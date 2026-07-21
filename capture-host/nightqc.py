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

# NOMINAL sample rate (Hz) per (model, stream) — the honest denominator for a coverage figure. Mirrors the
# rates in webmon's _BPS_BY_MODEL (the second tuple element); duplicated rather than imported because
# nightqc is a pure, dependency-light reporter. A device config's own `rates` override wins over this (the
# Verity ACC is configured at 52 Hz, not its 200 Hz nominal), so this is only the fallback default.
_NOMINAL_HZ = {
    "H10":    {"ecg": 130, "acc": 200, "hr": 1},
    "Verity": {"ppg": 55, "acc": 52, "gyro": 52, "mag": 50, "ppi": 1},
    "O2Ring": {"spo2": 1, "ppg": 125.738},
}

# Below this fraction of the expected rows a stream that DID produce data is still "degraded" — the trickle
# that reads green under a bare zero/non-zero test (the Verity IMU delivering ~40% of nominal, a stream that
# died at hour one) but is not a healthy night. Coverage is an ESTIMATE (span from file mtimes), so the bar
# is deliberately generous — it flags a real hole, not normal jitter.
_DEGRADED_BELOW = 0.5
_MIN_SPAN_SEC = 300.0    # too little elapsed capture to judge a rate — report coverage as unknown, not low


def _model_of(dev: dict) -> str:
    blob = f"{dev.get('model', '')} {dev.get('name', '')}".lower()
    return "H10" if "h10" in blob else ("Verity" if ("verity" in blob or "sense" in blob) else "O2Ring")


def _expected_hz(dev: dict, stream: str):
    """The rate to judge coverage against: the device's CONFIGURED rate for this stream if set, else the
    model nominal, else None (unknown — no coverage claim for a stream we have no reference rate for)."""
    rate = (dev.get("rates") or {}).get(stream)
    if rate:
        return float(rate)
    return _NOMINAL_HZ.get(_model_of(dev), {}).get(stream)


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
        st = os.stat(path)
        out.append({"file": n, "stream": tag, "rows": count_rows(path),
                    "bytes": st.st_size, "mtime": st.st_mtime})
    return out


def summarize(night_dir: str, devices: list[dict]) -> dict:
    """Roll a night's files up against the configured devices. For each device × declared stream, sum the
    rows of the files carrying that device_id and stream tag; a declared stream with zero rows is
    `missing`. Beyond that bare presence test, estimate each stream's COVERAGE — delivered rows vs the
    rows its (configured or nominal) rate would produce over the night's span — so a stream that merely
    TRICKLES (the Verity IMU at ~40% of nominal, a stream that died at hour one) shows up `degraded`
    instead of hiding behind a green `ok`. Coverage is an estimate: the span comes from file mtimes
    (newest − oldest data file), so it is deliberately coarse and unknown until _MIN_SPAN_SEC has elapsed.
    `ok` is true only when every declared stream produced data AND none is degraded."""
    scanned = scan_night(night_dir)
    data = [f for f in scanned if f["stream"] not in _SIDECAR_TAGS]
    # Span of the capture, estimated from when files were last touched: the newest data file is being
    # written ~now, the oldest was opened at session start. None (→ coverage unknown) until there is a
    # meaningful, judge-able span.
    span = (max(f["mtime"] for f in data) - min(f["mtime"] for f in data)) if data else 0.0
    span = span if span >= _MIN_SPAN_SEC else None
    per_device = []
    missing = []
    degraded = []
    for d in devices:
        did = d.get("device_id")
        name = d.get("name") or did
        streams: dict[str, int] = {}
        coverage: dict[str, float] = {}
        for s in d.get("streams") or []:
            tag = s.upper()
            rows = sum(f["rows"] for f in scanned
                       if did and did in f["file"] and f["stream"] == tag)
            streams[s] = rows
            if rows == 0:
                missing.append(f"{name}:{s}")
                continue
            hz = _expected_hz(d, s)
            if hz and span:
                cov = round(rows / (hz * span), 2)
                coverage[s] = cov
                if cov < _DEGRADED_BELOW:
                    degraded.append(f"{name}:{s} {int(cov * 100)}%")
        per_device.append({"name": name, "streams": streams, "coverage": coverage})
    return {
        "night": os.path.basename(night_dir.rstrip("/")),
        "devices": per_device,
        "missing": missing,
        "degraded": degraded,
        "span_sec": round(span) if span else None,
        "files": len(scanned),
        "total_rows": sum(f["rows"] for f in scanned),
        "total_bytes": sum(f["bytes"] for f in scanned),
        "sidecars": sorted({f["stream"] for f in scanned if f["stream"] in _SIDECAR_TAGS}),
        "ok": not missing and not degraded,
    }
