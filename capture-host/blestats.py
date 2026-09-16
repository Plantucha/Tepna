# tepna-capture — blestats.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""BLE operation counters — the DENOMINATOR, not just the failures.

BLE-TRANSPORT-REDESIGN §1.5/§1.6. Establishing #2170's rate required recovering the denominator from a
startup line that happened to state `poll 30.0s`, because the shadow poll logged only FAILURES. A
failure log without a denominator is not a rate, and the entire question was a rate. Then when the fix
landed, "zero failures" was equally meaningless — zero over an unknown number of attempts.

§1.6 is the same defect wearing a success message: #2365's retry absorbed 97 of 98 failures, which is
excellent for the capture and is exactly what let the underlying fault run ~98x/night behind a warning
nobody had to read. A recovery that hides its own frequency is a defect with a success message
attached.

TWO RULES, and they are the whole module:

  1. §∅ — A RATE OVER ZERO ATTEMPTS IS `None`. Not 1.0 ("nothing failed"), not 0.0 ("nothing
     succeeded"). Both are fabrications of a measurement that was never taken, and both are what a
     naive `successes / max(attempts, 1)` produces. A counter reading 0 is a MEASURED zero — we looked
     and saw no attempts; a rate computed from it is an ABSENCE.

  2. COUNTING MUST NEVER BREAK CAPTURE. Every public entry point is exception-safe. A telemetry defect
     that takes down a night's recording is worse than the blindness it was added to fix.
"""
from __future__ import annotations

import threading

# RLock, not Lock: `snapshot()` calls the public accessors rather than re-deriving their rules, and
# each of those takes the lock too. Re-deriving would put the §∅ rate rule in two places, which is how
# one copy gets the `n <= 0` guard and the other gets `max(n, 1)`.
_LOCK = threading.RLock()

# (op, device) -> int
_ATTEMPTS: dict[tuple[str, str], int] = {}
_SUCCESSES: dict[tuple[str, str], int] = {}
# (op, device, cls) -> int
_FAILURES: dict[tuple[str, str, str], int] = {}
# (device, why) -> int
_RETRIES: dict[tuple[str, str], int] = {}


def _bump(store: dict, key: tuple) -> None:
    with _LOCK:
        store[key] = store.get(key, 0) + 1


def attempt(op: str, device: str) -> None:
    """Called BEFORE the operation can fail. This is the denominator; if it is not incremented first,
    a crash between the call and the failure silently shrinks it and inflates every rate built on it."""
    try:
        _bump(_ATTEMPTS, (str(op), str(device)))
    except Exception:  # noqa: BLE001 - rule 2: never break capture
        pass


def ok(op: str, device: str) -> None:
    try:
        _bump(_SUCCESSES, (str(op), str(device)))
    except Exception:  # noqa: BLE001
        pass


def fail(op: str, device: str, cls: str) -> None:
    """`cls` is the failure CLASS (timeout, not_found, in_progress, ...), never a formatted message —
    a message carries the instance and cannot be counted across instances."""
    try:
        _bump(_FAILURES, (str(op), str(device), str(cls)))
    except Exception:  # noqa: BLE001
        pass


def retried(device: str, why: str) -> None:
    """§1.6: a retry is an event with a cause. A rising retry rate is itself the alert, which is only
    possible if the retry is counted rather than merely logged."""
    try:
        _bump(_RETRIES, (str(device), str(why)))
    except Exception:  # noqa: BLE001
        pass


def attempts(op: str, device: str) -> int:
    with _LOCK:
        return _ATTEMPTS.get((op, device), 0)


def successes(op: str, device: str) -> int:
    with _LOCK:
        return _SUCCESSES.get((op, device), 0)


def failures(op: str, device: str) -> dict[str, int]:
    with _LOCK:
        return {k[2]: v for k, v in _FAILURES.items() if k[0] == op and k[1] == device}


def retries(device: str) -> dict[str, int]:
    with _LOCK:
        return {k[1]: v for k, v in _RETRIES.items() if k[0] == device}


def success_rate(op: str, device: str) -> float | None:
    """§∅. `None` when nothing was attempted — NEVER 1.0 and never 0.0.

    This is the one function the module exists for. `successes / max(attempts, 1)` is the idiom that
    looks harmless and reports a perfect 1.0 success rate for a device that was never contacted, which
    is precisely the "zero failures over an unknown denominator" that made #2170 unanswerable."""
    with _LOCK:
        n = _ATTEMPTS.get((op, device), 0)
        if n <= 0:
            return None
        return _SUCCESSES.get((op, device), 0) / n


def snapshot() -> dict:
    """A reportable view. Rates are `None` where undetermined; counts are always integers, because a
    count of 0 IS a measurement while a rate over 0 is not."""
    with _LOCK:
        keys = set(_ATTEMPTS) | set(_SUCCESSES)
        ops = {}
        for op, dev in sorted(keys):
            ops[f"{op}/{dev}"] = {
                "attempts": attempts(op, dev),
                "successes": successes(op, dev),
                "rate": success_rate(op, dev),      # the ONE place the §∅ rule lives
                "failures": failures(op, dev),
            }
        return {"ops": ops, "retries": {d: retries(d) for d in sorted({k[0] for k in _RETRIES})}}


def reset() -> None:
    """Tests only. Production never resets: a counter that restarts cannot show a rising rate."""
    with _LOCK:
        _ATTEMPTS.clear()
        _SUCCESSES.clear()
        _FAILURES.clear()
        _RETRIES.clear()
