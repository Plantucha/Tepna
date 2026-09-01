# tepna-capture — tests/test_clocksync_sidecar.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# CLOCKSYNC.csv — the per-night device clock-sync EVIDENCE CHANNEL (H10-2019-ORIGIN, 2026-09-01).
#
# `auto_sync_clock` and `clock_watchdog` have always reported their outcomes — into live STATUS (a
# snapshot the next write erases) and journald (which rotates). Nothing wrote them into the night's own
# files, so "was THIS night's device clock actually synced?" was unanswerable after the fact — which is
# how 84 H10 nights recorded on the strap's 2019-01-01 firmware default went unnoticed for two months.
# The transferable law being pinned here: a live status field is not an evidence channel; any question
# that will be asked about a night post-hoc must be persisted WITH the night.
#
# Two layers, tested separately and then wired:
#   · `writers.append_clock_sync_event` — the writer itself (header discipline, honest blanks,
#     sanitisation, and the never-raise contract).
#   · the EMITTERS — every terminal outcome in `auto_sync_clock` and every watchdog verdict lands a
#     row. These are behavioural, not source-scans: a source-scan cannot see a wrong argument.

import asyncio
import glob
import os

import pytest

import capture
import writers


@pytest.fixture(autouse=True)
def _clean_stop():
    """Same reset `test_clock_resync_on_reconnect` uses, and for the same reason: the runners mutate
    process-wide state, and a module-level asyncio.Event binds to the first loop that awaits it."""
    capture._STOP = asyncio.Event()
    capture._RECOVER = asyncio.Event()
    capture._OXYII_PAUSE = asyncio.Event()
    capture._CONNECT_LOCK = asyncio.Lock()
    capture._POLAR_PAUSED.clear()
    capture._CLOCK_FRESHLY_SYNCED.clear()
    capture._CFG.clear()
    capture.STATUS.clear()
    capture.STATUS["devices"] = {}
    yield
    capture._STOP.set()
    capture._STOP.clear()
    capture._CLOCK_FRESHLY_SYNCED.clear()


def _run(coro):
    return asyncio.run(coro)


def _rows(root):
    """Every CLOCKSYNC row across the tree, header excluded — one file per night dir, fixed name."""
    out = []
    for p in sorted(glob.glob(os.path.join(root, "captures", "*", writers.CLOCKSYNC_NAME))):
        with open(p, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
        assert lines[0] == "Phone timestamp;device;address;event;skew_sec;detail", p
        assert "Phone timestamp" not in "\n".join(lines[1:]), "one header per file, however many appends"
        out.extend(lines[1:])
    return out


# ---------------------------------------------------------------- the writer

def test_first_append_writes_header_then_row(tmp_path):
    import datetime as dt
    when = dt.datetime(2026, 9, 1, 23, 45, 6, 789000)
    assert writers.append_clock_sync_event(str(tmp_path), when, "H10", "AA:BB", "synced",
                                           detail="attempt 1") is True
    rows = _rows(str(tmp_path))
    assert rows == ["2026-09-01T23:45:06.789;H10;AA:BB;synced;;attempt 1"]
    # keyed by the EVENT's wall date — the LINK/CLOCK sidecar convention
    assert os.path.exists(os.path.join(tmp_path, "captures", "2026-09-01", writers.CLOCKSYNC_NAME))


def test_appends_accumulate_under_one_header(tmp_path):
    import datetime as dt
    when = dt.datetime(2026, 9, 1, 1, 0, 0)
    writers.append_clock_sync_event(str(tmp_path), when, "H10", "AA:BB", "synced")
    writers.append_clock_sync_event(str(tmp_path), when, "Verity", "CC:DD", "uncorrectable", skew_s=-5.0)
    rows = _rows(str(tmp_path))
    assert len(rows) == 2
    assert rows[1] == "2026-09-01T01:00:00.000;Verity;CC:DD;uncorrectable;-5.000;"


def test_a_cross_midnight_pair_lands_in_two_night_dirs(tmp_path):
    """The convention, pinned: rows key on the EVENT's date. nightqc already reads a cross-midnight
    neighbour pair as one session, so this is legibility, not fragmentation."""
    import datetime as dt
    writers.append_clock_sync_event(str(tmp_path), dt.datetime(2026, 9, 1, 23, 59, 0), "H10", "A", "synced")
    writers.append_clock_sync_event(str(tmp_path), dt.datetime(2026, 9, 2, 0, 1, 0), "H10", "A", "resynced",
                                    skew_s=31.2, detail="jump")
    days = sorted(os.path.basename(os.path.dirname(p))
                  for p in glob.glob(os.path.join(tmp_path, "captures", "*", writers.CLOCKSYNC_NAME)))
    assert days == ["2026-09-01", "2026-09-02"]


def test_blanks_are_honest_and_fields_are_sanitised(tmp_path):
    """Blank, never a fabricated 0, for an absent skew; `;`/newlines cannot corrupt the row shape."""
    import datetime as dt
    when = dt.datetime(2026, 9, 1, 2, 0, 0)
    writers.append_clock_sync_event(str(tmp_path), when, None, None, "sync-failed",
                                    detail="BleakError('busy; try later')\nline2")
    (row,) = _rows(str(tmp_path))
    assert row == "2026-09-01T02:00:00.000;;;sync-failed;;BleakError('busy, try later') line2"


def test_no_root_means_no_row_and_no_error():
    """The emitters call unconditionally; a caller with no capture root (every existing test, any
    headless use) must cost nothing and raise nothing."""
    assert writers.append_clock_sync_event(None, None, "H10", "A", "synced") is False
    assert writers.append_clock_sync_event("", None, "H10", "A", "synced") is False


def test_an_unwritable_root_returns_false_never_raises(tmp_path):
    """Evidence must never take capture down — the PMD frame dump's rule, kept here."""
    blocker = tmp_path / "captures"
    blocker.write_text("a file where the captures dir must go")
    import datetime as dt
    assert writers.append_clock_sync_event(str(tmp_path), dt.datetime(2026, 9, 1), "H10", "A",
                                           "synced") is False


# ---------------------------------------------------------------- the auto-sync emitters

def test_a_successful_sync_lands_a_synced_row(tmp_path, monkeypatch):
    monkeypatch.setattr(capture, "sync_device_time", lambda addr: asyncio.sleep(0))
    monkeypatch.setattr(capture, "_set", lambda name, **kw: None)
    assert _run(capture.auto_sync_clock("Verity", "AA:BB", str(tmp_path))) is True
    (row,) = _rows(str(tmp_path))
    _, dev, addr, event, skew, detail = row.split(";")
    assert (dev, addr, event, skew, detail) == ("Verity", "AA:BB", "synced", "", "attempt 1")


def test_a_hard_failure_lands_a_sync_failed_row(tmp_path, monkeypatch):
    async def boom(addr):
        raise RuntimeError("no such characteristic")
    monkeypatch.setattr(capture, "sync_device_time", boom)
    monkeypatch.setattr(capture, "_set", lambda name, **kw: None)
    assert _run(capture.auto_sync_clock("H10", "CC:DD", str(tmp_path))) is False
    (row,) = _rows(str(tmp_path))
    assert ";H10;CC:DD;sync-failed;;" in row and "no such characteristic" in row


def test_an_absent_device_lands_a_deferred_row_not_a_failure(tmp_path, monkeypatch):
    """Deferral is a different claim from failure: the reconnect loop re-triggers it, so the night can
    still end synced — the row must say which happened."""
    async def gone(addr):
        raise RuntimeError("device not found")
    monkeypatch.setattr(capture, "sync_device_time", gone)
    monkeypatch.setattr(capture, "device_absent_error", lambda e: True)
    monkeypatch.setattr(capture, "_set", lambda name, **kw: None)
    assert _run(capture.auto_sync_clock("H10", "CC:DD", str(tmp_path))) is False
    (row,) = _rows(str(tmp_path))
    assert ";H10;CC:DD;deferred-absent;;attempt 1" in row


def test_a_burned_budget_lands_a_gave_up_budget_row(tmp_path, monkeypatch):
    async def busy(addr):
        raise RuntimeError("br-connection-busy")
    monkeypatch.setattr(capture, "sync_device_time", busy)
    monkeypatch.setattr(capture, "device_absent_error", lambda e: False)
    monkeypatch.setattr(capture, "transient_ble_error", lambda e: True)
    monkeypatch.setattr(capture, "_CLOCK_SYNC_LADDER_BUDGET_S", -1.0)   # already over budget
    monkeypatch.setattr(capture, "_set", lambda name, **kw: None)
    assert _run(capture.auto_sync_clock("H10", "CC:DD", str(tmp_path))) is False
    (row,) = _rows(str(tmp_path))
    assert ";H10;CC:DD;gave-up-budget;;" in row


def test_an_exhausted_ladder_lands_a_gave_up_busy_row(tmp_path, monkeypatch):
    real_sleep = asyncio.sleep
    async def busy(addr):
        raise capture.offline_lock.OfflineBusy()
    monkeypatch.setattr(capture, "sync_device_time", busy)
    monkeypatch.setattr(capture.asyncio, "sleep", lambda *_a, **_k: real_sleep(0))
    monkeypatch.setattr(capture, "_set", lambda name, **kw: None)
    assert _run(capture.auto_sync_clock("H10", "CC:DD", str(tmp_path))) is False
    (row,) = _rows(str(tmp_path))
    assert ";H10;CC:DD;gave-up-busy;;12 attempts" in row


# ---------------------------------------------------------------- the watchdog emitters

def _drive(monkeypatch, root, skew, cycles, sync=None):
    """Run the watchdog `cycles` polls against one connected Polar with a constant skew."""
    monkeypatch.setattr(capture, "_set", lambda name, **kw: None)

    async def _ok(addr):
        return None
    monkeypatch.setattr(capture, "sync_device_time", sync or _ok)
    dev = [{"name": "H10", "address": "AA:BB:CC:DD:EE:FF", "vendor": "Polar"}]
    capture.STATUS["devices"] = {"H10": {"clock_skew_sec": skew, "connected": True}}
    capture._CLOCK_FRESHLY_SYNCED.clear()
    n = {"i": 0}

    async def fake_sleep(_s):
        n["i"] += 1
        if n["i"] >= cycles:
            capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    capture._STOP.clear()
    try:
        asyncio.run(capture.clock_watchdog({"devices": dev, "time": {"drift_check_sec": 0}},
                                           str(root)))
    finally:
        capture._STOP.set()


def test_a_watchdog_resync_lands_a_resynced_row_with_the_skew(tmp_path, monkeypatch):
    _drive(monkeypatch, tmp_path, skew=99.0, cycles=2)
    rows = [r for r in _rows(str(tmp_path)) if ";resynced;" in r]
    assert rows, "an adrift correction must land in the night's own sidecar"
    assert ";H10;AA:BB:CC:DD:EE:FF;resynced;99.000;adrift" in rows[0]


def test_the_uncorrectable_verdict_lands_once(tmp_path, monkeypatch):
    """The skew never moves, so the adrift budget burns down and the give-up is declared — ONCE, like
    the log line and the STATUS flag it rides beside."""
    _drive(monkeypatch, tmp_path, skew=99.0, cycles=capture.CLOCK_ADRIFT_GIVEUP + 3)
    rows = _rows(str(tmp_path))
    unc = [r for r in rows if ";uncorrectable;" in r]
    assert len(unc) == 1, rows
    assert ";H10;AA:BB:CC:DD:EE:FF;uncorrectable;99.000;" in unc[0]


def test_a_hard_resync_failure_lands_a_resync_failed_row(tmp_path, monkeypatch):
    async def boom(addr):
        raise RuntimeError("write rejected")
    monkeypatch.setattr(capture, "transient_ble_error", lambda e: False)
    _drive(monkeypatch, tmp_path, skew=99.0, cycles=2, sync=boom)
    rows = [r for r in _rows(str(tmp_path)) if ";resync-failed;" in r]
    assert rows and "write rejected" in rows[0]
