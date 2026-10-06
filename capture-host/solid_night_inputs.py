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

import bisect as _bisect
import datetime as _dt
import glob
import json
import os
import re
from typing import Any

import nights_index as _ni
import loss_audit as _la
import nightqc as _nqc
import writers as _wr

LOSS_AUDIT_NAME = "LOSS-AUDIT.json"
PMDNEG_NAME = "PMDNEG.csv"

# model → the file prefix the box writes, the PRIMARY stream (the one the loss audit reads, and the one
# continuity and completeness are scored on), and the WAVEFORM streams whose validity sidecar is required.
# 🔴 `clock` IS NOT `primary`, AND CONFLATING THEM MISREAD EVERY RING NIGHT. `primary` is the stream
# continuity and completeness are scored on — for the ring that is the polled vitals CSV, which is the
# right denominator for "did we get the samples we asked for". `clock` is the stream that carries a
# DEVICE-REPORTED per-sample time, which is what the timebase band and §A5 need, and they are different
# questions about different files. The timebase band read `primary`, so for the ring it opened
# `…_SPO2.csv`, found no `sensor timestamp [ns]` column and said "no device clock" — true of that file
# and not a finding about the night. 2026-10-04 is the first night with LOSS, H10 and Verity all PASS
# and the ring alone UNKNOWN on exactly that; 10-02 read the same and 10-01 hid it behind a completeness
# FAIL.
#
# `clock: None` FOR THE RING, AND THE REASON IS ABOUT THE EXPORTED AXIS, NEVER THE HARDWARE. The ring
# HAS a crystal and we discipline it — `oxyii.SET_UTC_TIME (0xC0)` pushes host wall-clock to its RTC so
# its stored-session `.dat` stamps line up — and `O2RING-PROTOCOL-2026-07-17-BRIEF` §153 says that RTC
# "must never stamp the waveform". What the ring exports carries no per-sample clock reading: every
# optical stream's `sensor timestamp [ns]` is the HOST's, not the device's. `accraw`, `ppg2w` and
# `pletha` write it as a literal 0 ("this opcode exposes no device clock", writers.py), and `_PPG.txt`'s
# column is `O2PpgGrid` — "the ring publishes NO PER-SAMPLE clock, so the host lays its samples on a
# grid and writes that grid" (capture.py). Pointing the band at that grid would judge the host's own
# reconstruction as a device axis and could PASS it, which is worse than refusing: a confident verdict
# about an instrument that is not there. Measured 2026-10-04; `o2ring-timestamp-is-drawn` carries the
# owner's correction on this wording.
MODELS: dict[str, dict[str, Any]] = {
    "H10": {
        "prefix": "Polar_H10_",
        "primary": "ECG",
        "clock": "ECG",
        "rtc": None,
        "ext": ".txt",
        "pmd": "ecg",
        "waveforms": ("ECG", "ACC"),
    },
    "VeritySense": {
        "prefix": "Polar_VeritySense_",
        "primary": "PPG",
        "clock": "PPG",
        "rtc": None,
        "ext": ".txt",
        "pmd": "ppg",
        "waveforms": ("PPG", "ACC"),
    },
    "O2Ring-S": {
        "prefix": "Wellue_O2Ring-S_",
        "primary": "SPO2",
        "clock": None,
        "rtc": "RTCLOG",
        "ext": ".csv",
        "pmd": None,
        "waveforms": ("PPG", "PPG2W", "ACCRAW"),
    },
}
# ── §3.4 `rtc` — the device's own RTC, judged against the host it is disciplined from ───────────────
#
# 🔴 EVERY BOUND HERE IS PRE-STATED FROM THE MIRROR, measured 2026-10-04 over 620 `*_RTCLOG.csv` in
# `/srv/data/tepna-corpus/uploads/vigil-archive/captures` — 181 nights with >= 2 reads, 2883 reads —
# BEFORE any night was judged. The derivation is quoted in SOLID-NIGHT-RTC-2026-10-04-BRIEF §2.
#
# ⚠️ THE OFFSET COLUMN IS TWO POPULATIONS, AND THAT IS THE WHOLE DESIGN. Binned by seconds since the
# last push: 0-2 s gives |offset| p50 0.80, **2-5 s gives p50 5.90 / p95 9.60 / max 11.9 (n=166)**,
# 60-300 s gives 0.70, and beyond an hour 0.40 with max 1.9. Clear of a push the clock is TIGHT —
# p99 1.6, p99.9 3.1, **max 3.3 over 2184 reads**. So essentially every read above 6 s sits inside one
# 2-5 s window after a push: a read landing mid-push-sequence reporting a half-applied time, NOT a
# drifting RTC. A bound applied to every read would therefore fail nights on the band's own instrument.
# The band judges reads taken CLEAR of a push and STATES how many it set aside (§🧾's
# `checked + excluded = eligible`). The spike itself is a capture-side defect, not this band's business:
# residue 2026-10-04-a-read-inside-the-push-sequence-reports-a-half-applied-time.
RTC_PUSH_SETTLE_S = 60.0  # a read within this of a push measures the sequence, not the clock
RTC_OFFSET_MAX_S = 8.0  # on the CLEAR reads THIS BAND ACTUALLY JUDGES — 2788 of them over 44 nights —
# |offset| is p50 0.5, p95 1.5, p99 4.4, p99.9 6.1, max 6.3. The bound sits ~1.3x that maximum, so it
# fires on nothing the mirror holds.
# ⚠️ IT WAS 5.0 FOR AN HOUR, AND 5.0 WAS DERIVED OVER THE WRONG POPULATION. The first derivation measured
# reads > 60 s after a push only where a push had ALREADY been seen, which silently dropped every read
# before a log's first push — and those carry free-run from whenever the RTC was last set. Over the
# narrower set the max was 3.3; over the set the band judges it is 6.3. Caught by running the band on the
# mirror: 2026-08-30's worst clear read is 6.3 and 2026-08-29's is 5.1, so a 5.0 bound FAILED 2 of 44
# nights. A bound measured on a narrower population than it is applied to is two populations wearing one
# number, which is the error this file keeps paying for.
# AND IT FAILS ONLY OUTSIDE EVERYTHING OBSERVED, which is A5's precedent applied here: the mirror holds no
# night labelled bad, so a detector that convicted the two churn nights would be convicting on a
# distribution's tail rather than on evidence. The band REPORTS the worst clear offset on every night —
# 08-30's 6.3 s is visible in its PASS reason — and FAILs only above anything the corpus has shown.
RTC_READ_GAP_MAX_S = 900.0  # cadence p50 600.4 / p99 606.4 / max 761.5 — a 10 min poll. A gap past this
# is a window nobody read, and a window never read reports NULL rather than a number (§∅).
RTC_OFFSET_QUANTUM_S = 0.1  # THE LOG'S OWN RESOLUTION, measured: 110 distinct values, min spacing 0.1.
RTC_DRIFT_MAX_PPM = 100.0  # spans > 4 h: |ppm| p50 26.3, p95 78.3, max 98.3 — crystal-plausible.
RTC_DRIFT_RESOLVE = 4.0  # ... and the span must resolve that bound this many times over, or the drift is
# NULL. The floor is `QUANTUM / span`, so a short night's ppm figure is the log's resolution and not the
# crystal: spans > 0.2 h measured p50 83.3 ppm against a floor of 166.7, i.e. the median was BELOW the
# noise. Publishing a number there would be absence-as-value in reverse.
NO_RTC_LOG = "this device keeps no RTC log — nothing here records a device-vs-host clock comparison to judge"


NO_DEVICE_AXIS = (
    "this device stamps no waveform — its RTC disciplines the host, not the samples, so its exported "
    "streams carry no per-sample device time for a timebase to be measured on"
)

# §3.4 continuity — the fixed-mechanism daemon classes whose recurrence inside the worn interval is a
# regression. `daemon:charging hold` is NOT here: it is device-positive doff evidence (correct behaviour).
# 🔴 OWNER RULING 2026-10-03: A PAUSE THE DAEMON DECLARES IS EXPLAINED, NOT A REGRESSION.
# `daemon:pull paused live` was in this set because §5's re-audit traced the pull-pause CHURN to a fixed
# mechanism (#2982/#2983), so a recurrence read as the fix regressing. The churn is the defect; the pause
# itself is the H10/Verity offline-recording op doing what it does, and the journal names it with its
# reason (`Polar <addr>: offline-recording op — live capture paused`). A discontinuity the system
# DECLARES is explained, and §∅ says reduced coverage ANNOTATES where a discontinuity refuses — so it
# leaves the band PASSing with the pause named rather than failing it, and it still counts toward the
# LOSS bar, which is a different consumer and is untouched here.
# Precedent both ways, and it is why this is a one-line set change rather than a new mechanism:
# `operator:time-sync` already re-labels this identical journal line so it does not fail the band (the
# 2026-09-24 one-press, two-FAIL fix in `loss_audit.py`), and `daemon:charging hold` was never in the set
# because the device reported charging — device-positive doff evidence, correct behaviour.
DECLARED_PAUSE = "daemon:pull paused live"
DAEMON_REGRESSION = (
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

# ── SOLID-NIGHT §A5 — the unrecorded-shift TRIPWIRE ─────────────────────────────────────────────────
# EVERY NUMBER HERE IS PRE-STATED IN THE BRIEF, measured over n = 36 clean nights (08-01 → 08-27 and
# 09-13 → 09-23, storm nights excluded as unadjudicable), and NONE is derived from a night being judged
# (§🧾). There is no measured signal side — the clean corpus holds ZERO true unrecorded steps — which is
# exactly why the fire is a TRIPWIRE (UNKNOWN, flagged for review) and never a FAIL: a detector that has
# never been validated against the thing it would convict must not convict.
A5_STEP_MS = 1000.0  # |persistence| ≥ 1 s, ~12x the quiet windowed-shift p99.9 of 81 ms (median per file)
A5_BEFORE_S = (-90.0, -30.0)  # the level BEFORE a candidate, relative to it
A5_AFTER_S = (60.0, 120.0)  # ... and AFTER. Persistence is after minus before — never the windowed peak:
# 1,237 of 1,756 corpus events above 1 s (70 %) were delivery-latency TRANSIENTS that RETURN, and a peak
# cannot tell them from a step. Do not re-tune this band to the peak.
A5_REANCHOR_S = 60.0  # split the anchors at re-anchors wider than this (the capture's own seam bound)
A5_BIN_S = 10.0  # delivery-rate bin. At 130 Hz a 10 s bin holds 17–18 batches, so healthy bins sit within
# about ±3 % — the quantisation Guard 1's 10 % is roughly three times.
A5_BIN_MS = int(A5_BIN_S * 1000)  # the same bin in ms, named ONCE. Every `A5_BIN_S * 1000.0` written inline
# was a separate mutation site whose `*`→`/` twin made the bin 0.01 ms; here that twin is `int(10.0 / 1000)`
# = 0, so the first `// A5_BIN_MS` raises ZeroDivisionError and the mutant DIES instead of timing out.
A5_RATE_TOL = 0.10  # Guard 1 (judgement): a window whose row rate departs from nominal by more than this
# is a LATENCY REGIME, not a step. A clock step holds the nominal rate while the level moves; a backlog
# collapses it (09-19: 25–90 % of nominal throughout its ramp). This is the discriminator the residual lacks.
A5_GAP_NEAR_S = 10.0  # Guard 2: an after-window containing, or ending within this of, a gap or the end of
# the stream cannot establish persistence — the level "after" must be measured on data that exists.
A5_GAP_FLOOR_S = 2.0  # the host gap width recorded during the residual pass, so Guard 2 has gaps to read
A5_RECORD_NEAR_S = 300.0  # a recorded clock event within this of a candidate MAKES IT RECORDED. Pre-stated
# rather than fitted: the 08-18 positive was logged at 04:09:08 for an instant at ~04:08, a lag of ~68 s,
# and 300 s is over four times that while staying inside the persistence window's own neighbourhood.
A5_DENSE_RECORDS = 2  # ... and this many records inside one candidate's persistence span is
# `clock-sets too dense to attribute` — the 08-28 → 09-12 resync storm, one set every ~5.5 min, where
# ±15–30 s flips minutes apart cannot be assigned to one another.

# THE SECOND-TO-MS CONVERSIONS, NAMED ONCE, for the reason `A5_BIN_MS` above already gives: every
# `A5_X_S * 1000.0` written inline inside the function was a separate mutation site, and twenty of the
# tripwire's survivors were perturbations of that one multiplier (`* 1001.0`, `/ 1000.0`, `- …`) rather
# than of anything the detector decides. A constant has ONE value and a test states it; the same
# arithmetic written out eight times has eight chances to be wrong and no single place to pin it. The
# windows stay in SECONDS above because that is how the brief states them and how they were measured.
A5_BEFORE_MS = (A5_BEFORE_S[0] * 1000.0, A5_BEFORE_S[1] * 1000.0)
A5_AFTER_MS = (A5_AFTER_S[0] * 1000.0, A5_AFTER_S[1] * 1000.0)
A5_REANCHOR_MS = A5_REANCHOR_S * 1000.0
A5_GAP_NEAR_MS = A5_GAP_NEAR_S * 1000.0
A5_RECORD_NEAR_MS = A5_RECORD_NEAR_S * 1000.0
A5_GAP_FLOOR_MS = A5_GAP_FLOOR_S * 1000.0
_SENSOR_NS_COL = "sensor timestamp [ns]"

_PMD_RATE = re.compile(r"^# pmd stream=\S+ negotiated=yes rate=(\d+(?:\.\d+)?)\b")
_FINAL = re.compile(r"^# final stream=\S+ seams=(\d+) examined=(\d+)")
_MIN_RUN = re.compile(r"\bmin_run=(\d+)\b")
_DECLARED_HZ = re.compile(r"@(\d+(?:\.\d+)?)Hz$")
# The rate came from the NAME of the signal, not from a record of what the device and host agreed. A
# named constant because `completeness` branches on it: matching the prose would break the moment the
# wording changed, and the branch would go quiet rather than red.
DECLARED_RATE_WHY = "declared in the acquisition evidence (A6)"


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


# ── THE RECORDING IS THE SCOPE (NIGHT-IS-THE-RECORDING-2026-10-05) ──────────────────────────────────
# 🔴 THE JUDGE'S POPULATION WAS THE FOLDER, AND A FOLDER IS NOT A NIGHT. Measured on the box
# 2026-10-04: that folder held THREE recordings (the 10-03/04 night from 00:26, a 09:52 daytime ring
# session, and the night from 22:00) and the verdict judged their union — completeness 46.25 % for BOTH
# the Verity (2,538,420 / 5,489,055 @ 55 Hz) and the H10 (6,014,297 / 13,004,420 @ 130 Hz). One
# percentage fitting two sample rates is the tell, and the denominators say why: they imply 27.72 h and
# 27.79 h, and the FOLDER's own span (first session 10-04 00:26:20 to the last write 10-05 04:17) is
# 27.84 h. Both devices were divided by the folder. `expected - actual` came to 14.9 h, exactly the
# 896 min the loss audit booked as lost under `daemon:pull paused live` — the daytime gap BETWEEN two
# recordings, charged to the daemon. Nothing was lost; two recordings were joined by a hole (#3290 §②,
# #3291 §harm).
#
# A RECORDING is the maximal chain of sessions separated by less than `nightqc._SESSION_GAP_SEC`,
# CLIPPED TO THE NIGHT BAND it begins in — one sleep, one night (owner ruling via Kestrel 2026-10-05).
#
# ⚠️ "CLIPPED" MEANS TWO THINGS AND BOTH ARE LOAD-BEARING. Measured while verifying the ruling: a first
# pass that clipped by session MEMBERSHIP alone reported a night span of 32.95 h, which cannot exist
# inside a 16 h band — the model was wrong, not the data.
#   · MEMBERSHIP (is the session's START inside the band?) decides the FOLDER SET, because a session's
#     files live in its start-date folder. This is what makes the two-folder bound STRUCTURAL.
#   · TRUNCATION (cut the interval at the band edges) bounds the SPAN. Membership alone does not: a
#     session starting 09:00 in a band that ends at 10:00 may run until 17:00, and one starting 19:00 may
#     run past the next 10:00. 9 of the mirror's 111 night recordings have a raw extent that leaves their
#     band, and for those the untruncated span — hence the completeness DENOMINATOR — is too wide again,
#     which is the 46.25 % defect reappearing one layer in. Truncated: p50 7.76 h, p95 14.75 h, max
#     exactly 16.00 h, none over the band width.
#
# THE TWO-FOLDER BOUND IS STRUCTURAL, NOT EMPIRICAL: a band runs 18:00 -> 10:00, so it touches exactly
# two calendar dates, so a clipped recording's sessions can only start in those two. Measured over the
# mirror: 111 night recordings, 61 in one folder, 50 in two, ZERO in three. The third-folder branch below
# is therefore a TRIPWIRE that must never fire, kept and asserted rather than deleted — a bound nobody
# checks is a bound nobody keeps.
#
# AND IT REACHES FORWARD, which is the opposite of `nightqc._prev_day_dir`. A recording is judged in its
# FIRST session's folder, so the judged dir holds the evening and the scope reaches to the NEXT day for
# the morning half. `_prev_day_dir` exists because QC is asked about the folder holding the morning and
# pools backward (QC-SCOPE-RESOLUTION-2026-07-28). Same one-day span, opposite direction; both are named
# so neither is mistaken for the other.
SCOPE_MAX_DIRS = 2  # structural: see above. Exceeding it is a refusal, never a truncation.


def _folder_date(night_dir: str):
    """The `datetime.date` a `YYYY-MM-DD` night folder is named for, or None if the basename isn't one."""
    try:
        return _dt.datetime.strptime(os.path.basename(night_dir.rstrip("/")), "%Y-%m-%d").date()
    except ValueError:
        return None


def _next_day_dir(night_dir: str):
    """Sibling folder for the NEXT calendar day, or None if the basename isn't a date.

    Where the morning half of a recording that began last evening lives. The mirror image of
    `nightqc._prev_day_dir`, and deliberately a separate name: this one is called from the recording's
    FIRST folder and reaches forward, that one is called from the folder holding the morning."""
    d = _folder_date(night_dir)
    if d is None:
        return None
    return os.path.join(os.path.dirname(night_dir.rstrip("/")), (d + _dt.timedelta(days=1)).isoformat())


def band_of(night_dir: str):
    """The night band this folder NAMES — `[D 18:00, D+1 10:00)` as epochs — or None without a date.

    The folder is the band's own name, not a guess from its contents: a folder dated D holds the
    recording that began on D's evening, whatever else also landed in it."""
    d = _folder_date(night_dir)
    if d is None:
        return None
    # ONE CONVENTION: the band comes from `nightqc.night_band`, never from a second copy of its
    # constants here. 23:00 on the folder's own date is inside that folder's band for any begin hour at
    # or before 23:00, so this asks the single implementation rather than restating its edges — which is
    # the whole point of the owner's "one convention" ruling on the 18:00 move.
    # THE MINUTE IS NOT A PARAMETER, and writing `time(23, 0)` made it look like one: two mutants of
    # that zero survived the gate and neither is killable, because ANY minute of the 23:00 hour selects
    # the same band. Probed over the space rather than argued — 429 dates spanning ~8 years crossed with
    # minutes {00, 01, 30, 59}: zero disagreements, and 23:00 fell inside the band it selects on every
    # one. So the site is removed instead of being excused in the equivalence ledger. 23:00 is the hour
    # because it lies inside `[D 18:00, D+1 10:00)` and would for any lower edge at or before 23:00.
    probe = _dt.datetime.combine(d, _dt.time(23)).timestamp()
    return _nqc.night_band(probe)


def _scope_file_count(night_dir: str, band) -> int:
    """How many of this folder's CAPTURE files the band admits.

    Counts what every model's prefix matches, so it does not depend on which devices a night expected —
    `searched_dirs` says where the judgement looked and this says what was there to look at. Sidecars
    count: they are files the scope admits, and a folder holding only sidecars is a real and different
    state from an empty one."""
    seen = set()
    for spec in MODELS.values():
        for f in glob.glob(os.path.join(night_dir, f"{spec['prefix']}*")):
            if in_band(f, band):
                seen.add(os.path.basename(f))
    return len(seen)


def recording_scope(night_dir: str, *, max_dirs: int = SCOPE_MAX_DIRS) -> dict:
    """The recording judged in this folder: which dirs it spans, what it covers, what it excludes.

    `searched_dirs` and `judged_dir` are the vocabulary QC-SCOPE-RESOLUTION-2026-07-28 established for
    exactly this — a verdict carrying its own ground — and `data_files` counts what it actually read.
    `daytime` names the wear that fell outside the band with its span, so an exclusion is stated rather
    than silent (§∅).

    Returns `ok: False` with a reason when the folder is not a date (no band to speak of) or when the
    scope would need more than `SCOPE_MAX_DIRS` folders. The latter cannot happen for a band-clipped
    recording and is asserted as a tripwire; if it ever fires, the night is UNKNOWN and says so rather
    than being judged over a truncated scope."""
    judged = os.path.basename(night_dir.rstrip("/"))
    band = band_of(night_dir)
    if band is None:
        return {
            "ok": False,
            "reason": f"`{judged}` is not a YYYY-MM-DD night folder, so it names no night band",
            "judged_dir": judged,
            "searched_dirs": [judged],
            "data_files": 0,
            "band": None,
            "span": None,
            "daytime": [],
        }
    dirs = [night_dir.rstrip("/")]
    nxt = _next_day_dir(night_dir)
    if nxt and os.path.isdir(nxt):
        dirs.append(nxt)
    # `max_dirs` IS A PARAMETER so the tripwire can be FIRED in a test. It was `# pragma: no cover` with
    # the bound hard-coded, which made the branch unreachable — and an unreachable branch is one the
    # mutation gate can neither kill nor excuse, so "kept and asserted" would have meant kept and
    # unasserted. Lowering the bound to 1 against a two-folder scope exercises the real refusal path.
    if len(dirs) > max_dirs:
        return {
            "ok": False,
            "reason": (
                f"the recording would span {len(dirs)} folders and the bound is {max_dirs} — "
                "refusing rather than judging a truncated scope"
            ),
            "judged_dir": judged,
            "searched_dirs": [os.path.basename(d) for d in dirs],
            "data_files": 0,
            "band": band,
            "span": None,
            "daytime": [],
        }
    # 🔴 `data_files` IS COUNTED, NOT DECLARED. It shipped as a literal 0 in the first draft of this
    # function and three mutants of that literal survived the gate — nothing read it, because there was
    # nothing to read: a field fixed at zero is a count nobody took, which is the §∅ bug this file exists
    # to refuse. It now counts the capture files the scope actually admits, per folder and in total, so
    # `searched_dirs` says where the judgement looked and this says what it found there.
    per_dir = {os.path.basename(d): _scope_file_count(d, band) for d in dirs}
    return {
        "ok": True,
        "reason": None,
        "judged_dir": judged,
        "searched_dirs": [os.path.basename(d) for d in dirs],
        "dirs": dirs,
        "data_files": sum(per_dir.values()),
        "data_files_per_dir": per_dir,
        "band": band,
        "span": None,
        "daytime": [],
    }


def _scope_dirs(night_dir: str) -> list[str]:
    """The folders a judgement of `night_dir` may read, first one first.

    The single choke point the pooling goes through, so the band functions keep their signatures: they
    are still handed one night and still ask for one stream, and the enumeration underneath them spans
    the recording instead of the folder."""
    sc = recording_scope(night_dir)
    return sc.get("dirs") or [night_dir.rstrip("/")]


def in_band(path: str, band) -> bool:
    """Does this file's session START inside `band`? MEMBERSHIP, which decides the folder set.

    A file is attributed by the stamp in its NAME, which is the session's start — never by its mtime,
    which is its last write and may fall in the next band entirely.

    ⚠️ THE STAMP COMES FROM `writers.file_stamp` AND NOT FROM A REGEX HERE. Its own docstring records why
    (audit F5, 2026-08-01): an unanchored 14-digit search takes the FIRST 14-digit run in the name, which on
    `Polar_H10_20250101000000_20260725225058_ECG.txt` is the device SERIAL — and it strptime's cleanly, so
    the file is silently keyed to a session eighteen months away. Two callers already had that bug."""
    if band is None:
        return True
    stamp = _wr.file_stamp(os.path.basename(path))
    if stamp is None:
        return True  # stampless: not this function's call to exclude — it has no start to judge
    # NO try/except HERE. `file_stamp` returns None unless the field is a 14-digit stamp with a
    # plausible year, so `strptime` cannot raise on what it hands back — and a `return True` that no
    # input can reach is a branch the mutation gate can neither kill nor excuse. The guarantee belongs
    # to `file_stamp`; duplicating it as dead code only hides which function owns it.
    t = _dt.datetime.strptime(stamp, "%Y%m%d%H%M%S").timestamp()
    return band[0] <= t < band[1]


def stream_files(night_dir: str, model: str, stream: str) -> list[str]:
    """This model's files for one stream in the night, sorted. `_ECG.txt` never matches `_ECGSEAMS.txt`."""
    spec = MODELS[model]
    ext = spec["ext"] if stream == spec["primary"] else ".txt"
    # POOLED OVER THE RECORDING, FILTERED BY BAND MEMBERSHIP. The signature is unchanged — callers still
    # hand one night and ask for one stream — and the enumeration underneath now spans the recording
    # rather than the folder. This is the QC-SCOPE-RESOLUTION-2026-07-28 move applied to the verdict:
    # resolve the folder set once, pool the files, leave every band function alone.
    band = band_of(night_dir)
    out = [
        f
        for d in _scope_dirs(night_dir)
        for f in glob.glob(os.path.join(d, f"{spec['prefix']}*_{stream}{ext}"))
        if in_band(f, band)
    ]
    return sorted(out)


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


SEAM_UNASSESSED = "the seam between folders was not assessed"


def _scan_shape(entry: dict) -> dict | None:
    """A published `files[]` entry back in the shape `loss_audit.boundary_gap` consumes, or None.

    The six fields #3297's follow-on added to the audit (`first`, `last`, `first_dev`, `last_dev`,
    `period_ns`, `cut`) are exactly `boundary_gap`'s inputs, so the judge is reused rather than
    reimplemented — including its device-counter test that separates a DELAY from a LOSS (#3157).

    🔴 RETURNS None FOR AN OLDER-SHAPE ENTRY, and that is the whole point of the check: the box runs
    behind `main` until the owner deploys, so an audit written by the older daemon carries only
    `{file, span_min, gaps, delays}`. An absent endpoint must become "not assessed", never a seam judged
    against a time nobody recorded (§∅)."""
    if not isinstance(entry, dict):
        return None
    if "first" not in entry or "last" not in entry:
        return None  # an older audit: it cannot say, and a default here would invent an answer
    try:
        first = _dt.datetime.fromisoformat(entry["first"]) if entry.get("first") else None
        last = _dt.datetime.fromisoformat(entry["last"]) if entry.get("last") else None
    except (TypeError, ValueError):
        return None
    return {
        "first": first,
        "last": last,
        "first_dev": entry.get("first_dev"),
        "last_dev": entry.get("last_dev"),
        "period_ns": entry.get("period_ns"),
        "cut": entry.get("cut") or 0.0,
    }


def seam_gap(prev_audit_dev: dict | None, next_audit_dev: dict | None) -> tuple:
    """The gap ACROSS the folder boundary: `(rows, reason)` — `([], reason)` when it cannot be judged.

    🔴 "SUM THE FILES' GAPS" MISSES EXACTLY THIS. `loss_audit.stream_scan` says so in its own docstring:
    a gap BETWEEN two files is a real delivery event no per-file scan can see, and for a recording that
    spans two folders the gap between the evening's last file and the morning's first is seen by NEITHER
    audit — each one judges boundaries only among its own files. Merging the two gap lists therefore
    gives the union of two halves' internal holes and stays blind to the seam joining them, which is the
    single most likely place for loss in exactly the recordings this exists to judge.

    Returns rows in the audit's own gap shape so `continuity` can read them beside the merged ones, each
    marked `seam: True` and carrying the two files it joins."""
    if not isinstance(prev_audit_dev, dict) or not isinstance(next_audit_dev, dict):
        return [], f"{SEAM_UNASSESSED}: one side has no audit entry for this device"
    prev_files = [f for f in (prev_audit_dev.get("files") or []) if isinstance(f, dict)]
    next_files = [f for f in (next_audit_dev.get("files") or []) if isinstance(f, dict)]
    if not prev_files or not next_files:
        return [], f"{SEAM_UNASSESSED}: one side audited no file for this device"
    # the evening's LAST file by its own last row, and the morning's FIRST by its own first row — never
    # by name, which carries only the session start and would put the boundary the wrong way round for a
    # fragment whose name lies (the ordering `loss_audit` itself uses)
    pv = [sc for sc in (_scan_shape(f) for f in prev_files) if sc and sc["last"] is not None]
    nx = [sc for sc in (_scan_shape(f) for f in next_files) if sc and sc["first"] is not None]
    if not pv or not nx:
        return [], f"{SEAM_UNASSESSED}: the audit publishes no per-file endpoints (written before #3297)"
    a = max(pv, key=lambda sc: sc["last"])
    b = min(nx, key=lambda sc: sc["first"])
    judged = _la.boundary_gap(a, b)
    if judged is None:
        return [], None  # judged, and there is no seam gap to report: silence here is a measurement
    if judged[0] == "delay":
        return [], None  # a delay is not a loss (#3157): the counter advanced by less than a period
    return [{"at": judged[1].isoformat(), "s": judged[2], "seam": True}], None


def continuity(audit: dict, audit_dev: dict, start, end, spans: dict[str, tuple]) -> dict:
    """§3.4 continuity rows 1–3 over the gaps that START inside the worn interval."""
    if str(audit.get("journal") or "").startswith("unavailable"):
        return _decision("UNKNOWN", "the loss audit could not read the journal — no gap can be attributed")
    gaps = audit_dev.get("gaps")
    if not isinstance(gaps, list):
        return _decision("UNKNOWN", "no per-gap times in the loss audit")
    # 🔴 JUDGE OVER THE AUDITED SET, NOT OVER ONE FRAGMENT OF IT. This read `audit_dev["file"]` and
    # required THAT file to span the whole worn interval — but the loss audit documents that key as "the
    # LARGEST fragment, kept under its old name so a reader of an older ledger is not misled", and
    # publishes the population it actually examined as `files`. So a worn interval delivered in two files
    # could never be judged: neither covers it alone and the band returned UNKNOWN.
    #
    # Measured on 2026-10-05: the P1 ring stop at 20:23 split the ring's set into `…201856` (20:18–20:23)
    # and `…203501` (20:35–04:24). One recording by the session rule (the 12-min break is far under
    # `_SESSION_GAP_SEC`), two files, and the night went UNJUDGEABLE on the ring while `loss_audit`
    # had already read both. A dropout inside a recording is a discontinuity to ANNOTATE, not a reason to
    # refuse the night — and the annotation already exists: the audit's `gaps` list carries "the gaps
    # BETWEEN fragments (`boundary: true`)", so the 20:23→20:35 break flows through the rules below as a
    # gap row inside the interval, exactly like a gap found within a single file.
    #
    # ∅ TWO THINGS STILL REFUSE, because coverage is a claim about what was EXAMINED:
    #   · an audited fragment that could not be read — the audit records it as `{file, reason}` with no
    #     `span_min`, so its position is unknown and it may well have covered part of the interval;
    #   · an interval that reaches beyond the outermost span, which is genuinely uncovered data.
    # A hole BETWEEN fragments is neither: it is covered by the gap rows.
    entries = audit_dev.get("files")
    if not isinstance(entries, list) or not entries:
        # an older ledger with no population published — fall back to the single fragment it does name
        entries = [{"file": audit_dev.get("file")}]
    # ⚠️ KEYED ON `reason`, THE MARKER THE AUDIT ACTUALLY WRITES — not on a missing `span_min`. My first
    # version used the latter and 17 existing tests failed, correctly: a minimal fixture record is
    # `{"file": name}` with no `span_min`, which is not the same thing as a fragment that could not be
    # read. The audit writes `{"file": …, "reason": "unreadable: …"}` for that, and only for that.
    unreadable = [str(e.get("file")) for e in entries if isinstance(e, dict) and e.get("reason")]
    if unreadable:
        return _decision(
            "UNKNOWN",
            f"the loss audit could not read {len(unreadable)} audited fragment(s) "
            f"({', '.join(unreadable[:3])}) — their position in the worn interval is unknown",
        )
    names = [str(e.get("file")) for e in entries if isinstance(e, dict)]
    found = [
        v
        for nm in names
        for p, v in spans.items()
        # NO INDEX, so there is no index to swap. `first_last` assigns `first` on the SAME iteration as
        # `last` and clears neither, so both members are set or neither is — `(None, set)` and
        # `(set, None)` are unreachable for every value `spans` can hold, since it is built only from
        # `first_last`.
        #
        # ⚠️ THAT EQUIVALENCE SURVIVED TWO REWRITES BEFORE IT STOPPED MOVING. It was first
        # `v[0] is not None and v[1] is not None`, where the gate named dropping a conjunct; dropping the
        # redundant half left `v[0] is not None`, where the gate named SWAPPING the index to `v[1]` — the
        # same unkillable claim, relocated. `None not in v` removes the subscript entirely, so neither
        # mutant can be written, and the one mutation that IS available (`not in` → `in`) is killable: it
        # admits only the unstamped fragments and `min` then compares against None.
        if os.path.basename(p) == nm and None not in v
    ]
    # ⚠️ "does not cover the worn interval" IS THE PINNED PHRASE on every refusal below, and the
    # single-fragment sentence is reproduced verbatim. Three existing tests assert that wording — a reason
    # string is part of this module's contract ("the FAIL always names the BASIS it was judged against"),
    # so widening the rule must not silently reword the refusals it still reaches. Only the genuinely new
    # multi-fragment case gets new prose.
    # ONE conditional, not four. My first version branched the message three separate ways to keep the
    # single-fragment sentence verbatim, and CI's diff-scoped gate named four survivors on those branches
    # (`(names) or True`, `(len(names) == 1) or True`, `len(found) != 1`, `len(found) == 2`). Naming the
    # SUBJECT once and sharing one sentence removes the branches rather than testing them: the pinned
    # wording still comes out exactly for one fragment, and a set names its members.
    _subj = f"`{names[0]}`" if len(names) == 1 else f"{len(names)} fragments ({', '.join(names[:3])})"
    _nocover = f"the loss audit examined {_subj}, which does not cover the worn interval"
    if not found:
        return _decision("UNKNOWN", _nocover)
    covered_from, covered_to = min(v[0] for v in found), max(v[1] for v in found)
    if covered_from > start or covered_to < end:
        return _decision(
            "UNKNOWN", f"{_nocover} {start:%H:%M}-{end:%H:%M} (spanning {covered_from:%H:%M}-{covered_to:%H:%M})"
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
    # THE ANNOTATION SITS AT THE PASS, AND THAT PLACEMENT IS THE WHOLE SAFETY ARGUMENT. Every rule above
    # still decides first, so a declared pause can only ever turn a BARE pass into a REASONED one — it
    # can never soften a FAIL or an UNKNOWN that another rule reached, and no precedence moves. A band
    # that passes silently over a known discontinuity makes a healthy night unauditable later, which is
    # the half of §∅ that annotates rather than refuses.
    paused = [s for c, s in inside if c == DECLARED_PAUSE]
    if paused:
        return _decision(
            "PASS",
            f"explained discontinuity: {len(paused)} declared pause(s), {sum(paused):.0f} s "
            f"({DECLARED_PAUSE}) inside the worn interval — counted toward the LOSS bar, not a band failure",
        )
    return _decision("PASS")


def negotiated_rate(night_dir: str, device: str, model: str, primary: str) -> tuple[float | None, str]:
    """The primary stream's rate and where it came from, or (None, why). Never a nominal fallback."""
    spec = MODELS[model]
    if spec["pmd"] is None:
        meta = read_json(primary + ".meta.json")
        signal = str(((meta or {}).get("acquisition_evidence") or {}).get("signal") or "")
        m = _DECLARED_HZ.search(signal)
        if m:
            return float(m.group(1)), DECLARED_RATE_WHY
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


def stated_expected_count(primary: str) -> int | None:
    """The sample count the stream's OWN writer says to expect, or None when it declines to state one.

    `acquisition_evidence.expected_sample_count` is the writer's answer to "how many samples should be
    here". It is a POSITIVE INTEGER or the literal `"UNKNOWN"`, and `"UNKNOWN"` means the writer could
    not say — which is an absence and never a zero (§∅). Measured across the box's whole corpus
    2026-09-29: every one of the 370 live `_SPO2.csv` metas says `"UNKNOWN"`, while all 63 downloaded
    `STORED.dat` metas carry a real count. So the two exist side by side today and the distinction is the
    writer's own, not a guess about the device."""
    a = (read_json(primary + ".meta.json") or {}).get("acquisition_evidence") or {}
    n = a.get("expected_sample_count")
    return n if isinstance(n, int) and not isinstance(n, bool) and n > 0 else None


def completeness(night_dir: str, device: str, model: str, primaries: list[str], start, end) -> dict:
    """§3.4 completeness on the primary stream (A2: an event stream is never scored here).

    🔴 THE DENOMINATOR MUST BE STATED, NOT MANUFACTURED. `rate x span` is a completeness measure only
    for a stream whose rate is a CLOCK. For a POLLED stream it is not: the host asks, the device answers,
    and the period is the sleep PLUS the work, so the count drifts below the nominal on a night when
    nothing was lost at all. Measured on the 2026-09-28 ring night: 23 826 rows against 24 179 s of worn
    interval read 98.54 % and FAILED the 0.99 band, while the frame interval was mean 1.0149 s (median
    1.019, p99 1.300) and not one frame was missing a value. The `@1Hz` the band divided by is the
    nominal in the stream's signal NAME — `spo2_hr_motion@1Hz` — and the same file's acquisition evidence
    says `expected_sample_count: "UNKNOWN"` in as many words. Reading a nominal where the writer wrote
    UNKNOWN is the absence-as-value shape, one layer up from the sample.

    So the denominator is taken in this order, and never invented:
      1. the count the writer STATED (`expected_sample_count`) — the honest number when it exists;
      2. `rate x span` when the rate came from a NEGOTIATED record (the device and host agreed it) —
         unchanged for every PMD stream, which is where this band has always done its work;
      3. otherwise the band does not bind: NOT_APPLICABLE, naming the polled stream and the nominal it
         refuses to divide by. It neither passes nor fails the device, and coverage for that stream is
         answered by CONTINUITY, which measures the gaps directly and is unaffected.

    ⚠️ The device's own `duration_s` counter does NOT rescue case 3, and was checked before this shape was
    chosen: on 2026-09-28 it read 24 177 s against the host's 24 179 s, so 23 826 / 24 177 = 98.55 % —
    the same FAIL. The drift is in the POLL PERIOD, not in the span, so no better span can fix it."""
    stated = [stated_expected_count(p) for p in primaries]
    rows = sum(rows_between(p, start, end) for p in primaries)
    if all(n is not None for n in stated) and primaries:
        expected = float(sum(n for n in stated if n is not None))
        return _complete_ratio(rows, expected, "expected_sample_count stated beside the stream")
    rates = [negotiated_rate(night_dir, device, model, p) for p in primaries]
    missing = [why for r, why in rates if r is None]
    if missing:
        return _decision("UNKNOWN", missing[0])
    hz = sorted({r for r, _ in rates if r is not None})
    if len(hz) != 1:
        return _decision("UNKNOWN", f"the primary files disagree on their rate: {hz}")
    rate = hz[0]
    if any(why == DECLARED_RATE_WHY for _r, why in rates):
        return _decision(
            "NOT_APPLICABLE",
            f"polled stream, rate declared not negotiated: {rate:g} Hz is the nominal in the signal name and "
            f"the stream's own evidence states no expected_sample_count, so rows x span is not a completeness "
            f"measure — coverage for this stream is the continuity band",
        )
    expected = rate * (end - start).total_seconds()
    if expected <= 0:
        return _decision("UNKNOWN", "the worn interval has no length")
    return _complete_ratio(rows, expected, f"at {rate:g} Hz")


def _complete_ratio(rows: int, expected: float, basis: str) -> dict:
    """PASS inside the band, FAIL outside it, and the FAIL always names the BASIS it was judged against —
    a percentage with no denominator behind it cannot be argued with.

    `expected` is positive on both paths into here and no guard repeats that: the stated count is
    accepted only when it is a positive integer, and the rate path checks `expected <= 0` before it calls
    this. Coverage found the duplicate, and a guard no input can reach is one more thing a reader has to
    rule out rather than protection."""
    ratio = rows / expected
    if COMPLETE_LO <= ratio <= COMPLETE_HI:
        return _decision("PASS")
    return _decision("FAIL", f"{rows} rows against {expected:.0f} expected {basis} = {100 * ratio:.2f} %")


def has_rows(path: str) -> bool:
    """Does this waveform file hold a single DATA row? Stops at the first one.

    O(1) on a real stream: a night's ECG is ~160 MB and this reads one line of it. The comment and
    header lines a writer emits before the first sample are not data — an `# timebase=` line and a
    `Phone timestamp;…` header are the file saying what it WOULD contain."""
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if line.startswith("#") or line.startswith("Phone") or not line.strip():
                    continue
                return True
    except OSError:
        return False  # a file we cannot open holds no row we can see; the caller says what that means
    return False


def _sidecar_unflushed(waveform: str) -> bool:
    """Is this waveform's RUNS sidecar PRESENT but EMPTY — the writer still holding its buffer?

    Present and 0 bytes, which is a different fact from ABSENT: `open(path, "w")` creates the file at
    construction, so the sidecar exists from the session's first moment while its header sits in a
    64 KB buffer. An ABSENT sidecar is the pre-#2950 writers and keeps its own UNKNOWN."""
    runs = waveform[: -len(".txt")] + "RUNS.txt"
    try:
        return os.path.getsize(runs) == 0
    except OSError:
        return False  # absent, or unstattable: not this function's case


def validity(night_dir: str, model: str) -> dict:
    """§3.4 validity (A4): every waveform file carries its RUNS sidecar with its OWN `min_run=`.

    🔴 A ZERO-ROW WAVEFORM IS AN ABSENT SESSION, NOT AN UNDECIDED ONE, and the distinction cost a night.
    The `min_run=` header is written at the FIRST run, so a session that recorded nothing leaves a
    0-line sidecar — and this band, iterating every waveform file in the folder, returned UNKNOWN on it
    and dragged the whole device down. Measured live on the box 2026-10-04: the Verity connected at
    15:06 on its charger, battery 100 %, never worn, and opened a session whose `_PPG.txt` has 0 rows;
    `/api/state.solid` read UNKNOWN for the night on `…_PPGRUNS.txt publishes no min_run`. If the night's
    real session lands in the same folder, an empty file costs the first PASS-capable night.

    ⚠️ FOLDER-SHAPE AGNOSTIC, AND DELIBERATELY SO (owner ruling 2026-10-05, "the recording defines the
    night"). Nothing here parses `night_dir`'s name: it is an opaque directory, the waveforms are found
    by the model's own prefix, and a sidecar's path is derived from its waveform's. Both exclusions —
    recorded-nothing and still-being-written — therefore hold whatever a night folder comes to mean when
    the UTC-offset work re-cuts it.
    A session that recorded nothing has no validity to assess, so it is EXCLUDED and the exclusion is
    NAMED and COUNTED (§🧾 `checked + excluded = eligible`) rather than silently skipped.

    ⚠️ AND A NON-EMPTY FILE WHOSE SIDECAR CANNOT ANSWER STILL READS UNKNOWN — that is a real blind floor
    and not an absence. The mirror's 2787 waveform files partition as: 30 zero-row (0 bytes, no header
    at all) · 115 with rows and a proper `min_run=` header · **2642 with rows and NO SIDECAR FILE AT
    ALL**, from writers predating #2950, which this band already reports under its own reason · and
    ZERO with a sidecar present but lacking `min_run`. So the discriminator has to be the ROWS: keying
    the exclusion off the sidecar instead would sweep in the 2642 absent-sidecar nights, which are the
    historical majority and exactly what this band exists to refuse."""
    files = [f for w in MODELS[model]["waveforms"] for f in stream_files(night_dir, model, w)]
    if not files:
        return _decision("UNKNOWN", "no waveform file this night, so no sidecar could be checked")
    empty = [os.path.basename(f) for f in files if not has_rows(f)]
    # 🔴 A 0-BYTE SIDECAR BESIDE A WAVEFORM WITH ROWS IS A SESSION STILL BEING WRITTEN, NOT A BLIND
    # FLOOR. `_RunSidecar` writes its `min_run=` header into a 64 KB buffer at construction, and
    # `StreamWriter.flush()` flushes the waveform and its `_RR` sibling and NOT `_runs` — so the header
    # reaches disk only once 64 KB of run rows accumulate or the file is closed. A live session's
    # sidecar can therefore be 0 bytes for its whole duration, and `close()` is what makes it appear.
    # Measured live on the box 2026-10-04: a Verity session open since 19:08 was judged at 19:37 and the
    # night read UNKNOWN on `…_PPGRUNS.txt publishes no min_run`; that same sidecar later carried
    # `min_run=200` on line 1 and nine lines. The file had never failed to state its rule — nobody had
    # flushed it yet.
    # Excluded with its OWN reason rather than folded into `empty-session`: that one says the session
    # recorded nothing, this one says it is still recording. ⚠️ A 0-byte sidecar cannot survive a clean
    # close, so finding one means LIVE or TORN, never finished — which is why this case has no corpus
    # population to bound. The mirror holds none (its nights are archived after close), and that silence
    # is consistent with the write path rather than evidence against it.
    writing = [os.path.basename(f) for f in files if os.path.basename(f) not in empty and _sidecar_unflushed(f)]
    checked = [f for f in files if os.path.basename(f) not in empty and os.path.basename(f) not in writing]
    if not checked:
        return _decision(
            "UNKNOWN",
            f"no waveform file this night is judgeable yet: {len(empty)} empty session(s), "
            f"{len(writing)} still being written",
        )
    for f in checked:
        runs = f[: -len(".txt")] + "RUNS.txt"
        try:
            with open(runs, encoding="utf-8", errors="replace") as fh:
                header = fh.readline()
        except OSError:
            return _decision("UNKNOWN", f"`{os.path.basename(runs)}` absent — absences not examined (#2950)")
        if not _MIN_RUN.search(header):
            return _decision("UNKNOWN", f"`{os.path.basename(runs)}` publishes no min_run — its blind floor is unknown")
    aside = []
    if empty:
        aside.append(
            f"{len(empty)} excluded as empty-session ({', '.join(sorted(empty))}) — a session that "
            "recorded nothing has no validity to assess"
        )
    if writing:
        aside.append(
            f"{len(writing)} not yet judgeable, still being written ({', '.join(sorted(writing))}) — "
            "the RUNS header is in the writer's buffer, not absent"
        )
    if aside:
        return _decision("PASS", f"{len(checked)} waveform file(s) checked, " + "; ".join(aside))
    return _decision("PASS")


def clocks(night_dir: str, model: str) -> dict:
    """§3.4 clocks: the device clock was compared with the host on this night."""
    prefix = MODELS[model]["prefix"]
    _band = band_of(night_dir)
    _seams = sorted(
        f
        for d in _scope_dirs(night_dir)
        for f in glob.glob(os.path.join(d, f"{prefix}*SEAMS.txt"))
        if in_band(f, _band)
    )
    for seams in _seams:
        rows = claimed = 0
        examined = 0
        with open(seams, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                m = _FINAL.match(line)
                if m:
                    claimed += int(m.group(1))
                    examined += int(m.group(2))
                elif line.startswith("#") or line.startswith("phone_ts"):
                    continue
                elif line.strip():
                    rows += 1
        # A TRIPWIRE, not a measurement. The final lines COUNT the rows above them — one writer instance
        # writes both, and since the count now follows the row it cannot run ahead of them. If a reader
        # ever finds them disagreeing, one of the two is describing a file it did not write, and neither
        # can be trusted to answer "was the clock compared": refuse by name rather than pick a side.
        # Measured 2026-09-27 over 132 sidecars (66 rig + 66 box): none disagree, so this fires on
        # nothing today and exists to notice the day it does.
        if claimed != rows:
            return _decision(
                "UNKNOWN",
                f"`{os.path.basename(seams)}` claims {claimed} seam(s) over "
                f"{rows} row(s) — its rows and its own totals disagree",
            )
        if examined > 0:
            return _decision("PASS")
    _rband = band_of(night_dir)
    _rtcs = sorted(
        f
        for d in _scope_dirs(night_dir)
        for f in glob.glob(os.path.join(d, f"{prefix}*_RTCLOG.csv"))
        if in_band(f, _rband)
    )
    for rtc in _rtcs:
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
            # `_ni.parse_host_stamp`, NOT `datetime.fromisoformat`: a ZONED stamp is legal (Clock
            # Contract §2 rule 2) and `fromisoformat` returns an AWARE value for it, which the comparison
            # below then cannot make against a naive `start` — `TypeError: can't compare offset-naive and
            # offset-aware datetimes`, and it escapes the `except ValueError` here rather than skipping
            # the row. The poller catches it and the night gets NO verdict, which §3.1 reads as
            # unassessed: one zoned row silently costs the whole night's assessment. The shared parser
            # takes the components as written, so a zoned row lands on the same floating time as its
            # zoneless twin.
            host = _ni.parse_host_stamp(cells[0])
            if host is None:
                continue  # an unplaceable seam row is not a step of zero — see below (§∅)
            try:
                step_ms = float(cells[2])
            except ValueError:
                continue  # an unparseable seam row is not a step of zero — it is one this reader cannot
                # place, so it splits nothing rather than splitting at the wrong sample (§∅)
            if start is not None and (host < start or host > end):
                continue  # a seam outside the worn interval does not split an axis nobody was wearing
            seams.append({"host_ms": host.timestamp() * 1000.0, "step_ms": step_ms})
    seams.sort(key=lambda r: r["host_ms"])
    return seams


def _seam_cause(night_dir: str) -> str | None:
    """What the night's own record says caused the step, or None. Never inferred from the magnitude.

    Called only inside `if seams:`, so a `not seams` guard here was unreachable — coverage found it and it
    is removed rather than given a test that could never fail, the same call this file's `drawn_share`
    note records. THE SEAM LIST IS NOT A PARAMETER, for the same reason: the cause is read from the
    night's clock record and from nothing else, so a `seams` argument would be dead weight the reader
    has to rule out — and it was: the mutation gate found `_seam_cause(night_dir, None)` surviving,
    which is the dead parameter reporting itself."""
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
        # SOLID-NIGHT §A5's two guards, collected in THIS pass rather than a second one. Guard 1 needs the
        # DELIVERY RATE in the persistence windows — "a clock step keeps delivery at the nominal rate while
        # the level moves; a latency backlog collapses the row rate" — and Guard 2 needs the gaps. Neither
        # is derivable from the anchors: an anchor is one per BATCH, so the anchor cadence says nothing
        # about how many rows arrived. `row_bins` counts DELIVERED rows (host stamp + device stamp both
        # parsed), which is exactly the population Guard 1 compares against the negotiated rate.
        row_bins: dict[int, int] = {}
        gaps: list[tuple[float, float]] = []
        prev_host_ms: float | None = None
        for line in fh:
            parts = line.split(";")
            if len(parts) <= ns_at:
                continue  # a short row measures nothing; it is skipped, never defaulted (§∅)
            # Same shared parser and the same reason as `recorded_seams` above: a zoned `Phone
            # timestamp` must not become an aware datetime, or the worn-interval comparison below raises
            # TypeError and the night loses its verdict entirely.
            host = _ni.parse_host_stamp(parts[0])
            if host is None:
                continue  # an unplaceable row is not a zero
            try:
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
            host_ms = host.timestamp() * 1000.0
            b = int(host_ms // A5_BIN_MS)
            row_bins[b] = row_bins.get(b, 0) + 1
            if prev_host_ms is not None and host_ms - prev_host_ms > A5_GAP_FLOOR_MS:
                gaps.append((prev_host_ms, host_ms))
            prev_host_ms = host_ms
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
    return {
        "anchors": anchors,
        "drawn_share": (top / total) if total else None,
        "reason": None,
        "row_bins": row_bins,
        "gaps": gaps,
        "last_row_ms": prev_host_ms,
    }


def clock_records(night_dir: str, device: str, primary: str, start, end) -> tuple[list[float] | None, str]:
    """Every clock event the box RECORDED for this device in the worn interval, as host ms — or
    `(None, why)` when a record source could not be read.

    🔴 ALL THREE SOURCES, OR NONE. SOLID-NIGHT §A5 requires the seam sidecar, the journal's clock-event
    lines and `CLOCKSYNC.csv` together, and the brief records what happens otherwise: matching the journal
    alone missed half the recorded clock-sets, and matching `off host` alone missed the `device clock
    JUMPED` line that recorded 2026-08-18 — so the first cut of the detector flagged a night the daemon
    had logged. A missing source therefore returns None and stops the tripwire, rather than shrinking the
    record set and letting it fire (§∅: absence is not "no record").

    The journal is not readable from here and must not be: the verdict side has never shelled out, and
    journald rotates, so the answer has to be persisted WITH the night. `loss_audit.audit_night` writes
    `clock_events` into `LOSS-AUDIT.json` from the pass it already makes; `None` there means journalctl
    was unavailable and is kept distinct from `[]`, which means read and nothing happened.

    ⚠️ CLOCKSYNC IS READ FROM THE NEIGHBOURING DATE TOO. `writers.clocksync_row` keys a row by the EVENT's
    wall date, so a cross-midnight session leaves its late rows in the NEXT date's folder — and a night
    that ends at 04:00 would otherwise have every post-midnight sync invisible here. Missing the record is
    the one failure mode this function exists to prevent, so the neighbour is read and its absence is not
    an error (most nights have none).

    `deferred-absent` is the one event word excluded, and deliberately: it means the device was not
    reachable and NOTHING was written to its clock — 153 of 09-28's rows. Every other word in the
    vocabulary, including the failures, is a record that the daemon was writing to that clock at that
    moment, which is the brief's own rule ("a FAILED re-sync is still a record that a clock event
    happened")."""
    out: list[float] = [r["host_ms"] for r in recorded_seams(primary, start, end)]
    audit = read_json(os.path.join(night_dir, LOSS_AUDIT_NAME))
    if audit is None:
        return None, f"`{LOSS_AUDIT_NAME}` absent or unreadable, so the journal's clock events cannot be read"
    if "clock_events" not in audit:
        return None, f"`{LOSS_AUDIT_NAME}` predates the clock-event record and carries none"
    ev = audit.get("clock_events")
    if ev is None:
        return None, "journalctl was unavailable when the night was audited, so the record set is incomplete"
    for e in ev:
        t = _ni.parse_host_stamp(str(e.get("at") or ""))
        if t is None or (start is not None and (t < start or t > end)):
            continue
        devs = e.get("devices") or []
        if devs and device not in devs:
            continue  # a line that names OTHER devices is not this device's record; one that names none is
        out.append(t.timestamp() * 1000.0)
    seen = _clocksync_rows(night_dir, device, start, end)
    if seen is None:
        return None, f"`{writers_CLOCKSYNC}` is present but unreadable, so the record set is incomplete"
    out.extend(seen)
    out.sort()
    return out, "seam sidecar + journal clock events + CLOCKSYNC.csv"


_A5_NON_RECORD_EVENTS = ("deferred-absent",)
writers_CLOCKSYNC = "CLOCKSYNC.csv"


def _clocksync_rows(night_dir: str, device: str, start, end) -> list[float] | None:
    """This device's CLOCKSYNC rows in the interval, as host ms, over the night's folder AND the next
    date's. `None` only when a file exists and cannot be read — an ABSENT file is no rows, not an error,
    because most nights never write one."""
    out: list[float] = []
    base = os.path.dirname(night_dir.rstrip("/"))
    night = os.path.basename(night_dir.rstrip("/"))
    dirs = [night_dir]
    try:
        nxt = (_dt.date.fromisoformat(night) + _dt.timedelta(days=1)).isoformat()
        dirs.append(os.path.join(base, nxt))
    except ValueError:
        pass  # a folder that is not a date has no neighbour to read; the night's own file still counts
    for d in dirs:
        path = os.path.join(d, writers_CLOCKSYNC)
        if not os.path.exists(path):
            continue
        try:
            with open(path, encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    cells = line.rstrip("\n").split(";")
                    if len(cells) < 4 or cells[1] != device:
                        continue
                    if cells[3] in _A5_NON_RECORD_EVENTS:
                        continue
                    t = _ni.parse_host_stamp(cells[0])
                    if t is None or (start is not None and (t < start or t > end)):
                        continue
                    out.append(t.timestamp() * 1000.0)
        except OSError:
            return None
    return out


def seam_rate(primary: str) -> float | None:
    """The stream's NOMINAL rate as its own seam sidecar records it, or None.

    SOLID-NIGHT §A5's Guard 1 names this source exactly — "the seam sidecar's negotiated rate" — and not
    `negotiated_rate`'s wider ladder: `PMDNEG.csv` records what was AGREED for the session, while the
    guard compares the rate rows actually arrived at against the rate THIS FILE was negotiated to. Where
    they differ, the sidecar beside the stream is the one that describes the stream."""
    try:
        with open(primary[: -len(".txt")] + "SEAMS.txt", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                m = _PMD_RATE.match(line)
                if m and float(m.group(1)) > 0:
                    return float(m.group(1))
    except OSError:
        return None
    return None


def _a5_crossing(times: list[float], vals: list[float], vantage_ms: float, persistence_ms: float) -> float:
    """Where the residual actually moves between the two levels, given a vantage that saw the move.

    The first anchor after the before-window whose residual has travelled HALF the persistence. Half,
    rather than the full level, because a real transition is not instantaneous — the residual crosses the
    midpoint once, while it may approach the far level asymptotically or overshoot it.

    Starts from the before-window's end by BISECT rather than scanning from the segment's first anchor,
    for the reason `_win_median` records below."""
    lo = vantage_ms + A5_BEFORE_MS[1]
    base: float = _win_median(times, vals, vantage_ms + A5_BEFORE_MS[0], lo)  # type: ignore[assignment]
    half = base + persistence_ms / 2.0
    i = _bisect.bisect_left(times, lo)
    # UNCONDITIONAL, and both guards this used to carry were unreachable. `base` cannot be None: the only
    # caller is the grid, which reached this line precisely because that window HAD a median. And some
    # anchor must cross: the after-window's median IS the far level, so at least one anchor in it sits at
    # or past the halfway mark, and every anchor in it is at or after `lo`. Coverage found both, and a
    # guard no input can reach is not protection — it is a branch a reader has to rule out.
    # ONE SIGN TEST, NOT TWO. This read `(persistence_ms > 0 and r >= half) or (persistence_ms < 0 and
    # r <= half)`, which asks the same question twice and leaves the gap between the two arms — a
    # persistence of exactly 0 — matching NEITHER, so `next` would raise StopIteration. The caller cannot
    # produce it (`abs(p) >= A5_STEP_MS` is 1000 ms), so the second test was four unkillable mutation
    # sites standing in for a case that is already impossible. A conditional expression has one.
    return next(t for t, r in zip(times[i:], vals[i:]) if (r >= half if persistence_ms > 0 else r <= half))


def _win_median(times: list[float], vals: list[float], lo_ms: float, hi_ms: float) -> float | None:
    """The median residual over `[lo_ms, hi_ms)`, or None when the window holds no anchor. Never 0.0 for
    an empty window — an unmeasured level is absent, and a persistence computed from one would be the
    difference between a real level and a fiction (§∅).

    🔴 BISECT, NEVER A SCAN, AND THE REASON IS THE MUTATION GATE. This used to filter the whole segment
    per call, so the per-vantage cost was O(len(seg)) and the total cost depended on how many vantages the
    caller chose. A mutant that defeats the caller's one-per-bin dedup — `seen.add(b)` becoming
    `seen.add(None)`, measured as `x_unrecorded_shift__mutmut_77` on run 36651159596 — then evaluates
    EVERY anchor at O(n) each, which is O(n²) on the largest plant and reads as UNDECIDED (a timeout)
    rather than as a kill or an honest survivor. Two windows of 60 s hold about 60 anchors whatever the
    night's length, so a bisect makes the per-vantage cost independent of the segment AND of the dedup:
    the same mutant now finishes and gives an answer a test or a ledger entry can address. Bounding the
    LOOP was not enough; the cost inside it was the other half of the same class.

    `times` must be sorted, and `unrecorded_shift` sorts once when it builds the pair. Half-open by
    construction: `bisect_left` at both ends is exactly `lo <= t < hi`."""
    i = _bisect.bisect_left(times, lo_ms)
    j = _bisect.bisect_left(times, hi_ms)
    return _median(vals[i:j]) if j > i else None


def _rows_in(row_bins: dict[int, int], lo_ms: float, hi_ms: float) -> tuple[int, float]:
    """Delivered rows and the seconds they were counted over, on the residual pass's own bin grid. The
    span is the BINS' span, not the requested one, so the rate is rows over the time actually covered."""
    b0, b1 = int(lo_ms // A5_BIN_MS), int(hi_ms // A5_BIN_MS)
    # BOUNDED BY THE DATA, NOT BY THE ARITHMETIC. Summing over `range(b0, b1 + 1)` walks a span the bin
    # maths computes, so a mutant of the bin divisor makes that range millions wide and the test TIMES
    # OUT instead of failing — the mutation gate then reports UNDECIDED, which is neither a kill nor an
    # honest survivor (measured on run 36635883102: `_rows_in` mutants 8, 19 and 20). Filtering the bins
    # that exist cannot exceed the dictionary, so the same mutant now produces a WRONG COUNT a test can
    # see. CLAUDE.md §🧪 states the rule for hand-advanced indices; a computed `range` is the same trap.
    n = sum(c for b, c in row_bins.items() if b0 <= b <= b1)
    return n, max(A5_BIN_S, (b1 - b0 + 1) * A5_BIN_S)


def unrecorded_shift(scan: dict, records: list[float], nominal_hz: float | None) -> dict | None:
    """SOLID-NIGHT §A5: the strongest persistent residual shift on this axis, and what it is.

    Returns a decision when something is worth saying — the tripwire's own fire, or one of the guards'
    named UNKNOWNs — and `None` when the axis carries no candidate at all, which is the PASS path.

    THE FIRE IS UNKNOWN `unrecorded-shift-candidate`, NEVER A FAIL, and this is the whole reason A5 is a
    tripwire: over n = 36 clean nights the corpus holds ZERO true unrecorded steps, so the detector has
    never been validated against the thing it would convict. It flags for review; it does not decide.

    MEASURED ON A GRID, NOT AT PEAKS. Persistence is evaluated every `A5_BIN_S` across each segment —
    the level 60–120 s after an instant minus the level 30–90 s before it — rather than at points where
    a smoothed series jumps. A jump filter would be cheaper and would miss a WALK, the one class the
    clean corpus cannot rule out because it contains none. The windowed peak is not used at all: 1,237
    of 1,756 corpus events above 1 s were delivery-latency transients that RETURN.

    PRECEDENCE, and it is not arbitrary. Each test below can only make the verdict SOFTER than a fire,
    and the softest applicable one wins, because each says the candidate cannot be adjudicated for a
    different reason:
      1. recorded         — a clock event within `A5_RECORD_NEAR_S`. Not a finding at all: the box said
                            so. Checked FIRST, because convicting a logged step is the 08-18 mistake.
      2. too dense        — `A5_DENSE_RECORDS` records inside the persistence span; ±15–30 s flips
                            minutes apart cannot be assigned to one another.
      3. latency regime   — Guard 1: the row rate in either window departs from nominal by more than
                            `A5_RATE_TOL`. A clock step holds delivery at the nominal rate.
      4. across a gap     — Guard 2: the after-window contains, or ends within `A5_GAP_NEAR_S` of, a gap
                            or the end of the stream. The level "after" must be measured on data that
                            exists and is flowing normally.
      5. the fire.
    """
    anchors = scan.get("anchors") or []
    if len(anchors) < TB_MIN_ANCHORS:
        return None  # `timebase` already says so in its own words; saying it twice adds nothing
    # SORTED ONCE. The segment split already assumed host order, and `_win_median` now bisects on it, so
    # the assumption is made explicit here instead of being inherited from the read order of a file.
    pts = sorted((h, (h - d) - (anchors[0][0] - anchors[0][1])) for h, d in anchors)
    row_bins = scan.get("row_bins") or {}
    gaps = scan.get("gaps") or []
    last_ms = scan.get("last_row_ms")
    segs: list[list[tuple[float, float]]] = [[pts[0]]]
    for prev, cur in zip(pts, pts[1:]):
        (segs.append([cur]) if cur[0] - prev[0] > A5_REANCHOR_MS else segs[-1].append(cur))
    # ONE `best`, CARRYING ITS OWN AXIS. This was three variables — `best`, `best_p` and `best_axis` —
    # each with an initial value that nothing could read: the `best is None` return below is reached
    # before any of them is used, so `best_p = 0.0` and `best_axis = ([], [])` were unkillable mutation
    # sites rather than decisions (`__mutmut_51`, `__mutmut_52`). A single Optional tuple has no
    # unreadable initial state, so there is nothing there to be wrong about.
    best: tuple[float, float, list[float], list[float]] | None = None  # (persistence, vantage, times, vals)
    # HOW MANY VANTAGES WERE ACTUALLY EVALUATED. Published on every decision below as `vantages`, a NEW
    # FIELD carrying NEW DATA (§🧪's back-compatible shape) — `timebase` forwards only status and reason,
    # so no verdict file changes. It exists because the one-per-bin dedup was otherwise UNOBSERVABLE: with
    # `_win_median` bisected, a mutant that defeats the dedup (`seen.add(b)` → `seen.add(None)`,
    # `x_unrecorded_shift__mutmut_77`) evaluates every anchor instead of one per bin, finishes in the same
    # time and returns the SAME answer — an honest survivor rather than a timeout, but still a survivor.
    # The count is the thing it changes, so the count is what a test can hold it to.
    vantages = 0
    for seg in segs:
        # THE VANTAGES ARE THE ANCHORS, ONE PER BIN — bounded by the DATA and by nothing computed.
        # CLAUDE.md §🧪 names the hand-advanced `while` index; a *computed count* is the same trap wearing
        # different clothes, and both cost a cycle here. `while t <= end: ... t += step` let a mutant of
        # the advance line run forever (run 36635883102, mutants 112–114), and replacing it with
        # `for k in range(steps)` over `steps = int((last - start) // step) + 1` merely moved the
        # arithmetic: mutant 68 turned `A5_BIN_S * 1000.0` into `A5_BIN_S / 1000.0`, a 0.01 ms step and
        # ~10^9 vantages, so the gate reported UNDECIDED again (run 36646177195; read from the generated
        # mutant source, not inferred). Iterating the segment's own anchors cannot exceed `len(seg)`
        # whatever the bin arithmetic becomes — the worst a mutation can now do is evaluate MORE of the
        # anchors it already has, which is a wrong answer a test can see rather than a run that never ends.
        times = [t for t, _r in seg]
        vals = [r for _t, r in seg]
        lo = times[0] - A5_BEFORE_MS[0]
        hi = times[-1] - A5_AFTER_MS[1]
        seen: set[int] = set()
        for t in times:
            if t < lo or t > hi:
                continue  # a vantage whose windows fall outside the segment measures nothing
            b = int(t // A5_BIN_MS)
            if b in seen:
                continue  # one vantage per bin: the grid's spacing, taken from where data exists
            seen.add(b)
            vantages += 1
            # BOTH WINDOWS ARE POPULATED BY CONSTRUCTION, and the `is not None` guard this used to carry
            # was unreachable: a window is 60 s wide, the segments were split at anchor gaps WIDER than
            # 60 s, so a gap able to empty a window has already ended the segment. Coverage found the
            # branch, and a guard no input can reach is not protection — it is one more thing a reader
            # has to rule out. `_win_median` still returns None for the callers that can see it.
            before = _win_median(times, vals, t + A5_BEFORE_MS[0], t + A5_BEFORE_MS[1])
            after = _win_median(times, vals, t + A5_AFTER_MS[0], t + A5_AFTER_MS[1])
            p = (after or 0.0) - (before or 0.0)
            if abs(p) >= A5_STEP_MS and (best is None or abs(p) > abs(best[0])):
                best = (p, t, times, vals)
    if best is None:
        return None
    best_p, vantage, b_times, b_vals = best
    # ⚠️ THE STRONGEST VANTAGE IS NOT THE INSTANT. Persistence is measured from a point whose windows
    # straddle the shift, and every point in a wide plateau sees the SAME level difference — the earliest
    # of them, which is what the scan above keeps, sits about a window-width EARLY. Reporting that time
    # would put the guards' windows and the record match in the wrong place, which is how a detector
    # excuses the wrong event or reads the wrong stretch of delivery. So the instant is refined to where
    # the residual actually crosses between the two levels, inside the span the windows leave open.
    at = _a5_crossing(b_times, b_vals, vantage, best_p)
    # NO SEPARATE `sign`. `+.3g` already prints one, so a trailing `(+ve)` restated it — and five of the
    # tripwire's survivors were mutations of that restatement, three of them unkillable by construction
    # (`best_p > 0` cannot be reached with `best_p` in (0, 1], because |p| >= A5_STEP_MS = 1000). A
    # duplicated fact is a second place to be wrong about one thing; it is removed, not covered.
    what = f"{best_p / 1000.0:+.3g} s persistent shift at {_dt.datetime.fromtimestamp(at / 1000.0):%H:%M:%S}"
    # DENSITY IS CHECKED BEFORE ATTRIBUTION, and the order is load-bearing. Dense clock-sets are dense
    # precisely because several of them sit NEAR the candidate, so testing "is one within the match
    # window" first would absorb every storm night as "recorded" and this branch would be unreachable —
    # a rule that cannot fire is not a rule. The storm's point is that ±15–30 s flips minutes apart
    # cannot be assigned to one another, which is neither "recorded" nor "unrecorded" but unadjudicable.
    span = [r for r in records if at + A5_BEFORE_MS[0] <= r <= at + A5_AFTER_MS[1]]
    if len(span) >= A5_DENSE_RECORDS:
        return {
            **_decision("UNKNOWN", f"clock-sets too dense to attribute — {len(span)} records around {what}"),
            "vantages": vantages,
        }
    near = [r for r in records if abs(r - at) <= A5_RECORD_NEAR_MS]
    if near:
        return None  # the box recorded a clock event here; a recorded step is not an unrecorded one
    if not nominal_hz:
        # Both guards must PASS before the tripwire may fire, so a guard that cannot be applied stops it.
        # Reporting the candidate anyway would be a fire that skipped a guard — the shape A5 was rewritten
        # to prevent, since the only positive the first cut produced was one Guard 1 would have refused.
        return {
            **_decision(
                "UNKNOWN",
                f"{what}, but the stream's seam sidecar records no negotiated rate, so Guard 1 (delivery "
                f"rate) could not be applied and the candidate cannot be adjudicated",
            ),
            "vantages": vantages,
        }
    # No `if nominal_hz:` — the refusal above already returned for a missing one, so the test was always
    # true here and its other arm was a branch nothing could take.
    for label, win in (("before", A5_BEFORE_MS), ("after", A5_AFTER_MS)):
        n, secs = _rows_in(row_bins, at + win[0], at + win[1])
        if abs(n / secs - nominal_hz) / nominal_hz > A5_RATE_TOL:
            return {
                **_decision(
                    "UNKNOWN",
                    f"latency regime — the {label} window delivered {n / secs:.3g} rows/s against a nominal "
                    f"{nominal_hz:g} Hz, so {what} is a delivery backlog and not a step",
                ),
                "vantages": vantages,
            }
    a0, a1 = at + A5_AFTER_MS[0], at + A5_AFTER_MS[1]
    if any(g1 > a0 and g0 < a1 + A5_GAP_NEAR_MS for g0, g1 in gaps) or (
        last_ms is not None and last_ms < a1 + A5_GAP_NEAR_MS
    ):
        return {
            **_decision("UNKNOWN", f"persistence across a gap — the window after {what} is not flowing normally"),
            "vantages": vantages,
        }
    return {
        **_decision("UNKNOWN", f"unrecorded-shift-candidate — {what}, with no record in any of the three sources"),
        "vantages": vantages,
    }


def rtc_events(night_dir: str, model: str) -> list[tuple[_dt.datetime, str, float | None]]:
    """Every `push` / `read` / `reset` the night's RTC logs hold, sorted, as `(at, event, offset_s)`.

    ALL of the night's logs, because the ring writes ONE PER CAPTURE SESSION: 2026-08-29 holds 290 of
    them against a median night's 3, so a per-night figure taken from one file is not a per-night figure
    at all. A `read` with no parseable offset measured nothing and is dropped rather than defaulted (§∅).
    """
    tag = MODELS[model]["rtc"]
    out: list[tuple[_dt.datetime, str, float | None]] = []
    if tag is None:
        return out
    prefix = MODELS[model]["prefix"]
    for path in sorted(glob.glob(os.path.join(night_dir, f"{prefix}*_{tag}.csv"))):
        try:
            fh = open(path, encoding="utf-8", errors="replace")
        except OSError:
            continue  # a log we cannot open records nothing; the caller's count says how many we read
        with fh:
            for line in fh:
                c = line.rstrip("\n").split(";")
                if len(c) < 3 or c[1] not in ("push", "read", "reset"):
                    continue
                at = _ni.parse_host_stamp(c[0])
                if at is None:
                    continue  # an unplaceable row places no event
                if c[1] == "read":
                    try:
                        out.append((at, "read", float(c[2])))
                    except ValueError:
                        continue  # a read with no offset measured nothing
                else:
                    out.append((at, c[1], None))
    out.sort(key=lambda r: r[0])
    return out


def rtc_drift(clear: list, span_s: float) -> tuple:
    """`(ppm, floor_ppm, resolved)` for a night's push-clear reads — the band's arithmetic, on its own.

    EXTRACTED SO THE NUMBERS CAN BE PINNED. Inside `rtc_band` these three only ever reached a reader as
    `f"{ppm:+.0f}"`, rounded to whole ppm — so a test could assert the rendered text and still not
    distinguish an index substitution that moves the figure by less than half a ppm. 28 mutants of this
    arithmetic survived a suite at 100 % line coverage for exactly that reason (#3324): the lines ran,
    the values were unobserved. A pure function returning the floats is testable to the float.

    `floor_ppm` is the log's own 0.1 s quantum over the span — the smallest drift the RECORD can express,
    not the smallest the crystal can have. Below `RTC_DRIFT_RESOLVE` times the bound a published figure
    would be the resolution rather than the clock, so `resolved` is False and the band says so instead
    of quoting a number (§∅ — absence as a value, in reverse). Measured over the mirror: spans > 0.2 h
    give |ppm| p50 83.3 against a floor of 166.7, so the median sits BELOW its own floor."""
    if span_s <= 0:
        return None, None, False
    floor_ppm = RTC_OFFSET_QUANTUM_S / span_s * 1e6
    ppm = (clear[-1][1] - clear[0][1]) / span_s * 1e6
    return ppm, floor_ppm, floor_ppm * RTC_DRIFT_RESOLVE <= RTC_DRIFT_MAX_PPM


def rtc_band(night_dir: str, model: str, start, end) -> dict:
    """§3.4 `rtc`: the device's onboard RTC, judged against the host clock that disciplines it.

    A device whose spec names no RTC log is NOT_APPLICABLE — examined, and the rule does not bind. A
    device that keeps one, on a night that holds none, is UNKNOWN: the rule binds and the input is absent.

    ⚠️ READS WITHIN `RTC_PUSH_SETTLE_S` OF A PUSH ARE SET ASIDE, and the count is stated. See the
    constants above for the measurement: the whole offset tail lives in a 2-5 s window after a push, so
    judging every read would convict the ring for the daemon's own read timing. `checked + excluded =
    eligible` is the contract's own arithmetic (§🧾) and it is published here rather than implied."""
    if MODELS[model]["rtc"] is None:
        return _decision("NOT_APPLICABLE", NO_RTC_LOG)
    ev = rtc_events(night_dir, model)
    if not ev:
        return _decision("UNKNOWN", f"no `{MODELS[model]['rtc']}` rows this night, so the RTC was never read")
    if start is None:
        return _decision("UNKNOWN", "no worn interval, so no stretch of the RTC's night could be judged")
    resets = [t for t, k, _ in ev if k == "reset"]
    if resets:
        # A RESET MEANS THE DISCIPLINED TIME WAS LOST. ⚠️ The mirror holds ZERO resets in 620 logs, so
        # this arm has never fired on real data and is a tripwire rather than a validated discriminator
        # — said here so a FAIL never implies the detector has seen one before.
        return _decision(
            "FAIL",
            f"the RTC was RESET {len(resets)} time(s) this night, first at {resets[0]:%H:%M:%S} — "
            "the disciplined time was lost, so no offset after it describes the clock we set",
        )
    pushes = [t for t, k, _ in ev if k == "push"]
    reads = [(t, v) for t, k, v in ev if k == "read" and v is not None and start <= t <= end]
    clear = [(t, v) for t, v in reads if all(abs((t - p).total_seconds()) > RTC_PUSH_SETTLE_S for p in pushes)]
    excluded = len(reads) - len(clear)
    if not clear:
        return _decision(
            "UNKNOWN",
            f"all {len(reads)} read(s) inside the worn interval sit within {RTC_PUSH_SETTLE_S:.0f} s of a "
            f"push, so none of them measures the clock rather than the push sequence",
        )
    worst = max(clear, key=lambda r: abs(r[1]))
    span_s = (clear[-1][0] - clear[0][0]).total_seconds()
    # THE DRIFT IS NULL UNLESS THE SPAN CAN RESOLVE THE BOUND. The floor is the log's own quantum over
    # the span; below `RTC_DRIFT_RESOLVE` times the bound the figure would be the resolution, not the
    # crystal, and a number there is absence-as-value in reverse (§∅).
    ppm, floor_ppm, resolved = rtc_drift(clear, span_s)
    gaps = [(b[0] - a[0]).total_seconds() for a, b in zip(clear, clear[1:])]
    worst_gap = max(gaps) if gaps else None
    pop = f"{len(clear)} read(s) checked, {excluded} set aside within {RTC_PUSH_SETTLE_S:.0f} s of a push"
    if abs(worst[1]) > RTC_OFFSET_MAX_S:
        return _decision(
            "FAIL",
            f"the RTC was {worst[1]:+.1f} s off the host at {worst[0]:%H:%M:%S}, past the "
            f"{RTC_OFFSET_MAX_S:.1f} s bound — {pop}",
        )
    if resolved and ppm is not None and abs(ppm) > RTC_DRIFT_MAX_PPM:
        return _decision(
            "FAIL",
            f"the RTC drifted {ppm:+.0f} ppm over {span_s / 3600:.1f} h, past the "
            f"{RTC_DRIFT_MAX_PPM:.0f} ppm bound — {pop}",
        )
    drift = (
        f"{ppm:+.0f} ppm over {span_s / 3600:.1f} h"
        if resolved and ppm is not None
        else (
            f"null (the {span_s / 3600:.1f} h span resolves only "
            f"{floor_ppm:.0f} ppm, so a drift figure would be the log's 0.1 s resolution)"
            if floor_ppm is not None
            else "null (no span between clear reads)"
        )
    )
    cov = (
        f"longest unread stretch {worst_gap / 60:.0f} min"
        if worst_gap is not None and worst_gap > RTC_READ_GAP_MAX_S
        else "read throughout"
    )
    return _decision("PASS", f"RTC within {abs(worst[1]):.1f} s of the host, drift {drift}, {cov} — {pop}")


def timebase(night_dir: str, device: str, clock_tag: str, clock_files: list[str], start, end) -> dict:
    """§3.4 timebase: the device axis is a CLOCK, it was disciplined by an independent host, its rate is
    plausible, and it carries no step. Judged on the largest primary file inside the worn interval.

    NO `model` PARAMETER. It was accepted and never read — the stream map is resolved by the caller,
    which passes `primaries` already — so it was a dead parameter, and the mutation gate reported it as
    one: replacing it with `None` changed no answer (`x_score_devices__mutmut_168`). A dead parameter is
    removed rather than given a test that cannot fail; `_seam_cause` above records the same shape.

    🔴 `device` IS THE DEVICE NAME AND `who` IS THE FILE LABEL, and conflating them cost the record set.
    `clock_records` filters the journal's clock-event lines and every `CLOCKSYNC.csv` row BY DEVICE NAME,
    so passing the file's basename there matched nothing: the CLOCKSYNC half of §A5's record set was
    discarded in full, and every journal line that names its devices with it — leaving the tripwire free
    to convict a step the daemon had written down, which is precisely the 2026-08-18 mistake §A5 exists
    to prevent. Found by the mutation gate: replacing the argument with `None` changed no answer, because
    neither value ever matched (`test_a_step_the_CLOCKSYNC_SIDECAR_recorded_reaches_the_BAND_and_excuses_it`).
    """
    if start is None:
        return _decision("UNKNOWN", "no worn interval, so no stretch of the axis could be judged")
    if not clock_files:
        # ABSENCE, NOT INAPPLICABILITY. The spec names a clock-bearing stream for this model and this
        # night does not hold one — so the rule binds and the input is missing, which is UNKNOWN (§∅).
        # A model that names NO clock stream is a different answer and is decided by the caller.
        return _decision("UNKNOWN", f"no `{clock_tag}` stream this night, so no device axis could be read")
    path = max(clock_files, key=os.path.getsize)
    scan = residual_scan(path, start, end)
    if scan.get("reason"):
        return _decision("UNKNOWN", scan["reason"])
    who = os.path.basename(path)
    anchors = scan["anchors"]
    if len(anchors) < TB_MIN_ANCHORS:
        return _decision(
            "UNKNOWN", f"`{who}` gave {len(anchors)} anchor(s) inside the worn interval — under {TB_MIN_ANCHORS}"
        )
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
        cause = _seam_cause(night_dir)
        seam_note = (
            f" — {len(seams)} recorded clock seam(s), largest {worst['step_ms'] / 1000.0:+.3g} s"
            f"{'; ' + cause if cause else '; no cause recorded this night'}"
            f"; the axis is judged in {len(segs)} segment(s), never across a step"
        )

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
                out = _decision(
                    "UNKNOWN",
                    f"{tag} residual spread {spread:.2f} ms — the host column adds nothing beyond rounding, so there is no second clock{seam_note}",
                )
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
                    out = _decision(
                        "FAIL",
                        f"{tag} host-vs-device rate {ppm:+.0f} ppm over {span_s / 60:.0f} min — beyond the plausibility bound, so the two columns are not the two clocks{seam_note}",
                    )
                else:
                    # ── SOLID-NIGHT §A5 — the tripwire, which is what stood between a healthy axis and a
                    # PASS. Until it ran, EVERY night read UNKNOWN here by construction and the 14-night
                    # run could never start; the band said so in as many words rather than passing on an
                    # unexamined term, and this is that examination.
                    recs, how = clock_records(night_dir, device, path, start, end)
                    if recs is None:
                        out = _decision(
                            "UNKNOWN",
                            f"{tag}: axis is an independent clock at {ppm:+.0f} ppm over {span_s / 60:.0f} min, "
                            f"but the A5 record set could not be read — {how}{seam_note}",
                        )
                    else:
                        trip = unrecorded_shift(scan, recs, seam_rate(path))
                        if trip is not None:
                            out = _decision(trip["status"], f"{tag}: {trip['reason']}{seam_note}")
                        else:
                            # A PASS CARRIES ITS MEASUREMENT. `device_outcome` collects reasons only from
                            # FAIL and UNKNOWN bands, so this changes no verdict — but a band that passes
                            # silently publishes nothing, and the rate, the span, the segment tag and the
                            # seams consumed are exactly what makes a healthy night auditable later. The
                            # old UNKNOWN text said all of it; passing is no reason to start saying less.
                            out = _decision(
                                "PASS",
                                f"{tag}: axis is an independent clock at {ppm:+.0f} ppm over {span_s / 60:.0f} min; "
                                f"the A5 tripwire found no unrecorded shift ({how}){seam_note}",
                            )
        if worst_out is None or rank[out["status"]] > rank[worst_out["status"]]:
            worst_out = out
    assert worst_out is not None  # `anchors` is non-empty above, so `segs` carries at least one segment
    return worst_out
    # A5 IS BUILT ABOVE (`unrecorded_shift`), and the distinction this note used to draw still holds: the
    # segment split consumes a step the box RECORDED, which is the opposite of detecting an unrecorded
    # one. Where no seam file exists there is ONE segment and the number is unchanged. The tripwire's
    # fire is UNKNOWN `unrecorded-shift-candidate`, never a FAIL — "the clean corpus holds zero true
    # unrecorded steps, so the detector has never been validated against the thing it would convict" —
    # and it runs only after the record set has been read from all three sources and both guards pass.


def expected_devices(night_dir: str, devices: list) -> list[dict]:
    """§3.2: the configured devices minus `optional` backups — an optional one only on a night it captured."""
    out = []
    for d in devices or []:
        if not isinstance(d, dict):
            continue
        model = str(d.get("model") or "")
        if d.get("optional"):
            spec = MODELS.get(model)
            # POOLED like the rest: a device whose only files are the morning half of the recording is
            # present, and asking the judged folder alone would witness it as absent.
            _eb = band_of(night_dir)
            _seen = (
                [
                    f
                    for _sd in _scope_dirs(night_dir)
                    for f in glob.glob(os.path.join(_sd, f"{spec['prefix']}*"))
                    if in_band(f, _eb)
                ]
                if spec is not None
                else []
            )
            if spec is None or not _seen:
                continue
        out.append(d)
    return out


def _truncate_to_band(night_dir: str, start, end):
    """Clip a worn interval to the night band, reporting whether it had to. `(start, end, truncated)`.

    Both ends are datetimes here (`worn_interval` returns `min(starts)` and the audit's doff), so the
    band's epoch bounds are converted rather than the other way round — one conversion, at the boundary."""
    band = band_of(night_dir)
    if band is None or start is None or end is None:
        return start, end, False
    lo = _dt.datetime.fromtimestamp(band[0])
    hi = _dt.datetime.fromtimestamp(band[1])
    new_start = max(start, lo)
    new_end = min(end, hi)
    if new_end <= new_start:  # the interval lies wholly outside its own band: nothing of it is this night
        return None, None, True
    return new_start, new_end, (new_start != start or new_end != end)


def _adopt_later_wear(base: dict, other: dict, nxt: str) -> None:
    """Take `other`'s wear ends into `base` where they are LATER, recording which folder they came from.

    Only `wear` crosses. A device the judged folder never listed is adopted outright: it was worn, in
    this band, and the morning audit is the only record of it."""
    for name, od in (other.get("devices") or {}).items():
        if not isinstance(od, dict):
            continue  # one unusable entry must not drop the devices listed after it
        bd = (base.setdefault("devices", {})).setdefault(name, {})
        o_end = ((od.get("wear") or {}).get("worn_end") or {}).get("at")
        b_end = ((bd.get("wear") or {}).get("worn_end") or {}).get("at")
        if o_end and (not b_end or str(o_end) > str(b_end)):
            bd["wear"] = od["wear"]
            bd["wear_from"] = os.path.basename(nxt)
        # THE GAP ROWS MERGE BY FILE IDENTITY, and the SEAM between the two halves is judged separately,
        # because no per-file scan can see it (`loss_audit.stream_scan`: "sum the files' gaps misses
        # exactly the loss that made the night fragment"). Each row already names its `file`, and a
        # filename carries its own 14-digit session start, so identity is the filename and a row from the
        # morning folder cannot be mistaken for one from the evening.
        seen = {r.get("file") for r in (bd.get("gaps") or []) if isinstance(r, dict)}
        merged = list(bd.get("gaps") or [])
        for r in od.get("gaps") or []:
            if isinstance(r, dict) and r.get("file") not in seen:
                merged.append(dict(r, folder=os.path.basename(nxt)))
        rows, why = seam_gap(bd, od)
        merged.extend(rows)
        bd["gaps"] = sorted(merged, key=lambda r: (str(r.get("at")), r.get("s") or 0.0))
        # NAMED, NEVER SILENT: a seam nobody could judge says so, so `continuity` cannot read the absence
        # of a seam row as the absence of a seam gap (§∅).
        bd["seam_unassessed"] = why


def _pooled_audit(night_dir: str) -> dict | None:
    """The loss audit for the RECORDING, not for the folder.

    A recording may span two folders and each carries its own `LOSS-AUDIT.json`, so the judged folder's
    audit alone stops at midnight and the morning half's doff is in the other one. The judged folder's
    audit is the base — it is the one whose journal and gap rows this night was audited against — and a
    device's `wear.worn_end` is taken as the LATEST stated across the scope, because a doff recorded in
    the morning folder is the recording's real end.

    ⚠️ WHAT IS NOT MERGED, AND WHY. `gaps` and `file` stay the judged folder's own: the gap rows were
    measured against ONE named file, and concatenating two folders' rows would attribute one file's gaps
    to another's timeline. `continuity` reads them that way and would silently mis-attribute rather than
    refuse, so the half it cannot see is reported by `scope_partial` below instead of being guessed at."""
    base = read_json(os.path.join(night_dir, LOSS_AUDIT_NAME))
    dirs = _scope_dirs(night_dir)
    if base is None or len(dirs) < 2:
        return base
    # NO `continue` ON THE OUTER LOOP. `dirs` is bounded at two, so `dirs[1:]` holds at most one folder
    # and `continue` there is indistinguishable from `break` — a mutation site no input can decide,
    # created by the structural bound rather than by this code. Expressed as a condition instead, so the
    # loop means what it says and the gate has nothing undecidable to report.
    for nxt in dirs[1:]:
        other = read_json(os.path.join(nxt, LOSS_AUDIT_NAME))
        if isinstance(other, dict):
            _adopt_later_wear(base, other, nxt)
    return base


def score_devices(night_dir: str, devices: list) -> dict:
    """`{name: {"bands": {term: decision}}}` for `solid_night.compose`, one entry per expected device."""
    audit = _pooled_audit(night_dir)
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
        # 🔴 TRUNCATE TO THE BAND. `completeness` takes its denominator from `rate x (end - start)`, so
        # the worn interval IS the denominator — and an interval that runs past the band's edge makes it
        # too wide again, which is the 46.25 % defect one layer in. Membership (above) decided WHICH
        # files; truncation decides HOW LONG, and the two are different operations: a session starting
        # 09:00 inside a band that ends at 10:00 may run until 17:00. 9 of the mirror's 111 night
        # recordings have a raw extent that leaves their band.
        start, end, _trunc = _truncate_to_band(night_dir, start, end)
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
        # THE TIMEBASE BAND READS THE CLOCK STREAM, NOT THE PRIMARY — see `MODELS` above. A model that
        # names no clock-bearing stream is NOT_APPLICABLE: the band was examined and the rule does not
        # bind (§🧾), which is a different statement from "we could not tell" and the one an operator
        # needs — the ring is not a broken clock, it is a device that exports none.
        bands["rtc"] = rtc_band(night_dir, model, start, end)
        clock_tag = MODELS[model]["clock"]
        if clock_tag is None:
            bands["timebase"] = _decision("NOT_APPLICABLE", NO_DEVICE_AXIS)
        else:
            # `clock_files`, NOT `clocks`: `clocks` is the BAND FUNCTION two lines above, and a local of
            # that name shadows it for the whole scope — including the call that has already run, which
            # then raises UnboundLocalError. The same-name-two-things error, inside the unit that exists
            # to separate two things that share a name. Caught by the suite immediately; named here
            # because the next reader will reach for `clocks` too.
            clock_files = stream_files(night_dir, model, clock_tag)
            bands["timebase"] = timebase(night_dir, name, clock_tag, clock_files, start, end)
        out[name] = {"bands": bands}
    return out
