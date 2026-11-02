# tepna-capture — tests/test_alert_why.py
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""Two alert decisions from board #2972 (Kestrel, CLAUDE.md §7), both measured on the capture box from
2026-10-19 to 2026-11-01.

1. The quiet after a night-ended note holds until the device records again or the next night begins.
   The 8 h expiry sent "offline for ~481 min — capture is missing it" at 12:22 for a device that was off
   by design.
2. "capture started" names why the daemon started. 72 of 98 starts were deploys, and the alert said
   the same words for a deploy, a boot and a crash.
"""

import asyncio
import datetime as dt
import json
import sys

import pytest

import alerts
import capture
import nightqc

_WALL = 5_000_000.0
_MONO = 100_000.0
_RING = "Wellue O2Ring TEST0009"
_STRAP = "Polar H10 TEST0009"


def _run(coro):
    return asyncio.run(coro)


def _dev(name):
    return {
        "name": name,
        "vendor": "Polar",
        "model": "H10",
        "device_id": "00000009",
        "address": "AA:BB:CC:00:00:09",
        "streams": ["ecg"],
    }


# ── pure: the night boundary and the licence ───────────────────────────────────────────────────────
def test_the_night_begins_at_the_owners_18_00_edge_and_ends_before_the_morning():
    assert alerts.NIGHT_BEGIN_H == nightqc._NIGHT_BEGIN_H == 18
    assert [h for h in range(24) if alerts.begins_a_night(h)] == [0, 1, 2, 3, 18, 19, 20, 21, 22, 23]
    assert alerts.STREAM_MORNING_HOURS.start == 4


def test_the_licence_holds_until_a_night_begins_after_the_stamp():
    assert alerts.quiet_licence_holds(None, None) is False
    assert alerts.quiet_licence_holds(None, 5.0) is False
    assert alerts.quiet_licence_holds(100.0, None) is True
    assert alerts.quiet_licence_holds(100.0, 99.0) is True, "a night that began before the note"
    assert alerts.quiet_licence_holds(100.0, 100.0) is False
    assert alerts.quiet_licence_holds(100.0, 101.0) is False


def test_the_quiet_state_carries_the_night_start_through_a_restart():
    saved = alerts.quiet_state_to_save({}, {"ring": 900.0}, 1060.0, _WALL, 1000.0)
    assert saved == {"pull_ok": {}, "ended": {"ring": _WALL - 160.0}, "night_began": _WALL - 60.0}
    assert alerts.quiet_state_to_save({}, {}, 1060.0, _WALL)["night_began"] is None
    # a restart: the monotonic clock starts again at 10.0, and 100 s of wall time passed
    assert alerts.night_began_restored(saved, 10.0, _WALL + 100.0) == 10.0 - 160.0


def test_a_bad_night_start_reads_as_absent():
    for saved in (None, [1], {}, {"night_began": None}, {"night_began": True}, {"night_began": "5"}):
        assert alerts.night_began_restored(saved, 0.0, _WALL) is None, saved
    assert alerts.night_began_restored({"night_began": _WALL + 1}, 0.0, _WALL) is None, "a future stamp"
    assert alerts.night_began_restored({"night_began": _WALL}, 7.0, _WALL) == 7.0


def test_an_ended_stamp_has_no_age_bound_but_a_pull_stamp_keeps_8_h():
    three_days = 3 * 24 * 3600.0
    saved = {"pull_ok": {"ring": _WALL - three_days}, "ended": {"ring": _WALL - three_days, "late": _WALL + 1}}
    pull_ok, ended = alerts.quiet_state_restored(saved, 50.0, _WALL)
    assert pull_ok == {}
    assert ended == {"ring": 50.0 - three_days}


# ── pure: why the daemon started ────────────────────────────────────────────────────────────────────
def test_the_run_record_shape():
    assert alerts.run_record("b1", "abc1234") == {"boot_id": "b1", "git": "abc1234", "stopped": None}
    assert alerts.run_record("b1", "abc1234", 0)["stopped"] == 0


@pytest.mark.parametrize(
    "prev, boot, git, want",
    [
        (None, "b1", "new", "no record of a previous run"),
        (["x"], "b1", "new", "no record of a previous run"),
        ({"boot_id": "b0", "git": "old", "stopped": 0}, "b1", "new", "the box booted"),
        ({"boot_id": "b0", "git": "new", "stopped": None}, "b1", "new", "the box booted"),
        ({"boot_id": "b1", "git": "old", "stopped": 0}, "b1", "new", "a deploy moved the code from old to new"),
        ({"boot_id": "b1", "git": "new", "stopped": 0}, "b1", "new", "a clean stop and start on the same code (new)"),
        (
            {"boot_id": "b1", "git": "new", "stopped": 1},
            "b1",
            "new",
            "the previous run exited with code 1 to ask for a restart",
        ),
        (
            {"boot_id": "b1", "git": "new", "stopped": None},
            "b1",
            "new",
            "the previous run on new did not stop cleanly (a crash or a kill)",
        ),
        (
            {"boot_id": "b1", "git": "new", "stopped": True},
            "b1",
            "new",
            "the previous run on new did not stop cleanly (a crash or a kill)",
        ),
        # An unreadable boot id or commit cannot name a boot or a deploy.
        (
            {"boot_id": "b0", "git": "old", "stopped": 0},
            None,
            None,
            "a clean stop and start on the same code (unknown)",
        ),
        (
            {"boot_id": None, "git": None},
            "b1",
            None,
            "the previous run on unknown code did not stop cleanly (a crash or a kill)",
        ),
    ],
)
def test_the_start_reason(prev, boot, git, want):
    assert alerts.start_reason(prev, boot, git) == want


# ── the wire: the alert poller ──────────────────────────────────────────────────────────────────────
def _poll(tmp_path, monkeypatch, *, saved=None, hour=12, strap_records=False, polls=3):
    """Run the alert poller on a ring that is off and a strap; return the alerts it sent."""
    if saved is not None:
        p = tmp_path / "captures" / alerts.QUIET_STATE_NAME
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(saved))
    capture.STATUS["devices"][_RING] = {"connected": False}
    capture.STATUS["devices"][_STRAP] = {"connected": strap_records}
    for nm in (_RING, _STRAP):
        capture._LAST_DATA.pop(nm, None)
        capture._LAST_PULL_OK.pop(nm, None)
        capture._IDLE_TIMER_NAMED.discard(nm)
    if strap_records:
        capture._LAST_DATA[_STRAP] = _MONO
    sent = []

    class _N:
        enabled = True

        async def send(self, title, message, **kw):
            sent.append((title, message))
            return True

    calls = {"n": 0}

    async def fake_sleep(_s):
        calls["n"] += 1
        if calls["n"] >= polls:
            capture._STOP.set()

    cfg = {
        "root": str(tmp_path),
        "alerts": {"poll_sec": 1, "offline_sec": 0},
        "devices": [_dev(_RING), _dev(_STRAP) | {"optional": True}],
    }
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(capture._time, "monotonic", lambda: _MONO)
    monkeypatch.setattr(capture._time, "time", lambda: _WALL)
    monkeypatch.setattr(capture, "_now", lambda: dt.datetime(2026, 10, 29, hour, 22))
    capture._STOP.clear()
    try:
        _run(capture.alert_poller(cfg, _N()))
    finally:
        for nm in (_RING, _STRAP):
            capture._LAST_DATA.pop(nm, None)
            capture.STATUS["devices"].pop(nm, None)
    assert calls["n"] >= polls
    return sent


def _saved_state(tmp_path):
    return json.loads((tmp_path / "captures" / alerts.QUIET_STATE_NAME).read_text())


_ENDED_8H_AGO = {"pull_ok": {}, "ended": {_RING: _WALL - 481 * 60}}


@pytest.mark.sets_capture_events
def test_a_device_off_since_its_night_ended_stays_quiet_past_8_h(tmp_path, monkeypatch):
    """MEASURED on 2026-10-29 at 12:22: "offline for ~481 min — capture is missing it" for a device that was off
    by design since its night ended."""
    assert _poll(tmp_path, monkeypatch, saved=_ENDED_8H_AGO) == []
    assert _saved_state(tmp_path)["ended"] == {_RING: _WALL - 481 * 60}


@pytest.mark.sets_capture_events
def test_a_morning_wear_of_another_device_does_not_begin_a_night(tmp_path, monkeypatch):
    assert _poll(tmp_path, monkeypatch, saved=_ENDED_8H_AGO, hour=7, strap_records=True) == []
    assert _saved_state(tmp_path)["night_began"] is None


@pytest.mark.sets_capture_events
def test_an_evening_wear_of_another_device_begins_a_night_and_the_alarm_returns(tmp_path, monkeypatch):
    sent = _poll(tmp_path, monkeypatch, saved=_ENDED_8H_AGO, hour=22, strap_records=True)
    assert sent == [("Tepna: sensor offline", f"{_RING} has been offline for ~0 min — capture is missing it.")]
    saved = _saved_state(tmp_path)
    assert saved["night_began"] == _WALL and saved["ended"] == {}


@pytest.mark.sets_capture_events
def test_a_night_start_saved_before_a_restart_ends_the_licence(tmp_path, monkeypatch):
    saved = dict(_ENDED_8H_AGO, night_began=_WALL - 60)
    assert [t for t, _ in _poll(tmp_path, monkeypatch, saved=saved)] == ["Tepna: sensor offline"]


@pytest.mark.sets_capture_events
def test_a_night_start_saved_before_the_note_keeps_the_licence(tmp_path, monkeypatch):
    saved = dict(_ENDED_8H_AGO, night_began=_WALL - 20 * 3600)
    assert _poll(tmp_path, monkeypatch, saved=saved) == []


@pytest.mark.sets_capture_events
def test_a_linked_device_with_a_licence_still_alarms_when_it_records_nothing(tmp_path, monkeypatch):
    """The licence covers a device that is off. A linked device that sends nothing is a fault."""
    p = tmp_path / "captures" / alerts.QUIET_STATE_NAME
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(_ENDED_8H_AGO))
    monkeypatch.setitem(capture.STATUS["devices"], _RING, {"connected": True})
    sent = []

    class _N:
        enabled = True

        async def send(self, title, message, **kw):
            sent.append(message)
            return True

    calls = {"n": 0}

    async def fake_sleep(_s):
        calls["n"] += 1
        if calls["n"] >= 2:
            capture._STOP.set()

    capture._LAST_DATA.pop(_RING, None)
    capture._LAST_PULL_OK.pop(_RING, None)
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(capture._time, "monotonic", lambda: _MONO)
    monkeypatch.setattr(capture._time, "time", lambda: _WALL)
    monkeypatch.setattr(capture, "_now", lambda: dt.datetime(2026, 10, 29, 12, 22))
    capture._STOP.clear()
    cfg = {"root": str(tmp_path), "alerts": {"poll_sec": 1, "offline_sec": 0}, "devices": [_dev(_RING)]}
    _run(capture.alert_poller(cfg, _N()))
    assert sent == [f"{_RING} has been linked but recording nothing for ~0 min — capture is missing it."]


# ── the wire: main() and the run record ─────────────────────────────────────────────────────────────
def _main(tmp_path, monkeypatch, git, boot="boot-1"):
    """Run main() once, stopping at once; return the 'capture started' message."""
    import webmon
    import yaml as _yaml

    bootp = tmp_path / "boot_id"
    bootp.write_text(boot + "\n")
    monkeypatch.setattr(capture, "_BOOT_ID_PATH", str(bootp))
    monkeypatch.setattr(capture.build_id, "probe", lambda *a, **k: {"git": git, "dirty": False, "started": 0.0})
    monkeypatch.setattr(capture.sdnotify, "sd_notify", lambda s: True)
    posts = []

    async def fake_post(url, payload):
        posts.append(payload)
        return True

    monkeypatch.setattr(capture.alerts, "_http_post", fake_post)

    async def _n(*a, **k):
        return None

    for r in (
        "run_polar",
        "run_oxyii",
        "run_viatom",
        "run_muse",
        "status_loop",
        "adapter_watchdog",
        "rssi_poller",
        "clock_watchdog",
        "host_clock_poller",
        "storage_poller",
        "alert_poller",
        "qc_poller",
        "archive_poller",
        "sd_watchdog",
    ):
        monkeypatch.setattr(capture, r, _n)

    async def fake_hci(mac, refresh=False):
        return "hci2"

    monkeypatch.setattr(capture.link_rssi, "resolve_hci", fake_hci)

    class _Runner:
        async def cleanup(self):
            pass

    async def fake_start(app, host, port):
        capture._STOP.set()
        return _Runner()

    monkeypatch.setattr(webmon, "start", fake_start)
    cfg = {
        "adapter": "AA:BB:CC:00:00:10",
        "root": str(tmp_path),
        "web": {"enabled": True, "host": "127.0.0.1", "port": 0},
        "alerts": {"enabled": True, "webhook_url": "https://hook"},
        "devices": [_dev(_STRAP)],
    }
    cfgp = tmp_path / "config.yaml"
    cfgp.write_text(_yaml.safe_dump(cfg))
    monkeypatch.setattr(sys, "argv", ["capture.py", "--config", str(cfgp)])
    capture._STOP.clear()
    _run(capture.main())
    started = [p for p in posts if p["title"] == "Tepna: capture started"]
    assert len(started) == 1, posts
    return started[0]["message"].split("\n\n")[0]  # the notifier adds a host footer


def _record(tmp_path):
    return json.loads((tmp_path / "captures" / alerts.RUN_RECORD_NAME).read_text())


@pytest.mark.sets_capture_events
def test_capture_started_names_a_deploy_then_a_clean_restart_then_a_crash(tmp_path, monkeypatch):
    first = _main(tmp_path, monkeypatch, "aaa1111")
    assert first.endswith("It started because no record of a previous run."), first
    assert _record(tmp_path) == {"boot_id": "boot-1", "git": "aaa1111", "stopped": 0}

    assert _main(tmp_path, monkeypatch, "bbb2222").endswith("a deploy moved the code from aaa1111 to bbb2222.")
    assert _main(tmp_path, monkeypatch, "bbb2222").endswith("a clean stop and start on the same code (bbb2222).")

    # A run that never reached the end of its stop leaves no exit code.
    (tmp_path / "captures" / alerts.RUN_RECORD_NAME).write_text(json.dumps(alerts.run_record("boot-1", "bbb2222")))
    assert _main(tmp_path, monkeypatch, "bbb2222").endswith("did not stop cleanly (a crash or a kill).")
    assert _main(tmp_path, monkeypatch, "bbb2222", boot="boot-2").endswith("It started because the box booted.")


@pytest.mark.sets_capture_events
def test_a_watchdog_give_up_exit_code_is_named_on_the_next_start(tmp_path, monkeypatch):
    _main(tmp_path, monkeypatch, "aaa1111")
    capture._EXIT_CODE[0] = 1
    try:
        _main(tmp_path, monkeypatch, "aaa1111")
    finally:
        capture._EXIT_CODE[0] = 0
    assert _record(tmp_path)["stopped"] == 1
    assert _main(tmp_path, monkeypatch, "aaa1111").endswith("the previous run exited with code 1 to ask for a restart.")


def test_the_boot_id_reads_as_absent_when_it_cannot_be_read(tmp_path, monkeypatch):
    monkeypatch.setattr(capture, "_BOOT_ID_PATH", str(tmp_path / "absent"))
    assert capture._boot_id() is None
    (tmp_path / "empty").write_text("\n")
    monkeypatch.setattr(capture, "_BOOT_ID_PATH", str(tmp_path / "empty"))
    assert capture._boot_id() is None
    (tmp_path / "id").write_text("7f3a\n")
    monkeypatch.setattr(capture, "_BOOT_ID_PATH", str(tmp_path / "id"))
    assert capture._boot_id() == "7f3a"
