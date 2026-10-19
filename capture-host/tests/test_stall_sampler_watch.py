# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# WHICH JOB HELD THE LOOP — the attribution neither `loop_monitor` nor `SlowCallbackWatch` can give,
# because both of them run ON the loop and so learn of a stall only after the stack that held it has
# returned. The §4 table in `briefs/O2RING-FREEZE-SURVIVAL-2026-10-13-BRIEF.md` lists eleven jobs that
# reach the disk through `asyncio.to_thread`; the holder is a frame in an executor thread.
#
# What these tests pin, in order of how easily each could silently rot:
#   · the wiring is exercised when DISABLED too, so the night it is armed is not the night it is first run
#   · the thread exists and is NAMED, since a row naming `Thread-7` names no job
#   · the night is resolved PER ROW — a watch armed at 21:00 outlives the night boundary
#   · a stall with nowhere to file it still reaches the JOURNAL, rather than returning quietly
#   · the config's threshold and cap reach the sampler, not just the log line
import asyncio
import json
import threading

import pytest

import capture
import stallsampler as ss


def _run(coro):
    return asyncio.run(coro)


def _row(lag=16000.0, samples=3):
    return {
        "schema": "tepna.stall/1",
        "at": "2026-10-12T23:41:07",
        "lag_ms": lag,
        "samples": samples,
        "stacks": {"9": {"thread": "loss_poller", "frames": ["newest_data_mtime (nightqc.py:88)"]}},
        "stacks_reason": None,
    }


def test_DISABLED_it_returns_at_once_and_starts_NO_thread(caplog):
    """The wiring runs every night. A probe wired only when enabled has its registration exercised for
    the first time on the night someone needs it."""
    before = {t.name for t in threading.enumerate()}
    with caplog.at_level("INFO"):
        _run(capture.stall_sampler_watch({"stall_sampler": {"enabled": False}}, "/nonexistent"))
    assert "stall sampler: OFF" in " ".join(r.getMessage() for r in caplog.records)
    assert {t.name for t in threading.enumerate()} == before


def test_a_MISSING_config_section_is_the_same_as_disabled(caplog):
    with caplog.at_level("INFO"):
        _run(capture.stall_sampler_watch({}, "/nonexistent"))
    assert "stall sampler: OFF" in " ".join(r.getMessage() for r in caplog.records)


@pytest.mark.sets_capture_events  # the scenario's end IS `_STOP`; the autouse fixture resets it after
def test_ENABLED_it_runs_a_NAMED_thread_beats_the_loop_and_STOPS_with_the_daemon(caplog, tmp_path):
    """The enabled path end to end. The thread has to be named: a stall row that names `Thread-7` names
    no job, which is the defect this whole unit exists to remove one layer up."""

    async def body():
        capture._STOP.clear()
        t = asyncio.get_running_loop().create_task(
            capture.stall_sampler_watch(
                {"stall_sampler": {"enabled": True, "threshold_ms": 250, "max_rows": 7}}, str(tmp_path)
            )
        )
        named = False
        for _ in range(100):
            await asyncio.sleep(0)
            if "stall_sampler" in {th.name for th in threading.enumerate()}:
                named = True
                break
        capture._STOP.set()
        await t
        return named

    with caplog.at_level("INFO"):
        named = _run(body())
    assert named, "the watchdog thread must exist and carry its own name"
    assert "stall_sampler" not in {th.name for th in threading.enumerate()}, "and must be joined on stop"
    msgs = " ".join(r.getMessage() for r in caplog.records)
    assert "stall sampler: ON" in msgs and "250 ms" in msgs and "cap 7 rows" in msgs, msgs
    assert "stopped after 0 row(s), 0 past the cap, 0 write failure(s)" in msgs, msgs


@pytest.mark.sets_capture_events
def test_STOP_ALREADY_SET_still_arms_and_joins_rather_than_leaving_a_thread_behind(caplog, tmp_path):
    """The shutdown race, and the branch where the beat loop never runs a single iteration."""

    async def body():
        capture._STOP.set()
        await capture.stall_sampler_watch({"stall_sampler": {"enabled": True}}, str(tmp_path))

    with caplog.at_level("INFO"):
        _run(body())
    assert "stall_sampler" not in {th.name for th in threading.enumerate()}
    assert "stopped after 0 row(s)" in " ".join(r.getMessage() for r in caplog.records)


def test_the_sink_files_ONE_JSON_LINE_in_the_nights_own_STALLS_jsonl(tmp_path, caplog):
    captures = tmp_path / "captures"
    (captures / "2026-10-12").mkdir(parents=True)
    with caplog.at_level("WARNING"):
        sink = capture._stall_sink(str(captures), 0.0)
        sink(_row())
        sink(_row(lag=900.0, samples=1))
    lines = (captures / "2026-10-12" / "STALLS.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(lines) == 2, lines
    assert json.loads(lines[0])["lag_ms"] == 16000.0
    assert json.loads(lines[1])["samples"] == 1
    msgs = " ".join(r.getMessage() for r in caplog.records)
    assert "loss_poller:newest_data_mtime (nightqc.py:88)" in msgs, msgs
    assert "2026-10-12/STALLS.jsonl" in msgs


def test_the_night_is_resolved_PER_ROW_because_the_watch_OUTLIVES_the_night_boundary(tmp_path):
    """A watch armed at 21:00 is still running when the next night's directory appears. A path captured
    at arm time would file every later stall into the night that has already ended."""
    captures = tmp_path / "captures"
    (captures / "2026-10-12").mkdir(parents=True)
    sink = capture._stall_sink(str(captures), 0.0)
    sink(_row())
    (captures / "2026-10-13").mkdir()
    sink(_row(lag=700.0))
    assert len((captures / "2026-10-12" / "STALLS.jsonl").read_text().splitlines()) == 1
    assert len((captures / "2026-10-13" / "STALLS.jsonl").read_text().splitlines()) == 1


def test_a_stall_with_NO_NIGHT_DIR_still_reaches_the_JOURNAL_and_writes_nothing(tmp_path, caplog):
    """Before the first night directory exists there is no file to append to, and a sink that returned
    quietly there would lose exactly the start-up stalls — the ones with the most threads doing
    first-time work."""
    captures = tmp_path / "captures"
    captures.mkdir()
    with caplog.at_level("WARNING"):
        capture._stall_sink(str(captures), 0.0)(_row())
    msgs = " ".join(r.getMessage() for r in caplog.records)
    assert "NO night dir" in msgs and "16000 ms" in msgs, msgs
    assert "loss_poller" in msgs, "and it still names the thread it sampled"
    assert list(captures.iterdir()) == []


def test_the_sink_survives_a_row_whose_STACKS_ARE_NULL(tmp_path, caplog):
    """§∅ end to end: the row carries its reason, and the journal line prints the reason rather than
    trailing off after "threads:"."""
    captures = tmp_path / "captures"
    (captures / "2026-10-12").mkdir(parents=True)
    row = _row()
    row["stacks"], row["stacks_reason"] = None, "only-the-sampler-thread-was-running"
    with caplog.at_level("WARNING"):
        capture._stall_sink(str(captures), 0.0)(row)
    assert "only-the-sampler-thread-was-running" in " ".join(r.getMessage() for r in caplog.records)


@pytest.mark.sets_capture_events
def test_the_defaults_come_from_the_MODULE_so_the_two_files_cannot_disagree(caplog, tmp_path, monkeypatch):
    """The threshold and the cap live in `stallsampler`, and `capture` has to read them from there. A
    second literal in capture.py is the drift that makes a log line and a file disagree about one run —
    so this moves the module's values and asks the DAEMON what it armed, rather than reading source."""
    monkeypatch.setattr(ss, "THRESHOLD_MS", 731.0)
    monkeypatch.setattr(ss, "MAX_ROWS", 13)

    async def body():
        capture._STOP.set()
        await capture.stall_sampler_watch({"stall_sampler": {"enabled": True}}, str(tmp_path))

    with caplog.at_level("INFO"):
        _run(body())
    msgs = " ".join(r.getMessage() for r in caplog.records)
    assert "731 ms" in msgs and "cap 13 rows" in msgs, msgs
    assert ss.THRESHOLD_MS == 731.0, "sanity: the patch is what moved, not the assertion"


def test_the_shipped_defaults_are_the_BRIEFS_figures():
    assert (ss.THRESHOLD_MS, ss.MAX_ROWS, ss.BEAT_INTERVAL_S, ss.TOP_FRAMES) == (500.0, 200, 0.05, 6)
