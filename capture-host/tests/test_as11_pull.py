# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""as11_pull — the encrypted-session PULL orchestration, driven against a fake AS11.

The cipher is dependency-injected (the real AES lives in the operator probe, not in this
gated module), so the tests pass an IDENTITY cipher: `seal`/`unseal` are the identity, and
an "encrypted" frame is just plaintext JSON carried on the encrypted VCID. That exercises
the full state machine — the plaintext handshake, encrypted-channel routing, fragment
reassembly by `seq`, round continuation, and the error/refusal paths that must never
silently produce empty output — while the wire cipher itself is validated live by the probe.
"""
import asyncio
import base64
import collections
import json

import as11_link as L
import as11_pull as P
import pytest

PAIR_KEY = b"K" * 32
NONCE = bytes.fromhex("00112233445566778899aabbccddeeff")
SESSION_KEY = L.session_key(PAIR_KEY, NONCE)
FROM_DT = "2026-08-20T00:00:00.000Z"  # required — the device rejects an empty spool address


def _seal(payload):
    return payload  # identity cipher — the real AES seal is injected by the probe


def _unseal(wire):
    return wire


def _run(coro):
    return asyncio.run(coro)


class FakeAS11:
    """Injected transport: preload response frames, capture what the core writes."""

    def __init__(self, frames):
        self._frames = collections.deque(frames)  # list of (vcid, payload_bytes)
        self.written = []

    async def write(self, frame):
        self.written.append(frame)

    async def recv_frame(self):
        return self._frames.popleft()


def _plain(obj):
    return (L.VCID_PLAIN_RX, json.dumps(obj).encode())


def _enc(obj):
    # identity cipher: the "sealed" wire bytes ARE the plaintext JSON
    return (L.VCID_ENC_RX, json.dumps(obj).encode())


def _frag(seq, data, status, next_dt=None):
    p = {"spoolId": 5, "seq": seq, "status": status}
    if data is not None:
        p["data"] = base64.b64encode(data).decode()
    if next_dt is not None:
        p["nextSpoolAddress"] = {"Summary": {"fromDateTime": next_dt}}
    return _enc({"jsonrpc": "2.0", "method": "SpoolFragment", "params": p})


# ── _read_json ───────────────────────────────────────────────────────────────
def test_read_json_plaintext():
    dev = FakeAS11([_plain({"id": 1, "result": {}})])
    assert _run(P._read_json(dev.recv_frame))["id"] == 1


def test_read_json_encrypted_with_cipher():
    dev = FakeAS11([_enc({"id": 2, "result": {"ok": True}})])
    assert _run(P._read_json(dev.recv_frame, _unseal))["result"]["ok"] is True


def test_read_json_encrypted_without_cipher_is_an_error():
    dev = FakeAS11([_enc({"id": 3})])
    with pytest.raises(P.As11Error):
        _run(P._read_json(dev.recv_frame, None))


# ── _await_result ────────────────────────────────────────────────────────────
def test_await_result_skips_heartbeat_then_returns():
    dev = FakeAS11([_plain({"jsonrpc": "2.0", "method": "HeartBeat"}), _plain({"id": 9, "result": {"v": 1}})])
    assert _run(P._await_result(dev.recv_frame, 9)) == {"v": 1}


def test_await_result_raises_on_error_response():
    dev = FakeAS11([_plain({"id": 9, "error": {"code": -32601, "message": "Method Not Found"}})])
    with pytest.raises(P.As11Error):
        _run(P._await_result(dev.recv_frame, 9))


# ── establish ────────────────────────────────────────────────────────────────
def _handshake_frames():
    challenge = b"chal-16-bytes!!!"
    return [
        _plain({"id": 10, "result": {"challenge": challenge.hex(), "nonce": NONCE.hex()}}),
        _plain({"id": 11, "result": {"confirmation": True}}),
    ]


def test_establish_returns_the_session_key():
    dev = FakeAS11(_handshake_frames())
    key = _run(P.establish(PAIR_KEY, "cid", dev.write, dev.recv_frame))
    assert key == SESSION_KEY
    # it wrote RequestSession then CheckSessionIntegrity on the plaintext VCID
    sent = [json.loads(L.fig_unframe(f)[1]) for f in dev.written]
    assert [m["method"] for m in sent] == ["RequestSession", "CheckSessionIntegrity"]


def test_establish_raises_on_request_session_error():
    dev = FakeAS11([_plain({"id": 10, "error": {"message": "unknown client"}})])
    with pytest.raises(P.As11Error):
        _run(P.establish(PAIR_KEY, "cid", dev.write, dev.recv_frame))


def test_establish_raises_on_check_integrity_error():
    dev = FakeAS11([
        _plain({"id": 10, "result": {"challenge": b"chal-16-bytes!!!".hex(), "nonce": NONCE.hex()}}),
        _plain({"id": 11, "error": {"message": "bad proof"}}),
    ])
    with pytest.raises(P.As11Error):
        _run(P.establish(PAIR_KEY, "cid", dev.write, dev.recv_frame))


# ── get_date_time ────────────────────────────────────────────────────────────
def test_get_date_time_returns_iso_string():
    dev = FakeAS11([_enc({"id": 13, "result": {"dateTime": "2026-08-12T14:25:31.000Z"}})])
    got = _run(P.get_date_time(dev.write, dev.recv_frame, _seal, _unseal))
    assert got == "2026-08-12T14:25:31.000Z"


# ── pull_spool_round ─────────────────────────────────────────────────────────
def test_round_single_fragment_no_more():
    dev = FakeAS11([
        _enc({"id": 14, "result": {"spoolId": 5}}),
        _enc({"id": 15, "result": {"spoolId": 5}}),  # PullSpoolFragments echo (skipped)
        _frag(0, b"hello", "SPOOL_COMPLETE_NO_MORE_DATA"),
    ])
    body, more, nxt = _run(P.pull_spool_round(dev.write, dev.recv_frame, _seal, _unseal, "Summary", FROM_DT))
    assert body == b"hello" and more is False and nxt is None


def test_round_sends_the_start_spool_then_pull_fragments_requests():
    # regression: the device rejects an empty spool address — the round MUST carry fromDateTime — and
    # the follow-up PullSpoolFragments MUST carry the spoolId the StartSpool result handed back.
    # NON-DEFAULT rpc ids on purpose: `start_id`/`pull_id` must be threaded into the builders, not left
    # to the builders' own (coinciding) defaults, or dropping the wiring would be invisible.
    dev = FakeAS11([
        _enc({"id": 99, "result": {"spoolId": 5}}),
        _frag(0, b"x", "SPOOL_COMPLETE_NO_MORE_DATA"),
    ])
    _run(P.pull_spool_round(dev.write, dev.recv_frame, _seal, _unseal, "Summary", FROM_DT, start_id=99, pull_id=88))
    start = json.loads(L.fig_unframe(dev.written[0])[1])  # first write is StartSpool
    assert start["method"] == "StartSpool" and start["id"] == 99
    assert start["params"]["spoolAddress"]["Summary"] == {"fromDateTime": FROM_DT}
    assert start["params"]["maxSpoolSize"] == 4096
    frags = json.loads(L.fig_unframe(dev.written[1])[1])  # second write is PullSpoolFragments
    assert frags["method"] == "PullSpoolFragments" and frags["id"] == 88
    assert frags["params"]["spoolId"] == 5  # the id the StartSpool result returned, not a constant


def test_round_uses_the_default_rpc_ids_when_not_overridden():
    # the default start_id=14 / pull_id=15 must actually reach the wire — a changed default is caught here
    # (the non-default test above catches a DROPPED id kwarg; this catches a WRONG default).
    dev = FakeAS11([
        _enc({"id": 14, "result": {"spoolId": 5}}),
        _frag(0, b"x", "SPOOL_COMPLETE_NO_MORE_DATA"),
    ])
    _run(P.pull_spool_round(dev.write, dev.recv_frame, _seal, _unseal, "Summary", FROM_DT))
    start = json.loads(L.fig_unframe(dev.written[0])[1])
    frags = json.loads(L.fig_unframe(dev.written[1])[1])
    assert start["id"] == 14 and frags["id"] == 15


def test_round_reassembles_multiple_fragments_by_seq():
    dev = FakeAS11([
        _enc({"id": 14, "result": {"spoolId": 5}}),
        _frag(0, b"AAA", "SPOOL_INCOMPLETE"),
        _frag(1, b"BBB", "SPOOL_INCOMPLETE"),
        _frag(2, b"CCC", "SPOOL_COMPLETE_NO_MORE_DATA"),
    ])
    body, more, nxt = _run(P.pull_spool_round(dev.write, dev.recv_frame, _seal, _unseal, "Summary", FROM_DT))
    assert body == b"AAABBBCCC" and more is False


def test_round_more_pending_reports_next_address():
    dev = FakeAS11([
        _enc({"id": 14, "result": {"spoolId": 5}}),
        _frag(0, b"part1", "SPOOL_COMPLETE_MORE_DATA_PENDING", next_dt="2026-04-29T11:00:00.000Z"),
    ])
    body, more, nxt = _run(P.pull_spool_round(dev.write, dev.recv_frame, _seal, _unseal, "Summary", FROM_DT))
    assert body == b"part1" and more is True and nxt == "2026-04-29T11:00:00.000Z"


def test_round_skips_a_non_spoolfragment_notification():
    dev = FakeAS11([
        _enc({"id": 14, "result": {"spoolId": 5}}),
        _enc({"jsonrpc": "2.0", "method": "HeartBeat"}),  # not a SpoolFragment — skipped
        _frag(0, b"z", "SPOOL_COMPLETE_NO_MORE_DATA"),
    ])
    body, _more, _nxt = _run(P.pull_spool_round(dev.write, dev.recv_frame, _seal, _unseal, "Summary", FROM_DT))
    assert body == b"z"


def test_round_terminal_fragment_with_no_data():
    dev = FakeAS11([
        _enc({"id": 14, "result": {"spoolId": 5}}),
        _frag(0, None, "SPOOL_COMPLETE_NO_MORE_DATA"),  # empty terminal round
    ])
    body, more, _nxt = _run(P.pull_spool_round(dev.write, dev.recv_frame, _seal, _unseal, "Summary", FROM_DT))
    assert body == b"" and more is False


def test_round_raises_on_data_unavailable():
    dev = FakeAS11([
        _enc({"id": 14, "result": {"spoolId": 5}}),
        _frag(0, None, "ERROR_DATA_UNAVAILABLE"),
    ])
    with pytest.raises(P.As11Error, match="data unavailable"):
        _run(P.pull_spool_round(dev.write, dev.recv_frame, _seal, _unseal, "Summary", FROM_DT))


def test_round_raises_on_start_spool_error():
    dev = FakeAS11([_enc({"id": 14, "error": {"message": "no such spool"}})])
    with pytest.raises(P.As11Error):
        _run(P.pull_spool_round(dev.write, dev.recv_frame, _seal, _unseal, "Summary", FROM_DT))


# ── pull_spool (multi-round) ─────────────────────────────────────────────────
def test_pull_spool_single_round():
    dev = FakeAS11([
        _enc({"id": 14, "result": {"spoolId": 5}}),
        _frag(0, b"one", "SPOOL_COMPLETE_NO_MORE_DATA"),
    ])
    assert _run(P.pull_spool(dev.write, dev.recv_frame, _seal, _unseal, "Summary", FROM_DT)) == b"one"


def test_pull_spool_continues_across_rounds():
    dev = FakeAS11([
        _enc({"id": 14, "result": {"spoolId": 5}}),
        _frag(0, b"R1", "SPOOL_COMPLETE_MORE_DATA_PENDING", next_dt="2026-05-01T00:00:00.000Z"),
        _enc({"id": 14, "result": {"spoolId": 5}}),
        _frag(0, b"R2", "SPOOL_COMPLETE_NO_MORE_DATA"),
    ])
    assert _run(P.pull_spool(dev.write, dev.recv_frame, _seal, _unseal, "Summary", FROM_DT)) == b"R1R2"


def _pending(seq_body):
    return _frag(0, seq_body, "SPOOL_COMPLETE_MORE_DATA_PENDING", next_dt="2026-05-01T00:00:00.000Z")


def test_pull_spool_runs_exactly_the_rounds_the_device_reports():
    # completes in EXACTLY 3 rounds (two continuations then a terminal). Pins the round counter: a
    # start-at-1, a +=2, or an off-by-one on the loop bound all mis-count and would raise or truncate.
    dev = FakeAS11([
        _enc({"id": 14, "result": {"spoolId": 5}}), _pending(b"R1"),
        _enc({"id": 14, "result": {"spoolId": 5}}), _pending(b"R2"),
        _enc({"id": 14, "result": {"spoolId": 5}}), _frag(0, b"R3", "SPOOL_COMPLETE_NO_MORE_DATA"),
    ])
    assert _run(P.pull_spool(dev.write, dev.recv_frame, _seal, _unseal, "Summary", FROM_DT, max_rounds=3)) == b"R1R2R3"


def test_pull_spool_bounds_runaway_rounds_at_exactly_max_rounds():
    # a device that always says MORE_DATA_PENDING must stop at the cap. EXACTLY max_rounds rounds of
    # frames: the correct loop consumes all 3 then raises; an off-by-one that would run a 4th finds an
    # empty transport and errors instead — so the boundary is pinned, not just "raised eventually".
    frames = []
    for _ in range(3):
        frames.append(_enc({"id": 14, "result": {"spoolId": 5}}))
        frames.append(_pending(b"x"))
    dev = FakeAS11(frames)
    with pytest.raises(P.As11Error, match="exceeded"):
        _run(P.pull_spool(dev.write, dev.recv_frame, _seal, _unseal, "Summary", FROM_DT, max_rounds=3))


def test_pull_spool_default_cap_stops_at_exactly_64_rounds():
    # the documented default ceiling. EXACTLY 64 all-pending rounds of frames: the default loop consumes
    # all 64 then raises; a default of 65 would reach for a 65th round, find the transport empty, and
    # error instead — so this pins the default bound behaviourally (no max_rounds passed).
    frames = []
    for _ in range(64):
        frames.append(_enc({"id": 14, "result": {"spoolId": 5}}))
        frames.append(_pending(b"x"))
    dev = FakeAS11(frames)
    with pytest.raises(P.As11Error, match="exceeded"):
        _run(P.pull_spool(dev.write, dev.recv_frame, _seal, _unseal, "Summary", FROM_DT))


# ── stream (live waveform) ─────────────────────────────────────────────────────
# StartStream ACK + StreamData shapes are HARDWARE-CONFIRMED against a real AirSense 11 (2026-08-23):
#   ACK:        {"dataIds":[{"dataId":"PatientFlow","valid":true},…], "streamId":1}
#   StreamData: {"method":"StreamData","params":{"data":[{"PatientFlow":[…]},{"MaskPressure":[…]}],
#                                                "intervalMs":40,"startTime":"…Z","streamId":1}}
_START_ID = 16


def _ack(ids_valid, stream_id=1, rpc_id=_START_ID):
    return _enc({"id": rpc_id, "result": {
        "dataIds": [{"dataId": d, "valid": v} for d, v in ids_valid], "streamId": stream_id}})


def _stream_data(channels, start_time="2026-08-23T01:30:28.730Z", interval_ms=40, stream_id=1):
    return _enc({"jsonrpc": "2.0", "method": "StreamData", "params": {
        "data": [{k: v} for k, v in channels.items()],
        "intervalMs": interval_ms, "startTime": start_time, "streamId": stream_id}})


async def _collect(agen):
    out = []
    async for batch in agen:
        out.append(batch)
    return out


def test_stream_yields_decoded_batches_and_merges_channels():
    dev = FakeAS11([
        _ack([("PatientFlow", True), ("MaskPressure", True)]),
        _stream_data({"PatientFlow": [0.01, 0.02], "MaskPressure": [0.1, 0.2]}),
        _stream_data({"PatientFlow": [0.03, 0.04], "MaskPressure": [0.3, 0.4]}),
    ])
    batches = _run(_collect(P.stream(dev.write, dev.recv_frame, _seal, _unseal,
                                     ["PatientFlow", "MaskPressure"], start_id=_START_ID, max_batches=2)))
    assert len(batches) == 2
    assert batches[0]["channels"] == {"PatientFlow": [0.01, 0.02], "MaskPressure": [0.1, 0.2]}
    assert batches[0]["interval_ms"] == 40 and batches[0]["stream_id"] == 1
    assert batches[0]["start_time"] == "2026-08-23T01:30:28.730Z"
    assert batches[1]["channels"]["MaskPressure"] == [0.3, 0.4]


def test_stream_sends_startstream_with_the_requested_params():
    # a DISTINCTIVE start_id (42, not the default 16) so that dropping the `rpc_id=start_id` forward —
    # which would silently fall back to start_stream's default of 16 — changes this frame and is caught.
    dev = FakeAS11([_ack([("SpO2", True)], rpc_id=42), _stream_data({"SpO2": [98.0]}, interval_ms=1000)])
    _run(_collect(P.stream(dev.write, dev.recv_frame, _seal, _unseal, ["SpO2"],
                           sample_interval_ms=1000, report_interval_ms=2000,
                           start_id=42, max_batches=1)))
    sent = json.loads(L.fig_unframe(dev.written[0])[1])
    # assert the WHOLE request — every argument stream() forwards to L.start_stream, and the id it
    # opens the stream under. A weakened forward (wrong dataIds/interval/report/id) changes this frame.
    assert sent["method"] == "StartStream" and sent["id"] == 42
    assert sent["params"]["dataIds"] == ["SpO2"]
    assert sent["params"]["sampleIntervalMs"] == 1000
    assert sent["params"]["reportIntervalMs"] == 2000


def test_stream_defaults_the_sample_interval_and_the_start_id():
    """Called with only the dataIds, stream() opens with the documented defaults — 40 ms sampling and
    rpc id 16. The ACK here carries id 16, so a mutated default start_id would send a different id and
    this frame assertion catches it (and the ACK would no longer match)."""
    dev = FakeAS11([_ack([("PatientFlow", True)]), _stream_data({"PatientFlow": [0.0]})])
    _run(_collect(P.stream(dev.write, dev.recv_frame, _seal, _unseal, ["PatientFlow"], max_batches=1)))
    sent = json.loads(L.fig_unframe(dev.written[0])[1])
    assert sent["id"] == 16, "default start_id is 16"
    assert sent["params"]["sampleIntervalMs"] == 40, "default sample interval is 40 ms"


def test_stream_carries_the_device_start_time_verbatim_never_fabricated():
    """The device clock runs minutes off the box; this layer must pass startTime through untouched so the
    box's own stamp — not a guess here — is the correction."""
    dev = FakeAS11([_ack([("PatientFlow", True)]),
                    _stream_data({"PatientFlow": [0.0]}, start_time="2026-08-23T01:30:28.730Z")])
    b = _run(_collect(P.stream(dev.write, dev.recv_frame, _seal, _unseal, ["PatientFlow"],
                               start_id=_START_ID, max_batches=1)))[0]
    assert b["start_time"] == "2026-08-23T01:30:28.730Z"


def test_stream_raises_when_the_device_reports_no_stream_id():
    dev = FakeAS11([_enc({"id": _START_ID, "result": {"dataIds": [{"dataId": "PatientFlow", "valid": True}]}})])
    with pytest.raises(P.As11Error, match="streamId"):
        _run(_collect(P.stream(dev.write, dev.recv_frame, _seal, _unseal, ["PatientFlow"], start_id=_START_ID)))


def test_stream_raises_on_a_partially_rejected_id_rather_than_streaming_a_subset():
    """A device that accepts PatientFlow but not BadId must not silently stream just the good one — the
    caller asked for both, and a half-answer read as complete is the failure to avoid."""
    dev = FakeAS11([_ack([("PatientFlow", True), ("BadId", False)])])
    with pytest.raises(P.As11Error, match="rejected"):
        _run(_collect(P.stream(dev.write, dev.recv_frame, _seal, _unseal,
                               ["PatientFlow", "BadId"], start_id=_START_ID)))


def test_stream_skips_a_non_streamdata_notification():
    dev = FakeAS11([
        _ack([("PatientFlow", True)]),
        _enc({"jsonrpc": "2.0", "method": "HeartBeat"}),   # not StreamData — skipped
        _stream_data({"PatientFlow": [0.5]}),
    ])
    b = _run(_collect(P.stream(dev.write, dev.recv_frame, _seal, _unseal, ["PatientFlow"],
                               start_id=_START_ID, max_batches=1)))
    assert b[0]["channels"] == {"PatientFlow": [0.5]}


def test_stream_ignores_a_different_streams_data():
    dev = FakeAS11([
        _ack([("PatientFlow", True)], stream_id=1),
        _stream_data({"PatientFlow": [9.9]}, stream_id=2),   # some other stream — not ours
        _stream_data({"PatientFlow": [0.5]}, stream_id=1),
    ])
    b = _run(_collect(P.stream(dev.write, dev.recv_frame, _seal, _unseal, ["PatientFlow"],
                               start_id=_START_ID, max_batches=1)))
    assert b[0]["channels"] == {"PatientFlow": [0.5]}, "only the matching streamId is yielded"


def test_stream_runs_until_the_caller_stops_when_max_batches_is_none():
    """max_batches=None means 'until the caller stops iterating' — pin it by breaking after one batch
    from a transport that would otherwise keep feeding StreamData."""
    dev = FakeAS11([_ack([("PatientFlow", True)])]
                   + [_stream_data({"PatientFlow": [i]}) for i in range(5)])

    async def take_one():
        got = []
        async for batch in P.stream(dev.write, dev.recv_frame, _seal, _unseal, ["PatientFlow"], start_id=_START_ID):
            got.append(batch)
            break
        return got
    got = _run(take_one())
    assert len(got) == 1 and got[0]["channels"] == {"PatientFlow": [0]}


# ── P3 gap-accounting at the frame boundary (counters=) ─────────────────────────────────────────────
def test_stream_counts_ok_foreign_and_malformed_where_frames_are_seen():
    """INV7 at the frame boundary: a non-StreamData and a foreign-streamId frame are COUNTED, not
    silently eaten. Filtering is unchanged — only the OK frame yields."""
    from cpap_ingest import GapCounters
    c = GapCounters()
    dev = FakeAS11([
        _ack([("PatientFlow", True), ("MaskPressure", True)]),
        _enc({"jsonrpc": "2.0", "method": "HeartBeat", "params": {}}),          # MALFORMED (not StreamData)
        _stream_data({"PatientFlow": [0.01, 0.02]}, stream_id=99),               # FOREIGN (wrong streamId)
        _stream_data({"PatientFlow": [0.03, 0.04], "MaskPressure": [0.3, 0.4]}),  # OK — 4 samples
    ])
    batches = _run(_collect(P.stream(dev.write, dev.recv_frame, _seal, _unseal,
                                     ["PatientFlow", "MaskPressure"], start_id=_START_ID,
                                     max_batches=1, counters=c)))
    assert len(batches) == 1                                     # filtering unchanged — only OK yielded
    assert c.frames_ok == 1 and c.samples_ok == 4
    assert c.malformed == 1 and c.foreign_stream == 1


def test_stream_without_counters_is_unchanged():
    """counters defaults to None — the counting branches are skipped and behaviour is exactly as before."""
    dev = FakeAS11([_ack([("SpO2", True)]), _stream_data({"SpO2": [98.0]})])
    batches = _run(_collect(P.stream(dev.write, dev.recv_frame, _seal, _unseal, ["SpO2"],
                                     start_id=_START_ID, max_batches=1)))
    assert len(batches) == 1 and batches[0]["channels"] == {"SpO2": [98.0]}
