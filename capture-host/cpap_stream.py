# tepna-capture — cpap_stream.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# CPAP live waveform → the telemetry bus. The piece that makes a ResMed AS11 flow/pressure trace show
# up in the monitor's Live-streams grid: it runs the encrypted BLE stream (as11_pull.stream) and pushes
# each batch onto the SAME TelemetryBus the wearables use, so the existing SSE endpoint + renderer draw
# it with no new UI. READ-ONLY: nothing here writes a device setting.
#
# TESTABLE BY INJECTION. The transport (write/recv_frame) and the cipher factory are parameters, exactly
# as as11_pull is — so the whole session→stream→push path runs against a fake device with an identity
# cipher, stdlib-only. capture.py supplies the real bleak transport + as11_cipher.make_cipher; the bleak
# connect is the only un-unit-tested edge, and it lives in the daemon shim, not here.
from __future__ import annotations

import asyncio

import as11_cipher
import as11_pull
import telemetry

# The BRP waveforms and their bus presentation. dataId → (bus key, label, unit). The device streams flow
# and mask pressure at the 40 ms BRP cadence; fs is derived from the sample interval, not hard-coded, so
# a caller that picks a different interval gets a truthful rate on the card.
BRP_CHANNELS = {
    "PatientFlow": ("cpap_flow", "CPAP Flow", "L/min"),
    "MaskPressure": ("cpap_pressure", "CPAP Pressure", "cmH₂O"),
}


def gate(status_devices) -> str | None:
    """Refusal reason if a CPAP BLE stream must NOT start right now, else None.

    The bar is the same one the CPAP PULL enforces, single-sourced on `telemetry.on_body`: a 2.4 GHz BLE
    stream must never run while a sensor is ON A BODY, because the transmitter sits beside it. A device
    that is CHARGING or otherwise not on a body is NOT a blocker — a ring on its dock cannot be interfered
    with, and blocking on it made the gate unreachable exactly when a capture is safest (the 2026-07-26
    docked-sensors bug that `cpap_harvest.blocking_devices` records). `status_devices` is the daemon's
    device-status map. Blocks on `on_body is not False` (True OR unknown) — the harvest's conservative
    policy: refusing costs only a retry.
    """
    blocking = sorted(name for name, st in (status_devices or {}).items()
                      if telemetry.on_body(st) is not False)
    if blocking:
        return "a sensor is on the body (" + ", ".join(blocking) + ") — refusing to transmit beside it"
    return None


async def stream_to_bus(bus, write, recv_frame, pair_key, client_id, *,
                        channels=None, extra_sinks=None, sample_interval_ms=40,
                        cipher_factory=as11_cipher.make_cipher, max_batches=None, should_stop=None):
    """Establish the encrypted session, then fan each AS11 StreamData batch out to `bus` AND to any
    `extra_sinks`. Returns the number of batches delivered.

    ONE INGESTION SEAM, PEERS ON IT. The bus card is the built-in consumer; `extra_sinks` (the on-disk
    EDF writer, a future raw sidecar) join it on the SAME batch loop — none is the sole consumer, and a
    new tap is one entry in the list, not a second stream. Each `extra_sink` implements open(channels,fs)
    / on_batch(batch) / close(); the bus is pushed inline as its samples are values, not a file to finalize.

    `channels` maps dataId → (bus_key, label, unit); defaults to flow + pressure. Each stream is
    registered ONCE (so the card shows immediately, even before the first frame), then every batch's
    samples are pushed under the matching bus key. `should_stop` (an asyncio.Event, optional) ends the
    pump cleanly between batches — the monitor's stop button. `cipher_factory` is injectable ONLY for
    tests (an identity cipher over plaintext frames); production uses the real AES factory.

    DRAIN-ON-DISCONNECT. A dropped link raises out of the batch loop (a recv times out with nothing left),
    and a StreamData fragment can even arrive ~230 ms AFTER the drop — the loop consumes any such buffered
    batch before the read fails. So every sink is CLOSED in a finally: a disconnect is never treated as
    end-of-data, and each delivered batch is finalized rather than lost with the exception. The file an
    EDF sink writes is only whole once closed, so this is what makes an interrupted night's EDF readable.
    """
    channels = channels or BRP_CHANNELS
    fs = 1000.0 / sample_interval_ms
    session_key = await as11_pull.establish(pair_key, client_id, write, recv_frame)
    seal, unseal = cipher_factory(session_key)
    for _did, (key, label, unit) in channels.items():
        bus.register(key, label, unit, fs, chans=1)
    sinks = list(extra_sinks or ())
    for s in sinks:
        s.open(channels, fs)
    delivered = 0
    try:
        async for batch in as11_pull.stream(write, recv_frame, seal, unseal, list(channels),
                                            sample_interval_ms=sample_interval_ms, max_batches=max_batches):
            for did, (key, _label, _unit) in channels.items():
                samples = batch["channels"].get(did)
                if samples:
                    bus.push(key, samples, fs)
            for s in sinks:
                s.on_batch(batch)
            delivered += 1
            if should_stop is not None and should_stop.is_set():
                break
    finally:
        for s in sinks:
            s.close()
    return delivered


class LiveStreamController:
    """Start/stop lifecycle for the live CPAP waveform, driven by the monitor's button.

    The daemon injects a `connect` (opens the BLE link on the free radio → write/recv_frame/disconnect)
    and a `load_creds` (reads as11_creds.json). Everything else — the gate, the task, the bus cleanup —
    is here and unit-tested; the only un-covered edge is the bleak connect itself, which lives in the
    daemon shim. One controller per daemon; `op("start"|"stop")` is what the endpoint calls."""

    def __init__(self, bus, connect, load_creds, devices, *, channels=None, pump=stream_to_bus,
                 edf_sink_factory=None):
        self._bus = bus
        self._connect = connect
        self._load_creds = load_creds
        self._devices = devices        # () -> the daemon's device-status map, for the on-body gate
        self._channels = channels or BRP_CHANNELS
        self._pump = pump
        # () -> a fresh on-disk EDF sink for this session, or None to stream to the bus alone. The daemon
        # supplies one; a bus-only controller (and every existing test) leaves it None and is unaffected.
        self._edf_sink_factory = edf_sink_factory
        self._task = None
        self._stop = None
        self._disconnect = None

    def _keys(self):
        return [key for _did, (key, _l, _u) in self._channels.items()]

    def _running(self):
        return self._task is not None and not self._task.done()

    async def op(self, action):
        return await (self._start() if action == "start" else self._stop_op())

    async def _start(self):
        if self._running():
            return {"ok": True, "streaming": True, "already": True, "channels": self._keys()}
        reason = gate(self._devices())
        if reason:
            return {"ok": False, "error": reason}
        creds = self._load_creds()
        if not creds:
            return {"ok": False, "error": "no AS11 credentials on this box — pair the CPAP first"}
        write, recv_frame, disconnect = await self._connect()
        self._disconnect = disconnect
        self._stop = asyncio.Event()
        kw = {"channels": self._channels, "should_stop": self._stop}
        if self._edf_sink_factory is not None:
            # A fresh sink per session — the file is named from this session's device start_time. Only
            # passed when configured, so a bus-only pump (and the injected test pumps) never see the kwarg.
            kw["extra_sinks"] = [self._edf_sink_factory()]
        self._task = asyncio.create_task(self._pump(
            self._bus, write, recv_frame, bytes.fromhex(creds["masterPairKey"]), creds["clientId"], **kw))
        return {"ok": True, "streaming": True, "channels": self._keys()}

    async def _stop_op(self):
        task, disconnect = self._task, self._disconnect
        self._task = self._stop = self._disconnect = None
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            except Exception:  # noqa: BLE001 — a dying stream must not stop us tearing the link down
                pass
        if disconnect is not None:
            try:
                await disconnect()
            except Exception:  # noqa: BLE001 — best-effort link close; never crash the stop path
                pass
        for key in self._keys():
            self._bus.unregister(key)
        return {"ok": True, "streaming": False}
