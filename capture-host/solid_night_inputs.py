# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""solid_night_inputs — the SOLID-NIGHT band SUPPLIERS: each §3.4 term read from its real input, on disk.

`solid_night.compose` applies §3.1 to band decisions that are already made. This module makes them, one per
term per expected device, from the files the capture and its audits leave beside the night. Every term
names the input it read; where that input is absent, unreadable or cannot answer the question, the term is
UNKNOWN with the reason — never PASS (CLAUDE.md §∅: an unexamined term is not a clean one).

Inputs are read BY EXACT NAME, never by glob over the verdict/audit files (§3.4): the re-audit left
`LOSS-AUDIT.prev-*.json` beside the live audit, and a glob would read the blind instrument.

THE WORN INTERVAL (§3.3, amended A1 and A6):
  · END   — the loss audit's `wear.worn_end`, only when its reason is `doff` (device-positive removal
            evidence). `link-loss` and `quiet-end-unclassified` are §3.3's "doff or loss —
            indistinguishable" ⇒ every interval-bound term is UNKNOWN. A model the audit has no wear rule
            for says so, and so does this.
  · START — the primary stream's first row (A6). Nothing yet measures a wear-evidence START, and this
            choice is ONE-DIRECTIONAL: a longer interval can only ADD gaps and LOWER completeness, so it
            can manufacture a false FAIL but never a false PASS.

The terms, per device:
  continuity   — the audit's per-gap list, counted inside the worn interval (§3.4 rows 1–3). UNKNOWN when
                 the audit has no per-gap times, no journal, or examined a file that does not cover the
                 worn interval (it reads one primary file per device; on 2026-09-10 that file was the
                 previous night's tail, so an empty list there means "not examined", not "no gaps").
  completeness — primary rows inside the worn interval against the NEGOTIATED rate × its seconds, 99–101 %.
                 The rate comes from the stream's own `# pmd … negotiated=yes rate=` line, else PMDNEG.csv's
                 acknowledged `chosen_hz`; a non-PMD fixed-rate stream (the ring's SpO₂) takes the rate its
                 writer declared in the acquisition evidence (A6). Never a nominal fallback.
  validity     — every waveform file of the model carries its `…RUNS.txt` sidecar, and the sidecar
                 publishes its OWN `min_run=` (the episode floor below which it is blind — the H10 ECG's is
                 30 samples, #3006). Absent ⇒ UNKNOWN, never PASS or FAIL (#2950).
  clocks       — the device clock was compared against the host: a seam sidecar that `examined` rows, or
                 the ring's RTCLOG `read` with an offset.
  timebase     — UNKNOWN until the residual pass lands (`independent`, hostAxis-ok, the A5 tripwire).
"""

from __future__ import annotations

import datetime as _dt
import glob
import json
import os
import re
from typing import Any

import nights_index as _ni

LOSS_AUDIT_NAME = "LOSS-AUDIT.json"
PMDNEG_NAME = "PMDNEG.csv"

# model → the file prefix the box writes, the PRIMARY stream (the one the loss audit reads, and the one
# continuity and completeness are scored on), and the WAVEFORM streams whose validity sidecar is required.
MODELS: dict[str, dict[str, Any]] = {
    "H10": {"prefix": "Polar_H10_", "primary": "ECG", "ext": ".txt", "pmd": "ecg", "waveforms": ("ECG", "ACC")},
    "VeritySense": {
        "prefix": "Polar_VeritySense_",
        "primary": "PPG",
        "ext": ".txt",
        "pmd": "ppg",
        "waveforms": ("PPG", "ACC"),
    },
    "O2Ring-S": {
        "prefix": "Wellue_O2Ring-S_",
        "primary": "SPO2",
        "ext": ".csv",
        "pmd": None,
        "waveforms": ("PPG", "PPG2W", "ACCRAW"),
    },
}

# §3.4 continuity — the fixed-mechanism daemon classes whose recurrence inside the worn interval is a
# regression. `daemon:charging hold` is NOT here: it is device-positive doff evidence (correct behaviour).
DAEMON_REGRESSION = (
    "daemon:pull paused live",
    "daemon:clock re-sync",
    "daemon:stream stall re-negotiate",
    "daemon:restart",
    "daemon:not-worn drop",
)
UNATTRIBUTED = "unattributed"
NO_JOURNAL = "unattributed (no journal)"
UNATTRIBUTED_MAX_S = 60.0  # §3.4: total < 60 s …
UNATTRIBUTED_MAX_N = 5  # … and count < 5
LINK_MAX_FRACTION = 0.01  # §3.4: link drops < 1 % of the worn interval
COMPLETE_LO, COMPLETE_HI = 0.99, 1.01  # §3.4 completeness band
TIMEBASE_PENDING = "timebase scan not built — needs the residual pass (independent, hostAxis-ok, the A5 tripwire)"

_PMD_RATE = re.compile(r"^# pmd stream=\S+ negotiated=yes rate=(\d+(?:\.\d+)?)\b")
_EXAMINED = re.compile(r"^# final stream=\S+ seams=\d+ examined=(\d+)")
_MIN_RUN = re.compile(r"\bmin_run=(\d+)\b")
_DECLARED_HZ = re.compile(r"@(\d+(?:\.\d+)?)Hz$")


def _decision(status: str, reason: str | None = None) -> dict:
    return {"status": status, "reason": reason}


def read_json(path: str) -> dict | None:
    """The file's JSON object, or None when it is absent, unreadable or not an object."""
    try:
        with open(path, encoding="utf-8") as fh:
            obj = json.load(fh)
    except (OSError, ValueError):
        return None
    return obj if isinstance(obj, dict) else None


def stream_files(night_dir: str, model: str, stream: str) -> list[str]:
    """This model's files for one stream in the night, sorted. `_ECG.txt` never matches `_ECGSEAMS.txt`."""
    spec = MODELS[model]
    ext = spec["ext"] if stream == spec["primary"] else ".txt"
    return sorted(glob.glob(os.path.join(night_dir, f"{spec['prefix']}*_{stream}{ext}")))


def first_last(path: str) -> tuple[_dt.datetime | None, _dt.datetime | None]:
    """The first and last row stamps of a stream file (local naive), streamed — never loaded whole."""
    first = last = None
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            t = _ni.parse_stamp(line)
            if t is None:
                continue
            if first is None:
                first = t
            last = t
    return first, last


def rows_between(path: str, start: _dt.datetime, end: _dt.datetime) -> int:
    """Rows whose stamp lies in [start, end], streamed. `parse_stamp` reads whole seconds, so the row set can
    include up to one second of rows past `end` — at most rate/(rate × interval) of the count, 0.006 % on a
    5 h night, against a 1 % band. Stated, not hidden."""
    n = 0
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            t = _ni.parse_stamp(line)
            if t is not None and start <= t <= end:
                n += 1
    return n


def worn_interval(audit_dev: dict | None, primaries: list[str], spans: dict[str, tuple]) -> tuple:
    """`(start, end, None)` or `(None, None, reason)` — §3.3 as amended by A1 and A6 (module docstring)."""
    if not primaries:
        return None, None, "no primary file this night"
    starts = [spans[p][0] for p in primaries if spans[p][0] is not None]
    if not starts:
        return None, None, "the primary stream carries no readable row stamp"
    if audit_dev is None:
        return None, None, f"{LOSS_AUDIT_NAME} has no entry for this device"
    wear = audit_dev.get("wear")
    if not isinstance(wear, dict):
        return None, None, f"{LOSS_AUDIT_NAME} carries no wear end for this device (an audit older than #3010)"
    if not wear.get("available"):
        return None, None, f"no worn-interval end: {wear.get('reason') or 'the audit gives no reason'}"
    end = wear.get("worn_end")
    if not isinstance(end, dict) or not end.get("at"):
        return None, None, "no file end could be judged, so the worn interval has no end"
    if end.get("reason") != "doff":
        return None, None, f"worn end is `{end.get('reason')}` — doff or loss, indistinguishable (§3.3)"
    return min(starts), _dt.datetime.fromisoformat(end["at"]), None


def continuity(audit: dict, audit_dev: dict, start, end, spans: dict[str, tuple]) -> dict:
    """§3.4 continuity rows 1–3 over the gaps that START inside the worn interval."""
    if str(audit.get("journal") or "").startswith("unavailable"):
        return _decision("UNKNOWN", "the loss audit could not read the journal — no gap can be attributed")
    gaps = audit_dev.get("gaps")
    if not isinstance(gaps, list):
        return _decision("UNKNOWN", "no per-gap times in the loss audit")
    audited = audit_dev.get("file")
    span = next((v for p, v in spans.items() if os.path.basename(p) == audited), None)
    if span is None or span[0] is None or span[0] > start or span[1] < end:
        return _decision(
            "UNKNOWN", f"the loss audit examined `{audited}`, which does not cover the worn interval"
        )
    inside = []
    for g in gaps:
        at = _dt.datetime.fromisoformat(g["at"])
        if start <= at <= end:
            inside.append((str(g["cause"]), float(g["s"])))
    worn_s = (end - start).total_seconds()
    regress = sorted({c for c, _ in inside if c in DAEMON_REGRESSION})
    if regress:
        return _decision("FAIL", f"daemon regression inside the worn interval: {', '.join(regress)}")
    if any(c == NO_JOURNAL for c, _ in inside):
        return _decision("UNKNOWN", "a gap inside the worn interval is unattributed for want of a journal")
    un = [s for c, s in inside if c == UNATTRIBUTED]
    if sum(un) >= UNATTRIBUTED_MAX_S or len(un) >= UNATTRIBUTED_MAX_N:
        return _decision("FAIL", f"{len(un)} unattributed gap(s), {sum(un):.0f} s, inside the worn interval")
    link = sum(s for c, s in inside if c.startswith("link:"))
    if worn_s > 0 and link / worn_s >= LINK_MAX_FRACTION:
        return _decision("FAIL", f"link drops {link:.0f} s = {100 * link / worn_s:.1f} % of the worn interval")
    return _decision("PASS")


def negotiated_rate(night_dir: str, device: str, model: str, primary: str) -> tuple[float | None, str]:
    """The primary stream's rate and where it came from, or (None, why). Never a nominal fallback."""
    spec = MODELS[model]
    if spec["pmd"] is None:
        meta = read_json(primary + ".meta.json")
        signal = str(((meta or {}).get("acquisition_evidence") or {}).get("signal") or "")
        m = _DECLARED_HZ.search(signal)
        if m:
            return float(m.group(1)), "declared in the acquisition evidence (A6)"
        return None, "no rate declared in the stream's acquisition evidence"
    seams = primary[: -len(".txt")] + "SEAMS.txt"
    try:
        with open(seams, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                m = _PMD_RATE.match(line)
                if m and float(m.group(1)) > 0:
                    return float(m.group(1)), "the stream's own # pmd line"
    except OSError:
        pass  # no seam sidecar beside the stream: PMDNEG.csv below is the other negotiated record
    try:
        with open(os.path.join(night_dir, PMDNEG_NAME), encoding="utf-8", errors="replace") as fh:
            for line in fh:
                p = line.rstrip("\n").split(";")
                if len(p) >= 8 and p[1] == device and p[3] == spec["pmd"] and p[7] == "ok":
                    try:
                        hz = float(p[6])
                    except ValueError:
                        continue  # a blank or non-numeric chosen_hz is no rate; a later row may carry one
                    if hz > 0:
                        return hz, PMDNEG_NAME
    except OSError:
        pass  # no PMDNEG.csv: falls through to the named UNKNOWN below, never to a nominal rate
    return None, "negotiated rate not written beside the stream (#2912)"


def completeness(night_dir: str, device: str, model: str, primaries: list[str], start, end) -> dict:
    """§3.4 completeness on the primary stream (A2: an event stream is never scored here)."""
    rates = [negotiated_rate(night_dir, device, model, p) for p in primaries]
    missing = [why for r, why in rates if r is None]
    if missing:
        return _decision("UNKNOWN", missing[0])
    hz = sorted({r for r, _ in rates if r is not None})
    if len(hz) != 1:
        return _decision("UNKNOWN", f"the primary files disagree on their rate: {hz}")
    rate = hz[0]
    expected = rate * (end - start).total_seconds()
    if expected <= 0:
        return _decision("UNKNOWN", "the worn interval has no length")
    rows = sum(rows_between(p, start, end) for p in primaries)
    ratio = rows / expected
    if COMPLETE_LO <= ratio <= COMPLETE_HI:
        return _decision("PASS")
    return _decision("FAIL", f"{rows} rows against {expected:.0f} expected at {rate:g} Hz = {100 * ratio:.2f} %")


def validity(night_dir: str, model: str) -> dict:
    """§3.4 validity (A4): every waveform file carries its RUNS sidecar with its OWN `min_run=`."""
    files = [f for w in MODELS[model]["waveforms"] for f in stream_files(night_dir, model, w)]
    if not files:
        return _decision("UNKNOWN", "no waveform file this night, so no sidecar could be checked")
    for f in files:
        runs = f[: -len(".txt")] + "RUNS.txt"
        try:
            with open(runs, encoding="utf-8", errors="replace") as fh:
                header = fh.readline()
        except OSError:
            return _decision("UNKNOWN", f"`{os.path.basename(runs)}` absent — absences not examined (#2950)")
        if not _MIN_RUN.search(header):
            return _decision("UNKNOWN", f"`{os.path.basename(runs)}` publishes no min_run — its blind floor is unknown")
    return _decision("PASS")


def clocks(night_dir: str, model: str) -> dict:
    """§3.4 clocks: the device clock was compared with the host on this night."""
    prefix = MODELS[model]["prefix"]
    for seams in sorted(glob.glob(os.path.join(night_dir, f"{prefix}*SEAMS.txt"))):
        with open(seams, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                m = _EXAMINED.match(line)
                if m and int(m.group(1)) > 0:
                    return _decision("PASS")
    for rtc in sorted(glob.glob(os.path.join(night_dir, f"{prefix}*_RTCLOG.csv"))):
        with open(rtc, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                p = line.rstrip("\n").split(";")
                if len(p) >= 3 and p[1] == "read":
                    try:
                        float(p[2])
                    except ValueError:
                        continue  # a `read` with no offset measured nothing; keep looking for one that did
                    return _decision("PASS")
    return _decision("UNKNOWN", "no device-vs-host clock comparison recorded this night")


def expected_devices(night_dir: str, devices: list) -> list[dict]:
    """§3.2: the configured devices minus `optional` backups — an optional one only on a night it captured."""
    out = []
    for d in devices or []:
        if not isinstance(d, dict):
            continue
        model = str(d.get("model") or "")
        if d.get("optional"):
            spec = MODELS.get(model)
            if spec is None or not glob.glob(os.path.join(night_dir, f"{spec['prefix']}*")):
                continue
        out.append(d)
    return out


def score_devices(night_dir: str, devices: list) -> dict:
    """`{name: {"bands": {term: decision}}}` for `solid_night.compose`, one entry per expected device."""
    audit = read_json(os.path.join(night_dir, LOSS_AUDIT_NAME))
    out: dict[str, dict] = {}
    for d in expected_devices(night_dir, devices):
        name = str(d.get("name") or d.get("model"))
        model = str(d.get("model") or "")
        if model not in MODELS:
            out[name] = {"bands": {"presence": _decision("UNKNOWN", f"no stream map for model {model!r}")}}
            continue
        primaries = stream_files(night_dir, model, MODELS[model]["primary"])
        if not primaries:
            out[name] = {
                "bands": {"presence": _decision("UNKNOWN", "no-wear or radio down — indistinguishable (§3.2)")}
            }
            continue
        spans = {p: first_last(p) for p in primaries}
        audit_dev = ((audit or {}).get("devices") or {}).get(name)
        start, end, why = worn_interval(audit_dev, primaries, spans)
        bands: dict[str, dict] = {}
        if audit is None:
            bands["continuity"] = _decision("UNKNOWN", f"{LOSS_AUDIT_NAME} absent or unreadable")
            bands["completeness"] = _decision("UNKNOWN", f"no worn interval: {why}")
        elif why is not None:
            bands["continuity"] = _decision("UNKNOWN", f"no worn interval: {why}")
            bands["completeness"] = _decision("UNKNOWN", f"no worn interval: {why}")
        else:
            bands["continuity"] = continuity(audit, audit_dev or {}, start, end, spans)
            bands["completeness"] = completeness(night_dir, name, model, primaries, start, end)
        bands["validity"] = validity(night_dir, model)
        bands["clocks"] = clocks(night_dir, model)
        bands["timebase"] = _decision("UNKNOWN", TIMEBASE_PENDING)
        out[name] = {"bands": bands}
    return out
