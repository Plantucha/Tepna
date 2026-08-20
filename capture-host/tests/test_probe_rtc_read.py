# tepna-capture — tests/test_probe_rtc_read.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# `probe_rtc_read` — the 0xE1 double-read RTC probe. It is a one-shot hardware diagnostic (it needs the
# ring worn and advertising to run for real), but its DECISION logic is a pure function of two byte
# buffers and must be covered without hardware — a fake ring answers each read opcode through the real
# oxyii encode/Reassembler/decode path, exactly as the sibling probe tests do.
#
# The promise the probe makes: a differential read settles the RTC question EITHER way. So the one thing
# that must not rot is the DISCRIMINATOR — a field that advances by ~the gap is a clock candidate; a field
# that advances by anything else is a counter and must NOT be flagged. `test_diff_does_not_flag_a_counter`
# is that control: without it the probe would "find a clock" in any changing byte and its verdict would be
# worthless.

import asyncio

import oxyii
import probe_rtc_read as probe
from probe_rtc_read import diff


def _run(coro):
    return asyncio.run(coro)


class _Ring:
    """Answers each read opcode with one oxyii-encoded reply. `replies` maps op -> fn(count)->bytes|None
    (None = stay silent, so the probe's ask() times out → NO REPLY)."""

    def __init__(self, replies):
        self.replies = replies
        self.count = {}
        self.notify = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def start_notify(self, _c, cb):
        self.notify = cb

    async def _answer(self, op, seq):
        self.count[op] = self.count.get(op, 0) + 1
        payload = self.replies[op](self.count[op])
        if payload is not None:
            await self.notify(0, oxyii.encode(op, payload, seq))

    async def write_gatt_char(self, _c, frame, response=False):
        op = frame[1]
        if op in self.replies and self.notify is not None:
            await self._answer(op, frame[4])


def _install(monkeypatch, ring):
    monkeypatch.setattr(probe, "BleakClient", lambda addr, **kw: ring)

    async def no_sleep(_s):
        return None

    monkeypatch.setattr(probe.asyncio, "sleep", no_sleep)
    # a deterministic 10 s gap: main() reads monotonic() twice (t0, then after the sleep)
    times = iter([1000.0, 1010.0])
    monkeypatch.setattr(probe, "monotonic", lambda: next(times))


# ── the pure decision function ────────────────────────────────────────────────────────────────────
def test_diff_reports_a_changed_byte():
    out = diff(b"\x00\x00", b"\x00\x05", 10)
    assert any("byte[ 1]" in line for line in out)


def test_diff_flags_a_u32_that_tracks_the_gap():
    out = diff((1000).to_bytes(4, "little"), (1010).to_bytes(4, "little"), 10)
    assert any("CLOCK CANDIDATE" in line and "u32" in line for line in out)


def test_diff_does_not_flag_a_counter_that_ignores_the_gap():
    # advanced 500 against a 10 s gap: a real change, but NOT a clock. The change is still reported;
    # the CLOCK CANDIDATE tag is not. This is the discriminator the whole probe rests on.
    out = diff((1000).to_bytes(4, "little"), (1500).to_bytes(4, "little"), 10)
    assert not any("CLOCK CANDIDATE" in line for line in out)
    assert any("byte[" in line for line in out)


def test_diff_is_empty_for_identical_buffers():
    assert diff(b"abc", b"abc", 10) == []


def test_diff_handles_buffers_shorter_than_the_multibyte_windows():
    out = diff(b"\x01", b"\x02", 10)  # len 1 < 2- and 4-byte windows; range guards must not raise
    assert len(out) == 1 and "byte[ 0]" in out[0]


# ── main() end to end against a fake ring ─────────────────────────────────────────────────────────
def _const(payload):
    return lambda _count: payload


def test_a_clock_field_that_advances_by_the_gap_is_detected(monkeypatch, capsys):
    def info(count):
        p = bytearray(60)
        p[4:8] = (1000 + 10 * (count - 1)).to_bytes(4, "little")  # +10 on the 2nd read == the gap
        return bytes(p)

    ring = _Ring({
        oxyii.OP_GET_INFO: info,
        oxyii.OP_GET_CONFIG: _const(bytes(40)),
        oxyii.OP_GET_BATTERY: _const(bytes([80])),
    })
    _install(monkeypatch, ring)
    assert _run(probe.main("MAC", 10.0)) == 0
    out = capsys.readouterr().out
    assert "GET_INFO: 60 bytes" in out
    assert "CLOCK CANDIDATE" in out
    assert "BYTE-IDENTICAL" in out  # config + battery did not move


def test_b_all_identical_reads_yield_the_no_rtc_verdict(monkeypatch, capsys):
    ring = _Ring({
        oxyii.OP_GET_INFO: _const(bytes(60)),
        oxyii.OP_GET_CONFIG: _const(bytes(40)),
        oxyii.OP_GET_BATTERY: _const(bytes([80])),
    })
    _install(monkeypatch, ring)
    _run(probe.main("MAC", 10.0))
    out = capsys.readouterr().out
    assert out.count("BYTE-IDENTICAL") == 3
    assert "no read opcode carries the RTC" in out


def test_c_a_ring_that_never_answers_is_inconclusive(monkeypatch, capsys):
    ring = _Ring({})  # answers nothing → every ask times out
    _install(monkeypatch, ring)

    _real_wait_for = asyncio.wait_for  # capture before patching, or quick() recurses into itself

    async def quick(coro, _t):  # shorten the real 4 s ask timeout for the no-reply path
        return await _real_wait_for(coro, 0.02)

    monkeypatch.setattr(probe.asyncio, "wait_for", quick)
    _run(probe.main("MAC", 10.0))
    out = capsys.readouterr().out
    assert "NO REPLY" in out
    assert "unreadable on one side" in out


def test_d_ask_loops_past_a_nonmatching_frame(monkeypatch, capsys):
    """A stray reply for a different opcode must not satisfy the ask — Chan.ask must keep waiting for the
    op it wrote. Covers the `r[0] == op` false arc."""

    class _NoisyRing(_Ring):
        async def _answer(self, op, seq):
            await self.notify(0, oxyii.encode(oxyii.OP_LIVE, b"\x00", seq))  # decoy, wrong op
            await super()._answer(op, seq)

    ring = _NoisyRing({
        oxyii.OP_GET_INFO: _const(bytes(60)),
        oxyii.OP_GET_CONFIG: _const(bytes(40)),
        oxyii.OP_GET_BATTERY: _const(bytes([80])),
    })
    _install(monkeypatch, ring)
    _run(probe.main("MAC", 10.0))
    assert "GET_INFO: 60 bytes" in capsys.readouterr().out  # real reply arrived past the decoy


def test_module_has_a_cli_guard():
    src = open(probe.__file__).read()
    assert 'if __name__ == "__main__":' in src
    assert "require_free_link()" in src  # the daemon-stop guard runs before any connect, in the entry


# ── --clock: the pull-side drift check the differential probe made possible ────────────────────────
def _rtc_payload(y, mo, d, h, mi, s):
    p = bytearray(60)
    p[24:31] = bytes([y & 0xFF, (y >> 8) & 0xFF, mo, d, h, mi, s])
    return bytes(p)


def _install_clock(monkeypatch, ring, host):
    """read_clock needs only the client + a pinned host instant; it never reads monotonic()."""
    import datetime as dt
    monkeypatch.setattr(probe, "BleakClient", lambda addr, **kw: ring)

    async def no_sleep(_s):
        return None
    monkeypatch.setattr(probe.asyncio, "sleep", no_sleep)

    class _Now(dt.datetime):
        @classmethod
        def now(cls, tz=None):
            return host
    monkeypatch.setattr(dt, "datetime", _Now)


def test_clock_offset_is_signed_component_arithmetic():
    import datetime as dt
    rtc = {"year": 2026, "month": 8, "day": 19, "hour": 19, "minute": 48, "second": 26}
    assert probe.clock_offset_s(rtc, dt.datetime(2026, 8, 19, 19, 48, 26)) == 0
    assert probe.clock_offset_s(rtc, dt.datetime(2026, 8, 19, 19, 45, 55)) == 151   # the measured free-run drift
    assert probe.clock_offset_s(rtc, dt.datetime(2026, 8, 19, 19, 49, 0)) == -34    # ring can lag too


def test_read_clock_reports_ring_vs_host(monkeypatch, capsys):
    import datetime as dt
    ring = _Ring({oxyii.OP_GET_INFO: lambda _c: _rtc_payload(2026, 8, 19, 19, 48, 26)})
    _install_clock(monkeypatch, ring, dt.datetime(2026, 8, 19, 19, 48, 21))
    assert _run(probe.read_clock("MAC")) == 0
    out = capsys.readouterr().out
    assert "2026-08-19 19:48:26" in out
    assert "+5 s" in out


def test_read_clock_no_reply_is_a_failure_not_a_zero(monkeypatch, capsys):
    import datetime as dt
    _install_clock(monkeypatch, _Ring({}), dt.datetime(2026, 8, 19, 19, 48, 21))

    _real_wait_for = asyncio.wait_for

    async def quick(coro, _t):
        return await _real_wait_for(coro, 0.02)
    monkeypatch.setattr(probe.asyncio, "wait_for", quick)
    assert _run(probe.read_clock("MAC")) == 1
    assert "NO REPLY" in capsys.readouterr().out


def test_read_clock_out_of_range_rtc_is_a_failure(monkeypatch, capsys):
    """An unset RTC region (zeros) must read as 'not a clock', never as year-0 with offset math."""
    import datetime as dt
    ring = _Ring({oxyii.OP_GET_INFO: lambda _c: bytes(60)})
    _install_clock(monkeypatch, ring, dt.datetime(2026, 8, 19, 19, 48, 21))
    assert _run(probe.read_clock("MAC")) == 1
    assert "out of range" in capsys.readouterr().out
