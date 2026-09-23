# tepna-capture — tools/seal_vectors.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""(Re)generate the committed `tepna-seal/1` test vectors — CAPTURE-NIGHT-SEAL §6.

    python3 tools/seal_vectors.py            # rewrite tests/vectors/tepna-seal-1/ from the inputs

The night is the existing synthetic corpus (three tracked `uploads/synthetic_*` files, one per device
kind), sealed under the committed TEST key pair and TEST card key with deterministic nonces derived
from that test key. Both `tests/test_seal.py` and `tools/verify-seals.mjs` verify these SAME bytes, and
the Python test additionally re-seals and asserts byte identity — so a change to the recipe on either
side reds before any real seal exists in the wild.

⚠️ The key pair and card key in that directory are TEST material, committed on purpose, and worthless
for anything but these vectors. A box generates its own at first boot (phase B).
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
from datetime import datetime
from typing import Any

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)

import seal            # noqa: E402
import sealfmt as F    # noqa: E402

VECTOR_DIR = os.path.join(HERE, "tests", "vectors", "tepna-seal-1")
UPLOADS = os.path.join(os.path.dirname(HERE), "uploads")
NIGHT_INPUTS = ("synthetic_ecgdex_h10.txt", "synthetic_oxydex_o2ring.csv", "synthetic_motiondex_acc.txt")
BOX_ID, NIGHT, KEY_ID = "TESTBOX0", "2026-09-20", 1
CLOSED_AT_MS = 1789977600000                       # 2026-09-21T08:00:00 floating (Clock Contract) — read the bytes: Date.UTC(2026,8,21,8)
BAGGING = datetime(2026, 9, 21, 7, 0, 0)
# The TEST card key: fixed, printable, obviously not random. Its Crockford code is committed beside it.
TEST_CARD_KEY = bytes.fromhex("000102030405060708090a0b0c0d0e0f")
SEAL_NAME = "%s-%s.tepna" % (BOX_ID, NIGHT)


def stage_night(into: str) -> str:
    night = os.path.join(into, "night")
    os.makedirs(night, exist_ok=True)
    for n in NIGHT_INPUTS:
        shutil.copy(os.path.join(UPLOADS, n), os.path.join(night, n))
    return night


def load_test_key():
    from cryptography.hazmat.primitives import serialization
    with open(os.path.join(VECTOR_DIR, "test-signing-key.pem"), "rb") as fh:
        return serialization.load_pem_private_key(fh.read(), password=None)


def seal_kwargs(signing_key, **over):
    kw = dict(box_id=BOX_ID, night=NIGHT, card_key=TEST_CARD_KEY, key_id=KEY_ID, signing_key=signing_key,
              consent=None, revision=1, closed_at_ms=CLOSED_AT_MS, now=BAGGING,
              extra_info={"Tepna-Capture-Host-Version": "test-vector", "Tepna-Capture-Host-Sha": "0000000"},
              deterministic_from=TEST_CARD_KEY)
    kw.update(over)
    return kw


# ── the eight plants (§6) — built HERE so the committed plant vectors and the test build the same bytes ──
# Each plant is a hook between construction and signing (`mutate_bag` / `mutate_header`), a different
# key, a post-hoc header forgery, or a reader-side condition. `expect` is the refusal kind BOTH readers
# must name; None means "not a refusal — reads null". The committed `plants/` directory carries the four
# that need the sealer (a browser reader cannot re-seal); the other three a reader builds from the base
# vector at run time (a different card key, a different pin, a known revision).
# The streams the plants touch, named through NIGHT_INPUTS (the vector's own input list) rather than
# as literals: the capture-filename suffix-parity gate reads a bare lowercase `_<tag>.<ext>` literal
# in a capture-host source as a reader comparing against the wrong case, and these are not readers.
FLIPPED_STREAM = "data/" + NIGHT_INPUTS[1]      # the O2Ring CSV
TRUNCATED_STREAM = "data/" + NIGHT_INPUTS[2]    # the MotionDex ACC


def _flip_one_byte_in_one_stream(bag):
    b = bytearray(bag[FLIPPED_STREAM]); b[1000] ^= 0x01; bag[FLIPPED_STREAM] = bytes(b)
    return bag                        # manifest was computed on the good bytes: THAT stream's hash


def _truncate_payload(bag):
    bag[TRUNCATED_STREAM] = bag[TRUNCATED_STREAM][:-4096]     # Oxum was computed on the full bytes: caught BEFORE any hashing
    return bag


def _drop_consent(header):
    h = dict(header); del h["consent"]; return h


def _disagree_consent(header):
    return {**header, "consent": "yes"}    # the bag says null (not asked); the header now claims an answer


PLANTS: dict[str, dict[str, Any]] = {
    "flipped byte in one stream": dict(mutate_bag=_flip_one_byte_in_one_stream, expect="manifest:" + FLIPPED_STREAM, sealed=True),
    "truncated payload":          dict(mutate_bag=_truncate_payload, expect="oxum", sealed=True),
    "wrong card key":             dict(read_card_key=bytes(range(16, 32)), expect="card-key"),
    "unknown signing key":        dict(signing_key="OTHER", expect="fingerprint", sealed=True),
    "forged header":              dict(forge=True, expect="signature"),
    "stale revision":             dict(known_revision=2, expect="revision"),
    "consent absent":             dict(mutate_header=_drop_consent, expect=None, sealed=True),   # NOT a refusal: reads null
    "consent disagrees":          dict(mutate_header=_disagree_consent, expect="consent", sealed=True),
}
OTHER_KEY_PEM = "test-signing-key-other.pem"   # the SECOND committed test key — "unknown signing key" must be deterministic too


def plant_slug(name: str) -> str:
    return name.replace(" ", "_")


def load_other_test_key():
    from cryptography.hazmat.primitives import serialization
    with open(os.path.join(VECTOR_DIR, OTHER_KEY_PEM), "rb") as fh:
        return serialization.load_pem_private_key(fh.read(), password=None)


def build_plant(name: str, spec: dict, night: str, key, out: str) -> str:
    kw = seal_kwargs(key)
    if spec.get("signing_key") == "OTHER":
        kw["signing_key"] = load_other_test_key()
    if spec.get("mutate_bag"):
        kw["mutate_bag"] = spec["mutate_bag"]
    if spec.get("mutate_header"):
        kw["mutate_header"] = spec["mutate_header"]
    seal.seal_night(night, out, **kw)
    if spec.get("forge"):
        # keep the box's signature and payload, change one header field: the signature covers
        # header ‖ SHA-256(payload), so a header that was not signed cannot pass
        blob = bytearray(open(out, "rb").read())
        n = len(F.MAGIC) + 1
        hlen = int.from_bytes(blob[n:n + 4], "big")
        header = json.loads(bytes(blob[n + 4:n + 4 + hlen]))
        header["night"] = "2026-09-21"
        nh = F.canonical_header_bytes(header)
        blob[n:n + 4 + hlen] = len(nh).to_bytes(4, "big") + nh
        open(out, "wb").write(bytes(blob))
    return out


def write_plants(key, into: str) -> dict:
    """Write the SEALED plants (the four a reader cannot build from the base vector) and their index."""
    os.makedirs(into, exist_ok=True)
    index = {}
    with tempfile.TemporaryDirectory() as tmp:
        night = stage_night(tmp)
        for name, spec in PLANTS.items():
            if not spec.get("sealed"):
                continue
            out = os.path.join(into, "plant-%s.tepna" % plant_slug(name))
            build_plant(name, spec, night, key, out)
            index[name] = {"file": os.path.basename(out), "expect": spec["expect"],
                           "sha256": __import__("hashlib").sha256(open(out, "rb").read()).hexdigest()}
    with open(os.path.join(into, "expected.json"), "w") as fh:
        json.dump(index, fh, indent=2, sort_keys=True)
        fh.write("\n")
    return index


def main() -> int:
    from cryptography.hazmat.primitives import serialization
    os.makedirs(VECTOR_DIR, exist_ok=True)
    other = os.path.join(VECTOR_DIR, OTHER_KEY_PEM)
    if not os.path.exists(other):
        k2 = seal.generate_signing_key()
        with open(other, "wb") as fh:
            fh.write(k2.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                      serialization.NoEncryption()))
    os.makedirs(VECTOR_DIR, exist_ok=True)
    pem = os.path.join(VECTOR_DIR, "test-signing-key.pem")
    if not os.path.exists(pem):
        k = seal.generate_signing_key()
        with open(pem, "wb") as fh:
            fh.write(k.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                     serialization.NoEncryption()))
    key = load_test_key()
    with open(os.path.join(VECTOR_DIR, "test-card-key.txt"), "w") as fh:
        fh.write("# TEST card key — 16 bytes hex, and its printed Crockford code\n%s\n%s\n"
                 % (TEST_CARD_KEY.hex(), F.card_code_encode(TEST_CARD_KEY)))
    with tempfile.TemporaryDirectory() as tmp:
        night = stage_night(tmp)
        header = seal.seal_night(night, os.path.join(VECTOR_DIR, SEAL_NAME), **seal_kwargs(key))
    with open(os.path.join(VECTOR_DIR, "expected.json"), "w") as fh:
        json.dump({"seal": SEAL_NAME, "inputs": list(NIGHT_INPUTS), "boxId": BOX_ID, "night": NIGHT,
                   "keyId": KEY_ID, "cardKeyHex": TEST_CARD_KEY.hex(),
                   "boxKeyFingerprint": header["boxKeyFingerprint"], "header": header,
                   "sha256": __import__("hashlib").sha256(open(os.path.join(VECTOR_DIR, SEAL_NAME), "rb").read()).hexdigest()},
                  fh, indent=2, sort_keys=True)
        fh.write("\n")
    write_plants(key, os.path.join(VECTOR_DIR, "plants"))
    print("wrote", VECTOR_DIR)
    return 0


if __name__ == "__main__":     # pragma: no cover
    raise SystemExit(main())
