# tepna-capture — tests/test_oxy_rec_axis.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The RECORDING axis (OxyRecEngine) — OXYII-PRESENCE-MODEL §1-MEASURED / DAT-AUTO-HARVEST §3–§5.
# Independent of the LINK axis by construction; every rule here carries the measurement that ratified it
# (1.33 M corpus frames; 40 doff→close events; the 18311 ≡ 18311 trailer cross-check).
import pytest
from oxy_lifecycle import (
    LEGAL_TRANSITIONS,
    REC_LEGAL_TRANSITIONS,
    InvalidTransition,
    OxyRecEngine,
    OxyRecState,
    OxyState,
)


def _eng(**kw):
    kw.setdefault("device_id", "O2R-01")
    kw.setdefault("session_id", "20260824T220000Z-abcdef")
    kw.setdefault("mono", lambda: 42.0)
    kw.setdefault("wall", lambda: "2026-08-24T22:00:00+00:00")
    return OxyRecEngine(**kw)


# ── the two axes are DISJOINT — the invariant everything else leans on ────────────────────────────────

def test_the_two_state_vocabularies_share_no_value():
    """An axis-blind OXYLIFE reader must not be able to confuse a rec row with a link row: the enum
    VALUES are disjoint, so even before the axis column is consulted the states cannot collide."""
    link = {s.value for s in OxyState}
    rec = {s.value for s in OxyRecState}
    assert not (link & rec)


def test_no_cross_axis_edge_exists_in_either_table():
    """Owner spec §3: the dimensions stay independent. Neither table may reference the other's states."""
    for frm, to in LEGAL_TRANSITIONS:
        assert isinstance(frm, OxyState) and isinstance(to, OxyState)
    for frm, to in REC_LEGAL_TRANSITIONS:
        assert isinstance(frm, OxyRecState) and isinstance(to, OxyRecState)


# ── start-up honesty: UNKNOWN converts to a conclusion only on EVIDENCE ───────────────────────────────

def test_a_single_zero_reading_is_not_recording():
    eng = _eng()
    ts = eng.observe_duration(0)
    assert [t.new for t in ts] == [OxyRecState.NOT_RECORDING]
    assert ts[0].axis == "rec"


def test_a_single_positive_reading_stays_unknown_two_increasing_readings_are_recording():
    """A lone dur>0 cannot distinguish an advancing counter from a stale one — §5 forbids turning a
    non-observation into a conclusion, so RECORDING needs two strictly increasing readings."""
    eng = _eng()
    assert eng.observe_duration(10434) == []
    assert eng.state is OxyRecState.UNKNOWN
    ts = eng.observe_duration(10435)
    assert [t.new for t in ts] == [OxyRecState.RECORDING]
    assert "10434→10435" in ts[0].reason


def test_a_flat_positive_counter_never_becomes_recording():
    """The stale-counter control: the same dur>0 forever must hold UNKNOWN, not drift to RECORDING."""
    eng = _eng()
    for _ in range(5):
        assert eng.observe_duration(500) == []
    assert eng.state is OxyRecState.UNKNOWN


# ── the session lifecycle as the corpus measured it ───────────────────────────────────────────────────

def test_not_recording_to_recording_when_the_counter_leaves_zero():
    eng = _eng()
    eng.observe_duration(0)
    ts = eng.observe_duration(1)
    assert [t.new for t in ts] == [OxyRecState.RECORDING]


def test_not_recording_holds_through_repeated_zeros():
    """The docked-idle steady state (16k+ zero frames measured 2026-08-24): repeated 0 is NO event."""
    eng = _eng()
    eng.observe_duration(0)
    for _ in range(4):
        assert eng.observe_duration(0) == []
    assert eng.state is OxyRecState.NOT_RECORDING


def test_unknown_with_a_decreasing_counter_stays_unknown():
    """A reconnect seeing a LOWER value than an earlier UNKNOWN-held reading is still not evidence of
    anything — no close was observed (prev was captured under the same ignorance)."""
    eng = _eng()
    eng.observe_duration(500)
    assert eng.observe_duration(400) == []
    assert eng.state is OxyRecState.UNKNOWN


def test_backward_step_is_end_candidate_and_records_the_close_value():
    """The 2026-08-23 night: counter at 18311 at close, trailer later stored 18311. closed_at_duration
    is what duration_check.observed_s reads — it must be the LAST pre-reset value, not the reset one."""
    eng = _eng()
    eng.observe_duration(0)
    eng.observe_duration(18310)
    eng.observe_duration(18311)
    ts = eng.observe_duration(0)
    assert [t.new for t in ts] == [OxyRecState.END_CANDIDATE]
    assert eng.closed_at_duration == 18311
    assert "18311" in ts[0].reason


def test_backward_step_into_an_already_advancing_session_emits_two_transitions():
    """A reconnect gap can hide the 0: 18302 → 3 is one observation carrying two real events —
    the old session closed AND a new one is running. Both must journal, in order."""
    eng = _eng()
    eng.observe_duration(0)
    eng.observe_duration(18301)
    eng.observe_duration(18302)
    ts = eng.observe_duration(3)
    assert [t.new for t in ts] == [OxyRecState.END_CANDIDATE, OxyRecState.RECORDING]
    assert eng.closed_at_duration == 18302
    assert eng.state is OxyRecState.RECORDING


def test_end_candidate_holds_through_zeros_then_a_new_session_returns_to_recording():
    """The 2026-08-23 14:20/14:25 corpus pair: two real sessions five minutes apart. The candidate holds
    while the counter sits at 0, and re-donning starts a fresh RECORDING."""
    eng = _eng()
    eng.observe_duration(0)
    eng.observe_duration(100)
    eng.observe_duration(532)
    eng.observe_duration(0)                       # close (END_CANDIDATE)
    assert eng.state is OxyRecState.END_CANDIDATE
    for _ in range(3):
        assert eng.observe_duration(0) == []      # candidate held, not decayed by time
    ts = eng.observe_duration(5)
    assert [t.new for t in ts] == [OxyRecState.RECORDING]


# ── confirmation is the PULL's evidence, never the engine's own ───────────────────────────────────────

def test_confirm_end_agrees_within_the_measured_quantization():
    eng = _eng()
    eng.observe_duration(0); eng.observe_duration(200); eng.observe_duration(251)
    eng.observe_duration(0)
    ts = eng.confirm_end(251)
    assert [t.new for t in ts] == [OxyRecState.END_CONFIRMED]
    assert "251" in ts[0].reason


def test_confirm_end_tolerates_exactly_the_counter_quantization_and_no_more():
    """agrees = |stored − observed| ≤ 1 s, CITED to the ±1 s counter quantization
    (o2ring-duration-is-quantized) — not a chosen constant. ±1 confirms; ±2 must NOT."""
    eng1 = _eng()
    eng1.observe_duration(0); eng1.observe_duration(100); eng1.observe_duration(300)
    eng1.observe_duration(0)
    assert [t.new for t in eng1.confirm_end(301)] == [OxyRecState.END_CONFIRMED]
    eng2 = _eng()
    eng2.observe_duration(0); eng2.observe_duration(100); eng2.observe_duration(300)
    eng2.observe_duration(0)
    assert eng2.confirm_end(302) == []            # discrepancy: the CALLER records it; no fabricated agreement
    assert eng2.state is OxyRecState.END_CANDIDATE


def test_confirm_end_outside_end_candidate_is_a_noop():
    eng = _eng()
    assert eng.confirm_end(100) == []
    eng.observe_duration(0)
    assert eng.confirm_end(100) == []
    assert eng.state is OxyRecState.NOT_RECORDING


def test_after_confirmation_zero_is_not_recording_and_advance_is_recording():
    eng = _eng()
    eng.observe_duration(0); eng.observe_duration(10); eng.observe_duration(20)
    eng.observe_duration(0)
    eng.confirm_end(20)
    assert eng.state is OxyRecState.END_CONFIRMED
    ts = eng.observe_duration(0)
    assert [t.new for t in ts] == [OxyRecState.NOT_RECORDING]


def test_after_confirmation_an_advancing_counter_is_a_new_recording():
    eng = _eng()
    eng.observe_duration(0); eng.observe_duration(10); eng.observe_duration(20)
    eng.observe_duration(0)
    eng.confirm_end(20)
    ts = eng.observe_duration(4)
    assert [t.new for t in ts] == [OxyRecState.RECORDING]


# ── THE fleet trap, as a planted control: link loss is UNKNOWN, never NOT_RECORDING ───────────────────

def test_link_loss_moves_to_unknown_never_not_recording():
    """BLE loss must never read as 'recording ended' (owner spec §3/§11; the morning-of-2026-08-24
    misread class). The engine's answer to an unobservable ring is ignorance, stated as such."""
    eng = _eng()
    eng.observe_duration(0)
    eng.observe_duration(50)
    assert eng.state is OxyRecState.RECORDING
    ts = eng.observe_link_lost()
    assert [t.new for t in ts] == [OxyRecState.UNKNOWN]
    assert eng.state is not OxyRecState.NOT_RECORDING


def test_link_loss_forgets_the_counter_so_reconnect_starts_from_ignorance():
    """A stale prev across a reconnect would let ONE post-reconnect frame (lower than the pre-drop
    counter) fabricate an END_CANDIDATE for a close nobody observed. prev must not survive the drop."""
    eng = _eng()
    eng.observe_duration(0)
    eng.observe_duration(9000)
    eng.observe_link_lost()
    assert eng.prev_duration is None
    ts = eng.observe_duration(20)                 # reconnect: a lone positive reading
    assert ts == [] and eng.state is OxyRecState.UNKNOWN


def test_link_loss_while_already_unknown_is_silent():
    eng = _eng()
    assert eng.observe_link_lost() == []


# ── hygiene ───────────────────────────────────────────────────────────────────────────────────────────

def test_invalid_duration_inputs_are_ignored_not_conclusions():
    """None / negative / non-int must cause NO transition — a parse failure is a non-observation."""
    eng = _eng()
    for bad in (None, -1, "12", 3.5):
        assert eng.observe_duration(bad) == []
    assert eng.state is OxyRecState.UNKNOWN and eng.prev_duration is None


def test_rec_rows_carry_the_rec_axis_and_the_shared_row_shape():
    eng = _eng()
    (t,) = eng.observe_duration(0)
    parts = t.as_row().split(";")
    assert len(parts) == 9
    assert parts[2] == "rec_unknown" and parts[3] == "not_recording" and parts[8] == "rec"


def test_illegal_rec_transition_raises():
    eng = _eng()
    with pytest.raises(InvalidTransition):
        eng._to(OxyRecState.END_CONFIRMED, "forced")   # UNKNOWN → END_CONFIRMED is not a legal edge


def test_every_rec_state_is_reachable_and_unknown_is_reachable_at_runtime():
    """§5's 'UNKNOWN must be reachable at runtime, not only at boot': it is the TARGET of edges from
    every other state, and every non-start state is the target of at least one edge."""
    targets = {to for _, to in REC_LEGAL_TRANSITIONS}
    assert targets == set(OxyRecState) - {OxyRecState.UNKNOWN} | {OxyRecState.UNKNOWN}
    froms_to_unknown = {frm for frm, to in REC_LEGAL_TRANSITIONS if to is OxyRecState.UNKNOWN}
    assert froms_to_unknown == set(OxyRecState) - {OxyRecState.UNKNOWN}
