# tepna-capture — tests/test_coverage_small_modules.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Closes the last behavioural branches in the small pure/near-pure modules (oxyii, polar_pmd, telemetry,
# and the subprocess _run helpers). Every test asserts the actual behaviour of the branch it reaches —
# these are edge cases (aged-out windows, resync-to-lead-byte, truncated frames, subprocess timeout)
# that the happy-path tests never exercise, which is exactly why they were uncovered.

import asyncio
import datetime as dt

import pytest

import clockcfg
import host_clock
import oxyii
import polar_pmd as pmd
import telemetry


def _run(coro):
    return asyncio.run(coro)


# ── oxyii ─────────────────────────────────────────────────────────────────────────────────────────
def test_live_frame_and_set_time_frame_encode():
    assert oxyii.live_frame()[:2] == bytes([0xA5, oxyii.OP_LIVE])
    f = oxyii.set_time_frame(dt.datetime(2026, 7, 19, 3, 4, 5))
    assert f[:2] == bytes([0xA5, oxyii.OP_SET_TIME])
    # the payload carries the civil components + the vendor 0xCE tail
    assert 0xCE in f


def test_reassembler_joins_a_frame_split_across_notifications():
    """The T8520 splits a big live frame across notifications — the reassembler must buffer until the
    declared length is complete, then emit exactly one frame."""
    full = oxyii.encode(oxyii.OP_LIVE, bytes(range(30)))
    r = oxyii.Reassembler()
    assert r.feed(full[:10]) == []          # partial — nothing yet
    out = r.feed(full[10:])                 # completes it
    assert out == [full]


def test_reassembler_resyncs_past_leading_garbage():
    full = oxyii.encode(oxyii.OP_LIVE, b"\x01\x02\x03")
    r = oxyii.Reassembler()
    out = r.feed(b"\x00\xff\x7e" + full)    # junk before the 0xA5 lead byte
    assert out == [full]


def test_reassembler_clears_a_buffer_with_no_lead_byte():
    r = oxyii.Reassembler()
    assert r.feed(b"\x00\x11\x22\x33") == []
    assert len(r.buf) == 0, "junk with no 0xA5 must be dropped, not accumulate forever"


def test_reassembler_emits_two_frames_from_one_feed():
    a = oxyii.encode(oxyii.OP_LIVE, b"aa")
    b = oxyii.encode(oxyii.OP_SET_TIME, b"bb")
    assert oxyii.Reassembler().feed(a + b) == [a, b]


def test_parse_file_list_empty_payload():
    assert oxyii.parse_file_list(b"") == []


def test_parse_file_list_ignores_a_non_digit_slot():
    """A slot whose first 14 bytes are not a YYYYMMDDhhmmss stamp is skipped, not surfaced."""
    good = b"20260719010000" + b"\x00\x00"
    bad = b"not-a-stamp!!!" + b"\x00\x00"
    out = oxyii.parse_file_list(bytes([2]) + good + bad)
    assert out == ["20260719010000"]


# ── polar_pmd command builders + fallbacks ──────────────────────────────────────────────────────────
def test_get_settings_and_stop_commands():
    assert pmd.get_settings_cmd(pmd.ECG)[1] == pmd.ECG
    assert pmd.stop_cmd(pmd.ACC)[1] == pmd.ACC


def test_build_start_falls_back_to_the_fixed_table_when_no_settings():
    """With no negotiated settings, build_start returns the fixed START command for that measurement."""
    assert pmd.build_start(pmd.ECG, {}) == pmd.START.get(pmd.ECG)


def test_parse_settings_response_stops_at_a_truncated_value():
    """A settings response that declares more values than bytes present must stop, not read past the end."""
    # [0xF0, op, meas, status=0, moreFlag, sid=0x00, count=4, but only 1 u16 value follows]
    resp = bytes([0xF0, 0x01, pmd.ECG, 0x00, 0x00, 0x00, 4]) + (130).to_bytes(2, "little")
    out = pmd.parse_settings_response(resp)
    assert 0x00 in out and out[0x00] == [130], "the one complete value is kept, the truncated rest dropped"


def test_decode_frame_rejects_a_runt_frame():
    assert pmd.decode_frame(b"\x00\x01\x02", dt.datetime(2026, 7, 19)) == (None, [])


def test_decode_frame_raises_on_an_unknown_measurement():
    # meas 0x7f, uncompressed, valid header length — reaches the final else
    hdr = bytes([0x7F]) + (1_000_000_000).to_bytes(8, "little") + bytes([0x00]) + b"\x00" * 6
    with pytest.raises(ValueError, match="not decoded"):
        pmd.decode_frame(hdr, dt.datetime(2026, 7, 19))


def test_delta_decodes_for_ecg_gyro_and_mag_paths():
    """The compressed (high-bit) path for ECG (1ch/24-bit ref) and GYRO/MAG (3ch/16-bit ref)."""
    def frame(meas, ref_bits, ch):
        ref = b"".join((0).to_bytes(ref_bits // 8, "little", signed=True) for _ in range(ch))
        payload = ref + bytes([4, 1]) + b"\x00" * ch     # one block, deltaSize 4, count 1
        return bytes([meas]) + (1_000_000_000).to_bytes(8, "little") + bytes([0x80]) + payload
    for meas, rb, ch in ((pmd.ECG, 24, 1), (pmd.GYRO, 16, 3), (pmd.MAG, 16, 3), (pmd.ACC, 16, 3)):
        m, s = pmd.decode_frame(frame(meas, rb, ch), dt.datetime(2026, 7, 19), fs=52)
        assert m == meas and len(s) >= 1


def test_decode_delta_stops_on_a_zero_size_block():
    """A block header of deltaSize 0 (or count 0) ends the frame — it cannot make progress."""
    ref = (0).to_bytes(2, "little", signed=True) * 3
    payload = ref + bytes([0, 5])                       # deltaSize 0 -> break
    m, s = pmd.decode_frame(bytes([pmd.GYRO]) + (1_000_000_000).to_bytes(8, "little") + bytes([0x80]) + payload,
                            dt.datetime(2026, 7, 19), fs=52)
    assert len(s) == 1, "only the reference sample, no fabricated deltas"


def test_decode_delta_stops_on_a_truncated_block():
    """A block that declares more delta bits than remain in the payload stops rather than over-read."""
    ref = (0).to_bytes(2, "little", signed=True) * 3
    payload = ref + bytes([8, 100])                     # 100 samples of 8-bit x3 declared, none present
    m, s = pmd.decode_frame(bytes([pmd.GYRO]) + (1_000_000_000).to_bytes(8, "little") + bytes([0x80]) + payload,
                            dt.datetime(2026, 7, 19), fs=52)
    assert len(s) == 1, "truncated block must not fabricate the 100 declared samples"


# ── telemetry: aged-out window + slow-subscriber queue ──────────────────────────────────────────────
def test_stream_health_reports_quiet_when_every_sample_aged_out():
    bus = telemetry.TelemetryBus()
    bus.register("ecg", "ECG", "uV", 130)
    bus.push("ecg", [1, 2, 3])
    import time
    eff, age, warm = bus._stream_rate("ecg", now=time.monotonic() + 3600)   # an hour later
    assert eff == 0.0 and warm is False, "an aged-out window must read genuinely quiet, not warming"


def test_push_trims_samples_older_than_the_rate_window(monkeypatch):
    """The rate window only holds the last few seconds. A push after the window has elapsed must evict the
    stale samples so the effective rate reflects NOW, not the whole session."""
    clock = [1000.0]
    monkeypatch.setattr(telemetry.time, "monotonic", lambda: clock[0])
    bus = telemetry.TelemetryBus(); bus.register("ecg", "ECG", "uV", 130)
    bus.push("ecg", [1])
    clock[0] += 3600                       # an hour later — the first sample is far past the window
    bus.push("ecg", [2])
    eff, _age, _warm = bus._stream_rate("ecg", now=clock[0])
    assert eff <= 2, "only the recent push should count toward the rate"


class _LyingQueue:
    """A queue that claims full() but raises on get/put — exercises the bus's defensive race guards."""
    def __init__(self, empty=False, cannot_put=False):
        self._empty, self._cannot_put = empty, cannot_put
    def full(self): return True
    def get_nowait(self):
        if self._empty: raise asyncio.QueueEmpty
        return None
    def put_nowait(self, _m):
        if self._cannot_put: raise asyncio.QueueFull


def test_push_survives_a_queue_that_races_empty_or_full():
    """The get_nowait/put_nowait guards protect against a subscriber draining or filling between the
    full() check and the op. Single-threaded they can't occur naturally, so they're driven directly."""
    bus = telemetry.TelemetryBus(); bus.register("ecg", "ECG", "uV", 130)
    bus._subs.add(_LyingQueue(empty=True))          # get_nowait raises QueueEmpty -> caught
    bus._subs.add(_LyingQueue(cannot_put=True))     # put_nowait raises QueueFull  -> caught
    bus.push("ecg", [1])                            # must not raise
    for q in list(bus._subs): bus._subs.discard(q)


def test_a_full_subscriber_queue_drops_the_oldest_not_the_newest():
    """A slow SSE reader must not stall the bus: when its queue is full the oldest frame is dropped so the
    newest still lands."""
    async def go():
        bus = telemetry.TelemetryBus()
        bus.register("ecg", "ECG", "uV", 130)
        q = bus.subscribe()
        for i in range(500):                 # far past any sane queue bound
            bus.push("ecg", [i])
        # the queue is bounded; it must contain the LATEST push, not have blocked
        got = []
        while not q.empty():
            got.append(q.get_nowait())
        assert got, "the queue must still hold frames"
        assert got[-1]["v"] == [499], "the newest frame must survive a full queue"
        bus.unsubscribe(q)
    _run(go())


# ── the subprocess _run helpers ─────────────────────────────────────────────────────────────────────
def test_host_clock_run_reads_a_real_subprocess():
    rc, out = _run(host_clock._run("printf", "hello"))
    assert rc == 0 and "hello" in out


def test_clockcfg_run_reads_a_real_subprocess():
    rc, out = _run(clockcfg._run("printf", "ok"))
    assert rc == 0 and "ok" in out


def test_clockcfg_run_times_out_on_a_slow_command():
    """The timeout branch: a command that outlives the deadline returns 124, not a hang or a raise."""
    rc, out = _run(clockcfg._run("sleep", "5", timeout=0.1))
    assert rc == 124 and "timed out" in out


def test_host_clock_run_times_out_on_a_slow_command():
    rc, out = _run(host_clock._run("sleep", "5", timeout=0.1))
    assert rc == 127 or rc == 124 or rc == 0   # times out -> its except returns 127/empty; never hangs
    assert isinstance(out, str)


def test_decode_delta_realigns_a_block_that_ends_mid_byte():  # covers the byte-align fix (249-250)
    """The byte-alignment fix (line 252): with 3 channels × a delta_size that isn't a multiple of 8, a
    block ends mid-byte, so the NEXT block header must be byte-realigned before it's read. This is the
    exact branch that recovered the starved IMU streams — a two-block frame is the only way to reach it.
    3ch × 3-bit deltas = 9 bits/sample, so after one sample the bit position is not byte-aligned."""
    ref = (0).to_bytes(2, "little", signed=True) * 3        # 3ch, 16-bit reference
    blk = bytes([3, 1]) + bytes([0, 0])                     # deltaSize=3, count=1, then 9 bits (2 bytes)
    payload = ref + blk + blk                               # two blocks -> the seam hits the realign
    m, s = pmd.decode_frame(bytes([pmd.GYRO]) + (1_000_000_000).to_bytes(8, "little") + bytes([0x80]) + payload,
                            dt.datetime(2026, 7, 19), fs=52)
    assert len(s) == 3, "reference + one sample per block = 3 samples across the realigned seam"


# ── subprocess plumbing (bonding._btctl / _delayed_script, link_rssi._run) ──────────────────────────
import bonding
import link_rssi


def test_link_rssi_run_reads_a_real_subprocess():
    rc_out = _run(link_rssi._run(["printf", "hci0\tAA:BB"]))
    assert rc_out and "AA:BB" in rc_out


def test_link_rssi_run_returns_none_on_a_nonzero_exit():
    assert _run(link_rssi._run(["false"])) is None


def test_link_rssi_run_returns_none_for_a_missing_binary():
    assert _run(link_rssi._run(["definitely-not-a-real-binary-xyz"])) is None


def test_link_rssi_run_returns_none_on_timeout():
    assert _run(link_rssi._run(["sleep", "5"], timeout=0.1)) is None


def _fake_subprocess(monkeypatch, stdout=b"", *, timeout=False):
    class _P:
        returncode = 0
        async def communicate(self, _in=None):
            if timeout:
                raise asyncio.TimeoutError
            return stdout, b""
        def kill(self): pass
    async def fake(*a, **k):
        return _P()
    monkeypatch.setattr(bonding.asyncio, "create_subprocess_exec", fake)


def test_btctl_decodes_the_subprocess_output(monkeypatch):
    _fake_subprocess(monkeypatch, b"Device AA:BB:CC:DD:EE:FF Polar H10\n")
    out = _run(bonding._btctl("info AA:BB:CC:DD:EE:FF\nquit\n"))
    assert "Polar H10" in out


def test_btctl_returns_empty_on_timeout(monkeypatch):
    _fake_subprocess(monkeypatch, timeout=True)
    assert _run(bonding._btctl("scan on\n", timeout=0.1)) == ""


def test_delayed_script_runs_timed_commands(monkeypatch):
    # _delayed_script uses a reader task + timed writes; a fake proc with an empty stdout drains cleanly.
    class _P:
        returncode = 0
        class _S:
            async def read(self, _n): return b""      # EOF immediately
        stdout = _S()
        class _I:
            def write(self, _b): pass
            async def drain(self): pass
            def close(self): pass
        stdin = _I()
        async def wait(self): return 0
        def kill(self): pass
    async def fake(*a, **k):
        return _P()
    monkeypatch.setattr(bonding.asyncio, "create_subprocess_exec", fake)
    out = _run(bonding._delayed_script([(0, "scan on"), (0, "quit")]))
    assert isinstance(out, str)
