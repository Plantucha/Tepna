# tepna-capture — tests/test_reconnect_backoff_cap.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# VIGIL-OVERNIGHT-FINDINGS P2.1 — the error backoff a MANDATORY runner rides when its device is simply
# not here. Until 2026-09-05 the three loops (run_polar · run_viatom · run_oxyii) capped at 60 s, which
# with the 30 s connect timeout is a ~90 s cycle: the vigil journal showed 27–35 (H10) and 36–46
# (O2Ring) hopeless scans PER HOUR, all day, on every day the box was up — against a brief that asked
# for a cap of ~5 min and < 20 attempts/hour. The brief's 2026-08-19 verification table had cited the
# OPTIONAL-device branch (`min(max(backoff, 120), 300)`), which the mandatory devices never take.
#
# The cap is now ONE module constant, `_RECONNECT_BACKOFF_CAP_S`, shared by all three loops and
# overridable via `power.reconnect_backoff_cap_sec`. These tests drive each real runner against a
# connect that raises the absent-device error and read the sleeps it takes.

import asyncio

import pytest
from bleak.exc import BleakDeviceNotFoundError

import capture
import settings_schema

_ABSENT = "not advertising — device off, out of range, or held by another central"


@pytest.fixture(autouse=True)
def _fresh_events(monkeypatch):
    """A module-level asyncio.Event binds to the first loop that awaits it and every asyncio.run() below
    is a new loop — recreate them per test, as test_capture_runners does. Jitter is OFF here: this file
    pins the SCHEDULE (5 → … → cap, held); the ±10 % jitter `_retry_sleep` adds on top is pinned by
    tests/test_resource_orchestration.py, and with it on the 5 s floor sleep lands below the recorder's
    ≥ 5 s filter about half the time."""
    monkeypatch.setattr(capture, "_RETRY_JITTER", 0.0)
    capture._STOP = asyncio.Event()
    capture._RECOVER = asyncio.Event()
    capture._OXYII_PAUSE = asyncio.Event()
    capture._CONNECT_LOCK = asyncio.Lock()
    capture._POLAR_PAUSED.clear()
    capture._WORN_SINCE.clear()
    capture._OXYII_RTC_AT.clear()
    capture.STATUS["devices"] = {}
    yield


def _record_backoffs(monkeypatch, n):
    """Patch capture's sleep to record every reconnect-backoff sleep (≥ 5 s — the floor of the schedule;
    the poll/negotiation sleeps are all shorter) and trip _STOP once `n` of them have been taken."""
    slept: list[float] = []
    real = asyncio.sleep

    async def rec(secs):
        if secs and secs >= 5:
            slept.append(secs)
            if len(slept) >= n:
                capture._STOP.set()
        await real(0)

    monkeypatch.setattr(capture.asyncio, "sleep", rec)
    return slept


def _absent(addr, *a, **k):
    raise BleakDeviceNotFoundError(_ABSENT)


# 5 → 10 → 20 → 40 → 80 → 160 → 180 → 180 → 180: doubling from the floor, then HELD at the cap. The
# held tail is the point — a cap that was not a cap (a reset, a further doubling) shows up there.
_EXPECTED = [5, 10, 20, 40, 80, 160, 180, 180, 180]


def test_the_cap_meets_the_briefs_attempts_per_hour_bound():
    """VIGIL-OVERNIGHT-FINDINGS §8 done-when: '< 20 relink attempts/hour' for an absent device. Every
    attempt costs the connect timeout (a scan on the shared radio) plus the backoff sleep, so the rate
    at the cap is 3600 / (timeout + cap). The old 60 s cap gave 40/h; 180 s gives ~17/h."""
    cycle = capture._BLE_CONNECT_TIMEOUT_S + capture._RECONNECT_BACKOFF_CAP_S
    assert 3600 / cycle < 20, f"{3600 / cycle:.1f} attempts/hour at the cap — the brief's bound is < 20"
    assert capture._RECONNECT_BACKOFF_CAP_S <= 300, "and no more than the brief's '~5 min' — pickup latency"


def test_the_schema_default_is_the_module_constant():
    """The settings table's default is the single source of truth the UI advertises — it must be the
    value the daemon actually falls back to (same pin test_drop_not_worn applies to its siblings)."""
    key = "power.reconnect_backoff_cap_sec"
    assert key in settings_schema.SETTINGS
    assert settings_schema.SETTINGS[key][4] == capture._RECONNECT_BACKOFF_CAP_S
    _typ, lo, hi, needs_restart, _d, _help = settings_schema.SETTINGS[key]
    assert lo >= 60 and hi <= 900 and needs_restart is True


@pytest.mark.sets_capture_events
def test_absent_o2ring_backoff_climbs_to_the_cap_and_holds(tmp_path, monkeypatch):
    """run_oxyii against a ring that never advertises: no session is ever viable, so the backoff must
    climb from 5 s and then HOLD at the cap — never reset, never exceed it."""
    monkeypatch.setattr(capture, "_connect_scan", _absent)
    slept = _record_backoffs(monkeypatch, len(_EXPECTED))
    dev = {
        "name": "RingGone",
        "vendor": "Wellue",
        "model": "O2Ring-S",
        "device_id": "S8AW",
        "address": "D1:98:62:7C:92:B3",
        "streams": ["spo2"],
    }
    asyncio.run(capture.run_oxyii(dev, str(tmp_path)))
    assert slept == _EXPECTED, slept
    assert "BleakDeviceNotFoundError" in capture.STATUS["devices"]["RingGone"]["last_error"], (
        "the absent-device error is what drove every cycle — this must not pass via some other path"
    )


@pytest.mark.sets_capture_events
def test_absent_h10_backoff_climbs_to_the_cap_and_holds(tmp_path, monkeypatch):
    """run_polar, same schedule. The H10 is the device the journal showed at 27–35 hopeless scans/hour."""

    async def bonded(*a, **k):
        return True

    monkeypatch.setattr(capture.bonding, "ensure_bonded", bonded)
    capture._CFG.clear()
    capture._CFG.update({"time": {"auto_sync_devices": False}})
    monkeypatch.setattr(capture, "_connect", _absent)
    slept = _record_backoffs(monkeypatch, len(_EXPECTED))
    dev = {
        "name": "H10Gone",
        "vendor": "Polar",
        "model": "H10",
        "device_id": "12345678",
        "address": "24:AC:AC:02:84:96",
        "streams": ["ecg"],
    }
    asyncio.run(capture.run_polar(dev, str(tmp_path)))
    assert slept == _EXPECTED, slept
    assert "BleakDeviceNotFoundError" in (capture.STATUS["devices"]["H10Gone"].get("last_error") or "")


@pytest.mark.sets_capture_events
def test_absent_legacy_ring_backoff_climbs_to_the_cap_and_holds(tmp_path, monkeypatch):
    """run_viatom (the legacy O2Ring path) rides the same constant — three loops, one cap."""

    async def bonded(*a, **k):
        return True

    monkeypatch.setattr(capture.bonding, "ensure_bonded", bonded)
    monkeypatch.setattr(capture, "_connect", _absent)
    slept = _record_backoffs(monkeypatch, len(_EXPECTED))
    dev = {
        "name": "LegacyGone",
        "vendor": "Wellue",
        "model": "O2Ring",
        "device_id": "S8AW",
        "address": "D1:98:62:7C:92:B3",
        "streams": ["spo2"],
        "protocol": "legacy",
    }
    asyncio.run(capture.run_viatom(dev, str(tmp_path)))
    assert slept == _EXPECTED, slept


@pytest.mark.sets_capture_events
def test_the_optional_device_branch_keeps_its_own_schedule(tmp_path, monkeypatch):
    """An OPTIONAL backup device is known-but-not-expected and already slept 120–300 s per cycle; the
    mandatory cap must not have pulled it DOWN to 180. (This is the branch the brief's 2026-08-19 table
    verified, mistaking it for the mandatory one.)"""

    async def bonded(*a, **k):
        return True

    monkeypatch.setattr(capture.bonding, "ensure_bonded", bonded)
    capture._CFG.clear()
    capture._CFG.update({"time": {"auto_sync_devices": False}})
    monkeypatch.setattr(capture, "_connect", _absent)
    slept = _record_backoffs(monkeypatch, 4)
    dev = {
        "name": "Spare",
        "vendor": "Coospo",
        "model": "HRM808S",
        "device_id": "X",
        "address": "AA:BB:CC:DD:EE:01",
        "streams": ["hr"],
        "optional": True,
    }
    asyncio.run(capture.run_polar(dev, str(tmp_path)))
    assert slept == [120, 120, 120, 120], slept  # min(max(5..40, 120), 300)


@pytest.mark.sets_capture_events
def test_config_override_raises_the_cap(tmp_path, monkeypatch):
    """`power.reconnect_backoff_cap_sec` reaches the loop: with 400 the O2Ring schedule doubles past 180."""
    monkeypatch.setattr(capture, "_RECONNECT_BACKOFF_CAP_S", 400.0)
    monkeypatch.setattr(capture, "_connect_scan", _absent)
    slept = _record_backoffs(monkeypatch, 8)
    dev = {
        "name": "RingGone",
        "vendor": "Wellue",
        "model": "O2Ring-S",
        "device_id": "S8AW",
        "address": "D1:98:62:7C:92:B3",
        "streams": ["spo2"],
    }
    asyncio.run(capture.run_oxyii(dev, str(tmp_path)))
    assert slept == [5, 10, 20, 40, 80, 160, 320, 400], slept


# ── E16 · THE BUDGET IS NOW MEASURED ────────────────────────────────────────────────────────────────
# The header above states P2.1's requirement — a cap of ~5 min and **< 20 attempts/hour** — and the
# tests above pin the SCHEDULE that was supposed to deliver it. Nothing measured the rate itself, so
# when E16 reported "the daemon keeps rescanning the doffed ring every ~3 min, 35 cycles between 04:24
# and 06:20", there was no instrument to say whether that was a breach or the spec working. It is the
# spec working: 35 over 116 min is 18.1/h on a 199 s cycle, inside the budget and within 5 % of the
# cycle this file predicts. These tests exist so the next report of this shape is answered by a
# measurement instead of an argument.


@pytest.fixture
def _fresh_rate_counters(monkeypatch):
    """The rate counters are module-level and process-lifetime by design (like `_WORN_SINCE`), so they
    must be isolated per test or the second test reads the first one's stamps."""
    monkeypatch.setattr(capture, "_RETRY_STAMPS", {})
    monkeypatch.setattr(capture, "_RETRY_SINCE", {})
    monkeypatch.setattr(capture, "_RETRY_ALERTED", {})


def test_a_rate_over_a_PARTIAL_window_is_None_not_a_big_number():
    """∅ Ten attempts in the first ten minutes is ten attempts and an UNKNOWN rate. Extrapolating it to
    60/h would alert on every daemon start, which is how a warning becomes unread."""
    now = 10_000.0
    stamps = [now - 60.0 * i for i in range(10)]
    assert capture.retry_rate_per_hour(stamps, now, observing_since=now - 600.0) is None, (
        "ten minutes of observation cannot answer a per-hour question"
    )
    assert capture.retry_rate_per_hour(stamps, now, observing_since=now - 3599.0) is None, "one second short"
    assert capture.retry_rate_per_hour(stamps, now, observing_since=now - 3600.0) == 10.0, "exactly at the bound"


def test_the_rate_counts_only_the_TRAILING_window():
    now = 10_000.0
    inside = [now - 100.0, now - 200.0, now - 3599.0]
    outside = [now - 3601.0, now - 7200.0]  # older than the window: not this hour's attempts
    assert capture.retry_rate_per_hour(inside + outside, now, observing_since=0.0) == 3.0
    assert capture.retry_rate_per_hour(outside, now, observing_since=0.0) == 0.0, (
        "a device that has stopped retrying reads ZERO, which is a measurement — not None"
    )


def test_E16_s_OWN_night_is_INSIDE_the_budget_and_that_is_the_finding():
    """The number the whole unit turns on, as an assertion rather than a sentence: 35 `scan + connect`
    cycles between 04:24 and 06:20 EDT on 2026-09-28. If a future change to the cap or the cycle pushes
    that shape over 20/h, this test is where it will be noticed."""
    start = 1000.0
    cycle = (6 * 3600 + 20 * 60 - (4 * 3600 + 24 * 60)) / 35.0  # 116 min over 35 cycles
    assert cycle == pytest.approx(198.9, abs=0.1), "the measured cycle, from E16's own two timestamps"
    stamps = [start + cycle * i for i in range(35)]
    episode = 116 * 60.0
    end = start + episode
    # ⚠️ TWO CORRECT ANSWERS, AND THE DIFFERENCE IS THE ENDPOINT CONVENTION — written down because the
    # obvious "fix" is to make the function agree with the headline, and that would be wrong.
    #   · E16's prose divides 35 attempts by 116 min and reports **18.1/h**. That counts BOTH endpoints
    #     of the span, i.e. 35 points across 34 intervals.
    #   · The shipped window is half-open, `cut < t <= now`, because that is what makes consecutive
    #     windows partition the stamps instead of double-counting the boundary. Over the same span it
    #     therefore counts 34 and reads **17.6/h**.
    # The claim the unit rests on is unaffected: both are comfortably inside P2.1's < 20/h.
    assert 35 / (episode / 3600.0) == pytest.approx(18.1, abs=0.1), "E16's prose arithmetic"
    rate = capture.retry_rate_per_hour(stamps, end, observing_since=start, window_sec=episode)
    assert rate == pytest.approx(17.6, abs=0.1), f"the shipped half-open window reads {rate}/h"
    assert rate < capture._RECONNECT_BUDGET_PER_HOUR, (
        "E16's rescan rate is INSIDE P2.1's budget — which is why E16 changed no constant"
    )
    # And through the shipped one-hour window, ending with the episode: the same answer.
    hourly = capture.retry_rate_per_hour(stamps, end, observing_since=start)
    assert hourly == pytest.approx(18.0, abs=1.0), f"trailing hour reads {hourly}/h"
    assert hourly < capture._RECONNECT_BUDGET_PER_HOUR
    assert capture.retry_budget_alert(stamps, end, start, None) is None, "and therefore raises no alert"
    # ⚠️ A WINDOW THAT ENDS BEFORE THE STAMPS DO must not count them. Asking at the episode's START
    # once an hour of observation exists reads the FIRST hour, 18 attempts — not all 35. Getting this
    # wrong is what made the first draft of this test read 34/h out of an 18/h night.
    assert capture.retry_rate_per_hour(stamps, start + 3600.0, observing_since=start) == 18.0


def test_the_alert_fires_over_budget_ONCE_per_window_per_device():
    now = 10_000.0
    stamps = [now - 60.0 * i for i in range(25)]  # 25 in the hour, budget is 20
    assert capture.retry_budget_alert(stamps, now, now - 3600.0, None) == 25.0
    assert capture.retry_budget_alert(stamps, now, now - 3600.0, last_alert=now - 10.0) is None, (
        "already warned this window — a tripwire that fires on every retry is the unread warning again"
    )
    assert capture.retry_budget_alert(stamps, now, now - 3600.0, last_alert=now - 3600.0) == 25.0, (
        "a full window later it is due again"
    )
    at_budget = [now - 60.0 * i for i in range(20)]
    assert capture.retry_budget_alert(at_budget, now, now - 3600.0, None) is None, (
        "the requirement is < 20/h, so exactly 20 is not yet a breach — the boundary is the whole content"
    )


def test_only_the_ERROR_backoff_is_counted_and_the_warning_reaches_the_journal(
    _fresh_rate_counters, monkeypatch, caplog
):
    """Drives `_retry_sleep` itself, both sides of its one branch: the steady cadences must leave the
    counter untouched, and a device over budget must say so in the journal."""
    monkeypatch.setattr(capture, "_RETRY_JITTER", 0.0)
    # No sleep patch: every call below passes delay 0.0, so `asyncio.sleep(0)` is what runs. Patching
    # `capture.asyncio.sleep` with a lambda that calls `asyncio.sleep` recurses into itself — the two
    # names are the same object.

    async def _drive():
        for why in ("charging", "stalled", "not_worn"):
            await capture._retry_sleep("H10", 0.0, why, 1)
        assert capture._RETRY_STAMPS == {}, "a steady recheck has no attempts/hour requirement to breach"
        await capture._retry_sleep("H10", 0.0, "backoff", 1)
        assert len(capture._RETRY_STAMPS["H10"]) == 1

    asyncio.run(_drive())
    assert "attempts/hour" not in caplog.text, "one backoff inside a partial window must not alert"

    # Now a device whose first backoff was over an hour ago and which has retried 25 times since.
    mono = capture._time.monotonic()
    capture._RETRY_SINCE["O2Ring-S"] = mono - 7200.0
    capture._RETRY_STAMPS["O2Ring-S"] = [mono - 60.0 * i for i in range(25)]
    with caplog.at_level("WARNING"):
        asyncio.run(capture._retry_sleep("O2Ring-S", 0.0, "backoff", 9))
    assert "attempts/hour" in caplog.text and "budget" in caplog.text, caplog.text
    assert "O2Ring-S" in caplog.text
    first = caplog.text.count("attempts/hour")
    with caplog.at_level("WARNING"):
        asyncio.run(capture._retry_sleep("O2Ring-S", 0.0, "backoff", 10))
    assert caplog.text.count("attempts/hour") == first, "deduped inside the window"
