# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""cpap_events — the AS11's own session-boundary witness (SubscribeEvent → EventNotification), recorded
beside the stream and compared with the trigger the box already has.

Shape: the parser and the recorder are pinned pure (no transport); then the pull loop is driven against
the same fake AS11 the stream tests use, pinning ORDER (SubscribeEvent before StartStream), NON-FATALITY
(a declined or timed-out subscription is recorded and the stream proceeds) and ROUTING (an
EventNotification is counted as its own frame kind and handed to the recorder, never yielded as a batch);
then the pump and the controller forward the recorder additively; then the daemon's factory is
config-gated and OFF by default. Every absent measurement is None — a delta over a missing edge is not
0 s of agreement (§∅)."""
import asyncio
import collections
import json
import logging
import os

import pytest

import as11_link as L
import as11_pull as P
import cpap_events as E
import cpap_stream as CS
from cpap_ingest import FrameKind, GapCounters, classify_frame

PAIR_KEY = b"K" * 32
NONCE = bytes.fromhex("00112233445566778899aabbccddeeff")
_START_ID = 16


def _run(coro):
    return asyncio.run(coro)


def _seal(p):
    return p


def _unseal(w):
    return w


def _enc(obj):
    return (L.VCID_ENC_RX, json.dumps(obj).encode())


def _plain(obj):
    return (L.VCID_PLAIN_RX, json.dumps(obj).encode())


class FakeAS11:
    def __init__(self, frames):
        self._frames = collections.deque(frames)
        self.written = []

    async def write(self, frame):
        self.written.append(frame)

    async def recv_frame(self):
        return self._frames.popleft()


def _ack(rpc_id=_START_ID, stream_id=1):
    return _enc({"id": rpc_id, "result": {
        "dataIds": [{"dataId": "PatientFlow", "valid": True}, {"dataId": "MaskPressure", "valid": True}],
        "streamId": stream_id}})


def _sub_ack(rpc_id=_START_ID + 1):
    return _enc({"id": rpc_id, "result": {"dataIds": [{"dataId": "_ZLE", "valid": True}]}})


def _stream_data(flow=(0.1, 0.2), pressure=(5.0, 5.1), stream_id=1):
    return _enc({"jsonrpc": "2.0", "method": "StreamData", "params": {
        "data": [{"PatientFlow": list(flow)}, {"MaskPressure": list(pressure)}],
        "intervalMs": 40, "startTime": "2026-08-23T01:30:28.730Z", "streamId": stream_id}})


def _event(data_id, events):
    return _enc({"jsonrpc": "2.0", "method": "EventNotification",
                 "params": {"dataId": data_id, "events": events}})


def _zle(value, rt="2026-09-19T22:01:02.000Z"):
    return {"value": value, "reportTime": rt}


def _sent(dev, skip=0):
    """The JSON-RPC requests the core wrote, decoded from the framed identity-cipher wire bytes."""
    return [json.loads(L.fig_unframe(f)[1]) for f in dev.written[skip:]]


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# THE BUILDER — as11_link.subscribe_event
# ══════════════════════════════════════════════════════════════════════════════════════════════════
def test_subscribe_event_is_a_versioned_rpc_with_the_ids_verbatim_and_a_distinct_default_id():
    msg = json.loads(L.subscribe_event(["UsageEvents-TherapyStatusEvents", "_ZLE"]))
    assert msg["method"] == "SubscribeEvent"
    assert msg["params"] == {"dataIds": ["UsageEvents-TherapyStatusEvents", "_ZLE"]}
    assert msg["id"] == 17 and msg["jsonrpc"] == "1.0", "the encrypted-channel RPC version, like StartStream"
    assert json.loads(L.subscribe_event(["_ZLE"], rpc_id=99))["id"] == 99
    # the id must not collide with StartStream's default, or the two acks are indistinguishable
    assert json.loads(L.start_stream(["PatientFlow"]))["id"] != json.loads(L.subscribe_event(["_ZLE"]))["id"]


@pytest.mark.parametrize("bad", [[], [""], ["_ZLE", 3], ["x"] * 31, "not-a-list-of-ids"])
def test_subscribe_event_refuses_an_unusable_id_list(bad):
    with pytest.raises(ValueError):
        L.subscribe_event(bad if bad != "not-a-list-of-ids" else [None])


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# THE FRAME KIND — an EventNotification is neither a batch nor a defect
# ══════════════════════════════════════════════════════════════════════════════════════════════════
def test_an_event_notification_is_its_OWN_kind_and_is_counted_apart_from_malformed():
    msg = {"jsonrpc": "2.0", "method": "EventNotification", "params": {"dataId": "_ZLE", "events": []}}
    assert classify_frame(msg, 1) is FrameKind.EVENT
    assert classify_frame({"method": "HeartBeat"}, 1) is FrameKind.MALFORMED, "unchanged"
    c = GapCounters()
    c.note_frame(FrameKind.EVENT)
    c.note_frame(FrameKind.EVENT)
    c.note_frame(FrameKind.MALFORMED)
    assert (c.events, c.malformed, c.frames_ok) == (2, 1, 0)
    assert c.summary()["events"] == 2
    assert c.total_lost == 1, "an event is not a loss — it never enters total_lost"


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# THE PARSER — pure, never raises, never fabricates
# ══════════════════════════════════════════════════════════════════════════════════════════════════
def test_parse_yields_one_row_per_event_with_BOTH_slots_and_both_stamps():
    rows = E.parse_event_notification(
        {"dataId": "UsageEvents-TherapyStatusEvents",
         "events": [{"event": "TherapyStart", "reportTime": "2026-09-19T22:00:00.000Z"},
                    {"event": "MaskOn", "reportTime": "2026-09-19T22:00:01.000Z"}]}, 1000.5)
    assert rows == [
        {"host_epoch": 1000.5, "data_id": "UsageEvents-TherapyStatusEvents", "event": "TherapyStart",
         "value": None, "report_time": "2026-09-19T22:00:00.000Z"},
        {"host_epoch": 1000.5, "data_id": "UsageEvents-TherapyStatusEvents", "event": "MaskOn",
         "value": None, "report_time": "2026-09-19T22:00:01.000Z"},
    ]
    zle = E.parse_event_notification({"dataId": "_ZLE", "events": [_zle(1)]}, 7.0)
    assert zle == [{"host_epoch": 7.0, "data_id": "_ZLE", "event": None, "value": 1,
                    "report_time": "2026-09-19T22:01:02.000Z"}]


@pytest.mark.parametrize("params", [
    None, "x", [], {}, {"dataId": "_ZLE"}, {"events": []}, {"dataId": 3, "events": []},
    {"dataId": "_ZLE", "events": "nope"}, {"dataId": "_ZLE", "events": [1, "a", None]},
])
def test_parse_of_anything_not_of_the_wire_shape_yields_NO_rows_and_never_raises(params):
    assert E.parse_event_notification(params, 1.0) == []


def test_parse_keeps_a_bool_or_string_value_OUT_of_the_numeric_slot():
    """`True` is an int in Python; a device that ever sent one must not read as `_ZLE=1`."""
    rows = E.parse_event_notification({"dataId": "_ZLE", "events": [{"value": True}, {"value": "1"},
                                                                     {"value": 0, "reportTime": 5}]}, 1.0)
    assert [r["value"] for r in rows] == [None, None, 0]
    assert rows[2]["report_time"] is None, "a non-string reportTime is absent, not coerced"


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# THE RECORDER — edges, levels, deltas, the sidecar
# ══════════════════════════════════════════════════════════════════════════════════════════════════
def test_the_first_zle_value_is_a_LEVEL_not_an_edge():
    """A session subscribed while `_ZLE` is already 1 has no rising edge to report; fabricating one at
    subscribe time would be a stamp nobody took."""
    r = E.EventRecorder()
    r.note({"dataId": "_ZLE", "events": [_zle(1)]}, host_epoch=100.0)
    assert r.zle_value == 1 and r.zle_edges == 0 and r.zle_rising_host is None
    r.note({"dataId": "_ZLE", "events": [_zle(1)]}, host_epoch=101.0)        # same level, still no edge
    assert r.zle_edges == 0


def test_rising_is_the_FIRST_edge_and_falling_the_LAST_and_deltas_are_signed_seconds():
    r = E.EventRecorder()
    r.mark_trigger("start", host_epoch=100.0)
    r.note({"dataId": "_ZLE", "events": [_zle(0, "a")]}, host_epoch=100.5)   # level
    r.note({"dataId": "_ZLE", "events": [_zle(1, "b")]}, host_epoch=103.25)  # ↑ first rising
    r.note({"dataId": "_ZLE", "events": [_zle(0, "c")]}, host_epoch=110.0)   # ↓ a mask-fit blip
    r.note({"dataId": "_ZLE", "events": [_zle(1, "d")]}, host_epoch=111.0)   # ↑ second rising — NOT recorded
    r.note({"dataId": "_ZLE", "events": [_zle(0, "e")]}, host_epoch=500.0)   # ↓ last falling
    r.mark_trigger("stop", host_epoch=620.0)
    s = r.snapshot()
    assert (s["zle_edges"], s["zle_rising_host"], s["zle_rising_report"]) == (4, 103.25, "b")
    assert (s["zle_falling_host"], s["zle_falling_report"]) == (500.0, "e")
    assert s["witness_start_delta_s"] == 3.25, "device rose 3.25 s AFTER the trigger"
    assert s["witness_stop_delta_s"] == -120.0, "device fell 120 s BEFORE the trigger stopped"
    assert s["events_notifications"] == 5 and s["events_rows"] == 5


def test_a_delta_over_a_missing_edge_is_None_never_zero():
    r = E.EventRecorder()
    r.mark_trigger("start", host_epoch=1.0)
    r.mark_trigger("stop", host_epoch=2.0)
    s = r.snapshot()
    assert s["witness_start_delta_s"] is None and s["witness_stop_delta_s"] is None
    assert s["zle_rising_host"] is None and s["zle_falling_host"] is None
    assert s["events_subscribe"] == "not-requested", "the pump never reported; say so"
    r2 = E.EventRecorder()
    r2.note({"dataId": "_ZLE", "events": [_zle(0), _zle(1)]}, host_epoch=5.0)
    assert r2.snapshot()["witness_start_delta_s"] is None, "no trigger mark ⇒ no delta"


def test_mark_trigger_rejects_an_unknown_mark_and_stamps_the_host_clock_when_none_given():
    r = E.EventRecorder()
    with pytest.raises(ValueError):
        r.mark_trigger("pause")
    r.mark_trigger("start")
    assert isinstance(r.trigger_start_host, float) and r.trigger_start_host > 1.7e9


def test_the_sidecar_is_VERBATIM_JSONL_with_the_host_stamp_and_survives_a_malformed_notification(tmp_path):
    path = str(tmp_path / "ev" / "cpap-events-x.jsonl")
    r = E.EventRecorder(path)
    r.note({"dataId": "_ZLE", "events": [_zle(1)]}, host_epoch=10.0)
    r.note("garbage-the-device-sent", host_epoch=11.0)                       # recorded too — evidence
    r.note_subscribed("ok")
    r.close()
    lines = [json.loads(ln) for ln in open(path, encoding="utf-8")]
    assert lines == [{"host_epoch": 10.0, "params": {"dataId": "_ZLE", "events": [_zle(1)]}},
                     {"host_epoch": 11.0, "params": "garbage-the-device-sent"}]
    assert r.notifications == 2 and len(r.rows) == 1
    assert r.snapshot()["events_subscribe"] == "ok"
    r.close()                                                                  # idempotent


def test_a_sidecar_write_failure_is_RECORDED_and_does_not_end_the_night(tmp_path):
    path = str(tmp_path / "cpap-events-y.jsonl")
    r = E.EventRecorder(path)
    r._fh.close()                                          # the disk went away under us
    rows = r.note({"dataId": "_ZLE", "events": [_zle(1)]}, host_epoch=1.0)
    assert rows and r.zle_value == 1, "the in-memory witness is intact"
    assert r.subscribe_status.startswith("record-error:ValueError")
    r.close()


def test_a_recorder_with_no_path_records_in_memory_only():
    r = E.EventRecorder(None, data_ids=["_ZLE"])
    assert r._fh is None and r.data_ids == ("_ZLE",)
    r.note({"dataId": "_ZLE", "events": [_zle(0)]}, host_epoch=1.0)
    assert r.rows and r.snapshot()["events_rows"] == 1
    r.close()


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# THE PULL LOOP — order, non-fatality, routing
# ══════════════════════════════════════════════════════════════════════════════════════════════════
def _collect(agen):
    async def go():
        out = []
        async for b in agen:
            out.append(b)
        return out
    return _run(go())


def test_SubscribeEvent_goes_out_BEFORE_StartStream_and_its_ack_is_consumed_first():
    rec = E.EventRecorder()
    dev = FakeAS11([_sub_ack(), _ack(), _stream_data()])
    batches = _collect(P.stream(dev.write, dev.recv_frame, _seal, _unseal, ["PatientFlow", "MaskPressure"],
                                start_id=_START_ID, max_batches=1,
                                subscribe=["_ZLE"], on_event=rec.note, on_subscribed=rec.note_subscribed))
    assert len(batches) == 1
    sent = _sent(dev)
    assert [m["method"] for m in sent] == ["SubscribeEvent", "StartStream"]
    assert sent[0]["id"] == _START_ID + 1, "the subscribe id sits beside start_id"
    assert sent[0]["params"] == {"dataIds": ["_ZLE"]}
    assert rec.subscribe_status == "ok"


def test_a_subscribe_ERROR_from_the_device_is_recorded_and_the_stream_still_runs():
    rec = E.EventRecorder()
    dev = FakeAS11([_enc({"id": _START_ID + 1, "error": {"code": -32601, "message": "no such method"}}),
                    _ack(), _stream_data()])
    batches = _collect(P.stream(dev.write, dev.recv_frame, _seal, _unseal, ["PatientFlow", "MaskPressure"],
                                start_id=_START_ID, max_batches=1,
                                subscribe=["_ZLE"], on_event=rec.note, on_subscribed=rec.note_subscribed))
    assert len(batches) == 1, "the night is not lost to a declined witness"
    assert rec.subscribe_status.startswith("failed:"), rec.subscribe_status
    assert "As11Error" in rec.subscribe_status


def test_a_subscribe_TIMEOUT_is_recorded_as_such_and_the_stream_still_runs():
    """A device that never answers SubscribeEvent: the wait is bounded, the outcome named, the stream
    proceeds. (Simulated with a transport that hangs on the FIRST read only.)"""
    rec = E.EventRecorder()
    inner = FakeAS11([_ack(), _stream_data()])
    hung = {"once": True}

    async def recv_frame():
        if hung["once"]:
            hung["once"] = False
            await asyncio.sleep(10)          # far past the 0.05 s budget below
        return await inner.recv_frame()

    batches = _collect(P.stream(inner.write, recv_frame, _seal, _unseal, ["PatientFlow", "MaskPressure"],
                                start_id=_START_ID, max_batches=1, subscribe_timeout_s=0.05,
                                subscribe=["_ZLE"], on_event=rec.note, on_subscribed=rec.note_subscribed))
    assert len(batches) == 1
    assert rec.subscribe_status == "failed:TimeoutError"


def test_an_EventNotification_is_ROUTED_to_the_recorder_counted_as_an_event_and_never_yielded():
    rec = E.EventRecorder()
    c = GapCounters()
    dev = FakeAS11([_sub_ack(), _ack(),
                    _event("_ZLE", [_zle(0)]),
                    _event("UsageEvents-TherapyStatusEvents", [{"event": "TherapyStart", "reportTime": "t"}]),
                    _stream_data(),
                    _event("_ZLE", [_zle(1, "rise")]),
                    _stream_data()])
    batches = _collect(P.stream(dev.write, dev.recv_frame, _seal, _unseal, ["PatientFlow", "MaskPressure"],
                                start_id=_START_ID, max_batches=2, counters=c,
                                subscribe=["UsageEvents-TherapyStatusEvents", "_ZLE"],
                                on_event=rec.note, on_subscribed=rec.note_subscribed))
    assert len(batches) == 2, "events never become batches"
    assert (c.events, c.malformed, c.frames_ok) == (3, 0, 2)
    assert rec.notifications == 3 and [r["event"] for r in rec.rows] == [None, "TherapyStart", None]
    assert rec.zle_edges == 1 and rec.zle_rising_report == "rise"


def test_a_recorder_that_raises_does_not_end_the_stream():
    def bad(params):
        raise RuntimeError("recorder bug")
    c = GapCounters()
    dev = FakeAS11([_sub_ack(), _ack(), _event("_ZLE", [_zle(1)]), _stream_data()])
    batches = _collect(P.stream(dev.write, dev.recv_frame, _seal, _unseal, ["PatientFlow", "MaskPressure"],
                                start_id=_START_ID, max_batches=1, counters=c, subscribe=["_ZLE"], on_event=bad))
    assert len(batches) == 1 and c.events == 1


def test_without_subscribe_the_loop_sends_only_StartStream_and_an_unsolicited_event_is_still_counted():
    """The additive contract: no subscribe ⇒ no SubscribeEvent on the wire and no on_subscribed call. An
    EventNotification that arrives anyway (a device that pushes unasked) is counted, not malformed, and
    with no on_event it goes nowhere — silently, which is the pre-existing behaviour for extra frames."""
    c = GapCounters()
    dev = FakeAS11([_ack(), _event("_ZLE", [_zle(1)]), _stream_data()])
    batches = _collect(P.stream(dev.write, dev.recv_frame, _seal, _unseal, ["PatientFlow", "MaskPressure"],
                                start_id=_START_ID, max_batches=1, counters=c))
    assert len(batches) == 1 and [m["method"] for m in _sent(dev)] == ["StartStream"]
    assert c.events == 1 and c.malformed == 0


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# THE PUMP — the recorder rides stream_to_bus and lands on both surfaces
# ══════════════════════════════════════════════════════════════════════════════════════════════════
def _identity_factory(session_key):
    assert isinstance(session_key, bytes) and len(session_key) == 32
    return (lambda p: p), (lambda w: w)


def _handshake():
    return [_plain({"id": 10, "result": {"challenge": b"chal-16-bytes!!!".hex(), "nonce": NONCE.hex()}}),
            _plain({"id": 11, "result": {"confirmation": True}})]


class _Bus:
    def __init__(self):
        self.pushed = []

    def register(self, key, label, unit, fs, chans=1, labels=()):
        pass

    def push(self, stream, values, fs=None, dev_ns=None):
        self.pushed.append((stream, list(values), fs))


class _RawStub:
    def open(self, channels, fs): pass
    def on_batch(self, batch): pass
    def close(self): pass
    def acq_facts(self):
        return {"session_id": "s", "device_id": "d", "path": None, "size": None, "records": 0,
                "first_device_start": None, "closed_cleanly": True}


def test_the_pump_marks_the_trigger_merges_the_witness_into_the_gap_line_and_the_envelope(caplog, tmp_path):
    rec = E.EventRecorder(str(tmp_path / "cpap-events-z.jsonl"))
    envelopes = []
    dev = FakeAS11(_handshake() + [_sub_ack(), _ack(), _event("_ZLE", [_zle(0)]), _event("_ZLE", [_zle(1, "up")]),
                                   _stream_data()])
    with caplog.at_level(logging.INFO, logger="tepna.cpap"):
        _run(CS.stream_to_bus(_Bus(), dev.write, dev.recv_frame, PAIR_KEY, "cid", cipher_factory=_identity_factory,
                              max_batches=1, extra_sinks=[_RawStub()], acq_evidence_out=envelopes.append,
                              events=rec))
    assert [m["method"] for m in _sent(dev, skip=2)] == ["SubscribeEvent", "StartStream"]
    assert rec.trigger_start_host is not None and rec.trigger_stop_host is not None
    assert rec.trigger_start_host <= rec.zle_rising_host <= rec.trigger_stop_host
    assert rec._fh is None, "closed with the sinks"
    ev = envelopes[-1].provenance["events"]
    assert ev["events_subscribe"] == "ok" and ev["zle_edges"] == 1 and ev["zle_rising_report"] == "up"
    assert isinstance(ev["witness_start_delta_s"], float) and ev["witness_stop_delta_s"] is None
    lines = [r.getMessage() for r in caplog.records if "gap accounting" in r.getMessage()]
    assert any("'events_subscribe': 'ok'" in ln and "'zle_edges': 1" in ln for ln in lines), lines
    assert os.path.getsize(rec.path) > 0


def test_the_pump_without_a_recorder_is_byte_identical_to_before(caplog):
    envelopes = []
    dev = FakeAS11(_handshake() + [_ack(), _stream_data()])
    with caplog.at_level(logging.INFO, logger="tepna.cpap"):
        _run(CS.stream_to_bus(_Bus(), dev.write, dev.recv_frame, PAIR_KEY, "cid", cipher_factory=_identity_factory,
                              max_batches=1, extra_sinks=[_RawStub()], acq_evidence_out=envelopes.append))
    assert [m["method"] for m in _sent(dev, skip=2)] == ["StartStream"]
    assert envelopes[-1].provenance["events"] is None
    assert not any("events_subscribe" in r.getMessage() for r in caplog.records)


def test_the_stop_mark_lands_even_when_the_link_drops():
    rec = E.EventRecorder()
    dev = FakeAS11(_handshake() + [_sub_ack(), _ack(), _stream_data()])       # deque runs dry → IndexError
    with pytest.raises(IndexError):
        _run(CS.stream_to_bus(_Bus(), dev.write, dev.recv_frame, PAIR_KEY, "cid", cipher_factory=_identity_factory,
                              extra_sinks=[_RawStub()], events=rec))
    assert rec.trigger_stop_host is not None and rec._fh is None


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# THE CONTROLLER + THE DAEMON FACTORY — additive, config-gated, OFF by default
# ══════════════════════════════════════════════════════════════════════════════════════════════════
def test_the_controller_builds_ONE_recorder_per_session_and_forwards_it_under_events():
    from test_cpap_stream import _ControllerBus, _connector, _creds, _idle_devices
    seen = []
    built = []

    async def pump(bus, write, recv_frame, pk, cid, *, channels=None, should_stop=None, events=None):
        seen.append(events)
        while should_stop is None or not should_stop.is_set():
            await asyncio.sleep(0.005)
        return 0

    def factory():
        r = E.EventRecorder(None)
        built.append(r)
        return r

    async def go():
        connect, _ = _connector()
        c = CS.LiveStreamController(_ControllerBus(), connect, _creds, _idle_devices, pump=pump, events_factory=factory)
        await c.op("start"); await asyncio.sleep(0.02); await c.op("stop")
        await c.op("start"); await asyncio.sleep(0.02); await c.op("stop")
    _run(go())
    assert len(built) == 2 and seen == built and built[0] is not built[1]


def test_the_controller_without_a_factory_never_passes_events():
    from test_cpap_stream import _ControllerBus, _connector, _creds, _idle_devices
    seen = []

    async def pump(bus, write, recv_frame, pk, cid, *, channels=None, should_stop=None, **kw):
        seen.append(sorted(kw))
        while should_stop is None or not should_stop.is_set():
            await asyncio.sleep(0.005)
        return 0

    async def go():
        connect, _ = _connector()
        c = CS.LiveStreamController(_ControllerBus(), connect, _creds, _idle_devices, pump=pump)
        await c.op("start"); await asyncio.sleep(0.02); await c.op("stop")
    _run(go())
    assert seen and "events" not in seen[0]


def test_the_daemon_factory_is_OFF_by_default_and_says_so(caplog):
    import capture
    with caplog.at_level(logging.INFO, logger=capture.log.name):
        assert capture._cpap_events_factory({}, None) is None
        assert capture._cpap_events_factory({"events": {"enabled": False}}, "/x") is None
    assert any("event subscription: OFF" in r.getMessage() for r in caplog.records)


def test_the_daemon_factory_when_ARMED_writes_a_host_stamped_jsonl_beside_the_raw_record(tmp_path, caplog):
    import capture
    with caplog.at_level(logging.INFO, logger=capture.log.name):
        f = capture._cpap_events_factory({"events": {"enabled": True}}, str(tmp_path))
    assert any("event subscription ARMED" in r.getMessage() for r in caplog.records)
    r = f()
    assert r.data_ids == E.EVENT_DATA_IDS_DEFAULT
    assert os.path.dirname(r.path) == str(tmp_path) and os.path.basename(r.path).startswith("cpap-events-")
    assert r.path.endswith(".jsonl") and os.path.exists(r.path)
    r.close()
    # a custom id list reaches the recorder verbatim; no sidecar root ⇒ in-memory recorder
    r2 = capture._cpap_events_factory({"events": {"enabled": True, "data_ids": ["_ZLE"]}}, None)()
    assert r2.data_ids == ("_ZLE",) and r2.path is None
    with pytest.raises(ValueError):
        capture._cpap_events_factory({"events": {"enabled": True, "data_ids": [""]}}, None)


def test_the_builder_wires_the_factory_only_when_configured(tmp_path):
    import capture
    off = capture._build_cpap_controller(object(), {"cpap": {}}, str(tmp_path / "config.yaml"))
    assert off._events_factory is None
    on = capture._build_cpap_controller(object(), {"cpap": {"ble_stream": {"events": {"enabled": True}}}},
                                        str(tmp_path / "config.yaml"))
    assert callable(on._events_factory)
    assert on._events_factory().path is None, "no raw_record_dir / edf_dir ⇒ in-memory"


def test_config_example_documents_the_key_OFF():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    text = open(os.path.join(here, "config.example.yaml"), encoding="utf-8").read()
    i = text.index("# events:")
    block = text[i:i + 200]
    assert "enabled: false" in block and "_ZLE" in block
