# tepna-capture — tests/test_probe_verity_offline.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The Phase-1 probe that proved the Verity can be forced to record to its own flash. It WRITES to a
# device, so the properties worth pinning are the safety ones, not the happy path:
#
#   * a bare run must never write — read-only unless --force-record;
#   * it must STOP in a `finally`, including when the start raises, because a probe that can start
#     something it cannot stop fills the device's flash and trips the auto-stop at the memory limit;
#   * `in_charger` must be reported as a DEVICE STATE, not as a failed experiment — a Polar on its dock
#     refuses every PMD start, and reading that as "the mechanism does not work" is how the earlier USB
#     dead end happened;
#   * the verdict must come from the DEVICE's own status, never from the start ACK. An ACK says the
#     request was accepted; only `status` says a recording exists.

import asyncio
import types

import pytest

import polar_pmd as pmd
import probe_verity_offline as probe


def _ack(status=0x00, op=0x02, meas=pmd.ACC):
    return bytes([0xF0, op, meas, status, 0x00])


def _status(**states):
    """Build a status reply from {measurement name: state}."""
    return bytes([(st << 6) | _MEAS[name] for name, st in states.items()])


_MEAS = {v: k for k, v in pmd.MEAS_NAME.items()}


class _FakeClient:
    """A PMD control point that answers from a scripted queue and records what was written."""

    def __init__(self, replies):
        self.replies, self.writes, self._cb = list(replies), [], None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def start_notify(self, _char, cb):
        self._cb = cb

    async def write_gatt_char(self, _char, data, response=False):
        self.writes.append(bytes(data))
        reply = self.replies.pop(0) if self.replies else None
        if reply is not None and self._cb:
            self._cb(0, bytearray(reply))


# ⚠️ THE FAKES ASSERT WHAT THEY ARE HANDED. A `lambda dev, **kw: client` cannot tell `BleakClient(dev)`
# from `BleakClient(None)`, so the whole point of the bonded-address fallback — that the ADDRESS is what
# gets connected when no advertisement was seen — was unobservable. The mutation gate found exactly that
# (`dev = address` → `dev = None` survived), and it is the third time in one session that a fake
# ignoring its arguments hid a real hole. `_seen` records the value so a test can assert on it.
def _install(monkeypatch, client, found=True, addr="AA:BB"):
    seen = {}

    async def find(a, timeout=0):
        assert a == addr, f"the scanner must be asked for {addr}, got {a!r}"
        seen["scanned"] = a
        return object() if found else None

    def _mk(dev, **kw):
        seen["connected_to"] = dev
        return client

    monkeypatch.setattr(probe.BleakScanner, "find_device_by_address", find)
    monkeypatch.setattr(probe, "BleakClient", _mk)
    return seen


def _run(coro):
    return asyncio.run(coro)


def _bonded_says(value, expect="AA:BB"):
    """The bond read must be asked about the DEVICE, not about None — `_is_bonded(address)` →
    `_is_bonded(None)` survived until this asserted it."""
    async def _f(addr):
        assert addr == expect, f"the bond read must be asked about {expect}, got {addr!r}"
        return value
    return _f


# ── read-only by default ─────────────────────────────────────────────────────────────────────────────

def test_a_bare_run_asks_status_and_writes_nothing_else(monkeypatch):
    c = _FakeClient([_status(acc=pmd.NO_MEASUREMENT)])
    _install(monkeypatch, c)
    out = _run(probe.run("AA:BB", None, pmd.ACC, force=False, seconds=1))
    assert out["status_before"]["acc"] == "none"
    assert c.writes == [pmd.status_cmd()], "a read-only run must issue exactly one, read-only command"
    assert "--force-record" in out["verdict"]


def test_no_advertisement_is_NOT_absence_the_bonded_address_still_connects(monkeypatch):
    """A bonded+trusted Polar sitting idle emits no advertisement, so `find_device_by_address` returns
    None while the device is perfectly reachable — BlueZ knows it by path. This used to be reported as
    "device not found — is it advertising, and is the daemon stopped?", sending the operator to inspect
    a daemon that was never involved. Measured 2026-08-10: 20 s scan silent, `bluetoothctl info` saying
    Bonded: yes."""
    seen = _install(monkeypatch, _FakeClient([_status(acc=pmd.NO_MEASUREMENT)]), found=False)
    out = _run(probe.run("AA:BB", None, pmd.ACC, force=False, seconds=1))
    assert "error" not in out, f"a reachable bonded device must not be reported as an error: {out}"
    assert out["reached_by"] == "bonded address (no advertisement seen)"
    assert seen["connected_to"] == "AA:BB", \
        "the ADDRESS is what must be connected when no advertisement was seen — that is the fallback"
    assert out["status_before"]["acc"] == "none", "…and the run proceeds normally"


def test_a_genuinely_unreachable_device_gets_a_DIAGNOSIS_not_a_traceback(monkeypatch):
    """⚠️ THE FALLBACK MUST NOT COST THE CLEAN FAILURE. Handing BleakClient a bare address for an absent
    device raises BleakDeviceNotFoundError out of `__aenter__`; the first cut of the fallback let that
    escape as a stack dump, replacing an actionable sentence. The two states need OPPOSITE actions —
    idle on a wrist (do nothing) vs powered off (press the button) — so the bond state is READ, not
    guessed."""
    class _Refuses:
        async def __aenter__(self):
            raise probe.BleakError("Device with address AA:BB was not found.")

        async def __aexit__(self, *a):
            return False

    _install(monkeypatch, _Refuses(), found=False)
    monkeypatch.setattr(probe, "_is_bonded", _bonded_says(True))
    out = _run(probe.run("AA:BB", None, pmd.ACC, force=False, seconds=1))
    assert "could not reach the device" in out["error"], out
    assert out["bonded"] is True
    assert "POWERED OFF" in out["diagnosis"], "the actionable half — press its button"

    _install(monkeypatch, _Refuses(), found=False)
    monkeypatch.setattr(probe, "_is_bonded", _bonded_says(False))
    out = _run(probe.run("AA:BB", None, pmd.ACC, force=False, seconds=1))
    assert "not bonded" in out["diagnosis"], "an unpaired device needs pairing, not a button press"


# ── the forced path ──────────────────────────────────────────────────────────────────────────────────

def test_a_confirmed_recording_is_confirmed_by_the_DEVICE_not_by_the_ack(monkeypatch):
    c = _FakeClient([
        _status(acc=pmd.NO_MEASUREMENT),                     # status_before
        _ack(0x00, op=0x03),                                 # pre-stop
        b"\xf0\x01\x02\x00\x00",                             # get_settings (empty -> fixed START)
        _ack(0x00),                                          # start
        _status(acc=pmd.OFFLINE_ACTIVE),                     # status_during
        _status(acc=pmd.OFFLINE_ACTIVE),                     # status re-read for the verdict
        _ack(0x00, op=0x03),                                 # stop
        _status(acc=pmd.NO_MEASUREMENT),                     # status_after
    ])
    _install(monkeypatch, c)
    out = _run(probe.run("AA:BB", None, pmd.ACC, force=True, seconds=0))
    assert out["recording_confirmed_by_device"] is True
    assert "CONFIRMED" in out["verdict"]
    assert out["status_after"]["acc"] == "none", "it must leave the device as it found it"


def test_an_ok_ack_without_a_recording_is_not_reported_as_success(monkeypatch):
    """The dangerous false positive: the device accepts the request and records nothing."""
    c = _FakeClient([
        _status(acc=pmd.NO_MEASUREMENT), _ack(0x00, op=0x03), b"\xf0\x01\x02\x00\x00", _ack(0x00),
        _status(acc=pmd.NO_MEASUREMENT), _status(acc=pmd.NO_MEASUREMENT),
        _ack(0x00, op=0x03), _status(acc=pmd.NO_MEASUREMENT),
    ])
    _install(monkeypatch, c)
    out = _run(probe.run("AA:BB", None, pmd.ACC, force=True, seconds=0))
    assert out["recording_confirmed_by_device"] is False
    assert "CONFIRMED" not in out["verdict"]
    assert "does not report recording" in out["verdict"]


def test_in_charger_is_reported_as_a_device_state_not_a_protocol_failure(monkeypatch):
    c = _FakeClient([
        _status(acc=pmd.NO_MEASUREMENT), _ack(0x00, op=0x03), b"\xf0\x01\x02\x00\x00", _ack(0x0D),
        _ack(0x00, op=0x03), _status(acc=pmd.NO_MEASUREMENT),
    ])
    _install(monkeypatch, c)
    out = _run(probe.run("AA:BB", None, pmd.ACC, force=True, seconds=0))
    assert "IN THE CHARGER" in out["verdict"]
    assert "not a protocol failure" in out["verdict"]
    assert out["start_ack"] == "in_charger"


def test_the_start_command_carries_the_recording_bit(monkeypatch):
    c = _FakeClient([
        _status(acc=pmd.NO_MEASUREMENT), _ack(0x00, op=0x03), b"\xf0\x01\x02\x00\x00", _ack(0x00),
        _status(acc=pmd.OFFLINE_ACTIVE), _status(acc=pmd.OFFLINE_ACTIVE),
        _ack(0x00, op=0x03), _status(acc=pmd.NO_MEASUREMENT),
    ])
    _install(monkeypatch, c)
    out = _run(probe.run("AA:BB", None, pmd.ACC, force=True, seconds=0))
    sent = bytes.fromhex(out["start_cmd"])
    assert sent[0] == 0x02 and sent[1] == pmd.ACC | 0x80


def test_every_stop_written_is_the_bare_type(monkeypatch):
    """Hardware refuses `03 82` with GATT Unlikely Error. Pinned here so the probe can never re-learn
    it the expensive way."""
    c = _FakeClient([
        _status(acc=pmd.NO_MEASUREMENT), _ack(0x00, op=0x03), b"\xf0\x01\x02\x00\x00", _ack(0x00),
        _status(acc=pmd.OFFLINE_ACTIVE), _status(acc=pmd.OFFLINE_ACTIVE),
        _ack(0x00, op=0x03), _status(acc=pmd.NO_MEASUREMENT),
    ])
    _install(monkeypatch, c)
    _run(probe.run("AA:BB", None, pmd.ACC, force=True, seconds=0))
    stops = [w for w in c.writes if w and w[0] == 0x03]
    assert stops, "no stop was issued"
    for w in stops:
        assert w == bytes([0x03, pmd.ACC]), f"stop carried the recording bit: {w.hex()}"


def test_the_device_is_stopped_even_when_the_run_raises(monkeypatch):
    """The property that matters most: a probe that starts a recording it cannot stop leaves the flash
    filling until the device auto-stops mid-night."""
    c = _FakeClient([
        _status(acc=pmd.NO_MEASUREMENT), _ack(0x00, op=0x03), b"\xf0\x01\x02\x00\x00", _ack(0x00),
    ])
    _install(monkeypatch, c)

    async def boom(_):
        raise RuntimeError("link dropped mid-recording")
    monkeypatch.setattr(probe.asyncio, "sleep", boom)
    with pytest.raises(RuntimeError):
        _run(probe.run("AA:BB", None, pmd.ACC, force=True, seconds=5))
    assert any(w == bytes([0x03, pmd.ACC]) for w in c.writes), "no STOP after the failure"


def test_a_measurement_with_no_start_command_is_refused(monkeypatch):
    c = _FakeClient([_status(), _ack(0x00, op=0x03), b"\xf0\x01\x02\x00\x00"])
    _install(monkeypatch, c)
    monkeypatch.setattr(probe.pmd, "build_start", lambda *a, **k: None)
    monkeypatch.setattr(probe.pmd, "START", {})
    out = _run(probe.run("AA:BB", None, pmd.ACC, force=True, seconds=0))
    assert "no START command" in out["error"]


# ── the small pure helpers ───────────────────────────────────────────────────────────────────────────

def test_a_missing_reply_is_no_response_not_a_guess():
    assert probe._ack_status(None) == (pmd.NO_ACK, "no_response")
    assert probe._status_of(None) == {"error": "no reply to status"}


def test_the_ack_status_is_read_from_the_envelope_when_present():
    assert probe._ack_status(_ack(0x0D))[1] == "in_charger"
    assert probe._ack_status(b"\x00")[1] == "ok", "a bare reply falls back to its last byte"


def test_an_unknown_status_code_is_named_rather_than_hidden():
    assert "unknown_0x7f" in probe._ack_status(_ack(0x7F))[1]


def test_a_control_timeout_yields_none_rather_than_hanging(monkeypatch):
    c = _FakeClient([])                                   # never answers
    ctl = probe._Control(c)
    _run(ctl.start())
    assert _run(ctl.send(b"\x05", timeout=0.01)) is None


def test_stale_replies_are_dropped_before_the_next_command(monkeypatch):
    c = _FakeClient([_ack(0x00)])
    ctl = probe._Control(c)
    _run(ctl.start())
    ctl.q.put_nowait(b"\xff\xff")                          # a leftover from a previous command
    got = _run(ctl.send(b"\x05"))
    assert got == _ack(0x00), "a stale reply was returned as this command's answer"


# ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────

def test_main_prints_the_verdict_and_exits_zero(monkeypatch, capsys):
    async def fake(*a, **k):
        return {"verdict": "FORCED RECORDING CONFIRMED"}
    monkeypatch.setattr(probe, "run", fake)
    assert probe.main(["--address", "AA:BB"]) == 0
    assert "CONFIRMED" in capsys.readouterr().out


def test_main_exits_nonzero_when_the_probe_could_not_run(monkeypatch, capsys):
    async def fake(*a, **k):
        return {"error": "device not found"}
    monkeypatch.setattr(probe, "run", fake)
    assert probe.main(["--address", "AA:BB"]) == 1
    assert "not found" in capsys.readouterr().out


def test_the_default_target_is_acc_because_recording_removes_the_live_stream(monkeypatch):
    """Defaulting to PPG would silently kill the stream the whole backup exists to protect (§2)."""
    seen = {}

    async def fake(address, adapter, meas, force, seconds):
        seen["meas"] = meas
        return {"verdict": "x"}
    monkeypatch.setattr(probe, "run", fake)
    probe.main(["--address", "AA:BB"])
    assert seen["meas"] == pmd.ACC


# ── the bond read itself ─────────────────────────────────────────────────────────────────────────────
# The tests above monkeypatch `_is_bonded`, so its own body never ran. That body is what decides
# between "press the button" and "pair it first" — opposite ends of the room for the operator — so it
# needs its own cases, including the one where bluetoothctl cannot be asked at all.

def _bluetoothctl(monkeypatch, *, stdout="", raises=None):
    def _run(cmd, capture_output=False, text=False, timeout=None):
        assert cmd[:2] == ["bluetoothctl", "info"], f"unexpected command {cmd}"
        assert timeout, "an unbounded bluetoothctl would hang the diagnosis it exists to produce"
        if raises:
            raise raises
        return types.SimpleNamespace(stdout=stdout)
    monkeypatch.setattr(probe.subprocess, "run", _run)


def test_bond_read_reports_TRUE_on_a_bonded_device(monkeypatch):
    _bluetoothctl(monkeypatch, stdout="Device AA:BB\n\tPaired: yes\n\tBonded: yes\n\tTrusted: yes\n")
    assert _run(probe._is_bonded("AA:BB")) is True


def test_bond_read_reports_FALSE_when_paired_but_not_bonded(monkeypatch):
    """`Paired: yes` is not `Bonded: yes` — polar_mirror's header records that the two diverge and that
    PS-FTP fails on the difference. Matching the wrong word here would call an unpairable device ready."""
    _bluetoothctl(monkeypatch, stdout="Device AA:BB\n\tPaired: yes\n\tBonded: no\n")
    assert _run(probe._is_bonded("AA:BB")) is False


def test_bond_read_reports_UNKNOWN_when_bluetoothctl_cannot_be_asked(monkeypatch):
    """⚠️ None, not False. "I could not find out" and "it is not bonded" prescribe different actions,
    and defaulting to False would tell the operator to re-pair a device that is already paired."""
    _bluetoothctl(monkeypatch, raises=FileNotFoundError("bluetoothctl"))
    assert _run(probe._is_bonded("AA:BB")) is None
