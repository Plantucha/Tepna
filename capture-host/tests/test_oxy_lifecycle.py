# tepna-capture — tests/test_oxy_lifecycle.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# OxyII G4 — the acquisition-lifecycle journal (CPAP P2 twin). Pure/clock-injected, 100% branch.
import pytest
from cpap_acq import FailureClass
from oxy_lifecycle import (
    LEGAL_TRANSITIONS,
    InvalidTransition,
    OxyLifecycle,
    OxyState,
    Transition,
)


def _lc(**kw):
    kw.setdefault("device_id", "O2R-01")
    kw.setdefault("session_id", "20260823T220000Z-abcdef")
    kw.setdefault("mono", lambda: 12.5)
    kw.setdefault("wall", lambda: "2026-08-23T22:00:00+00:00")
    return OxyLifecycle(**kw)


# ── the happy path + reachability ─────────────────────────────────────────────────────────────────────

def test_a_normal_night_walks_connect_to_live_to_pull_and_back():
    lc = _lc()
    assert lc.state is OxyState.NOT_SEEN            # the daemon starts not having seen the ring
    lc.to(OxyState.CONNECTING, "scan")
    lc.to(OxyState.CONNECTED, "auth+setup ok")
    lc.to(OxyState.LIVE, "first frame")
    lc.to(OxyState.PAUSED_FOR_PULL, "stored-session pull owns the link")
    lc.to(OxyState.PULLING, "autopull started")
    lc.to(OxyState.CONNECTING, "resume live after pull")
    assert [t.new for t in lc.history][:3] == [OxyState.CONNECTING, OxyState.CONNECTED, OxyState.LIVE]


def test_every_state_is_reachable_by_some_legal_edge():
    """R5: no stubbed state — every OxyState is the target of at least one legal transition (except the
    start state NOT_SEEN, which is where the lifecycle begins)."""
    targets = {to for _frm, to in LEGAL_TRANSITIONS}
    for s in OxyState:
        if s is OxyState.NOT_SEEN:
            continue
        assert s in targets, f"{s} is unreachable — a stubbed state"


def test_the_transition_carries_every_required_field():
    lc = _lc()
    t = lc.to(OxyState.CONNECTING, "scan")
    assert t.prev is OxyState.NOT_SEEN and t.new is OxyState.CONNECTING and t.reason == "scan"
    assert t.host_monotonic == 12.5 and t.host_wall == "2026-08-23T22:00:00+00:00"
    assert t.device_id == "O2R-01" and t.session_id == "20260823T220000Z-abcdef"
    assert t.failure is None


# ── illegal transitions ───────────────────────────────────────────────────────────────────────────────

def test_an_illegal_transition_raises_and_does_not_mutate():
    lc = _lc()
    lc.to(OxyState.CONNECTING, "scan")
    lc.to(OxyState.CONNECTED, "up")
    before = lc.state
    with pytest.raises(InvalidTransition, match=r"illegal.*transition.*->") as ei:
        lc.to(OxyState.PULLING, "cannot pull straight from connected")  # not a legal edge
    assert lc.state is before                       # NOT mutated
    assert len(lc.history) == 2                      # NO partial record appended
    assert ei.value.frm is OxyState.CONNECTED and ei.value.to is OxyState.PULLING


def test_can_reports_edge_legality():
    lc = _lc()
    assert lc.can(OxyState.CONNECTING) is True
    assert lc.can(OxyState.LIVE) is False            # NOT_SEEN -> LIVE is not an edge


# ── the failure taxonomy (shared cpap_acq.FailureClass, not forked) ─────────────────────────────────────

def test_a_recoverable_failure_during_live_is_an_interruption():
    lc = _lc(); lc.to(OxyState.CONNECTING, "s"); lc.to(OxyState.CONNECTED, "u"); lc.to(OxyState.LIVE, "f")
    t = lc.fail(FailureClass.TRANSPORT_FAILURE, "ring stalled mid-capture")
    assert t.new is OxyState.INTERRUPTED and t.failure is FailureClass.TRANSPORT_FAILURE
    assert lc.state is OxyState.INTERRUPTED


def test_a_permanent_failure_during_live_is_an_error():
    lc = _lc(); lc.to(OxyState.CONNECTING, "s"); lc.to(OxyState.CONNECTED, "u"); lc.to(OxyState.LIVE, "f")
    t = lc.fail(FailureClass.PROTOCOL_FAILURE, "unparseable frame")
    assert t.new is OxyState.ERROR and t.failure is FailureClass.PROTOCOL_FAILURE


def test_a_failure_outside_live_is_always_an_error_even_if_recoverable():
    lc = _lc(); lc.to(OxyState.CONNECTING, "s")
    t = lc.fail(FailureClass.TIMEOUT, "auth timed out")   # recoverable, but not during LIVE
    assert t.new is OxyState.ERROR


# ── as_row (the OXYLIFE.csv sidecar format) ─────────────────────────────────────────────────────────────

def test_as_row_is_semicolon_delimited_with_the_failure_label():
    lc = _lc(); lc.to(OxyState.CONNECTING, "s"); lc.to(OxyState.CONNECTED, "u"); lc.to(OxyState.LIVE, "f")
    t = lc.fail(FailureClass.STREAM_STALL, "no frames 30s")
    parts = t.as_row().split(";")
    assert parts[0] == "2026-08-23T22:00:00+00:00" and parts[1] == "12.500000"
    assert parts[2] == "live" and parts[3] == "interrupted" and parts[4] == "no frames 30s"
    assert parts[5] == "O2R-01" and parts[6] == "20260823T220000Z-abcdef"
    assert parts[7] == FailureClass.STREAM_STALL.label


def test_as_row_blanks_absent_fields_never_a_fabricated_zero():
    lc = OxyLifecycle(mono=lambda: 1.0, wall=lambda: "W")   # no device_id / session_id
    t = lc.to(OxyState.CONNECTING, "scan")                  # no failure
    parts = t.as_row().split(";")
    assert parts[5] == "" and parts[6] == "" and parts[7] == ""   # blank, not "None", not "0"


def test_status_state_is_the_current_label():
    lc = _lc()
    assert lc.status_state() == "not_seen"
    lc.to(OxyState.CONNECTING, "s")
    assert lc.status_state() == "connecting"


def test_default_clocks_are_real_and_injectable():
    """Cover the default mono/wall (no injection) — real host clocks, an ISO-8601 wall stamp."""
    lc = OxyLifecycle()
    t = lc.to(OxyState.CONNECTING, "scan")
    assert isinstance(t.host_monotonic, float) and "T" in t.host_wall
    # UTC-aware, not local-naive (Clock-Contract: the journal wall clock is unambiguous UTC). A naive
    # isoformat() carries no offset suffix, so this kills a `datetime.now()` (tz-dropped) regression.
    assert t.host_wall.endswith("+00:00"), "the default journal wall stamp must be UTC-aware"


def test_transition_is_immutable():
    t = Transition(OxyState.NOT_SEEN, OxyState.CONNECTING, "r", 1.0, "W", None, None)
    with pytest.raises(Exception):
        t.reason = "mutated"


def test_a_pull_or_recovery_before_any_connect_is_legal():
    """A stored-session pull or an adapter recovery can be in progress before the daemon ever connects."""
    lc = _lc()
    assert lc.can(OxyState.PAUSED_FOR_PULL) and lc.can(OxyState.RECOVERING)
    lc.to(OxyState.PAUSED_FOR_PULL, "pull owns the link at startup")
    assert lc.state is OxyState.PAUSED_FOR_PULL
