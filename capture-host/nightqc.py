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
import cmath
import math
import os
import logging
import subprocess

import allan
import clock_offset
import writers
from datetime import datetime, timedelta

log = logging.getLogger("tepna-capture")

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


# ── THE NIGHT BAND ──────────────────────────────────────────────────────────────────────────────────
# A capture SESSION is not a night. Contiguity was a workable proxy while the box recorded only at night;
# under continuous recording a 1 h gap almost never splits, so sessions measured 31.73 h, 16.24 h and
# 20.39 h on 2026-08-13/14/15 — QC called a 31.7-hour block "the night".
#
# ⚠️ THE FOLDER PROBLEM IS ALREADY SOLVED and this is NOT that. Sessions merge across midnight and
# `searched_dirs` spans both folders (QC-SCOPE-RESOLUTION-2026-07-28); all three judged sessions above
# cross midnight correctly. What remains is day-vs-night INSIDE one contiguous session.
#
# 20:00 -> 10:00 deliberately WIDE. Measured over 28 nights (HRVDEX-ALL-NIGHT-SCOPE-2026-07-20): 27
# started 21:00-23:00 and one started at 01:06, and a `getUTCHours() < 10` "morning only" rule kept 1 of
# 28. A band fitted to the mode drops the outlier night entirely, which is the failure this inherits
# rather than repeats. 14 h is longer than anyone sleeps ON PURPOSE — it bounds where a night may fall,
# it does not claim the subject was in bed for it.
_NIGHT_BEGIN_H = 20
_NIGHT_END_H = 10


def night_band(ts: float) -> tuple:
    """The [begin, end) night band containing `ts`, as epochs.

    Anchored on the EVENING date: a stamp at or after 20:00 belongs to the band starting that evening, a
    stamp before it belongs to the previous evening's. So 02:42 and 22:30 either side of one midnight
    land in the SAME band, which is the whole point.

    ⚠️ Naive local arithmetic, matching `_midnight_of` — an hour off on the two DST changeover days a
    year. Bounded and benign for a band this wide; a 14 h window does not care about one hour.
    """
    d = datetime.fromtimestamp(ts)
    anchor = d.date() if d.hour >= _NIGHT_BEGIN_H else (d - timedelta(days=1)).date()
    begin = datetime.combine(anchor, datetime.min.time()).timestamp() + _NIGHT_BEGIN_H * 3600.0
    return begin, begin + (24 - _NIGHT_BEGIN_H + _NIGHT_END_H) * 3600.0


def _overlap(a0: float, a1: float, b0: float, b1: float) -> float:
    """Seconds two intervals share; 0 when they do not touch."""
    return max(0.0, min(a1, b1) - max(b0, a0))


def _gap_class(excluded: list, b0: float, b1: float) -> str:
    """Is excluded capture a HOLE IN THIS NIGHT, or capture lying outside the judged night's band?

    `excluded` is the list of sessions left out of the judgement; `b0`/`b1` are the night band of the
    session that WAS judged. Returns `"in-night"` or `"outside-band"`.

    ⚠️ THE CLASS IS "outside-band", NOT "daytime", AND THE DIFFERENCE IS REAL. `FINISHED-WORK` §D
    words this as "in-night hole vs post-night daytime", but the test that actually discriminates is
    placement against THE JUDGED NIGHT'S band, and something can be outside it while being the middle
    of the night — a 00:15 sitting belongs to the PREVIOUS night's band, not to the day. Labelling it
    "daytime" would state a fact not in evidence. What is in evidence is that it does not bear on the
    night being judged, which is the only thing `ok` needs.

    ⚠️ FAILS CLOSED, and every branch here is that rule. Any excluded session overlapping the band —
    including one merely straddling its edge — makes the whole entry `in-night`. Only when EVERY
    excluded session lies wholly outside the band is it out of scope. A band that is not a band
    (`b1 <= b0`) classifies as in-night, because a rule that cannot see must not grant a green.

    The asymmetry is deliberate: this function's only power is to turn a red into a labelled green, so
    it may act on positive evidence that the excluded time was outside the night, never on absence.
    That is the same posture as `unarchived_nights` — a second copy you can currently SEE."""
    if not (b1 > b0):
        return "in-night"
    for sess in excluded:
        if _overlap(sess[0], sess[1], b0, b1) > 0:
            return "in-night"
    return "outside-band"


def night_view(session, files) -> "dict | None":
    """What of a session actually fell in the night band — span, and rows APPORTIONED to it.

    ⚠️ **Rows are apportioned PRO RATA over each file's own span, not counted.** QC reads filenames and
    counts newlines; it never parses a timestamp (that is what makes it cheap enough to run every ten
    minutes), so it cannot know WHICH rows fell inside the band. Each file contributes
    `rows * overlap(file, band) / file_span`, which assumes a roughly uniform row rate WITHIN one file —
    true for a capture stream, and the assumption is stated here rather than hidden because it is the
    one thing that could make these numbers wrong.

    Measured 2026-08-13..15: a 20.39 h session becomes a 10.42 h night carrying 63 % of its rows, while a
    3.35 h session that was entirely night reads 1.00.

    ⚠️ **REPORTED, NOT JUDGED.** `ok`, `coverage` and `missing` are deliberately untouched. Flipping the
    verdict onto this changes every number in an alarm with no ground truth to validate against; the
    band and the pro-rata assumption should be watched on real nights first. Same stance as
    `system_files`.
    """
    if not files:
        return None
    s0, s1 = session[0], session[1]
    b0, b1 = night_band((s0 + s1) / 2.0)
    span = _overlap(s0, s1, b0, b1)
    rows = 0.0
    for f in files:
        st = f.get("session")
        if st is None:
            continue
        dur = float(f.get("span_sec") or 0.0)
        if dur <= 0:
            rows += f["rows"] if b0 <= st < b1 else 0.0      # a zero-span file is a point in time
            continue
        rows += f["rows"] * _overlap(st, st + dur, b0, b1) / dur
    total = sum(f["rows"] for f in files)
    return {"begin": round(b0), "end": round(b1), "span_sec": round(span),
            "rows": round(rows), "row_fraction": (rows / total) if total else None}


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
        # errors="replace", like every other text reader here: invalid bytes must degrade to a
        # row that fails to parse (already handled, and bounded by _RATE_MIN_ROWS below), never
        # to a UnicodeDecodeError — that is a ValueError, so the `except OSError` around this
        # would NOT catch it and one corrupt file would take the whole night's QC with it.
        with open(path, encoding="utf-8", errors="replace") as fh:
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
                    continue          # BOUNDED BY A FLOOR, which is why this one stays quiet: if
                                      # enough rows drop, `len(ns) < _RATE_MIN_ROWS` refuses below
                                      # and returns None rather than a rate built from scraps
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


def _rate_key(dev: dict) -> str:
    """The identity `rate_reality` files a measurement under, and `summarize` looks it up by.

    ⚠️ SHARED SO THE TWO CANNOT DISAGREE — they did. `rate_reality` keyed its rows
    `dev.get("name") or dev.get("model") or "?"` while `summarize` looked up
    `d.get("name") or d.get("device_id")`. Identical for a NAMED device, and for a nameless one the
    measurement is filed under the model and sought under the id, so it is never found: coverage
    falls back to the CONFIGURED rate, which is exactly the failure `measured_hz` exists to catch
    ("you asked for 176 and recorded 55"). A nameless device is a supported shape — `summarize`'s own
    `or did` fallback is what says so.

    Same reasoning as `merge_sessions` being shared by `summarize` and `timeline.build` "so the two
    cannot disagree about what the session is" — they had, and the fix was one definition rather than
    two that happen to match.

    ⚠️ THE `device_id` FALLBACK IS NOT COVERED BY A TEST, and saying so is the point. Once both callers
    share this function they agree whatever it returns, so the clause cannot change a lookup — it only
    keeps two devices with NEITHER a name NOR a model from both keying to "?" and shadowing each
    other's measurement. That scenario is real but I could not build it with the current fixture
    harness in reasonable time, so the clause is defensive and UNVERIFIED rather than proven. It is
    kept because removing a guard one failed to test is not the same as showing it unnecessary."""
    return dev.get("name") or dev.get("model") or dev.get("device_id") or "?"


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
                "device": _rate_key(dev),
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
            # NOT a partial total — a WRONG ANSWER. Skipping a file makes the night look OLDER than
            # it is, and the caller uses this to decide which night is the active one. Rare enough
            # (per file, not per row) that saying so costs nothing.
            log.warning("night-QC: %s is unreadable, so it cannot age this night", p, exc_info=True)
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

# Bin width for putting two streams of one device on ONE grid, in seconds. `gcov` requires both series
# sampled at the same instants and refuses unequal lengths; two BLE streams never are, so they are
# averaged into fixed absolute bins first. 1 s is chosen because every stream here delivers at least one
# packet per second, so a bin is a mean rather than an interpolation of an absent sample.
_TRANSPORT_BIN_S = 1.0


def _phase_grid(pairs, bin_s=_TRANSPORT_BIN_S):
    """`arrival - device` averaged into fixed ABSOLUTE bins, keyed by bin index.

    Absolute rather than per-stream-relative: the two streams start at different instants, and a
    relative index would align bin 0 of one with bin 0 of the other — i.e. compare different times
    while producing a perfectly well-formed number.
    """
    acc: dict[int, list[float]] = {}
    for host_ms, phase, *_ in pairs:
        acc.setdefault(int(host_ms / 1000.0 / bin_s), []).append(phase)
    return {k: sum(v) / len(v) for k, v in acc.items()}


def _fisher_ci(r, n_eff, z=1.96):
    """95 % interval for a correlation via the Fisher z transform, or None.

    `r` is bounded [-1, 1] but atanh diverges at the ends, so a degenerate +/-1 yields None rather than
    an infinite bound — that is a pair with no independent information left, not a perfect measurement.
    Needs `n_eff > 3` because the transform's SE is `1/sqrt(n_eff - 3)`.
    """
    if n_eff is None or n_eff <= 3 or not -1.0 < r < 1.0:
        return None
    zr = math.atanh(r)
    se = 1.0 / math.sqrt(n_eff - 3)
    return [math.tanh(zr - z * se), math.tanh(zr + z * se)]


def transport_share(pairs_a, pairs_b, bin_s=_TRANSPORT_BIN_S):
    """How much of one stream's arrival ADEV is SHARED with a sibling stream of the same device.

    ADEV squares a single series, so it reports clock + that stream's own packet-arrival noise and
    cannot separate them. Two streams of one device share the device clock and the host, and carry
    independent per-packet noise, so `allan.gcov` of the pair keeps the shared part and averages the
    rest away. `shared` = gdev/adev is therefore the fraction of the single-stream figure that is NOT
    per-stream noise. Measured on 2026-08-14: H10 ecg-vs-acc **0.71**, Verity ppg-vs-acc **0.33** at
    1 s — i.e. two thirds of the Verity's single-stream ADEV is not clock at all.

    ⚠️ **A FLOOR on the shared part, not a clock measurement.** Both streams ride the SAME BLE
    connection, so arrival jitter common to a connection event is shared and is retained rather than
    rejected — `gcov` cannot tell shared clock from shared measurement noise. Read it as "at least this
    much of the ADEV is per-stream noise", never as "the clock is this stable".

    **`corr` IS A CORRELATION COEFFICIENT, normalised by the GEOMETRIC MEAN of the two ADEVs**, so
    Cauchy-Schwarz bounds it to [-1, 1] by construction and `corr**2` is the shared VARIANCE fraction.

    ⚠️ It replaces a `shared` field that divided by ONE channel's ADEV. That is not a presentation
    change: measured over all 70 device-fragments in the box corpus, the old form ran -1.914 to +2.071
    with **4 of 70 outside [-1, 1]** — values a shared fraction cannot take. The same 70 under this
    normalisation run -0.385 to +0.969, none outside. The impossible readings were the normalisation,
    not small-sample noise, and an n-floor would have hidden them while leaving them reachable at any n.
    The key was RENAMED rather than redefined so no consumer silently receives a different quantity.

    Read it on the VARIANCE scale: the corpus median is `corr` 0.042, i.e. ~96 % of a typical fragment's
    arrival variance is per-stream transport noise. The deviation scale compresses this misleadingly —
    a 5 % shared variance shows as 0.22 — which is why the ratio is no longer published rooted.

    `ci` is the **Fisher z** 95 % interval, or None where the pair cannot support one.

    ⚠️ **`n_eff`, NOT `n`, feeds that interval, and it is deliberately conservative.** Overlapping Allan
    second differences reuse most of the same samples, so the `n` terms are far from independent and a
    Fisher z over `n` would be far too tight — the same effective-degrees-of-freedom problem
    `allan.classify` refuses to hand-roll. `n_eff` counts NON-OVERLAPPING second differences (each spans
    `2m+1` samples), which under-states the information and so errs wide. It is a stand-in for a proper
    EDF treatment, not one; a wide honest interval is publishable, a narrow wrong one is not.
    """
    ga, gb = _phase_grid(pairs_a, bin_s), _phase_grid(pairs_b, bin_s)
    keys = sorted(set(ga) | set(gb))
    # ONE series feeds the covariance AND both denominators: only bins where BOTH streams delivered.
    # Taking each ADEV over its own bins instead makes `shared` a ratio between two different series —
    # measured 2026-08-14 on the Verity, whose acc covers half the ppg's bins, the numerator ran over
    # 20 955 terms against a denominator over 42 468 and inflated `shared` from 0.259 to 0.319. It
    # under-reports transport noise exactly where the gaps are worst, and it reads as a real result.
    xs = [ga[k] for k in keys if k in ga and k in gb]
    ys = [gb[k] for k in keys if k in ga and k in gb]
    solo_a = allan.adev(xs, bin_s)
    solo_b = allan.adev(ys, bin_s)
    both = allan.gcov(xs, ys, bin_s)
    if not solo_a or not solo_b or not both:
        return None
    at = {p["tau"]: p for p in both}
    tau = solo_a[0]["tau"]
    if tau not in at or not solo_a[0]["adev"] or solo_b[0]["tau"] != tau or not solo_b[0]["adev"]:
        return None
    corr = at[tau]["gcov"] / (solo_a[0]["adev"] * solo_b[0]["adev"])
    m = max(1, int(round(tau / bin_s)))
    n_eff = len(xs) // (2 * m + 1)          # non-overlapping second differences; see the docstring
    return {
        "tau": tau,
        "adev_a": solo_a[0]["adev"],
        "adev_b": solo_b[0]["adev"],
        "gcov": at[tau]["gcov"],
        "corr": corr,
        "n": at[tau]["n"],
        "n_eff": n_eff,
        "ci": _fisher_ci(corr, n_eff),
    }


def _tau0_of(pairs) -> float:
    """Mean packet interval in SECONDS — ADEV's sample interval. Measured from the HOST stamps, which
    are the axis this phase series is indexed on; taking it from the device would let a stalled counter
    shrink its own tau0 and silently rescale the whole curve."""
    if len(pairs) < 2:
        return 0.0
    return ((pairs[-1][0] - pairs[0][0]) / 1000.0) / (len(pairs) - 1)


# ── TIMING UNCERTAINTY, AS A BUDGET RATHER THAN A FLAG ──────────────────────────────────────────────
# INTERDISCIPLINARY-LITERATURE-DIAGNOSIS §2.3 marks measurement-uncertainty propagation MISSING, and its
# sentence is the whole justification for this: *"a binary `trusted` flag cannot distinguish a 1-ms result
# from a 50-ms result."* Everything below was ALREADY MEASURED per stream — delivery jitter, the stamp
# quantum, the oscillator curve — and never combined, so a consumer asking "how well do I know WHEN this
# sample happened?" had to read four diagnostics and guess.
#
# §2.2 is the reason this is a budget and not a correction: a ONE-WAY BLE arrival stamp cannot separate
# device event time, device offset and transport delay without a delay model, a two-way exchange or an
# independent reference (RFC 5905; IEEE 1588-2019). We have none of the three, so the honest output is an
# uncertainty attached to the timestamp we do have — NOT a better timestamp.
_IQR_TO_SIGMA = 1.349          # IQR -> sigma for a normal; robust, and the jitter tail is not normal
_STAMP_QUANTUM_MS = 1.0        # sidecar `Phone timestamp` is whole milliseconds
_RING_QUANTUM_MS = 1000.0      # the O2Ring's duration axis is 1 s quantised — see `quantised`
_UNIFORM_DIVISOR = math.sqrt(12.0)   # GUM 4.3.7: a rectangular half-width a has u = a/sqrt(3), full width w = w/sqrt(12)


def timing_uncertainty(jitter, *, quantised=False, stability=None, tau_s=None):
    """Combined standard uncertainty, in ms, for an event time read off a BLE arrival stamp.

    GUM (JCGM 100:2008) in its plainest form: identify the inputs, express each as a standard
    uncertainty, combine independent ones in quadrature. Returns the COMPONENTS as well as the total,
    because a budget whose terms are hidden cannot be argued with — and the dominant term is the only
    one worth acting on.

        u_delivery   IQR/1.349 of per-packet delivery jitter — measured, and normally dominant
        u_quantum    stamp resolution / sqrt(12), rectangular: 1 ms stamps, or 1 s for the ring's axis
        (the oscillator is NOT here — see `free_run` below and the second warning)

    None when there is no jitter measurement at all: with no delivery term the total would be dominated
    by the quantum and read ~0.3 ms, which is not an honest claim about a link whose real jitter is
    measured in tens of ms. An absent input makes the budget UNKNOWN, not small.

    ⚠️ **THE OSCILLATOR IS DELIBERATELY NOT A TERM HERE, and putting it in was the first draft's error.**
    An arrival-stamped event does not ride the device clock — the HOST stamps it — so nothing free-runs
    and no drift accumulates into that timestamp. The first cut added `adev_min * optimal_tau` and read
    **173 ms for the H10 against a real per-event figure of 34 ms**: it was answering "how far would the
    device clock drift over 24 minutes?", which is a real question and a different one. It is published
    as `free_run`, with the tau it belongs to, so neither can be mistaken for the other.

    ⚠️ Delivery and quantum are treated as independent, which they are: one is link scheduling, the other
    is the stamp's own resolution.

    ⚠️ It is a per-EVENT uncertainty about arrival, not about physiology: it says how well the timestamp
    locates the packet, not how well the packet locates a heartbeat.
    """
    if not isinstance(jitter, dict) or jitter.get("iqr_ms") is None:
        return None
    comps = {}
    comps["delivery"] = float(jitter["iqr_ms"]) / _IQR_TO_SIGMA
    # ⚠️ THAT CONVERSION ASSUMES A NORMAL TAIL, and on this hardware it does not hold. IQR/1.349 is the
    # normal-consistency estimator; it is a robust SIGMA only if the distribution is roughly Gaussian.
    # `excess_kurtosis` is published beside it so the assumption can be CHECKED rather than trusted:
    # measured +1901 (H10 acc), +1400 (ecg), +124 (Verity ppg) against 0 for a normal. Where it is far
    # from 0 this budget UNDER-states the delivery term, and no finite sigma describes the tail — read
    # `allan.mtie` for the bound instead, which assumes no distribution at all (ITU-T G.810).
    # Reported, not judged: nothing here gates on `tail_gaussian`, and the raw number travels with it so
    # a reader can disagree with the bound.
    comps["quantum"] = (_RING_QUANTUM_MS if quantised else _STAMP_QUANTUM_MS) / _UNIFORM_DIVISOR
    total = math.sqrt(sum(v * v for v in comps.values()))
    dominant = max(comps, key=lambda k: comps[k])
    free_run = None
    if isinstance(stability, dict) and stability.get("ok") and tau_s:
        adev = stability.get("adev_min")
        if adev:
            # `allan.adev` divides a MILLISECOND phase series by a SECOND tau, so it is already ms/s and
            # adev*tau is milliseconds — no unit conversion. Reported SEPARATELY with its tau, never
            # folded into u_ms: see the docstring.
            free_run = {"drift_ms": round(float(adev) * float(tau_s), 3), "tau_s": round(float(tau_s), 1)}
    kurt = jitter.get("excess_kurtosis")
    return {
        "u_ms": round(total, 3),
        # Does the delivery term's Gaussian premise hold? |excess kurtosis| < 1 is the conventional
        # "close enough to normal" bound. None when it could not be measured — an unknown tail is not a
        # Gaussian one.
        "tail_gaussian": None if kurt is None else bool(abs(kurt) < 1.0),
        "excess_kurtosis": kurt,
        "components_ms": {k: round(v, 3) for k, v in comps.items()},
        "dominant": dominant,
        # A DIFFERENT QUANTITY, published beside rather than inside: how far the DEVICE clock would drift
        # if ridden free for `tau_s`. It is not part of `u_ms` because an arrival-stamped event does not
        # ride the device clock at all — the host stamps it. Folding it in read 173 ms for the H10 where
        # the real per-event figure is 34, i.e. a 5x overstatement of an uncertainty.
        "free_run": free_run,
        # The share the dominant term contributes to the VARIANCE — the number that says whether
        # attacking it is worth anything. 0.99 means nothing else matters; 0.4 means it is not the story.
        "dominant_share": round((comps[dominant] ** 2) / (total * total), 3) if total else None,
    }


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
    # EXCESS KURTOSIS, so the Gaussian assumption downstream is CHECKABLE rather than implied.
    # `timing_uncertainty` converts `iqr_ms` to a sigma with IQR/1.349, which is only a standard
    # uncertainty if the tail is normal. Measured on the real corpus it is not, by three orders:
    # +1901 (H10 acc), +1400 (H10 ecg), +124 (Verity ppg) against 0 for a normal. Publishing the
    # number beside the sigma is what lets a reader see that, instead of trusting the conversion.
    mean = sum(s) / n
    var = sum((v - mean) ** 2 for v in s) / n
    kurt = (sum((v - mean) ** 4 for v in s) / n / (var * var) - 3.0) if var > 0 else None
    return {
        "n": n,
        "iqr_ms": round(q(0.75) - q(0.25), 2),
        "p99_ms": round(q(0.99), 2),
        "worst_ms": round(max(abs(s[0]), abs(s[-1])), 2),
        "excess_kurtosis": None if kurt is None else round(kurt, 1),
    }


# BLE negotiates its connection interval in units of 1.25 ms, so a recovered period is checkable
# against that grid rather than merely plausible. Measured: H10 45.00 ms (36 units), Verity 30.00 ms (24).
CK_BLE_UNIT_MS = 1.25
# The period must be small enough that the DATA SPANS several of them. Without this the scan returns its
# own upper bound: if one period covers the whole support every value shares a phase and R is trivially
# ~1. A planted 12.5 ms lattice on +/-50 ms support was "recovered" as 300 ms, the edge of the range.
CK_LATTICE_MIN_CYCLES = 4.0
# The scan is O(grid * n) and a night is ~50 000 packets, so the series is strided to this many points.
CK_LATTICE_MAX_POINTS = 4000


def connection_lattice(delays: list[float], *, device_axis_is_clock: bool = True,
                       min_n: int = 300) -> dict | None:
    """Is the host-added delay QUANTISED, and to what period? The BLE connection interval, from data.

    A packet can only be delivered on a connection event, so the delivery delay is not a continuous
    random variable — it is an integer number of connection intervals plus a small residual. This finds
    that period without being told it, by the circular concentration

        R(s) = | mean( exp(2i*pi*x/s) ) |

    which is 1 for a perfect lattice of spacing `s` and ~1/sqrt(n) for anything continuous. `x` is the
    DIFFERENCED delay, the same series `host_jitter` summarises.

    Measured over the real corpus: **H10 R=0.95 at 44.94 ms, Verity ppg R=0.84 at 30.01 ms** — 36 and 24
    exact BLE units. Adding U(0, 45 ms) to the H10 series collapses R from 0.976 to 0.005, which is the
    control that makes the number mean something.

    ⚠️ **THIS IS NOT A BOUND ON THE JITTER, and reading it as one is the mistake to avoid.** The lattice
    sets the GRANULARITY; the width spans many teeth. The robust sigma is 2.6x one interval on the H10
    and 9.6x on Verity ppg. A packet is late by an integer number of connection events, and that integer
    is not small.

    ⚠️ **SUBMULTIPLES ALSO SCORE HIGH, by construction** — every multiple of 45 is a multiple of 22.5 and
    15. The fundamental is the LARGEST period that scores, and it wins on real data because phase error
    scales as 1/s (H10: 0.982 at 45 ms against 0.943 at 22.5 and 0.906 at 15). Reporting a submultiple
    would understate the granularity by an integer factor, so the scan takes the argmax rather than the
    first peak.

    **MEASURED EVERY SESSION, NEVER ASSUMED — the interval is NEGOTIATED per connection.** It is a
    property of this adapter, this stack and this link, not of the device model: swap the dongle, or let
    the peer renegotiate, and it changes. Nothing here carries a default, and the 45/30 ms figures above
    are corpus OBSERVATIONS quoted for the reader, not constants the code consults. `arrival_quality`
    runs this per stream per file, so the value lands in each night's summary and a change of adapter
    shows up as a changed `period_ms` rather than as unexplained jitter.

    Reported, gated by NOTHING — see `host_jitter` for why an arrival diagnostic does not get a threshold.
    """
    if not delays or len(delays) < min_n:
        return None
    # THE DEVICE AXIS HAS TO BE A CLOCK, or this measures the wrong thing. `delays` is
    # `host - device`, and differencing it removes the device's cadence ONLY if the device supplied
    # one. Where the axis is drawn the subtraction injects that instead: a FROZEN stamp reduces the
    # series to raw host inter-arrival times, and a 1 s quantised counter stamps its own quantum on it.
    # Measured on the O2Ring, which is the whole reason this refusal exists: of 28 streams, 19 have a
    # frozen stamp and 9 a 1 s counter — NOT ONE has a real clock, and the scan was returning 6.30 BLE
    # units, a non-integer, at R 0.52. A refusal is the honest answer; a number there is an artifact.
    if not device_axis_is_clock:
        return {"ok": False, "reason": "device-axis-not-a-clock", "n": len(delays) - 1}
    x = [delays[i] - delays[i - 1] for i in range(1, len(delays))]
    srt = sorted(x)
    pick = lambda p: srt[min(len(srt) - 1, int(p * len(srt)))]  # noqa: E731 - local quantile
    spread = pick(0.95) - pick(0.05)
    hi = spread / CK_LATTICE_MIN_CYCLES
    lo = 2.0
    if not (hi > lo):
        return None                      # too narrow to span several periods: see CK_LATTICE_MIN_CYCLES
    step = max(1, len(x) // CK_LATTICE_MAX_POINTS)
    xs = x[::step]
    n = len(xs)
    best_r, best_s = 0.0, None
    grid = 1600
    for i in range(grid):
        s = lo * (hi / lo) ** (i / (grid - 1))
        r = abs(sum(cmath.exp(2j * math.pi * v / s) for v in xs) / n)
        if r > best_r:
            best_r, best_s = r, s
    for i in range(400):                 # refine +/-1.5 % around the coarse peak
        s = best_s * (0.985 + 0.03 * i / 399)
        r = abs(sum(cmath.exp(2j * math.pi * v / s) for v in xs) / n)
        if r > best_r:
            best_r, best_s = r, s
    return {
        "ok": True,
        "period_ms": round(best_s, 3),
        # Whether the period lands on BLE's own 1.25 ms grid is the check that it is a LINK parameter
        # rather than a number the scan liked. Published as the raw ratio, not rounded to an integer.
        "ble_units": round(best_s / CK_BLE_UNIT_MS, 2),
        "R": round(best_r, 3),
        "n": n,
        # Rayleigh: p = exp(-n R^2). It underflows immediately on real data, so the exponent is reported.
        "neg_log10_p": round(n * best_r * best_r / math.log(10), 1),
    }


def device_stamp_constant(stamps, min_n: int = 200):
    """Did this stream's device timestamp advance AT ALL over the capture?

    `clock_offset.estimate` already REFUSES such a stream — a device stamp frozen at one value makes
    `delay = host - const`, whose slope is exactly 1e6 ppm, far past `MAX_PPM`. But it refuses it as
    `implausible-skew`, which describes a clock running 100 % fast. That is not what happened: the field
    is unpopulated. The remedies differ (a skewed clock is a clock; this one is an absent measurement),
    so the distinction is published rather than left to be inferred from a suspiciously round slope.

    Measured over 470 streams / 5 nights: **22 of the 23 refusals are this**, not skew — every Verity
    `ppi` stream (`last_sensor_ns` literally 0 for all 4864 packets) and every frozen O2Ring
    `OXYLIVE_DURATION_S`. The one real skew reads 193 892.8 ppm.

    ⚠️ This is NOT a "drawn axis" test, and the statistic that looks like one does not work here. A modal
    delta share over these PACKET-level stamps scores 0.61 on a genuinely healthy H10 ECG clock, because
    its packets are uniformly filled: the modal step is 561.409 ms = 73 samples at 130 Hz, i.e. exactly
    one packet. `ppgdex-dsp.js`'s `quantizedShare >= 0.99` measures per-SAMPLE stamps, a different axis;
    porting that threshold here would name packet-fill uniformity as a synthesised timebase.

    `None` below `min_n` — a handful of packets can repeat a stamp by chance.
    """
    xs = [v for v in stamps if v is not None]
    if len(xs) < min_n:
        return None
    first = xs[0]
    return all(v == first for v in xs)


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
            with open(path, newline="", encoding="utf-8", errors="replace") as fh:
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
                            (host_ms, host_ms - int(ns) / 1e6, int(ns)))
                    except (ValueError, TypeError):
                        continue      # a torn or half-written row is EXPECTED in a live journal and
                                      # is not evidence about arrival quality; `rows` below reports
                                      # how many actually survived to be measured
        except OSError:
            # A whole arrival file lost: every stream inside it silently vanishes from the report,
            # and an absent stream reads the same as one that was never recorded.
            log.warning("night-QC: arrival file %s is unreadable, so its streams are absent from "
                        "this report rather than judged", name, exc_info=True)
            continue
        for (device, meas), pairs in sorted(per.items()):
            quantised = meas.endswith("_DURATION_S")
            stamp_frozen = device_stamp_constant([ns for _, _, ns in pairs])
            diffs = [d for _, d, _ in pairs]
            est, spread = (None, None) if quantised else writers.PmdArrivalLogWriter.floor_ms(diffs)
            # t relative to this stream's first packet, in seconds — the estimator quotes its offset at
            # the centroid of t, so the absolute host epoch must not leak into the fit.
            t0 = pairs[0][0]
            offset = clock_offset.estimate([((h - t0) / 1000.0, d) for h, d, _ in pairs])
            # Hoisted so the uncertainty budget below composes them rather than recomputing.
            jit = host_jitter(diffs)
            stab = allan.stability(diffs, _tau0_of(pairs), _TDEV_TAU_S)
            out.append({
                "file": name, "device": device, "meas": meas, "rows": len(diffs),
                "quantised": quantised,
                    # Explains the refusal above when it is NOT skew: see device_stamp_constant.
                    "device_stamp_constant": stamp_frozen,
                "offset": offset,
                    "jitter": jit,
                # THE GRANULARITY BEHIND THAT JITTER: delivery happens on connection events, so
                # the delay is an integer number of them. See connection_lattice — and note it is
                # a granularity, NOT a bound; the spread covers many teeth.
                    "lattice": connection_lattice(
                        diffs, device_axis_is_clock=not (quantised or bool(stamp_frozen))),
                    # HOW WELL DO WE KNOW *WHEN*? A GUM budget over terms already measured here, so a
                    # consumer gets one number with its parts rather than four diagnostics to weigh.
                    # `tau` is the stability curve's own optimal averaging time — where `adev_min` was
                    # read — so the oscillator term stays self-consistent with the curve it came from.
                    "u_time": timing_uncertainty(jit, quantised=quantised, stability=stab,
                                                 tau_s=(stab or {}).get("optimal_tau")),
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
                    "stability": stab,
                    # IS A SINGLE tau0 EVEN A FAIR LABEL FOR THIS SERIES? `_tau0_of` hands `stability` the MEAN packet
                    # interval, and every estimator in `allan.py` then treats the samples as evenly spaced by it. On the
                    # BLE arrival axis they are not: measured over 120 sidecars, mean/median runs 0.87-1.16 on Verity
                    # ppg (79 series) against <=0.7% on the device-counter axis the JS lane uses — same estimator, same
                    # vocabulary, opposite answer. A UNIFORM rescale of tau is a horizontal shift in log-log, so
                    # `classify`'s noise type is IMMUNE; what moves is where a sigma is READ — `optimal_tau`, and
                    # `_TDEV_TAU_S` comparisons. That last one is the cost: a FIXED tau exists so nights are comparable,
                    # and two streams quoted 'at 100 s' are not at the same 100 s when one tau0 is inflated 16% by gaps.
                    # Reported beside the curve, never applied to it — the unbiased unequal-spacing estimator (Sesia &
                    # Tavella 2008, 10.1088/0026-1394/45/6/S19) is the principled fix and should FOLLOW this measurement.
                    "tau0_uniformity": allan.tau0_uniformity([p[0] for p in pairs]),
                # Filled below where this device has a second stream to compare against; None means
                # "no sibling stream", never "nothing shared".
                "transport": None,
                "floor_spread_ms": None if spread is None else round(spread, 1),
                # The verdict a reader should branch on. None where it cannot be judged — an unknown is
                # not a pass, and the earlier attempt's whole failure was reporting a number that had
                # not earned one.
                "floor_ok": None if spread is None else bool(spread < 5.0),
            })
        # SECOND PASS, per device: how much of each stream's ADEV is its own packet-arrival noise.
        # Needs two streams of one device, so it cannot be computed inside the per-stream loop above.
        # `_DURATION_S` is excluded because the ring's axis is 1 s quantised — pairing against it would
        # measure the quantum rather than the link.
        by_device: dict[str, list[tuple[str, list]]] = {}
        for (device, meas), pairs in per.items():
            if not meas.endswith("_DURATION_S"):
                by_device.setdefault(device, []).append((meas, pairs))
        for device, streams in by_device.items():
            if len(streams) < 2:
                continue
            # The two densest streams: the pair with the most bins in common, without searching.
            streams.sort(key=lambda s: (-len(s[1]), s[0]))
            (first, pairs_a), (second, pairs_b) = streams[0], streams[1]
            share = transport_share(pairs_a, pairs_b)
            if share is None:
                continue
            for rec in out:
                if rec["file"] == name and rec["device"] == device and rec["meas"] in (first, second):
                    mine = "adev_a" if rec["meas"] == first else "adev_b"
                    rec["transport"] = {
                        "tau": share["tau"], "n": share["n"], "n_eff": share["n_eff"],
                        "gcov": share["gcov"],
                        "partner": second if rec["meas"] == first else first,
                        "adev": share[mine],           # THIS stream's own, for scale
                        # SYMMETRIC by construction: the correlation describes the PAIR, so both records
                        # carry the same value. Only `adev` differs between them.
                        "corr": share["corr"],
                        "ci": share["ci"],
                    }
    return out

# ── RING CONTACT FROM THE RAW 0x05 STREAM (PPG2W) ──────────────────────────────────────────────────
# The O2Ring's `cmd 0x05` two-channel stream (identity still open — O2RING-RAW-DUAL-WAVELENGTH) turns
# out to carry one unambiguous fact whichever hypothesis wins: TISSUE IN THE PATH locks the two
# channels to a ~1:1 ratio, and off-finger they diverge by FOUR ORDERS OF MAGNITUDE (ch0 rails toward
# its ceiling while ch1 collapses to ~10^2 counts). That gives the ring an independent hardware-side
# coupling vote where today the SpO2 CSV judges itself and the motion column is per-source-faulty.
#
# MEASURED vs CHOSEN — every constant is labelled, because a fitted number that later reads as a
# discovered one is this repo's recurring failure:
#   PPG2W_CH1_FLOOR = 15388     MEASURED: the geometric midpoint of the doffed-tail ch1 p99 maximum
#                               (355 counts, n = 3 doffings) and the worn ch1 p1 minimum (667,065,
#                               15 sessions). ~43x margin each side — 3.3 orders of TOTAL separation,
#                               1.64 orders per side (the first version said "3 orders each side",
#                               which contradicted the ~40x bar below by ~23x; a reader sizing a
#                               firmware change against it would break the detector an order early).
#                               It becomes WRONG if a firmware/scale change moves either population
#                               by >~40x.
#   PPG2W_RATIO_LO/HI = 0.5/3   CHOSEN: a ~2x margin around the MEASURED worn band (ratio
#                               0.955-1.444 across the 15 derivation sessions). The margin earned its
#                               keep out-of-sample: one held-out 7-min adjustment session reached
#                               1.929 and stayed correctly inside.
#
# VALIDATION, with the denominators beside the rates (the in-sample caveat is structural):
#   derivation (2026-08-05..09, 15 sessions): separates the 3 mid-stream doffings from the 12 other
#     session tails — but the thresholds were DERIVED on these sessions, so that 3/3 + 0/12 is
#     optimistic by construction.
#   HELD-OUT (2026-08-11..16, 14 sessions, 161,811 one-second epochs, thresholds frozen first): the
#     worn band held on every session; 0.49 % of epochs off-finger, concentrated in 0-1 sustained
#     run per session; 6 session tails flagged = the doffing endings, found out-of-sample.
#   POSITIVE EVENTS TOTAL: n = 3 derivation + 6 held-out tails. Small; the 10^4 separation is what
#     carries the claim, not the event count.
#
# Reported, gated by NOTHING (the arrival-diagnostics precedent): a contact verdict folded into `ok`
# would make a night the wearer ended early read as a capture failure.
PPG2W_CH1_FLOOR = 15388
PPG2W_RATIO_LO = 0.5
PPG2W_RATIO_HI = 3.0
_PPG2W_ROWS_PER_EPOCH = 100     # the stream is back-timed on a 10 ms grid -> 1 s epochs
_PPG2W_MIN_EPOCHS = 60          # under a minute cannot establish a worn band -> refuse, never report
_PPG2W_RUN_EPOCHS = 10          # a sustained off-run, vs single-epoch flicker; also the bar for
                                # "ended off-finger" — a tail is a doffing when the trailing off-run
                                # is itself sustained, not when some window's majority tips (a
                                # majority-of-last-minute definition sat exactly on a tie in the first
                                # planted test, which is what a window boundary does)


def ppg2w_contact(ch0, ch1):
    """Worn/off-finger summary from the 0x05 channel pair. PURE — the file walk is in the caller.

    worn(row) := ch1 > PPG2W_CH1_FLOOR and PPG2W_RATIO_LO <= ch0/ch1 <= PPG2W_RATIO_HI.
    An epoch (1 s = 100 rows) is OFF when the MAJORITY of its rows fail that predicate — a single
    glitch row must not flip a second.

    Returns None when fewer than _PPG2W_MIN_EPOCHS epochs exist: a block that cannot be computed is
    ABSENT, never `off_epochs_pct: 0` — zero is the healthy end of that scale, and missing data
    reading as healthy is the exact failure class this file already documents for actigraphy.
    """
    n_ep = min(len(ch0), len(ch1)) // _PPG2W_ROWS_PER_EPOCH
    if n_ep < _PPG2W_MIN_EPOCHS:
        return None
    worn_ratios = []
    ep_off = []
    for e in range(n_ep):
        lo = e * _PPG2W_ROWS_PER_EPOCH
        bad = 0
        for i in range(lo, lo + _PPG2W_ROWS_PER_EPOCH):
            c1 = ch1[i]
            if c1 > PPG2W_CH1_FLOOR and PPG2W_RATIO_LO * c1 <= ch0[i] <= PPG2W_RATIO_HI * c1:
                worn_ratios.append(ch0[i] / c1)
            else:
                bad += 1
        ep_off.append(bad * 2 > _PPG2W_ROWS_PER_EPOCH)
    runs, cur = [], 0
    for off in ep_off:
        if off:
            cur += 1
        else:
            if cur:
                runs.append(cur)
            cur = 0
    if cur:
        runs.append(cur)
    # trailing off-run, in epochs from the end — the caller turns it into a wall-clock doff time
    trail = 0
    for off in reversed(ep_off):
        if not off:
            break
        trail += 1
    tail_off = trail >= _PPG2W_RUN_EPOCHS
    worn_ratios.sort()
    m = len(worn_ratios)
    out = {
        "epochs": n_ep,
        "off_epochs_pct": round(100.0 * sum(ep_off) / n_ep, 2),
        "off_runs_sustained": sum(1 for r in runs if r >= _PPG2W_RUN_EPOCHS),
        "tail_off": tail_off,
        "trailing_off_epochs": trail,
        # The worn band is reported so drift OUT of it is visible before it becomes misses: these two
        # numbers are the detector auditing itself night by night.
        "worn_ratio_median": round(worn_ratios[m // 2], 3) if m else None,
        "worn_ratio_iqr": round(worn_ratios[(3 * m) // 4] - worn_ratios[m // 4], 3) if m >= 4 else None,
    }
    return out


def ppg2w_contact_quality(night_dir: str) -> list:
    """One `ppg2w_contact` block per `*_PPG2W.txt` in the night. Empty list when the stream was not
    captured — nothing to report is not the same as everything healthy, and the key stays honest by
    holding sessions, not a verdict.

    Rows that do not parse as numbers are SKIPPED, not fatal: a mid-file repeated header is a real
    rotation artifact (seen 20260815100132) and one bad row must not erase a session's verdict.
    """
    out = []
    for name in sorted(os.listdir(night_dir) if os.path.isdir(night_dir) else []):
        if not name.endswith("_PPG2W.txt"):
            continue
        ch0, ch1 = [], []
        first_ts = None
        try:
            with open(os.path.join(night_dir, name), "r", encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    parts = line.rstrip("\n").split(";")
                    if len(parts) < 5:
                        continue
                    try:
                        a, b = int(parts[2]), int(parts[3])
                    except ValueError:
                        continue      # a torn row is expected at a live file's tail; the epoch count
                                      # is computed from the rows that parsed, and `_PPG2W_MIN_EPOCHS`
                                      # refuses a block built from too few
                    if first_ts is None:
                        first_ts = parts[0]
                    ch0.append(a)
                    ch1.append(b)
        except OSError:
            log.warning("night-QC: %s is unreadable, so its contact quality is ABSENT rather than "
                        "poor — the two must not read alike", name, exc_info=True)
            continue
        block = ppg2w_contact(ch0, ch1)
        if block is None:
            out.append({"file": name, "usable": False, "reason": f"under {_PPG2W_MIN_EPOCHS} s of rows"})
            continue
        block["file"] = name
        block["usable"] = True
        # Doff wall-clock: first timestamp + (epochs - trailing_off) seconds, on the file's own
        # back-timed axis. Only when the tail IS off — a doff time on a worn tail would be fabricated.
        if block["tail_off"] and block["trailing_off_epochs"] and first_ts:
            try:
                t0 = datetime.fromisoformat(first_ts)
                doff = t0 + timedelta(seconds=block["epochs"] - block["trailing_off_epochs"])
                block["doff_at"] = doff.isoformat(timespec="seconds")
            except ValueError:
                block["doff_at"] = None
        else:
            block["doff_at"] = None
        out.append(block)
    return out


def rtc_drift_summary(path: str) -> dict | None:
    """Roll a `_rtclog.csv` (RingClockLogWriter) into one night's ring-clock verdict, or None when there
    is no readback to summarise. The daemon watches the O2Ring's RTC against the host every ~10 min and
    logs each event; STATUS keeps only the latest, so WITHOUT this the night's drift and any battery-reset
    live only in a CSV nobody opens. Fields: `reads` (periodic readbacks), `drift_s` (last − first
    offset — the free-run the 0xC0 push corrects), `span_h` (first→last read), `resets` (offset jumped
    past threshold = a battery event that silently ruins the stored .dat's timebase), `pushes` (0xC0
    sent). Rows are `Phone timestamp;event;rtc_offset_s;…`; PURE-ish (reads a path)."""
    try:
        lines = open(path, encoding="utf-8", errors="replace").read().splitlines()
    except OSError:
        return None
    offsets: list[float] = []
    times: list[str] = []
    resets = pushes = 0
    for ln in lines[1:]:
        p = ln.split(";")
        if len(p) < 3:
            continue
        event = p[1]
        if event == "push":
            pushes += 1
        elif event == "reset-suspect":
            resets += 1
        if event in ("read", "reset-suspect"):
            try:
                offsets.append(float(p[2]))
                times.append(p[0])
            except ValueError:
                continue              # the returned `reads` IS len(offsets), so a dropped row shows
                                      # up as a smaller read count rather than as a silently
                                      # narrower drift estimate
    if not offsets:
        return None
    span_h = None
    try:
        t0 = datetime.fromisoformat(times[0]).timestamp()
        t1 = datetime.fromisoformat(times[-1]).timestamp()
        span_h = round((t1 - t0) / 3600, 1)
    except ValueError:
        span_h = None
    return {"reads": len(offsets), "first_offset_s": offsets[0], "last_offset_s": offsets[-1],
            "drift_s": round(offsets[-1] - offsets[0], 1), "span_h": span_h,
            "resets": resets, "pushes": pushes}


def dat_timefit_summary(dat_path: str, spo2_path: str,
                        *, node_bin: str = "node",
                        tool_path: str | None = None,
                        timeout_s: float = 30.0) -> dict | None:
    """Fit the O2Ring's onboard `.dat` clock against a same-night live `_SPO2.csv` and return the
    lag verdict, or None when the tool cannot be run.

    FINISHED-WORK-IMPROVEMENTS §B4. `tools/o2ring-dat-timefit.mjs` cross-correlates the two 1 Hz series
    (both record the SAME session — one stored on the ring, one delivered live and host-stamped) and
    returns the integer-second offset that puts the .dat's own axis on host time. That is an
    INDEPENDENT measurement of the same clock error `rtc_drift_summary` reports: they measure the ring
    RTC from opposite ends (readback vs waveform correlation), so if they disagree by more than the .dat
    quantum (1 s) the 0xC0 push isn't landing where the readback says it is.

    Absent from the box's live status because the tool ships as a Node CLI; folded in here via
    subprocess-out so the digest carries both numbers on the same line.

    Returns `{lagS, ok, reason, agree, spo2, pulse}` on success (the tool's own `--json` shape,
    trimmed), or None when Node/tooling is unavailable or refuses. `None` is the ORDINARY case: a box
    without Node, or a fixture without a paired .dat/CSV."""
    if not (dat_path and spo2_path and os.path.exists(dat_path) and os.path.exists(spo2_path)):
        return None
    if tool_path is None:
        # nightqc.py lives at capture-host/nightqc.py; the tool sits at ../tools/o2ring-dat-timefit.mjs
        here = os.path.dirname(os.path.abspath(__file__))
        tool_path = os.path.normpath(os.path.join(here, "..", "tools", "o2ring-dat-timefit.mjs"))
    if not os.path.exists(tool_path):
        return None
    try:
        proc = subprocess.run(
            [node_bin, tool_path, "--dat", dat_path, "--spo2", spo2_path, "--json"],
            capture_output=True, text=True, timeout=timeout_s, check=False,
        )
    except (FileNotFoundError, OSError, subprocess.TimeoutExpired):
        return None
    # exit code 0 = fit ok, 1 = tool refused with `ok:false` and a reason on stdout; anything else is a
    # SHAPE failure (tool crashed, Node missing runtime dep). Trust stdout only when it parses.
    if proc.returncode not in (0, 1):
        return None
    try:
        raw = json.loads(proc.stdout or "{}")
    except (ValueError, TypeError):
        return None
    return {
        "ok": bool(raw.get("ok")),
        # `converged` (tool #1657/#1658): ok means A lag was chosen; converged means the two columns
        # CONFIRM each other within the measured 8 s tolerance. An ok-but-unconverged fit is a
        # single-legged estimate — carried through so the digest can refuse to print it as a
        # measurement, which is the tool's own rule applied one level up. None on an older tool.
        "converged": raw.get("converged"),
        "reason": raw.get("reason"),
        "lag_s": raw.get("chosenLagS"),
        "agree": raw.get("agree"),
        "dat_sec": raw.get("datSec"),
        "csv_sec": raw.get("csvSec"),
    }


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
                # No lower bound, deliberately: a NEGATIVE difference means the neighbour was still
                # writing when this folder's earliest session opened — devices overlapping across the
                # boundary, which is STRONGER contiguity evidence than a gap, not weaker. Multi-device
                # wake makes it the normal case (2026-09-01: the O2Ring's 04:20:53 morning fragment
                # opened while the Verity's night file was written until 04:24; a `0 <=` bound read
                # that −190 s as "not contiguous" and the whole 17-file night went unjudged). Third
                # failed assumption in this guard's family — the near-midnight proxy, the long
                # reconnect (2026-07-28), now the simultaneous wake — and the sentence above already
                # states the contract: "runs into" includes overlap.
                _pool = earliest - max(f["mtime"] for f in prev_data) < _SESSION_GAP_SEC
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
    # Since the two cases cannot be distinguished BY FILE-ACTIVITY SIGNATURE, they are not guessed
    # between: everything is reported. A benign daytime sitting shows up in `gaps` as exactly what it
    # is. Silently keeping the green was the defect.
    #
    # ⚠️ THEY ARE, HOWEVER, DISTINGUISHABLE BY WALL-CLOCK PLACEMENT — and that is a different question
    # from the one the paragraph above answers. Nothing about WHEN a session sits helps decide whether
    # it is "this night, interrupted" or "an unrelated earlier run"; but it does decide whether the
    # excluded time is part of the night being judged at all. An excluded session that overlaps the
    # night band is a HOLE IN THIS NIGHT and must red. One lying wholly outside it is a daytime
    # sitting: real, reportable, and not a defect of the night.
    #
    # This is what made `ok` uninformative. Its own comment above records it false on 20 of the last
    # 20 nights; the session-judging fix removed the spurious `missing`, and this removes the other
    # half — every day carrying any daytime capture still produced a gap, so the alarm stayed on.
    #
    # FAILS CLOSED, deliberately: a session that STRADDLES the band edge counts as in-night, and a
    # night with no judgeable band keeps every gap. The rule may only ever turn a red into a labelled
    # green when it can positively show the excluded time was outside the night — never by absence.
    gaps: list[str] = []
    gaps_in_night: list[str] = []
    if data:
        sessions = merge_sessions(data)
        # ⚠️ JUDGE THE SUBSTANTIVE SESSION, NOT THE MOST RECENT ONE.
        #
        # This used to be `max(sessions, key=lambda s: s[1])` — the session reaching the latest write —
        # on the reasoning that QC runs in the morning, so the newest session IS the night. That was true
        # while the box recorded only at night. It stopped being true when it began recording
        # continuously, and nothing noticed because the failure is silent: a later DAYTIME session simply
        # becomes "current" and the whole night is reported as an excluded gap.
        #
        # Measured 2026-08-15 — the day a Verity sat streaming noise in its charger all morning:
        #     02:42->06:03   2 977 473 rows   <- the night
        #     10:01->12:12   1 716 348 rows   <- JUDGED, and it was the charger
        # H10 and O2Ring were absent from the morning session, so QC reported them `missing` and returned
        # ok=false. It judged the garbage and called the night a hole.
        #
        # That is why `ok` has been false on 20 of the last 20 nights: every day with any daytime capture
        # produces a spurious gap plus a spurious `missing`, and an alarm that is always on carries no
        # information — it could not have told you about the charger, because it says the same thing every
        # other night.
        #
        # ROWS, not duration: duration is inflated by a session that idles across a doffing gap, while
        # rows count what was actually captured. Ties break toward the later session, preserving the old
        # behaviour for the single-session days it was written for.
        cur = max(sessions, key=lambda sess: (sum(f["rows"] for f in sess[2]), sess[1]))
        current = cur[2]
        span = cur[1] - cur[0]
        span = span if span >= _MIN_SPAN_SEC else None
        # ⚠️ EXCLUDED IS EXCLUDED, WHICHEVER SIDE IT SITS ON.
        #
        # This used to look only BEFORE the judged session (`s[1] <= cur[0]`), which was safe while the
        # judged session was always the newest — nothing could come after it. Judging by rows breaks that
        # invariant: a night split by a box-wide outage now judges the BIGGER half, and if that is the
        # earlier one the discarded half sits AFTER it and became invisible. The night would then grade
        # green having thrown away part of itself — exactly the §A2 regression, re-entered through a door
        # the one-sided test could not see. (Reachability is not hypothetical: the measured 2026-07-24
        # box-wide silence ran 58.6 min, 85 s under the split threshold.)
        others = [s for s in sessions if s is not cur]
        if others:
            before = [s for s in others if s[1] <= cur[0]]
            after = [s for s in others if s[0] >= cur[1]]
            # `prior_gap_sec` keeps naming the gap to the nearest EARLIER session, which is what its
            # consumers read; the nearest later one is reported in the message rather than renamed.
            b0, b1 = night_band((cur[0] + cur[1]) / 2.0)
            if before:
                prev = max(before, key=lambda s: s[1])
                prior_gap = cur[0] - prev[1]
                cls = _gap_class(before, b0, b1)
                line = (f"{_hhmm(prev[1])}->{_hhmm(cur[0])} {round(prior_gap / 60)}min gap; "
                        f"{len(before)} earlier session(s), "
                        f"{sum(f['rows'] for s in before for f in s[2])} rows, excluded from coverage"
                        f" [{cls}]")
                gaps.append(line)
                if cls == "in-night":
                    gaps_in_night.append(line)
            if after:
                nxt = min(after, key=lambda s: s[0])
                cls = _gap_class(after, b0, b1)
                line = (f"{_hhmm(cur[1])}->{_hhmm(nxt[0])} {round((nxt[0] - cur[1]) / 60)}min gap; "
                        f"{len(after)} later session(s), "
                        f"{sum(f['rows'] for s in after for f in s[2])} rows, excluded from coverage"
                        f" [{cls}]")
                gaps.append(line)
                if cls == "in-night":
                    gaps_in_night.append(line)
    per_device = []
    newest = max((f["mtime"] for f in current), default=None)
    missing: list[str] = []
    degraded = []
    optional_absent: list[str] = []
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
            hz = _measured_hz_of.get((_rate_key(d), s)) or _expected_hz(d, s)
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
        # RING-CLOCK DRIFT — the O2Ring's `_rtclog.csv` rolled into one verdict (None for non-ring devices
        # and rings on firmware before the readback). Discovered by listing rather than the stream scan,
        # so it does not depend on the scan tagging a sidecar it was written before.
        rtc = None
        # FINISHED-WORK-IMPROVEMENTS §B4 — the independent measurement of the same ring-RTC error, from
        # the OTHER end. If a `_STORED.dat` (onboard pull, ring's own clock) and a `_SPO2.csv` (live BLE,
        # host-stamped) both landed for this device, the JS tool cross-correlates their SpO2 series and
        # returns the integer-second offset that puts the .dat on host time. `qc_digest` flags a
        # disagreement with `rtc.drift_s` (see below); on a well-behaved night the two agree within the
        # .dat's 1 s quantum. None means either sidecar is absent or Node/tool are.
        datfit = None
        dat_path = spo2_path = None
        for fn in sorted(os.listdir(night_dir)) if os.path.isdir(night_dir) else []:
            if writers.file_device_id(fn) not in dids:
                continue
            if fn.endswith("_rtclog.csv") and rtc is None:
                rtc = rtc_drift_summary(os.path.join(night_dir, fn))
            elif fn.endswith("_STORED.dat") and dat_path is None:
                dat_path = os.path.join(night_dir, fn)
            elif fn.endswith("_SPO2.csv") and spo2_path is None:
                spo2_path = os.path.join(night_dir, fn)
        if dat_path and spo2_path:
            datfit = dat_timefit_summary(dat_path, spo2_path)
        per_device.append({"name": name, "streams": streams, "coverage": coverage,
                           "silent_sec": silent, "rtc": rtc, "datfit": datfit})
    return {
        "night": os.path.basename(night_dir.rstrip("/")),
        # Reported beside the capture verdict, never folded into it — see the note on system_file_drift.
        "system_files": system_file_drift(),
        "devices": per_device,
        "missing": missing,
        "degraded": degraded,
        "gaps": gaps,
        # THE SUBSET THAT ACTUALLY BEARS ON THE NIGHT, and the only one `ok` reads. `gaps` stays
        # complete so nothing is hidden — a daytime sitting is still reported, still labelled, and a
        # consumer that wants every exclusion reads `gaps` exactly as before.
        "gaps_in_night": gaps_in_night,
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
        # WHICH session the verdict rests on, on the same principle as `judged_dir`/`searched_dirs`
        # below: a verdict that cannot be audited against the ground it was computed from is a claim.
        "judged_session": {"start": round(cur[0]), "end": round(cur[1]),
                           "rows": sum(f["rows"] for f in cur[2])} if data else None,
        # WHAT OF THAT SESSION WAS ACTUALLY NIGHT. Published beside the session rather than replacing
        # it: under continuous recording the judged session runs 16-31 h, so `judged_session.rows` is
        # not a claim about a night. Reported, gated by NOTHING — see night_view's docstring.
        "night_window": night_view(cur, cur[2]) if data else None,
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
        "ok": not missing and not degraded and not gaps_in_night,
        # THE ARRIVAL SIDECAR IS ONLY WORTH WRITING IF ITS EDGE IS AN EDGE (PAT-PACKET-ARRIVAL §3).
        # It exists so `min(arrival - device)` recovers the per-connection BLE offset, which works only
        # because buffering is one-sided. If a night's distribution comes back SMEARED anyway — a wedged
        # stack, a clock step, a device that batches differently — the number is unusable, and without
        # this check that would surface weeks later in an analysis rather than the morning after.
        # Reported, never folded into `ok`: a smeared floor is a defect of the OFFSET measurement, not of
        # the night's physiology, and conflating the two would make a perfectly good recording read as a
        # capture failure.
        "arrival": arrival_quality(night_dir),
        # RING CONTACT from the raw 0x05 pair — the independent coupling vote (constants + validation
        # documented at ppg2w_contact). A session list, not a verdict; empty when never captured.
        "ppg2w_contact": ppg2w_contact_quality(night_dir),
        # What rate the files ACTUALLY carry, against what was asked for. Coverage notices a rate swap
        # only as `degraded`, which names it a link fault; this names it a rate fault.
        "rates": _rate_rows,
    }


def qc_digest(summ) -> str | None:
    """One line of night QC for the webhook — the unconditional 'how did tonight go', as opposed to the
    missing-stream alert that fires only when something is wrong (VIGIL-OVERNIGHT-FINDINGS §P2.4: the
    coverage number 'is computed but not surfaced … it is the number that matters').

    Returns None when there is nothing measured to say — a digest of an empty night would train the
    reader that the message is noise, and an unconditional sender with no content check is the vacuous
    twin of the alert it complements. Devices with an empty coverage dict (configured but absent all
    night) are named rather than averaged in as zeros.
    """
    if not isinstance(summ, dict):
        return None
    devs = summ.get("devices") or []
    parts: list[str] = []
    absent: list[str] = []
    for d in devs:
        if not isinstance(d, dict):
            continue
        name = str(d.get("name") or "?")
        cov = d.get("coverage") or {}
        vals = [v for v in cov.values() if isinstance(v, (int, float))]
        if not vals:
            absent.append(name)
            continue
        lo = min(vals)
        hi = max(vals)
        # one number when the streams agree, a range when they do not — a device whose acc and ppg
        # diverge 41 %/95 % must not be summarised as 68 %.
        pct = f"{lo * 100:.0f}%" if (hi - lo) < 0.05 else f"{lo * 100:.0f}–{hi * 100:.0f}%"
        seg_dev = f"{name} {pct}"
        # ring-clock drift, appended to the device that has it — the number that says whether the 6-hourly
        # 0xC0 push is holding and whether a battery reset silently corrupted the night's stored .dat.
        rtc = d.get("rtc")
        if isinstance(rtc, dict) and rtc.get("reads"):
            extra = f"RTC {rtc['drift_s']:+g}s"
            if rtc.get("resets"):
                extra += f"/{rtc['resets']}⚠reset"
            seg_dev += f" ({extra})"
        # FINISHED-WORK-IMPROVEMENTS §B4 — the .dat<->live cross-correlation, appended after the RTC
        # readback. Two independent measurements of the SAME clock error (RTC's `drift_s` is
        # last-minus-first read; `datfit`'s `lag_s` is the offset needed to put the .dat on host time).
        # If they disagree by more than the .dat's 1 s quantum, the 0xC0 push isn't landing where the
        # readback says it is — a signal worth flagging even when either one alone reads clean.
        fit = d.get("datfit")
        # `converged is False` = the two columns did not confirm each other — a single-legged lag is
        # not a measurement (the tool's own #1657 rule), so the digest omits it rather than printing a
        # number a reader will trust. None (older tool without the flag) falls back to trusting `ok`.
        if isinstance(fit, dict) and fit.get("ok") and fit.get("lag_s") is not None and fit.get("converged") is not False:
            seg_dev += f" (.dat {fit['lag_s']:+g}s"
            if isinstance(rtc, dict) and rtc.get("reads") and rtc.get("drift_s") is not None:
                gap = abs(fit["lag_s"] - rtc["drift_s"])
                if gap > 1:
                    seg_dev += f" ⚠±{gap:.0f}s"
            seg_dev += ")"
        parts.append(seg_dev)
    if not parts and not absent:
        return None
    seg = [", ".join(parts)] if parts else []
    if absent:
        seg.append("no data: " + ", ".join(absent))
    missing = summ.get("missing") or []
    if missing:
        seg.append("missing: " + ", ".join(str(m) for m in missing[:4]))
    return f"night {summ.get('night') or '?'} — " + " · ".join(seg)
