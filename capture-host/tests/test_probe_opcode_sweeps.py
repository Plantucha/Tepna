# tepna-capture — tests/test_probe_opcode_sweeps.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The two opcode sweeps. Both send commands nobody understands to firmware nobody here wrote, so what is
# pinned is the SAFETY, not the happy path:
#
#   * neither may send anything without explicit consent;
#   * the Polar sweep must never send 0x08/0x09 — they persist across power cycles, so an armed trigger
#     makes the device record by itself on every boot;
#   * both must ABORT at the first unexplained state change rather than keep poking;
#   * both must leave nothing running.
#
# The two differ in what their evidence is worth, and the tests say so: PMD has a STATUS FIELD, so
# `invalid_op` proves absence; OxyII has none, so silence is "no evidence" and only REPLIES count.

import asyncio

import polar_pmd as pmd
import probe_oxyii_opcodes as oxs
import probe_pmd_opcodes as pms


def _run(c):
    return asyncio.run(c)


# ══ Polar PMD sweep ══════════════════════════════════════════════════════════════════════════════════

def _ack(status=0x00, op=0x05):
    return bytes([0xF0, op, 0xFF, status, 0x00])


class _PmdClient:
    def __init__(self, replies=None, default=0x01):
        self.replies, self.default, self.writes, self._cb = replies or {}, default, [], None
        self.is_connected = True
        self.services = ["gatt"]

    async def connect(self):
        pass

    async def disconnect(self):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def start_notify(self, _c, cb):
        self._cb = cb

    async def write_gatt_char(self, _c, data, response=False):
        op = data[0]
        self.writes.append(bytes(data))
        r = self.replies.get(op, _ack(self.default, op))
        if r is not None and self._cb:
            self._cb(0, bytearray(r))


def _patch_pmd(monkeypatch, client):
    async def find(_a, timeout=0):
        return object()
    monkeypatch.setattr(pms.BleakScanner, "find_device_by_address", find)
    monkeypatch.setattr(pms, "BleakClient", lambda dev, **kw: client)


def test_pmd_refuses_to_send_without_consent(capsys):
    assert pms.main(["--address", "AA:BB"]) == 2
    assert "refusing" in capsys.readouterr().out


def test_pmd_dry_run_sends_nothing_and_shows_the_plan(capsys):
    assert pms.main(["--address", "AA:BB", "--dry-run"]) == 0
    out = capsys.readouterr().out
    assert "nothing was sent" in out and "0x08" in out


def test_pmd_never_plans_the_persistent_trigger_writes():
    res = _run(pms.run("AA:BB", None, 0x00, 0x0F, include_dangerous=False, dry_run=True))
    assert "0x08" not in res["planned"] and "0x09" not in res["planned"]
    assert "persists across power cycles" in res["skipped"]["0x08"]


def test_pmd_include_dangerous_is_the_only_way_to_reach_them():
    res = _run(pms.run("AA:BB", None, 0x00, 0x0F, include_dangerous=True, dry_run=True))
    assert "0x08" in res["planned"]


def test_pmd_distinguishes_absent_from_present_by_status(monkeypatch):
    """The whole method: invalid_op means the OPCODE is absent; anything else means it exists."""
    c = _PmdClient(replies={0x01: _ack(0x02, 0x01), 0x0B: _ack(0x01, 0x0B)}, default=0x01)
    _patch_pmd(monkeypatch, c)
    res = _run(pms.run("AA:BB", None, 0x01, 0x0B, False, False))
    assert res["opcodes"]["0x01"]["exists"] is True
    assert res["opcodes"]["0x0b"]["exists"] is False


def test_pmd_a_bare_ok_is_flagged_as_having_executed(monkeypatch):
    c = _PmdClient(replies={0x05: _ack(0x00, 0x05)}, default=0x01)
    _patch_pmd(monkeypatch, c)
    res = _run(pms.run("AA:BB", None, 0x05, 0x05, False, False))
    assert res["opcodes"]["0x05"]["executed_bare"] is True


def test_pmd_aborts_when_state_changes(monkeypatch):
    """An unknown op that returns ok AND moves the device must stop the sweep — finding out WHICH op did
    it matters more than finishing the table."""
    seq = {"n": 0}

    class _Moving(_PmdClient):
        async def write_gatt_char(self, _c, data, response=False):
            op = data[0]
            self.writes.append(bytes(data))
            if op == 0x05:
                seq["n"] += 1
                r = _ack(0x00, 0x05) if seq["n"] < 2 else bytes([0xF0, 0x05, 0xFF, 0x00, 0x42])
            elif op == 0x0B:
                r = _ack(0x00, 0x0B)
            else:
                r = _ack(0x01, op)
            if self._cb:
                self._cb(0, bytearray(r))
    c = _Moving()
    _patch_pmd(monkeypatch, c)
    res = _run(pms.run("AA:BB", None, 0x0B, 0x0F, False, False))
    assert res.get("aborted_at") == "0x0b"
    assert "state changed" in res["abort_reason"]


def test_pmd_a_gatt_refusal_stops_rather_than_being_read_as_a_verdict(monkeypatch):
    class _Deaf(_PmdClient):
        async def write_gatt_char(self, _c, data, response=False):
            # The snapshot must succeed — only the SWEPT opcode goes deaf, which is the case under test.
            if data[0] in (0x05, 0x06, 0x07, 0x01):
                if self._cb:
                    self._cb(0, bytearray(_ack(0x00, data[0])))
                return
            raise RuntimeError("GATT Protocol Error: Unlikely Error")
    _patch_pmd(monkeypatch, _Deaf())
    res = _run(pms.run("AA:BB", None, 0x0B, 0x0F, False, False))
    assert "gatt_refused" in res["opcodes"]["0x0b"]
    assert "cannot distinguish device state from link state" in res["abort_reason"]


def test_pmd_stops_anything_left_running(monkeypatch):
    active = bytes([0xF0, 0x05, 0xFF, 0x00]) + bytes([(pmd.OFFLINE_ACTIVE << 6) | pmd.PPG])
    c = _PmdClient(replies={0x05: active}, default=0x01)
    _patch_pmd(monkeypatch, c)
    res = _run(pms.run("AA:BB", None, 0x0B, 0x0C, False, False))
    assert res["left_running"] == ["ppg"]
    assert any(w == pmd.stop_cmd(pmd.PPG) for w in c.writes), "a stop must actually be sent"


def test_pmd_a_missing_device_is_reported(monkeypatch):
    async def none(_a, timeout=0):
        return None
    monkeypatch.setattr(pms.BleakScanner, "find_device_by_address", none)
    res = _run(pms.run("AA:BB", None, 0x0B, 0x0C, False, False))
    assert "not found" in res["error"]


def test_pmd_main_writes_json_and_reports(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(pms.BleakScanner, "find_device_by_address",
                        lambda *a, **k: _wrap(None))
    p = str(tmp_path / "o.json")
    assert pms.main(["--address", "AA:BB", "--i-accept-the-risk", "--json", p]) == 1
    capsys.readouterr()
    assert "not found" in open(p).read()


async def _wrap(v):
    return v


def test_pmd_status_of_a_missing_reply_is_no_response():
    assert pms.status_of(None)[1] == "no_response"
    assert pms.status_of(_ack(0x0D))[1] == "in_charger"
    assert pms.status_of(b"\x00")[1] == "ok", "a bare reply falls back to its last byte"


def test_pmd_control_send_times_out_to_none(monkeypatch):
    c = _PmdClient()
    c._cb = None
    cp = pms.Control(c)
    _run(cp.start())

    async def silent(_ch, data, response=False):
        pass
    c.write_gatt_char = silent
    assert _run(cp.send(b"\x05", timeout=0.01)) is None


# ══ OxyII sweep ══════════════════════════════════════════════════════════════════════════════════════

def test_oxyii_refuses_without_consent(capsys):
    assert oxs.main(["--address", "AA:BB"]) == 2
    assert "no 'invalid_op' to hide behind" in capsys.readouterr().out


def test_oxyii_dry_run_names_the_weaker_evidence(capsys):
    assert oxs.main(["--address", "AA:BB", "--dry-run"]) == 0
    out = capsys.readouterr().out
    assert "no evidence" in out, "silence must not be reported as absence"
    assert "AUTH" in out and "SET_UTC_TIME" in out


def test_oxyii_skips_every_known_op():
    res = _run(oxs.run("AA:BB", None, 0x00, 0xFF, dry=True))
    assert res["planned"] == 256 - len(oxs.KNOWN)
    assert set(oxs.KNOWN) == {0xFF, 0x10, 0x04, 0xC0, 0xF1, 0xF2, 0xF3, 0xF4}


class _RingClient:
    def __init__(self, responders=(), live=b"\xa5\x04\xfb\x01\x00\x02\x00\x11\x22\x00"):
        self.responders, self.live, self.writes, self._cb = set(responders), live, [], None
        self.is_connected = True

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def start_notify(self, _c, cb):
        self._cb = cb

    async def write_gatt_char(self, _c, data, response=False):
        op = data[1]
        self.writes.append(op)
        if op == oxs.oxyii.OP_LIVE:
            self._cb(0, bytearray(self.live))
        elif op in self.responders:
            self._cb(0, bytearray(oxs.oxyii.encode(op, b"\x01")))


def _patch_ring(monkeypatch, client):
    async def find(_a, timeout=0):
        return object()
    monkeypatch.setattr(oxs.BleakScanner, "find_device_by_address", find)
    monkeypatch.setattr(oxs, "BleakClient", lambda dev, **kw: client)


def test_oxyii_records_which_ops_replied(monkeypatch):
    _patch_ring(monkeypatch, _RingClient(responders={0x20}))
    res = _run(oxs.run("AA:BB", None, 0x20, 0x22, dry=False))
    assert res["responders"] == ["0x20"]
    assert res["opcodes"]["0x21"]["replied"] is False


def test_oxyii_aborts_when_the_live_frame_moves(monkeypatch):
    class _Mutating(_RingClient):
        async def write_gatt_char(self, _c, data, response=False):
            op = data[1]
            self.writes.append(op)
            if op == oxs.oxyii.OP_LIVE:
                n = self.writes.count(oxs.oxyii.OP_LIVE)
                self._cb(0, bytearray(self.live if n < 2 else b"\xa5\x04\xfb\x01\x00\x02\x00\x99\x88\x00"))
            elif op == 0x20:
                self._cb(0, bytearray(oxs.oxyii.encode(op, b"\x01")))
    _patch_ring(monkeypatch, _Mutating())
    res = _run(oxs.run("AA:BB", None, 0x20, 0x25, dry=False))
    assert res["aborted_at"] == "0x20"
    assert "live state changed" in res["abort_reason"]


def test_oxyii_a_write_failure_stops_the_sweep(monkeypatch):
    class _Dead(_RingClient):
        async def write_gatt_char(self, _c, data, response=False):
            # Handshake and snapshot must work; only the swept opcode kills the link.
            if data[1] in (oxs.oxyii.OP_LIVE, oxs.oxyii.OP_AUTH, oxs.oxyii.OP_SETUP):
                if data[1] == oxs.oxyii.OP_LIVE:
                    self._cb(0, bytearray(self.live))
                return
            raise RuntimeError("link gone")
    _patch_ring(monkeypatch, _Dead())
    res = _run(oxs.run("AA:BB", None, 0x20, 0x25, dry=False))
    assert res["aborted_at"] == "0x20"


def test_oxyii_reports_an_absent_ring_by_its_real_cause(monkeypatch):
    async def none(_a, timeout=0):
        return None
    monkeypatch.setattr(oxs.BleakScanner, "find_device_by_address", none)
    res = _run(oxs.run("AA:BB", None, 0x20, 0x22, dry=False))
    assert "advertises ONLY while worn" in res["error"]


def test_oxyii_main_dry_run_writes_json(tmp_path, capsys):
    p = str(tmp_path / "o.json")
    assert oxs.main(["--address", "AA:BB", "--dry-run", "--json", p]) == 0
    capsys.readouterr()
    assert "dry_run" in open(p).read()


def test_pmd_a_stale_reply_is_drained_before_the_next_command():
    """Replies are paired by arrival order, so a leftover from a timed-out command would be returned as
    the NEXT opcode's answer — silently attributing one op's behaviour to another."""
    c = _PmdClient(replies={0x05: _ack(0x00, 0x05)})
    cp = pms.Control(c)
    _run(cp.start())
    cp.q.put_nowait(b"\xff\xff")
    assert _run(cp.send(bytes([0x05]))) == _ack(0x00, 0x05)


def test_pmd_an_ok_op_that_changes_nothing_does_not_stop_the_sweep(monkeypatch):
    """Only an ok that MOVES the device aborts. A harmless one must let the table finish."""
    c = _PmdClient(default=0x00)          # every op answers ok, snapshot is constant
    _patch_pmd(monkeypatch, c)
    res = _run(pms.run("AA:BB", None, 0x0B, 0x0E, False, False))
    assert "aborted_at" not in res
    assert len(res["opcodes"]) == 4
    assert res["net_state_change"] == "none"


def test_oxyii_a_stale_frame_is_drained_before_the_next_command(monkeypatch):
    c = _RingClient(responders={0x20})
    r = oxs.Ring(c)
    _run(r.start())
    r.q.put_nowait(b"\xa5\xff\x00")
    got = _run(r.send(0x20))
    assert got is not None and got[1] == 0x20


def test_oxyii_main_checks_the_link_before_sending(monkeypatch, capsys):
    """The daemon holds the ring's link too — the guard must run on the real path, not just the Polar one."""
    called = {"n": 0}
    monkeypatch.setattr(oxs, "require_free_link", lambda: called.__setitem__("n", called["n"] + 1))

    async def none(_a, timeout=0):
        return None
    monkeypatch.setattr(oxs.BleakScanner, "find_device_by_address", none)
    oxs.main(["--address", "AA:BB", "--i-accept-the-risk"])
    capsys.readouterr()
    assert called["n"] == 1
