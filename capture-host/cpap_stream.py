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
import logging

import acq_evidence_cpap
import as11_cipher
import as11_pull
from cpap_ingest import GapCounters
import telemetry

_log = logging.getLogger("tepna.cpap")

# The BRP waveforms and their bus presentation. dataId → (bus key, label, unit). The device streams flow
# and mask pressure at the 40 ms BRP cadence; fs is derived from the sample interval, not hard-coded, so
# a caller that picks a different interval gets a truthful rate on the card.
BRP_CHANNELS = {
    "PatientFlow": ("cpap_flow", "CPAP Flow", "L/min"),
    "MaskPressure": ("cpap_pressure", "CPAP Pressure", "cmH₂O"),
}

# §8 — how long a cooperative stop is given to finish the current batch, drain and persist before the
# emergency cancel fires. A healthy 25 Hz stream checks should_stop every batch (~40 ms), so this is only
# ever hit by a pump stuck waiting on a frame that never comes.
STOP_GRACE_S = 5.0


def on_body_wearables(status_devices) -> list[str]:
    """The wearables currently ON A BODY — `telemetry.on_body(st) is not False` (True OR unknown), sorted.
    A CHARGING or off-body device is excluded (a docked ring cannot be interfered with; blocking on it made
    the gate unreachable when a capture is safest — the 2026-07-26 docked-sensors bug). Exposed separately
    so the condition can be LOGGED even when the coexistence gate is disabled and no longer blocks."""
    return sorted(name for name, st in (status_devices or {}).items()
                  if telemetry.on_body(st) is not False)


def _coexistence_refusal(on_body: list[str]) -> str:
    return "a sensor is on the body (" + ", ".join(on_body) + ") — refusing to transmit beside it"


def gate(status_devices, *, enabled=True) -> str | None:
    """Refusal reason if a CPAP BLE stream must NOT start right now, else None.

    The bar the CPAP PULL enforces, single-sourced on `telemetry.on_body`: a 2.4 GHz BLE stream sits beside
    a sensor ON A BODY, so historically it must never run then. `status_devices` is the daemon's device map.

    ⚠️ `enabled` GATES THE BLOCK, and its default at the daemon is FALSE — the coexistence interlock is
    DISABLED BY OWNER ORDER (2026-08-23), which SUPERSEDES the findings-spec §13 conservative-semantics
    clause (documented, not silent). When disabled this NEVER blocks (returns None even with a sensor
    on-body); the caller logs which wearables were on-body so the congestion condition stays observable for
    post-mortems without any refusal. When enabled (the config opt-in), it refuses on `on_body is not False`
    exactly as before. This function stays pure; the logging lives at the one call site that has the logger.
    """
    on_body = on_body_wearables(status_devices)
    if on_body and enabled:
        return _coexistence_refusal(on_body)
    return None


async def stream_to_bus(bus, write, recv_frame, pair_key, client_id, *,
                        channels=None, extra_sinks=None, sample_interval_ms=40,
                        cipher_factory=as11_cipher.make_cipher, max_batches=None, should_stop=None,
                        acq_evidence_out=None):
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
    requested_ms = sample_interval_ms          # §2 — retained for the observed-vs-requested comparison
    fs = 1000.0 / requested_ms                 # the requested rate; the card shows it until the device speaks
    session_key = await as11_pull.establish(pair_key, client_id, write, recv_frame)
    seal, unseal = cipher_factory(session_key)
    for _did, (key, label, unit) in channels.items():
        bus.register(key, label, unit, fs, chans=1)
    counters = GapCounters()                   # P3 gap accounting: frame classification + sink-write failures
    sinks = list(extra_sinks or ())
    for s in sinks:
        s.open(channels, fs)
    delivered = 0
    clean = False                              # set True only if the batch loop ends without raising
    observed_ms = None                         # §2 — the device's OWN interval, authoritative once seen
    try:
        async for batch in as11_pull.stream(write, recv_frame, seal, unseal, list(channels),
                                            sample_interval_ms=sample_interval_ms, max_batches=max_batches,
                                            counters=counters):
            # §2 OBSERVED INTERVAL IS AUTHORITATIVE. The device reports its actual sample interval on every
            # batch; trust IT over the requested nominal, WARN on a mismatch, and DETECT a mid-stream change
            # — never silently resample or ride the nominal. The bus push (and the EDF sink, which reads the
            # same batch) consume the observed rate.
            iv = batch.get("interval_ms")
            if isinstance(iv, (int, float)) and iv > 0:
                if observed_ms is None:
                    observed_ms = iv
                    if iv != requested_ms:
                        _log.warning("CPAP stream observed interval %s ms != requested %s ms — using the "
                                     "observed rate as authoritative", iv, requested_ms)
                elif iv != observed_ms:
                    _log.warning("CPAP stream interval changed mid-stream: %s -> %s ms", observed_ms, iv)
                    observed_ms = iv
                fs = 1000.0 / observed_ms
            # INV9 ORDERING FIX: the DURABLE record is written BEFORE the bus push — the bus is a VIEW
            # of the acquisition, not the acquisition, so the authoritative copy must land first (the
            # merged #1701 loop pushed to the bus first; this reorders it). A sink write failure is
            # NON-FATAL but LOUD: count it (sink_errors) and keep streaming — the stream survives a
            # subscriber failure, and the failure is first-class gap-accounting data, never a silent drop.
            for s in sinks:
                try:
                    s.on_batch(batch)
                except Exception:  # noqa: BLE001 — ANY sink failure must not kill the stream (INV9)
                    counters.sink_errors += 1
                    _log.exception("CPAP durable sink failed — counted (sink_errors=%d), stream continues",
                                   counters.sink_errors)
            for did, (key, _label, _unit) in channels.items():
                samples = batch["channels"].get(did)
                if samples:
                    bus.push(key, samples, fs)
            delivered += 1
            if should_stop is not None and should_stop.is_set():
                break
        # Reached ONLY by the loop ending on its own terms (cooperative stop, or max_batches). A dropped
        # link raises straight past this into the finally, leaving `clean` False — so the envelope's
        # completeness reflects what actually happened instead of assuming every session ended well.
        clean = True
    finally:
        for s in sinks:
            s.close()
        _summary = counters.summary()
        if counters.total_lost or counters.sink_errors or counters.foreign_stream:
            _log.warning("CPAP stream gap accounting: %s", _summary)
        else:
            _log.info("CPAP stream gap accounting: %s", _summary)
        # ACQUISITION EVIDENCE CONTRACT, Phase B (ACQ-EVIDENCE-CONTRACT-2026-08-24-BRIEF §11/§18).
        # AFTER the sinks are closed — the raw record's clean close is the validation input, so
        # assembling before this would read a still-open record and report UNKNOWN for every session.
        # Emitted in the finally so an INTERRUPTED night gets its envelope too: a drop is exactly when
        # acquisition evidence matters, and the drain above means those batches are already durable.
        if acq_evidence_out is not None:
            _emit_acq_evidence(acq_evidence_out, sinks, counters, observed_ms, clean)
    return delivered


def _emit_acq_evidence(out, sinks, counters, observed_ms, stopped_cleanly):
    """Assemble the live envelope from the closed sinks and hand it to `out`. Never raises into the
    pump: evidence is a REPORT ABOUT the acquisition, so failing to write it must not also destroy the
    acquisition's return value. A sink with no `acq_facts` (the EDF writer) is not the raw record."""
    try:
        raw = next((s.acq_facts() for s in sinks if hasattr(s, "acq_facts")), None)
        if raw is None:
            return
        edf = next((s.path for s in sinks if hasattr(s, "path") and not hasattr(s, "acq_facts")), None)
        out(acq_evidence_cpap.assemble_live(
            raw,
            counters=counters.summary(),
            edf_path=edf,
            observed_interval_ms=observed_ms,
            stopped_cleanly=stopped_cleanly,
        ))
    except Exception:  # noqa: BLE001 — see the docstring: the report must not sink the acquisition
        _log.exception("CPAP acquisition-evidence emit failed — the capture itself is unaffected")


class LiveStreamController:
    """Start/stop lifecycle for the live CPAP waveform, driven by the monitor's button.

    The daemon injects a `connect` (opens the BLE link on the free radio → write/recv_frame/disconnect)
    and a `load_creds` (reads as11_creds.json). Everything else — the gate, the task, the bus cleanup —
    is here and unit-tested; the only un-covered edge is the bleak connect itself, which lives in the
    daemon shim. One controller per daemon; `op("start"|"stop")` is what the endpoint calls."""

    def __init__(self, bus, connect, load_creds, devices, *, channels=None, pump=stream_to_bus,
                 edf_sink_factory=None, raw_record_factory=None, coexistence_gate=False,
                 acq_evidence_out=None):
        self._bus = bus
        self._connect = connect
        self._load_creds = load_creds
        self._devices = devices        # () -> the daemon's device-status map, for the on-body gate
        self._channels = channels or BRP_CHANNELS
        self._pump = pump
        # The 2.4 GHz coexistence interlock. DEFAULT FALSE — disabled by owner order 2026-08-23 (supersedes
        # findings-spec §13). When False the stream starts even beside an on-body wearable and only LOGS the
        # condition; set True (config cpap.ble_stream.coexistence_gate) to restore the blocking behaviour.
        self._coexistence_gate = coexistence_gate
        # () -> a fresh on-disk EDF sink for this session, or None to stream to the bus alone. The daemon
        # supplies one; a bus-only controller (and every existing test) leaves it None and is unaffected.
        self._edf_sink_factory = edf_sink_factory
        # () -> a fresh RawRecordSink for this session (the durable JSONL raw record, INV9), or
        # None for no on-disk record. Peers with the EDF sink on the one ingestion seam.
        self._raw_record_factory = raw_record_factory
        # (AcquisitionEvidence) -> None, called once per session after the sinks close — the Phase B
        # execution witness. None (the default) keeps the prior behaviour exactly, so every existing
        # controller and injected test pump is unaffected.
        self._acq_evidence_out = acq_evidence_out
        self._task = None
        self._stop = None
        self._disconnect = None
        # §7 START/STOP CONCURRENCY. `_start` has an `await self._connect()` BETWEEN the `_running()` check
        # and assigning `_task`, so two concurrent op("start") calls both pass the check and both spawn a
        # pump → two acquisition sessions on ONE link. This lock RESERVES the whole start/stop transition
        # before the first await, so at most ONE session owns the live stream and stop/restart cannot race
        # connect/auth. (asyncio.Lock is loop-agnostic at construction on 3.10+, so building the controller
        # outside a running loop — as the daemon does — is fine.)
        self._lock = asyncio.Lock()

    def _keys(self):
        return [key for _did, (key, _l, _u) in self._channels.items()]

    def _running(self):
        return self._task is not None and not self._task.done()

    async def op(self, action):
        async with self._lock:
            return await (self._start() if action == "start" else self._stop_op())

    async def _start(self):
        if self._running():
            return {"ok": True, "streaming": True, "already": True, "channels": self._keys()}
        devs = self._devices()
        reason = gate(devs, enabled=self._coexistence_gate)
        if reason:
            return {"ok": False, "error": reason}
        if not self._coexistence_gate:
            # Gate DISABLED by owner order 2026-08-23 — `gate` permitted the start; if a wearable IS on a
            # body, record it (no refusal) so a 2.4 GHz congestion post-mortem still has the condition.
            on_body = on_body_wearables(devs)
            if on_body:
                _log.warning(
                    "coexistence gate DISABLED (owner order 2026-08-23) — CPAP stream starting beside "
                    "ON-BODY wearable(s): %s",
                    ", ".join(on_body),
                )
        creds = self._load_creds()
        if not creds:
            return {"ok": False, "error": "no AS11 credentials on this box — pair the CPAP first"}
        write, recv_frame, disconnect = await self._connect()
        self._disconnect = disconnect
        self._stop = asyncio.Event()
        kw = {"channels": self._channels, "should_stop": self._stop}
        # Fresh sinks per session — the durable raw record leads (authoritative copy), then the EDF.
        # Only passed when a factory is configured, so a bus-only pump (and the injected test pumps) never
        # see the kwarg. The pump writes every sink BEFORE the bus push (INV9), so order here is only the
        # order among sinks, not durable-vs-bus.
        _factories = [f for f in (self._raw_record_factory, self._edf_sink_factory) if f is not None]
        if _factories:
            kw["extra_sinks"] = [f() for f in _factories]
        if self._acq_evidence_out is not None:
            kw["acq_evidence_out"] = self._acq_evidence_out
        self._task = asyncio.create_task(self._pump(
            self._bus, write, recv_frame, bytes.fromhex(creds["masterPairKey"]), creds["clientId"], **kw))
        return {"ok": True, "streaming": True, "channels": self._keys()}

    async def _stop_op(self):
        task, stop, disconnect = self._task, self._stop, self._disconnect
        self._task = self._stop = self._disconnect = None
        if task is not None and not task.done():
            # §8 COOPERATIVE STOP IS THE NORMAL PATH: signal should_stop and let the pump finish its
            # current batch, DRAIN, close the sinks (persist the EDF) and end on its own. Cancellation is
            # the EMERGENCY fallback for a pump that will not stop — and WHEN it fires we RECORD it, so a
            # truncated recording is never an ambiguous termination.
            # stop is guaranteed non-None for a live task: _start sets self._stop (an Event) BEFORE
            # self._task, both under self._lock, and _stop_op reads/nulls the pair together — so reaching
            # here with a task but no stop is unreachable, and an unconditional set is provably safe.
            stop.set()
            try:
                await asyncio.wait_for(asyncio.shield(task), STOP_GRACE_S)
            except asyncio.TimeoutError:
                _log.warning(
                    "CPAP stream did not stop cooperatively within %.0fs — CANCELLING (emergency); the "
                    "final record may be truncated",
                    STOP_GRACE_S,
                )
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
                except Exception:  # noqa: BLE001 — a cancelled stream must not stop us tearing the link down
                    pass
            except Exception:  # noqa: BLE001 — a pump that ended by ERROR still lets us close the link
                pass
        if disconnect is not None:
            try:
                await disconnect()
            except Exception:  # noqa: BLE001 — best-effort link close; never crash the stop path
                pass
        for key in self._keys():
            self._bus.unregister(key)
        return {"ok": True, "streaming": False}
