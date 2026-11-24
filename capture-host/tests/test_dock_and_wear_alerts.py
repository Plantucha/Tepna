# tepna-capture — tests/test_dock_and_wear_alerts.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Three device states that reached no phone (owner, 2026-11-04): a night that ends on the dock, a device
that runs while not worn, and a device that streams on its charger. Every notifier is a stub."""

import asyncio
import datetime as dt
import json

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
    """Run the poller over `steps`: each is (monotonic now, status dict, last-data mono, worn-since), and
    an optional fifth item, the monotonic time of a pull that completed by that poll."""
    keep = {k: dict(v) if isinstance(v, dict) else v for k, v in capture.STATUS["devices"].items()}

    def go(steps, notifier=None, acfg=None, hour=12):
        n = notifier or _N()
        it = {"i": -1}

        def apply(i):
            now, st, last, ws, *pull = steps[i]
            if pull:
                capture._LAST_PULL_OK[NM] = pull[0]
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
        # The wall clock is pinned, to midday by default: the night-battery alert reads `_now`, and a run inside the
        # night window must not decide these dock and wear tests (test_battery_alerts.py, the pin rule).
        monkeypatch.setattr(capture, "_now", lambda: dt.datetime(2026, 11, 4, hour, 0))
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


# ── a stream judged not worn does not re-arm the night note ────────────────────────────────────────────
OFF = {"connected": False}
_NIGHT = [(1000, ON, 1000, None), (4700, ON, 4700, None), (4800, OFF, 4700, 4750)]  # worn 1 h, doffed, off
_DESK = [(5100, ON, 5100, 4750), (5150, DOCK, 5150, 4750), (5200, OFF, 5150, 4750)]  # unworn, docked, off


def test_an_unworn_charger_stream_after_the_night_sends_no_second_note(poll):
    """MEASURED on the capture box 2026-11-08: the Sense's night ended at 08:06 with one note. From 08:12 it
    streamed on its charger, judged not worn. The dock popped that episode, so at 08:33 the silence had an
    unknown span and the box sent "night ended" a second time."""
    capture._LAST_PULL_OK[NM] = 4000
    assert poll(_NIGHT + _DESK) == ["Tepna: " + NM + " night ended"]


def test_a_worn_stream_after_the_desk_re_arms_the_note_for_the_next_night(poll):
    capture._LAST_PULL_OK[NM] = 4000
    # The second night's doff pull completes at 12760. The 4000 pull came before that stream began, so it
    # licenses no silence of it (measured on the capture box 2026-11-08, see powered_off_after_pull).
    later = [(9000, ON, 9000, None), (12700, ON, 12700, None), (12800, OFF, 12700, 12750, 12760)]
    assert poll(_NIGHT + _DESK + later) == ["Tepna: " + NM + " night ended"] * 2


# ── the ring states its wear in `worn`, and an unknown span is not a night ─────────────────────────────
UNWORN = {"connected": True, "worn": False}
NOTE = "Tepna: " + NM + " night ended"


def test_an_unworn_ring_stream_in_the_evening_sends_nothing(poll):
    """MEASURED on the capture box 2026-11-23: the ring came back at 20:12 with "no finger contact", 1 s after
    its pull. The box read its wear as unknown, and sent two offline alerts and a night note."""
    capture._LAST_PULL_OK[NM] = 900
    steps = [(1000, UNWORN, 1000, None), (1100, OFF, 1000, None), (3000, OFF, 1000, None)]
    assert poll(steps, acfg={"offline_sec": 300}, hour=20) == []


def test_a_ring_that_states_no_wear_still_begins_an_episode(poll):
    """The mirror: `worn` None is unknown, and an unknown wear may be a real one. The pull came before this
    stream began, so it licenses no silence, and the alert goes out."""
    capture._LAST_PULL_OK[NM] = 900
    on = {"connected": True, "worn": None}
    steps = [(1000, on, 1000, None), (1100, OFF, 1000, None), (1500, OFF, 1000, None)]
    assert poll(steps, acfg={"offline_sec": 300}, hour=20) == ["Tepna: sensor offline"]


def test_a_wear_after_an_unworn_return_is_its_own_episode(poll):
    """The return closed the gap unworn. A wear of 9 min then begins there, not at the night before it."""
    capture._LAST_PULL_OK[NM] = 4000
    short = [(9000, UNWORN, 9000, None), (9060, ON, 9060, None), (9600, OFF, 9590, None, 9595)]
    assert poll(_NIGHT + short) == [NOTE]


def test_a_night_after_an_unworn_return_keeps_the_span_it_began_with(poll):
    capture._LAST_PULL_OK[NM] = 4000
    night = [(9000, UNWORN, 9000, None), (9060, ON, 9060, None), (12800, ON, 12800, None)]
    assert poll(_NIGHT + night + [(12900, OFF, 12800, None, 12850)]) == [NOTE] * 2


def test_a_moment_without_contact_inside_a_night_does_not_split_it(poll):
    capture._LAST_PULL_OK[NM] = 4750
    inside = [(1000, ON, 1000, None), (3000, UNWORN, 3000, None), (3060, ON, 3060, None), (4700, ON, 4700, None)]
    assert poll(inside + [(4800, OFF, 4700, None)]) == [NOTE]


@pytest.mark.parametrize(("hour", "sent"), [(6, [NOTE]), (12, []), (20, [])])
def test_a_silence_whose_span_a_restart_erased_is_a_night_only_in_the_morning(poll, hour, sent):
    """MEASURED 2026-11-23: a deploy restarted the daemon at 20:58, and at 20:59 the box sent "night ended"."""
    capture._LAST_PULL_OK[NM] = 900
    assert poll([(1000, OFF, None, None)], hour=hour) == sent


@pytest.mark.parametrize("hour", [6, 20])
def test_a_dock_with_no_sample_time_reads_the_span_it_knows(poll, hour):
    """The span holds its own last sample, so its length is known when `_LAST_DATA` has none: a restart."""
    assert poll([(1000, ON, 1000, None), (5000, DOCK, None, None)], hour=hour) == []
    capture._LAST_DATA.pop(NM, None)
    long = [(1000, ON, 1000, None), (4600, ON, 4600, None), (5000, DOCK, None, None)]
    assert poll(long, hour=hour) == [NOTE]


# ── the night span crosses a short gap and a restart ───────────────────────────────────────────────────
H = 3600
_NIGHT_H = 5  # the local hour every step below reads


def _split(gap):
    """A night of 3 h and 1 h 30 min with `gap` s of silence between, then off. Neither piece is a night."""
    a, b = 1000 + 3 * H, 1000 + 3 * H + gap
    end = b + 5400
    return [
        (1000, ON, 1000, None),
        (a, ON, a, None),
        (a + 60, OFF, a, None),
        (b, ON, b, None),
        (end, ON, end, None),
        (end + 60, OFF, end, None),
        (end + 200, OFF, end, None),
        (end + 900, OFF, end, None),
    ]


@pytest.fixture
def morning(monkeypatch):
    """`datetime.now()` in the poller, which dates the stop, reads the morning too."""

    class _DT(capture._dt.datetime):
        @classmethod
        def now(cls, tz=None):
            return capture._dt.datetime(2026, 11, 24, _NIGHT_H, 30)

    monkeypatch.setattr(capture._dt, "datetime", _DT)


def test_a_two_minute_drop_does_not_split_a_night(poll, morning):
    """MEASURED on the capture box 2026-11-24: the headband dropped at 01:00 and 03:57 and ended at 04:55. The
    span began at 03:59, and at 05:01 the box sent "offline" for a night of 6 h 47 min."""
    assert poll(_split(120), acfg={"offline_sec": 300}, hour=_NIGHT_H) == [NOTE]


def test_the_gap_bound_is_thirty_minutes_and_no_more(poll, morning):
    assert poll(_split(1800), acfg={"offline_sec": 10**9}, hour=_NIGHT_H) == [NOTE]
    assert poll(_split(1801), acfg={"offline_sec": 10**9}, hour=_NIGHT_H) == []


def test_a_wear_after_the_reported_end_is_a_new_span(poll, morning):
    """A wear of 10 min that follows the note within the bound is short, and it earns no second note."""
    end = 1000 + 5 * H
    steps = [
        (1000, ON, 1000, None),
        (end, ON, end, None),
        (end + 200, OFF, end, None),
        (end + 400, ON, end + 400, None),
        (end + 1000, ON, end + 1000, None),
        (end + 1300, OFF, end + 1000, None, end + 1100),
    ]
    assert poll(steps, acfg={"offline_sec": 10**9}, hour=_NIGHT_H) == [NOTE]


def test_a_dock_closes_the_span_even_when_no_note_is_due(poll):
    """Two wears of 33 min with a visit to the charger between them are not one wear of 70 min."""
    steps = [
        (1000, ON, 1000, None),
        (3000, ON, 3000, None),
        (3060, DOCK, 3000, None),
        (3200, ON, 3200, None),
        (5200, ON, 5200, None),
        (5260, DOCK, 5200, None),
    ]
    assert poll(steps) == []


def test_a_reported_morning_end_still_alerts_when_the_next_night_begins(poll, morning, monkeypatch):
    """The licence ends when the next night begins (board #2972). The morning clause had no end of its own,
    so a device left off stayed quiet through the next night while another one recorded."""
    end = 1000 + 5 * H
    steps = [(1000, ON, 1000, None), (end, ON, end, None), (end + 200, OFF, end, None)]
    real = alerts.quiet_licence_holds
    began = {"t": None}
    monkeypatch.setattr(alerts, "quiet_licence_holds", lambda stamp, _n: real(stamp, began["t"]))
    assert poll(steps + [(end + 900, OFF, end, None)], acfg={"offline_sec": 0}, hour=_NIGHT_H) == [NOTE]
    began["t"] = end + 800.0  # another device began a night after the note
    sent = poll(steps + [(end + 900, OFF, end, None)], acfg={"offline_sec": 0}, hour=_NIGHT_H)
    assert sent == [NOTE, "Tepna: sensor offline"]


# pure
def test_night_span_extends_bridges_and_starts_again():
    ns = alerts.night_span
    assert ns(None, 5.0, after_gap=False, reported=False) == (5.0, 5.0)
    assert ns((1.0, 2.0), 9000.0, after_gap=False, reported=False) == (1.0, 9000.0), "no gap: no bound"
    assert ns((1.0, 2.0), 9000.0, after_gap=False, reported=True) == (1.0, 9000.0), "no gap: not a new wear"
    assert ns((1.0, 2.0), 1802.0, after_gap=True, reported=False) == (1.0, 1802.0)
    assert ns((1.0, 2.0), 1802.5, after_gap=True, reported=False) == (1802.5, 1802.5)
    assert ns((1.0, 2.0), 3.0, after_gap=True, reported=True) == (3.0, 3.0)


def test_span_last_prefers_this_process():
    assert alerts.span_last((1.0, 2.0), 0.0) == 0.0, "0.0 is a sample time, not an absence"
    assert alerts.span_last((1.0, 2.0), None) == 2.0
    assert alerts.span_last(None, None) is None


def test_the_spans_round_trip_through_the_wall_clock():
    wall = 5_000_000.0
    saved = alerts.quiet_state_to_save({}, {}, 1060.0, wall, None, {"B": (60.0, 1000.0), "A": (1.0, 1060.0)})
    assert saved["spans"] == {"A": [wall - 1059.0, wall], "B": [wall - 1000.0, wall - 60.0]}
    assert list(saved["spans"]) == ["A", "B"]
    # a restart: the monotonic clock starts again at 10.0, and 100 s of wall time passed
    got = alerts.spans_restored(saved, 10.0, wall + 100.0)
    assert got == {"A": (10.0 - 1159.0, 10.0 - 100.0), "B": (10.0 - 1100.0, 10.0 - 160.0)}


def test_spans_restored_drops_what_it_cannot_trust():
    sr = alerts.spans_restored
    for saved in (None, [1], {}, {"spans": [1]}, {"spans": None}):
        assert sr(saved, 0.0, 100.0) == {}, saved
    for pair in ("ab", [1.0], [1.0, 2.0, 3.0], [None, 90.0], [80.0, "90"], [90.0, 80.0], [80.0, 101.0]):
        # A bad row does not hide the good one after it.
        assert sr({"spans": {"bad": pair, "ok": [80.0, 90.0]}}, 0.0, 100.0) == {"ok": (-20.0, -10.0)}, pair
    assert sr({"spans": {"A": [90.0, 90.0]}}, 0.0, 100.0) == {"A": (-10.0, -10.0)}
    wall = 100_000.0
    assert sr({"spans": {"A": [1.0, wall - 1799.0]}}, 0.0, wall) == {"A": (1.0 - wall, -1799.0)}
    assert sr({"spans": {"A": [1.0, wall - 1800.0]}}, 0.0, wall) == {}, "too old: the next sample begins a new span"


# the wire: a restart
@pytest.mark.sets_capture_events
def test_a_restart_after_the_doff_keeps_the_night_and_sends_one_note(tmp_path, monkeypatch, morning):
    """MEASURED on the capture box 2026-11-24: the strap's last sample was at 05:01:15 and a deploy restarted
    the daemon at 05:01:38. That restart and three more each sent "offline for ~5 min"."""
    wall, sent = 5_000_000.0, []

    class _Note:
        enabled = True

        async def send(self, title, message, **kw):
            sent.append((title, message))
            return True

    p = tmp_path / "captures" / alerts.QUIET_STATE_NAME
    p.parent.mkdir(parents=True)
    p.write_text(json.dumps({"spans": {NM: [wall - 7 * H, wall - 23.0]}}))
    cfg = {
        "root": str(tmp_path),
        "alerts": {"poll_sec": 1, "offline_sec": 300},
        "devices": [{"name": NM, "vendor": "Polar", "address": ADDR, "streams": ["ppg"]}],
    }
    clock = {"t": 100.0, "since": 0.0}

    async def sleep(_s):
        clock["t"] += 60.0
        if clock["t"] > 100.0 + 15 * 60:
            capture._STOP.set()

    monkeypatch.setattr(capture.asyncio, "sleep", sleep)
    monkeypatch.setattr(capture._time, "monotonic", lambda: clock["t"])
    monkeypatch.setattr(capture._time, "time", lambda: wall + clock["since"] + clock["t"] - 100.0)
    capture.STATUS["devices"][NM] = {"connected": False}
    for m in (capture._LAST_DATA, capture._LAST_PULL_OK):
        m.pop(NM, None)
    for run in (1, 2):  # the second run is the next restart: the note's stamp keeps it quiet
        capture._STOP.clear()
        clock.update(t=100.0, since=(run - 1) * 960.0)  # a restart: monotonic starts again, the wall goes on
        asyncio.run(capture.alert_poller(cfg, _Note()))
        assert [t for t, _ in sent] == [NOTE], run
    assert "streamed for 6 h 59 min" in sent[0][1], sent[0][1]


@pytest.mark.sets_capture_events
def test_a_recording_device_saves_its_span(tmp_path, monkeypatch):
    class _Note:
        enabled = True

        async def send(self, *a, **k):
            return True

    calls = {"n": 0}

    async def sleep(_s):
        calls["n"] += 1
        capture._LAST_DATA[NM] = 900.0 + 50 * calls["n"]
        if calls["n"] >= 2:
            capture._STOP.set()

    cfg = {
        "root": str(tmp_path),
        "alerts": {"poll_sec": 1, "offline_sec": 300},
        "devices": [{"name": NM, "vendor": "Polar", "address": ADDR, "streams": ["ppg"]}],
    }
    (tmp_path / "captures").mkdir()
    monkeypatch.setattr(capture.asyncio, "sleep", sleep)
    monkeypatch.setattr(capture._time, "monotonic", lambda: 1000.0)
    monkeypatch.setattr(capture._time, "time", lambda: 5000.0)
    capture.STATUS["devices"][NM] = {"connected": True}
    capture._WORN_SINCE.pop(ADDR, None)
    capture._STOP.clear()
    asyncio.run(capture.alert_poller(cfg, _Note()))
    saved = json.loads((tmp_path / "captures" / alerts.QUIET_STATE_NAME).read_text())
    assert saved["spans"] == {NM: [4950.0, 5000.0]}
