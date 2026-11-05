# tepna-capture — tests/test_dock_and_wear_alerts.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Three device states that reached no phone (owner, 2026-11-04): a night that ends on the dock, a device
that runs while not worn, and a device that streams on its charger. Every notifier is a stub."""

import datetime as dt

import pytest

import alerts
import capture
from tests.test_capture_runners import _dev, _run

NM = "Polar Sense TEST0001"
ADDR = "00:00:00:00:00:01"


# ── pure ────────────────────────────────────────────────────────────────────────────────────────────
def test_not_worn_while_running_needs_the_grace_and_recent_samples():
    f = alerts.not_worn_while_running
    assert f(None, 1000, 1000) is False
    assert f(0, None, 1000) is False
    assert f(400, 1000, 1000) is True  # exactly the 600 s grace
    assert f(401, 1000, 1000) is False
    assert f(0, 700, 1000) is True  # samples exactly 300 s old
    assert f(0, 699, 1000) is False  # a device that went silent: no alert
    assert f(0, 1000, 1000, grace_sec=0) is False  # 0 turns the alert off
    assert f(0, 1000, 1000, grace_sec=1) is True  # any positive grace keeps the alert on
    assert f(0, 1000, 1000, grace_sec=50, window_sec=10) is True


def test_streams_on_charger_needs_samples_after_the_dock():
    f = alerts.streams_on_charger
    assert f(None, 100, 150, 120) is False
    assert f(100, 100, 150, 120) is False  # the last night sample, not a dock stream
    assert f(101, 100, 150, 120) is True
    assert f(101, 100, 221, 120) is True
    assert f(101, 100, 222, 120) is False  # samples stopped again


def test_the_three_texts_are_exact():
    assert alerts.not_worn_text("D", 10.9) == (
        "Tepna: D not worn",
        "D is on and sends data, but it has not been on a body for 10 min.",
    )
    t, m = alerts.dock_stream_text("D", True)
    assert t == "Tepna: D streams on its charger"
    assert m == "D is on its charger and sends samples (SDK mode on). These samples are not a wear."
    assert "(SDK mode off)" in alerts.dock_stream_text("D", False)[1]
    assert "(SDK mode unknown)" in alerts.dock_stream_text("D", None)[1]
    assert alerts.dock_night_text("D") == (
        "Tepna: D night ended",
        "D went onto its charger after the night. Its live data is on the box.",
    )


# ── wired into alert_poller ───────────────────────────────────────────────────────────────────────────
class _N:
    def __init__(self, ok=True, enabled=True):
        self.ok, self.enabled, self.sent = ok, enabled, []

    async def send(self, title, message, **kw):
        self.sent.append(title)
        return self.ok


@pytest.fixture
def poll(monkeypatch):
    """Run the poller over `steps`: each is (monotonic now, status dict, last-data mono, worn-since)."""
    keep = {k: dict(v) if isinstance(v, dict) else v for k, v in capture.STATUS["devices"].items()}

    def go(steps, notifier=None, acfg=None):
        n = notifier or _N()
        it = {"i": -1}

        def apply(i):
            now, st, last, ws = steps[i]
            capture.STATUS["devices"][NM] = st
            if last is None:
                capture._LAST_DATA.pop(NM, None)
            else:
                capture._LAST_DATA[NM] = last
            if ws is None:
                capture._WORN_SINCE.pop(ADDR, None)
            else:
                capture._WORN_SINCE[ADDR] = ws

        async def fake_sleep(_s):
            it["i"] += 1
            apply(it["i"])
            if it["i"] == len(steps) - 1:
                capture._STOP.set()  # the poll that follows this sleep is the last one

        monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
        monkeypatch.setattr(capture._time, "monotonic", lambda: steps[it["i"]][0])
        # The wall clock is pinned to midday: the night-battery alert reads `_now`, and a run inside the
        # night window must not decide these dock and wear tests (test_battery_alerts.py, the pin rule).
        monkeypatch.setattr(capture, "_now", lambda: dt.datetime(2026, 11, 4, 12, 0))
        cfg = {
            "alerts": {"poll_sec": 1, "offline_sec": 10**6, **(acfg or {})},
            "devices": [_dev(name=NM, address=ADDR)],
        }
        capture._STOP.clear()
        try:
            _run(capture.alert_poller(cfg, n))
        finally:
            capture._STOP.clear()
            capture._LAST_DATA.pop(NM, None)
            capture._WORN_SINCE.pop(ADDR, None)
            capture._LAST_PULL_OK.pop(NM, None)
            capture._IDLE_TIMER_NAMED.discard(NM)
            capture.STATUS["devices"].clear()
            capture.STATUS["devices"].update(keep)
        return n.sent

    return go


ON = {"connected": True}
DOCK = {"connected": True, "charging": True, "sdk_mode": True}


def test_a_night_that_ends_on_the_dock_sends_one_night_note(poll):
    """MEASURED 2026-11-04: the Sense recorded 22:50 to 04:24, docked at 04:25 and stayed linked."""
    steps = [(1000, ON, 1000, None), (4600, ON, 4600, None), (4700, DOCK, 4600, None), (4800, DOCK, 4600, None)]
    assert poll(steps) == ["Tepna: " + NM + " night ended"]


def test_a_short_wear_that_ends_on_the_dock_sends_no_note(poll):
    steps = [(1000, ON, 1000, None), (4599, ON, 4599, None), (4700, DOCK, 4599, None)]
    assert poll(steps) == []


def test_a_failed_dock_note_retries_on_the_next_poll(poll):
    steps = [(1000, ON, 1000, None), (4600, ON, 4600, None), (4700, DOCK, 4600, None), (4800, DOCK, 4600, None)]
    assert poll(steps, _N(ok=False)) == ["Tepna: " + NM + " night ended"] * 2


def test_a_dock_note_latches_when_alerts_are_off(poll):
    steps = [(1000, ON, 1000, None), (4600, ON, 4600, None), (4700, DOCK, 4600, None), (4800, DOCK, 4600, None)]
    assert poll(steps, _N(ok=False, enabled=False)) == ["Tepna: " + NM + " night ended"]


def test_a_device_docked_from_the_start_sends_no_night_note(poll):
    assert poll([(1000, DOCK, None, None), (1100, DOCK, None, None)]) == []


def test_samples_after_the_dock_alert_once_per_dock(poll):
    steps = [
        (1000, DOCK, 900, None),  # the dock begins; the last sample predates it
        (1100, DOCK, 1050, None),  # a sample after the dock: the device streams on its charger
        (1200, DOCK, 1150, None),  # still streaming: no repeat
        (1300, ON, None, None),  # off the dock
        (1400, DOCK, None, None),  # a new dock
        (1500, DOCK, 1450, None),  # streams again: a new alert
    ]
    assert poll(steps) == ["Tepna: " + NM + " streams on its charger"] * 2


def test_a_failed_dock_stream_alert_retries(poll):
    steps = [(1000, DOCK, 900, None), (1100, DOCK, 1050, None), (1150, DOCK, 1140, None)]
    assert poll(steps, _N(ok=False)) == ["Tepna: " + NM + " streams on its charger"] * 2


def test_a_device_that_runs_unworn_alerts_once_per_stretch(poll):
    steps = [
        (1000, ON, 1000, 1000),  # not worn from 1000
        (1599, ON, 1599, 1000),  # inside the grace
        (1600, ON, 1600, 1000),  # 600 s: alert
        (1700, ON, 1700, 1000),  # no repeat
        (1800, ON, 1800, None),  # worn again: the latch clears
        (1900, ON, 1900, 1900),
        (2500, ON, 2500, 1900),  # a new stretch: a new alert
    ]
    assert poll(steps) == ["Tepna: " + NM + " not worn"] * 2


def test_an_unworn_alert_waits_for_the_dock_to_end_and_restarts_after_it(poll):
    steps = [(1000, ON, 1000, 0), (1100, ON, 1100, 0), (1200, DOCK, 1100, 0), (1300, ON, 1300, 0)]
    assert poll(steps) == ["Tepna: " + NM + " not worn"] * 2


def test_a_failed_unworn_alert_retries_and_a_silent_device_never_alerts(poll):
    assert poll([(1000, ON, 1000, 0), (1100, ON, 1100, 0)], _N(ok=False)) == ["Tepna: " + NM + " not worn"] * 2
    assert poll([(1000, ON, 600, 0), (1100, ON, 600, 0)]) == []


def test_the_unworn_alert_reads_its_grace_from_the_config(poll):
    steps = [(1000, ON, 1000, 950), (1100, ON, 1100, 950)]
    assert poll(steps, acfg={"not_worn_sec": 50}) == ["Tepna: " + NM + " not worn"]
    assert poll(steps, acfg={"not_worn_sec": 0}) == []
    off = [(1000, ON, 1000, 0), (1100, ON, 1100, 0)]
    assert poll(off, _N(ok=False, enabled=False)) == ["Tepna: " + NM + " not worn"], "alerts off still latch"
