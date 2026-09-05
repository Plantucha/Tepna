# tepna-capture — tests/test_oxy_power.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The power axis (`oxy_power.py`) — O2RING-POWER-AWARE-BLE-LIFECYCLE §23's adversarial set.

Every test is a claim the brief makes, phrased as the thing that must NOT happen: a connect-fail
loop, a harvest preempting live capture, a battery read as a reason to connect, a flicker of the
worn bit re-arming the idle sync, an illegal edge killing the daemon. The clock is injected, so
every deadline here is exact.
"""
from __future__ import annotations

import json

import pytest

import oxy_lifecycle
import oxy_power as P
from cpap_acq import FailureClass as F

S = P.PowerState
L = oxy_lifecycle.OxyState
ADDR = "D1:98:62:7C:92:B3"


def _pw(**kw):
    clock = {"t": 0.0}
    pw = P.RingPower(ADDR, mono=lambda: clock["t"], wall=lambda: "2026-09-05T00:00:00", **kw)
    return pw, clock


def _detected(pw, now=1.0):
    pw.note_scan_window(10.0, sightings=1)
    pw.note_presence("pres_present", now)
    assert pw.state is S.DEVICE_DETECTED
    return pw


def _fail(pw, now, failure=F.TIMEOUT, trigger="charger"):
    assert pw.attempt_allowed(now).allowed
    pw.attempt_started(trigger, now)
    return pw.attempt_finished(now + 1.0, ok=False, failure=failure)


# ── the machine itself ────────────────────────────────────────────────────────────────────────────
def test_every_state_is_reachable_and_every_legal_edge_names_real_states():
    reachable = {S.RADIO_IDLE}
    frontier = [S.RADIO_IDLE]
    while frontier:
        s = frontier.pop()
        for a, b in P.LEGAL_TRANSITIONS:
            if a is s and b not in reachable:
                reachable.add(b)
                frontier.append(b)
    assert reachable == set(S), set(S) - reachable


def test_radio_idle_cannot_jump_straight_to_harvesting_or_active_capture():
    pw, _ = _pw()
    for bad in (S.HARVESTING, S.ACTIVE_CAPTURE, S.CONNECTED_IDLE, S.DISCONNECTING):
        assert not pw.can(bad)
        with pytest.raises(P.InvalidTransition) as ei:
            pw.to(bad, "x")
        assert ei.value.frm is S.RADIO_IDLE and ei.value.to is bad
    assert pw.state is S.RADIO_IDLE and pw.counters.transitions == 0


def test_cooldown_and_backoff_never_lead_directly_into_connecting():
    """§12 — the connect-fail loop is an ILLEGAL EDGE, not a discouraged one."""
    assert (S.COOLDOWN, S.CONNECTING) not in P.LEGAL_TRANSITIONS
    assert (S.RESOURCE_WAIT, S.CONNECTING) not in P.LEGAL_TRANSITIONS
    # ERROR_BACKOFF → CONNECTING IS legal (a strike, not a cooldown) — but only through attempt_allowed


def test_guarded_edge_is_skipped_and_counted_never_raised():
    pw, _ = _pw()
    assert pw._try(S.HARVESTING, "impossible") is False
    assert pw.state is S.RADIO_IDLE
    assert pw.counters.illegal_skipped == 1
    assert pw.drain() == []


def test_self_edge_is_a_silent_noop_not_an_illegal_skip():
    pw, _ = _pw()
    assert pw._try(S.RADIO_IDLE, "again") is False
    assert pw.counters.illegal_skipped == 0 and pw.counters.transitions == 0


def test_transition_rows_are_power_axis_and_write_through_the_existing_row_format():
    pw, clock = _pw(device_id="ring-1", session_id="sess")
    clock["t"] = 12.5
    pw.to(S.PASSIVE_SCAN, "window")
    (row,) = pw.drain()
    assert isinstance(row, oxy_lifecycle.Transition)
    assert row.axis == P.AXIS == "power"
    text = row.as_row()
    assert text.endswith(";power")
    assert "pw_radio_idle;pw_passive_scan;window;ring-1;sess" in text
    assert pw.drain() == [], "drain hands each row over exactly once"


def test_radio_on_set_is_small_and_excludes_every_waiting_state():
    for s in (S.RADIO_IDLE, S.DEVICE_DETECTED, S.HARVEST_CANDIDATE, S.COOLDOWN, S.RESOURCE_WAIT, S.ERROR_BACKOFF):
        assert s not in P.RADIO_ON
    assert P.LINK_HELD < P.RADIO_ON


# ── §3/§7 scan policy ─────────────────────────────────────────────────────────────────────────────
def test_no_scan_policy_is_active_and_low_is_the_default():
    for pol in (P.SCAN_LOW, P.SCAN_MODERATE, P.SCAN_RESPONSIVE):
        assert pol.active is False
    assert P.scan_policy_for(S.RADIO_IDLE) is P.SCAN_LOW
    assert P.scan_policy_for(S.PASSIVE_SCAN) is P.SCAN_LOW
    assert P.scan_policy_for(S.COOLDOWN) is P.SCAN_LOW


def test_scan_duty_cycles_are_ordered_and_responsive_equals_todays_fifty_percent():
    assert P.SCAN_LOW.duty < P.SCAN_MODERATE.duty < P.SCAN_RESPONSIVE.duty
    assert P.SCAN_RESPONSIVE.duty == pytest.approx(0.5)
    assert P.SCAN_LOW.duty < 0.1


def test_scan_policy_escalates_with_state_and_sync_expectation():
    assert P.scan_policy_for(S.DEVICE_DETECTED) is P.SCAN_MODERATE
    assert P.scan_policy_for(S.HARVEST_CANDIDATE) is P.SCAN_RESPONSIVE
    assert P.scan_policy_for(S.RADIO_IDLE, sync_expected=True) is P.SCAN_RESPONSIVE


# ── §4/§5/§6 presence → power ─────────────────────────────────────────────────────────────────────
def test_presence_unknown_changes_nothing():
    pw, _ = _pw()
    pw.note_scan_window(10.0, sightings=0)
    pw.note_presence("pres_unknown", 5.0)
    assert pw.state is S.PASSIVE_SCAN
    assert pw.cache.first_seen is None and pw.cache.generation == 0


def test_presence_present_is_detected_not_ready_and_starts_no_link():
    pw, _ = _pw()
    _detected(pw)
    assert pw.state is S.DEVICE_DETECTED
    assert pw.cache.owner is None, "presence alone owns no radio"
    assert pw.counters.connect_attempts == 0 and pw.counters.harvest_attempts == 0


def test_repeated_presence_ticks_do_not_bump_generation_but_absence_and_return_do():
    pw, _ = _pw()
    _detected(pw, 1.0)
    for t in (2.0, 3.0, 4.0):
        pw.note_presence("pres_present", t)
    assert pw.cache.generation == 1 and pw.cache.last_seen == 4.0 and pw.cache.first_seen == 1.0
    pw.note_presence("pres_absent", 5.0)
    assert pw.state is S.PASSIVE_SCAN
    pw.note_presence("pres_present", 6.0)
    assert pw.cache.generation == 2 and pw.state is S.DEVICE_DETECTED


def test_sighting_inside_a_backoff_does_not_reset_strikes():
    """§12 — 'visible again' is not 'a new opportunity' while a strike is being served."""
    pw, _ = _pw()
    _detected(pw)
    _fail(pw, 10.0)
    assert pw.state is S.ERROR_BACKOFF and pw.cache.retry_count == 1
    pw.note_presence("pres_present", 12.0)
    assert pw.cache.retry_count == 1 and pw.cache.generation == 1
    assert pw.state is S.ERROR_BACKOFF


def test_presence_without_a_prior_scan_window_still_walks_idle_scan_detected():
    """A presence observation arriving in RADIO_IDLE (the fold ran before the window was noted) must
    not be an illegal edge — it passes through PASSIVE_SCAN."""
    pw, _ = _pw()
    pw.note_presence("pres_present", 1.0)
    assert [r.new for r in pw.drain()] == [S.PASSIVE_SCAN, S.DEVICE_DETECTED]
    assert pw.counters.illegal_skipped == 0


def test_absence_while_idle_or_in_a_link_changes_nothing():
    pw, _ = _pw()
    pw.note_presence("pres_absent", 1.0)
    assert pw.state is S.RADIO_IDLE and pw.counters.transitions == 0
    pw.note_link(L.CONNECTING, "s", 2.0)
    pw.note_presence("pres_absent", 3.0)
    assert pw.state is S.CONNECTING


def test_scan_window_counters_are_sightings_not_adverts_and_never_negative():
    pw, _ = _pw()
    pw.note_scan_window(10.0, sightings=3)
    pw.note_scan_window(-4.0, sightings=-1)
    c = pw.counters.as_dict()
    assert c["scan_windows"] == 2 and c["scan_seconds"] == 10.0 and c["sightings"] == 3
    assert "adverts" not in c


# ── §18 battery ───────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("pct,band", [
    (None, P.BatteryBand.UNKNOWN), ("80", P.BatteryBand.UNKNOWN), (True, P.BatteryBand.UNKNOWN),
    (-1, P.BatteryBand.UNKNOWN), (101, P.BatteryBand.UNKNOWN), (float("nan"), P.BatteryBand.UNKNOWN),
    (0, P.BatteryBand.CRITICAL), (10, P.BatteryBand.CRITICAL), (11, P.BatteryBand.LOW),
    (20, P.BatteryBand.LOW), (21, P.BatteryBand.NORMAL), (100, P.BatteryBand.NORMAL),
])
def test_battery_band_unknown_is_first_class_and_edges_are_inclusive(pct, band):
    assert P.battery_band(pct) is band


def test_battery_never_causes_a_connection_or_a_transition():
    pw, _ = _pw()
    _detected(pw)
    n = pw.counters.transitions
    assert pw.note_battery(3) is P.BatteryBand.CRITICAL
    assert pw.state is S.DEVICE_DETECTED and pw.counters.transitions == n
    assert pw.counters.connect_attempts == 0
    assert pw.snapshot()["cache"]["battery"] == "critical"


# ── §16 the one hard rule ─────────────────────────────────────────────────────────────────────────
def test_harvest_is_deferred_while_live_capture_runs_regardless_of_worn_flag():
    pw, _ = _pw()
    for worn in (True, False, None):
        d = pw.harvest_request(link_state="live", worn=worn)
        assert not d.allowed and "LIVE CAPTURE ACTIVE" in d.reason
    assert pw.counters.deferrals_live == 3


def test_harvest_is_deferred_when_connected_and_worn_but_allowed_when_connected_and_unworn():
    pw, _ = _pw()
    assert not pw.harvest_request(link_state="connected", worn=True).allowed
    assert pw.harvest_request(link_state="connected", worn=False).allowed
    assert pw.harvest_request(link_state="idle_unworn", worn=False).allowed


def test_harvest_on_unknown_link_and_unknown_worn_is_allowed():
    """Refusing on UNKNOWN would lose the only backup of a lossy night — same asymmetry as on_body()."""
    pw, _ = _pw()
    d = pw.harvest_request(link_state=None, worn=None)
    assert d.allowed and pw.counters.deferrals_live == 0


# ── §10/§11/§12 strikes, backoff, cooldown ────────────────────────────────────────────────────────
def test_three_strikes_then_cooldown_and_no_fourth_attempt_until_it_expires():
    pw, _ = _pw()
    _detected(pw)
    _fail(pw, 10.0)
    assert pw.state is S.ERROR_BACKOFF and not pw.attempt_allowed(11.0).allowed
    t2 = 10.0 + 1.0 + P.backoff_for(F.TIMEOUT, 1)
    _fail(pw, t2)
    t3 = t2 + 1.0 + P.backoff_for(F.TIMEOUT, 2)
    a3 = _fail(pw, t3)
    assert a3.ok is False and pw.state is S.COOLDOWN
    assert pw.cache.cooldown_until == pytest.approx(t3 + 1.0 + P.STRIKE_COOLDOWN_S)
    assert pw.counters.cooldowns == 1 and pw.counters.harvest_attempts == 3 and pw.counters.retries == 2
    for t in (t3 + 2, t3 + 900, pw.cache.cooldown_until - 0.01):
        assert not pw.attempt_allowed(t).allowed
    assert pw.counters.harvest_attempts == 3, "no attempt was recorded during the cooldown"


def test_cooldown_expiry_resets_strikes_and_returns_to_radio_idle():
    pw, _ = _pw()
    _detected(pw)
    for _ in range(3):
        pw.cache.backoff_until = None
        _fail(pw, 100.0)
    assert pw.state is S.COOLDOWN
    d = pw.attempt_allowed(pw.cache.cooldown_until)
    assert d.allowed and "attempt 1 of 3" in d.reason
    assert pw.state is S.RADIO_IDLE and pw.cache.retry_count == 0 and pw.cache.cooldown_until is None


def test_backoff_expiry_keeps_the_strike_count():
    pw, _ = _pw()
    _detected(pw)
    _fail(pw, 10.0, F.TRANSPORT_FAILURE)
    until = pw.cache.backoff_until
    assert until == pytest.approx(11.0 + 60.0)
    assert not pw.attempt_allowed(until - 1).allowed
    d = pw.attempt_allowed(until)
    assert d.allowed and "attempt 2 of 3" in d.reason and pw.cache.retry_count == 1


def test_backoff_is_failure_typed_and_doubles_per_strike_but_never_exceeds_the_cooldown():
    assert P.backoff_for(F.TRANSPORT_FAILURE, 1) < P.backoff_for(F.TIMEOUT, 1) < P.backoff_for(F.DEVICE_UNAVAILABLE, 1)
    assert P.backoff_for(F.AUTHENTICATION_FAILURE, 1) > P.backoff_for(F.DEVICE_UNAVAILABLE, 1)
    assert P.backoff_for(F.TIMEOUT, 2) == 2 * P.backoff_for(F.TIMEOUT, 1)
    assert P.backoff_for(F.PROTOCOL_FAILURE, 3) == P.STRIKE_COOLDOWN_S
    assert P.backoff_for(None, 1) == P._DEFAULT_BACKOFF_S
    assert P.backoff_for(F.TIMEOUT, 0) == P.backoff_for(F.TIMEOUT, 1)
    assert set(P.BACKOFF_S) == set(F), "every FailureClass has an explicit backoff"


def test_success_resets_strikes_marks_synced_and_releases_the_radio():
    pw, _ = _pw()
    _detected(pw)
    _fail(pw, 10.0)
    pw.cache.backoff_until = None
    pw.attempt_started("charger", 200.0)
    assert pw.cache.owner is not None and pw.cache.owner.reason is P.RadioReason.O2RING_HARVEST
    a = pw.attempt_finished(230.0, ok=True, files=2, bytes=4096)
    assert a.duration_s == 30.0 and a.files == 2
    assert pw.state is S.RADIO_IDLE and pw.cache.owner is None
    assert pw.cache.retry_count == 0 and pw.cache.synced_this_idle is True and pw.cache.last_success_at == 230.0
    c = pw.counters.as_dict()
    assert c["harvests_ok"] == 1 and c["files"] == 2 and c["bytes"] == 4096 and c["harvest_avg_s"] == 30.0


def test_attempt_finished_without_a_start_still_records_a_closed_attempt():
    pw, _ = _pw()
    a = pw.attempt_finished(5.0, ok=False, failure=F.PROTOCOL_FAILURE)
    assert a.trigger == "?" and a.duration_s == 0.0 and pw.cache.retry_count == 1


def test_externally_declared_cooldown_is_idempotent_on_its_deadline():
    """The live loop re-enters the storm-hold branch every second; it must count ONE cooldown."""
    pw, _ = _pw()
    assert pw.note_cooldown(900.0, "restart storm") is True
    for _ in range(50):
        assert pw.note_cooldown(900.0, "restart storm") is False
    assert pw.counters.cooldowns == 1 and pw.state is S.COOLDOWN
    assert not pw.attempt_allowed(899.0).allowed
    pw.cooldown_over()
    assert pw.state is S.RADIO_IDLE and pw.cache.cooldown_until is None


def test_a_longer_hold_replaces_a_shorter_one_and_counts_again():
    pw, _ = _pw()
    pw.note_cooldown(900.0, "storm")
    assert pw.note_cooldown(7200.0, "storm ×2") is True
    assert pw.counters.cooldowns == 2 and pw.cache.cooldown_until == 7200.0


# ── §17 ownership / RESOURCE_WAIT ────────────────────────────────────────────────────────────────
def test_busy_slot_is_a_deferral_with_a_holder_not_a_failure_strike():
    pw, _ = _pw()
    _detected(pw)
    pw.note_busy(5.0, holder="polar offline pull")
    assert pw.state is S.RESOURCE_WAIT
    assert pw.counters.deferrals_busy == 1 and pw.cache.retry_count == 0
    (row,) = [r for r in pw.drain() if r.new is S.RESOURCE_WAIT]
    assert "polar offline pull" in row.reason


def test_owner_record_carries_who_why_since_until_and_is_released():
    pw, clock = _pw()
    clock["t"] = 42.0
    o = pw.take("run_oxyii", P.RadioReason.LIVE_O2RING_CAPTURE, until=99.0)
    assert (o.owner, o.reason, o.since, o.until) == ("run_oxyii", P.RadioReason.LIVE_O2RING_CAPTURE, 42.0, 99.0)
    snap = pw.snapshot()["cache"]["owner"]
    assert snap == {"owner": "run_oxyii", "reason": "live_o2ring_capture", "since": 42.0, "until": 99.0}
    pw.release()
    assert pw.snapshot()["cache"]["owner"] is None


# ── §19 the re-arm chain ──────────────────────────────────────────────────────────────────────────
def test_synced_idle_blocks_a_second_harvest_until_worn_recording_removed():
    pw, _ = _pw()
    pw.cache.synced_this_idle = True
    assert not pw.harvest_request(link_state="disconnected", worn=False).allowed
    assert pw.note_worn_rec(True, "not_recording") is False        # worn, no session yet
    assert pw.note_worn_rec(False, "not_recording") is False       # taken off again — chain broken
    assert pw.cache.synced_this_idle is True and pw.cache.rearm_stage == "idle"
    assert pw.note_worn_rec(True, "not_recording") is False
    assert pw.note_worn_rec(True, "recording") is False
    assert pw.note_worn_rec(True, "recording") is False
    assert pw.note_worn_rec(False, "end_candidate") is True        # REMOVED after RECORDING after WORN
    assert pw.cache.synced_this_idle is False
    assert pw.harvest_request(link_state="disconnected", worn=False).allowed


def test_unknown_worn_never_advances_or_breaks_the_chain():
    pw, _ = _pw()
    pw.cache.synced_this_idle = True
    pw.note_worn_rec(True, "recording")
    assert pw.cache.rearm_stage == "recording"
    assert pw.note_worn_rec(None, None) is False
    assert pw.cache.rearm_stage == "recording" and pw.cache.synced_this_idle is True


def test_recording_without_worn_first_does_not_start_the_chain():
    pw, _ = _pw()
    assert pw.note_worn_rec(False, "recording") is False
    assert pw.cache.rearm_stage == "idle"


# ── the LINK axis folds in ────────────────────────────────────────────────────────────────────────
def test_live_loop_link_transitions_map_onto_power_states_and_count_connection_seconds():
    pw, _ = _pw()
    seq = [(L.CONNECTING, S.CONNECTING, 0.0), (L.CONNECTED, S.CONNECTED_IDLE, 5.0),
           (L.LIVE, S.ACTIVE_CAPTURE, 6.0), (L.IDLE_UNWORN, S.CONNECTED_IDLE, 3000.0),
           (L.LIVE, S.ACTIVE_CAPTURE, 3010.0), (L.INTERRUPTED, S.DISCONNECTING, 3605.0),
           (L.DISCONNECTED, S.DISCONNECTING, 3606.0), (L.SHUTTING_DOWN, S.RADIO_IDLE, 3607.0)]
    for link, power, t in seq:
        pw.note_link(link, link.value, t)
        assert pw.state is power, (link, pw.state)
    c = pw.counters.as_dict()
    assert c["connect_attempts"] == 1 and c["connect_successes"] == 1 and c["connect_failures"] == 0
    assert c["connection_seconds"] == 3600.0
    assert c["illegal_skipped"] == 0, "the real loop's sequence has no modelling gap"
    assert pw.cache.owner is None


def test_connect_failure_is_counted_when_the_link_drops_from_connecting():
    pw, _ = _pw()
    pw.note_link(L.CONNECTING, "scan", 0.0)
    assert pw.cache.owner.reason is P.RadioReason.LIVE_O2RING_CAPTURE
    pw.note_link(L.DISCONNECTED, "session ended", 30.0, failure=F.TIMEOUT)
    assert pw.counters.connect_failures == 1 and pw.counters.connection_seconds == 0.0
    assert pw.state is S.DISCONNECTING and pw.cache.owner is None
    row = pw.drain()[-1]
    assert row.failure is F.TIMEOUT


def test_link_drop_while_the_radio_is_already_off_is_not_an_illegal_edge():
    pw, _ = _pw()
    pw.note_link(L.ERROR, "classify me", 1.0, failure=F.FATAL_ERROR)
    assert pw.state is S.RADIO_IDLE and pw.counters.illegal_skipped == 0 and pw.counters.connect_failures == 0


def test_pull_side_link_states_are_ignored_by_the_link_fold():
    pw, _ = _pw()
    pw.note_link(L.PAUSED_FOR_PULL, "pull", 1.0)
    pw.note_link(L.PULLING, "pull", 2.0)
    assert pw.state is S.RADIO_IDLE and pw.counters.transitions == 0


def test_recovery_takes_the_radio_as_recovery_and_lands_in_error_backoff():
    pw, _ = _pw()
    pw.note_link(L.RECOVERING, "adapter reset", 1.0)
    assert pw.state is S.ERROR_BACKOFF and pw.cache.owner.reason is P.RadioReason.RECOVERY
    pw.note_link(L.SHUTTING_DOWN, "daemon stop", 2.0)
    assert pw.state is S.RADIO_IDLE and pw.cache.owner is None


def test_shutdown_from_a_live_link_passes_through_disconnecting_and_closes_the_seconds():
    pw, _ = _pw()
    pw.note_link(L.CONNECTING, "s", 0.0)
    pw.note_link(L.CONNECTED, "a", 10.0)
    pw.note_link(L.SHUTTING_DOWN, "daemon stop", 70.0)
    states = [r.new for r in pw.drain()]
    assert states[-2:] == [S.DISCONNECTING, S.RADIO_IDLE]
    assert pw.counters.connection_seconds == 60.0


def test_shutdown_after_the_link_already_dropped_does_not_double_count_or_repeat_disconnecting():
    pw, _ = _pw()
    pw.note_link(L.CONNECTING, "s", 0.0)
    pw.note_link(L.CONNECTED, "a", 10.0)
    pw.note_link(L.DISCONNECTED, "ended", 40.0)
    pw.note_link(L.SHUTTING_DOWN, "daemon stop", 70.0)
    assert [r.new for r in pw.drain()][-2:] == [S.DISCONNECTING, S.RADIO_IDLE]
    assert pw.counters.connection_seconds == 30.0 and pw.counters.illegal_skipped == 0


# ── §9 timeouts, classification, snapshot ────────────────────────────────────────────────────────
def test_seven_distinct_timeouts_are_named_and_positive():
    t = P.TIMEOUTS
    names = ("discovery_s", "connect_s", "auth_s", "service_discovery_s", "inventory_s", "transfer_chunk_s", "disconnect_s")
    assert len(names) == 7 and all(getattr(t, n) > 0 for n in names)
    assert t.connect_s == 30.0, "the value bleak applied implicitly, now explicit"
    assert t.discovery_s == 25.0, "pull_session's find_device_by_filter bound"


def test_classify_exception_maps_onto_the_shared_taxonomy():
    class BleakDeviceNotFoundError(Exception):
        pass

    class BleakDBusError(Exception):
        pass

    assert P.classify_exception(TimeoutError()) is F.TIMEOUT
    assert P.classify_exception(BleakDeviceNotFoundError("x")) is F.DEVICE_UNAVAILABLE
    assert P.classify_exception(RuntimeError("Device with address D1:.. was not found")) is F.DEVICE_UNAVAILABLE
    assert P.classify_exception(BleakDBusError("org.bluez.Error.Failed")) is F.TRANSPORT_FAILURE
    assert P.classify_exception(OSError(19, "No such device")) is F.TRANSPORT_FAILURE
    assert P.classify_exception(RuntimeError("Error 201 not_implemented")) is F.PROTOCOL_FAILURE
    assert P.classify_exception(RuntimeError("auth frame rejected")) is F.AUTHENTICATION_FAILURE
    assert P.classify_exception(ValueError("short trailer")) is F.RECOVERABLE_ERROR


def test_snapshot_is_json_serialisable_and_carries_state_policy_counters_and_last_attempt():
    pw, _ = _pw()
    assert pw.snapshot()["last_attempt"] is None
    _detected(pw)
    _fail(pw, 10.0, F.DEVICE_UNAVAILABLE)
    snap = json.loads(json.dumps(pw.snapshot()))
    assert snap["state"] == "pw_error_backoff" and snap["radio_on"] is False
    assert snap["scan_policy"] == "low"
    assert snap["cache"]["last_failure"] == "device_unavailable" and snap["cache"]["generation"] == 1
    assert snap["last_attempt"] == {"trigger": "charger", "ok": False, "failure": "device_unavailable",
                                    "duration_s": 1.0, "files": 0, "bytes": 0}
    assert snap["counters"]["harvest_avg_s"] is None


def test_default_clock_is_real_monotonic_and_wall_matches_the_link_axis():
    pw = P.RingPower(ADDR)
    t = pw.to(S.PASSIVE_SCAN, "w")
    assert t.host_monotonic > 0 and isinstance(t.host_wall, str) and "T" in t.host_wall
