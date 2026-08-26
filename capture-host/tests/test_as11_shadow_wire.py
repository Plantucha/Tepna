# tepna-capture — tests/test_as11_shadow_wire.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The daemon wiring for the AS11 shadow detector: capture._maybe_start_as11_shadow. Covers all three
# branches (disabled → None, enabled-but-no-creds → None, enabled → task) with the seams injected, so
# no radio and no live loop are needed. The bleak connect closure it would build is the only pragma'd
# edge.

from types import SimpleNamespace

import capture


def test_cpap_ble_connect_disconnects_when_start_notify_fails(monkeypatch):
    """THE 27-MINUTE WEDGE, 2026-08-25. `_cpap_ble_connect` opens the BLE link and only LATER returns
    the `disconnect` callable, so anything raising in between leaks the link — and a CONNECTED
    peripheral stops advertising, so every later poll dies BleakDeviceNotFoundError forever. The real
    box needed a manual `bluetoothctl disconnect` to recover. #1770's broad retry made it worse: it
    faithfully retried a link that could never succeed. This asserts the link is CLOSED on the way out."""
    import asyncio as _a
    import sys
    import types

    import capture
    import pytest as _p

    calls = []

    class _FakeClient:
        mtu_size = 23

        def __init__(self, *a, **k):
            pass

        async def connect(self):
            calls.append("connect")

        async def start_notify(self, *a, **k):
            raise RuntimeError("notify refused by the controller")

        async def disconnect(self):
            calls.append("disconnect")

    fake = types.ModuleType("bleak")
    fake.BleakClient = _FakeClient
    monkeypatch.setitem(sys.modules, "bleak", fake)

    with _p.raises(RuntimeError):
        _a.run(capture._cpap_ble_connect("AA:BB:CC:DD:EE:FF", "hci0"))

    assert calls == ["connect", "disconnect"], (
        "the link was opened and NOT closed — this is the leak that wedged the detector; got " + str(calls)
    )


def test_disabled_is_a_noop(tmp_path):
    tasks = []
    assert capture._maybe_start_as11_shadow({}, "cfg.yaml", str(tmp_path), object(), tasks) is None
    assert tasks == []


def test_enabled_but_no_creds_skips(tmp_path):
    tasks = []
    r = capture._maybe_start_as11_shadow(
        {"as11_detector": {"enabled": True}}, str(tmp_path / "cfg.yaml"), str(tmp_path),
        object(), tasks, load_creds=lambda _p: None,
    )
    assert r is None and tasks == []


def test_enabled_starts_shadow_task_and_opens_sidecars(tmp_path):
    tasks = []
    made = []

    def fake_create_task(coro):
        coro.close()  # create the coroutine but do NOT run the loop
        made.append(coro)
        return "TASK"

    async def fake_connect():  # never called (task isn't run), just satisfies the seam
        return None

    ctl = SimpleNamespace(_running=lambda: False)
    r = capture._maybe_start_as11_shadow(
        {"as11_detector": {"enabled": True, "poll_interval_sec": 10}, "cpap": {"ble_stream": {}}},
        str(tmp_path / "cfg.yaml"), str(tmp_path), ctl, tasks,
        load_creds=lambda _p: {"masterPairKey": "00ff", "clientId": "c1", "ble_addr": "AA:BB"},
        connect_factory=fake_connect, create_task=fake_create_task,
    )
    assert r == "TASK" and tasks == ["TASK"] and len(made) == 1
    # both sidecars were opened under root (headers are buffered until the task runs)
    assert (tmp_path / "SESSIONDETECT.csv").exists()
    assert (tmp_path / "AS11CLOCK.csv").exists()


def test_publish_therapy_state_maps_the_machine_state():
    """The monitor could not answer 'is therapy running?' — active/effFs measure PACKET ARRIVAL and
    the AS11 emits 25 Hz of zeros in standby, while `cpap.state` belongs to the SD-harvest job."""
    import capture
    from cpap_supervisor import CPAPSessionSupervisor, Observation, TherapyState

    capture.STATUS.pop("cpap", None)
    sup = CPAPSessionSupervisor()

    d = sup.observe(Observation(host_ms=1000, reachable=True, fg_state=TherapyState.THERAPY,
                                last_therapy_use=5))
    capture._publish_therapy_state(d, None)
    assert capture.STATUS["cpap"]["therapy"] is True
    assert capture.STATUS["cpap"]["fg_state"] == "Therapy"   # the enum VALUE, not the NAME

    d = sup.observe(Observation(host_ms=61000, reachable=True, fg_state=TherapyState.STANDBY,
                                last_therapy_use=5))
    capture._publish_therapy_state(d, None)
    assert capture.STATUS["cpap"]["therapy"] is False

    # UNREACHABLE must be None, NOT False — the shadow poll defers entirely while the stream runs, so
    # "no reading" is the COMMON case and must never render as "not in therapy" (§2.6).
    d = sup.observe(Observation(host_ms=121000, reachable=False))
    capture._publish_therapy_state(d, None)
    assert capture.STATUS["cpap"]["therapy"] is None
    capture.STATUS.pop("cpap", None)


def test_therapy_end_factory_is_off_unless_configured():
    import capture
    assert capture._therapy_end_factory({}) is None                       # absent  -> OFF
    assert capture._therapy_end_factory({"auto_stop": {}}) is None        # present -> still OFF
    assert capture._therapy_end_factory({"auto_stop": {"enabled": False}}) is None


def test_therapy_end_factory_builds_a_sink_with_the_configured_hold():
    import asyncio

    import capture
    f = capture._therapy_end_factory({"auto_stop": {"enabled": True, "flow_eps_lpm": 0.4, "hold_sec": 90}})
    assert f is not None
    sink = f(asyncio.Event())
    assert sink._flow_eps == 0.4 and sink._hold_s == 90.0


def test_resolve_cpap_adapter_maps_a_MAC_to_the_CURRENT_hci(monkeypatch):
    """PERMANENT FIX for adapter renumbering. One reboot on 2026-08-25 moved the Sena hci3 -> hci1 and
    the Intel hci1 -> hci2, so a config saying `hci1` silently changed which radio served the CPAP.
    bleak needs an hciN, so the config may state a MAC and this resolves it EVERY connect."""
    import asyncio

    import capture

    seen = {}

    async def fake_resolve(mac, refresh=False):
        seen["mac"], seen["refresh"] = mac, refresh
        return {"00:01:95:CC:53:02": "hci1"}.get(mac)

    monkeypatch.setattr(capture.link_rssi, "resolve_hci", fake_resolve)

    assert asyncio.run(capture._resolve_cpap_adapter("00:01:95:CC:53:02")) == "hci1"
    assert seen["refresh"] is True, "a cached index is exactly the bug — must bypass the cache"

    # A plain hciN name is passed through untouched (back-compat with every existing config).
    assert asyncio.run(capture._resolve_cpap_adapter("hci0")) == "hci0"
    assert asyncio.run(capture._resolve_cpap_adapter(None)) is None

    # An ABSENT radio returns None (BlueZ default) rather than pretending the pin worked.
    assert asyncio.run(capture._resolve_cpap_adapter("AA:BB:CC:DD:EE:FF")) is None
