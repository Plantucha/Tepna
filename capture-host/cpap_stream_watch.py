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
    "unreachable_reason",
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
           min_cover: float = MIN_COVER, attempts=None, last_error=None, unreachable=None) -> dict:
    """`{state, detail, therapy_min, stream_min, cover}` — did the live stream record the session? PURE.

    `therapy_min` is None when the detector could not measure it. That is UNKNOWN, not zero: treating
    an unmeasured session as "no therapy" would silence the watchdog exactly when the detector is the
    thing that broke, and treating it as zero therapy would report OK for a night nobody watched.

    `attempts`/`last_error` come from auto-start's SESSION-KEYED record and separate a failed
    automation from a missed click. They are keyword-only and default to None so every existing caller
    keeps its exact behaviour — a box without auto-start armed has no record and still reports
    NEVER_STARTED, which is the truth there."""
    if therapy_min is None:
        # F2's journal half: SAY WHY, when the journal knows. The state stays UNKNOWN and the number
        # stays None — see `unreachable_reason` for why unanimous not-found cannot be promoted to 0
        # without evidence the radio worked — but "the machine was never found" and "the radio was
        # contended" stop being the same sentence, because they need opposite responses.
        why = ""
        if isinstance(unreachable, dict) and unreachable.get("n"):
            if unreachable.get("unanimous_absent"):
                why = (f" — every one of {unreachable['n']} failed poll(s) reported the machine NOT "
                       f"FOUND ({unreachable['dominant']}). Consistent with the machine being off, "
                       f"and equally consistent with a radio that could not hear it all night; "
                       f"nothing in this journal separates those")
            else:
                why = (f" — {unreachable['n']} failed poll(s), mostly {unreachable['dominant']}. At "
                       f"least one blames the RADIO rather than the machine, so this is a capture "
                       f"fault, not evidence about therapy")
        return {
            "state": UNKNOWN,
            "therapy_min": None,
            "stream_min": stream_min,
            "cover": None,
            "unreachable": unreachable,
            "detail": "no therapy duration measured (detector off, or its journal absent) — "
            "this is not evidence that no therapy ran" + why,
        }
    try:
        observed = float(therapy_min)
        s = float(stream_min or 0.0)
        # 🔴 STREAMED TIME IS THERAPY TIME, AND OMITTING IT MADE THIS CHECK MEASURE ITS OWN OBSERVER.
        # The shadow detector holds the one AS11 link only while the stream does NOT — `is_capturing()`
        # makes it stand down and resume — so `therapy_minutes` sees exactly the therapy that was NOT
        # streamed. Treating that sliver as the whole session meant STARTING a capture destroyed the
        # measurement the capture is judged against.
        #
        # Measured 2026-08-30: therapy detected 22:49:53-22:51:37, the operator started the stream at
        # ~104 s, and the night's verdict came out "therapy ran 2 min, below the 30 min floor — too
        # short to call a missed capture" for an EIGHT-HOUR session that produced a real EDF. The QC
        # therefore declined to judge precisely the nights where capture worked, and returned OK while
        # doing it — a self-masking blind spot over the whole feature.
        #
        # The two windows are DISJOINT BY CONSTRUCTION, which is what makes the sum honest rather than
        # a fudge: the detector observes only while the stream is idle. So total = observed + streamed,
        # and `cover` becomes a real fraction in [0, 1] instead of an unbounded ratio (last night it
        # would have read 480/1.7 = 282).
        #
        # It stays correct at both ends. Stream never started: s = 0, total = observed, NEVER_STARTED
        # as before. Stream died early: the detector RESUMES and observes the remainder, so total
        # grows while s does not, and cover falls — which is exactly DIED_EARLY.
        t = observed + s
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
            "therapy_observed_min": round(observed, 1),
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
            "therapy_observed_min": round(observed, 1),
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
            "therapy_observed_min": round(observed, 1),
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
            "therapy_observed_min": round(observed, 1),
            "stream_min": round(s, 1),
            "cover": round(cover, 3),
            "detail": f"the live stream covered {s:.0f} of {t:.0f} therapy min ({100 * cover:.1f} %) "
            f"— it opened and stopped early",
        }
    return {
        "state": OK,
        "therapy_min": round(t, 1),
            "therapy_observed_min": round(observed, 1),
        "stream_min": round(s, 1),
        "cover": round(cover, 3),
        "detail": f"the live stream covered {s:.0f} of {t:.0f} therapy min ({100 * cover:.1f} %)",
    }


# A detector poll is nominally every 30 s, but the link drops: 41 `BleakDeviceNotFoundError` in one
# night on this box. So consecutive rows can be minutes apart, and crediting the whole gap as therapy
# would turn an outage into recorded treatment. Gaps longer than this are counted as the poll interval
# instead — the observation is worth one poll, not the silence around it.
# ── WHY the journal could not be read — F2's journal half ─────────────────────────────────────────
# `UnreachableRow` has recorded the exception class in `trigger` (parts[5]) since 2026-08-30 so a
# persistent fault is identifiable by a human reading the CSV. Nothing consumed it, so a night the
# machine was OFF and a night the RADIO could not answer produced byte-identical UNKNOWNs — and they
# need opposite responses (wait vs reset bluez).
#
# 🔴 THIS DELIBERATELY DOES NOT PROMOTE A MACHINE-OFF NIGHT TO 0.0 MINUTES, AND THAT RESTRAINT IS THE
# DESIGN, NOT A SHORTCUT. The tempting win is real — a machine that was genuinely off HAS an answer,
# zero, and reporting None there turns a measurement into an unknown. But the classes alone cannot
# license it:
#
#     machine OFF, radio healthy                 -> every poll not-found
#     machine ON, bluez wedged against THIS device -> every poll not-found
#
# ⚠️ THE SECOND ROW IS NOT "A JAMMED RADIO", AND THE DIFFERENCE MATTERS. On 2026-08-29 the radio was
# demonstrably HEALTHY throughout — one adapter enumerated 107 other devices and the two wearables
# streamed all night — while bluez stayed blind to the CPAP alone. So a radio-health signal cannot
# separate these two rows either: a per-device wedge IS a healthy radio. That kills the obvious
# discriminator ("did the adapter hear anything?") before it is reached for, which is why the
# restraint below is not merely cautious.
#
# Unanimous not-found is IDENTICAL under both, so a night-long wedge would ship a fabricated 0 —
# strictly worse than the honest None it replaces. Separating them needs positive evidence the radio
# WORKED that night (did the adapter reach any other device?), and `therapy_minutes` is pure over one
# journal: it can see no other device, no adapter state, nothing outside the CPAP's own rows. The
# corroboration is not merely absent, it is structurally unavailable at this layer.
#
# Proven, not argued: the 2026-08-29 blackout produced unanimous not-found across BOTH adapters for a
# night the machine was demonstrably running — ten EDF files were harvested from it the next day.
# `absence_verdict`'s clean sweep does not catch that either, which is why reusing it wholesale would
# have inherited the same blind spot one level up.
#
# So this LABELS the unknown instead of resolving it: "not found on every poll" and "the radio was
# contended" become different sentences a human can act on, while the number stays None. To promote
# one to 0 later, give this layer a radio-health signal — the wedge rung's `radio_healthy` is the
# shape — and gate the promotion on it.
_ABSENT_CLASSES = ("bleakdevicenotfounderror",)


def unreachable_reason(text: str) -> "dict | None":
    """`{n, classes, dominant, unanimous_absent}` over the journal's unreachable rows, or None. PURE.

    `unanimous_absent` means every unreachable row blamed a device-not-found class — NECESSARY for a
    machine-off reading and, on its own, NOT SUFFICIENT (see above). It is published so a caller that
    *does* hold radio-health evidence can combine the two; it is never treated as a verdict here."""
    classes: "dict[str, int]" = {}
    n = 0
    for line in str(text or "").splitlines():
        parts = line.split(";")
        if len(parts) < 9:
            continue
        try:
            float(parts[0])
        except ValueError:
            continue                       # header or torn line
        if parts[7].strip().lower() not in ("false", "0"):
            continue                       # a reachable poll says nothing about why others failed
        n += 1
        cls = parts[5].strip() or "unknown"
        classes[cls] = classes.get(cls, 0) + 1
    if not n:
        return None
    dominant = max(classes.items(), key=lambda kv: (kv[1], kv[0]))[0]
    return {"n": n, "classes": classes, "dominant": dominant,
            "unanimous_absent": bool(classes) and all(
                c.lower() in _ABSENT_CLASSES for c in classes)}


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
            continue   # an unreadable EDF header contributes no minutes; #2004's `unreachable`
                       # classification is what distinguishes "no data" from "machine was off"
        if n > 0 and dur > 0:
            total += n * dur
    return total / 60.0
