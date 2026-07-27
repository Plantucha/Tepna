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
import re

import writers
from datetime import datetime, timedelta

# Sidecars the box writes that are NOT a device capture stream — excluded from the per-device rollup so a
# LINK/CLOCK/QC file never masquerades as sensor data.
_SIDECAR_TAGS = {"LINK", "CLOCK", "OXYFRAME"}
_SUMMARY_NAME = "QC-SUMMARY.json"

# A gap this long between two capture SESSIONS starts a new one, so coverage is judged against the CURRENT
# session's span, not the whole date folder. A date dir rolls by the session's START date (writers.night_dir),
# so a box that ran all day piles the daytime tests AND the evening's sleep session into one YYYY-MM-DD dir —
# and measuring a stream that is streaming perfectly RIGHT NOW against that ~19 h wall-clock span reads it as
# ~0 % (a false 'degraded', the very inversion of the false-confidence bug coverage exists to catch). One hour
# comfortably spans reconnect churn / a bathroom break (kept in one session) but splits a genuine new sitting.
_SESSION_GAP_SEC = 3600.0
_STAMP_RE = re.compile(r"_(\d{14})_")


def _session_of(fname: str, mtime: float) -> float:
    """The capture SESSION a file belongs to, as an epoch — the `_YYYYMMDDHHMMSS_` START stamp
    writers.capture_filename() embeds (the instant the connection opened). Falls back to the file's mtime
    when the name carries no such stamp, so a legacy/stampless file is simply its own one-file session."""
    m = _STAMP_RE.search(fname)
    if m:
        try:
            return datetime.strptime(m.group(1), "%Y%m%d%H%M%S").timestamp()
        except ValueError:
            pass                                       # a 14-digit run that is not a real datetime → mtime
    return mtime


def _folder_date(night_dir: str):
    """The datetime.date a YYYY-MM-DD night folder is named for, or None if the basename isn't a date."""
    try:
        return datetime.strptime(os.path.basename(night_dir.rstrip("/")), "%Y-%m-%d").date()
    except ValueError:
        return None


def _prev_day_dir(night_dir: str):
    """Sibling folder for the PREVIOUS calendar day (…/captures/<date-1>), or None if the basename isn't a
    date. The place the pre-midnight half of a cross-midnight session lives."""
    d = _folder_date(night_dir)
    if d is None:
        return None
    return os.path.join(os.path.dirname(night_dir.rstrip("/")), (d - timedelta(days=1)).isoformat())


def _hhmm(epoch: float) -> str:
    """`HH:MM` local civil, for a human-readable gap description. Clock Contract: the stamps these
    epochs come from were written as naive LOCAL time, so they are read back the same way."""
    return datetime.fromtimestamp(epoch).strftime("%H:%M")


def _midnight_of(night_dir: str):
    """Epoch of this folder's date at 00:00 local, or None. Used to decide whether the folder's earliest
    session began just after midnight (⇒ possibly the tail of the previous night's session)."""
    d = _folder_date(night_dir)
    return datetime(d.year, d.month, d.day).timestamp() if d else None

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


def file_span_sec(path: str) -> float | None:
    """Elapsed time THE FILE ITSELF records, from its own device-clock column. None when it cannot say.

    The honest per-file duration, and the reason it exists: `rows / fs` needs an `fs`, and the only one
    available at read time is the rate configured TODAY. Rates change — re-negotiated ranges, a corrected
    `rates:` entry — so an old night measured against today's number over-states its own duration, which
    is one of the three mechanisms that put `coverage_pct` at 196.7 % on the real 2026-07-16 H10 ACC
    (CAPTURE-HOST-DEEP-AUDIT §A4c). The device clock in the file is era-correct by construction: it was
    written by the device that recorded it.

    O(1) — header + first row + a tail read, never the whole file (an ECG night is ~500 MB). The last
    line may be a partial write on a still-open file, so parsing walks backwards to the newest line that
    actually parses instead of trusting the final one."""
    try:
        with open(path, "rb") as fh:
            header = fh.readline().decode("utf-8", "replace").rstrip("\r\n")
            cols = [c.strip().lower() for c in header.split(";")]
            try:
                idx = cols.index("sensor timestamp [ns]")
            except ValueError:
                return None          # HR/RR/PPI and the CSV layouts carry no device clock — say so
            first = _ns_at(fh.readline().decode("utf-8", "replace"), idx)
            if first is None:
                return None
            size = fh.seek(0, os.SEEK_END)
            fh.seek(max(0, size - (1 << 13)))
            tail = fh.read().decode("utf-8", "replace").split("\n")
    except OSError:
        return None
    for line in reversed(tail):
        last = _ns_at(line, idx)
        if last is not None and last >= first:
            return (last - first) / 1e9
    return None


def _ns_at(line: str, idx: int) -> int | None:
    parts = line.rstrip("\r\n").split(";")
    if len(parts) <= idx:
        return None
    try:
        return int(parts[idx])
    except ValueError:
        return None


def merge_sessions(files: list[dict], gap_sec: float = _SESSION_GAP_SEC) -> list[list]:
    """[[start, end, [files]], …] — the night's capture sessions, by MERGED ACTIVE INTERVAL, oldest first.

    Each file was live from when its connection opened (its start stamp) until its last write (mtime), so
    a device that held ONE long connection streaming for hours is a single wide interval, not an isolated
    point. A file extends the running session when it opens within `gap_sec` of the coverage so far;
    clustering by start-STAMP alone wrongly split such a stream off (a 7-h H10 connection has one 19:46
    stamp, so a stamp-gap looked like silence though it streamed the whole time).

    Shared by `summarize` and `timeline.build` so the two cannot disagree about what "the session" is —
    they did: timeline derived its coverage denominator from the LINK sidecar's CALENDAR DAY and rendered
    a flawless zero-loss 4 h night as 16.7 % captured, while this module computed the honest 14 400 s span
    one import away (CAPTURE-HOST-DEEP-AUDIT §A4a)."""
    sessions: list[list] = []
    for st, en, f in sorted(((f["session"], max(f["session"], f["mtime"]), f) for f in files),
                            key=lambda iv: iv[0]):
        if sessions and st <= sessions[-1][1] + gap_sec:
            sessions[-1][1] = max(sessions[-1][1], en)
            sessions[-1][2].append(f)
        else:
            sessions.append([st, en, [f]])
    return sessions


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
                    "bytes": st.st_size, "mtime": st.st_mtime,
                    "session": _session_of(n, st.st_mtime),
                    # What the file says about its OWN duration; None when it carries no device clock.
                    # Callers must treat None as "unknown", never as zero — see file_span_sec.
                    "span_sec": file_span_sec(path)})
    return out


def summarize(night_dir: str, devices: list[dict]) -> dict:
    """Roll the CURRENT capture session up against the configured devices. The session is scoped by
    file-activity (see _SESSION_GAP_SEC) and unified across midnight (see below), NOT the whole date
    folder — so a box that also ran earlier the same day, or an overnight that crossed midnight, is judged
    on the actual session, not a 19 h folder span. For each device × declared stream, sum the session's
    rows; a stream with zero rows THIS session is `missing`. Each stream's COVERAGE is its delivered rows
    vs the rows its (configured or nominal) rate would produce over the session's span, so a stream that
    merely TRICKLES (the Verity IMU at ~40% of nominal, a stream that died at hour one) shows up `degraded`
    instead of hiding behind a green `ok`. Coverage is an estimate, unknown until _MIN_SPAN_SEC has
    elapsed. `files`/`total_*` describe the night FOLDER on disk.

    THE SESSION SCOPING IS REPORTED, NOT ASSUMED (§A2). `span_sec`, `coverage`, `missing` and
    `silent_sec` describe the CURRENT session only. Any earlier session on this night is listed in
    `sessions` with the hole between them in `prior_gap_sec` and a human-readable line in `gaps`.
    `ok` is true only when every declared stream produced data, none is degraded, AND no session was
    excluded — because `ok` is a claim about the night, and it cannot be made about a night half of
    which was left out of the judgement."""
    scanned = scan_night(night_dir)
    data = [f for f in scanned if f["stream"] not in _SIDECAR_TAGS]
    # CROSS-MIDNIGHT: an overnight begun before midnight is split into TWO date folders, because night_dir
    # rolls each connection into a folder by its START date. So the pre-midnight half of tonight's session
    # lives in yesterday's folder. If THIS folder's earliest session opened just after midnight, pool the
    # previous day's files so the session — and its coverage — is measured whole; without this, each folder
    # sees only its half and a device that streamed cleanly across midnight reads as badly degraded. Gated
    # on the near-midnight start so an ordinary mid-day session never pays to re-read a whole prior day.
    if data:
        earliest = min(f["session"] for f in data)
        midnight = _midnight_of(night_dir)
        if midnight is not None and 0 <= earliest - midnight < _SESSION_GAP_SEC:
            prev = _prev_day_dir(night_dir)
            if prev:
                data = [f for f in scan_night(prev) if f["stream"] not in _SIDECAR_TAGS] + data
    # Isolate the CURRENT capture session (merge_sessions holds the reasoning). The current session is
    # the merged interval reaching the newest write (~now); `span` is its elapsed time. None (coverage
    # unknown) until a judge-able span has accrued.
    current = data
    span = None
    sessions: list[list] = []
    prior_gap = None
    # SESSIONS THIS SCOPING DISCARDS, AND THE HOLE THAT MADE THEM (CAPTURE-HOST-DEEP-AUDIT §A2).
    # The scoping is deliberate — it stops a daytime sitting diluting tonight's coverage — but the
    # file-activity signature of "an earlier unrelated session" and "this same night, interrupted for
    # more than _SESSION_GAP_SEC" is IDENTICAL, and nothing here can tell them apart. So a box-wide
    # outage longer than the gap threshold made `summarize` discard the whole pre-outage half of the
    # night and grade the remainder `coverage: 1.0, ok: true` — with no field saying a word about it.
    # (Measured: the 2026-07-24 03:33->04:32 box-wide silence ran 58.6 min, 85 s under the threshold.
    # This has already come within a minute and a half of firing on the real box.)
    #
    # Since the two cases cannot be distinguished, they are not guessed between: everything is reported
    # and `ok` goes false, so a human looks. A benign daytime sitting shows up in `gaps` as exactly what
    # it is. Silently keeping the green was the defect.
    gaps: list[str] = []
    if data:
        sessions = merge_sessions(data)
        cur = max(sessions, key=lambda sess: sess[1])  # the session reaching the latest write == "now"
        current = cur[2]
        span = cur[1] - cur[0]
        span = span if span >= _MIN_SPAN_SEC else None
        prior = [s for s in sessions if s is not cur and s[1] <= cur[0]]
        if prior:
            prev = max(prior, key=lambda s: s[1])
            prior_gap = cur[0] - prev[1]
            excluded = sum(f["rows"] for s in prior for f in s[2])
            gaps.append(f"{_hhmm(prev[1])}->{_hhmm(cur[0])} {round(prior_gap / 60)}min gap; "
                        f"{len(prior)} earlier session(s), {excluded} rows, excluded from coverage")
    per_device = []
    newest = max((f["mtime"] for f in current), default=None)
    missing = []
    degraded = []
    optional_absent = []
    for d in devices:
        did = d.get("device_id")
        # Every id this device's files may carry — the current one plus any corrected-away
        # predecessors. Matching on the current id ALONE is what reported the Verity at 0 %
        # on 2026-07-26 after its id was fixed at 06:51; see writers.device_ids.
        dids = writers.device_ids(d)
        name = d.get("name") or did
        opt = bool(d.get("optional"))          # a known-but-not-expected backup — its absence is not a fault
        streams: dict[str, int] = {}
        coverage: dict[str, float] = {}
        for s in d.get("streams") or []:
            tag = s.upper()
            # Everything is the CURRENT SESSION (the `current` set, unified across midnight) — so a stream
            # is `missing` only if it produced nothing THIS session, and its row count + coverage reflect
            # the session, never an earlier daytime or previous-night one.
            rows = sum(f["rows"] for f in current
                       if writers.file_device_id(f["file"]) in dids and f["stream"] == tag)
            streams[s] = rows
            if rows == 0:
                # An OPTIONAL backup device that did not join is EXPECTED, not a gap — it stays out of
                # `missing` and does not make `ok` False (VIGIL: known-but-not-expected). Surfaced in
                # `optional_absent` so the box still records that it exists.
                (optional_absent if opt else missing).append(f"{name}:{s}")
                continue
            hz = _expected_hz(d, s)
            if hz and span:
                cov = round(rows / (hz * span), 2)
                coverage[s] = cov
                if cov < _DEGRADED_BELOW:
                    degraded.append(f"{name}:{s} {int(cov * 100)}%")
        # SECONDS SINCE THIS DEVICE LAST WROTE, measured against the night's NEWEST write rather
        # than wall-clock now(). Two reasons: reading an old night back must not report every
        # device as frozen, and the question that matters is always "silent while the others were
        # still recording". None when the device wrote nothing at all — that is `missing`, which
        # has its own alert.
        _mine = [f["mtime"] for f in current if writers.file_device_id(f["file"]) in dids]
        silent = round(newest - max(_mine)) if _mine and newest else None
        per_device.append({"name": name, "streams": streams, "coverage": coverage,
                           "silent_sec": silent})
    return {
        "night": os.path.basename(night_dir.rstrip("/")),
        "devices": per_device,
        "missing": missing,
        "degraded": degraded,
        "gaps": gaps,
        "optional_absent": optional_absent,
        # Every session on this night, oldest first — so `span_sec`/`coverage`/`missing`/`silent_sec`
        # being CURRENT-session-scoped is visible rather than implied.
        "sessions": [{"start": round(s[0]), "end": round(s[1]),
                      "rows": sum(f["rows"] for f in s[2])} for s in sessions],
        "prior_gap_sec": round(prior_gap) if prior_gap is not None else None,
        "span_sec": round(span) if span else None,
        "files": len(scanned),
        "total_rows": sum(f["rows"] for f in scanned),
        "total_bytes": sum(f["bytes"] for f in scanned),
        "sidecars": sorted({f["stream"] for f in scanned if f["stream"] in _SIDECAR_TAGS}),
        # A hole in the night is a reason to look, exactly like a missing or degraded stream. `ok` is a
        # claim about THE NIGHT; if half of it was excluded from the judgement, the claim is unsupported.
        "ok": not missing and not degraded and not gaps,
    }
