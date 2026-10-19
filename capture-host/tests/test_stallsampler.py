# tepna-capture — tests/test_stallsampler.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The stall sampler, driven by an injected clock so no test waits on a real stall."""

import threading

import pytest
import stallsampler as ss

_THR = 500.0


def _s(**kw):
    return ss.StallSampler(**kw)


# ── thread_stacks: it names the work, and never borrows a name ───────────────────────────────────


def test_the_samplers_OWN_thread_is_excluded_so_it_does_not_name_itself():
    """Without the exclusion the sampler appears in every sample, at the top of the stack, as the
    deepest frame — so the one thread that is certainly NOT holding the loop reads as the holder."""
    mine = threading.get_ident()
    assert str(mine) in ss.thread_stacks()
    assert str(mine) not in ss.thread_stacks(exclude_ident=mine)


def test_a_thread_with_no_threading_object_reports_a_NULL_NAME_not_a_borrowed_one(monkeypatch):
    """§∅. A raw thread from a C extension has no `threading.Thread`, and it is exactly the holder that
    a nearest-match or a default name would hide. The frames still have to arrive: the stack is the
    finding, and the name is a convenience."""
    frame = ss._sys._getframe()
    monkeypatch.setattr(ss._sys, "_current_frames", lambda: {424242: frame})
    out = ss.thread_stacks()
    assert out["424242"]["thread"] is None
    assert out["424242"]["frames"], "a nameless thread must still report its stack"


def test_the_frames_of_ANOTHER_thread_are_INNERMOST_FIRST_and_the_limit_keeps_THAT_end():
    """The production shape: the sampler runs in its own thread and reads the WORKERS. The job's own
    call is the innermost frame, so the limit has to keep that end — a limit taken from the outer end
    returns `Thread._bootstrap` and `run` for every worker alike, which is the same answer for every
    stall and therefore no answer."""
    parked = threading.Event()
    release = threading.Event()

    def the_job_that_held_the_loop():
        parked.set()
        release.wait(5)

    def the_poller_that_called_it():
        the_job_that_held_the_loop()

    t = threading.Thread(target=the_poller_that_called_it, name="loss_poller")
    t.start()
    try:
        assert parked.wait(5), "the worker never parked, so there is nothing to sample"

        def frames_at(limit):
            out = ss.thread_stacks(limit=limit, exclude_ident=threading.get_ident())
            rows = [v for v in out.values() if v["thread"] == "loss_poller"]
            assert len(rows) == 1, out
            return rows[0]["frames"]

        names = [f.split(" (")[0] for f in frames_at(4)]
        assert names.index("the_job_that_held_the_loop") < names.index("the_poller_that_called_it"), names
        assert names[0] == "wait", f"the innermost frame is the park the worker is sitting in: {names}"
        # ⚠️ THE PROPERTY, stated as the pair: at limit 1 the OUTER end is what gets dropped. Had the
        # slice taken the outer end instead, this one frame would be `_bootstrap` for every worker in the
        # process — identical for a stalled thread and an idle one.
        assert frames_at(1) == [frames_at(4)[0]]
        assert "the_poller_that_called_it" not in [f.split(" (")[0] for f in frames_at(1)]
    finally:
        release.set()
        t.join(5)


def test_a_sample_with_NOTHING_LEFT_after_the_exclusion_is_NULL_with_a_REASON(monkeypatch):
    """§∅, and the single-threaded case is how it was found: the sampler excludes itself, so in a
    process with no other thread the stacks come back empty. An empty object there reads as "every
    thread was idle", which is the one thing a 16 s freeze was not.

    ⚠️ THE EMPTY SAMPLE IS INJECTED, not produced by running alone. This test passed by accident on its
    own and failed inside the suite, where other tests leave threads alive — a test whose subject is an
    empty collection must BUILD the empty collection."""
    monkeypatch.setattr(ss, "thread_stacks", lambda *a, **k: {})
    s = _s()
    s.tick(100.6, 100.0)
    row = s.tick(100.7, 100.65)
    assert row["stacks"] is None
    assert row["stacks_reason"] == "only-the-sampler-thread-was-running"
    assert row["lag_ms"] == 600.0, "the duration still stands — reduced coverage annotates, it does not refuse"


def test_a_sample_that_DID_name_a_thread_carries_a_NULL_reason(monkeypatch):
    monkeypatch.setattr(ss, "thread_stacks", lambda *a, **k: {"7": {"thread": "qc_poller", "frames": ["f (x.py:1)"]}})
    s = _s()
    s.tick(100.6, 100.0)
    row = s.tick(100.7, 100.65)
    assert row["stacks"] == {"7": {"thread": "qc_poller", "frames": ["f (x.py:1)"]}}
    assert row["stacks_reason"] is None


# ── tick: the episode machine ────────────────────────────────────────────────────────────────────


def test_no_heartbeat_yet_is_NOT_a_stall():
    """Before the loop's first tick there is no lag to compute. Treating `None` as 0 would make
    `now - 0` an epoch-sized lag and open an episode on every daemon start."""
    assert _s().tick(100.0, None) is None


def test_a_lag_under_the_threshold_writes_NOTHING_and_opens_no_episode():
    s = _s()
    assert s.tick(100.4, 100.0) is None
    assert s._open is None
    assert s.rows_written == 0


def test_the_row_arrives_when_the_episode_ENDS_because_that_is_when_its_DURATION_is_known():
    """The stall's length is only known once the loop runs again. Writing at detection would report the
    threshold (500 ms) for a 16 s freeze — the figure that made this brief necessary."""
    s = _s()
    assert s.tick(100.6, 100.0) is None, "detection alone must not write a row"
    assert s.tick(116.0, 100.0) is None, "still stalled: one episode, not one row per sample"
    row = s.tick(116.1, 116.05)
    assert row is not None
    assert row["schema"] == "tepna.stall/1"
    assert row["lag_ms"] == 16000.0, "the WORST lag seen, not the one that crossed the threshold"
    assert row["sampled_at_lag_ms"] == 600.0, "and the lag the stacks were taken at, stated apart"
    assert row["samples"] == 2
    assert row["threshold_ms"] == _THR
    assert row["samples"] == 2


def test_the_stacks_are_sampled_at_the_START_of_the_episode_not_at_its_end(monkeypatch):
    """By the time the loop runs again the holder has returned. A sample taken at the end would be the
    stack of whatever runs next, presented as the cause."""
    calls = []
    monkeypatch.setattr(ss, "thread_stacks", lambda *a, **k: calls.append(1) or {"1": {"thread": "t"}})
    s = _s()
    s.tick(100.6, 100.0)
    s.tick(101.0, 100.0)
    s.tick(101.1, 101.05)
    assert len(calls) == 1, f"sampled {len(calls)} time(s); the episode opens once"


def test_a_LATER_SMALLER_lag_does_not_lower_the_reported_duration():
    """`max`, in the direction that matters: the samples inside one episode are not monotonic, because
    the heartbeat can advance partway through a multi-stage freeze."""
    s = _s()
    s.tick(102.0, 100.0)
    s.tick(100.7, 100.0)
    row = s.tick(102.1, 102.05)
    assert row["lag_ms"] == 2000.0, row


def test_the_wall_clock_stamp_is_FLOATING_CIVIL_TIME_and_the_caller_may_supply_it():
    """Clock Contract §2 form 3: components as written, no zone, so a reader rebuilds the stamp with
    `offsetMin = null` rather than against the box's zone at read time."""
    s = _s()
    s.tick(100.6, 100.0, wall="2026-10-12T23:41:07")
    row = s.tick(100.7, 100.65)
    assert row["at"] == "2026-10-12T23:41:07"


def test_without_a_supplied_stamp_it_takes_one_ITSELF_rather_than_leaving_the_row_undated():
    s = _s()
    s.tick(100.6, 100.0)
    row = s.tick(100.7, 100.65)
    assert row["at"] and row["at"].count(":") == 2, row["at"]


def test_past_the_cap_it_STOPS_WRITING_and_the_count_of_what_it_dropped_RIDES_THE_NEXT_ROW():
    """A stall storm must not fill the disk the recordings live on. It must not go quiet either: a
    sampler silenced by its own limit would otherwise read exactly like a night with no stalls."""
    s = _s(max_rows=2)
    rows = []
    for k in range(5):
        t = 100.0 + k * 10
        s.tick(t + 0.6, t)
        r = s.tick(t + 0.7, t + 0.65)
        if r is not None:
            rows.append(r)
    assert len(rows) == 2, "the cap is a cap"
    assert rows[1]["capped"] is True, "the row that reaches the cap says so"
    assert rows[0]["capped"] is False
    assert s.rows_dropped == 3
    assert s.rows_written == 2


def test_the_end_of_an_episode_that_was_never_opened_is_not_a_row():
    """The ordinary case, and it runs ten times a second all night: no stall, nothing to close."""
    s = _s()
    s.rows_written = 0
    assert s.tick(100.1, 100.0) is None


# ── run: the watchdog body ───────────────────────────────────────────────────────────────────────


def _driver(seq):
    """A clock that walks `seq` of (now, heartbeat) and then stops."""
    state = {"i": 0}

    def now():
        return seq[min(state["i"], len(seq) - 1)][0]

    def heartbeat():
        return seq[min(state["i"], len(seq) - 1)][1]

    def sleep(_s):
        state["i"] += 1

    def stop():
        return state["i"] >= len(seq)

    return now, heartbeat, sleep, stop


def test_run_appends_one_row_per_episode_and_keeps_watching_after_it():
    now, hb, sleep, stop = _driver([(100.6, 100.0), (100.7, 100.65), (110.6, 110.0), (110.7, 110.65)])
    s = _s()
    rows = []
    s.run(hb, rows.append, stop, interval_s=0, now=now, sleep=sleep)
    assert len(rows) == 2
    assert s.rows_written == 2


def test_run_with_stop_ALREADY_SET_samples_nothing():
    """The shutdown race: the watchdog starts as the daemon is stopping. Branch coverage of the loop's
    own condition, and a sampler that writes a row during teardown writes it to a closed night.

    🔴 THE SLEEP RAISES, AND THAT IS THE ASSERTION. `rows == []` alone is also true of a body that ran
    and produced no row, so this test could not tell "never sampled" from "sampled nothing" — and under
    the mutation gate an inverted loop condition HUNG here instead of dying, because `stop()` answers
    True forever and a no-op sleep advances nothing. The gate reported it UNDECIDED twice on #3654
    (runs 39182747495 and 39184063166, `stallsampler.xǁStallSamplerǁrun__mutmut_1`), which is unmeasured
    rather than killed. `sleep` is the one call outside the loop's `except`, so raising there turns an
    unbounded loop into an immediate failure and states what the test name claims."""
    s = _s()
    rows = []

    def _sleep(_s):
        raise AssertionError("the loop body ran: a watchdog starting into a stopped daemon samples nothing")

    s.run(lambda: 100.0, rows.append, lambda: True, interval_s=0, now=lambda: 101.0, sleep=_sleep)
    assert rows == []


def test_a_FAILING_SINK_is_counted_and_the_watch_SURVIVES_it():
    """⚠️ The capture is recording a night. An instrument that takes the daemon down costs more than the
    diagnosis is worth — so the failure becomes a counter the caller logs, never a raised exception."""
    now, hb, sleep, stop = _driver([(100.6, 100.0), (100.7, 100.65), (110.6, 110.0), (110.7, 110.65)])
    s = _s()

    def sink(_row):
        raise OSError("read-only filesystem")

    s.run(hb, sink, stop, interval_s=0, now=now, sleep=sleep)
    assert s.errors == 2, "both episodes failed to write, and both were counted"
    assert s.rows_written == 2, "the rows were produced; the SINK is what failed"


def test_a_FAILING_SAMPLE_is_counted_too_and_does_not_end_the_watch(monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("frames unavailable")

    monkeypatch.setattr(ss, "thread_stacks", boom)
    now, hb, sleep, stop = _driver([(100.6, 100.0), (100.7, 100.65)])
    s = _s()
    rows = []
    s.run(hb, rows.append, stop, interval_s=0, now=now, sleep=sleep)
    assert s.errors == 1
    assert rows == []


def test_the_threshold_is_the_BRIEFS_figure_and_is_not_the_stall_COUNTERS_figure():
    """`capture._LOOP_LAG_STALL_MS` is 100 ms and stays there. If someone unified them, either the
    counter would stop counting the cadence of lag or every 100 ms hiccup would walk every thread's
    stack — and the comment in each file would still claim the other thing."""
    assert ss.THRESHOLD_MS == _THR
    capture_stall_ms = 100.0
    assert ss.THRESHOLD_MS > capture_stall_ms


def test_the_defaults_are_the_documented_ones():
    s = _s()
    assert (s.threshold_ms, s.max_rows, s.limit) == (ss.THRESHOLD_MS, ss.MAX_ROWS, ss.TOP_FRAMES)
    assert (ss.SAMPLE_INTERVAL_S, ss.TOP_FRAMES, ss.MAX_ROWS) == (0.1, 6, 200)


def test_pytest_is_imported_for_a_reason():
    with pytest.raises(TypeError):
        ss.StallSampler(bogus_kwarg=1)


# ── LoopBeat and the journal line ────────────────────────────────────────────────────────────────


def test_the_beat_is_NONE_until_the_loop_touches_it_and_that_is_not_a_stall():
    beat = ss.LoopBeat()
    assert beat.mono is None
    assert _s().tick(100.0, beat.mono) is None
    beat.touch(99.9)
    assert beat.mono == 99.9


def test_the_beat_PERIOD_sits_far_under_the_THRESHOLD_so_a_healthy_tick_is_never_a_stall():
    """The pair that cannot be tuned alone. The watchdog computes the lag against the last beat, so an
    ordinary tick already reads as one beat period of lag. At a period of half the threshold, every
    healthy tick would open an episode and the file would fill with rows naming nothing."""
    assert ss.BEAT_INTERVAL_S * 1000.0 * 4 <= ss.THRESHOLD_MS
    assert ss.BEAT_INTERVAL_S == 0.05


def test_the_journal_line_names_each_thread_and_its_INNERMOST_frame():
    row = {
        "stacks": {
            "7": {"thread": "qc_poller", "frames": ["newest_data_mtime (nightqc.py:88)", "qc_poller (capture.py:1)"]},
            "9": {"thread": None, "frames": []},
        }
    }
    line = ss.thread_names(row)
    assert "qc_poller:newest_data_mtime (nightqc.py:88)" in line
    assert "None:no frames" in line, line


def test_a_row_with_NO_stacks_puts_its_REASON_in_the_journal_line_not_an_empty_string():
    """§∅ at the presentation layer. A line that trails off after "threads:" reads as a formatting bug
    rather than as the finding."""
    assert ss.thread_names({"stacks": None, "stacks_reason": "only-the-sampler-thread-was-running"}) == (
        "only-the-sampler-thread-was-running"
    )
    assert ss.thread_names({}) == "stacks absent, no reason recorded"


# ── What a single-threaded test process cannot see ──────────────────────────────────────────────
#
# The mutation gate reported 23 survivors over this module on #3654, and most of them share one
# cause: **pytest runs single-threaded, so the sampler is the only live thread.** `thread_stacks`
# then excludes the only ident it finds, the loop body never runs, and neither `limit` nor
# `exclude_ident` is observable. Every argument at the `thread_stacks` call site was therefore free
# to change. The tests below park a real second thread, which is the production shape anyway: the
# sampler reads the WORKERS.
#
# The rest of the survivors sat on `round(lag_ms, 1)`. Every assertion in the file used a lag whose
# three roundings agree (16000.0 rounds to itself at 0, 1 and 2 places), so the precision was free
# too. 612.34 ms and 756.78 ms disagree at all three.


def test_an_EXCLUDED_ident_is_SKIPPED_and_the_threads_after_it_still_report(monkeypatch):
    """`continue`, not `break`. The sampler's own ident can arrive anywhere in the frame dict, and a
    `break` there drops every thread enumerated after it — which, on the box, is most of the capture."""
    frame = ss._sys._getframe()
    mine = threading.get_ident()
    monkeypatch.setattr(ss._sys, "_current_frames", lambda: {mine: frame, 424242: frame})
    out = ss.thread_stacks(exclude_ident=mine)
    assert str(mine) not in out
    assert "424242" in out, "the exclusion skips one thread; it does not end the enumeration"


def test_a_FRAME_NAMES_ITS_FILE_BY_BASENAME_so_the_line_stays_readable(monkeypatch):
    """The frame string is `name (file:line)`, and `file` is the basename. The full path makes the
    journal line unreadable at the width a stall report is read in, and the directory alone names no
    file at all."""
    frame = ss._sys._getframe()
    monkeypatch.setattr(ss._sys, "_current_frames", lambda: {424242: frame})
    frames = ss.thread_stacks()["424242"]["frames"]
    assert frames, "the fixture frame must report"
    for f in frames:
        assert "/" not in f, f"a path, not a basename: {f}"
        assert ".py:" in f, f"neither a file nor a line: {f}"


def test_a_SYNTHETIC_filename_with_NO_directory_still_renders(monkeypatch):
    """A frame compiled from a string carries a filename like `<probe>`, with no separator in it at
    all. Splitting such a name and then indexing FORWARD raises `IndexError`, which would take the
    sample down over a frame the sampler merely passed through."""
    code = compile("import sys as _s; CAUGHT['f'] = _s._getframe()", "<probe>", "exec")
    caught: dict = {}
    exec(code, {"CAUGHT": caught})  # noqa: S102 — a frame with a known synthetic filename, by construction
    monkeypatch.setattr(ss._sys, "_current_frames", lambda: {424242: caught["f"]})
    frames = ss.thread_stacks()["424242"]["frames"]
    assert any("<probe>:" in f for f in frames), frames


def _parked_thread():
    """A live second thread, parked, so `thread_stacks` has something to return. Returns
    `(thread, release)`; the caller sets `release` and joins."""
    parked = threading.Event()
    release = threading.Event()

    def the_worker_the_sampler_reads():
        parked.set()
        release.wait(5)

    t = threading.Thread(target=the_worker_the_sampler_reads, name="parked_worker")
    t.start()
    assert parked.wait(5), "the worker never parked, so there is nothing to sample"
    return t, release


def test_the_EPISODES_stacks_EXCLUDE_the_samplers_own_thread_and_HONOUR_the_limit():
    """The call site, measured with a second thread alive. With only one thread in the process the
    exclusion and the limit are both unobservable, so both arguments were free to change: dropping
    the exclusion puts the sampler at the top of its own report, and dropping the limit returns every
    frame of every worker."""
    t, release = _parked_thread()
    try:
        s = _s(limit=2)
        assert s.tick(100.6, 100.0) is None
        row = s.tick(100.7, 100.65)
        assert row is not None
        stacks = row["stacks"]
        assert stacks, "a parked worker was alive, so the sample is not empty"
        assert row["stacks_reason"] is None
        assert str(threading.get_ident()) not in stacks, "the sampler named itself as the holder"
        worker = [v for v in stacks.values() if v["thread"] == "parked_worker"]
        assert len(worker) == 1, stacks
        assert len(worker[0]["frames"]) == 2, f"limit=2 was not applied: {worker[0]['frames']}"
    finally:
        release.set()
        t.join(5)


def test_the_LAG_KEEPS_ONE_DECIMAL_at_the_moment_the_episode_OPENS():
    """0.1 ms, because the threshold is 500 ms and the figure is read beside it. A whole millisecond
    is coarse enough to hide the difference between two samples of one freeze, and two decimals
    reports the float's own noise as a measurement."""
    s = _s()
    assert s.tick(100.61234, 100.0) is None
    row = s.tick(100.7, 100.65)
    assert row is not None
    assert row["sampled_at_lag_ms"] == 612.3, row["sampled_at_lag_ms"]
    assert row["lag_ms"] == 612.3, row["lag_ms"]


def test_the_RUNNING_MAX_keeps_the_same_ONE_DECIMAL_as_the_opening_sample():
    """The second sample of an episode goes through `max`, on its own line, with its own rounding.
    The two have to agree, or one episode reports its duration to a different precision depending on
    which of its samples happened to be the worst."""
    s = _s()
    assert s.tick(100.61234, 100.0) is None
    assert s.tick(100.75678, 100.0) is None
    row = s.tick(100.8, 100.75)
    assert row is not None
    assert row["samples"] == 2
    assert row["sampled_at_lag_ms"] == 612.3, "the opening sample is reported apart, and unchanged"
    assert row["lag_ms"] == 756.8, row["lag_ms"]


def test_a_lag_EXACTLY_AT_the_threshold_IS_a_stall():
    """`>=`. The threshold is the documented figure, so the sample that reads exactly 500 ms is the
    first stall rather than the last healthy tick — and at a 50 ms beat the equal case is reachable."""
    s = _s()
    assert s.tick(100.5, 100.0) is None, "detection opens the episode and writes nothing yet"
    row = s.tick(100.6, 100.55)
    assert row is not None, "a lag equal to the threshold must open an episode"
    assert row["lag_ms"] == 500.0


def test_run_hands_the_SINK_the_row_itself_and_SLEEPS_the_interval_it_was_given():
    """Both arguments `run` passes on. A sink called with `None` still appends, so counting the
    appends says nothing about what arrived; a sleep called with `None` blocks forever on the box and
    returns instantly against a stub."""
    now, hb, sleep, stop = _driver([(100.6, 100.0), (100.7, 100.65)])
    naps = []

    def _sleep(seconds):
        naps.append(seconds)
        sleep(seconds)

    s = _s()
    rows = []
    s.run(hb, rows.append, stop, interval_s=0.25, now=now, sleep=_sleep)
    assert len(rows) == 1
    assert rows[0] is not None and rows[0]["schema"] == "tepna.stall/1", rows
    assert naps, "the watch never slept, so it never yielded the box"
    assert set(naps) == {0.25}, f"the interval it was given, every time: {naps}"
