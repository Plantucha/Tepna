# tepna-capture — tests/test_proc_util.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Bounded subprocess execution (CAPTURE-HOST-DEEP-AUDIT §E1).

`await asyncio.wait_for(proc.communicate(), t)` cancels the AWAIT, not the PROCESS. Five wrappers had
that shape and all five returned a tidy timeout value while leaving the child running — holding its
pipes, its descriptors and whatever privilege it was given.

These tests assert on the CHILD, not on the return value. A test that only checked "returns 124 after
1 s" passes against the broken code, which is precisely why the defect survived five copies.
"""
import asyncio
import os
import signal

import pytest

import proc_util


def _run(coro):
    return asyncio.run(coro)


async def _sleeper(seconds=30):
    return await asyncio.create_subprocess_exec(
        "sleep", str(seconds),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)


def _alive(pid: int) -> bool:
    """True while the process exists AND has not been reaped. A zombie still 'exists' for signal 0, so
    this deliberately reads its state — leaving zombies is the half-fix `kill()` without `wait()` gives."""
    try:
        with open(f"/proc/{pid}/stat") as fh:
            return fh.read().split(") ", 1)[1].split()[0] != "Z"
    except (FileNotFoundError, ProcessLookupError, IndexError):
        return False


def test_a_timed_out_child_is_killed_not_abandoned():
    """THE §E1 regression. The caller's timeout branch is unchanged — what changes is that the child
    does not outlive it."""
    async def go():
        p = await _sleeper()
        pid = p.pid
        with pytest.raises(asyncio.TimeoutError):
            await proc_util.communicate(p, 0.2)
        return pid
    pid = _run(go())
    assert not _alive(pid), f"pid {pid} survived its own timeout"


def test_a_timed_out_child_is_also_REAPED():
    """kill() alone leaves a zombie in the process table for the daemon's lifetime — which under
    `Restart=always` with no `RuntimeMaxSec` means months. `bonding._btctl` was the one sibling that
    already killed, and it did not reap."""
    async def go():
        p = await _sleeper()
        with pytest.raises(asyncio.TimeoutError):
            await proc_util.communicate(p, 0.2)
        assert p.returncode is not None, "the child must have been reaped, not merely signalled"
        return p.pid
    pid = _run(go())
    with open(f"/proc/{pid}/stat", "rb") if os.path.exists(f"/proc/{pid}") else open(os.devnull, "rb") as fh:
        raw = fh.read().decode(errors="replace")
    assert "Z" not in (raw.split(") ", 1)[1].split()[0] if ") " in raw else ""), "left a zombie"


def test_a_command_that_finishes_in_time_is_untouched():
    """The control: the common path must not have gained a kill."""
    async def go():
        p = await asyncio.create_subprocess_exec(
            "echo", "hello", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        out, _ = await proc_util.communicate(p, 5.0)
        return p.returncode, out
    rc, out = _run(go())
    assert rc == 0 and out.strip() == b"hello"


def test_stdin_is_still_delivered():
    """`bonding._btctl` feeds a script on stdin — the helper must carry it, or every bond breaks."""
    async def go():
        p = await asyncio.create_subprocess_exec(
            "cat", stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        out, _ = await proc_util.communicate(p, 5.0, b"scan on\n")
        return out
    assert _run(go()).strip() == b"scan on"


def test_kill_never_raises_on_an_already_dead_child():
    """Teardown must not become a new failure mode."""
    async def go():
        p = await asyncio.create_subprocess_exec("true")
        await p.wait()
        await proc_util.kill(p)        # already exited and reaped
        await proc_util.kill(p)        # and again
    _run(go())


def test_every_bounded_wrapper_routes_through_the_helper():
    """The CLASS. Five modules had the same broken shape and one (`bonding`) had the fix, which is how
    it survived: nothing tied them together. Adding a sixth naked `wait_for(...communicate())` puts the
    leak straight back, so it is refused here."""
    import glob
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    offenders = []
    for f in glob.glob(os.path.join(here, "*.py")):
        if os.path.basename(f) == "proc_util.py":
            continue
        body = open(f, encoding="utf-8").read()
        if "wait_for(" in body and ".communicate(" in body:
            for line in body.splitlines():
                if "wait_for(" in line and ".communicate(" in line:
                    offenders.append(f"{os.path.basename(f)}: {line.strip()}")
    assert not offenders, (
        "these bound the await but not the process — use proc_util.communicate():\n  "
        + "\n  ".join(offenders))
