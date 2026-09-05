# tepna-capture — tests/test_oxy_power_wire.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The POWER axis (oxy_power.py) WIRED into capture.py — O2RING-POWER-AWARE-BLE-LIFECYCLE-2026-09-05.

test_oxy_power.py proves the pure engine. These prove the daemon actually CONSULTS it at the four sites
that spend radio: the two automatic pollers (charger/doff/presence dispatch + the hourly net), the
stored-session pull that records every attempt, and the presence observer that picks its own cadence.
A gate that exists and is consulted by nobody is this repo's dominant defect class; each test here drives
a real daemon loop against a fake pull and reads what the engine recorded.
"""
import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import capture  # noqa: E402
import oxy_power  # noqa: E402

RING = "D1:98:62:7C:92:B3"


@pytest.fixture(autouse=True)
def _clean_daemon_state():
    capture._STOP = asyncio.Event()
    capture._RECOVER = asyncio.Event()
    capture._OXYII_PAUSE = asyncio.Event()
    capture._CONNECT_LOCK = asyncio.Lock()
    capture._CHARGER_SINCE.clear()
    capture._CHARGER_PULLED.clear()
    capture._NOTWORN_PULLED.clear()
    capture._PRESENCE.clear()
    capture._PRESENCE_NAMES.clear()
    capture.STATUS.clear()
    capture.STATUS["devices"] = {}
    yield
    capture._STOP.set()
    capture._PRESENCE.clear()
    capture._PRESENCE_NAMES.clear()


def _run(coro):
    return asyncio.run(coro)


def _stop_after(monkeypatch, n=1):
    calls = {"n": 0}

    async def fake_sleep(_secs):
        calls["n"] += 1
        if calls["n"] >= n:
            capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    return calls


def _ring():
    return {"name": "Ring", "vendor": "Wellue", "model": "O2Ring-S", "address": RING, "device_id": "S1"}


def _charger_cfg():
    return {"pull": {"auto": True, "charger_settle_sec": 0}, "devices": [_ring()]}


def _hourly_cfg(retries=1):
    return {"pull": {"auto": True, "auto_interval_sec": 1, "auto_retries": retries}, "devices": [_ring()]}


def _fake_pull(monkeypatch, result=None, raise_=None):
    calls = []

    async def fake(dev, root, which="latest", ftype=0, *, trigger="manual"):
        calls.append(trigger)
        if raise_ is not None:
            raise raise_
        return result if result is not None else {"new_files": [], "out_dir": root}
    monkeypatch.setattr(capture, "pull_oxyii_session", fake)
    return calls


# ── charger / doff / presence dispatch (charger_pull_poller) ────────────────────────────────────────
def test_charger_pull_is_vetoed_while_the_ring_is_in_cooldown_and_the_latch_is_not_spent(tmp_path, monkeypatch):
    """§12 — a 3-strike cooldown means no connect, whatever the trigger says. And the veto lands BEFORE
    `_CHARGER_PULLED` is marked, so the trigger is still armed when the cooldown lifts."""
    capture.STATUS["devices"]["Ring"] = {"charging": True}
    pw = capture._power_for("Ring", RING)
    pw.note_cooldown(1e12, "restart storm hold")           # far future
    calls = _fake_pull(monkeypatch)
    _stop_after(monkeypatch, 2)
    _run(capture.charger_pull_poller(_charger_cfg(), str(tmp_path)))
    assert calls == [], "a ring in cooldown must not be connected to"
    assert RING not in capture._CHARGER_PULLED, "the latch must stay armed for when the veto lifts"
    assert capture.STATUS["power"]["Ring"]["state"] == "pw_cooldown"
    assert capture.STATUS["power"]["Ring"]["counters"]["deferrals_policy"] >= 1


def test_charger_pull_is_vetoed_by_typed_backoff_then_allowed_once_it_expires(tmp_path, monkeypatch):
    """§11 — one strike opens a failure-typed backoff; the SAME trigger is refused inside it and honoured
    after it, with the strike count kept (a backoff is a pause, not a pardon)."""
    capture.STATUS["devices"]["Ring"] = {"charging": True}
    pw = capture._power_for("Ring", RING)
    pw.attempt_started("charger", 0.0)
    pw.attempt_finished(1.0, ok=False, failure=oxy_power.FailureClass.TIMEOUT)
    assert pw.state is oxy_power.PowerState.ERROR_BACKOFF
    calls = _fake_pull(monkeypatch)
    # inside the backoff: refused
    monkeypatch.setattr(capture._time, "monotonic", lambda: 2.0)
    _stop_after(monkeypatch, 2)
    _run(capture.charger_pull_poller(_charger_cfg(), str(tmp_path)))
    assert calls == []
    # after it: allowed, and the strike is still on the record
    capture._STOP = asyncio.Event()
    monkeypatch.setattr(capture._time, "monotonic", lambda: 1.0 + 24 * 3600)
    _stop_after(monkeypatch, 2)
    _run(capture.charger_pull_poller(_charger_cfg(), str(tmp_path)))
    assert calls == ["charger"]
    assert pw.cache.retry_count == 1, "strikes are kept across a backoff"


def test_charger_pull_never_interrupts_a_live_capture(tmp_path, monkeypatch):
    """§16 — LIVE CAPTURE ACTIVE → HARVEST DEFERRED. A ring streaming raw PPG on the charger (it happens:
    the dock does not always break the link) is not downloaded from; raw data outranks a backup (§25)."""
    capture.STATUS["devices"]["Ring"] = {"charging": True, "oxy_lifecycle": "live", "worn": True}
    calls = _fake_pull(monkeypatch)
    _stop_after(monkeypatch, 2)
    _run(capture.charger_pull_poller(_charger_cfg(), str(tmp_path)))
    assert calls == []
    assert RING not in capture._CHARGER_PULLED
    assert capture.STATUS["power"]["Ring"]["counters"]["deferrals_live"] >= 1


def test_a_synced_idle_is_not_harvested_again_until_worn_recording_removed(tmp_path, monkeypatch):
    """§19 — after a committed harvest the idle is synced; re-docking the ring without wearing it is not a
    new opportunity. The chain WORN→RECORDING→REMOVED (fed by `_power_observe`) re-arms it."""
    capture.STATUS["devices"]["Ring"] = {"charging": True}
    pw = capture._power_for("Ring", RING)
    pw.attempt_started("charger", 0.0)
    pw.attempt_finished(1.0, ok=True, files=1, bytes=10)
    assert pw.cache.synced_this_idle is True
    calls = _fake_pull(monkeypatch)
    _stop_after(monkeypatch, 2)
    _run(capture.charger_pull_poller(_charger_cfg(), str(tmp_path)))
    assert calls == [], "already synced this idle — a second dock buys nothing but battery"
    # the ring is worn, records, and comes off again — the live path publishes each link
    capture._power_observe("Ring", worn=True, battery=80)
    capture._power_observe("Ring", worn=True, rec_state="recording")
    capture._power_observe("Ring", worn=False)
    assert pw.cache.synced_this_idle is False
    assert capture.STATUS["power"]["Ring"]["cache"]["battery"] == "normal"
    capture._STOP = asyncio.Event()
    capture._CHARGER_SINCE.clear()
    _stop_after(monkeypatch, 2)
    _run(capture.charger_pull_poller(_charger_cfg(), str(tmp_path)))
    assert calls == ["charger"]


def test_power_observe_reads_the_other_axes_from_status_when_not_told(monkeypatch):
    """A field not supplied comes from STATUS (what the other axis last published); None moves nothing."""
    capture.STATUS["devices"]["Ring"] = {"worn": True, "oxy_recording": "recording"}
    pw = capture._power_for("Ring", RING)
    capture._power_observe("Ring")
    assert pw.cache.rearm_stage == "recording"
    capture._power_observe("Ring", battery=5)
    assert pw.cache.battery is oxy_power.BatteryBand.CRITICAL
    capture.STATUS["devices"]["Ring"] = {}
    capture._power_observe("Ring")                     # worn None, rec None: UNKNOWN moves nothing
    assert pw.cache.rearm_stage == "recording"


def test_a_busy_offline_slot_on_the_charger_path_is_resource_wait_not_a_strike(tmp_path, monkeypatch):
    """§17 — another pull holds the single radio. Nothing was attempted: no strike, no backoff, and the
    engine reads RESOURCE_WAIT so the dashboard says WHY the harvest is not happening."""
    capture.STATUS["devices"]["Ring"] = {"charging": True}
    _fake_pull(monkeypatch, raise_=capture.offline_lock.OfflineBusy("held by Verity"))
    _stop_after(monkeypatch, 2)
    _run(capture.charger_pull_poller(_charger_cfg(), str(tmp_path)))
    pw = capture._POWER["Ring"]
    assert pw.state is oxy_power.PowerState.RESOURCE_WAIT
    assert pw.cache.retry_count == 0
    assert pw.counters.deferrals_busy >= 1
    assert capture.STATUS["power"]["Ring"]["state"] == "pw_resource_wait"


def test_the_power_gate_is_ring_only_a_polar_charger_pull_is_untouched(tmp_path, monkeypatch):
    """The engine is an O2Ring axis. A Polar sensor on the charger takes the pre-existing path."""
    h10 = {"name": "H10", "vendor": "Polar", "model": "H10", "address": "24:AC:AC:02:84:96", "device_id": "1"}
    capture.STATUS["devices"]["H10"] = {"charging": True}
    calls = []

    async def fake_polar(dev, root):
        calls.append(dev["name"]); return {"new_files": []}
    monkeypatch.setattr(capture, "pull_polar_offline_all", fake_polar)
    _stop_after(monkeypatch, 2)
    _run(capture.charger_pull_poller({"pull": {"auto": True, "charger_settle_sec": 0}, "devices": [h10]},
                                     str(tmp_path)))
    assert calls == ["H10"]
    assert "H10" not in capture._POWER


# ── the hourly reconciliation net (autopull_poller) ─────────────────────────────────────────────────
def test_hourly_net_ignores_the_synced_idle_veto_but_honours_cooldown(tmp_path, monkeypatch):
    """`strict_idle=False` — the net exists for the night whose WORN→RECORDING→REMOVED chain was never
    observable. It still never connects to a ring in cooldown (§12)."""
    capture.STATUS["devices"]["Ring"] = {"connected": False, "worn": False}
    pw = capture._power_for("Ring", RING)
    pw.attempt_started("charger", 0.0)
    pw.attempt_finished(1.0, ok=True, files=1, bytes=1)
    assert pw.cache.synced_this_idle is True
    calls = _fake_pull(monkeypatch)
    _stop_after(monkeypatch, 1)
    _run(capture.autopull_poller(_hourly_cfg(), str(tmp_path)))
    assert calls == ["hourly"], "synced-idle does not veto the reconciliation net"

    pw.note_cooldown(1e12, "restart storm hold")
    capture._STOP = asyncio.Event()
    _stop_after(monkeypatch, 1)
    _run(capture.autopull_poller(_hourly_cfg(), str(tmp_path)))
    assert calls == ["hourly"], "but a cooldown does"
    assert capture.STATUS["power"]["Ring"]["state"] == "pw_cooldown"


def test_hourly_net_defers_while_the_link_is_live_even_if_on_body_is_unknown(tmp_path, monkeypatch):
    """§16 from the other side: `on_body` needs `worn`; the LINK axis saying `live` is enough on its own."""
    capture.STATUS["devices"]["Ring"] = {"oxy_lifecycle": "live"}
    calls = _fake_pull(monkeypatch)
    _stop_after(monkeypatch, 1)
    _run(capture.autopull_poller(_hourly_cfg(), str(tmp_path)))
    assert calls == []
    assert capture.STATUS["power"]["Ring"]["counters"]["deferrals_live"] == 1


def test_hourly_net_busy_slot_is_resource_wait_and_a_failure_ends_the_cycle(tmp_path, monkeypatch):
    """§17 busy → RESOURCE_WAIT, no strike. A real failure was a strike INSIDE pull_oxyii_session and opened
    a backoff, so the in-cycle retry loop stops rather than reconnecting at once (§11/§12)."""
    capture.STATUS["devices"]["Ring"] = {"connected": False, "worn": False}
    _fake_pull(monkeypatch, raise_=capture.offline_lock.OfflineBusy("held"))
    _stop_after(monkeypatch, 1)
    _run(capture.autopull_poller(_hourly_cfg(retries=3), str(tmp_path)))
    pw = capture._POWER["Ring"]
    assert pw.state is oxy_power.PowerState.RESOURCE_WAIT and pw.cache.retry_count == 0

    capture._STOP = asyncio.Event()
    calls = _fake_pull(monkeypatch, raise_=RuntimeError("device not advertising"))
    _stop_after(monkeypatch, 1)
    _run(capture.autopull_poller(_hourly_cfg(retries=3), str(tmp_path)))
    assert calls == ["hourly"], "one failed attempt per cycle — the backoff owns the retry now"


# ── pull_oxyii_session records every attempt (§10/§21) ──────────────────────────────────────────────
def _quiet_pull_env(monkeypatch):
    async def no_sleep(_s): return None
    monkeypatch.setattr(capture.asyncio, "sleep", no_sleep)

    async def hci(): return None
    monkeypatch.setattr(capture, "adapter_hci", hci)
    capture.STATUS["devices"]["Ring"] = {"connected": False}


def test_a_committed_pull_is_recorded_with_its_files_and_bytes(tmp_path, monkeypatch):
    import pull_session
    _quiet_pull_env(monkeypatch)
    f = tmp_path / "Wellue_O2Ring-S_S1_20260905_STORED.dat"
    f.write_bytes(b"x" * 123)
    ghost = str(tmp_path / "vanished.dat")               # a file the pull named but that is gone: 0, not a raise

    async def fake_pull(address, out_dir, **kw):
        return [str(f), ghost]
    monkeypatch.setattr(pull_session, "pull", fake_pull)
    r = _run(capture.pull_oxyii_session(_ring(), str(tmp_path), trigger="charger"))
    assert r["ok"] is True
    pw = capture._POWER["Ring"]
    assert pw.state is oxy_power.PowerState.RADIO_IDLE
    last = capture.STATUS["power"]["Ring"]["last_attempt"]
    assert last["trigger"] == "charger" and last["ok"] is True
    assert last["files"] == 2 and last["bytes"] == 123
    assert pw.cache.synced_this_idle is True and pw.cache.retry_count == 0
    assert pw.counters.harvests_ok == 1 and pw.counters.harvest_attempts == 1


def test_a_failed_pull_is_a_typed_strike(tmp_path, monkeypatch):
    import pull_session
    from bleak.exc import BleakError
    _quiet_pull_env(monkeypatch)

    async def fake_pull(address, out_dir, **kw):
        raise BleakError("Device with address D1:98:62:7C:92:B3 was not found")
    monkeypatch.setattr(pull_session, "pull", fake_pull)
    with pytest.raises(BleakError):
        _run(capture.pull_oxyii_session(_ring(), str(tmp_path), trigger="hourly"))
    pw = capture._POWER["Ring"]
    assert pw.state is oxy_power.PowerState.ERROR_BACKOFF
    assert pw.cache.retry_count == 1
    assert pw.cache.last_failure is oxy_power.classify_exception(BleakError("… was not found"))
    assert capture.STATUS["power"]["Ring"]["last_attempt"]["ok"] is False
    assert not capture._OXYII_PAUSE.is_set(), "the live capture resumes regardless"


def test_a_timed_out_pull_is_a_TIMEOUT_strike(tmp_path, monkeypatch):
    """No `_quiet_pull_env` here: `capture.asyncio` IS the asyncio module, so a no-op sleep would also
    neuter the never-returning pull and the deadline could not elapse. Real (short) sleeps instead."""
    import pull_session

    async def hci(): return None
    monkeypatch.setattr(capture, "adapter_hci", hci)
    capture.STATUS["devices"]["Ring"] = {"connected": False}

    async def never(*a, **k): await asyncio.sleep(3600)
    monkeypatch.setattr(pull_session, "pull", never)
    monkeypatch.setattr(capture, "_OFFLINE_OP_TIMEOUT_S", 0.01)

    async def go():
        with pytest.raises(asyncio.TimeoutError):
            await capture.pull_oxyii_session(_ring(), str(tmp_path))
    _run(go())
    pw = capture._POWER["Ring"]
    assert pw.cache.last_failure is oxy_power.FailureClass.TIMEOUT
    assert pw.state is oxy_power.PowerState.ERROR_BACKOFF
    assert capture.STATUS["power"]["Ring"]["last_attempt"]["trigger"] == "manual"


def test_three_strikes_cool_the_ring_down_for_half_an_hour(tmp_path, monkeypatch):
    """§10 — the whole chain through the real pull wrapper: strike, strike, COOLDOWN; then the charger
    poller refuses for STRIKE_COOLDOWN_S."""
    import pull_session
    _quiet_pull_env(monkeypatch)

    async def fake_pull(address, out_dir, **kw):
        raise RuntimeError("0xE1 timeout")
    monkeypatch.setattr(pull_session, "pull", fake_pull)
    for _ in range(3):
        with pytest.raises(RuntimeError):
            _run(capture.pull_oxyii_session(_ring(), str(tmp_path), trigger="charger"))
    pw = capture._POWER["Ring"]
    assert pw.state is oxy_power.PowerState.COOLDOWN
    assert pw.counters.cooldowns == 1
    now = capture._time.monotonic()
    assert pw.cache.cooldown_until - now == pytest.approx(oxy_power.STRIKE_COOLDOWN_S, abs=5)
    assert not pw.attempt_allowed(now).allowed


# ── the presence observer picks its cadence (§3/§6/§7) ──────────────────────────────────────────────
def _present(now):
    import oxy_presence
    return oxy_presence.Presence(state=oxy_presence.OxyPresState.PRESENT, sightings=1, last_seen=now,
                                 reason="advert seen")


def _absent(now):
    import oxy_presence
    return oxy_presence.Presence(state=oxy_presence.OxyPresState.ABSENT, sightings=0, last_seen=None,
                                 reason="no advert")


def test_scan_pause_is_the_window_when_no_ring_is_named():
    capture._PRESENCE[RING] = _absent(0.0)             # a presence with no name has no engine to feed
    assert capture._power_scan_pause({}, 10.0, 1.0) == 10.0
    assert capture._POWER == {}


def test_scan_pause_follows_the_presence_transition_low_moderate_responsive():
    capture._PRESENCE_NAMES[RING] = "Ring"
    capture.STATUS["devices"]["Ring"] = {}
    capture._PRESENCE[RING] = _absent(0.0)
    assert capture._power_scan_pause({}, 10.0, 1.0) == oxy_power.SCAN_LOW.interval_s
    pw = capture._POWER["Ring"]
    assert pw.state is oxy_power.PowerState.PASSIVE_SCAN
    assert pw.counters.scan_windows == 1 and pw.counters.sightings == 0

    capture._PRESENCE[RING] = _present(2.0)
    assert capture._power_scan_pause({RING: 2.0}, 10.0, 2.0) == oxy_power.SCAN_MODERATE.interval_s
    assert pw.state is oxy_power.PowerState.DEVICE_DETECTED
    assert pw.counters.sightings == 1 and pw.cache.generation == 1

    capture.STATUS["devices"]["Ring"] = {"oxy_recording": "end_candidate"}     # a session just closed
    assert capture._power_scan_pause({RING: 3.0}, 10.0, 3.0) == oxy_power.SCAN_RESPONSIVE.interval_s
    assert capture.STATUS["power"]["Ring"]["counters"]["scan_seconds"] == 30.0

    capture._PRESENCE[RING] = _absent(4.0)
    capture.STATUS["devices"]["Ring"] = {}
    assert capture._power_scan_pause({}, 10.0, 4.0) == oxy_power.SCAN_LOW.interval_s
    assert pw.state is oxy_power.PowerState.PASSIVE_SCAN


def test_scan_pause_is_the_shortest_interval_across_rings():
    """One radio, many rings — the observer runs at the cadence the most demanding ring needs."""
    other = "AA:BB:CC:DD:EE:FF"
    capture._PRESENCE_NAMES.update({RING: "Ring", other: "Ring2"})
    capture.STATUS["devices"].update({"Ring": {}, "Ring2": {}})
    capture._PRESENCE[RING] = _absent(0.0)
    capture._PRESENCE[other] = _present(0.0)
    assert capture._power_scan_pause({other: 0.0}, 10.0, 1.0) == oxy_power.SCAN_MODERATE.interval_s


def test_the_presence_loop_sleeps_for_the_policy_interval_not_the_window(monkeypatch):
    """The fixed `sleep(window_s)` was a 50 % duty cycle around the clock; with every ring absent the
    loop now sleeps SCAN_LOW.interval_s between 10 s windows."""
    import oxy_presence
    capture._PRESENCE_NAMES[RING] = "Ring"
    capture.STATUS["devices"]["Ring"] = {}
    slept = []

    async def scan(window):
        return {}

    async def sleep(s):
        slept.append(s)
        capture._STOP.set()
    monkeypatch.setattr(oxy_presence, "witness_chain", lambda w: [])
    monkeypatch.setattr(oxy_presence, "witness_summary", lambda ch: "")
    _run(capture._presence_scan_loop(addresses=[RING], window_s=10.0, scan=scan, sleep=sleep, mono=lambda: 100.0))
    assert slept == [oxy_power.SCAN_LOW.interval_s]
