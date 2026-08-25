# tepna-capture — tests/test_cpap_supervisor.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Exhaustive branch coverage for the pure AS11 session-detection state machine. No hardware,
# no clock, no I/O — every Observation is hand-built and time is passed in via host_ms.

import cpap_supervisor as S
from cpap_supervisor import (
    CPAPSessionSupervisor,
    Decision,
    Observation,
    SessionState,
    TherapyState,
)


def _obs(host_ms=1000, reachable=True, fg=None, use=None, mask=None):
    return Observation(
        host_ms=host_ms,
        reachable=reachable,
        fg_state=fg,
        last_therapy_use=use,
        mask_pressure=mask,
    )


# --- start (IDLE → ACTIVE) --------------------------------------------------------------


def test_start_on_fgstate_therapy_no_debounce():
    sup = CPAPSessionSupervisor()
    d = sup.observe(_obs(fg=TherapyState.THERAPY, use=100))
    assert sup.state == SessionState.ACTIVE
    assert d.transition == "start"
    assert d.action == "start_capture"
    assert d.trigger == "fgstate_therapy"
    assert d.confidence == "fgstate_only"  # no mask reading
    assert d.evidence["baseline_use"] == 100


def test_start_confidence_confirmed_when_mask_corroborates():
    sup = CPAPSessionSupervisor()
    d = sup.observe(_obs(fg=TherapyState.THERAPY, mask=8.0))
    assert d.confidence == "confirmed"


def test_start_confidence_fgstate_only_when_mask_below_threshold():
    sup = CPAPSessionSupervisor()
    d = sup.observe(_obs(fg=TherapyState.THERAPY, mask=0.5))
    assert d.confidence == "fgstate_only"


def test_idle_stays_idle_on_standby():
    sup = CPAPSessionSupervisor()
    d = sup.observe(_obs(fg=TherapyState.STANDBY))
    assert sup.state == SessionState.IDLE
    assert d.transition is None
    assert d.trigger == "idle_steady"
    assert d.confidence == "fgstate_only"


def test_idle_confidence_held_when_state_unread():
    sup = CPAPSessionSupervisor()
    d = sup.observe(_obs(fg=None))
    assert d.trigger == "idle_steady"
    assert d.confidence == "held"


# --- stop via device verdict (primary) --------------------------------------------------


def test_stop_on_device_verdict_advance():
    sup = CPAPSessionSupervisor()
    sup.observe(_obs(fg=TherapyState.THERAPY, use=100))
    d = sup.observe(_obs(host_ms=2000, fg=TherapyState.THERAPY, use=101))
    assert sup.state == SessionState.IDLE
    assert d.transition == "stop"
    assert d.action == "stop_capture"
    assert d.trigger == "device_verdict"
    assert d.confidence == "confirmed"


def test_verdict_fires_even_when_fgstate_unread():
    sup = CPAPSessionSupervisor()
    sup.observe(_obs(fg=TherapyState.THERAPY, use=100))
    d = sup.observe(_obs(host_ms=2000, fg=None, use=200))
    assert d.trigger == "device_verdict"
    assert sup.state == SessionState.IDLE


def test_verdict_not_fired_when_use_equal_baseline():
    sup = CPAPSessionSupervisor()
    sup.observe(_obs(fg=TherapyState.THERAPY, use=100))
    d = sup.observe(_obs(host_ms=2000, fg=TherapyState.THERAPY, use=100))
    assert sup.state == SessionState.ACTIVE
    assert d.trigger == "active_steady"


def test_verdict_skipped_when_baseline_none():
    # start with no readable use marker → baseline None → verdict path unavailable.
    sup = CPAPSessionSupervisor()
    sup.observe(_obs(fg=TherapyState.THERAPY, use=None))
    d = sup.observe(_obs(host_ms=2000, fg=TherapyState.THERAPY, use=500))
    assert sup.state == SessionState.ACTIVE
    assert d.trigger == "active_steady"


def test_verdict_skipped_when_current_use_none():
    sup = CPAPSessionSupervisor()
    sup.observe(_obs(fg=TherapyState.THERAPY, use=100))
    d = sup.observe(_obs(host_ms=2000, fg=TherapyState.THERAPY, use=None))
    assert sup.state == SessionState.ACTIVE
    assert d.trigger == "active_steady"


def test_active_steady_confidence_confirmed_with_mask():
    sup = CPAPSessionSupervisor()
    sup.observe(_obs(fg=TherapyState.THERAPY, use=100))
    d = sup.observe(_obs(host_ms=2000, fg=TherapyState.THERAPY, use=100, mask=9.0))
    assert d.confidence == "confirmed"


# --- stop via sustained-Standby fallback ------------------------------------------------


def test_sustained_standby_stop_after_debounce():
    sup = CPAPSessionSupervisor(stop_debounce_s=10.0)
    sup.observe(_obs(host_ms=0, fg=TherapyState.THERAPY, use=100))
    p = sup.observe(_obs(host_ms=1000, fg=TherapyState.STANDBY))
    assert p.trigger == "standby_pending"
    assert sup.state == SessionState.ACTIVE
    d = sup.observe(_obs(host_ms=11000, fg=TherapyState.STANDBY))  # 10 s elapsed
    assert d.transition == "stop"
    assert d.trigger == "sustained_standby"
    assert d.confidence == "corroborated"  # mask not pressurised
    assert sup.state == SessionState.IDLE


def test_sustained_standby_pending_below_debounce():
    sup = CPAPSessionSupervisor(stop_debounce_s=10.0)
    sup.observe(_obs(host_ms=0, fg=TherapyState.THERAPY, use=100))
    sup.observe(_obs(host_ms=1000, fg=TherapyState.STANDBY))
    d = sup.observe(_obs(host_ms=5000, fg=TherapyState.STANDBY))  # only 4 s
    assert d.trigger == "standby_pending"
    assert sup.state == SessionState.ACTIVE


def test_sustained_standby_stop_conflicted_when_mask_still_pressurised():
    sup = CPAPSessionSupervisor(stop_debounce_s=10.0)
    sup.observe(_obs(host_ms=0, fg=TherapyState.THERAPY, use=100))
    sup.observe(_obs(host_ms=1000, fg=TherapyState.STANDBY))
    d = sup.observe(_obs(host_ms=20000, fg=TherapyState.STANDBY, mask=7.0))
    assert d.trigger == "sustained_standby"
    assert d.confidence == "conflicted"


def test_standby_blip_then_therapy_resets_run():
    # A brief mask-off (SmartStop flicker) must NOT close the session.
    sup = CPAPSessionSupervisor(stop_debounce_s=10.0)
    sup.observe(_obs(host_ms=0, fg=TherapyState.THERAPY, use=100))
    sup.observe(_obs(host_ms=1000, fg=TherapyState.STANDBY))  # blip starts
    sup.observe(_obs(host_ms=2000, fg=TherapyState.THERAPY, use=100))  # mask back on
    # a later Standby starts a FRESH run, so it is pending again, not immediately stopped.
    d = sup.observe(_obs(host_ms=3000, fg=TherapyState.STANDBY))
    assert d.trigger == "standby_pending"
    assert sup.state == SessionState.ACTIVE


# --- unreachable / unreadable holds -----------------------------------------------------


def test_unreachable_holds_idle():
    sup = CPAPSessionSupervisor()
    d = sup.observe(_obs(reachable=False))
    assert sup.state == SessionState.IDLE
    assert d.transition is None
    assert d.trigger == "unreachable_hold"
    assert d.confidence == "held"


def test_unreachable_holds_active_session_open():
    sup = CPAPSessionSupervisor()
    sup.observe(_obs(fg=TherapyState.THERAPY, use=100))
    d = sup.observe(_obs(host_ms=2000, reachable=False))
    assert sup.state == SessionState.ACTIVE  # BLE loss ≠ therapy end
    assert d.trigger == "unreachable_hold"


def test_unreachable_breaks_standby_run():
    sup = CPAPSessionSupervisor(stop_debounce_s=10.0)
    sup.observe(_obs(host_ms=0, fg=TherapyState.THERAPY, use=100))
    sup.observe(_obs(host_ms=1000, fg=TherapyState.STANDBY))  # run started
    sup.observe(_obs(host_ms=2000, reachable=False))  # run broken
    # standby resumes → fresh run (pending), not an immediate stop despite wall time passing.
    d = sup.observe(_obs(host_ms=15000, fg=TherapyState.STANDBY))
    assert d.trigger == "standby_pending"
    assert sup.state == SessionState.ACTIVE


def test_active_state_unreadable_holds():
    sup = CPAPSessionSupervisor()
    sup.observe(_obs(fg=TherapyState.THERAPY, use=100))
    d = sup.observe(_obs(host_ms=2000, fg=None, use=100))  # reachable, FGState InvalidObject
    assert sup.state == SessionState.ACTIVE
    assert d.trigger == "state_unreadable_hold"
    assert d.confidence == "held"


def test_active_state_unreadable_resets_standby_run():
    sup = CPAPSessionSupervisor(stop_debounce_s=10.0)
    sup.observe(_obs(host_ms=0, fg=TherapyState.THERAPY, use=100))
    sup.observe(_obs(host_ms=1000, fg=TherapyState.STANDBY))  # run started
    sup.observe(_obs(host_ms=2000, fg=None, use=100))  # unreadable → run dropped
    d = sup.observe(_obs(host_ms=15000, fg=TherapyState.STANDBY))
    assert d.trigger == "standby_pending"


# --- journalling seam -------------------------------------------------------------------


def test_journal_receives_transitions_only_by_default():
    seen = []
    sup = CPAPSessionSupervisor(journal=seen.append)
    sup.observe(_obs(fg=TherapyState.STANDBY))  # idle_steady, no transition → not journalled
    sup.observe(_obs(host_ms=2000, fg=TherapyState.THERAPY, use=1))  # start → journalled
    assert [d.transition for d in seen] == ["start"]


def test_journal_every_captures_non_transitions():
    seen = []
    sup = CPAPSessionSupervisor(journal=seen.append, journal_every=True)
    sup.observe(_obs(fg=TherapyState.STANDBY))
    sup.observe(_obs(host_ms=2000, reachable=False))
    assert len(seen) == 2
    assert all(d.transition is None for d in seen)


def test_no_journal_sink_is_fine():
    sup = CPAPSessionSupervisor()  # journal None
    sup.observe(_obs(fg=TherapyState.THERAPY, use=1))
    assert sup.state == SessionState.ACTIVE


# --- Decision.as_row (house journal contract) -------------------------------------------


def test_as_row_blanks_none_and_renders_values():
    sup = CPAPSessionSupervisor()
    start = sup.observe(_obs(host_ms=1000, fg=TherapyState.THERAPY, use=100, mask=8.0))
    row = start.as_row()
    cells = row.split(";")
    assert len(cells) == len(Decision.ROW_FIELDS)
    assert cells[0] == "1000"  # host_ms
    assert cells[2] == "active"  # state
    assert cells[3] == "start"  # transition
    assert cells[8] == "Therapy"  # fg_state
    assert cells[10] == "8.0"  # mask_pressure


def test_as_row_blank_for_missing_fields():
    sup = CPAPSessionSupervisor()
    d = sup.observe(_obs(reachable=False))  # fg/use/mask/baseline all None
    cells = d.as_row().split(";")
    # transition, action, fg_state, last_therapy_use, mask_pressure, baseline_use → blank
    assert cells[3] == ""  # transition
    assert cells[4] == ""  # action
    assert cells[8] == ""  # fg_state
    assert cells[11] == ""  # baseline_use


def test_reachable_flag_rendered():
    sup = CPAPSessionSupervisor()
    d = sup.observe(_obs(fg=TherapyState.STANDBY))
    cells = d.as_row().split(";")
    assert cells[7] == "True"  # reachable


# --- config knobs -----------------------------------------------------------------------


def test_custom_mask_threshold_respected():
    sup = CPAPSessionSupervisor(mask_therapy_min=5.0)
    d = sup.observe(_obs(fg=TherapyState.THERAPY, mask=4.0))  # below custom threshold
    assert d.confidence == "fgstate_only"


def test_module_default_constants_present():
    assert S.DEFAULT_STOP_DEBOUNCE_S == 40.0
    assert S.MASK_THERAPY_MIN_CMH2O == 2.0
