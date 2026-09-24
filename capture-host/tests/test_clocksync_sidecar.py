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
    capture._CLOCK_SYNC_COOLDOWN.clear()
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


# ------------------------------------------------- the PAUSE bound (2026-09-23) and its control
#
# These two drive the REAL `polar_offline_op` with only `op` faked, because the fact under test is the
# pause itself: `blestats.attempt("offline_op", …)` is incremented inside it, immediately after
# `_POLAR_PAUSED.add(address)`, and a stub for `sync_device_time` (what every other test here patches)
# never reaches that line. That is precisely why the whole existing suite passed while the ladder was
# paying 66 retry-pauses a night: nothing in it ever took the device.


def _takes_the_device(outcome):
    """A `sync_device_time` that goes through the real pause path and then does `outcome`."""

    async def sync(addr):
        async def op():
            if isinstance(outcome, BaseException):
                raise outcome
            return outcome

        return await capture.polar_offline_op(addr, op, timeout=5.0)

    return sync


@pytest.fixture
def _no_sleep(monkeypatch):
    real_sleep = asyncio.sleep
    monkeypatch.setattr(capture.asyncio, "sleep", lambda *_a, **_k: real_sleep(0))
    monkeypatch.setattr(capture, "_set", lambda name, **kw: None)


def test_a_transient_failure_that_took_the_device_pauses_ONCE_and_defers(tmp_path, monkeypatch, _no_sleep):
    """THE FIX (2026-09-23). A transient BLE error is raised in two structurally different places and the
    ladder could not tell them apart: BEFORE the device is taken it costs nothing, AFTER it costs a
    live-capture pause — and retrying then buys another one at the same price.

    Measured on vigil, 2026-09-18/19, 18 h, counting the `retry N/12` lines by index: 146 attempts took
    the device, of which **80 were a first attempt and 66 were retries**, 113 abandoned at the op ceiling.
    Those 66 are pure lost signal: the pause is up to `_CLOCK_SYNC_TIMEOUT_S` of the device not streaming.

    ONE pause is not removable and this test does not ask for zero — pausing IS how the op takes the
    device's single BLE link. What it pins is that the SECOND one never happens."""
    import blestats

    before = blestats.attempts("offline_op", "CC:DD")
    monkeypatch.setattr(capture, "device_absent_error", lambda e: False)
    monkeypatch.setattr(capture, "transient_ble_error", lambda e: True)
    monkeypatch.setattr(capture, "sync_device_time",
                        _takes_the_device(RuntimeError("org.bluez.Error.InProgress")))

    assert _run(capture.auto_sync_clock("H10", "CC:DD", str(tmp_path))) is False

    assert blestats.attempts("offline_op", "CC:DD") - before == 1, (
        "the ladder must pause live capture at most ONCE; before the fix this was 12")
    (row,) = _rows(str(tmp_path))
    assert ";H10;CC:DD;deferred-after-pause;;attempt 1 (RuntimeError)" in row
    assert not capture._POLAR_PAUSED, "live capture must be resumed however the attempt ended"


def test_the_deferral_does_not_disable_a_sync_the_device_CAN_take(tmp_path, monkeypatch, _no_sleep):
    """THE CONTROL, and the reason the test above is not simply "never sync". The same code path, the
    same real pause, the only difference being that the op succeeds — and the clock must still be
    written, on the first attempt, with no cooldown left behind.

    A fix that bounded the pauses by not syncing would pass the test above and re-break what the ladder
    exists for: 2026-07-18, both Polars on different timebases for an evening."""
    import blestats

    before = blestats.attempts("offline_op", "AA:BB")
    monkeypatch.setattr(capture, "sync_device_time", _takes_the_device({"ok": True}))

    assert _run(capture.auto_sync_clock("Verity", "AA:BB", str(tmp_path))) is True

    assert blestats.attempts("offline_op", "AA:BB") - before == 1, "one pause, and it bought a sync"
    (row,) = _rows(str(tmp_path))
    assert ";Verity;AA:BB;synced;;attempt 1" in row
    # Deliberately asserts NOTHING about the cooldown table: a control has to run unchanged against the
    # code it is controlling for, and a reference to machinery only the fix introduces makes it fail on
    # the baseline for a reason that is not behavioural. "A success clears the backoff" is pinned in
    # `test_a_success_clears_an_existing_backoff` instead.


def test_a_pause_paying_failure_cools_the_device_down(tmp_path, monkeypatch, _no_sleep):
    """The CROSS-ladder half. The per-ladder budget bounds one ladder; `clock_sync_due` re-arms it on
    every reconnect (~70-110 s), which is how 80 separate ladders each paid a pause in one night while
    the budget was working correctly throughout."""
    monkeypatch.setattr(capture, "device_absent_error", lambda e: False)
    monkeypatch.setattr(capture, "transient_ble_error", lambda e: True)
    monkeypatch.setattr(capture, "sync_device_time", _takes_the_device(RuntimeError("InProgress")))

    assert _run(capture.auto_sync_clock("H10", "CC:DD", str(tmp_path))) is False

    fails, until = capture._CLOCK_SYNC_COOLDOWN["CC:DD"]
    assert fails == 1
    assert capture._clock_sync_cooling("CC:DD", until - 1.0) is True
    assert capture._clock_sync_cooling("CC:DD", until + 1.0) is False, "the backoff must EXPIRE"
    assert capture.clock_sync_due(True, True, False, False,
                                  capture._clock_sync_cooling("CC:DD", until - 1.0)) is False


def test_a_success_clears_an_existing_backoff(tmp_path, monkeypatch, _no_sleep):
    """A success CLEARS the count rather than decaying it: the device demonstrably takes a clock write
    now, so its history is not evidence about its present. Without this a device that failed five times
    and then recovered would keep serving a 32-minute backoff it had already earned its way out of."""
    capture._CLOCK_SYNC_COOLDOWN["AA:BB"] = (5, 1e18)
    monkeypatch.setattr(capture, "sync_device_time", _takes_the_device({"ok": True}))

    assert _run(capture.auto_sync_clock("Verity", "AA:BB", str(tmp_path))) is True
    assert "AA:BB" not in capture._CLOCK_SYNC_COOLDOWN


def test_an_absent_device_is_NOT_cooled_down(tmp_path, monkeypatch, _no_sleep):
    """395 of the 553 attempts on the measured night were `deferred-absent`: a 6 s scan outside every
    lock, no pause, and the device genuinely not on the air. Backing off on those would delay the sync
    for a device that is about to come back — and coming back IS the reconnect that re-arms the ladder,
    so cooling on absence would fight the mechanism that makes absence cheap."""

    async def gone(addr):
        raise RuntimeError("device not found")

    monkeypatch.setattr(capture, "sync_device_time", gone)
    monkeypatch.setattr(capture, "device_absent_error", lambda e: True)

    assert _run(capture.auto_sync_clock("H10", "CC:DD", str(tmp_path))) is False
    assert "CC:DD" not in capture._CLOCK_SYNC_COOLDOWN, "absence is cheap; it must not cost a backoff"


# ---------------------------------------------------------------- the watchdog emitters

def _drive(monkeypatch, root, skew, cycles, sync=None):
    """Run the watchdog `cycles` polls against one connected Polar with a constant skew."""
    monkeypatch.setattr(capture, "_set", lambda name, **kw: None)

    async def _ok(addr):
        return None
    monkeypatch.setattr(capture, "sync_device_time", sync or _ok)
    dev = [{"name": "H10", "address": "AA:BB:CC:DD:EE:FF", "vendor": "Polar"}]
    # `clock_skew_floor_sec` is the key `clock_watchdog` decides on — the envelope over a window
    # rather than one frame's reading, which carries that frame's delivery latency. Seeded to the
    # same value so these tests drive the watchdog with exactly the skew they always did.
    capture.STATUS["devices"] = {"H10": {"clock_skew_sec": skew, "clock_skew_floor_sec": skew,
                                         "connected": True}}
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
