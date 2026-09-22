# tepna-capture — sealbox.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""THE BOX SIDE OF THE NIGHT SEAL — CAPTURE-NIGHT-SEAL phase B, decisions §13.

`seal.py` seals a directory when handed every input; this module is where those inputs LIVE on the box
and when a night gets sealed:

  · the per-box P-256 signing key — `<keys>/seal-signing.pem`, 0600, generated once by the daemon the
    first time a seal is needed, never written anywhere else (§13 (1));
  · the card key store — `<keys>/seal-card.json`, 0600: the CURRENT `keyId` and every key ever issued,
    because a lost card is re-displayed from the plaintext the box holds and an old night is re-issued
    under the key it was sealed with (§13 (2));
  · the card — `<outbox>/<boxId>-card-k<keyId>.html`, self-contained, printed by the browser; the QR
    only when `segno` is importable, and the card SAYS when it is not (§13 (2));
  · `extra_info` for bag-info — version, commit, device inventory (names and ids, never addresses),
    consent (null until asked), revision (§13 (3));
  · `seal_or_reissue()` — the decision per settled night: no seal ⇒ revision 1; a seal whose header's
    files/bytes no longer match the directory (a post-close writer) ⇒ revision+1 written to a temp
    name, VERIFIED with `unseal.unseal`, then swapped in; every outcome a `tepna.verdict/1` object
    (`gate: night-seal`) beside the seal.

Nothing here talks to a network, listens on a port, or touches a file under `captures/` — the
unsealed night stays as the evidence record; `outbox/` receives copies.
"""

from __future__ import annotations

import datetime as _dt
import hashlib
import html
import importlib
import json
import logging
import os
import socket
import time

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

import seal as _seal
import sealfmt as F
import unseal as _unseal
import verdict as _verdict

log = logging.getLogger("tepna.sealbox")

SIGNING_NAME = "seal-signing.pem"
CARD_STORE_NAME = "seal-card.json"
TOOL = "capture-host/sealbox.py"
GATE = "night-seal"
CRITERION = {"name": "seal_verifies_after_write", "threshold": 0, "unit": "refusals", "direction": "eq"}


class SealBoxError(Exception):
    """A box-side precondition the seal cannot proceed without (key unreadable, store malformed)."""


# ── (1) the signing key ───────────────────────────────────────────────────────────────────────────────


def _write_private_0600(path: str, data: bytes) -> None:
    fd = os.open(path + ".tmp", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(path + ".tmp", path)
    finally:
        if os.path.exists(path + ".tmp"):
            os.unlink(path + ".tmp")


def load_or_create_signing_key(key_dir: str) -> tuple[ec.EllipticCurvePrivateKey, bool]:
    """(key, created). Generated ONCE when absent; an unreadable or malformed existing file raises —
    never silently replaced, because a new key breaks the fingerprint every reader has pinned."""
    path = os.path.join(key_dir, SIGNING_NAME)
    if os.path.exists(path):
        try:
            with open(path, "rb") as fh:
                key = serialization.load_pem_private_key(fh.read(), password=None)
        except (OSError, ValueError, TypeError) as e:
            raise SealBoxError(f"signing key {path} unreadable: {e!r} — regeneration is an operator action") from e
        if not isinstance(key, ec.EllipticCurvePrivateKey):
            raise SealBoxError(f"signing key {path} is not an EC key")
        return key, False
    os.makedirs(key_dir, mode=0o700, exist_ok=True)
    key = _seal.generate_signing_key()
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    _write_private_0600(path, pem)
    log.info("seal: generated the box signing key at %s (fingerprint %s)", path, F.fingerprint(_seal.public_raw(key)))
    return key, True


# ── (2) the card key store ────────────────────────────────────────────────────────────────────────────


def _utc_now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_or_create_card_store(key_dir: str, rng=os.urandom) -> tuple[dict, bool]:
    """(store, created). `{"keyId": N, "keys": {"1": hex, ...}, "createdAt", "rotatedAt": [...]}`."""
    path = os.path.join(key_dir, CARD_STORE_NAME)
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as fh:
                store = json.load(fh)
            kid = int(store["keyId"])
            key = bytes.fromhex(store["keys"][str(kid)])
        except (OSError, ValueError, KeyError, TypeError) as e:
            raise SealBoxError(f"card store {path} unreadable or malformed: {e!r}") from e
        if len(key) != F.CARD_KEY_BYTES:
            raise SealBoxError(f"card store {path}: key {kid} is not {F.CARD_KEY_BYTES} bytes")
        return store, False
    os.makedirs(key_dir, mode=0o700, exist_ok=True)
    store = {"keyId": 1, "keys": {"1": rng(F.CARD_KEY_BYTES).hex()}, "createdAt": _utc_now_iso(), "rotatedAt": []}
    _write_private_0600(path, json.dumps(store, indent=1).encode("utf-8"))
    log.info("seal: generated card key 1 at %s", path)
    return store, True


def current_card_key(store: dict) -> tuple[int, bytes]:
    kid = int(store["keyId"])
    return kid, bytes.fromhex(store["keys"][str(kid)])


def card_key_for(store: dict, key_id: int) -> bytes | None:
    """The key a given night was sealed with — kept so a re-issue stays under the night's own keyId."""
    hexkey = (store.get("keys") or {}).get(str(int(key_id)))
    return bytes.fromhex(hexkey) if isinstance(hexkey, str) else None


def rotate_card(key_dir: str, store: dict, rng=os.urandom) -> dict:
    """STOLEN card: mint keyId+1. Old keys stay (old nights stay readable and re-issuable under them)."""
    kid = int(store["keyId"]) + 1
    store = {
        **store,
        "keyId": kid,
        "keys": {**store["keys"], str(kid): rng(F.CARD_KEY_BYTES).hex()},
        "rotatedAt": list(store.get("rotatedAt") or []) + [_utc_now_iso()],
    }
    path = os.path.join(key_dir, CARD_STORE_NAME)
    if os.path.exists(path):
        os.unlink(path)
    _write_private_0600(path, json.dumps(store, indent=1).encode("utf-8"))
    log.warning("seal: card ROTATED to keyId %d — nights sealed from now on need the new card", kid)
    return store


# ── the card ──────────────────────────────────────────────────────────────────────────────────────────


def _load_segno(import_module=importlib.import_module):
    """The QR encoder, or None when it is not installed — a dependency the owner adds to the box (§13 (2))."""
    try:
        return import_module("segno")
    except ImportError:
        return None


def qr_svg(text: str, encoder=None) -> str | None:
    """The QR as inline SVG when `segno` is importable (or an `encoder` with segno's `make` is handed
    in); None — and the card says so — when it is not."""
    segno = encoder if encoder is not None else _load_segno()
    if segno is None:
        return None
    import io

    buf = io.BytesIO()
    segno.make(text, error="m").save(buf, kind="svg", scale=6, border=2, xmldecl=False, svgns=True)
    return buf.getvalue().decode("utf-8")


def render_card_html(*, box_id: str, key_id: int, card_key: bytes, fingerprint: str, qr: str | None) -> str:
    """One self-contained page: no script, no external fetch, prints on one sheet. The code is what the
    Dex asks for; the fingerprint is what pins the box; the QR is a convenience for the same code."""
    code = F.card_code_encode(card_key)
    e = html.escape
    qr_block = (
        qr
        if qr
        else '<p class="noqr">No QR on this card: the box has no QR encoder installed '
        "(<code>segno</code>). Type the code — it works in every browser.</p>"
    )
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Tepna card · box {e(box_id)} · key {key_id}</title>
<style>
body{{font:16px/1.4 system-ui,sans-serif;margin:2rem;color:#111;background:#fff}}
.card{{max-width:640px;border:2px solid #111;border-radius:12px;padding:1.5rem}}
h1{{font-size:1.25rem;margin:0 0 .25rem}} .sub{{color:#555;margin:0 0 1rem}}
.code{{font:700 2rem/1.2 ui-monospace,monospace;letter-spacing:.08em;margin:1rem 0;word-break:break-all}}
.fp{{font:13px ui-monospace,monospace;color:#333;word-break:break-all}}
.noqr{{color:#a00;font-size:14px}} svg{{display:block;margin:1rem 0;max-width:260px;height:auto}}
p{{margin:.5rem 0}} @media print{{body{{margin:0}} .card{{border-width:1px}}}}
</style></head><body><div class="card">
<h1>Tepna night card</h1>
<p class="sub">Box <b>{e(box_id)}</b> · card key <b>{key_id}</b></p>
<p>Type this code the first time you open a night from this box. Keep this card with your other health papers; a photo of it is a valid card.</p>
<div class="code">{e(code)}</div>
{qr_block}
<p class="fp">Box signature fingerprint<br>{e(fingerprint)}</p>
<p>Lost this card? The box can show it again. Think it was copied? The box can issue key {key_id + 1}; nights sealed under key {key_id} stay readable with this card.</p>
</div></body></html>
"""


def write_card(outbox: str, *, box_id: str, store: dict, signing_key: ec.EllipticCurvePrivateKey) -> str:
    kid, key = current_card_key(store)
    fp = F.fingerprint(_seal.public_raw(signing_key))
    page = render_card_html(box_id=box_id, key_id=kid, card_key=key, fingerprint=fp, qr=qr_svg(F.card_code_encode(key)))
    os.makedirs(outbox, exist_ok=True)
    path = os.path.join(outbox, f"{box_id}-card-k{kid}.html")
    tmp = path + ".part"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(page)
    os.replace(tmp, path)
    return path


# ── (3) extra_info ───────────────────────────────────────────────────────────────────────────────────


def extra_info(cfg: dict, *, version: str | None, commit: str | None, revision: int) -> dict[str, str]:
    """bag-info fields, each read from where it lives; `null` when it does not (§∅)."""
    devs = []
    for d in cfg.get("devices") or []:
        if isinstance(d, dict):
            ident = " ".join(str(d.get(k)) for k in ("vendor", "model", "device_id") if d.get(k))
            if ident:
                devs.append(ident)
    consent = (cfg.get("seal") or {}).get("research_consent")
    return {
        "Tepna-Capture-Host-Version": version if version else "null",
        "Tepna-Capture-Host-Commit": commit if commit else "null",
        "Tepna-Device-Inventory": "; ".join(devs) if devs else "null",
        "Tepna-Research-Consent": "null"
        if consent is None
        else ("yes" if consent is True or consent == "yes" else "no"),
        "Tepna-Seal-Revision": str(int(revision)),
    }


def consent_value(cfg: dict) -> str | None:
    """`seal.research_consent` as the header/bag value: 'yes' | 'no' | None (not asked — never a default)."""
    c = (cfg.get("seal") or {}).get("research_consent")
    if c is None:
        return None
    return "yes" if c is True or c == "yes" else "no"


def box_id_of(cfg: dict) -> str:
    bid = (cfg.get("seal") or {}).get("box_id")
    return str(bid) if bid else socket.gethostname()


# ── the decision per night ────────────────────────────────────────────────────────────────────────────


def night_signature(night_dir: str) -> tuple[int, int]:
    """(files, bytes) the way `seal_night` counts them — what the header records — so a post-close writer
    is detected by comparing this with the sealed header, no hashing of hundreds of MB per tick."""
    files = _seal._night_files(night_dir)
    return len(files), sum(os.path.getsize(p) for _, p in files)


def existing_header(seal_path: str) -> dict | None:
    if not os.path.exists(seal_path):
        return None
    try:
        return _unseal.read_header(seal_path)
    except Exception:  # noqa: BLE001 — an unreadable seal is treated as absent for the decision; the verdict names it
        return None


def closed_at_ms(night_dir: str) -> int:
    """The night's close as floating wall-clock ms (Clock Contract): the newest file's mtime, local civil
    time encoded as if UTC."""
    newest = max((os.path.getmtime(p) for _, p in _seal._night_files(night_dir)), default=time.time())
    local = _dt.datetime.fromtimestamp(newest)
    return int(local.replace(tzinfo=_dt.timezone.utc).timestamp() * 1000)


def seal_or_reissue(
    night_dir: str,
    *,
    outbox: str,
    box_id: str,
    night: str,
    store: dict,
    signing_key: ec.EllipticCurvePrivateKey,
    cfg: dict,
    version: str | None,
    commit: str | None,
    now: _dt.datetime | None = None,
) -> dict:
    """Seal a settled night, or re-issue it when the directory moved since the last seal. Returns the
    `tepna.verdict/1` object (also written beside the seal as `<seal>.verdict.json`):

      PASS            written (revision N) and verified end to end with the reader
      NOT_APPLICABLE  the existing seal still matches the directory — nothing to do (the common case)
      FAIL            the freshly written seal did NOT verify — the temp file is removed, the previous
                      seal (if any) is kept, and the reason is the reader's refusal kind
      NOT_RUN         a precondition is missing (the night has no files; the night's keyId is not in
                      the store)
      UNKNOWN         the sealer raised
    """
    final = os.path.join(outbox, f"{box_id}-{night}.tepna")
    vpath = final + ".verdict.json"
    evidence = [TOOL, "capture-host/seal.py", "capture-host/unseal.py", final]
    n_files, n_bytes = night_signature(night_dir)
    header = existing_header(final)
    fp = F.fingerprint(_seal.public_raw(signing_key))

    def _emit(status, result, reason, checked=1):
        obj = _verdict.make(
            gate=GATE,
            status=status,
            population={"checked": checked, "eligible": 1, "excluded": 1 - checked},
            criterion=CRITERION,
            result=result,
            evidence=evidence,
            reason=reason,
            tool=TOOL,
            commit=commit,
        )
        try:
            _verdict.write(vpath, obj)
        except OSError:
            log.warning("seal: could not write %s", vpath, exc_info=True)
        return obj

    if n_files == 0:
        return _emit("NOT_RUN", None, f"{night_dir} holds no files — nothing to seal", checked=0)
    if header is not None and int(header.get("files", -1)) == n_files and int(header.get("bytes", -1)) == n_bytes:
        return _emit(
            "NOT_APPLICABLE",
            None,
            f"seal revision {header.get('revision')} still matches the directory ({n_files} files, {n_bytes} bytes)",
        )
    revision = 1 if header is None else int(header.get("revision", 0)) + 1
    if header is None:
        key_id, card_key = current_card_key(store)
    else:
        key_id = int(header.get("keyId", 0))
        ck = card_key_for(store, key_id)
        if ck is None:
            return _emit(
                "NOT_RUN",
                None,
                f"the existing seal is under card keyId {key_id}, which the store no longer holds",
                checked=0,
            )
        card_key = ck
    target = final if header is None else final + ".rev.part"
    try:
        os.makedirs(outbox, exist_ok=True)
        _seal.seal_night(
            night_dir,
            target,
            box_id=box_id,
            night=night,
            card_key=card_key,
            key_id=key_id,
            signing_key=signing_key,
            consent=consent_value(cfg),
            revision=revision,
            closed_at_ms=closed_at_ms(night_dir),
            now=now or _dt.datetime.now(),
            extra_info=extra_info(cfg, version=version, commit=commit, revision=revision),
        )
        check = _unseal.verdict(target, card_key=card_key, pinned_fingerprint=fp, known_revision=revision)
    except Exception as exc:  # noqa: BLE001 — a crash is not a verdict
        if target != final and os.path.exists(target):
            os.unlink(target)
        return _verdict.unknown(gate=GATE, criterion=CRITERION, evidence=evidence, tool=TOOL, exc=exc)
    result = {
        "revision": revision,
        "keyId": key_id,
        "files": n_files,
        "bytes": n_bytes,
        "fingerprint": fp,
        "reader": check.get("status"),
        "sha256": _sha256_file(target),
    }
    if check.get("status") != "PASS":
        if target != final:
            os.unlink(target)
        else:
            os.unlink(final)  # a first seal that does not verify must not sit in the outbox
        return _emit("FAIL", result, f"the written seal did not verify: {check.get('reason')}")
    if target != final:
        os.replace(target, final)  # the previous revision is replaced only by a verified successor
    log.info(
        "seal: %s revision %d written (%d files, %d bytes, keyId %d) — verified",
        night,
        revision,
        n_files,
        n_bytes,
        key_id,
    )
    return _emit("PASS", result, None)


def _sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()
