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

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)

import seal            # noqa: E402
import sealfmt as F    # noqa: E402

VECTOR_DIR = os.path.join(HERE, "tests", "vectors", "tepna-seal-1")
UPLOADS = os.path.join(os.path.dirname(HERE), "uploads")
NIGHT_INPUTS = ("synthetic_ecgdex_h10.txt", "synthetic_oxydex_o2ring.csv", "synthetic_motiondex_acc.txt")
BOX_ID, NIGHT, KEY_ID = "TESTBOX0", "2026-09-20", 1
CLOSED_AT_MS = 1789977600000                       # 2026-09-21T00:00:00 floating (Clock Contract)
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


def main() -> int:
    from cryptography.hazmat.primitives import serialization
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
    print("wrote", VECTOR_DIR)
    return 0


if __name__ == "__main__":     # pragma: no cover
    raise SystemExit(main())
