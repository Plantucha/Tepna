# tepna-capture — as11_pull.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# ResMed AirSense 11 — encrypted-session PULL orchestration (read-only).
#
# PURE + FULLY INJECTED. Nothing here does BLE or crypto directly. Every function takes:
#   * write(frame_bytes)            async — send one FIG frame
#   * recv_frame() -> (vcid, bytes) async — the next reassembled FIG frame
#   * seal(payload_bytes)  -> bytes       — encrypt one RPC payload (session key bound)
#   * unseal(wire_bytes)   -> bytes       — decrypt one encrypted payload
# The AES cipher is NOT a dependency of this module (capture-host carries no crypto dep):
# the operator probe binds the session key to a real AES-256-CBC seal/unseal and passes them
# in; tests pass an identity cipher. So the whole state machine is testable with the standard
# library alone, and the wire cipher is validated live by the probe's encrypted-Get check.
#
# READ-ONLY: reconnect auth (plaintext), GetDateTime, StartSpool/PullSpoolFragments. No write.
# Protocol: RESMED-AS11-PROTOCOL-REFERENCE-2026-08-21-BRIEF.
from __future__ import annotations

import base64
import json

import as11_link as L


class As11Error(RuntimeError):
    """An AS11 RPC returned an error, or a spool round failed."""


# P3 gap-accounting taxonomy — used ONLY to COUNT frames at the stream boundary (see stream()).
from cpap_ingest import FrameKind as _FrameKind

async def _read_json(recv_frame, unseal=None):
    """Read one FIG frame; decrypt if it is an encrypted-channel frame; decode JSON."""
    vcid, payload = await recv_frame()
    if vcid == L.VCID_ENC_RX:
        if unseal is None:
            raise As11Error("encrypted frame received without a cipher")
        payload = unseal(payload)
    return json.loads(payload.decode("utf-8"))


async def _await_result(recv_frame, rpc_id, unseal=None):
    """Read frames until the response echoing rpc_id arrives; skip HeartBeat/other notifications."""
    while True:
        msg = await _read_json(recv_frame, unseal)
        if msg.get("id") != rpc_id:
            continue  # a HeartBeat or out-of-band notification — keep reading
        if "error" in msg:
            raise As11Error(f"RPC {rpc_id} failed: {msg['error']}")
        return msg.get("result", {})


async def _send_enc(write, seal, payload):
    """Encrypt an RPC payload and write it framed on the encrypted TX VCID."""
    await write(L.fig_frame(L.VCID_ENC_TX, seal(payload)))


async def establish(pair_key, client_id, write, recv_frame, *, req_id=10, chk_id=11):
    """Run the passwordless reconnect handshake (plaintext) and return the AES-256 session key.

    RequestSession(clientId) -> {challenge, nonce}; response = HMAC-SHA256(K, challenge);
    CheckSessionIntegrity(response); session_key = SHA256(K || nonce_raw).
    """
    await write(L.fig_frame(L.VCID_PLAIN_TX, L.request_session(client_id, req_id)))
    res = await _await_result(recv_frame, req_id)
    challenge = bytes.fromhex(res["challenge"])
    nonce = bytes.fromhex(res["nonce"])
    proof = L.session_proof(pair_key, challenge)
    await write(L.fig_frame(L.VCID_PLAIN_TX, L.check_session_integrity(proof.hex(), chk_id)))
    await _await_result(recv_frame, chk_id)  # raises on error; {"confirmation":true} unused
    return L.session_key(pair_key, nonce)


async def get_date_time(write, recv_frame, seal, unseal, *, rpc_id=13):
    """GetDateTime over the encrypted channel → the device clock as an ISO-8601 string."""
    await _send_enc(write, seal, L.get_date_time(rpc_id))
    res = await _await_result(recv_frame, rpc_id, unseal)
    return res["dateTime"]


# Terminal spool statuses (rpc_protocol.md §SpoolFragment).
_ROUND_DONE = ("SPOOL_COMPLETE_MORE_DATA_PENDING", "SPOOL_COMPLETE_NO_MORE_DATA")


async def pull_spool_round(write, recv_frame, seal, unseal, spool_type, from_dt, *, start_id=14, pull_id=15):
    """Pull ONE spool round. Returns (data_bytes, more_pending, next_from_dt).

    `from_dt` is REQUIRED (hardware-confirmed — see as11_link.start_spool). StartSpool opens the
    reader; PullSpoolFragments drives SpoolFragment notifications whose Base64 `data` is reassembled
    in strict `seq` order until a terminal status.
    """
    await _send_enc(write, seal, L.start_spool(spool_type, from_dt, rpc_id=start_id))
    started = await _await_result(recv_frame, start_id, unseal)
    spool_id = started["spoolId"]
    await _send_enc(write, seal, L.pull_spool_fragments(spool_id, rpc_id=pull_id))
    chunks: dict[int, bytes] = {}
    while True:
        msg = await _read_json(recv_frame, unseal)
        if msg.get("method") != "SpoolFragment":
            continue  # the PullSpoolFragments {spoolId} echo, a HeartBeat, etc.
        p = msg["params"]
        status = p["status"]
        if status == "ERROR_DATA_UNAVAILABLE":
            raise As11Error(f"spool {spool_type}: data unavailable")
        data = p.get("data")
        if data:
            chunks[p["seq"]] = base64.b64decode(data)
        if status in _ROUND_DONE:
            more = status == "SPOOL_COMPLETE_MORE_DATA_PENDING"
            nxt = p["nextSpoolAddress"][spool_type]["fromDateTime"] if more else None
            body = b"".join(chunks[s] for s in sorted(chunks))
            return body, more, nxt


async def stream(write, recv_frame, seal, unseal, data_ids, *,
                 sample_interval_ms=40, report_interval_ms=None, start_id=16, max_batches=None,
                 counters=None):
    """Async generator over a LIVE AS11 waveform stream (StartStream → StreamData). READ-ONLY.

    Sends StartStream, verifies the device marked EVERY requested dataId valid (a partial accept raises
    rather than silently streaming a subset), then yields one decoded batch per StreamData notification:

        {"stream_id": int, "start_time": "…Z", "interval_ms": int, "channels": {dataId: [float, …]}}

    `start_time` is the DEVICE clock, verbatim as sent (ISO-8601). This layer never fabricates or
    corrects a timestamp — the box applies its own stratum-1 / host-axis stamp downstream, which is the
    whole point of capturing the device-vs-box offset. `channels` merges the device's list-of-one-key
    dicts (`[{"PatientFlow":[…]},{"MaskPressure":[…]}]`) into one map.

    Stops after `max_batches` batches, or — when that is None — runs until the caller stops iterating.
    There is no StopStream RPC: ending iteration and dropping the BLE link is what stops the device."""
    await _send_enc(write, seal, L.start_stream(data_ids, sample_interval_ms, report_interval_ms, rpc_id=start_id))
    ack = await _await_result(recv_frame, start_id, unseal)
    stream_id = ack.get("streamId")
    if stream_id is None:
        raise As11Error("StartStream returned no streamId")
    rejected = [d.get("dataId") for d in ack.get("dataIds", []) if not d.get("valid")]
    if rejected:
        raise As11Error(f"StartStream: device rejected dataId(s): {rejected}")
    count = 0
    while max_batches is None or count < max_batches:
        msg = await _read_json(recv_frame, unseal)
        if msg.get("method") != "StreamData":
            # P3 gap accounting at the frame boundary — count where the frame is SEEN, before the filter
            # eats it (INV7). COUNTING ONLY: what is dropped is unchanged, it is just no longer silent.
            if counters is not None:
                counters.note_frame(_FrameKind.MALFORMED)
            continue  # a HeartBeat or other out-of-band notification — keep reading
        p = msg["params"]
        if p.get("streamId") != stream_id:
            if counters is not None:
                counters.note_frame(_FrameKind.FOREIGN)
            continue  # data from a different stream (defensive) — not ours
        channels: dict[str, list] = {}
        for entry in p.get("data", []):
            channels.update(entry)
        if counters is not None:
            counters.note_frame(_FrameKind.OK,
                                n_samples=sum(len(v) for v in channels.values() if isinstance(v, list)))
        yield {"stream_id": stream_id, "start_time": p.get("startTime"),
               "interval_ms": p.get("intervalMs"), "channels": channels}
        count += 1


async def pull_spool(write, recv_frame, seal, unseal, spool_type, from_dt, *, max_rounds=64):
    """Pull a spool to completion across rounds; concatenate every round's reassembled bytes.

    `from_dt` is REQUIRED (the device rejects an empty spool address — see as11_link.start_spool);
    to pull everything retained, pass a far-past ISO-8601 date. `max_rounds` bounds a pathological
    device that never reports NO_MORE_DATA.
    """
    out = bytearray()
    rounds = 0
    while rounds < max_rounds:
        rounds += 1
        body, more, nxt = await pull_spool_round(write, recv_frame, seal, unseal, spool_type, from_dt)
        out += body
        if not more:
            return bytes(out)
        from_dt = nxt
    raise As11Error(f"spool {spool_type}: exceeded {max_rounds} rounds without completion")
