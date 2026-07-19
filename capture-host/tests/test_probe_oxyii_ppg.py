# tepna-capture — tests/test_probe_oxyii_ppg.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The Phase-0 diagnostic probe (O2RING-LIVE-PPG-WAVEFORM). It is a hand-run tool, but its decode path
# (feed live 0x04 replies through the real Reassembler + parse_live, then decide body-present vs
# KILL-criterion) is worth covering — driven by a fake ring that answers each live_frame() write with a
# genuine oxyii-encoded 0x04 reply, so the real protocol is exercised end to end.

import asyncio


import oxyii
import probe_oxyii_ppg as probe


def _run(coro):
    return asyncio.run(coro)


class _FakeDevice:
    def __init__(self, addr="D1:98:62:7C:92:B3", name="S8-AW 2100"):
        self.address, self.name = addr, name


class _FakeRing:
    """Answers each live_frame() write with an encoded 0x04 reply carrying a `body_len`-byte PPG body."""
    def __init__(self, body_len):
        self.body_len = body_len
        self.notify = None

    async def __aenter__(self): return self
    async def __aexit__(self, *a): return False
    async def start_notify(self, _c, cb): self.notify = cb
    async def write_gatt_char(self, _c, frame, response=False):
        if frame[1] == oxyii.OP_LIVE and self.notify:
            # 24-B status header (SpO2/HR fields) + body_len PPG bytes
            hdr = bytearray(24)
            hdr[6] = 96          # spo2 (offset [6] per parse_live)
            hdr[8] = 55          # pr low byte
            payload = bytes(hdr) + bytes(self.body_len)
            self.notify(0, oxyii.encode(oxyii.OP_LIVE, payload))
    mtu_size = 247


def _install(monkeypatch, ring, device=_FakeDevice()):
    async def find(*a, **k): return device
    monkeypatch.setattr(probe.BleakScanner, "find_device_by_filter", find)
    monkeypatch.setattr(probe, "BleakClient", lambda dev, **kw: ring)
    async def no_sleep(_s): return None
    monkeypatch.setattr(probe.asyncio, "sleep", no_sleep)


def test_probe_reports_a_ring_that_never_advertises(monkeypatch, capsys):
    async def find(*a, **k): return None
    monkeypatch.setattr(probe.BleakScanner, "find_device_by_filter", find)
    _run(probe.main("D1:98:62:7C:92:B3", 3))
    assert "not advertising" in capsys.readouterr().out


def test_probe_detects_a_present_ppg_body(monkeypatch, capsys):
    """A body well past the header → 'body present', with the sample-rate hint."""
    _install(monkeypatch, _FakeRing(body_len=126))
    _run(probe.main("D1:98:62:7C:92:B3", 3))
    out = capsys.readouterr().out
    assert "captured 3 live" in out and "body present" in out


def test_probe_reports_the_kill_criterion_when_there_is_no_body(monkeypatch, capsys):
    """A reply that is header-only (body <= 2) is the Phase-0 KILL criterion — no waveform on this ring."""
    _install(monkeypatch, _FakeRing(body_len=0))
    _run(probe.main("D1:98:62:7C:92:B3", 2))
    assert "KILL criterion" in capsys.readouterr().out


def test_probe_main_module_has_a_cli_guard():
    src = open(probe.__file__, encoding="utf-8").read()
    assert 'if __name__ == "__main__":' in src or "argparse" in src


def test_probe_ignores_a_non_live_reply(monkeypatch, capsys):
    """on_notify skips any reply that is not a 0x04 LIVE frame."""
    class _Ring(_FakeRing):
        def __init__(self): super().__init__(body_len=0)
        async def write_gatt_char(self, _c, frame, response=False):
            if frame[1] == oxyii.OP_LIVE and self.notify:
                self.notify(0, oxyii.encode(oxyii.OP_SET_TIME, b"\x00"))   # a NON-live reply
    _install(monkeypatch, _Ring())
    _run(probe.main("D1:98:62:7C:92:B3", 2))
    assert "captured 0 live" in capsys.readouterr().out    # the non-live frames were skipped
