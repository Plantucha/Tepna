# tepna-capture — tests/test_polar_psftp_client.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The PolarPsFtp client over a FAKE BleakClient that speaks the real RFC76 air-packet framing in both
# directions: it reassembles the host's request packets, parses the PS-FTP operation / query out of them,
# and answers with genuine device→host response packets (seq/status/next bits, MORE→LAST). So the real
# _read_response reassembly, _build_request_packets chunking, _parse_directory, the query allowlist and
# the walk/list_recordings/pull_recording flows are all exercised — no BLE hardware, no protocol stub.

import asyncio

import pytest

import polar_psftp as ps


# ── response framing (device → host), the mirror of _read_response ──────────────────────────────────
def _response_data_packets(data: bytes, mtu: int = 20) -> list[bytes]:
    """Frame `data` as a multi-packet PS-FTP response ending in LAST. byte0 = seq<<4 | status<<1 | next,
    status 1=LAST 2=MORE (read back as (b0>>1)&3), next=0 on the first packet then 1."""
    out, seq, i, first = [], 0, 0, True
    while True:
        chunk = data[i:i + (mtu - 1)]
        i += len(chunk)
        last = i >= len(data)
        status = 0x01 if last else 0x02
        b0 = (seq << 4) | (status << 1) | (0 if first else 1)
        out.append(bytes([b0]) + chunk)
        seq = (seq + 1) & 0x0F
        first = False
        if last:
            return out


def _response_code_packet(err: int = 0) -> bytes:
    """A status-0x00 ERROR_OR_RESPONSE terminator (err=0 → success, no data)."""
    return bytes([(0 << 4) | (0x00 << 1) | 0, err & 0xFF, (err >> 8) & 0xFF])


def _encode_directory(entries):
    """PbPFtpDirectory { repeated PbPFtpEntry{name=1,size=2} } — what _parse_directory reads."""
    return b"".join(ps._pb_msg(1, ps._pb_msg(1, n.encode()) + ps._pb_uint(2, s)) for n, s in entries)


# ── a fake BleakClient that answers a configured filesystem ─────────────────────────────────────────
class FakeClient:
    def __init__(self, dev=None, **kw):
        self.notify = None
        self._rx = bytearray()           # reassembled request stream
        self.connected = False
        self.mtu_size = 250
        # {dir_path: [(name,size)...]}  and  {file_path: bytes}
        self.dirs = {}
        self.files = {}
        self.time_reply = None           # bytes for a GET_LOCAL_TIME query, or None
        self.fail_connect = False

    async def connect(self):
        if self.fail_connect:
            raise RuntimeError("connect refused")
        self.connected = True

    async def disconnect(self):
        self.connected = False

    async def _acquire_mtu(self):
        pass

    async def start_notify(self, _char, cb):
        self.notify = cb

    async def stop_notify(self, _char):
        pass

    async def write_gatt_char(self, _char, pkt, response=False):
        # reassemble RFC76 request packets: status bits (b0 & 0x06) == 0x02 marks LAST
        self._rx += pkt[1:]
        if (pkt[0] & 0x06) != 0x02:       # MORE — wait for the rest
            return
        stream, self._rx = bytes(self._rx), bytearray()
        self._answer(stream)

    def _answer(self, stream: bytes):
        if len(stream) >= 2 and (stream[1] & 0x80):        # QUERY (top bit of byte1 set)
            query_id = stream[0]
            if query_id == ps.GET_LOCAL_TIME and self.time_reply is not None:
                for p in _response_data_packets(self.time_reply):
                    self.notify(0, p)
            else:
                self.notify(0, _response_code_packet(0))    # SET_* → success ack
            return
        # REQUEST: [len_lo, len_hi] + protobuf(op). field 2 = path.
        proto = stream[2:]
        path = ps._parse_pb_fields(proto).get(2, b"").decode("utf-8", "replace")
        if path in self.files:
            for p in _response_data_packets(self.files[path]):
                self.notify(0, p)
        elif path in self.dirs:
            for p in _response_data_packets(_encode_directory(self.dirs[path])):
                self.notify(0, p)
        else:
            self.notify(0, _response_code_packet(0))         # empty


def _install(monkeypatch, client, device="dev"):
    async def find(addr, timeout=15.0, **kw):
        return device
    monkeypatch.setattr(ps.BleakScanner, "find_device_by_address", find)
    monkeypatch.setattr(ps, "BleakClient", lambda dev, **kw: client)
    async def no_disc(addr):
        return None
    monkeypatch.setattr(ps, "_bt_disconnect", no_disc)


def _run(coro):
    return asyncio.run(coro)


# ── connect / context manager ───────────────────────────────────────────────────────────────────────
def test_context_manager_connects_and_disconnects(monkeypatch):
    c = FakeClient()
    _install(monkeypatch, c)

    async def go():
        async with ps.PolarPsFtp("AA:BB", adapter="hci0") as fs:
            assert c.connected is True
            assert fs._frame_mtu == 247          # mtu 250 - 3
        assert c.connected is False              # __aexit__ disconnected
    _run(go())


def test_connect_falls_back_to_the_address_when_the_scan_misses(monkeypatch):
    c = FakeClient()
    async def find(addr, timeout=15.0, **kw): return None    # scan misses
    monkeypatch.setattr(ps.BleakScanner, "find_device_by_address", find)
    monkeypatch.setattr(ps, "BleakClient", lambda dev, **kw: c)
    async def no_disc(addr): return None
    monkeypatch.setattr(ps, "_bt_disconnect", no_disc)

    async def go():
        async with ps.PolarPsFtp("AA:BB"):
            assert c.connected is True
    _run(go())


def test_a_failed_connect_never_leaks_a_half_open_link(monkeypatch):
    c = FakeClient(); c.fail_connect = True
    _install(monkeypatch, c)

    async def go():
        with pytest.raises(RuntimeError, match="connect refused"):
            async with ps.PolarPsFtp("AA:BB"):
                pass
    _run(go())
    assert c.connected is False


# ── get / list_dir / walk ───────────────────────────────────────────────────────────────────────────
def _fs_with_one_session():
    c = FakeClient()
    # the real recording layout: /U/0/YYYYMMDD/{E|R}/HHMMSS/ with the session files inside
    c.dirs = {
        "/U/0/": [("20260719/", 0)],
        "/U/0/20260719/": [("E/", 0)],
        "/U/0/20260719/E/": [("034500/", 0)],
        "/U/0/20260719/E/034500/": [("BPM.GZ", 12), ("PLETH.GZ", 34)],
    }
    c.files = {
        "/U/0/20260719/E/034500/BPM.GZ": b"A" * 12,
        "/U/0/20260719/E/034500/PLETH.GZ": b"B" * 34,
    }
    return c


def test_list_dir_parses_a_directory(monkeypatch):
    c = _fs_with_one_session()
    _install(monkeypatch, c)

    async def go():
        async with ps.PolarPsFtp("AA:BB") as fs:
            return await fs.list_dir("/U/0/20260719/E/034500/")
    assert _run(go()) == [("BPM.GZ", 12), ("PLETH.GZ", 34)]


def test_get_downloads_file_bytes(monkeypatch):
    c = _fs_with_one_session()
    _install(monkeypatch, c)

    async def go():
        async with ps.PolarPsFtp("AA:BB") as fs:
            return await fs.get("/U/0/20260719/E/034500/PLETH.GZ")
    assert _run(go()) == b"B" * 34


def test_walk_recurses_the_whole_tree(monkeypatch):
    c = _fs_with_one_session()
    _install(monkeypatch, c)

    async def go():
        async with ps.PolarPsFtp("AA:BB") as fs:
            return [row async for row in fs.walk("/U/0/")]
    rows = _run(go())
    files = {p for p, sz, is_dir in rows if not is_dir and sz >= 0}
    assert "/U/0/20260719/E/034500/BPM.GZ" in files and "/U/0/20260719/E/034500/PLETH.GZ" in files


# ── the query path (set/get local time) ─────────────────────────────────────────────────────────────
def test_set_local_time_sends_an_allowed_query(monkeypatch):
    import datetime as dt
    c = FakeClient()
    _install(monkeypatch, c)

    async def go():
        async with ps.PolarPsFtp("AA:BB") as fs:
            await fs.set_local_time(dt.datetime(2026, 7, 19, 3, 4, 5), with_system_time=True)
    _run(go())          # must complete — the success ack terminates _read_response


def test_get_local_time_round_trips_the_device_clock(monkeypatch):
    import datetime as dt
    c = FakeClient()
    when = dt.datetime(2026, 7, 19, 3, 4, 5)
    c.time_reply = ps._pb_msg(1, ps._pb_date(when.year, when.month, when.day)) + \
        ps._pb_msg(2, ps._pb_time(when.hour, when.minute, when.second))
    _install(monkeypatch, c)

    async def go():
        async with ps.PolarPsFtp("AA:BB") as fs:
            return await fs.get_local_time()
    got = _run(go())
    assert got.year == 2026 and got.hour == 3 and got.minute == 4


# ── module-level list_recordings / pull_recording ───────────────────────────────────────────────────
def test_list_recordings_groups_files_into_a_session(monkeypatch):
    c = _fs_with_one_session()
    _install(monkeypatch, c)
    out = _run(ps.list_recordings("AA:BB"))
    assert len(out) == 1
    assert out[0]["total_bytes"] == 12 + 34


def test_pull_recording_writes_every_file_and_a_manifest(monkeypatch, tmp_path):
    c = _fs_with_one_session()
    _install(monkeypatch, c)
    manifest = _run(ps.pull_recording("AA:BB", "/U/0/20260719/E/034500/", str(tmp_path)))
    assert manifest["total_bytes"] == 12 + 34
    written = {p.name for p in tmp_path.rglob("*") if p.is_file()}
    assert "BPM.GZ" in written and "PLETH.GZ" in written


# ── _bt_disconnect (the pre-connect BlueZ clear) ────────────────────────────────────────────────────
def test_bt_disconnect_runs_and_swallows_errors(monkeypatch):
    class _P:
        async def wait(self): return 0
    async def fake(*a, **k): return _P()
    monkeypatch.setattr(ps.asyncio, "create_subprocess_exec", fake)
    async def no_sleep(_s): return None
    monkeypatch.setattr(ps.asyncio, "sleep", no_sleep)
    _run(ps._bt_disconnect("AA:BB:CC:DD:EE:FF"))            # success path, no raise

    async def boom(*a, **k): raise FileNotFoundError("no bluetoothctl")
    monkeypatch.setattr(ps.asyncio, "create_subprocess_exec", boom)
    _run(ps._bt_disconnect("AA:BB:CC:DD:EE:FF"))            # except -> swallowed


# ── _read_response error framing ────────────────────────────────────────────────────────────────────
class _BadFrameClient(FakeClient):
    """Answers with a deliberately malformed response to drive _read_response's guards."""
    def __init__(self, mode):
        super().__init__()
        self.mode = mode
    def _answer(self, stream):
        if self.mode == "seq":
            self.notify(0, bytes([(5 << 4) | (0x01 << 1) | 0]) + b"x")   # wrong seq (5, expected 0)
        elif self.mode == "error":
            self.notify(0, bytes([(0 << 4) | (0x00 << 1) | 0, 0x0C, 0x00]))  # error code 12
        elif self.mode == "more_then_last":
            self.notify(0, bytes([(0 << 4) | (0x02 << 1) | 0]) + b"AB")   # MORE
            self.notify(0, bytes([(1 << 4) | (0x01 << 1) | 1]) + b"CD")   # LAST


def test_read_response_raises_on_a_lost_air_packet(monkeypatch):
    _install(monkeypatch, _BadFrameClient("seq"))
    async def go():
        async with ps.PolarPsFtp("AA:BB") as fs:
            await fs.get("/U/0/")
    with pytest.raises(RuntimeError, match="air packet lost"):
        _run(go())


def test_read_response_raises_on_a_psftp_error_code(monkeypatch):
    _install(monkeypatch, _BadFrameClient("error"))
    async def go():
        async with ps.PolarPsFtp("AA:BB") as fs:
            await fs.get("/U/0/")
    with pytest.raises(RuntimeError, match="PS-FTP error 12"):
        _run(go())


def test_read_response_reassembles_more_then_last(monkeypatch):
    _install(monkeypatch, _BadFrameClient("more_then_last"))
    async def go():
        async with ps.PolarPsFtp("AA:BB") as fs:
            return await fs.get("/U/0/somefile")
    assert _run(go()) == b"ABCD", "MORE + LAST must concatenate both payloads"


# ── get_local_time / walk error paths ───────────────────────────────────────────────────────────────
def test_get_local_time_returns_none_on_an_unparseable_reply(monkeypatch):
    c = FakeClient()
    c.time_reply = b"\x08\x01"              # not the {date,time} message shape
    _install(monkeypatch, c)
    async def go():
        async with ps.PolarPsFtp("AA:BB") as fs:
            return await fs.get_local_time()
    assert _run(go()) is None


def test_walk_yields_a_marker_when_a_dir_cannot_be_listed(monkeypatch):
    class _RaiseOnList(FakeClient):
        async def _fail(self, *a): raise RuntimeError("read failed")
    c = _RaiseOnList()
    _install(monkeypatch, c)
    async def go():
        async with ps.PolarPsFtp("AA:BB") as fs:
            fs.list_dir = c._fail                       # force list_dir to raise
            return [row async for row in fs.walk("/U/0/")]
    rows = _run(go())
    assert rows == [("/U/0/", -1, False)], "an unreadable dir yields one (path, -1, False) marker"


# ── _with_retry ─────────────────────────────────────────────────────────────────────────────────────
def test_with_retry_succeeds_after_transient_failures(monkeypatch):
    async def no_sleep(_s): return None
    monkeypatch.setattr(ps.asyncio, "sleep", no_sleep)
    calls = {"n": 0}
    async def flaky():
        calls["n"] += 1
        if calls["n"] < 3:
            raise RuntimeError("device disconnected")
        return "ok"
    assert _run(ps._with_retry(flaky)) == "ok" and calls["n"] == 3


def test_with_retry_reraises_after_exhausting_attempts(monkeypatch):
    async def no_sleep(_s): return None
    monkeypatch.setattr(ps.asyncio, "sleep", no_sleep)
    async def always_fail():
        raise RuntimeError("still broken")
    with pytest.raises(RuntimeError, match="still broken"):
        _run(ps._with_retry(always_fail, attempts=2))


# ── main() CLI ──────────────────────────────────────────────────────────────────────────────────────
def test_main_list(monkeypatch, capsys):
    async def fake_list(addr, adapter=None):
        return [{"path": "/U/0/20260719/E/034500/", "total_bytes": 46, "start_local": "2026-07-19T03:45:00"}]
    monkeypatch.setattr(ps, "list_recordings", fake_list)
    import sys as _sys
    monkeypatch.setattr(_sys, "argv", ["polar_psftp.py", "--address", "AA:BB", "list"])
    ps.main()
    assert "/U/0/20260719/E/034500/" in capsys.readouterr().out


def test_main_pull(monkeypatch, tmp_path):
    seen = {}
    async def fake_list(addr, adapter=None):
        return [{"path": "/U/0/20260719/E/034500/"}]
    async def fake_pull(addr, session, out, adapter=None):
        seen["session"] = session
        return {"files": [], "total_bytes": 0}
    monkeypatch.setattr(ps, "list_recordings", fake_list)
    monkeypatch.setattr(ps, "pull_recording", fake_pull)
    import sys as _sys
    monkeypatch.setattr(_sys, "argv",
                        ["polar_psftp.py", "--address", "AA:BB", "pull", "--out", str(tmp_path)])
    ps.main()
    assert seen["session"] == "/U/0/20260719/E/034500/"


# ── remaining defensive guards + edges ──────────────────────────────────────────────────────────────
def test_acquire_mtu_failure_is_swallowed(monkeypatch):
    c = FakeClient()
    async def boom(): raise RuntimeError("mtu nope")
    c._acquire_mtu = boom
    _install(monkeypatch, c)
    async def go():
        async with ps.PolarPsFtp("AA:BB") as fs:
            assert fs._frame_mtu == 247      # still derived from mtu_size despite the acquire raising
    _run(go())


def test_aexit_swallows_stop_notify_and_disconnect_errors(monkeypatch):
    c = FakeClient()
    async def boom(*a): raise RuntimeError("teardown err")
    c.stop_notify = boom
    c.disconnect = boom
    _install(monkeypatch, c)
    async def go():
        async with ps.PolarPsFtp("AA:BB"):
            pass                              # __aexit__ must swallow both raising teardown calls
    _run(go())                                # no exception propagates


def test_read_response_raises_when_the_next_bit_is_out_of_sync(monkeypatch):
    class _BadNext(FakeClient):
        def _answer(self, stream):
            # correct seq (0) but next-bit set on the FIRST packet (expected 0)
            self.notify(0, bytes([(0 << 4) | (0x01 << 1) | 1]) + b"x")
    _install(monkeypatch, _BadNext())
    async def go():
        async with ps.PolarPsFtp("AA:BB") as fs:
            await fs.get("/U/0/")
    with pytest.raises(RuntimeError, match="out of sync"):
        _run(go())


def test_get_local_time_returns_none_when_the_date_fields_are_malformed(monkeypatch):
    c = FakeClient()
    # d and t ARE length-delimited messages (pass the isinstance check) but the date sub-fields are
    # missing -> datetime(dd[1],...) raises KeyError -> the except returns None.
    c.time_reply = ps._pb_msg(1, b"") + ps._pb_msg(2, b"")
    _install(monkeypatch, c)
    async def go():
        async with ps.PolarPsFtp("AA:BB") as fs:
            return await fs.get_local_time()
    assert _run(go()) is None


def test_pull_recording_normalises_a_session_without_a_trailing_slash(monkeypatch, tmp_path):
    c = _fs_with_one_session()
    _install(monkeypatch, c)
    # note: no trailing slash on the session -> line 400 appends it
    m = _run(ps.pull_recording("AA:BB", "/U/0/20260719/E/034500", str(tmp_path)))
    assert m["total_bytes"] == 46


def test_pull_recording_reports_progress_and_survives_a_raising_callback(monkeypatch, tmp_path):
    c = _fs_with_one_session()
    _install(monkeypatch, c)
    seen = []
    def cb(done, total):
        seen.append((done, total))
        raise ValueError("ui blew up")        # must not abort the pull
    m = _run(ps.pull_recording("AA:BB", "/U/0/20260719/E/034500/", str(tmp_path), on_progress=cb))
    assert m["total_bytes"] == 46 and seen, "progress fired and the raising callback was swallowed"


def test_connect_cleanup_swallows_a_failing_disconnect(monkeypatch):
    """Line 225: start_notify raises during setup, so __aenter__ tears down — and if the disconnect ALSO
    raises, that second failure must be swallowed so the ORIGINAL error surfaces, not the cleanup's."""
    c = FakeClient()
    async def boom_notify(*a): raise RuntimeError("notify setup failed")
    async def boom_disc(): raise RuntimeError("disconnect also failed")
    c.start_notify = boom_notify
    c.disconnect = boom_disc
    _install(monkeypatch, c)
    async def go():
        async with ps.PolarPsFtp("AA:BB"):
            pass
    with pytest.raises(RuntimeError, match="notify setup failed"):   # original error, not the cleanup's
        _run(go())


def test_main_pull_prints_the_file_manifest(monkeypatch, tmp_path, capsys):
    """Line 460: the per-file print when a pull returns files."""
    async def fake_pull(addr, session, out, adapter=None):
        return {"files": [{"name": "BPM.GZ", "bytes": 12, "ok": True}], "total_bytes": 12}
    monkeypatch.setattr(ps, "pull_recording", fake_pull)
    import sys as _sys
    monkeypatch.setattr(_sys, "argv",
                        ["polar_psftp.py", "--address", "AA:BB", "pull",
                         "--session", "/U/0/20260719/E/034500/", "--out", str(tmp_path)])
    ps.main()
    out = capsys.readouterr().out
    assert "BPM.GZ" in out and "OK" in out
