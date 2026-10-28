# tepna-capture — tests/test_loss_audit_stall_attribution.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""WHO HELD THE LOOP, as the night's own artifact.

`loop_monitor` names no holder, so `LOSS-AUDIT.json`'s `daemon:event-loop stall` bin reads "whatever
held it". Two instruments in the daemon do name one — `capture.SlowCallbackWatch` in a journal line and
`capture.stall_sampler_watch` in `<night>/STALLS.jsonl` — and until this reader neither had a consumer.

What these tests pin, in order of how easily each could silently rot:
  · the DRIFT GUARDS — the producer's own line and the producer's own row, parsed by this consumer. Two
    copies of one shape is how the "25 at the QC poll's cadence" misreading of 2026-09-25 became durable
  · THREE-VALUED arming: off (`events: null`), armed-and-quiet (`events: {}`), and unread (`armed: null`)
  · rows outrank an unread journal, because only an armed sampler can have written them
  · the rows are a SAMPLE: the cap and what it dropped travel with them
"""

import asyncio
import datetime as dt
import json
import os
import time

import capture
import loss_audit
import stallsampler

SINCE = dt.datetime(2026, 9, 25, 18, 0, 0)
UNTIL = dt.datetime(2026, 9, 26, 6, 0, 0)


def _row(**kw):
    r = {
        "schema": "tepna.stall/1",
        "at": "2026-09-25T23:10:00",
        "lag_ms": 1500.0,
        "samples": 3,
        "threshold_ms": 500.0,
        "capped": False,
        "dropped_before": 0,
        "stacks": {"1": {"thread": "MainThread", "frames": ["nightqc.summarize:41"]}},
        "stacks_reason": None,
    }
    r.update(kw)
    return r


def _jsonl(night_dir, *lines):
    os.makedirs(night_dir, exist_ok=True)
    with open(os.path.join(night_dir, loss_audit.STALLS_FILE), "w", encoding="utf-8") as fh:
        for ln in lines:
            fh.write((ln if isinstance(ln, str) else json.dumps(ln)) + "\n")


# ── DRIFT GUARDS: the producer's own output through this reader ───────────────────────────────────────


def test_DRIFT_the_watchs_OWN_line_is_what_this_reader_parses(caplog):
    """The regex here and the format string in `capture.py` are two copies of one shape. This runs the
    real instrument and feeds its real message to the real reader, so a reword reds HERE rather than on
    the night someone needs the attribution."""

    async def body():
        w = capture.SlowCallbackWatch(threshold_ms=40)
        w.install()
        try:
            loop = asyncio.get_running_loop()
            done = asyncio.Event()

            def qc_offload_stand_in():
                time.sleep(0.09)
                done.set()

            loop.call_soon(qc_offload_stand_in)
            await done.wait()
            await asyncio.sleep(0)
        finally:
            w.restore()

    with caplog.at_level("WARNING"):
        asyncio.run(body())
    lines = [r.getMessage() for r in caplog.records]
    got = loss_audit.callback_watch(lines)
    assert got["armed"] is True, got
    assert got["events"], f"the producer's own line did not parse: {lines}"
    name, rec = next(iter(got["events"].items()))
    assert "qc_offload_stand_in" in name, name
    assert rec["n"] == 1 and rec["worst_ms"] >= 80, rec


def test_DRIFT_the_samplers_OWN_row_is_what_this_reader_summarises(tmp_path):
    """Same guard on the file half: the row comes from `StallSampler.tick`, not from a literal here."""
    s = stallsampler.StallSampler(threshold_ms=10.0)
    assert s.tick(1.0, 0.0) is None  # lag 1000 ms opens the episode
    row = s.tick(1.0, 1.0)  # lag 0 closes it, and the row is returned
    assert row is not None
    night = str(tmp_path / "2026-09-25")
    _jsonl(night, row)
    got = loss_audit.stall_rows(night)
    assert got["present"] is True and got["rows"] == 1, got
    assert got["worst_lag_ms"] == row["lag_ms"], got
    # `thread_stacks` excludes its OWN thread, and here that is the caller — so whether this row carries
    # stacks depends on what else was running. Both outcomes are asserted rather than assumed, because
    # the guard is about the ROW surviving the reader, not about this process's thread list.
    if row["stacks"]:
        assert got["threads"], got
    else:
        assert got["rows_without_stacks"] == 1 and got["threads"] == {}, got


def test_DRIFT_the_OFF_lines_both_instruments_log_are_the_needles_here(caplog):
    """The OFF line is what distinguishes "off" from "unread", so its wording is load-bearing."""
    with caplog.at_level("INFO"):
        asyncio.run(capture.slow_callback_watch({}))
        asyncio.run(capture.stall_sampler_watch({}, "/nonexistent-root"))
    msgs = " ".join(r.getMessage() for r in caplog.records)
    assert loss_audit.SLOW_CB_OFF_NEEDLE in msgs, msgs
    assert loss_audit.SAMPLER_OFF_NEEDLE in msgs, msgs


# ── THREE-VALUED ARMING ──────────────────────────────────────────────────────────────────────────────


def test_an_OFF_watch_reports_events_NULL_and_says_why():
    got = loss_audit.callback_watch(["2026-09-25T22:00:01 vigil x[1]: slow-callback watch: OFF — x"])
    assert got == {"armed": False, "events": None, "reason": loss_audit.SLOW_CB_OFF_REASON}


def test_an_ARMED_watch_with_no_slow_callback_reports_an_EMPTY_set_which_is_a_finding():
    """`{}` says the loop ran clean under the instrument. `null` would say nobody looked, and the two
    are the readings residue 2026-09-25 was created by confusing."""
    got = loss_audit.callback_watch(["2026-09-25T22:00:01 vigil x[1]: slow-callback watch: ON — >= 100 ms"])
    assert got["armed"] is True and got["events"] == {} and got["reason"] is None


def test_a_window_with_NEITHER_line_is_UNREAD_not_off():
    got = loss_audit.callback_watch(["2026-09-25T22:00:01 vigil x[1]: Starting tepna-capture"])
    assert got["armed"] is None and got["events"] is None
    assert "unread" in got["reason"]


def test_a_slow_callback_line_OUTRANKS_an_OFF_line_because_only_an_armed_watch_emits_one():
    got = loss_audit.callback_watch(
        [
            "slow-callback watch: OFF — slow_callback.enabled is false",
            "slow callback: task:qc_poller:summarize held the loop 2400 ms — stamps waited (seen 1, worst 2400 ms)",
        ]
    )
    assert got["armed"] is True
    assert got["events"]["task:qc_poller:summarize"] == {"n": 1, "worst_ms": 2400.0}


def test_the_ON_OFF_pair_is_LAST_WINS_because_a_restart_can_change_it_mid_window():
    on = "slow-callback watch: ON — >= 100 ms"
    off = "slow-callback watch: OFF — slow_callback.enabled is false"
    assert loss_audit.callback_watch([on, off])["armed"] is False
    assert loss_audit.callback_watch([off, on])["armed"] is True


def test_repeated_names_AGGREGATE_to_a_count_and_the_worst_duration():
    got = loss_audit.callback_watch(
        [
            "slow callback: task:qc:summarize held the loop 900 ms — x (seen 1, worst 900 ms)",
            "slow callback: task:qc:summarize held the loop 2600 ms — x (seen 2, worst 2600 ms)",
            "slow callback: <Handle other() at a.py:1> held the loop 150 ms — x (seen 1, worst 150 ms)",
        ]
    )
    assert got["events"]["task:qc:summarize"] == {"n": 2, "worst_ms": 2600.0}
    assert got["events"]["<Handle other() at a.py:1>"]["n"] == 1


# ── THE SAMPLER'S FILE ───────────────────────────────────────────────────────────────────────────────


def test_an_ABSENT_file_is_not_a_quiet_night(tmp_path):
    got = loss_audit.stall_rows(str(tmp_path / "2026-09-25"))
    assert got["present"] is False
    assert set(got) == set(loss_audit.stall_rows_keys()), "every path must carry the same keys"
    assert all(v is None for k, v in got.items() if k != "present"), got


def test_a_TORN_final_line_is_counted_and_skipped_rather_than_raising(tmp_path):
    """The daemon appends to this file while it runs, so the last line can be half-written."""
    night = str(tmp_path / "2026-09-25")
    _jsonl(night, _row(), "", '{"schema": "tepna.stall/1", "lag_m', json.dumps([1, 2]))
    got = loss_audit.stall_rows(night)
    assert got["rows"] == 1, got
    assert got["torn_lines"] == 1, got


def test_a_row_with_NO_STACKS_still_counts_and_is_reported_separately(tmp_path):
    night = str(tmp_path / "2026-09-25")
    _jsonl(night, _row(stacks=None, stacks_reason="only-the-sampler-thread-was-running"))
    got = loss_audit.stall_rows(night)
    assert got["rows"] == 1 and got["rows_without_stacks"] == 1
    assert got["threads"] == {}


def test_a_stack_entry_without_frames_or_of_the_wrong_shape_degrades_to_the_thread_name(tmp_path):
    night = str(tmp_path / "2026-09-25")
    _jsonl(
        night,
        _row(stacks={"1": {"thread": "qc", "frames": []}, "2": "not-a-dict"}),
        _row(lag_ms="not-a-number", stacks=None),
    )
    got = loss_audit.stall_rows(night)
    assert got["threads"] == {"qc": 1}, got
    assert got["worst_lag_ms"] == 1500.0, "a non-numeric lag must not become the worst"
    assert got["rows_without_stacks"] == 1, got


def test_an_EMPTY_file_reports_no_worst_lag_rather_than_zero(tmp_path):
    night = str(tmp_path / "2026-09-25")
    _jsonl(night)
    got = loss_audit.stall_rows(night)
    assert got["rows"] == 0 and got["worst_lag_ms"] is None


def test_the_CAP_and_what_it_dropped_travel_with_the_rows(tmp_path):
    """The rows are a sample for the same reason the stall bin is, so a reader must see the cap."""
    night = str(tmp_path / "2026-09-25")
    _jsonl(night, _row(), _row(capped=True, dropped_before=7))
    got = loss_audit.stall_rows(night)
    assert got["capped"] is True and got["dropped_past_cap"] == 7


# ── THE TWO HALVES TOGETHER ──────────────────────────────────────────────────────────────────────────


def test_ROWS_OUTRANK_an_unread_journal(tmp_path):
    night = str(tmp_path / "2026-09-25")
    _jsonl(night, _row())
    got = loss_audit.stall_attribution(None, night)
    assert got["stall_sampler"]["armed"] is True, got["stall_sampler"]
    assert got["stall_sampler"]["reason"] is None
    assert got["callback_watch"]["armed"] is None, "an unread journal leaves the callback half unread"


def test_an_ARMED_sampler_with_no_file_reports_ZERO_rows_because_it_writes_on_the_first_stall(tmp_path):
    got = loss_audit.stall_attribution(["stall sampler: ON — a stall >= 500 ms writes ONE row"], str(tmp_path))
    assert got["stall_sampler"]["armed"] is True
    assert got["stall_sampler"]["rows"] == 0
    assert "no stall reached" in got["stall_sampler"]["reason"]


def test_an_OFF_sampler_keeps_rows_NULL_and_names_the_config_key(tmp_path):
    got = loss_audit.stall_attribution(["stall sampler: OFF — stall_sampler.enabled is false"], str(tmp_path))
    assert got["stall_sampler"]["armed"] is False
    assert got["stall_sampler"]["rows"] is None
    assert got["stall_sampler"]["reason"] == loss_audit.SAMPLER_OFF_REASON


def test_neither_line_leaves_the_sampler_UNREAD(tmp_path):
    got = loss_audit.stall_attribution(["Starting tepna-capture"], str(tmp_path))
    assert got["stall_sampler"]["armed"] is None
    assert "unread" in got["stall_sampler"]["reason"]


# ── THE JOURNAL READER ───────────────────────────────────────────────────────────────────────────────


class _R:
    def __init__(self, rc, out=""):
        self.returncode = rc
        self.stdout = out


def test_the_reader_parses_the_window_when_journalctl_answers(tmp_path):
    got = loss_audit.read_stall_attribution(
        SINCE, UNTIL, str(tmp_path), run=lambda *a, **k: _R(0, "slow-callback watch: ON — >= 100 ms\n")
    )
    assert got["callback_watch"]["armed"] is True and got["callback_watch"]["events"] == {}


def test_a_NONZERO_journalctl_leaves_the_callback_half_unread(tmp_path):
    got = loss_audit.read_stall_attribution(SINCE, UNTIL, str(tmp_path), run=lambda *a, **k: _R(1))
    assert got["callback_watch"]["armed"] is None


def test_an_ABSENT_journalctl_leaves_the_callback_half_unread_and_still_reads_the_file(tmp_path):
    night = str(tmp_path / "2026-09-25")
    _jsonl(night, _row())

    def boom(*a, **k):
        raise OSError("no journalctl here")

    got = loss_audit.read_stall_attribution(SINCE, UNTIL, night, run=boom)
    assert got["callback_watch"]["armed"] is None
    assert got["stall_sampler"]["rows"] == 1, "the file half must answer without the journal"


# ── WHAT THE MUTATION GATE SAW THAT NOTHING ABOVE OBSERVED ───────────────────────────────────────────
# Each case below pins a value a mutant moved while the suite stayed green. The names say which reading
# the night loses, never which mutant, because the mutant numbering is not stable across a rewrite.


def test_a_ZERO_MS_callback_reports_zero_rather_than_a_floor():
    """`worst_ms` starts at the identity of `max`, so the shortest event the daemon logs is reportable."""
    got = loss_audit.callback_watch(["slow callback: task:x held the loop 0 ms — y (seen 1, worst 0 ms)"])
    assert got["events"] == {"task:x": {"n": 1, "worst_ms": 0.0}}, got


def test_TWO_torn_lines_count_TWO_and_the_rows_BEHIND_them_are_still_read(tmp_path):
    """A tear stops the LINE, never the file. The daemon appends while it runs, so a tear sits last only
    when nothing follows it — and the rows behind one are the night's own stalls."""
    night = str(tmp_path / "2026-09-25")
    _jsonl(night, '{"schema": "tepna.stall/1", "lag_m', "not json at all", _row(), _row())
    got = loss_audit.stall_rows(night)
    assert got["torn_lines"] == 2, got
    assert got["rows"] == 2, got


def test_the_thread_key_is_the_thread_AND_its_first_frame_and_a_repeat_counts(tmp_path):
    """The key answers WHERE the loop was held, so the frame belongs in it. A thread name alone names the
    sampler's own thread on every row it ever writes."""
    night = str(tmp_path / "2026-09-25")
    _jsonl(night, _row(), _row())
    got = loss_audit.stall_rows(night)
    assert got["threads"] == {"MainThread:nightqc.summarize:41": 2}, got


def test_TWO_stackless_rows_count_TWO(tmp_path):
    night = str(tmp_path / "2026-09-25")
    _jsonl(night, _row(stacks=None), _row(stacks={}))
    got = loss_audit.stall_rows(night)
    assert got["rows_without_stacks"] == 2 and got["rows"] == 2, got


def test_the_worst_lag_keeps_the_samplers_OWN_precision_and_a_zero_reads_zero(tmp_path):
    """One decimal of a millisecond: the sampler logs `lag_ms` as a float, and both a coarser and a
    finer rounding read as a different stall."""
    night = str(tmp_path / "2026-09-25")
    _jsonl(night, _row(lag_ms=0.0))
    assert loss_audit.stall_rows(night)["worst_lag_ms"] == 0.0, "the worst starts at max's identity"
    _jsonl(night, _row(lag_ms=2.25))
    assert loss_audit.stall_rows(night)["worst_lag_ms"] == 2.2, "one decimal, neither two nor none"


def test_an_EMPTY_file_reports_a_MEASURED_zero_for_the_cap_and_for_what_it_dropped(tmp_path):
    """The file exists, so every count is a reading. Only the worst lag is null, because no row carries
    one — §∅ applies per field, not per file."""
    night = str(tmp_path / "2026-09-25")
    _jsonl(night)
    got = loss_audit.stall_rows(night)
    assert got["dropped_past_cap"] == 0 and got["capped"] is False, got
    assert got["threads"] == {} and got["torn_lines"] == 0, got


def test_a_row_carrying_NO_dropped_count_reads_zero_rather_than_one(tmp_path):
    """The sampler writes `dropped_before` only once it has capped, so its absence is a zero it measured."""
    night = str(tmp_path / "2026-09-25")
    _jsonl(night, _row(dropped_before=None), _row(dropped_before=0))
    assert loss_audit.stall_rows(night)["dropped_past_cap"] == 0


def test_the_journal_read_is_BOUNDED_so_a_wedged_journalctl_cannot_hold_the_audit(tmp_path):
    """The audit runs per night inside the morning's own window. An unbounded read here would hand a
    stuck journalctl the whole run, and the reader's refusal path exists for exactly that."""
    seen = {}

    def fake(argv, **kw):
        seen["argv"], seen["kw"] = argv, kw
        return _R(0, "")

    loss_audit.read_stall_attribution(SINCE, UNTIL, str(tmp_path), run=fake)
    assert seen["kw"]["timeout"] == 120, seen["kw"]
    assert seen["argv"][0] == "journalctl" and "tepna-capture" in seen["argv"], seen["argv"]


def test_the_sampler_file_read_NAMES_its_encoding(tmp_path):
    """`encoding="utf-8"` → `None` / dropped. The rows carry thread names and frame text, which are
    device-independent but locale-sensitive, and a wrong codec on this reader does not announce itself:
    a mis-decoded frame simply becomes a different `threads` key, so the night names the wrong holder.

    CPython resolves the default encoding in C, so no in-process patch reaches it; `-X
    warn_default_encoding -W error::EncodingWarning` is the supported lever and holds on a UTF-8 box and
    a C-locale one alike. Same two rules as the sibling in test_loss_audit.py: IN-PROCESS FIRST (mutmut
    selects a mutant's tests from coverage and a subprocess is invisible to the tracer), and NO `env=`
    (the child must inherit `MUTANT_UNDER_TEST`, or it runs the original function however the parent was
    mutated)."""
    import subprocess
    import sys

    night = str(tmp_path / "2026-09-25")
    _jsonl(night, _row(), _row(stacks={"1": {"thread": "MainThread", "frames": ["nightqc.summarize:41"]}}))

    assert loss_audit.stall_rows(night)["rows"] == 2

    src = f"import loss_audit\ngot = loss_audit.stall_rows({night!r})\nassert got['rows'] == 2, got\n"
    r = subprocess.run(
        [sys.executable, "-X", "warn_default_encoding", "-W", "error::EncodingWarning", "-c", src],
        capture_output=True,
        text=True,
        cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    )
    assert r.returncode == 0, r.stderr[-600:]
