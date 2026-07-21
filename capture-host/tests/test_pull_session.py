# tepna-capture — tests/test_pull_session.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The O2Ring stored-session download. It is the one path that produces a file the user believes is a
# complete night, so the branches that matter are the ones where it ISN'T: a truncated transfer, an
# implausible declared size, a session that does not exist. All of those still write a .dat, and the only
# signal that something went wrong is the sidecar — which is exactly why they need tests.
#
# BLE is faked end-to-end, but the fake speaks the REAL 0xA5 wire format through oxyii.encode(), so the
# frames go through the real Reassembler and the real decoder. Nothing about the protocol is stubbed out.

import asyncio
import json
import os

import pytest

import oxyii
import pull_session


def _run(coro):
    return asyncio.run(coro)


# ── _wait: opcode filtering + deadline ──────────────────────────────────────────────────────────────
def test_wait_returns_the_matching_opcode_and_discards_live_frames():
    """Live 0x04 replies keep arriving during a download; _wait must skip them rather than mistake one
    for the file reply it is waiting on."""
    async def go():
        q = asyncio.Queue()
        q.put_nowait((0x04, b"live"))
        q.put_nowait((0x04, b"live-again"))
        q.put_nowait((oxyii.OP_FILE_LIST, b"hit"))
        return await pull_session._wait(q, oxyii.OP_FILE_LIST, timeout=1.0)
    assert _run(go()) == b"hit"


def test_wait_raises_immediately_when_the_deadline_has_already_passed():
    async def go():
        return await pull_session._wait(asyncio.Queue(), oxyii.OP_FILE_LIST, timeout=0)
    with pytest.raises(asyncio.TimeoutError, match="no reply to op"):
        _run(go())


def test_wait_times_out_when_only_the_wrong_opcode_arrives():
    async def go():
        q = asyncio.Queue()
        q.put_nowait((0x04, b"live"))
        return await pull_session._wait(q, oxyii.OP_FILE_LIST, timeout=0.05)
    with pytest.raises(asyncio.TimeoutError):
        _run(go())


# ── a fake ring that speaks the real wire format ────────────────────────────────────────────────────
class FakeRing:
    """Answers FILE_LIST / FILE_START / FILE_DATA with genuine oxyii-encoded frames."""

    def __init__(self, sessions, blob=b"", declared=None, chunk=512, split_frames=False):
        self.sessions = sessions
        self.blob = blob
        self.declared = len(blob) if declared is None else declared
        self.chunk = chunk
        self.split_frames = split_frames
        self.notify = None
        self.off = 0
        self.writes = []
        self.mtu_size = 517
        self.ended = False

    # -- bleak surface --------------------------------------------------------------------------
    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        self.ended = True
        return False

    async def start_notify(self, _char, cb):
        self.notify = cb

    async def write_gatt_char(self, _char, frame, response=False):
        assert response is False, "this device requires write-without-response"
        self.writes.append(frame)
        op = frame[1]
        if op == oxyii.OP_FILE_LIST:
            slots = b"".join(s.encode() + b"\x00\x00" for s in self.sessions)
            self._reply(oxyii.OP_FILE_LIST, bytes([len(self.sessions)]) + slots)
        elif op == oxyii.OP_FILE_START:
            self._reply(oxyii.OP_FILE_START, self.declared.to_bytes(4, "little") + b"\x00" * 4)
        elif op == oxyii.OP_FILE_DATA:
            chunk = self.blob[self.off:self.off + self.chunk]
            self.off += len(chunk)
            self._reply(oxyii.OP_FILE_DATA, chunk)

    def _reply(self, op, payload):
        frame = oxyii.encode(op, payload)
        if self.split_frames and len(frame) > 4:      # prove the real Reassembler is in the path
            self.notify(0, frame[:3])
            self.notify(0, frame[3:])
        else:
            self.notify(0, frame)


class FakeDevice:
    """What BleakScanner hands back — the code reads .address and .name off it."""

    def __init__(self, address="D1:98:62:7C:92:B3", name="O2Ring S8AW"):
        self.address, self.name = address, name


def _install(monkeypatch, ring, device=None):
    device = device or FakeDevice()

    async def find(*a, **k):
        return device

    monkeypatch.setattr(pull_session.BleakScanner, "find_device_by_filter", find)
    monkeypatch.setattr(pull_session, "BleakClient", lambda dev, **kw: ring)

    async def no_sleep(_s):
        return None
    monkeypatch.setattr(pull_session.asyncio, "sleep", no_sleep)


def _dat(tmp_path):
    return [f for f in os.listdir(tmp_path) if f.endswith(".dat")]


# ── the happy path ──────────────────────────────────────────────────────────────────────────────────
def test_a_complete_download_writes_the_dat_and_its_sidecar(tmp_path, monkeypatch):
    blob = b"\x01\x03" + bytes(range(256)) * 8      # format_a marker + body
    ring = FakeRing(["20260719010000"], blob)
    _install(monkeypatch, ring)
    got = _run(pull_session._pull_once("AA:BB:CC:DD:EE:FF", str(tmp_path), "latest", 0, None, "0000"))

    assert len(got) == 1 and got[0].endswith("Wellue_O2Ring-S_20260719010000_STORED.dat")
    assert open(got[0], "rb").read() == blob, "bytes must round-trip exactly"
    meta = json.load(open(got[0] + ".meta.json"))
    assert meta["session"] == "20260719010000"
    assert meta["bytes"] == len(blob) == meta["declared_size"], "a complete pull matches its declaration"
    assert meta["format_a"] is True
    assert meta["approx_samples"] == (len(blob) - 10 - 48) // 3
    assert len(meta["trailer"]) == 96, "48 trailer bytes as hex"


def test_the_transfer_survives_frames_split_across_notifications(tmp_path, monkeypatch):
    """BLE delivers whatever fits the MTU; a reply can straddle two notifications. The real Reassembler
    is in this path, so splitting every frame must change nothing."""
    blob = b"\x01\x03" + bytes(range(200)) * 3
    ring = FakeRing(["20260719010000"], blob, split_frames=True)
    _install(monkeypatch, ring)
    got = _run(pull_session._pull_once("A", str(tmp_path), "latest", 0, None, "0000"))
    assert open(got[0], "rb").read() == blob


def test_adapter_pin_reaches_bleak_in_the_bluez_form(tmp_path, monkeypatch):
    seen = {}
    ring = FakeRing(["20260719010000"], b"\x01\x03" + b"x" * 100)

    async def find(*a, **k):
        seen["scan"] = k
        return FakeDevice()
    monkeypatch.setattr(pull_session.BleakScanner, "find_device_by_filter", find)

    def client(dev, **kw):
        seen["client"] = kw
        return ring
    monkeypatch.setattr(pull_session, "BleakClient", client)

    async def no_sleep(_s):
        return None
    monkeypatch.setattr(pull_session.asyncio, "sleep", no_sleep)
    _run(pull_session._pull_once("A", str(tmp_path), "latest", 0, "hci1", "0000"))
    assert seen["client"] == {"bluez": {"adapter": "hci1"}}


# ── session selection ───────────────────────────────────────────────────────────────────────────────
def test_latest_picks_the_chronologically_newest_not_the_last_listed(tmp_path, monkeypatch):
    """`latest` is max() over YYYYMMDDhhmmss stamps, so a device listing them out of order still yields
    the newest night — sessions[-1] would grab whatever happened to be last."""
    ring = FakeRing(["20260719230000", "20260720010000", "20260718120000"], b"\x01\x03" + b"z" * 90)
    _install(monkeypatch, ring)
    got = _run(pull_session._pull_once("A", str(tmp_path), "latest", 0, None, "0000"))
    assert got[0].endswith("20260720010000_STORED.dat")


def test_all_pulls_every_session(tmp_path, monkeypatch):
    ring = FakeRing(["20260719010000", "20260720010000"], b"\x01\x03" + b"y" * 90)
    _install(monkeypatch, ring)
    got = _run(pull_session._pull_once("A", str(tmp_path), "all", 0, None, "0000"))
    assert len(got) == 2 and len(_dat(tmp_path)) == 2


def test_no_sessions_returns_empty_and_still_disconnects(tmp_path, monkeypatch):
    ring = FakeRing([], b"")
    _install(monkeypatch, ring)
    assert _run(pull_session._pull_once("A", str(tmp_path), "latest", 0, None, "0000")) == []
    assert _dat(tmp_path) == []
    assert ring.ended is True, "the early return must still leave the BLE link closed"


# ── the failure branches that still produce a file ──────────────────────────────────────────────────
@pytest.mark.parametrize("declared", [0, 50_000_000, 60_000_000])
def test_an_implausible_declared_size_skips_the_session_without_writing(tmp_path, monkeypatch, declared):
    """A wrong --ftype makes the ring report nonsense. Writing a .dat here would produce a file the user
    believes is a night; skipping is correct, and it must leave NOTHING behind."""
    ring = FakeRing(["20260719010000"], b"\x01\x03" + b"q" * 100, declared=declared)
    _install(monkeypatch, ring)
    got = _run(pull_session._pull_once("A", str(tmp_path), "latest", 0, None, "0000"))
    assert got == [] and _dat(tmp_path) == []


def test_the_largest_plausible_size_is_still_accepted(tmp_path, monkeypatch):
    """Boundary: the guard is `0 < size < 50_000_000`, so one under the cap must go through."""
    blob = b"\x01\x03" + b"w" * 100
    ring = FakeRing(["20260719010000"], blob, declared=49_999_999, chunk=len(blob))
    _install(monkeypatch, ring)

    calls = {"n": 0}
    real_wait = pull_session._wait

    async def flaky(q, op, timeout=20.0):
        if op == oxyii.OP_FILE_DATA:
            calls["n"] += 1
            if calls["n"] > 1:
                raise asyncio.TimeoutError("stop")
        return await real_wait(q, op, timeout=timeout)
    monkeypatch.setattr(pull_session, "_wait", flaky)
    got = _run(pull_session._pull_once("A", str(tmp_path), "latest", 0, None, "0000"))
    assert len(got) == 1, "a size just under the cap must not be rejected"


def test_a_truncated_transfer_still_writes_but_the_sidecar_shows_the_shortfall(tmp_path, monkeypatch):
    """THE detectable signature of truncation. A partial .dat is kept deliberately — the data is real —
    but bytes < declared_size is the only way a consumer can tell it is not a whole night."""
    blob = b"\x01\x03" + b"p" * 4000
    ring = FakeRing(["20260719010000"], blob, declared=len(blob), chunk=512)
    _install(monkeypatch, ring)

    real_wait = pull_session._wait
    seen = {"n": 0}

    async def cut_off(q, op, timeout=20.0):
        if op == oxyii.OP_FILE_DATA:
            seen["n"] += 1
            if seen["n"] > 2:
                raise asyncio.TimeoutError("link died mid-transfer")
        return await real_wait(q, op, timeout=timeout)
    monkeypatch.setattr(pull_session, "_wait", cut_off)

    got = _run(pull_session._pull_once("A", str(tmp_path), "latest", 0, None, "0000"))
    assert len(got) == 1, "the partial data must still be saved"
    meta = json.load(open(got[0] + ".meta.json"))
    assert meta["bytes"] < meta["declared_size"], "the shortfall must be visible in the sidecar"
    assert os.path.getsize(got[0]) == meta["bytes"]


def test_an_empty_chunk_stops_the_transfer_rather_than_looping_forever(tmp_path, monkeypatch):
    """A zero-length FILE_DATA reply never advances the offset; without the guard this spins forever."""
    ring = FakeRing(["20260719010000"], b"", declared=5000)
    _install(monkeypatch, ring)
    got = _run(pull_session._pull_once("A", str(tmp_path), "latest", 0, None, "0000"))
    assert len(got) == 1 and os.path.getsize(got[0]) == 0


# ── device not found + the retry loop ───────────────────────────────────────────────────────────────
def test_a_ring_that_never_advertises_raises_device_not_found(tmp_path, monkeypatch):
    async def find(*a, **k):
        return None
    monkeypatch.setattr(pull_session.BleakScanner, "find_device_by_filter", find)
    with pytest.raises(pull_session.BleakDeviceNotFoundError):
        _run(pull_session._pull_once("A", str(tmp_path), "latest", 0, None, "0000"))


def test_pull_gives_up_immediately_when_not_waiting(tmp_path, monkeypatch):
    calls = {"n": 0}

    async def boom(*a, **k):
        calls["n"] += 1
        raise pull_session.BleakDeviceNotFoundError("A", "not advertising")
    monkeypatch.setattr(pull_session, "_pull_once", boom)
    assert _run(pull_session.pull("A", str(tmp_path), wait=0)) == []
    assert calls["n"] == 1, "wait=0 means one attempt, no retry"


def test_pull_retries_until_the_ring_appears(tmp_path, monkeypatch):
    calls = {"n": 0}

    async def flaky(*a, **k):
        calls["n"] += 1
        if calls["n"] < 3:
            raise pull_session.BleakDeviceNotFoundError("A", "not advertising")
        return ["/tmp/x.dat"]
    monkeypatch.setattr(pull_session, "_pull_once", flaky)

    async def no_sleep(_s):
        return None
    monkeypatch.setattr(pull_session.asyncio, "sleep", no_sleep)
    assert _run(pull_session.pull("A", str(tmp_path), wait=60)) == ["/tmp/x.dat"]
    assert calls["n"] == 3


def test_pull_creates_the_output_directory_even_if_the_ring_never_appears(tmp_path, monkeypatch):
    async def boom(*a, **k):
        raise pull_session.BleakDeviceNotFoundError("A", "nope")
    monkeypatch.setattr(pull_session, "_pull_once", boom)
    out = tmp_path / "captures" / "stored"
    _run(pull_session.pull("A", str(out), wait=0))
    assert out.is_dir()


def test_pull_does_not_swallow_an_unexpected_error(tmp_path, monkeypatch):
    """Only 'not advertising' is a retryable condition. A protocol or filesystem failure must surface
    rather than be reported as 'the ring never appeared'."""
    async def boom(*a, **k):
        raise RuntimeError("decode failed")
    monkeypatch.setattr(pull_session, "_pull_once", boom)
    with pytest.raises(RuntimeError, match="decode failed"):
        _run(pull_session.pull("A", str(tmp_path), wait=0))


# ── progress callback ───────────────────────────────────────────────────────────────────────────────
def test_a_raising_progress_callback_does_not_break_the_transfer(tmp_path, monkeypatch):
    """The callback is a UI concern; a bad one must not cost the user their download."""
    blob = b"\x01\x03" + b"m" * 30000
    ring = FakeRing(["20260719010000"], blob, chunk=512)
    _install(monkeypatch, ring)

    def bad(*a, **k):
        raise ValueError("ui exploded")
    got = _run(pull_session._pull_once("A", str(tmp_path), "latest", 0, None, "0000", on_progress=bad))
    assert len(got) == 1 and os.path.getsize(got[0]) == len(blob)


def test_progress_reports_a_percentage_during_a_large_transfer(tmp_path, monkeypatch):
    seen = []
    blob = b"\x01\x03" + b"n" * 60000
    ring = FakeRing(["20260719010000"], blob, chunk=512)
    _install(monkeypatch, ring)
    _run(pull_session._pull_once("A", str(tmp_path), "latest", 0, None, "0000",
                                 on_progress=lambda *a: seen.append(a)))
    assert seen, "a 60 kB transfer must report progress at least once"


# ── metadata edge cases ─────────────────────────────────────────────────────────────────────────────
def test_a_tiny_file_reports_zero_samples_and_no_trailer(tmp_path, monkeypatch):
    ring = FakeRing(["20260719010000"], b"\x01\x03tiny")
    _install(monkeypatch, ring)
    got = _run(pull_session._pull_once("A", str(tmp_path), "latest", 0, None, "0000"))
    meta = json.load(open(got[0] + ".meta.json"))
    assert meta["approx_samples"] == 0, "too short to contain samples — must not report a fabricated count"
    assert meta["trailer"] == ""


def test_format_a_is_false_without_the_marker(tmp_path, monkeypatch):
    ring = FakeRing(["20260719010000"], b"\xff\xffnot-format-a" + b"k" * 80)
    _install(monkeypatch, ring)
    got = _run(pull_session._pull_once("A", str(tmp_path), "latest", 0, None, "0000"))
    assert json.load(open(got[0] + ".meta.json"))["format_a"] is False


def test_pull_skips_a_session_already_on_disk_at_the_same_size(tmp_path, monkeypatch):
    """Idempotency: `which='all'` re-lists every onboard session, so without a skip an auto-pull would
    re-download the whole flash every cycle over a slow BLE link. A .dat already on disk at the device-
    reported size is the same recording → skip, and it must NOT count as a 'new' file."""
    blob = b"\x01\x03" + b"z" * 90
    ts = "20260719010000"
    _install(monkeypatch, FakeRing([ts], blob))
    got1 = _run(pull_session._pull_once("A", str(tmp_path), "latest", 0, None, "0000"))
    assert len(got1) == 1 and os.path.exists(tmp_path / f"Wellue_O2Ring-S_{ts}_STORED.dat")
    # same session, same dir, a fresh ring → skipped (already on disk at the same size)
    _install(monkeypatch, FakeRing([ts], blob))
    got2 = _run(pull_session._pull_once("A", str(tmp_path), "latest", 0, None, "0000"))
    assert got2 == [], "a session already on disk at the same size must be skipped, not re-downloaded"


def test_pull_rejects_a_path_traversal_which(tmp_path, monkeypatch):
    """`which=<specific>` is a user/API-controlled value that bypasses parse_file_list's stamp filter and
    goes straight into a filesystem path (py/path-injection). A traversal value must be skipped, never
    opened — nothing written outside out_dir."""
    import os
    _install(monkeypatch, FakeRing(["20260719010000"], b"\x01\x03" + b"z" * 90))
    got = _run(pull_session._pull_once("A", str(tmp_path), "../../etc/evil", 0, None, "0000"))
    assert got == [], "a traversal `which` must be skipped, not turned into a path"
    assert not os.path.exists("/etc/evil")
