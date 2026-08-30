# tepna-capture — tests/test_failover_planted_wedge.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""SEEN TO FAIL OVER, not assumed — the last item on the failover brief's Done-when list.

`failover_target` has been tested as a pure decision since P1.5, and `link_distress` tests the signal.
Neither drives the LADDER. This plants a wedge on the pinned radio and asserts the whole path: the
recovery ladder escalates, a healthy spare is chosen, the process-wide pin actually MOVES, the
sensors are re-bonded there, and the switch leaves an EVENT carrying its cause.

🔴 WHY AN END-TO-END TEST AND NOT MORE UNIT TESTS. Every piece of this was already covered
individually and the wiring between them still had a hole — `_set_active_adapter` moves a process
global that nothing asserted, and the event emission was added blind. A ladder whose rungs are each
tested but which was never climbed is the shape this repo keeps finding.
"""


import capture
import pytest
from test_capture_runners import _dev, _run, _stop_after

PINNED = "00:01:95:CC:53:02"  # Sena — the radio we wedge
SPARE = "F0:D5:BF:1E:79:21"  # Intel — up, addressable, not pinned


@pytest.fixture(autouse=True)
def _isolate():
    capture._STOP.clear()
    capture._RADIO_EVENTS.clear()
    capture.STATUS.pop("radio_switches", None)
    before = capture.ADAPTER
    yield
    capture.ADAPTER = before
    capture._STOP.clear()
    capture._RADIO_EVENTS.clear()


def _wedge(monkeypatch, *, spares=((SPARE, True),), bond_ok=True):
    """Pin a radio, hold it DOWN, and offer `spares` to `list_adapters`."""
    bonded = []

    async def hci():
        return "hci1"

    async def is_up(_h):
        return False  # the wedge: the pinned adapter is DOWN, every poll

    async def adapters():
        return [{"mac": PINNED, "up": False}] + [{"mac": m, "up": u} for m, u in spares]

    async def btctl(_script, timeout=6):
        return ""

    async def ensure_bonded(addr, mac, force=False):
        bonded.append((addr, mac))
        return bond_ok

    async def restart_radio():
        return None

    monkeypatch.setattr(capture, "adapter_hci", hci)
    monkeypatch.setattr(capture, "_adapter_is_up", is_up)
    monkeypatch.setattr(capture, "list_adapters", adapters)
    monkeypatch.setattr(capture.bonding, "_btctl", btctl)
    monkeypatch.setattr(capture.bonding, "ensure_bonded", ensure_bonded)
    monkeypatch.setattr(capture, "_restart_radio", restart_radio)
    return bonded


def _cfg(**over):
    w = {
        "enabled": True,
        "interval_sec": 1,
        "grace_checks": 1,
        "max_adapter_cycles": 1,
        "recover_checks": 1,
        "max_failovers": 3,
    }
    w.update(over)
    return {"watchdog": w, "devices": [_dev(name="H10")]}


def _run_watchdog(monkeypatch, cfg, polls=6):
    capture.STATUS["devices"]["H10"] = {
        "connected": False,
        "address": "24:AC:AC:02:84:96",
        "last_error": "TimeoutError",
    }
    _stop_after(monkeypatch, polls)
    _run(capture.adapter_watchdog(PINNED, cfg))


def test_a_planted_wedge_MIGRATES_the_pin_to_a_healthy_spare(monkeypatch):
    """The whole point: the process-wide pin has to actually move, because every device task resolves
    ADAPTER -> hciN fresh on each reconnect. Asserting the decision alone would pass against a
    failover that decided correctly and then changed nothing."""
    bonded = _wedge(monkeypatch)
    capture.ADAPTER = PINNED
    _run_watchdog(monkeypatch, _cfg())
    assert capture.ADAPTER == SPARE, "the ladder escalated but the pin never moved"
    assert bonded and bonded[0][1] == SPARE, "the sensors were not re-bonded on the spare"


def test_the_switch_leaves_an_EVENT_carrying_its_cause(monkeypatch):
    """A `log.critical` is not a surface. Radio churn has to reach something that survives the night."""
    _wedge(monkeypatch)
    capture.ADAPTER = PINNED
    _run_watchdog(monkeypatch, _cfg())
    evs = capture.STATUS.get("radio_switches") or []
    assert evs, "a failover happened and left no event"
    ev = evs[-1]
    assert ev["from"] == PINNED and ev["to"] == SPARE
    assert ev["cause"] == "wedged" and "ladder spent" in (ev["detail"] or "")


def test_the_event_records_where_it_came_FROM_not_where_it_went(monkeypatch):
    """🔴 `adapter_mac` is reassigned inside the try, so an event built after the repoint would report
    the spare as both endpoints — a switch log that cannot tell you which radio failed."""
    _wedge(monkeypatch)
    capture.ADAPTER = PINNED
    _run_watchdog(monkeypatch, _cfg())
    ev = (capture.STATUS.get("radio_switches") or [])[-1]
    assert ev["from"] != ev["to"], "the event lost the radio it failed away from"


def test_NO_HEALTHY_SPARE_means_no_switch_and_no_event(monkeypatch):
    """A down spare is no spare. Moving onto an adapter we could not confirm UP is worse than staying
    on the wedged one, and it must not be reported as a recovery either."""
    _wedge(monkeypatch, spares=((SPARE, False),))
    capture.ADAPTER = PINNED
    _run_watchdog(monkeypatch, _cfg())
    assert capture.ADAPTER == PINNED, "failed over onto an adapter that was not up"
    assert not (capture.STATUS.get("radio_switches") or [])


def test_failover_DISABLED_by_config_does_not_switch(monkeypatch):
    _wedge(monkeypatch)
    capture.ADAPTER = PINNED
    _run_watchdog(monkeypatch, _cfg(failover=False))
    assert capture.ADAPTER == PINNED and not (capture.STATUS.get("radio_switches") or [])


def test_a_FAILED_re_bond_does_not_abort_the_migration(monkeypatch):
    """The spare is already pinned by then. Refusing to finish because one bond failed would leave the
    box on a radio nothing is bonded to — worse than the wedge."""
    _wedge(monkeypatch, bond_ok=False)
    capture.ADAPTER = PINNED
    _run_watchdog(monkeypatch, _cfg())
    assert capture.ADAPTER == SPARE
    assert capture.STATUS.get("radio_switches") or [], "the switch happened but was not recorded"
