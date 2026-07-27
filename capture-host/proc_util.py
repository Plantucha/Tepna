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


async def kill(proc) -> None:
    """Kill a child and reap it. Never raises: teardown must not become a new failure mode.

    The reap is not optional. Without `await proc.wait()` the killed child stays a zombie in the
    process table for the daemon's lifetime — which for a unit that is `Restart=always` with no
    `RuntimeMaxSec` means months."""
    with contextlib.suppress(ProcessLookupError, OSError, ValueError):
        proc.kill()
    with contextlib.suppress(Exception):
        await asyncio.wait_for(proc.wait(), _REAP_S)
