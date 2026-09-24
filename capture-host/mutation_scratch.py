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


def _proc_start_ticks(pid: int):
    """That pid's start time, or None if it is gone. Field 22 of /proc/<pid>/stat.

    A bare `pid alive?` check is wrong the first time the OS wraps a pid onto a new process, and it
    fails in the worst direction: it reports a dead holder as live, so a stale scratch is never
    reclaimed and /tmp — tmpfs, i.e. RAM on the capture host — fills instead. Pairing the pid with
    its start time makes the identity exact."""
    try:
        with open(f"/proc/{pid}/stat", "rb") as fh:
            data = fh.read()
    except OSError:
        return None
    # comm is field 2 and may contain spaces or ')'; everything after the LAST ')' is positional.
    tail = data[data.rfind(b")") + 2:].split()
    return tail[19].decode() if len(tail) > 19 else None


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
    mutation run is a fix nobody re-checks."""
    pruned, left = [], []
    for old_dir in sorted(Path(tmpdir).glob(f"mut-{stem}-*")):
        if old_dir == keep or not old_dir.is_dir():
            continue
        if _holder_alive(old_dir):
            left.append(old_dir.name)
            continue
        pruned.append(old_dir.name)
        shutil.rmtree(old_dir, ignore_errors=True)
    return pruned, left


