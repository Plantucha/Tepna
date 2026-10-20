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
        # ⚠️ `_FAILURES` IS IN THIS UNION AND ITS ABSENCE WAS A SILENT DROP (2026-09-19).
        # The key set used to be `_ATTEMPTS | _SUCCESSES` alone. `attempt()` has exactly ONE call site
        # and it is `"connect"`, so the two ops that only ever call `fail()` — `link` (capture.py's
        # link-error site) and `offline_op` (the offline-pull timeout) — appeared in NEITHER dict and
        # were therefore UNPUBLISHABLE BY CONSTRUCTION. Their counts incremented and stopped there.
        #
        # That is this module's own stated defect wearing the opposite face. Both call sites assert the
        # publication in their comments — "the total is in `status.json` `ble` where a rate can be read
        # off it", "the rate rides in `status.json` as `ble` and is the thing an operator should
        # actually watch", "the total is never lost" — and BOTH USED THAT ASSERTION TO JUSTIFY
        # QUIETENING THEIR LOGS to first-occurrence-plus-decades. So the frequency was hidden in the
        # log on the strength of a report it never reached, which is precisely the "recovery that hides
        # its own frequency" this module was written to end.
        #
        # Measured on vigil before the fix: `ble.ops` carried three `connect/…` keys and NO `link/` or
        # `offline_op/` key, against 445 link-error occurrence lines and 887 offline_op lines in the
        # same 72 h of journal.
        #
        # §∅ is honoured rather than bent by this: a failures-only op now publishes its COUNTS (a count
        # of 0 is a measurement) with `rate: None`, because it has no denominator and inventing one
        # would be the fabrication the rule forbids. `None` here reads "nobody counted the attempts",
        # which is the true statement.
        keys = set(_ATTEMPTS) | set(_SUCCESSES) | {(op, dev) for op, dev, _cls in _FAILURES}
        ops = {}
        for op, dev in sorted(keys):
            ops[f"{op}/{dev}"] = {
                "attempts": attempts(op, dev),
                "successes": successes(op, dev),
                "rate": success_rate(op, dev),  # the ONE place the §∅ rule lives
                "failures": failures(op, dev),
            }
        return {"ops": ops, "retries": {d: retries(d) for d in sorted({k[0] for k in _RETRIES})}}


# ── §1.6 THE SERIES, and why a cumulative count cannot be one ───────────────────────────────────────
# `snapshot()` is a LEVEL. `status.json` is rewritten every tick, so it answers "what is it now" and
# never "how did it get there", and §1.6's done-when needs the second question answered: a rising retry
# rate is the alert, and a rise is a shape over time. The journal is the only surface on this box that
# keeps a series, which is the same reading that put `mem: VmRSS …` on a line (`mem_log_line`).
#
# ⚠️ A CUMULATIVE COUNT DRAWN AS A SERIES READS A DEPLOY AS A RECOVERY. These counters never fall
# inside one process — `reset()` is tests-only, deliberately — but `tepna-capture` restarts on every
# deploy (measured 2026-09-15: 4 stop/starts in 6 h), so a line carrying the running total steps back
# to a small number at each deploy and a reader sees the problem go away. The line therefore carries
# the DELTA SINCE THE PREVIOUS LINE, which is the correction `mem_log_line` already applies to VmHWM
# for the same reason: *"VmHWM is the peak since the PROCESS started, and the daemon restarts at every
# deploy"*.
#
# §∅ decides the first line of a process: it has NO previous line, so every delta on it is `null` with
# a reason, never 0. A 0 there is a measured "nothing happened" over an interval nobody watched.
#
# ⚠️ AN ABSENT KEY IS NOT AN ABSENT BASELINE, and the two look alike. An op missing from the previous
# line had a baseline of EXACTLY ZERO, because a key appears in these dicts on its first bump — so its
# delta is its whole current count, measured. Only a missing previous LINE is an absence. Collapsing
# the two would null out every op that started during the interval, which is every op that matters.
FIRST_LINE = "no previous line this process"


def _delta(cur: int, prev: dict | None, key: str) -> int | None:
    """One figure's increment, or `None` when there is no previous line to measure against."""
    if prev is None:
        return None
    # A TALLY, per the house rule's own reason: these keys appear on their first bump, so a key the
    # previous line omits was counted exactly zero times and the default IS the measurement. The
    # absence this function reports is the absent LINE above, not an absent key (see the block above).
    return cur - int(prev.get(key, 0))


def deltas(snap: dict, prev: dict | None) -> dict:
    """PURE: the per-op and per-retry increments between two `snapshot()` results.

    Every figure is `None` when `prev` is `None`, and measured otherwise — including for an op the
    previous snapshot does not name, whose baseline is zero by construction (see the note above).

    THE TOP-LEVEL KEYS ARE INDEXED, NOT `.get`-ed, for the reason `log_line` already states about
    `rate` and `window_sec`: `snapshot()` writes `ops`, `retries` and a per-op `failures` on every
    call unconditionally, and `prev` is only ever a `snapshot()` result (`capture.py` seeds it `None`
    and then assigns the snapshot it just logged). A `{}` default on those five reads was a branch no
    caller could reach, so no test could observe it — measured 2026-10-20 as 10 surviving mutants
    under `mutation (diff-scoped)`, every one of them that default turning into `None`. Indexing
    turns a producer that ever drops a key into a `KeyError` here instead of a silently empty
    series. The `.get` calls that REMAIN are the reachable ones: an op or device the previous
    snapshot does not name, whose baseline is zero by construction."""
    ops = {}
    for key, cur in snap["ops"].items():
        base = None if prev is None else prev["ops"].get(key, {})
        fbase = None if base is None else base.get("failures", {})
        ops[key] = {
            "attempts": _delta(cur["attempts"], base, "attempts"),
            "successes": _delta(cur["successes"], base, "successes"),
            "failures": {c: _delta(n, fbase, c) for c, n in cur["failures"].items()},
        }
    retries = {}
    for dev, whys in snap["retries"].items():
        base = None if prev is None else prev["retries"].get(dev, {})
        retries[dev] = {w: _delta(n, base, w) for w, n in whys.items()}
    return {"ops": ops, "retries": retries}


def _n(v: object) -> str:
    return "null" if v is None else str(v)


def log_line(snap: dict, prev: dict | None = None, rates: dict | None = None) -> str:
    """One journal line: the increments since the previous line, then the windowed backoff rate.

    THE TOTALS ARE NOT HERE. They are in `status.json` as `ble`, which is the level; repeating them on
    the line would put the figure that resets at every deploy back into the surface that keeps the
    series. `rates` is `retry_rate_report`'s mapping — a measured attempts/hour per device, or `null`
    with its own reason while the trailing window is not yet covered by observation."""
    d = deltas(snap, prev)
    segs = []
    for key, inc in sorted(d["ops"].items()):
        fails = ",".join(f"{c}={_n(n)}" for c, n in sorted(inc["failures"].items()))
        seg = f"{key} {_n(inc['successes'])}/{_n(inc['attempts'])}"
        segs.append(f"{seg} fail {fails}" if fails else seg)
    for dev, whys in sorted(d["retries"].items()):
        segs.append(f"retries {dev} " + ",".join(f"{w}={_n(n)}" for w, n in sorted(whys.items())))
    # `rate` and `window_sec` are indexed, not `.get`-ed: every entry comes from `retry_rate_report`,
    # which writes both on every device it reports. A `.get` default here would add a branch no caller
    # can reach and would quietly print a line missing the window the rate is quoted over.
    for dev, r in sorted((rates or {}).items()):
        rate = r["rate"]
        segs.append(
            f"backoff rate {dev} {'null' if rate is None else f'{rate:.1f}'}/h over {r['window_sec'] / 60.0:.0f} min"
        )
    line = "ble: since last line " + (" · ".join(segs) if segs else "nothing counted yet")
    reasons = [] if prev is not None else [FIRST_LINE]
    reasons += [r["reason"] for _d, r in sorted((rates or {}).items()) if r["reason"]]
    for reason in reasons:
        line += f" · {reason}"
    return line


def reset() -> None:
    """Tests only. Production never resets: a counter that restarts cannot show a rising rate."""
    with _LOCK:
        _ATTEMPTS.clear()
        _SUCCESSES.clear()
        _FAILURES.clear()
        _RETRIES.clear()
