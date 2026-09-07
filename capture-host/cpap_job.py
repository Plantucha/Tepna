# tepna-capture — cpap_job.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# THE POST-THERAPY HARVEST JOB — a durable record of what is OWED, not of what has fired.
#
# ── The defect this exists to remove ────────────────────────────────────────────────────────────────
# `cpap-therapy-end-fired.json` stored one number: the `ended_at_ms` of a therapy end whose trigger had
# FIRED. `capture.py` wrote it BEFORE the interlocks that can defer the harvest, deliberately — a
# one-shot trigger must not re-arm every minute for the rest of the night. The cost was that the file
# could not distinguish four different facts, and the boot path read the only one it had as the last:
#
#     therapy ended  ·  harvest requested  ·  harvest attempted  ·  harvest COMPLETED
#
# Measured on the box 2026-09-06: therapy ended 06:26:04, the trigger fired and the marker was written
# at 07:31:02, the daemon was restarted (a DEPLOY — 127 restarts in six days, all clean exits, median
# 18/day) at 07:32:50, and the boot path logged **"the last therapy end was already harvested"**. It had
# not been harvested. The card was not read until the 13:00 window, 5.5 hours later, and had that window
# also failed the night would have been skipped behind a log line claiming success.
#
# ⚠️ A LOCK ALONE DOES NOT FIX THIS, and that is the whole reason this module exists rather than a
# mutex. The restart landed at +108 s — after the marker was durable, before any byte moved. A lock held
# in the dying process protects nothing across that boundary: it stops a SECOND harvest starting during
# one, it cannot resume an INTERRUPTED one. So the state is persisted at every transition and a job left
# in `harvest_attempted` at boot is RE-QUEUED, never read as complete.
#
# ── Why `unknown` is safe and `completed` is not ────────────────────────────────────────────────────
# The predecessor's own docstring had the right instinct — *"a duplicate costs one extra card read; a
# skip costs the night's data, which is not recoverable"* — and applied it only to a MISSING file. It is
# a rule about the whole state space: every ambiguity here resolves toward doing the work again. The one
# state that stops a harvest is `harvest_completed`, and nothing writes that until the transfer returned.
#
# PURE. No I/O, no clock, no filesystem: `capture.py` owns the atomic read/write and passes `now_ms` in,
# the same split as cpap_live / cpap_harvest / cpap_supervisor.
from __future__ import annotations

__all__ = ["THERAPY_ENDED", "HARVEST_REQUESTED", "HARVEST_ATTEMPTED", "HARVEST_DEFERRED",
           "HARVEST_COMPLETED", "STATES", "END_SOURCES", "new_job", "transition", "is_complete",
           "resume_action", "should_reconcile", "job_id_for", "SCHEMA"]

SCHEMA = 1

#: The lifecycle, in the order a healthy job walks it. `harvest_deferred` is a legal resting place — a
#: resource interlock is not a failure — and it is re-queued exactly like `harvest_attempted`.
THERAPY_ENDED = "therapy_ended"
HARVEST_REQUESTED = "harvest_requested"
HARVEST_ATTEMPTED = "harvest_attempted"
HARVEST_DEFERRED = "harvest_deferred"
HARVEST_COMPLETED = "harvest_completed"
STATES = (THERAPY_ENDED, HARVEST_REQUESTED, HARVEST_ATTEMPTED, HARVEST_DEFERRED, HARVEST_COMPLETED)

#: Where the end-of-therapy claim came from. FIXED vocabulary, one schema, mandatory on every job —
#: an end whose source cannot be named is not evidence, and the fleet's null ruling applies: a source
#: that cannot supply an end TIME writes `therapy_end_ms: None` rather than an invented stamp.
END_SOURCES = ("device_verdict", "standby_hysteresis", "spool_recovered",
               "next_start_inferred", "daily_window", "unknown")


def job_id_for(ended_at_ms) -> str:
    """Stable identity for one therapy end. Idempotent by construction: the same end yields the same id,
    so a duplicate stop event, a crash-replay and a daily reconciliation all address ONE job rather than
    creating three. `None` (an end with no known time) still gets an id, because "a session certainly
    ended and we cannot say when" is a fact worth carrying — it just cannot be keyed on the instant."""
    return "end-unknown" if ended_at_ms is None else f"end-{int(ended_at_ms)}"


def new_job(ended_at_ms, source: str, now_ms: float, *, device=None) -> dict:
    """A job in `therapy_ended` — the fact, before anything has been asked of it.

    `source` must be in END_SOURCES; an unrecognised one is recorded as `unknown` rather than rejected,
    because losing the job would be a worse outcome than losing the label, and a wrong label that
    silently passes is worse than both."""
    return {
        "schema": SCHEMA,
        "job_id": job_id_for(ended_at_ms),
        "therapy_end_ms": ended_at_ms,
        "therapy_end_source": source if source in END_SOURCES else "unknown",
        "device": device,
        "created_ms": now_ms,
        "state": THERAPY_ENDED,
        "retry_count": 0,
        "last_attempt_ms": None,
        "last_error": None,
        "completed_ms": None,
        "files": None,
        "bytes": None,
    }


def transition(job: dict, state: str, now_ms: float, *, error=None, files=None, nbytes=None,
               window_date=None) -> dict:
    """Move a job to `state`, returning a NEW dict — the caller persists it before acting on it.

    `retry_count` increments on entry to `harvest_attempted` and nowhere else: it counts attempts, which
    is what a retry policy needs, not transitions, which is what a state machine happens to produce."""
    if state not in STATES:
        raise ValueError(f"unknown harvest job state {state!r}")
    out = dict(job)
    out["state"] = state
    if state == HARVEST_ATTEMPTED:
        out["retry_count"] = int(job.get("retry_count") or 0) + 1
        out["last_attempt_ms"] = now_ms
        out["last_error"] = None       # this attempt has not failed yet; the previous one is history
    if state == HARVEST_DEFERRED:
        out["last_error"] = error
    if state == HARVEST_COMPLETED:
        out["completed_ms"] = now_ms
        out["last_error"] = None
        if files is not None:
            out["files"] = files
        if nbytes is not None:
            out["bytes"] = nbytes
        # WHICH window this completion answers for. A DATE STRING, deliberately, not a timestamp
        # comparison: the caller's `now` and the job's `completed_ms` can come from different clocks
        # (a test's fake datetime against real `time.time()`), and comparing them silently produced a
        # window that skipped forever. A string equality has no clock in it to get wrong.
        if window_date is not None:
            out["window_date"] = str(window_date)
    return out


def is_complete(job) -> bool:
    """The ONLY predicate that may stop a harvest. Requires the state AND a completion stamp: a record
    carrying `harvest_completed` with no `completed_ms` is malformed, and a malformed record must not be
    able to cancel a night's data."""
    return bool(isinstance(job, dict)
                and job.get("state") == HARVEST_COMPLETED
                and job.get("completed_ms") is not None)


def resume_action(job, now_ms: float) -> tuple[str, str]:
    """What a just-booted daemon should do with the job it found: `("none"|"requeue", why)`.

    Every path that is not a verified completion returns `requeue`. That is the inversion this module
    exists for — the predecessor could only answer "a trigger fired for this end", and the boot path
    read that as done."""
    if job is None:
        return "none", "no post-therapy job on disk"
    if not isinstance(job, dict) or job.get("state") not in STATES:
        # A torn or foreign file. Re-queueing costs one card read; trusting it costs the night.
        return "requeue", "job record unreadable or has no known state — re-queueing rather than trusting it"
    if is_complete(job):
        return "none", (f"harvest completed for {job.get('job_id')} "
                        f"({job.get('files')} file(s)) — nothing owed")
    if job.get("state") == HARVEST_COMPLETED:
        return "requeue", "job claims completed with no completion stamp — malformed, re-queueing"
    return "requeue", (f"job {job.get('job_id')} is {job.get('state')} "
                       f"(attempt {job.get('retry_count') or 0}) — INTERRUPTED, not harvested")


def should_reconcile(job, now_ms: float, window_date=None) -> tuple[bool, str]:
    """May the daily window skip its expensive collection? `(needed, why)`.

    §6: the window becomes retry/reconciliation rather than the primary trigger — it runs the collection
    only when the job store says something is owed, and a job it cannot read is something owed.

    🔴 `since_ms` IS LOAD-BEARING AND ITS ABSENCE WAS A REAL DEFECT. A first version asked only "is there
    a completed job?", which is true forever after the first successful harvest — so the daily window
    would have skipped EVERY subsequent day, silently, destroying exactly the guarantee it exists to
    provide. Caught by `test_the_completion_hook_sees_every_outcome_including_the_error_path`, which
    reuses one directory across two runs and so replayed a yesterday-job against today's window.

    A completion only excuses the window it was stamped for. Pass the current window's date; a job
    carrying a different one (or none, from a build before this) is a previous night's answer and
    cannot speak for this one."""
    do, why = resume_action(job, now_ms)
    if do == "none" and job is not None:
        if window_date is not None and str(job.get("window_date")) != str(window_date):
            return True, (f"job {job.get('job_id')} answered window {job.get('window_date')!r}, "
                          f"not {str(window_date)!r} — a previous night does not excuse this one")
        return False, why
    return True, ("no job for the last therapy end — the window is the only trigger that saw it"
                  if job is None else why)
