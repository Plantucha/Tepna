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

import json
import os
import subprocess

import allan
import clock_offset
import writers
from datetime import datetime, timedelta

# Sidecars the box writes that are NOT a device capture stream — excluded from the per-device rollup so a
# LINK/CLOCK/QC file never masquerades as sensor data.
_SIDECAR_TAGS = {"LINK", "CLOCK", "OXYFRAME"}

# ── DEPLOY-FILE DRIFT, CHECKED NIGHTLY ──────────────────────────────────────────────────────────────
# `deploy/check-system-files.sh` is the ONLY instrument that can see an installed helper diverging from
# the repo, and nothing ran it on a schedule — so drift surfaced when somebody happened to look. On
# 2026-08-15 that was three weeks after the brief, and the stale file was `tepna-restart.sh` missing the
# `deploy` verb: the fix for the Deploy button had been MERGED FOR A DAY with CI green while the field
# stayed broken. Nothing in the repo could have said so.
#
# ⚠️ IT REPORTS, IT DOES NOT JUDGE. This deliberately does NOT feed `ok`. QC already returns ok=false on
# ~10 of 11 nights for a benign doffing gap, and a drifted deploy file is an OPERATOR action (`--install`,
# or a hand `rm` for a superseded leftover) rather than a bad night's capture. Another axis in an alarm
# nobody reads is worth nothing.
#
# ⚠️ COUNTS, NOT THE EXIT CODE. The exit code is a single bit and the two classes need OPPOSITE responses.
# (It does carry SUPERSEDED, contrary to a first reading — line ~168 increments `drift` as well as
# `stale_etc`, measured exit 1 — but "something drifted" still cannot say WHICH.)
_SYSTEM_FILES_SH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "deploy", "check-system-files.sh")
_SYSTEM_FILES_TIMEOUT_S = 60.0
_DEPLOYED_MARKER = "/usr/local/lib/tepna"      # helper_path.SYSTEM_DIRS[0]; absent on a dev checkout
_CHECKOUT_DIR = "/opt/tepna"                   # the tree tepna-update.sh fast-forwards


def system_file_drift(script: str = _SYSTEM_FILES_SH, *,
                      timeout: float = _SYSTEM_FILES_TIMEOUT_S,
                      marker: str = _DEPLOYED_MARKER,
                      runner=None) -> "dict | None":
    """Counts from `check-system-files.sh --json`, or `None` when no claim can be made.

    `None` for every unhappy path — not a deployed host, script absent, timed out, unparseable — because
    a zeroed record would read as "nothing has drifted", which is the one wrong answer available here.
    The script is read-only without `--install`, never restarts anything and never deletes, so it is
    safe on a schedule.
    """
    if not os.path.isdir(marker):
        return None                                  # a dev checkout has nothing installed to drift
    if not os.path.exists(script):
        return None
    run = runner or subprocess.run
    try:
        p = run(["bash", script, "--json"], capture_output=True, text=True, timeout=timeout)
    except Exception:                                # noqa: BLE001 — a QC extra may never break QC
        return None
    try:
        out = json.loads((p.stdout or "").strip().splitlines()[-1])
    except Exception:                                # noqa: BLE001
        return None
    if not isinstance(out, dict):
        return None
    out["exit"] = p.returncode
    out["checkout_clean"] = _checkout_clean(runner=run)
    return out


def _checkout_clean(checkout: str = _CHECKOUT_DIR, *, runner=None) -> "bool | None":
    """Is the deploy checkout clean? `None` when it cannot be said.

    ⚠️ THIS IS THE CONDITION; HEAD-CURRENCY IS A LAGGING SYMPTOM OF IT. `tepna-update.sh` refuses a dirty
    tree — *"ERROR: /opt/tepna has uncommitted changes — refusing to touch it"* — which is correct (it
    will not fast-forward over someone's work) and severe: ONE stray untracked file silently halts every
    future deploy, and the only outward sign is a `systemctl --failed` entry on a box nobody logs into.
    It has happened: an untracked `capture-host/vigil.sh` plus a `chmod +x` that git counted as a mode
    change were together enough.

    A dirty tree does NOT make HEAD stale at the moment it appears — it makes it stale from the NEXT
    merge. So a HEAD-currency check reads green for up to an hour after the box has actually stopped
    deploying, and catches the breakage only after the first missed pull. This catches it when it breaks.
    (Suggested in review, and it is the same move as measuring the tree rather than the ref.)

    ⚠️ `core.fileMode=true` here, so `chmod +x` on a tracked file IS a modification — fixing an exec bit
    by hand creates the very dirt that blocks the updater. Let the commit carry the mode.
    """
    if not os.path.isdir(os.path.join(checkout, ".git")):
        return None
    run = runner or subprocess.run
    try:
        p = run(["git", "-C", checkout, "status", "--porcelain"],
                capture_output=True, text=True, timeout=_SYSTEM_FILES_TIMEOUT_S)
    except Exception:                                # noqa: BLE001 — a QC extra may never break QC
        return None
    if p.returncode != 0:
        return None
    return not (p.stdout or "").strip()
_SUMMARY_NAME = "QC-SUMMARY.json"

# A gap this long between two capture SESSIONS starts a new one, so coverage is judged against the CURRENT
# session's span, not the whole date folder. A date dir rolls by the session's START date (writers.night_dir),
# so a box that ran all day piles the daytime tests AND the evening's sleep session into one YYYY-MM-DD dir —
# and measuring a stream that is streaming perfectly RIGHT NOW against that ~19 h wall-clock span reads it as
# ~0 % (a false 'degraded', the very inversion of the false-confidence bug coverage exists to catch). One hour
# comfortably spans reconnect churn / a bathroom break (kept in one session) but splits a genuine new sitting.
_SESSION_GAP_SEC = 3600.0
# How far into a day a capture may open and still be ASKED whether it continues last night. A cost
# guard on the probe, not a correctness threshold — see prev_probe_window.
_PREV_PROBE_SEC = 12 * 3600.0
# Stamp parsing moved to writers.file_stamp (audit F5) — anchored, year-validated, one implementation.


def _session_of(fname: str, mtime: float) -> float:
    """The capture SESSION a file belongs to, as an epoch — the `_YYYYMMDDHHMMSS_` START stamp
    writers.capture_filename() embeds (the instant the connection opened). Falls back to the file's mtime
    when the name carries no such stamp, so a legacy/stampless file is simply its own one-file session."""
    stamp = writers.file_stamp(fname)
    if stamp:
        try:
            return datetime.strptime(stamp, "%Y%m%d%H%M%S").timestamp()
        except ValueError:
            pass                                       # a plausible-year run that is not a real datetime
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


def prev_probe_window(earliest: float, midnight) -> bool:
    """Is it worth ASKING the previous folder whether its session runs into this one?

    Purely a cost guard, never a correctness one — the pooling decision is made by contiguity, and this
    only decides whether that question gets asked at all. The cheap near-midnight gate beside it answers
    the common case for free; this widens the probe to the small hours, where a cross-midnight
    continuation is the only thing a session can be. A capture opening at 15:00 cannot be last night's,
    so it never pays for the extra directory scan. Noon is deliberately generous: the cost of being wrong
    here is one scan, and the cost of being too tight is a night judged as two broken halves."""
    return midnight is not None and 0 <= earliest - midnight < _PREV_PROBE_SEC


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
    # O2Ring ppg is the observed ROW rate (~125.7), NOT the 125.000 ADC clock: the file counts one row per
    # sample PLUS one per inserted `156` beat marker, and a coverage figure divides ROW count by span — so
    # the honest denominator here is the row rate. DEVICE-RATE-TRUTH §2; distinct from capture.O2PPG_FS_DEFAULT.
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


# The markers that make a device RECOGNISED. `_model_of` defaults an unknown device to "O2Ring" so its
# callers always get a string; that default must never reach the nominal-rate table, because a sensor
# this suite has never seen would then inherit the O2Ring's rates and be judged against them. A user can
# change any device's rate at any time and can attach sensors whose rates are documented nowhere — the
# honest answer for those is "no reference rate", not "the last model in the if-chain".
_MODEL_MARKERS = (("H10", ("h10",)), ("Verity", ("verity", "sense")), ("O2Ring", ("o2ring", "wellue", "viatom")))


def _recognised_model(dev: dict):
    """The model, only if the device actually matches a known marker. None for anything else."""
    blob = f"{dev.get('model', '')} {dev.get('name', '')}".lower()
    for name, marks in _MODEL_MARKERS:
        if any(m in blob for m in marks):
            return name
    return None


def _expected_hz(dev: dict, stream: str):
    """The rate to judge coverage against: the device's CONFIGURED rate for this stream if set, else the
    model nominal for a RECOGNISED model, else None (unknown — no coverage claim for a stream we have no
    reference rate for, and no borrowed one from a model this device is not)."""
    rate = (dev.get("rates") or {}).get(stream)
    if rate:
        return float(rate)
    model = _recognised_model(dev)
    if model is None:
        return None
    # Direct subscript, not `.get(model, {})`: `_recognised_model` returns a key of this table or None,
    # and None already returned above — so a default here is an arm no input can reach, and an
    # unreachable arm is removed rather than tested.
    return _NOMINAL_HZ[model].get(stream)


# How many rows to read when measuring a rate off a stream file. The device stamp is monotonic and the
# rate is constant within a session, so a few thousand rows settle it — and a 456 MB PPG file must never
# be read whole just to name its rate.
_RATE_SAMPLE_ROWS = 4000
_RATE_MIN_ROWS = 200        # below this the span is too short to divide by
_RATE_MISMATCH_TOL = 0.10   # 10 % — wider than crystal error, far narrower than a rate SWAP


def measured_hz(path: str, max_rows: int = _RATE_SAMPLE_ROWS):
    """The rate a stream file ACTUALLY carries, read off its device timestamps. None when unsayable.

    ⚠️ THE CONFIGURED RATE IS A REQUEST, NOT A FACT, and the gap between them is a documented way to
    lose a night. `polar_pmd`'s SDK-MODE block records it: every stream must be STOPPED before SDK mode
    is entered, or the device answers `ERROR_INVALID_STATE` (0x0C) — and 0x0C sits in
    `TRANSIENT_STATUS`, so a caller that only asks `is_transient` reads the refusal as "try again
    later" and records the whole night at 55 Hz believing it asked for 176.

    `capture.py` already logs `{"want": ..., "got": ...}` for the NEGOTIATED rate, which is a different
    claim: negotiation is what the device said it would do. This is what the bytes on disk actually are,
    and it is the only one of the three that cannot be wrong about itself.

    Uses the `sensor timestamp [ns]` column — the DEVICE clock — deliberately, not the host stamp: the
    host column is back-timed across each packet from one arrival, so it measures the packet cadence
    rather than the sample rate.

    ⚠️ THE ANSWER IS NOT THE NOMINAL RATE, AND THE FRACTION IS REAL. Measured on the 2026-08-11/12 box
    captures, with the mechanism identified for each:

      H10 ecg     129.995 Hz   ~-38 ppm from 130 (ecgdex-dsp records 129.9866-129.9966)
      H10 acc      50.788 Hz   delta is EXACTLY 645 ticks of a 32768 Hz clock: 32768/645 = 50.7876.
                               Never 50 Hz, and not a drifting 50 — a divided watch crystal.
      Verity ppg   55.114 Hz   |  one timebase: 176.429/55.114 = 3.2013 against a nominal 3.2, so both
      Verity ppg  176.429 Hz   |  sit ~+2000 ppm above nominal. Consistent, not noise.

    These match the negotiated rates `polar_pmd` already records ("ECG 129.94 vs 130, H10 ACC 50.72 vs
    50, Verity PPG 55.11 vs 55"), and row-inflation was ruled out directly: file rows equal the summed
    `n_samples` the device reported, ratio 1.000000 on all three Polar streams.

    ⚠️ THAT LAST CHECK IS WHY THIS IS PMD-ONLY. The O2Ring's pleth file writes one row per sample PLUS
    one per inserted `156` beat marker, so counting its rows yields ~125.7 for a 125.000 Hz ADC — a row
    rate wearing a sample rate's units. This function would report that inflated figure as a rate. It is
    saved only by the layout guard above (the ring's file carries no `sensor timestamp` column, so it
    returns None), which is luck rather than design: do NOT relax that guard.
    """
    ns: list[int] = []
    try:
        with open(path) as fh:
            head = fh.readline()
            if "sensor timestamp" not in head:
                return None                      # not a PMD stream layout — say nothing rather than guess
            for i, line in enumerate(fh):
                if i >= max_rows:
                    break
                parts = line.split(";")
                if len(parts) < 2:
                    continue
                try:
                    ns.append(int(parts[1]))
                except ValueError:
                    continue
    except OSError:
        return None
    if len(ns) < _RATE_MIN_ROWS:
        return None
    # MEDIAN INTER-SAMPLE DELTA, not (n-1)/span across the endpoints. A single dropout inside the
    # window inflates the span and makes an endpoint estimate UNDER-report the rate — the worst
    # direction, because a 176 Hz stream with one gap would then read as ~55 and be filed as a failed
    # rate swap. The median ignores any minority of gaps entirely.
    deltas = sorted(ns[i] - ns[i - 1] for i in range(1, len(ns)))
    step_ns = deltas[len(deltas) // 2]
    if step_ns <= 0:
        return None                              # a stalled or drawn counter cannot name a rate
    return 1e9 / step_ns


def rate_reality(night_dir: str, devices: list[dict]) -> list[dict]:
    """Per stream: the rate ASKED FOR against the rate the file actually carries.

    Exists because "ready for any Hz" is a property nothing else in this reporter checks. Coverage does
    notice a rate swap, but only as a side effect and with the wrong name: at a configured 176 Hz that
    silently recorded 55, delivered rows are 31 % of expected, so the stream reports `degraded` — which
    reads as "the radio dropped packets" when the truth is "the rate you asked for was refused". One is
    a link fault you might chase for hours; the other is a one-line config answer.

    ⚠️ `matches_config` IS NOT A FAULT FLAG, and nothing gates on it. A user may change a device's rate
    at any time, for any sensor, and a future sensor may offer rates nobody has documented — so the
    capture must simply RUN at whatever arrives, and it does: coverage divides by the measured rate,
    back-timing uses the negotiated one, and the optical worn detector refuses outside its calibrated
    domain rather than guessing. A disagreement here means "the config no longer describes this
    device", which is information about the CONFIG, not a defect in the night.

    It is still worth reporting, because the one case that does cost a night is invisible otherwise: a
    rate that was ASKED for and silently refused (`polar_pmd`'s SDK-MODE trap 2, where 0x0C reads as
    transient and the whole night records at 55 Hz believing it asked for 176). Saying "you got 55, you
    configured 176" is a one-line answer; leaving it to coverage names it `degraded` and sends you
    after the radio.

    False only when both numbers exist and differ by more than 10 % — far wider than any crystal error
    (tens of ppm), far narrower than any step on a device menu (28/44/55/135/176). None where either is
    unknown: an unmeasurable rate is not a pass, and a stream with no `sensor timestamp` column is not
    judged at all rather than judged wrong. A device with no configured rate is likewise unjudged,
    which is the correct answer for a sensor this suite has never seen.
    """
    out = []
    try:
        names = sorted(os.listdir(night_dir))
    except OSError:
        return out
    for dev in devices or []:
        for stream in sorted((dev.get("streams") or [])):
            want = _expected_hz(dev, stream)
            suffix = "_" + stream.upper() + ".txt"
            cand = [n for n in names if n.endswith(suffix) and _dev_matches(n, dev)]
            if not cand:
                continue
            # the LARGEST file of the session — the shortest ones are re-connect fragments whose few
            # hundred rows cannot settle a rate, and would report a spurious mismatch
            path = max((os.path.join(night_dir, n) for n in cand), key=lambda p: _size(p))
            got = measured_hz(path)
            ok = None
            if got is not None and want:
                ok = bool(abs(got - want) <= _RATE_MISMATCH_TOL * want)
            out.append({
                "device": dev.get("name") or dev.get("model") or "?",
                "stream": stream,
                "requested_hz": want,
                "measured_hz": None if got is None else round(got, 2),
                "matches_config": ok,
            })
    return out


def _size(p: str) -> int:
    try:
        return os.path.getsize(p)
    except OSError:
        return 0


def _dev_matches(name: str, dev: dict) -> bool:
    """Does this filename belong to this configured device? Matches on the device id when one is set,
    since two Polar devices in one night differ only by that field."""
    did = str(dev.get("device_id") or "")
    if did and did in name:
        return True
    if did:
        for alias in dev.get("device_id_aliases") or []:
            if str(alias) and str(alias) in name:
                return True
        return False
    model = _model_of(dev).lower()
    return model in name.lower() or (model == "verity" and "veritysense" in name.lower())


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


def newest_data_mtime(night_dir: str) -> float | None:
    """Newest mtime among this folder's DEVICE-CAPTURE files, or None if it holds none.

    Sidecars are excluded deliberately, and that exclusion is the whole point. LINK/CLOCK roll on the
    WALL CLOCK, so at 00:00 the box creates tomorrow's folder and writes sidecars into it while every
    sensor keeps appending to the session's START-date folder. That decoy folder is `active` (it is
    being written) and lexically newer, so picking the current night by name lands on a folder holding
    no data at all — which is exactly how QC came to report nine missing streams on 2026-07-28 against
    942 MB of healthy tri-device recording. A sidecar is the box talking about itself; only a capture
    file is evidence that a SESSION lives here.

    Cheap: listdir + stat, never a read. Callers scan at most the handful of nights that are active."""
    newest = None
    try:
        names = os.listdir(night_dir)
    except OSError:
        return None
    for n in names:
        if n == _SUMMARY_NAME:
            continue
        parsed = parse_capture_name(n)
        if not parsed or parsed[0] in _SIDECAR_TAGS:
            continue
        p = os.path.join(night_dir, n)
        try:
            if os.path.isfile(p):
                m = os.path.getmtime(p)
                newest = m if newest is None else max(newest, m)
        except OSError:
            continue
    return newest



# The averaging time TDEV is quoted at, in SECONDS, for every stream alike. A fixed tau is the whole
# point: read at each stream's OWN optimal tau the ordering INVERTS — measured on the real corpus,
# H10 3.4 ms vs Verity 0.85 ms per-stream flips to H10 ~2.0 vs Verity ppg ~3.5 at a common tau. A
# per-stream tau yields two numbers that cannot be compared while looking exactly like two that can.
# 300 s sits past the short-tau jitter and is short enough that the corpus streams support it.
# ⚠️ The `ppi` stream is NOT comparable on this axis at any tau — it is a derived interval series
# rather than an arrival series, and reads white-frequency at ~5 s.
_TDEV_TAU_S = 300.0


def _tau0_of(pairs) -> float:
    """Mean packet interval in SECONDS — ADEV's sample interval. Measured from the HOST stamps, which
    are the axis this phase series is indexed on; taking it from the device would let a stalled counter
    shrink its own tau0 and silently rescale the whole curve."""
    if len(pairs) < 2:
        return 0.0
    return ((pairs[-1][0] - pairs[0][0]) / 1000.0) / (len(pairs) - 1)


def host_jitter(delays: list[float], min_n: int = 100) -> dict | None:
    """HOST-SIDE delivery jitter per packet, in ms. None when there are too few packets to say.

    THE DEVICE CLOCK SUPPLIES THE EXPECTED CADENCE, so this needs no sample rate and is correct at any
    Hz by construction. Each sidecar row carries both clocks, and `delays` is already
    `arrival - device`; differencing consecutive rows cancels the device's own cadence and leaves

        (arrival_i - arrival_i-1) - (device_i - device_i-1)

    which is what the HOST added between two packets the device emitted on schedule — scheduling
    latency, BLE stack delay, radio retries. A rate change moves the packet period and does not touch
    this, which is the property that matters when the same night may run at 55 or 176 Hz.

    ⚠️ It is deliberately NOT folded into any pass/fail. Jitter is one-sided-ish and bursty, and the
    first arrival check shipped with a threshold (`floor_ok < 5 ms`) that fired on every stream of the
    first real night because the premise was unreachable. This reports the distribution and lets a
    reader judge; a bar can be added once there is more than one night of it.

    `iqr` is the everyday spread; `p99` and `worst` are where a wedged stack or a competing radio shows
    up, and those are the ones that move a PAT measurement rather than merely widening it.
    """
    if not delays or len(delays) < min_n:
        return None
    d = [delays[i] - delays[i - 1] for i in range(1, len(delays))]
    s = sorted(d)
    n = len(s)
    q = lambda p: s[min(n - 1, int(p * n))]  # noqa: E731 - a local quantile, not worth a helper
    return {
        "n": n,
        "iqr_ms": round(q(0.75) - q(0.25), 2),
        "p99_ms": round(q(0.99), 2),
        "worst_ms": round(max(abs(s[0]), abs(s[-1])), 2),
    }


def arrival_quality(night_dir: str) -> list[dict]:
    """Per-device floor quality from the `*_PMDARRIVAL.csv` sidecars.

    `min(arrival - device)` is the offset estimator only where the distribution has a genuine lower
    EDGE. The measurement that proves it does is the gap between the minimum and a low quantile: on the
    back-timed per-sample stamps this sidecar replaces, that gap ran 27-115 ms — a smear, not a floor.
    A real floor has the two nearly coincident.

    Ring rows are reported but NOT floor-judged: `duration` is quantised to 1 s, and the spread between
    its minimum and a low quantile is then a property of the quantum rather than of the link, so the
    smear verdict does not mean there what it means elsewhere. Judging it by the same rule would
    manufacture a failure every night.

    `offset` carries the actual estimate, from `clock_offset.estimate`, and it runs on EVERY device
    including the ring — counter quantisation and BLE buffering are both one-sided positive, so one
    lower envelope serves both. It is what a consumer should spend. `floor_*` stays as the smear
    diagnostic that showed the per-sample stamps were unusable, and remains ring-exempt.

    ⚠️ The two answer DIFFERENT questions and will not agree on a night with any skew, because
    `floor_ms` has no time model: it returns one number for a quantity that moved across the recording.
    Measured on a real 8 h H10 capture it sat 242 ms from the fitted value, against PAT's 10 ms budget.
    Prefer `offset`; read `floor_ok` as "did this stream have an edge at all".

    ## THE PACKET-FILL TERM, and why the pairing uses `last_sensor_ns` (first real night, 2026-08-11)

    A BLE packet carries many samples and is delivered once, so its arrival stamp follows its LAST
    sample. Pairing against the first therefore adds the packet's fill duration to every delay — and
    that duration belongs to the STREAM, not the link, so two streams of one device disagree by
    exactly the difference in their fill times:

    |            | mean fill | offset via `first` | offset via `last` |
    |------------|-----------|--------------------|-------------------|
    | H10 acc    |  689.9 ms | 460.2              | **-229.4**        |
    | H10 ecg    |  553.8 ms | 325.1              | **-228.7**        |
    | Verity acc | 2155.0 ms | 1887.8 (uncertified)| **691.9**        |
    | Verity ppg |  657.9 ms | 1152.4 (uncertified)| **696.3**        |

    The H10's fill difference is 136.1 ms and its first-based spread was 135.1 ms — the anomaly is the
    fill term, to within a millisecond. Switching to `last` collapses the same-device spread from
    135.1 to **0.7 ms** (H10) and 735.4 to **4.4 ms** (Verity), and takes Verity from certifying on
    NEITHER stream to certifying on BOTH. The two devices are then on one host clock and differ by
    ~923 ms — the per-connection inter-device offset `PAT-PACKET-ARRIVAL` §1 called unmeasurable.

    The ring is unaffected: its writer passes the same `_dur_ns` as both first and last.
    """
    import csv as _csv
    out = []
    try:
        names = [n for n in sorted(os.listdir(night_dir)) if n.endswith("_PMDARRIVAL.csv")]
    except OSError:
        return out
    for name in names:
        path = os.path.join(night_dir, name)
        per: dict[tuple[str, str], list[float]] = {}
        try:
            with open(path, newline="") as fh:
                for row in _csv.DictReader(fh, delimiter=";"):
                    # PAIR AGAINST THE **LAST** SAMPLE IN THE PACKET, not the first. The arrival is
                    # stamped when the packet LANDS, which is after every sample in it — so
                    # `arrival - first_sensor_ns` carries the whole packet-FILL duration as spurious
                    # delay, and that duration is a property of the STREAM (its rate and frame size),
                    # not of the link. Measured on the first real night: see the module note below.
                    # `first_sensor_ns` is the fallback only because a row must not be dropped for
                    # lacking a column the ring path happens to write identically to both.
                    ns = row.get("last_sensor_ns") or row.get("first_sensor_ns") or ""
                    ts = row.get("Phone timestamp") or ""
                    if not ns or not ts:
                        continue                      # blank is "absent", never a fabricated 0
                    try:
                        host_ms = datetime.fromisoformat(ts).timestamp() * 1000.0
                        per.setdefault((row.get("device", ""), row.get("meas", "")), []).append(
                            (host_ms, host_ms - int(ns) / 1e6))
                    except (ValueError, TypeError):
                        continue
        except OSError:
            continue
        for (device, meas), pairs in sorted(per.items()):
            quantised = meas.endswith("_DURATION_S")
            diffs = [d for _, d in pairs]
            est, spread = (None, None) if quantised else writers.PmdArrivalLogWriter.floor_ms(diffs)
            # t relative to this stream's first packet, in seconds — the estimator quotes its offset at
            # the centroid of t, so the absolute host epoch must not leak into the fit.
            t0 = pairs[0][0]
            offset = clock_offset.estimate([((h - t0) / 1000.0, d) for h, d in pairs])
            out.append({
                "file": name, "device": device, "meas": meas, "rows": len(diffs),
                "quantised": quantised,
                "offset": offset,
                "jitter": host_jitter(diffs),
                # CLOCK STABILITY AS A CURVE. `arrival - device` is a phase (time-error) series, ADEV's
                # native input, and the SLOPE names a mechanism where a ppm cannot: measured 2026-08-11,
                # all four Polar streams are white/flicker PHASE (slope -0.99 to -1.00) averaging to
                # 0.023-0.094 ms — the clock sits ~100x inside PAT's 10 ms budget and is not the
                # bottleneck. The ring is white FREQUENCY at 615 ms, four orders worse.
                # THAT ADEV LABEL IS TWO ANSWERS, and `phase_noise` now separates them: ADEV maps white
                # PM and flicker PM both to tau^-1 (26 of 27 corpus streams get the joint label), while
                # MDEV splits them tau^-3/2 vs tau^-1 and resolves 19, refusing 8. The two halves give
                # opposite advice about a longer window, so the joint label could not be acted on.
                # `tdev` is quoted at a FIXED tau for the reason `_TDEV_TAU_S` documents.
                # Reported, gated by NOTHING: the last two arrival diagnostics that shipped with
                # thresholds both fired on every stream of the first real night. See
                # ALLAN-DEVIATION-2026-08-12-BRIEF.
                "stability": allan.stability(diffs, _tau0_of(pairs), _TDEV_TAU_S),
                "floor_spread_ms": None if spread is None else round(spread, 1),
                # The verdict a reader should branch on. None where it cannot be judged — an unknown is
                # not a pass, and the earlier attempt's whole failure was reporting a number that had
                # not earned one.
                "floor_ok": None if spread is None else bool(spread < 5.0),
            })
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
    searched = [night_dir]
    prev_data = None
    if data:
        earliest = min(f["session"] for f in data)
        midnight = _midnight_of(night_dir)
        _pool = midnight is not None and 0 <= earliest - midnight < _SESSION_GAP_SEC
        if not _pool and prev_probe_window(earliest, midnight):
            # THE NEAR-MIDNIGHT PROXY IS NOT THE QUESTION. "Did this folder open just after midnight"
            # only ever stood in for "does last night's session continue into this folder", and the two
            # part company the moment a device takes longer than the gap to reconnect. Real case,
            # 2026-07-28: the H10 dropped at 01:08:10 and came back at 01:08:59 — 4101 s past midnight,
            # 501 s over _SESSION_GAP_SEC — so its 107 MB 01:08→05:03 half landed in tomorrow's folder
            # with pooling switched off. The night was then judged TWICE and wrong both times: the
            # 07-28 folder saw ecg 0.53 with 3.4 h "silent" and ok=false, the 07-29 folder saw ecg 1.0
            # but no Verity or O2Ring at all (coverage {}). A complete 7.7 h tri-device night read as
            # two broken halves, and the alert fired on the half that looked worse.
            #
            # So ASK the neighbour instead of guessing from the clock: pool when its last write actually
            # runs into this folder's earliest session, within the same gap that defines a session
            # everywhere else in this file. Contiguity is the property the proxy was approximating, and
            # unlike the proxy it does not care how long the reconnect took.
            # _prev_day_dir cannot be None here: prev_probe_window already required a parseable
            # midnight, which is the same folder-name parse. No dead guard for an unreachable state.
            prev_data = [f for f in scan_night(_prev_day_dir(night_dir)) if f["stream"] not in _SIDECAR_TAGS]
            if prev_data:
                _pool = 0 <= earliest - max(f["mtime"] for f in prev_data) < _SESSION_GAP_SEC
    else:
        # NO CAPTURE FILES HERE AT ALL. The old gate was `if data:`, so this branch could not run — and
        # it is precisely the 2026-07-28 shape: the midnight sidecar rollover creates tomorrow's folder,
        # QC is pointed at it, and the pooling built to measure a cross-midnight session whole is skipped
        # because the folder it was asked about is empty. An empty folder is the STRONGEST reason to look
        # next door, not a reason to stop. (capture._current_night now prefers the folder with the newest
        # DATA write, so QC should rarely land here — this is the second line of that defence, because a
        # single resolver getting it right is a hope and two independent ones agreeing is a property.)
        _pool = True
    if _pool:
        prev = _prev_day_dir(night_dir)
        if prev:
            searched.append(prev)
            if prev_data is None:
                prev_data = [f for f in scan_night(prev) if f["stream"] not in _SIDECAR_TAGS]
            data = prev_data + data
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
    # Read every stream's ACTUAL rate once, up front: the coverage loop below divides by it, and the
    # same rows are reported as `rates` so a mismatch against the config is visible on its own terms.
    _rate_rows = rate_reality(night_dir, devices)
    _measured_hz_of = {(r["device"], r["stream"]): r["measured_hz"]
                       for r in _rate_rows if r.get("measured_hz")}
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
            # THE MEASURED RATE WINS. Coverage asks "did we receive the packets the device was
            # SENDING"; whether it was sending at the rate we asked is a different question, answered
            # separately by `rates` below. Dividing by a configured value conflates the two and names
            # the wrong fault: a Verity that recorded 55 Hz under a 176 Hz config delivers 31 % of the
            # configured expectation and reports `degraded`, which reads as dropped packets and sends
            # you after the radio. Against the rate it actually ran at, delivery is ~100 % and the
            # rate mismatch is reported as a rate mismatch.
            #
            # NOT tautological: `measured_hz` reads a contiguous head of the file (median inter-sample
            # delta over ~4000 rows), while coverage counts EVERY row against the whole session span —
            # so a stream that dies at hour one still reports low coverage at its own correct rate.
            hz = _measured_hz_of.get((name, s)) or _expected_hz(d, s)
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
        # Reported beside the capture verdict, never folded into it — see the note on system_file_drift.
        "system_files": system_file_drift(),
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
        # THE SCOPE THIS VERDICT RESTS ON, REPORTED RATHER THAN IMPLIED. On 2026-07-28 the summary
        # already carried the tell — `files: 2`, both sidecars — and nothing said what that meant, so a
        # scope failure read as nine simultaneous device failures. A verdict that cannot be audited
        # against the ground it was computed from is a claim, not a measurement.
        "judged_dir": os.path.basename(night_dir.rstrip("/")),
        "searched_dirs": [os.path.basename(p.rstrip("/")) for p in searched],
        "data_files": len(data),
        # NINE INDEPENDENT STREAMS ACROSS THREE VENDORS DO NOT FAIL IN THE SAME SECOND. When the scope
        # we searched holds no capture file at all, "every stream is missing" is a statement about where
        # we looked, not about the hardware — and must never be dressed up as the latter. `missing` is
        # still populated (it is honestly what this scope contains); this flag says do not read it as a
        # device fault, and it is what any consumer — human or automated — must branch on first.
        "scope_suspect": bool(devices) and not data,
        # A hole in the night is a reason to look, exactly like a missing or degraded stream. `ok` is a
        # claim about THE NIGHT; if half of it was excluded from the judgement, the claim is unsupported.
        "ok": not missing and not degraded and not gaps,
        # THE ARRIVAL SIDECAR IS ONLY WORTH WRITING IF ITS EDGE IS AN EDGE (PAT-PACKET-ARRIVAL §3).
        # It exists so `min(arrival - device)` recovers the per-connection BLE offset, which works only
        # because buffering is one-sided. If a night's distribution comes back SMEARED anyway — a wedged
        # stack, a clock step, a device that batches differently — the number is unusable, and without
        # this check that would surface weeks later in an analysis rather than the morning after.
        # Reported, never folded into `ok`: a smeared floor is a defect of the OFFSET measurement, not of
        # the night's physiology, and conflating the two would make a perfectly good recording read as a
        # capture failure.
        "arrival": arrival_quality(night_dir),
        # What rate the files ACTUALLY carry, against what was asked for. Coverage notices a rate swap
        # only as `degraded`, which names it a link fault; this names it a rate fault.
        "rates": _rate_rows,
    }
