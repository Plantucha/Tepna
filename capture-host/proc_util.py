# tepna-capture — proc_util.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# ONE bounded-subprocess primitive, because there were five and none of them worked.
#
# `await asyncio.wait_for(proc.communicate(), t)` cancels the AWAIT, not the PROCESS
# (CAPTURE-HOST-DEEP-AUDIT §E1). On expiry the caller gets its TimeoutError and returns a tidy
# 124/None, while the child keeps running — holding its pipes, its file descriptors and whatever
# privilege it was given. Measured across the five wrappers that had it:
#
#   link_rssi._run       returned None       after 1.00s ; live children: {'1354774': 'S'}
#   host_clock._run      returned (127, '')  after 1.00s ; live children: {..., '1354801': 'S'}
#   storage_targets._run returned (124, ...) after 1.00s ; live children: 4
#
# `bonding._btctl` was the only sibling that already called `proc.kill()` — the fix and the proof that
# it was known. It is now here, once, so the five cannot drift apart again.
#
# Exposure is real but modest, and the audit's "~576 orphans/h" figure does NOT hold: `rssi_poller`
# calls `read_rssi` only for devices STATUS reports as connected, so on a wedged radio it skips
# entirely, and after three misses it backs off to 600 s. The defect is the leak, not the rate.
from __future__ import annotations

import asyncio
import contextlib
import os
import signal

# How long to wait for a killed child to actually die before giving up on reaping it. SIGKILL is not
# refusable, but a process in uninterruptible sleep (a hung USB/BLE ioctl — precisely what these
# wrappers time out on) can outlive it, and blocking the event loop on that would recreate the very
# stall the timeout exists to prevent.
_REAP_S = 2.0

# How long the GROUP gets after SIGTERM before SIGKILL. A capture child that leads its own session is
# the one case here with a tail to flush, and the Muse recorder's own ladder already spent its SIGINT
# grace upstream, so this is short on purpose.
_GROUP_GRACE_S = 1.0


def _killpg(pgid, sig: int) -> None:
    """`os.killpg`, never raising, and NEVER our own process group.

    🔴 THIS IS THE SECOND OF TWO INDEPENDENT GUARDS, AND IT IS WHY THESE FUNCTIONS ARE
    MUTATION-TESTABLE AT ALL. A mutant that signals the process group judging it cannot be killed BY
    that runner: measured on `mutation_diff.kill_process_group` in #3237, a single inverted clause made
    the gate `killpg` its own group, the mutmut counter stopped at mutant 7 of 30, and the remaining 23
    came back `not_checked` — unmeasured, which `mutate_diff` refuses. With a guard here AND in each
    caller, no single mutation can reach `os.killpg` with our own group: inverting either clause leaves
    the other blocking.

    A pgid of 0 is not "no pgid" — `os.killpg(0, sig)` addresses the CALLER's group, so a 0 arriving
    from a half-built double or a mutated flag must fail safe here. `bool` is excluded because
    `isinstance(True, int)` is true. A group that died between the check and the signal is the normal
    case, so the raise is suppressed rather than reported."""
    if isinstance(pgid, bool) or not isinstance(pgid, int) or pgid <= 0 or pgid == os.getpgrp():
        return
    with contextlib.suppress(ProcessLookupError, PermissionError, OSError):
        os.killpg(pgid, sig)


def sweep_group(pgid) -> bool:
    """SIGKILL a process group started with `start_new_session=True`, AFTER its leader is reaped.

    A leader that exits CLEANLY orphans its helpers just as surely as one that is killed, and once the
    leader is reaped `os.getpgid` can no longer say which group to sweep — so the caller keeps the
    pgid, which for a session leader IS the child's pid. The group stays signallable while any member
    lives, and an empty group raises `ProcessLookupError`, which `_killpg` swallows.

    Returns whether the signal was ATTEMPTED, which is what a caller can honestly log: a `True` here
    says the group was addressed, never that anything was in it.
    """
    if isinstance(pgid, bool) or not isinstance(pgid, int) or pgid <= 0 or pgid == os.getpgrp():
        return False
    _killpg(pgid, signal.SIGKILL)
    return True


async def communicate(proc, timeout: float, stdin: bytes | None = None) -> tuple[bytes, bytes]:
    """`proc.communicate(stdin)` bounded by `timeout`, KILLING and REAPING the child on expiry.

    Re-raises `asyncio.TimeoutError` so every existing caller's timeout branch still runs unchanged —
    this fixes what happens to the CHILD, not what the caller reports."""
    try:
        return await asyncio.wait_for(proc.communicate(stdin), timeout)
    except asyncio.TimeoutError:
        await kill(proc)
        raise


def _leads_own_group(pid) -> bool:
    """True only when `pid` is a REAL, POSITIVE pid that LEADS a process group which is not ours.

    `os.killpg` on a child started WITHOUT `start_new_session=True` reaches the group it was born into,
    which is the daemon's own — so the group is signalled only when the child leads one. A pid of 0 is
    not "no pid": `os.killpg(0, sig)` addresses the CALLER's group, so it is refused here outright (a
    double or a half-built proc object must fail safe, not reap the daemon). Same guard, same reason, as
    `mutation_diff.kill_process_group`.

    `bool` is excluded because `isinstance(True, int)` is true and `os.getpgid(True)` reads pid 1.
    Measured 2026-10-12 while reproducing the row: a child spawned without `start_new_session=True`
    reported a pgid equal to this process's own, so a `killpg` there would have signalled the daemon,
    every sibling task's child, and the test runner."""
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0:
        return False
    try:
        pgid = os.getpgid(pid)
    except OSError:  # ProcessLookupError is a subclass: already gone and reaped
        return False
    return pgid == pid and pgid != os.getpgrp()


async def kill(proc) -> None:
    """Kill a child, its descendants where it leads a group, and reap it. Never raises: teardown must
    not become a new failure mode.

    🔴 WHY THE GROUP AND NOT JUST THE CHILD. `proc.kill()` signals the direct child alone, so a child
    that forks leaves the daemon's own orphans — `TOOL-BUILD-STANDARD` §2.3 requires SIGKILL to the
    parent to end "every worker, thread and child". Measured 2026-10-12 with a two-level plant: the
    child died, the grandchild was still alive a second later, and it held the pipe it inherited.

    The reap is not optional. Without `await proc.wait()` the killed child stays a zombie in the
    process table for the daemon's lifetime — which for a unit that is `Restart=always` with no
    `RuntimeMaxSec` means months.

    ⚠️ THE UPWARD DIRECTION IS NOT THIS FUNCTION'S, AND HERE IT IS ALREADY COVERED. Putting a child in
    its own session takes it OUT of the parent's process group, so a kill from ABOVE that swept the
    group now misses it. `deploy/tepna-capture.service` sets no `KillMode`, so systemd's default
    `control-group` applies and a stop, restart or watchdog kill reaps the whole cgroup regardless of
    process groups. A caller that is NOT under such a unit owes its own pass-through handler.
    """
    pid = getattr(proc, "pid", None)
    lead = _leads_own_group(pid)
    if lead:
        # SIGTERM to the group first, so a child with a tail to flush can write it. The grace is short
        # because every caller here has already spent its own.
        _killpg(pid, signal.SIGTERM)
        with contextlib.suppress(Exception):
            await asyncio.wait_for(proc.wait(), _GROUP_GRACE_S)
    if getattr(proc, "returncode", None) is None:
        with contextlib.suppress(ProcessLookupError, OSError, ValueError):
            proc.kill()
    with contextlib.suppress(Exception):
        await asyncio.wait_for(proc.wait(), _REAP_S)
    if lead:
        # AFTER the reap, because a descendant can outlive the leader. SIGKILL is unrefusable and a
        # group whose last member is gone raises ProcessLookupError, which `_killpg` swallows.
        _killpg(pid, signal.SIGKILL)
