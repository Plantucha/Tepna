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


# ── the RATE as a SERIES, read back from the journal ────────────────────────────────────────────────
# Row 2026-10-20-ble-backoff-rate-is-drawn-as-a-level-not-a-curve: gap 2 above left the line written and
# unread, so the card could say what the rate IS and never what it HAS BEEN. Every line here is
# SYNTHETIC and its shape copies `log_line`'s output; the shapes are asserted against the real producer
# in `test_the_journal_line_this_module_parses_is_the_one_log_line_writes` below, which is the only
# assertion that fails if the line's grammar moves.
import asyncio  # noqa: E402
import datetime as dt  # noqa: E402
import subprocess  # noqa: E402
from types import SimpleNamespace  # noqa: E402

from aiohttp.test_utils import TestClient, TestServer  # noqa: E402

import ble_series  # noqa: E402
import telemetry  # noqa: E402
import webmon  # noqa: E402

PREFIX = "2026-01-02T{hhmmss}{zone} synthbox python[{pid}]: 2026-01-02 {hhmmss},000 INFO ble: since last line "
MEASURED = "backoff rate H10 {rate}/h over 60 min"
NULL_RATE = "backoff rate VeritySense null/h over 18 min"
NULL_WHY = "backoff rate VeritySense: observed 1080 s of the 3600 s window"


def _bline(pid, hhmmss, segs, zone="-04:00"):
    return PREFIX.format(hhmmss=hhmmss, zone=zone, pid=pid) + segs


def test_a_measured_rate_and_a_null_one_parse_as_different_facts():
    """The pair the row keeps distinct: a figure with its window, and an absence with its own reason."""
    r = ble_series.parse_ble_line(
        _bline(
            111,
            "23:28:22",
            f"connect/H10 3/4 fail timeout=1 · {MEASURED.format(rate='12.3')} · {NULL_RATE} · {NULL_WHY}",
        )
    )
    assert r["pid"] == 111 and r["offsetMin"] == -240
    assert r["tMs"] == int(dt.datetime(2026, 1, 2, 23, 28, 22, tzinfo=dt.timezone.utc).timestamp() * 1000)
    assert r["rates"]["H10"] == {"rate": 12.3, "window_min": 60, "reason": None}
    assert r["rates"]["VeritySense"] == {
        "rate": None,
        "window_min": 18,
        "reason": "observed 1080 s of the 3600 s window",
    }


def test_a_measured_zero_is_a_figure_and_never_the_null():
    """§∅ at the series layer: 0.0 is the morning-after figure, and `null` is no measurement at all."""
    zero = ble_series.parse_ble_line(_bline(1, "01:00:00", MEASURED.format(rate="0.0")))["rates"]["H10"]
    assert zero["rate"] == 0.0 and zero["reason"] is None
    assert ble_series.parse_ble_line(_bline(1, "01:00:00", NULL_RATE))["rates"]["VeritySense"]["rate"] is None


def test_a_line_before_any_backoff_is_a_point_with_no_rate_not_a_skipped_line():
    """`log_line` writes every tick. A tick that reported no device is the daemon's presence, not a gap."""
    r = ble_series.parse_ble_line(_bline(1, "01:00:00", "nothing counted yet · " + blestats.FIRST_LINE))
    assert r["rates"] == {} and r["pid"] == 1


def test_a_line_that_is_not_a_ble_line_is_skipped():
    assert ble_series.parse_ble_line("2026-01-02T01:00:00Z synthbox python[5]: INFO connected") is None
    assert ble_series.parse_ble_line("no stamp here INFO ble: since last line " + NULL_RATE) is None


def test_only_the_text_after_the_needle_is_the_body():
    """A rate segment quoted in the logger prefix belongs to the prefix, not to this line's body."""
    r = ble_series.parse_ble_line(
        "2026-01-02T01:00:00Z synthbox python[5]: "
        + MEASURED.format(rate="99.0")
        + " INFO ble: since last line "
        + MEASURED.format(rate="1.0")
    )
    assert r["rates"]["H10"]["rate"] == 1.0 and r["offsetMin"] == 0


def test_PLANT_a_restart_opens_a_new_segment_and_no_point_crosses_it():
    """The rate's own observation window restarts with the process, so a joined line draws a fall
    out of a window that merely began again."""
    lines = [
        _bline(10, "01:00:00", MEASURED.format(rate="4.0")),
        _bline(10, "01:01:00", MEASURED.format(rate="5.0")),
        "noise",
        _bline(20, "01:02:00", f"{NULL_RATE} · {NULL_WHY}"),
    ]
    s = ble_series.series(lines)
    assert [(g["pid"], len(g["points"])) for g in s["segments"]] == [(10, 2), (20, 1)]
    assert s["segments"][1]["points"][0]["rates"]["VeritySense"]["rate"] is None
    assert s["shapes"]["backoff_rate"] == "windowed-rate-per-pid"
    assert s["shapes"]["window_min"] == "window-of-the-point"
    assert s["schema"] == "tepna.ble-series/1"


def test_devices_is_the_union_over_the_window_not_the_newest_line():
    """A device that stops being reported mid-window still has a curve to draw."""
    lines = [
        _bline(10, "01:00:00", f"{MEASURED.format(rate='4.0')} · {NULL_RATE} · {NULL_WHY}"),
        _bline(10, "01:01:00", MEASURED.format(rate="5.0")),
    ]
    assert ble_series.series(lines)["devices"] == ["H10", "VeritySense"]
    assert ble_series.series([])["devices"] == []


def test_points_are_sorted_by_time_within_a_segment():
    lines = [_bline(10, "01:02:00", MEASURED.format(rate="1.0")), _bline(10, "01:00:00", MEASURED.format(rate="2.0"))]
    pts = ble_series.series(lines)["segments"][0]["points"]
    assert [p["rates"]["H10"]["rate"] for p in pts] == [2.0, 1.0]


def test_a_pid_that_returns_after_another_is_a_third_segment():
    lines = [
        _bline(10, "01:00:00", MEASURED.format(rate="1.0")),
        _bline(20, "01:01:00", MEASURED.format(rate="2.0")),
        _bline(10, "01:02:00", MEASURED.format(rate="3.0")),
    ]
    assert [g["pid"] for g in ble_series.series(lines)["segments"]] == [10, 20, 10]


def test_the_journal_line_this_module_parses_is_the_one_log_line_writes():
    """THE CONTRACT, against the real producer: `log_line`'s text, read back by this module.

    Every other test here plants a synthetic line, so this is the one that fails when the segment's
    grammar moves — a reader keyed to a format nobody writes any more reports a quiet night."""
    now = _realtime.monotonic()
    rates = capture.retry_rate_report({"AA": [now - 60.0, now - 30.0]}, {"AA": now - 7200.0}, now)
    rates.update(capture.retry_rate_report({"BB": []}, {"BB": now - 600.0}, now))
    produced = blestats.log_line(blestats.snapshot(), blestats.snapshot(), rates)
    parsed = ble_series.parse_ble_line(
        f"2026-01-02T01:00:00Z synthbox python[7]: 2026-01-02 01:00:00,000 INFO {produced}"
    )
    assert parsed["rates"]["AA"]["rate"] == round(rates["AA"]["rate"], 1)
    assert parsed["rates"]["AA"]["window_min"] == 60 and parsed["rates"]["AA"]["reason"] is None
    assert parsed["rates"]["BB"]["rate"] is None and parsed["rates"]["BB"]["window_min"] == 60
    assert parsed["rates"]["BB"]["reason"] == "observed 600 s of the 3600 s window"


NOW = dt.datetime(2026, 1, 2, 12, 0, 0)


def _runner(rc, out="", err=""):
    calls = []

    def run(argv, **kw):
        calls.append(argv)
        return SimpleNamespace(returncode=rc, stdout=out, stderr=err)

    return run, calls


def test_read_passes_the_window_and_returns_the_series():
    run, calls = _runner(0, _bline(10, "11:00:00", MEASURED.format(rate="9.0")) + "\n")
    out = ble_series.read_ble_series(2, now=NOW, run=run)
    assert out["segments"][0]["pid"] == 10 and out["devices"] == ["H10"]
    assert out["window"] == {"hours": 2, "since": "2026-01-02T10:00:00", "until": "2026-01-02T12:00:00"}
    assert calls[0][calls[0].index("--since") + 1] == "2026-01-02 10:00:00"
    assert calls[0][calls[0].index("--grep") + 1] == "since last line"


def test_an_empty_window_is_an_empty_series_not_unreadable():
    run, _ = _runner(1, "-- No entries --\n")
    assert ble_series.read_ble_series(1, now=NOW, run=run)["segments"] == []


def test_an_unreadable_journal_is_None_never_an_empty_series():
    assert ble_series.read_ble_series(1, now=NOW, run=_runner(1, "", "Failed to open")[0]) is None
    assert ble_series.read_ble_series(1, now=NOW, run=_runner(2, "")[0]) is None

    def boom(argv, **kw):
        raise OSError("no journalctl")

    assert ble_series.read_ble_series(1, now=NOW, run=boom) is None

    def slow(argv, **kw):
        raise subprocess.TimeoutExpired(argv, 60)

    assert ble_series.read_ble_series(1, now=NOW, run=slow) is None


def test_read_defaults_to_now_and_the_real_runner(monkeypatch):
    seen = {}

    def fake(argv, **kw):
        seen["kw"] = kw
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(subprocess, "run", fake)
    assert ble_series.read_ble_series(1)["segments"] == []
    assert seen["kw"]["timeout"] == 60
    # The parser reads `stdout` as str lines: bytes, or an uncaptured stream, would parse to nothing.
    assert seen["kw"]["capture_output"] is True and seen["kw"]["text"] is True


# ── /api/ble-rate ───────────────────────────────────────────────────────────────────────────────────
def _get(tmp_path, path):
    cfg = {"root": str(tmp_path), "clock": {"sudo": False}, "devices": []}
    app = webmon.make_app(
        telemetry.TelemetryBus(), cfg, str(tmp_path / "config.yaml"), "AA:AA:AA:AA:AA:AA", {"devices": {}}, None
    )

    async def go():
        c = TestClient(TestServer(app))
        await c.start_server()
        try:
            r = await c.get(path)
            return r.status, await r.json()
        finally:
            await c.close()

    return asyncio.run(go())


def test_api_ble_rate_clamps_the_window_and_serves_the_series(tmp_path, monkeypatch):
    asked = []
    monkeypatch.setattr(webmon._ble, "read_ble_series", lambda h: asked.append(h) or {"segments": []})
    assert _get(tmp_path, "/api/ble-rate") == (200, {"segments": []})
    _get(tmp_path, "/api/ble-rate?hours=500")
    _get(tmp_path, "/api/ble-rate?hours=0")
    _get(tmp_path, "/api/ble-rate?hours=abc")
    assert asked == [12.0, 72.0, 1.0, 12.0]


def test_api_ble_rate_says_unreadable_with_503_and_null_segments(tmp_path, monkeypatch):
    monkeypatch.setattr(webmon._ble, "read_ble_series", lambda h: None)
    status, body = _get(tmp_path, "/api/ble-rate")
    assert status == 503 and body["segments"] is None
