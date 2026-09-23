# tepna-capture — unseal.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""UNSEAL A NIGHT — `tepna-seal/1`, refusing LOUDLY and BY NAME (CAPTURE-NIGHT-SEAL §4, §6).

The reader is the Python twin of `tools/verify-seals.mjs`; both verify the same committed vectors so
they cannot drift unseen. Order of checks, and the plant each one is the guard for — every refusal is a
`SealRefused(kind, detail)` whose `kind` is one of `KINDS`, so a gate can count refusals by name:

    magic / version   not a tepna seal, or a version this reader does not know
    header            length-prefix or JSON unparseable, or `format` not tepna-seal/1
    fingerprint       header's box key does not hash to the PINNED fingerprint — an unknown key with a
                      valid-looking signature (§6 plant 4); pin comes from the CARD, never from the file
    signature         ECDSA over header ‖ SHA-256(payload) fails — a forged header over the correct
                      payload (plant 5), or any byte of the payload changed in transit
    revision          `revision` older than the newest already seen for this (boxId, night) (plant 6)
    card-key          AES-KW unwrap of the data key fails its integrity check (plant 3)
    payload           AES-GCM tag fails (would also be a wrong key; KW catches that first)
    zip               the decrypted bytes are not the zip the sealer writes
    oxum              `Payload-Oxum` disagrees with what `data/` holds — checked BEFORE any hashing, as
                      the cheap completeness test (plant 2)
    manifest:<path>   a `data/` file's SHA-256 disagrees with `manifest-sha256.txt` — one flipped byte
                      in one stream reds THAT stream's name (plant 1); tag files likewise via
                      `tagmanifest-sha256.txt`
    consent           the clear header and `bag-info.txt` answer the consent question differently — the
                      header MIRRORS the bag (format §2), and a reader must not pick either (plant 8)

`consent` is never a refusal: absent from the header it reads `None` — not asked — and NEVER "no" (plant
7 asserts exactly that). `read_header` needs no key at all (§2: the clear header is deliberately readable).
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import struct
import zipfile

from cryptography.exceptions import InvalidSignature, InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import Prehashed, encode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.keywrap import InvalidUnwrap, aes_key_unwrap

import sealfmt as F
import verdict as VD

__all__ = ["SealRefused", "KINDS", "read_header", "unseal", "verdict"]

KINDS = ("magic", "version", "header", "fingerprint", "signature", "revision", "card-key", "payload",
         "zip", "oxum", "manifest", "consent")


class SealRefused(Exception):
    def __init__(self, kind: str, detail: str):
        base = kind.split(":", 1)[0]
        if base not in KINDS:
            raise ValueError("unknown refusal kind %r" % kind)
        super().__init__("%s: %s" % (kind, detail))
        self.kind = kind
        self.detail = detail


def _split(blob: bytes) -> tuple[dict, bytes, bytes, bytes]:
    """(header dict, header bytes AS READ, signature, payload) — or a refusal by name."""
    n = len(F.MAGIC)
    if blob[:n] != F.MAGIC:
        raise SealRefused("magic", "not a tepna seal (magic %r)" % blob[:n])
    if len(blob) < n + 1 or blob[n] != F.VERSION:
        raise SealRefused("version", "seal version %r; this reader knows %d" % (blob[n:n + 1], F.VERSION))
    p = n + 1
    try:
        (hlen,) = struct.unpack(">I", blob[p:p + F.HEADER_LEN_BYTES]); p += F.HEADER_LEN_BYTES
        header_bytes = blob[p:p + hlen]; p += hlen
        if len(header_bytes) != hlen:
            raise SealRefused("header", "header truncated: %d of %d bytes" % (len(header_bytes), hlen))
        header = json.loads(header_bytes.decode("utf-8"))
        (slen,) = struct.unpack(">H", blob[p:p + F.SIG_LEN_BYTES]); p += F.SIG_LEN_BYTES
        sig = blob[p:p + slen]; p += slen
        if len(sig) != F.P256_SIG_BYTES:       # before the payload length is read from what follows
            raise SealRefused("signature", "signature is %d bytes, not %d" % (len(sig), F.P256_SIG_BYTES))
        (plen,) = struct.unpack(">Q", blob[p:p + F.PAYLOAD_LEN_BYTES]); p += F.PAYLOAD_LEN_BYTES
        payload = blob[p:p + plen]
    except (struct.error, ValueError, UnicodeDecodeError) as e:
        raise SealRefused("header", "cannot parse the clear header: %r" % (e,))
    if not isinstance(header, dict) or header.get("format") != F.FORMAT:
        raise SealRefused("header", "format is %r, not %r" % (header.get("format") if isinstance(header, dict) else None, F.FORMAT))
    if len(payload) != plen:
        raise SealRefused("payload", "payload truncated: %d of %d bytes" % (len(payload), plen))
    return header, header_bytes, sig, payload


def read_header(path: str) -> dict:
    """The clear header, with NO key: what it is (box, night, size, consent) before anyone decrypts."""
    header, _hb, _sig, _payload = _split(open(path, "rb").read())
    return header


def _verify_signature(header: dict, header_bytes: bytes, sig: bytes, payload: bytes) -> None:
    try:
        raw = base64.b64decode(header["boxKey"])
        pub = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), raw)
    except Exception as e:  # noqa: BLE001 — any malformed key is the same refusal
        raise SealRefused("header", "boxKey is not a P-256 point: %r" % (e,))
    digest = hashlib.sha256(header_bytes + hashlib.sha256(payload).digest()).digest()
    r, s = int.from_bytes(sig[:32], "big"), int.from_bytes(sig[32:], "big")
    try:
        pub.verify(encode_dss_signature(r, s), digest, ec.ECDSA(Prehashed(hashes.SHA256())))
    except InvalidSignature:
        raise SealRefused("signature", "ECDSA over header ‖ SHA-256(payload) does not verify — the "
                                       "header or the payload is not what the box signed")


def _consent(header: dict) -> str | None:
    """Tri-state, and absence is `None`. A reader that defaulted a missing field to "no" would be
    answering a question nobody asked (§∅ applies to consent)."""
    c = header.get("consent")
    return c if c in ("yes", "no") else None


def unseal(path: str, *, card_key: bytes, pinned_fingerprint: str, known_revision: int | None = None) -> dict:
    """Verify everything and return `{"header", "consent", "bag_info", "files": {relpath: bytes}}`.

    `pinned_fingerprint` is the box key fingerprint FROM THE CARD (§2: "pin the key from the card rather
    than trust first sight"). `known_revision` is the newest revision this reader has already accepted
    for the same (boxId, night); an older one presented later is refused (§4: a seal is re-issued, never
    patched, and the previous file is replaced once the new one verifies)."""
    blob = open(path, "rb").read()
    header, header_bytes, sig, payload = _split(blob)

    if header.get("boxKeyFingerprint") != pinned_fingerprint or \
            F.fingerprint(base64.b64decode(header.get("boxKey", ""))) != pinned_fingerprint:
        raise SealRefused("fingerprint", "box key %s is not the pinned %s — an unknown key, whatever its "
                                         "signature says" % (header.get("boxKeyFingerprint"), pinned_fingerprint))
    _verify_signature(header, header_bytes, sig, payload)

    rev = header.get("revision")
    if not isinstance(rev, int) or rev < 1:
        raise SealRefused("header", "revision is %r, not a positive integer" % (rev,))
    if known_revision is not None and rev < known_revision:
        raise SealRefused("revision", "revision %d presented after revision %d was already seen for "
                                      "%s/%s — a stale re-issue" % (rev, known_revision, header.get("boxId"), header.get("night")))

    recips = [r for r in header.get("recipients") or [] if r.get("kind") == "card" and r.get("keyId") == header.get("keyId")]
    if not recips or recips[0].get("wrap") != "AES-KW":
        raise SealRefused("header", "no AES-KW card recipient for keyId %r" % (header.get("keyId"),))
    kek = F.hkdf_sha256(card_key, F.kek_salt(str(header["boxId"]), int(header["keyId"])), F.KEK_INFO, F.KEK_BYTES)
    try:
        data_key = aes_key_unwrap(kek, base64.b64decode(recips[0]["wrapped"]))
    except (InvalidUnwrap, ValueError):
        raise SealRefused("card-key", "the card key does not unwrap this seal's data key (keyId %s)" % header["keyId"])

    nonce, ct = payload[:F.GCM_NONCE_BYTES], payload[F.GCM_NONCE_BYTES:]
    try:
        plain = AESGCM(data_key).decrypt(nonce, ct, header_bytes)
    except InvalidTag:
        raise SealRefused("payload", "AES-GCM tag does not verify")

    try:
        z = zipfile.ZipFile(io.BytesIO(plain))
        entries = {zi.filename: z.read(zi) for zi in z.infolist()}
    except (zipfile.BadZipFile, KeyError) as e:
        raise SealRefused("zip", "payload is not the sealer's zip: %r" % (e,))

    info = _bag_info(entries)
    data = {k[5:]: v for k, v in entries.items() if k.startswith("data/")}
    oxum = info.get("Payload-Oxum", "")
    got = "%d.%d" % (sum(len(v) for v in data.values()), len(data))
    if oxum != got:
        raise SealRefused("oxum", "Payload-Oxum says %s, data/ holds %s (bytes.files) — the bag is not "
                                  "complete, checked before any hashing" % (oxum, got))
    _check_manifest(entries, "tagmanifest-sha256.txt")
    _check_manifest(entries, "manifest-sha256.txt")
    consent = _consent(header)
    in_bag = info.get("Tepna-Research-Consent")
    in_bag = in_bag if in_bag in ("yes", "no") else None
    if in_bag != consent:
        raise SealRefused("consent", "clear header says %r but bag-info.txt says %r" % (consent, in_bag))
    return {"header": header, "consent": consent, "bag_info": info, "files": data}


def _bag_info(entries: dict[str, bytes]) -> dict[str, str]:
    try:
        text = entries["bag-info.txt"].decode("utf-8")
    except (KeyError, UnicodeDecodeError):
        raise SealRefused("zip", "bag-info.txt missing or not UTF-8")
    info: dict[str, str] = {}
    for line in text.splitlines():
        if ": " in line:
            k, v = line.split(": ", 1)
            info[k] = v
    return info


def _check_manifest(entries: dict[str, bytes], manifest_name: str) -> None:
    try:
        lines = entries[manifest_name].decode("utf-8").splitlines()
    except (KeyError, UnicodeDecodeError):
        raise SealRefused("zip", "%s missing or not UTF-8" % manifest_name)
    for line in lines:
        if not line.strip():
            continue
        try:
            want, name = line.split("  ", 1)
        except ValueError:
            raise SealRefused("zip", "%s: unparseable line %r" % (manifest_name, line))
        if name not in entries:
            raise SealRefused("manifest:" + name, "listed in %s but absent from the bag" % manifest_name)
        got = hashlib.sha256(entries[name]).hexdigest()
        if got != want:
            raise SealRefused("manifest:" + name, "SHA-256 %s… does not match the manifest's %s…" % (got[:12], want[:12]))


# ── tepna.verdict/1 — the same object the Node twin emits (VERDICT-CONTRACT §1) ──────────────────
# Built by `verdict.make` (the Python half of the contract, #2803) since wave 2 — one builder, one
# validator, the same rules `verdict.js` applies; this module no longer hand-writes the shape.
VERDICT_GATE = "verify-seals"
VERDICT_CRITERION = {"name": "tepna-seal/1 verifies end to end", "threshold": 0, "unit": "refusals", "direction": "eq"}
_TOOL = "capture-host/unseal.py"


_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _evidence_path(path: str) -> str:
    """A file under the repo is named repo-relative in `evidence`; anything else as given. An absolute
    path there is a checkout's, not the file's — the committed sample carried one worktree's `/home/…`
    and read as drift in every other checkout (#2815, first CI lap). PURE."""
    absolute = os.path.abspath(path)
    if absolute == _REPO or absolute.startswith(_REPO + os.sep):
        return os.path.relpath(absolute, _REPO)
    return path


def verdict(path: str, *, card_key: bytes, pinned_fingerprint: str, known_revision: int | None = None) -> dict:
    """One JSON object per file: PASS with what is inside, FAIL with the refusal's kind as the reason,
    NOT_RUN when the file cannot be read, UNKNOWN when the reader itself crashed. Prose is explanation;
    this is the API. A refusal is never an adjective — `reason` is `<kind>: <detail>`, the same string
    the exception carries. Population: the one file; NOT_RUN excludes it (nothing was opened)."""
    evidence = [_TOOL, _evidence_path(path)]
    one = {"checked": 1, "eligible": 1, "excluded": 0}
    try:
        r = unseal(path, card_key=card_key, pinned_fingerprint=pinned_fingerprint, known_revision=known_revision)
    except SealRefused as e:
        return VD.make(gate=VERDICT_GATE, status="FAIL", population=one, criterion=VERDICT_CRITERION,
                       result={"kind": e.kind, "files": None, "consent": None, "revision": None},
                       evidence=evidence, reason="%s: %s" % (e.kind, e.detail), tool=_TOOL)
    except OSError as e:
        return VD.make(gate=VERDICT_GATE, status="NOT_RUN", population={"checked": 0, "eligible": 1, "excluded": 1},
                       criterion=VERDICT_CRITERION, result=None, evidence=[_TOOL],
                       reason="cannot read %s: %s" % (path, e), tool=_TOOL)
    except Exception as e:  # noqa: BLE001 — a crash is not a verdict: UNKNOWN with the error as the reason
        return VD.unknown(gate=VERDICT_GATE, criterion=VERDICT_CRITERION, evidence=evidence, tool=_TOOL, exc=e)
    return VD.make(gate=VERDICT_GATE, status="PASS", population=one, criterion=VERDICT_CRITERION,
                   result={"kind": None, "files": sorted(r["files"]), "consent": r["consent"],
                           "revision": r["header"]["revision"], "boxId": r["header"]["boxId"], "night": r["header"]["night"]},
                   evidence=evidence, reason=None, tool=_TOOL)


def verdict_sample() -> dict:
    """The object over the COMMITTED vector (`tests/vectors/tepna-seal-1/`, #2796): the test card key and
    the test box key's fingerprint from `expected.json`. No corpus, no box key — `--verdict-sample`."""
    here = os.path.dirname(os.path.abspath(__file__))
    vec = os.path.join(here, "tests", "vectors", "tepna-seal-1")
    with open(os.path.join(vec, "expected.json"), encoding="utf-8") as fh:
        exp = json.load(fh)
    return verdict(os.path.join(vec, exp["seal"]), card_key=bytes.fromhex(exp["cardKeyHex"]),
                   pinned_fingerprint=exp["boxKeyFingerprint"])


if __name__ == "__main__":  # `verdict_sample` is tested; this only prints it
    import sys
    if sys.argv[1:] == ["--verdict-sample"]:
        print(json.dumps(verdict_sample(), indent=1))
        sys.exit(0)
    sys.exit("unseal: a library — call unseal() / verdict(); --verdict-sample prints the committed vector's object")
