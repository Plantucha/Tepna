#!/usr/bin/env python3
# tepna-capture — polar_mirror.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# MIRROR THE DEVICE'S FILESYSTEM TO DISK ONCE, THEN ANALYSE LOCALLY FOREVER.
#
# Written after spending most of a day doing exploratory round trips over a BLE link that fails every
# few minutes — listing a directory, thinking, listing another, losing the session, starting again.
# That is the wrong shape. The link is the scarce, unreliable resource; the analysis is free. So take
# everything in one pass, and never pay for a question twice.
#
# ── TWO THINGS THAT COST A DAY, BOTH FIXED HERE ─────────────────────────────────────────────────────
#
# * `Trusted: no` BREAKS PS-FTP, and the error does not say so. `PolarPsFtp.__aenter__` fails at
#   `start_notify(MTU_CHAR)` with GATT `UNLIKELY_ERROR (0x0E)` — the same code an un-bonded read gives
#   (POLAR-OFFLINE-DOWNLOAD: "Bonding is mandatory"). But `bluetoothctl info` showed **Paired: yes,
#   Bonded: yes** and it still failed; the missing property was TRUST. One `bluetoothctl trust <addr>`
#   and every listing worked immediately. Bonded-but-untrusted is indistinguishable from unbonded at
#   the ATT layer, so this is checked and repaired before anything else is attempted.
# * THE CAPTURE DAEMON HOLDS THE SINGLE LINK. See `link_guard.require_free_link()`.
#
# ── WHAT IT DOES ────────────────────────────────────────────────────────────────────────────────────
#
# Walks from `/`, GETs every file, writes them under a local root mirroring the device paths, and emits
# a manifest with sizes and hashes. RESUMABLE: a file already present with the expected size is skipped,
# so a link that dies half way costs only the remainder. Per-file timeouts, because some paths hang
# rather than erroring and one of them must not consume the window.
#
# ⚠️ PRIVACY. `/U/0/USERID.BPB` contains the owner's REAL NAME and Polar account UUID — measured
# 2026-08-03. A mirror of this device is personal data. It is written to the gitignored capture root by
# default, `--redact` blanks the known PII files, and nothing here should ever be committed. The export
# pipeline scrubs serials with `dexScrubExport`; device files have no such pipeline, so the care has to
# be here.
#
#   python polar_mirror.py --address 24:AC:AC:0C:30:1E --out /srv/tepna/captures/device-mirror
#   python polar_mirror.py --address … --out … --redact          # blank the PII files

from __future__ import annotations

import argparse
import asyncio
import datetime as _dt
import hashlib
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from link_guard import require_free_link  # noqa: E402

import polar_psftp as psftp  # noqa: E402

# Files known to carry personal data or SECRETS. `--redact` writes a placeholder instead of the bytes.
#
# `/SYS/BT/<n>/BTDEV.BPB` is the BONDING TABLE — one directory per paired host, each carrying the peer's
# address and a 128-bit key (LTK/IRK). Measured 2026-08-03: slot 0 held another host's MAC and key, slot
# 1 held vigil's. So anything that can reach PS-FTP can read the pairing secrets for EVERY host the
# device is bonded to, not just its own. That is a stronger reason to redact than the name in USERID.
PII = {"/U/0/USERID.BPB"}
PII_PREFIXES = ("/SYS/BT/",)
# Paths observed to hang rather than error over BLE; still attempted, but they must not eat the window.
FILE_TIMEOUT = 45.0
LIST_TIMEOUT = 40.0


def ensure_trusted(address: str) -> str:
    """Bonded is not enough — PS-FTP needs TRUSTED, and says `UNLIKELY_ERROR` when it is missing."""
    try:
        info = subprocess.run(["bluetoothctl", "info", address], capture_output=True, text=True,
                              timeout=20).stdout
        if "Trusted: yes" in info:
            return "already trusted"
        subprocess.run(["bluetoothctl", "trust", address], capture_output=True, text=True, timeout=20)
        return "trust set (was untrusted — this is what makes PS-FTP return UNLIKELY_ERROR)"
    except Exception as exc:                                  # noqa: BLE001
        return f"could not check/set trust: {type(exc).__name__}"


async def walk(fs, path, out, depth=0, max_depth=6):
    if depth > max_depth:
        return
    try:
        entries, truncated = await asyncio.wait_for(fs.list_dir_ex(path), LIST_TIMEOUT)
    except Exception as exc:                                  # noqa: BLE001
        out["errors"][path] = f"list: {type(exc).__name__}: {exc}"
        return
    out["dirs"][path] = [{"name": n, "size": s} for n, s in entries]
    if truncated:
        # A MIRROR THAT SILENTLY OMITS FILES IS WORSE THAN NO MIRROR — the manifest is what later
        # analysis trusts to say what was on the device. A cut listing is therefore recorded as an
        # ERROR even though the pull of what DID arrive proceeds normally (psftp.TruncatedProtobuf).
        out["errors"][path] = (f"list: TRUNCATED — the reply was cut off after {len(entries)} "
                               "complete entries; anything below this path is MISSING from this "
                               "mirror. Re-run to pick it up.")
    for name, _size in entries:
        if name.endswith("/"):
            await walk(fs, path + name, out, depth + 1, max_depth)


async def fetch_all(fs, out, root, redact):
    files = [(p + e["name"], e["size"]) for p, es in out["dirs"].items()
             for e in es if not e["name"].endswith("/")]
    out["n_files_seen"] = len(files)
    for path, size in files:
        dest = os.path.join(root, path.lstrip("/"))
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        if os.path.exists(dest) and os.path.getsize(dest) == size and size:
            out["files"][path] = {"bytes": size, "status": "already local"}
            continue
        if redact and (path in PII or path.startswith(PII_PREFIXES)):
            with open(dest, "w") as fh:
                fh.write("REDACTED — personal data or bonding key material\n")
            out["files"][path] = {"bytes": size, "status": "REDACTED (personal data / bonding keys)"}
            continue
        try:
            raw = await asyncio.wait_for(fs.get(path, timeout=FILE_TIMEOUT), FILE_TIMEOUT + 10)
            with open(dest, "wb") as fh:
                fh.write(raw)
            out["files"][path] = {"bytes": len(raw), "declared": size,
                                  "sha256_12": hashlib.sha256(raw).hexdigest()[:12],
                                  "status": "pulled" if len(raw) == size else "pulled (size differs)"}
        except TimeoutError:
            out["files"][path] = {"declared": size, "status": "TIMEOUT — device never answered"}
        except Exception as exc:                              # noqa: BLE001
            out["files"][path] = {"declared": size, "status": f"{type(exc).__name__}: {exc}"}
        with open(os.path.join(root, "MANIFEST.json"), "w") as fh:
            json.dump(out, fh, indent=1, default=str)


async def mirror(address, out_root, redact) -> dict:
    out = {"address": address, "started": _dt.datetime.now().isoformat(),
           "trust": ensure_trusted(address), "dirs": {}, "files": {}, "errors": {}}
    os.makedirs(out_root, exist_ok=True)
    async with psftp.PolarPsFtp(address) as fs:
        await walk(fs, "/", out)
        await fetch_all(fs, out, out_root, redact)
    out["finished"] = _dt.datetime.now().isoformat()
    with open(os.path.join(out_root, "MANIFEST.json"), "w") as fh:
        json.dump(out, fh, indent=1, default=str)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Mirror a Polar device's PS-FTP filesystem to disk")
    ap.add_argument("--address", required=True)
    ap.add_argument("--out", required=True, help="local root (use a gitignored path — this is personal data)")
    ap.add_argument("--redact", action="store_true", help="blank files known to carry personal data")
    a = ap.parse_args(argv)
    require_free_link()
    res = asyncio.run(mirror(a.address, a.out, a.redact))
    pulled = sum(1 for v in res["files"].values() if str(v.get("status", "")).startswith("pulled"))
    print(json.dumps({"dirs": len(res["dirs"]), "files_seen": res.get("n_files_seen"),
                      "pulled": pulled, "trust": res["trust"],
                      "failed": {k: v["status"] for k, v in res["files"].items()
                                 if not str(v.get("status", "")).startswith(("pulled", "already", "REDACTED"))},
                      "manifest": os.path.join(a.out, "MANIFEST.json")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
