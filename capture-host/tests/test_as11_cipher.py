# tepna-capture — tests/test_as11_cipher.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""as11_cipher — the AES-256-CBC payload cipher for the AS11 encrypted BLE channel.

The pure protocol layer (as11_link/as11_pull) takes seal/unseal by injection and is tested with an
identity cipher; THIS is the real one the daemon/probe inject. What must hold: an exact round-trip
(including a payload whose own trailing bytes are 0x00 — the length prefix, not a pad scan, is what
strips the padding), a fresh IV per seal, the length-prefixed-zero-pad wire shape (NOT PKCS#7), and a
hard refusal of a wrong-sized key. It is also cross-checked against as11_pull driving a real StreamData
frame through seal→unseal, so the cipher and the consumer are proven to compose.
"""
import json

import as11_cipher as C
import as11_link as L
import as11_pull as P
import pytest

KEY = b"K" * 32


def test_roundtrips_an_arbitrary_payload():
    seal, unseal = C.make_cipher(KEY)
    for payload in (b"", b"{}", b'{"method":"StreamData"}', bytes(range(256)) * 3):
        assert unseal(seal(payload)) == payload


def test_roundtrips_a_payload_that_ends_in_zero_bytes():
    """The length prefix — not a trailing-zero scan — defines the boundary, so a payload whose real
    content ends in 0x00 must survive. A PKCS#7 (or strip-trailing-zeros) unpad would corrupt this."""
    seal, unseal = C.make_cipher(KEY)
    payload = b"\x01\x02\x00\x00\x00"
    assert unseal(seal(payload)) == payload


def test_each_seal_uses_a_fresh_iv_so_ciphertexts_differ():
    seal, _ = C.make_cipher(KEY)
    a, b = seal(b"same"), seal(b"same")
    assert a != b, "a repeated IV would leak equality of plaintexts under CBC"
    assert a[:16] != b[:16], "the 16-byte IV prefix must be random per call"


def test_the_wire_is_iv_plus_length_prefixed_zero_pad_not_pkcs7():
    """Pin the exact format with a deterministic IV: [iv:16][AES(len:2LE || payload || 0x00-pad)].
    A one-byte payload → body is 3 bytes → padded to one 16-byte block → 16 IV + 16 cipher = 32."""
    seal, _ = C.make_cipher(KEY, iv_source=lambda n: b"\x00" * n)
    wire = seal(b"x")
    assert len(wire) == 32 and wire[:16] == b"\x00" * 16
    # decrypt the block ourselves and confirm the plaintext is len-prefixed + zero-padded, not PKCS#7
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    dec = Cipher(algorithms.AES(KEY), modes.CBC(b"\x00" * 16)).decryptor()
    block = dec.update(wire[16:]) + dec.finalize()
    assert block[:2] == (1).to_bytes(2, "little"), "2-byte LE length prefix"
    assert block[2:3] == b"x" and block[3:] == b"\x00" * 13, "zero pad, not PKCS#7 (which would be 0x0d…)"


def test_a_block_aligned_body_adds_NO_padding_block():
    """len-prefix(2) + payload(14) == 16 exactly: the body is already block-aligned, so NO pad is added
    and the wire is exactly IV(16) + one cipher block(16) = 32. A `% -> /` mutation (pad whenever the
    length is non-zero, i.e. always) would append a spurious 16-byte zero block here → 48 bytes, while
    the round-trip alone would still pass because unseal cuts at the length prefix. So assert the LENGTH,
    not just the round-trip."""
    seal, unseal = C.make_cipher(KEY)
    payload = bytes(range(14))
    wire = seal(payload)
    assert len(wire) == 32, "an already-aligned body must not gain a padding block"
    assert unseal(wire) == payload


def test_rejects_a_key_that_is_not_32_bytes():
    for bad in (b"", b"short", b"K" * 16, b"K" * 33):
        with pytest.raises(ValueError, match="32 bytes"):
            C.make_cipher(bad)


def test_composes_with_as11_pull_over_a_real_streamdata_frame():
    """The cipher and the consumer must fit: seal a StartStream ACK + a StreamData frame, feed them
    through as11_pull.stream with the REAL unseal, and get the decoded batch back."""
    seal, unseal = C.make_cipher(KEY)

    def enc(obj):
        return (L.VCID_ENC_RX, seal(json.dumps(obj).encode()))

    import asyncio
    import collections

    class Dev:
        def __init__(self, frames):
            self._f = collections.deque(frames)
            self.written = []

        async def write(self, frame):
            self.written.append(frame)

        async def recv_frame(self):
            return self._f.popleft()

    dev = Dev([
        enc({"id": 16, "result": {"dataIds": [{"dataId": "PatientFlow", "valid": True}], "streamId": 1}}),
        enc({"jsonrpc": "2.0", "method": "StreamData", "params": {
            "data": [{"PatientFlow": [0.1, 0.2, 0.3]}], "intervalMs": 40,
            "startTime": "2026-08-23T01:30:28.730Z", "streamId": 1}}),
    ])

    async def go():
        out = []
        async for batch in P.stream(dev.write, dev.recv_frame, seal, unseal, ["PatientFlow"], max_batches=1):
            out.append(batch)
        return out

    batches = asyncio.run(go())
    assert batches[0]["channels"] == {"PatientFlow": [0.1, 0.2, 0.3]}
    # and the StartStream it sent was itself sealed — unseal it back to prove the TX leg enciphered too
    sent_vcid, sent_payload, _ = L.fig_unframe(dev.written[0])
    assert sent_vcid == L.VCID_ENC_TX
    assert json.loads(unseal(sent_payload))["method"] == "StartStream"
