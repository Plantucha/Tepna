# tepna-capture — nightqc.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# PER-NIGHT QC SUMMARY. "Did last night actually capture?" used to mean opening files by hand. This walks
# a night directory and answers it at a glance: per configured (device, stream), how many rows landed, and
# which expected streams produced NOTHING — the header-only files a rejected PMD START or a never-worn
# sensor leaves behind. Surfaced in status.json (`qc`) and written as <night>/QC-SUMMARY.json.
#
# Pure + cheap: it reads filenames and counts newlines, no vendor-format parsing. Capture files are the
# writers.capture_filename() layout — `<vendor>_<model>_<deviceid>_<YYYYMMDDHHMMSS>_<STREAM>.<ext>` — and
# every writer emits exactly one header line, so rows = newlines − 1.
from __future__ import annotations

import os

# Sidecars the box writes that are NOT a device capture stream — excluded from the per-device rollup so a
# LINK/CLOCK/QC file never masquerades as sensor data.
_SIDECAR_TAGS = {"LINK", "CLOCK", "OXYFRAME"}
_SUMMARY_NAME = "QC-SUMMARY.json"


def parse_capture_name(fname: str) -> tuple[str, str] | None:
    """(STREAM_TAG, ext) from a capture filename, or None if it is not one. The stream is the last
    `_`-delimited token before the extension (device_id/model may not contain `_`, which holds for every
    real config), so this is robust to the vendor/model prefix."""
    base, dot, ext = fname.rpartition(".")
    if not dot or "_" not in base:
        return None
    tag = base.rsplit("_", 1)[1]
    if not tag:
        return None
    return tag.upper(), ext


def count_rows(path: str) -> int:
    """Data rows in a capture file = newline count − 1 (the single header line). 0 for an empty or
    header-only file. Counts newlines in binary chunks so a multi-GB ECG file is cheap and never loaded
    whole into memory."""
    newlines = 0
    try:
        with open(path, "rb") as fh:
            while True:
                chunk = fh.read(1 << 20)
                if not chunk:
                    break
                newlines += chunk.count(b"\n")
    except OSError:
        return 0
    return max(0, newlines - 1)


def scan_night(night_dir: str) -> list[dict]:
    """One record per capture file under `night_dir`: {file, stream, rows, bytes}. [] if the dir is
    absent. The QC summary itself and any sidecar are tagged but included, so callers can tell them apart."""
    try:
        names = os.listdir(night_dir)
    except OSError:
        return []
    out = []
    for n in sorted(names):
        if n == _SUMMARY_NAME:
            continue
        parsed = parse_capture_name(n)
        if not parsed:
            continue
        path = os.path.join(night_dir, n)
        if not os.path.isfile(path):
            continue
        tag, _ext = parsed
        out.append({"file": n, "stream": tag, "rows": count_rows(path),
                    "bytes": os.path.getsize(path)})
    return out


def summarize(night_dir: str, devices: list[dict]) -> dict:
    """Roll a night's files up against the configured devices. For each device × declared stream, sum the
    rows of the files carrying that device_id and stream tag; a declared stream with zero rows is
    `missing`. `ok` is true only when every declared stream produced data."""
    scanned = scan_night(night_dir)
    per_device = []
    missing = []
    for d in devices:
        did = d.get("device_id")
        name = d.get("name") or did
        streams: dict[str, int] = {}
        for s in d.get("streams") or []:
            tag = s.upper()
            rows = sum(f["rows"] for f in scanned
                       if did and did in f["file"] and f["stream"] == tag)
            streams[s] = rows
            if rows == 0:
                missing.append(f"{name}:{s}")
        per_device.append({"name": name, "streams": streams})
    return {
        "night": os.path.basename(night_dir.rstrip("/")),
        "devices": per_device,
        "missing": missing,
        "files": len(scanned),
        "total_rows": sum(f["rows"] for f in scanned),
        "total_bytes": sum(f["bytes"] for f in scanned),
        "sidecars": sorted({f["stream"] for f in scanned if f["stream"] in _SIDECAR_TAGS}),
        "ok": not missing,
    }
