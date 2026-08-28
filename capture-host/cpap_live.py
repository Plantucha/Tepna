# tepna-capture — cpap_live.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# THE DECISION HALF for two questions the monitor and the harvest scheduler both ask about the CPAP,
# both answered from the AS11 shadow detector's `fg_state`. Pure, per the house pattern
# (`cpap_spool_caller`'s header): a decision that only exists inside an async loop is a decision no
# test can reach.
#
#   1. IS THERAPY RUNNING RIGHT NOW, AND HOW OLD IS THAT ANSWER?  (`live_view`)
#   2. HAS THERAPY ENDED LONG ENOUGH TO HARVEST?                  (`observe` / `harvest_due`)
#
# 🔴 THE TRAP BOTH SHARE: `therapy` IS None, NEVER False, WHEN THE DETECTOR CANNOT SEE THE MACHINE.
# The shadow poll defers ENTIRELY while the live stream is running, so "no reading" is the common
# case, not an edge one. Treating None as "not in therapy" would (1) render a confident "Standby"
# during a session the box simply is not watching, and (2) fire a harvest in the MIDDLE of therapy —
# the 2.4 GHz-next-to-a-sleeping-body contention that `cpap_harvest.due_now`'s window exists to
# prevent. §2.6: a missing observation stays visible as missing; it is never a fabricated negative.

from __future__ import annotations

__all__ = ["DETECTOR_STALE_MULTIPLE", "stale_after_s", "detector_age_s", "live_view",
           "EndWatch", "observe", "harvest_due"]

# ── how old is too old ─────────────────────────────────────────────────────────────────────────
# DERIVED, not chosen by feel. The shadow detector's promise is one reading every
# `as11_detector.poll_interval_sec` (default 30 s, capture.py). Three consecutive missed polls is the
# smallest gap that cannot be one slow cycle, so "unknown" means "older than the mechanism's own
# promise" rather than "older than felt right". Change the poll interval and this moves with it.
#
# ⚠️ AND IT WILL BE EXCEEDED ROUTINELY AND LEGITIMATELY. The detector defers for the whole duration of
# a live stream, so during streaming the age grows without bound and the honest answer really is
# "unknown" — not "standby", and not a stale "Therapy" frozen at the last reading before the stream
# began. That is why the state degrades to unknown rather than to a value.
DETECTOR_STALE_MULTIPLE = 3


def stale_after_s(poll_interval_s: float = 30.0, multiple: int = DETECTOR_STALE_MULTIPLE) -> float:
    """Seconds after which a detector reading stops being evidence about NOW. Pure."""
    try:
        p = float(poll_interval_s)
    except (TypeError, ValueError):
        p = 30.0
    if not (p > 0):
        p = 30.0
    return p * max(1, int(multiple))


def detector_age_s(now_ms, detector_host_ms):
    """Age of the reading in seconds, or None when it cannot be computed. Pure.

    ⚠️ COMPUTED SERVER-SIDE, AT SERVE TIME, ON PURPOSE. `detector_host_ms` is a BOX-local stamp; a
    browser aging it against its own clock subtracts two different clocks and prints the difference as
    a duration. Both operands here come from the same host clock, so the subtraction means something.
    A negative age (a clock step between publish and serve) is reported as 0 rather than as a reading
    from the future."""
    if detector_host_ms is None or now_ms is None:
        return None
    try:
        age = (float(now_ms) - float(detector_host_ms)) / 1000.0
    except (TypeError, ValueError):
        return None
    return max(0.0, age)


def live_view(cpap, now_ms, poll_interval_s: float = 30.0):
    """The monitor's live-therapy answer: `{state, therapy, age_s, stale_after_s, fresh}`. Pure.

    `state` is the word the page shows — "Therapy", "Standby", or "unknown". It is "unknown" whenever
    the reading is absent, unreachable, OR older than `stale_after_s`, because all three mean the same
    thing to a reader asking "is it running NOW".

    `age_s` is returned WHETHER OR NOT the reading is fresh, so the page can show the age always. A UI
    that shows an age only when stale teaches the reader that a bare value is current, which is the
    assumption this whole field exists to remove."""
    c = cpap if isinstance(cpap, dict) else {}
    limit = stale_after_s(poll_interval_s)
    age = detector_age_s(now_ms, c.get("detector_host_ms"))
    fresh = age is not None and age <= limit
    therapy = c.get("therapy")
    fg = c.get("fg_state")
    if not fresh or therapy is None:
        state = "unknown"
    else:
        state = str(fg) if fg else ("Therapy" if therapy else "Standby")
    return {"state": state, "therapy": therapy if fresh else None,
            "age_s": None if age is None else round(age, 1),
            "stale_after_s": limit, "fresh": bool(fresh)}


# ── therapy-end harvest trigger ────────────────────────────────────────────────────────────────
# The owner wants the card pulled SHORTLY AFTER therapy ends rather than at a fixed hour. The calendar
# window stays as the fallback: a transition the detector never saw (box asleep, detector disabled,
# stream running through the end of the session) must still harvest that day, so this trigger only
# ever makes a harvest EARLIER, never replaces the guarantee.

class EndWatch:
    """The debounce state. Deliberately a plain object with public fields: the daemon holds one, and
    every transition is decided by `observe`, which is pure and testable without a loop."""

    __slots__ = ("seen_therapy", "ended_at_ms", "fired_for")

    def __init__(self, seen_therapy: bool = False, ended_at_ms=None, fired_for=None):
        self.seen_therapy = seen_therapy   # a Therapy reading has been seen — an "end" means something
        self.ended_at_ms = ended_at_ms     # when the current uninterrupted non-Therapy run began
        self.fired_for = fired_for         # ended_at_ms of the end already harvested (fire once)

    # ⚠️ NO __eq__/as_tuple. Both were written here "for tests" and deleted the same hour: nothing
    # used them, and a method kept alive by its own convenience is the defect `find_unwired` caught on
    # `mutation_sweep.budget_for` earlier today. Tests assert on the FIELDS, which is what the daemon
    # reads too.

    def __repr__(self):  # pragma: no cover — debugging aid only
        return f"EndWatch(seen_therapy={self.seen_therapy!r}, ended_at_ms={self.ended_at_ms!r}, fired_for={self.fired_for!r})"


def observe(watch: EndWatch, therapy, now_ms) -> EndWatch:
    """Fold ONE detector reading into the debounce state. Pure; returns a new EndWatch.

    Three inputs, three different meanings, and conflating any two is the defect:
      · `therapy is True`  — in therapy. Arms the watch and CANCELS any pending end (this is the
        mask-off flap: the machine drops to standby and comes back, and a naive edge-trigger would
        already have fired).
      · `therapy is False` — genuinely not in therapy. STARTS the end clock, but only if therapy was
        ever seen; a box that boots into standby has not "ended" anything.
      · `therapy is None`  — THE DETECTOR CANNOT SEE THE MACHINE (unreachable, or deferred for the
        whole of a live stream). This is NOT an end. It leaves the state untouched, so an end clock
        already running keeps running and one never starts from ignorance."""
    if therapy is None:
        return EndWatch(watch.seen_therapy, watch.ended_at_ms, watch.fired_for)
    if therapy:
        return EndWatch(True, None, watch.fired_for)
    if not watch.seen_therapy:
        return EndWatch(False, None, watch.fired_for)
    if watch.ended_at_ms is None:
        return EndWatch(True, now_ms, watch.fired_for)
    return EndWatch(True, watch.ended_at_ms, watch.fired_for)


def harvest_due(watch: EndWatch, now_ms, debounce_s: float = 600.0):
    """`(due, reason)` — has therapy ended and STAYED ended for `debounce_s`? Pure.

    ⚠️ THE DEBOUNCE IS INSURANCE, AND THE FIELD IT GUARDS HAS NOT BEEN SEEN TO FLAP. This docstring
    first claimed "the machine flaps at mask-off, so an edge trigger would fire mid-session". Measured
    against the box's own `SESSIONDETECT.csv` on 2026-08-28, that is TRUE OF THE WRONG FIELD. Over
    three nights the journal holds 1080 changes of the supervisor's `active`/`idle` state — including
    six inside 287 s at 06:28-06:33, exactly the mask-off pattern — but only SIX `fg_state`
    transitions total, one down and one up per night, with a minimum return-to-Therapy gap of
    54 602 s (15.2 h, i.e. the following night). `therapy` is derived from `fg_state`, so the
    flapping that motivated this debounce happens in a field this function never reads.

    It is KEPT because three nights of one machine is thin evidence for "never", the failure it
    prevents is a 2.4 GHz transfer beside a sleeping body (`cpap_harvest.due_now`: 5-7 dB and 17
    reconnects across three sensors), and the cost of being wrong in the safe direction is ten
    minutes. But the justification is now "cheap insurance against an unobserved flap", not "the
    measured flap", and those are different claims. Default 600 s is still an hour earlier than the
    13:00 window on a normal night.

    Fires ONCE per end (`fired_for`), so a caller polling every 30 s does not re-trigger every cycle;
    a NEW therapy period clears it by resetting `ended_at_ms`."""
    if watch.ended_at_ms is None:
        return False, "no therapy end observed"
    if watch.fired_for == watch.ended_at_ms:
        return False, "already harvested for this therapy end"
    try:
        held = (float(now_ms) - float(watch.ended_at_ms)) / 1000.0
    except (TypeError, ValueError):
        return False, "unusable timestamps"
    if held < float(debounce_s):
        return False, f"therapy ended {held:.0f}s ago; debounce is {float(debounce_s):.0f}s"
    return True, f"therapy ended and held for {held:.0f}s"
