# tepna-capture — probe_polar_onboard.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Phase 0 of POLAR-ONBOARD-BACKUP-2026-08-01-BRIEF: measure what the H10 and the Verity Sense actually
# hold, before a nightly recording lifecycle is designed around a guess.
#
# ⚠️ READ-ONLY ON PURPOSE — IT DOES NOT START A RECORDING.
# The SDK documents the capability (Verity offline recording from firmware 2.1.0; H10 exercise
# recording with SampleType HR|RR) but this repo does not yet know the WIRE FORMAT of the start op, and
# `polar_psftp` refuses REQUEST_START_RECORDING (14) by allowlist — deliberately, in the same breath as
# PREPARE_FIRMWARE_UPDATE, because a wrong query id on a privileged path does something far worse than
# set a clock. Writing that op from a guess is exactly the plausible-but-wrong class the audit charter
# puts first. The brief resolves the format from the SDK sources; this probe gathers everything
# obtainable WITHOUT it, so the design starts from measurements.
#
# What it answers:
#   1. FIRMWARE — "offline recording is supported on this unit" stops being an assumption. The Verity
#      floor is 2.1.0; the Polar Flow app reports 3.0.16 for 0C301E3F, and a screenshot is not a probe.
#   2. CAPACITY — every recording already on flash with byte sizes. The device auto-STOPS active
#      recordings at its memory limit and never erases on its own, so headroom is a precondition. The
#      H10 additionally "supports only one recording at the time", making a stale session a blocker.
#   3. CLOCK OFFSET — device time vs host time. The offline file carries DEVICE time; correcting it
#      afterwards depends on knowing the offset at the start of a night.
#
# Live-channel availability is NOT probed: the daemon already negotiates HR + GYRO every night, so that
# question is answered by the corpus, and a probe that re-asks it would be theatre.
#
#   A Polar holds ONE BLE link — stop the capture daemon first:
#     sudo -n /usr/local/lib/tepna/tepna-restart.sh restart     (to put it back afterwards)
#     python probe_polar_onboard.py --address 24:AC:AC:0C:30:1E [--adapter hci0]
from __future__ import annotations

import argparse
import asyncio
import datetime as _dt
import json

# Verity Sense offline recording landed in firmware 2.1.0 (SDK: SdkOfflineRecordingExplained.md).
OFFLINE_MIN_FW = (2, 1, 0)
_FW_CHAR = "00002a26-0000-1000-8000-00805f9b34fb"      # Device Information Service · Firmware Revision


def parse_fw(text: str | None) -> tuple[int, ...] | None:
    """'3.0.16' -> (3, 0, 16). None when it is not a dotted numeric version.

    Pure, so the version gate is testable without hardware — which is the whole point of this file: a
    capability claim nobody measured is not evidence."""
    if not text:
        return None
    parts = text.strip().split(".")
    if not parts or not all(p.isdigit() for p in parts):
        return None
    return tuple(int(p) for p in parts)


def offline_supported(fw: tuple[int, ...] | None, minimum: tuple[int, ...] = OFFLINE_MIN_FW):
    """True / False / None-for-unknown.

    None is a legal answer and must NOT collapse to False: "the firmware could not be read" and "the
    firmware is too old" are different facts, and only one of them is a reason to abandon the design
    (CLAUDE.md §🔒.6 — a missing value is null, never a fabricated one)."""
    if not fw:
        return None
    return tuple(fw[:len(minimum)]) >= minimum


def summarize_fs(entries) -> dict:
    """Roll a flat [(path, size, is_dir)] enumeration into the capacity picture.

    `sessions` counts RECORDING directories (/U/0/<date>/<E|R>/<time>/), the unit both device limits are
    expressed against. System/bond/profile paths are reported separately rather than dropped: a total
    that quietly excludes things is how a capacity figure becomes a wrong number."""
    rec_bytes = sys_bytes = 0
    sessions: set[str] = set()
    for path, size, is_dir in entries:
        if is_dir:
            continue
        size = max(0, int(size or 0))
        if path.startswith("/U/"):
            rec_bytes += size
            head = path.rsplit("/", 1)[0]
            if head.count("/") >= 5:                   # /U/0/<date>/<kind>/<time>
                sessions.add(head)
        else:
            sys_bytes += size
    return {"sessions": sorted(sessions), "n_sessions": len(sessions),
            "recording_bytes": rec_bytes, "system_bytes": sys_bytes,
            "total_bytes": rec_bytes + sys_bytes}


def clock_offset_sec(device, host):
    """device − host in seconds, or None when either side is unknown — never 0.0, which would read as
    'perfectly in sync' when the truth is 'not measured'."""
    if device is None or host is None:
        return None
    return round((device - host).total_seconds(), 3)


def verdict(fw_ok, fs: dict) -> dict:
    """The blockers, as data rather than prose, so the brief can be filled in from a JSON dump."""
    stale = fs.get("n_sessions", 0) > 0
    return {
        "offline_recording_supported": fw_ok,
        "flash_is_clear": not stale,
        "blockers": ([] if fw_ok is not False else ["firmware below the 2.1.0 offline-recording floor"])
        + (["a session is already on flash: pull and REMOVE it before any nightly lifecycle — the H10 "
            "holds exactly one, and neither device erases on its own"] if stale else [])
        + ([] if fw_ok is not None else ["firmware could not be read — capability UNKNOWN, not absent"]),
    }


async def probe(address: str, adapter: str | None = None, *, _fs=None, _client=None) -> dict:
    """Gather the read-only picture. `_fs` / `_client` are injectable so the flow is testable without a
    radio — the same idiom nightarchive/diskguard use for their destructive calls."""
    if _fs is None or _client is None:                      # pragma: no cover — import-time wiring only,
        import polar_psftp                                  #   both are always injected by the tests and
        from bleak import BleakClient                       #   always absent in real use.
        # bleak wants bluez={"adapter": "hciN"} — the bare `adapter=` kwarg is a shim today and its
        # removal would be SWALLOWED, silently unpinning the radio on a three-adapter box
        # (tests/test_no_deprecated_apis.py pins this form; PolarPsFtp._kw builds the same shape).
        _fs = _fs or (lambda: polar_psftp.PolarPsFtp(address, adapter))
        _client = _client or (lambda: BleakClient(address, bluez={"adapter": adapter} if adapter else {}))

    out: dict = {"address": address, "hci": adapter}   # NOT "adapter": the bleak-kwarg guard
    #   (tests/test_no_deprecated_apis) is a TEXT rule, and a report key that reads like a kwarg is a
    #   false positive worth avoiding rather than a guard worth widening.
    async with _fs() as fs:
        dev_time = await fs.get_local_time()
        host = _dt.datetime.now()
        out["device_time"] = dev_time.isoformat() if dev_time else None
        out["host_time"] = host.isoformat()
        out["clock_offset_sec"] = clock_offset_sec(dev_time, host)
        out["filesystem"] = summarize_fs([e async for e in fs.walk("/")])

    async with _client() as cli:
        try:
            out["firmware"] = (await cli.read_gatt_char(_FW_CHAR)).decode("utf-8", "replace").strip()
        except Exception as e:
            out["firmware"] = None
            out["firmware_error"] = repr(e)

    fw = parse_fw(out["firmware"])
    out["firmware_parsed"] = list(fw) if fw else None
    out["offline_supported"] = offline_supported(fw)
    out["verdict"] = verdict(out["offline_supported"], out["filesystem"])
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Read-only recon before the Polar onboard-backup build")
    ap.add_argument("--address", required=True, help="BLE MAC of the bonded Polar device")
    ap.add_argument("--adapter", default=None, help="BlueZ adapter, e.g. hci0")
    a = ap.parse_args(argv)
    print(json.dumps(asyncio.run(probe(a.address, a.adapter)), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
