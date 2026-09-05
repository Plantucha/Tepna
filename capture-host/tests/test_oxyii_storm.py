# tepna-capture — tests/test_oxyii_storm.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The O2Ring restart-STORM policy (capture.oxyii_restart_storm / oxyii_storm_hold_s). It exists because
# on the night of 2026-09-04→05 the ring restarted its recording session 61 times in 30 minutes —
# buzzing on the owner's finger every ~40 s — and stopped the moment the daemon left it alone; the
# 2026-08-28 night had 520. A quiet night has 1–2 restarts, hours apart. The policy's job is to tell those
# two shapes apart from the restart times alone and to back off ESCALATINGLY when it sees the first.

import capture


N, WIN, HOLD, HOLD_MAX, MEM = (capture._OXYII_STORM_N, capture._OXYII_STORM_WINDOW_S, capture._OXYII_STORM_HOLD_S,
                               capture._OXYII_STORM_HOLD_MAX_S, capture._OXYII_STORM_MEMORY_S)


def test_constants_are_the_replayed_choice():
    """Pinned so a retune is a deliberate edit here, with the replay below re-run against it."""
    assert (N, WIN, HOLD, HOLD_MAX, MEM) == (4, 120.0, 900.0, 7200.0, 3 * 3600.0)


def test_a_quiet_night_never_storms():
    """1–2 restarts hours apart — every night from 09-01 to 09-04 except the bad one."""
    restarts = [0.0, 4 * 3600.0]
    for t in restarts:
        storm, recent = capture.oxyii_restart_storm([r for r in restarts if r <= t], t)
        assert storm is False
    assert recent == [4 * 3600.0]                    # the earlier one has aged out of the window


def test_four_restarts_inside_the_window_is_a_storm_and_three_is_not():
    t = [0.0, 40.0, 80.0]
    assert capture.oxyii_restart_storm(t, 80.0) == (False, t)
    assert capture.oxyii_restart_storm(t + [119.0], 119.0) == (True, t + [119.0])


def test_the_window_prunes_from_the_front():
    """The 4th restart 121 s after the 1st does NOT count the 1st — the tuple returns what it kept, and the
    caller stores exactly that, so the pruned list is what the next evaluation sees."""
    storm, recent = capture.oxyii_restart_storm([0.0, 40.0, 80.0, 121.0], 121.0)
    assert storm is False and recent == [40.0, 80.0, 121.0]


def test_hold_escalates_per_prior_storm_and_caps():
    now = 10 * 3600.0
    assert capture.oxyii_storm_hold_s([], now) == 900.0
    assert capture.oxyii_storm_hold_s([now - 1000], now) == 1800.0
    assert capture.oxyii_storm_hold_s([now - 3000, now - 1000], now) == 3600.0
    assert capture.oxyii_storm_hold_s([now - 5000, now - 3000, now - 1000], now) == 7200.0
    assert capture.oxyii_storm_hold_s([now - 7000, now - 5000, now - 3000, now - 1000], now) == 7200.0  # cap


def test_storm_memory_expires_back_to_the_base_hold():
    """A storm at 03:00 must not make a 22:00 storm the next evening start at 30 min."""
    now = 10 * 3600.0
    assert capture.oxyii_storm_hold_s([now - MEM - 1], now) == 900.0
    assert capture.oxyii_storm_hold_s([now - MEM], now) == 1800.0        # boundary is inclusive


def _replay(restart_gaps_s, *, t0=0.0):
    """Drive the policy the way run_oxyii does, over a ring that restarts on the given cadence WHILE WE
    ARE CONNECTED and behaves itself once we leave. Returns (restarts we were present for, storms, held s).
    The bad night's shape is a ring that restarts every ~40 s for as long as the daemon polls it."""
    t, seen, storms, n_storms, held, restarts, hold_until = t0, 0, [], 0, 0.0, [], None
    for gap in restart_gaps_s:
        t += gap
        if hold_until is not None and t < hold_until:
            continue                                  # the daemon is holding off — the ring does not buzz
        if hold_until is not None:
            hold_until, restarts = None, []          # hold over: resume, count from zero
        seen += 1
        storm, restarts = capture.oxyii_restart_storm(restarts + [t], t)
        if storm:
            h = capture.oxyii_storm_hold_s(storms, t)
            storms = [s for s in storms if t - s <= MEM] + [t]
            hold_until, restarts, held, n_storms = t + h, [], held + h, n_storms + 1
    return seen, n_storms, held


def test_replay_the_09_05_night_61_restarts_every_40_s():
    """61 restarts over ~30 min (02:27–02:57). Under the policy we are present for the first 4, leave
    for 15 min, come back, see 4 more, leave for 30 min — 8 buzzes instead of 61 and the second hold
    outlasts the storm."""
    seen, storms, held = _replay([40.0] * 61)
    assert (seen, storms) == (8, 2)
    assert held == 900.0 + 1800.0


def test_replay_the_08_28_night_holds_escalate_to_the_cap():
    """520 restarts at ~40 s spacing (≈5.8 h). Flat 15-min holds would have declared 14 storms; the
    escalation reaches the 2 h cap by the 4th storm. The 3-h memory then lets the ladder fall back
    (storms 5–7 re-climb from 30 min) — so a storm that outlasts the memory is still held for most of its
    length, and the ring buzzes 7 storms' worth (28), not 520."""
    seen, storms, held = _replay([40.0] * 520)
    assert seen == 7 * N and storms == 7
    assert held == (900.0 + 1800.0 + 3600.0 + 7200.0) + (1800.0 + 3600.0 + 3600.0)
    assert held > 520 * 40.0                            # held longer than the storm itself lasted


def test_replay_a_quiet_night_is_untouched():
    """Two restarts in a night (e.g. finger on, finger off and on) — no hold, both seen: the policy costs a
    normal night nothing."""
    assert _replay([3 * 3600.0, 2 * 3600.0]) == (2, 0, 0.0)
