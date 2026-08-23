# tepna-capture — tests/test_cpap_acq.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# P2 of CPAP-ACQUISITION-HARDENING-AUDIT — the acquisition lifecycle state machine, provenance
# transition record, and failure taxonomy. Pure logic, injected clocks, 100% branch.
import cpap_acq
import pytest
from cpap_acq import AcqLifecycle, AcqState, FailureClass, InvalidTransition


def _lc(**kw):
    """A lifecycle with deterministic injected clocks — monotonic advances by 1.0 each read, wall is a
    fixed stamp, so every test is reproducible and every transition's timestamps are checkable."""
    ticks = iter(range(1000))
    kw.setdefault("mono", lambda: float(next(ticks)))
    kw.setdefault("wall", lambda: "2026-08-23T00:00:00+00:00")
    return AcqLifecycle(device_id="AS11-01", session_id="acq-1", **kw)


def _walk(lc, *states):
    """Drive a lifecycle through a legal path, returning the transitions."""
    return [lc.to(s, f"→{s.value}") for s in states]


# ── the legal-transition table is coherent ────────────────────────────────────────────────────────

def test_every_state_has_at_least_one_legal_edge():
    """A state with no legal transition in or out is dead — either an enum member nothing reaches or a
    typo. Every AcqState must appear in LEGAL_TRANSITIONS."""
    seen = set()
    for frm, to in cpap_acq.LEGAL_TRANSITIONS:
        seen.add(frm)
        seen.add(to)
    assert seen == set(AcqState), f"states not in any transition: {set(AcqState) - seen}"


def test_the_happy_path_connect_through_verified_is_legal():
    lc = _lc()
    ts = _walk(lc, AcqState.CONNECTING, AcqState.CONNECTED,
               AcqState.AUTHENTICATING, AcqState.AUTHENTICATED, AcqState.CONFIGURING, AcqState.READY,
               AcqState.SYNC_PENDING, AcqState.SYNCING, AcqState.VERIFIED)
    assert lc.state is AcqState.VERIFIED
    assert len(ts) == 9 == len(lc.history)
    assert [t.new for t in ts][-1] is AcqState.VERIFIED


def test_live_capture_path_is_legal():
    lc = _lc()
    _walk(lc, AcqState.CONNECTING, AcqState.CONNECTED, AcqState.AUTHENTICATING,
          AcqState.AUTHENTICATED, AcqState.CONFIGURING, AcqState.READY, AcqState.LIVE_CAPTURING)
    assert lc.state is AcqState.LIVE_CAPTURING


# ── invalid transitions are refused, not silently taken ───────────────────────────────────────────

def test_an_illegal_transition_raises_and_does_not_move():
    """spec §3 — invalid transitions must not silently occur. A DISCONNECTED→LIVE_CAPTURING jump is
    illegal; it raises AND leaves the state + history untouched (no partial record)."""
    lc = _lc()
    with pytest.raises(InvalidTransition) as ei:
        lc.to(AcqState.LIVE_CAPTURING, "skip the whole handshake")
    assert ei.value.frm is AcqState.DISCONNECTED and ei.value.to is AcqState.LIVE_CAPTURING
    assert lc.state is AcqState.DISCONNECTED
    assert lc.history == []


def test_invalid_transition_message_names_both_states():
    lc = _lc()
    with pytest.raises(InvalidTransition, match="disconnected -> ready"):
        lc.to(AcqState.READY, "nope")


def test_can_reports_legality_without_moving():
    lc = _lc()
    assert lc.can(AcqState.CONNECTING) is True
    assert lc.can(AcqState.READY) is False
    assert lc.state is AcqState.DISCONNECTED  # can() is read-only


# ── the recovery model (hardware-pinned, spec §6 + §7) ────────────────────────────────────────────

def test_a_live_drop_goes_to_interrupted_not_error_and_carries_the_class():
    """A recoverable transport failure DURING live capture is a LIVE_INTERRUPTED (a transport drop, not a
    session end — spec §4), carrying the failure class for the recovery driver."""
    lc = _lc()
    _walk(lc, AcqState.CONNECTING, AcqState.CONNECTED, AcqState.AUTHENTICATING,
          AcqState.AUTHENTICATED, AcqState.CONFIGURING, AcqState.READY, AcqState.LIVE_CAPTURING)
    t = lc.fail(FailureClass.TRANSPORT_FAILURE, "BLE link dropped")
    assert lc.state is AcqState.LIVE_INTERRUPTED
    assert t.failure is FailureClass.TRANSPORT_FAILURE and t.failure.recoverable is True


def test_recovery_re_enters_connecting_not_prior_state():
    """spec §6 — a reconnect must not assume prior protocol state remains valid; recovery re-enters at
    CONNECTING (the full CONNECT→AUTHENTICATE→CONFIGURE→RESUME sequence)."""
    lc = _lc(state=AcqState.LIVE_INTERRUPTED)
    lc.to(AcqState.RECOVERING, "reconnect")
    assert lc.can(AcqState.CONNECTING) is True
    lc.to(AcqState.CONNECTING, "re-open link")
    assert lc.state is AcqState.CONNECTING


def test_recovery_budget_spent_goes_to_error():
    lc = _lc(state=AcqState.RECOVERING)
    lc.to(AcqState.ERROR, "retry budget exhausted")
    assert lc.state is AcqState.ERROR


def test_a_non_live_recoverable_failure_still_goes_to_error():
    """`fail` only diverts to LIVE_INTERRUPTED when the state IS live capture. A recoverable failure in
    any other state (e.g. during SYNCING) goes to ERROR — the SYNCING→ERROR edge, then a caller may
    RECOVERING from there."""
    lc = _lc(state=AcqState.SYNCING)
    t = lc.fail(FailureClass.TIMEOUT, "spool round timed out")
    assert lc.state is AcqState.ERROR and t.failure is FailureClass.TIMEOUT


def test_a_permanent_failure_during_live_capture_goes_straight_to_error():
    """An UNrecoverable failure (auth/protocol/storage) during live capture must NOT become a
    LIVE_INTERRUPTED that a recovery loop would retry forever (spec §31). It goes to ERROR."""
    lc = _lc()
    _walk(lc, AcqState.CONNECTING, AcqState.CONNECTED, AcqState.AUTHENTICATING,
          AcqState.AUTHENTICATED, AcqState.CONFIGURING, AcqState.READY, AcqState.LIVE_CAPTURING)
    t = lc.fail(FailureClass.PROTOCOL_FAILURE, "malformed StreamData past resync")
    assert lc.state is AcqState.ERROR
    assert t.failure is FailureClass.PROTOCOL_FAILURE and t.failure.recoverable is False


def test_error_can_recover_or_settle():
    lc = _lc(state=AcqState.ERROR)
    assert lc.can(AcqState.RECOVERING) is True
    assert lc.can(AcqState.DISCONNECTED) is True


# ── the failure taxonomy ──────────────────────────────────────────────────────────────────────────

def test_failure_classes_split_recoverable_from_permanent():
    recoverable = {f for f in FailureClass if f.recoverable}
    permanent = {f for f in FailureClass if not f.recoverable}
    assert FailureClass.TRANSPORT_FAILURE in recoverable
    assert FailureClass.AUTHENTICATION_FAILURE in permanent
    assert FailureClass.PROTOCOL_FAILURE in permanent
    assert FailureClass.STORAGE_FAILURE in permanent
    assert FailureClass.VALIDATION_FAILURE in permanent
    # every class is exactly one or the other (no member left unclassified)
    assert recoverable | permanent == set(FailureClass)
    assert recoverable & permanent == set()


def test_failure_label_is_the_wire_string():
    assert FailureClass.TRANSPORT_FAILURE.label == "transport_failure"


# ── the Transition provenance record ──────────────────────────────────────────────────────────────

def test_transition_carries_every_required_field():
    """spec §3 — prev, new, reason, host monotonic AND wall, device identity, acquisition session."""
    lc = _lc()
    t = lc.to(AcqState.CONNECTING, "open link")
    assert t.prev is AcqState.DISCONNECTED and t.new is AcqState.CONNECTING
    assert t.reason == "open link"
    assert t.host_monotonic == 0.0                    # first injected tick
    assert t.host_wall == "2026-08-23T00:00:00+00:00"
    assert t.device_id == "AS11-01" and t.session_id == "acq-1"
    assert t.failure is None


def test_transition_is_immutable():
    lc = _lc()
    t = lc.to(AcqState.CONNECTING, "x")
    with pytest.raises(Exception):
        t.new = AcqState.READY  # frozen dataclass


def test_transition_row_is_semicolon_delimited_with_blanks_for_absent():
    """The provenance row matches the LinkLogWriter sidecar idiom; an absent field is BLANK, never a
    fabricated zero (Clock-Contract honesty)."""
    lc = AcqLifecycle(device_id=None, session_id=None,
                      mono=lambda: 12.5, wall=lambda: "2026-08-23T01:02:03+00:00")
    lc.state = AcqState.LIVE_CAPTURING
    t = lc.fail(FailureClass.STREAM_STALL, "no frame 8s")
    row = t.as_row().split(";")
    assert row[0] == "2026-08-23T01:02:03+00:00"
    assert row[1] == "12.500000"
    assert row[2] == "live_capturing" and row[3] == "live_interrupted"
    assert row[4] == "no frame 8s"
    assert row[5] == "" and row[6] == ""                # device_id, session_id absent → blank
    assert row[7] == "stream_stall"


def test_a_clean_transition_row_has_a_blank_failure_field():
    lc = _lc()
    t = lc.to(AcqState.CONNECTING, "advert")
    assert t.as_row().split(";")[7] == ""              # no failure on a clean edge


# ── clean shutdown path ───────────────────────────────────────────────────────────────────────────

def test_shutdown_settles_to_disconnected():
    lc = _lc(state=AcqState.READY)
    lc.to(AcqState.SHUTTING_DOWN, "operator stop")
    lc.to(AcqState.DISCONNECTED, "link closed")
    assert lc.state is AcqState.DISCONNECTED


def test_default_wall_clock_is_utc_iso():
    """The un-injected default wall clock returns a UTC ISO-8601 string (real callers get it; tests
    inject a fixed one). Exercised so the default branch is covered."""
    s = cpap_acq._default_wall()
    assert s.endswith("+00:00") and "T" in s
