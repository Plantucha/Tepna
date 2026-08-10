# tepna-capture — tests/test_polar_psftp_client.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The PolarPsFtp client over a FAKE BleakClient that speaks the real RFC76 air-packet framing in both
# directions: it reassembles the host's request packets, parses the PS-FTP operation / query out of them,
# and answers with genuine device→host response packets (seq/status/next bits, MORE→LAST). So the real
# _read_response reassembly, _build_request_packets chunking, _parse_directory, the query allowlist and
# the walk/list_recordings/pull_recording flows are all exercised — no BLE hardware, no protocol stub.

import asyncio
import json
import os

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
        self.requested = []              # every path the client actually asked for, in order
        self.fail_connect = False
        # ── WHAT THE DOUBLE WAS HANDED ──────────────────────────────────────────────────────────────
        # A fake that accepts an argument and DISCARDS it makes the code computing that argument
        # unobservable, while coverage still reads 100 % because the line ran. That is the failure
        # class this repo keeps producing, and it is why 24 of __aenter__'s mutants survived a suite
        # with four tests pointed straight at it: `lambda dev, **kw: client` threw away the device
        # object whose selection IS the scan-then-fall-back logic, and `start_notify(_char, cb)` threw
        # away the characteristic UUID — so subscribing to the wrong characteristic was invisible.
        # Every argument this double receives is kept, and the tests below read them.
        self.ctor_dev = None             # what BleakClient(...) was constructed with
        self.ctor_kw = {}
        self.scan_addr = None            # what BleakScanner.find_device_by_address was asked for
        self.scan_timeout = None
        self.scan_kw = {}
        self.cleared_addr = None         # the address _bt_disconnect was told to clear
        self.notify_char = None          # the characteristic actually subscribed
        self.stopped_char = None         # ... and the one unsubscribed
        self.acquired = 0                # how many times _acquire_mtu was called
        self.writes = []                 # [(char, response)] for every GATT write
        self.queries = []                # [(query_id, params)] for every PS-FTP QUERY sent

    async def connect(self):
        if self.fail_connect:
            raise RuntimeError("connect refused")
        self.connected = True

    async def disconnect(self):
        self.connected = False

    async def _acquire_mtu(self):
        self.acquired += 1

    async def start_notify(self, char, cb):
        self.notify_char = char
        self.notify = cb

    async def stop_notify(self, char):
        self.stopped_char = char

    # `response=None` as the default, NOT the real `False`: mirroring the production default here is
    # what let `write_gatt_char(MTU_CHAR, pkt)` — the kwarg dropped entirely — survive the first pass.
    async def write_gatt_char(self, char, pkt, response=None):
        self.writes.append((char, response))
        # reassemble RFC76 request packets: status bits (b0 & 0x06) == 0x02 marks LAST
        self._rx += pkt[1:]
        if (pkt[0] & 0x06) != 0x02:       # MORE — wait for the rest
            return
        stream, self._rx = bytes(self._rx), bytearray()
        self._answer(stream)

    def _answer(self, stream: bytes):
        if len(stream) >= 2 and (stream[1] & 0x80):        # QUERY (top bit of byte1 set)
            query_id = stream[0]
            self.queries.append((query_id, stream[2:]))    # the params ARE the device's new clock
            if query_id == ps.GET_LOCAL_TIME and self.time_reply is not None:
                for p in _response_data_packets(self.time_reply):
                    self.notify(0, p)
            else:
                self.notify(0, _response_code_packet(0))    # SET_* → success ack
            return
        # REQUEST: [len_lo, len_hi] + protobuf(op). field 2 = path.
        proto = stream[2:]
        path = ps._parse_pb_fields(proto).get(2, b"").decode("utf-8", "replace")
        self.requested.append(path)
        if path in self.files:
            for p in _response_data_packets(self.files[path]):
                self.notify(0, p)
        elif path in self.dirs:
            for p in _response_data_packets(_encode_directory(self.dirs[path])):
                self.notify(0, p)
        else:
            self.notify(0, _response_code_packet(0))         # empty


def _install(monkeypatch, client, device="dev"):
    # `timeout=None` as the stub's default, deliberately: with the real 15.0 mirrored here, dropping
    # `timeout=15.0` from the call site would be indistinguishable from passing it.
    async def find(addr, timeout=None, **kw):
        client.scan_addr, client.scan_timeout, client.scan_kw = addr, timeout, kw
        return device
    monkeypatch.setattr(ps.BleakScanner, "find_device_by_address", find)

    def mk(dev, **kw):
        client.ctor_dev, client.ctor_kw = dev, kw
        return client
    monkeypatch.setattr(ps, "BleakClient", mk)

    async def no_disc(addr):
        client.cleared_addr = addr
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


def test_the_frame_mtu_starts_at_the_BLE_FLOOR_before_any_negotiation():
    """20 = the 23-byte ATT default minus its 3-byte header, i.e. the smallest payload any BLE link is
    guaranteed to carry. It is what every request is chunked to until `__aenter__` negotiates something
    larger, and on this device it is frequently also the FINAL value ("MTU stays 23 here"). Nothing
    asserted it, so it could become 21 — one byte over what the link guarantees — unnoticed."""
    assert ps.PolarPsFtp("AA:BB")._frame_mtu == 20


def test_a_fresh_session_has_recorded_no_truncated_directories():
    """The accumulator starts EMPTY, so a non-empty `truncated_dirs` always means something was cut."""
    assert ps.PolarPsFtp("AA:BB").truncated_dirs == []


def test_walk_records_a_truncated_listing_and_still_walks_what_arrived(monkeypatch, caplog):
    """A cut listing must leave a trace on the SESSION, because `walk` yields tuples and a tuple has
    nowhere to say "and there was more". Without `truncated_dirs` a caller sees a short directory and
    a clean run — measured on the real device, where `/U/0/` came back 4 of 6 entries and the tool
    reported success (psftp.TruncatedProtobuf)."""
    c = _fs_with_one_session()
    _install(monkeypatch, c)

    async def go():
        async with ps.PolarPsFtp("AA:BB") as fs:
            async def _cut(path):
                return [("BPM.GZ", 12)], True
            fs.list_dir_ex = _cut
            rows = [row async for row in fs.walk("/U/0/")]
            return rows, list(fs.truncated_dirs)
    with caplog.at_level("WARNING", logger="polar_psftp"):
        rows, cut = _run(go())
    assert cut == ["/U/0/"], "the cut path is named, not merely counted"
    # THE WARNING'S ARGUMENTS ARE THE REPORT. "a listing was truncated" is not actionable; WHICH path,
    # and how much of it did arrive, is — and an operator staring at a short mirror has nothing else.
    warn = " ".join(r.getMessage() for r in caplog.records if r.levelname == "WARNING")
    assert "/U/0/" in warn and "1 complete" in warn
    assert ("/U/0/BPM.GZ", 12, False) in rows, "the entries that DID arrive are still yielded"


def test_walk_leaves_truncated_dirs_empty_on_a_clean_tree(monkeypatch):
    """Positive control — an always-populated list would be no signal at all."""
    c = _fs_with_one_session()
    _install(monkeypatch, c)

    async def go():
        async with ps.PolarPsFtp("AA:BB") as fs:
            [row async for row in fs.walk("/U/0/")]
            return list(fs.truncated_dirs)
    assert _run(go()) == []


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
            fs.list_dir_ex = c._fail                    # force the listing to raise
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


# ── a truncated download must not occupy the real filename (audit F3, 2026-08-01) ────────────────────
#
# `pull_recording` computed `ok: len(data) == size` per file and then wrote the bytes under the final
# name regardless — and NOTHING anywhere read that field. Its sibling harvester states the standard for
# the identical condition (`cpap_harvest.short_read`): "A short read is NOT a valid file; accepting one
# writes a corrupt EDF that parses far enough to look real." These recordings are the reliability net
# for a lossy live link, so a truncated one that looks complete is the worst available outcome.

def _fs_with_a_short_file():
    """The device declares 34 bytes for PLETH.GZ and delivers 9 — a transfer cut short."""
    c = _fs_with_one_session()
    c.files["/U/0/20260719/E/034500/PLETH.GZ"] = b"B" * 9
    return c


def test_a_short_file_is_left_as_part_not_under_its_real_name(monkeypatch, tmp_path):
    c = _fs_with_a_short_file()
    _install(monkeypatch, c)
    _run(ps.pull_recording("AA:BB", "/U/0/20260719/E/034500/", str(tmp_path)))
    names = {p.name for p in tmp_path.rglob("*") if p.is_file()}
    assert "PLETH.GZ" not in names, "a truncated file must not occupy the name a reader will trust"
    assert "PLETH.GZ.part" in names, "the fetched bytes are kept — refused, not destroyed"
    assert "BPM.GZ" in names, "the complete sibling still lands"


def test_a_short_file_is_reported_in_the_manifest(monkeypatch, tmp_path):
    c = _fs_with_a_short_file()
    _install(monkeypatch, c)
    m = _run(ps.pull_recording("AA:BB", "/U/0/20260719/E/034500/", str(tmp_path)))
    assert m["ok"] is False, "the manifest must carry a verdict a caller can branch on"
    assert len(m["short"]) == 1 and "PLETH.GZ" in m["short"][0]
    assert "declared 34" in m["short"][0] and "got 9" in m["short"][0]


def test_a_complete_pull_reports_ok(monkeypatch, tmp_path):
    c = _fs_with_one_session()
    _install(monkeypatch, c)
    m = _run(ps.pull_recording("AA:BB", "/U/0/20260719/E/034500/", str(tmp_path)))
    assert m["ok"] is True and m["short"] == []


# ── the idempotency the caller's docstring already promised (audit F3b) ──────────────────────────────
#
# `pull_polar_offline_all` says "Idempotent: pull_recording skips a file already on disk at the same
# size, so a repeat pull only fetches genuinely new bytes." It did not skip: every on-charger auto-pull
# re-downloaded the device's entire flash over BLE, with live capture paused for the duration, and
# reported every file as new.

def test_a_file_already_on_disk_at_the_same_size_is_not_refetched(monkeypatch, tmp_path):
    c = _fs_with_one_session()
    _install(monkeypatch, c)
    _run(ps.pull_recording("AA:BB", "/U/0/20260719/E/034500/", str(tmp_path)))
    fetched = []
    orig = ps.PolarPsFtp.get

    async def counting_get(self, path, timeout=180.0):
        if not path.endswith("/"):          # a directory GET is the walk listing, not a file download
            fetched.append(path)
        return await orig(self, path, timeout=timeout)
    monkeypatch.setattr(ps.PolarPsFtp, "get", counting_get)

    m = _run(ps.pull_recording("AA:BB", "/U/0/20260719/E/034500/", str(tmp_path)))
    assert fetched == [], f"a second pull re-downloaded {fetched}"
    assert m["new_files"] == [], "nothing was new, so nothing may be reported as new"
    assert m["total_bytes"] == 46, "the manifest still describes the whole session"


def test_a_part_file_from_a_short_read_is_refetched_next_run(monkeypatch, tmp_path):
    """The `.part` must not satisfy the skip — otherwise a truncated file is never repaired."""
    c = _fs_with_a_short_file()
    _install(monkeypatch, c)
    _run(ps.pull_recording("AA:BB", "/U/0/20260719/E/034500/", str(tmp_path)))
    c.files["/U/0/20260719/E/034500/PLETH.GZ"] = b"B" * 34      # the link recovers
    m = _run(ps.pull_recording("AA:BB", "/U/0/20260719/E/034500/", str(tmp_path)))
    assert m["ok"] is True
    names = {p.name for p in tmp_path.rglob("*") if p.is_file()}
    assert "PLETH.GZ" in names and "PLETH.GZ.part" not in names


def test_progress_is_reported_for_skipped_files_and_survives_a_raising_callback(monkeypatch, tmp_path):
    """A resumed pull must still drive the progress bar to 100% — a skipped file is progress, not a
    gap. And the UI hook must never be able to break a transfer, on this path as on the download one."""
    c = _fs_with_one_session()
    _install(monkeypatch, c)
    _run(ps.pull_recording("AA:BB", "/U/0/20260719/E/034500/", str(tmp_path)))

    seen = []
    _run(ps.pull_recording("AA:BB", "/U/0/20260719/E/034500/", str(tmp_path),
                           on_progress=lambda d, t: seen.append((d, t))))
    assert seen and seen[-1] == (46, 46), f"a fully-skipped pull must still reach 100%: {seen}"

    def boom(done, total):
        raise RuntimeError("the monitor went away")
    m = _run(ps.pull_recording("AA:BB", "/U/0/20260719/E/034500/", str(tmp_path), on_progress=boom))
    assert m["ok"] is True and m["total_bytes"] == 46


# ── pruning the session walk (2026-08-02) ────────────────────────────────────────────────────────────
#
# `list_recordings` always knew a session is exactly `/U/0/<8-digit>/<E|R>/<6-digit>/` — it just applied
# that filter AFTER walking everything. The real Verity's `/U/0/` also holds `S/`, so the walk descended
# a subtree that cannot contain a session and discarded the result. Every directory is a PS-FTP round
# trip on a link stuck at MTU 23, which is why the waste is measured in minutes, not milliseconds.

def _fs_with_a_big_unrelated_subtree():
    """The measured Verity layout: two files, a session dir, and `S/` holding a deep tree."""
    c = _fs_with_one_session()
    c.dirs["/U/0/"] = [("DBDC.DAT", 1), ("USERID.BPB", 70), ("S/", 0), ("20260719/", 0)]
    c.dirs["/U/0/S/"] = [(f"{i:04d}/", 0) for i in range(20)]
    for i in range(20):
        c.dirs[f"/U/0/S/{i:04d}/"] = [("BLOB.BPB", 999)]
    return c


def test_the_session_walk_does_not_descend_the_unrelated_subtree(monkeypatch):
    c = _fs_with_a_big_unrelated_subtree()
    _install(monkeypatch, c)

    async def go():
        async with ps.PolarPsFtp("AA:BB") as fs:
            return [row async for row in fs.walk("/U/0/", descend=ps._session_descend)]
    rows = _run(go())
    paths = {p for p, _sz, _d in rows}
    assert "/U/0/S/" in paths, "the directory itself is still reported"
    assert not [p for p in paths if p.startswith("/U/0/S/0")], "must not have recursed into it"
    assert "/U/0/20260719/E/034500/BPM.GZ" in paths, "the real session is still found"


def test_an_unpruned_walk_still_visits_everything(monkeypatch):
    """The prune is opt-in: `walk`'s existing callers (pull_recording) must be unaffected."""
    c = _fs_with_a_big_unrelated_subtree()
    _install(monkeypatch, c)

    async def go():
        async with ps.PolarPsFtp("AA:BB") as fs:
            return [row async for row in fs.walk("/U/0/")]
    paths = {p for p, _sz, _d in _run(go())}
    assert "/U/0/S/0000/BLOB.BPB" in paths


def test_list_recordings_still_finds_the_session_through_the_prune(monkeypatch):
    c = _fs_with_a_big_unrelated_subtree()
    _install(monkeypatch, c)
    got = _run(ps.list_recordings("AA:BB"))
    assert [s["path"] for s in got] == ["/U/0/20260719/E/034500/"]
    assert got[0]["total_bytes"] == 12 + 34


def test_the_prune_accepts_exactly_the_session_shape():
    ok = ps._session_descend
    assert ok("/U/0/") is True                          # the root itself
    assert ok("/U/0/20260719/") is True                 # a date
    assert ok("/U/0/20260719/E/") is True               # exercise
    assert ok("/U/0/20260719/R/") is True               # offline recording
    assert ok("/U/0/20260719/E/034500/") is True        # the session
    assert ok("/U/0/20260719/E/034500/sub/") is True    # inside a session, take everything


def test_the_prune_rejects_what_cannot_hold_a_session():
    no = ps._session_descend
    assert no("/U/0/S/") is False                       # the measured real-world cost
    assert no("/U/0/SYS/") is False
    assert no("/U/0/2026071/") is False, "7 digits is not a date"
    assert no("/U/0/20260719/X/") is False, "only E and R"
    assert no("/U/0/20260719/E/03450/") is False, "5 digits is not a time"


def test_an_unknown_future_sibling_is_pruned_by_default():
    """Shape-based, not a name blocklist: a new sibling of `S/` must not silently reintroduce the cost."""
    assert ps._session_descend("/U/0/WHATEVER/") is False


# ── the retry actually gets to retry (2026-08-02) ────────────────────────────────────────────────────

def test_a_hanging_attempt_is_bounded_so_the_later_attempts_still_run():
    """Without a per-attempt bound the retry is dead code in the case it exists for: a wedged link does
    not raise, it hangs, so attempt 1 eats the whole budget and attempts 2 and 3 never happen."""
    calls = []

    async def hang():
        calls.append(1)
        await asyncio.sleep(30)

    async def go():
        with pytest.raises(asyncio.TimeoutError):
            await ps._with_retry(hang, attempts=3, backoff=0.0, per_attempt_timeout=0.02)
    _run(go())
    assert len(calls) == 3, "every attempt must get its turn"


def test_a_transient_failure_still_succeeds_on_a_later_attempt():
    state = {"n": 0}

    async def flaky():
        state["n"] += 1
        if state["n"] < 3:
            raise RuntimeError("device disconnected")
        return "ok"

    assert _run(ps._with_retry(flaky, attempts=3, backoff=0.0, per_attempt_timeout=5.0)) == "ok"


def test_without_a_timeout_the_retry_behaves_exactly_as_before():
    """Back-compat: the parameter is optional and last, and its absence must not change the path."""
    async def boom():
        raise RuntimeError("nope")
    with pytest.raises(RuntimeError):
        _run(ps._with_retry(boom, attempts=2, backoff=0.0))


# ── the prune is WIRED IN, not merely available ──────────────────────────────────────────────────────
#
# The mutation gate caught this gap on 2026-08-02: `descend=_session_descend` could be replaced with
# `descend=None` and every test still passed, because the tests drove `walk(descend=...)` directly and
# then asserted only list_recordings' RESULT — which is identical with or without pruning. What makes
# the fix a fix is the round trips NOT taken, so that is what has to be asserted.

def test_list_recordings_actually_prunes_the_unrelated_subtree(monkeypatch):
    c = _fs_with_a_big_unrelated_subtree()
    _install(monkeypatch, c)
    _run(ps.list_recordings("AA:BB"))
    assert "/U/0/" in c.requested, "the root is still listed"
    assert not [p for p in c.requested if p.startswith("/U/0/S/")], (
        "list_recordings walked into S/ — the prune is not wired in, only available")
    assert "/U/0/20260719/E/034500/" in c.requested, "the real session is still visited"


def test_the_prune_is_propagated_into_the_recursion(monkeypatch):
    """A prune applied only at the top level would still pass the S/ test — S/ is pruned at depth 0.
    This one can only pass if `descend` reaches the recursive call."""
    c = _fs_with_one_session()
    c.dirs["/U/0/20260719/"] = [("E/", 0), ("X/", 0)]        # X/ sits one level DOWN
    c.dirs["/U/0/20260719/X/"] = [("JUNK/", 0)]
    c.dirs["/U/0/20260719/X/JUNK/"] = [("BIG.BPB", 9999)]
    _install(monkeypatch, c)
    _run(ps.list_recordings("AA:BB"))
    assert not [p for p in c.requested if p.startswith("/U/0/20260719/X/")], (
        "descend was not passed down — pruning stops at the first level")


def test_maxdepth_still_bounds_the_walk(monkeypatch):
    c = _fs_with_one_session()
    _install(monkeypatch, c)

    async def go():
        async with ps.PolarPsFtp("AA:BB") as fs:
            return [row async for row in fs.walk("/U/0/", maxdepth=1)]
    paths = {p for p, _s, _d in _run(go())}
    assert "/U/0/20260719/E/" in paths, "depth 1 is still walked"
    # The FRONTIER, not just "something deep is missing": with `<=` the cut-off moves exactly one
    # level, so an assertion two levels down passes either way and sees nothing.
    assert "/U/0/20260719/E/034500/" not in paths, "depth 2 must be cut off"


# ── the progress logging is the diagnostic, so it is pinned ─────────────────────────────────────────
#
# The whole argument for adding it: when the op was killed at 300 s having logged nothing, "device
# busy", "tree too large" and "link wedged" were indistinguishable after the fact. A log nobody
# asserts can regress silently, which would put us straight back there.

def test_the_walk_reports_progress_and_completion(monkeypatch, caplog):
    c = _fs_with_one_session()
    # 60 entries in one directory → crosses the 25-entry progress threshold twice
    c.dirs["/U/0/20260719/E/034500/"] = [(f"F{i:03d}.GZ", 1) for i in range(60)]
    _install(monkeypatch, c)
    with caplog.at_level("INFO", logger="polar_psftp"):
        _run(ps.list_recordings("AA:BB"))
    msgs = [r.getMessage() for r in caplog.records]
    assert any("walked 25 entries" in m for m in msgs), "progress must appear every 25 entries"
    assert any("walked 50 entries" in m for m in msgs)
    assert any("walk complete" in m for m in msgs), "and a completion line, so a hang is visible"


def test_a_bounded_attempt_logs_which_attempt_timed_out(caplog):
    """`i + 1` — the human-readable attempt number. Off by one and the log points at the wrong try."""
    async def hang():
        await asyncio.sleep(30)

    async def go():
        with pytest.raises(asyncio.TimeoutError):
            await ps._with_retry(hang, attempts=2, backoff=0.0, per_attempt_timeout=0.01)
    with caplog.at_level("WARNING", logger="polar_psftp"):
        _run(go())
    msgs = [r.getMessage() for r in caplog.records]
    assert any("attempt 1/2" in m for m in msgs), "attempts are numbered from 1 for humans"
    assert any("attempt 2/2" in m for m in msgs)


# ── the retry constants are load-bearing, not decoration ────────────────────────────────────────────

def test_the_defaults_keep_three_attempts_inside_the_offline_watchdog():
    """3 x _LIST_ATTEMPT_TIMEOUT_S + 2 x backoff must fit in capture._OFFLINE_OP_TIMEOUT_S (300 s), or
    the retry cannot run and the watchdog reports "abandoned" instead of the real fault."""
    import inspect
    sig = inspect.signature(ps._with_retry)
    attempts = sig.parameters["attempts"].default
    backoff = sig.parameters["backoff"].default
    assert attempts == 3 and backoff == 2.0
    assert attempts * ps._LIST_ATTEMPT_TIMEOUT_S + (attempts - 1) * backoff < 300.0


def test_the_default_attempt_count_is_what_actually_runs():
    calls = []

    async def boom():
        calls.append(1)
        raise RuntimeError("nope")
    with pytest.raises(RuntimeError):
        _run(ps._with_retry(boom, backoff=0.0))
    assert len(calls) == 3, "the default must be the count that runs, not just the annotation"


def test_no_backoff_is_slept_after_the_final_attempt():
    """`i < attempts - 1`: an off-by-one here sleeps a pointless backoff while holding the offline
    lock and the paused-capture flag — the failure mode the 300 s bound exists to stop."""
    slept = []

    async def fake_sleep(d):
        slept.append(d)

    async def boom():
        raise RuntimeError("nope")

    async def go():
        real = asyncio.sleep
        asyncio.sleep = fake_sleep
        try:
            with pytest.raises(RuntimeError):
                await ps._with_retry(boom, attempts=3, backoff=1.5)
        finally:
            asyncio.sleep = real
    _run(go())
    assert slept == [1.5, 1.5], "one backoff BETWEEN attempts, none after the last"


def test_list_recordings_bounds_each_attempt(monkeypatch):
    """The bound is the whole point of the retry fix; dropping the argument restores the hang."""
    seen = {}
    real = ps._with_retry

    async def spy(factory, **kw):
        seen.update(kw)
        return await real(factory, **kw)
    monkeypatch.setattr(ps, "_with_retry", spy)
    c = _fs_with_one_session()
    _install(monkeypatch, c)
    _run(ps.list_recordings("AA:BB"))
    assert seen.get("per_attempt_timeout") == ps._LIST_ATTEMPT_TIMEOUT_S


def test_the_progress_log_names_the_device(monkeypatch, caplog):
    """With three Polars on one box, progress that does not say WHICH device is not diagnostic."""
    c = _fs_with_one_session()
    c.dirs["/U/0/20260719/E/034500/"] = [(f"F{i:03d}.GZ", 1) for i in range(30)]
    _install(monkeypatch, c)
    with caplog.at_level("INFO", logger="polar_psftp"):
        _run(ps.list_recordings("24:AC:AC:0C:30:1E"))
    assert any("24:AC:AC:0C:30:1E" in r.getMessage() for r in caplog.records)


def _fs_with_two_sessions():
    c = _fs_with_one_session()
    c.dirs["/U/0/"] = [("20260719/", 0), ("20260716/", 0)]      # deliberately out of order
    c.dirs["/U/0/20260716/"] = [("R/", 0)]
    c.dirs["/U/0/20260716/R/"] = [("170114/", 0)]
    c.dirs["/U/0/20260716/R/170114/"] = [("ACC.GZ", 7), ("PPG.GZ", 5)]
    return c


def test_sessions_come_back_in_chronological_order(monkeypatch):
    c = _fs_with_two_sessions()
    _install(monkeypatch, c)
    got = _run(ps.list_recordings("AA:BB"))
    assert [s["path"] for s in got] == ["/U/0/20260716/R/170114/", "/U/0/20260719/E/034500/"]


def test_each_session_carries_its_own_files_and_byte_total(monkeypatch):
    c = _fs_with_two_sessions()
    _install(monkeypatch, c)
    got = {s["path"]: s for s in _run(ps.list_recordings("AA:BB"))}
    r = got["/U/0/20260716/R/170114/"]
    assert sorted(f["name"] for f in r["files"]) == ["ACC.GZ", "PPG.GZ"]
    assert r["total_bytes"] == 12
    assert got["/U/0/20260719/E/034500/"]["total_bytes"] == 46, "totals must not pool across sessions"


def test_both_recording_kinds_are_found(monkeypatch):
    """E/ is an exercise session, R/ an offline recording — the backup path depends on R/."""
    c = _fs_with_two_sessions()
    _install(monkeypatch, c)
    kinds = {s["path"].split("/")[4] for s in _run(ps.list_recordings("AA:BB"))}
    assert kinds == {"E", "R"}


def test_the_adapter_is_passed_through_to_the_client(monkeypatch):
    """The box has three BLE radios and one of them is known to go deaf. A listing that silently
    ignores the requested adapter would talk over the wrong one."""
    seen = {}
    real_init = ps.PolarPsFtp.__init__

    def spy(self, address, adapter=None, *a, **kw):
        seen["adapter"] = adapter
        return real_init(self, address, adapter, *a, **kw)
    monkeypatch.setattr(ps.PolarPsFtp, "__init__", spy)
    c = _fs_with_one_session()
    _install(monkeypatch, c)
    _run(ps.list_recordings("AA:BB", "hci2"))
    assert seen["adapter"] == "hci2"


def test_the_progress_line_itself_names_the_device_and_where_it_is(monkeypatch, caplog):
    """Asserted on the PROGRESS line specifically: the completion line also carries the address, so a
    test that accepts any record cannot tell the two apart — and it is the progress line that has to
    be readable while the thing is still hanging."""
    c = _fs_with_one_session()
    c.dirs["/U/0/20260719/E/034500/"] = [(f"F{i:03d}.GZ", 1) for i in range(30)]
    _install(monkeypatch, c)
    with caplog.at_level("INFO", logger="polar_psftp"):
        _run(ps.list_recordings("24:AC:AC:0C:30:1E"))
    prog = [r.getMessage() for r in caplog.records if "walked" in r.getMessage()]
    assert prog, "no progress line at all"
    assert "24:AC:AC:0C:30:1E" in prog[0], "which device"
    assert "/U/0/20260719/E/034500/F0" in prog[0], "and how far it got"


def test_the_default_depth_limit_stops_a_runaway_tree(monkeypatch):
    """maxdepth is a real bound, not decoration: a device that reports a cyclic or very deep tree
    must not walk forever while holding the offline lock."""
    c = FakeClient()
    c.dirs = {"/U/0/": [("a/", 0)]}
    path = "/U/0/a/"
    for _ in range(12):                       # far deeper than the limit
        c.dirs[path] = [("a/", 0)]
        path += "a/"
    _install(monkeypatch, c)

    async def go():
        async with ps.PolarPsFtp("AA:BB") as fs:
            return [row async for row in fs.walk("/U/0/")]
    depths = [p.count("/") for p, _s, _d in _run(go())]
    assert max(depths) == 10, "6 levels below /U/0/ (3 slashes) inclusive of the leaf row"


def test_the_default_backoff_is_the_one_that_actually_sleeps():
    """A signature assertion cannot see this: mutmut swaps the function BODY, so `inspect.signature`
    still reports the original default. Only a behavioural check pins it."""
    slept = []

    async def fake_sleep(d):
        slept.append(d)

    async def boom():
        raise RuntimeError("nope")

    async def go():
        real = asyncio.sleep
        asyncio.sleep = fake_sleep
        try:
            with pytest.raises(RuntimeError):
                await ps._with_retry(boom)          # no backoff argument
        finally:
            asyncio.sleep = real
    _run(go())
    assert slept == [2.0, 2.0]


def test_the_listing_asks_for_the_address_it_was_given(monkeypatch):
    seen = {}
    real_init = ps.PolarPsFtp.__init__

    def spy(self, address, adapter=None, *a, **kw):
        seen["address"] = address
        return real_init(self, address, adapter, *a, **kw)
    monkeypatch.setattr(ps.PolarPsFtp, "__init__", spy)
    c = _fs_with_one_session()
    _install(monkeypatch, c)
    _run(ps.list_recordings("24:AC:AC:0C:30:1E"))
    assert seen["address"] == "24:AC:AC:0C:30:1E"


def test_both_log_lines_carry_an_elapsed_time(monkeypatch, caplog):
    """Elapsed is the half of the progress line that says whether it is moving or wedged."""
    import re as _re
    c = _fs_with_one_session()
    c.dirs["/U/0/20260719/E/034500/"] = [(f"F{i:03d}.GZ", 1) for i in range(30)]
    _install(monkeypatch, c)
    with caplog.at_level("INFO", logger="polar_psftp"):
        _run(ps.list_recordings("AA:BB"))
    msgs = [r.getMessage() for r in caplog.records]
    prog = next(m for m in msgs if "walked" in m)
    done = next(m for m in msgs if "walk complete" in m)
    # PLAUSIBLE, not merely present: `monotonic() - t0` mutated to `+ t0` still prints digits and
    # still matches a shape regex — it prints ~2x the machine uptime. A wall-clock instant rendered as
    # an elapsed time is exactly the kind of log that makes a hang harder to read, not easier.
    for label, m in (("progress", prog), ("completion", done)):
        hit = _re.search(r"in (\d+(?:\.\d+)?)s", m)
        assert hit, f"no elapsed in {label} line: {m}"
        assert float(hit.group(1)) < 60.0, f"{label} elapsed is not an elapsed: {m}"
    assert "30 entries" in done or "entries" in done


def test_sessions_on_the_same_day_are_ordered_by_time(monkeypatch):
    """Pins the TIME half of the sort key; a date-only comparison passes the two-date test."""
    c = _fs_with_one_session()
    c.dirs["/U/0/"] = [("20260719/", 0)]
    c.dirs["/U/0/20260719/"] = [("E/", 0)]
    c.dirs["/U/0/20260719/E/"] = [("034500/", 0), ("011500/", 0)]      # out of order
    c.dirs["/U/0/20260719/E/011500/"] = [("EARLY.GZ", 3)]
    _install(monkeypatch, c)
    got = [s["path"] for s in _run(ps.list_recordings("AA:BB"))]
    assert got == ["/U/0/20260719/E/011500/", "/U/0/20260719/E/034500/"]


def test_a_zero_byte_file_is_listed_rather_than_silently_dropped(monkeypatch):
    """`size >= 0`, not `> 0`. A zero-byte file in a session is precisely the case the backup exists
    to make visible — an aborted or auto-stopped recording. Dropping it reports a session as having
    fewer files than it has, which is POLAR-ONBOARD-BACKUP §0.2's fabricated-absence class: "the file
    is fine, it is just shorter than the night"."""
    c = _fs_with_one_session()
    c.dirs["/U/0/20260719/E/034500/"] = [("BPM.GZ", 12), ("EMPTY.GZ", 0)]
    _install(monkeypatch, c)
    got = _run(ps.list_recordings("AA:BB"))
    names = sorted(f["name"] for f in got[0]["files"])
    assert names == ["BPM.GZ", "EMPTY.GZ"], "the empty recording must still be reported"
    assert got[0]["total_bytes"] == 12
    # the record's shape, not just its name: mutants 94-97 rename `path` / `size`, and the monitor's
    # pull button reads both to decide what it is about to fetch
    assert {f["name"]: f for f in got[0]["files"]}["BPM.GZ"] == {
        "name": "BPM.GZ", "path": "/U/0/20260719/E/034500/BPM.GZ", "size": 12}


def test_the_completion_line_also_names_the_device(monkeypatch, caplog):
    """Both lines, not just the progress one: the completion line is what lands in the journal for a
    run that finished, and 'walk complete' without a device is unattributable on a three-Polar box."""
    c = _fs_with_one_session()
    _install(monkeypatch, c)
    with caplog.at_level("INFO", logger="polar_psftp"):
        _run(ps.list_recordings("24:AC:AC:0C:30:1E"))
    done = next(r.getMessage() for r in caplog.records if "walk complete" in r.getMessage())
    assert "24:AC:AC:0C:30:1E" in done


# ═══════════════════════════════════════════════════════════════════════════════════════════════════
# MUTATION PASS 2026-08-02 — what the doubles were throwing away
#
# Re-measured on this tree: 1154 mutants, 280 surviving (75 % killed). The survivors were not spread
# evenly — they clustered on exactly the arguments the test doubles accepted and discarded. `__aenter__`
# had 24 survivors under four tests aimed at it, because `lambda dev, **kw: client` discards the device
# object whose SELECTION is the entire scan-then-fall-back logic. `_bt_disconnect` had 22 out of 22 —
# every mutant of the whole function — under a test whose fake was `async def fake(*a, **k)`.
#
# Coverage read 100 % throughout, correctly: the lines ran. Nothing looked at what they produced.
# ═══════════════════════════════════════════════════════════════════════════════════════════════════


# ── _bt_disconnect: the command it runs is the whole function ───────────────────────────────────────
def test_the_bluez_link_is_cleared_for_the_address_with_a_real_command(monkeypatch):
    """All 22 of this function's mutants survived. `p = None`, `bluetoothctl` → None, `disconnect` →
    `DISCONNECT`, the address → None: under any of them the pre-connect clear silently does nothing and
    bleak goes on fighting BlueZ for the device's single BLE slot — the failure this function exists to
    prevent. A double that takes `*a, **k` cannot see any of it."""
    seen = {}

    class _P:
        def __init__(self):
            self.waited = 0

        async def wait(self):
            self.waited += 1
            return 0

    proc = _P()

    async def fake_exec(*argv, **kw):
        seen["argv"], seen["kw"] = argv, kw
        return proc
    monkeypatch.setattr(ps.asyncio, "create_subprocess_exec", fake_exec)

    slept = []

    async def fake_sleep(s):
        slept.append(s)
    monkeypatch.setattr(ps.asyncio, "sleep", fake_sleep)

    waited_with = []
    real_wait_for = asyncio.wait_for

    async def spy_wait_for(aw, timeout=None):
        waited_with.append(timeout)
        return await real_wait_for(aw, timeout)
    monkeypatch.setattr(ps.asyncio, "wait_for", spy_wait_for)

    _run(ps._bt_disconnect("24:AC:AC:0C:30:1E"))

    assert seen["argv"] == ("bluetoothctl", "disconnect", "24:AC:AC:0C:30:1E"), \
        "the exact argv — bluetoothctl's subcommand is case-sensitive and the address is the point"
    assert proc.waited == 1, "the process must be reaped, not merely spawned"
    assert seen["kw"]["stdout"] is asyncio.subprocess.DEVNULL, "bluetoothctl chatter stays out of the log"
    assert seen["kw"]["stderr"] is asyncio.subprocess.DEVNULL
    # BOUNDED, and by these numbers. bluetoothctl talking to a wedged BlueZ does not return; this runs
    # on the connect path, so an unbounded wait here is a hung pull, not a slow one.
    assert waited_with == [6.0], "the wait on bluetoothctl is bounded"
    assert slept == [2.0], "and the controller is given a fixed settle window before re-connecting"


# ── __aenter__: which device connects, on which characteristic ──────────────────────────────────────
def test_the_scan_and_the_client_are_given_the_address_and_its_result(monkeypatch):
    """Mutants 1, 2, 3, 9, 12: clear the wrong address, scan for None, hand BleakClient None or the bare
    address when the scan DID return a rich device. All 24 survivors of this method trace to doubles
    that ignored the argument under test."""
    c = FakeClient()
    _install(monkeypatch, c, device="rich-device-object")

    async def go():
        async with ps.PolarPsFtp("24:AC:AC:0C:30:1E"):
            pass
    _run(go())

    assert c.cleared_addr == "24:AC:AC:0C:30:1E", "the link cleared is the link we are about to take"
    assert c.scan_addr == "24:AC:AC:0C:30:1E"
    assert c.ctor_dev == "rich-device-object", \
        "a scan that HIT must connect to the device object it found, not fall back to the address"


def test_a_missed_scan_connects_to_the_bare_address(monkeypatch):
    """The other arm, and the reason the fallback exists: a bonded Polar idle on the nightstand is not
    advertising, so `find_device_by_address` misses it while BlueZ still knows it by path. Mutants 9 and
    10 invert or void this and were invisible — the old test asserted only that SOMETHING connected."""
    c = FakeClient()
    _install(monkeypatch, c, device=None)

    async def go():
        async with ps.PolarPsFtp("24:AC:AC:0C:30:1E"):
            pass
    _run(go())
    assert c.ctor_dev == "24:AC:AC:0C:30:1E", "a missed scan falls back to the address itself"


def test_the_connect_timeouts_are_the_tuned_ones(monkeypatch):
    """Mutants 4, 6, 8, 13, 15, 17 drop or nudge them. Unbounded is the dangerous direction: this runs
    with live capture paused and the offline lock held, so a connect that never returns costs the night,
    and the caller's watchdog reports 'abandoned' rather than the real fault."""
    c = FakeClient()
    _install(monkeypatch, c)

    async def go():
        async with ps.PolarPsFtp("AA:BB"):
            pass
    _run(go())
    assert c.scan_timeout == 15.0, "the advertisement scan is bounded"
    assert c.ctor_kw.get("timeout") == 25.0, "and so is the connect"


def test_the_adapter_pin_reaches_both_the_scan_and_the_client(monkeypatch):
    """Mutants 7 and 16 drop `**self._kw` from one call each. `_kw` being correct (already tested) is
    only half the contract — a pin that is built and then not passed is a pin that does nothing, and on
    a three-radio box it means the pull goes out of whichever adapter BlueZ picks."""
    c = FakeClient()
    _install(monkeypatch, c)

    async def go():
        async with ps.PolarPsFtp("AA:BB", adapter="hci1"):
            pass
    _run(go())
    assert c.scan_kw == {"bluez": {"adapter": "hci1"}}, "the scan is pinned to the adapter"
    assert c.ctor_kw.get("bluez") == {"adapter": "hci1"}, "and so is the connection"


def test_the_notifications_are_taken_on_the_pftp_characteristic(monkeypatch):
    """Mutant 43 subscribes to None. All PS-FTP traffic rides FB005C51 in both directions, so the
    characteristic is not decoration — subscribing elsewhere means every response is lost. The double
    signature was `start_notify(self, _char, cb)`: the underscore is the bug."""
    c = FakeClient()
    _install(monkeypatch, c)

    async def go():
        async with ps.PolarPsFtp("AA:BB"):
            pass
    _run(go())
    assert c.notify_char == ps.MTU_CHAR
    assert c.stopped_char == ps.MTU_CHAR, "and teardown unsubscribes the same one"


def test_the_mtu_is_acquired_before_the_frame_size_is_derived(monkeypatch):
    """Mutants 18-23 all stop `_acquire_mtu` being called (wrong attribute name, hasattr on None, a
    dropped argument that raises into the swallowing except). Without it BlueZ reports the default 23
    and every transfer runs at 20-byte frames — minutes instead of seconds, on the path whose whole
    problem is that it is slow."""
    c = FakeClient()
    _install(monkeypatch, c)

    async def go():
        async with ps.PolarPsFtp("AA:BB") as fs:
            assert fs._frame_mtu == 247          # 250 - 3
    _run(go())
    assert c.acquired == 1, "_acquire_mtu is called exactly once, before the frame size is read"


def test_a_client_that_reports_no_mtu_falls_back_to_the_23_byte_default(monkeypatch):
    """Mutants 37 (no default at all — raises, and the raise is caught by the connect cleanup, so the
    pull fails outright) and 40 (default 24 — a 21-byte frame the link will not carry). Every existing
    fixture had `mtu_size`, which is the one input that cannot distinguish them.

    Mutant 34 (`getattr(..., None) or 23`) is EQUIVALENT — `None or 23` and `23 or 23` are the same
    value on every input — and is expected to survive."""
    c = FakeClient()
    del c.mtu_size
    _install(monkeypatch, c)

    async def go():
        async with ps.PolarPsFtp("AA:BB") as fs:
            assert fs._frame_mtu == 20, "BLE's default ATT MTU 23, minus the 3-byte notification header"
            assert c.connected is True, "a client with no mtu_size must still connect"
    _run(go())
    assert c.notify_char == ps.MTU_CHAR, "setup ran to completion — mutant 37 raises out of it instead"


# ── __aexit__: teardown must be bounded, which the module says in a comment and nothing asserted ─────
def test_a_wedged_teardown_cannot_hold_the_caller_open(monkeypatch):
    """Mutant 5 replaces the teardown's `wait_for` timeout with None, and mutant 1 drops the
    `stop_notify` call entirely. The module carries a five-line comment about exactly this: teardown
    runs while the caller's `wait_for` is CANCELLING the op, both awaits go to the same wedged BlueZ
    that caused the timeout, so unbounded here means the caller's timeout can never fire — capture stays
    paused and the connect lock stays held for the rest of the night. A comment is not a gate."""
    import time as _time
    c = FakeClient()

    async def hangs():
        await asyncio.sleep(3600)
    c.disconnect = hangs
    _install(monkeypatch, c)
    monkeypatch.setattr(ps.PolarPsFtp, "_TEARDOWN_TIMEOUT_S", 0.05)

    async def go():
        async with ps.PolarPsFtp("AA:BB"):
            pass
    t0 = _time.monotonic()
    _run(asyncio.wait_for(go(), timeout=5.0))       # the outer bound only catches a total hang
    elapsed = _time.monotonic() - t0
    assert elapsed < 1.0, f"a hung disconnect must be abandoned at the teardown bound, took {elapsed:.2f}s"
    assert c.stopped_char == ps.MTU_CHAR, "and the notification subscription is still dropped first"


# ── _read_response: the response timeout, and the second byte of an error code ──────────────────────
class _SilentClient(FakeClient):
    """Answers nothing at all — the wedged link that does not raise, it just stops talking."""
    def _answer(self, stream):
        return None


def test_a_device_that_stops_answering_times_out_rather_than_hanging(monkeypatch):
    """Mutant 6 passes `timeout=None` to the queue wait. A silent link is the ordinary Polar failure —
    it does not disconnect, it stops notifying — so an unbounded wait there is an op that never returns
    and a retry that never gets its turn."""
    import time as _time
    _install(monkeypatch, _SilentClient())

    async def go():
        async with ps.PolarPsFtp("AA:BB") as fs:
            await fs.get("/U/0/", timeout=0.05)
    t0 = _time.monotonic()
    with pytest.raises(asyncio.TimeoutError):
        _run(asyncio.wait_for(go(), timeout=5.0))
    elapsed = _time.monotonic() - t0
    assert elapsed < 1.0, f"the read must give up at ITS timeout, not the caller's: took {elapsed:.2f}s"


def test_a_two_byte_psftp_error_code_is_decoded_whole(monkeypatch):
    """Mutants 37 and 39 corrupt the HIGH byte of the error code, which is zero for the single-byte
    error 12 the suite used. Polar's PbPFtpError runs past 255 (NOT_IMPLEMENTED is 201, and the H10
    answers it for SET_SYSTEM_TIME), so a two-byte code is the realistic one to misreport."""
    class _BigError(FakeClient):
        def _answer(self, stream):
            self.notify(0, bytes([(0 << 4) | (0x00 << 1) | 0, 0x01, 0x02]))     # 0x0201 = 513

    _install(monkeypatch, _BigError())

    async def go():
        async with ps.PolarPsFtp("AA:BB") as fs:
            await fs.get("/U/0/")
    with pytest.raises(RuntimeError, match=r"PS-FTP error 513$"):
        _run(go())


def test_a_bare_terminator_with_no_error_bytes_is_success_not_failure(monkeypatch):
    """Mutant 42 makes a too-short terminator packet default to error code 1 instead of 0, turning a
    successful empty response into a raised RuntimeError. Every SET_* query the clock path sends is
    acknowledged by exactly such a packet."""
    class _BareAck(FakeClient):
        def _answer(self, stream):
            self.notify(0, bytes([(0 << 4) | (0x00 << 1) | 0]))                  # no err bytes at all

    _install(monkeypatch, _BareAck())

    async def go():
        async with ps.PolarPsFtp("AA:BB") as fs:
            return await fs.get("/U/0/")
    assert _run(go()) == b"", "a bare terminator means 'done, nothing to send', not 'error 1'"


# ── get / query: the characteristic, the write mode, and the read bound ─────────────────────────────
def _spy_read_timeouts(monkeypatch):
    """Record the timeout each `_read_response` is handed — the argument `get`/`query` compute and no
    test observed, so `self._read_response(None)` survived on both."""
    seen = []
    orig = ps.PolarPsFtp._read_response

    async def spy(self, timeout):
        seen.append(timeout)
        return await orig(self, timeout)
    monkeypatch.setattr(ps.PolarPsFtp, "_read_response", spy)
    return seen


def test_a_get_writes_without_response_on_the_pftp_char_and_bounds_its_read(monkeypatch):
    """Mutants 10, 12, 15, 16, 17 and the 61.0 default. PS-FTP requires write-WITHOUT-response: an
    acknowledged write per air packet halves the throughput of a link that is already the slow path."""
    c = _fs_with_one_session()
    _install(monkeypatch, c)
    reads = _spy_read_timeouts(monkeypatch)

    async def go():
        async with ps.PolarPsFtp("AA:BB") as fs:
            return await fs.get("/U/0/20260719/E/034500/BPM.GZ")
    assert _run(go()) == b"A" * 12
    assert c.writes and all(char == ps.MTU_CHAR for char, _ in c.writes), "all traffic rides FB005C51"
    assert all(response is False for _, response in c.writes), "write without response, explicitly"
    assert reads == [60.0], "the default read bound a caller relies on when it passes no timeout"


def test_a_query_writes_without_response_on_the_pftp_char_and_bounds_its_read(monkeypatch):
    """The same contract on the only path that WRITES to the device (the time queries)."""
    c = FakeClient()
    _install(monkeypatch, c)
    reads = _spy_read_timeouts(monkeypatch)

    async def go():
        async with ps.PolarPsFtp("AA:BB") as fs:
            await fs.query(ps.SET_LOCAL_TIME, b"\x01")
    _run(go())
    assert c.writes and all(char == ps.MTU_CHAR for char, _ in c.writes)
    assert all(response is False for _, response in c.writes)
    assert reads == [20.0], "a query answers fast or not at all; 20 s is the bound"


# ── set_local_time: the clock we actually write ─────────────────────────────────────────────────────
def test_setting_the_clock_sends_the_encoded_time_not_an_empty_query(monkeypatch):
    """Mutants 11 and 19 drop the `params` argument from both queries — the device is told 'set your
    clock' with no clock attached. Nothing asserted the payload, only that the call completed, so both
    survived. Polar stamps every sample with device time; an unset H10 runs from 2019-01-01."""
    import datetime as dt
    c = FakeClient()
    _install(monkeypatch, c)
    when = dt.datetime(2026, 7, 19, 3, 4, 5, 678_000)

    async def go():
        async with ps.PolarPsFtp("AA:BB") as fs:
            await fs.set_local_time(when)
    _run(go())

    assert [qid for qid, _ in c.queries] == [ps.SET_LOCAL_TIME, ps.SET_SYSTEM_TIME], \
        "with_system_time defaults to True — mutant 1 flips that default and no caller passed it"
    local, system = dict(c.queries)[ps.SET_LOCAL_TIME], dict(c.queries)[ps.SET_SYSTEM_TIME]
    assert local == ps.encode_set_local_time(when, 0)
    assert system == ps.encode_set_system_time(when)
    # tz_offset = 0 ON PURPOSE (mutant 7 makes it 1): the device derives its SYSTEM clock from
    # local+tz_offset and PMD stamps every sample with the SYSTEM clock, so a non-zero offset here is
    # what put the Verity 4 h ahead of the H10 on 2026-07-18. Zero is the common timebase PAT needs.
    assert ps._parse_pb_fields(local)[3] == 0, "the declared tz offset is zero, deliberately"


def test_the_clock_written_when_no_time_is_given_is_utc(monkeypatch):
    """Mutant 4 replaces `datetime.now(timezone.utc)` with `datetime.now(None)` — naive LOCAL time. On
    a UTC box the two agree, which is why it survived; on the capture host they do not, and the device
    would be set hours off while GET_LOCAL_TIME cheerfully reports back what we sent. Pinned under an
    explicitly non-UTC TZ so the assertion means something wherever it runs."""
    import datetime as dt
    import time as _time
    monkeypatch.setenv("TZ", "America/New_York")
    _time.tzset()
    try:
        c = FakeClient()
        _install(monkeypatch, c)

        async def go():
            async with ps.PolarPsFtp("AA:BB") as fs:
                await fs.set_local_time()
        _run(go())
        sent = ps._parse_pb_fields(dict(c.queries)[ps.SET_LOCAL_TIME])
        d, t = ps._parse_pb_fields(sent[1]), ps._parse_pb_fields(sent[2])
        wrote = dt.datetime(d[1], d[2], d[3], t[1], t[2], t[3])
        drift = abs((wrote - dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)).total_seconds())
        assert drift < 120, f"the device clock is set from UTC, not local civil time (off by {drift:.0f}s)"
    finally:
        monkeypatch.undo()
        _time.tzset()


# ── get_local_time: reading the clock back ──────────────────────────────────────────────────────────
def test_reading_the_clock_back_round_trips_every_component(monkeypatch):
    """Twenty-three survivors, almost all of them in this one `datetime(...)` call: seconds read from
    the wrong field, minutes defaulted to 1, millis dropped or scaled by 1001. The old assertion looked
    at `.year`, `.hour` and `.minute` and stopped — so the three components after the ones it checked
    were free to be anything. This read-back is how we verify the clock we just set actually took."""
    import datetime as dt
    c = FakeClient()
    when = dt.datetime(2026, 7, 19, 23, 58, 59, 123_000)
    c.time_reply = (ps._pb_msg(1, ps._pb_date(when.year, when.month, when.day))
                    + ps._pb_msg(2, ps._pb_time(when.hour, when.minute, when.second, 123)))
    _install(monkeypatch, c)

    async def go():
        async with ps.PolarPsFtp("AA:BB") as fs:
            return await fs.get_local_time()
    assert _run(go()) == when, "every field, not the three the old test happened to name"


def test_a_clock_reply_that_omits_components_defaults_them_to_zero(monkeypatch):
    """Thirteen survivors sat in the `tt.get(field, DEFAULT)` defaults — minute defaulting to 1, second
    read from field 4, millis defaulted to None. A reply carrying every field cannot see any of them,
    which is exactly what the round-trip test above supplies. PbTime is proto2 and every member is
    OPTIONAL: the H10 answers GET_LOCAL_TIME without millis, so a partial reply is the ordinary one."""
    import datetime as dt
    c = FakeClient()
    c.time_reply = ps._pb_msg(1, ps._pb_date(2026, 7, 19)) + ps._pb_msg(2, b"")   # date only, no PbTime
    _install(monkeypatch, c)

    async def go():
        async with ps.PolarPsFtp("AA:BB") as fs:
            return await fs.get_local_time()
    assert _run(go()) == dt.datetime(2026, 7, 19, 0, 0, 0, 0), "midnight, not 00:01 and not a crash"
    assert dict(c.queries)[ps.GET_LOCAL_TIME] == b"", \
        "a read carries no params — mutant 1 gives `query` a non-empty default nobody passes"


def test_a_reply_with_only_the_date_is_refused(monkeypatch):
    """Mutant 11 turns the `and` in the shape check into `or`, so a reply carrying a date but no time
    passes the guard and reaches `_parse_pb_fields(None)`. Both existing malformed-reply fixtures broke
    BOTH fields at once, which is the one input an `and`/`or` swap cannot be seen through."""
    c = FakeClient()
    c.time_reply = ps._pb_msg(1, ps._pb_date(2026, 7, 19)) + ps._pb_uint(2, 5)   # field 2 is a varint
    _install(monkeypatch, c)

    async def go():
        async with ps.PolarPsFtp("AA:BB") as fs:
            return await fs.get_local_time()
    assert _run(go()) is None, "half a clock is not a clock"


# ── _session_meta: the sidecar's contents ───────────────────────────────────────────────────────────
def test_the_session_metadata_names_the_kind_the_date_and_the_start():
    """Nine survivors: `offline` → `OFFLINE`, `/R/` → `/r/`, the `time` key renamed. These land in
    `recording.meta.json`, which is how a pulled session describes itself to everything downstream."""
    m = ps._session_meta("/U/0/20260719/E/034500/")
    assert m == {"kind": "exercise", "date": "20260719", "time": "034500",
                 "start_local": "2026-07-19T03:45:00"}
    assert ps._session_meta("/U/0/20260720/R/221500/")["kind"] == "offline", \
        "R/ is a button-pressed offline recording, E/ is an exercise session"
    assert ps._session_meta("/U/0/20260720/S/221500/")["kind"] == "other"


def test_a_path_with_a_date_but_no_time_has_no_start_rather_than_raising():
    """Mutant 27 turns `if date and time` into `or`, and the branch then indexes `None` — an outright
    crash on the directory rows `walk` yields above the session level."""
    assert ps._session_meta("/U/0/20260719/")["start_local"] is None
    assert ps._session_meta("/U/0/20260719/")["date"] == "20260719"


# ── pull_recording: the manifest and the sidecar nobody read ────────────────────────────────────────
def test_the_manifest_describes_every_file_it_wrote(monkeypatch, tmp_path):
    """Mutants 151/152 assign the file list to a MISPELLED key, so `manifest["files"]` keeps the empty
    list it was initialised with — a pull that fetched a whole session reports zero files, and the CLI
    and the /api handler both print nothing. Sixteen more mutants rename a per-file key or flip its
    value. Nothing asserted the record's shape; only its byte total."""
    c = _fs_with_one_session()
    _install(monkeypatch, c)
    m = _run(ps.pull_recording("AA:BB", "/U/0/20260719/E/034500/", str(tmp_path)))

    # the exact key set, because mutants 17-20 misspell an INITIAL key: the later assignment then adds
    # the correct one beside the junk, so every individual lookup still works and only the shape shows it
    assert set(m) == {"session", "out_dir", "files", "new_files", "short", "ok", "total_bytes"}
    assert m["session"] == "/U/0/20260719/E/034500/"
    assert m["out_dir"] == str(tmp_path)
    assert sorted(m["new_files"]) == ["BPM.GZ", "PLETH.GZ"], "a first pull reports both files as new"
    by_name = {f["name"]: f for f in m["files"]}
    assert sorted(by_name) == ["BPM.GZ", "PLETH.GZ"]
    assert by_name["BPM.GZ"] == {"name": "BPM.GZ", "bytes": 12, "declared": 12, "ok": True,
                                 "dst": str(tmp_path / "BPM.GZ")}


def test_a_skipped_file_is_recorded_as_skipped_and_complete(monkeypatch, tmp_path):
    """The resume path's record, mutants 65-81: `ok` flipped to False, `skipped` flipped to False, the
    destination renamed. `pull_polar_offline_all` branches on these to decide what it just did."""
    c = _fs_with_one_session()
    _install(monkeypatch, c)
    _run(ps.pull_recording("AA:BB", "/U/0/20260719/E/034500/", str(tmp_path)))
    m = _run(ps.pull_recording("AA:BB", "/U/0/20260719/E/034500/", str(tmp_path)))
    by_name = {f["name"]: f for f in m["files"]}
    assert by_name["PLETH.GZ"] == {"name": "PLETH.GZ", "bytes": 34, "declared": 34, "ok": True,
                                   "skipped": True, "dst": str(tmp_path / "PLETH.GZ")}


def test_a_short_file_points_its_record_at_the_part_it_actually_wrote(monkeypatch, tmp_path):
    """Mutant 137 inverts the `dst` conditional, so a truncated file's record names the clean path it
    was deliberately NOT written to — a reader that trusts `dst` then reports a file that is not there,
    which is the same fabricated-completeness the `.part` scheme exists to prevent."""
    c = _fs_with_a_short_file()
    _install(monkeypatch, c)
    m = _run(ps.pull_recording("AA:BB", "/U/0/20260719/E/034500/", str(tmp_path)))
    short = next(f for f in m["files"] if f["name"] == "PLETH.GZ")
    assert short["ok"] is False and short["bytes"] == 9 and short["declared"] == 34
    assert short["dst"] == str(tmp_path / "PLETH.GZ.part"), "the record names the file that exists"
    assert m["new_files"] == ["BPM.GZ"], "a truncated file is not a new file"


def test_the_sidecar_is_written_into_the_output_directory_and_describes_the_pull(monkeypatch, tmp_path):
    """Eleven survivors covered the whole sidecar: `meta = None`, the filename uppercased, and — mutant
    192 — `os.path.join('recording.meta.json')`, which drops `out_dir` and writes it into whatever
    directory the process happens to be in. No test opened the file. It is the only thing that makes a
    pulled session self-describing once it is off the box."""
    c = _fs_with_one_session()
    _install(monkeypatch, c)
    m = _run(ps.pull_recording("24:AC:AC:0C:30:1E", "/U/0/20260719/E/034500/", str(tmp_path),
                               adapter="hci1"))

    # mutants 32-35: the address or the adapter dropped on the way into PolarPsFtp. A pull that opens
    # the session on the default radio is a pull of whichever Polar BlueZ picks.
    assert c.cleared_addr == "24:AC:AC:0C:30:1E" and c.scan_addr == "24:AC:AC:0C:30:1E"
    assert c.ctor_kw.get("bluez") == {"adapter": "hci1"}

    sidecar = tmp_path / "recording.meta.json"
    assert sidecar.is_file(), "written beside the recording, not into the working directory"
    meta = json.loads(sidecar.read_text())
    assert meta == {"kind": "exercise", "date": "20260719", "time": "034500",
                    "start_local": "2026-07-19T03:45:00",
                    "session": "/U/0/20260719/E/034500/", "total_bytes": m["total_bytes"],
                    "device": "24:AC:AC:0C:30:1E", "n_files": 2}
    assert "\n" in sidecar.read_text(), "indented, because a human reads this one"


def test_a_zero_byte_file_is_still_downloaded(monkeypatch, tmp_path):
    """Mutants 40 and 41 tighten `size >= 0` to `> 0` / `>= 1`, silently dropping an empty file from the
    pull; mutant 38 loosens the `and` to `or` and tries to download the directories too. A Polar session
    that was started and stopped without data has exactly this shape, and `list_recordings` already
    refuses to hide it — the pull must not either."""
    c = _fs_with_one_session()
    c.dirs["/U/0/20260719/E/034500/"] = [("BPM.GZ", 12), ("EMPTY.GZ", 0)]
    c.files["/U/0/20260719/E/034500/EMPTY.GZ"] = b""
    _install(monkeypatch, c)
    m = _run(ps.pull_recording("AA:BB", "/U/0/20260719/E/034500/", str(tmp_path)))
    assert sorted(f["name"] for f in m["files"]) == ["BPM.GZ", "EMPTY.GZ"]
    assert (tmp_path / "EMPTY.GZ").is_file() and (tmp_path / "EMPTY.GZ").stat().st_size == 0
    assert m["ok"] is True, "zero declared, zero received — that is a complete file"


def test_a_session_of_nothing_but_empty_files_still_reports_full_progress(monkeypatch, tmp_path):
    """Mutant 45 changes the zero-division guard `or 1` to `or 2`, so a session whose bytes sum to zero
    reports 0/2 — a progress bar stuck at half on a pull that finished."""
    c = _fs_with_one_session()
    c.dirs["/U/0/20260719/E/034500/"] = [("EMPTY.GZ", 0)]
    c.files["/U/0/20260719/E/034500/EMPTY.GZ"] = b""
    _install(monkeypatch, c)
    seen = []
    _run(ps.pull_recording("AA:BB", "/U/0/20260719/E/034500/", str(tmp_path),
                           on_progress=lambda d, t: seen.append((d, t))))
    assert seen == [(0, 1)], "no bytes to move is 100 %, not 0 %"


def test_progress_accumulates_across_files_and_reaches_the_total(monkeypatch, tmp_path):
    """Mutants 142/143 replace the accumulator with an assignment or a subtraction, and 144/145 pass
    `None` where the counts go. The existing download-path test asserted only that the callback FIRED —
    the arguments it was handed went unread, which is the same discarding-double failure one level up."""
    c = _fs_with_one_session()
    _install(monkeypatch, c)
    seen = []
    _run(ps.pull_recording("AA:BB", "/U/0/20260719/E/034500/", str(tmp_path),
                           on_progress=lambda d, t: seen.append((d, t))))
    assert seen == [(12, 46), (46, 46)], "monotonic, cumulative, and it ends at the total"


def test_a_file_download_is_bounded(monkeypatch, tmp_path):
    """Mutants 95/97/98 unbind or nudge the per-file read timeout. Unbounded is the one that matters:
    the caller's watchdog is what stops a wedged pull from holding the offline lock all night, and it
    cannot fire while this await never returns."""
    c = _fs_with_one_session()
    _install(monkeypatch, c)
    reads = []
    orig = ps.PolarPsFtp.get

    async def spy(self, path, timeout=60.0):
        reads.append((path, timeout))
        return await orig(self, path, timeout)
    monkeypatch.setattr(ps.PolarPsFtp, "get", spy)
    _run(ps.pull_recording("AA:BB", "/U/0/20260719/E/034500/", str(tmp_path)))
    file_reads = [t for p, t in reads if not p.endswith("/")]
    assert file_reads == [180.0, 180.0], "each file download carries the 180 s bound"


def test_a_nested_file_lands_in_its_own_subdirectory(monkeypatch, tmp_path):
    """Mutant 58 turns `os.path.dirname(dst) or out_dir` into `and`, so the parent directory created is
    `out_dir` itself and a nested file's open() fails outright. Every fixture was flat, which is the one
    layout where `and` and `or` agree. `pull_recording` documents that it MIRRORS the on-device tree."""
    c = _fs_with_one_session()
    c.dirs["/U/0/20260719/E/034500/"] = [("BPM.GZ", 12), ("SUB/", 0)]
    c.dirs["/U/0/20260719/E/034500/SUB/"] = [("INNER.GZ", 5)]
    c.files["/U/0/20260719/E/034500/SUB/INNER.GZ"] = b"inner"
    _install(monkeypatch, c)
    m = _run(ps.pull_recording("AA:BB", "/U/0/20260719/E/034500/", str(tmp_path)))
    assert (tmp_path / "SUB" / "INNER.GZ").read_bytes() == b"inner"
    assert sorted(f["name"] for f in m["files"]) == ["BPM.GZ", "SUB/INNER.GZ"]


# ── main(): the CLI's arguments and its output ──────────────────────────────────────────────────────
def _argv(monkeypatch, *args):
    import sys as _sys
    monkeypatch.setattr(_sys, "argv", ["polar_psftp.py", *args])


def test_the_cli_refuses_to_run_without_the_arguments_it_needs(monkeypatch, tmp_path):
    """Mutants 14, 35 and 60 make `--address`, the subcommand and `--out` optional. The module's own
    comment leans on the subcommand being required ('argparse has already exited on anything else, so
    the both-false arm cannot be reached') — with `required=False` that arm IS reached and the CLI
    exits 0 having done nothing at all, which is the worst way to fail a backup."""
    async def unused_list(addr, adapter=None):
        raise AssertionError("argparse should have exited before any device work")
    monkeypatch.setattr(ps, "list_recordings", unused_list)

    for missing in (["list"],                                        # no --address
                    ["--address", "AA:BB"],                          # no subcommand
                    ["--address", "AA:BB", "pull", "--session", "/U/0/"]):   # no --out
        _argv(monkeypatch, *missing)
        with pytest.raises(SystemExit) as e:
            ps.main()
        assert e.value.code == 2, f"argparse must reject {missing!r}"


def test_the_listing_cli_passes_the_address_and_adapter_through(monkeypatch, capsys):
    """Mutants 68-71: the address or the adapter silently dropped on the way to `list_recordings`. On a
    box with three BLE radios an unpinned adapter is a listing of the wrong device, or of nothing."""
    seen = {}

    async def fake_list(addr, adapter=None):
        seen["args"] = (addr, adapter)
        return [{"path": "/U/0/20260719/E/034500/", "total_bytes": 46}]
    monkeypatch.setattr(ps, "list_recordings", fake_list)
    _argv(monkeypatch, "--address", "24:AC:AC:0C:30:1E", "--adapter", "hci1", "list")
    ps.main()
    assert seen["args"] == ("24:AC:AC:0C:30:1E", "hci1")
    out = capsys.readouterr().out
    assert json.loads(out.split("\n\n")[0]) == [{"path": "/U/0/20260719/E/034500/", "total_bytes": 46}]
    assert out.rstrip().endswith("1 recording(s).")


def test_a_pull_of_every_session_gives_each_one_its_own_directory(monkeypatch, tmp_path, capsys):
    """Mutants 89/92/93 and 100/101 corrupt the per-session output path — `os.path.join(a.out)` drops
    the session component entirely, so pulling ALL recordings unpacks every session on top of the last
    one and the box ends up with a single mixed directory. Mutants 85-88 and 104-111 drop the address or
    the adapter on the way in. The old test read one field of one call."""
    seen = []

    listed = []

    async def fake_list(addr, adapter=None):
        listed.append((addr, adapter))     # mutants 85-88 drop these, and the first pass did not look
        return [{"path": "/U/0/20260719/E/034500/"}, {"path": "/U/0/20260720/R/221500/"}]

    async def fake_pull(addr, session, out, adapter=None):
        seen.append((addr, session, out, adapter))
        return {"files": [], "total_bytes": 0}
    monkeypatch.setattr(ps, "list_recordings", fake_list)
    monkeypatch.setattr(ps, "pull_recording", fake_pull)
    _argv(monkeypatch, "--address", "24:AC:AC:0C:30:1E", "--adapter", "hci1", "pull",
          "--out", str(tmp_path))
    ps.main()

    assert listed == [("24:AC:AC:0C:30:1E", "hci1")], \
        "the enumeration that decides WHICH sessions to pull is pinned to the same device and radio"
    assert seen == [
        ("24:AC:AC:0C:30:1E", "/U/0/20260719/E/034500/",
         os.path.join(str(tmp_path), "U_0_20260719_E_034500"), "hci1"),
        ("24:AC:AC:0C:30:1E", "/U/0/20260720/R/221500/",
         os.path.join(str(tmp_path), "U_0_20260720_R_221500"), "hci1"),
    ]
    out = capsys.readouterr().out
    assert f"pulling /U/0/20260719/E/034500/ -> {os.path.join(str(tmp_path), 'U_0_20260719_E_034500')}" in out
    assert "0 files, 0 bytes" in out


def test_the_pull_cli_marks_a_truncated_file_as_a_mismatch(monkeypatch, tmp_path, capsys):
    """Mutants 119/123/124: `'OK'` → `'XXOKXX'` survived an assertion of `"OK" in out` — a substring
    check cannot see a longer string containing it — and the MISMATCH arm was never printed at all.
    This line is the only place the operator learns a backup came back short."""
    async def fake_pull(addr, session, out, adapter=None):
        return {"files": [{"name": "BPM.GZ", "bytes": 12, "ok": True},
                          {"name": "PLETH.GZ", "bytes": 9, "ok": False}], "total_bytes": 21}
    monkeypatch.setattr(ps, "pull_recording", fake_pull)
    _argv(monkeypatch, "--address", "AA:BB", "pull", "--session", "/U/0/20260719/E/034500/",
          "--out", str(tmp_path))
    ps.main()
    lines = capsys.readouterr().out.splitlines()
    assert "        12  BPM.GZ  OK" in lines
    assert "         9  PLETH.GZ  MISMATCH" in lines
    assert "  2 files, 21 bytes" in lines
