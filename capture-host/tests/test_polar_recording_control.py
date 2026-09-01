# tepna-capture — tests/test_polar_recording_control.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The H10 onboard-recording control surface (POLAR-ONBOARD-BACKUP §6 Q1 / FOLLOWUPS §4): the wire
# codec for REQUEST_START/STOP/RECORDING_STATUS, the SECOND allowlist that reaches them, and the
# module wrapper + web endpoint that make the RR-acceptance probe runnable through the daemon.
#
# Two properties dominate:
#   · SAFETY IS PRESERVED, NOT WIDENED. `query()` and every time path keep the strict three-id
#     allowlist; the recording ids are reachable ONLY through the named `recording_*` path, and
#     PREPARE_FIRMWARE_UPDATE (12) is reachable through NOTHING. A widened single allowlist would
#     have made a wrong id in any old call able to start a recording — the exact accident the
#     original comment warns about.
#   · A WRITE IS A CLAIM UNTIL READ BACK. `recording_control` answers with the device's own status
#     readback, never an echo of the request — the O2Ring RTC discipline, applied here.
#
# Wire facts: polarofficial/polar-ble-sdk pftp_request.proto / pftp_response.proto / types.proto
# (verified 2026-09-01): PbPFtpRequestStartRecordingParams{sample_type=1, recording_interval=2
# (PbDuration{seconds=3}), sample_data_identifier=3}; PbRequestRecordingStatusResult{recording_on=1,
# sample_data_identifier=2}; SAMPLE_TYPE_HEART_RATE=1, SAMPLE_TYPE_RR_INTERVAL=16.

import asyncio

import pytest

import polar_psftp as ps
import webmon
from tests.test_webmon_api import H10, RING, _mk, _serve


def _run(coro):
    return asyncio.run(coro)


# ── the codec ───────────────────────────────────────────────────────────────────────────────────────

def test_start_recording_params_round_trip_and_exact_bytes():
    """Round-trip through the module's own reader, plus the derivable golden: field1 varint 16 =
    08 10; field2 = PbDuration{seconds=1} nested = 12 02 18 01."""
    raw = ps.encode_start_recording(ps.SAMPLE_TYPE_RR_INTERVAL, 1)
    assert raw == b"\x08\x10\x12\x02\x18\x01"
    f = ps._parse_pb_fields(raw)
    assert f[1] == ps.SAMPLE_TYPE_RR_INTERVAL
    assert ps._parse_pb_fields(f[2])[3] == 1          # PbDuration.seconds


def test_start_recording_params_carry_an_identifier_when_given():
    raw = ps.encode_start_recording(ps.SAMPLE_TYPE_HEART_RATE, 5, "TEPNA")
    f = ps._parse_pb_fields(raw)
    assert f[1] == ps.SAMPLE_TYPE_HEART_RATE
    assert ps._parse_pb_fields(f[2])[3] == 5
    assert f[3] == b"TEPNA"
    # …and omit the optional field entirely when not given — absent, not empty (proto2 optional)
    assert 3 not in ps._parse_pb_fields(ps.encode_start_recording(1, 1))


def test_recording_status_parses_both_verdicts_and_the_identifier():
    on = ps._pb_uint(1, 1) + ps._pb_msg(2, b"RR_INTERVAL")
    assert ps.parse_recording_status(on) == (True, "RR_INTERVAL")
    assert ps.parse_recording_status(ps._pb_uint(1, 0)) == (False, None)


def test_recording_status_reports_absence_never_a_fabricated_false():
    """'Could not read the status' and 'not recording' are different claims (§8's rule)."""
    assert ps.parse_recording_status(b"\x08") == (None, None)          # truncated varint -> except
    # field 1 present but length-delimited (wrong wire type for a bool) -> not an int -> (None, None)
    assert ps.parse_recording_status(b"\x0a\x00") == (None, None)


# ── the second allowlist — safety preserved, not widened ────────────────────────────────────────────

def test_time_paths_still_refuse_recording_ids():
    with pytest.raises(ValueError, match="refusing PS-FTP query id 14"):
        ps._encode_query_header(ps.REQUEST_START_RECORDING)
    with pytest.raises(ValueError):
        ps._build_query_packets(ps.REQUEST_STOP_RECORDING, b"", 200)


def test_recording_path_reaches_exactly_the_three_recording_ids():
    hdr = ps._encode_query_header(ps.REQUEST_START_RECORDING, recording=True)
    assert hdr == bytes([14, 0x80])                    # top bit 1 = QUERY, id in the low byte
    ps._encode_query_header(ps.REQUEST_STOP_RECORDING, recording=True)
    ps._encode_query_header(ps.REQUEST_RECORDING_STATUS, recording=True)


def test_firmware_update_is_reachable_through_nothing():
    """PREPARE_FIRMWARE_UPDATE (12) must refuse on BOTH paths — the recording flag is not a skeleton
    key, it admits exactly the three recording ids."""
    with pytest.raises(ValueError):
        ps._encode_query_header(12)
    with pytest.raises(ValueError):
        ps._encode_query_header(12, recording=True)


def test_the_client_recording_query_rejects_non_recording_ids_before_touching_the_link():
    """`_recording_query` is the only sender with the recording flag, so its own id check is the
    last wall: a time id routed through it must refuse without any BLE traffic (the client here was
    never connected — reaching the link would explode differently)."""
    fs = ps.PolarPsFtp("00:11:22:33:44:55")
    with pytest.raises(ValueError, match="not a recording query id"):
        _run(fs._recording_query(ps.GET_LOCAL_TIME))


def test_the_client_recording_query_requires_an_open_session():
    fs = ps.PolarPsFtp("00:11:22:33:44:55")
    with pytest.raises(RuntimeError, match="not connected"):
        _run(fs._recording_query(ps.REQUEST_RECORDING_STATUS))


class _FakeBleak:
    """Collects the GATT writes so the framed wire bytes can be asserted."""

    def __init__(self):
        self.writes: list[bytes] = []

    async def write_gatt_char(self, char, pkt, response=False):
        self.writes.append(bytes(pkt))


def test_the_client_methods_frame_the_wire_and_parse_the_reply(monkeypatch):
    """Drive the three client methods over a fake link: the framed stream must reassemble to the
    query header + params (the same identity the time-path test pins), and the status reply must come
    back through parse_recording_status."""
    fs = ps.PolarPsFtp("00:11:22:33:44:55")
    fake = _FakeBleak()
    fs._client = fake

    async def reply(timeout):
        return ps._pb_uint(1, 1) + ps._pb_msg(2, b"RR_INTERVAL")
    monkeypatch.setattr(fs, "_read_response", reply)

    assert _run(fs.recording_status()) == (True, "RR_INTERVAL")
    stream = b"".join(p[1:] for p in fake.writes)
    assert stream == ps._encode_query_header(ps.REQUEST_RECORDING_STATUS, recording=True)

    fake.writes.clear()
    _run(fs.start_recording(ps.SAMPLE_TYPE_RR_INTERVAL))
    stream = b"".join(p[1:] for p in fake.writes)
    assert stream == ps._encode_query_header(
        ps.REQUEST_START_RECORDING, ps.encode_start_recording(ps.SAMPLE_TYPE_RR_INTERVAL, 1),
        recording=True)

    fake.writes.clear()
    _run(fs.stop_recording())
    stream = b"".join(p[1:] for p in fake.writes)
    assert stream == ps._encode_query_header(ps.REQUEST_STOP_RECORDING, recording=True)


# ── recording_control — the readback discipline ─────────────────────────────────────────────────────

class _FakeFs:
    """Stands in for PolarPsFtp: records the ops, answers a scripted status."""
    calls: list = []
    status = (True, "RR_INTERVAL")

    def __init__(self, address, adapter=None):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def recording_status(self):
        _FakeFs.calls.append(("status",))
        return _FakeFs.status

    async def start_recording(self, sample_type, interval_s=1, identifier=None):
        _FakeFs.calls.append(("start", sample_type, interval_s))

    async def stop_recording(self):
        _FakeFs.calls.append(("stop",))


@pytest.fixture()
def fake_fs(monkeypatch):
    _FakeFs.calls = []
    _FakeFs.status = (True, "RR_INTERVAL")
    monkeypatch.setattr(ps, "PolarPsFtp", _FakeFs)
    return _FakeFs


def test_control_status_is_a_pure_read(fake_fs):
    out = _run(ps.recording_control("AA", "status"))
    assert out == {"recording_on": True, "sample_data_identifier": "RR_INTERVAL"}
    assert fake_fs.calls == [("status",)]


def test_control_start_defaults_to_rr_and_answers_with_the_readback(fake_fs):
    out = _run(ps.recording_control("AA", "start"))
    assert fake_fs.calls == [("start", ps.SAMPLE_TYPE_RR_INTERVAL, 1), ("status",)]
    assert out["readback"] is True and out["recording_on"] is True


def test_control_stop_reads_back_too(fake_fs):
    fake_fs.status = (False, None)
    out = _run(ps.recording_control("AA", "stop"))
    assert fake_fs.calls == [("stop",), ("status",)]
    assert out == {"recording_on": False, "sample_data_identifier": None, "readback": True}


def test_control_refuses_an_unknown_action_before_any_op(fake_fs):
    with pytest.raises(ValueError, match="unknown recording action"):
        _run(ps.recording_control("AA", "erase"))
    assert fake_fs.calls == [], "a bad action must not touch the device"


# ── the endpoint ────────────────────────────────────────────────────────────────────────────────────

def test_endpoint_rejects_a_non_polar_address(tmp_path):
    app, *_ = _mk(tmp_path, devices=[RING])

    async def go(c):
        r = await c.post("/api/polar/recording", json={"address": RING["address"], "action": "status"})
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 400 and "non-Polar" in body["error"]


def test_endpoint_rejects_a_bad_action_and_a_bad_sample_type(tmp_path):
    app, *_ = _mk(tmp_path)

    async def go(c):
        r1 = await c.post("/api/polar/recording", json={"address": H10["address"], "action": "erase"})
        r2 = await c.post("/api/polar/recording",
                          json={"address": H10["address"], "action": "start", "sample_type": "ppg"})
        return r1.status, r2.status
    assert _serve(app, go) == (400, 400)


def test_endpoint_start_routes_rr_through_recording_control_and_returns_the_readback(tmp_path, monkeypatch):
    seen = {}

    async def fake_control(address, action, sample_type=None, adapter=None):
        seen.update(address=address, action=action, sample_type=sample_type)
        return {"recording_on": True, "sample_data_identifier": "RR_INTERVAL", "readback": True}
    monkeypatch.setattr(webmon.polar_psftp, "recording_control", fake_control)
    app, *_ = _mk(tmp_path)

    async def go(c):
        r = await c.post("/api/polar/recording", json={"address": H10["address"], "action": "start"})
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 200 and body["ok"] is True and body["recording_on"] is True
    assert seen == {"address": H10["address"], "action": "start",
                    "sample_type": ps.SAMPLE_TYPE_RR_INTERVAL}


def test_endpoint_rejects_a_malformed_body(tmp_path):
    app, *_ = _mk(tmp_path)

    async def go(c):
        r = await c.post("/api/polar/recording", data=b"not json",
                         headers={"Content-Type": "application/json"})
        return r.status
    assert _serve(app, go) == 400


def test_endpoint_translates_offline_busy_to_409(tmp_path, monkeypatch):
    """A pull owning the single offline slot is contention, not failure — the UI retries; a 502
    would send the operator hunting a fault that does not exist."""
    import offline_lock

    async def busy(address, action, sample_type=None, adapter=None):
        raise offline_lock.OfflineBusy("Verity")
    monkeypatch.setattr(webmon.polar_psftp, "recording_control", busy)
    app, *_ = _mk(tmp_path)

    async def go(c):
        r = await c.post("/api/polar/recording", json={"address": H10["address"], "action": "status"})
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 409 and body["busy"] == "Verity"


def test_endpoint_surfaces_a_device_refusal_verbatim_as_502(tmp_path, monkeypatch):
    """The §6 Q1 'no' IS the PS-FTP error text — a measurement; flattening it would discard the
    answer the whole endpoint exists to fetch."""
    async def refuse(address, action, sample_type=None, adapter=None):
        raise RuntimeError("PFTP error 103: ERROR_INVALID_PARAMETER")
    monkeypatch.setattr(webmon.polar_psftp, "recording_control", refuse)
    app, *_ = _mk(tmp_path)

    async def go(c):
        r = await c.post("/api/polar/recording", json={"address": H10["address"], "action": "start"})
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 502 and "ERROR_INVALID_PARAMETER" in body["error"]
