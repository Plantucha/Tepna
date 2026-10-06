# tepna-capture — tests/test_bluez_wedge.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The PARTIAL wedge: bluez blind to one device while serving every other link.

The incident these pin is 2026-08-29/30 — the CPAP invisible for twelve hours while the H10 and the
O2Ring streamed throughout, hci0 enumerating 107 devices and never listing the CPAP, cured by a
32-second `bluetooth.service` restart. Therapy HAD run; ten EDF files were harvested the next day.
"""

from __future__ import annotations

import bluez_wedge as W

HOUR = 3600.0


def test_THE_2026_08_29_NIGHT_READS_AS_WEDGED():
    # Twelve hours of misses, radio demonstrably fine (other sensors streaming), and the machine had
    # been visible that same evening.
    verdict, why = W.wedge_verdict(absent_rounds=720, radio_healthy=True, last_seen_age_s=4 * HOUR)
    assert verdict == W.WEDGED
    assert "serves other links" in why


def test_A_DEAF_RADIO_IS_NOT_THIS_RUNGS_BUSINESS():
    """The structural point, and the reason this module exists as a SEPARATE predicate.

    `radio_looks_deaf` short-circuits on `connected_any` — correctly, for the failure it owns. A
    per-device wedge's signature is that everything else keeps working, so that predicate cannot
    fire on it, and this one must not fire on a whole-radio failure either. Complements, not a
    hierarchy: claiming a per-device wedge while the receiver is deaf would attribute a general
    failure to one device and spend a restart on the wrong evidence."""
    verdict, why = W.wedge_verdict(720, radio_healthy=False, last_seen_age_s=1 * HOUR)
    assert verdict == W.UNKNOWN
    assert "deafness rung" in why


def test_A_DEVICE_NEVER_SEEN_IS_UNKNOWN_NOT_ABSENT():
    # No prior evidence it was ever reachable, so its absence says nothing about bluez. UNKNOWN must
    # never be folded into a verdict — that is the honest-absence rule this repo keeps relearning.
    verdict, why = W.wedge_verdict(720, True, last_seen_age_s=None)
    assert verdict == W.UNKNOWN and "never seen" in why


def test_A_DEVICE_GONE_FOR_DAYS_IS_ABSENT_NOT_WEDGED():
    # Someone took it away. Restarting bluetoothd for a device that is not in the building drops live
    # links to fix nothing.
    verdict, _why = W.wedge_verdict(720, True, last_seen_age_s=30 * HOUR)
    assert verdict == W.ABSENT


def test_A_FEW_MISSES_ARE_NOT_EVIDENCE():
    assert W.wedge_verdict(3, True, 600)[0] == W.WATCHING


# ── the design decisions, pinned ──────────────────────────────────────────────────────────────────
def test_THIS_RUNG_DEMANDS_MORE_EVIDENCE_THAN_THE_DEAFNESS_RUNG():
    """Same recovery action, opposite blast radius, so the bars must differ — and this asserts the
    direction rather than the number.

    `radio_looks_deaf` fires after 2 rounds and says so in its own docstring: the cost of being wrong
    there is "a bluetooth restart that drops nothing (nothing was connected)". Here a restart drops
    precisely the links that ARE working, including an on-body sensor mid-recording. Copying the
    threshold across would be the reasoning error, not the number itself."""
    from capture import radio_looks_deaf  # the sibling rung, for the comparison this test is about

    deaf_rounds = 2  # its documented default
    assert radio_looks_deaf(0, False, deaf_rounds, deaf_rounds) is True
    assert W.MIN_ABSENT_ROUNDS > deaf_rounds, (
        "the partial-wedge rung must require MORE consecutive evidence than the deafness rung, "
        "because its recovery drops live links and the deafness rung's drops nothing"
    )
    # ...and at the deafness rung's threshold, this one is still only watching.
    assert W.wedge_verdict(deaf_rounds, True, 600)[0] == W.WATCHING


def test_AN_EXHAUSTED_BUDGET_DOES_NOT_MAKE_A_WEDGED_NIGHT_LOOK_HEALTHY():
    """The verdict and the permission are separate on purpose.

    Folding them would mean that once the budget ran out, a wedged night reported as fine — an
    absence produced by our own bookkeeping rather than by the world. What must happen instead is
    that we still SAY wedged and decline to act."""
    verdict, _ = W.wedge_verdict(720, True, 1 * HOUR)
    assert verdict == W.WEDGED
    ok, why = W.restart_allowed(W.MAX_RESTARTS_PER_DAY)
    assert ok is False and "budget spent" in why
    # The verdict is unchanged by the budget — asserted directly, because the coupling is the bug.
    assert W.wedge_verdict(720, True, 1 * HOUR)[0] == W.WEDGED


def test_THE_BUDGET_ALLOWS_ITS_FIRST_AND_LAST_SPEND():
    assert W.restart_allowed(0)[0] is True
    assert W.restart_allowed(W.MAX_RESTARTS_PER_DAY - 1)[0] is True
    assert W.restart_allowed(W.MAX_RESTARTS_PER_DAY + 5)[0] is False


# ── boundaries ────────────────────────────────────────────────────────────────────────────────────
def test_THE_ROUND_THRESHOLD_IS_INCLUSIVE():
    assert W.wedge_verdict(W.MIN_ABSENT_ROUNDS - 1, True, 600)[0] == W.WATCHING
    assert W.wedge_verdict(W.MIN_ABSENT_ROUNDS, True, 600)[0] == W.WEDGED


def test_THE_LAST_SEEN_WINDOW_BOUNDARY_FAVOURS_ABSENCE():
    # Exactly at the window is still wedged; past it, absent. Stated so the direction is deliberate
    # rather than an artifact of `>` vs `>=`.
    assert W.wedge_verdict(720, True, W.MAX_LAST_SEEN_AGE_S)[0] == W.WEDGED
    assert W.wedge_verdict(720, True, W.MAX_LAST_SEEN_AGE_S + 1)[0] == W.ABSENT


def test_A_ZERO_AGE_SIGHTING_IS_STILL_A_SIGHTING():
    # `last_seen_age_s == 0` is falsy; a `if not last_seen_age_s` check would misread it as never-seen.
    assert W.wedge_verdict(720, True, 0.0)[0] == W.WEDGED


# ── did the device come back? the only thing that separates "off" from "wedged" ───────────────────
T0 = 1_788_000_000_000


def test_A_DEVICE_THAT_ANSWERS_AFTER_THE_RESTART_WAS_A_WEDGE():
    """The 2026-08-29 shape: the CPAP returned 32 s after `bluetooth.service` restarted. That night
    must stay UNKNOWN for therapy — a wedge tells us nothing about whether the machine ran."""
    out, why = W.recovery_outcome(T0, [(T0 + 32_000, True)])
    assert out == W.RETURNED and "32s" in why


def test_A_DEVICE_THAT_NEVER_ANSWERS_IS_WHAT_LICENSES_A_ZERO():
    out, _ = W.recovery_outcome(T0, [(T0 + 60_000, False), (T0 + 300_000, False)])
    assert out == W.NOT_RETURNED


def test_A_WINDOW_NOBODY_POLLED_IS_UNKNOWN_NOT_A_NEGATIVE():
    """The assertion the whole design turns on.

    NOT_RETURNED is the state that would license reporting ZERO therapy for a night. Concluding it
    from "we stopped polling" would fabricate a machine-off verdict out of our own silence — the
    exact failure this module refuses everywhere else. No observation is not a negative."""
    out, why = W.recovery_outcome(T0, [])
    assert out == W.UNKNOWN and out != W.NOT_RETURNED
    assert "nobody looked" in why


def test_ASKING_BEFORE_THE_WINDOW_ELAPSES_ANSWERS_PENDING_NOT_ABSENT():
    out, _ = W.recovery_outcome(T0, [(T0 + 1_000, False)], now_ms=T0 + 60_000)
    assert out == W.PENDING


def test_OBSERVATIONS_OUTSIDE_THE_WINDOW_ARE_NOT_EVIDENCE():
    # A poll from before the restart, or long after the window, says nothing about whether THIS
    # intervention worked. Counting either would attribute an unrelated success to the rung.
    stale = [(T0 - 60_000, True), (T0 + W.RECOVERY_WINDOW_S * 1000 + 60_000, True)]
    out, _ = W.recovery_outcome(T0, stale)
    assert out == W.UNKNOWN, "an out-of-window poll was treated as a recovery"


def test_A_TORN_OBSERVATION_IS_SKIPPED_NOT_GUESSED():
    out, _ = W.recovery_outcome(T0, [("bad", True), (None,), (T0 + 5_000, True)])
    assert out == W.RETURNED


def test_THE_WINDOW_IS_GENEROUS_BECAUSE_ERRING_SHORT_FABRICATES_AN_ABSENCE():
    # The one measured recovery took 32 s. A window that expires before a slow re-advertise turns a
    # recovering device into a "machine off" — the one direction that produces a false number.
    assert W.RECOVERY_WINDOW_S >= 300.0


# ── the fire journal ──────────────────────────────────────────────────────────────────────────────
def test_A_FIRE_ROUND_TRIPS_THROUGH_THE_JOURNAL():
    text = "fired_ms;device;reason;error_class\n" + W.fire_row(T0, "cpap", "missed 20 rounds", "BleakError")
    rows = W.parse_fires(text)
    assert rows == [{"fired_ms": T0, "device": "cpap", "reason": "missed 20 rounds", "error_class": "BleakError"}]


def test_A_SEMICOLON_IN_A_REASON_CANNOT_BREAK_THE_COLUMNS():
    # The reason is free text built from a verdict string. A stray delimiter would shift every later
    # column, so it is squeezed rather than quoted — a mangled field is recoverable, a mangled row
    # count is not.
    row = W.fire_row(T0, "cpap", "seen 5 min ago; radio fine", None)
    assert row.count(";") == 3
    assert W.parse_fires(row)[0]["reason"] == "seen 5 min ago, radio fine"


def test_A_TORN_JOURNAL_LINE_IS_SKIPPED():
    text = W.fire_row(T0, "cpap", "a", None) + "\n1788000\n" + W.fire_row(T0 + 5, "cpap", "b", None)
    assert [r["fired_ms"] for r in W.parse_fires(text)] == [T0, T0 + 5]


def test_FIRES_COME_BACK_OLDEST_FIRST_WHATEVER_ORDER_THEY_WERE_WRITTEN():
    text = W.fire_row(T0 + 100, "cpap", "b", None) + "\n" + W.fire_row(T0, "cpap", "a", None)
    assert [r["reason"] for r in W.parse_fires(text)] == ["a", "b"]


def test_AN_UNUSABLE_FIRE_TIMESTAMP_IS_UNKNOWN_NOT_A_CRASH():
    # A torn journal line can yield a non-numeric timestamp. The answer is UNKNOWN — never
    # NOT_RETURNED, which would license a zero off a row we could not even read.
    for bad in (None, "not-a-time", object()):
        out, _ = W.recovery_outcome(bad, [(T0, True)])
        assert out == W.UNKNOWN


# ══ A KEY REJECTION IS NOT A WEDGE (2026-10-05) ════════════════════════════════════════════════════
# The AS11 refused the stored key from 10:01:17 and the watchdog answered with TWO BlueZ restarts and an
# adapter hand-off to hci1 — remedies against a radio that was never broken. The verdict could not say
# "the device answered and said no", so the counting rules, which infer a fault from SILENCE, decided a
# case in which the device had spoken.


def test_a_key_rejection_is_NOT_wedged_whatever_the_counts_say():
    """The streak, the radio and the recency all point at WEDGED — and the verdict must still refuse,
    because a named key rejection is proof the device answered. This is the case that cost two BlueZ
    restarts and a ladder hand-off on 2026-10-05, so the inputs are that night's: a long streak, other
    links healthy, the machine seen minutes ago."""
    verdict, why = W.wedge_verdict(27, radio_healthy=True, last_seen_age_s=600.0, fault_kind=W.KEY_REJECTED_FAULT)
    assert verdict == W.KEY_REJECTED, (verdict, why)
    # The reason must say what to DO — a verdict a reader cannot act on sends them back to the journal.
    assert "re-pair" in why, why
    # ⚠️ AND IT MUST NOT CLAIM A WEDGE in any wording: `restart_allowed` is consulted on WEDGED alone,
    # so a verdict string that merely reads differently while still being WEDGED would fire the radio.
    assert verdict != W.WEDGED


def test_the_same_counts_WITHOUT_a_named_fault_still_wedge():
    """The control, and the reason this is not a weakening: with no fault kind the verdict is unchanged,
    so the 2026-08-29 partial wedge this module exists for still fires. A fix that silenced the rung in
    general would trade one invisible failure for another."""
    verdict, _ = W.wedge_verdict(27, radio_healthy=True, last_seen_age_s=600.0)
    assert verdict == W.WEDGED
    assert W.wedge_verdict(27, True, 600.0, fault_kind=None)[0] == W.WEDGED
    # An unrecognised kind is NOT key-rejected: the taxonomy returns None for the undiscriminated
    # bucket, and only the named kind may change the remedy.
    assert W.wedge_verdict(27, True, 600.0, fault_kind="something-else")[0] == W.WEDGED


def test_key_rejected_constant_matches_as11_pull():
    """TWO SPELLINGS OF ONE STRING, PINNED. `bluez_wedge` deliberately does not import `as11_pull`: it is
    the pure watchdog policy, imported by the watchdog itself, and a protocol module in its dependency
    list is a cycle waiting to be written. The cost of that choice is two literals that must agree, and
    the repo's answer to that cost is a test, not trust
    (`test_psftp_mtu_char_literal_matches_polar_psftp` is the same idiom). If one is renamed alone, the
    wedge silently resumes restarting BlueZ against a key fault — the exact defect this unit fixes.

    ⚠️ A THIRD SPELLING ARRIVES WITH THE CARD (`cpap_live`, the pure monitor view), and this assertion
    must grow to three then. It is named here so the next unit cannot add a literal without the pin."""
    import as11_pull

    assert W.KEY_REJECTED_FAULT == as11_pull.KEY_REJECTED


def test_the_reason_lines_CONVERT_the_age_correctly():
    """CI's gate named FOUR survivors on the arithmetic inside these two reason strings
    (`/3600.0` → `*3600.0`, `/3601.0`; `/60.0` → `*60.0`, `/61.0`) — every existing test here asserts a
    VERDICT and at most a substring of the reason, so nothing ever read the NUMBER.

    ⚠️ It is not cosmetic, and that is why it is worth a test rather than an excuse: both lines exist to
    tell an operator HOW LONG the device has been gone, which is the single fact separating "bluez lost
    it" from "it is not here" — the distinction this whole module is built to make. A reason that says
    `0.0 h` for a seven-hour absence, or `36000 min` for ten minutes, inverts the judgement it is there
    to support. Exact strings, because a rounded wrong number still reads as plausible.

    🔴 THE INPUTS ARE CHOSEN TO SEPARATE THE DIVISORS, and my first attempt did not. With
    `7.2 * 3600` the `/3601.0` mutant prints 7.198 → `"7.2"`, and with 600 s the `/61.0` mutant prints
    9.84 → `"10"` — IDENTICAL after the format rounding, so two of the four survived a test written to
    kill all four. An off-by-one divisor needs an age large enough for the error to clear the printed
    precision: 200 h separates `.1f` (200.0 vs 199.9), and 1 h separates `.0f` (60 vs 59).
    A test whose inputs cannot distinguish the mutation reports success about arithmetic it never
    examined."""
    # ABSENT: 200 h, far past the 6 h window. /3601 prints 199.9 — separated at `.1f`.
    verdict, why = W.wedge_verdict(99, radio_healthy=True, last_seen_age_s=200.0 * 3600.0)
    assert verdict == W.ABSENT, (verdict, why)
    assert "last seen 200.0 h ago" in why, why
    # WEDGED: seen 1 h ago, inside the window. /61 prints 59 — separated at `.0f`.
    verdict, why = W.wedge_verdict(99, radio_healthy=True, last_seen_age_s=3600.0)
    assert verdict == W.WEDGED, (verdict, why)
    assert "seen 60 min ago" in why, why
