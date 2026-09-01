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
           "EndWatch", "observe", "harvest_due",
           "CATCH_UP_MAX_AGE_S", "journal_rows", "last_therapy_end", "boot_state",
           "AUTOSTART_RETAIN_S", "AUTOSTART_MAX_ATTEMPTS", "AUTOSTART_BACKOFF_S",
           "AUTOSTART_BACKOFF_MAX_S", "StartWatch", "observe_start", "autostart_due",
           "false_start_verdict", "note_false_start",
           "note_start_failed", "note_manual_stop", "note_started", "boot_start_state"]

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


# ── boot-time catch-up ─────────────────────────────────────────────────────────────────────────
# 🔴 AN EDGE TRIGGER WITH RAM STATE CANNOT SEE AN EDGE THAT SPANNED ITS OWN RESTART. Measured
# 2026-08-29: the owner rebooted at 06:26 and the therapy end landed at 06:28:03, two seconds after
# the daemon came up at 06:28:01. `observe` correctly refused to call it an end — a box that boots
# into standby has not ENDED anything, and inventing an end from ignorance is the fabricated negative
# §2.6 forbids. So the trigger did not fire, and the night's second witnessing attempt was lost to a
# restart rather than to a defect.
#
# The fix does NOT add a second firing path. It SEEDS the same `EndWatch` from the journal, so the
# already-tested `harvest_due` decides — same debounce, same fire-once, one decision core.
#
# ⚠️ THE 24-HOUR BOUND IS THE POINT, and the debounce horizon would have been the wrong number. A
# 600 s bound would miss an end at 06:20 on a box rebooted at 07:30 — precisely the case catch-up
# exists for. The true backstop for anything older is the daily 13:00 window, which is unchanged: a
# box that was off for a week harvests at its first 13:00, not at boot, which is also the right radio
# behaviour for a box that has just come back. So catch-up owns ends younger than a day; the daily
# window owns the rest, by design rather than by omission.
CATCH_UP_MAX_AGE_S = 86400.0


def journal_rows(text):
    """`[(host_ms, fg_state)]` from a SESSIONDETECT journal, ascending. Pure.

    The ONE place that knows this file's column layout: `host_ms` first, `fg_state` at index 8. A row
    that cannot yield a float first column is the header or a torn line and is skipped."""
    rows = []
    for line in str(text or "").splitlines():
        parts = line.split(";")
        if len(parts) < 9:
            continue
        try:
            ms = float(parts[0])
        except ValueError:
            continue   # a journal row with no parseable timestamp cannot be placed in the session
                       # it belongs to — and guessing one would fabricate therapy time
        rows.append((ms, parts[8].strip()))
    rows.sort()
    return rows


def last_therapy_end(rows):
    """`(end_ms, ended)` — when therapy last STOPPED, and whether the journal ends out of therapy. Pure.

    `end_ms` is the stamp of the first non-Therapy row after the last Therapy row, which is when the
    end was OBSERVED — not when it occurred. Those differ by up to one poll, and the observed stamp is
    the honest one: it is the only instant this file actually witnessed.

    `(None, False)` when the journal holds no Therapy at all, and `(None, True)` never happens — the
    two are returned together precisely so a caller cannot read "no end recorded" as "not in therapy".
    A journal ending IN Therapy returns `(<the previous end>, False)`, so a caller that ignores the
    flag would catch up during a running session."""
    last_therapy = None
    for i, (_ms, fg) in enumerate(rows):
        if fg == "Therapy":
            last_therapy = i
    if last_therapy is None:
        return None, False
    if last_therapy == len(rows) - 1:
        return None, False                # the journal ends IN therapy: no end has been observed yet
    return rows[last_therapy + 1][0], True


def boot_state(end_ms, ended, fired_for, now_ms, max_age_s: float = CATCH_UP_MAX_AGE_S):
    """`(EndWatch, reason)` — the state a JUST-STARTED daemon should begin with. Pure.

    Returns a seeded watch only when every one of these holds, and names which one failed otherwise,
    because a catch-up that silently declines is indistinguishable from one that is broken:
      · the journal witnessed an end (`ended`), so we are not seeding during a running session;
      · that end has not already been harvested (`fired_for`), which is why the marker is PERSISTED
        rather than inferred from the output tree — a harvest that wrote some files and then died
        looks identical to a complete one from the outside;
      · the end is younger than `max_age_s`.
    `fired_for` is carried into every returned watch, seeded or not, so a restart can never re-harvest
    an end the previous process already handled."""
    fresh = EndWatch(False, None, fired_for)
    if not ended or end_ms is None:
        return fresh, "no observed therapy end in the journal"
    try:
        age = (float(now_ms) - float(end_ms)) / 1000.0
    except (TypeError, ValueError):
        return fresh, "unusable timestamps"
    if fired_for == end_ms:
        return fresh, "the last therapy end was already harvested"
    if age < 0:
        return fresh, "the last therapy end is in the future — clock disagreement, not a missed edge"
    if age > float(max_age_s):
        return fresh, (f"the last therapy end is {age / 3600.0:.1f}h old, older than the "
                       f"{float(max_age_s) / 3600.0:.0f}h catch-up bound; the daily window owns it")
    return EndWatch(True, end_ms, fired_for), f"catching up a therapy end from {age / 60.0:.0f} min ago"


# ── AUTO-START: the live stream starts itself when therapy starts ──────────────────────────────
# The mirror of the therapy-END trigger, and it exists because the alternative is a click. On
# 2026-08-26 nobody clicked and a full night went unrecorded; on 08-27 the click was made and undone a
# second later. Neither was a failure of anything, which is exactly why nothing reported them.
#
# 🔴 THE ASYMMETRY WITH THE END TRIGGER IS DELIBERATE AND IS THE WHOLE DESIGN. Firing late on an END
# costs ten minutes of waiting. Firing wrongly on a START opens a BLE stream beside a sleeping body
# and, worse, can start recording something that is not a session. So this side carries three guards
# the end side does not need:
#
#   · a DEBOUNCE against mask-fit blips (default 120 s of continuous Therapy, config-overridable);
#   · MANUAL INTENT WINS — an operator who stops a stream mid-session has said "not this session",
#     and no automation may overrule that until a NEW session begins;
#   · BOUNDED RETRY — a start that fails retries with backoff while Therapy persists, and then STOPS.
#     An unbounded retry against a device that is refusing is a radio hammering a sleeping room.
#
# ⚠️ THE COEXISTENCE GATE IS NOT RE-INTRODUCED HERE. `cpap.ble_stream.coexistence_gate` defaults to
# FALSE by owner order (2026-08-23) — the stream does not refuse beside an on-body wearable, it only
# logs — and the box's config does not set it. Auto-start inherits that decision rather than quietly
# reinstating a refusal the owner removed: `LiveStreamController` still applies whatever the gate is
# set to, and this module never second-guesses it. (The monitor's hint claiming the stream "refuses
# while a wearable is capturing" is STALE for the same reason, and is corrected in this change.)
# THE 120 s RULE MOVED FROM THE GATE TO RETENTION (owner-queued, 2026-09-01). It was
# AUTOSTART_DEBOUNCE_S — therapy had to run 120 s before the stream would START, which cost every
# night a guaranteed 120 s head gap on top of detector latency (measured decomposition, night of
# 2026-08-31: 147.44 s total = ~120 s gate + ~27 s poll latency + ~1.3 s connect; the SD record
# covers the head, so closing this buys live-path completeness + redundancy, not archive recovery).
# Now the stream starts at the FIRST Therapy sighting and the 120 s question is answered AFTERWARD,
# by `false_start_verdict`: a session that failed to sustain is DISCARDED and costs an attempt.
# The failure directions are asymmetric and this is the benign one: an eager start's harm is bounded
# BLE churn (capped by the same attempt budget), where the old gate's harm was data loss every night.
AUTOSTART_RETAIN_S = 120.0
AUTOSTART_MAX_ATTEMPTS = 5
AUTOSTART_BACKOFF_S = 60.0
AUTOSTART_BACKOFF_MAX_S = 900.0


class StartWatch:
    """The auto-start state. Plain fields, like `EndWatch`, so every transition is decided by a pure
    function a test can reach without a loop.

    `began_at_ms` keys EVERYTHING here — `fired_for`, `manual_stop_for` and the attempt record are all
    scoped to the session that began at that instant, so a previous night's state can never leak into
    tonight's decision. Matching by key rather than by timestamp arithmetic means a stale record for a
    dead session is ignorable rather than needing an age test."""

    __slots__ = ("began_at_ms", "fired_for", "manual_stop_for", "attempts", "next_try_ms")

    def __init__(self, began_at_ms=None, fired_for=None, manual_stop_for=None,
                 attempts: int = 0, next_try_ms=None):
        self.began_at_ms = began_at_ms       # when the current uninterrupted Therapy run began
        self.fired_for = fired_for           # began_at_ms of the session already auto-started
        self.manual_stop_for = manual_stop_for   # began_at_ms of a session the OPERATOR stopped
        self.attempts = attempts             # failed start attempts for the CURRENT session
        self.next_try_ms = next_try_ms       # earliest next attempt (backoff), None = now

    def __repr__(self):  # pragma: no cover — debugging aid only
        return (f"StartWatch(began_at_ms={self.began_at_ms!r}, fired_for={self.fired_for!r}, "
                f"manual_stop_for={self.manual_stop_for!r}, attempts={self.attempts!r}, "
                f"next_try_ms={self.next_try_ms!r})")


def observe_start(watch: StartWatch, therapy, now_ms) -> StartWatch:
    """Fold ONE detector reading into the auto-start state. Pure; returns a new StartWatch.

    Same tri-state discipline as `observe`, and for the same reason — `therapy is None` means the
    detector cannot see the machine (unreachable, or deferred for the whole of a live stream), which
    is the COMMON case here, not an edge one. Note what that implies once a stream IS running: the
    detector defers, every reading is None, and the session's `began_at_ms` therefore SURVIVES rather
    than being cleared by ignorance. A `False` that arrived from ignorance would end the session in
    state and let a mask-off blip start a second one."""
    if therapy is None:
        return StartWatch(watch.began_at_ms, watch.fired_for, watch.manual_stop_for,
                          watch.attempts, watch.next_try_ms)
    if not therapy:
        # Out of therapy: the session is over. `fired_for` and `manual_stop_for` are KEPT — they are
        # keyed by the ended session and are simply no longer matched once a new one begins.
        return StartWatch(None, watch.fired_for, watch.manual_stop_for, 0, None)
    if watch.began_at_ms is None:
        return StartWatch(now_ms, watch.fired_for, watch.manual_stop_for, 0, None)
    return StartWatch(watch.began_at_ms, watch.fired_for, watch.manual_stop_for,
                      watch.attempts, watch.next_try_ms)


def autostart_due(watch: StartWatch, now_ms, *,
                  max_attempts: int = AUTOSTART_MAX_ATTEMPTS, already_streaming: bool = False):
    """`(due, reason)` — should the live stream be started right now? Pure.

    EAGER, deliberately: it fires at the FIRST Therapy sighting. The 120 s continuous-therapy
    question that used to gate here is now answered AFTER the fact by `false_start_verdict` — a start
    that turns out false is discarded and costs an attempt, where the old gate cost every genuine
    night a 120 s head gap. See AUTOSTART_RETAIN_S for the measured decomposition and the
    failure-direction argument.

    Every refusal names itself, because an auto-start that declines silently is indistinguishable from
    one that is broken — and that is the exact failure this whole feature exists to end."""
    if already_streaming:
        return False, "a stream is already running"
    if watch.began_at_ms is None:
        return False, "not in therapy"
    if watch.manual_stop_for == watch.began_at_ms:
        return False, "the operator stopped this session by hand; no auto-restart until the next one"
    if watch.fired_for == watch.began_at_ms:
        return False, "already auto-started for this therapy session"
    if watch.attempts >= int(max_attempts):
        return False, f"{watch.attempts} failed start(s) for this session; giving up until the next one"
    try:
        held = (float(now_ms) - float(watch.began_at_ms)) / 1000.0
    except (TypeError, ValueError):
        return False, "unusable timestamps"
    if watch.next_try_ms is not None:
        try:
            if float(now_ms) < float(watch.next_try_ms):
                wait = (float(watch.next_try_ms) - float(now_ms)) / 1000.0
                return False, f"backing off after {watch.attempts} failed start(s); {wait:.0f}s to go"
        except (TypeError, ValueError):
            return False, "unusable timestamps"
    return True, f"therapy sighted {held:.0f}s ago — starting eagerly (retention decides the 120 s question)"


def false_start_verdict(started_ms, ended_ms, *, manual: bool,
                        retain_s: float = AUTOSTART_RETAIN_S, hold_s: float = 120.0):
    """`(discard, reason)` — was this eagerly-started session a FALSE START? Pure.

    Decided from the STREAM'S OWN LIFETIME, because nothing else can see: while a stream runs the
    detector defers entirely (every reading is None), so "did therapy sustain?" cannot be asked of
    FGState — but the stream already answers it. Genuine therapy runs for hours; a false start's flow
    goes flat immediately, the therapy-end auto-stop's hold (`hold_sec`, default 120 s) times out,
    and the stream ends at roughly `hold_s` old. So the discard window is `retain_s + hold_s`, NOT
    `retain_s`: a session that sustained therapy for `retain_s` lives at least `retain_s + hold_s`
    before any flat-flow stop can end it, and a false start structurally cannot reach that age.
    (With both at their 120 s defaults: discard below 240 s of stream life.)

    A MANUAL stop is never a false start, whatever the age — the operator ending a short session is
    intent, and discarding data on intent would delete the one fragment somebody explicitly chose to
    make. An unparseable timestamp retains: when the verdict cannot be computed, keeping data is the
    error that can be undone."""
    if manual:
        return False, "operator-stopped — a manual stop is intent, never a false start"
    try:
        lived = (float(ended_ms) - float(started_ms)) / 1000.0
        window = float(retain_s) + float(hold_s)
    except (TypeError, ValueError):
        return False, "unusable timestamps — retaining (a discard cannot be undone)"
    if lived < 0:
        return False, "stream ended before it started? — retaining (clock disagreement, not evidence)"
    if lived < window:
        return True, (f"stream lived {lived:.0f}s < {window:.0f}s (retain {float(retain_s):.0f}s + "
                      f"auto-stop hold {float(hold_s):.0f}s) — therapy did not sustain; false start")
    return False, f"stream lived {lived:.0f}s ≥ {window:.0f}s — a real session"


def note_false_start(watch: StartWatch, now_ms, *, backoff_s: float = AUTOSTART_BACKOFF_S,
                     backoff_max_s: float = AUTOSTART_BACKOFF_MAX_S) -> StartWatch:
    """A started stream turned out to be a false start. Pure.

    Counts against the SAME attempt budget as a failed connect — the budget bounds BLE churn per
    session however the churn arises — and CLEARS `fired_for`, because `note_started` marked this
    session as already-fired and without the clear the machine still sitting in Therapy could never
    earn a retry. `began_at_ms` is deliberately untouched: the session key is the first sighting,
    and re-keying it would hand the retry a fresh attempt budget."""
    w = note_start_failed(watch, now_ms, backoff_s=backoff_s, backoff_max_s=backoff_max_s)
    return StartWatch(w.began_at_ms, None, w.manual_stop_for, w.attempts, w.next_try_ms)


def note_start_failed(watch: StartWatch, now_ms, *, backoff_s: float = AUTOSTART_BACKOFF_S,
                      backoff_max_s: float = AUTOSTART_BACKOFF_MAX_S) -> StartWatch:
    """Record a failed start and schedule the next attempt. Pure; EXPONENTIAL, capped.

    Capped because the backoff is bounded by `max_attempts` anyway, and an uncapped doubling would put
    the last permitted attempt hours away — long enough that the session it is retrying has ended, so
    the retry would land on nothing while the record still says a retry is pending."""
    n = int(watch.attempts) + 1
    try:
        delay = min(float(backoff_s) * (2 ** (n - 1)), float(backoff_max_s))
        nxt = float(now_ms) + delay * 1000.0
    except (TypeError, ValueError):
        nxt = None
    return StartWatch(watch.began_at_ms, watch.fired_for, watch.manual_stop_for, n, nxt)


def note_manual_stop(watch: StartWatch) -> StartWatch:
    """The operator stopped the stream by hand. Pure.

    MANUAL INTENT WINS, and it is scoped to THIS session: `manual_stop_for` is keyed by `began_at_ms`,
    so the next therapy session auto-starts normally. A global "never again" flag would silently
    disable the feature for every future night on one click."""
    return StartWatch(watch.began_at_ms, watch.fired_for, watch.began_at_ms, watch.attempts,
                      watch.next_try_ms)


def note_started(watch: StartWatch) -> StartWatch:
    """A start succeeded. Pure. Clears the backoff, and — since eager start — KEEPS the attempt
    count: the budget is per-SESSION and a false start spends from it after `note_started` has
    already run, so zeroing here would hand every started-then-discarded stream a fresh budget and
    unbound exactly the churn the budget exists to bound. (It zeroed before retention existed, when
    nothing could spend an attempt after a successful start.)"""
    return StartWatch(watch.began_at_ms, watch.began_at_ms, watch.manual_stop_for,
                      watch.attempts, None)


def boot_start_state(rows, fired_for, manual_stop_for, now_ms,
                     max_age_s: float = CATCH_UP_MAX_AGE_S):
    """`(StartWatch, reason)` — the auto-start state a JUST-STARTED daemon should begin with. Pure.

    The mirror of `boot_state`: that one asks "did an end happen that nobody harvested", this one asks
    "is a session still running that nobody is recording". A reboot during therapy is precisely when
    the stream is NOT running (the daemon that held it died), so this is the case with the most to
    recover — and it reuses the same journal rows and the same 24 h bound.

    `last_therapy_end` returning `ended=False` with a non-empty journal is exactly the in-therapy
    signal here, which is why that function returns the pair rather than a bare stamp."""
    rows = list(rows or [])
    if not rows:
        return StartWatch(None, fired_for, manual_stop_for), "no journal rows"
    end_ms, ended = last_therapy_end(rows)
    if ended or rows[-1][1] != "Therapy":
        return StartWatch(None, fired_for, manual_stop_for), "the journal does not end in therapy"
    # Walk back to the first row of this uninterrupted Therapy run — the session's real start, not the
    # last row's stamp. The session KEY is the first sighting (attempts, fired_for and manual intent
    # are all scoped by it), so re-keying at every boot would hand each reboot a fresh budget.
    began = rows[-1][0]
    for ms, fg in reversed(rows):
        if fg != "Therapy":
            break
        began = ms
    try:
        age = (float(now_ms) - float(rows[-1][0])) / 1000.0
    except (TypeError, ValueError):
        return StartWatch(None, fired_for, manual_stop_for), "unusable timestamps"
    if age < 0:
        return (StartWatch(None, fired_for, manual_stop_for),
                "the journal's last row is in the future — clock disagreement, not a live session")
    if age > float(max_age_s):
        return (StartWatch(None, fired_for, manual_stop_for),
                f"the journal's last row is {age / 3600.0:.1f}h old; it does not describe now")
    return (StartWatch(began, fired_for, manual_stop_for),
            f"therapy appears to be running (began {(float(now_ms) - float(began)) / 60000.0:.0f} min ago)")
