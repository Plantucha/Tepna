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

    deaf_rounds = 2                       # its documented default
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
