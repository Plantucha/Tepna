# tepna-capture — tests/test_heap_probe.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# THE HEAP PROBE — what accumulates, and whether a GC pass is what holds the loop.
#
# `loop_monitor` measures the loop's lateness and its own docstring says it cannot name the holder.
# On 2026-09-23 `loop.lag_max_ms` rose 272 → 593 ms while `RssAnon` rose 128 → 245 MB, both flat from
# 04:22-04:24 — and the H10 kept streaming for 25 minutes past that without the heap moving, which puts
# the accumulator in the Verity or ring path. This probe answers "what allocated it" with tracemalloc
# armed on demand, and tests the GC hypothesis with the tracked-object COUNT beside each snapshot.
#
# What these tests pin, in order of how easily each could silently rot:
#   · §∅ — a duration nothing measured is None, never 0.0 (a gen-2 pass may never happen in a window)
#   · the probe is OFF by default and its task is still WIRED, so arming is a config flag and not a code
#     path exercised for the first time on the night it matters
#   · arming and disarming are idempotent, because the cleanup path is not always the arming one
#   · a `stop` phase with no `start` is DROPPED rather than timed from an invented origin

import asyncio
import gc
import json

import pytest

import capture


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    capture._STOP = asyncio.Event()
    capture._GC_PASS.clear()
    capture._GC_T0.clear()
    monkeypatch.setattr(capture, "_GC_HOOK_ERRORS", 0)
    capture.disarm_gc_probe()
    capture.STATUS.pop("recording", None)
    yield
    capture.disarm_gc_probe()
    capture._GC_PASS.clear()
    capture._GC_T0.clear()


_GROWN: list = []          # module-level so the plant's allocation survives the collection it triggers


def _capture_is_live(monkeypatch, grow=0):
    """Every task test needs capture live, because the probe now arms on CAPTURE and not on boot.
    `grow` allocates inside the interval, which is what the growth plant needs."""
    capture.STATUS["recording"] = True

    async def no_wait(_s, poll_s=10.0):
        if grow:
            _GROWN.extend([[i, i + 1] for i in range(grow)])
        return False, True

    monkeypatch.setattr(capture, "_sleep_watching_capture", no_wait)

    async def no_arm_wait(_s):
        return False

    monkeypatch.setattr(capture, "_stop_or_sleep", no_arm_wait)


def _run(coro):
    return asyncio.run(coro)


# ---------------------------------------------------------------- the pass timer

def test_a_gen2_duration_is_None_until_a_gen2_pass_completes():
    """§∅, and the one most likely to be 'simplified' into a 0.0. A gen-2 collection is rare — a window
    may contain none — so a 0.0 here would read as 'a pass took no time' and would falsify the
    hypothesis with a number nothing measured."""
    snap = capture.gc_snapshot()
    assert snap["gen2_last_ms"] is None and snap["gen2_max_ms"] is None
    assert snap["gen"]["2"]["timed_passes"] == 0
    assert isinstance(snap["gen"]["2"]["collections"], int), "CPython's own counter is still reported"


def test_the_timer_records_a_pass_and_keeps_the_maximum():
    capture.arm_gc_probe()
    capture._gc_pass_callback("start", {"generation": 2})
    capture._gc_pass_callback("stop", {"generation": 2})
    first = capture.gc_snapshot()["gen2_last_ms"]
    assert first is not None and first >= 0.0
    capture._GC_PASS[2]["max_ms"] = 999.0          # a big pass earlier in the window
    capture._gc_pass_callback("start", {"generation": 2})
    capture._gc_pass_callback("stop", {"generation": 2})
    snap = capture.gc_snapshot()
    assert snap["gen2_max_ms"] == 999.0, "max is the window's worst, not the last"
    assert snap["gen"]["2"]["timed_passes"] == 2


def test_a_stop_with_no_start_is_dropped_not_timed_from_nothing():
    """The pass already running when the probe is armed. Timing it from an invented origin would
    manufacture a duration — the same fabrication §∅ forbids for a value."""
    capture._gc_pass_callback("stop", {"generation": 2})
    assert capture.gc_snapshot()["gen2_last_ms"] is None
    assert capture._GC_HOOK_ERRORS == 0, "a dropped pass is not an error"


def test_a_failing_hook_is_COUNTED_never_silent(monkeypatch):
    """It cannot log — a logging call inside a collection allocates and could recurse into the pass being
    timed — so the failure is counted and published. An instrument that fails invisibly is worse than
    one that is absent, because its zero reads like a measurement."""
    capture._gc_pass_callback("start", None)        # info is not a dict: .get raises
    assert capture._GC_HOOK_ERRORS == 1
    assert capture.gc_snapshot()["hook_errors"] == 1


def test_arming_and_disarming_are_idempotent():
    assert capture.arm_gc_probe() is True
    before = len(gc.callbacks)
    assert capture.arm_gc_probe() is True
    assert len(gc.callbacks) == before, "arming twice must not register twice"
    assert capture.disarm_gc_probe() is True
    assert capture.disarm_gc_probe() is True, "disarming an unarmed probe is not an error"
    assert capture.gc_snapshot()["installed"] is False


def test_a_real_collection_is_timed_end_to_end():
    """The plant: drive an ACTUAL collection through CPython rather than calling the callback by hand,
    so the phase strings and the info dict are the interpreter's, not the test's."""
    capture.arm_gc_probe()
    gc.collect(0)
    assert capture.gc_snapshot()["gen"]["0"]["timed_passes"] >= 1


# ---------------------------------------------------------------- the report row

def test_the_first_snapshot_has_no_growth_rows_and_says_so_with_an_empty_list():
    """A difference needs two snapshots. The absence is an empty list, never a fabricated zero-growth
    row — §∅ applied to a comparison rather than to a value."""
    row = capture.heap_report_row("2026-09-24T01:00:00", 1024, 2048, 77, {"gen2_max_ms": None}, [])
    assert row["top_growth"] == [] and row["gc_tracked_objects"] == 77
    assert "not comparable" in row["caveat"], "the caveat rides on every row, not only in a docstring"


# ---------------------------------------------------------------- the task

def test_the_probe_is_OFF_by_default_and_costs_nothing(tmp_path, caplog):
    with caplog.at_level("INFO"):
        _run(capture.heap_probe({}, str(tmp_path)))
    assert "heap probe: OFF" in caplog.text
    assert not (tmp_path / "captures" / capture.HEAP_PROBE_NAME).exists()
    assert capture.gc_snapshot()["installed"] is False, "a disabled probe arms nothing"


def test_the_task_is_registered_even_while_disabled():
    """A probe wired only when enabled is a probe whose wiring is first exercised on the night it is
    armed. `main` registers it unconditionally; it returns immediately when off."""
    src = capture.__loader__.get_source("capture")
    assert '("heap_probe", lambda: heap_probe(cfg, root))' in src


def test_an_armed_probe_writes_a_row_per_snapshot_and_disarms_after(tmp_path, monkeypatch):
    """Two snapshots so the second carries a real `compare_to`. Every row is written AS IT IS TAKEN, so
    a daemon that restarts mid-window leaves what it reached instead of nothing."""
    _capture_is_live(monkeypatch)
    cfg = {"heap_probe": {"enabled": True, "start_after_min": 0, "interval_min": 0, "snapshots": 2,
                          "top": 5}}
    _run(capture.heap_probe(cfg, str(tmp_path)))

    out = json.loads((tmp_path / "captures" / capture.HEAP_PROBE_NAME).read_text())
    assert out["schema"] == "tepna.heap-probe/1" and len(out["rows"]) == 2
    assert out["rows"][0]["top_growth"] == [], "nothing to compare the first snapshot to"
    assert out["rows"][0]["gc_tracked_objects"] > 0
    assert capture.gc_snapshot()["installed"] is False, "the window closed and the hook came off"
    import tracemalloc
    assert not tracemalloc.is_tracing(), "the probe stopped tracing it started"


def test_a_stop_during_the_arming_wait_leaves_nothing_armed(tmp_path, monkeypatch):
    capture.STATUS["recording"] = True

    async def stop_now(_s):
        return True

    monkeypatch.setattr(capture, "_stop_or_sleep", stop_now)
    _run(capture.heap_probe({"heap_probe": {"enabled": True}}, str(tmp_path)))
    assert capture.gc_snapshot()["installed"] is False
    assert not (tmp_path / "captures" / capture.HEAP_PROBE_NAME).exists()


def test_a_daemon_that_STOPS_BEFORE_CAPTURE_arms_nothing(tmp_path, monkeypatch):
    """The evening-restart case Wren's fix is about, taken to its end: the daemon is armed, capture never
    begins, and the box goes down. Nothing may be traced and no row may be written — a window that never
    opened must not leave a file that reads like a measurement."""
    capture.STATUS.clear()                       # never recording

    async def stop(_s):
        return True

    monkeypatch.setattr(capture, "_stop_or_sleep", stop)
    _run(capture.heap_probe({"heap_probe": {"enabled": True}}, str(tmp_path)))

    import tracemalloc
    assert not tracemalloc.is_tracing()
    assert capture.gc_snapshot()["installed"] is False
    assert not (tmp_path / "captures" / capture.HEAP_PROBE_NAME).exists()


def test_a_stop_MID_window_still_stops_tracing_and_disarms(tmp_path, monkeypatch):
    """The `finally` is the point: shutdown must not leave tracemalloc taxing every allocation."""
    _capture_is_live(monkeypatch)
    calls = {"n": 0}

    async def stop_on_second(_s, poll_s=10.0):
        calls["n"] += 1
        return calls["n"] > 1, True

    monkeypatch.setattr(capture, "_sleep_watching_capture", stop_on_second)
    _run(capture.heap_probe({"heap_probe": {"enabled": True, "snapshots": 3}}, str(tmp_path)))
    import tracemalloc
    assert not tracemalloc.is_tracing() and capture.gc_snapshot()["installed"] is False


def test_tracing_started_by_SOMEONE_ELSE_is_left_running(tmp_path, monkeypatch):
    """The probe stops only what it started. A test harness (or a future second probe) that was already
    tracing must not be switched off by this one's cleanup."""
    import tracemalloc

    _capture_is_live(monkeypatch)
    tracemalloc.start(1)
    try:
        _run(capture.heap_probe({"heap_probe": {"enabled": True, "snapshots": 1}}, str(tmp_path)))
        assert tracemalloc.is_tracing(), "the probe stopped tracing it did not start"
    finally:
        tracemalloc.stop()


def test_an_unwritable_report_path_warns_and_never_raises(tmp_path, monkeypatch, caplog):
    """Evidence must never take capture down — the PMD frame dump's rule, kept here."""
    _capture_is_live(monkeypatch)
    (tmp_path / "captures").write_text("a file where the captures dir must go")
    with caplog.at_level("WARNING"):
        _run(capture.heap_probe({"heap_probe": {"enabled": True, "snapshots": 1}}, str(tmp_path)))
    assert "could not write" in caplog.text


@pytest.mark.sets_capture_events   # setting _STOP IS the scenario — see conftest's tripwire
def test_stop_or_sleep_returns_on_the_event_and_on_the_timeout():
    assert _run(capture._stop_or_sleep(0.01)) is False
    capture._STOP.set()

    async def _immediate():
        return await capture._stop_or_sleep(30.0)

    assert _run(_immediate()) is True, "a set _STOP must not wait out the interval"


# ---------------------------------------------------------------- arming on capture, and coverage

def test_the_countdown_starts_AT_CAPTURE_not_at_boot(monkeypatch):
    """Wren's defect. The daemon routinely starts hours before bed — 2026-09-23 booted 23:00:54 against
    capture at 23:13; the night before it restarted at 18:16, 18:53 and 20:56 against capture at 22:38.
    Counting 30 + 2x60 min from an evening restart puts the whole window over an IDLE heap and writes
    "no growth found": a verdict about a period the probe never pointed at."""
    capture.STATUS.clear()
    capture.STATUS["recording"] = False
    polls = {"n": 0}

    async def tick(_s):
        polls["n"] += 1
        if polls["n"] == 3:
            capture.STATUS["recording"] = True      # capture starts on the third poll
        return False

    monkeypatch.setattr(capture, "_stop_or_sleep", tick)
    assert _run(capture._await_first_capture()) is True
    assert polls["n"] == 3, "it must WAIT for capture, not proceed on the first tick"


def test_waiting_for_capture_gives_up_on_stop(monkeypatch):
    capture.STATUS.clear()

    async def stop(_s):
        return True

    monkeypatch.setattr(capture, "_stop_or_sleep", stop)
    assert _run(capture._await_first_capture()) is False


def test_an_interval_with_no_capture_is_NOT_APPLICABLE_not_an_empty_diff():
    """The two look identical in the output and are opposite findings: an interval where nothing streamed
    yields an empty diff for the same reason a leak-free one does."""
    row = capture.heap_report_row("t", 1, 2, 3, {}, [], covered=False, live_streams=0)
    assert row["status"] == "NOT_APPLICABLE" and row["covered_capture"] is False
    assert "absence of capture, not the absence of growth" in row["reason"]
    ok = capture.heap_report_row("t", 1, 2, 3, {}, [], covered=True, live_streams=2)
    assert ok["status"] == "OK" and ok["reason"] is None and ok["live_streams"] == 2


def test_the_interval_sleeper_reports_whether_anything_streamed(monkeypatch):
    capture.STATUS.clear()
    capture.STATUS["recording"] = False
    seen = {"n": 0}

    async def tick(_s):
        seen["n"] += 1
        if seen["n"] == 2:
            capture.STATUS["recording"] = True       # streamed only in the middle of the interval
        return False

    monkeypatch.setattr(capture, "_stop_or_sleep", tick)
    stopped, covered = _run(capture._sleep_watching_capture(30.0, poll_s=10.0))
    assert stopped is False and covered is True, "capture anywhere in the interval counts as covered"

    capture.STATUS["recording"] = False
    stopped, covered = _run(capture._sleep_watching_capture(10.0, poll_s=10.0))
    assert stopped is False and covered is False


def test_the_interval_sleeper_returns_on_stop(monkeypatch):
    capture.STATUS.clear()

    async def stop(_s):
        return True

    monkeypatch.setattr(capture, "_stop_or_sleep", stop)
    assert _run(capture._sleep_watching_capture(60.0)) == (True, False)


def test_live_streams_counts_only_recording_devices():
    capture.STATUS.clear()
    capture.STATUS["devices"] = {"H10": {"recording": True}, "Verity": {"recording": False},
                                 "Ring": {"recording": True}, "junk": "not a dict"}
    assert capture._live_streams() == 2


# ---------------------------------------------------------------- the plant

def test_a_list_grown_INSIDE_the_window_is_named_by_file_and_line(tmp_path, monkeypatch):
    """THE PLANT, per Wren's rule that a plant must fail without the fix. An empty diff cannot be told
    from a probe that sees nothing, so the probe must be shown naming a real grower: this test allocates
    between the two snapshots and requires its own file to appear in the top-N growth rows.

    Without `tracemalloc.start(1)` there is nothing to compare and `top_growth` is empty, so this fails
    on a probe that traces nothing — which is the point."""
    _GROWN.clear()
    _capture_is_live(monkeypatch, grow=20_000)
    cfg = {"heap_probe": {"enabled": True, "start_after_min": 0, "interval_min": 0, "snapshots": 2,
                          "top": 15}}
    try:
        _run(capture.heap_probe(cfg, str(tmp_path)))
        out = json.loads((tmp_path / "captures" / capture.HEAP_PROBE_NAME).read_text())
        growth = out["rows"][1]["top_growth"]
        assert growth, "the second snapshot must carry a diff"
        assert any("test_heap_probe.py" in line for line in growth), (
            f"the probe must NAME the grower by file:line, not merely report bytes: {growth[:3]}")
        assert out["rows"][1]["status"] == "OK" and out["rows"][1]["covered_capture"] is True
    finally:
        _GROWN.clear()
