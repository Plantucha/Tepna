# tepna-capture — stallsampler.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# WHICH JOB HELD THE LOOP. `capture.loop_monitor` measures the lag and `SlowCallbackWatch` names the
# callback, and neither of them can name the WORK: the §4 table in
# `briefs/O2RING-FREEZE-SURVIVAL-2026-10-13-BRIEF.md` lists eleven jobs that reach the disk through
# `asyncio.to_thread`, so the holder is a frame in an executor thread rather than a handle on the loop.
#
# ⚠️ AND THE REASON THIS IS A THREAD RATHER THAN A TASK. `loop_monitor` runs ON the loop, so it learns
# the lag only after the loop runs again — by which time the stack that held it has returned and there is
# nothing left to sample. A watchdog thread keeps running while the loop is blocked (every one of those
# eleven jobs releases the GIL in its syscalls), so it samples the stack DURING the stall. That ordering
# is the whole mechanism: after the fact, every one of these freezes looks the same.
#
# On night 2026-10-12 the daemon froze for up to 16 s at a time, the O2Ring lost 87 s of signal in six
# gaps, and the night failed SOLID. Nobody could name the job. This writes one row per stall episode to
# <night>/STALLS.jsonl so the next one names itself.
"""The stall sampler: one row per event-loop stall, carrying the stack of every thread during it."""

import datetime as _dt
import sys as _sys
import threading as _threading
import time as _time
import traceback as _tb

#: The brief's figure. `capture._LOOP_LAG_STALL_MS` is 100 ms and stays there, because the two answer
#: different questions: 100 ms counts the CADENCE of lag, and a count is cheap. A stack sample across
#: every thread costs a frame walk per thread, and 500 ms is where a freeze is worth that — the night
#: that motivated this brief held the loop for 16,000 ms.
THRESHOLD_MS = 500.0
#: How often the watchdog compares the loop's heartbeat against the clock. A stall is resolved to within
#: one interval, so this is also the floor on the reported duration's precision.
SAMPLE_INTERVAL_S = 0.1
#: Innermost frames kept per thread. The job's own call is at the top; its caller chain names the poller.
TOP_FRAMES = 6
#: Rows per sampler, after which it stops writing and SAYS SO in the row that reaches the cap. A stall
#: storm must not fill the disk the recordings live on, and must not go quiet either.
MAX_ROWS = 200


#: How often the LOOP touches its own heartbeat. The watchdog computes the lag against this, so an
#: ordinary tick already reads as `BEAT_INTERVAL_S` of lag — the period has to sit far enough under
#: `THRESHOLD_MS` that no healthy tick can reach it. At 50 ms against 500 ms there is a factor of ten,
#: and the assertion in the tests holds the pair together so neither can be tuned alone.
BEAT_INTERVAL_S = 0.05


class LoopBeat:
    """The loop's own pulse, written by a task ON the loop and read by the watchdog thread.

    ⚠️ IT IS THE ONLY THING THE WATCHDOG READS FROM THE LOOP, and it is one float, so the thread never
    takes a lock and can never be the reason the loop waits. `None` until the first touch, which the
    sampler reads as "not started" rather than as a stall since the epoch."""

    __slots__ = ("mono",)

    def __init__(self) -> None:
        self.mono: float | None = None

    def touch(self, now_s: float) -> None:
        self.mono = now_s


def thread_names(row: dict) -> str:
    """One journal-readable line naming each sampled thread and its innermost frame.

    §∅ at the presentation layer too: when the row carries no stacks this returns the row's own REASON,
    never an empty string — a journal line that trails off after "threads:" reads as a formatting bug
    rather than as the finding it is."""
    stacks = row.get("stacks")
    if not stacks:
        return row.get("stacks_reason") or "stacks absent, no reason recorded"
    parts = []
    for v in stacks.values():
        frames = v.get("frames") or []
        parts.append(f"{v.get('thread')}:{frames[0] if frames else 'no frames'}")
    return ", ".join(sorted(parts))


def thread_stacks(limit: int = TOP_FRAMES, exclude_ident: int | None = None) -> dict:
    """Every live thread's innermost `limit` frames, innermost first, keyed by thread id.

    `exclude_ident` drops the sampler's own thread, which is otherwise in every sample naming itself.

    ⚠️ A thread with no `threading` object reports `"thread": null`, never a made-up name: a raw thread
    from a C extension is exactly the holder a borrowed name would hide."""
    named = {t.ident: t.name for t in _threading.enumerate()}
    out: dict[str, dict] = {}
    for ident, frame in _sys._current_frames().items():
        if ident == exclude_ident:
            continue
        frames = [f"{s.name} ({s.filename.rsplit('/', 1)[-1]}:{s.lineno})" for s in _tb.extract_stack(frame)[-limit:]]
        out[str(ident)] = {"thread": named.get(ident), "frames": list(reversed(frames))}
    return out


class StallSampler:
    """The episode machine. `tick` is one watchdog step and returns a row, or `None` for no row yet.

    It is a plain object with an injectable step so the whole of it is testable without a thread: the
    thread in `run` does nothing but call `tick` on a cadence."""

    def __init__(self, threshold_ms: float = THRESHOLD_MS, max_rows: int = MAX_ROWS, limit: int = TOP_FRAMES) -> None:
        self.threshold_ms = float(threshold_ms)
        self.max_rows = int(max_rows)
        self.limit = int(limit)
        self.rows_written = 0
        #: Episodes past the cap. Counted rather than ignored, and the capped row carries the count so
        #: far — a sampler that went quiet because of its own limit must never read as a quiet night.
        self.rows_dropped = 0
        #: Sink or sample failures. `run` swallows them so the capture survives, and the caller logs this
        #: at shutdown — a swallowed exception that nothing counts is an instrument that lies by silence.
        self.errors = 0
        self._open: dict | None = None

    def tick(self, now_s: float, heartbeat_s: float | None, wall: str | None = None) -> dict | None:
        """One watchdog step. `heartbeat_s` is the loop's last tick on the same monotonic clock as
        `now_s`; `None` means the loop has not ticked yet, which is not a stall.

        A row is returned when an episode ENDS, because that is the first moment its duration is known.
        The stacks in it were sampled when the episode OPENED, which is the only moment they exist."""
        if heartbeat_s is None:
            return None
        lag_ms = (now_s - heartbeat_s) * 1000.0
        if lag_ms >= self.threshold_ms:
            if self._open is None:
                self._open = {
                    "at": wall if wall is not None else _dt.datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
                    "sampled_at_lag_ms": round(lag_ms, 1),
                    "max_lag_ms": round(lag_ms, 1),
                    "samples": 1,
                    "stacks": thread_stacks(self.limit, _threading.get_ident()) or None,
                }
            else:
                self._open["max_lag_ms"] = max(self._open["max_lag_ms"], round(lag_ms, 1))
                self._open["samples"] += 1
            return None
        if self._open is None:
            return None
        ep = self._open
        self._open = None
        if self.rows_written >= self.max_rows:
            self.rows_dropped += 1
            return None
        self.rows_written += 1
        return {
            "schema": "tepna.stall/1",
            "at": ep["at"],
            "lag_ms": ep["max_lag_ms"],
            "sampled_at_lag_ms": ep["sampled_at_lag_ms"],
            "samples": ep["samples"],
            "threshold_ms": self.threshold_ms,
            "capped": self.rows_written >= self.max_rows,
            "dropped_before": self.rows_dropped,
            "stacks": ep["stacks"],
            #: §∅. No stack survived the sampler's own exclusion, so there is nothing to name — and an
            #: empty object there would read as "every thread was idle", which is the one thing a
            #: 16 s freeze was not. A row with a null here still carries its duration, which is a
            #: reduced-coverage annotation rather than a refusal.
            "stacks_reason": None if ep["stacks"] else "only-the-sampler-thread-was-running",
        }

    def run(
        self,
        heartbeat,
        sink,
        stop,
        interval_s: float = SAMPLE_INTERVAL_S,
        now=_time.monotonic,
        sleep=_time.sleep,
    ) -> None:
        """The watchdog body, for a daemon thread. `heartbeat()` returns the loop's last tick or `None`,
        `sink(row)` appends one row, `stop()` ends the watch.

        ⚠️ IT SWALLOWS EVERY EXCEPTION FROM THE SINK AND THE SAMPLE. This runs beside a capture that is
        recording a night; an instrument that can kill the daemon it is diagnosing costs more than the
        diagnosis is worth. The failure is visible as a missing row, which is why `rows_written` is a
        counter the caller logs rather than an internal."""
        while not stop():
            try:
                row = self.tick(now(), heartbeat())
                if row is not None:
                    sink(row)
            except Exception:  # noqa: BLE001 — see the docstring: never take the capture down
                self.errors += 1
            sleep(interval_s)
