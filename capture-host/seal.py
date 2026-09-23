# tepna-capture — seal.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""SEAL A NIGHT — `tepna-seal/1` (CAPTURE-NIGHT-SEAL §2, §4; format frozen in docs/NIGHT-SEAL-FORMAT.md).

bag → zip → sign → encrypt → write atomically. The night's files go in UNCHANGED under `data/` (§∅: the
recording is evidence; the seal is an envelope, never a rewrite). What is produced:

    magic ‖ u8 version ‖ u32 header-len ‖ header JSON ‖ u16 sig-len ‖ ECDSA(header ‖ SHA-256(payload))
    ‖ u64 payload-len ‖ nonce(12) ‖ AES-256-GCM(zip(bag), AAD = header)

The data key is random per seal and wrapped for each recipient — v1 ships the card recipient only:
KEK = HKDF-SHA-256(cardKey, salt = boxId‖keyId), wrapped = AES-KW(KEK, dataKey). `recipients[]` is an
envelope, so a clinic key slots in later without a format break (§9).

⚠️ DETERMINISM IS A TEST PROPERTY, NOT A PRODUCTION ONE. Production nonces and data keys come from
`os.urandom`. The committed test vectors are sealed with `deterministic_from=<the TEST card key>`, which
derives both from that key so a re-seal is byte-identical (§6) — and the zip is written with a fixed
epoch, sorted entries and no extra fields for the same reason. Never pass `deterministic_from` on a box.

Phase A builds and tests this module; wiring it to night close is phase B (Wren, deploy owner-authorized).
Until then it is imported by its tests and by nothing else, and `find_unwired` says so.
"""

from __future__ import annotations

import base64
import hashlib
import io
import os
import struct
import zipfile
from datetime import datetime
from typing import Callable

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import Prehashed, decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.keywrap import aes_key_wrap

import sealfmt as F

__all__ = ["seal_night", "build_bag", "bag_zip_bytes", "generate_signing_key", "public_raw", "SealError"]


class SealError(Exception):
    """A night that cannot be sealed as asked. Loud on purpose: a seal that silently omitted a file would
    read as complete to every reader."""


def generate_signing_key() -> ec.EllipticCurvePrivateKey:
    """The per-box P-256 key (§2). Generated once at first boot in phase B; here for tests and tools."""
    return ec.generate_private_key(ec.SECP256R1())


def public_raw(key: ec.EllipticCurvePrivateKey | ec.EllipticCurvePublicKey) -> bytes:
    """The raw uncompressed point (65 bytes) — what WebCrypto's `exportKey("raw")` yields, and the input
    to `sealfmt.fingerprint`."""
    pub = key.public_key() if isinstance(key, ec.EllipticCurvePrivateKey) else key
    return pub.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)


def _sha256_hex(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def _night_files(night_dir: str) -> list[tuple[str, str]]:
    """`(relative posix path, absolute path)` for every regular file under `night_dir`, sorted. Sorted so
    the manifest, the zip and the Oxum are the same on every filesystem."""
    out = []
    for root, _dirs, names in os.walk(night_dir):
        for n in names:
            p = os.path.join(root, n)
            if os.path.isfile(p) and not os.path.islink(p):
                out.append((os.path.relpath(p, night_dir).replace(os.sep, "/"), p))
    out.sort()
    return out


def _bag_info_bytes(*, box_id: str, night: str, consent: str | None, revision: int,
                    bagging_date: str, total: int, n_files: int,
                    extra_info: dict[str, str] | None) -> bytes:
    """`bag-info.txt`, which depends only on SIZES — never on the payload bytes.

    Split out so the streaming sealer can write it first (it sorts before `data/`) without having
    read a single sample. `Payload-Oxum` is the one field that ties it to the data, and it is
    `bytes.files`: the streaming path verifies every file against the size it counted here and
    REFUSES if one moved, rather than shipping an Oxum that describes a night it did not write."""
    consent_str = "null" if consent is None else consent
    if consent_str not in ("yes", "no", "null"):
        raise SealError("consent must be 'yes', 'no' or None (not asked); got %r" % (consent,))
    info = {
        "BagIt-Profile-Identifier": F.FORMAT,
        "Bagging-Date": bagging_date,
        "Payload-Oxum": "%d.%d" % (total, n_files),
        "Source-Organization": "Tepna box %s" % box_id,
        "Tepna-Box-Id": box_id,
        "Tepna-Night": night,
        "Tepna-Research-Consent": consent_str,
        "Tepna-Seal-Revision": str(int(revision)),
    }
    info.update(extra_info or {})
    return "".join("%s: %s\n" % kv for kv in sorted(info.items())).encode("utf-8")


def _tagmanifest_bytes(bagit: bytes, bag_info: bytes, manifest: bytes) -> bytes:
    pairs = (("bagit.txt", bagit), ("bag-info.txt", bag_info), ("manifest-sha256.txt", manifest))
    return ("\n".join("%s  %s" % (_sha256_hex(b), n) for n, b in pairs) + "\n").encode("utf-8")


def build_bag(night_dir: str, *, box_id: str, night: str, consent: str | None, revision: int,
              bagging_date: str, extra_info: dict[str, str] | None = None) -> dict[str, bytes]:
    """A BagIt 1.0 bag (RFC 8493) as `{path: bytes}` — `data/<file>` exactly as the box wrote it plus the
    four tag files. `Payload-Oxum` is `bytes.files`; `Tepna-Research-Consent` is written as the literal
    `null` when not asked (§∅ applies to consent); `Tepna-Seal-Revision` is the re-issue counter (§4)."""
    files = _night_files(night_dir)
    if not files:
        raise SealError("night directory holds no files: %s" % night_dir)
    bag: dict[str, bytes] = {}
    manifest_lines, total = [], 0
    for rel, abs_ in files:
        data = open(abs_, "rb").read()
        bag["data/" + rel] = data
        manifest_lines.append("%s  data/%s" % (_sha256_hex(data), rel))
        total += len(data)
    bag["bagit.txt"] = F.BAGIT_TXT.encode("utf-8")
    bag["bag-info.txt"] = _bag_info_bytes(box_id=box_id, night=night, consent=consent, revision=revision,
                                          bagging_date=bagging_date, total=total, n_files=len(files),
                                          extra_info=extra_info)
    bag["manifest-sha256.txt"] = ("\n".join(manifest_lines) + "\n").encode("utf-8")
    bag["tagmanifest-sha256.txt"] = _tagmanifest_bytes(bag["bagit.txt"], bag["bag-info.txt"],
                                                       bag["manifest-sha256.txt"])
    return bag


def bag_zip_bytes(bag: dict[str, bytes]) -> bytes:
    """A DETERMINISTIC zip: entries in sorted order, every `date_time` the 1980 epoch, deflate level 6,
    no extra fields — so the same bag zips to the same bytes on every run (§6's byte-identical re-seal).
    Deflate is what browsers' `DecompressionStream("deflate-raw")` reads back (§5)."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for name in sorted(bag):
            zi = zipfile.ZipInfo(name, date_time=F.ZIP_EPOCH)
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            z.writestr(zi, bag[name])
    return buf.getvalue()


_ZIP_CHUNK = 1 << 22        # 4 MiB — only the hash pass reads in chunks; `writestr` needs the entry whole


def zip_night_bytes(night_dir: str, *, box_id: str, night: str, consent: str | None, revision: int,
                    bagging_date: str, extra_info: dict[str, str] | None = None) -> tuple[bytes, int, int]:
    """`(zip bytes, file count, payload bytes)` — `bag_zip_bytes(build_bag(...))` WITHOUT ever holding
    the night, byte for byte the same zip. The two counts come back with it so the header's `files`
    and `bytes` are the same numbers the Oxum was written from, rather than a second stat pass that
    could disagree with it.

    The bag is a dict of every file's bytes, so building it costs the night: measured on vigil
    2026-09-22, sealing the 2067 MB night of 2026-09-12 peaked at **3475 MB** (1.68x the night), of
    which the bag was 2067 MB and the three copies of the 514 MB zip were the rest. The daemon runs
    the seal in a child (`sealbox.seal_in_subprocess`), so that peak is CONTAINED rather than
    unbounded — but it is still a ceiling on what the box can seal, and it is the night's size that
    sets it.

    Nothing here changes the FORMAT. The entries are written in the same sorted order, by the same
    `writestr` calls, with the same `ZipInfo` fields — only the source of each entry's bytes changes,
    from a dict that was filled in advance to one file read at the moment it is compressed. A test
    asserts the two produce identical bytes on the same night, which is the whole licence for it.

    ⚠️ `bag-info.txt` sorts BEFORE `data/`, and its `Payload-Oxum` counts bytes. So the sizes are read
    by `stat` first and every file is verified against the size it was counted at while it is
    streamed; a file that GREW or SHRANK under the sealer (a night still being written) raises rather
    than being sealed under an Oxum that describes something else. `build_bag` cannot see that case at
    all — it reads each file once and reports what it read, which is self-consistent and silent.
    """
    files = _night_files(night_dir)
    if not files:
        raise SealError("night directory holds no files: %s" % night_dir)
    sizes = [os.path.getsize(abs_) for _rel, abs_ in files]
    bagit = F.BAGIT_TXT.encode("utf-8")
    bag_info = _bag_info_bytes(box_id=box_id, night=night, consent=consent, revision=revision,
                               bagging_date=bagging_date, total=sum(sizes), n_files=len(files),
                               extra_info=extra_info)
    manifest_lines: list[str] = []
    buf = io.BytesIO()

    def _entry(z, name: str, data: bytes) -> None:
        zi = zipfile.ZipInfo(name, date_time=F.ZIP_EPOCH)
        zi.compress_type = zipfile.ZIP_DEFLATED
        zi.external_attr = 0o644 << 16
        z.writestr(zi, data)

    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        # sorted() over the WHOLE name set, exactly as bag_zip_bytes does — 'bag-info.txt' <
        # 'bagit.txt' < 'data/…' < 'manifest-sha256.txt' < 'tagmanifest-sha256.txt', so every entry
        # that depends on the payload hashes already sorts after it.
        _entry(z, "bag-info.txt", bag_info)
        _entry(z, "bagit.txt", bagit)
        for (rel, abs_), size in zip(files, sizes):
            data = open(abs_, "rb").read()
            if len(data) != size:
                raise SealError("%s changed size under the sealer (%d then %d bytes) — refusing to "
                                "seal it under an Oxum that counts the other one" % (rel, size, len(data)))
            manifest_lines.append("%s  data/%s" % (_sha256_hex(data), rel))
            _entry(z, "data/" + rel, data)
            del data                     # one file at a time is the whole point
        manifest = ("\n".join(manifest_lines) + "\n").encode("utf-8")
        _entry(z, "manifest-sha256.txt", manifest)
        _entry(z, "tagmanifest-sha256.txt", _tagmanifest_bytes(bagit, bag_info, manifest))
    return buf.getvalue(), len(files), sum(sizes)


def _derive_test_material(test_card_key: bytes) -> tuple[bytes, bytes]:
    """(nonce, data key) for TEST vectors only — from the test card key, so a re-seal is byte-identical."""
    return (F.hkdf_sha256(test_card_key, b"", F.TEST_NONCE_INFO, F.GCM_NONCE_BYTES),
            F.hkdf_sha256(test_card_key, b"", F.TEST_DATAKEY_INFO, F.DATA_KEY_BYTES))


def seal_night(night_dir: str, out_path: str, *, box_id: str, night: str, card_key: bytes, key_id: int,
               signing_key: ec.EllipticCurvePrivateKey, consent: str | None, revision: int = 1,
               closed_at_ms: int, now: datetime, anchor: dict | None = None,
               extra_info: dict[str, str] | None = None, deterministic_from: bytes | None = None,
               rng: Callable[[int], bytes] = os.urandom,
               mutate_bag: Callable[[dict[str, bytes]], dict[str, bytes]] | None = None,
               mutate_header: Callable[[dict], dict] | None = None) -> dict:
    """Seal `night_dir` into `out_path` (atomic: temp + rename). Returns the clear header as written.

    `mutate_bag` and `mutate_header` exist for the PLANTS (§6): hooks between construction and
    signing so a test can seal a bag whose data contradicts its manifest, whose Oxum lies, or a header
    with `consent` absent — the shapes a reader must refuse or read by name. Production never passes
    either; the header hook runs BEFORE signing, so what it produces is what the box would have
    signed, which is the point of the plant."""
    if len(card_key) != F.CARD_KEY_BYTES:
        raise SealError("card key must be %d bytes" % F.CARD_KEY_BYTES)
    bagging_date = now.strftime("%Y-%m-%d")
    if mutate_bag is None:
        # THE PRODUCTION PATH NEVER MATERIALISES THE NIGHT. Same zip bytes (asserted by
        # `test_zip_night_bytes_is_the_same_zip_as_the_bag`), one file in memory at a time.
        # Spelled out rather than passed as a `**kw` dict: mypy infers a joined value type for the
        # dict and then rejects every keyword against it, which is eight new errors for a shortcut.
        plain, n_files, n_bytes = zip_night_bytes(
            night_dir, box_id=box_id, night=night, consent=consent, revision=revision,
            bagging_date=bagging_date, extra_info=extra_info)
    else:
        # A PLANT rewrites the bag before it is zipped (§6) — a bag whose data contradicts its
        # manifest cannot be expressed by streaming from disk, because the disk IS the manifest's
        # subject. So the plant path keeps the old reader, deliberately and only here.
        bag = mutate_bag(build_bag(
            night_dir, box_id=box_id, night=night, consent=consent, revision=revision,
            bagging_date=bagging_date, extra_info=extra_info))
        n_files = sum(1 for k in bag if k.startswith("data/"))
        n_bytes = sum(len(v) for k, v in bag.items() if k.startswith("data/"))
        plain = bag_zip_bytes(bag)
        del bag

    if deterministic_from is not None:
        nonce, data_key = _derive_test_material(deterministic_from)
    else:
        nonce, data_key = rng(F.GCM_NONCE_BYTES), rng(F.DATA_KEY_BYTES)
    kek = F.hkdf_sha256(card_key, F.kek_salt(box_id, key_id), F.KEK_INFO, F.KEK_BYTES)
    wrapped = aes_key_wrap(kek, data_key)

    raw_pub = public_raw(signing_key)
    header = {
        "format": F.FORMAT, "boxId": box_id, "night": night, "closedAt": int(closed_at_ms),
        "files": n_files, "bytes": n_bytes, "keyId": int(key_id),
        "boxKey": base64.b64encode(raw_pub).decode("ascii"),
        "boxKeyFingerprint": F.fingerprint(raw_pub),
        "recipients": [{"kind": "card", "keyId": int(key_id), "wrap": "AES-KW",
                        "wrapped": base64.b64encode(wrapped).decode("ascii")}],
        "consent": consent, "revision": int(revision), "anchor": anchor,
    }
    if mutate_header is not None:
        header = mutate_header(header)
    header_bytes = F.canonical_header_bytes(header)
    # THE PAYLOAD IS NEVER CONCATENATED, and neither is the blob below. `nonce + ciphertext` and
    # `… + payload` each cost another full copy of the sealed night — 3 x 514 MB on the 2026-09-12
    # night measured above — for bytes that are about to be written out in order anyway. The file
    # gets the same bytes in the same order; only the intermediate copies are gone.
    ciphertext = AESGCM(data_key).encrypt(nonce, plain, header_bytes)
    del plain
    _ph = hashlib.sha256()
    _ph.update(nonce)
    _ph.update(ciphertext)
    digest = hashlib.sha256(header_bytes + _ph.digest()).digest()
    # The signature covers header ‖ SHA-256(payload); the digest is computed HERE so the Node twin can
    # compute the same bytes with `subtle.digest` and verify with `subtle.verify` (which hashes its
    # input once more — hence Prehashed on this side: sign the digest of that concatenation, not the
    # concatenation of digests).
    # RFC 6979 deterministic ECDSA: the signature depends only on key and message, never on an RNG.
    # Safer on a box (a weak RNG cannot leak the key through k) and what makes a test re-seal
    # byte-identical. WebCrypto verifies it exactly like a randomised one.
    der = signing_key.sign(digest, ec.ECDSA(Prehashed(hashes.SHA256()), deterministic_signing=True))
    r, s = decode_dss_signature(der)
    sig = r.to_bytes(32, "big") + s.to_bytes(32, "big")

    tmp = out_path + ".part"
    with open(tmp, "wb") as fh:
        fh.write(F.MAGIC + bytes([F.VERSION]) + struct.pack(">I", len(header_bytes)) + header_bytes
                 + struct.pack(">H", len(sig)) + sig + struct.pack(">Q", len(nonce) + len(ciphertext)))
        fh.write(nonce)
        fh.write(ciphertext)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, out_path)          # atomic on POSIX: a sync client never sees a half-written seal
    return header

