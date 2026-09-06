# tepna-capture — oxyii.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Wellue O2Ring-S / T8520 "OxyII" BLE protocol — live SpO2 + pulse. This is NOT the legacy Viatom
# protocol (viatom.py / the 14839ac4 service); the T8520 exposes a separate "OxyII" service and every
# legacy tool silently fails against it. Reverse-engineered reference + verification on hardware
# 2026-07-16: github.com/nglessner/o2ring-s-protocol.
#
# Flow: connect (no bond) → auth (cmd=0xFF, XOR-keyed, no reply) → setup (cmd=0x10, ack) → poll
# cmd=0x04 (~1/s); its 24-byte header carries the live SpO2/HR/motion/battery the ring's display shows.
# The live path uses only CRC-8 + MD5 + XOR — NO AES (auth is XOR; 0x10/0x04 are plaintext).
#
# Frame: [0xA5][cmd][~cmd][flag][seq][len_lo][len_hi][payload][crc8], CRC-8 poly 0x07 over all-but-crc.

from __future__ import annotations
import hashlib, struct, time
from enum import Enum
from typing import NamedTuple

OXYII_SERVICE = "e8fb0001-a14b-98f9-831b-4e2941d01248"
OXYII_WRITE   = "e8fb0002-a14b-98f9-831b-4e2941d01248"   # write-without-response
OXYII_NOTIFY  = "e8fb0003-a14b-98f9-831b-4e2941d01248"   # notify
OP_AUTH, OP_SETUP, OP_LIVE, OP_SET_TIME = 0xFF, 0x10, 0x04, 0xC0

# Largest declared payload the reassembler will believe. Deliberately loose rather than tight: the live
# frame is tens of bytes and a stored-session chunk is bounded by the negotiated ATT MTU (247 measured
# 2026-07-18), so anything real is far below this — but a bound set near today's MTU would break the
# .dat transfer outright if a firmware ever negotiated the 517 MTU. 2048 cannot be reached by a genuine
# frame, still caps a mis-framed stream's damage at ~2 KB instead of ~64 KB, and cannot regress the pull.
MAX_FRAME_LEN = 2048
_LEPU = hashlib.md5(b"lepucloud").digest()   # protocol salt (MD5 of the literal ASCII "lepucloud")


def crc8(data: bytes) -> int:
    """CRC-8, poly 0x07, init 0, no reflection/xorout (standard "ITU" CRC-8 — NOT the legacy XOR sum)."""
    crc = 0
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = ((crc << 1) ^ 0x07) & 0xFF if (crc & 0x80) else (crc << 1) & 0xFF
    return crc


def encode(op: int, payload: bytes = b"", seq: int = 0, flag: int = 0) -> bytes:
    h = bytes([0xA5, op, (~op) & 0xFF, flag, seq & 0xFF, len(payload) & 0xFF, (len(payload) >> 8) & 0xFF])
    return h + payload + bytes([crc8(h + payload)])


def auth_payload(serial: str = "0000", ts: int | None = None) -> bytes:
    """16-byte XOR'd auth payload. serial: 4 ASCII bytes ("0000" is the portable default). ts: epoch s.

    🔴 THE TIMESTAMP IS A PLAIN LITTLE-ENDIAN uint32, and this used to shift by `>> 0,1,2,3` while its
    own docstring called that "a faithful port of the vendor code — both sides match". It was neither
    faithful nor matching; nobody had checked it against the vendor.

    Settled 2026-08-30 by a USB capture of the real O2 Insight Pro, and the discriminator is `key[13]`:

        over a 27 s window   >> 0,1,2,3 predicts key[13] takes 14 distinct values
                             LE uint32  predicts key[13] is CONSTANT
        the capture observed key[13:16] CONSTANT at 2e 94 6a, only key[12] moving

    So the shift form is refuted outright. And the confirmation is stronger than consistency: those
    bytes DECODE as an LE epoch to 2026-08-30 09:20–09:24, which is when the capture was running.
    A wrong encoding does not produce the right wall-clock time by accident.

    ⚠️ WHY THIS NEVER BROKE BLE, WHICH IS THE PUZZLE WORTH SAVING THE NEXT READER: our BLE auth has
    always worked with the wrong bytes, so the ring does NOT strictly validate this field — it
    tolerates it as a loose nonce. That is why a real encoding bug sat here behind a passing link and
    a confident docstring. Fixing it is correspondingly low-risk: the ring accepted arbitrary bytes
    here, so it will accept the correct ones.

    `& 0xFFFFFFFF` because `struct.pack("<I", ...)` RAISES on a value outside uint32 — the old shift
    form silently truncated, and an auth frame must not become an exception in 2106 or on a bad clock."""
    ts = int(time.time()) if ts is None else ts
    key = bytearray(16)
    for i in range(8):
        key[i] = _LEPU[i * 2]
    key[8:12] = serial[:4].encode("ascii")
    key[12:16] = struct.pack("<I", ts & 0xFFFFFFFF)
    return bytes(a ^ b for a, b in zip(bytes(key), _LEPU))


def auth_frame(serial: str = "0000") -> bytes:
    return encode(OP_AUTH, auth_payload(serial))

OP_RT_ACC = 0x14          # device-PUSHED 3-axis accelerometer; enabled via AUTO_RT_SWITCH bit 3

# AUTO_RT_SWITCH (0x10) bitfield. This command was recorded as an opaque "setup, payload 00, purpose
# unknown" by both this project and the public reverse-engineering reference until 2026-09-02; the
# vendor exposes it as `oxyAutoSwitch(model, autoParam, autoWave, autoPpg, autoAcc)` and builds the
# payload by OR-ing four booleans into one byte. So the `0x00` we have always sent does not mean
# "default" — it DISABLES all four device-push streams, and every sample this project holds was
# obtained by polling because of it. See O2RING-PROTOCOL §3 and residue 2026-09-02-oxyii-autortswitch-unexamined.
RT_PUSH_PARAM, RT_PUSH_WAVE, RT_PUSH_PPG, RT_PUSH_ACC = 0x01, 0x02, 0x04, 0x08


def setup_frame(push: int = 0x00) -> bytes:
    """AUTO_RT_SWITCH (0x10) — which device-pushed streams the ring should send unprompted.

    `push` is the OR of the RT_PUSH_* bits; the default `0x00` preserves the historical behaviour
    exactly (all pushing off, everything polled), so no caller changes meaning by not passing it.

    ⚠️ **Enabling a push stream changes what arrives on the notify characteristic for the whole
    session** — unsolicited frames with opcodes our dispatcher has never seen. That is a live-capture
    behaviour change on a device we cannot re-run, so it is config-gated at the caller rather than
    switched on here, and it has never been exercised against hardware: no ring in this project has
    ever been asked to push. Treat a first run as an experiment with a night at stake, not a setting."""
    if not 0 <= push <= 0x0F:
        raise ValueError(f"AUTO_RT_SWITCH payload is a 4-bit field, got {push:#x}")
    return encode(OP_SETUP, bytes([push]))


def parse_rt_acc(payload: bytes) -> list[tuple[int, int, int]]:
    """cmd=0x14 reply → [(x, y, z), ...] as SIGNED 16-bit counts, or [] when there are no records.

    Layout: `[0:2]` u16 LE record count, then 6 bytes per sample — three i16 LE axes.

    SIGNED, and that is the half worth pinning: the sibling `parse_rt_ppg` shipped its first revision
    reading unsigned and its statistics were wrong by an order of magnitude, because small negative
    values wrap to ~2**32. An accelerometer at rest sits near zero on two axes and at ±1 g on the
    third, so unsigned reads turn every downward tilt into a huge positive number that still looks
    like data.

    ⚠️ UNITS ARE NOT KNOWN. The vendor publishes raw counts with no scale factor, and no ring here has
    ever been asked to push this stream, so there is nothing to calibrate against yet. Counts are
    returned as counts. Do NOT invent a g conversion — a plausible-looking acceleration is worse than
    an obviously raw one."""
    if len(payload) < 2:
        return []
    n = int.from_bytes(payload[0:2], "little")
    avail = max(0, (len(payload) - 2) // 6)
    out = []
    for i in range(min(n, avail)):
        o = 2 + i * 6
        out.append((
            int.from_bytes(payload[o:o + 2], "little", signed=True),
            int.from_bytes(payload[o + 2:o + 4], "little", signed=True),
            int.from_bytes(payload[o + 4:o + 6], "little", signed=True),
        ))
    return out

def live_frame() -> bytes:
    return encode(OP_LIVE, b"")


def set_time_frame(dt, seq: int = 0) -> bytes:
    """SET_UTC_TIME (0xC0): push the wall clock to the ring's onboard RTC so its STORED-session .dat
    timestamps line up with the NTP-synced host (the ring's RTC free-runs and drifts — measured ~+151 s
    2026-07-17; it also resets on any battery/factory event). 8-byte payload: year(u16 LE), month, day,
    hour, minute, second, then the vendor tail byte 0xCE (0x00 also accepted). The ring stores the fields
    VERBATIM with no timezone conversion, so pass LOCAL CIVIL time per the Clock Contract — the same wall
    clock the file-list `YYYYMMDDhhmmss` stamps use. Sent after the 0xFF→0x10 handshake, plaintext, in the
    standard 0xA5+CRC-8 envelope. Ref: github.com/nglessner/o2ring-s-protocol (SET_UTC_TIME)."""
    y = int(dt.year)
    pl = bytes([y & 0xFF, (y >> 8) & 0xFF, dt.month, dt.day, dt.hour, dt.minute, dt.second, 0xCE])
    return encode(OP_SET_TIME, pl, seq)


# ── Stored-session file transfer (the ONBOARD recording — the .dat the ViHealth app syncs on removal).
# Same 0xA5 envelope; opcodes + layout per github.com/nglessner/o2ring-s-protocol. NOTE the transfer
# CORRECTED 2026-07-18: an earlier note here claimed the transfer needs ATT MTU >= 517. It does NOT —
# the real negotiated MTU is 247 and an 8 h / 86 506 B session pulls clean at that. The myth came from
# printing bleak's PLACEHOLDER mtu_size (23 on BlueZ until a characteristic is acquired) plus a 6 s
# timeout against a ~4.1 s FILE_LIST reply. Do not re-introduce an MTU precondition.
OP_FILE_LIST, OP_FILE_START, OP_FILE_DATA, OP_FILE_END = 0xF1, 0xF2, 0xF3, 0xF4
OP_GET_CONFIG, OP_GET_INFO, OP_GET_BATTERY = 0x00, 0xE1, 0xE4   # read-only device queries
# ⚠️ NEVER IMPLEMENT — persistent DESTRUCTIVE writes. Named so the opcodes are not reused:
#   0xE3 FACTORY_RESET     — wipes settings AND every recording; no settings-only path
#   0xEE FACTORY_RESET_ALL — powers the ring off, needs USB to wake. DO NOT ISSUE.
# 0x01 SET_CONFIG sat on this list until 2026-08-19 (owner-ordered): it is a REVERSIBLE settings write
# (brightness, vibration intensity, alarm thresholds — the knobs the vendor app exposes), now gated
# behind set_config_frame's field whitelist + ring_config.py's full-struct read-back. It shares nothing
# with the resets above except an opcode neighbourhood — which is exactly why the gate is field-level.
# Ref: nglessner/o2ring-s-protocol (this device's OxyII family; frame codec byte-verified against ours,
# CRC fixture A5 E1 1E 00 02 00 00 -> BF matches encode(0xE1, seq=2)).
OP_SET_CONFIG = 0x01
OP_RT_PPG = 0x05          # raw TWO-CHANNEL optical buffer (see parse_rt_ppg + WHICH-IS-WHICH)


def file_list_frame(seq: int = 0) -> bytes:
    return encode(OP_FILE_LIST, b"", seq)

def file_start_frame(ts14: str, ftype: int = 0, seq: int = 0) -> bytes:
    pl = ts14.encode("ascii")[:14].ljust(14, b"\x00") + b"\x00\x00" + int(ftype).to_bytes(4, "little")
    return encode(OP_FILE_START, pl, seq)

def file_data_frame(offset: int, seq: int = 0) -> bytes:
    return encode(OP_FILE_DATA, int(offset).to_bytes(4, "little"), seq)

def file_end_frame(seq: int = 0) -> bytes:
    return encode(OP_FILE_END, b"", seq)


def parse_file_list(payload: bytes) -> list[str]:
    """GET_FILE_LIST reply → recorded-session timestamps. count byte + 16-byte slots (14-char ASCII
    `YYYYMMDDhhmmss` + 2 zero pad)."""
    if not payload:
        return []
    n, out = payload[0], []
    for i in range(n):
        slot = payload[1 + i * 16: 1 + i * 16 + 16]
        if len(slot) >= 14:
            ts = slot[:14].decode("ascii", "replace").strip("\x00")
            if ts.isdigit() and len(ts) == 14:
                out.append(ts)
    return out


class Reassembler:
    """Notify bytes → complete 0xA5 frames. The T8520 splits big live frames (24-B header + PPG body)
    across multiple notifications, so we accumulate until a full declared frame is buffered."""

    def __init__(self):
        self.buf = bytearray()

    def feed(self, data: bytes) -> list[bytes]:
        self.buf += data
        out: list[bytes] = []
        while True:
            if self.buf and self.buf[0] != 0xA5:          # resync to a lead byte
                i = self.buf.find(0xA5)
                if i < 0:
                    self.buf.clear(); break
                del self.buf[:i]
            if len(self.buf) < 8:
                break
            ln = self.buf[5] | (self.buf[6] << 8)
            # A LENGTH IS ONLY AS TRUSTWORTHY AS THE BYTE IT CAME FROM. `ln` is 16-bit, so a mis-framed
            # or truncated notification can claim up to 65535 and park the reassembler waiting for bytes
            # that never come — swallowing every VALID frame that follows into one bogus buffer (~64 KB
            # is ~7 minutes at this data rate) until the link happens to drop. Nothing this device sends
            # is anywhere near that (see MAX_FRAME_LEN). Treat an implausible length as loss of sync —
            # drop the lead byte and resync on the next 0xA5 — rather than trusting it.
            if ln > MAX_FRAME_LEN:
                del self.buf[:1]
                continue
            total = 7 + ln + 1
            if len(self.buf) < total:
                break
            out.append(bytes(self.buf[:total])); del self.buf[:total]
        return out


class Frame(NamedTuple):
    """A validated frame with EVERY header field the wire carries, not just the two we happened to use.

    `flag` is the vendor's `pkgType` (§2 of O2RING-PROTOCOL): on a host→device request it is 0, and on a
    device→host REPLY it is the STATUS byte — `1` = success. The old `decode()` returned only
    `(op, payload)`, so that byte was destroyed at the decoder and no caller could see it even if it
    wanted to. That is why a rejected `SET_UTC_TIME` was indistinguishable from an accepted one.

    `seq` is carried for the same reason: it costs nothing here and it is the echo a caller needs to
    match a reply to its request."""

    op: int
    flag: int
    seq: int
    payload: bytes


def decode_full(frame: bytes) -> "Frame | None":
    """Validate one complete frame → `Frame` or None.

    THE ONE VALIDATOR. `decode()` is a wrapper over this rather than a second copy of the checks:
    two validators drift, and a frame that one accepts and the other rejects is the worst outcome
    available here."""
    if len(frame) < 8 or frame[0] != 0xA5 or frame[2] != (~frame[1]) & 0xFF:
        return None
    ln = frame[5] | (frame[6] << 8)
    if len(frame) != 7 + ln + 1 or crc8(frame[:-1]) != frame[-1]:
        return None
    return Frame(op=frame[1], flag=frame[3], seq=frame[4], payload=frame[7:7 + ln])


def decode(frame: bytes):
    """Validate one complete frame → (opcode, payload) or None.

    BACK-COMPAT WRAPPER, unchanged in behaviour: new return data arrives via `decode_full`, existing
    callers are untouched (CLAUDE.md §🧪 — add new data through a NEW method, never by changing an
    existing return shape)."""
    f = decode_full(frame)
    return (f.op, f.payload) if f else None


class AckResult(Enum):
    """The outcome of an ack-only command. An ENUM, not a boolean, because there are five distinct
    states and collapsing any two of them loses the thing a caller needs.

    🔴 `NO_REPLY` IS NOT `REJECTED`, and for the file path that distinction is the whole point: an
    `0xF1` reply with an EMPTY payload means "the ring has no stored files", while no reply at all
    means the ring never answered. The harvesting state machine must never see those as one value —
    an empty list is a fact about the ring, a silence is a fact about the link.

    `UNKNOWN_STATUS` exists because §2 documents only `1` = success. What 2..255 mean is not known, so
    they are surfaced rather than guessed: reading "not 1" as "failed" would invent a semantics the
    protocol notes do not support."""

    OK = "ok"
    REJECTED = "rejected"
    NO_REPLY = "no_reply"
    MISMATCH = "mismatch"
    UNKNOWN_STATUS = "unknown_status"


def parse_ack(req_op: int, reply: "Frame | None") -> AckResult:
    """Interpret the reply to an ack-only command (`0x10`, `0xC0`, `0xF2`, `0xF4`, `0x01`).

    ABSENCE IS THE CALLER'S OBSERVATION, NOT THE PARSER'S: a parser cannot see a frame that never
    arrived, so `reply=None` is passed in by the wait/timeout at the call site and returned as
    `NO_REPLY`. Building "no reply" into the parser would mean inventing a timeout it cannot observe.

    A `flag == 1` on the WRONG opcode is `MISMATCH`, never `OK` — otherwise any successful ack in
    flight would vouch for whatever command we happened to be waiting on."""
    if reply is None:
        return AckResult.NO_REPLY
    if reply.op != req_op:
        return AckResult.MISMATCH
    if reply.flag == 1:
        return AckResult.OK
    if reply.flag == 0:
        return AckResult.REJECTED
    return AckResult.UNKNOWN_STATUS


# ── Encrypted-session guard (Gen2 newer firmware) ───────────────────────────────────────────────────
#
# 🔴 `decode()` ABOVE IS NOT A BACKSTOP AGAINST THIS, AND IT LOOKS EXACTLY LIKE ONE. It validates the
# 0xA5 magic, the ~cmd complement and the CRC-8, and returns None on any failure — so the natural
# reading is that a garbled or unintelligible frame cannot reach the parsers. It cannot, but ciphertext
# is neither. Only the PAYLOAD is encrypted; the ring builds the envelope around the ciphertext and
# computes the CRC-8 over it. So a ring in an encrypted session emits a STRUCTURALLY PERFECT frame:
# `decode()` passes it, hands back the ciphertext as `payload`, and `parse_live()` reads payload[6] as
# SpO2 and payload[8:10] as pulse rate. Every structural check is green and the vitals are invented.
#
# It does not even look broken. `parse_live` nulls SpO2 outside 50-100, and about a fifth of uniform
# bytes land inside it, so a ciphertext stream surfaces as mostly-None with intermittent plausible
# readings — a flaky sensor, not a fault. That is the failure this guard exists to prevent, and it is
# why the guard must not be deleted as redundant with the CRC: the CRC cannot see it.
#
# Newer rings answer OP_AUTH with a blob carrying an AES-128 session key, after which every payload in
# both directions is AES-128-ECB. Older ones do not answer OP_AUTH at all and stay in plaintext.
#
# ⚠️ WHICH FIELD IDENTIFIES "NEWER" — read this before comparing anything to it. The value that
# distinguishes them here is the ring's BRANCH CODE (`2D010001` answers; `2D010002`, which is every
# ring we own, does not). It is NOT the firmware version. Those are two different fields in the same
# GET_INFO reply and they coexist: the ring that answers reports branch 2D010001 AND firmware 1.13.1.0.
# `parse_get_info` in this module returns the branch code under the key `"firmware"`, which is a
# misnomer — the vendor SDK assigns those bytes to `branchCode` and builds the real dotted version from
# a different range. The owner of the ring in the run cited below noticed the same thing unprompted:
# "it says FW - but what is displayed is the Branchcode". Fixing that key is out of scope for this
# unit; what matters here is that a comparison against `"firmware"` is a comparison against the branch
# code, so do not write one expecting `1.13.1.0`.
#
# MEASURED, from a SomnoTrace run on a branch-2D010001 ring by a third party (discussion #180, comment
# 18250284; application-level logs only, no raw bytes of the exchange):
#   * the SAME ring answered OP_AUTH with >= 20 bytes on the pairing connect, and with 16 bytes on two
#     later connects in the same session;
#   * on those 16-byte connects a PLAINTEXT session worked completely — serial, firmware, file list and
#     four file pulls all correct.
# So "a reply arrived" does not imply "encrypted session", and refusing on any reply would have refused
# the connect that pulled every file.
#
# INFERRED, and nothing here depends on it: that the 16-byte reply is an echo of the 16-byte auth
# payload we send. It is the right length for one. The classification below keys on "too short to carry
# a key blob", which is measured, and never on "is an echo", which is not.

AUTH_PLAINTEXT = "plaintext"
AUTH_ENCRYPTED = "encrypted"
AUTH_REFUSE = "refuse"

_KEY_BLOB_MIN_LEN = 20  # type, length, two reserved, then the 16-byte key
_AUTH_TYPE_AES = 0x01
_AES_KEY_LEN = 16


def classify_auth_reply(payload: bytes | None) -> tuple[str, bytes | None, str]:
    """What does this OP_AUTH reply mean? → (mode, key_or_None, reason).

    Three outcomes, and the middle one is the one a naive guard gets wrong:

      AUTH_PLAINTEXT  no reply, or a reply too short to carry a key blob. Proceed unencrypted — this
                      is every ring we own, and it is also the 16-byte case measured on a 2D010001 ring
                      where the plaintext session then worked end to end.
      AUTH_ENCRYPTED  a well-formed key blob: type 0x01, key length 16. The AES-128 key is returned.
      AUTH_REFUSE     a key negotiation we cannot parse. This is the only case that risks fabricated
                      vitals, because it is the case where the ring has switched to ciphertext and we
                      would carry on reading payload bytes as measurements.

    The blob is obfuscated with the same protocol salt as the auth payload: cyclic XOR with
    md5("lepucloud"). That derivation is from the vendor SDK and is corroborated by an independent
    implementation (SomnoTrace 5e4bd0b) that has been exercised against a real branch-2D010001 ring; it
    has never been executed by THIS code against a ring, because no ring here answers OP_AUTH.
    """
    if not payload:
        return AUTH_PLAINTEXT, None, "no OP_AUTH reply — plaintext session (legacy firmware)"
    if len(payload) < _KEY_BLOB_MIN_LEN:
        return (AUTH_PLAINTEXT, None,
                f"OP_AUTH reply of {len(payload)} B is too short to carry a key blob "
                f"(want >= {_KEY_BLOB_MIN_LEN}) — plaintext session")

    dec = bytes(b ^ _LEPU[i % 16] for i, b in enumerate(payload))
    if dec[0] != _AUTH_TYPE_AES or dec[1] != _AES_KEY_LEN:
        return (AUTH_REFUSE, None,
                f"unsupported firmware — encrypted session negotiated with type=0x{dec[0]:02x} "
                f"key_len={dec[1]} (this build understands type=0x{_AUTH_TYPE_AES:02x} "
                f"len={_AES_KEY_LEN}); refusing rather than reading ciphertext as vitals")
    return (AUTH_ENCRYPTED, dec[4:4 + _AES_KEY_LEN],
            "AES-128-ECB session key negotiated")


# ── Secondary tell: does a decoded live frame look like ciphertext? ─────────────────────────────────
#
# PROBABILISTIC, and deliberately not the primary defence. `classify_auth_reply` is the primary one;
# this exists because a firmware revision could switch to ciphertext by some route we have not seen,
# and a wrong reading of a patient's oxygen saturation should not be the way we find out.
#
# The strongest discriminator is not the vitals, it is `duration`: payload[0:4] as u32 LE is seconds
# into the ring's session, so a real value is at most hours. Uniform random bytes exceed a week with
# probability ~99.9 %. `contact` is a second: the vendor documents exactly three values, so anything
# else is not a contact state. A lucky frame passes both — hence the run threshold, and hence this is a
# tell and not a check.

# ⚠️ THESE TWO RETURN BOOLEANS ON PURPOSE, and the obvious tidy-up is the thing to resist:
# `classify_auth_reply` returns a cause string, so it is tempting to give these one too and have a
# single "why did we stop" type. Do not. "The handshake told us to refuse" and "the stream looks
# statistically wrong" are different CLAIMS with different standards of evidence — the first is
# derived from a key negotiation the ring actually sent, the second is a guess about a distribution.
# A shared cause type makes them arrive looking alike at the call site, which is precisely the
# distinction this split exists to preserve. If a caller ever needs a reason here, give it its OWN
# type rather than borrowing the handshake's.

_MAX_PLAUSIBLE_DURATION_S = 7 * 24 * 3600  # a week; real ring sessions are hours
_CONTACT_VALUES = (0x00, 0x01, 0x03)  # no finger, idle-present, file open
CIPHERTEXT_RUN = 5  # consecutive suspect frames before we call it


def frame_looks_like_ciphertext(parsed: dict | None) -> bool:
    """One frame's worth of suspicion. See the note above: probabilistic, secondary."""
    if not parsed:
        return False  # a short/undecodable frame is decode()'s business, not this one
    if parsed["duration"] > _MAX_PLAUSIBLE_DURATION_S:
        return True
    if parsed["contact"] not in _CONTACT_VALUES:
        return True
    return False


def sustained_ciphertext(parsed_frames, run: int = CIPHERTEXT_RUN) -> bool:
    """True when the last `run` frames all look like ciphertext.

    Note what this does NOT flag: an off-finger ring reports SpO2 and pulse as 0xFF, which `parse_live`
    already nulls, and it reports a real duration and a documented contact byte. Off-finger is a normal
    state and must not be mistaken for a broken session.
    """
    frames = list(parsed_frames)
    if len(frames) < run:
        return False
    return all(frame_looks_like_ciphertext(f) for f in frames[-run:])



def session_restarted(prev_duration: int | None, duration: int) -> bool:
    """Did the ring start a NEW recording session between two live replies?

    Replaces the former `frame_gap()`, which was built on a false premise. That function read `[0]` as a
    frame sequence counter and reported "N live frame(s) dropped" whenever it stepped by more than one.
    `[0:4]` is not a counter — it is the session DURATION in seconds (u32 LE), confirmed against the
    vendor's own parser (LepuDemo `lepu-blepro` → RtParam.setDuration) AND against our data: 2736
    consecutive frames read 0 while the ring sat idle, which no frame counter can do. The old function
    therefore emitted phantom loss — 9 warnings in one evening, including "111 live frame(s) dropped",
    which was simply a session starting.

    A duration that goes BACKWARDS is the one real event here: the ring began a new session."""
    return prev_duration is not None and duration < prev_duration


def parse_live(payload: bytes) -> dict | None:
    """cmd=0x04 live header → live values.

    LAYOUT CORRECTED 2026-07-18 against the VENDOR'S OWN PARSER — the previous offsets were partly wrong
    and one of them was a live data bug. Source: viatom-develop/LepuDemo ships the official
    `lepu-blepro` SDK as an AAR; its OxyII parser (`TAG="OxyIIBleInterface"`) maps bytes into the public
    `oxy2.RtParam` DTO. Read directly from the decompiled class, the chain is:

        [0:4] u32 LE -> setDuration      [8:10] u16 LE -> setPr
        [4]          -> setRunStatus     [10] & 0x01   -> setFlag
        [5]          -> setSensorState   [11]          -> setMotion
        [6]          -> setSpo2          [12]          -> setBatteryState
        [7] / 10.0   -> setPi            [13]          -> setBatteryPercent

    The SDK's offset base is identical to ours: it parses `copyOfRange(payload, 0, 20)` of the same
    payload our `decode()` returns, so SDK offset N == payload[N].

    TWO CORRECTIONS THAT MATTERED, both independently confirmed against our own recordings:

    * **[7] is PERFUSION INDEX (value/10 %), not motion. [11] is motion.** They were swapped. This was
      not cosmetic: `[7]` was being written into the SpO2 CSV's `Motion` column, and OxyDex excludes
      artifact samples with `r.motion === 0`. Measured over a real 5288-row night, `[7]` is non-zero in
      99.9% of frames (mean 13.6 => PI 1.36%, range 0-18.3%) — a perfusion index is continuously
      non-zero, a sleeping subject's motion is not. The vendor's OWN ViHealth exports settle it from the
      other side: their Motion column is 99.4-99.8% ZERO (max 18-62), which is exactly how `[11]`
      behaves (0 in 249/271 frames). So on Vigil-captured files that filter was keeping ~0.1% of
      samples. Files written before this fix carry PI in the Motion column.
    * **[0:4] is the session duration (u32 LE), not a frame counter** — see session_restarted().

    `[1]`=104 was never a constant: it is duration's second byte (104*256 ~ 7.4 h into a session), with
    the low byte ticking +1/s. `[10]`=199 (0xC7) is not a constant either; the SDK reads only bit 0.
    `[14]` carries four 2-bit subfields the SDK parses but does not expose in RtParam — left unparsed
    rather than surfaced under a name we cannot defend.
    """
    if len(payload) < 14:
        return None
    spo2, contact = payload[6], payload[5]
    pr = int.from_bytes(payload[8:10], "little")     # u16 LE — [9] is the HIGH byte, not padding
    return {
        "duration": int.from_bytes(payload[0:4], "little"),   # seconds into the ring's session
        "spo2": spo2 if 50 <= spo2 <= 100 else None,   # 0/invalid off-finger
        "pr":   pr if 20 < pr < 250 else None,
        "pi":   payload[7] / 10.0,                     # perfusion index, %
        "motion": payload[11],                         # WAS [7] — the swap that caused the data bug
        "flag": payload[10] & 0x01,
        # The WHOLE byte, beside the bit. The vendor names [10] `flag(标志参数, 0:脉搏音标志)` —
        # "indicator parameter, bit 0 = pulse-tone flag" — and its SDK reads bit 0 and nothing else, which
        # is why we did too. Measured 2026-08-05 across 8 nights / 184 362 frames: bit 0 is set on
        # **100.0 % of frames on every night**, so it carries no per-frame information at all and is a
        # SETTING (the buzzer is enabled), not an event. The byte itself reads 0xC7, and this module's own
        # note has said since 2026-07-18 that it "is not a constant either" — so bits 1-7 vary and nothing
        # has ever looked at them. Recorded raw so a night can answer what changes there without a
        # re-capture; interpreting them is not attempted here.
        "flag_raw": payload[10],
        "batt": payload[13],
        "batt_state": payload[12],                     # 0 = not charging
        "run_status": payload[4],
        "contact": contact,                            # 0x00 no finger, 0x01 idle-present, 0x03 file open
        "worn": contact in (0x01, 0x03),
    }


# ── Live PPG waveform (O2RING-LIVE-PPG-WAVEFORM Phase 1, decoded + validated 2026-07-18) ──────────────
# Each cmd=0x04 reply is NOT just the 24-B status header parse_live reads — it also carries the ring's
# raw ~125 Hz plethysmograph, which parse_live (and every prior tool) discarded. Layout decoded off 90
# real frames (all matched; concatenated bodies are gap-free, boundary jumps 0-8; header HR/SpO2 cross-
# checked vs the paired ECG at 49 bpm):
#   [0:24]  status header (parse_live)
#   [24]    sample count N (u8)             — verified: len(payload) == 24 + 2 + N on every frame
#   [25]    flag / reserved (seen 0x00)
#   [26:26+N]  N one-byte UNSIGNED optical samples, ~125 Hz (steady-state ~126 samples per ~1.0 s poll),
#              single channel (even/odd samples are near-identical, so NOT interleaved LEDs).
# The stream is RAW (per HEALTH-BOX-VISION: no on-box DSP): the `156` rows are left in place for a
# downstream consumer to interpret — see below for what they actually are.
#
# ── 156 IS A BEAT MARKER, NOT A MISSING-SAMPLE SENTINEL (DEVICE-RATE-TRUTH §2 · corrected 2026-08-06) ──
# This was documented as "the device's INVALID-SAMPLE sentinel" and as "occasional isolated spike
# samples … not a fixed marker". It is neither invalid nor occasional: the ring INSERTS an extra row,
# value 156 (0x9C), once per beat it detects. The evidence was already inside the note that called it a
# sentinel — "~0.66/frame" at a ~1 s poll is 0.66/s, i.e. 40 bpm, which is a pulse, not a defect rate.
# Measured three independent ways:
#
#   · subtracting them across 13 nights gives fs − markers = 125.0069 mean / 124.9966 median (sd 270 ppm)
#     against 4 MHz / 32000 = 125.000000 exactly — the AFE4403's own crystal divider, and FCC internal
#     photos of the S8-AW confirm nRF52840 + TI AFE4403 + a 32.000 MHz crystal with no internal RC;
#   · the marker rate tracks pulse rate: fs = 125.138 + 0.799 × (PR/60), r = +0.870 over 13 nights;
#   · INSERTION, not replacement — regressed over 17 whole nights spanning 46.5–70.6 bpm, the ROW rate
#     climbs +0.01517 Hz/bpm (91 % of the +1/60 insertion prediction, R² 0.957) while row−markers is flat
#     at −0.00151 (9 % of the replacement prediction, R² 0.180).
#
# So BOTH standing instructions are wrong, in opposite directions: the vendor SDK interpolates it away
# (fabricating an amplitude nobody measured) and this file said to treat it as a gap (discarding a real
# per-beat event). The correct third behaviour is to STRIP it into a beat-event column, after which the
# row rate genuinely is 125.000 and one constant serves both the axis and the signal processing.
#
# ⚠️ It is NOT a usable beat reference, and the distinction matters. Against the H10's own `_RR.txt` over
# the same 9.30 h window: 29 647 beats vs 27 744 markers — ratio 0.936, degrading through the night
# (0.981 over the first 3.3 h). It is an EXACT accounting of inserted rows and an APPROXIMATE count of
# heartbeats; 6 % dropout merges intervals, which is disqualifying for HRV.
PPG_BEAT_MARKER = 156      # 0x9C — an INSERTED row, one per ring-detected beat
PPG_INVALID = PPG_BEAT_MARKER   # legacy spelling, kept so existing readers keep working

# Samples the ring produces per SESSION-SECOND — the unit that makes PPG loss ARITHMETIC instead of
# inferred (O2RING-FRAME-SAMPLE-LOCK). Note carefully what this is NOT: it is not a per-FRAME constant.
# Measured over 60 clean sessions / 60.9 h of the real corpus, delivery is 126.04 samples per session-
# second (the u32 `duration` counter in [0:4]) with a per-session spread of 125.6-126.5. Per FRAME it is
# 124-128 — the ring hands back whatever accumulated since the last poll, and the poll interval jitters
# (0.989-1.007 s observed), so a frame count is NOT a fixed quantity and 126*frames is not an expectation.
#
# It is also NOT a sample RATE and must never be used as one: 126 samples per DEVICE second is 125.80
# samples per HOST second, because the ring's own second runs -3446 ppm against the NTP-disciplined host
# (measured, 2026-08-01, 33 490 device-seconds vs 33 605.8 host-seconds). The device axis is the ring's,
# and it is the right axis for COUNTING what the ring produced; it is the wrong axis for TIMING, which is
# why the samples are still host-arrival stamped (O2RING-SYNTHESISED-AXIS §6). Do not reconcile this
# number with `O2PPG_FS_DEFAULT`; they are counts on two different clocks and both are correct.
#
# ── TWO CORRECTIONS TO THE PARAGRAPHS ABOVE (DEVICE-RATE-TRUTH §3 · 2026-08-06) ──────────────────────
# Both are kept in place rather than rewritten, because the measurements they cite are real and only
# their INTERPRETATION was wrong:
#
# 1 · WHERE 126 COMES FROM. It is not a hardware lock, it is `125 + markers`: the ADC runs at exactly
#     125.000 Hz and the ring inserts one extra row per detected beat (see PPG_BEAT_MARKER). So "126.04
#     per device-second" is 125 + 1.04 beats/s = 62 bpm, and the 124–128 per-FRAME spread above is
#     beat-to-beat heart-rate variation rather than poll jitter alone. The number is still the right one
#     to count with; it is simply not a constant of the silicon, and it moves with the wearer's pulse.
#
# 2 · WHAT −3446 ppm DESCRIBES. It is the ring's `duration` COUNTER, not its sample clock, and it is ONE
#     night. Across 44 sessions the counter's error is median +540 ppm, range −314 … +4282 — so −3446 is
#     not even representative of the counter, let alone of the ADC. The sample clock is crystal-accurate
#     (32 MHz ÷ 8 ÷ 32000 = 125.000000, an AFE4403 with no internal RC); the duration counter is a
#     separate RC-class timebase. What separates them on the reference night is the marker-free product
#     `fs × ring_second = 125.419` (+3353 ppm). Do not calibrate anything against −3446.
PPG_FRAME_SAMPLES = 126


def ppg_sample_count(payload: bytes) -> int | None:
    """The count of PPG samples the DEVICE DECLARES for this 0x04 frame ([24:26], u16 LE) — or None
    when the frame carries no waveform section at all.

    Surfaced separately from `parse_ppg` because the declared count and the delivered samples answer
    different questions and are allowed to disagree. `parse_ppg` slices `[26:26+N]`, which silently
    returns SHORT if the frame's own length field and its declared count are inconsistent — so
    `len(parse_ppg(p))` cannot distinguish "the ring sent 60 samples" from "the ring said 126 and we got
    60". `declared - delivered` is that distinction, and it costs one u16 read to keep.

    None (no body) is deliberately NOT 0 (a body declaring zero samples). The first is a frame shape,
    the second is a measurement of nothing — the same blank-vs-zero rule the writers keep."""
    if len(payload) < 26:
        return None
    return int.from_bytes(payload[24:26], "little")


def ppg_stream_offset(payload: bytes) -> int | None:
    """The ring's own CUMULATIVE stream position for this frame ([20:24], u32 LE) — or None when the
    frame is too short to carry the field.

    This is the vendor's `RtWave.offset` (`lepu-blepro` 1.3.6, `doad/Cthrow.java`), and because samples
    are ONE BYTE it is a sample index, not a byte count. The field has sat in this module's layout
    comment as "[20:24] u32 counter" since 2026-07-18 and has never been read by anything — the vendor's
    own SDK decodes it and discards it too.

    WHY IT EARNS A COLUMN. It is the only device-side sequence number the ring exposes, so
    `SUM(declared)` against `DELTA(offset)` decides — with **no host clock anywhere in the comparison** —
    whether the ring counts its own `PPG_INVALID` bytes in its stream position. That is the difference
    between those bytes being INSERTED extras (=> the ADC runs at 125 Hz and the markers are not samples)
    and being REPLACEMENTS for real ones (=> 126 Hz and they are). Arrival timing cannot separate those
    two; this counter can. Paired with `duration` ([0:4], session seconds) it also gives
    `DELTA(offset)/DELTA(duration)` — a sample rate measured entirely on the device's own counters, which
    is a different class of evidence from every rate figure this project currently holds.
    See `DEVICE-RATE-TRUTH-2026-08-05-BRIEF.md` §2.2 and §6.1.

    Threshold is 24, not 26: the offset occupies [20:24] and the sample count [24:26], so a frame can
    carry an offset without carrying a wave header. Requiring 26 would silently drop the field on
    exactly the malformed frames worth seeing.

    None (field absent) is deliberately NOT 0, matching `ppg_sample_count`: **0 is a real offset** — it
    is what the first frame of a session reports — while None means the bytes were not there at all."""
    if len(payload) < 24:
        return None
    return int.from_bytes(payload[20:24], "little")


# ── RAW DUAL-WAVELENGTH PPG (cmd 0x05) — MEASURED ON HARDWARE 2026-08-05 ─────────────────────────────
# `O2RING-RAW-STREAMS-ABSENT-2026-08-04` concluded this ring exports no raw red/IR. It does. That sweep
# scored 0x05's fixed 922-byte reply as noise-like against a GENERIC byte-wise metric — which is exactly
# what interleaved little-endian u32 pairs look like without record framing. Read as 9-byte records of
# {u32, u32, u8} (the layout `lepu-blepro` 1.3.6's `oxyIIGetRtPpg` uses), both channels are waveforms:
#
#   IR   range 8585  median|delta| 127   ratio 0.0148      ratio = median|delta| / range
#   RED  range 5471  median|delta|  92   ratio 0.0168      a waveform is << 1
#   IR, SAME data shuffled                ratio 0.3395      <- 23x rougher; ordering is the signal
#
# So the payload is not noise, and "re-deriving SpO2 is impossible on this hardware" no longer follows
# from the premise it rested on. Whether the ratio-of-ratios is RECOVERABLE is a separate question this
# does not answer — it only establishes that the two channels exist and are readable.
# ⚠️ MEASURED NOT REQUIRED (hardware A/B, 2026-08-05). The SDK sends this argument, so we send it — but
# a same-session control alternating `{0x07,0x01}` against an EMPTY payload got 15 replies each, every
# one 922 bytes with 102 records. The argument neither unlocks nor changes the reply. Keep it for
# fidelity to the vendor flow; do not describe it as the thing that revealed the stream, and do not
# assume a future opcode's argument matters just because an SDK passes one.
# ⚠️ THIS IS NOT A PLETHYSMOGRAM. Proven 2026-08-05 with a POSITIVE CONTROL: cmd 0x03 (LIVE_SAMPLES_A,
# an 8-bit pleth, 6-byte header + up to 250 samples) run in the SAME session through the SAME peak
# detector reproduces the ring's own pulse rate to 0.1 bpm (72.9 detected vs 73 reported). The identical
# detector on this stream finds 146 peaks on chA and 131 on chB over one 21615-record lossless chain --
# 58.5 and 52.5 bpm, disagreeing with the device AND WITH EACH OTHER. Two plethysmograms of one finger
# must find the same beats. These do not, so what varies here is drift, not a pulse.
# Rates differ too: 0x03 = 112.9 Hz (lossless), this = >=153.3 Hz. Different sources.
# WHAT THIS STREAM IS remains unknown -- two distinct 32-bit optical channels, r=0.9991, slowly varying,
# no cardiac content. AGC/ambient telemetry, a long-integration DC channel and a decimated envelope are
# all untested candidates. The `ppg2w` name predates this and is kept as a compatibility surface.
#
# WHICH IS WHICH — NOT ESTABLISHED. DO NOT COMPUTE SpO2 FROM THESE COLUMNS.
# A ratio-of-ratios over 3060 samples gave R = 0.4885 -> SpO2 ~97.8% against the ring's reported 97%
# (the swap gives 59%), and that was briefly recorded as proof that chA is RED. It is NOT proof: R is
# defined on the CARDIAC AC, and nothing shows the measured AC is cardiac. An AC/DC of 12-24% is ~10x a
# finger perfusion index, and autocorrelation finds NO periodicity at any lag from 20 to 2200 -- which
# covers every sample rate from 1 Hz to ~2400 Hz at the measured 66 bpm -- nor within seam-free single
# buffers. A pulsatile signal must peak at its beat period; this one never does. So the 97.8% agreement
# may be coincidence. See O2RING-RAW-DUAL-WAVELENGTH-2026-08-05-BRIEF §1.2 (4) for the full reasoning.
#
# WHAT IS ESTABLISHED: the two columns are genuinely different optical channels, not one photodiode at
# two gains -- fitting chB = k*chA gives k drifting 0.7139 -> 0.5320 with residual RMS 0.049% -> 7.06%,
# where a fixed gain would hold k constant at ~zero residual by construction.
#
# The columns are therefore recorded in DEVICE ORDER and named neutrally. That decision is what kept a
# wrong wavelength assignment from reaching a saturation number when the identification collapsed.

RT_PPG_ARG = bytes([0x07, 0x01])
RT_PPG_REC = 9                       # i32 LE chA | i32 LE chB | u8 motion  (SIGNED — see below)

# ⚠️ THE CHANNELS ARE SIGNED, and reading them unsigned is catastrophic rather than cosmetic. Measured
# 2026-08-05 over 61 066 samples: read unsigned the maximum is 4 294 966 954, i.e. within ~3000 of 2**32,
# because small NEGATIVE values wrap. Read SIGNED the range is -285 410 .. 3 478 709 and NOT ONE sample
# exceeds the 24-bit signed maximum of 8 388 607 -- so these are 24-bit two's-complement values
# sign-extended into 32 bits, which is exactly the output format of the TI AFE44xx family this device
# class is built on. A single wrapped 4.29e9 in a mean destroys it; the first shipped revision of this
# parser read unsigned and its AC/DC statistics were wrong by an order of magnitude because of it.

def rt_ppg_frame(seq: int = 0) -> bytes:
    """cmd=0x05 — ask for the raw two-channel optical buffer (see WHICH-IS-WHICH: not proven to be
    two wavelengths, and not proven to be a plethysmogram)."""
    return encode(OP_RT_PPG, RT_PPG_ARG, seq)


def parse_rt_ppg(payload: bytes) -> list[tuple[int, int, int]]:
    """cmd=0x05 reply -> [(chA, chB, motion), ...] with chA/chB SIGNED, or [] when there are no records.

    Layout, measured on device `S8AW2100` and matching the vendor SDK's `RtPpg`:
        [0:2]        u16 LE record count
        [2 : 2+9N]   N records of {i32 LE chA, i32 LE chB, u8 motion}  (SIGNED; chA/chB per WHICH-IS-WHICH)
    The observed reply is 922 B with a declared count of 102, i.e. 2 + 9*102 = 920 and TWO BYTES OVER.
    Those two are not decoded here and are not assumed to be padding — the record count is taken from
    the device's own field and the slice is bounded by the buffer, so a trailer of any size is ignored
    rather than silently absorbed into a record.

    ⚠️ THE RATE IS BOUNDED, NOT KNOWN, AND IS NOT ASSERTED HERE. 102 is a CAP: polled slowly the count
    pins at 102, but polled every 0-0.3 s it falls right through 0, 4, 10 ... 70 (measured 2026-08-05),
    which is what lets `count = fs*dt` be fitted at all. Over 35 unsaturated replies: 125.7 Hz by least
    squares (intercept 7.9 records), 155.5 Hz forced through the origin, 150.7 Hz as the median per-point
    ratio. Solid: it is NOT the 200 Hz the SDK claims.

    Compare against 125.000 Hz — the ADC crystal rate, which is now what O2PPG_FS_DEFAULT holds too.
    DEVICE-RATE-TRUTH §2: the ADC is 125.000 exactly (4 MHz / 32000); the finger pleth's OBSERVED row rate
    ~125.7 is that plus the inserted `156` beat marker (125 + ~44 bpm). This stream carries NO such marker
    -- no fixed sentinel value in 3060
    samples, and its apparent outliers are AGC LEVEL SHIFTS (a step down that stays down), not inserted
    rows -- so its row rate should equal the ADC rate flat. 125.7 is consistent with 125.000; the
    estimators still disagree by 25%, so fs stays 0 on the bus until a longer starvation run settles it.

    ⚠️ AND DO NOT USE A VALUE-BASED SEAM TEST to argue the replies are contiguous. That was tried and
    RETRACTED: it called consecutive replies contiguous at 0.5s, 1.0s AND 2.0s spacing, which cannot all
    be true. On a smooth waveform a gap of hundreds of samples still lands close in value.

    `motion` is returned as the raw byte. The vendor doubles it for display (`* 2`); that is a
    presentation choice and is not applied to a recorded value."""
    if len(payload) < 2:
        return []
    n = int.from_bytes(payload[0:2], "little")
    avail = max(0, (len(payload) - 2) // RT_PPG_REC)
    out = []
    for i in range(min(n, avail)):
        o = 2 + i * RT_PPG_REC
        out.append((int.from_bytes(payload[o:o + 4], "little", signed=True),
                    int.from_bytes(payload[o + 4:o + 8], "little", signed=True),
                    payload[o + 8]))
    return out


def parse_ppg(payload: bytes) -> list[int]:
    """cmd=0x04 body → the raw ~125 Hz PPG waveform samples (u8), or [] if no body/too short.

    ⚠️ 156 (0x9C) is a SENTINEL, not signal. The vendor SDK replaces it by interpolating its neighbours
    (both the OxyII wave class and the gen-1 `OxyBleResponse.RtWave` do this), and it occurs ~0.66x per
    frame in our captures. It is returned RAW here — we do not fabricate an interpolated measurement —
    but a consumer MUST reject `PPG_INVALID` rather than treat it as a real amplitude. The earlier note
    calling these "raw signal, left in place for a downstream consumer to reject" was half right: they
    are not signal, and no consumer rejects them yet.

    Also note the vendor's DISPLAY transform is `127 - sample` (gen-1 used `100 - temp/2`), i.e. the
    vendor's rendered pleth is INVERTED relative to these raw bytes. Anything comparing our waveform to
    a vendor screenshot, or assuming systolic peaks are maxima, must account for that.
    """
    # u16 LE, not u8: the vendor SDK splits the payload at 20 and reads the wave section as
    # [20:24] u32 counter, [24:26] u16 LE sample count, [26:] samples. Our [26:] start was already
    # right; [25] was mislabelled "flag/reserved, seen 0x00" — it is this count's HIGH byte.
    # Single-sourced on ppg_sample_count so the declared count has ONE reader; a frame with no body
    # (None) and a body declaring nothing (0) both slice to [], which is what this function promises.
    n = ppg_sample_count(payload)
    if n is None:
        return []
    return list(payload[26:26 + n])


# ── READ-ONLY DEVICE QUERIES (harvested from nglessner/o2ring-s-protocol, byte-verified) ─────────────
# All three are empty-payload reads. Frame builders are trivial; the value is in the parsers below.
def info_frame(seq: int = 0) -> bytes:
    return encode(OP_GET_INFO, b"", seq)

def config_frame(seq: int = 0) -> bytes:
    return encode(OP_GET_CONFIG, b"", seq)

def battery_frame(seq: int = 0) -> bytes:
    return encode(OP_GET_BATTERY, b"", seq)


def parse_get_info(payload: bytes) -> dict | None:
    """cmd=0xE1 reply (60-byte plaintext) → device identity + the ring's RTC, or None if too short.

    Firmware version is the field that matters operationally: this device's behaviour is
    firmware-dependent (the F2 MTU gate differs between 2D010001/2/3), so a capture should record which
    firmware produced it.

    THE RTC IS READABLE — bytes [24:31], measured on device 2592302100 2026-08-19. The layout is
    EXACTLY set_time_frame's write payload: year u16 LE, month, day, hour, minute, second (local civil
    time, stored verbatim, no timezone). Proven two independent ways: a differential double-read
    (probe_rtc_read: byte[30] advanced by the gap mod 60 and byte[29] carried) and an absolute read 4 min
    after a 0xC0 sync matching the host wall clock to the second. So time can be PULLED from the ring,
    not only pushed — a one-read drift check against the NTP-disciplined host (probe_rtc_read --clock).
    `rtc` carries the six components, or None when any is out of range (a fabricated instant must be
    visible, never silently plausible — Clock Contract §2.7). Consumers build a floating tMs from it via
    Date.UTC semantics; nothing here converts zones.

    Remaining bytes stay unmapped ON EVIDENCE: a 13-read × 10 s classifier (2026-08-19) found every
    other offset CONSTANT — [0:9]/[17:24] device constants, [31:33] u16 LE = 2016 (a frozen date-year;
    semantics unverified — do not decode), [33:37]/[48:60] zeros. [37] is the serial length and
    [38:38+len] the WIRE serial (2592302100 here) — note this is NOT the BLE-name-derived id
    (S8AW2100) the capture filenames use."""
    if len(payload) < 48:
        return None
    fw = payload[9:17].decode("ascii", "replace").rstrip("\x00")
    sn_len = payload[37]
    sn = payload[38:38 + sn_len].decode("ascii", "replace") if 0 < sn_len and 38 + sn_len <= len(payload) else ""
    y = payload[24] | (payload[25] << 8)
    mo, d, h, mi, s = payload[26], payload[27], payload[28], payload[29], payload[30]
    rtc = None
    if 2000 <= y <= 2255:
        import datetime as _dt
        try:
            _dt.datetime(y, mo, d, h, mi, s)   # calendar round-trip: rejects Feb 31 / Apr 31 and every
            rtc = {"year": y, "month": mo, "day": d, "hour": h, "minute": mi, "second": s}
        except ValueError:                     # out-of-range component — §2.7: absence, never a rolled instant
            rtc = None
    # ── THE FIELD WE CALLED "firmware" IS THE VENDOR'S branchCode ─────────────────────────────────
    # Residue `2026-09-02-oxyii-branchcode-named-firmware`. §3c: `payload[9:17]` is an 8-character
    # BRANCH CODE (`2D010002`); the firmware VERSION is a separate dotted string from bytes
    # `[4].[3].[2].[1]`, with `hwV = [0]` and a bootloader from `[8]..[5]`. The two COEXIST — the §3a
    # ring is branch `2D010001` AND firmware `1.13.1.0` — so a log line reading `firmware 2D010002`
    # could never be compared against a vendor-reported version.
    #
    # 🔴 `"firmware"` KEEPS ITS CURRENT (BRANCH) VALUE, deprecated but unchanged. It is persisted:
    # `pull_session.py` writes it into a session sidecar as `device_firmware`, so silently changing
    # what the key MEANS would rewrite the meaning of records already on disk while every consumer
    # kept reading the same name. New data arrives through NEW fields instead.
    ver = ".".join(str(payload[i]) for i in (4, 3, 2, 1)) if len(payload) > 4 else None
    boot = ".".join(str(payload[i]) for i in (8, 7, 6, 5)) if len(payload) > 8 else None
    return {
        "firmware": fw,          # DEPRECATED alias of `branch_code` — kept for on-disk compatibility
        "branch_code": fw,       # the same 8 ASCII chars, under the name the vendor uses
        "firmware_version": ver,  # the REAL version, "[4].[3].[2].[1]"
        "hw_version": payload[0] if payload else None,
        "bootloader": boot,
        "serial": sn,
        "rtc": rtc,
        "raw_len": len(payload),
    }


# GET_CONFIG field layout (first 20 of the 40-byte reply). Bytes 20+ are firmware-variant; opaque.
_CONFIG_FIELDS = (
    "alarm_flags", "spo2_low", "hr_low", "hr_high", "motor", "buzzer", "display_mode",
    "brightness", "storage_interval", "tz_byte", "auto_switch", "alg_avg_time",
    "count_down_time", "lr_model", "motor_switch", "motor_threshold", "invalid_signal_switch",
)  # [17..18] u16 LE invalid_signal_time_thr, then [19] func_switch — handled explicitly below

def parse_config(payload: bytes) -> dict | None:
    """cmd=0x00 reply (40-byte plaintext) → the ring's settings struct, first 20 bytes decoded.

    Read-only: this project does not ship a SET_CONFIG writer (see the opcode note above). Useful for
    reading `storage_interval` and the alarm thresholds, and for verifying the ring's config on the box
    without the vendor app."""
    if len(payload) < 20:
        return None
    out = {name: payload[i] for i, name in enumerate(_CONFIG_FIELDS)}
    out["invalid_signal_time_thr"] = payload[17] | (payload[18] << 8)
    out["func_switch"] = payload[19]
    return out


def parse_battery(payload: bytes) -> dict | None:
    """cmd=0xE4 reply (4 bytes) → {level, state}, or None if too short. byte[1] matches the live
    header's battery percent (parse_live)."""
    if len(payload) < 2:
        return None
    return {"state": payload[0], "level": payload[1]}


# ── SET_CONFIG (0x01) — the GATED settings writer (owner-ordered 2026-08-19) ─────────────────────────
# Payload per nglessner/o2ring-s-protocol: 8 bytes LE, [field_index, 0, 0, 0, value, 0, 0, 0].
# ⚠️ The WRITE-side field indices are a DIFFERENT enumeration from parse_config's READ-side byte
# offsets — MOTOR is write-field 6 but read-byte 4 ("motor"), BRIGHTNESS write-field 9 but read-byte 7.
# `readback` names the parse_config key each write should move so ring_config.py can verify the exact
# byte; None for the two alarm switches, which fold into bitfields (alarm_flags/motor/buzzer) where
# only the full-struct diff can judge the effect. Value ranges: BRIGHTNESS is documented (0/1/2);
# every other range is UNDOCUMENTED upstream — a byte is accepted and the mandatory read-back is the
# real validator (upstream's own advice: discover ranges empirically via GET_CONFIG before/after).
SET_CONFIG_FIELDS = {
    "spo2_switch":  {"index": 1, "max": 255, "readback": None},
    "spo2_low":     {"index": 2, "max": 255, "readback": "spo2_low"},
    "hr_switch":    {"index": 3, "max": 255, "readback": None},
    "hr_low":       {"index": 4, "max": 255, "readback": "hr_low"},
    "hr_high":      {"index": 5, "max": 255, "readback": "hr_high"},
    "motor":        {"index": 6, "max": 255, "readback": "motor"},
    "display_mode": {"index": 8, "max": 255, "readback": "display_mode"},
    "brightness":   {"index": 9, "max": 2, "readback": "brightness"},
    "interval":     {"index": 10, "max": 255, "readback": "storage_interval"},
}


def set_config_frame(field: str, value: int, seq: int = 0) -> bytes:
    """One whitelisted settings write. Raises ValueError on an unknown field or out-of-range value —
    the whitelist is the gate that keeps this opcode's neighbourhood (0xE3/0xEE factory resets)
    unreachable by construction: only a name in SET_CONFIG_FIELDS can produce a frame, and the frame's
    opcode is hard-coded. Callers MUST read the config back after writing (ring_config.py does a
    full-struct diff); a write without read-back is a claim, not a setting."""
    spec = SET_CONFIG_FIELDS.get(field)
    if spec is None:
        raise ValueError(f"unknown SET_CONFIG field {field!r} — whitelist: {sorted(SET_CONFIG_FIELDS)}")
    v = int(value)
    if not 0 <= v <= spec["max"]:
        raise ValueError(f"{field}={value} out of range 0..{spec['max']}")
    return encode(OP_SET_CONFIG, bytes([spec["index"], 0, 0, 0, v, 0, 0, 0]), seq)


# ── STORED-FILE (Format A) SESSION-STATS TRAILER ────────────────────────────────────────────────────
# Every finalised Format-A OXY recording ends with a 48-byte trailer the vendor app uses for its
# session-summary PDF. Two reasons to parse it: (1) `is_finalized` — the ring can report a file's full
# size via cmd=0xF2 BEFORE the trailer flushes, so size-equality is not a reliable "complete" check; the
# `48 12 5a da` sub-magic at trailer[4:8] is. (2) The stats are an INDEPENDENT cross-check on OxyDex's
# own computation of avg/min SpO2 and desat counts from the same bytes.
# Offsets verified byte-exact upstream across 8+ recordings; avg-SpO2/avg-HR agree with body means ±1.
_TRAILER_LEN = 48
_TRAILER_SUBMAGIC = bytes([0x48, 0x12, 0x5A, 0xDA])

def parse_oxy_trailer(data: bytes) -> dict | None:
    """The 48-byte Format-A trailer from a full recording's bytes → session stats, or None.

    `data` is the whole file; the trailer is its last 48 bytes. Returns None (not an exception) when the
    file is too short OR not finalised — a caller re-pulls in a later sync cycle rather than trusting a
    half-written summary. `o2_score_x10` is 0xFF on short sessions → surfaced as None.

    ── `start_t_ms` IS THE FIELD THIS PARSER WAS MISSING (added 2026-09-02) ─────────────────────────
    `T+8` is a u32 recording start time and was never read here, so every stored `.dat` we hold carried
    its own start stamp and we inferred one from the filename instead.

    ⚠️ **It is a FLOATING wall-clock epoch, not a real instant, and that is measured rather than assumed.**
    Across six stored files the value read as UTC equals the filename's LOCAL wall-clock stamp to +0.00 h
    on all six; if the ring applied the timezone we push in `set_time_frame` the delta would be ±5 h.
    So it is local civil time encoded as if it were UTC — exactly CLAUDE.md §🔒.1's canonical `tMs`, in
    seconds. Returned as `start_t_ms` (× 1000) so a caller can use it directly with `getUTC*`/
    `utcfromtimestamp` semantics. **Do NOT apply a timezone to it, and do not call it UTC.** The vendor's
    own SDK adds a zone offset when it reads this field — that is the phone app converting a floating
    stamp to an instant with the phone's zone, not the ring having written one.
    The ring's clock is still unsynced and drifts (§9), so this is an honest floating stamp, not an
    accurate one — it needs the same per-download offset correction as before. What it removes is the
    guess, not the drift.

    ── `total_seconds` is a SAMPLE COUNT, and it is right only because `interval` is 1 ──────────────
    `T+12` is the u32 sample count and `T+16` is the seconds-per-sample interval; the recording duration
    is their product. This function read `T+12` as a u16 and named it `total_seconds`.
    ⚠️ **That is not a live defect and is not being reported as one.** Measured over all 30 stored files:
    every `interval` is 1, the u16 and u32 reads are identical on 30/30, and the largest session is
    36 000 samples against a u16 wrap at 65 536 — §5's 10 h hard cap keeps it below the wrap by
    construction. It is read at its true width here for honesty, and `sample_count`/`interval_s` are
    surfaced so a future firmware with `interval != 1` cannot silently redefine `total_seconds`.
    **What would make it bite** (name the condition, not just today's safety): a ring whose session cap
    exceeds 65 536 samples, or any `interval` other than 1 — the first truncates the count silently, the
    second makes `total_seconds` a count rather than a duration. Either way `duration_s` stays correct
    and `total_seconds` does not, so prefer `duration_s` in new code.

    Back-compat: every pre-existing key keeps its name, type and value. New keys are additive."""
    if len(data) < _TRAILER_LEN:
        return None
    t = data[-_TRAILER_LEN:]
    if t[4:8] != _TRAILER_SUBMAGIC:
        return None                                        # not finalised (or not Format A)
    score = t[42]
    samples = int.from_bytes(t[12:16], "little")
    interval = t[16]
    return {
        "finalized": True,
        "total_seconds": samples,                          # == duration only while interval == 1
        "sample_count": samples,
        "interval_s": interval,
        "duration_s": samples * interval,
        "start_t_ms": int.from_bytes(t[8:12], "little") * 1000,   # FLOATING wall clock — see above
        "avg_spo2": t[34],
        "min_spo2": t[35],
        "desat_ge3": t[36],
        "desat_ge4": t[37],
        "seconds_below_90": t[39] | (t[40] << 8),
        "episodes_below_90": t[41],
        "asleep_seconds": t[32] | (t[33] << 8),
        "pct_below_90": t[38],
        "steps": int.from_bytes(t[43:47], "little"),
        "o2_score_x10": None if score == 0xFF else score,
        "avg_hr": t[47],
    }


def oxy_is_finalized(data: bytes) -> bool:
    """True iff a Format-A file carries the finalisation sub-magic — the reliable 'complete' predicate
    (size-equality is not; the trailer can flush after the size is reported). Cheaper than parsing."""
    return len(data) >= _TRAILER_LEN and data[-_TRAILER_LEN:][4:8] == _TRAILER_SUBMAGIC
