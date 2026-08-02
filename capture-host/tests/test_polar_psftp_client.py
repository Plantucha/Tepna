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
        self.requested = []              # every path the client actually asked for, in order
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


def test_the_completion_line_also_names_the_device(monkeypatch, caplog):
    """Both lines, not just the progress one: the completion line is what lands in the journal for a
    run that finished, and 'walk complete' without a device is unattributable on a three-Polar box."""
    c = _fs_with_one_session()
    _install(monkeypatch, c)
    with caplog.at_level("INFO", logger="polar_psftp"):
        _run(ps.list_recordings("24:AC:AC:0C:30:1E"))
    done = next(r.getMessage() for r in caplog.records if "walk complete" in r.getMessage())
    assert "24:AC:AC:0C:30:1E" in done
