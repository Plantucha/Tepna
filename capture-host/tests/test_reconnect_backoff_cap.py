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
def _fresh_events():
    """A module-level asyncio.Event binds to the first loop that awaits it and every asyncio.run() below
    is a new loop — recreate them per test, as test_capture_runners does."""
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


def test_absent_o2ring_backoff_climbs_to_the_cap_and_holds(tmp_path, monkeypatch):
    """run_oxyii against a ring that never advertises: no session is ever viable, so the backoff must
    climb from 5 s and then HOLD at the cap — never reset, never exceed it."""
    monkeypatch.setattr(capture, "_connect_scan", _absent)
    slept = _record_backoffs(monkeypatch, len(_EXPECTED))
    dev = {"name": "RingGone", "vendor": "Wellue", "model": "O2Ring-S", "device_id": "S8AW",
           "address": "D1:98:62:7C:92:B3", "streams": ["spo2"]}
    asyncio.run(capture.run_oxyii(dev, str(tmp_path)))
    assert slept == _EXPECTED, slept
    assert "BleakDeviceNotFoundError" in capture.STATUS["devices"]["RingGone"]["last_error"], \
        "the absent-device error is what drove every cycle — this must not pass via some other path"


def test_absent_h10_backoff_climbs_to_the_cap_and_holds(tmp_path, monkeypatch):
    """run_polar, same schedule. The H10 is the device the journal showed at 27–35 hopeless scans/hour."""
    async def bonded(*a, **k):
        return True
    monkeypatch.setattr(capture.bonding, "ensure_bonded", bonded)
    capture._CFG.clear(); capture._CFG.update({"time": {"auto_sync_devices": False}})
    monkeypatch.setattr(capture, "_connect", _absent)
    slept = _record_backoffs(monkeypatch, len(_EXPECTED))
    dev = {"name": "H10Gone", "vendor": "Polar", "model": "H10", "device_id": "12345678",
           "address": "24:AC:AC:02:84:96", "streams": ["ecg"]}
    asyncio.run(capture.run_polar(dev, str(tmp_path)))
    assert slept == _EXPECTED, slept
    assert "BleakDeviceNotFoundError" in (capture.STATUS["devices"]["H10Gone"].get("last_error") or "")


def test_absent_legacy_ring_backoff_climbs_to_the_cap_and_holds(tmp_path, monkeypatch):
    """run_viatom (the legacy O2Ring path) rides the same constant — three loops, one cap."""
    async def bonded(*a, **k):
        return True
    monkeypatch.setattr(capture.bonding, "ensure_bonded", bonded)
    monkeypatch.setattr(capture, "_connect", _absent)
    slept = _record_backoffs(monkeypatch, len(_EXPECTED))
    dev = {"name": "LegacyGone", "vendor": "Wellue", "model": "O2Ring", "device_id": "S8AW",
           "address": "D1:98:62:7C:92:B3", "streams": ["spo2"], "protocol": "legacy"}
    asyncio.run(capture.run_viatom(dev, str(tmp_path)))
    assert slept == _EXPECTED, slept


def test_the_optional_device_branch_keeps_its_own_schedule(tmp_path, monkeypatch):
    """An OPTIONAL backup device is known-but-not-expected and already slept 120–300 s per cycle; the
    mandatory cap must not have pulled it DOWN to 180. (This is the branch the brief's 2026-08-19 table
    verified, mistaking it for the mandatory one.)"""
    async def bonded(*a, **k):
        return True
    monkeypatch.setattr(capture.bonding, "ensure_bonded", bonded)
    capture._CFG.clear(); capture._CFG.update({"time": {"auto_sync_devices": False}})
    monkeypatch.setattr(capture, "_connect", _absent)
    slept = _record_backoffs(monkeypatch, 4)
    dev = {"name": "Spare", "vendor": "Coospo", "model": "HRM808S", "device_id": "X",
           "address": "AA:BB:CC:DD:EE:01", "streams": ["hr"], "optional": True}
    asyncio.run(capture.run_polar(dev, str(tmp_path)))
    assert slept == [120, 120, 120, 120], slept   # min(max(5..40, 120), 300)


def test_config_override_raises_the_cap(tmp_path, monkeypatch):
    """`power.reconnect_backoff_cap_sec` reaches the loop: with 400 the O2Ring schedule doubles past 180."""
    monkeypatch.setattr(capture, "_RECONNECT_BACKOFF_CAP_S", 400.0)
    monkeypatch.setattr(capture, "_connect_scan", _absent)
    slept = _record_backoffs(monkeypatch, 8)
    dev = {"name": "RingGone", "vendor": "Wellue", "model": "O2Ring-S", "device_id": "S8AW",
           "address": "D1:98:62:7C:92:B3", "streams": ["spo2"]}
    asyncio.run(capture.run_oxyii(dev, str(tmp_path)))
    assert slept == [5, 10, 20, 40, 80, 160, 320, 400], slept
