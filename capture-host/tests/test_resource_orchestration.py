# tepna-capture — tests/test_resource_orchestration.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""CAPTURE-HOST-RESOURCE-ORCHESTRATION-AUDIT (2026-09-05) — the failure-injection half of the change set.

Every test here PLANTS the failure the audit found and reads the evidence the fix is supposed to leave:
a row `write()` that raises inside a notification callback (§S1), an fsync that stalls the loop (§S2),
a cancel landing inside `_restart_radio`'s recovery window (§L1), a supervised task that crashes (§O2),
a retry that publishes nothing about itself (§O1), a tree walk on the event loop (§L3). None of them
asserts that an attribute exists — each drives the real code path and checks the number/log/state
that the 3am operator (or the next-morning analysis) would have to read.
"""
import asyncio
import datetime as _dt
import errno
import os
import re
import threading
import time

import pytest

import capture
import writers
from _srcscan import module_source

_WHEN = _dt.datetime(2026, 9, 5, 2, 0, 0)


# ══════════════════════════════════════════════════════════════════════════════════════════════
# §S1 — a row write that raises inside a callback is COUNTED, not a traceback per notification
# ══════════════════════════════════════════════════════════════════════════════════════════════

class _WriteFailingFH:
    """A handle whose `write` raises the way ENOSPC does — the buffered write itself, before any flush."""

    def __init__(self, exc):
        self.exc, self.failing, self.closed, self.written = exc, True, False, []

    def write(self, text):
        if self.failing:
            raise self.exc
        self.written.append(text)

    def flush(self):
        pass

    def fileno(self):
        return 0

    def close(self):
        self.closed = True


def _row_call(w):
    """One real row write per class, with the class's own signature."""
    cls = type(w).__name__
    if cls == "StreamWriter":
        return lambda: w.write_hr(_WHEN, 0, 61, [980, 1002])
    if cls == "OxyFrameLogWriter":
        return lambda: w.write(_WHEN, {"duration": 10, "pi": 3.1})
    if cls == "HostClockLogWriter":
        return lambda: w.write(_WHEN, {"trust": "ok"})
    if cls == "RingClockLogWriter":
        return lambda: w.write(_WHEN, "rtc")
    if cls == "LinkLogWriter":
        return lambda: w.write(_WHEN, "H10", True, -60, 80)
    if cls == "OxyLifeLogWriter":
        class _T:
            def as_row(self):
                return "a;b;c"
        return lambda: w.write(_T())
    if cls == "PmdArrivalLogWriter":
        return lambda: w.write(_WHEN, "H10", 0, 1, 2, 3)
    assert cls == "Spo2CsvWriter", cls
    return lambda: w.write(_WHEN, 97, 62, 0)


_CLASSES = [c for c in dir(writers) if c.endswith("Writer")]


def _make(cls, tmp_path):
    return getattr(writers, cls)(str(tmp_path / f"{cls}.csv"), *(["hr"] if cls == "StreamWriter" else []),
                                 fsync=False)


@pytest.mark.parametrize("cls", _CLASSES)
def test_A_ROW_THE_DISK_REFUSES_IS_COUNTED_AS_LOST_AND_NEVER_RAISES_INTO_THE_CALLBACK(cls, tmp_path, caplog):
    """Every row write runs inside a bleak notification callback, on the loop, NOT on the runner's stack:
    an exception there is asyncio's default handler printing a traceback per notification (130 Hz on
    the ECG) while the runner keeps believing it records, `flush_failures` stays 0 (the write raised
    before any flush), and the night's tail is gone with no counter saying so."""
    w = _make(cls, tmp_path)
    w._fh = _WriteFailingFH(OSError(errno.ENOSPC, os.strerror(errno.ENOSPC)))
    if getattr(w, "_rr_fh", None) is not None:
        w._rr_fh = _WriteFailingFH(OSError(errno.ENOSPC, os.strerror(errno.ENOSPC)))
    write = _row_call(w)
    before = w.rows
    with caplog.at_level("WARNING"):
        for _ in range(50):
            write()                                     # must NOT raise — the callback has no catcher
    assert w.rows == before, "a row that never landed must not be counted as recorded"
    assert w.rows_lost >= 50, (cls, w.rows_lost)
    assert w.flush_failures == 0, "the write raised BEFORE any flush — that counter cannot see it"
    assert caplog.text.count("ROW LOST") == 1, "the onset, once; not one line per notification"
    assert "ENOSPC" in caplog.text
    # RECOVERY names the damage — the count is the whole point of the counter
    w._fh.failing = False
    if getattr(w, "_rr_fh", None) is not None:
        w._rr_fh.failing = False
    with caplog.at_level("INFO"):
        w.flush()
    assert re.search(r"writing again, after 0 failed flush\(es\) and \d+ lost row\(s\)", caplog.text), caplog.text
    lost_then = w.rows_lost
    write()
    assert w.rows == before + 1 and w.rows_lost == lost_then, "after recovery, rows land and are counted"


def test_A_LATE_ROW_ON_A_CLOSED_HANDLE_IS_A_LOST_ROW_NOT_A_CRASH(tmp_path, caplog):
    """THE STALE-COMPLETION CASE without a generation counter: a notification delivered after the runner
    closed its writer raises `ValueError: I/O operation on closed file` — inside the callback. It is
    counted as lost; the evidence the audit's §23 "generations" item wanted, for one line of code."""
    w = writers.StreamWriter(str(tmp_path / "late.txt"), "ecg", fsync=False)
    w.write_ecg(_WHEN, 0, 0.0, 1)
    w.close()
    with caplog.at_level("WARNING"):
        w.write_ecg(_WHEN, 1, 7.7, 2)                   # the late one
    assert w.rows == 1 and w.rows_lost == 1
    assert "ROW LOST" in caplog.text and "ValueError" in caplog.text


def test_THE_RR_SIDECAR_LOSS_IS_COUNTED_TOO(tmp_path):
    """`write_hr` fans out to a second handle; a loss there is invisible to `rows` (which counts HR rows)
    and must still reach `rows_lost`."""
    w = writers.StreamWriter(str(tmp_path / "hr.txt"), "hr", fsync=False)
    w._rr_fh = _WriteFailingFH(OSError(errno.EIO, "eio"))
    w.write_hr(_WHEN, 0, 60, [1000, 1000, 1000])
    assert w.rows == 1, "the HR row landed"
    assert w.rows_lost == 3, "the three RR rows did not"


# ══════════════════════════════════════════════════════════════════════════════════════════════
# §S2 — fsync on the event loop is MEASURED, and a slow one names itself once
# ══════════════════════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("cls", _CLASSES)
def test_A_SLOW_FSYNC_IS_A_NUMBER_IN_THE_WRITER_AND_ONE_WARNING(cls, tmp_path, monkeypatch, caplog):
    # drive the class's flush with fsync ON, against a planted 300 ms os.fsync
    w = getattr(writers, cls)(str(tmp_path / f"{cls}-f.csv"), *(["hr"] if cls == "StreamWriter" else []),
                              fsync=True)
    # the threshold is lowered so eight classes × two flushes do not cost 5 s of wall clock; the real
    # 250 ms figure is pinned once, below, on the writer the ECG rides
    monkeypatch.setattr(writers._FlushHealth, "SLOW_FSYNC_MS", 20.0)
    monkeypatch.setattr(writers.os, "fsync", lambda fd: time.sleep(0.03))
    with caplog.at_level("WARNING"):
        w.flush()
        w.flush()
    assert w.fsync_max_ms >= 20, (cls, w.fsync_max_ms)
    assert caplog.text.count("SLOW fsync") == 1, "once per file — the max lives in STATUS"
    w.close()


def test_THE_SLOW_FSYNC_THRESHOLD_IS_250_MS(tmp_path, monkeypatch, caplog):
    """250 ms is ~32 ECG samples at 130 Hz queued behind one syscall — the point at which the host
    stamps of every other stream are visibly late. Below it: measured, silent. At it: named once."""
    assert writers._FlushHealth.SLOW_FSYNC_MS == 250.0
    w = writers.StreamWriter(str(tmp_path / "t.txt"), "ecg", fsync=True)
    monkeypatch.setattr(writers.os, "fsync", lambda fd: time.sleep(0.26))
    with caplog.at_level("WARNING"):
        w.flush()
    assert w.fsync_max_ms >= 250 and "SLOW fsync" in caplog.text
    w.close()


def test_A_FAST_FSYNC_SAYS_NOTHING_BUT_STILL_MEASURES(tmp_path, monkeypatch, caplog):
    w = writers.StreamWriter(str(tmp_path / "q.txt"), "ecg", fsync=True)
    monkeypatch.setattr(writers.os, "fsync", lambda fd: None)
    with caplog.at_level("WARNING"):
        w.flush()
    assert "SLOW fsync" not in caplog.text
    assert 0.0 <= w.fsync_max_ms < 250
    assert w._health.fsync_last_ms == pytest.approx(w.fsync_max_ms)
    w.close()


def test_THE_RUNNERS_PUBLISH_THE_TWO_NEW_COUNTERS_BESIDE_FLUSH_FAILURES():
    """The counters are only evidence if they reach status.json — and both row-count publish sites (the
    Polar PMD handler and the Viatom packet handler) must carry them, not just the one I tested."""
    src = module_source("capture.py")
    assert src.count('"rows_lost": wr.rows_lost') + src.count("rows_lost=wr.rows_lost") == 2, \
        "rows_lost must ride beside flush_failures at BOTH publish sites"
    assert src.count('"fsync_max_ms": wr.fsync_max_ms') + src.count("fsync_max_ms=wr.fsync_max_ms") == 2


# ══════════════════════════════════════════════════════════════════════════════════════════════
# §O1 — a retry is a published state, and the backoff is jittered (only the backoff)
# ══════════════════════════════════════════════════════════════════════════════════════════════

@pytest.fixture
def _fresh(monkeypatch):
    capture._STOP = asyncio.Event()
    capture._RECOVER = asyncio.Event()
    capture.STATUS["devices"] = {}
    capture.STATUS.pop("tasks", None)
    capture.STATUS.pop("loop", None)
    yield


def test_RETRY_SLEEP_PUBLISHES_ATTEMPT_AND_NEXT_AT_THEN_CLEARS(_fresh, monkeypatch):
    """Until now a runner parked in its backoff sleep published NOTHING: `connected` stayed at whatever it
    last read and there was no way to tell "retrying in 3 min" from "wedged". AirCANnect publishes
    attempt + next-retry per link; this is the same, without the state machine."""
    seen = {}
    real = asyncio.sleep

    async def rec(s):
        seen["during"] = dict(capture.STATUS["devices"]["H10"]["retry"])
        seen["slept"] = s
        await real(0)
    monkeypatch.setattr(capture.asyncio, "sleep", rec)
    t0 = time.time()
    waited = asyncio.run(capture._retry_sleep("H10", 40.0, "backoff", 3))
    d = seen["during"]
    assert d["attempt"] == 3 and d["why"] == "backoff"
    assert 36.0 <= d["wait_s"] <= 44.0 and 36.0 <= waited <= 44.0, "±10 % jitter on the backoff"
    assert seen["slept"] == pytest.approx(waited)
    assert abs(d["next_at_ms"] - (t0 * 1000 + waited * 1000)) < 2000
    assert capture.STATUS["devices"]["H10"]["retry"] is None, "cleared on the way out"


@pytest.mark.parametrize("why", ["charging", "stalled", "not_worn"])
def test_ONLY_THE_ERROR_BACKOFF_IS_JITTERED(_fresh, monkeypatch, why):
    """Charging / stall / not-worn waits are DELIBERATE intervals with their own semantics (the charge
    poll ticks, the stall reconnect is a measured link-loss window) — jittering them would move the
    numbers other tests pin. The jitter exists to de-synchronise the three runners' error retries."""
    real = asyncio.sleep
    monkeypatch.setattr(capture.asyncio, "sleep", lambda s: real(0))
    for _ in range(20):
        assert asyncio.run(capture._retry_sleep("X", 30.0, why, 1)) == 30.0


def test_THE_JITTER_IS_REALLY_RANDOM_NOT_A_FIXED_OFFSET(_fresh, monkeypatch):
    real = asyncio.sleep
    monkeypatch.setattr(capture.asyncio, "sleep", lambda s: real(0))
    waits = {asyncio.run(capture._retry_sleep("X", 100.0, "backoff", 1)) for _ in range(30)}
    assert len(waits) > 5 and all(90.0 <= w <= 110.0 for w in waits), waits


def test_RETRY_IS_CLEARED_EVEN_WHEN_THE_SLEEP_IS_CANCELLED(_fresh):
    """A runner replaced mid-backoff (`register_runner` hot-swap) must not leave a `retry` block on the
    card that the new runner never clears."""
    async def go():
        t = asyncio.ensure_future(capture._retry_sleep("H10", 60.0, "backoff", 2))
        await asyncio.sleep(0)
        assert capture.STATUS["devices"]["H10"]["retry"]["attempt"] == 2
        t.cancel()
        with pytest.raises(asyncio.CancelledError):
            await t
    asyncio.run(go())
    assert capture.STATUS["devices"]["H10"]["retry"] is None


def test_EVERY_ERROR_BACKOFF_SITE_IN_THE_THREE_RUNNERS_COUNTS_ATTEMPTS():
    """Three runners, one schedule: each `backoff = 5` reset also resets `attempt`, and each error sleep
    goes through `_retry_sleep(..., "backoff", attempt)`. A runner that kept a bare `asyncio.sleep(backoff)`
    would be the one whose card never shows a retry."""
    src = module_source("capture.py")
    assert src.count("backoff: float = 5\n") == 3 or src.count("backoff: float = 5") == 3
    assert src.count('await _retry_sleep(name, backoff, "backoff", attempt)') == 3
    assert src.count("backoff = 5; attempt = 0") == 3, "the data-flow resets clear the attempt count too"
    assert "asyncio.sleep(backoff)" not in src, "a bare backoff sleep publishes nothing"


# ══════════════════════════════════════════════════════════════════════════════════════════════
# §L1 — the global recovery gate is released on the way OUT, not only on the way through
# ══════════════════════════════════════════════════════════════════════════════════════════════

def test_A_CANCEL_INSIDE_THE_RESTART_WINDOW_DOES_NOT_LEAVE_RECOVER_SET_FOREVER(_fresh, monkeypatch):
    """`_RECOVER` is set by `_restart_radio` and cleared by nothing else. A cancel landing in its 5 s
    settle (the watchdog's own supervisor, shutdown, a hot-swap) used to leave every runner parked at
    `_RECOVER.is_set()` for the life of the process — the audit's one genuine WEDGE-EVERYTHING path."""
    async def fake(*args, timeout=45):
        return 0, "bluetooth: active"
    monkeypatch.setattr(capture.helper_path, "resolve", lambda n: "/bin/sh")
    monkeypatch.setattr(capture, "_run_helper", fake)

    async def go():
        t = asyncio.ensure_future(capture._restart_radio())
        for _ in range(20):
            await asyncio.sleep(0)
            if capture._RECOVER.is_set():
                break
        assert capture._RECOVER.is_set(), "the gate closes during the settle"
        t.cancel()
        with pytest.raises(asyncio.CancelledError):
            await t
    asyncio.run(go())
    assert not capture._RECOVER.is_set(), "…and must be open again after a cancel"


def test_EVERY_RECOVER_SET_SITE_HAS_A_FINALLY():
    """Three sites set the gate; all three must release in a `finally`. Counted as a set, not a floor,
    so a fourth site added without one reds this."""
    src = module_source("capture.py")
    sites = [m.start() for m in re.finditer(r"_RECOVER\.set\(\)", src)]
    assert len(sites) == 3, len(sites)
    for at in sites:
        window = src[at:at + 2500]
        assert "finally:" in window, src[at - 200:at + 300]
        after = window.split("finally:", 1)[1]
        assert "_RECOVER.clear()" in after[:1500], src[at:at + 400]


# ══════════════════════════════════════════════════════════════════════════════════════════════
# §O2 — a supervised task's crash is a FIELD, and the four bare create_task starters are supervised
# ══════════════════════════════════════════════════════════════════════════════════════════════

def test_A_SUPERVISED_CRASH_LANDS_IN_STATUS_TASKS(_fresh, monkeypatch):
    real = asyncio.sleep
    n = {"k": 0}

    async def boom():
        n["k"] += 1
        if n["k"] >= 3:
            capture._STOP.set()
            return
        raise RuntimeError(f"planted crash {n['k']}")

    monkeypatch.setattr(capture.asyncio, "sleep", lambda s: real(0))
    asyncio.run(capture.keep_running(boom, "planted poller"))
    rec = capture.STATUS["tasks"]["planted poller"]
    assert rec["crashes"] == 2
    assert "planted crash 2" in rec["last_error"]
    assert abs(rec["restart_at_ms"] - time.time() * 1000) < 60_000


def test_THE_FOUR_FORMERLY_BARE_STARTERS_ARE_SUPERVISED():
    """Measured 2026-09-05: four long-lived loops were started with a bare `create_task` — the AS11 shadow
    detector, CPAP auto-start, the CPAP stored-spool pull and the O2Ring presence scan. An exception in
    any of them retired the task silently (the exact failure `keep_running`'s docstring describes) and
    the box carried on believing it was, e.g., watching for AS11 sessions. Each must now go through
    `keep_running` with a label, which is what makes its crash a STATUS field."""
    src = module_source("capture.py")
    for label in ("AS11 shadow detector", "CPAP auto-start", "CPAP stored-spool pull", "O2Ring presence scan"):
        assert re.search(r"keep_running\(lambda: [\s\S]{0,900}?\"" + re.escape(label) + r"\"\)\)", src), label


# ══════════════════════════════════════════════════════════════════════════════════════════════
# §O1 — the coordination gates are ONE queryable snapshot
# ══════════════════════════════════════════════════════════════════════════════════════════════

def test_GATE_STATE_REPORTS_EVERY_GATE_A_RUNNER_CAN_BLOCK_ON(_fresh, monkeypatch):
    async def go():
        capture._OXYII_PAUSE = asyncio.Event()
        capture._CONNECT_LOCK = asyncio.Lock()
        base = capture.gate_state()
        assert base == {"recover": False, "oxyii_pause": False, "polar_paused": [],
                        "connect_lock": False, "offline_slot": None, "stop": False}
        capture._RECOVER.set()
        capture._OXYII_PAUSE.set()
        capture._POLAR_PAUSED.add("H10")
        monkeypatch.setattr(capture.offline_lock, "busy_with", lambda: "RingA")
        async with capture._CONNECT_LOCK:
            g = capture.gate_state()
        assert g == {"recover": True, "oxyii_pause": True, "polar_paused": ["H10"],
                     "connect_lock": True, "offline_slot": "RingA", "stop": False}
        capture._POLAR_PAUSED.discard("H10")
    asyncio.run(go())


def test_STATUS_LOOP_WRITES_THE_GATES(_fresh, tmp_path, monkeypatch):
    real = asyncio.sleep

    async def stop_sleep(s):
        capture._STOP.set()
        await real(0)
    monkeypatch.setattr(capture.asyncio, "sleep", stop_sleep)
    monkeypatch.setattr(capture, "gate_state", lambda: {"recover": True, "planted": 1})
    asyncio.run(capture.status_loop(str(tmp_path), 120))
    import json
    with open(capture.status_path(str(tmp_path), capture.INSTANCE)) as f:
        assert json.load(f)["gates"] == {"recover": True, "planted": 1}


# ══════════════════════════════════════════════════════════════════════════════════════════════
# §L2 — event-loop latency is measured; a blocking call anywhere is a number, and a big one logs once
# ══════════════════════════════════════════════════════════════════════════════════════════════

def test_LOOP_MONITOR_SEES_A_PLANTED_BLOCKING_CALL(_fresh, caplog):
    """A `time.sleep(0.15)` on the loop — the shape of a slow fsync or a tree walk — must register as a
    stall of ≥ 100 ms; a ≥ 1 s one logs ONCE within the rate-limit window."""
    capture.STATUS.pop("loop", None)

    async def go():
        mon = asyncio.ensure_future(capture.loop_monitor(period_s=0.01))
        await asyncio.sleep(0.03)
        time.sleep(0.15)                                   # the plant
        await asyncio.sleep(0.03)
        capture._STOP.set()
        await mon
    asyncio.run(go())
    rec = capture.STATUS["loop"]
    assert rec["ticks"] >= 2
    assert rec["lag_max_ms"] >= 100, rec
    assert rec["stalls"] >= 1, rec
    assert rec["lag_last_ms"] < 100, "the last tick after the plant was clean"
    assert "event loop stalled" not in caplog.text, "150 ms is counted, not logged"


def test_LOOP_MONITOR_LOGS_A_SECOND_LONG_STALL_ONCE_PER_WINDOW(_fresh, monkeypatch, caplog):
    monkeypatch.setattr(capture, "_LOOP_LAG_WARN_MS", 100.0)         # make the plant cheap
    capture.STATUS.pop("loop", None)

    async def go():
        mon = asyncio.ensure_future(capture.loop_monitor(period_s=0.01))
        for _ in range(3):
            await asyncio.sleep(0.02)
            time.sleep(0.12)                               # three "long" stalls inside one window
        await asyncio.sleep(0.02)
        capture._STOP.set()
        await mon
    with caplog.at_level("WARNING"):
        asyncio.run(go())
    assert capture.STATUS["loop"]["stalls"] >= 3
    assert caplog.text.count("event loop stalled") == 1, "rate-limited: the onset, not one line per stall"


def test_LOOP_MONITOR_IS_A_SUPERVISED_BACKGROUND_TASK():
    src = module_source("capture.py")
    assert '("loop_monitor", loop_monitor)' in src, "registered in _BACKGROUND, so keep_running owns it"


# ══════════════════════════════════════════════════════════════════════════════════════════════
# §L3 — the per-poll tree walks run off the loop
# ══════════════════════════════════════════════════════════════════════════════════════════════

def test_STORAGE_POLLER_WALKS_THE_NIGHTS_OFF_THE_EVENT_LOOP(_fresh, tmp_path, monkeypatch):
    """`active_nights` is a listdir+getmtime over every file of every night. On a 20-night SD card
    under a concurrent archive copy that is hundreds of ms — on the loop that stamps the ECG."""
    where = {}
    main = threading.current_thread()

    def spy(captures, settle):
        where["thread"] = threading.current_thread()
        return set()
    monkeypatch.setattr(capture.diskguard, "active_nights", spy)
    monkeypatch.setattr(capture.diskguard, "disk_report",
                        lambda root, m: {"low": False, "free_gb": 12.0, "free_pct": 40, "total_gb": 30})
    real = asyncio.sleep

    async def stop_sleep(s):
        capture._STOP.set()
        await real(0)
    monkeypatch.setattr(capture.asyncio, "sleep", stop_sleep)
    asyncio.run(capture.storage_poller({"storage": {"keep_nights": 0, "poll_sec": 1}}, str(tmp_path)))
    assert "thread" in where, "the walk must still RUN"
    assert where["thread"] is not main, "…but not on the loop's thread"


def test_EVERY_PER_POLL_TREE_WALK_IS_TO_THREADED():
    """The other three sites (qc_poller's `_current_night`, archive_poller's two `pending_nights`) are
    pinned by source shape: an inline call on any of them is the regression."""
    src = module_source("capture.py")
    assert "await asyncio.to_thread(_current_night, captures, settle)" in src
    assert src.count("await asyncio.to_thread(nightarchive.pending_nights, captures, active)") == 2
    assert src.count("await asyncio.to_thread(diskguard.active_nights, captures, settle)") >= 2
    # and no poller calls them inline any more
    assert not re.search(r"^\s+(?:protect|current) = (?:diskguard\.active_nights|_current_night)\(", src, re.M)
    assert not re.search(r"for night in nightarchive\.pending_nights\(", src)
