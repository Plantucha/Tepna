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
  timebase     — the host-vs-device residual, one anchor per BLE batch: the device axis is a CLOCK and
                 not a drawn counter, an independent host disciplined it, and its rate is plausible.
                 The A5 step tripwire is a separate unit, so the band still ends UNKNOWN (§∅) — but it
                 now names what it measured, and FAILs an implausible rate rather than waiting.
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
# §3.4 timebase — PARITY WITH `clock.js hostAxis`, whose constants these are. They are properties of the
# DATA, measured there over 381 box sidecars, not knobs: keep them equal or the detector and the emitter
# disagree about what a second clock IS.
TB_MIN_ANCHORS = 3  # §7: two points fit a line through any jitter and cannot be checked
TB_INERT_MS = 2.0  # CK_AXIS_INERT_MS — twice the 1 ms phone-stamp quantum
TB_DRAWN_SHARE = 0.67  # CK_AXIS_DRAWN_SHARE — real streams max 56 %, drawn min 79 %; nothing between
TB_MAX_PPM = 50000.0  # CK_AXIS_MAX_PPM — a refusal bound with 16x headroom over the worst real device
TB_FLOOR_S = 1.0  # take an anchor at least this often even when the residual never moves
TB_WIN = 21  # CK_AXIS_WIN — running-median width, odd so the median is a real sample
_SENSOR_NS_COL = "sensor timestamp [ns]"

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


def _median(v: list[float]) -> float:
    q = sorted(v)
    m = len(q) // 2
    return q[m] if len(q) % 2 else (q[m - 1] + q[m]) / 2.0


def recorded_seams(primary: str, start, end) -> list[dict]:
    """The device-clock STEPS the box already wrote beside this stream, inside the worn interval.

    ⚠️ THIS IS NOT SOLID-NIGHT §A5, and the distinction is what keeps this unit honest. A5's
    unrecorded-shift detector is a TRIPWIRE that must stay UNBUILT here — it needs a no-record check
    across three sources plus two guards, and a partial version emits the verdict the brief forbids
    (see `timebase`'s closing note). This reads a step the capture host OBSERVED and RECORDED. Consuming
    a record is not detecting; the file is the evidence, and `_SeamSidecar.feed` wrote it precisely
    because *"a seam is where they DISAGREE"*.

    🔴 JOINED ON `phone_ts`, NOT ON `idx`. The sidecar's `idx` is `self.examined` — the count of samples
    carrying BOTH clocks — while a reader's natural index is the raw row. Those are two populations and
    they differ by every row the device stamp was absent on, so joining them would place the seam at the
    wrong sample: the same-name-two-populations error this suite keeps paying for. `phone_ts` is a host
    stamp and the anchors are keyed by host stamp, so the join is on one quantity.
    """
    seams: list[dict] = []
    path = primary[: -len(".txt")] + "SEAMS.txt"
    try:
        fh = open(path, encoding="utf-8", errors="replace")
    except OSError:
        return seams  # no sidecar beside the stream: nothing was recorded, which is not a claim of no step
    with fh:
        for line in fh:
            if line.startswith("#") or line.startswith("phone_ts"):
                continue
            cells = line.rstrip("\n").split(";")
            if len(cells) < 3:
                continue  # a short row records nothing; skipped, never defaulted (§∅)
            try:
                host = _dt.datetime.fromisoformat(cells[0])
                step_ms = float(cells[2])
            except ValueError:
                continue  # an unparseable seam row is not a step of zero — it is one this reader cannot
                          # place, so it splits nothing rather than splitting at the wrong sample (§∅)
            if start is not None and (host < start or host > end):
                continue  # a seam outside the worn interval does not split an axis nobody was wearing
            seams.append({"host_ms": host.timestamp() * 1000.0, "step_ms": step_ms})
    seams.sort(key=lambda r: r["host_ms"])
    return seams


def _seam_cause(night_dir: str, seams: list[dict]) -> str | None:
    """What the night's own record says caused the step, or None. Never inferred from the magnitude.

    Called only inside `if seams:`, so a `not seams` guard here was unreachable — coverage found it and it
    is removed rather than given a test that could never fail, the same call this file's `drawn_share`
    note records."""
    for name in ("CLOCKSYNC.csv", "CLOCK.csv"):
        try:
            with open(os.path.join(night_dir, name), encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    low = line.lower()
                    if "resync" in low or "synced" in low or "offline" in low:
                        return f"`{name}` records a clock event this night"
        except OSError:
            continue  # this record is unreadable, so it names no cause; the NEXT one may. A missing cause
                      # is reported as "no cause recorded", never as an inferred one (the docstring's rule)
    return None


def residual_scan(path: str, start, end) -> dict:
    """ONE streaming pass over a two-clock stream → the residual anchors and the drawn-axis share.

    TWO POPULATIONS, DELIBERATELY DIFFERENT, and conflating them is the trap this docstring exists for:

      · the DRAWN test reads the device's OWN inter-sample deltas, at FULL row resolution. Sampling it
        at the anchor cadence would manufacture its own answer — one row per second means the device
        delta is (samples skipped) x (sample period), which varies by about one sample and so
        concentrates on two or three values, reading as drawn for every healthy stream.
      · the RESIDUAL reads one anchor per second, so consecutive anchors land in DIFFERENT BLE frames.
        `Phone timestamp` is BACK-TIMED within a frame (`arrival - back/fs`, writers.py), so the rows of
        one frame share a single real host measurement; treating each as an anchor would fabricate
        anchors out of an interpolation.

    Keyed on the integer `sensor_ns` delta, which is equal to or finer than `clock.js`'s `String(devMs)`.
    Finer keying can only LOWER a share, so it cannot invent a drawn verdict for a real stream; a
    counter synthesised as `index x rate` still lands at ~100 %, so it does not cost a detection either.

    Memory is bounded by the delta tally, which clusters (a real 130 Hz stream jitters over a narrow
    band). `rows` is never held; the file is read line by line (a night's ECG is ~160 MB).
    """
    try:
        fh = open(path, encoding="utf-8", errors="replace")
    except OSError:
        return {"reason": f"`{os.path.basename(path)}` could not be opened"}
    with fh:
        header = fh.readline()
        cols = header.rstrip("\n").split(";")
        if _SENSOR_NS_COL not in cols:
            return {"reason": f"`{os.path.basename(path)}` carries no `{_SENSOR_NS_COL}` column — no device clock"}
        ns_at = cols.index(_SENSOR_NS_COL)
        tally: dict[int, int] = {}
        top = total = 0
        prev_ns: int | None = None
        anchors: list[tuple[float, float]] = []
        prev_r: float | None = None
        last_at = _dt.datetime.min
        for line in fh:
            parts = line.split(";")
            if len(parts) <= ns_at:
                continue  # a short row measures nothing; it is skipped, never defaulted (§∅)
            try:
                host = _dt.datetime.fromisoformat(parts[0])
                ns = int(parts[ns_at])
            except ValueError:
                continue  # an unparseable row is not a zero
            if prev_ns is not None:
                d = ns - prev_ns
                c = tally[d] = tally.get(d, 0) + 1
                total += 1
                if c > top:
                    top = c
            prev_ns = ns
            if start is not None and (host < start or host > end):
                continue
            # ONE ANCHOR PER BATCH, derived rather than guessed. SOLID-NIGHT §A5: `Phone timestamp` is
            # synthesised per row as `batch arrival + k/fs` while the device advances by the SAME k/fs,
            # so the residual is CONSTANT inside a batch and moves only at a boundary. A change in the
            # residual therefore IS a batch boundary — no frame size assumed, and no cadence imposed.
            # Quantised to the host stamp's OWN 1 ms resolution. The device carries its own sub-ms
            # jitter, so the residual is not bit-constant inside a batch — it is constant to within
            # what the host can express, which is the resolution the model is stated at. Merging is
            # the SAFE direction: a boundary whose arrival jitter is under 1 ms joins its neighbour,
            # so this can only report FEWER anchors, never invent one.
            r = round(host.timestamp() * 1000.0 - ns / 1e6)
            # ... OR once a second regardless. Without the floor an INERT host column (one that only
            # rounds the device) never changes its residual, yields a single anchor, and is reported as
            # "too few anchors" — true, but it names the symptom instead of the cause. The floor keeps
            # the anchor set populated so the spread test can say what is actually wrong with it.
            if prev_r is None or r != prev_r or (host - last_at).total_seconds() >= TB_FLOOR_S:
                anchors.append((host.timestamp() * 1000.0, ns / 1e6))
                prev_r, last_at = r, host
    return {"anchors": anchors, "drawn_share": (top / total) if total else None, "reason": None}


def timebase(night_dir: str, model: str, primaries: list[str], start, end) -> dict:
    """§3.4 timebase: the device axis is a CLOCK, it was disciplined by an independent host, its rate is
    plausible, and it carries no step. Judged on the largest primary file inside the worn interval."""
    if start is None:
        return _decision("UNKNOWN", "no worn interval, so no stretch of the axis could be judged")
    path = max(primaries, key=os.path.getsize)
    scan = residual_scan(path, start, end)
    if scan.get("reason"):
        return _decision("UNKNOWN", scan["reason"])
    who = os.path.basename(path)
    anchors = scan["anchors"]
    if len(anchors) < TB_MIN_ANCHORS:
        return _decision("UNKNOWN", f"`{who}` gave {len(anchors)} anchor(s) inside the worn interval — under {TB_MIN_ANCHORS}")
    # `drawn_share` cannot be None here: it is None only when the file has under two rows, and under
    # three rows the anchor check above has already returned. Coverage found the branch unreachable and
    # it is removed rather than given a test that could never fail.
    share = scan["drawn_share"]
    if share >= TB_DRAWN_SHARE:
        # NOT a FAIL: a drawn axis is the ABSENCE of a second clock, not a bad one (§∅). `clock.js` says
        # a new consumer must gate on this rather than on `independent`, which reads TRUE for a drawn
        # O2Ring axis (its 1 s-granular counter gives a 22,335 ms spread).
        return _decision("UNKNOWN", f"`{who}`'s device axis was DRAWN ({100 * share:.1f} % modal delta) — not a clock")
    # ── 🔴 ONE DEVICE CLOCK PER SEGMENT — a recorded step SPLITS the axis, it is never a rate ─────
    # Night 1's FAIL is what this closes: the owner's 22:01 time-sync click ran an offline op, the H10
    # resumed with a 2.44e8 s device-clock step, and fitting ONE rate across it quoted
    # −10,592,683,838 ppm — "beyond the plausibility bound" — about a night whose two segments are
    # each fine. The step is real and the bound is right; the arithmetic spanning it is what was wrong.
    #
    # Mirrors `ecgdex-dsp.js`'s "ONE DEVICE CLOCK PER AXIS" DIAGNOSIS — *"continuity is not sameness:
    # the pre-sync counter is a different oscillator"*, and Clock Contract §7 says a step is REPORTED,
    # never absorbed. ⚠️ THE DISPOSITION DELIBERATELY DIFFERS, because the consumer does: ECGDex needs
    # ONE axis to set `fs`, so it DROPS every pre-resync anchor. A night verdict needs the whole night,
    # and dropping the pre-seam segment would silently stop judging the 12 minutes before the click —
    # the coverage-without-a-denominator shape. So both segments are judged, separately, and the
    # verdict is the worst of them. Stated rather than left as a silent divergence from the mirror.
    seams = recorded_seams(path, start, end)
    bounds = [s["host_ms"] for s in seams]
    segs: list[list[tuple[float, float]]] = []
    cur: list[tuple[float, float]] = []
    bi = 0
    for h, d in anchors:
        while bi < len(bounds) and h >= bounds[bi]:
            if cur:
                segs.append(cur)
            cur, bi = [], bi + 1
        cur.append((h, d))
    # UNCONDITIONAL, because `cur` cannot be empty here: the loop body ends in `cur.append`, and
    # `anchors` is non-empty (the TB_MIN_ANCHORS check above returned otherwise). An `if cur:` guard
    # was unreachable — coverage found the branch and it is removed rather than given a test that could
    # never fail. The guard INSIDE the while loop is a different case and is reachable: a seam at or
    # before anchor 0 closes a segment that never opened.
    segs.append(cur)
    seam_note = ""
    if seams:
        worst = max(seams, key=lambda r: abs(r["step_ms"]))
        cause = _seam_cause(night_dir, seams)
        seam_note = (f" — {len(seams)} recorded clock seam(s), largest {worst['step_ms'] / 1000.0:+.3g} s"
                     f"{'; ' + cause if cause else '; no cause recorded this night'}"
                     f"; the axis is judged in {len(segs)} segment(s), never across a step")

    worst_out: dict | None = None
    rank = {"FAIL": 2, "UNKNOWN": 1, "PASS": 0}
    for si, seg in enumerate(segs, 1):
        tag = f"`{who}` segment {si}/{len(segs)}" if len(segs) > 1 else f"`{who}`"
        if len(seg) < TB_MIN_ANCHORS:
            out = _decision("UNKNOWN", f"{tag} gave {len(seg)} anchor(s) — under {TB_MIN_ANCHORS}{seam_note}")
        else:
            r0 = seg[0][0] - seg[0][1]
            res = [((h - seg[0][0]) / 1000.0, (h - d) - r0) for h, d in seg]
            vals = [r for _, r in res]
            spread = max(vals) - min(vals)
            span_s = res[-1][0] - res[0][0]
            if spread <= TB_INERT_MS:
                out = _decision("UNKNOWN", f"{tag} residual spread {spread:.2f} ms — the host column adds nothing beyond rounding, so there is no second clock{seam_note}")
            elif span_s <= 0:
                out = _decision("UNKNOWN", f"{tag} anchors span no time{seam_note}")
            else:
                # No short-list fallback: a slice is already the whole list when the list is shorter, so
                # the conditional this used to carry was unreachable weight — and every mutation of that
                # dead branch survived the suite, which is how the diff-scoped mutation gate surfaced it.
                lead = _median(vals[:TB_WIN])
                tailv = _median(vals[-TB_WIN:])
                ppm = (tailv - lead) / 1000.0 / span_s * 1e6
                if abs(ppm) >= TB_MAX_PPM:
                    out = _decision("FAIL", f"{tag} host-vs-device rate {ppm:+.0f} ppm over {span_s / 60:.0f} min — beyond the plausibility bound, so the two columns are not the two clocks{seam_note}")
                else:
                    out = _decision("UNKNOWN", f"{tag}: axis is an independent clock at {ppm:+.0f} ppm over {span_s / 60:.0f} min — the A5 step tripwire has not run{seam_note}")
        if worst_out is None or rank[out["status"]] > rank[worst_out["status"]]:
            worst_out = out
    assert worst_out is not None  # `anchors` is non-empty above, so `segs` carries at least one segment
    return worst_out
    # A5 IS A SEPARATE UNIT AND IS DELIBERATELY NOT HALF-BUILT HERE. SOLID-NIGHT §A5 makes the
    # UNRECORDED-shift detector a TRIPWIRE whose fire is UNKNOWN `unrecorded-shift-candidate`, never a
    # FAIL — "the clean corpus holds zero true unrecorded steps, so the detector has never been
    # validated against the thing it would convict" — and it needs a no-record check across three
    # sources (seam sidecar, journal clock-event lines, CLOCKSYNC `synced`/`resynced`) plus two guards
    # that each yield their OWN named UNKNOWN. The segment split above does NOT build it and must not be
    # read as having built it: it consumes a step the box RECORDED, which is the opposite of detecting an
    # unrecorded one. Where no seam file exists there is ONE segment and the number is unchanged.


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
        bands["timebase"] = timebase(night_dir, model, primaries, start, end)
        out[name] = {"bands": bands}
    return out
