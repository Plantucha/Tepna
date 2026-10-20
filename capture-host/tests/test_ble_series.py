# tepna-capture — tests/test_ble_series.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""BLE-TRANSPORT-REDESIGN §1.6 — the RATE reaches a reader, and the counters reach a series.

Residue 2026-09-16-ble-counters-not-drawn. The counters reached `status.json` in September and nothing
read them: `find_unwired.py` allowlisted the key BECAUSE nothing did, which is the honest state of a
done-when that asks for a rising rate to be the alert. Two gaps, and the row says the second is the
real work:

  1. THE RATE WAS MEASURED AND DROPPED. `retry_budget_alert` computes attempts/hour to decide a
     warning, so the only device whose rate reached anybody was one ALREADY over budget — the box read
     identically at 0/h and at 19/h against a 20/h budget.
  2. A CUMULATIVE COUNT IS NOT A SERIES. `status.json` is rewritten every tick, and the daemon restarts
     at every deploy, so a count drawn over time steps back and reads as the problem going away. The
     journal line carries the delta since its own previous line, as `mem: VmRSS …` already does.
"""

import os
import sys
import time as _realtime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import blestats  # noqa: E402
import capture  # noqa: E402
import pytest  # noqa: E402

from tests.test_capture_coverage_100 import _run, _stop_after  # noqa: E402


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    blestats.reset()
    monkeypatch.setattr(capture, "_RETRY_STAMPS", {})
    monkeypatch.setattr(capture, "_RETRY_SINCE", {})
    yield
    blestats.reset()


# ── the rate as a REPORT rather than as a warning's input ───────────────────────────────────────────


def test_a_covered_window_reports_the_measured_rate_with_no_reason():
    now = 10_000.0
    stamps = {"AA": [now - 600.0, now - 300.0, now - 10.0]}
    r = capture.retry_rate_report(stamps, {"AA": now - 7200.0}, now)["AA"]
    assert r["rate"] == 3.0 and r["reason"] is None
    assert r["window_sec"] == 3600.0 and r["observed_s"] == 7200.0


def test_PLANT_a_covered_window_holding_no_stamp_is_a_MEASURED_zero():
    """∅ THE DISTINCTION THE WHOLE REPORT EXISTS FOR, and the one a bare `null` cannot carry. A device
    that backed off hours ago has an empty pruned list and a FULLY OBSERVED hour: 0.0/h is the measured
    truth and it is the figure an operator wants once a bad night ends. Reporting `None` here — the
    cautious-looking choice — would make a quiet box indistinguishable from an unobserved one."""
    now = 10_000.0
    r = capture.retry_rate_report({"AA": []}, {"AA": now - 7200.0}, now)["AA"]
    assert r["rate"] == 0.0, "None here erases the recovery it was asked about"
    assert r["reason"] is None


def test_an_uncovered_window_has_no_rate_and_names_what_it_observed():
    """The other absence: ten backoffs in the first ten minutes is not 60/h, it is ten backoffs and an
    unknown rate. A partial window extrapolates to an alert on every daemon start."""
    now = 10_000.0
    r = capture.retry_rate_report({"AA": [now - 60.0]}, {"AA": now - 600.0}, now)["AA"]
    assert r["rate"] is None
    assert r["reason"] == "backoff rate AA: observed 600 s of the 3600 s window"
    assert r["observed_s"] == 600.0


def test_the_observing_map_is_the_authority_for_which_devices_appear():
    """Both maps are written in one block at the single backoff site, and this one is the lower bound on
    when watching began — the quantity the rate needs. Reading the union would add a branch no caller
    can reach, and reading the STAMPS would drop a device whose stamps have all been pruned."""
    now = 10_000.0
    out = capture.retry_rate_report({"BB": [now - 10.0]}, {"AA": now - 7200.0}, now)
    assert list(out) == ["AA"]
    assert out["AA"]["rate"] == 0.0


def test_a_shorter_window_is_honoured_by_both_the_rate_and_its_reason():
    now = 10_000.0
    out = capture.retry_rate_report({"AA": [now - 100.0]}, {"AA": now - 900.0}, now, window_sec=1800.0)
    assert out["AA"]["rate"] is None and "of the 1800 s window" in out["AA"]["reason"]


# ── the status tick: the block carries the rate, the journal carries the series ─────────────────────


class _AdvancingClock:
    """`capture._time`, with a monotonic that moves. Only `monotonic` is overridden."""

    def __init__(self, step=10.0):
        self._t, self._step = 0.0, step

    def monotonic(self):
        self._t += self._step
        return self._t

    def __getattr__(self, name):
        return getattr(_realtime, name)


def _loop(monkeypatch, tmp_path, passes=1, **kw):
    monkeypatch.setitem(capture.STATUS, "devices", {})
    monkeypatch.setattr(capture.writers, "live_loss_check", lambda prev: ([], {}))
    monkeypatch.setattr(capture.writers, "open_writer_paths", lambda: [])
    capture._STOP = capture.asyncio.Event()
    _stop_after(monkeypatch, passes)
    _run(capture.status_loop(str(tmp_path), **kw))
    capture._STOP.clear()


def test_the_tick_publishes_the_rate_beside_the_counters_and_logs_one_line(tmp_path, monkeypatch, caplog):
    blestats.attempt("connect", "AA")
    blestats.ok("connect", "AA")
    monkeypatch.setattr(capture, "_RETRY_STAMPS", {"AA": []})
    monkeypatch.setattr(capture, "_RETRY_SINCE", {"AA": capture._time.monotonic() - 7200.0})
    with caplog.at_level("INFO"):
        _loop(monkeypatch, tmp_path)
    ble = capture.STATUS["ble"]
    assert set(ble) == {"ops", "retries", "backoff_rate"}
    assert ble["backoff_rate"]["AA"]["rate"] == 0.0, "a covered quiet window is a measured zero"
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("ble: ")]
    assert len(lines) == 1
    assert "backoff rate AA 0.0/h over 60 min" in lines[0]
    assert lines[0].endswith(blestats.FIRST_LINE), "the first line of a process has no baseline"


def test_the_journal_cadence_is_not_the_publish_cadence(tmp_path, monkeypatch, caplog):
    """The block is published every tick; the line is not. Same reading as `mem`: a line per tick is
    volume without information."""
    with caplog.at_level("INFO"):
        _loop(monkeypatch, tmp_path, passes=4, ble_log_sec=3600)
    assert sum(r.getMessage().startswith("ble: ") for r in caplog.records) == 1


def test_zero_publishes_the_block_and_logs_nothing(tmp_path, monkeypatch, caplog):
    """0 disables the LINE only — a box that wants no journal volume keeps the block for the monitor."""
    with caplog.at_level("INFO"):
        _loop(monkeypatch, tmp_path, passes=3, ble_log_sec=0)
    assert not any(r.getMessage().startswith("ble: ") for r in caplog.records)
    assert "backoff_rate" in capture.STATUS["ble"]


def test_the_second_line_measures_against_the_first_and_drops_the_no_baseline_reason(tmp_path, monkeypatch, caplog):
    """THE SERIES. Line two has a previous line, so its deltas are measured — and a reader differencing
    two lines never sees a deploy as a recovery, because a new process says it has no baseline."""
    blestats.attempt("connect", "AA")
    # The loop's own clock, advanced 10 s per read: `_stop_after` fakes `asyncio.sleep`, so two passes
    # take microseconds of real monotonic time and no cadence short of zero can elapse between them.
    # The shim proxies every other `_time` member, because the functions the tick calls use their own.
    monkeypatch.setattr(capture, "_time", _AdvancingClock())
    with caplog.at_level("INFO"):
        _loop(monkeypatch, tmp_path, passes=2, ble_log_sec=1.0)
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("ble: ")]
    assert len(lines) == 2
    assert lines[0].endswith(blestats.FIRST_LINE)
    assert blestats.FIRST_LINE not in lines[1]
    assert "connect/AA 0/0" in lines[1], "nothing was counted between the two lines"
