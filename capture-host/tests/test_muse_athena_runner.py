# tepna-capture — tests/test_muse_athena_runner.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The native Muse S Athena recorder (capture.run_muse_athena), driven WITHOUT BLE hardware. The link is a
# fake client injected through `_connect`; every packet is SYNTHETIC, built here, never captured.

import asyncio
import contextlib
import glob
import os

import pytest

import capture
import muse_athena as M
from tests._srcscan import module_source

ADDR = "AA:BB:CC:DD:EE:01"


@pytest.fixture(autouse=True)
def _clean():
    capture._STOP = asyncio.Event()
    capture._CONNECT_LOCK = asyncio.Lock()
    capture.STATUS.clear()
    capture.STATUS["devices"] = {}
    capture._LAST_DATA.clear()
    yield
    capture._STOP.set()
    capture._STOP.clear()


def _dev(**kw):
    d = {"name": "Muse", "vendor": "Muse", "model": "S-Athena", "device_id": "TEST0001", "address": ADDR}
    d.update(kw)
    return d


def _rec(tag, index, tick, n):
    return bytes([tag, index]) + tick.to_bytes(3, "little") + bytes(n)


def _pkt(counter, *records):
    body = b"".join(records)
    return bytes([M.HEADER_LEN + len(body), counter]) + bytes(7) + body


def _eeg(counter, tick):
    return _pkt(counter, _rec(M.TAG_EEG, 0, tick, 28), _rec(M.TAG_EEG, 1, tick + 78125, 28))


def _battery(counter, pct256):
    return _pkt(counter, bytes([M.TAG_BATTERY, 0, 1, 0, 0]) + pct256.to_bytes(2, "little") + bytes(18))


def _frag(text):
    return bytes([len(text)]) + text.encode()


class FakeMuse:
    def __init__(self):
        self.cbs = {}
        self.writes = []
        self.connected = True
        self.fail_write_after = None  # raise on the nth control write

    @property
    def is_connected(self):
        return self.connected

    async def start_notify(self, ch, cb):
        self.cbs[ch] = cb

    async def write_gatt_char(self, ch, data, response=False):
        assert ch == M.CONTROL_CHAR and response is False
        if self.fail_write_after is not None and len(self.writes) >= self.fail_write_after:
            raise OSError("gone")
        self.writes.append(bytes(data))


def _inject(monkeypatch, client):
    @contextlib.asynccontextmanager
    async def ctx(_addr, *a, **k):
        yield client

    monkeypatch.setattr(capture, "_connect", ctx)


def _sleeps(monkeypatch, on_sleep):
    """Patch capture's asyncio.sleep: each call runs `on_sleep(n, secs)` (n counts from 1)."""
    calls = {"n": 0, "secs": []}

    async def fake_sleep(secs):
        calls["n"] += 1
        calls["secs"].append(secs)
        on_sleep(calls["n"], secs)

    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    return calls


def _files(tmp_path, pattern):
    return sorted(glob.glob(os.path.join(str(tmp_path), "captures", "*", pattern)))


def test_a_session_subscribes_starts_the_preset_records_raw_frames_and_stops(tmp_path, monkeypatch):
    c = FakeMuse()
    _inject(monkeypatch, c)
    n_start = len(M.start_sequence("p1045"))

    def on_sleep(n, _secs):
        if n == n_start:  # the start sequence is written: frames flow
            data = c.cbs[M.DATA_CHAR]
            data(M.DATA_CHAR, bytearray(_eeg(1, 1000)))
            data(M.DATA_CHAR, bytearray(_eeg(4, 160000)))  # counters 2 and 3 never arrived
            data(M.DATA_CHAR, bytearray(_battery(5, 0x4880)))
            data(M.DATA_CHAR, bytearray(b"\x03\x06\x00"))  # a frame that does not tokenise is still kept
            ctrl = c.cbs[M.CONTROL_CHAR]
            ctrl(M.CONTROL_CHAR, _frag('{"fw":"1.2.3",'))
            ctrl(M.CONTROL_CHAR, _frag('"ps":4165}'))
            ctrl(M.CONTROL_CHAR, _frag('{"rc":0}{oops}'))
        if n == n_start + 1:  # one hold tick
            capture._STOP.set()

    calls = _sleeps(monkeypatch, on_sleep)
    asyncio.run(capture.run_muse_athena(_dev(), str(tmp_path)))

    assert set(c.cbs) == set(M.NOTIFY_CHARS)
    sent = [M.command(x) for x in M.start_sequence("p1045") + M.STOP_SEQUENCE]
    assert c.writes == sent
    assert calls["secs"][:n_start] == [0.6, 0.6, 1.5] + [0.6] * (n_start - 3)
    st = capture.STATUS["devices"]["Muse"]
    assert (st["battery"], st["fw"], st["preset_active"], st["preset"]) == (72, "1.2.3", 4165, "p1045")
    assert "Muse" in capture._LAST_DATA

    (raw,) = _files(tmp_path, "Muse_S-Athena_TEST0001_*_RAW.txt")
    rows = [ln.split(";") for ln in open(raw).read().splitlines()[1:]]
    assert [r[2] for r in rows] == ["1", "4", "5", ""]
    assert rows[0][1] == str(1000 * 100) and rows[3][1] == ""
    assert rows[0][4] == _eeg(1, 1000).hex()
    gaps = [ln for ln in open(raw[:-4] + "RUNS.txt").read().splitlines() if ";counter-gap;" in ln]
    assert [g.split(";")[2:5] for g in gaps] == [["1", "4", "2"]]
    (arr,) = _files(tmp_path, "Muse_S-Athena_TEST0001_*_PMDARRIVAL.csv")
    arows = [ln.split(";") for ln in open(arr).read().splitlines()[1:]]
    assert [(a[2], a[3], a[4], a[5]) for a in arows[:1]] == [("MUSE_FRAME", "100000", str((1000 + 78125) * 100), "2")]
    assert arows[3][3:6] == ["", "", "0"]


def test_a_silent_data_channel_behind_a_live_link_is_a_stall_and_the_header_only_file_goes(tmp_path, monkeypatch):
    c = FakeMuse()
    _inject(monkeypatch, c)
    clock = {"t": 1000.0}
    monkeypatch.setattr(capture._time, "monotonic", lambda: clock["t"])
    retries = []

    async def fake_retry(name, delay, why, attempt):
        retries.append((why, delay))
        capture._STOP.set()

    monkeypatch.setattr(capture, "_retry_sleep", fake_retry)

    def on_sleep(n, secs):
        if secs == 1.0:
            clock["t"] += capture.MUSE_STALL_S + 1

    _sleeps(monkeypatch, on_sleep)
    asyncio.run(capture.run_muse_athena(_dev(preset="p1041"), str(tmp_path)))
    assert retries == [("stalled", capture._STALL_RECONNECT_S)]
    assert M.command("p1041") in c.writes
    assert _files(tmp_path, "*_RAW*.txt") == []  # nothing recorded: no junk file set


def test_a_lost_link_after_data_backs_off_from_the_floor_and_a_failed_start_backs_off_further(tmp_path, monkeypatch):
    c = FakeMuse()
    _inject(monkeypatch, c)
    retries = []

    async def fake_retry(name, delay, why, attempt):
        retries.append((why, delay, attempt))
        c.fail_write_after = len(c.writes)  # the next session's first control write raises
        if len(retries) == 2:
            capture._STOP.set()

    monkeypatch.setattr(capture, "_retry_sleep", fake_retry)
    n_start = len(M.start_sequence("p1045"))

    def on_sleep(n, secs):
        if n == n_start:
            c.cbs[M.DATA_CHAR](M.DATA_CHAR, _eeg(1, 5))
        if n == n_start + 1:
            c.connected = False

    _sleeps(monkeypatch, on_sleep)
    asyncio.run(capture.run_muse_athena(_dev(), str(tmp_path)))
    assert retries == [("backoff", 5, 1), ("backoff", 10, 2)]
    assert capture.STATUS["devices"]["Muse"]["last_error"] == "OSError('gone')"
    assert len(_files(tmp_path, "*_RAW.txt")) == 1  # the recorded set is kept; the empty resume never deletes it


def test_a_session_that_records_resets_the_backoff_a_failed_start_had_raised(tmp_path, monkeypatch):
    """A failed start raises the backoff to 10 s. The next session records a frame, so its lost link
    backs off from the 5 s floor at attempt 1 again, not from 10 s at attempt 2."""
    c = FakeMuse()
    c.fail_write_after = 0  # the first session's first control write raises
    _inject(monkeypatch, c)
    retries = []

    async def fake_retry(name, delay, why, attempt):
        retries.append((why, delay, attempt))
        c.fail_write_after = None
        if len(retries) == 2:
            capture._STOP.set()

    monkeypatch.setattr(capture, "_retry_sleep", fake_retry)
    n_start = len(M.start_sequence("p1045"))

    def on_sleep(n, secs):
        if n == n_start:
            c.cbs[M.DATA_CHAR](M.DATA_CHAR, _eeg(1, 5))
        if n == n_start + 1:
            c.connected = False

    _sleeps(monkeypatch, on_sleep)
    asyncio.run(capture.run_muse_athena(_dev(), str(tmp_path)))
    assert retries == [("backoff", 5, 1), ("backoff", 5, 1)]


def test_a_stopped_session_sends_both_stop_commands(tmp_path, monkeypatch):
    c = FakeMuse()
    _inject(monkeypatch, c)
    n_start = len(M.start_sequence("p1045"))

    def on_sleep(n, secs):
        if n == n_start:
            c.cbs[M.DATA_CHAR](M.DATA_CHAR, _eeg(1, 5))
            capture._STOP.set()

    _sleeps(monkeypatch, on_sleep)
    asyncio.run(capture.run_muse_athena(_dev(), str(tmp_path)))
    assert c.writes[-2:] == [M.command("s"), M.command("h")]


def test_a_stop_write_that_fails_ends_the_stop_sequence_without_raising(tmp_path, monkeypatch):
    c = FakeMuse()
    _inject(monkeypatch, c)
    n_start = len(M.start_sequence("p1045"))

    def on_sleep(n, secs):
        if n == n_start:
            c.cbs[M.DATA_CHAR](M.DATA_CHAR, _eeg(1, 5))
            c.fail_write_after = len(c.writes)
            capture._STOP.set()

    _sleeps(monkeypatch, on_sleep)
    asyncio.run(capture.run_muse_athena(_dev(), str(tmp_path)))
    assert c.writes == [M.command(x) for x in M.start_sequence("p1045")]
    assert capture.STATUS["devices"]["Muse"]["last_error"] is None


def test_a_reconnect_inside_the_resume_window_appends_to_the_same_file_set(tmp_path, monkeypatch):
    c = FakeMuse()
    _inject(monkeypatch, c)
    n_start = len(M.start_sequence("p1045"))
    seen = {"session": 0}

    async def fake_retry(name, delay, why, attempt):
        seen["session"] += 1
        if seen["session"] == 2:
            capture._STOP.set()

    monkeypatch.setattr(capture, "_retry_sleep", fake_retry)

    def on_sleep(n, secs):
        if n % (n_start + 1) == n_start:
            c.cbs[M.DATA_CHAR](M.DATA_CHAR, _eeg(n % 256, 5))
        if n % (n_start + 1) == 0:
            c.connected = False
        else:
            c.connected = True

    _sleeps(monkeypatch, on_sleep)
    asyncio.run(capture.run_muse_athena(_dev(), str(tmp_path)))
    (raw,) = _files(tmp_path, "*_RAW.txt")
    assert len(open(raw).read().splitlines()) == 3  # one header, one frame from each session


def test_the_runner_choice_reads_protocol_athena():
    src = module_source("capture.py")
    assert 'runner = run_muse_athena if dev.get("protocol") == "athena" else run_muse' in src


def test_a_connect_that_fails_before_any_writer_backs_off_and_leaves_no_file(tmp_path, monkeypatch):
    """With resume off, a refused connect opens no writer: nothing to close, nothing on disk, one backoff."""
    monkeypatch.setattr(capture, "_RESUME_WINDOW_S", 0)

    @contextlib.asynccontextmanager
    async def refused(_addr, *a, **k):
        raise OSError("refused")
        yield  # pragma: no cover — an async generator needs a yield

    monkeypatch.setattr(capture, "_connect", refused)
    retries = []

    async def fake_retry(name, delay, why, attempt):
        retries.append((why, delay, attempt))
        capture._STOP.set()

    monkeypatch.setattr(capture, "_retry_sleep", fake_retry)
    asyncio.run(capture.run_muse_athena(_dev(), str(tmp_path)))
    assert retries == [("backoff", 5, 1)]
    assert capture.STATUS["devices"]["Muse"]["last_error"] == "OSError('refused')"
    assert _files(tmp_path, "*") == []


def test_an_arrival_log_that_cannot_write_still_leaves_the_raw_frame(tmp_path, monkeypatch):
    c = FakeMuse()
    _inject(monkeypatch, c)

    def broken(self, *a, **k):
        raise OSError("arrival log full")

    monkeypatch.setattr(capture.PmdArrivalLogWriter, "write", broken)
    n_start = len(M.start_sequence("p1045"))

    def on_sleep(n, secs):
        if n == n_start:
            c.cbs[M.DATA_CHAR](M.DATA_CHAR, _eeg(1, 5))
            capture._STOP.set()

    _sleeps(monkeypatch, on_sleep)
    asyncio.run(capture.run_muse_athena(_dev(), str(tmp_path)))
    (raw,) = _files(tmp_path, "*_RAW.txt")
    assert len(open(raw).read().splitlines()) == 2  # the header and the one frame


def test_a_session_feeds_the_live_eeg_card_four_electrodes_at_256_hz(tmp_path, monkeypatch):
    c = FakeMuse()
    _inject(monkeypatch, c)
    n_start = len(M.start_sequence("p1045"))
    reg, pushed = [], []
    monkeypatch.setattr(capture.BUS, "register", lambda *a, **k: reg.append((a, k)))
    monkeypatch.setattr(capture.BUS, "push", lambda *a, **k: pushed.append((a, k)))

    def on_sleep(n, _secs):
        if n == n_start:
            c.cbs[M.DATA_CHAR](M.DATA_CHAR, bytearray(_eeg(1, 1000)))
            c.cbs[M.DATA_CHAR](M.DATA_CHAR, bytearray(_battery(2, 0x4880)))  # no EEG record: no push
        if n == n_start + 1:
            capture._STOP.set()

    _sleeps(monkeypatch, on_sleep)
    asyncio.run(capture.run_muse_athena(_dev(), str(tmp_path)))

    assert reg == [(("eeg_TEST0001", "EEG (Muse)", "raw", 256.0, 4, M.EEG_ELECTRODES), {"device": "Muse"})]
    assert [a[0] for a, _ in pushed] == ["eeg_TEST0001", "eeg_TEST0001"]  # one push per EEG record
    rows, hz = pushed[0][0][1], pushed[0][0][2]
    assert hz == 256.0 and len(rows) == 2 and all(len(r) == 4 for r in rows)
    # Each record carries its own device time: 78 125 ticks apart is 7.8125 ms.
    assert pushed[1][1]["dev_ns"] - pushed[0][1]["dev_ns"] == 7_812_500
