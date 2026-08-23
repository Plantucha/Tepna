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

# The BRP waveforms and their bus presentation. dataId → (bus key, label, unit). The device streams flow
# and mask pressure at the 40 ms BRP cadence; fs is derived from the sample interval, not hard-coded, so
# a caller that picks a different interval gets a truthful rate on the card.
BRP_CHANNELS = {
    "PatientFlow": ("cpap_flow", "CPAP Flow", "L/min"),
    "MaskPressure": ("cpap_pressure", "CPAP Pressure", "cmH₂O"),
}


def gate(meta) -> str | None:
    """Refusal reason if a CPAP BLE stream must NOT start right now, else None.

    The bar is the same one the CPAP pull enforces: a 2.4 GHz BLE stream must never run while a wearable
    is delivering, because the transmitter sits beside the sensors it would interfere with. `meta` is
    `bus.meta()`; any ACTIVE stream that is not one of our own CPAP keys is a live wearable and blocks us.
    """
    ours = {k for _did, (k, _l, _u) in BRP_CHANNELS.items()}
    live = [m["key"] for m in meta if m.get("active") and m["key"] not in ours]
    if live:
        return "wearable capture is live (" + ", ".join(sorted(live)) + ") — refusing to transmit beside the sensors"
    return None


async def stream_to_bus(bus, write, recv_frame, pair_key, client_id, *,
                        channels=None, sample_interval_ms=40, cipher_factory=as11_cipher.make_cipher,
                        max_batches=None, should_stop=None):
    """Establish the encrypted session, then pump AS11 StreamData batches onto `bus`. Returns the number
    of batches pushed.

    `channels` maps dataId → (bus_key, label, unit); defaults to flow + pressure. Each stream is
    registered ONCE (so the card shows immediately, even before the first frame), then every batch's
    samples are pushed under the matching bus key. `should_stop` (an asyncio.Event, optional) ends the
    pump cleanly between batches — the monitor's stop button. `cipher_factory` is injectable ONLY for
    tests (an identity cipher over plaintext frames); production uses the real AES factory.
    """
    channels = channels or BRP_CHANNELS
    fs = 1000.0 / sample_interval_ms
    session_key = await as11_pull.establish(pair_key, client_id, write, recv_frame)
    seal, unseal = cipher_factory(session_key)
    for _did, (key, label, unit) in channels.items():
        bus.register(key, label, unit, fs, chans=1)
    pushed = 0
    async for batch in as11_pull.stream(write, recv_frame, seal, unseal, list(channels),
                                        sample_interval_ms=sample_interval_ms, max_batches=max_batches):
        for did, (key, _label, _unit) in channels.items():
            samples = batch["channels"].get(did)
            if samples:
                bus.push(key, samples, fs)
        pushed += 1
        if should_stop is not None and should_stop.is_set():
            break
    return pushed


class LiveStreamController:
    """Start/stop lifecycle for the live CPAP waveform, driven by the monitor's button.

    The daemon injects a `connect` (opens the BLE link on the free radio → write/recv_frame/disconnect)
    and a `load_creds` (reads as11_creds.json). Everything else — the gate, the task, the bus cleanup —
    is here and unit-tested; the only un-covered edge is the bleak connect itself, which lives in the
    daemon shim. One controller per daemon; `op("start"|"stop")` is what the endpoint calls."""

    def __init__(self, bus, connect, load_creds, *, channels=None, pump=stream_to_bus):
        self._bus = bus
        self._connect = connect
        self._load_creds = load_creds
        self._channels = channels or BRP_CHANNELS
        self._pump = pump
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
        reason = gate(self._bus.meta())
        if reason:
            return {"ok": False, "error": reason}
        creds = self._load_creds()
        if not creds:
            return {"ok": False, "error": "no AS11 credentials on this box — pair the CPAP first"}
        write, recv_frame, disconnect = await self._connect()
        self._disconnect = disconnect
        self._stop = asyncio.Event()
        self._task = asyncio.create_task(self._pump(
            self._bus, write, recv_frame, bytes.fromhex(creds["masterPairKey"]), creds["clientId"],
            channels=self._channels, should_stop=self._stop))
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
