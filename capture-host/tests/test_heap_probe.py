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
import tracemalloc

import pytest

import capture
import _srcscan


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
    (tmp_path / "heap-probe.request").write_text("t")   # REQUESTED: the armed path
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
    (tmp_path / "heap-probe.request").write_text("t")   # REQUESTED: the armed path
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
    (tmp_path / "heap-probe.request").write_text("t")   # REQUESTED: the armed path
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
    (tmp_path / "heap-probe.request").write_text("t")   # REQUESTED: the armed path
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
        (tmp_path / "heap-probe.request").write_text("t")   # REQUESTED: the armed path
        _run(capture.heap_probe({"heap_probe": {"enabled": True, "snapshots": 1}}, str(tmp_path)))
        assert tracemalloc.is_tracing(), "the probe stopped tracing it did not start"
    finally:
        tracemalloc.stop()


def test_an_unwritable_report_path_warns_and_never_raises(tmp_path, monkeypatch, caplog):
    """Evidence must never take capture down — the PMD frame dump's rule, kept here."""
    _capture_is_live(monkeypatch)
    (tmp_path / "captures").write_text("a file where the captures dir must go")
    with caplog.at_level("WARNING"):
        (tmp_path / "heap-probe.request").write_text("t")   # REQUESTED: the armed path
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
    (tmp_path / "heap-probe.request").write_text("t")   # REQUESTED: the armed path
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


# ── THE RSS SAMPLER — the quantity the stall was blamed on, beside the one tracemalloc measures ───
# This probe's own docstring quotes `RssAnon` 128 → 245 MB at ~21 MB/h, and until now it recorded only
# `traced_bytes`. Measured on the first real night: traced grew +9.2 MiB/h with NO RSS figure captured,
# so the two could not be compared and the 9.2 was not evidence about the 21.

def test_the_row_carries_RSS_beside_the_traced_bytes(tmp_path):
    """The point of the sampler: one row, both quantities, so a reader can compare them at all."""
    st = tmp_path / "status"
    st.write_text("Name:\tpython3\nVmRSS:\t 262144 kB\nRssAnon:\t 245760 kB\nRssFile:\t  16384 kB\n")
    rss = capture.proc_rss_kb(str(st))
    assert rss == {"VmRSS": 262144, "RssAnon": 245760, "RssFile": 16384}
    row = capture.heap_report_row("2026-09-25T00:21:01", 28751120, 137480083, 1076838, {}, [], rss=rss)
    assert row["rss_kb"]["RssAnon"] == 245760
    assert row["traced_bytes"] == 28751120, "both live on the row — comparing them is the whole point"


def test_an_UNREADABLE_status_file_is_None_per_key_and_never_zero(tmp_path):
    """§∅. A kernel without `RssAnon` and a process using no anonymous memory must not produce the same
    row — and 0 would read as the second while meaning the first."""
    rss = capture.proc_rss_kb(str(tmp_path / "does-not-exist"))
    assert rss == {"VmRSS": None, "RssAnon": None, "RssFile": None}
    row = capture.heap_report_row("t", 1, 2, 3, {}, [], rss=rss)
    assert row["rss_kb"] == {"VmRSS": None, "RssAnon": None, "RssFile": None}
    assert 0 not in row["rss_kb"].values(), "unreadable is not zero"


def test_an_ABSENT_key_is_None_while_its_siblings_are_read(tmp_path):
    """Partial is not all-or-nothing: `RssAnon` arrived in Linux 4.5, so an older kernel answers the
    other two. The row must carry what was read and null what was not."""
    st = tmp_path / "status"
    st.write_text("VmRSS:\t 100 kB\nRssFile:\t 40 kB\n")
    assert capture.proc_rss_kb(str(st)) == {"VmRSS": 100, "RssAnon": None, "RssFile": 40}


def test_a_line_whose_UNIT_is_not_kB_is_refused_rather_than_read_as_kB(tmp_path):
    """The unit is asserted, not assumed. A row that silently changed units would be indistinguishable
    from a 1024x leak, which is the most expensive way for this field to be wrong."""
    st = tmp_path / "status"
    st.write_text("VmRSS:\t 262144 MB\nRssAnon:\t not-a-number kB\nRssFile:\t 16384 kB\n")
    rss = capture.proc_rss_kb(str(st))
    assert rss["VmRSS"] is None, "MB is not kB — refuse rather than publish the number under a wrong unit"
    assert rss["RssAnon"] is None, "a non-numeric value is not a measurement"
    assert rss["RssFile"] == 16384, "and the well-formed sibling is still read"


def test_the_row_defaults_to_NULL_RSS_when_the_caller_passes_none(tmp_path):
    """Back-compat and honesty at once: the parameter is last and optional, so an older caller still
    builds a valid row — and that row says the RSS is unknown rather than omitting the field, which
    would leave a reader unable to tell an old row from a failed read."""
    row = capture.heap_report_row("t", 1, 2, 3, {}, [])
    assert row["rss_kb"] == {"VmRSS": None, "RssAnon": None, "RssFile": None}


# ── PER-SUBSYSTEM ATTRIBUTION: who decodes, how often, and who holds the big containers ──────────
# The probe named `json/decoder.py:361` at +182,469 live objects/h and could not say WHOSE decode that
# was — every caller shares the line inside `json/`. The QC poll was exonerated by measurement (#3072),
# and the remaining clue is the RATE: 50 decodes/s against a poll cadence of ~20/h.
#
# ⚠️ WHY THIS IS A CENSUS AND NOT A REFERRER WALK FROM THE DECODED OBJECTS. That design is not
# implementable and the reason belongs in a test: tracemalloc returns STATISTICS, never the objects, so
# there is no path from a line to the dicts it allocated; and plain `dict`/`list` DO NOT SUPPORT WEAK
# REFERENCES, so a `WeakSet` of decoded results raises TypeError while a strong set would be the leak.

def test_the_census_counts_decodes_PER_CALL_SITE(tmp_path):
    c = capture.DecodeCensus()
    c.install()
    try:
        for _ in range(3):
            json.loads('{"a": 1}')
        json.loads('[1, 2]')
    finally:
        c.restore()
    # One site per source line: the loop body and the single call are different lines of THIS file.
    keys = [k for k in c.counts if k.startswith("test_heap_probe.py:")]
    assert len(keys) == 2, c.counts
    assert sum(c.counts[k] for k in keys) == 4, c.counts


def test_a_site_never_called_is_ABSENT_from_the_census_not_present_with_zero():
    """§∅ for a counter: `{}` means the window observed no decode, which is itself a finding. A census
    pre-seeded with every site at 0 could not say that."""
    c = capture.DecodeCensus()
    assert c.counts == {}
    row = capture.heap_report_row("t", 1, 2, 3, {}, [], decodes=c.top())
    assert row["decodes_by_site"] == {}


def test_the_census_RESTORES_json_even_when_the_body_raises():
    """The dangerous failure. A probe that leaves `json.loads` wrapped has permanently changed the
    process it was measuring — and added a frame walk to every decode for the rest of the night."""
    orig_loads, orig_load = json.loads, json.load
    c = capture.DecodeCensus()
    c.install()
    assert json.loads is not orig_loads, "the wrapper must actually be installed, or this proves nothing"
    try:
        raise RuntimeError("the probe body failed")
    except RuntimeError:
        pass          # the raise IS the scenario: what is under test is that `finally` restores anyway
    finally:
        c.restore()
    assert json.loads is orig_loads and json.load is orig_load
    c.restore()                                # idempotent: a second restore is not an error


def test_install_is_idempotent_and_does_not_double_wrap():
    orig = json.loads
    c = capture.DecodeCensus()
    c.install()
    once = json.loads
    c.install()
    assert json.loads is once, "a second install must not wrap the wrapper — the count would double"
    c.restore()
    assert json.loads is orig


def test_holder_of_finds_a_MODULE_holder():
    """The population a leak actually lives in: a long-lived tracked container. A module global is the
    simplest one and is what `null` must be distinguishable from."""
    capture._HOLDER_TEST_SUBJECT = {f"k{i}": i for i in range(100)}     # noqa: SLF001 — a planted holder
    try:
        h = capture.holder_of(capture._HOLDER_TEST_SUBJECT)
        assert h["module"] == "capture" and h["name"] == "<module>", h
    finally:
        del capture._HOLDER_TEST_SUBJECT


def test_a_FRAME_LOCAL_holder_is_INVISIBLE_and_null_says_so_rather_than_unheld():
    """🔴 A MEASURED LIMIT OF THE INSTRUMENT, pinned so nobody reads a `null` as "nothing holds it".

    On CPython 3.13 an object held only in a frame's fast local has ZERO `gc.get_referrers` — localsplus
    is not reported as a reference from the frame object. So this walk is blind to a live frame local, and
    a `null` means "not held by a tracked container within the bound", which INCLUDES "in flight". A
    reader who takes it as unheld will hunt a leak that is merely a local."""
    held = {f"k{i}": i for i in range(100)}                      # a local of THIS frame
    assert gc.get_referrers(held) == [], (
        "a frame local now HAS referrers on this interpreter — the limit this test records has changed, "
        "and `holder_of`'s docstring plus its null semantics must be re-derived rather than trusted")
    assert capture.holder_of(held) == {"module": None, "name": None}
    # And the bound itself still produces the same shape, so the two causes of null are not distinguished
    # by the value — which is exactly why the docstring states what null covers.
    assert capture.holder_of(held, depth=0) == {"module": None, "name": None}


def test_top_container_holders_is_BOUNDED_and_reports_len_with_a_holder():
    rows = capture.top_container_holders(sample=3)
    assert len(rows) <= 3, "the sample bound is what keeps the probe from becoming the leak"
    for r in rows:
        assert r["kind"] in ("dict", "list") and r["len"] >= 64
        assert set(r) == {"kind", "len", "holder_module", "holder_name"}


# ── PERMISSION IS NOT A REQUEST — SOLID-NIGHT night 1, and the probe degraded the night ───────────
# `heap_probe.enabled` is a STANDING permission, so the probe armed on every daemon start — four that
# evening. While tracing 22:19:56 → 00:21:01 the box logged 25 event-loop stalls of 1–12 s at the QC
# poll's 10-minute cadence, and 58 of the 64 H10 host inter-arrival gaps over 1 s fall inside that
# window; 3 stalls in the two hours after tracing stopped. The recording was whole (`gaps_in_night: []`,
# 13.7 M rows) — the host stamps waited, the device clocks did not — and the owner read it on the monitor
# as "fragmentation". A diagnostic that degrades the night it diagnoses is not a diagnostic.

def test_PLANT_a_start_with_no_request_does_not_arm(tmp_path):
    """The defect. With permission alone the probe used to trace; now it says so and stays off."""
    assert capture.consume_heap_request(str(tmp_path / "heap-probe.request")) is False
    assert not tracemalloc.is_tracing(), "nothing may be tracing on the not-requested path"


def test_PLANT_the_request_is_CONSUMED_so_a_restart_does_not_repeat_it(tmp_path):
    """One-shot is the whole point: four daemon starts that night meant four traced windows."""
    req = tmp_path / "heap-probe.request"
    req.write_text("please trace one window\n")
    assert capture.consume_heap_request(str(req)) is True
    assert not req.exists(), "the request must be gone, or the next start arms again"
    assert (tmp_path / "heap-probe.request.consumed").read_text() == "please trace one window\n", \
        "consumed rather than deleted, so an operator can see the request was honoured"
    assert capture.consume_heap_request(str(req)) is False, "a consumed request is not a second request"


def test_an_UNCONSUMABLE_request_FAILS_CLOSED_and_does_not_arm(tmp_path):
    """⚠️ The direction of the failure is the point. An un-consumable request would otherwise arm on
    EVERY start — the exact defect being fixed — so it must refuse to arm, not arm anyway. Refusing to
    trace is recoverable; a night degraded by the instrument is not."""
    d = tmp_path / "ro"
    d.mkdir()
    (d / "heap-probe.request").write_text("x")
    d.chmod(0o500)                               # can read/list, cannot rename within
    try:
        assert capture.consume_heap_request(str(d / "heap-probe.request")) is False
    finally:
        d.chmod(0o700)


def test_CONTROL_a_requested_start_still_arms_and_the_attribution_runs_behind_the_same_gate(tmp_path):
    """The instrument must remain usable. And the census/holder walk are reached only PAST the gate, so
    one request covers all three costs — tracemalloc's allocation tax, the json wrapper's frame walk and
    the referrer walk — rather than each needing its own switch."""
    req = tmp_path / "heap-probe.request"
    req.write_text("go")
    assert capture.consume_heap_request(str(req)) is True
    src = _srcscan.module_source("capture.py")
    gate = src.index("if not consume_heap_request(req):")
    # The CALL sites, not the definitions — `def top_container_holders(` sits ABOVE the gate in the file,
    # so matching the bare name would have compared the wrong thing and passed for the wrong reason.
    for later in ("_census = DecodeCensus()", "holders=top_container_holders()", "tracemalloc.start(1)"):
        assert src.index(later) > gate, f"{later} must sit BEHIND the request gate, not beside it"


def test_the_census_counts_json_LOAD_as_well_as_LOADS(tmp_path):
    """Both entry points, because a subsystem that reads a FILE uses `json.load` and would otherwise be
    invisible to the census — and the file readers are exactly the periodic jobs this is meant to
    separate from the live path."""
    f = tmp_path / "x.json"
    f.write_text('{"a": 1}')
    c = capture.DecodeCensus()
    c.install()
    try:
        with open(f, encoding="utf-8") as fh:
            assert json.load(fh) == {"a": 1}
    finally:
        c.restore()
    assert sum(c.counts.values()) == 1, c.counts
    assert any(k.startswith("test_heap_probe.py:") for k in c.counts), c.counts


def test_holder_of_walks_THROUGH_an_intermediate_container_to_the_module(tmp_path):
    """The depth mechanism, and the `else` branch that feeds it. A leak is rarely held directly by a
    module global — it sits in a list or a dict that a global holds — so the walk must pass THROUGH a
    referrer that is not itself a holder. Depth 1 cannot reach the module and must return the null shape;
    depth 2 can, which is what distinguishes "no holder within the bound" from "no holder"."""
    subject = {f"k{i}": i for i in range(100)}
    capture._HOLDER_TEST_CHAIN = [subject]                      # noqa: SLF001 — a planted two-level chain
    try:
        assert capture.holder_of(subject, depth=1) == {"module": None, "name": None}, \
            "one hop reaches the list, not the module — the bound must be reported, not guessed past"
        assert capture.holder_of(subject, depth=2) == {"module": "capture", "name": "<module>"}
    finally:
        del capture._HOLDER_TEST_CHAIN


def test_the_walk_stops_when_the_frontier_EMPTIES_before_the_depth_runs_out(tmp_path):
    """The bound has two exits and they are different: depth exhausted, or nothing left to visit. This is
    the second — a chain that ends in a container nothing holds, so the frontier empties at hop 2 while
    two hops of budget remain. Without it the walk would keep asking `get_referrers` of nothing."""
    subject = {f"k{i}": i for i in range(100)}
    holder = [subject]                          # a LOCAL: nothing refers to it, so the chain dead-ends
    assert capture.holder_of(subject, depth=4) == {"module": None, "name": None}
    assert holder[0] is subject                 # and the chain really existed while we walked it


def test_PLANT_heap_probe_RETURNS_without_tracing_when_no_request_is_present(tmp_path):
    """The whole point, end to end rather than on the helper: permission granted, no request, so the probe
    logs and returns and tracemalloc is never started. This is the path every unrequested daemon start
    takes — four of them on the night the probe degraded."""
    was_tracing = tracemalloc.is_tracing()
    _run(capture.heap_probe({"heap_probe": {"enabled": True}}, str(tmp_path)))
    assert tracemalloc.is_tracing() == was_tracing, "an unrequested start must not begin tracing"
    assert not list(tmp_path.glob("heap-probe.json")), "and it must write no report"
