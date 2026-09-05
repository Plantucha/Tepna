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

import oxy_inventory as inv
import oxy_lifecycle
import oxyii
import pull_session


def _run(coro):
    return asyncio.run(coro)


# The FakeRing answers the 0xE1 identity read with serial "O2R-TEST-1" (see write_gatt_char), so a
# ledger row for a pulled session keys on this device id. The transactional tests seed rows under it.
DEV = "O2R-TEST-1"


def _ledger_state(tmp_path, ts, device_id=DEV):
    """The current ledger state for one recording, or None — reads the same inventory.jsonl _pull_once
    writes beside the night files."""
    rows = inv.load_rows(str(tmp_path / "inventory.jsonl"))
    cur = inv.current(rows).get(inv.identity(device_id, ts))
    return cur["state"] if cur else None


def _seed(tmp_path, *rows):
    """Append pre-existing ledger rows, as a prior (possibly crashed) run would have left them."""
    led = str(tmp_path / "inventory.jsonl")
    for r in rows:
        inv.append_row(led, r)


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

    def __init__(self, sessions, blob=b"", declared=None, chunk=512, split_frames=False,
                 declared_seq=None):
        self.sessions = sessions
        self.blob = blob
        self.declared = len(blob) if declared is None else declared
        # Per-session declared sizes, consumed in target order — needed to put a BAD session in front of
        # a good one, which is the only way to tell "skip this session" apart from "abandon the pull".
        self.declared_seq = list(declared_seq) if declared_seq else None
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

    async def start_notify(self, char, cb):
        # The characteristic is part of the contract, not decoration: subscribing on the wrong one
        # yields a link that connects and then never delivers a single frame.
        assert char == oxyii.OXYII_NOTIFY, "notifications must be subscribed on the OxyII notify char"
        self.notify = cb

    # `response` deliberately defaults to None, NOT False — so omitting the kwarg entirely trips the
    # assert instead of silently inheriting the value the code is supposed to be passing.
    async def write_gatt_char(self, char, frame, response=None):
        assert char == oxyii.OXYII_WRITE, "file ops must be written to the OxyII write characteristic"
        assert response is False, "this device requires write-without-response, stated explicitly"
        self.writes.append(frame)
        op = frame[1]
        # The ring answers its identity read. Without this every test paid the 6 s identity timeout —
        # measured: this file went from 0.24 s to 4 MINUTES, which would have shipped into CI as a
        # silent slowdown. A fake that declines to answer a command the real device answers is not a
        # neutral omission; it makes the happy path untested AND expensive.
        if op == oxyii.OP_GET_INFO and getattr(self, 'answer_info', True):
            fw = b"2D010003"
            sn = b"O2R-TEST-1"
            payload = (b"\x00" * 9) + fw + (b"\x00" * 20) + bytes([len(sn)]) + sn
            self._reply(oxyii.OP_GET_INFO, payload + b"\x00" * max(0, 48 - len(payload)))
        if op == oxyii.OP_FILE_LIST:
            slots = b"".join(s.encode() + b"\x00\x00" for s in self.sessions)
            self._reply(oxyii.OP_FILE_LIST, bytes([len(self.sessions)]) + slots)
        elif op == oxyii.OP_FILE_START:
            self.off = 0                                  # each session streams from its own start
            if self.declared_seq:
                self.declared = self.declared_seq.pop(0)
            # The size is the FIRST FOUR bytes; the meta bytes that follow are NOT zero on real
            # hardware. Keeping them nonzero is what makes an off-by-one read width (meta[:5]) decode a
            # wildly wrong size rather than coincidentally the same number.
            self._reply(oxyii.OP_FILE_START, self.declared.to_bytes(4, "little") + b"\xab\xcd\xef\x12")
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


class FakeAdv:
    """The AdvertisementData half of the scan callback — the code reads .local_name off it."""

    def __init__(self, local_name=None):
        self.local_name = local_name


def _install(monkeypatch, ring, device=None, adv=None, capture=None):
    """Install the fake BLE stack.

    The scanner APPLIES the real match predicate instead of ignoring it, and that is the whole point.
    A `find(*a, **k)` that just hands the device back never runs the lambda that decides WHICH radio
    peer we connect to — so every mutation of it is invisible, however green the suite is. Applying it
    puts that decision under every test in this file.
    """
    device = device or FakeDevice()
    adv = adv if adv is not None else FakeAdv(device.name)

    async def find(predicate, *a, **k):
        if capture is not None:
            capture["predicate"], capture["scan_kwargs"] = predicate, k
        return device if predicate(device, adv) else None

    monkeypatch.setattr(pull_session.BleakScanner, "find_device_by_filter", find)

    def client(dev, **kw):
        if capture is not None:
            capture["device"] = dev
        return ring
    monkeypatch.setattr(pull_session, "BleakClient", client)

    async def no_sleep(_s):
        return None
    monkeypatch.setattr(pull_session.asyncio, "sleep", no_sleep)


def _predicate(monkeypatch, tmp_path, address="D1:98:62:7C:92:B3"):
    """Return the real device-match lambda `_pull_once` builds, for direct interrogation."""
    cap = {}
    _install(monkeypatch, FakeRing([], b""), capture=cap)
    _run(pull_session._pull_once(address, str(tmp_path), "latest", 0, None, "0000"))
    return cap["predicate"]


def _dat(tmp_path):
    return [f for f in os.listdir(tmp_path) if f.endswith(".dat")]


# ── the happy path ──────────────────────────────────────────────────────────────────────────────────
def test_a_complete_download_writes_the_dat_and_its_sidecar(tmp_path, monkeypatch):
    blob = b"\x01\x03" + bytes(range(256)) * 8      # format_a marker + body
    ring = FakeRing(["20260719010000"], blob)
    _install(monkeypatch, ring)
    got = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000"))

    assert len(got) == 1 and got[0].endswith("Wellue_O2Ring-S_20260719010000_STORED.dat")
    assert open(got[0], "rb").read() == blob, "bytes must round-trip exactly"
    meta = json.load(open(got[0] + ".meta.json"))
    assert meta["session"] == "20260719010000"
    assert meta["bytes"] == len(blob) == meta["declared_size"], "a complete pull matches its declaration"
    assert meta["format_a"] is True
    assert meta["approx_samples"] == (len(blob) - 10 - 48) // 3
    assert len(meta["trailer"]) == 96, "48 trailer bytes as hex"
    # This synthetic blob has no finalisation sub-magic, so the device summary must be absent — not a
    # half-parsed dict. A caller re-pulls in a later cycle rather than trusting an unfinalised file.
    assert meta["finalized"] is False and meta["device_summary"] is None


def test_a_finalized_recording_carries_the_devices_own_session_summary(tmp_path, monkeypatch):
    """The trailer harvested from nglessner/o2ring-s-protocol: a finalised Format-A file ends with the
    ring's OWN avg/min SpO2 + desat stats. The puller surfaces them so OxyDex can be cross-checked
    against the device's summary, and so `finalized` gates re-pulls."""
    hdr = bytes([0x01, 0x03, 0, 0, 0, 0, 0, 0, 0x04, 0x00])
    body = bytes([96, 50, 0]) * 300
    t = bytearray(48)
    t[4:8] = bytes([0x48, 0x12, 0x5A, 0xDA])       # finalisation sub-magic
    t[12], t[13] = 300 & 0xFF, 300 >> 8            # total seconds
    t[34], t[35], t[47] = 96, 81, 49               # avg spo2, min spo2, avg hr
    t[42] = 94                                     # O2 score x10
    blob = hdr + body + bytes(t)
    ring = FakeRing(["20260720020000"], blob)
    _install(monkeypatch, ring)
    got = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000"))
    meta = json.load(open(got[0] + ".meta.json"))
    assert meta["finalized"] is True
    ds = meta["device_summary"]
    assert ds["total_seconds"] == 300 and ds["min_spo2"] == 81 and ds["avg_hr"] == 49
    assert ds["o2_score_x10"] == 94
    # EXECUTION-WITNESS (ACQ-EVIDENCE-CONTRACT §18): the REAL pull path — not a helper — produced the
    # Acquisition Evidence envelope beside the artifact, with the facts assembled from the landed pull.
    acq = meta["acquisition_evidence"]
    assert acq["schema"] == "ganglior.acquisition-evidence" and acq["source"] == "stored_dat"
    assert acq["sample_count"] == 300 and acq["expected_sample_count"] == 300  # (958-58)/3 == total_seconds
    assert acq["validation"] == "VALID" and acq["completeness"] == "COMPLETE"   # VERIFIED classify + finalised
    assert acq["duration_check"]["stored_s"] == 300 and acq["duration_check"]["observed_s"] is None
    assert acq["session_id"] == "20260720020000"


def test_the_transfer_survives_frames_split_across_notifications(tmp_path, monkeypatch):
    """BLE delivers whatever fits the MTU; a reply can straddle two notifications. The real Reassembler
    is in this path, so splitting every frame must change nothing."""
    blob = b"\x01\x03" + bytes(range(200)) * 3
    ring = FakeRing(["20260719010000"], blob, split_frames=True)
    _install(monkeypatch, ring)
    got = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000"))
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
    _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, "hci1", "0000"))
    assert seen["client"] == {"bluez": {"adapter": "hci1"}}
    assert seen["scan"] == {"timeout": 25, "bluez": {"adapter": "hci1"}}, (
        "the adapter pin must reach the SCAN too — scanning on the default radio and then connecting on "
        "hci1 finds a device the pinned adapter may not see. 25 s is measured, not arbitrary: FILE_LIST "
        "alone answers in ~4 s and the old 6 s window left no margin.")


# ── session selection ───────────────────────────────────────────────────────────────────────────────
def test_latest_picks_the_chronologically_newest_not_the_last_listed(tmp_path, monkeypatch):
    """`latest` is max() over YYYYMMDDhhmmss stamps, so a device listing them out of order still yields
    the newest night — sessions[-1] would grab whatever happened to be last."""
    ring = FakeRing(["20260719230000", "20260720010000", "20260718120000"], b"\x01\x03" + b"z" * 90)
    _install(monkeypatch, ring)
    got = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000"))
    assert got[0].endswith("20260720010000_STORED.dat")


def test_all_pulls_every_session(tmp_path, monkeypatch):
    ring = FakeRing(["20260719010000", "20260720010000"], b"\x01\x03" + b"y" * 90)
    _install(monkeypatch, ring)
    got = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "all", 0, None, "0000"))
    assert len(got) == 2 and len(_dat(tmp_path)) == 2


def test_no_sessions_returns_empty_and_still_disconnects(tmp_path, monkeypatch):
    ring = FakeRing([], b"")
    _install(monkeypatch, ring)
    assert _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000")) == []
    assert _dat(tmp_path) == []
    assert ring.ended is True, "the early return must still leave the BLE link closed"


# ── the failure branches that still produce a file ──────────────────────────────────────────────────
@pytest.mark.parametrize("declared", [0, 50_000_000, 60_000_000])
def test_an_implausible_declared_size_skips_the_session_without_writing(tmp_path, monkeypatch, declared):
    """A wrong --ftype makes the ring report nonsense. Writing a .dat here would produce a file the user
    believes is a night; skipping is correct, and it must leave NOTHING behind."""
    ring = FakeRing(["20260719010000"], b"\x01\x03" + b"q" * 100, declared=declared)
    _install(monkeypatch, ring)
    got = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000"))
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
    got = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000"))
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

    got = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000"))
    assert len(got) == 1, "the partial data must still be saved"
    meta = json.load(open(got[0] + ".meta.json"))
    assert meta["bytes"] < meta["declared_size"], "the shortfall must be visible in the sidecar"
    assert os.path.getsize(got[0]) == meta["bytes"]


def test_an_empty_chunk_stops_the_transfer_rather_than_looping_forever(tmp_path, monkeypatch):
    """A zero-length FILE_DATA reply never advances the offset; without the guard this spins forever."""
    ring = FakeRing(["20260719010000"], b"", declared=5000)
    _install(monkeypatch, ring)
    got = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000"))
    assert len(got) == 1 and os.path.getsize(got[0]) == 0


# ── device not found + the retry loop ───────────────────────────────────────────────────────────────
def test_a_ring_that_never_advertises_raises_device_not_found(tmp_path, monkeypatch):
    async def find(*a, **k):
        return None
    monkeypatch.setattr(pull_session.BleakScanner, "find_device_by_filter", find)
    with pytest.raises(pull_session.BleakDeviceNotFoundError):
        _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000"))


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
    got = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000", on_progress=bad))
    assert len(got) == 1 and os.path.getsize(got[0]) == len(blob)


def test_progress_reports_a_percentage_during_a_large_transfer(tmp_path, monkeypatch):
    seen = []
    blob = b"\x01\x03" + b"n" * 60000
    ring = FakeRing(["20260719010000"], blob, chunk=512)
    _install(monkeypatch, ring)
    _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000",
                                 on_progress=lambda *a: seen.append(a)))
    assert seen, "a 60 kB transfer must report progress at least once"


# ── metadata edge cases ─────────────────────────────────────────────────────────────────────────────
def test_a_tiny_file_reports_zero_samples_and_no_trailer(tmp_path, monkeypatch):
    ring = FakeRing(["20260719010000"], b"\x01\x03tiny")
    _install(monkeypatch, ring)
    got = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000"))
    meta = json.load(open(got[0] + ".meta.json"))
    assert meta["approx_samples"] == 0, "too short to contain samples — must not report a fabricated count"
    assert meta["trailer"] == ""


def test_format_a_is_false_without_the_marker(tmp_path, monkeypatch):
    ring = FakeRing(["20260719010000"], b"\xff\xffnot-format-a" + b"k" * 80)
    _install(monkeypatch, ring)
    got = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000"))
    assert json.load(open(got[0] + ".meta.json"))["format_a"] is False


def test_pull_skips_a_session_already_on_disk_at_the_same_size(tmp_path, monkeypatch):
    """Idempotency: `which='all'` re-lists every onboard session, so without a skip an auto-pull would
    re-download the whole flash every cycle over a slow BLE link. A .dat already on disk at the device-
    reported size is the same recording → skip, and it must NOT count as a 'new' file."""
    blob = b"\x01\x03" + b"z" * 90
    ts = "20260719010000"
    _install(monkeypatch, FakeRing([ts], blob))
    got1 = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000"))
    assert len(got1) == 1 and os.path.exists(tmp_path / f"Wellue_O2Ring-S_{ts}_STORED.dat")
    # same session, same dir, a fresh ring → skipped (already on disk at the same size)
    _install(monkeypatch, FakeRing([ts], blob))
    got2 = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000"))
    assert got2 == [], "a session already on disk at the same size must be skipped, not re-downloaded"


def test_pull_rejects_a_which_that_escapes_the_output_dir(tmp_path, monkeypatch):
    """`which=<specific>` is a user/API-controlled value (the LAN webmon /api/pull body) that bypasses
    parse_file_list's stamp filter and goes straight into a filesystem path (py/path-injection). A value
    whose resolved path escapes out_dir hits the CONTAINMENT guard and is skipped — never opened."""
    import os
    _install(monkeypatch, FakeRing(["20260719010000"], b"\x01\x03" + b"z" * 90))
    # enough `..` to resolve ABOVE out_dir whatever its depth — the containment guard must reject it
    got = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "../" * 40 + "evil", 0, None, "0000"))
    assert got == [], "a which whose path escapes out_dir must be skipped, not turned into a path"
    assert not os.path.exists("/evil_STORED.dat")


def test_pull_skips_a_contained_but_nonstamp_which(tmp_path, monkeypatch):
    """A `which` that stays inside out_dir but is not a YYYYMMDDhhmmss stamp (e.g. 'notadate') passes the
    containment guard, then is rejected by the stamp-shape check — never sent to the device."""
    _install(monkeypatch, FakeRing(["20260719010000"], b"\x01\x03" + b"z" * 90))
    got = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "notadate", 0, None, "0000"))
    assert got == [], "a non-stamp `which` must be skipped"


# ── the device-match predicate ──────────────────────────────────────────────────────────────────────
# This lambda decides WHICH radio peer the pull connects to. Until the fake scanner started applying it
# (see _install), nothing in this file ran it at all: every mutation of it survived a 100 %-covered
# suite. Since 2026-09-05 it is ADDRESS-ONLY (`oxy_presence.is_expected_ring`, standing ruling
# 2026-08-27): the name arm it carried — "a MAC can rotate" — let any beacon in range summon a connect.
def test_the_scan_matches_the_ring_by_address(tmp_path, monkeypatch):
    match = _predicate(monkeypatch, tmp_path, address="D1:98:62:7C:92:B3")
    # advertises nothing recognisable, but it is the exact MAC we asked for
    assert match(FakeDevice("D1:98:62:7C:92:B3", "BLE-4C21"), FakeAdv(None)) is True


def test_the_scan_refuses_a_ring_named_device_at_another_address(tmp_path, monkeypatch):
    """The name is attacker-controlled. A stranger's device (or a stranger's ring) broadcasting
    'O2Ring S8AW' from an address we did not pair with must NOT be connected to — that is the whole of
    the address-only ruling, and this is the arm the old `or` used to accept."""
    match = _predicate(monkeypatch, tmp_path, address="D1:98:62:7C:92:B3")
    assert match(FakeDevice("FF:FF:FF:FF:FF:FF", "junk"), FakeAdv("O2Ring S8AW")) is False
    assert match(FakeDevice("11:22:33:44:55:66", "O2Ring S8AW"), FakeAdv(None)) is False
    assert match(FakeDevice("11:22:33:44:55:66", "junk"), FakeAdv("O2RING S8AW")) is False


def test_the_scan_is_case_insensitive_on_both_sides_of_the_mac(tmp_path, monkeypatch):
    """A MAC typed in lowercase on the command line must match the uppercase one BlueZ reports — which
    is why both sides are upper()ed, not just one."""
    match = _predicate(monkeypatch, tmp_path, address="d1:98:62:7c:92:b3")
    assert match(FakeDevice("D1:98:62:7C:92:B3", "junk"), FakeAdv(None)) is True


def test_the_scan_never_reads_the_name_at_all(tmp_path, monkeypatch):
    """A device with neither an advertised nor a cached name must be a clean address decision — and
    the predicate must not touch `.local_name`/`.name`, so an advert object without them cannot abort
    the scan with an AttributeError."""
    match = _predicate(monkeypatch, tmp_path, address="D1:98:62:7C:92:B3")
    assert match(FakeDevice("D1:98:62:7C:92:B3", None), object()) is True
    assert match(FakeDevice("11:22:33:44:55:66", None), object()) is False


def test_the_scan_ignores_an_unrelated_device(tmp_path, monkeypatch):
    """The predicate must be a filter, not a rubber stamp: connecting to the first peer that answers is
    how a pull ends up talking to somebody's earbuds."""
    match = _predicate(monkeypatch, tmp_path, address="D1:98:62:7C:92:B3")
    assert match(FakeDevice("11:22:33:44:55:66", "Galaxy Buds"), FakeAdv("Galaxy Buds")) is False


def test_the_connection_targets_the_device_the_scan_found(tmp_path, monkeypatch):
    cap = {}
    device = FakeDevice("D1:98:62:7C:92:B3", "O2Ring S8AW")
    _install(monkeypatch, FakeRing(["20260719010000"], b"\x01\x03" + b"z" * 90),
             device=device, capture=cap)
    _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000"))
    assert cap["device"] is device, "connect to the peer the scan matched, not to some other handle"


def test_the_real_mtu_is_acquired_before_it_is_reported(tmp_path, monkeypatch):
    """On BlueZ, bleak reports a PLACEHOLDER mtu_size of 23 until a characteristic has been acquired.
    Printing that straight after connect once cost a long misdiagnosis (a phantom 'needs MTU >= 517'
    fault; the real negotiated value is 247). The acquire is best-effort, but it must be ATTEMPTED."""
    ring = FakeRing(["20260719010000"], b"\x01\x03" + b"z" * 90)
    acquired = []

    class Backend:
        async def _acquire_mtu(self):
            acquired.append(True)
            ring.mtu_size = 247

    ring._backend = Backend()
    ring.mtu_size = 23
    _install(monkeypatch, ring)
    _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000"))
    assert acquired == [True], "the placeholder MTU must be refreshed before it is reported"


# ── one bad session must not end the pull ───────────────────────────────────────────────────────────
def test_one_implausible_session_does_not_abandon_the_rest_of_the_flash(tmp_path, monkeypatch):
    """`which='all'` walks every onboard session, so a single unusable entry must be SKIPPED rather than
    treated as the end of the flash. Breaking out instead hides every night behind the bad one, and it
    fails silently — the caller gets a shorter list, not an error."""
    blob = b"\x01\x03" + b"z" * 90
    ring = FakeRing(["20260719010000", "20260720010000"], blob,
                    declared_seq=[0, len(blob)])          # the FIRST session reports a nonsense size
    _install(monkeypatch, ring)
    got = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "all", 0, None, "0000"))
    assert len(got) == 1 and got[0].endswith("20260720010000_STORED.dat"), \
        "the good session behind the bad one must still be pulled"


def test_a_session_already_on_disk_does_not_abandon_the_rest_of_the_flash(tmp_path, monkeypatch):
    """The same hazard on the idempotency path, and the likelier one in production: the auto-pull re-lists
    the whole flash every cycle, so the FIRST session is nearly always already on disk. Stopping there
    would mean a new night is never collected at all."""
    blob = b"\x01\x03" + b"z" * 90
    first, second = "20260719010000", "20260720010000"
    _install(monkeypatch, FakeRing([first], blob))
    assert len(_run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "all", 0, None, "0000"))) == 1
    _install(monkeypatch, FakeRing([first, second], blob))
    got = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "all", 0, None, "0000"))
    assert len(got) == 1 and got[0].endswith(f"{second}_STORED.dat"), \
        "the already-present session is skipped, and the genuinely new one is still pulled"


# ── the stamp-shape guard's boundaries ──────────────────────────────────────────────────────────────
def test_a_date_only_session_id_is_still_a_plausible_stamp(tmp_path, monkeypatch):
    """8 is the LOW boundary of `8 <= len(ts) <= 14` — a date-only id. It must be accepted; whether such
    a session exists is the device's answer to give, not this guard's."""
    blob = b"\x01\x03" + b"z" * 90
    _install(monkeypatch, FakeRing(["20260719010000"], blob))
    got = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "20260719", 0, None, "0000"))
    assert len(got) == 1 and got[0].endswith("20260719_STORED.dat")


def test_an_over_long_session_id_is_rejected(tmp_path, monkeypatch):
    """14 is the HIGH boundary — a full YYYYMMDDhhmmss stamp. Fifteen digits is not a stamp, and this
    value reaches a filesystem path, so the guard must not stretch to fit it."""
    _install(monkeypatch, FakeRing(["20260719010000"], b"\x01\x03" + b"z" * 90))
    got = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "202607190100001", 0, None, "0000"))
    assert got == [] and _dat(tmp_path) == []


def test_a_single_byte_session_is_still_pulled(tmp_path, monkeypatch):
    """Boundary: the size guard is `0 < size`, so one byte is the smallest thing the ring can legitimately
    report. Rejecting it would silently discard the shortest recordings as 'implausible'."""
    _install(monkeypatch, FakeRing(["20260719010000"], b"\x7f", declared=1, chunk=1))
    got = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000"))
    assert len(got) == 1 and os.path.getsize(got[0]) == 1


# ── the sidecar's numbers ───────────────────────────────────────────────────────────────────────────
def test_the_sidecar_reports_whole_samples_and_a_fixed_width_header(tmp_path, monkeypatch):
    """approx_samples is a COUNT: a `/` where `//` belongs puts `1234.0` into the sidecar and every
    consumer of it. The header is a fixed 10-byte prefix, so its hex is exactly 20 characters."""
    blob = b"\x01\x03" + b"s" * 200
    _install(monkeypatch, FakeRing(["20260719010000"], blob))
    got = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000"))
    meta = json.load(open(got[0] + ".meta.json"))
    assert isinstance(meta["approx_samples"], int), "a sample count must not be a float"
    assert meta["approx_samples"] == (len(blob) - 10 - 48) // 3
    assert meta["header"] == blob[:10].hex() and len(meta["header"]) == 20


def test_exactly_forty_eight_bytes_still_yields_a_trailer(tmp_path, monkeypatch):
    """Boundary: the trailer is kept when `len(data) >= 48`. At exactly 48 the whole file IS the trailer,
    and one request covered it — asking for a chunk past the declared size costs a BLE round trip on a
    link slow enough that the round trips are the cost."""
    blob = bytes(range(48))
    ring = FakeRing(["20260719010000"], blob, chunk=48)
    _install(monkeypatch, ring)
    got = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000"))
    meta = json.load(open(got[0] + ".meta.json"))
    assert meta["trailer"] == blob.hex() and len(meta["trailer"]) == 96
    assert len([w for w in ring.writes if w[1] == oxyii.OP_FILE_DATA]) == 1


def test_progress_reports_once_per_20_kb_with_the_offset_and_the_total(tmp_path, monkeypatch):
    """The cadence is `off % (512*40) < len(chunk)` — one report per 20 480 B. Not one per chunk (118 UI
    updates for this transfer) and not none. The callback's ARGUMENTS are the whole payload: bytes so
    far, then the total expected — swapped or blanked, a progress bar reads as finished or stuck."""
    seen = []
    blob = b"\x01\x03" + b"n" * 60000                     # 60 002 B in 512 B chunks
    _install(monkeypatch, FakeRing(["20260719010000"], blob, chunk=512))
    _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000",
                                 on_progress=lambda off, size: seen.append((off, size))))
    assert seen == [(20480, len(blob)), (40960, len(blob))]


# ── pull(): the retry wrapper's wiring ──────────────────────────────────────────────────────────────
# Every test above calls _pull_once directly, and the three that exercise pull() stub _pull_once with a
# lambda that ignores its arguments — so pull()'s job, which is to pass seven values through in the
# right order, was entirely unasserted. It could have handed out_dir as the address.
def test_pull_hands_every_argument_to_the_attempt_in_order(tmp_path, monkeypatch):
    seen = {}

    def cb(off, size):
        pass

    async def record(*a, **k):
        seen["args"], seen["kwargs"] = a, k
        return []
    monkeypatch.setattr(pull_session, "_pull_once", record)
    _run(pull_session.pull("D1:98:62:7C:92:B3", str(tmp_path), "20260719010000", 3, "hci1", "1234",
                           0, on_progress=cb))
    assert seen["args"] == ("D1:98:62:7C:92:B3", str(tmp_path), "20260719010000", 3, "hci1", "1234", cb)
    # `device_id` rides as a keyword, None when the caller has no identity to offer (the CLI) — the
    # ledger then keys on the address, never on the auth serial (test_pull_identity_key).
    assert seen["kwargs"] == {"device_id": None}
    _run(pull_session.pull("D1:98:62:7C:92:B3", str(tmp_path), device_id="2592302100"))
    assert seen["kwargs"] == {"device_id": "2592302100"}


def test_pull_defaults_are_the_ones_the_cli_documents(tmp_path, monkeypatch):
    """These defaults ARE the behaviour for every caller that omits them — the webmon auto-pull included.
    `wait=0` in particular is what makes an unattended poll one attempt rather than a retry loop."""
    seen = {}
    calls = {"n": 0}

    async def record(*a, **k):
        calls["n"] += 1
        seen["args"] = a
        raise pull_session.BleakDeviceNotFoundError("A", "not advertising")
    monkeypatch.setattr(pull_session, "_pull_once", record)
    assert _run(pull_session.pull("D1:98:62:7C:92:B3", str(tmp_path))) == []
    assert seen["args"][2:] == ("latest", 0, None, "0000", None)
    assert calls["n"] == 1, "wait defaults to 0 — one attempt, no retry"


# ── the --ftype argument must actually reach the wire ───────────────────────────────────────────────
def test_ftype_reaches_the_file_start_frame(tmp_path, monkeypatch):
    """`_pull_once(..., ftype, ...)` builds the FILE_START frame with `oxyii.file_start_frame(ts, ftype)`,
    and that parameter DEFAULTS to 0. Every other test in this file pulls with ftype=0, so dropping the
    argument entirely is invisible to all of them — the frame comes out byte-identical. It is not
    The verifiable consequence is a DEAD CONFIG KNOB: capture.py reads `ftype` from config.yaml
    (`int(pcfg.get("ftype", 0))`) and threads it down to this frame, so dropping the argument pins the
    wire value to 0 no matter what the operator configured — the setting silently stops working. What
    a non-zero ftype actually returns is the device's business and is NOT asserted here: the vigil box
    runs `ftype: 0` and all 15 stored pulls used it, so there is no observation on hand, and the
    "selects a different file type" reading comes only from the flag's help text and the
    "try a different --ftype" error message.

    Asserting on the encoded payload rather than on a spy: the four little-endian bytes after the
    14-char stamp + 2 pad ARE the wire contract (oxyii.file_start_frame)."""
    ring = FakeRing(["20260720010000"], b"\x01\x03" + b"z" * 90)
    _install(monkeypatch, ring)
    _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "all", 7, None, "0000"))

    starts = [w for w in ring.writes if w[1] == oxyii.OP_FILE_START]
    assert starts, "the pull must have sent a FILE_START"
    payload = starts[0][7:-1]                       # oxyii.encode: 7-byte header, payload, 1 CRC byte
    assert payload[:14] == b"20260720010000", "stamp must lead the payload"
    assert int.from_bytes(payload[16:20], "little") == 7, \
        "the requested --ftype must reach the device; a dropped argument silently defaults it to 0"


def test_a_too_small_mtu_warns_loudly_instead_of_failing_silently(tmp_path, monkeypatch, capsys):
    """Upstream's silent-drop failure: at a too-small ATT MTU, cmd=0xF2 returns zero bytes with no
    error. If _acquire_mtu can't raise the placeholder 23, we must SAY so — a mystery 0xF2 timeout is
    the exact misdiagnosis this warning prevents. It warns, never blocks (BlueZ may still complete)."""
    ring = FakeRing(["20260719010000"], b"\x01\x03" + b"z" * 90)

    class Backend:
        async def _acquire_mtu(self):
            raise RuntimeError("cannot acquire")     # leaves the placeholder 23 in place

    ring._backend = Backend()
    ring.mtu_size = 23
    _install(monkeypatch, ring)
    _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000"))
    out = capsys.readouterr().out
    assert "MTU is 23" in out and "may fail silently" in out


def test_a_healthy_mtu_does_not_warn(tmp_path, monkeypatch, capsys):
    """The negative arm: a normal 517/247 link must NOT print the warning (it would cry wolf on every
    good pull). FakeRing defaults to mtu_size=517."""
    ring = FakeRing(["20260719010000"], b"\x01\x03" + b"z" * 90)
    _install(monkeypatch, ring)
    _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000"))
    assert "may fail silently" not in capsys.readouterr().out


def _pull_one(tmp_path, monkeypatch, answer_info=True):
    """One complete pull against the fake ring → its `.meta.json`. `answer_info=False` models a device
    that ignores the 0xE1 identity read."""
    hdr = bytes([0x01, 0x03, 0, 0, 0, 0, 0, 0, 0x04, 0x00])
    blob = hdr + bytes([96, 50, 0]) * 60 + bytes(48)
    ring = FakeRing(["20260720020000"], blob)
    ring.answer_info = answer_info
    _install(monkeypatch, ring)
    got = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000"))
    return json.load(open(got[0] + ".meta.json"))

def test_the_pull_records_WHICH_FIRMWARE_produced_the_bytes(tmp_path, monkeypatch):
    """⚠️ `parse_get_info` said this mattered and was called by nothing.

    Its docstring: *"this device's behaviour is firmware-dependent (the F2 MTU gate differs between
    2D010001/2/3), so a capture should record which firmware produced it."* Nothing in the tree recorded
    the ring's firmware — the only firmware handling anywhere was Polar-side. A capture whose
    interpretation depends on firmware, and which does not say which firmware, cannot be re-read later
    with that knowledge."""
    meta = _pull_one(tmp_path, monkeypatch)
    assert meta["device_firmware"] == "2D010003", meta
    assert meta["device_serial"] == "O2R-TEST-1", meta


def test_a_ring_that_does_not_answer_0xE1_still_completes_the_pull(tmp_path, monkeypatch):
    """⚠️ THE IDENTITY READ MUST NEVER BE ABLE TO FAIL A PULL. The recording on flash is the
    irreplaceable thing here; the firmware string is a nice-to-have. A device that ignores 0xE1 — an
    older firmware, a busy radio — must still yield its session, with `device_firmware: null`.

    `null`, not a guess: "not read" and "old firmware" are different facts, and only one of them is a
    reason to reinterpret the capture."""
    meta = _pull_one(tmp_path, monkeypatch, answer_info=False)
    assert meta["device_firmware"] is None and meta["device_serial"] is None, meta
    assert meta["bytes"] > 0, "the session itself must still land"


# ── the transactional pull layer (OxyII charter G1) ─────────────────────────────────────────────────
# _pull_once is now ledger-driven: it records every state transition beside the night files, and
# oxy_restart.plan() — reading that ledger against the disk — decides per session whether the bytes we
# already hold can be trusted. These tests drive the four plan actions through the real _pull_once.
def test_a_completed_download_records_the_full_ledger_lifecycle(tmp_path, monkeypatch):
    """The happy path writes the ledger too: DISCOVERED → DOWNLOADING → VERIFYING → (classified) →
    COMMITTED. VERIFYING is T3 (last byte received); the classified row is T4. A file
    with no finalisation trailer classifies PARTIAL, but a size-complete transfer is still committed to
    the final path — the COMMITTED row is what makes the NEXT run skip it."""
    ts = "20260719010000"
    blob = b"\x01\x03" + b"z" * 90
    _install(monkeypatch, FakeRing([ts], blob))
    got = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000"))
    assert len(got) == 1 and got[0].endswith(f"{ts}_STORED.dat")
    rows = inv.load_rows(str(tmp_path / "inventory.jsonl"))
    states = [r["state"] for r in rows if r["session"] == ts]
    assert states == [inv.DISCOVERED, inv.DOWNLOADING, inv.VERIFYING, inv.PARTIAL, inv.COMMITTED], states
    committed = inv.current(rows)[inv.identity(DEV, ts)]
    assert committed["sha256"] == inv.sha256_bytes(blob), "the committed row carries the content hash"
    assert committed["size"] == len(blob)


def test_a_finalized_download_classifies_VERIFIED_before_committing(tmp_path, monkeypatch):
    """A file that carries the Format-A finalisation sub-magic reaches VERIFIED (not merely PARTIAL) in
    the ledger before its COMMITTED row — the distinction the transactional layer exists to keep."""
    hdr = bytes([0x01, 0x03, 0, 0, 0, 0, 0, 0, 0x04, 0x00])
    t = bytearray(48)
    t[4:8] = bytes([0x48, 0x12, 0x5A, 0xDA])
    blob = hdr + bytes([96, 50, 0]) * 60 + bytes(t)
    ts = "20260720020000"
    _install(monkeypatch, FakeRing([ts], blob))
    _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000"))
    states = [r["state"] for r in inv.load_rows(str(tmp_path / "inventory.jsonl")) if r["session"] == ts]
    assert states == [inv.DISCOVERED, inv.DOWNLOADING, inv.VERIFYING, inv.VERIFIED, inv.COMMITTED], states


def test_a_committed_recording_is_skipped_by_the_ledger_not_by_size(tmp_path, monkeypatch):
    """INTACT: a prior COMMITTED row whose bytes still match the disk is the only do-nothing. The session
    is not re-listed to the device at all — no FILE_START goes out."""
    ts = "20260719010000"
    blob = b"\x01\x03" + b"z" * 90
    (tmp_path / f"Wellue_O2Ring-S_{ts}_STORED.dat").write_bytes(blob)
    _seed(tmp_path, inv.make_row(DEV, ts, inv.COMMITTED, size=len(blob), at=1.0))
    ring = FakeRing([ts], blob)
    _install(monkeypatch, ring)
    got = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000"))
    assert got == [], "a committed, size-matching recording must be skipped"
    assert [w for w in ring.writes if w[1] == oxyii.OP_FILE_START] == [], "INTACT must not re-pull"
    assert _ledger_state(tmp_path, ts) == inv.COMMITTED, "and its state must not regress"


def test_a_verified_but_never_committed_recording_is_committed_without_a_repull(tmp_path, monkeypatch):
    """COMMIT: the kill-window between the atomic rename and the ledger write. The bytes are already at
    the final path; recovery records the COMMITTED row rather than re-pulling over the slow link."""
    ts = "20260721030000"
    blob = b"\x01\x03" + b"z" * 90
    final = tmp_path / f"Wellue_O2Ring-S_{ts}_STORED.dat"
    final.write_bytes(blob)                          # the rename ran; the ledger write did not
    _seed(tmp_path,
          inv.make_row(DEV, ts, inv.DISCOVERED, at=1.0),
          inv.make_row(DEV, ts, inv.VERIFIED, size=len(blob), at=2.0))
    ring = FakeRing([ts], blob)
    _install(monkeypatch, ring)
    got = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000"))
    assert len(got) == 1 and got[0].endswith(f"{ts}_STORED.dat"), "the recovered recording is surfaced"
    assert [w for w in ring.writes if w[1] == oxyii.OP_FILE_START] == [], "COMMIT must not re-download"
    assert final.read_bytes() == blob, "the already-committed bytes are untouched"
    assert _ledger_state(tmp_path, ts) == inv.COMMITTED, "the COMMITTED row is now recorded"


def test_a_recording_whose_bytes_drifted_under_a_verified_row_is_quarantined(tmp_path, monkeypatch):
    """QUARANTINE: the file on disk changed size under a COMMITTED row. Re-pulling would destroy the
    evidence and trusting would launder it, so neither — it is skipped for a human, never overwritten."""
    ts = "20260722040000"
    blob = b"\x01\x03" + b"z" * 90                    # 92 bytes, what the ring would serve
    final = tmp_path / f"Wellue_O2Ring-S_{ts}_STORED.dat"
    final.write_bytes(b"x" * 50)                      # on disk at a DIFFERENT size than recorded
    _seed(tmp_path, inv.make_row(DEV, ts, inv.COMMITTED, size=92, at=1.0))
    ring = FakeRing([ts], blob)
    _install(monkeypatch, ring)
    got = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000"))
    assert got == [], "a drifted recording is neither trusted nor re-pulled"
    assert [w for w in ring.writes if w[1] == oxyii.OP_FILE_START] == [], "QUARANTINE must not re-pull"
    assert final.read_bytes() == b"x" * 50, "the drifted bytes are preserved as evidence"


def test_a_leftover_part_forces_a_repull_and_is_never_adopted(tmp_path, monkeypatch):
    """REPULL over debris: an unfinalised `.part` from an interrupted transfer plus a PARTIAL ledger row.
    plan() re-pulls — a `.part`'s size proves nothing — and the fresh, complete transfer commits."""
    ts = "20260723050000"
    blob = b"\x01\x03" + b"z" * 90
    (tmp_path / f"Wellue_O2Ring-S_{ts}_STORED.dat.part").write_bytes(b"z" * 40)   # a short leftover
    _seed(tmp_path, inv.make_row(DEV, ts, inv.PARTIAL, size=40, at=1.0))
    ring = FakeRing([ts], blob)
    _install(monkeypatch, ring)
    got = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000"))
    assert len(got) == 1 and got[0].endswith(f"{ts}_STORED.dat"), "the leftover .part is re-pulled"
    assert (tmp_path / f"Wellue_O2Ring-S_{ts}_STORED.dat").read_bytes() == blob
    assert [w for w in ring.writes if w[1] == oxyii.OP_FILE_START], "a re-pull DID send FILE_START"
    assert _ledger_state(tmp_path, ts) == inv.COMMITTED


def test_a_truncated_transfer_emits_NO_VERIFYING_row(tmp_path, monkeypatch):
    """T3 is "bytes complete on disk", so a SHORT pull must not emit it. The control that makes this
    test mean something is the pair: the completed-download test above asserts VERIFYING IS present in
    the same position, so a change that dropped the emit entirely would fail there rather than pass here.
    A VERIFYING row on a short transfer would assert the completeness the PARTIAL row then denies."""
    ts = "20260726070000"
    blob = b"\x01\x03" + b"q" * 4000
    ring = FakeRing([ts], blob, declared=len(blob), chunk=512)
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
    _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000"))
    states = [r["state"] for r in inv.load_rows(str(tmp_path / "inventory.jsonl")) if r["session"] == ts]
    assert inv.VERIFYING not in states, f"a short pull claimed bytes-complete: {states}"
    assert states == [inv.DISCOVERED, inv.DOWNLOADING, inv.PARTIAL], states


def test_a_truncated_transfer_is_recorded_PARTIAL_and_re_pulled_next_run(tmp_path, monkeypatch):
    """The .part discipline expressed through the ledger: a short pull keeps its `.part`, lands a PARTIAL
    row (not COMMITTED), and the NEXT run re-downloads it to completion."""
    ts = "20260724060000"
    blob = b"\x01\x03" + b"p" * 4000
    ring = FakeRing([ts], blob, declared=len(blob), chunk=512)
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
    got = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000"))
    assert got[0].endswith(".part"), "an incomplete pull is surfaced under its .part name"
    assert _ledger_state(tmp_path, ts) == inv.PARTIAL, "and recorded PARTIAL, never COMMITTED"

    # next run, full transfer available → the .part is re-pulled and committed
    monkeypatch.setattr(pull_session, "_wait", real_wait)
    _install(monkeypatch, FakeRing([ts], blob, chunk=512))
    got2 = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000"))
    assert got2[0].endswith(f"{ts}_STORED.dat") and not got2[0].endswith(".part")
    assert _ledger_state(tmp_path, ts) == inv.COMMITTED


def test_the_pull_emits_the_PULLING_lifecycle_state(tmp_path, monkeypatch):
    """G4: the pull path is the only emitter of OxyState.PULLING. An injected lifecycle is driven
    NOT_SEEN → PAUSED_FOR_PULL → PULLING around the transfer and back to PAUSED_FOR_PULL afterward —
    every edge legal, never forced."""
    lc = oxy_lifecycle.OxyLifecycle()
    _install(monkeypatch, FakeRing(["20260719010000"], b"\x01\x03" + b"z" * 90))
    _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000", lifecycle=lc))
    seq = [t.new for t in lc.history]
    assert oxy_lifecycle.OxyState.PULLING in seq, "the pull must emit PULLING"
    assert seq[:2] == [oxy_lifecycle.OxyState.PAUSED_FOR_PULL, oxy_lifecycle.OxyState.PULLING]
    assert lc.state is oxy_lifecycle.OxyState.PAUSED_FOR_PULL, "back to PAUSED_FOR_PULL after the pull"


def test_no_sessions_leaves_the_lifecycle_untouched(tmp_path, monkeypatch):
    """No stored sessions means no per-session pull, so PULLING is never entered — the early return
    fires before the lifecycle is driven at all."""
    lc = oxy_lifecycle.OxyLifecycle()
    _install(monkeypatch, FakeRing([], b""))
    assert _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000", lifecycle=lc)) == []
    assert lc.history == [] and lc.state is oxy_lifecycle.OxyState.NOT_SEEN
