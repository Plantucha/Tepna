"""ENCRYPTED-SESSION GUARD — the failure here is fabricated vitals, not a dropped link.

Newer O2Ring-S firmware answers OP_AUTH with an AES-128 session key and encrypts every payload
afterwards. The envelope is NOT encrypted, so `decode()` — magic, ~cmd, CRC-8 — passes ciphertext
through intact and `parse_live()` reads it as measurements. `test_crc_does_not_stop_ciphertext` below
is the reason this module exists: it demonstrates that every structural check we have stays green
while the numbers are invented.

ON FIXTURE PROVENANCE, stated because it decides what these tests may claim: the key blob used here is
SDK-DERIVED, not captured. The only run of this protocol on real newer-firmware hardware we can point
to (SomnoTrace discussion #180, comment 18250284) produced application-level logs, not raw bytes — it
records that the handshake succeeded, the reply lengths seen, and that a plaintext session worked on
the short-reply connects, but it does not contain the blob. So `_key_blob()` builds a blob to the
vendor SDK's documented shape. It is not presented as a capture, and no test here asserts that a real
ring emits exactly these bytes.

What the third-party run DOES pin, and what `test_short_reply_is_plaintext_not_refusal` encodes, is
that the same ring answered with >= 20 bytes on one connect and 16 bytes on later ones, and that the
16-byte connects worked in plaintext — four files pulled. A guard that refuses on any reply would have
refused those.

NAMING, because it will otherwise mislead: the rings are distinguished here by BRANCH CODE (2D010001
answers OP_AUTH, 2D010002 does not), which is a different field from the firmware version — the ring
that answers is branch 2D010001 AND firmware 1.13.1.0. `parse_get_info` returns the branch code under
the key "firmware", which is a misnomer inherited from this module and out of scope to fix here.
"""

import hashlib

import oxyii

_LEPU = hashlib.md5(b"lepucloud").digest()


def _key_blob(key: bytes, *, type_byte: int = 0x01, key_len: int = 16) -> bytes:
    """A 20-byte OP_AUTH reply to the SDK's documented shape, salted the way the ring salts it.

    SDK-derived, not captured — see the module docstring.
    """
    plain = bytes([type_byte, key_len, 0x00, 0x00]) + key
    return bytes(b ^ _LEPU[i % 16] for i, b in enumerate(plain))


def _live_payload(duration=61, contact=0x01, spo2=97, pr=62) -> bytes:
    p = bytearray(14)
    p[0:4] = duration.to_bytes(4, "little")
    p[4] = 0x01
    p[5] = contact
    p[6] = spo2
    p[7] = 15
    p[8:10] = pr.to_bytes(2, "little")
    p[10] = 0xC7
    p[11] = 0
    p[12] = 0
    p[13] = 80
    return bytes(p)


# ── the hazard itself ───────────────────────────────────────────────────────────────────────────────


def test_crc_does_not_stop_ciphertext():
    """The CRC is computed over the ciphertext by the ring, so every structural check passes.

    This is the whole reason for the guard. If someone later decides the guard duplicates `decode()`,
    this test is the answer: decode() accepts the frame and parse_live() produces a reading.
    """
    ciphertext = bytes([0x9E, 0x4C, 0xD1, 0x77, 0x22, 0x5B, 0x3E, 0x08, 0x41, 0x00, 0xAA, 0x13, 0x02, 0x55])
    frame = oxyii.encode(oxyii.OP_LIVE, ciphertext)

    got = oxyii.decode(frame)
    assert got is not None, "decode() rejected it — then this hazard would not exist"
    op, payload = got
    assert op == oxyii.OP_LIVE
    assert payload == ciphertext

    parsed = oxyii.parse_live(payload)
    assert parsed is not None, "parse_live() refused it — then this hazard would not exist"
    # 0x3E == 62 is inside 50..100, so it is surfaced as a genuine-looking saturation.
    assert parsed["spo2"] == 62, "the fabricated reading this guard exists to prevent"

    # And the guard does catch it, on the tells the vitals cannot provide.
    assert oxyii.frame_looks_like_ciphertext(parsed) is True


# ── classify_auth_reply ─────────────────────────────────────────────────────────────────────────────


def test_no_reply_is_plaintext():
    mode, key, reason = oxyii.classify_auth_reply(None)
    assert mode == oxyii.AUTH_PLAINTEXT
    assert key is None
    assert "no OP_AUTH reply" in reason

    assert oxyii.classify_auth_reply(b"")[0] == oxyii.AUTH_PLAINTEXT


def test_short_reply_is_plaintext_not_refusal():
    """16 bytes → plaintext. Measured on a real branch-2D010001 ring; the plaintext session then worked.

    Refusing here would refuse a session that pulls files correctly, which is what the first real
    capture of this device showed. The classification keys on the LENGTH being too short to carry a
    key blob — not on any claim about what the 16 bytes are.
    """
    mode, key, reason = oxyii.classify_auth_reply(bytes(16))
    assert mode == oxyii.AUTH_PLAINTEXT
    assert key is None
    assert "too short" in reason


def test_valid_key_blob_yields_the_key():
    key = bytes(range(0x10, 0x20))
    mode, got, reason = oxyii.classify_auth_reply(_key_blob(key))
    assert mode == oxyii.AUTH_ENCRYPTED
    assert got == key
    assert "AES-128" in reason


def test_unknown_type_refuses():
    mode, key, reason = oxyii.classify_auth_reply(_key_blob(bytes(16), type_byte=0x02))
    assert mode == oxyii.AUTH_REFUSE
    assert key is None
    assert "unsupported firmware" in reason
    assert "type=0x02" in reason


def test_unknown_key_length_refuses():
    mode, key, reason = oxyii.classify_auth_reply(_key_blob(bytes(16), key_len=32))
    assert mode == oxyii.AUTH_REFUSE
    assert key is None
    assert "key_len=32" in reason


def test_refusal_reason_names_itself():
    """A refusal must say why in words an operator can act on, not just fail."""
    _, _, reason = oxyii.classify_auth_reply(_key_blob(bytes(16), type_byte=0x07))
    assert "refusing" in reason.lower()
    assert "vitals" in reason.lower()


# ── the secondary tell ──────────────────────────────────────────────────────────────────────────────


def test_a_normal_frame_is_not_suspect():
    assert oxyii.frame_looks_like_ciphertext(oxyii.parse_live(_live_payload())) is False


def test_off_finger_is_not_suspect():
    """0xFF/0xFF with a real duration and a documented contact byte is a NORMAL state.

    parse_live already nulls both vitals here. Mistaking it for a broken session would refuse every
    ring that is simply not being worn.
    """
    parsed = oxyii.parse_live(_live_payload(contact=0x00, spo2=0xFF, pr=0xFFFF))
    assert parsed["spo2"] is None and parsed["pr"] is None
    assert oxyii.frame_looks_like_ciphertext(parsed) is False


def test_absurd_duration_is_suspect():
    parsed = oxyii.parse_live(_live_payload(duration=0x7F1A2B3C))
    assert oxyii.frame_looks_like_ciphertext(parsed) is True


def test_undocumented_contact_byte_is_suspect():
    parsed = oxyii.parse_live(_live_payload(contact=0x9C))
    assert oxyii.frame_looks_like_ciphertext(parsed) is True


def test_one_suspect_frame_is_not_enough():
    """A single odd frame is noise; the tell is statistical and must not fire on one."""
    frames = [oxyii.parse_live(_live_payload()) for _ in range(4)]
    frames.append(oxyii.parse_live(_live_payload(duration=0x6BCDEF01)))
    assert oxyii.sustained_ciphertext(frames) is False


def test_a_sustained_run_is_enough():
    frames = [oxyii.parse_live(_live_payload(duration=0x40000000 + i)) for i in range(oxyii.CIPHERTEXT_RUN)]
    assert oxyii.sustained_ciphertext(frames) is True


def test_a_short_stream_never_fires():
    frames = [oxyii.parse_live(_live_payload(duration=0x40000000))] * (oxyii.CIPHERTEXT_RUN - 1)
    assert oxyii.sustained_ciphertext(frames) is False


def test_an_undecodable_frame_is_not_this_functions_business():
    """A frame parse_live() rejected is decode()'s problem, not a ciphertext signal.

    Returning True here would turn every short or malformed frame into a refusal, which is a
    different failure with a different fix.
    """
    assert oxyii.frame_looks_like_ciphertext(None) is False
    assert oxyii.frame_looks_like_ciphertext({}) is False
