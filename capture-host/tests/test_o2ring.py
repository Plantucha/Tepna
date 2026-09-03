# tepna-capture — tests/test_o2ring.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Coverage for o2ring: crc, framing, auth generator, AES, encrypted handshake, transport,
file ops, CLI.

Two fakes:
  FakeDev  — a dumb reply queue (transport-level tests only; it never models ring behaviour).
  FakeRing — a stateful ring simulator. Old firmware: AUTH is fire-and-forget, HELLO acks
             (verified on hardware 2026-08-30). New firmware (encrypted=True): built from the
             vendor SDK logic — answers 0xFF with flag=1 + 20-byte key blob, then REQUIRES every
             request payload to be AES/ECB/PKCS5 and encrypts every reply. The regression that
             matters is DIFFERENTIAL: the same recording pulled from both rings must be identical.
"""
import hashlib
import os
import re
import struct
import sys

import pytest

import o2ring
from tests._srcscan import function_source

_LEPU = hashlib.md5(b"lepucloud").digest()


@pytest.fixture(autouse=True)
def _fresh_session():
    o2ring.SESSION.reset()
    yield
    o2ring.SESSION.reset()


class FakeDev:
    def __init__(self, replies=None):
        self.written = []
        self.replies = [bytes(r) for r in (replies or [])]

    def write(self, data):
        self.written.append(bytes(data))
        return len(data)

    def read(self, size, timeout_ms=0):
        return list(self.replies.pop(0)) if self.replies else []

    def set_nonblocking(self, v):
        self.nb = v

    def close(self):
        self.closed = True


def reply(op, payload=b""):
    return o2ring.encode(op, payload)


def _frame_reports(op, payload, flag=1):
    """Ring-side framing: [len][body][crc] split into 64-byte reports with the 0x3f-continuation
    rule (content = body + crc, only the first report carries the header)."""
    n = len(payload)
    body = bytes([0xA5, op, (~op) & 0xFF, flag, 0, n & 0xFF, n >> 8]) + payload
    content = body + bytes([o2ring.crc8_smbus(body)])
    reports = []
    for i in range(0, len(content), 63):
        chunk = content[i:i + 63]
        reports.append((bytes([len(chunk)]) + chunk).ljust(64, b"\x00"))
    return reports


class FakeRing:
    """Stateful O2Ring-S simulator. See module docstring for provenance of each behaviour."""

    def __init__(self, sessions=None, encrypted=False, key=None, info=None,
                 hello_after_auth=True, chunk=512):
        self.sessions = dict(sessions or {})
        self.encrypted = encrypted
        self.key = key or bytes(range(0x10, 0x20))
        self.info = info if info is not None else bytes(24) + bytes([0xEA, 0x07, 8, 30, 9, 21, 14])
        self.hello_after_auth = hello_after_auth
        self.chunk = chunk
        self.queue = []
        self.authed = False
        self.keyed = False
        self.log = []                 # (op, plaintext_payload) of every well-formed request
        self.auth_after_key = 0       # AUTH frames received after the encrypted session was in use
        self.bad_requests = 0         # frames that did not decrypt / were not encrypted when required
        self.enc_requests = 0

    # -- transport side -----------------------------------------------------------------
    def write(self, data):
        rep = bytes(data)[1:]         # strip the 0x00 report id
        n = rep[0]
        body = rep[1:n]               # drop crc
        if len(body) < 7 or body[0] not in (0xA5, 0xAA):
            return len(data)
        if o2ring.crc8_smbus(body) != rep[n]:
            self.bad_requests += 1
            return len(data)
        op = body[1]
        plen = body[5] | (body[6] << 8)
        payload = body[7:7 + plen]
        self._handle(body[0], op, payload)
        return len(data)

    def read(self, size, timeout_ms=0):
        return list(self.queue.pop(0)) if self.queue else []

    def set_nonblocking(self, v):
        pass

    def close(self):
        self.closed = True

    # -- ring logic ---------------------------------------------------------------------
    def _reply(self, op, payload=b""):
        if self.keyed:
            payload = o2ring.aes_ecb_encrypt(self.key, payload)
        self.queue += _frame_reports(op, payload)

    def _handle(self, magic, op, payload):
        if op == o2ring.OP_AUTH:
            if self.keyed:
                # The client sends the a5 and aa AUTH variants back-to-back (old-ring readiness),
                # so one extra AUTH right after the key is expected; what must never happen is an
                # AUTH once the encrypted session is in use (the ring would re-key underneath us).
                if self.enc_requests:
                    self.auth_after_key += 1
                return
            self.authed = True
            if self.encrypted:
                # SDK: r = content XOR md5 cyclic; r[0]=type, r[1]=len, key=r[4:4+len]
                blob = bytes([0x01, len(self.key), 0, 0]) + self.key
                enc = bytes(b ^ _LEPU[i % 16] for i, b in enumerate(blob))
                self.queue += _frame_reports(o2ring.OP_AUTH, enc, flag=1)   # key blob is NOT AES
                self.keyed = True
            return
        if self.keyed:
            try:
                payload = o2ring.aes_ecb_decrypt(self.key, payload)
                self.enc_requests += 1
            except ValueError:
                # Plaintext frames the client queued in the same batch as its AUTH (poll + HELLO)
                # land here before it has seen the key reply — harmless, the ring ignores them.
                # A plaintext frame AFTER the client has spoken AES is a client bug.
                if self.enc_requests:
                    self.bad_requests += 1
                return                # a new ring parsing garbage: no sane reply
        self.log.append((op, payload))
        if not self.authed:
            return
        if op == o2ring.OP_HELLO:
            if self.hello_after_auth:
                self._reply(op)
        elif op == o2ring.OP_GET_INFO:
            self._reply(op, self.info)
        elif op == o2ring.OP_FILE_LIST:
            slots = b"".join(sid.encode().ljust(16, b"\x00") for sid in self.sessions)
            self._reply(op, bytes([len(self.sessions)]) + slots)
        elif op == o2ring.OP_FILE_START:
            if len(payload) != 24:
                return                # malformed (e.g. probe sweep): no answer
            sid = payload[:14].split(b"\x00")[0].decode()
            self.cur = self.sessions.get(sid)
            self._reply(op, struct.pack("<I", len(self.cur)) if self.cur is not None else b"")
        elif op == o2ring.OP_FILE_DATA:
            if len(payload) != 4 or getattr(self, "cur", None) is None:
                return
            (off,) = struct.unpack("<I", payload)
            self._reply(op, self.cur[off:off + self.chunk])
        elif op == o2ring.OP_FILE_END:
            self._reply(op)
        elif magic == 0xA5:
            self._reply(op, b"\x11\x22")   # generic probe answer


def _synthetic_dat(n_samples=300):
    body = bytes([1, 3, 0, 0, 0, 0, 0, 0, 4, 0])
    body += b"".join(bytes([95 + i % 4, 60 + i % 7, 0]) for i in range(n_samples))
    body += b"\xff\xff\x00"
    tail = bytearray(48)
    tail[4:8] = o2ring.OXY_TRAILER_MAGIC
    return body + bytes(tail)


# ------------------------------------------------------------------ frames / auth -------

def test_known_command_frames():
    assert o2ring.encode(o2ring.OP_HELLO)[:9].hex() == "08a5e01f0000000022"
    assert o2ring.encode(o2ring.OP_GET_INFO)[:9].hex() == "08a5e11e0000000069"
    assert o2ring.encode(o2ring.OP_FILE_LIST)[:9].hex() == "08a5f10e00000000c5"


def test_encode_empty_payload_shape():
    frame = o2ring.encode(o2ring.OP_HELLO)
    assert frame[0] == 0x08 and len(frame) == 64


def test_encode_too_long_raises():
    with pytest.raises(ValueError, match="frame exceeds 64 bytes"):
        o2ring.encode(0x01, b"\x00" * 56)


def test_decode_short_body_returns_none_op():
    rep = bytes([4, 1, 2, 3]).ljust(64, b"\x00")
    assert o2ring.decode(rep)["op"] is None


def test_decode_full_frame():
    msg = o2ring.decode(reply(o2ring.OP_GET_INFO, b"\xaa\xbb"))
    assert msg["op"] == o2ring.OP_GET_INFO
    assert msg["payload"] == b"\xaa\xbb"


def test_auth_reproduces_captured_aa_variant():
    got = o2ring.build_auth(b"0000", ts=1788096060, magic=0xAA)[:25]
    assert got == bytes.fromhex("18aaff00000010000068158872091cb098c8c7daf86da199b4")


def test_auth_reproduces_captured_a5_variant():
    got = o2ring.build_auth(b"0000", ts=1788095920, magic=0xA5)[:25]
    assert got == bytes.fromhex("18a5ff00000010000068158872091cb098c8c7da746ea19925")


def test_auth_payload_default_ts_uses_clock(monkeypatch):
    monkeypatch.setattr(o2ring.time, "time", lambda: 1788096060)
    assert o2ring.auth_payload(b"0000") == o2ring.auth_payload(b"0000", ts=1788096060)


def test_auth_payload_short_serial_padded():
    pl = o2ring.auth_payload(b"12", ts=0)
    key = bytes(a ^ b for a, b in zip(pl, o2ring._LEPU))
    assert key[8:12] == b"1200"


# ------------------------------------------------------------------ AES ----------------

@pytest.mark.parametrize("key_hex,ct_hex", [
    ("000102030405060708090a0b0c0d0e0f", "69c4e0d86a7b0430d8cdb78070b4c55a"),                  # FIPS-197 C.1
    ("000102030405060708090a0b0c0d0e0f1011121314151617", "dda97ca4864cdfe06eaf70a0ec0d7191"),  # C.2
    ("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
     "8ea2b7ca516745bfeafc49904b496089"),                                                     # C.3
])
def test_aes_fips197_vectors(key_hex, ct_hex):
    key, pt = bytes.fromhex(key_hex), bytes.fromhex("00112233445566778899aabbccddeeff")
    assert o2ring.aes_encrypt_block(key, pt).hex() == ct_hex
    assert o2ring.aes_decrypt_block(key, bytes.fromhex(ct_hex)) == pt


def test_aes_fips197_appendix_b():
    key = bytes.fromhex("2b7e151628aed2a6abf7158809cf4f3c")
    pt = bytes.fromhex("3243f6a8885a308d313198a2e0370734")
    assert o2ring.aes_encrypt_block(key, pt).hex() == "3925841d02dc09fbdc118597196a0b32"


def test_aes_ecb_pkcs5_roundtrip_and_shapes():
    key = bytes(range(16))
    assert len(o2ring.aes_ecb_encrypt(key, b"")) == 16            # SDK: empty payload -> one block
    assert len(o2ring.aes_ecb_encrypt(key, b"x" * 16)) == 32
    assert len(o2ring.aes_ecb_encrypt(key, b"x" * 512)) == 528    # FILE_DATA chunk
    for n in (0, 1, 15, 16, 17, 512):
        data = bytes((i * 7) & 0xFF for i in range(n))
        assert o2ring.aes_ecb_decrypt(key, o2ring.aes_ecb_encrypt(key, data)) == data


def test_aes_ecb_decrypt_rejects_garbage():
    """Three DIFFERENT failures, and the message is what separates them.

    All three are ValueError, so asserting the type alone cannot tell a truncated ciphertext from
    a bad pad from a bad key length — a mutation run made the point by replacing every message
    with `ValueError(None)` and leaving this test green.
    """
    key = bytes(range(16))
    with pytest.raises(ValueError, match="not a multiple of 16"):
        o2ring.aes_ecb_decrypt(key, b"\x00" * 15)
    with pytest.raises(ValueError, match="bad PKCS5 padding"):
        o2ring.aes_ecb_decrypt(key, b"\x00" * 16)          # decrypts to junk -> bad padding
    with pytest.raises(ValueError, match="must be 16, 24 or 32 bytes"):
        o2ring._expand_key(b"\x00" * 15)


# FIPS-197 Appendix C known-answer vectors: one plaintext block, one key per length.
#
# WHY A PUBLISHED VECTOR AND NOT A SECOND LIBRARY. This used to build its reference with
# `Cipher(algorithms.AES(key), modes.ECB())` from `cryptography` and compare against that, which
# code scanning flagged — correctly, in the narrow sense that an ECB construction is an ECB
# construction even in a test. ECB is not our choice: it is the O2Ring's wire format, fixed by
# the vendor SDK. But the flag was worth listening to, because the standard is the better oracle
# anyway: it cannot drift with a dependency, it needs no dependency at all (so this runs
# everywhere instead of being skipped where `cryptography` is absent, which is how it behaved
# before), and it is the reference the library itself is written against.
_FIPS197_PLAINTEXT = bytes.fromhex("00112233445566778899aabbccddeeff")
_FIPS197_ECB = {                       # key = bytes(range(klen))
    16: "69c4e0d86a7b0430d8cdb78070b4c55a",
    24: "dda97ca4864cdfe06eaf70a0ec0d7191",
    32: "8ea2b7ca516745bfeafc49904b496089",
}


def test_aes_matches_the_fips197_known_answers():
    """The check a wrong-but-self-consistent implementation cannot pass.

    A round trip only proves encrypt and decrypt agree with each other; two mirrored mistakes
    survive it. A published ciphertext does not.
    """
    for klen, expected in _FIPS197_ECB.items():
        key = bytes(range(klen))
        out = o2ring.aes_ecb_encrypt(key, _FIPS197_PLAINTEXT)
        assert out[:16].hex() == expected, f"AES-{klen * 8} first block"
        # PKCS7 appends a WHOLE block to an exact multiple, so 16 B in gives 32 B out.
        assert len(out) == 32, "PKCS7 must pad an exact multiple by a full block"
        assert o2ring.aes_ecb_decrypt(key, out) == _FIPS197_PLAINTEXT


def test_aes_round_trips_across_sizes_and_key_lengths():
    """The padding path the single-block vectors do not reach: empty, short, exact, multi-block.

    The empty case matters to the protocol: the SDK sends an empty payload as one padded block,
    so a command with no arguments is 16 bytes on the wire, not 0.
    """
    for klen in (16, 24, 32):
        key = os.urandom(klen)
        for n in (0, 5, 16, 100, 512):
            data = os.urandom(n)
            ct = o2ring.aes_ecb_encrypt(key, data)
            assert len(ct) % 16 == 0 and len(ct) > n
            assert o2ring.aes_ecb_decrypt(key, ct) == data


# ------------------------------------------------------------------ handshake ---------

def test_parse_key_reply_sdk_layout():
    key = bytes(range(0x30, 0x40))
    blob = bytes([1, 16, 0, 0]) + key
    payload = bytes(b ^ _LEPU[i % 16] for i, b in enumerate(blob))
    assert len(payload) == 20
    assert o2ring.parse_key_reply(payload) == key


def test_parse_key_reply_rejects_short_or_odd_len():
    assert o2ring.parse_key_reply(b"\x00" * 19) is None
    blob = bytes([1, 7, 0, 0]) + bytes(16)                    # 7 is not an AES key length
    assert o2ring.parse_key_reply(bytes(b ^ _LEPU[i % 16] for i, b in enumerate(blob))) is None
    blob = bytes([1, 32, 0, 0]) + bytes(16)                   # claims 32 B but only 16 present
    assert o2ring.parse_key_reply(bytes(b ^ _LEPU[i % 16] for i, b in enumerate(blob))) is None


def test_cipher_wrap_unwrap_rules(capsys):
    c = o2ring.Cipher()
    assert c.wrap(o2ring.OP_GET_INFO, b"ab") == b"ab"             # no key: plaintext
    c.key = bytes(16)
    assert c.wrap(o2ring.OP_AUTH, b"ab") == b"ab"                  # AUTH always plain
    assert c.unwrap(o2ring.OP_AUTH, b"ab") == b"ab"
    assert len(c.wrap(o2ring.OP_GET_INFO, b"")) == 16
    assert c.unwrap(o2ring.OP_HELLO, b"") == b""                   # not AES-shaped: pass-through
    assert c.unwrap(o2ring.OP_HELLO, b"\x01\x02\x03") == b"\x01\x02\x03"
    junk = b"\x00" * 16
    assert c.unwrap(o2ring.OP_GET_INFO, junk) == junk and c.errors == 1
    assert "did not decrypt" in capsys.readouterr().out
    assert c.unwrap(o2ring.OP_GET_INFO, c.wrap(o2ring.OP_GET_INFO, b"hi")) == b"hi"


def test_authenticate_old_ring_hello_ack(capsys):
    ring = FakeRing()
    rep = o2ring.authenticate(ring)
    assert rep["op"] == o2ring.OP_HELLO
    assert o2ring.SESSION.key is None
    assert "hello ack" in capsys.readouterr().out
    assert any(op == o2ring.OP_HELLO for op, _ in ring.log)


def test_authenticate_new_ring_installs_key_then_hello(capsys):
    ring = FakeRing(encrypted=True)
    rep = o2ring.authenticate(ring)
    assert rep["op"] == o2ring.OP_HELLO
    assert o2ring.SESSION.key == ring.key
    assert ring.auth_after_key == 0            # AUTH not re-sent once keyed (would re-key)
    assert ring.bad_requests == 0
    assert ring.enc_requests >= 1              # the HELLO that got acked went out encrypted
    out = capsys.readouterr().out
    assert "128-bit AES session key installed" in out and "[AES session]" in out


def test_authenticate_new_ring_keyed_without_hello_returns_after_grace(capsys):
    ring = FakeRing(encrypted=True, hello_after_auth=False)
    rep = o2ring.authenticate(ring, keyed_grace_s=0)
    assert rep["op"] == o2ring.OP_AUTH and rep["flag"] == 1
    assert o2ring.SESSION.key == ring.key
    assert "no hello ack" in capsys.readouterr().out


def test_authenticate_ignores_non_key_auth_reply(capsys):
    dev = FakeDev([o2ring.encode(o2ring.OP_AUTH, b"\x01", flag=1)])
    assert o2ring.authenticate(dev, timeout_s=0.05) is None
    assert o2ring.SESSION.key is None
    assert "not a key blob" in capsys.readouterr().out


def test_authenticate_timeout_quiet():
    assert o2ring.authenticate(FakeDev([]), timeout_s=0, verbose=False) is None


def test_send_cmd_encrypts_when_keyed():
    dev = FakeDev()
    o2ring.send_cmd(dev, o2ring.OP_GET_INFO)
    assert dev.written[-1][1:10].hex() == "08a5e11e0000000069"
    o2ring.SESSION.key = bytes(16)
    o2ring.send_cmd(dev, o2ring.OP_GET_INFO)
    frame = dev.written[-1][1:]
    assert frame[0] == 8 + 16 and frame[6] == 16                 # 16-byte ciphertext for empty payload
    o2ring.send_cmd(dev, o2ring.OP_AUTH, b"\x00" * 16)
    assert dev.written[-1][1:][0] == 8 + 16                        # AUTH untouched


# ------------------------------------------------------------------ transport --------

def test_open_device_uses_fake_hid(monkeypatch):
    class FakeHidDev:
        def open(self, vid, pid):
            self.ids = (vid, pid)

        def set_nonblocking(self, v):
            self.nb = v

    class FakeHidMod:
        def device(self):
            return FakeHidDev()

    monkeypatch.setitem(sys.modules, "hid", FakeHidMod())
    dev = o2ring.open_device()
    assert dev.ids == (o2ring.VID, o2ring.PID)


def test_send_prepends_report_id():
    dev = FakeDev()
    o2ring.send(dev, b"\x01" * 64)
    assert dev.written[0][0] == 0x00 and len(dev.written[0]) == 65


def test_read_report_none_when_empty():
    assert o2ring.read_report(FakeDev()) is None


def test_read_reply_skips_short_and_matches_op():
    short = bytes([5, 0, 0, 0, 0, 0]).ljust(64, b"\x00")
    dev = FakeDev([short, reply(o2ring.OP_HELLO), reply(o2ring.OP_AUTH, b"\x01")])
    msg = o2ring.read_reply(dev, want_op=o2ring.OP_AUTH)
    assert msg["op"] == o2ring.OP_AUTH


def test_read_reply_returns_none_when_exhausted():
    assert o2ring.read_reply(FakeDev(), want_op=o2ring.OP_AUTH, tries=3) is None


def test_read_reply_any_op():
    dev = FakeDev([reply(o2ring.OP_HELLO, b"\x09")])
    assert o2ring.read_reply(dev)["op"] == o2ring.OP_HELLO


def test_read_reply_reassembles_multi_report_frame():
    payload = bytes(i & 0xFF for i in range(512))
    dev = FakeDev(_frame_reports(o2ring.OP_FILE_DATA, payload))
    msg = o2ring.read_reply(dev, want_op=o2ring.OP_FILE_DATA)
    assert msg["payload"] == payload


def test_read_reply_decrypts_when_keyed():
    key = bytes(range(16))
    o2ring.SESSION.key = key
    dev = FakeDev(_frame_reports(o2ring.OP_GET_INFO, o2ring.aes_ecb_encrypt(key, b"serial!")))
    assert o2ring.read_reply(dev, want_op=o2ring.OP_GET_INFO)["payload"] == b"serial!"


# ------------------------------------------------------------------ file ops ---------

def test_file_list_parses_slots():
    slot = b"20260830132000" + b"\x00\x00"
    dev = FakeDev([reply(o2ring.OP_FILE_LIST, bytes([1]) + slot)])
    assert o2ring.file_list(dev) == ["20260830132000"]


class RingNeedingAReset:
    """A ring whose FILE_LIST state machine is stalled until a FILE_END clears it.

    Deliberately NOT more capable than the hardware: it answers F1 only after it has SEEN an
    F4, which is exactly the recovery under test. A fake that answered F1 unconditionally
    would pass this test while proving nothing about the ring — the defect that produced a
    green suite over a client that could never authenticate.
    """

    def __init__(self, slot):
        self.slot = slot
        self.reset_seen = False
        self.pending = []
        self.ops = []

    def write(self, data):
        frame = bytes(data)[1:]              # send() prepends the 0x00 report id
        op = frame[2] if len(frame) > 2 else None
        self.ops.append(op)
        if op == o2ring.OP_FILE_END:
            self.reset_seen = True
        elif op == o2ring.OP_FILE_LIST and self.reset_seen:
            self.pending = [bytes(r) for r in
                            _frame_reports(o2ring.OP_FILE_LIST, bytes([1]) + self.slot)]
        return len(data)

    def read(self, size, timeout_ms=0):
        return list(self.pending.pop(0)) if self.pending else []

    def set_nonblocking(self, v):
        pass

    def close(self):
        pass


def test_file_list_resets_the_ring_and_retries_when_it_goes_quiet():
    """F1 silent -> F4 -> F1 again. Observed on a branch-2D010001 ring after a recording closed."""
    slot = b"20260902231709" + b"\x00\x00"
    dev = RingNeedingAReset(slot)
    assert o2ring.file_list(dev) == ["20260902231709"]
    assert o2ring.OP_FILE_END in dev.ops, "the stalled state machine was never reset"
    assert dev.ops.count(o2ring.OP_FILE_LIST) == 2, "F1 was not retried after the reset"


def test_a_silent_ring_raises_rather_than_reporting_no_recordings():
    """The bug this replaces: a ring that would not answer read as a ring with nothing on it.

    Returning [] made a transport failure indistinguishable from an empty ring, so a caller
    iterating the result did nothing at all and reported success.
    """
    try:
        o2ring.file_list(FakeDev())
    except RuntimeError as exc:
        assert "NOT a ring with no recordings" in str(exc)
    else:
        raise AssertionError("a silent ring was reported as an empty one")


def test_an_actually_empty_ring_is_still_empty():
    """The other side of it: count 0 is a real answer and must stay a plain empty list."""
    assert o2ring.file_list(FakeDev([reply(o2ring.OP_FILE_LIST, bytes([0]))])) == []


def test_file_start_and_data_and_end():
    dev = FakeDev([reply(o2ring.OP_FILE_START, struct.pack("<I", 3))])
    assert o2ring.file_start(dev, "20260830132000") is not None
    assert dev.written[0][1:][0] == 8 + 24                          # 24-byte session-id payload
    dev = FakeDev([reply(o2ring.OP_FILE_DATA, b"\x01\x02\x03")])
    assert o2ring.file_data(dev, 0)["payload"] == b"\x01\x02\x03"
    dev = FakeDev([reply(o2ring.OP_FILE_END)])
    assert o2ring.file_end(dev)["op"] == o2ring.OP_FILE_END


def test_pull_session_reassembles(capsys):
    dev = FakeDev([
        reply(o2ring.OP_FILE_START, struct.pack("<I", 6)),
        reply(o2ring.OP_FILE_DATA, b"\x01\x02\x03"),
        reply(o2ring.OP_FILE_DATA, b"\x04\x05\x06"),
        reply(o2ring.OP_FILE_END),
    ])
    assert o2ring.pull_session(dev, "sid") == b"\x01\x02\x03\x04\x05\x06"


def test_pull_session_raises_without_start():
    with pytest.raises(RuntimeError):
        o2ring.pull_session(FakeDev(), "sid")


def test_pull_session_no_size_breaks_on_empty():
    dev = FakeDev([
        reply(o2ring.OP_FILE_START, b"\x00"),
        reply(o2ring.OP_FILE_DATA, b""),
        reply(o2ring.OP_FILE_END),
    ])
    assert o2ring.pull_session(dev, "sid") == b""


def test_pull_session_detects_complete_trailer(capsys):
    tail = bytearray(48)
    tail[4:8] = o2ring.OXY_TRAILER_MAGIC
    dev = FakeDev([
        reply(o2ring.OP_FILE_START, struct.pack("<I", 48)),
        reply(o2ring.OP_FILE_DATA, bytes(tail)),
        reply(o2ring.OP_FILE_END),
    ])
    o2ring.pull_session(dev, "sid")
    assert "complete-trailer=True" in capsys.readouterr().out


# ------------------------------------------------------- differential: old vs new ring -

SID = "20260829225715"


def _full_pull(ring):
    assert o2ring.authenticate(ring, verbose=False) is not None
    sids = o2ring.file_list(ring)
    return sids, o2ring.pull_session(ring, SID)


def test_differential_pull_plaintext_vs_encrypted_ring(capsys):
    dat = _synthetic_dat(300)                       # 10 + 903 + 48 = 961 B -> two FILE_DATA chunks
    old = FakeRing({SID: dat})
    new = FakeRing({SID: dat}, encrypted=True, key=os.urandom(16))
    sids_old, data_old = _full_pull(old)
    sids_new, data_new = _full_pull(new)
    assert sids_old == sids_new == [SID]
    assert data_old == data_new == dat
    assert "complete-trailer=True" in capsys.readouterr().out
    # the new ring really was driven encrypted end-to-end
    assert new.enc_requests >= 5 and new.bad_requests == 0 and new.auth_after_key == 0
    assert o2ring.SESSION.errors == 0
    # ... and it saw the same plaintext requests the old ring did (minus the readiness chatter)
    chatter = {o2ring.OP_HELLO, 0x15}
    assert [e for e in new.log if e[0] not in chatter] == \
           [e for e in old.log if e[0] not in chatter]
    assert [e[0] for e in new.log if e[0] not in chatter] == \
           [o2ring.OP_FILE_LIST, o2ring.OP_FILE_START, o2ring.OP_FILE_DATA, o2ring.OP_FILE_DATA,
            o2ring.OP_FILE_END]


def test_differential_get_info(capsys):
    info = bytes(range(38)) + b"2662302184" + bytes(10)
    old, new = FakeRing(info=info), FakeRing(info=info, encrypted=True)
    got = []
    for ring in (old, new):
        o2ring.authenticate(ring, verbose=False)
        o2ring.send_cmd(ring, o2ring.OP_GET_INFO)
        got.append(o2ring.read_reply(ring, want_op=o2ring.OP_GET_INFO)["payload"])
    assert got[0] == got[1] == info


def test_encrypted_ring_breaks_a_plaintext_only_client():
    """The bug: a client that ignores the key reply parses ciphertext (SomnoTrace #180 symptom)."""
    ring = FakeRing(encrypted=True)
    o2ring.send(ring, o2ring.build_auth())          # raw AUTH, reply ignored
    o2ring.SESSION.reset()                          # client never installs the key
    ring.queue.clear()                              # (drop the key reply, as the buggy client does)
    o2ring.send(ring, o2ring.encode(o2ring.OP_GET_INFO))   # plaintext request ...
    assert ring.queue == [] and ring.log == []      # ... which the ring cannot decrypt: silence
    # and whatever the ring does answer is ciphertext to a key-less client:
    o2ring.send(ring, o2ring.encode(o2ring.OP_GET_INFO, o2ring.aes_ecb_encrypt(ring.key, b"")))
    msg = o2ring.read_reply(ring, want_op=o2ring.OP_GET_INFO)
    assert msg["payload"] != ring.info and len(msg["payload"]) == 32   # 31 B info -> 2 blocks


# ------------------------------------------------------------------- _emit_csv --------

def test_emit_csv_with_and_without_trailer(tmp_path, capsys):
    import parse_dat
    data, _, _ = parse_dat._build_synthetic_dat()
    p = tmp_path / "20260830132000.dat"
    p.write_bytes(data)
    o2ring._emit_csv(str(p))
    assert (tmp_path / "20260830132000.csv").exists()
    assert "self-consistency" in capsys.readouterr().out
    p2 = tmp_path / "20260830132000_b.dat"
    p2.write_bytes(b"\x00" * 10 + b"\x5f\x3c\x00")
    o2ring._emit_csv(str(p2))
    assert (tmp_path / "20260830132000_b.csv").exists()


def test_emit_csv_import_error(monkeypatch, tmp_path, capsys):
    monkeypatch.setitem(sys.modules, "parse_dat", None)
    o2ring._emit_csv(str(tmp_path / "x.dat"))
    assert "parse_dat.py not importable" in capsys.readouterr().out


# ------------------------------------------------------------------- main CLI ---------

def _main(monkeypatch, argv, dev):
    monkeypatch.setattr(o2ring, "open_device", lambda: dev)
    monkeypatch.setattr("sys.argv", argv)
    o2ring.main()


def test_main_monitor(monkeypatch, capsys):
    dev = FakeDev([reply(o2ring.OP_HELLO, b"\x01")])
    _main(monkeypatch, ["o2ring.py", "monitor", "--seconds", "0.05"], dev)
    assert "IN:" in capsys.readouterr().out


def test_main_replay(monkeypatch, capsys):
    dev = FakeDev([reply(o2ring.OP_AUTH, b"\x01")])
    _main(monkeypatch, ["o2ring.py", "replay", "18aaff00"], dev)
    assert "reply:" in capsys.readouterr().out


@pytest.mark.parametrize("encrypted", [False, True])
def test_main_auth(monkeypatch, encrypted):
    _main(monkeypatch, ["o2ring.py", "auth"], FakeRing(encrypted=encrypted))


@pytest.mark.parametrize("encrypted", [False, True])
def test_main_info_with_rtc(monkeypatch, capsys, encrypted):
    _main(monkeypatch, ["o2ring.py", "info"], FakeRing(encrypted=encrypted))
    assert "RTC = 2026-08-30 09:21:14" in capsys.readouterr().out


def test_main_info_short_payload(monkeypatch, capsys):
    _main(monkeypatch, ["o2ring.py", "info"], FakeRing(info=b"\x00"))
    assert "GET_INFO payload:" in capsys.readouterr().out


@pytest.mark.parametrize("encrypted", [False, True])
def test_main_list(monkeypatch, capsys, encrypted):
    _main(monkeypatch, ["o2ring.py", "list"], FakeRing({SID: b"\x01"}, encrypted=encrypted))
    assert SID in capsys.readouterr().out


@pytest.mark.parametrize("encrypted", [False, True])
def test_main_pull(monkeypatch, tmp_path, capsys, encrypted):
    out = tmp_path / "rec.dat"
    dat = _synthetic_dat(20)
    _main(monkeypatch, ["o2ring.py", "pull", SID, "-o", str(out)],
          FakeRing({SID: dat}, encrypted=encrypted))
    assert out.read_bytes() == dat
    assert "saved" in capsys.readouterr().out


@pytest.mark.parametrize("encrypted", [False, True])
def test_main_pull_all(monkeypatch, tmp_path, encrypted):
    dat = _synthetic_dat(20)
    _main(monkeypatch, ["o2ring.py", "pull-all", "-d", str(tmp_path)],
          FakeRing({SID: dat}, encrypted=encrypted))
    assert (tmp_path / f"{SID}.dat").read_bytes() == dat


# ------------------------------------------------------------------- probe ------------

@pytest.mark.parametrize("encrypted", [False, True])
def test_probe_safe_reports_replies(capsys, encrypted):
    o2ring.cmd_probe(FakeRing(encrypted=encrypted))
    out = capsys.readouterr().out
    assert "safe read-only probe" in out
    assert "GET_INFO" in out and "GET_BATTERY" in out
    assert "payload=11 22" in out                      # generic answers decrypted fine
    assert "did not decrypt" not in out


def test_probe_safe_handles_no_reply(monkeypatch, capsys):
    monkeypatch.setattr(o2ring, "authenticate", lambda dev: None)   # skip the 90 s hello loop
    o2ring.cmd_probe(FakeDev([]))                     # nothing answers
    assert "(no reply)" in capsys.readouterr().out


def test_probe_sweep_skips_destructive(capsys):
    ring = FakeRing()
    o2ring.cmd_probe(ring, sweep=True)
    out = capsys.readouterr().out
    assert "full opcode sweep" in out
    assert "op=0xe3 FACTORY_RESET  -> SKIPPED (destructive)" in out
    assert "op=0xee FACTORY_RESET_ALL -> SKIPPED (destructive)" in out
    assert not any(op in o2ring.DESTRUCTIVE for op, _ in ring.log)


def test_main_probe(monkeypatch, capsys):
    _main(monkeypatch, ["o2ring.py", "probe"], FakeRing())
    assert "safe read-only probe" in capsys.readouterr().out


def test_replay_refuses_destructive(monkeypatch, capsys):
    dev = FakeDev([])
    _main(monkeypatch, ["o2ring.py", "replay", "18a5e3"], dev)   # op byte = 0xe3
    out = capsys.readouterr().out
    assert "REFUSED" in out
    assert dev.written == []                                     # nothing sent


def test_parse_key_reply_rejects_an_unknown_type_byte():
    """r[0] is the blob type; only 0x01 (AES) is defined. Anything else is not a key we know.

    Installing a key from a blob whose type we do not recognise is the fabricated-vitals shape
    one layer down: every subsequent reply would decrypt to plausible-looking rubbish.
    """
    key = bytes(range(0x10, 0x20))
    plain = bytes([0x02, 16, 0, 0]) + key
    blob = bytes(b ^ o2ring._LEPU[i % 16] for i, b in enumerate(plain))
    assert o2ring.parse_key_reply(blob) is None

# ── the paths a real ring reaches only when something goes wrong ─────────────────────────
#
# Everything below closes a gap in o2ring.py's own coverage. The module is NEW in this branch,
# so none of it is inherited debt — it is the branch's to cover, and a partial branch here is a
# reachable path nobody has ever run.


class _Clock:
    """A controllable `time.time` so the 0.9 s AUTH deadline is deterministic, not slept through.

    The fake device ticks it on every read, which is what lets the deadline expire naturally
    inside the loop rather than by wall time.
    """

    def __init__(self, step=0.0):
        self.t = 1_000_000.0
        self.step = step

    def __call__(self):
        return self.t

    def tick(self, dt):
        self.t += dt


class _TickingDev(FakeDev):
    """FakeDev that advances a clock on each read, so time passes only when the code reads."""

    def __init__(self, clock, dt, replies=None):
        super().__init__(replies)
        self._clock, self._dt = clock, dt

    def read(self, size, timeout_ms=0):
        self._clock.tick(self._dt)
        return super().read(size, timeout_ms)


def test_a_truncated_continuation_yields_no_frame():
    """A report claiming 0x3f more bytes, with nothing following it.

    Covers both halves of one real fault: the continuation loop breaking on a missing report, and
    the runt buffer that leaves. A ring that stops mid-frame must produce no message at all —
    silence is the correct outcome, not a short frame passed on to a parser.
    """
    dev = FakeDev([bytes([0x3F, 0xA5, o2ring.OP_HELLO])])
    assert o2ring.read_reply(dev, want_op=o2ring.OP_HELLO) is None


def test_auth_is_quiet_about_a_non_key_reply_when_not_verbose(monkeypatch, capsys):
    """verbose=False must print nothing, and must still refuse to treat 16 bytes as a key.

    The 16-byte reply is the measured branch-2D010001 case: it is not a key blob, the session
    stays plaintext, and a quiet caller should see no diagnostics at all.
    """
    clock = _Clock()
    monkeypatch.setattr(o2ring.time, "time", clock)
    not_a_key = o2ring.encode(o2ring.OP_AUTH, bytes(16), flag=1)
    dev = _TickingDev(clock, 0.5, [not_a_key, not_a_key, not_a_key])

    assert o2ring.authenticate(dev, timeout_s=8.0, verbose=False) is None
    assert o2ring.SESSION.key is None, "16 bytes must never install a key"
    assert capsys.readouterr().out == "", "verbose=False printed anyway"


def test_auth_returns_the_key_reply_when_the_hello_never_comes(monkeypatch, capsys):
    """A key installs, the ring then goes quiet, and the grace window expires.

    GET_INFO decrypting cleanly is the real proof of a session, so a missing HELLO ack after a
    successful key negotiation is not a failure — but it must be reported as the key reply, not
    as a hello.
    """
    clock = _Clock()
    monkeypatch.setattr(o2ring.time, "time", clock)
    key = bytes(range(0x20, 0x30))
    plain = bytes([0x01, 16, 0, 0]) + key
    blob = bytes(b ^ o2ring._LEPU[i % 16] for i, b in enumerate(plain))
    dev = _TickingDev(clock, 3.0, [o2ring.encode(o2ring.OP_AUTH, blob, flag=1)])
    try:
        got = o2ring.authenticate(dev, timeout_s=30.0, verbose=False,
                                  keyed_grace_s=1.0)
        assert got is not None and got["op"] == o2ring.OP_AUTH
        assert o2ring.SESSION.key == key
        assert capsys.readouterr().out == ""
    finally:
        o2ring.SESSION.reset()


def test_pull_stops_at_max_bytes_when_the_ring_reports_no_size():
    """FILE_START without a size field: the pull is bounded by max_bytes, not by the ring.

    A reply too short to carry a u32 leaves the size unknown, and an unbounded read against an
    unknown size is how a pull runs away. The cap is the only thing ending the loop here.
    """
    short_start = reply(o2ring.OP_FILE_START, b"\x01\x02")      # < 4 bytes -> size is None
    chunk = reply(o2ring.OP_FILE_DATA, b"\xAA" * 8)
    dev = FakeDev([short_start, chunk, reply(o2ring.OP_FILE_END)])
    data = o2ring.pull_session(dev, SID, max_bytes=4)
    assert data == b"\xAA" * 8, "the chunk that crossed the cap is kept whole"


def test_pull_all_over_a_ring_with_no_recordings(monkeypatch, tmp_path, capsys):
    """An empty ring is a valid answer: iterate nothing, close the device, say nothing saved."""
    _main(monkeypatch, ["o2ring.py", "pull-all", "-d", str(tmp_path)], FakeRing({}))
    assert "saved" not in capsys.readouterr().out
    assert list(tmp_path.iterdir()) == []


def test_selftest_subcommand_exits_with_its_own_status(monkeypatch, capsys):
    """`o2ring.py selftest` is the offline proof-of-codec path and must not touch a device."""
    monkeypatch.setattr(o2ring, "open_device",
                        lambda: pytest.fail("selftest opened a device"))
    monkeypatch.setattr("sys.argv", ["o2ring.py", "selftest"])
    with pytest.raises(SystemExit) as exc:
        o2ring.main()
    assert exc.value.code == 0, "the shipped self-test does not pass"
    assert "OK" in capsys.readouterr().out

def test_auth_ignores_a_frame_that_is_neither_auth_nor_hello(monkeypatch, capsys):
    """The ring interleaves status frames; the handshake must step over them, not stop.

    A `0x15` legacy-poll answer is neither the AUTH key reply nor the HELLO ack, and the loop has
    to keep going — treating any unexpected frame as terminal would abandon a handshake that was
    about to succeed.
    """
    clock = _Clock()
    monkeypatch.setattr(o2ring.time, "time", clock)
    other = reply(0x15, b"\x01\x02")
    hello = reply(o2ring.OP_HELLO, b"\x01")
    dev = _TickingDev(clock, 0.1, [other, hello])
    got = o2ring.authenticate(dev, timeout_s=8.0, verbose=False)
    assert got is not None and got["op"] == o2ring.OP_HELLO, "the hello after a status frame was lost"

def test_every_registered_subcommand_is_dispatched():
    """The invariant that the `# pragma: no branch` on the pull-all guard rests on.

    That pragma is correct *today* because all nine subparsers are dispatched and eight of them
    return unconditionally, so `a.cmd == "pull-all"` is invariantly true where it appears. But it
    is self-invalidating: add a tenth subparser that does not return, and the arc becomes
    reachable, the pragma silently masks it, and the symptom is "the new subcommand does nothing".
    No other test catches that, because the guard PREVENTS the misbehaviour instead of surfacing
    it — the invariant was held by inspection alone until this test.

    Both sides are derived from the source, so neither can decay into a hardcoded list of nine,
    and the scan goes through `function_source` because a bare read of a mutatable module poisons
    the mutation run (see tests/_srcscan.py).
    """
    src = function_source("o2ring.py", "main")
    registered = set(re.findall(r'add_parser\("([\w-]+)"', src))
    dispatched = set(re.findall(r'a\.cmd == "([\w-]+)"', src))

    # non-vacuity: a regex that matched nothing would make the comparison trivially true
    assert "pull-all" in registered, "the scan found no real subparsers — check the pattern"
    assert "pull-all" in dispatched, "the scan found no real dispatch sites — check the pattern"

    assert registered == dispatched, (
        f"registered but never dispatched (the subcommand would do nothing): "
        f"{sorted(registered - dispatched)}; "
        f"dispatched but never registered (dead branch): {sorted(dispatched - registered)}")
