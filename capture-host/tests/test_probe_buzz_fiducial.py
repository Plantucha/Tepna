# tepna-capture — tests/test_probe_buzz_fiducial.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# `probe_buzz_fiducial` — fire ONE commanded 0x83 into the ring's own raw 0x05 stream and locate the
# artifact (O2RING-BUZZ-FIDUCIAL §3 step 1; ran live 2026-08-19: motion 0→6.88, ~1.1 s wide). The
# decision logic is pure (back_time / locate_artifact) and the session loop runs against a fake ring
# through the real oxyii encode/Reassembler/decode path. The load-bearing control is
# `test_flat_motion_is_not_called_an_artifact`: without it the probe would "detect" the buzz in any
# noise and its verdict would be worthless — same discriminator discipline as the RTC probe's counter
# control.

import asyncio

import oxyii
import probe_buzz_fiducial as probe
from probe_buzz_fiducial import back_time, locate_artifact


def _run(coro):
    return asyncio.run(coro)


def _recs(n, motion):
    return [(1000 + i, 2000 + i, motion) for i in range(n)]


def _rt_payload(recs):
    """A genuine cmd=0x05 payload: u16 LE count + 9-byte records {i32 chA, i32 chB, u8 motion}."""
    out = bytearray(len(recs).to_bytes(2, "little"))
    for a, b, mo in recs:
        out += int(a).to_bytes(4, "little", signed=True)
        out += int(b).to_bytes(4, "little", signed=True)
        out.append(mo & 0xFF)
    return bytes(out)


# ── back_time: the daemon's arrival back-timing, reproduced ─────────────────────────────────────────
def test_back_time_spreads_records_across_the_span():
    bt = back_time(_recs(5, 0), 100.0, 1.0)
    assert len(bt) == 5
    assert abs(bt[-1][0] - 100.0) < 1e-9          # last record at arrival
    assert abs(bt[0][0] - 99.0) < 1e-9            # earliest one span before it


def test_back_time_empty_buffer_is_empty():
    assert back_time([], 100.0) == []


def test_back_time_single_record_lands_at_arrival():
    bt = back_time(_recs(1, 3), 50.0, 1.0)
    assert bt == [(50.0, 1000, 2000, 3)]


# ── locate_artifact: the discriminator ──────────────────────────────────────────────────────────────
def _samples(before_motion, after_motion):
    pre = [(t, 2000, 2000, before_motion) for t in (98.0, 98.5, 99.0, 99.5)]
    post = [(t, 2000, 2000, after_motion) for t in (100.0, 100.3, 100.6, 100.9)]
    return pre + post


def test_a_motion_spike_after_the_buzz_is_detected():
    r = locate_artifact(_samples(1, 40), 100.0, 1.0)
    assert r["detected"] is True
    assert r["motion_ratio"] >= 2


def test_a_still_baseline_gives_an_infinite_ratio():
    """The live 2026-08-19 shape: baseline exactly 0 (held still), so the lift is infinite."""
    r = locate_artifact(_samples(0, 7), 100.0, 1.0)
    assert r["detected"] is True
    assert r["motion_ratio"] == float("inf")


def test_flat_motion_is_not_called_an_artifact():
    r = locate_artifact(_samples(1, 1), 100.0, 1.0)
    assert r["detected"] is False


def test_flat_zero_motion_is_not_called_an_artifact():
    """Both windows silent: ratio degenerates to 1.0 and the absolute-lift clause must refuse."""
    r = locate_artifact(_samples(0, 0), 100.0, 1.0)
    assert r["detected"] is False
    assert r["motion_ratio"] == 1.0


def test_no_buzz_is_inconclusive_not_false():
    assert locate_artifact(_samples(0, 7), None)["detected"] is None


def test_empty_window_is_inconclusive():
    assert locate_artifact(_samples(0, 7), 200.0, 1.0)["detected"] is None


# ── the session loop against a fake ring ────────────────────────────────────────────────────────────
class _Ring:
    """Answers each 0x05 poll with one raw buffer; motion goes hot after a 0x83 arrives. Records every
    opcode written so the tests can assert exactly which device-state writes happened."""

    def __init__(self, motion_after_buzz=30, answers=True):
        self.buzzed = False
        self.motion_after_buzz = motion_after_buzz
        self.answers = answers
        self.writes = []
        self.notify = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def start_notify(self, _c, cb):
        self.notify = cb

    async def write_gatt_char(self, _c, frame, response=False):
        op = frame[1]
        self.writes.append(op)
        if op == probe.VIBRATE:
            self.buzzed = True
        elif op == oxyii.OP_RT_PPG and self.answers and self.notify is not None:
            mo = self.motion_after_buzz if self.buzzed else 0
            self.notify(0, oxyii.encode(oxyii.OP_RT_PPG, _rt_payload(_recs(20, mo)), frame[4]))


def _install(monkeypatch, ring, *, wall_start=1000.0):
    monkeypatch.setattr(probe, "BleakClient", lambda addr, **kw: ring)

    async def no_sleep(_s):
        return None
    monkeypatch.setattr(probe.asyncio, "sleep", no_sleep)
    # monotonic drives the loop: t0, then one read per iteration. pre=1, post=2 → buzz on the 2nd
    # iteration, break past 3.0.
    mono = iter([0.0, 0.5, 1.2, 2.0, 2.6, 3.5, 4.0, 5.0])
    monkeypatch.setattr(probe, "monotonic", lambda: next(mono))
    # wall supplies buzz_s and each poll's arrival stamp, monotonically
    state = {"t": wall_start}

    def _wall():
        state["t"] += 0.5
        return state["t"]
    monkeypatch.setattr(probe, "wall", _wall)


def test_session_fires_once_and_detects_the_artifact(tmp_path, monkeypatch, capsys):
    ring = _Ring()
    _install(monkeypatch, ring)
    out = str(tmp_path / "buzz.txt")
    assert _run(probe.main("MAC", 1.0, 2.0, out)) == 0
    text = capsys.readouterr().out
    assert "BUZZ fired" in text
    assert "BUZZ ARTIFACT in motion" in text
    assert ring.writes.count(probe.VIBRATE) == 1, "exactly ONE vibrate — never a repeat"
    # the capture file is written in the daemon's PPG2W column format
    lines = open(out).read().splitlines()
    assert lines[0].startswith("Phone timestamp;sensor timestamp [ns];channel 0;channel 1;motion")
    assert len(lines) > 1


def test_session_reports_a_motor_that_did_not_move(tmp_path, monkeypatch, capsys):
    """0x83 acked but no motion artifact → the explicit negative, not a crash and not a claim."""
    _install(monkeypatch, _Ring(motion_after_buzz=0))
    assert _run(probe.main("MAC", 1.0, 2.0, str(tmp_path / "b.txt"))) == 0
    assert "no clear motion artifact" in capsys.readouterr().out


def test_session_with_no_replies_is_inconclusive(tmp_path, monkeypatch, capsys):
    _install(monkeypatch, _Ring(answers=False))
    assert _run(probe.main("MAC", 1.0, 2.0, str(tmp_path / "b.txt"))) == 0
    assert "inconclusive" in capsys.readouterr().out


def test_sync_mode_pushes_0xc0_before_the_capture(tmp_path, monkeypatch, capsys):
    ring = _Ring()
    _install(monkeypatch, ring)
    assert _run(probe.main("MAC", 1.0, 2.0, str(tmp_path / "b.txt"), sync=True)) == 0
    assert oxyii.OP_SET_TIME in ring.writes
    assert ring.writes.index(oxyii.OP_SET_TIME) < ring.writes.index(probe.VIBRATE), \
        "the RTC push happens before the buzz, so the .dat carries synced time for the artifact"
    assert "RTC synced" in capsys.readouterr().out


def test_the_only_device_state_writes_are_whitelisted(tmp_path, monkeypatch):
    """The §4 constraint made checkable: across a whole session the write surface is auth/setup/0x05
    polls + exactly one 0x83 (+ 0xC0 when --sync). Anything else appearing here is a regression."""
    ring = _Ring()
    _install(monkeypatch, ring)
    _run(probe.main("MAC", 1.0, 2.0, str(tmp_path / "b.txt")))
    allowed = {oxyii.OP_AUTH, oxyii.OP_SETUP, oxyii.OP_RT_PPG, probe.VIBRATE}
    assert set(ring.writes) <= allowed, f"unexpected writes: {set(ring.writes) - allowed}"


def test_module_has_a_cli_guard():
    src = open(probe.__file__).read()
    assert 'if __name__ == "__main__":' in src
    assert "require_free_link()" in src


def test_a_decoy_frame_is_filtered_not_collected(tmp_path, monkeypatch, capsys):
    """A stray reply for a different opcode (the ring interleaves 0x04 live frames) must not be
    swallowed into the raw-sample stream — the notify filter keeps only 0x05."""
    class _Noisy(_Ring):
        async def write_gatt_char(self, _c, frame, response=False):
            if frame[1] == oxyii.OP_RT_PPG and self.notify is not None:
                self.notify(0, oxyii.encode(oxyii.OP_LIVE, b"\x00" * 24, frame[4]))   # decoy first
            await super().write_gatt_char(_c, frame, response)
    ring = _Noisy()
    _install(monkeypatch, ring)
    assert _run(probe.main("MAC", 1.0, 2.0, str(tmp_path / "b.txt"))) == 0
    assert "BUZZ ARTIFACT" in capsys.readouterr().out
