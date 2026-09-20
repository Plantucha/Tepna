# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The cost axis of the live CPAP stream (WU4/Unit 2, 2026-09-19): what the link carried, counted where the
loop already touches the bytes; the ATT MTU acquired and logged so those bytes convert to radio cost; a
HeartBeat counted as what it is and never as a loss; and an UNPUBLISHED dataId — requested from the device,
recorded verbatim in the raw record, registered on no bus — so the marginal cost of an id is measured and
its unit pinned before any consumer is built on it."""

import asyncio
import collections
import json
import logging
import os

import pytest

import as11_link as L
import as11_pull as P
import cpap_stream as CS
from cpap_ingest import GapCounters

PAIR_KEY = b"K" * 32
NONCE = bytes.fromhex("00112233445566778899aabbccddeeff")
_IV = b"\x00" * 16


def _run(coro):
    return asyncio.run(coro)


# A cipher with the REAL wire shape: 16-byte IV + body padded to 16. Wire and json sizes differ, so a
# counter that summed the wrong one is caught — the identity cipher of the sibling tests cannot see that.
def _seal(payload):
    pad = (-len(payload)) % 16
    return _IV + payload + b"\x00" * pad


def _unseal(wire):
    return wire[16:].rstrip(b"\x00")


def _shaped_factory(session_key):
    assert isinstance(session_key, bytes) and len(session_key) == 32
    return _seal, _unseal


def _enc(obj):
    return (L.VCID_ENC_RX, _seal(json.dumps(obj, separators=(",", ":")).encode()))


def _plain(obj):
    return (L.VCID_PLAIN_RX, json.dumps(obj).encode())


def _handshake():
    return [
        _plain({"id": 10, "result": {"challenge": b"chal-16-bytes!!!".hex(), "nonce": NONCE.hex()}}),
        _plain({"id": 11, "result": {"confirmation": True}}),
    ]


def _ack(ids, rpc_id=16, stream_id=1):
    return _enc(
        {"id": rpc_id, "result": {"dataIds": [{"dataId": d, "valid": True} for d in ids], "streamId": stream_id}}
    )


def _data(chans, stream_id=1):
    return _enc(
        {
            "jsonrpc": "2.0",
            "method": "StreamData",
            "params": {
                "data": [{k: v} for k, v in chans.items()],
                "intervalMs": 40,
                "startTime": "2026-08-23T01:30:28.730Z",
                "streamId": stream_id,
            },
        }
    )


HB = {"jsonrpc": "2.0", "method": "HeartBeat", "params": {}}


class FakeDev:
    def __init__(self, frames):
        self._f = collections.deque(frames)
        self.written = []

    async def write(self, frame):
        self.written.append(frame)

    async def recv_frame(self):
        return self._f.popleft()


class _Bus:
    def __init__(self):
        self.registered = {}
        self.pushed = []

    def register(self, key, label, unit, fs, chans=1, labels=()):
        self.registered[key] = (label, unit)

    def push(self, stream, values, fs=None, dev_ns=None):
        self.pushed.append((stream, list(values)))


class _Raw:
    """The least of RawRecordSink that matters here: it keeps EVERY channel of a batch."""

    def __init__(self):
        self.batches = []

    def open(self, channels, fs):
        self.opened = channels

    def on_batch(self, batch):
        self.batches.append(dict(batch.get("channels") or {}))

    def close(self):
        pass

    def acq_facts(self):
        return {
            "session_id": "s",
            "device_id": "d",
            "path": None,
            "size": None,
            "records": len(self.batches),
            "first_device_start": None,
            "closed_cleanly": True,
        }


def _sent(dev, skip=0):
    return [json.loads(_unseal(L.fig_unframe(f)[1])) for f in dev.written[skip:]]


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# BYTES — counted per frame, every kind, wire ≠ json under a real cipher shape
# ══════════════════════════════════════════════════════════════════════════════════════════════════
def test_bytes_wire_and_bytes_json_are_summed_over_EVERY_frame_and_differ_by_the_cipher_envelope():
    c = GapCounters()
    frames = [
        _enc(HB),
        _data({"PatientFlow": [0.03], "MaskPressure": [5.2]}, stream_id=9),  # FOREIGN
        _data({"PatientFlow": [0.01, 0.02], "MaskPressure": [5.0, 5.1]}),
    ]  # OK — ends the loop
    dev = FakeDev([_ack(["PatientFlow", "MaskPressure"])] + frames)

    async def go():
        out = []
        async for b in P.stream(
            dev.write, dev.recv_frame, _seal, _unseal, ["PatientFlow", "MaskPressure"], max_batches=1, counters=c
        ):
            out.append(b)
        return out

    assert len(_run(go())) == 1
    assert (c.frames_ok, c.notifications, c.foreign_stream, c.malformed) == (1, 1, 1, 0)
    wire = sum(len(f[1]) for f in frames)
    js = sum(len(_unseal(f[1])) for f in frames)
    assert c.bytes_wire == wire and c.bytes_json == js
    assert wire > js and (wire - js) >= 16 * 3, "IV + padding per frame — the envelope is visible"
    assert c.total_lost == 0, "a HeartBeat and a foreign frame are not lost samples"


def test_read_frame_reports_sizes_and_read_json_is_its_message_only_view():
    dev = FakeDev([_enc({"id": 1, "result": {}}), _enc({"id": 2})])
    msg, wire, js = _run(P._read_frame(dev.recv_frame, _unseal))
    # body 20 B → padded to 32 + 16 B IV = 48 on the wire
    assert msg == {"id": 1, "result": {}} and js == len(b'{"id":1,"result":{}}') == 20 and wire == 48
    assert _run(P._read_json(dev.recv_frame, _unseal)) == {"id": 2}


def test_a_per_night_gap_line_carries_the_byte_totals_and_the_notification_count(caplog):
    dev = FakeDev(
        _handshake()
        + [_ack(["PatientFlow", "MaskPressure"]), _enc(HB), _data({"PatientFlow": [0.1], "MaskPressure": [5.0]})]
    )
    with caplog.at_level(logging.INFO, logger="tepna.cpap"):
        _run(
            CS.stream_to_bus(
                _Bus(), dev.write, dev.recv_frame, PAIR_KEY, "cid", cipher_factory=_shaped_factory, max_batches=1
            )
        )
    lines = [r.getMessage() for r in caplog.records if "gap accounting" in r.getMessage()]
    assert len(lines) == 1
    assert "'notifications': 1" in lines[0] and "'malformed': 0" in lines[0] and "'total_lost': 0" in lines[0]
    assert "'bytes_wire': " in lines[0] and "'bytes_json': " in lines[0]


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# MTU — acquired after start_notify and logged; the write step follows it; a failure costs nothing
# ══════════════════════════════════════════════════════════════════════════════════════════════════
def _fake_bleak(monkeypatch, acquire):
    """The test_cpap_stream fake client with a backend that CAN acquire the MTU (bleak's BlueZ backend
    shape): `acquire` sets the client's mtu_size, or raises."""
    from test_cpap_stream import _FakeBleak
    import bleak

    class _Client(_FakeBleak):
        def __init__(self, *a, **k):
            super().__init__(*a, **k)
            self.mtu_size = 23  # the placeholder BlueZ reports before acquire
            client = self

            async def _acquire_mtu():
                acquire(client)

            self._backend._acquire_mtu = _acquire_mtu

    _FakeBleak.instances.clear()
    monkeypatch.setattr(bleak, "BleakClient", _Client)
    return _FakeBleak


def test_connect_acquires_the_REAL_mtu_logs_it_and_sizes_the_write_step_by_it(monkeypatch, caplog):
    import capture

    def acquire(client):
        client.mtu_size = 247

    fb = _fake_bleak(monkeypatch, acquire)

    async def go():
        with caplog.at_level(logging.INFO, logger=capture.log.name):
            write, _recv, disconnect = await capture._cpap_ble_connect("04:CD:15:3A:0B:BD", "hci1")
        await write(b"x" * 250)  # step 244 → 2 chunks
        assert len(fb.instances[-1].written) == 2
        await disconnect()

    _run(go())
    assert any("link MTU=247 (write step 244)" in r.getMessage() for r in caplog.records)


def test_a_failed_mtu_acquire_leaves_the_placeholder_and_the_link_up(monkeypatch, caplog):
    import capture

    def acquire(client):
        raise RuntimeError("dbus went away")

    fb = _fake_bleak(monkeypatch, acquire)

    async def go():
        with caplog.at_level(logging.INFO, logger=capture.log.name):
            write, _recv, disconnect = await capture._cpap_ble_connect("04:CD:15:3A:0B:BD", "hci1")
        await write(b"x" * 40)  # step 20 → 2 chunks
        assert len(fb.instances[-1].written) == 2 and fb.instances[-1].connected
        await disconnect()

    _run(go())
    assert any("link MTU=23 (write step 20)" in r.getMessage() for r in caplog.records)


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# UNPUBLISHED IDS — requested, recorded, never published
# ══════════════════════════════════════════════════════════════════════════════════════════════════
def test_an_extra_id_is_REQUESTED_lands_in_the_raw_record_and_reaches_NO_bus(caplog):
    bus, raw = _Bus(), _Raw()
    dev = FakeDev(
        _handshake()
        + [
            _ack(["PatientFlow", "MaskPressure", "_LKF"]),
            _data({"PatientFlow": [0.1, 0.2], "MaskPressure": [5.0, 5.1], "Leak": [0.4, 0.4]}),
        ]
    )
    with caplog.at_level(logging.INFO, logger="tepna.cpap"):
        n = _run(
            CS.stream_to_bus(
                bus,
                dev.write,
                dev.recv_frame,
                PAIR_KEY,
                "cid",
                cipher_factory=_shaped_factory,
                max_batches=1,
                extra_sinks=[raw],
                extra_ids=("_LKF",),
            )
        )
    assert n == 1
    assert _sent(dev, skip=2)[0]["params"]["dataIds"] == ["PatientFlow", "MaskPressure", "_LKF"]
    assert set(bus.registered) == {"cpap_flow", "cpap_pressure"}, "no bus channel under an unpinned unit"
    assert [k for k, _ in bus.pushed] == ["cpap_flow", "cpap_pressure"]
    assert raw.batches == [{"PatientFlow": [0.1, 0.2], "MaskPressure": [5.0, 5.1], "Leak": [0.4, 0.4]}], "verbatim"
    assert raw.opened == CS.BRP_CHANNELS, "the sinks' channel table is the PUBLISHED one"
    assert any("requesting ['_LKF'] UNPUBLISHED" in r.getMessage() for r in caplog.records)


def test_an_extra_id_already_in_channels_is_not_requested_twice_and_no_extras_is_the_old_call():
    dev = FakeDev(
        _handshake() + [_ack(["PatientFlow", "MaskPressure"]), _data({"PatientFlow": [0.1], "MaskPressure": [5.0]})]
    )
    _run(
        CS.stream_to_bus(
            _Bus(),
            dev.write,
            dev.recv_frame,
            PAIR_KEY,
            "cid",
            cipher_factory=_shaped_factory,
            max_batches=1,
            extra_ids=("MaskPressure",),
        )
    )
    assert _sent(dev, skip=2)[0]["params"]["dataIds"] == ["PatientFlow", "MaskPressure"]
    dev2 = FakeDev(
        _handshake() + [_ack(["PatientFlow", "MaskPressure"]), _data({"PatientFlow": [0.1], "MaskPressure": [5.0]})]
    )
    _run(
        CS.stream_to_bus(
            _Bus(), dev2.write, dev2.recv_frame, PAIR_KEY, "cid", cipher_factory=_shaped_factory, max_batches=1
        )
    )
    assert _sent(dev2, skip=2)[0]["params"]["dataIds"] == ["PatientFlow", "MaskPressure"]


def test_the_controller_forwards_extra_ids_only_when_it_has_them():
    from test_cpap_stream import _ControllerBus, _connector, _creds, _idle_devices

    seen = []

    async def pump(bus, write, recv_frame, pk, cid, *, channels=None, should_stop=None, **kw):
        seen.append(kw.get("extra_ids", "ABSENT"))
        while should_stop is None or not should_stop.is_set():
            await asyncio.sleep(0.005)
        return 0

    async def go():
        connect, _ = _connector()
        c = CS.LiveStreamController(_ControllerBus(), connect, _creds, _idle_devices, pump=pump, extra_ids=["_LKF"])
        await c.op("start")
        await asyncio.sleep(0.02)
        await c.op("stop")
        c2 = CS.LiveStreamController(_ControllerBus(), connect, _creds, _idle_devices, pump=pump)
        await c2.op("start")
        await asyncio.sleep(0.02)
        await c2.op("stop")

    _run(go())
    assert seen == [("_LKF",), "ABSENT"]


def test_the_daemon_REFUSES_extra_ids_without_a_raw_record_and_arms_them_with_one(tmp_path, caplog):
    import capture

    assert capture._cpap_extra_ids({}, None) == ()
    assert capture._cpap_extra_ids({"extra_data_ids": []}, str(tmp_path)) == ()
    with pytest.raises(ValueError, match="raw_record_dir"):
        capture._cpap_extra_ids({"extra_data_ids": ["_LKF"]}, None)
    with pytest.raises(ValueError, match="non-empty"):
        capture._cpap_extra_ids({"extra_data_ids": ["_LKF", ""]}, str(tmp_path))
    with pytest.raises(ValueError, match="non-empty"):
        capture._cpap_extra_ids({"extra_data_ids": "_LKF"}, str(tmp_path))
    with caplog.at_level(logging.INFO, logger=capture.log.name):
        assert capture._cpap_extra_ids({"extra_data_ids": ["_LKF"]}, str(tmp_path)) == ("_LKF",)
    assert any("extra dataIds ARMED" in r.getMessage() for r in caplog.records)


def test_the_builder_wires_extra_ids_from_config_and_refuses_the_half_config(tmp_path):
    import capture

    off = capture._build_cpap_controller(object(), {"cpap": {}}, str(tmp_path / "config.yaml"))
    assert off._extra_ids == ()
    raw = tmp_path / "raw"
    on = capture._build_cpap_controller(
        object(),
        {"cpap": {"ble_stream": {"raw_record_dir": str(raw), "extra_data_ids": ["_LKF"]}}},
        str(tmp_path / "config.yaml"),
    )
    assert on._extra_ids == ("_LKF",)
    with pytest.raises(ValueError, match="raw_record_dir"):
        capture._build_cpap_controller(
            object(), {"cpap": {"ble_stream": {"extra_data_ids": ["_LKF"]}}}, str(tmp_path / "config.yaml")
        )


def test_config_example_documents_extra_data_ids_OFF_and_the_raw_record_requirement():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    text = open(os.path.join(here, "config.example.yaml"), encoding="utf-8").read()
    i = text.index("# EXTRA STREAM IDS")
    block = text[i : i + 1400]
    assert '# extra_data_ids: ["_LKF"]' in block and "raw_record_dir" in block and "DEFAULT OFF" in block
