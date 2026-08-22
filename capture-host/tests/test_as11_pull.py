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
    body, more, nxt = _run(P.pull_spool_round(dev.write, dev.recv_frame, _seal, _unseal, "Summary"))
    assert body == b"hello" and more is False and nxt is None


def test_round_reassembles_multiple_fragments_by_seq():
    dev = FakeAS11([
        _enc({"id": 14, "result": {"spoolId": 5}}),
        _frag(0, b"AAA", "SPOOL_INCOMPLETE"),
        _frag(1, b"BBB", "SPOOL_INCOMPLETE"),
        _frag(2, b"CCC", "SPOOL_COMPLETE_NO_MORE_DATA"),
    ])
    body, more, nxt = _run(P.pull_spool_round(dev.write, dev.recv_frame, _seal, _unseal, "Summary"))
    assert body == b"AAABBBCCC" and more is False


def test_round_more_pending_reports_next_address():
    dev = FakeAS11([
        _enc({"id": 14, "result": {"spoolId": 5}}),
        _frag(0, b"part1", "SPOOL_COMPLETE_MORE_DATA_PENDING", next_dt="2026-04-29T11:00:00.000Z"),
    ])
    body, more, nxt = _run(P.pull_spool_round(dev.write, dev.recv_frame, _seal, _unseal, "Summary"))
    assert body == b"part1" and more is True and nxt == "2026-04-29T11:00:00.000Z"


def test_round_skips_a_non_spoolfragment_notification():
    dev = FakeAS11([
        _enc({"id": 14, "result": {"spoolId": 5}}),
        _enc({"jsonrpc": "2.0", "method": "HeartBeat"}),  # not a SpoolFragment — skipped
        _frag(0, b"z", "SPOOL_COMPLETE_NO_MORE_DATA"),
    ])
    body, _more, _nxt = _run(P.pull_spool_round(dev.write, dev.recv_frame, _seal, _unseal, "Summary"))
    assert body == b"z"


def test_round_terminal_fragment_with_no_data():
    dev = FakeAS11([
        _enc({"id": 14, "result": {"spoolId": 5}}),
        _frag(0, None, "SPOOL_COMPLETE_NO_MORE_DATA"),  # empty terminal round
    ])
    body, more, _nxt = _run(P.pull_spool_round(dev.write, dev.recv_frame, _seal, _unseal, "Summary"))
    assert body == b"" and more is False


def test_round_raises_on_data_unavailable():
    dev = FakeAS11([
        _enc({"id": 14, "result": {"spoolId": 5}}),
        _frag(0, None, "ERROR_DATA_UNAVAILABLE"),
    ])
    with pytest.raises(P.As11Error):
        _run(P.pull_spool_round(dev.write, dev.recv_frame, _seal, _unseal, "Summary"))


def test_round_raises_on_start_spool_error():
    dev = FakeAS11([_enc({"id": 14, "error": {"message": "no such spool"}})])
    with pytest.raises(P.As11Error):
        _run(P.pull_spool_round(dev.write, dev.recv_frame, _seal, _unseal, "Summary"))


# ── pull_spool (multi-round) ─────────────────────────────────────────────────
def test_pull_spool_single_round():
    dev = FakeAS11([
        _enc({"id": 14, "result": {"spoolId": 5}}),
        _frag(0, b"one", "SPOOL_COMPLETE_NO_MORE_DATA"),
    ])
    assert _run(P.pull_spool(dev.write, dev.recv_frame, _seal, _unseal, "Summary")) == b"one"


def test_pull_spool_continues_across_rounds():
    dev = FakeAS11([
        _enc({"id": 14, "result": {"spoolId": 5}}),
        _frag(0, b"R1", "SPOOL_COMPLETE_MORE_DATA_PENDING", next_dt="2026-05-01T00:00:00.000Z"),
        _enc({"id": 14, "result": {"spoolId": 5}}),
        _frag(0, b"R2", "SPOOL_COMPLETE_NO_MORE_DATA"),
    ])
    assert _run(P.pull_spool(dev.write, dev.recv_frame, _seal, _unseal, "Summary")) == b"R1R2"


def test_pull_spool_bounds_runaway_rounds():
    # a device that always says MORE_DATA_PENDING must not loop forever
    frames = []
    for _ in range(3):
        frames.append(_enc({"id": 14, "result": {"spoolId": 5}}))
        frames.append(_frag(0, b"x", "SPOOL_COMPLETE_MORE_DATA_PENDING", next_dt="2026-05-01T00:00:00.000Z"))
    dev = FakeAS11(frames)
    with pytest.raises(P.As11Error):
        _run(P.pull_spool(dev.write, dev.recv_frame, _seal, _unseal, "Summary", max_rounds=2))
