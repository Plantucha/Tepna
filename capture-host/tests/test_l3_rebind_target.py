# tepna-capture — tests/test_l3_rebind_target.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""THE LAST RUNG MUST ACT ON THE RADIO THE WATCHDOG IS WATCHING.

`adapter_usb_id` has said since it was written that it is "the only sanctioned source of a rebind
target", that `watchdog.usb_path` is not a fallback for it, and that falling back to the static path
"is precisely how the wrong-radio rebind re-enters". That rule was built, tested and adopted — by the
CPAP escalation gate, which refuses the rung when nothing is derivable. The wearables watchdog, the
rung the rule was written FOR, went on reading the static value, and nothing drove it in a test.

Measured on vigil 2026-09-06: `usb_path: '1-2'` is the UB500 (hci0) while this watchdog was watching
the Sena (hci1, USB 1-5). So the last rung would have re-enumerated a radio that was neither wedged
nor monitored, and left the wedged one untouched — two rungs four lines apart, in one `try` block,
disagreeing about which device was being recovered.
"""

import capture
import pytest
from test_capture_runners import _dev, _run, _stop_after

PIN = "00:01:95:CC:53:02"


@pytest.fixture(autouse=True)
def _isolate():
    capture._STOP.clear()
    before = capture.ADAPTER
    yield
    capture.ADAPTER = before
    capture._STOP.clear()


def _l3_rig(monkeypatch, *, derived="1-5", hci="hci1"):
    """Drive the ladder to its LAST rung: a wedged radio, one power-cycle budget, no spare."""
    rebound = []

    async def btctl(_script, timeout=8):
        return ""                                  # no phantom link

    async def fake_hci():
        return hci

    async def fake_up(_h):
        return False                               # the wedge

    async def fake_responds(_h):
        return None                                # undeterminable — never a verdict of its own

    async def fake_cmd(_cmd):
        return True

    async def no_spares():
        return []                                  # nothing to fail over to; the ladder ends here

    async def scan(_mac, seconds=0):
        return [{"address": "AA:AA:AA:AA:AA:AA"}]  # not deaf — keep this about the rebind

    async def rebind(dev_id):
        rebound.append(dev_id)
        return True

    monkeypatch.setattr(capture.bonding, "_btctl", btctl)
    monkeypatch.setattr(capture.bonding, "scan", scan)
    monkeypatch.setattr(capture, "adapter_hci", fake_hci)
    monkeypatch.setattr(capture, "_adapter_is_up", fake_up)
    monkeypatch.setattr(capture, "_adapter_responds", fake_responds)
    monkeypatch.setattr(capture, "_adapter_cmd", fake_cmd)
    monkeypatch.setattr(capture, "list_adapters", no_spares)
    monkeypatch.setattr(capture, "_usb_rebind", rebind)
    monkeypatch.setattr(capture, "adapter_usb_id", lambda h, **k: derived)
    return rebound


def _cfg(**w):
    base = {"enabled": True, "interval_sec": 1, "grace_checks": 1, "max_adapter_cycles": 1,
            "recover_checks": 1, "usb_path": "1-2"}
    base.update(w)
    return {"watchdog": base, "devices": [_dev(name="H10")]}


def _drive(monkeypatch, cfg, polls=4):
    capture.STATUS["devices"]["H10"] = {"connected": False, "address": "24:AC:AC:02:84:96",
                                        "last_error": "TimeoutError"}
    _stop_after(monkeypatch, polls)
    _run(capture.adapter_watchdog(PIN, cfg))


def test_L3_rebinds_the_DERIVED_bus_port_and_NOT_the_configured_one(monkeypatch, caplog):
    """The defect, planted: the two disagree, and the rung must follow the adapter it is watching."""
    rebound = _l3_rig(monkeypatch, derived="1-5")
    with caplog.at_level("WARNING"):
        _drive(monkeypatch, _cfg())
    assert rebound == ["1-5"], f"the last rung re-enumerated {rebound}, not the watched radio"
    assert "1-2" not in rebound, "it reached for the static config value"
    assert "is a DIFFERENT radio" in caplog.text, \
        "a box whose config names another radio must SAY so — that is the 2026-09-06 state"


def test_L3_REFUSES_when_no_bus_port_can_be_derived(monkeypatch, caplog):
    """An internal controller has no USB bus-port, and an hci index can re-enumerate after a rebind.
    Either way the derivation returns None and the rung must REFUSE — the fallback IS the defect."""
    rebound = _l3_rig(monkeypatch, derived=None)
    with caplog.at_level("ERROR"):
        _drive(monkeypatch, _cfg())
    assert rebound == [], "refused derivation still re-enumerated something"
    assert "REFUSING the L3 USB rebind" in caplog.text
    assert "NOT a fallback" in caplog.text


def test_usb_path_still_ARMS_the_rung_even_though_it_no_longer_TARGETS_it(monkeypatch):
    """`watchdog.usb_path` carries two jobs and only one of them was wrong. Unset means the operator
    disarmed the last rung; deriving a target must not silently arm it on every box."""
    rebound = _l3_rig(monkeypatch, derived="1-5")
    cfg = _cfg()
    cfg["watchdog"].pop("usb_path")
    _drive(monkeypatch, cfg)
    assert rebound == [], "a disarmed rung fired because the target became derivable"


def test_no_spurious_warning_when_config_and_derivation_AGREE(monkeypatch, caplog):
    """The warning is evidence of a real disagreement. Firing it on a correctly configured box would
    train an operator to ignore the line that matters."""
    rebound = _l3_rig(monkeypatch, derived="1-2")
    with caplog.at_level("WARNING"):
        _drive(monkeypatch, _cfg())
    assert rebound == ["1-2"]
    assert "is a DIFFERENT radio" not in caplog.text


def test_L3_REFUSES_when_the_adapter_itself_cannot_be_RESOLVED(monkeypatch, caplog):
    """`adapter_hci()` returning None IS a wedge signature — the configured adapter is not resolvable
    at all. There is nothing to derive from, so there is nothing to rebind; the static path would
    happily name a radio anyway, which is the whole failure."""
    rebound = _l3_rig(monkeypatch, hci=None)
    with caplog.at_level("ERROR"):
        _drive(monkeypatch, _cfg())
    assert rebound == []
    assert "REFUSING the L3 USB rebind" in caplog.text
