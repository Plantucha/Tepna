# tepna-capture — tests/test_night_battery_alert.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The battery may not last the night (owner, 2026-11-04). Every notifier is a stub."""

import datetime as dt

import pytest

import alerts
import capture
from tests.test_capture_runners import _dev, _run

NM = "Polar Sense TEST0001"


def test_night_need_pct_reads_the_device_then_the_model():
    assert alerts.night_need_pct({"model": "VeritySense"}) == 41
    assert alerts.night_need_pct({"model": "O2Ring-S"}) == 37
    assert alerts.night_need_pct({"model": "H10"}) == 30
    assert alerts.night_need_pct({"model": "H10", "night_need_pct": "55"}) == 55
    assert alerts.night_need_pct({"model": "Muse"}) is None
    assert alerts.night_need_pct({}) is None


def test_night_battery_short_needs_the_hours_a_figure_and_no_charger():
    f = alerts.night_battery_short
    assert f(40, 41, None, 18) is True
    assert f(41, 41, None, 18) is False  # exactly the need is enough
    assert f(40, 41, None, 17) is False  # before the night-begin hours
    assert f(40, 41, None, 23) is True
    assert f(40, 41, None, 0) is True  # after midnight still belongs to the night
    assert f(40, 41, True, 20) is False  # on the charger
    assert f(None, 41, None, 20) is False
    assert f(40, None, None, 20) is False


def test_the_text_is_exact():
    assert alerts.night_battery_text("D", 35, 41) == (
        "Tepna: D may not last the night",
        "D reads 35 %. The worst nights on record used 41 %. Charge it before you sleep.",
    )


class _N:
    def __init__(self, ok=True, enabled=True):
        self.ok, self.enabled, self.sent = ok, enabled, []

    async def send(self, title, message, **kw):
        self.sent.append(title)
        return self.ok


@pytest.fixture
def poll(monkeypatch):
    """Run the poller over `steps`, each (local wall clock, status dict)."""
    keep = {k: dict(v) if isinstance(v, dict) else v for k, v in capture.STATUS["devices"].items()}

    def go(steps, notifier=None, dev=None):
        n = notifier or _N()
        it = {"i": -1}

        async def fake_sleep(_s):
            it["i"] += 1
            capture.STATUS["devices"][NM] = dict(steps[it["i"]][1])
            if it["i"] == len(steps) - 1:
                capture._STOP.set()  # the poll that follows this sleep is the last one

        monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
        monkeypatch.setattr(capture._time, "monotonic", lambda: 1000.0)
        monkeypatch.setattr(capture, "_now", lambda: steps[it["i"]][0])
        cfg = {
            "alerts": {"poll_sec": 1, "offline_sec": 10**6},
            "devices": [dev or _dev(name=NM, model="VeritySense", address="00:00:00:00:00:01")],
        }
        capture._STOP.clear()
        try:
            _run(capture.alert_poller(cfg, n))
        finally:
            capture._STOP.clear()
            capture.STATUS["devices"].clear()
            capture.STATUS["devices"].update(keep)
        return n.sent

    return go


def _at(day, hour):
    return dt.datetime(2026, 11, day, hour, 0)


LOW = {"connected": True, "battery": 35}
OK = {"connected": True, "battery": 90}
TITLE = "Tepna: " + NM + " may not last the night"


def test_a_low_device_alerts_once_per_night_and_again_the_next(poll):
    steps = [
        (_at(4, 17), LOW),  # before the night-begin hours
        (_at(4, 19), LOW),  # alert
        (_at(4, 23), LOW),  # same night: no repeat
        (_at(5, 2), LOW),  # still the night of the 4th
        (_at(5, 19), LOW),  # the next night: a new alert
    ]
    assert poll(steps) == [TITLE] * 2
    assert poll(steps[:4]) == [TITLE], "02:00 belongs to the night that began the evening before"


def test_a_charged_or_docked_device_does_not_alert(poll):
    assert poll([(_at(4, 19), OK), (_at(4, 20), {**LOW, "charging": True})]) == []


def test_a_failed_send_retries_and_alerts_off_latch(poll):
    assert poll([(_at(4, 19), LOW), (_at(4, 20), LOW)], _N(ok=False)) == [TITLE] * 2
    assert poll([(_at(4, 19), LOW), (_at(4, 20), LOW)], _N(ok=False, enabled=False)) == [TITLE]


def test_the_device_figure_wins_over_the_model(poll):
    dev = _dev(name=NM, model="VeritySense", address="00:00:00:00:00:01", night_need_pct=30)
    assert poll([(_at(4, 19), LOW)], dev=dev) == []
