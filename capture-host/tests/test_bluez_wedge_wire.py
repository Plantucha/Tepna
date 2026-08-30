# tepna-capture — tests/test_bluez_wedge_wire.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The PARTIAL-wedge rung, wired into the watchdog.

Brief runner's F1: `_restart_radio()` was reachable ONLY from the deafness rung, which fires solely
`if not connected_any` — so on 2026-08-29, with the CPAP invisible while the H10 and O2Ring streamed,
no rung could fire. The ladder would not have caught the night it was built for.

And the CPAP's unreachability could not have contributed to any verdict even in principle: it is not
a `cfg["devices"]` entry (it arrives as FILES on a timer and would render as a permanently-dead
sensor), so the loop that iterates devices never sees it. It reaches the watchdog through the
DETECTOR's status instead.
"""

from __future__ import annotations

import capture
import bluez_wedge


def _wire(monkeypatch, restarts):
    async def fake_btctl(script, timeout=6):
        return "Connected: yes\n"

    async def fake_restart():
        restarts.append(1)
        return True

    monkeypatch.setattr(capture.bonding, "_btctl", fake_btctl)
    monkeypatch.setattr(capture, "_restart_radio", fake_restart)


def _poll(monkeypatch, cpap_status, restarts):
    """Drive exactly one watchdog poll with a healthy, connected sensor and the given CPAP state."""
    from test_capture_runners import _dev, _run, _stop_after

    _wire(monkeypatch, restarts)
    capture._STOP.clear()
    _stop_after(monkeypatch, 1)
    capture.STATUS["devices"]["H10"] = {"connected": True, "address": "24:AC:AC:02:84:96"}
    capture.STATUS["cpap"] = dict(cpap_status)
    capture.STATUS.pop("cpap_wedge", None)
    cfg = {"watchdog": {"enabled": True, "interval_sec": 60}, "devices": [_dev(name="H10")]}
    _run(capture.adapter_watchdog("hci0", cfg))
    capture._STOP.clear()
    return capture.STATUS.get("cpap_wedge")


def _cpap(streak, seen_min_ago):
    import time as _t
    return {"enabled": True, "unreachable_streak": streak,
            "last_seen_ms": (_t.time() - seen_min_ago * 60.0) * 1000.0,
            "last_unreachable_class": "BleakDeviceNotFoundError"}


def test_THE_2026_08_29_SHAPE_NOW_FIRES_A_RUNG(monkeypatch):
    # CPAP invisible for hours, H10 connected and streaming throughout. Every existing check green;
    # this is the night the ladder missed.
    restarts = []
    verdict = _poll(monkeypatch, _cpap(streak=600, seen_min_ago=120), restarts)
    assert verdict["verdict"] == bluez_wedge.WEDGED, verdict
    assert restarts == [1], "no recovery fired on the exact shape the ladder was built for"
    # the failure CLASS is surfaced too — Brief runner's F2, which the CSV could not answer
    assert verdict["class"] == "BleakDeviceNotFoundError"


def test_A_FEW_MISSES_DO_NOT_RESTART_THE_RADIO(monkeypatch):
    restarts = []
    verdict = _poll(monkeypatch, _cpap(streak=3, seen_min_ago=10), restarts)
    assert verdict["verdict"] == bluez_wedge.WATCHING
    assert restarts == [], "a handful of missed polls dropped every live link"


def test_A_MACHINE_GONE_FOR_DAYS_IS_NOT_A_WEDGE(monkeypatch):
    restarts = []
    verdict = _poll(monkeypatch, _cpap(streak=600, seen_min_ago=60 * 40), restarts)
    assert verdict["verdict"] == bluez_wedge.ABSENT
    assert restarts == []


def test_A_DISABLED_CPAP_IS_NOT_ASSESSED(monkeypatch):
    restarts = []
    st = _cpap(600, 10); st["enabled"] = False
    assert _poll(monkeypatch, st, restarts) is None
    assert restarts == []


def test_A_ZERO_STREAK_IS_NOT_ASSESSED(monkeypatch):
    # Nothing has been missed, so there is no question to answer and no verdict to publish.
    restarts = []
    assert _poll(monkeypatch, _cpap(0, 10), restarts) is None


def test_A_RESTART_THAT_DOES_NOT_HELP_IS_NOT_REPEATED_WITHOUT_BOUND(monkeypatch):
    """The budget's whole purpose: a restart that did not clear the wedge will not clear it on the
    fourth attempt either, and each one drops every live link.

    ⚠️ Driven as ONE watchdog lifetime, several polls — not several watchdogs. The budget is a local
    in `adapter_watchdog`, so polling it through repeated invocations would reset the counter every
    time and test the harness rather than the code. (My first version of this test did exactly that
    and 'passed' the restart cap by starting a fresh watchdog for each poll.)

    The fake restart RE-ARMS the streak, modelling a wedge the restart failed to clear — which is the
    only situation in which the cap can be reached at all."""
    from test_capture_runners import _dev, _run, _stop_after

    restarts = []

    async def fake_btctl(script, timeout=6):
        # Re-arm HERE, once per poll, not inside the restart: the rung clears the streak immediately
        # AFTER `_restart_radio()` returns, so a re-arm from inside the restart is overwritten on the
        # very next line. This models what a persisting wedge really does — misses keep accumulating
        # between polls because the restart did not fix anything.
        capture.STATUS.setdefault("cpap", {})["unreachable_streak"] = 600
        return "Connected: yes\n"

    async def unhelpful_restart():
        restarts.append(1)
        return True

    monkeypatch.setattr(capture.bonding, "_btctl", fake_btctl)
    monkeypatch.setattr(capture, "_restart_radio", unhelpful_restart)
    capture._STOP.clear()
    _stop_after(monkeypatch, bluez_wedge.MAX_RESTARTS_PER_DAY + 3)
    capture.STATUS["devices"]["H10"] = {"connected": True, "address": "24:AC:AC:02:84:96"}
    capture.STATUS["cpap"] = _cpap(600, 120)
    cfg = {"watchdog": {"enabled": True, "interval_sec": 60}, "devices": [_dev(name="H10")]}
    _run(capture.adapter_watchdog("hci0", cfg))
    capture._STOP.clear()

    assert len(restarts) == bluez_wedge.MAX_RESTARTS_PER_DAY, (
        f"spent {len(restarts)} restarts against a budget of {bluez_wedge.MAX_RESTARTS_PER_DAY}")
    # ...and it still SAYS wedged after the budget is gone. The bookkeeping governs the action, never
    # the verdict; a wedged night reading as healthy is the failure this lane exists to prevent.
    assert capture.STATUS["cpap_wedge"]["verdict"] == bluez_wedge.WEDGED


# ── the status signal the rung reads ──────────────────────────────────────────────────────────────
def test_A_FAILED_POLL_INCREMENTS_THE_STREAK_AND_RECORDS_THE_CLASS():
    capture.STATUS["cpap"] = {"enabled": True}
    capture._note_cpap_unreachable(OSError("no route"))
    capture._note_cpap_unreachable(TimeoutError("slow"))
    st = capture.STATUS["cpap"]
    assert st["unreachable_streak"] == 2
    assert st["reachable"] is False
    assert st["last_unreachable_class"] == "TimeoutError"


def test_A_SUCCESSFUL_POLL_RESETS_THE_STREAK_AND_STAMPS_LAST_SEEN():
    import types
    capture.STATUS["cpap"] = {"enabled": True, "unreachable_streak": 9,
                              "last_unreachable_class": "OSError"}

    class _D:
        evidence = {"reachable": True, "fg_state": "Standby"}
        state = types.SimpleNamespace(name="IDLE")
        host_ms = 1.0

    capture._publish_therapy_state(_D(), None)
    st = capture.STATUS["cpap"]
    assert st["unreachable_streak"] == 0
    assert st["reachable"] is True
    assert st["last_unreachable_class"] is None
    assert st["last_seen_ms"] > 0


def test_AN_UNREACHABLE_POLL_DOES_NOT_MOVE_LAST_SEEN():
    # `last_seen_ms` is the only thing separating "bluez lost it" from "it is not here". If a failed
    # poll refreshed it, the window would never expire and every absence would read as a wedge.
    capture.STATUS["cpap"] = {"enabled": True, "last_seen_ms": 1000.0}
    capture._note_cpap_unreachable(OSError("boom"))
    assert capture.STATUS["cpap"]["last_seen_ms"] == 1000.0
