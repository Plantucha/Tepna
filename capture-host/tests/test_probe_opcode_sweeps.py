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
import json

import pytest

import polar_pmd as pmd
import probe_oxyii_opcodes as oxs
import probe_pmd_opcodes as pms


def _run(c):
    return asyncio.run(c)


@pytest.fixture(autouse=True)
def _no_baseline_wait(monkeypatch):
    """The ~1 s spacing between baseline samples matches the ring's 1 Hz frame cadence — a hardware fact,
    not a test fact. The COUNT still applies, so the sampling logic is exercised for real."""
    monkeypatch.setattr(oxs, "BASELINE_GAP_S", 0.0)


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


class _Live(_RingClient):
    """A ring whose live frame is built per-call: `noisy` bytes churn on their own, and an opcode in
    `effects` permanently rewrites a byte. That separates the two things the detector must tell apart."""

    def __init__(self, noisy=(), effects=None, scratch=None, drift=None, **kw):
        super().__init__(**kw)
        self.noisy, self.effects, self.applied, self.tick = set(noisy), effects or {}, {}, 0
        self.scratch = scratch          # a byte ANY command write perturbs — device state it is not
        self.drift = drift              # a byte that wanders slowly, like SpO2 over a long sweep
        self.nth_cmd = self.reads = 0

    HDR = 7                                             # [A5, op, ~op, flag, seq, len_lo, len_hi]

    def _frame(self):
        """A REAL frame — built through oxyii.encode, so the reassembler accepts it and the trailing
        CRC moves with the payload exactly as the device's does (and is excluded as volatile for it)."""
        p = bytearray(b"\x00\x00\x00\x00\xc7\x00\x62\x48\x00\x00\x00\x00")
        self.tick += 1
        if self.drift is not None:
            self.reads += 1
            # holds still for the ~10-sample null, then wanders — exactly SpO2's behaviour
            p[self.drift - self.HDR] = (0x62 - max(0, self.reads - 10)) & 0xFF
        for i in self.noisy:                            # `i` is a FRAME index, as the report reports
            p[i - self.HDR] = (self.tick * 37 + i) & 0xFF
        for i, v in self.applied.items():
            p[i - self.HDR] = v
        return oxs.oxyii.encode(oxs.oxyii.OP_LIVE, bytes(p))

    async def write_gatt_char(self, _c, data, response=False):
        op = data[1]
        self.writes.append(op)
        if op == oxs.oxyii.OP_LIVE:
            self._cb(0, bytearray(self._frame()))
        else:
            if self.scratch is not None:            # every command moves it, documented ones included
                self.nth_cmd += 1
                self.applied[self.scratch] = (0x30 + self.nth_cmd) & 0xFF
            if op in self.effects:
                self.applied.update(self.effects[op])
            if op in self.effects or op in self.responders:
                self._cb(0, bytearray(oxs.oxyii.encode(op, b"\x01")))


def test_oxyii_a_self_churning_live_frame_is_not_read_as_an_effect(monkeypatch):
    """THE FALSE POSITIVE. Measured 2026-08-03 on a WORN ring: 4 of 4 consecutive frames differ with
    NOTHING sent — plethysmogram, sequence counter, checksum. The old detector compared raw frames and
    tripped on the very first opcode swept, which would have condemned an innocent op and stopped the
    sweep 247 opcodes early."""
    c = _Live(noisy={8, 9, 10}, responders={0x20, 0x21, 0x22})
    _patch_ring(monkeypatch, c)
    res = _run(oxs.run("AA:BB", None, 0x20, 0x22, dry=False))
    assert "aborted_at" not in res, "self-churn must not be attributed to an opcode"
    assert res["baseline"]["volatile_bytes"] == [8, 9, 10, 19], "the CRC moves with them"
    assert len(res["opcodes"]) == 3


def test_oxyii_aborts_when_a_byte_that_held_constant_moves(monkeypatch):
    """The real signal, buried in that churn: byte 11 held `c7` across the baseline and went to `00`."""
    c = _Live(noisy={8, 9, 10}, effects={0x20: {11: 0x00}})
    _patch_ring(monkeypatch, c)
    res = _run(oxs.run("AA:BB", None, 0x20, 0x25, dry=False))
    assert res["aborted_at"] == "0x20"
    assert res["opcodes"]["0x20"]["state_changed"] == {
        "byte_positions": [11], "before": [0xC7], "after": [0x00]}
    assert "did NOT move again under the control command" in res["abort_reason"]


def test_oxyii_publishes_how_little_the_detector_could_watch(monkeypatch):
    """When the whole PAYLOAD churns, the only stable bytes left are the fixed frame header — which can
    never move, so the detector cannot fail and every opcode would come back 'nothing changed'. The tool
    cannot know that the header is structural, so it does not pretend to; what it must do is publish the
    stable/volatile split so a reader can see the verdict rests on 7 header bytes and discount it."""
    c = _Live(noisy=range(7, 19), responders={0x20})
    _patch_ring(monkeypatch, c)
    res = _run(oxs.run("AA:BB", None, 0x20, 0x25, dry=False))
    assert "aborted_at" not in res
    assert res["baseline"]["stable_bytes"] == 7, "only [A5, op, ~op, flag, seq, len_lo, len_hi]"
    assert res["baseline"]["volatile_bytes"] == list(range(7, 20))


def test_oxyii_a_short_reply_cannot_be_read_past_its_end():
    """A truncated live frame must not index off the end of the shorter buffer."""
    base = bytes([0xA5, 0x04, 0xFB, 0x01, 0x00, 0x02, 0x00, 0x11, 0x22, 0x00])
    assert oxs._changed(base, "a504fb", [0, 1, 2, 8]) == []
    assert oxs._changed(base, None, [0, 1]) == []
    assert oxs._changed(None, "a504fb", [0]) == []


def test_oxyii_a_ring_that_never_answers_live_leaves_the_detector_blind(monkeypatch):
    class _NoLive(_RingClient):
        async def write_gatt_char(self, _c, data, response=False):
            self.writes.append(data[1])
    _patch_ring(monkeypatch, _NoLive())
    res = _run(oxs.run("AA:BB", None, 0x20, 0x22, dry=False))
    assert "detector_blind" in res and res["live_before"] is None


def test_oxyii_a_write_failure_stops_the_sweep(monkeypatch):
    class _Dead(_RingClient):
        async def write_gatt_char(self, _c, data, response=False):
            # Handshake and snapshot must work; only the swept opcode kills the link.
            if data[1] in (oxs.oxyii.OP_LIVE, oxs.oxyii.OP_AUTH, oxs.oxyii.OP_SETUP, oxs.CONTROL_OP):
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
    assert "advertises while WORN" in res["error"] and "scan_errors" not in res


class _DiesOnNthLive(_RingClient):
    """A ring whose link goes away on the Nth LIVE frame — the snapshot, not the swept opcode."""

    def __init__(self, nth, **kw):
        super().__init__(**kw)
        self.nth, self.n_live = nth, 0

    async def write_gatt_char(self, _c, data, response=False):
        op = data[1]
        self.writes.append(op)
        if op == oxs.oxyii.OP_LIVE:
            self.n_live += 1
            if self.n_live >= self.nth:
                raise RuntimeError("Service Discovery has not been performed yet")
            self._cb(0, bytearray(self.live))
        elif op in self.responders:
            self._cb(0, bytearray(oxs.oxyii.encode(op, b"\x01")))


def test_oxyii_a_link_lost_on_the_closing_snapshot_does_not_discard_the_sweep(monkeypatch):
    """THE REGRESSION. Measured 2026-08-03: a full 248-opcode sweep reached its closing snapshot, the
    link had gone, and the raised error propagated out of run() before main() could write the JSON — ten
    minutes of hardware evidence lost on the last line, against a device reachable only while worn."""
    c = _DiesOnNthLive(nth=11, responders=set())   # 10 null samples, then the closing one
    _patch_ring(monkeypatch, c)
    res = _run(oxs.run("AA:BB", None, 0x20, 0x24, dry=False))
    assert len(res["opcodes"]) == 5, "every opcode probed must survive the closing failure"
    assert "Service Discovery" in res["link_lost"]
    assert res["responders"] == []
    assert "live_before" in res


def test_oxyii_a_link_lost_mid_verification_keeps_the_ops_already_mapped(monkeypatch):
    """The verification snapshot runs inside the loop. A link dying there must cost that op, not the
    table built before it."""
    c = _DiesOnNthLive(nth=11, responders={0x21})  # 10 null samples, then 0x21 replies -> snapshot dies
    _patch_ring(monkeypatch, c)
    res = _run(oxs.run("AA:BB", None, 0x20, 0x25, dry=False))
    assert res["opcodes"]["0x20"]["replied"] is False, "the op mapped before the failure is kept"
    assert res["aborted_at"] == "0x21"
    assert "Service Discovery" in res["opcodes"]["0x21"]["error"]


def test_oxyii_main_signals_a_lost_link_in_its_exit_code(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(oxs, "require_free_link", lambda: None)
    _patch_ring(monkeypatch, _DiesOnNthLive(nth=11, responders=set()))
    p = str(tmp_path / "o.json")
    assert oxs.main(["--address", "AA:BB", "--i-accept-the-risk", "--from", "0x20", "--to", "0x22",
                     "--json", p]) == 1
    capsys.readouterr()
    assert len(json.load(open(p))["opcodes"]) == 3, "the report is written even when the link died"


def test_oxyii_probes_the_neighbourhoods_of_known_opcodes_first():
    """A linear 0x00-upward crawl spends a 10-minute window on empty space against a device reachable
    only while worn or charging. Firmware command spaces cluster, so an unknown SIBLING of a documented
    opcode is the better bet — every neighbourhood must land in the first handful of probes."""
    p = oxs.plan_ops(0x00, 0xFF)
    assert p[:8] == [0x03, 0x05, 0x0F, 0x11, 0xBF, 0xC1, 0xF0, 0xF5], "the ±1 ring around every known op"
    assert len(p) == 256 - len(oxs.KNOWN)
    assert not (set(p) & set(oxs.KNOWN))
    # Every immediate neighbour of a documented opcode that is not itself documented. (0xF1-0xF4 are
    # contiguous, so 0xF2's neighbours ARE known and are correctly absent from the plan entirely.)
    adjacent = {a for k in oxs.KNOWN for a in (k - 1, k + 1) if 0 <= a <= 0xFF} - set(oxs.KNOWN)
    assert adjacent <= set(p[:40]), f"left for the tail: {sorted(adjacent - set(p[:40]))}"


def test_oxyii_a_characterised_opcode_is_not_fired_again():
    """0x00 replies AND moves a status byte, so it trips the abort every run and stops the sweep before
    the rest of the space is reached. Re-firing it buys nothing and costs the whole window."""
    assert 0x00 not in oxs.plan_ops(0x00, 0xFF, skip={0x00})
    assert 0x00 in oxs.plan_ops(0x00, 0xFF)


def test_oxyii_max_ops_truncates_without_losing_a_neighbourhood():
    p = oxs.plan_ops(0x00, 0xFF, limit=8)
    assert len(p) == 8 and p == oxs.plan_ops(0x00, 0xFF)[:8], "a short run is a prefix, so it resumes"


def test_oxyii_main_passes_the_plan_controls_through(monkeypatch, capsys):
    seen = {}

    async def fake(address, adapter, lo, hi, dry, limit=None, skip=()):
        seen.update(lo=lo, hi=hi, limit=limit, skip=list(skip))
        return {"ok": True}
    monkeypatch.setattr(oxs, "run", fake)
    assert oxs.main(["--address", "AA:BB", "--dry-run", "--max-ops", "12", "--skip", "0x00,0x3"]) == 0
    capsys.readouterr()
    assert seen == {"lo": 0x00, "hi": 0xFF, "limit": 12, "skip": [0x00, 0x03]}


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


class _WedgedAdapter:
    """A BlueZ that raises InProgress until the adapter is cycled — the real failure, exactly."""

    def __init__(self, fails=2):
        self.fails, self.calls, self.cycles = fails, 0, 0

    async def find(self, _a, timeout=0):
        self.calls += 1
        if self.calls <= self.fails:
            raise RuntimeError("[org.bluez.Error.InProgress] Operation already in progress")
        return object()


def test_oxyii_a_wedged_adapter_is_cycled_and_the_scan_retried(monkeypatch):
    """The adapter wedges on EVERY disconnect and does not admit it — `bluetoothctl show` still says
    `Discovering: no`. Left alone it reads as "the ring is not advertising", sending the reader after the
    device instead of the host."""
    w, c = _WedgedAdapter(fails=2), _Live()
    monkeypatch.setattr(oxs.BleakScanner, "find_device_by_address", w.find)
    monkeypatch.setattr(oxs, "BleakClient", lambda dev, **kw: c)
    cycled = {"n": 0}

    async def cycle():
        cycled["n"] += 1
        return True
    monkeypatch.setattr(oxs, "_cycle_adapter", cycle)
    res = _run(oxs.run("AA:BB", None, 0x20, 0x21, dry=False))
    assert cycled["n"] == 2, "each refused scan must be followed by a cycle"
    assert len(res["scan_errors"]) == 2 and "InProgress" in res["scan_errors"][0]
    assert len(res["opcodes"]) == 2, "and the sweep then runs normally"


def test_oxyii_a_scan_that_never_recovers_reports_the_host_not_the_device(monkeypatch):
    """This call sits before the sweep, so an unguarded raise here wrote NO report at all — it killed a
    resumed sweep before a single opcode was sent."""
    w = _WedgedAdapter(fails=99)
    monkeypatch.setattr(oxs.BleakScanner, "find_device_by_address", w.find)

    async def cycle():
        return True
    monkeypatch.setattr(oxs, "_cycle_adapter", cycle)
    res = _run(oxs.run("AA:BB", None, 0x20, 0x21, dry=False))
    assert res["error"] == "adapter refused to scan — see scan_errors"
    assert len(res["scan_errors"]) == 3


def test_oxyii_the_adapter_cycle_is_best_effort(monkeypatch):
    async def spawn(*cmd, **kw):
        class _P:
            async def wait(self):
                return 0
        return _P()

    async def nosleep(_s):
        return None
    monkeypatch.setattr(oxs.asyncio, "create_subprocess_exec", spawn)
    monkeypatch.setattr(oxs.asyncio, "sleep", nosleep)
    assert _run(oxs._cycle_adapter()) is True

    async def boom(*a, **k):
        raise FileNotFoundError("bluetoothctl")
    monkeypatch.setattr(oxs.asyncio, "create_subprocess_exec", boom)
    assert _run(oxs._cycle_adapter()) is False


def test_oxyii_a_byte_that_any_command_perturbs_cannot_convict_an_opcode(monkeypatch):
    """THE SECOND FALSE POSITIVE, and the worse one because the first fix made the detector look
    rigorous. Live-frame byte 17 sat at 0xc7 across every PASSIVE sample — 34 of 34 bytes "stable" on a
    docked ring — and moved for 0x00, 0x03 and 0x06, reported as three findings. Then 0xF1 (FILE_LIST:
    documented, read-only, and on a worn ring it does not even reply) moved it too. A passive null
    cannot see a byte that the ACT OF COMMANDING writes, so the null now fires a control command."""
    c = _Live(scratch=11, responders={0x20, 0x21})
    _patch_ring(monkeypatch, c)
    res = _run(oxs.run("AA:BB", None, 0x20, 0x21, dry=False))
    assert 11 in res["baseline"]["volatile_bytes"], "the scratch byte must be disqualified"
    assert "aborted_at" not in res, "and must not convict an opcode"
    assert res["baseline"]["control_op"] == "0xf1"


def test_oxyii_a_real_effect_still_convicts_alongside_a_scratch_byte(monkeypatch):
    """Disqualifying the scratch byte must not blind the detector to a genuine change."""
    c = _Live(scratch=11, effects={0x21: {12: 0x99}}, responders={0x20})
    _patch_ring(monkeypatch, c)
    res = _run(oxs.run("AA:BB", None, 0x20, 0x25, dry=False))
    assert res["aborted_at"] == "0x21"
    assert res["opcodes"]["0x21"]["state_changed"]["byte_positions"] == [12]


def test_oxyii_a_drifting_vital_sign_is_adjudicated_not_convicted(monkeypatch):
    """The null lasts ~10 s; the sweep lasts minutes. On a WORN ring SpO2 holds still across the null and
    then drifts on its own — measured 2026-08-03, the sweep stopped at 0x02 on byte 13 going 98 -> 95,
    which is SpO2 doing what SpO2 does. A byte that keeps moving across a documented read-only command is
    drifting, not responding."""
    c = _Live(drift=13, responders={0x20, 0x21, 0x22})
    _patch_ring(monkeypatch, c)
    res = _run(oxs.run("AA:BB", None, 0x20, 0x22, dry=False))
    assert "aborted_at" not in res, "drift must not convict an opcode"
    # 19 is the frame CRC, which follows any payload change — the real device does this too
    assert res["opcodes"]["0x20"]["drift_suspected"]["byte_positions"] == [13, 19]
    assert len(res["opcodes"]) == 3, "and the sweep must carry on"


def test_oxyii_a_real_effect_survives_the_drift_adjudication(monkeypatch):
    """A one-shot change does NOT recur under the control command, so it still convicts."""
    c = _Live(effects={0x21: {12: 0x99}}, responders={0x20})
    _patch_ring(monkeypatch, c)
    res = _run(oxs.run("AA:BB", None, 0x20, 0x25, dry=False))
    assert res["aborted_at"] == "0x21"
    assert res["opcodes"]["0x21"]["state_changed"]["byte_positions"] == [12, 19]   # 19 = the CRC
    assert "drift_suspected" not in res["opcodes"]["0x21"]
