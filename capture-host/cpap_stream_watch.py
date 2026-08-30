# tepna-capture — cpap_stream_watch.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# THERAPY RAN AND NOTHING RECORDED IT — the notice that was missing on 2026-08-26.
#
# WHAT HAPPENED. The CPAP live stream is OPERATOR-INITIATED: `POST /api/cpap/stream` from the monitor
# is the only thing that opens it, and there is no scheduled starter. So on 08-26 the machine ran a
# full therapy session and `edf_dir` stayed empty, because nobody clicked. On 08-27 it was started at
# 23:35:47 and STOPPED at 23:35:48 — a double-click or a toggle race — leaving a 7 KB, one-record
# file for a six-hour session. Neither night produced a warning, a log line, or a QC row.
#
# 🔴 THE HARM WAS THE SILENCE, NOT THE MISSED CLICK. A missed click is a small thing that happens; a
# capture box that records nothing and says nothing is the failure class this repo keeps finding — the
# archive-pull that had never once succeeded, the Verity that held a link for 4 h 25 m and wrote zero
# bytes, the harvest that reported success about a walk it never made. Each was invisible for the same
# reason: absence produces no event. This module makes THIS absence produce one.
#
# ⚠️ AND IT REFUSES RATHER THAN GUESSES, because a watchdog that fabricates is worse than none. It
# needs a MEASURED therapy duration to compare against. If the shadow detector is off, or its journal
# is absent or unreadable, there is no therapy figure — and "no therapy observed" is NOT "no therapy
# happened". In that state it returns UNKNOWN and says why, never a silent OK and never a finding.
# Same rule as `cpap_live`: a missing observation stays visible as missing.

from __future__ import annotations

__all__ = [
    "OK",
    "NEVER_STARTED",
    "AUTOSTART_FAILED",
    "DIED_EARLY",
    "UNKNOWN",
    "MIN_THERAPY_MIN",
    "MIN_OBSERVED_FRAC",
    "MIN_COVER",
    "MAX_GAP_S",
    "assess",
    "therapy_minutes",
    "stream_minutes",
]

OK = "ok"
NEVER_STARTED = "never-started"  # therapy ran, the stream was never opened at all
AUTOSTART_FAILED = "auto-start-failed"  # automation TRIED and could not — not a missed click
DIED_EARLY = "died-early"  # the stream opened and covered far less than the session
UNKNOWN = "unknown"  # no measured therapy duration — REFUSES to judge

# A session shorter than this is not evidence of a missed capture: a machine switched on to check a
# setting, or a mask fitted and removed, legitimately produces minutes of Therapy and no stream. The
# observed real sessions on this box are 233-521 min, so 30 leaves a wide margin below anything real
# while still catching a whole night.
MIN_THERAPY_MIN = 30.0

# Coverage below this is the finding. Not 100%: the stream is started BY HAND after the machine, so a
# few minutes of therapy always precede it, and that is normal rather than a fault. Half a session is
# far outside that — the 08-27 case was 0.3% (one minute of 380).
MIN_COVER = 0.5


def assess(therapy_min, stream_min, *, min_therapy_min: float = MIN_THERAPY_MIN,
           min_cover: float = MIN_COVER, attempts=None, last_error=None) -> dict:
    """`{state, detail, therapy_min, stream_min, cover}` — did the live stream record the session? PURE.

    `therapy_min` is None when the detector could not measure it. That is UNKNOWN, not zero: treating
    an unmeasured session as "no therapy" would silence the watchdog exactly when the detector is the
    thing that broke, and treating it as zero therapy would report OK for a night nobody watched.

    `attempts`/`last_error` come from auto-start's SESSION-KEYED record and separate a failed
    automation from a missed click. They are keyword-only and default to None so every existing caller
    keeps its exact behaviour — a box without auto-start armed has no record and still reports
    NEVER_STARTED, which is the truth there."""
    if therapy_min is None:
        return {
            "state": UNKNOWN,
            "therapy_min": None,
            "stream_min": stream_min,
            "cover": None,
            "detail": "no therapy duration measured (detector off, or its journal absent) — "
            "this is not evidence that no therapy ran",
        }
    try:
        t = float(therapy_min)
        s = float(stream_min or 0.0)
    except (TypeError, ValueError):
        return {
            "state": UNKNOWN,
            "therapy_min": None,
            "stream_min": None,
            "cover": None,
            "detail": f"unusable durations: therapy={therapy_min!r} stream={stream_min!r}",
        }
    if t < float(min_therapy_min):
        return {
            "state": OK,
            "therapy_min": round(t, 1),
            "stream_min": round(s, 1),
            "cover": None,
            "detail": f"therapy ran {t:.0f} min, below the {float(min_therapy_min):.0f} min floor "
            f"— too short to call a missed capture",
        }
    cover = 0.0 if t <= 0 else s / t
    if s <= 0:
        # 🔴 A FAILED AUTOMATION MUST NEVER WEAR THE MANUAL-GAP LABEL. On disk, "nobody clicked" and
        # "auto-start tried five times and could not connect" are byte-identical: both are an empty
        # `edf_dir` beside a full therapy session. They demand OPPOSITE responses — one is a habit to
        # fix, the other is a bug to fix — so the distinction cannot be left to the reader's guess.
        # It is only available because auto-start persists an attempt record; absent that record the
        # honest answer is still NEVER_STARTED, which is what an unarmed box correctly reports.
        try:
            n = int(attempts or 0)
        except (TypeError, ValueError):
            n = 0
        if n > 0:
            return {
                "state": AUTOSTART_FAILED,
                "therapy_min": round(t, 1),
                "stream_min": 0.0,
                "cover": 0.0,
                "attempts": n,
                "detail": f"therapy ran {t:.0f} min and auto-start failed {n} time(s) — the "
                f"automation tried and could not open the stream"
                + (f" (last error: {last_error})" if last_error else ""),
            }
        return {
            "state": NEVER_STARTED,
            "therapy_min": round(t, 1),
            "stream_min": 0.0,
            "cover": 0.0,
            "detail": f"therapy ran {t:.0f} min and the live stream was never opened — nobody "
            f"started it (POST /api/cpap/stream is the only way in; there is no "
            f"scheduled starter)",
        }
    if cover < float(min_cover):
        return {
            "state": DIED_EARLY,
            "therapy_min": round(t, 1),
            "stream_min": round(s, 1),
            "cover": round(cover, 3),
            "detail": f"the live stream covered {s:.0f} of {t:.0f} therapy min ({100 * cover:.1f} %) "
            f"— it opened and stopped early",
        }
    return {
        "state": OK,
        "therapy_min": round(t, 1),
        "stream_min": round(s, 1),
        "cover": round(cover, 3),
        "detail": f"the live stream covered {s:.0f} of {t:.0f} therapy min ({100 * cover:.1f} %)",
    }


# A detector poll is nominally every 30 s, but the link drops: 41 `BleakDeviceNotFoundError` in one
# night on this box. So consecutive rows can be minutes apart, and crediting the whole gap as therapy
# would turn an outage into recorded treatment. Gaps longer than this are counted as the poll interval
# instead — the observation is worth one poll, not the silence around it.
MAX_GAP_S = 120.0

# The share of polls that must have REACHED the machine before this journal is allowed to answer.
# Below it the honest verdict is UNKNOWN. 2026-08-30 ran ELEVEN HOURS with every poll failing, and a
# handful of surviving observations would otherwise have reported a short, calm, entirely fictional
# night. Deliberately lenient at two thirds: ordinary dropout is normal here (41
# BleakDeviceNotFoundError in one night), so an outage has to DOMINATE before we refuse to answer.
MIN_OBSERVED_FRAC = 0.667


def therapy_minutes(text: str, *, max_gap_s: float = MAX_GAP_S):
    """Minutes of observed Therapy in a SESSIONDETECT journal, or None if it cannot be measured. PURE.

    Sums the interval each Therapy observation COVERS, not the span from first to last: a session that
    ends and restarts must not have the idle middle counted as treatment.

    ⚠️ Returns None — never 0.0 — for an empty or unparseable journal, and `assess` turns that into
    UNKNOWN rather than a finding. Zero would say "no therapy ran", which is a claim about the machine;
    None says "this journal cannot tell us", which is a claim about the evidence. Conflating them makes
    a broken detector look like a quiet night."""
    rows = []
    unreachable = 0
    for line in str(text or "").splitlines():
        parts = line.split(";")
        if len(parts) < 9:
            continue
        try:
            ms = float(parts[0])
        except ValueError:
            continue  # the header row, or a torn line
        # 🔴 AN UNREACHABLE POLL IS NOT AN OBSERVATION OF STANDBY. The shadow runner now writes a row
        # when it could not reach the machine (reachable=False, blank fg_state) — which is what makes
        # an outage visible at all. Counting those as "not in therapy" would be strictly WORSE than
        # the silence they replaced: the night would read as measured, and measured as fine.
        if parts[7].strip().lower() in ("false", "0"):
            unreachable += 1
            continue
        rows.append((ms, parts[8].strip()))
    if len(rows) < 2:
        return None
    # ⚠️ COVERAGE, NOT MERE PRESENCE. A mostly-unreachable journal can still hold a couple of real
    # observations, and summing therapy across them reports a confident few minutes for a night nobody
    # watched — the exact poisoning the unreachable row was added to EXPOSE rather than create.
    if unreachable > len(rows) * (1.0 - MIN_OBSERVED_FRAC) / MIN_OBSERVED_FRAC:
        return None
    rows.sort()
    total = 0.0
    for (t0, fg), (t1, _) in zip(rows, rows[1:]):
        if fg != "Therapy":
            continue
        gap = (t1 - t0) / 1000.0
        if gap <= 0:
            continue  # duplicate or out-of-order stamp: covers no time
        elif gap <= float(max_gap_s):
            total += gap  # a normal ~30 s poll interval — the observation covers it
        else:
            # 🔴 A LONG GAP IS A DETECTOR OUTAGE, NOT A LONG TREATMENT. The link drops often on this
            # box — 41 BleakDeviceNotFoundError in one night — so consecutive rows can be an hour
            # apart. Crediting that hour would report a well-covered night at exactly the moment the
            # detector had stopped looking, which is the silence this module exists to break, one
            # level up. Credit one nominal poll and no more.
            total += 30.0
    # The LAST Therapy row contributes nothing, so this under-reads by up to one poll (~30 s). That is
    # the safe direction: under-reporting therapy can only make the watchdog quieter, never noisier.
    return total / 60.0


def stream_minutes(headers):
    """Minutes of live stream from EDF headers — `[(n_records, seconds_per_record), ...]`. PURE.

    Returns 0.0 for an empty list, and that IS a measurement: `edf_dir` was read and held no EDF for
    this night. Distinct from `therapy_minutes`' None, which means the journal could not be read at
    all. (Brief runner's distinction, and it is the right one: absence from a source that WAS read is
    evidence; absence of a reading is not.)"""
    total = 0.0
    for h in headers or []:
        try:
            n, dur = float(h[0]), float(h[1])
        except (TypeError, ValueError, IndexError):
            continue
        if n > 0 and dur > 0:
            total += n * dur
    return total / 60.0
