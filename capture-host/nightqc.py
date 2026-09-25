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

from array import array as _array
from typing import Any
import json
import cmath
import math
import os
import logging
import subprocess

import allan
import clock_offset
import polar_pmd
import writers
from collections.abc import Sequence
from datetime import datetime, timedelta, timezone
from localstamp import LocalStampResolver

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
        # `or 0.0` here would collapse UNKNOWN into ZERO — precisely what `file_span_sec`'s contract
        # forbids ("Callers must treat None as unknown, never as zero"). The two are the same arm in
        # this function, because a file whose span we cannot measure has to be placed SOMEWHERE and a
        # point at its start stamp is the only defensible choice — but they are separated here so the
        # distinction survives, and so a future caller reading this does not learn the wrong idiom.
        raw = f.get("span_sec")
        dur = 0.0 if raw is None else float(raw)
        if dur <= 0:
            rows += f["rows"] if b0 <= st < b1 else 0.0      # unknown or zero span ⇒ a point in time
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


def _worn_end(wear: dict | None, name: object) -> dict | None:
    """One device's `worn_end` out of a `loss_audit.wear_ends`-shaped mapping, or None.

    `name` is typed `object` rather than `str` because it arrives as `dev.get("name")`, which is
    legitimately None for a device configured without one — and a missing key is exactly the "cannot say"
    this function already answers with None, so there is nothing to narrow it to.

    ⚠️ ABSENCE IS NULL AT EVERY HOP, and there are four of them: no mapping was supplied, the device is
    not in it, its wear block is unavailable (no usable file), or the block has no `worn_end`. Each is a
    different reason for not knowing and NONE of them is "the device was worn to the end", so every one
    returns None rather than a value the caller could mistake for a measurement."""
    if not isinstance(wear, dict):
        return None
    block = wear.get(name)
    if not isinstance(block, dict):
        return None
    end = block.get("worn_end")
    return end if isinstance(end, dict) else None


def _worn_end_reason(wear: dict | None, name: object) -> str | None:
    end = _worn_end(wear, name)
    reason = end.get("reason") if end else None
    return reason if isinstance(reason, str) and reason else None


def _worn_end_at(wear: dict | None, name: object) -> str | None:
    end = _worn_end(wear, name)
    at = end.get("at") if end else None
    return at if isinstance(at, str) and at else None


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
# Annotated because the literals mix int and float ("hr": 1 beside "ppg": 125.738), which mypy
# joins to `object` — so `_NOMINAL_HZ[model].get(stream)` read as a call on `object`. The values
# are all rates; float is the honest common type.
_NOMINAL_HZ: dict[str, dict[str, float]] = {
    "H10":    {"ecg": 130, "acc": 200, "hr": 1},
    "Verity": {"ppg": 55, "acc": 52, "gyro": 52, "mag": 50, "ppi": 1},
    # O2Ring ppg is the observed ROW rate (~125.7), NOT the 125.000 ADC clock: the file counts one row per
    # sample PLUS one per inserted `156` beat marker, and a coverage figure divides ROW count by span — so
    # the honest denominator here is the row rate. DEVICE-RATE-TRUTH §2; distinct from capture.O2PPG_FS_DEFAULT.
    # O2Ring `acc` is the RECORD rate (~9.979), and that is deliberate for the same reason `ppg` above
    # is a row rate: `measured_hz` reads rows off the file and `_expected_hz` is what it is compared
    # against, so a denominator that is not the row rate reports a healthy stream as mismatched. The
    # ring's ACC is a ZERO-ORDER HOLD — it MEASURES at 1.5625 Hz and the capture path writes 10 Hz
    # records, so ~84 % of records repeat the previous value (measured over two nights: record rate
    # 9.979–10.000, distinct-value rate 1.562–1.565, 6.387–6.396 records per distinct value = 32/5).
    # Coverage asks "did the stream keep arriving", which the record rate answers. Anything asking
    # "how much was MEASURED" — epoch grids, independent-sample counts, information content — must use
    # `_MEASUREMENT_HZ` below instead, or it is 6.4x wrong.
    "O2Ring": {"spo2": 1, "ppg": 125.738, "acc": 9.979},
}

# The rate at which a device actually MEASURES, where that differs from the rate it emits records at.
# Separate from `_NOMINAL_HZ` on purpose: they answer different questions and conflating them is the
# defect this table exists to prevent. Absent ⇒ the two are the same and the record rate is the
# measurement rate. NEVER use this as a coverage denominator against a row count.
_MEASUREMENT_HZ = {
    "O2Ring": {"acc": 1.5625},
}

# Below this fraction of the expected rows a stream that DID produce data is still "degraded" — the trickle
# that reads green under a bare zero/non-zero test (the Verity IMU delivering ~40% of nominal, a stream that
# died at hour one) but is not a healthy night. Coverage is an ESTIMATE (span from file mtimes), so the bar
# is deliberately generous — it flags a real hole, not normal jitter.
_DEGRADED_BELOW = 0.5

#: The Polar device epoch, in Unix milliseconds. Device stamps are ns since 2000-01-01
#: (polar-ble-sdk `TimeSystemExplained.md`; `capture.py:_POLAR_EPOCH` carries the same instant), and
#: `Phone timestamp` is a Unix instant — so an arrival offset MUST difference them on one epoch.
#: Anchored in UTC deliberately, and both halves are stated by the producer: the device counter is UTC
#: (`capture.py:_utcnow` — "Device clocks are set in UTC ... so skew is measured against UTC") while the
#: host column is naive LOCAL civil time (`writers._phone_ts`, written from `_now()`), so `.timestamp()`
#: converts the host side and this constant converts the device side. 946 684 800 000 ms is the
#: 1970→2000 delta, and it is exactly what was being added to every reading before this was subtracted.
_POLAR_EPOCH_MS = datetime(2000, 1, 1, tzinfo=timezone.utc).timestamp() * 1000.0
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


def measurement_hz(dev: dict, stream: str):
    """The rate this device MEASURES `stream` at, when that differs from the rate it writes records.

    The O2Ring's ACC is the case this exists for: it measures at 1.5625 Hz and the capture path writes
    ~10 Hz records, so 84 % of records are a zero-order hold of the previous value. That is the §7
    DRAWN-AXIS shape and NOT the §∅ absence shape — the held value is real data at a real, lower rate,
    so it must not be recorded as absence, and a run-length rule keyed on constant runs would convict
    the device for working as designed (99.8 % of its runs are length 6 or 7).

    None ⇒ no separate measurement rate is known, so the record rate IS the measurement rate. A caller
    computing independent samples, an epoch grid or information content must use this and not
    `_expected_hz`; a caller computing coverage must use `_expected_hz` and not this."""
    dev_rate = (dev.get("measurement_rates") or {}).get(stream)
    if dev_rate:
        return float(dev_rate)
    model = _recognised_model(dev)
    if model is None:
        return None
    return _MEASUREMENT_HZ.get(model, {}).get(stream)


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


# 🔴 A CONFIGURED STREAM NAME IS NOT ALWAYS ITS FILE TAG, and assuming so is silent in BOTH
# directions. The config asks for `acc`; `capture.py` writes the O2Ring's accelerometer through
# `StreamWriter(accraw_path, "accraw")`, so the file lands as `..._ACCRAW.txt` while the Polar
# Verity's identical `acc` lands as `..._ACC.txt`. Two devices, one config word, two tags.
#
# Measured on vigil 2026-09-05: `stream.upper()` matched neither the 38 ACCRAW files on disk nor
# 2.1 MB of accelerometer data in the live session, so QC reported `missing stream(s):
# Wellue O2Ring-S:acc` every ~10 min against data that was arriving perfectly. That is a false
# alarm in the ONE channel whose whole job is to announce data loss — the cost is not the wrong
# line, it is that a reader who sees it nightly stops believing the true one.
#
# The two consumers fail differently from the same cause, which is why this is a shared helper and
# not a patch at one site: coverage reports a stream MISSING (loud and wrong), while `rate_reality`
# finds no candidate file and emits no row at all (silent and wrong).
_STREAM_FILE_TAGS = {"acc": ("ACC", "ACCRAW")}


def stream_file_tags(stream: str) -> tuple[str, ...]:
    """Every file tag a configured stream may legitimately be written under, upper-case.

    Default is the name upper-cased, which is right for every stream but the exception above. A
    UNION rather than a per-device mapping on purpose: no device writes both tags (verified on the
    real corpus — 38 `_ACCRAW.` against 2 `_ACC.` on 2026-09-05, disjoint by device), so accepting
    either cannot mask one device's loss with another's data, and a device that changes which it
    writes does not silently become `missing`."""
    return _STREAM_FILE_TAGS.get(stream, (stream.upper(),))


def pmd_negotiations(night_dir: str) -> dict:
    """`(device, stream) -> {"chosen": hz|None, "offered": str|None, "starts": n}` from `PMDNEG.csv`.

    The middle term `rate_reality` never had. Until this sidecar existed it compared the CONFIG against
    the FILE, so "the device refused the rate" and "the link dropped packets" arrived at the reader as
    the same disagreement. What the device agreed to sits between them.

    ⚠️ ONLY STARTED negotiations count toward `chosen`, and the vocabulary is DERIVED from
    `polar_pmd`, never restated here — a second copy of "which ack means started" is how the sidecar
    and the daemon would come to disagree about the same night. Refused starts still raise `starts`,
    so a stream that negotiated five times and began none reports its count with a null rate.

    ⚠️ Disagreeing starts give **None**, not a first or a majority: a session that began at 55 Hz and
    reconnected at 176 was not captured at either, and averaging them would invent a rate no sample
    was taken at (§∅). The count is published beside it so the reader sees the denominator."""
    started = {polar_pmd.CTRL_STATUS[c] for c in polar_pmd.CTRL_STATUS if polar_pmd.is_started(c)}
    out: dict = {}
    path = os.path.join(night_dir, writers.PMDNEG_NAME)
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            rows = fh.read().splitlines()
    except OSError:
        return out
    for line in rows[1:]:
        p = line.split(";")
        if len(p) < 9:
            continue                      # a torn row is skipped, exactly as every sidecar reader does
        key = (p[1], p[3])
        rec = out.setdefault(key, {"chosen": None, "offered": None, "starts": 0, "_seen": set(), "_menus": set()})
        rec["starts"] += 1
        # THE MENU IS A PROPERTY OF THE DEVICE, NOT OF THE OUTCOME, so it is read from every row —
        # a refused START still carries the settings block the device reported before refusing.
        # Measured on the box the day this shipped: a Verity left on its charger refused 63 ACC
        # starts in an hour, every row recording `offered 52`, and this reported `offered: None`
        # while the file said 52 sixty-three times — a null where a measurement exists, which is
        # §∅ inverted. `chosen` stays started-only (below): what was captured at IS an outcome.
        if p[5]:
            rec["_menus"].add(p[5])
        if p[7] not in started:
            continue
        try:
            rec["_seen"].add(int(p[6]))
        except ValueError:
            pass                          # a blank or torn rate is an ABSENCE, not a zero
    for rec in out.values():
        rec["chosen"] = next(iter(rec["_seen"])) if len(rec["_seen"]) == 1 else None
        rec["offered"] = next(iter(rec["_menus"])) if len(rec["_menus"]) == 1 else None
        del rec["_seen"], rec["_menus"]
    return out


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
    out: list = []
    try:
        names = sorted(os.listdir(night_dir))
    except OSError:
        return out
    negotiated = pmd_negotiations(night_dir)
    for dev in devices or []:
        for stream in sorted((dev.get("streams") or [])):
            want = _expected_hz(dev, stream)
            suffixes = tuple("_" + t + ".txt" for t in stream_file_tags(stream))
            cand = [n for n in names if n.endswith(suffixes) and _dev_matches(n, dev)]
            if not cand:
                continue
            # the LARGEST file of the session — the shortest ones are re-connect fragments whose few
            # hundred rows cannot settle a rate, and would report a spurious mismatch
            path = max((os.path.join(night_dir, n) for n in cand), key=lambda p: _size(p))
            got = measured_hz(path)
            meas = measurement_hz(dev, stream)
            ok = None
            if got is not None and want:
                ok = bool(abs(got - want) <= _RATE_MISMATCH_TOL * want)
            out.append({
                "device": _rate_key(dev),
                "stream": stream,
                "requested_hz": want,
                "measured_hz": None if got is None else round(got, 2),
                "matches_config": ok,
                # Where a device MEASURES more slowly than it emits records, the two rates are reported
                # side by side and the ratio is named. Without this a reader has only the record rate
                # and no way to know that 6.4 of every 7 rows repeat the previous value — the ring's
                # ACC writes ~9.979 Hz records from a 1.5625 Hz sensor. `held_ratio` is records per
                # measurement: 1.0 (or None) means every record is its own measurement.
                "measurement_hz": meas,
                "held_ratio": None if not (meas and want) else round(want / meas, 3),
                # THE MIDDLE TERM (PMDNEG.csv). `requested_hz` is what the config asked for and
                # `measured_hz` what the file carries; between them is what the DEVICE agreed to and
                # the menu it agreed from. Null where the night has no sidecar — an older night, or a
                # stream that never negotiated — which is an absence, not an agreement.
                **_negotiated_fields(negotiated.get((dev.get("name"), stream))),
            })
    return out


def _negotiated_fields(rec) -> dict:
    """The three sidecar fields, null-shaped when the night has no negotiation for this stream."""
    if not rec:
        return {"negotiated_hz": None, "offered_hz": None, "negotiated_starts": 0}
    return {"negotiated_hz": rec["chosen"], "offered_hz": rec["offered"], "negotiated_starts": rec["starts"]}


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
            span = (last - first) / 1e9
            # A span of EXACTLY zero is not a duration, it is a column that never moved — the shape a
            # stream with no device clock leaves behind (the three O2Ring raw-buffer opcodes wrote a
            # literal 0 on every row until 2026-09-07). Returning 0.0 hands the caller a measurement
            # of no elapsed time; None says the file cannot answer, which is the truth and is what
            # every caller is documented to expect. Kept for a BLANK column too — `_ns_at` returns
            # None there, so first is None and we never reach here — this guards the legacy files
            # already on disk, which will carry literal zeros forever.
            return span if span > 0 else None
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


def daemon_starts(night_dir: str, files: list[dict] | None = None) -> dict:
    """`{"starts": n, "inside_capture": m, "stamps": [...]}` — the night's daemon starts, and how many
    of them landed INSIDE a signal-carrying file's span.

    ⚠️ THE COUNT NEVER TRAVELS ALONE, and that is the finding this function exists to carry rather
    than to re-open. A high restart count was read as evidence of fragmentation until the harm was
    measured: over four nights, 9 restarts fell in capture hours and **0** of them landed inside a
    live capture, because the deploy path gates on idleness. So the pair is the observation — a count
    beside the number of them that could have interrupted anything.

    The predicate is the row's own: a start whose stamp falls within `[filename stamp, mtime]` of a
    data file that carries rows. `files` defaults to a fresh `scan_night`; callers that already have
    it pass it rather than walking the night twice.

    ⚠️ It bounds interruption of CAPTURE, not of WEAR: a restart while a device was worn but its link
    was already down reads as outside, which is benign for this question (there was nothing to
    interrupt) and is not the same statement. Absent sidecar ⇒ `starts: None`, never 0 — a night whose
    daemon predates the sidecar did not restart zero times, it did not say."""
    path = os.path.join(night_dir, writers.STARTS_NAME)
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            rows = fh.read().splitlines()[1:]
    except OSError:
        return {"starts": None, "inside_capture": None, "stamps": []}
    stamps = []
    for line in rows:
        p_ = line.split(";")
        if len(p_) < 5:
            continue                       # a torn row is skipped, as in every sidecar reader here
        t = _parse_phone_ts(p_[0])
        if t is not None:
            stamps.append(t)
    if files is None:
        files = scan_night(night_dir)
    spans = [(f["session"], f["mtime"]) for f in (files or [])
             if f.get("rows") and f.get("stream") not in _SIDECAR_TAGS]
    inside = sum(1 for t in stamps if any(a <= t <= b for a, b in spans))
    return {"starts": len(stamps), "inside_capture": inside, "stamps": sorted(stamps)}


def _parse_phone_ts(raw: str) -> float | None:
    """The sidecar's own stamp format back to an epoch, or None. Never `now` for an unparseable
    stamp — a start we cannot place is not a start that happened at this instant (§2.6)."""
    try:
        return datetime.strptime(raw.strip()[:23], "%Y-%m-%dT%H:%M:%S.%f").timestamp()
    except (ValueError, TypeError):
        return None


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
    # `best_s` starts at a REAL candidate rather than None. Every `r` is an `abs()`, so it is >= 0 and
    # never exceeds the initial 0.0 when the vector sum cancels exactly — with None that left the refine
    # loop below multiplying None, and mypy was right to flag it. Seeding `lo` removes the crash without
    # adding a branch nobody can reach to test: a scan that finds nothing returns `R: 0.0`, which is
    # already this function's signal for "no periodicity", rather than a fabricated peak.
    best_r: float = 0.0
    best_s: float = lo
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
    out: list = []
    try:
        names = [n for n in sorted(os.listdir(night_dir)) if n.endswith("_PMDARRIVAL.csv")]
    except OSError:
        return out
    for name in names:
        path = os.path.join(night_dir, name)
        # (host_ms, host_ms - device_ms, device_ns) per packet — a TRIPLE, not a float. The
        # annotation said `list[float]` while every append has been a 3-tuple, so mypy reported
        # the append AND everything downstream that unpacks it ("float is not iterable", "not
        # indexable") — six errors from one wrong declaration, none of them a real defect.
        per: dict[tuple[str, str], list[tuple[float, float, int]]] = {}
        folds: dict[tuple[str, str], LocalStampResolver] = {}
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
                    meas = row.get("meas", "")
                    if not ns or not ts:
                        continue                      # blank is "absent", never a fabricated 0
                    # 🔴 `0` IS ABSENT TOO, AND THE LINE ABOVE USED TO SAY SO WHILE ACCEPTING IT.
                    # `row.get(...)` yields the STRING "0", which is truthy, so `if not ns` let it
                    # through and `host_ms - 0` recorded the whole Unix epoch as an arrival offset.
                    # It is not a rare shape: the docstring above records every Verity `ppi` stream
                    # carrying `last_sensor_ns` literally 0 for all 4864 packets, and the ring writes
                    # zeros too — measured 2026-09-13 on the real 2026-08-11 capture, 132 of its
                    # 24 289 `OXYLIVE_DURATION_S` rows are `0` (the rest carry a real, INCREMENTING
                    # duration, so they are not a frozen stamp and this guard is not what catches them).
                    #
                    # ⚠️ AND THIS COLUMN CARRIES TWO DIFFERENT KINDS OF NUMBER. For a Polar stream it is
                    # a device TIMESTAMP (ns since 2000-01-01); for the ring's `OXYLIVE_DURATION_S` rows
                    # `capture.py:4530` passes a DURATION as both first and last, which has no epoch and
                    # so no arrival offset. Those rows are NOT excluded by `meas` here, and excluding
                    # them was tried first: this module's contract is that ring rows are REPORTED and
                    # merely not floor-judged (see the docstring — `offset` runs "on EVERY device
                    # including the ring"), so dropping them is LESS honest than the refusal the ring
                    # already gets. `quantised` publishes `ok: False` WITH a reason; a dropped row
                    # publishes nothing. Five existing assertions defend that and caught the exclusion.
                    try:
                        # Folded into the SAME try as the stamp parse rather than given its own: both
                        # failures mean "this row is unusable", the handler below already explains why
                        # swallowing that is correct, and a second bare handler would be one more
                        # unexplained swallow — `test_silent_except` caught exactly that when this was
                        # two blocks.
                        dev_ns = int(ns)
                        if dev_ns <= 0:
                            continue
                        # The fall-back hour is decided by host−device continuity, per stream, never
                        # by `fold=0` (residue 2026-09-13-dst-fallback-splits-the-host-axis).
                        host_ms = folds.setdefault((row.get("device", ""), meas), LocalStampResolver()) \
                            .resolve_ms(datetime.fromisoformat(ts), dev_ms=_POLAR_EPOCH_MS + dev_ns / 1e6)
                        # 🔴 SUBTRACT THE DEVICE EPOCH. `host_ms` counts from 1970 and `dev_ns` from
                        # 2000, so differencing them raw added the 946 684 800 000 ms between the two
                        # epochs to every reading — and CERTIFIED it, because nothing downstream
                        # range-checks a number this far out and a constant added to every row leaves
                        # the slope and every spread-based check untouched.
                        #
                        # Measured 2026-09-13 on the real 2026-08-11 H10 capture, 50 192 ECG rows: the
                        # old path's minimum delay read 946 684 799 461.936 ms, where with the epoch
                        # subtracted it is -538.064 ms (median -183.623) — a difference of exactly
                        # 946 684 800 000.0 ms. The corrected median agrees in sign and order with the
                        # docstring table above, which has carried H10 ecg at -228.7 ms since
                        # 2026-08-11: the code and its own documentation had disagreed by thirty years.
                        device_ms = _POLAR_EPOCH_MS + dev_ns / 1e6
                        per.setdefault((row.get("device", ""), meas), []).append(
                            (host_ms, host_ms - device_ms, dev_ns))
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
            # §2.2 step 2a: the host instants go in so a BLE hole is CUT, not compacted — measured
            # 2026-09-21 over 34 box nights, max_gap ≤ 4× median held on only 22.8 % of the ECG/PPG
            # legs (H10 ecg median 97×), and a compacted hole inflates every ADEV level by the step's
            # size (8× at a 500σ step, slope untouched). Seconds, the unit `_tau0_of` returns.
            stab = allan.stability(diffs, _tau0_of(pairs), _TDEV_TAU_S, sample_times=[(h - pairs[0][0]) / 1000.0 for h, _, _ in pairs])
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
# ⚠️ AN EPOCH IS ONE SECOND OF WALL CLOCK, read from each row's phone stamp — NOT a fixed row count. It was
# `_PPG2W_ROWS_PER_EPOCH = 100` ("a 10 ms grid"), and the stream is not 100 rows/s: measured per file on the box
# (Wren, 2026-09-24) it ran ~101.6 rows/s through 2026-08-21 and ~199 rows/s from 2026-08-23. So every "second"
# was 0.98 s and then 0.5 s, `doff_at = first + (epochs - trailing)` drifted 1.6 % of the file's length in the
# derivation regime (up to ~9 min) and ~2x after it — HOURS late (2026-09-22: 09:59:38 for a finger out at
# 04:22:34), and the 60-epoch minimum and the 10-epoch run were halved in real seconds. The PER-ROW predicate
# and its constants above are rate-independent and unchanged; only time is now read from the clock.
# VALIDATED against an EXTERNAL label on every night (the SpO2 file's last row: the ring stops SpO2 when the
# finger leaves), clock-aligned `doff_at` minus that row, over the 50 sustained off-tails 2026-08-06 → 09-23:
# +5 to +7 s on every tail at ~101.6 rows/s, 0 to +4 s on every tail at ~199 rows/s; two land EARLY — 2026-09-07
# 08:01:28 (-80 s) and 2026-09-11 20:15:24 (-202 s) — where the two-channel signal left the finger before the
# ring stopped writing SpO2. Reported as observed.
_PPG2W_MIN_EPOCHS = 60  # under a minute cannot establish a worn band -> refuse, never report
_PPG2W_RUN_EPOCHS = 10  # a sustained off-run, vs single-epoch flicker; also the bar for
# "ended off-finger" — a tail is a doffing when the trailing off-run
# is itself sustained, not when some window's majority tips (a
# majority-of-last-minute definition sat exactly on a tie in the first
# planted test, which is what a window boundary does)


def ppg2w_contact(ch0, ch1, secs):
    """Worn/off-finger summary from the 0x05 channel pair. PURE — the file walk is in the caller.

    worn(row) := ch1 > PPG2W_CH1_FLOOR and PPG2W_RATIO_LO <= ch0/ch1 <= PPG2W_RATIO_HI.
    An epoch is ONE SECOND of wall clock — every row whose `secs[i]` (its phone stamp to the second) is that
    second, wherever it falls in the file — and is OFF when the MAJORITY of its rows fail that predicate: a single glitch row
    must not flip a second. `tail_start` is the label of the trailing off-run's first second (None when the
    tail is worn): the doff time, read off the clock rather than computed from a count.

    Returns None when fewer than _PPG2W_MIN_EPOCHS epochs exist: a block that cannot be computed is
    ABSENT, never `off_epochs_pct: 0` — zero is the healthy end of that scale, and missing data
    reading as healthy is the exact failure class this file already documents for actigraphy.
    """
    # Rows are BACK-TIMED per frame, so their stamps are not monotonic across a second boundary: grouping
    # CONSECUTIVE equal labels split one second into ~3 epochs (60 478 "epochs" in a 20 859 s file). Group by
    # the label's VALUE and order the seconds by label (an ISO stamp to the second sorts chronologically).
    per: dict = {}
    worn_ratios = []
    for i in range(min(len(ch0), len(ch1), len(secs))):
        cell = per.setdefault(secs[i], [0, 0])
        cell[1] += 1
        c1 = ch1[i]
        if c1 > PPG2W_CH1_FLOOR and PPG2W_RATIO_LO * c1 <= ch0[i] <= PPG2W_RATIO_HI * c1:
            worn_ratios.append(ch0[i] / c1)
        else:
            cell[0] += 1
    labels = sorted(per)
    n_ep = len(labels)
    if n_ep < _PPG2W_MIN_EPOCHS:
        return None
    ep_off = [per[k][0] * 2 > per[k][1] for k in labels]
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
        "tail_start": labels[n_ep - trail] if tail_off else None,
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
        # Memory, because this runs inside the daemon over ~4 M rows a night: the channels are machine ints, and
        # every row of one second shares ONE label object (consecutive rows repeat it), so `secs` is pointers
        # into ~20 k strings rather than 4 M of them.
        ch0, ch1, secs = _array("q"), _array("q"), []
        prev = ""
        try:
            with open(os.path.join(night_dir, name), "r", encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    parts = line.rstrip("\n").split(";")
                    if len(parts) < 5:
                        continue
                    try:
                        a, b = int(parts[2]), int(parts[3])
                    except ValueError:
                        continue  # a torn row is expected at a live file's tail; the epoch count
                        # is computed from the rows that parsed, and `_PPG2W_MIN_EPOCHS`
                        # refuses a block built from too few
                    label = parts[0][:19]
                    if label != prev:
                        prev = label
                    secs.append(prev)
                    ch0.append(a)
                    ch1.append(b)
        except OSError:
            log.warning(
                "night-QC: %s is unreadable, so its contact quality is ABSENT rather than "
                "poor — the two must not read alike",
                name,
                exc_info=True,
            )
            continue
        block = ppg2w_contact(ch0, ch1, secs)
        if block is None:
            out.append({"file": name, "usable": False, "reason": f"under {_PPG2W_MIN_EPOCHS} s of rows"})
            continue
        block["file"] = name
        block["usable"] = True
        # Doff wall-clock: the trailing off-run's FIRST SECOND, read off the rows' own stamps — never computed
        # from an epoch count (see the constants). A label that is not a time is not a doff time.
        tail = block.pop("tail_start")
        try:
            block["doff_at"] = datetime.fromisoformat(tail).isoformat(timespec="seconds") if tail else None
        except ValueError:
            block["doff_at"] = None
        out.append(block)
    return out


_CLIP_MIN_RUN = 5  # the shortest plateau REPORTED. It is a sensitivity knob only, and
# measurably not a specificity one: the clean-stream control yields 0
# regions at min_run 5, 6 and 8 alike, because `rail_value` rejects an
# unqualified rail before this is ever consulted. So raising it buys
# nothing and costs real events.
# ⚠️ IT COSTS DAMAGE, and the curve is why it is 5 and not 8. Magpie
# measured the excursion a pin puts into the bandpassed signal against
# the clean signal's own sd (2026-09-06):
#     len  1 →  5.7x     20 → 40.2x (peak)
#     len  5 → 25.4x     40 → 33.1x
#     len 10 → 38.6x     94 → 22.1x
# A 5-sample pin is a 25x-sd excursion — comparable to a 94-sample one
# at 22x — so a "tidy" raise to 8 silently drops 9 spans on 045318 that
# do real damage. Do not raise this without re-measuring that curve.
_PLATEAU_LSB = 1  # a rail plateau flickers by one quantisation step, so the region is
# NEAR-constant, not constant. Measured 2026-09-06 on the ring: exact
# equality split one ceiling population into 118 regions at 200 and 81
# at 199 and would have reported one plateau as two findings.
_RAMP_SAMPLES = 6  # samples either side used to read the approach. One ring beat's rising
# edge at 125 Hz — enough to see monotonicity, short enough not to
# reach the neighbouring beat.
_HELD_NEAR_DELTA = 0.90  # >= this share of runs on two ADJACENT lengths => a zero-order HOLD,
# not a defect. Measured on the ring's `_ACCRAW.txt` (2026-09-06, three
# sessions / two nights): 99.8 % of runs are 6 or 7, ratio 6.387-6.396,
# because a 1.5625 Hz update is emitted into a 10 Hz record stream.


def constant_runs(values, *, min_run: int = 2):
    """Maximal runs of ONE repeated value that reach `min_run`, as `(first_index, n, value)`.

    Keyed on length and never on value membership. A `!= 0` test — or any list of known-bad constants
    — convicts every stream where the constant is real: ECG microvolts cross zero on every beat and an
    ACC axis rests at 0 mG. This function has no opinion about the value; callers decide.
    """
    out = []
    if min_run < 2:
        raise ValueError("min_run must be at least 2 — a single sample is not a run")
    i, n = 0, len(values)
    while i < n:
        j = i + 1
        while j < n and values[j] == values[i]:
            j += 1
        if j - i >= min_run:
            out.append((i, j - i, values[i]))
        i = j
    return out


def _count_singletons(values) -> int:
    """Values differing from BOTH neighbours — the runs `constant_runs` cannot return.

    The held test reasons over the whole transition population; dropping singletons would let a stream
    with one long hold and thousands of single samples read as a near-delta.
    """
    n = len(values)
    if n <= 1:
        return n
    c = 0
    for i in range(n):
        prev_same = i > 0 and values[i - 1] == values[i]
        next_same = i + 1 < n and values[i + 1] == values[i]
        if not prev_same and not next_same:
            c += 1
    return c


def held_stream(values, *, near_delta: float = _HELD_NEAR_DELTA):
    """Is this stream a ZERO-ORDER HOLD of a slower measurement, rather than a damaged one?

    A held stream repeats every value by construction, so a run-length rule would flag essentially the
    whole file — 99.8 % of runs on the ring's ACC — and report working behaviour as corruption. The
    discriminator is the SHAPE of the run-length distribution: a hold produces a near-delta at the two
    integers bracketing a fixed ratio (6 and 7 for 6.4), because an integer number of records cannot
    realise a non-integer ratio any other way. Damage is ragged and its short runs do not vanish.

    Computed rather than configured ON PURPOSE. An exclusion list naming `acc` would keep protecting a
    stream that stopped being held and would miss the next held stream nobody added to it.

    FEED IT A RECORD, NOT A COLUMN, for a multi-column stream. Two axes change on the same tick, but
    either alone also repeats across a change by coincidence, splicing neighbouring runs together.
    Measured on the ring's ACC: the triplet gives ratio 6.387 / share 0.998 — reproducing an
    independently measured 6.387 exactly — while X, Y and Z alone read 6.579, 6.613 and 6.603.

    `None` when not held. Otherwise the ratio, which is the number a consumer needs: the record rate
    OVERSTATES the measurement rate by exactly this factor.
    """
    return _held_shape([n for _i, n, _v in constant_runs(values, min_run=2)],
                       _count_singletons(values), near_delta=near_delta)


def held_columns(columns, *, near_delta: float = _HELD_NEAR_DELTA):
    """`held_stream` over PER-CHANNEL columns instead of materialised records — the same rule, read
    the other way round.

    A record repeats iff EVERY channel repeats on that tick, which is a property this can test
    column by column without ever building the tuple. That matters because building it is what the
    back-check's memory was: a night's 5.26 M two-channel rows cost 755 MB as tuples of ints and
    84 MB as two `array('q')` (measured on vigil, the 2026-09-21 night).

    ⚠️ THE RULE IS NOT DUPLICATED HERE, deliberately — both paths end in `_held_shape`, and
    `test_held_columns_matches_held_stream_exactly` asserts the two agree on the same data. A second
    copy of the shape logic is how the two would drift into answering differently about one night."""
    n = len(columns[0]) if columns else 0
    if n <= 1:
        return _held_shape([], n, near_delta=near_delta)
    # One pass building the record-level change mask: same[i] is True when record i repeats i-1.
    same = bytearray(n)
    for col in columns:
        if len(col) != n:
            raise ValueError("columns must be the same length — they are one stream's channels")
    for i in range(1, n):
        same[i] = 1 if all(col[i] == col[i - 1] for col in columns) else 0
    runs = []
    singles = 0
    i = 1
    run = 1
    while i <= n:
        if i < n and same[i]:
            run += 1
        else:
            if run >= 2:
                runs.append(run)
            else:
                singles += 1     # `run` starts at 1 and resets to 1, so the only other case IS 1 —
            run = 1              # an `elif run == 1` here reads as a guard and is an unreachable branch
        i += 1
    return _held_shape(runs, singles, near_delta=near_delta)


def _held_shape(runs, singles, *, near_delta: float = _HELD_NEAR_DELTA):
    """THE hold rule, in one place: is the run-length distribution a near-delta at two adjacent
    integers? Called with run lengths and a singleton count, however they were counted."""
    total = len(runs) + singles
    if total < 20:
        return None                      # too few transitions to have a shape at all
    best = None
    for a in sorted({n for n in runs}):
        share = (sum(1 for n in runs if n in (a, a + 1)) + (singles if a == 1 else 0)) / total
        if best is None or share > best[1]:
            best = ((a, a + 1), share)
    if best is None or best[1] < near_delta:
        return None
    return {"held": True, "ratio": (sum(runs) + singles) / total,
            "lengths": best[0], "share": best[1]}


_ANNOTATION_GAP_MAX = 8         # the longest run of consecutive annotation rows a plateau may be
                                # merged ACROSS. Measured on 20260905045318, consecutive-`156` run
                                # lengths are 1:5383 · 2:11 · 3:3 · 4:2 · 5:3 · 6:3 — 99.6 % singletons,
                                # max 6, 5455 marker rows in 5405 runs. Eight clears that max without
                                # room to spare being the point: unbounded stepping is safe on THIS
                                # corpus and would silently merge two plateaus across any future
                                # marker burst, reporting a span that is mostly annotation.


def _ramp(values, first, n, *, toward_high, ramp=_RAMP_SAMPLES, annotations=()):
    """Approach/departure shape around a plateau: `(monotone_in, monotone_out, projects_beyond)`.

    `projects_beyond` continues the approach slope across the plateau and asks whether it would have
    left the observed range — the question a rail answers YES to and a flat stretch of signal answers
    NO to, with no threshold on the value.

    ⚠️ The projection is LINEAR over a plateau that may be long, so it indicates DIRECTION, not depth.
    Never quote its magnitude as the excursion the device would have recorded.
    """
    skip = frozenset(annotations)
    a, b = [], []
    k = first - 1
    while k >= 0 and len(a) < ramp:
        if values[k] not in skip:
            a.append(values[k])
        k -= 1
    a.reverse()
    k = first + n
    while k < len(values) and len(b) < ramp:
        if values[k] not in skip:
            b.append(values[k])
        k += 1
    mono_in = mono_out = False
    beyond = None
    if len(a) == ramp:
        mono_in = all(a[t + 1] >= a[t] for t in range(ramp - 1)) if toward_high \
            else all(a[t + 1] <= a[t] for t in range(ramp - 1))
        slope = (a[-1] - a[0]) / float(ramp - 1)
        proj = a[-1] + slope * n
        beyond = proj > values[first] if toward_high else proj < values[first]
    if len(b) == ramp:
        mono_out = all(b[t + 1] <= b[t] for t in range(ramp - 1)) if toward_high \
            else all(b[t + 1] >= b[t] for t in range(ramp - 1))
    return mono_in, mono_out, beyond


_RAIL_SCAN_VALUES = 8           # how many OCCUPIED values inward from an edge are considered when
                                # locating the rail.
_RAIL_GAP_MAX = 4               # a wider gap than this between occupied values means the edge value
                                # stands alone, so it IS the rail and no spike search is run.
_RAIL_SPIKE_MIN = 5             # a rail must OUT-COUNT its nearest occupied neighbour by this factor.
                                # Measured 2026-09-06 over eight files: real rails run 9.0-43.0x (ring
                                # floor 34.3-43.0, ring ceiling 16.4-38.4, Verity ceiling 41.0 and 9.0),
                                # a clean quantised sine reaches only 2.3-2.4x because a smooth signal
                                # genuinely lingers at its own turning point, and the Verity's lone
                                # minimum sample scores 1.0x. Five clears clean signal by ~2x and sits
                                # ~1.8x under the weakest real rail.


def rail_value(values, *, toward_high, scan=_RAIL_SCAN_VALUES, gap_max=_RAIL_GAP_MAX,
               spike_min: float = _RAIL_SPIKE_MIN):
    """The rail is the HISTOGRAM SPIKE NEAREST THE EDGE, not the edge.

    🔴 The observed extreme is not the rail, and using it silently drops a whole class. Measured on
    20260905045318, the top of the range is 195:34 · 196:39 · 197:41 · 198:75 · **199:2596** · 200:304 —
    the rail is 199 and the maximum is a rare overshoot one quantum above it. A rule keyed on `max`
    hunts for the ceiling at 200, weighs 304 samples against a 2,596-sample neighbour, and concludes
    the ceiling is not pinned. The failure presents as "the ceiling behaves differently from the floor",
    which is exactly the asymmetry the marker exclusion already had to dissolve once. (Found by Magpie
    building the JS port against real files, 2026-09-06; this implementation had the same bug in a
    milder form — a one-quantum tolerance caught the 199 class by accident while LABELLING it 200.)

    The gap clause keeps this general: if the stream jumps away from the extreme, a spike search across
    that gap would walk into the bulk of the distribution and return a value that is not a rail at all.
    The Verity's 2 096 921 sits alone that way; the ring's 199 does not.
    """
    counts: dict[int, int] = {}
    for v in values:
        counts[v] = counts.get(v, 0) + 1
    if not counts:
        return None
    occupied = sorted(counts, reverse=toward_high)
    if len(occupied) < 2:
        return None
    edge = occupied[0]
    window = [edge]
    for v in occupied[1:scan]:
        if abs(v - window[-1]) > gap_max:
            break
        window.append(v)
    rail = max(window, key=lambda v: counts[v])
    # `occupied` is sorted outward-edge first, so the first survivor is the NEAREST neighbour inward.
    inward = [v for v in occupied if v < rail] if toward_high else [v for v in occupied if v > rail]
    if not inward:
        return None                      # the spike sits at the far end of a stream with only a
                                         # couple of distinct values, so there is nothing inward of it
                                         # to be a spike ABOVE. That is a flat/binary stream, not a rail.
    neighbour = inward[0]
    if counts[rail] < spike_min * counts[neighbour]:
        return None                      # not a spike: a smooth signal lingering at its own turning
                                         # point, or a lone outlier. This stream has no rail on this
                                         # side, so it has no clip regions on this side either.
    return rail


def _at_rail(v, rail, toward_high, max_spread):
    """At-or-BEYOND the pin, never short of it.

    The tolerance exists for the OVERSHOOT: the ring's ceiling rail is 199 and it flickers up
    to 200, and admitting that flicker is what merges one plateau reported as 118 + 81 regions
    into one. It was never for the approach. A sample one LSB SHORT of the pin — a 198 under a
    199 ceiling, a 1 above a 0 floor — is a value the encoding could represent and the device
    did report, so a span covering it claims territory where the signal was still measuring.
    Making the tolerance symmetric (an earlier draft here) extended every span by a sample at
    each end and started ceiling spans during the ramp.
    """
    if toward_high:
        return rail <= v <= rail + max_spread
    return rail - max_spread <= v <= rail


def _rail_runs(values, rail, *, toward_high, max_spread, min_run, annotations, annotation_gap_max):
    """Runs of samples AT THE RAIL, grouped from the rail outward — not filtered out of generic
    near-constant regions.

    🔴 THE GENERIC SCAN GETS THE BOUNDARY WRONG, and this function exists because of it. A greedy
    maximal near-constant scan is non-overlapping, so a sample that IS at the rail can be absorbed
    into a shorter preceding region and lost from the plateau. Measured on 20260905045318 at 9294:
    `190, 193, 196, 198, 199, 200, 199, 199 …` — the greedy scan emits `[9297, 9298] = (198, 199)`,
    two samples, dropped by `min_run`, and the real plateau then opens at 9299 on the 200. The span
    start therefore depended on WHAT PRECEDED the plateau rather than on the rail, which is
    indefensible under any tolerance rule. (Found by Magpie diffing span lists, 2026-09-06.)

    Grouping outward from the rail makes the boundary a property of the rail alone. Annotations stay
    transparent up to `annotation_gap_max`, as everywhere else.
    """
    skip = frozenset(annotations)
    n = len(values)
    out = []
    i = 0
    while i < n:
        if values[i] in skip or not _at_rail(values[i], rail, toward_high, max_spread):
            i += 1
            continue
        first = last = i
        j = i + 1
        gap = 0
        while j < n:
            if values[j] in skip:
                gap += 1
                if gap > annotation_gap_max:
                    break
                j += 1
                continue
            if not _at_rail(values[j], rail, toward_high, max_spread):
                break
            gap = 0
            last = j
            j += 1
        if last - first + 1 >= min_run:
            out.append((first, last - first + 1))
        i = max(j, first + 1)
    return out


_NO_SAMPLE = object()   # "the filtered column is empty" — distinct from every value a column can hold


def clip_regions(values, *, min_run: int = _CLIP_MIN_RUN, max_spread: int = _PLATEAU_LSB,
                 ramp: int = _RAMP_SAMPLES, annotations=()):
    """Plateaus PINNED AT AN OBSERVED EXTREME, at BOTH rails, with their approach shape measured.

    Both extremes are read from the data and tested identically, which is what makes the ring's 0 and
    the Verity's 2 096 921 the same rule rather than two entries on a list. There is no declared bound
    to test against — the ring's 200 is not an encoding extreme — so the observed range is the only
    honest reference, and that is why this is a whole-night back-check and not live-computable.

    THE CEILING IS THE POSITIVE CONTROL. On 20260905045318 the ceiling scores 115/118 monotone-in and
    113/118 monotone-out, so the shape test is known to fire on a rail this stream really does hit; the
    floor's numbers are then a measurement against a working instrument rather than a hopeful
    threshold. A rule with no positive control cannot tell "clean" from "blind".

    ⚠️ THE GEOMETRY IS EVIDENCE, NOT THE DISCRIMINATOR. It rides with each region and it does not
    decide which regions are emitted — the pin does. A slow turning point is approached monotonically
    AND projects beyond its own extreme (the approach slope is non-zero), so both flags fire on clean
    signal too; on the real corpus the ceiling projects beyond in only 54-62 % of regions while reading
    94-97 % monotone. Anyone tempted to filter on these flags should read
    `test_clip_clean_night_reports_the_signals_own_turning_points` first — an earlier draft of this
    docstring claimed the separation and the test falsified it.
    """
    if len(values) == 0:
        return []
    skip = frozenset(annotations)
    # A GENERATOR, NOT A COPY. `rail_value` only iterates, and this list was a second full copy of the
    # column — 5.26 M samples of it on the real 2026-09-21 ring file. Rebuilt per rail because an
    # exhausted iterator would silently hand the second call an empty distribution, which reads as
    # "no rail on this side" — a clean verdict from an examination that never happened (§4b).
    def _real():
        return (v for v in values if v not in skip)
    if next(_real(), _NO_SAMPLE) is _NO_SAMPLE:
        return []
    out = []
    for toward_high in (False, True):
        rail = rail_value(_real(), toward_high=toward_high)
        if rail is None:
            continue                     # no rail on this side — a clean stream has none on either
        for first, n in _rail_runs(values, rail, toward_high=toward_high, max_spread=max_spread, min_run=min_run,
                                   annotations=skip, annotation_gap_max=_ANNOTATION_GAP_MAX):
            mono_in, mono_out, beyond = _ramp(values, first, n, toward_high=toward_high,
                                              ramp=ramp, annotations=skip)
            out.append({"first_index": first, "n_samples": n, "rail": rail,
                        "toward_high": toward_high, "monotone_in": mono_in,
                        "monotone_out": mono_out, "projects_beyond": beyond})
    out.sort(key=lambda r: r["first_index"])
    return out


def class_b_runs(records=None, *, columns=None, stream: str, min_run: int = _CLIP_MIN_RUN,
                 tick_ms: float | None = None, annotations=(), emit=None) -> dict:
    """Class-B (QUALITY) signatures for one stream: `clip` regions, or a `held` mark, never both.

    Class A is ABSENCE — a value that was not measured, which must reach a consumer as null. Class B is
    a value that WAS measured and is untrustworthy: an input pinned at a rail carries no information
    while looking exactly like data. The rule name is what lets a consumer tell them apart, which is
    why it travels in the row rather than being inferred from the stream's name.

    `records` is one entry per ROW — a tuple for a multi-channel stream, a scalar for one channel. A
    HOLD is a property of the record (every channel freezes on the same tick); a RAIL is a property of
    one channel (an ADC saturates by itself). Measuring either at the other's level is quietly wrong.

    There is deliberately NO `collapse` rule. It was specified, built and then measured away: after
    excluding the beat marker, the population of deviating near-constant regions that are not at a rail
    is 3-17 regions in 843,032 samples (0.006-0.020 %) at any defensible minimum, and the survivors sit
    a few LSB short of the ceiling — the same mechanism not quite reaching the rail, not a second one.
    A detector with no population is a parameter with no evidence.

    `emit` is the seam the sidecar writer fills — `emit(stream, value, first_index, n, dur_ms, closed,
    rule)`. It defaults to collecting the rows, so a test sees the real rows rather than a no-op that
    would pass while writing nothing.

    ⚠️ `columns=` IS THE SAME INPUT READ THE OTHER WAY ROUND — one sequence per channel instead of one
    record per row — and it exists for memory, not for expressiveness. The caller that reads a night
    off disk (`class_b_quality`) fills `array('q')` columns, which cost 8 bytes a sample against the
    ~143 the equivalent tuple-of-ints record cost: measured on vigil's 2026-09-21 night, the ring's
    5.26 M-row two-channel file alone took **755 MB** as records, inside the daemon that holds every
    BLE link. Run against each other on that night the two readers peak at **1116 MB and 245 MB** and
    produce byte-identical blocks. Records stay the documented input and every existing caller works;
    `test_class_b_runs_columns_equals_records` pins that the two produce the identical dict, so the
    cheap path can never quietly become a different rule.
    """
    if (records is None) == (columns is None):
        raise TypeError("class_b_runs takes exactly one of records= or columns=")
    if columns is not None:
        columns = list(columns)
        if not columns:
            raise ValueError("columns= must name at least one channel")
    rows = []
    if emit is None:
        def emit(stream, value, first_index, n, dur_ms, closed, rule):
            rows.append({"stream": stream, "value": value, "first_index": first_index,
                         "n_samples": n, "dur_ms": dur_ms, "closed": closed, "rule": rule})
    n_records = len(columns[0]) if columns is not None else len(records)
    held = held_columns(columns) if columns is not None else held_stream(records)
    if held is not None:
        # Reported ONCE, as what it is. Emitting its runs would bury a real finding under thousands of
        # rows describing the device working as designed.
        emit(stream, None, 0, n_records, None, True, "held ratio=%.2f" % held["ratio"])
        return {"stream": stream, "held": held, "rows": rows, "clips": {}}
    if columns is not None:
        wide = len(columns) > 1
        channels = columns
    else:
        wide = bool(records) and isinstance(records[0], tuple)
        channels = list(zip(*records)) if wide else [records]
    last = n_records - 1
    clips = {}
    for c, col in enumerate(channels):
        name = "%s:ch%d" % (stream, c) if wide else stream
        found = clip_regions(col, min_run=min_run, annotations=annotations)
        clips[name] = len(found)
        for r in found:
            dur_ms = None if tick_ms is None else r["n_samples"] * tick_ms
            closed = (r["first_index"] + r["n_samples"] - 1) != last
            emit(name, r["rail"], r["first_index"], r["n_samples"], dur_ms, closed, "clip")
    return {"stream": stream, "held": None, "rows": rows, "clips": clips}


def rtc_drift_summary(path: str | Sequence[str]) -> dict | None:
    """Roll a night's `_RTCLOG.csv` sidecars (RingClockLogWriter) into one ring-clock verdict, or None
    when there is no readback to summarise. The daemon watches the O2Ring's RTC against the host every
    ~10 min and logs each event; STATUS keeps only the latest, so WITHOUT this the night's drift and any
    battery-reset live only in a CSV nobody opens. Fields: `reads` (periodic readbacks), `drift_s`
    (last − first offset — the free-run the 0xC0 push corrects), `span_h` (first→last read), `resets`
    (offset jumped past threshold = a battery event that silently ruins the stored .dat's timebase),
    `pushes` (0xC0 sent), `files` (sidecars pooled). Rows are `Phone timestamp;event;rtc_offset_s;…`;
    PURE-ish (reads paths).

    ⚠️ ONE SIDECAR PER CONNECT SESSION, NOT PER NIGHT — so this takes every sidecar the ring wrote and
    pools their rows in filename order (the capture stamp, chronological). The first real night this
    reached (vigil 2026-09-05, the first after the case fix) had 29 sidecars: the ring reconnected 29
    times, and the caller handed over the FIRST file only. The verdict read `reads 1 · pushes 11 ·
    resets 0 · span_h 0.0` while the 29 files held 15 reads, 63 pushes and TWO reset-suspect events —
    the one finding this field exists to surface, invisible because the night was summarised from its
    first few minutes. A path that cannot be read is skipped, not fatal: on a 29-file night one torn
    sidecar must not null the other 28."""
    paths = [path] if isinstance(path, str) else list(path)
    lines: list[str] = []
    files = 0
    for p_ in paths:
        try:
            body = open(p_, encoding="utf-8", errors="replace").read().splitlines()
        except OSError:  # one torn sidecar of 29 must not null the night — and it is not hidden:
            continue  # `files` counts only what was read, so 28-of-29 lands in the record
        files += 1
        lines.extend(body[1:])            # each file carries its own header row
    if not files:
        return None
    offsets: list[float] = []
    times: list[str] = []
    resets = pushes = 0
    for ln in lines:
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
        # The endpoints alone cannot resolve a fall-back seam; walking the series with the
        # monotonicity rule can, so the span is the last resolved stamp minus the first.
        r = LocalStampResolver()
        walked = [r.resolve_ms(datetime.fromisoformat(t)) for t in times]
        t0, t1 = walked[0] / 1000.0, walked[-1] / 1000.0
        span_h = round((t1 - t0) / 3600, 1)
    except ValueError:
        span_h = None
    return {"reads": len(offsets), "first_offset_s": offsets[0], "last_offset_s": offsets[-1],
            "drift_s": round(offsets[-1] - offsets[0], 1), "span_h": span_h,
            "resets": resets, "pushes": pushes, "files": files}


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


def summarize(night_dir: str, devices: list[dict], wear: dict | None = None) -> dict:
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
    which was left out of the judgement.

    `wear` is OPTIONAL and is `{device name: loss_audit.wear_ends(...) result}`. Supplied, it names WHY
    a device stopped early (`stopped_early_reason`) and where its worn interval ended (`worn_end_at`).
    Omitted — the default, and the case for every caller with no loss audit to hand — both read None,
    which means "not determined" and never "worn to the end". It is a parameter rather than a call into
    `loss_audit` because that module reads each wear stream end to end: measured 6.9 s on the 794 MB
    2026-09-23 night (H10 5.0 s, Verity 1.9 s), which is worth paying once beside the caller's own
    audit rather than every time anything summarizes a night."""
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
        # ── THE DENOMINATOR IS THIS DEVICE'S OWN SPAN, not the session's (2026-09-24) ──────────────
        # Coverage asks, in its own words below, "did we receive the packets the device was SENDING".
        # Dividing by the SESSION span — the union across devices — answers a different question: it
        # charges one device for the time another kept recording. Measured on 2026-09-23, one session
        # 23:13:18 → 04:49:58 (span 20,200 s), against each device's own extent:
        #
        #   H10 ecg     own 20,089 s   own/session = 0.9945   reported 0.99   stopped  1.9 min early
        #   Verity ppg  own 18,499 s   own/session = 0.9158   reported 0.92   stopped 28.4 min early
        #   Ring ppg    own 18,699 s   own/session = 0.9257   reported 0.92   stopped 25.0 min early
        #
        # Every published number is that ratio to 2 dp, and QC's own `gaps` was EMPTY for the night —
        # so the "missing 8 %" was two devices stopping half an hour before the third, not absence.
        #
        # 🔴 THE REASON IT MATTERED: against the session span, "stopped early" and "dropped packets
        # while recording" produce the SAME number, and they are opposite findings — one is correct
        # behaviour and one is the loss this metric exists to catch. The early stop is now its own
        # published quantity (`stopped_early_s`) and the denominator is the device's own span, so a
        # genuine in-recording loss is the only thing that can move coverage off 1.00.
        #
        # Per DEVICE and not per stream, deliberately: the streams of one device stop together when its
        # link drops, which is what 09-23 shows (Verity acc and ppg both 0.92). Per-stream is the finer
        # grain and the data is here if a stream is ever seen stopping alone.
        _dev_files = [f for f in current if writers.file_device_id(f["file"]) in dids]
        _dev_end = max((f["mtime"] for f in _dev_files), default=None)
        dev_span = None
        # EVERY file must carry its own span, or the START cannot be bounded. Dropping the ones that do
        # not would move the start LATER, shorten the span and INFLATE coverage — the wrong direction for
        # a missing measurement — so an incomplete set falls back to the session span and says so, the
        # same shape `coverage_basis` already uses for the rate (§∅: absence is not a smaller number).
        if _dev_files and all(f.get("span_sec") for f in _dev_files):
            dev_span = _dev_end - min(f["mtime"] - f["span_sec"] for f in _dev_files)
            if dev_span < _MIN_SPAN_SEC:
                dev_span = None
        # Session end − this device's last write. Published so a reader sees 28.4 min on the Verity
        # rather than "8 % of nothing"; the session end it is measured against is named beside it.
        stopped_early_s = (round(cur[1] - _dev_end)
                           if (_dev_end is not None and span is not None) else None)
        streams: dict[str, int] = {}
        coverage: dict[str, float] = {}
        #: Per stream: "device" when the denominator was this device's own recording extent, "session"
        #: when it fell back because some file carried no measurable span. The rate's provenance is in
        #: `coverage_basis`; this is the OTHER factor of the same denominator, and publishing only one
        #: of the two is how the number came to mean two things at once.
        span_basis: dict[str, str] = {}
        #: THE OLD NUMBER, KEPT AND NAMED. `coverage` now answers what its definition says — did we
        #: receive what this device sent — which means an early stop reads 1.00, and until something
        #: consumes `stopped_early_s` that would silently retire the alert a died-at-hour-one stream used
        #: to raise. So the session-span ratio stays, as its own field, and `degraded` keeps keying on it:
        #: nothing that was flagged before stops being flagged, and no threshold had to be invented to
        #: keep it. When the early stop has a REASON (`stopped_early_reason`), `degraded` moves to
        #: coverage plus an unexplained early stop, and this stays as the reader's cross-check.
        session_coverage: dict[str, float] = {}
        #: Per stream: "measured" when its rate was observed off the file, "expected" when the
        #: configured rate was substituted because none could be measured. The coverage number is
        #: worth exactly what its rate is worth, and before this the two were indistinguishable.
        coverage_basis: dict[str, str] = {}
        for s in d.get("streams") or []:
            tags = stream_file_tags(s)
            # Everything is the CURRENT SESSION (the `current` set, unified across midnight) — so a stream
            # is `missing` only if it produced nothing THIS session, and its row count + coverage reflect
            # the session, never an earlier daytime or previous-night one.
            rows = sum(f["rows"] for f in current
                       if writers.file_device_id(f["file"]) in dids and f["stream"] in tags)
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
            # 🔴 THE BASIS IS PUBLISHED, BECAUSE THE NUMBER ALONE CANNOT BE TRUSTED OR DISCARDED.
            # This read `measured or expected`, so a stream whose rate was never measured borrowed the
            # EXPECTED one and its coverage was indistinguishable from one computed against an actual
            # observation — reaching `degraded`, the `ok` verdict and the alerts identically.
            #
            # ⚠️ DELETING THE FALLBACK IS THE OBVIOUS FIX AND IT IS THE WRONG ONE. Measured on the
            # 2026-09-12 night: of 9 rate rows, 4 carry a measured rate and 5 do not. Null-propagating
            # would therefore have deleted coverage for five of nine streams — and coverage is how a
            # stream that DIED becomes visible, so that trades a fabricated number for a blind spot.
            # §∅ requires that an unmeasured quantity not masquerade as a measured one, not that it be
            # thrown away. So the number stays and `coverage_basis` says where its rate came from.
            # `or` is still gone — it swallowed a genuine 0.0 — and `measured` wins whenever it exists.
            hz = _measured_hz_of.get((_rate_key(d), s))
            basis = "measured"
            if hz is None:
                hz, basis = _expected_hz(d, s), "expected"
            _span, _sbasis = (dev_span, "device") if dev_span else (span, "session")
            if hz and _span:
                cov = round(rows / (hz * _span), 2)
                coverage[s] = cov
                coverage_basis[s] = basis
                span_basis[s] = _sbasis
            # The session-span ratio is computed whenever the session span exists, INDEPENDENTLY of
            # whether the device's own span could be bounded — so the alert does not quietly depend on a
            # file carrying a device clock. `degraded` keys on this one, unchanged.
            if hz and span:
                scov = round(rows / (hz * span), 2)
                session_coverage[s] = scov
                if scov < _DEGRADED_BELOW:
                    degraded.append(f"{name}:{s} {int(scov * 100)}%"
                                    + ("" if basis == "measured" else " (rate assumed)"))
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
        rtc_paths: list[str] = []
        for fn in sorted(os.listdir(night_dir)) if os.path.isdir(night_dir) else []:
            if writers.file_device_id(fn) not in dids:
                continue
            # ⚠️ UPPERCASE. `capture_filename` upper-cases every stream tag, so the writer emits
            # `..._RTCLOG.csv` — this matched `_rtclog.csv` and therefore matched NOTHING. Measured on
            # vigil 2026-09-05: 29 RTCLOG files on disk that day and `rtc: null` for every device,
            # including the ring that wrote them. The ring-clock verdict this function exists to
            # produce — drift_s, resets, pushes — has never been computed from a real night.
            # Same class as the ACCRAW mismatch above: the reader's filename expectation did not
            # match the writer's output, and nothing compared the two.
            # ⚠️ EVERY sidecar, not the first. The ring writes one `_RTCLOG.csv` per CONNECT SESSION,
            # and `and rtc is None` here summarised the night from its earliest one. Measured on vigil
            # 2026-09-05, the first night the case fix above reached: 29 sidecars, verdict
            # `reads 1 · pushes 11 · resets 0 · span_h 0.0` against 15 reads, 63 pushes and TWO
            # reset-suspect events on disk. The pooled roll-up is `rtc_drift_summary`'s job; this
            # loop only collects.
            if fn.endswith("_RTCLOG.csv"):
                rtc_paths.append(os.path.join(night_dir, fn))
            elif fn.endswith("_STORED.dat") and dat_path is None:
                dat_path = os.path.join(night_dir, fn)
            elif fn.endswith("_SPO2.csv") and spo2_path is None:
                spo2_path = os.path.join(night_dir, fn)
        if rtc_paths:
            rtc = rtc_drift_summary(rtc_paths)
        if dat_path and spo2_path:
            datfit = dat_timefit_summary(dat_path, spo2_path)
        per_device.append({"name": name, "streams": streams, "coverage": coverage,
                           "coverage_basis": coverage_basis, "span_basis": span_basis,
                           "session_coverage": session_coverage,
                           "span_sec": round(dev_span) if dev_span else None,
                           "stopped_early_s": stopped_early_s,
                           "session_end": round(cur[1]) if span is not None else None,
                           # WHY it stopped, from `loss_audit.wear_ends`'s `worn_end.reason` — NEVER
                           # inferred here, and `None` still means "not determined" rather than "no
                           # reason". Three things this deliberately does not do:
                           #   · it does not GUESS when no wear block was supplied (`wear=None`, the
                           #     default, and every caller that has no loss audit to hand);
                           #   · it does not name a reason for a device that did NOT stop early. A
                           #     reason for a 0-second early stop would read as a fault where there is
                           #     none — the H10 that defines the session end is the normal case;
                           #   · it does not MAP the vocabulary. `quiet-end-unclassified` travels
                           #     verbatim: it is the wear unit's way of saying it could not tell, and
                           #     translating it into anything shorter would manufacture a verdict.
                           "stopped_early_reason": None,
                           # The wear boundary itself, whether or not the device stopped early — so the
                           # off-body tail is READABLE rather than inferred. The H10 on 2026-09-23 has
                           # `stopped_early_s = 0` because it defines the session end, and still came off
                           # 28 min before its file did; that window held 2,766 of the night's 2,767
                           # "PVCs" (#3001). Without this field a reader has to join two files to see it.
                           "worn_end_at": None,
                           "silent_sec": silent, "rtc": rtc, "datfit": datfit})
    return attach_wear({
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
        # CLASS-B QUALITY — `clip` spans pinned at each stream's own observed rails, and a computed
        # `held` mark. Whole-night because the rail is not knowable until the night is complete.
        # Reported, never folded into `ok`: a clipped stretch is a defect of the SIGNAL, not of the
        # capture, and conflating them would make a good recording read as a capture failure — the
        # same separation `arrival` above is kept out of `ok` for.
        "class_b": class_b_quality(night_dir),
        # OBSERVABILITY (residue 2026-09-10-daemon-restarts-are-idle-gated): the night's daemon
        # starts and how many fell inside a capture — `scanned` is passed so the night is not walked
        # a second time for it.
        "daemon": daemon_starts(night_dir, scanned),
        # What rate the files ACTUALLY carry, against what was asked for. Coverage notices a rate swap
        # only as `degraded`, which names it a link fault; this names it a rate fault.
        "rates": _rate_rows,
    }, wear)


# ── VERDICTS — one `tepna.verdict/1` object per gate per night (VERDICT-CONTRACT §3b, wave 1) ──────────
# Both criteria are PRE-STATED here as constants, written from what the code decided BEFORE the objects
# existed (2026-09-21): a tool that computes its threshold from the data it judges cannot emit a PASS.
_QC_GATE = "night-qc"
_QC_CRITERION = {"name": "stream_coverage", "threshold": _DEGRADED_BELOW, "unit": "fraction", "direction": "gte"}
_QC_VERDICT_NAME = "QC-VERDICT.json"
_BACKCHECK_GATE = "night-backcheck"
_BACKCHECK_CRITERION = {"name": "clip_regions_plus_held_streams", "threshold": 0, "unit": "count", "direction": "lte"}
_BACKCHECK_VERDICT_NAME = "BACKCHECK-VERDICT.json"
_TOOL = "capture-host/nightqc.py"


def qc_verdict(summary: dict, devices: list[dict], *, night_dir: str = "") -> dict:
    """The `night-qc` verdict from a `summarize()` result. The rule is summarize's own `ok`, split into
    the states a machine must not confuse:

      PASS          every declared stream on every non-optional device delivered rows this session at
                    coverage ≥ 0.5 of rate × span, and no session inside the night window was excluded
      FAIL          a RECORDING device has a missing or degraded stream (reason names each, with %)
      SHORTFALL     the headline held but a session inside the night was excluded from the judgement
                    (`gaps_in_night`) — met on the whole, not on a stated sub-population
      UNDERPOWERED  span < _MIN_SPAN_SEC: coverage is unknown there, not low
      UNKNOWN       every expected device produced NOTHING, so no sibling witnesses the radio: nobody
                    wore the kit and a dead adapter are indistinguishable from here
      NOT_RUN       no device is configured — nothing was declared, so nothing was examined

    `coverage` carries ONLY the streams whose denominator was the device's own extent
    (`span_basis: "device"`). A session-basis coverage travels in `coverage_session_basis` and an
    unlabelled one in `coverage_basis_unknown`, because those answer a different question and folding
    them together is how one number came to mean two things.

    Population = declared streams, as an EQUALITY. `checked` are the streams of devices that RECORDED;
    `excluded` are `optional` backups plus every stream of a device that produced nothing (declared,
    not judged — see the block below); eligible = all declared. A crash → UNKNOWN naming it.
    ⚠️ An ABSENT device is excluded rather than failed, and that is the whole point: "never started"
    and "recorded badly" are opposite findings, and only the second is this gate's business.
    """
    import verdict as _v
    ev = [_TOOL, os.path.join(night_dir, _SUMMARY_NAME) if night_dir else _SUMMARY_NAME]
    try:
        # ── A SESSION-BASIS COVERAGE IS NOT THIS DEVICE'S COVERAGE (2026-09-25) ────────────────────
        # `summarize` divides by the device's OWN recording extent where it can bound one, and falls back
        # to the SESSION span — the union across every device — where it cannot, saying so per stream in
        # `span_basis`. That label was published and no consumer read it, so this verdict presented both
        # kinds in one `coverage` map as though they answered the same question. They do not: one is "did
        # we receive what this device sent", the other is "what fraction of the whole session's elapsed
        # time did this device's rows cover", and on a night whose directory holds TWO capture sessions
        # the second reads ~0.47 for a device that recorded perfectly through one of them. Measured at
        # 21:33 on SOLID-NIGHT night 1: nine streams, every one `span_basis: "session"`, `span_sec: None`.
        #
        # ⚠️ The fallback itself is DELIBERATE and stays — `test_a_clockless_file_falls_back_to_the_
        # session_span_and_SAYS_SO` pins it, and its reason holds: dropping a clockless file would move
        # the start later, shorten the span and INFLATE coverage. Nothing here deletes a number. The
        # verdict simply stops conflating two denominators, and `degraded` (which keys on
        # `session_coverage`) is untouched, so no alarm changes.
        cov: dict[str, float] = {}
        cov_session: dict[str, float] = {}
        cov_unknown: dict[str, float] = {}
        for _d in summary.get("devices") or []:
            _sb = _d.get("span_basis") or {}
            for _s, _c in (_d.get("coverage") or {}).items():
                _key = f"{_d['name']}:{_s}"
                # A MISSING basis is its own bucket, never folded into either: absence of the label is
                # not evidence of which denominator was used (§∅), and an old summary read back by a
                # newer reader is exactly where that guess would land.
                # `_sb.get(_s)` is None when the basis label is absent, and that falls to
                # `cov_unknown` BY DESIGN (the note above). The cast says so; the behaviour is unchanged.
                _basis: str = _sb.get(_s) or ""
                {"device": cov, "session": cov_session}.get(_basis, cov_unknown)[_key] = _c
        # Heterogeneous by construction (lists, dicts and counts under one roof), so the value type
        # is annotated once HERE rather than narrowed at each of its readers. Without it mypy infers
        # a union carrying None and every `set(result["missing"])` downstream reads as a possible
        # crash — noise that hid a REAL one four lines up for a day.
        result: dict[str, Any] = {"coverage": cov, "coverage_session_basis": cov_session,
                  "coverage_basis_unknown": cov_unknown, "missing": list(summary.get("missing") or []),
                  "degraded": list(summary.get("degraded") or []),
                  "gaps_in_night": list(summary.get("gaps_in_night") or []),
                  "span_sec": summary.get("span_sec")}
        span = summary.get("span_sec")
        # ── A DEVICE THAT NEVER STARTED IS NOT A DEVICE THAT RECORDED BADLY (2026-09-25) ───────────
        # Measured on SOLID-NIGHT night 1: with the kit on its dock the verdict read FAIL, because every
        # zero-row stream lands in `missing` and ANY `missing` entry was a FAIL. Those are opposite
        # findings and the band says so — a night nobody wore is NOT_APPLICABLE, never FAIL, and the
        # consecutive counter SKIPS it (solid_night.py §3.1). A FAIL there convicts the box of a fault
        # that belongs to nobody, and it is the verdict WORD that is wrong, not a number.
        #
        # THE WITNESS IS A SIBLING THAT PRODUCED ROWS, and it is read here rather than borrowed:
        #   · some devices recorded, others did not  → the recording siblings PROVE the radio worked, so
        #     each absent device is declared-but-not-judged. Its streams move to `excluded`, and the
        #     verdict comes from the devices that did record.
        #   · EVERY expected device is absent        → nothing witnesses the radio, and no-wear is then
        #     INDISTINGUISHABLE from a dead adapter, so the answer is UNKNOWN and says which two states
        #     it cannot separate. Never NOT_APPLICABLE on absence alone — that is the band's own rule,
        #     and upgrading it needs the per-radio ADAPTERHCI witness, which is a DIFFERENT producer's
        #     fact. `absent` is published so the SOLID-NIGHT composer can apply it; this verdict does
        #     not reach across and guess.
        # A device with SOME streams missing is NOT absent — that is a partial failure and stays FAIL.
        # ── A DEVICE WITH NO IDENTITY IS EXCLUDED AND NAMED, NEVER KEYED `None` (2026-09-25) ──────
        # `d.get("name") or d.get("device_id")` is None when a configured device carries NEITHER, and
        # that None became a dict KEY here. `sorted()` two lines down then compares it against the
        # str keys beside it and RAISES:
        #     TypeError: '<' not supported between instances of 'NoneType' and 'str'
        # — reproduced, not inferred. `', '.join(absent)` raises the same way on the None member. That
        # takes down the whole QC verdict path, which is the thing that decides whether a night is
        # judged at all, so a malformed entry convicts every OTHER device of nothing being reported.
        #
        # ⚠️ IT IS REACHABLE: #3040 hardened the qc ALERT path against exactly this input ("refuses a
        # malformed devices list, naming what arrived"). A malformed `devices` list is a known event
        # on this box; that path was guarded and this one was not.
        #
        # The remedy is NOT an annotation. A device with no identity cannot be judged — it cannot even
        # be addressed in `missing`, whose entries are `f"{name}:{stream}"` — so it is EXCLUDED, and
        # the population equality (checked + excluded == eligible) carries it rather than dropping it.
        # It is NAMED by what it actually carried, because there is no name to name it by; that is the
        # same "name what arrived" shape #3040 used for the alert path.
        _unidentified = [d for d in devices
                         if not d.get("optional") and not (d.get("name") or d.get("device_id"))]
        _declared = {_k: list(d.get("streams") or [])
                     for d in devices if not d.get("optional")
                     for _k in [d.get("name") or d.get("device_id")] if _k}
        _miss = set(result["missing"])
        absent = sorted(n for n, ss in _declared.items() if ss and all(f"{n}:{s}" in _miss for s in ss))
        recorded = sorted(n for n, ss in _declared.items() if n not in absent)
        if _unidentified:
            # Published so a reader can FIND the malformed entry: it has no name, so it is named by the
            # streams it declared. Absent the key, a silent drop would shrink `eligible` and the
            # equality would still balance — which is exactly how this would hide.
            result["unidentified_devices"] = [sorted(d.get("streams") or []) for d in _unidentified]
        result["absent"] = absent
        result["absent_witnessed_by"] = recorded if absent else []
        # The population is an EQUALITY and an absent device was declared, so it is EXCLUDED and never
        # simply dropped: checked + excluded == eligible, and a PASS over `checked: 0` is invalid by
        # schema rather than by convention.
        checked = sum(len(ss) for n, ss in _declared.items() if n in recorded)
        excluded = sum(len(d.get("streams") or []) for d in devices if d.get("optional")) \
            + sum(len(ss) for n, ss in _declared.items() if n in absent) \
            + sum(len(d.get("streams") or []) for d in _unidentified)
        eligible = sum(len(d.get("streams") or []) for d in devices)
        pop = {"checked": checked, "eligible": eligible, "excluded": excluded}
        if eligible == 0:
            return _v.make(gate=_QC_GATE, status="NOT_RUN", population=pop, criterion=_QC_CRITERION, result=None,
                           evidence=ev, reason="no device is configured — nothing was declared to judge", tool=_TOOL)
        if absent and not recorded:
            return _v.make(gate=_QC_GATE, status="UNKNOWN", population=pop, criterion=_QC_CRITERION,
                           result=result, evidence=ev, tool=_TOOL,
                           reason="no expected device produced a row, and no sibling recorded to witness the "
                                  "radio — nobody wore the devices and a dead adapter are indistinguishable "
                                  f"from here: {', '.join(absent)}")
        if checked == 0:
            return _v.make(gate=_QC_GATE, status="NOT_RUN", population=pop, criterion=_QC_CRITERION, result=None,
                           evidence=ev, reason="no device is configured — nothing was declared to judge", tool=_TOOL)
        # Only the RECORDING devices' faults are judged; an absent device's streams are excluded above,
        # so its `missing` entries must not also convict it here.
        result["missing"] = [m for m in result["missing"] if m.split(":", 1)[0] not in set(absent)]
        if result["missing"] or result["degraded"]:
            parts = ([f"missing: {', '.join(result['missing'])}"] if result["missing"] else []) + \
                    ([f"degraded (< {int(_DEGRADED_BELOW * 100)} %): {', '.join(result['degraded'])}"] if result["degraded"] else [])
            return _v.make(gate=_QC_GATE, status="FAIL", population=pop, criterion=_QC_CRITERION, result=result,
                           evidence=ev, reason="; ".join(parts), tool=_TOOL)
        if span is None or span < _MIN_SPAN_SEC:
            return _v.make(gate=_QC_GATE, status="UNDERPOWERED", population=pop, criterion=_QC_CRITERION,
                           result=result, evidence=ev, tool=_TOOL,
                           reason=f"span {span if span is not None else 'unknown'} s is under the {int(_MIN_SPAN_SEC)} s "
                                  "minimum — coverage is unknown, not low")
        if result["gaps_in_night"]:
            return _v.make(gate=_QC_GATE, status="SHORTFALL", population=pop, criterion=_QC_CRITERION,
                           result=result, evidence=ev, tool=_TOOL,
                           reason="every stream met coverage, but a capture session inside the night window was "
                                  "excluded from the judgement: " + "; ".join(result["gaps_in_night"]))
        return _v.make(gate=_QC_GATE, status="PASS", population=pop, criterion=_QC_CRITERION, result=result,
                       evidence=ev, reason=None, tool=_TOOL)
    except Exception as exc:  # noqa: BLE001 — a crash is not a verdict; it is UNKNOWN with the exception named
        return _v.unknown(gate=_QC_GATE, criterion=_QC_CRITERION, evidence=ev, tool=_TOOL, exc=exc)


def backcheck_verdict(night_dir: str, summary: dict) -> dict:
    """The `night-backcheck` verdict: no class-B block carries a clipped region or a held stream.

    ⚠️ THE POPULATION IS THE NEW INFORMATION. `class_b_quality` SKIPS a file it cannot judge — unreadable,
    no waveform column in its header, under the minimum run — with `continue`, so a night in which every
    PPG file was skipped produced an empty list, which `night_report.back_check` read as "0 spans, ok".
    Here eligible = every PPG/PPG2W/ECG capture in the directory, checked = those with a block, and
    excluded = the difference — so a clean verdict about files nobody examined cannot be written:
    eligible > 0 with checked == 0 is UNKNOWN, and a night with no class-B file at all is NOT_RUN.
    """
    import verdict as _v
    ev = [_TOOL, os.path.join(night_dir, _SUMMARY_NAME)]
    try:
        names = sorted(os.listdir(night_dir)) if os.path.isdir(night_dir) else []
        eligible_files = [n for n in names if (parse_capture_name(n) or ("", ""))[0] in _CLASS_B_TAGS]
        blocks = [b for b in (summary.get("class_b") or []) if isinstance(b, dict)]
        checked = sum(1 for b in blocks if b.get("file") in eligible_files)
        pop = {"checked": checked, "eligible": len(eligible_files), "excluded": len(eligible_files) - checked}
        per_file = {}
        clips = held = 0
        for b in blocks:
            raw = b.get("clips")
            got: dict = raw if isinstance(raw, dict) else {}
            c = sum(int(v) for v in got.values() if isinstance(v, int) and not isinstance(v, bool) and v > 0)
            h = b.get("held") is not None
            per_file[str(b.get("file"))] = {"clip_regions": c, "held": h}
            clips += c
            held += 1 if h else 0
        result = {"clip_regions": clips, "held_streams": held, "files": per_file}
        if not eligible_files:
            return _v.make(gate=_BACKCHECK_GATE, status="NOT_RUN", population=pop, criterion=_BACKCHECK_CRITERION,
                           result=None, evidence=ev, tool=_TOOL,
                           reason="the night holds no PPG/PPG2W/ECG capture — nothing to back-check")
        if checked == 0:
            return _v.make(gate=_BACKCHECK_GATE, status="UNKNOWN", population=pop, criterion=_BACKCHECK_CRITERION,
                           result=result, evidence=ev, tool=_TOOL,
                           reason=f"all {len(eligible_files)} class-B file(s) were skipped by the check "
                                  "(unreadable, no waveform column, or under the minimum run) — nothing was examined")
        if clips or held:
            bad = [f"{f}: {v['clip_regions']} clip region(s)" + (", held" if v["held"] else "")
                   for f, v in per_file.items() if v["clip_regions"] or v["held"]]
            return _v.make(gate=_BACKCHECK_GATE, status="FAIL", population=pop, criterion=_BACKCHECK_CRITERION,
                           result=result, evidence=ev, tool=_TOOL,
                           reason=f"{clips} clipped region(s) and {held} held stream(s) over {checked} file(s): " + "; ".join(bad))
        return _v.make(gate=_BACKCHECK_GATE, status="PASS", population=pop, criterion=_BACKCHECK_CRITERION,
                       result=result, evidence=ev, reason=None, tool=_TOOL)
    except Exception as exc:  # noqa: BLE001 — a crash is not a verdict
        return _v.unknown(gate=_BACKCHECK_GATE, criterion=_BACKCHECK_CRITERION, evidence=ev, tool=_TOOL, exc=exc)


def adapter_hci_verdict(night_dir: str, summary: dict) -> dict:
    """The `adapter-hci` verdict (adapter_hci.py — the pre-stated rule lives there) over the rows of
    `<root>/ADAPTERHCI.csv` that fall inside the night's session window. The root is the night dir's
    grandparent (`<root>/captures/<night>`); a night with no session window has no rows to read and
    is NOT_RUN by the builder's own rule."""
    import adapter_hci
    root = os.path.dirname(os.path.dirname(os.path.abspath(night_dir)))
    night = os.path.basename(night_dir.rstrip("/"))
    sessions = [s for s in (summary.get("sessions") or []) if isinstance(s, dict)]
    try:
        if not sessions:
            rows: list[dict] = []
        else:
            start = min(int(s["start"]) for s in sessions) * 1000
            end = max(int(s["end"]) for s in sessions) * 1000
            rows = adapter_hci.read_rows(root, start, end)
        return adapter_hci.verdict_object(rows, night=night, root=root)
    except Exception as exc:  # noqa: BLE001 — a crash is not a verdict
        import verdict as _v
        return _v.unknown(gate=adapter_hci.GATE, criterion=adapter_hci.CRITERION,
                          evidence=[adapter_hci.TOOL, os.path.join(root, adapter_hci.FILE_NAME)], tool=adapter_hci.TOOL, exc=exc)


def attach_wear(summary: dict, wear: dict | None) -> dict:
    """Fill each device's `stopped_early_reason` / `worn_end_at` from a `loss_audit.wear_by_device`
    mapping. PURE, returns the same object, and is the ONE place wear reaches a QC summary.

    It is a separate function rather than an argument threaded through the scan because of WHERE the two
    halves run. `capture.qc_poller` offloads the scan to a spawned child (`_qc_offload`) so QC never
    costs the recording; the wear scan runs on a THREAD beside it — the precedent is `write_night` in the
    same file, which already runs `wear_ends` for every device through `asyncio.to_thread` — and the two
    results are joined here by pure arithmetic over dicts.

    ⚠️ NEITHER THIS NOR THE WEAR SCAN MAY BECOME AN OFFLOAD TARGET, and that is a measured trap rather
    than a style note. `_importable_by_reference` decides child-versus-thread by whether the target's
    module still binds that name to that object, and several poller tests patch `nightqc.summarize` with
    a LAMBDA precisely so that check fails and the poll runs on a thread — a frozen `time.monotonic` and
    a spawned child cannot coexist, because `multiprocessing` reads it for its deadlines and the child's
    result never arrives. Offloading any OTHER module-level name steps out from under those patches.
    Measured twice: `check.sh` wedged at 98 % with all 24 xdist workers idle and the controller in
    `futex_do_wait`, and a single test hung with a `multiprocessing` queue feeder alive beside it.

    Absent, the fields stay None, which means "not determined" and never "worn to the end"."""
    for dev in summary.get("devices") or []:
        if not isinstance(dev, dict):
            continue
        name = dev.get("name")
        # A reason belongs only to a device that DID stop early — naming one for a 0-second early stop
        # reads as a fault where there is none, and the device defining the session end is the normal
        # case. The boundary is published either way, so an off-body tail stays readable.
        if dev.get("stopped_early_s"):
            dev["stopped_early_reason"] = _worn_end_reason(wear, name)
        dev["worn_end_at"] = _worn_end_at(wear, name)
    return summary


def write_verdicts(night_dir: str, summary: dict, devices: list[dict]) -> None:
    """The three objects beside QC-SUMMARY.json. Never raises: a verdict that cannot be written is
    logged, and the summary write it accompanies must not be lost to it."""
    import adapter_hci
    import verdict as _v
    for name, obj in ((_QC_VERDICT_NAME, qc_verdict(summary, devices, night_dir=night_dir)),
                      (_BACKCHECK_VERDICT_NAME, backcheck_verdict(night_dir, summary)),
                      (adapter_hci.VERDICT_NAME, adapter_hci_verdict(night_dir, summary))):
        try:
            _v.write(os.path.join(night_dir, name), obj)
        except (OSError, ValueError):
            log.warning("night-QC: could not write %s beside the summary", name, exc_info=True)


_STREAM_ANNOTATIONS = {
    # Values that are NOT SAMPLES, by capture FORMAT rather than by defect. Keyed on the file tag.
    # ⚠️ This is a value list, and the detectors refuse to be value lists — the difference is that
    # this declares a property of the format, knowable in advance, rather than a property of the data.
    # The O2Ring writes its beat marker into the sample column of its PPG streams; the Verity and the
    # H10 write no such thing, so their entries are deliberately absent rather than empty-by-oversight.
    "PPG": (156,),
    "PPG2W": (156,),
}
_CLASS_B_TAGS = ("PPG", "PPG2W", "ECG")
# Columns that are NOT WAVEFORMS, by capture FORMAT — the third term the detector needs beside
# sample and annotation. A status or orientation column travels in the same row as the samples
# and is not one: PPG2W's `motion` is the ring's u8 stillness byte, whose CORRECT reading — `0`,
# still — is a rail by every distributional test, and ECG's `timestamp [ms]` is a device axis.
# Both were being scanned because the reader took every column after the two stamps by POSITION;
# measured 2026-09-07 on the 2026-09-06 night, `ppg2w:ch2` carried 156 spans and a 700,409-sample
# run on a file whose two real channels were clean, and the H10's ECG was labelled `ecg:ch1`
# behind its own timestamp. Declared by header NAME, never by position, so a format that gains a
# column cannot silently become a waveform. Like `_STREAM_ANNOTATIONS` this is a property of the
# format knowable in advance, not a value list; and it is a DENYLIST on purpose — a forgotten
# status column over-flags, whereas a forgotten waveform in an allowlist would go unscanned.
_NON_WAVEFORM_COLUMNS = frozenset({
    "Phone timestamp", "sensor timestamp [ns]", "timestamp [ms]", "motion", "beat",
})


def _waveform_columns(header: str) -> tuple:
    """`((index, name), …)` of the columns a class-B scan reads, from the file's own header row."""
    names = [h.strip() for h in header.rstrip("\n").split(";")]
    return tuple((i, n) for i, n in enumerate(names) if n and n not in _NON_WAVEFORM_COLUMNS)


def class_b_quality(night_dir: str, *, emit=None) -> list:
    """One class-B block per PPG/ECG capture in the night — the END-OF-NIGHT back-check.

    Empty list when nothing was captured: nothing to report is not the same as everything healthy, so
    the key holds sessions rather than a verdict, exactly as `ppg2w_contact_quality` does.

    Whole-night by necessity, not by preference. `clip` is pinned at the stream's OWN observed rails
    and there is no declared bound to test against — the ring's ceiling is 199 with a thin overshoot to
    200, which is not an encoding extreme — so the rail cannot be known until the night is complete.
    That is precisely the half the live writer cannot do.

    Rows that do not parse are SKIPPED, not fatal: a mid-file repeated header is a real rotation
    artifact and one torn row must not erase a session's verdict.

    The columns scanned are chosen from the file's OWN header by name (`_NON_WAVEFORM_COLUMNS`), and
    the block records them as `columns` so a `<stream>:chN` row is resolvable to a column name: `chN`
    indexes `columns`, not the file. A file whose header names no waveform column is skipped with a
    warning — absent, not clean.
    """
    out = []
    for name in sorted(os.listdir(night_dir) if os.path.isdir(night_dir) else []):
        parsed = parse_capture_name(name)
        if parsed is None or parsed[0] not in _CLASS_B_TAGS:
            continue
        tag = parsed[0]
        # ONE ARRAY PER CHANNEL, NOT ONE TUPLE PER ROW. `array('q')` holds a sample in 8 bytes; the
        # tuple-of-ints record it replaces cost ~143 (measured: 755 MB for the 5.26 M-row two-channel
        # PPG2W of vigil's 2026-09-21 night, inside the daemon that holds every BLE link). The rows
        # are the same rows and `class_b_runs(columns=…)` computes the same verdict from them — see
        # its note, and `test_class_b_runs_columns_equals_records`.
        chans: list = []
        columns: tuple = ()
        width = 0
        try:
            with open(os.path.join(night_dir, name), "r", encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    if not line.startswith("#"):    # `# timebase=…` precedes the header on box files
                        columns = _waveform_columns(line)
                        width = len(line.rstrip("\n").split(";"))
                        break
                for line in fh:
                    parts = line.rstrip("\n").split(";")
                    if len(parts) != width:
                        continue
                    try:
                        cols = [int(float(parts[i])) for i, _ in columns]
                    except ValueError:
                        continue      # a torn row is expected at a live file's tail and a repeated
                                      # mid-file header is a real rotation artifact; the spans are
                                      # built from the rows that parsed, and `_CLIP_MIN_RUN` plus the
                                      # rail qualification refuse a verdict built from too few
                    if not chans:
                        chans = [_array("q") for _ in cols]
                    for ch, v in zip(chans, cols):
                        ch.append(v)
        except OSError:
            log.warning("night-QC: %s is unreadable, so its class-B quality is ABSENT rather than "
                        "clean — the two must not read alike", name, exc_info=True)
            continue
        if width and not columns:
            log.warning("night-QC: %s names no waveform column in its header, so its class-B quality "
                        "is ABSENT rather than clean", name)
            continue
        if not chans or len(chans[0]) < _CLIP_MIN_RUN:
            continue        # includes a file with no header yet — a 0-byte open capture (seen on
                            # the box: a Verity session file 30 s old), which is too few rows, not
                            # a malformed header, and is not worth a warning per scan
        block = class_b_runs(columns=chans, stream=tag.lower(),
                             annotations=_STREAM_ANNOTATIONS.get(tag, ()), emit=emit)
        block["file"] = name
        block["columns"] = [n for _, n in columns]
        out.append(block)
    return out


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
