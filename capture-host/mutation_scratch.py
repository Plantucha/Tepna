# tepna-capture — mutation_scratch.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Scratch-directory liveness for `tools/mutate` — residue `2026-09-24-mutate-prune-crosses-sessions`.

/tmp is SHARED. `mutate` globs `mut-<module>-*` to evict its own stale scratches (a necessary cache
eviction: one directory per module VERSION, on a tmpfs where a scratch is RAM — 153 orphans and
2.6 GB measured 2026-08-03). That glob also matched OTHER SESSIONS' live scratches, so two sessions
mutating one module deleted each other's work tree mid-run.

It sits at the root beside `mutation_diff` (which owns scratch REUSE) rather than inside
`tools/mutate.py`, following the `mutation_*.py` library / `tools/mutate_*.py` script split the rest
of this programme uses — and that placement is what puts it under the 100 % floor. `tools/` has no
`__init__.py`, so coverage never descends into it: `tools/mutate.py` is invisible to the floor until
a test imports it, and the first such import would drop a 246-statement audit tool (24 % covered)
under a gate it has never met. A small root module that IS fully covered keeps the floor honest."""

from __future__ import annotations

import os
import shutil
from pathlib import Path

HOLDER = ".mut-holder"
# Indirected so a test can drive the non-Linux arm; `/proc` is the liveness oracle everywhere else.
PROC = Path("/proc")


def _ticks_from_stat(data: bytes):
    """Field 22 (starttime) of a /proc/<pid>/stat line, or None if the line is short.

    Split from the read so its correctness is ASSERTABLE: the diff-scoped mutation gate on #3027
    showed five surviving mutants here — `rfind`→`find`, `+2`→`-2`, `>19`→`>=19`/`>20`, and an
    `or True` — every one of which returns a plausible WRONG string rather than raising. A wrong
    start time is worse than no start time: it makes two different processes compare equal, which is
    precisely the pid-reuse confusion this pairing exists to prevent. Tests that only check
    truthiness cannot see any of them, so this function takes bytes and is checked against a known
    answer.

    Field 2 (comm) is parenthesised and may itself contain spaces AND ')' — `(sh (weird) name)` is a
    legal comm — so the split point is the LAST ')', never the first, and the two fields before it
    are not in `tail`: starttime is field 22, i.e. index 19 of what follows."""
    tail = data[data.rfind(b")") + 2 :].split()
    return tail[19].decode() if len(tail) > 19 else None


def _proc_start_ticks(pid: int):
    """That pid's start time, or None if it is gone.

    A bare `pid alive?` check is wrong the first time the OS wraps a pid onto a new process, and it
    fails in the worst direction: it reports a dead holder as live, so a stale scratch is never
    reclaimed and /tmp — tmpfs, i.e. RAM on the capture host — fills instead. Pairing the pid with
    its start time makes the identity exact."""
    try:
        with open(f"/proc/{pid}/stat", "rb") as fh:
            data = fh.read()
    except OSError:
        return None
    return _ticks_from_stat(data)


def _claim(d: Path) -> None:
    """Mark this dir as held by THIS process."""
    try:
        d.mkdir(parents=True, exist_ok=True)
        (d / HOLDER).write_text(f"{os.getpid()} {_proc_start_ticks(os.getpid()) or ''}\n")
    except OSError:
        pass  # a scratch we cannot mark is still usable; it just prunes as stale later


def _holder_alive(d: Path) -> bool:
    """True only if a LIVE process holds this dir.

    Fails CLOSED on an unreadable or malformed marker — an unmarked dir predates this mechanism or
    was written by a crashed run, and treating it as live would reintroduce the unbounded /tmp growth
    the prune exists to stop (153 orphaned scratches, 2.6 GB, measured 2026-08-03). Fails OPEN on a
    /proc that does not exist at all (non-Linux), where liveness is unknowable and deleting another
    run's tree is the worse error."""
    if not PROC.is_dir():
        return True
    try:
        raw = (d / HOLDER).read_text().split()
    except OSError:
        return False
    if not raw:
        return False
    try:
        pid = int(raw[0])
    except ValueError:
        return False
    if pid == os.getpid():
        return True
    started = _proc_start_ticks(pid)
    if started is None:
        return False
    return len(raw) < 2 or raw[1] == started


def prune_stale_scratches(tmpdir: Path, stem: str, keep: Path):
    """Remove this module's scratches that NO LIVE RUN holds. Returns (pruned, left).

    Extracted from run_one so the concurrency case is testable without a mutmut pass: the defect it
    fixes only appears with two runs in flight, and a fix whose only proof requires a 20-minute
    mutation run is a fix nobody re-checks.

    `ignore_errors=True` is deliberate — an undeletable orphan (root-owned build output, a tree under
    a read-only parent) must not crash a mutation run that has nothing to do with it. But swallowing
    the error made the RETURN VALUE a claim rather than a fact: a dir that could not be removed was
    still reported as pruned. So the removal is CHECKED afterwards, and a survivor goes in `left`
    where it belongs. Absence of a crash is not evidence of a deletion."""
    pruned: list[str] = []
    left: list[str] = []
    for old_dir in sorted(Path(tmpdir).glob(f"mut-{stem}-*")):
        if old_dir == keep or not old_dir.is_dir():
            continue
        if _holder_alive(old_dir):
            left.append(old_dir.name)
            continue
        shutil.rmtree(old_dir, ignore_errors=True)
        (left if old_dir.exists() else pruned).append(old_dir.name)
    return pruned, left
