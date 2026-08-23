# tepna-capture — tests/test_cpap_stream.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""cpap_stream — the CPAP live waveform → telemetry bus pump.

Driven against a fake AS11 (canned plaintext frames + identity cipher, exactly as test_as11_pull does)
and a fake bus that records register/push. What must hold: the encrypted session is established, both
BRP streams are registered with the derived rate, each StreamData batch's samples are pushed under the
matching bus key, a `should_stop` event ends the pump cleanly, and the gate refuses while a wearable is
live but permits an otherwise-idle box.
"""
import asyncio
import collections
import json
import logging

import as11_link as L
import cpap_stream as CS
import pytest

PAIR_KEY = b"K" * 32
NONCE = bytes.fromhex("00112233445566778899aabbccddeeff")


def _identity_factory(session_key):
    # identity seal/unseal — frames are plaintext JSON on the wire. Asserts the session key it is handed
    # is the real 32-byte output of establish(): a mutant that skips establish (key=None) is caught here.
    assert isinstance(session_key, bytes) and len(session_key) == 32, "cipher must get the derived 32-byte key"
    return (lambda p: p), (lambda w: w)


def _enc(obj):
    return (L.VCID_ENC_RX, json.dumps(obj).encode())


def _plain(obj):
    return (L.VCID_PLAIN_RX, json.dumps(obj).encode())


def _handshake():
    challenge = b"chal-16-bytes!!!"
    return [
        _plain({"id": 10, "result": {"challenge": challenge.hex(), "nonce": NONCE.hex()}}),
        _plain({"id": 11, "result": {"confirmation": True}}),
    ]


def _ack(stream_id=1):
    return _enc({"id": 16, "result": {
        "dataIds": [{"dataId": "PatientFlow", "valid": True}, {"dataId": "MaskPressure", "valid": True}],
        "streamId": stream_id}})


def _data(flow, pressure, stream_id=1):
    return _enc({"jsonrpc": "2.0", "method": "StreamData", "params": {
        "data": [{"PatientFlow": flow}, {"MaskPressure": pressure}],
        "intervalMs": 40, "startTime": "2026-08-23T01:30:28.730Z", "streamId": stream_id}})


class FakeDev:
    def __init__(self, frames):
        self._f = collections.deque(frames)
        self.written = []

    async def write(self, frame):
        self.written.append(frame)

    async def recv_frame(self):
        return self._f.popleft()


class FakeBus:
    def __init__(self):
        self.registered = {}
        self.pushed = []

    def register(self, key, label, unit, fs, chans=1, labels=()):
        self.registered[key] = {"label": label, "unit": unit, "fs": fs, "chans": chans}

    def push(self, stream, values, fs=None, dev_ns=None):
        self.pushed.append((stream, list(values), fs))


class _RecordingSink:
    """A minimal extra-sink (open/on_batch/close) that records what the pump fed it — stands in for the
    EDF writer so the fan-out and the drain-on-disconnect can be asserted without touching a file."""

    def __init__(self):
        self.opened = None
        self.batches = []
        self.closed = 0

    def open(self, channels, fs):
        self.opened = (channels, fs)

    def on_batch(self, batch):
        self.batches.append(batch)

    def close(self):
        self.closed += 1


def _run(coro):
    return asyncio.run(coro)


# ── stream_to_bus ──────────────────────────────────────────────────────────────
def test_registers_both_channels_and_pushes_each_batch():
    dev = FakeDev(_handshake() + [
        _ack(),
        _data([0.1, 0.2], [5.0, 5.1]),
        _data([0.3, 0.4], [5.2, 5.3]),
    ])
    bus = FakeBus()
    pushed = _run(CS.stream_to_bus(bus, dev.write, dev.recv_frame, PAIR_KEY, "cid-9",
                                   cipher_factory=_identity_factory, max_batches=2))
    assert pushed == 2
    # both BRP streams registered with the FULL presentation: key, label, unit, derived rate, 1 channel
    assert set(bus.registered) == {"cpap_flow", "cpap_pressure"}
    reg = bus.registered["cpap_flow"]
    assert reg["fs"] == 25.0, "rate derived from the 40 ms interval → 25 Hz"
    assert reg["unit"] == "L/min" and reg["label"] == "CPAP Flow" and reg["chans"] == 1
    # the clientId reached the handshake and the sample interval reached StartStream (both on the wire)
    sent = [json.loads(L.fig_unframe(f)[1]) for f in dev.written]
    req = next(m for m in sent if m.get("method") == "RequestSession")
    assert req["params"]["clientId"] == "cid-9", "the clientId must reach RequestSession, not be dropped"
    start = next(m for m in sent if m.get("method") == "StartStream")
    assert start["params"]["sampleIntervalMs"] == 40, "the sample interval must reach StartStream"
    # each batch's samples pushed under the right key, in order
    flow = [vals for key, vals, _fs in bus.pushed if key == "cpap_flow"]
    pressure = [vals for key, vals, _fs in bus.pushed if key == "cpap_pressure"]
    assert flow == [[0.1, 0.2], [0.3, 0.4]]
    assert pressure == [[5.0, 5.1], [5.2, 5.3]]


def test_pushes_use_the_derived_rate():
    dev = FakeDev(_handshake() + [_ack(), _data([1.0], [2.0])])
    bus = FakeBus()
    _run(CS.stream_to_bus(bus, dev.write, dev.recv_frame, PAIR_KEY, "cid",
                          cipher_factory=_identity_factory, max_batches=1))
    assert all(fs == 25.0 for _k, _v, fs in bus.pushed)


def test_a_channel_absent_from_a_batch_is_simply_not_pushed():
    """A batch that carries only flow must push only flow — never a fabricated empty pressure frame."""
    dev = FakeDev(_handshake() + [
        _ack(),
        _enc({"jsonrpc": "2.0", "method": "StreamData", "params": {
            "data": [{"PatientFlow": [0.9]}], "intervalMs": 40,
            "startTime": "2026-08-23T01:30:28.730Z", "streamId": 1}}),
    ])
    bus = FakeBus()
    _run(CS.stream_to_bus(bus, dev.write, dev.recv_frame, PAIR_KEY, "cid",
                          cipher_factory=_identity_factory, max_batches=1))
    keys = {key for key, _v, _fs in bus.pushed}
    assert keys == {"cpap_flow"}, "pressure had no samples this batch — must not be pushed"


def test_an_empty_sample_list_is_not_pushed():
    dev = FakeDev(_handshake() + [
        _ack(),
        _data([], [3.0]),   # flow present but empty → skip flow, push pressure
    ])
    bus = FakeBus()
    _run(CS.stream_to_bus(bus, dev.write, dev.recv_frame, PAIR_KEY, "cid",
                          cipher_factory=_identity_factory, max_batches=1))
    assert {key for key, _v, _fs in bus.pushed} == {"cpap_pressure"}


def test_should_stop_ends_the_pump_between_batches():
    stop = asyncio.Event()
    stop.set()   # already set: the pump pushes its first batch, then stops before a second
    dev = FakeDev(_handshake() + [_ack(), _data([0.1], [5.0]), _data([0.2], [5.1])])
    bus = FakeBus()
    pushed = _run(CS.stream_to_bus(bus, dev.write, dev.recv_frame, PAIR_KEY, "cid",
                                   cipher_factory=_identity_factory, should_stop=stop))
    assert pushed == 1, "a set should_stop must end the pump after the current batch"


def test_a_custom_channel_map_is_honoured():
    dev = FakeDev(_handshake() + [
        _enc({"id": 16, "result": {"dataIds": [{"dataId": "SpO2", "valid": True}], "streamId": 1}}),
        _enc({"jsonrpc": "2.0", "method": "StreamData", "params": {
            "data": [{"SpO2": [98.0]}], "intervalMs": 1000,
            "startTime": "2026-08-23T01:30:28.730Z", "streamId": 1}}),
    ])
    bus = FakeBus()
    _run(CS.stream_to_bus(bus, dev.write, dev.recv_frame, PAIR_KEY, "cid",
                          channels={"SpO2": ("cpap_spo2", "CPAP SpO₂", "%")},
                          sample_interval_ms=1000, cipher_factory=_identity_factory, max_batches=1))
    assert set(bus.registered) == {"cpap_spo2"}
    assert bus.registered["cpap_spo2"]["fs"] == 1.0, "1000 ms interval → 1 Hz"
    # the chosen interval must reach StartStream too — not silently fall back to the 40 ms default
    start = next(json.loads(L.fig_unframe(f)[1]) for f in dev.written
                 if json.loads(L.fig_unframe(f)[1]).get("method") == "StartStream")
    assert start["params"]["sampleIntervalMs"] == 1000


# ── extra sinks: PEERS on the one seam + drain-on-disconnect ─────────────────────
def test_an_extra_sink_is_opened_fed_every_batch_and_closed():
    """The EDF writer (here a recording stand-in) is a PEER of the bus on ONE loop: opened once with the
    channel map + derived rate, handed every batch the bus is, and closed on clean completion."""
    sink = _RecordingSink()
    dev = FakeDev(_handshake() + [_ack(), _data([0.1], [5.0]), _data([0.2], [5.1])])
    bus = FakeBus()
    delivered = _run(CS.stream_to_bus(bus, dev.write, dev.recv_frame, PAIR_KEY, "cid",
                                      cipher_factory=_identity_factory, extra_sinks=[sink], max_batches=2))
    assert delivered == 2
    assert sink.opened == (CS.BRP_CHANNELS, 25.0), "opened with the channel map + derived rate"
    assert len(sink.batches) == 2, "fed every batch the bus was"
    assert sink.closed == 1, "closed exactly once on clean completion"


def test_a_dropped_link_still_FINALIZES_the_sink_with_every_delivered_batch():
    """⚠️ DRAIN-ON-DISCONNECT. A link drop raises out of the batch loop, but every batch already delivered
    — INCLUDING one that arrived late, at the instant of the drop — must reach the sink, and the sink must
    be CLOSED so its file is finalized. A disconnect is not end-of-data. Here the third frame is the late
    fragment; the read after it fails (the link is gone), and all three batches must survive that."""
    sink = _RecordingSink()
    # handshake + ack + THREE data frames, then the recv underflows (IndexError) → the link is gone
    dev = FakeDev(_handshake() + [_ack(), _data([0.1], [5.0]), _data([0.2], [5.1]), _data([0.3], [5.2])])
    bus = FakeBus()
    with pytest.raises(IndexError):     # the drop propagates — the caller (controller task) handles it
        _run(CS.stream_to_bus(bus, dev.write, dev.recv_frame, PAIR_KEY, "cid",
                              cipher_factory=_identity_factory, extra_sinks=[sink]))
    assert len(sink.batches) == 3, "all three delivered batches — incl. the late one — reached the sink"
    assert sink.closed == 1, "the sink was finalized despite the disconnect, not left half-open"


# ── gate — on-body, NOT stream-active (single-sourced on telemetry.on_body) ─────────────────────────────
def _dev(connected=True, worn=None, charging=False):
    return {"connected": connected, "worn": worn, "charging": charging}


def test_gate_refuses_while_a_sensor_is_on_the_body():
    reason = CS.gate({"Polar H10": _dev(worn=True), "O2Ring": _dev(connected=False)})
    assert reason and "Polar H10" in reason and "on the body" in reason


def test_gate_permits_when_every_sensor_is_charging():
    """THE fix: docked sensors report connected=True while producing nothing, and blocking on that made
    the gate unreachable exactly when a capture is safest (the 2026-07-26 bug). A charging device is not
    on a body, so it must NOT block — matching cpap_harvest.blocking_devices."""
    assert CS.gate({"O2Ring": _dev(worn=False, charging=True),
                    "Verity": _dev(worn=False, charging=True)}) is None


def test_gate_permits_a_disconnected_sensor():
    assert CS.gate({"Polar H10": _dev(connected=False)}) is None


def test_gate_blocks_on_unknown_worn_conservatively():
    """`worn is None` (unknown) blocks, like the harvest — refusing costs only a retry, and transmitting
    beside a possibly-worn sensor is the risk this exists to avoid."""
    assert CS.gate({"Polar H10": _dev(worn=None)}) is not None


def test_gate_permits_an_empty_or_none_device_map():
    assert CS.gate({}) is None and CS.gate(None) is None


def test_gate_reports_blocking_sensors_sorted():
    reason = CS.gate({"Verity": _dev(worn=True), "H10": _dev(worn=True)})
    assert "H10" in reason and "Verity" in reason
    assert reason.index("H10") < reason.index("Verity"), "named in sorted order"


def test_gate_DISABLED_permits_even_with_a_sensor_on_the_body():
    """⚠️ OWNER ORDER 2026-08-23 (supersedes findings-spec §13 conservative-semantics). With the coexistence
    gate DISABLED (enabled=False — the daemon's default), a sensor on the body no longer blocks: gate
    returns None even for worn=True AND the conservative worn=None. The blocking mechanism stays in code;
    enabled=True restores it. Only the default changed, and the condition is LOGGED, not silently dropped."""
    assert CS.gate({"Polar H10": _dev(worn=True)}, enabled=False) is None
    assert CS.gate({"Polar H10": _dev(worn=None)}, enabled=False) is None


def test_on_body_wearables_lists_the_condition_sorted():
    """The on-body set the gate is about, exposed so it can be LOGGED when the gate is disabled. Sorted;
    charging/off-body/disconnected excluded (same predicate the gate uses)."""
    assert CS.on_body_wearables({"Verity": _dev(worn=True), "H10": _dev(worn=True),
                                 "Ring": _dev(worn=False, charging=True)}) == ["H10", "Verity"]
    assert CS.on_body_wearables({}) == [] and CS.on_body_wearables(None) == []


# ── LiveStreamController ─────────────────────────────────────────────────────────
class _ControllerBus(FakeBus):
    def __init__(self, meta=None):
        super().__init__()
        self._meta = meta or []
        self.unregistered = []

    def meta(self):
        return self._meta

    def unregister(self, key):
        self.unregistered.append(key)


def _creds():
    return {"masterPairKey": "aa" * 32, "clientId": "cid-1"}


def _idle_devices():
    return {}   # no device on a body → the gate permits


def _worn_devices():
    return {"Polar H10": _dev(worn=True)}   # a sensor on the body → the gate refuses


async def _idle_pump(bus, write, recv_frame, pk, cid, *, channels=None, should_stop=None):
    """A pump that blocks until asked to stop — stands in for a live stream while the controller runs."""
    while should_stop is None or not should_stop.is_set():
        await asyncio.sleep(0.005)
    return 0


def _recording_pump():
    """A pump that RECORDS every argument the controller forwards, then blocks until stop. Lets a test
    pin that _start wires the bus, transport, key, clientId, channels and stop-event through correctly —
    without it, dropping or swapping any of those arguments is an invisible mutation."""
    seen = {}

    async def pump(bus, write, recv_frame, pk, cid, *, channels=None, should_stop=None):
        seen.update(bus=bus, write=write, recv_frame=recv_frame, pk=pk, cid=cid,
                    channels=channels, should_stop=should_stop)
        while should_stop is None or not should_stop.is_set():
            await asyncio.sleep(0.005)
        return 0
    return pump, seen


def _connector():
    events = {"connected": 0, "disconnected": 0}

    async def connect():
        events["connected"] += 1

        async def write(_f):
            pass

        async def recv_frame():
            await asyncio.sleep(3600)   # never delivers in the test; the pump is the fake above

        async def disconnect():
            events["disconnected"] += 1
        return write, recv_frame, disconnect
    return connect, events


def test_controller_start_spawns_a_stream_and_stop_tears_it_down():
    async def go():
        connect, events = _connector()
        bus = _ControllerBus()
        pump, seen = _recording_pump()
        c = CS.LiveStreamController(bus, connect, _creds, _idle_devices, pump=pump)
        started = await c.op("start")
        assert started["ok"] is True and started["streaming"] is True
        assert set(started["channels"]) == {"cpap_flow", "cpap_pressure"}
        assert events["connected"] == 1 and c._running()
        await asyncio.sleep(0.01)   # let the spawned task run once so the pump records its arguments
        # the pump was wired with EVERY argument from the controller — bus, transport, the key decoded
        # from the creds, the clientId, the channel map, and a stop Event. Pins each forward.
        assert seen["bus"] is bus
        assert seen["pk"] == bytes.fromhex("aa" * 32) and seen["cid"] == "cid-1"
        assert seen["channels"] == CS.BRP_CHANNELS
        assert isinstance(seen["should_stop"], asyncio.Event)
        running_task = c._task    # grab it before stop nulls the reference
        stopped = await c.op("stop")
        assert stopped == {"ok": True, "streaming": False}
        assert events["disconnected"] == 1
        assert set(bus.unregistered) == {"cpap_flow", "cpap_pressure"}
        assert not c._running()
        # the running task must actually have been cancelled — not merely detached. A stop that only
        # cancels a task it thinks is DONE (an inverted guard) would leave this one running.
        assert running_task.cancelled(), "stop must cancel the live task, not leak it"
    _run(go())


def test_controller_passes_a_fresh_edf_sink_to_the_pump_when_configured():
    """With an edf_sink_factory, _start builds a FRESH sink per session (named from that session's device
    start_time) and hands it to the pump as an extra_sink, making the on-disk EDF a peer of the bus.
    Without the factory — every other controller test — the kwarg is never passed, which is exactly why
    the bus-only pumps stay untouched."""
    async def go():
        connect, _ = _connector()
        made = []

        def factory():
            s = _RecordingSink()
            made.append(s)
            return s

        seen = {}

        async def pump(bus, write, recv_frame, pk, cid, *, channels=None, extra_sinks=None, should_stop=None):
            seen["extra_sinks"] = extra_sinks
            while should_stop is None or not should_stop.is_set():
                await asyncio.sleep(0.005)
            return 0

        c = CS.LiveStreamController(_ControllerBus(), connect, _creds, _idle_devices,
                                    pump=pump, edf_sink_factory=factory)
        await c.op("start")
        await asyncio.sleep(0.01)
        assert len(made) == 1, "one fresh sink built for the session"
        assert seen["extra_sinks"] == made, "the sink is handed to the pump as an extra_sink"
        await c.op("stop")
    _run(go())


def test_controller_start_is_idempotent_while_running():
    async def go():
        connect, events = _connector()
        c = CS.LiveStreamController(_ControllerBus(), connect, _creds, _idle_devices, pump=_idle_pump)
        await c.op("start")
        again = await c.op("start")
        assert again["already"] is True and events["connected"] == 1, "no second connect while running"
        await c.op("stop")
    _run(go())


def test_controller_with_coexistence_gate_ENABLED_refuses_while_a_sensor_is_on_the_body():
    """The mechanism is intact for anyone who opts back in: with coexistence_gate=True, an on-body sensor
    still refuses BEFORE the radio opens. The both-ways §14 pin, half one — enabled blocks."""
    async def go():
        connect, events = _connector()
        c = CS.LiveStreamController(_ControllerBus(), connect, _creds, _worn_devices, pump=_idle_pump,
                                    coexistence_gate=True)
        res = await c.op("start")
        assert res["ok"] is False and "Polar H10" in res["error"]
        assert events["connected"] == 0, "the gate must refuse BEFORE opening the radio"
    _run(go())


def test_controller_with_coexistence_gate_DISABLED_starts_beside_an_on_body_sensor_and_logs(caplog):
    """⚠️ THE OWNER ORDER (2026-08-23, supersedes findings-spec §13). The DEFAULT is DISABLED, so a stream
    STARTS even with a sensor on the body — but logs the condition ONCE so a 2.4 GHz congestion post-mortem
    keeps it. The both-ways §14 pin, half two — disabled allows + logs."""
    async def go():
        connect, events = _connector()
        c = CS.LiveStreamController(_ControllerBus(), connect, _creds, _worn_devices, pump=_idle_pump)
        res = await c.op("start")            # default: coexistence_gate=False
        assert res["ok"] is True and res["streaming"] is True, "no refusal — the gate is disabled"
        assert events["connected"] == 1, "the radio opened despite the on-body sensor"
        await c.op("stop")
        return res
    with caplog.at_level(logging.WARNING, logger="tepna.cpap"):
        _run(go())
    assert any("coexistence gate DISABLED" in r.message and "Polar H10" in r.message
               for r in caplog.records), "the on-body condition is logged for the post-mortem"


def test_controller_with_coexistence_gate_ENABLED_starts_normally_when_nothing_on_body(caplog):
    """Enabled gate + nothing on-body: starts normally, and does NOT emit the disabled-log line (that log
    belongs only to the disabled path). Covers the enabled-and-permitted branch."""
    async def go():
        connect, events = _connector()
        c = CS.LiveStreamController(_ControllerBus(), connect, _creds, _idle_devices, pump=_idle_pump,
                                    coexistence_gate=True)
        res = await c.op("start")
        assert res["ok"] is True and events["connected"] == 1
        await c.op("stop")
    with caplog.at_level(logging.WARNING, logger="tepna.cpap"):
        _run(go())
    assert not any("coexistence gate DISABLED" in r.message for r in caplog.records), \
        "no disabled-log when the gate is enabled"


def test_controller_refuses_to_start_without_credentials():
    async def go():
        connect, events = _connector()
        c = CS.LiveStreamController(_ControllerBus(), connect, lambda: None, _idle_devices, pump=_idle_pump)
        res = await c.op("start")
        assert res["ok"] is False and "pair the CPAP" in res["error"]
        assert events["connected"] == 0
    _run(go())


def test_controller_stop_is_idempotent_when_not_running():
    async def go():
        connect, _ = _connector()
        c = CS.LiveStreamController(_ControllerBus(), connect, _creds, _idle_devices, pump=_idle_pump)
        assert await c.op("stop") == {"ok": True, "streaming": False}
    _run(go())


def test_controller_stop_survives_a_pump_that_errored_and_a_disconnect_that_raises():
    """Robustness for the live daemon: a stream task that already died with an exception, and a
    disconnect that itself throws, must still leave a clean {streaming:False} and unregister the bus
    keys — the stop path can never crash the monitor."""
    async def boom_pump(bus, write, recv_frame, pk, cid, *, channels=None, should_stop=None):
        raise RuntimeError("stream died")

    async def connect():
        async def write(_f):
            pass

        async def recv_frame():
            await asyncio.sleep(3600)

        async def disconnect():
            raise OSError("adapter vanished")
        return write, recv_frame, disconnect

    async def go():
        bus = _ControllerBus()
        c = CS.LiveStreamController(bus, connect, _creds, _idle_devices, pump=boom_pump)
        await c.op("start")
        await asyncio.sleep(0.01)   # let the pump raise
        stopped = await c.op("stop")
        assert stopped == {"ok": True, "streaming": False}
        assert set(bus.unregistered) == {"cpap_flow", "cpap_pressure"}
    _run(go())


def test_controller_stop_handles_a_task_that_raises_on_cancel():
    """If the running pump turns its cancellation into a different exception, stop must swallow it and
    still finish cleanly — the generic-exception arm of the await-after-cancel, distinct from the plain
    CancelledError arm."""
    async def stubborn_pump(bus, write, recv_frame, pk, cid, *, channels=None, should_stop=None):
        try:
            while not should_stop.is_set():
                await asyncio.sleep(0.005)
        except asyncio.CancelledError:
            raise RuntimeError("teardown failed mid-cancel") from None

    async def go():
        connect, events = _connector()
        c = CS.LiveStreamController(_ControllerBus(), connect, _creds, _idle_devices, pump=stubborn_pump)
        await c.op("start")
        await asyncio.sleep(0.01)   # ensure the task is genuinely running (not done) before we stop it
        stopped = await c.op("stop")
        assert stopped == {"ok": True, "streaming": False}
        assert events["disconnected"] == 1
    _run(go())


# ── capture._load_as11_creds (the daemon creds loader) ───────────────────────────
def test_load_as11_creds_reads_a_complete_file(tmp_path):
    import capture
    p = tmp_path / "as11_creds.json"
    p.write_text(json.dumps({"masterPairKey": "aa" * 32, "clientId": "c", "ble_addr": "04:CD:15:3A:0B:BD"}))
    creds = capture._load_as11_creds(str(p))
    assert creds["clientId"] == "c" and creds["ble_addr"] == "04:CD:15:3A:0B:BD"


def test_load_as11_creds_returns_none_for_missing_malformed_or_incomplete(tmp_path):
    import capture
    assert capture._load_as11_creds(str(tmp_path / "nope.json")) is None
    bad = tmp_path / "bad.json"
    bad.write_text("{not json")
    assert capture._load_as11_creds(str(bad)) is None
    partial = tmp_path / "partial.json"
    partial.write_text(json.dumps({"clientId": "c"}))   # no key/addr
    assert capture._load_as11_creds(str(partial)) is None
    empty_val = tmp_path / "empty.json"
    empty_val.write_text(json.dumps({"masterPairKey": "", "clientId": "c", "ble_addr": "x"}))
    assert capture._load_as11_creds(str(empty_val)) is None, "an empty required value is not complete"


# ── capture._build_cpap_controller (pure wiring) ─────────────────────────────────
def test_build_controller_defaults_creds_beside_config_and_uses_hci1(tmp_path):
    import capture
    cfg = {"cpap": {}}
    ctl = capture._build_cpap_controller(object(), cfg, str(tmp_path / "config.yaml"))
    # the creds loader closes over the default path (beside the config file)
    assert isinstance(ctl, __import__("cpap_stream").LiveStreamController)
    (tmp_path / "as11_creds.json").write_text(json.dumps(
        {"masterPairKey": "aa" * 32, "clientId": "c", "ble_addr": "x"}))
    assert ctl._load_creds()["clientId"] == "c", "default creds_path is beside the config file"


def test_build_controller_honours_an_explicit_creds_path_and_adapter(tmp_path):
    import capture
    creds = tmp_path / "elsewhere.json"
    creds.write_text(json.dumps({"masterPairKey": "bb" * 32, "clientId": "z", "ble_addr": "y"}))
    cfg = {"cpap": {"ble_stream": {"creds_path": str(creds), "adapter": "hci3"}}}
    ctl = capture._build_cpap_controller(object(), cfg, str(tmp_path / "config.yaml"))
    assert ctl._load_creds()["clientId"] == "z"


def test_build_controller_wires_a_VERIFIED_edf_sink_now_that_the_pin_landed(tmp_path):
    """Setting cpap.ble_stream.edf_dir enables the on-disk EDF sink. Post-pin (2026-08-23): flow_scale_verified
    now DEFAULTS TRUE — the flow unit is confirmed L/s and the clock is local-civil, so files land in the
    committed root, not PENDING. Setting flow_scale_verified: false re-quarantines. Serial from config."""
    import capture
    import cpap_edf_writer
    out = tmp_path / "cpap-ble"
    cfg = {"cpap": {"ble_stream": {"edf_dir": str(out), "serial": "23211234567"}}}
    ctl = capture._build_cpap_controller(object(), cfg, str(tmp_path / "config.yaml"))
    assert ctl._edf_sink_factory is not None, "edf_dir enables the sink"
    sink = ctl._edf_sink_factory()
    assert isinstance(sink, cpap_edf_writer.EdfSink)
    assert sink._out_root == str(out) and sink._serial == "23211234567"
    assert sink._verified is True, "verified by default now that the pin confirmed the flow unit"
    # explicit opt-out re-quarantines
    req = {"cpap": {"ble_stream": {"edf_dir": str(out), "flow_scale_verified": False}}}
    assert capture._build_cpap_controller(object(), req, str(tmp_path / "c.yaml"))._edf_sink_factory()._verified is False
    # serial is provisional — an absent config value falls back to a clear placeholder, never a wrong guess
    ctl2 = capture._build_cpap_controller(object(), {"cpap": {"ble_stream": {"edf_dir": str(out)}}},
                                          str(tmp_path / "config.yaml"))
    assert ctl2._edf_sink_factory()._serial == "UNKNOWN"


def test_build_controller_leaves_the_edf_sink_off_without_edf_dir(tmp_path):
    """The mirror: no edf_dir means bus-only — the prior behaviour, no EDF files written."""
    import capture
    ctl = capture._build_cpap_controller(object(), {"cpap": {}}, str(tmp_path / "config.yaml"))
    assert ctl._edf_sink_factory is None


def test_build_controller_coexistence_gate_defaults_DISABLED_and_config_can_enable(tmp_path):
    """Owner order 2026-08-23: the daemon's coexistence gate DEFAULTS to disabled (no config → False);
    setting cpap.ble_stream.coexistence_gate: true restores the block."""
    import capture
    off = capture._build_cpap_controller(object(), {"cpap": {}}, str(tmp_path / "config.yaml"))
    assert off._coexistence_gate is False, "disabled by default per the owner order"
    on = capture._build_cpap_controller(object(), {"cpap": {"ble_stream": {"coexistence_gate": True}}},
                                        str(tmp_path / "config.yaml"))
    assert on._coexistence_gate is True, "config opt-in restores the interlock"


# ── capture._cpap_ble_connect (the bleak I/O edge, mocked) ───────────────────────
class _FakeBleak:
    """Records the bleak calls _cpap_ble_connect makes and lets a test drive the notify callback."""
    instances = []

    def __init__(self, addr, timeout=None, bluez=None):
        self.addr, self.bluez = addr, bluez
        self.connected = False
        self.notify_cb = None
        self.written = []
        self.mtu_size = 100
        _FakeBleak.instances.append(self)

    async def connect(self):
        self.connected = True

    async def start_notify(self, uuid, cb):
        self.notify_cb = cb

    async def write_gatt_char(self, uuid, chunk, response=True):
        self.written.append(bytes(chunk))

    async def disconnect(self):
        self.connected = False


def test_cpap_ble_connect_wires_write_recv_and_disconnect(monkeypatch):
    import as11_link as L
    import capture
    import bleak
    _FakeBleak.instances.clear()
    monkeypatch.setattr(bleak, "BleakClient", _FakeBleak)

    async def go():
        write, recv_frame, disconnect = await capture._cpap_ble_connect("04:CD:15:3A:0B:BD", "hci1")
        client = _FakeBleak.instances[-1]
        assert client.connected and client.bluez == {"adapter": "hci1"}
        # write chunks the frame to (mtu-3) — a 250-byte frame over mtu 100 → step 97 → 3 chunks
        await write(b"x" * 250)
        assert len(client.written) == 3 and b"".join(client.written) == b"x" * 250
        # the notify callback reassembles FIG frames and recv_frame yields them
        frame = L.fig_frame(L.VCID_ENC_RX, b'{"id":1}')
        client.notify_cb(None, frame)
        vcid, payload = await recv_frame()
        assert vcid == L.VCID_ENC_RX and payload == b'{"id":1}'
        await disconnect()
        assert not client.connected
    _run(go())


def test_cpap_ble_connect_without_an_adapter_passes_no_bluez_kwarg(monkeypatch):
    import capture
    import bleak
    _FakeBleak.instances.clear()
    monkeypatch.setattr(bleak, "BleakClient", _FakeBleak)

    async def go():
        await capture._cpap_ble_connect("04:CD:15:3A:0B:BD", None)
        assert _FakeBleak.instances[-1].bluez is None, "no hci → no bluez adapter kwarg"
    _run(go())
