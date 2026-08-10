# tepna-capture — tests/test_sdk_mode.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""SDK mode, end to end: the wire commands, the daemon's entry, and the monitor's switch.

WHY THIS EXISTS AT ALL. The Verity offers PPG at 55 Hz and nothing else until it is put into SDK mode,
where the menu becomes 28/44/55/135/176. `polar_pmd.chosen_rate` honours a configured rate ONLY if the
device offers it and otherwise falls back silently — by design, because a rate the firmware rejects
would leave a permanently idle stream. The two behaviours compose into the failure this file guards:
`rates: {ppg: 176}` with no SDK mode captures the whole night at 55 Hz, writes no warning, and leaves
every card green. It happened on 2026-08-03 and took a file-by-file rate audit to notice.

THE RULE EVERY TEST HERE ENFORCES IS THE SAME ONE: **an ACK is not a state.** This device accepts
`SET_LOCAL_TIME`, echoes it back verbatim, and goes on stamping samples from a different clock
(POLAR-PMD-COMMAND-SURFACE §2.1). So SDK mode is confirmed by asking the device, and a device that does
not answer yields `None` — never `False`.
"""
import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import capture  # noqa: E402
import polar_pmd as pmd  # noqa: E402
from tests.test_webmon_api import _mk, _serve  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_capture_runners as T  # noqa: E402

# ⚠️ ADOPT THE AUTOUSE RESET, do not re-implement it. `run_polar` mutates a lot of process-wide state
# and `capture.STATUS` is module-global, so without this the first runner test below leaves
# `sdk_mode` set and the next two assert against ITS leftovers rather than their own device — which is
# precisely how they first failed. Assigning the fixture object makes it autouse in this module too;
# `test_run_polar_live_contract.py` does the same, for the same reason.
_clean_stop = T._clean_stop


# ── the wire commands ───────────────────────────────────────────────────────────────────────────────
def test_sdk_mode_start_and_stop_are_the_ordinary_opcodes_against_type_9():
    """Measured on hardware (POLAR-VERITY-DEVICE-SURFACE §4). Not a new opcode — START/STOP at 0x09."""
    assert pmd.sdk_mode_cmd(True) == bytes([0x02, 0x09])
    assert pmd.sdk_mode_cmd(False) == bytes([0x03, 0x09])


def test_sdk_mode_is_not_a_measurement_and_must_never_be_offered_as_a_stream():
    """`webmon` decides what is capturable with `not str(x).startswith('0x')`, so naming 0x09 in
    MEAS_NAME would put a device MODE in front of the user as a checkbox that can never capture."""
    assert pmd.SDK_MODE not in pmd.MEAS_NAME
    assert pmd.SDK_MODE == 0x09


@pytest.mark.parametrize("reply,expect", [
    (bytes([0xF0, 0x06, 0x09, 0x00, 0x00, 0x01]), True),    # the real shape, measured
    (bytes([0xF0, 0x06, 0x09, 0x00, 0x00, 0x00]), False),
    (bytes([0xF0, 0x06, 0x09, 0x03, 0x00, 0x01]), None),    # non-zero status = an error, not an answer
    (bytes([0xF0, 0x01, 0x09, 0x00, 0x00, 0x01]), None),    # a different command's reply
    (bytes([0x01, 0x06, 0x09, 0x00]), None),                # a device PUSH, not a response
    (bytes([0xF0, 0x06]), None),                            # too short to carry a status
    (b"", None),                                            # no answer at all
])
def test_sdk_mode_status_reports_unknown_as_None_never_as_off(reply, expect):
    """⚠️ `None` IS NOT `False`. A device that said nothing has told us nothing — reporting that as
    "off" makes the daemon re-send the enter command every cycle to a device already in SDK mode, and
    publishes `sdk_mode: false` while the negotiated rates say otherwise."""
    assert pmd.parse_sdk_mode_status(reply) is expect


# ── the daemon's entry ──────────────────────────────────────────────────────────────────────────────
class _Ctrl:
    """A control point that answers each command from a script, and records what it was asked."""

    def __init__(self, on_start=0x00, status_reply=bytes([0xF0, 0x06, 0x09, 0x00, 0x00, 0x01])):
        self.sent, self._on_start, self._status = [], on_start, status_reply

    async def __call__(self, cmd):
        self.sent.append(bytes(cmd))
        if cmd[:1] == bytes([0x06]):
            return self._status
        return bytes([0xF0, cmd[0], cmd[1] if len(cmd) > 1 else 0, self._on_start, 0x00])


def _run(coro):
    return asyncio.run(coro)


def test_entering_sdk_mode_asks_the_device_rather_than_trusting_its_own_ack():
    c = _Ctrl()
    assert _run(capture._enter_sdk_mode(c, "Verity")) is True
    assert c.sent[0] == pmd.sdk_mode_cmd(True), "it starts SDK mode"
    assert pmd.sdk_mode_status_cmd() in c.sent, "…and then ASKS whether it is on"


def test_a_device_that_acks_but_reports_off_is_reported_OFF():
    """The whole point. A green ACK with the mode not actually set is the silent-55-Hz night."""
    c = _Ctrl(status_reply=bytes([0xF0, 0x06, 0x09, 0x00, 0x00, 0x00]))
    assert _run(capture._enter_sdk_mode(c, "Verity")) is False


def test_a_device_that_never_reports_its_mode_is_UNKNOWN_not_off():
    c = _Ctrl(status_reply=b"")
    assert _run(capture._enter_sdk_mode(c, "Verity")) is None


def test_already_in_that_mode_is_success_not_a_failure(caplog):
    """`already_streaming` against a mode means the device is already in it — which is what was
    asked for. Warning about it would train the operator to ignore the log."""
    c = _Ctrl(on_start=pmd.ALREADY_STREAMING)
    with caplog.at_level("WARNING"):
        assert _run(capture._enter_sdk_mode(c, "Verity")) is True
    assert not [r for r in caplog.records if "SDK mode START" in r.message]


def test_invalid_state_is_warned_about_by_name_because_is_transient_hides_it(caplog):
    """0x0C means a stream was still running, so the device stayed on its NORMAL menu. It is a member
    of `TRANSIENT_STATUS`, so any caller consulting only `is_transient` files it as "retry later" and
    never learns it captured the night at 55 Hz."""
    c = _Ctrl(on_start=pmd.INVALID_STATE, status_reply=bytes([0xF0, 0x06, 0x09, 0x00, 0x00, 0x00]))
    with caplog.at_level("WARNING"):
        assert _run(capture._enter_sdk_mode(c, "Verity")) is False
    assert any("invalid_state" in r.message and "55" in r.message for r in caplog.records), \
        "the warning must name the consequence, not just the status code"
    assert pmd.INVALID_STATE in pmd.TRANSIENT_STATUS, "…which is exactly why it needs its own warning"


def test_an_unexpected_refusal_is_warned_about(caplog):
    c = _Ctrl(on_start=0x03, status_reply=b"")              # not_supported
    with caplog.at_level("WARNING"):
        _run(capture._enter_sdk_mode(c, "Verity"))
    assert any("not_supported" in r.message for r in caplog.records)


# ── the monitor's switch ────────────────────────────────────────────────────────────────────────────
_VERITY = {"name": "Verity", "vendor": "Polar", "model": "VeritySense", "device_id": "0C301E3F",
           "address": "24:AC:AC:0C:30:1E", "streams": ["ppg"], "rates": {}}
_SUPPORTED = ["ppg", "acc", "0x9", "0xd", "0xe"]


def _settings(tmp_path, devices, status=None):
    app, cfg, *_ = _mk(tmp_path, devices=devices, status=status)

    async def go(c):
        return await (await c.get("/api/settings")).json()
    return _serve(app, go), cfg


def _post(tmp_path, body, devices, status=None):
    app, cfg, *_ = _mk(tmp_path, devices=devices, status=status)

    async def go(c):
        r = await c.post("/api/settings", json=body)
        return r.status, await r.json()
    return _serve(app, go), cfg


def test_the_switch_is_offered_only_where_the_device_advertises_feature_0x9(tmp_path):
    """A switch that cannot work is worse than an absent one: the operator sets it and the config then
    claims a mode the hardware never had."""
    body, _ = _settings(tmp_path, [_VERITY], {"Verity": {"pmd_supported": _SUPPORTED}})
    assert body["devices"][0]["sdk_capable"] is True
    body, _ = _settings(tmp_path, [_VERITY], {"Verity": {"pmd_supported": ["ppg", "acc"]}})
    assert body["devices"][0]["sdk_capable"] is False


def test_capability_survives_the_device_being_asleep(tmp_path):
    """`pmd_supported_seen` is what the last connect saw. Without the fallback the switch vanishes from
    the page whenever the armband is on its charger, which is exactly when it gets configured."""
    dev = {**_VERITY, "pmd_supported_seen": _SUPPORTED}
    body, _ = _settings(tmp_path, [dev], {})
    assert body["devices"][0]["sdk_capable"] is True


def test_the_page_separates_what_was_ASKED_from_what_the_device_SAID(tmp_path):
    dev = {**_VERITY, "sdk_mode": True}
    body, _ = _settings(tmp_path, [dev], {"Verity": {"pmd_supported": _SUPPORTED, "sdk_mode": None}})
    d = body["devices"][0]
    assert d["sdk_mode"] is True, "the config's request"
    assert d["sdk_mode_actual"] is None, "…and the device never confirmed it — not the same thing"


def test_enabling_it_is_persisted_and_asks_for_a_reconnect(tmp_path):
    (st, body), cfg = _post(tmp_path, {"sdk_mode": {"24:AC:AC:0C:30:1E": True}}, [_VERITY],
                            {"Verity": {"pmd_supported": _SUPPORTED}})
    assert st == 200 and body["ok"] is True
    assert cfg["devices"][0]["sdk_mode"] is True
    assert body["restart_needed"] is True, "the mode is entered during PMD negotiation, i.e. at connect"


def test_enabling_it_on_hardware_that_does_not_advertise_it_is_REFUSED(tmp_path):
    (st, body), cfg = _post(tmp_path, {"sdk_mode": {"24:AC:AC:0C:30:1E": True}}, [_VERITY],
                            {"Verity": {"pmd_supported": ["ppg", "acc"]}})
    assert st == 400 and "SDK mode" in body["error"]
    assert "sdk_mode" not in cfg["devices"][0], "a refused save must not half-apply"


def test_DISABLING_is_always_allowed_even_on_a_device_that_no_longer_advertises_it(tmp_path):
    """Otherwise a flag set against a since-swapped sensor could never be cleared from the UI."""
    dev = {**_VERITY, "sdk_mode": True}
    (st, _), cfg = _post(tmp_path, {"sdk_mode": {"24:AC:AC:0C:30:1E": False}}, [dev],
                         {"Verity": {"pmd_supported": ["ppg"]}})
    assert st == 200 and cfg["devices"][0]["sdk_mode"] is False


def test_a_never_connected_device_can_still_be_configured(tmp_path):
    """No status and no `pmd_supported_seen` means no menu to check against — the same "allow, the
    daemon will fall back" stance `rates` takes for an unconnected device, rather than a lockout."""
    (st, _), cfg = _post(tmp_path, {"sdk_mode": {"24:AC:AC:0C:30:1E": True}}, [_VERITY], {})
    assert st == 200 and cfg["devices"][0]["sdk_mode"] is True


def test_a_non_boolean_is_rejected(tmp_path):
    (st, body), _ = _post(tmp_path, {"sdk_mode": {"24:AC:AC:0C:30:1E": "yes"}}, [_VERITY],
                          {"Verity": {"pmd_supported": _SUPPORTED}})
    assert st == 400 and "boolean" in body["error"]


def test_an_unknown_address_is_rejected(tmp_path):
    (st, body), _ = _post(tmp_path, {"sdk_mode": {"ZZ": True}}, [_VERITY], {})
    assert st == 400 and "unknown device" in body["error"]


def test_an_unchanged_value_is_not_reported_as_a_change(tmp_path):
    """`changed` drives the "reconnect the device to apply" banner. A save that changed nothing must
    not ask the operator to interrupt a running capture."""
    dev = {**_VERITY, "sdk_mode": True}
    (st, body), _ = _post(tmp_path, {"sdk_mode": {"24:AC:AC:0C:30:1E": True}}, [dev],
                          {"Verity": {"pmd_supported": _SUPPORTED}})
    assert st == 200 and body["changed"] == []


# ── the runner, end to end ──────────────────────────────────────────────────────────────────────────
# Everything above tests a piece. This drives the real `run_polar` negotiation against a fake device
# that holds SDK mode as STATE and widens its own settings menu when the mode is on — so the
# assertions are about what the daemon actually negotiated, not about which calls it made.
def test_run_polar_enters_sdk_mode_and_negotiates_the_EXTENDED_rate(tmp_path, monkeypatch):
    """The payoff, and the thing that was broken: with SDK mode on, the device offers 176 and the
    daemon takes it. Without the entry the menu is [130] and `chosen_rate` falls back SILENTLY, which
    is how `rates: {ppg: 176}` produced a 55 Hz night with nothing in the log."""
    T._polar_common(monkeypatch)
    c = T.FakePolarClient()
    T._inject_connect(monkeypatch, c)
    T._stop_after(monkeypatch, 1)
    T._run(capture.run_polar(T._pdev(sdk_mode=True, rates={"ecg": 176}), str(tmp_path)))
    assert pmd.sdk_mode_cmd(True) in c.writes, "the mode is entered"
    assert capture.STATUS["devices"]["H10"]["sdk_mode"] is True, "…and confirmed FROM THE DEVICE"
    assert capture.STATUS["devices"]["H10"]["pmd_options"]["ecg"] == [130, 176], \
        "the menu published to the monitor is the WIDER one — that is what the mode is for"


def test_run_polar_leaves_sdk_mode_alone_when_it_is_not_configured(tmp_path, monkeypatch):
    """The positive control: the enter must not be unconditional. Every H10 in the fleet would
    otherwise take an extra pair of control writes per negotiation for a mode it does not advertise."""
    T._polar_common(monkeypatch)
    c = T.FakePolarClient()
    T._inject_connect(monkeypatch, c)
    T._stop_after(monkeypatch, 1)
    T._run(capture.run_polar(T._pdev(), str(tmp_path)))
    assert pmd.sdk_mode_cmd(True) not in c.writes
    assert "sdk_mode" not in capture.STATUS["devices"]["H10"]


def test_a_refused_entry_is_published_as_off_rather_than_assumed_on(tmp_path, monkeypatch):
    """`invalid_state` means a stream was still running and the device stayed on its NORMAL menu. The
    status must say so, because the rates that follow are the narrow ones."""
    T._polar_common(monkeypatch)
    c = T.FakePolarClient(sdk_start_ok=False)
    T._inject_connect(monkeypatch, c)
    T._stop_after(monkeypatch, 1)
    T._run(capture.run_polar(T._pdev(sdk_mode=True), str(tmp_path)))
    assert capture.STATUS["devices"]["H10"]["sdk_mode"] is False
    assert capture.STATUS["devices"]["H10"]["pmd_options"]["ecg"] == [130], "the narrow menu, honestly"
