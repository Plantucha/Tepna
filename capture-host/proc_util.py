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
    `mutation_diff.kill_process_group`."""
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0:
        return False
    try:
        pgid = os.getpgid(pid)
    except OSError:  # ProcessLookupError is a subclass: already gone and reaped
        return False
    return pgid == pid and pgid != os.getpgrp()


async def kill(proc) -> None:
    """Kill a child — and, when the child LEADS its own process group, every descendant in it — then reap.
    Never raises: teardown must not become a new failure mode.

    `proc.kill()` signals the direct child only, so a child that forks leaves the daemon's own orphans
    (`TOOL-BUILD-STANDARD` §2.3: SIGKILL to the parent must end "every worker, thread and child").
    A child that was spawned with `start_new_session=True` leads its own group, and then the whole group
    is signalled. A child that does NOT lead one is killed alone, exactly as before: signalling its
    "group" would be OUR group. So this is the helper half of the fix; it only reaches descendants for a
    caller that spawns in its own session.

    The reap is not optional. Without `await proc.wait()` the killed child stays a zombie in the
    process table for the daemon's lifetime — which for a unit that is `Restart=always` with no
    `RuntimeMaxSec` means months."""
    signalled_group = False
    if _leads_own_group(getattr(proc, "pid", None)):
        with contextlib.suppress(OSError):
            os.killpg(proc.pid, signal.SIGKILL)
            signalled_group = True
    if not signalled_group:  # not a leader, or the group signal was refused: the child alone, as before
        with contextlib.suppress(ProcessLookupError, OSError, ValueError):
            proc.kill()
    with contextlib.suppress(Exception):
        await asyncio.wait_for(proc.wait(), _REAP_S)
