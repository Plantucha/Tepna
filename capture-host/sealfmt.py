# tepna-capture — sealfmt.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`tepna-seal/1` — the constants and pure helpers BOTH `seal.py` and `unseal.py` read.

THE FORMAT IS FROZEN in `docs/NIGHT-SEAL-FORMAT.md`; this module is its executable half. Nothing here
decides policy: it names byte layouts, derivation inputs and encodings so the sealer and the unsealer —
and `tools/verify-seals.mjs`, the Node twin that must never drift from them — agree on one recipe.
Every constant below is echoed in the format doc with the reason it was chosen; change one and the
format version bumps (CAPTURE-NIGHT-SEAL §2: "`tepna-seal/1` is FROZEN once shipped").

Primitives are WebCrypto-native on purpose (§5, §9 "no vendored crypto"): ECDSA P-256 / SHA-256 with the
signature as raw `r‖s`, AES-256-GCM, AES-KW (RFC 3394) for the per-recipient data-key wrap, HKDF-SHA-256.
A browser reader (phase C) reuses exactly this recipe through `crypto.subtle`.
"""

from __future__ import annotations

import hashlib
import hmac
import json

FORMAT = "tepna-seal/1"
MAGIC = b"TEPNASEAL"          # 9 bytes, then u8 version
VERSION = 1

HEADER_LEN_BYTES = 4          # u32 big-endian length of the clear-header JSON
SIG_LEN_BYTES = 2             # u16 big-endian length of the signature (64 for P-256 raw r‖s)
PAYLOAD_LEN_BYTES = 8         # u64 big-endian length of nonce ‖ ciphertext ‖ tag
GCM_NONCE_BYTES = 12
GCM_TAG_BYTES = 16
DATA_KEY_BYTES = 32           # AES-256
CARD_KEY_BYTES = 16           # §3: a 128-bit card key
P256_SIG_BYTES = 64           # raw r‖s, IEEE P1363 — what WebCrypto produces and verifies

# HKDF-SHA-256 from the card key to the key-encryption key that wraps the data key.
#   salt = UTF-8(boxId) ‖ UTF-8(str(keyId))   — §2: "salt boxId‖keyId"; a rotated card (keyId+1)
#                                                 derives a different KEK, so old nights stay under theirs
#   info = KEK_INFO
KEK_INFO = b"tepna-seal/1 card-kek"
KEK_BYTES = 32

# Test-vector determinism ONLY (§6): nonces and the data key derive from the TEST card key so a re-seal
# is byte-identical. Production draws both from `os.urandom`. The info strings differ from KEK_INFO so a
# derived nonce can never collide with a derived key.
TEST_NONCE_INFO = b"tepna-seal/1 TEST nonce"
TEST_DATAKEY_INFO = b"tepna-seal/1 TEST datakey"

# Header fields, in the order the format doc lists them. `boxKey` (the raw uncompressed P-256 point,
# base64) and `revision` are in the CLEAR header so the fingerprint pin and the stale-revision check run
# before any key material is touched; `consent` is mirrored from bag-info.txt (§2) and is tri-state:
# "yes" | "no" | null, where null means NOT ASKED — never a default "no" wearing the shape of an answer.
HEADER_FIELDS = ("format", "boxId", "night", "closedAt", "files", "bytes", "keyId", "boxKey",
                 "boxKeyFingerprint", "recipients", "consent", "revision", "anchor")

BAGIT_TXT = "BagIt-Version: 1.0\nTag-File-Character-Encoding: UTF-8\n"
ZIP_EPOCH = (1980, 1, 1, 0, 0, 0)   # deterministic zip: every entry carries this date_time

CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def canonical_header_bytes(header: dict) -> bytes:
    """The clear header as SIGNED: compact JSON, keys sorted, UTF-8. The bytes on disk ARE these bytes
    (the sealer writes exactly what it signed), so a verifier never re-serialises — it hashes what it
    read. Canonical form is for the SEALER's determinism only."""
    return json.dumps(header, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def fingerprint(raw_point: bytes) -> str:
    """`sha256/<hex>` over the raw uncompressed P-256 public point (65 bytes, 0x04 ‖ X ‖ Y) — the form
    WebCrypto exports as "raw", so the card, the box and the browser compute the same string."""
    return "sha256/" + hashlib.sha256(raw_point).hexdigest()


def kek_salt(box_id: str, key_id: int) -> bytes:
    return box_id.encode("utf-8") + str(int(key_id)).encode("utf-8")


def hkdf_sha256(ikm: bytes, salt: bytes, info: bytes, length: int) -> bytes:
    """RFC 5869, written out rather than imported so the derivation is READABLE beside its Node twin
    (`crypto.subtle.deriveBits` with HKDF) — the point of this module is that the two agree."""
    prk = hmac.new(salt, ikm, hashlib.sha256).digest()
    out, t, counter = b"", b"", 1
    while len(out) < length:
        t = hmac.new(prk, t + info + bytes([counter]), hashlib.sha256).digest()
        out += t
        counter += 1
    return out[:length]


def card_code_encode(card_key: bytes) -> str:
    """§3: the 128-bit card key as 26 Crockford base32 characters in groups of four. 128 bits = 25.6
    symbols, so the 26th carries 2 padding bits that MUST be zero (the decoder refuses otherwise)."""
    if len(card_key) != CARD_KEY_BYTES:
        raise ValueError("card key must be %d bytes" % CARD_KEY_BYTES)
    n = int.from_bytes(card_key, "big") << 2         # 130 bits → 26 symbols
    syms = [CROCKFORD[(n >> (5 * (25 - i))) & 31] for i in range(26)]
    s = "".join(syms)
    return "-".join(s[i:i + 4] for i in range(0, 26, 4))


def card_code_decode(code: str) -> bytes:
    """Accepts the printed form (groups, any case, `I`/`L`→`1`, `O`→`0` per Crockford) and returns the
    16 key bytes. Refuses the wrong length or a non-zero padding tail."""
    s = code.upper().replace("-", "").replace(" ", "")
    s = s.replace("I", "1").replace("L", "1").replace("O", "0")
    if len(s) != 26 or any(c not in CROCKFORD for c in s):
        raise ValueError("card code must be 26 Crockford base32 characters")
    n = 0
    for c in s:
        n = (n << 5) | CROCKFORD.index(c)
    if n & 0b11:
        raise ValueError("card code has non-zero padding bits — not a tepna card code")
    return (n >> 2).to_bytes(CARD_KEY_BYTES, "big")
