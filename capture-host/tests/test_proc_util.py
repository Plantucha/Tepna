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
import sys
import time

import pytest

import proc_util


def _run(coro):
    return asyncio.run(coro)


async def _sleeper(seconds=30):
    return await asyncio.create_subprocess_exec(
        "sleep", str(seconds), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
    )


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
            "echo", "hello", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
        )
        out, _ = await proc_util.communicate(p, 5.0)
        return p.returncode, out

    rc, out = _run(go())
    assert rc == 0 and out.strip() == b"hello"


def test_stdin_is_still_delivered():
    """`bonding._btctl` feeds a script on stdin — the helper must carry it, or every bond breaks."""

    async def go():
        p = await asyncio.create_subprocess_exec(
            "cat", stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
        )
        out, _ = await proc_util.communicate(p, 5.0, b"scan on\n")
        return out

    assert _run(go()).strip() == b"scan on"


def test_kill_never_raises_on_an_already_dead_child():
    """Teardown must not become a new failure mode."""

    async def go():
        p = await asyncio.create_subprocess_exec("true")
        await p.wait()
        await proc_util.kill(p)  # already exited and reaped
        await proc_util.kill(p)  # and again

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
    assert not offenders, "these bound the await but not the process — use proc_util.communicate():\n  " + "\n  ".join(
        offenders
    )


# ── kill(): what it suppresses, and that the reap is not optional ───────────────────────────────────
def test_kill_reaps_and_never_raises_whatever_the_child_does():
    """Three exception types are suppressed around `proc.kill()` and each is a real state:
    ProcessLookupError (already exited between the check and the signal), OSError (the transport is
    gone), ValueError (asyncio's own guard on a closed transport). Narrowing that tuple turns a
    teardown into a NEW failure mode, which is exactly what the docstring forbids.

    And the reap is separate and mandatory: without `await proc.wait()` the killed child stays a
    zombie for the daemon's lifetime — for a unit that is Restart=always with no RuntimeMaxSec, months.
    """
    for exc in (ProcessLookupError(), OSError("gone"), ValueError("closed transport")):
        reaped = []

        class P:
            def kill(self_inner):
                raise exc

            async def wait(self_inner):
                reaped.append(True)
                return 0

        asyncio.run(proc_util.kill(P()))
        assert reaped == [True], f"a {type(exc).__name__} from kill() must not skip the reap"


def test_kill_bounds_the_reap_rather_than_waiting_forever():
    """`wait_for(proc.wait(), _REAP_S)`. A child that ignores SIGKILL — uninterruptible in D-state on a
    stuck USB/BLE transport — would otherwise park the teardown forever. The timeout is swallowed by
    design: at that point the process is the kernel's problem, not the daemon's."""
    seen = {}

    class P:
        def kill(self):
            seen["killed"] = True

        async def wait(self):
            await asyncio.sleep(3600)  # never returns

    async def go():
        await asyncio.wait_for(proc_util.kill(P()), timeout=5)

    asyncio.run(go())
    assert seen["killed"] is True, "the signal is sent even though the reap times out"


def test_kill_reaps_a_cooperative_child_without_error():
    order = []

    class P:
        def kill(self):
            order.append("kill")

        async def wait(self):
            order.append("wait")
            return -9

    asyncio.run(proc_util.kill(P()))
    assert order == ["kill", "wait"], "signal first, then reap — reversing it waits on a live child"


# ── the GROUP: descendants, and the one group that must never be signalled ──────────────────────────
# `2026-09-29-proc-util-kill-is-parent-only`. Reproduced 2026-10-12 before the fix: a child spawned
# with `start_new_session=True` that forks a grandchild left `child_alive=False grandchild_alive=True`
# after `proc_util.kill`, and the grandchild held the pipe it had inherited.
_FORK_THEN_WAIT = (
    "import subprocess,sys,time;"
    "g=subprocess.Popen(['sleep','60']);"
    "sys.stdout.write(str(g.pid)+chr(10));sys.stdout.flush();"
    "time.sleep(60)"
)
# The clean-exit case reports through a FILE, not a pipe: the orphan inherits the pipe, and asyncio's
# `proc.wait()` does not complete until every pipe is closed — so a piped version of this test hangs on
# the very descendant it is about. That hang is the defect wearing a different hat.
_FORK_THEN_EXIT = "import subprocess,sys;g=subprocess.Popen(['sleep','60']);open(sys.argv[1],'w').write(str(g.pid))"


async def _leader_with_a_grandchild(ignore_sigterm=False):
    """A child in a session of its OWN that forks one level deeper, reporting the grandchild's pid."""
    pre = "import signal;signal.signal(signal.SIGTERM,signal.SIG_IGN);" if ignore_sigterm else ""
    p = await asyncio.create_subprocess_exec(
        sys.executable,
        "-c",
        pre + _FORK_THEN_WAIT,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        start_new_session=True,
    )
    line = await asyncio.wait_for(p.stdout.readline(), 10)
    return p, int(line.strip())


def _dies_within(pid: int, seconds: float = 5.0) -> bool:
    """A descendant is re-parented to init and reaped asynchronously, so the death is polled, not read
    once. The poll is what distinguishes "killed" from "killed and not yet reaped"."""
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if not _alive(pid):
            return True
        time.sleep(0.05)
    return False


def test_kill_ends_the_GRANDCHILD_not_only_the_child():
    """THE ROW. `proc.kill()` signals the direct child alone; `TOOL-BUILD-STANDARD` §2.3 requires the
    SIGKILL to end "every worker, thread and child". The assertion is on the GRANDCHILD, because the
    child died under the old code too — which is how the leak read as a working teardown."""

    async def go():
        p, gpid = await _leader_with_a_grandchild()
        await proc_util.kill(p)
        return p.pid, gpid, p.returncode

    pid, gpid, rc = _run(go())
    assert rc is not None, "the leader must be reaped, not merely signalled"
    assert _dies_within(pid), f"leader {pid} survived"
    assert _dies_within(gpid), f"grandchild {gpid} survived — the group was not signalled"


def test_kill_of_a_leader_that_IGNORES_SIGTERM_still_ends_the_group():
    """The escalation. The group gets SIGTERM and `_GROUP_GRACE_S`; a leader that ignores it is killed
    directly, reaped, and the group is SIGKILLed AFTER the reap — a descendant can outlive its leader,
    so a sweep that ran before the reap would miss exactly the process this row is about."""

    async def go():
        p, gpid = await _leader_with_a_grandchild(ignore_sigterm=True)
        await proc_util.kill(p)
        return p.pid, gpid, p.returncode

    pid, gpid, rc = _run(go())
    assert rc is not None and _dies_within(pid), "a SIGTERM-ignoring leader must still be killed"
    assert _dies_within(gpid), f"grandchild {gpid} outlived a leader that ignored SIGTERM"


def test_kill_bounds_the_GROUP_GRACE_rather_than_waiting_forever(monkeypatch):
    """`wait_for(proc.wait(), _GROUP_GRACE_S)`. The grace lets a leader with a tail to flush write it,
    and a leader that never exits must not hold the teardown open for the daemon's lifetime.

    🔴 THIS BOUND IS INVISIBLE TO EVERY OTHER TEST HERE, AND THE REASON IS THE INHERITED PIPE. A real
    leader's grandchild holds the pipe it inherited, so `proc.wait()` returns in neither the grace nor
    the reap, and an unbounded grace HANGS the suite rather than failing it. Measured 2026-10-12:
    dropping the bound left mutmut's one UNDECIDED mutant on this function — a timeout, which
    `mutate_diff` refuses, because a mutant no test ever observed is not a killed mutant. Bounding the
    CALL in the test turns that hang into a failure in seconds.
    """
    sent = []
    monkeypatch.setattr(proc_util, "_group_leader", lambda pid: True)
    monkeypatch.setattr(proc_util, "_killpg", lambda pgid, sig: sent.append(sig))
    # Shrunk so the PASSING path costs milliseconds. The mutant reads no constant at all, so this
    # cannot flatter it: it still waits forever and the outer bound is what fails.
    monkeypatch.setattr(proc_util, "_GROUP_GRACE_S", 0.02)
    monkeypatch.setattr(proc_util, "_REAP_S", 0.02)

    class P:
        pid = 4242
        returncode = None

        def kill(self):
            sent.append("kill")

        async def wait(self):
            await asyncio.sleep(3600)  # a leader that exits for neither signal

    async def go():
        await asyncio.wait_for(proc_util.kill(P()), timeout=2)

    asyncio.run(go())
    assert sent == [signal.SIGTERM, "kill", signal.SIGKILL], (
        f"the ladder is SIGTERM to the group, the child, then SIGKILL to the group after the reap: {sent}"
    )


def test_a_child_in_OUR_OWN_group_is_killed_ALONE():
    """🔴 THE WORST FAILURE MODE OF A GROUP KILL IS KILLING YOUR OWN GROUP. A child spawned WITHOUT
    `start_new_session=True` shares our pgid — measured 2026-10-12: `child pgid=2939605 our
    pgid=2939605 leader=False`. Signalling that group would reach the daemon, every sibling task's
    child and this test runner. So the sibling below must still be alive afterwards, and the child
    must take the single-process path unchanged."""

    async def go():
        sibling = await _sleeper()
        target = await _sleeper()
        leads = proc_util._group_leader(target.pid)
        await proc_util.kill(target)
        return sibling, target.pid, sibling.pid, leads

    async def go2():
        sibling, tpid, spid, leads = await go()
        alive = _alive(spid)
        await proc_util.kill(sibling)  # tidy up: it was only ever the control
        return tpid, spid, leads, alive

    tpid, spid, leads, sibling_alive = _run(go2())
    assert leads is False, "a child in our own group does not lead one"
    assert sibling_alive, f"sibling {spid} was killed — the signal reached OUR group"
    assert _dies_within(tpid), f"the target {tpid} itself must still be killed"


def test_sweep_group_kills_the_orphan_a_CLEAN_exit_left_behind(tmp_path):
    """A leader that exits 0 orphans its helpers just as surely as one that is killed, and after the
    reap `os.getpgid` can no longer name the group — which is why the caller keeps the pgid and the
    sweep runs however the child went. In the Muse case the orphan holds the headset's BLE link, so
    the next daemon start cannot connect."""
    pidfile = tmp_path / "grandchild.pid"

    async def go():
        p = await asyncio.create_subprocess_exec(
            sys.executable, "-c", _FORK_THEN_EXIT, str(pidfile), start_new_session=True
        )
        await asyncio.wait_for(p.wait(), 20)
        assert p.returncode == 0, "the leader is meant to exit cleanly here"
        return p.pid

    pid = _run(go())
    gpid = int(pidfile.read_text())
    assert _alive(gpid), "the orphan is the premise of this test"
    assert proc_util.sweep_group(pid) is True, "sweep_group reports that it addressed the group"
    assert _dies_within(gpid), f"orphan {gpid} survived the sweep"


def test_sweep_group_REFUSES_our_own_group_and_everything_that_is_not_a_pid(monkeypatch):
    """`os.killpg(0, sig)` addresses the CALLER's group, so a 0 arriving from a half-built double or a
    mutated flag must fail safe. `bool` is excluded because `isinstance(True, int)` is true and would
    read pid 1. `os.killpg` is replaced here: a test that really signalled a group to prove a guard
    would be killing the runner that judges it."""
    sent = []
    monkeypatch.setattr(proc_util.os, "killpg", lambda pgid, sig: sent.append((pgid, sig)))
    for bad in (True, False, None, "1234", 1234.0, 0, -1, os.getpgrp()):
        assert proc_util.sweep_group(bad) is False, f"sweep_group({bad!r}) must refuse"
    assert sent == [], f"a refused pgid must send nothing: {sent}"
    assert proc_util.sweep_group(os.getpgrp() + 10_000_000) is True
    assert len(sent) == 1 and sent[0][1] == signal.SIGKILL, "the sweep is SIGKILL, after the reap"


def test_killpg_is_the_SECOND_independent_guard_and_never_raises(monkeypatch):
    """🔴 A MUTANT THAT SIGNALS THE GROUP JUDGING IT CANNOT BE KILLED BY THAT RUNNER. Measured on
    `mutation_diff.kill_process_group` in #3237: one inverted clause made the gate killpg its own
    group, mutmut's counter stopped at mutant 7 of 30, and the remaining 23 came back `not_checked` —
    unmeasured, which `mutate_diff` refuses. So the guard exists in the caller AND here: inverting
    either one leaves the other blocking, and no single mutation reaches `os.killpg` with our group."""
    sent = []
    monkeypatch.setattr(proc_util.os, "killpg", lambda pgid, sig: sent.append(pgid))
    for bad in (True, None, "9", 0, -5, os.getpgrp()):
        proc_util._killpg(bad, signal.SIGTERM)
    assert sent == [], f"the second guard let one through: {sent}"

    for exc in (ProcessLookupError(), PermissionError("not ours"), OSError("gone")):

        def boom(pgid, sig, _e=exc):
            raise _e

        monkeypatch.setattr(proc_util.os, "killpg", boom)
        proc_util._killpg(os.getpgrp() + 10_000_000, signal.SIGTERM)  # a group that died first is normal


def test_group_leader_refuses_every_pid_that_does_not_LEAD_a_group_of_its_own(monkeypatch):
    """Two independent conditions: the child must lead the group (`pgid == pid`) and that group must
    not be ours. A dead pid, a pid we may not read, and a pid that is not a pid all read False rather
    than raising — `_group_leader` is called on the teardown path, where a raise is a new failure
    mode."""
    assert proc_util._group_leader(os.getpid()) is False or os.getpgrp() != os.getpid()
    for bad in (True, False, None, "1234", 12.0, 0, -1):
        assert proc_util._group_leader(bad) is False, f"_group_leader({bad!r}) must refuse"

    async def reaped_pid():
        p = await asyncio.create_subprocess_exec("true")
        await p.wait()
        return p.pid

    assert proc_util._group_leader(_run(reaped_pid())) is False, "a reaped pid leads nothing"

    async def same_group_child():
        p = await _sleeper()
        leads = proc_util._group_leader(p.pid)
        await proc_util.kill(p)
        return leads

    assert _run(same_group_child()) is False, "a child in our group does not lead one"

    for exc in (PermissionError("not ours"), OSError("no such"), ProcessLookupError()):

        def boom(_pid, _e=exc):
            raise _e

        monkeypatch.setattr(proc_util.os, "getpgid", boom)
        assert proc_util._group_leader(os.getpid()) is False, f"{type(exc).__name__} must read as False"


def test_group_leader_decides_the_REFUSAL_before_it_reads_the_group(monkeypatch):
    """The guard's bound is `pid <= 0`, and neither `< 0` nor `<= 1` is the same rule.

    `0` means "the caller's own group" to every POSIX signal call, so it must fail safe BEFORE
    `os.getpgid` is consulted — a half-built double or a mutated flag arriving as 0 must not reach a
    group read at all. And `1` is a real pid that really leads its own group, so the guard must not
    swallow it. `os.getpgid` here records what it was asked, which is the only way to see a refusal
    that happens too late."""
    asked = []

    def getpgid(pid):
        asked.append(pid)
        return pid  # a pid that leads its own group

    monkeypatch.setattr(proc_util.os, "getpgid", getpgid)
    monkeypatch.setattr(proc_util.os, "getpgrp", lambda: 999_000)
    assert proc_util._group_leader(0) is False
    assert asked == [], f"pid 0 must be refused without any group read: {asked}"
    assert proc_util._group_leader(1) is True, "pid 1 leads its own group, and that group is not ours"


def test_group_leader_needs_BOTH_conditions_and_a_grandchild_shows_why(monkeypatch):
    """`pgid == pid and pgid != os.getpgrp()`. A grandchild satisfies the second clause and fails the
    first: its group is not ours, and it does not lead that group. Reading `or` there would call a group
    kill on a pid whose group belongs to somebody else's leader — the group kill this module exists to
    bound."""
    monkeypatch.setattr(proc_util.os, "getpgrp", lambda: 999_000)
    monkeypatch.setattr(proc_util.os, "getpgid", lambda _pid: 777_000)  # a group this pid does not lead
    assert proc_util._group_leader(12_345) is False, "a member of a foreign group does not lead it"


def test_both_pgid_guards_refuse_ZERO_and_pass_pgid_ONE(monkeypatch):
    """Both guards read `pgid <= 0`, and `<= 1` is a different rule. `0` addresses the caller's own
    group and must never be signalled. `1` is a real group that is not ours, so a guard that refuses it
    would drop a real sweep. `os.killpg` is replaced: a test that really signalled pgid 1 would be the
    defect it measures."""
    sent = []
    monkeypatch.setattr(proc_util.os, "killpg", lambda pgid, sig: sent.append((pgid, sig)))
    monkeypatch.setattr(proc_util.os, "getpgrp", lambda: 999_000)
    proc_util._killpg(0, signal.SIGTERM)
    assert sent == [], "zero addresses our own group"
    proc_util._killpg(1, signal.SIGTERM)
    assert sent == [(1, signal.SIGTERM)], f"pgid 1 is a real group and not ours: {sent}"
    sent.clear()
    assert proc_util.sweep_group(1) is True, "and the sweep reports that it addressed it"
    assert sent == [(1, signal.SIGKILL)], f"the sweep is SIGKILL: {sent}"


def test_a_leader_that_exits_during_the_GROUP_SIGTERM_is_not_killed_again(monkeypatch):
    """The grace is a real READ of the child, and its result decides the next rung of the ladder.

    `wait_for(proc.wait(), _GROUP_GRACE_S)` lets the group SIGTERM land, then
    `getattr(proc, "returncode", None) is None` asks whether the child still needs a signal of its own.
    A leader that exited for the group signal has a returncode by then, so `proc.kill()` is not called.
    A grace that waits for nothing, or a `returncode` read off the wrong object, reports a live child
    and signals a reaped one. The pgid the group gets is the LEADER's own pid, never another value."""
    sent = []
    monkeypatch.setattr(proc_util, "_group_leader", lambda pid: True)
    monkeypatch.setattr(proc_util, "_killpg", lambda pgid, sig: sent.append((pgid, sig)))

    class P:
        pid = 4343
        returncode = None

        def kill(self):
            sent.append(("kill", self.pid))

        async def wait(self):
            self.returncode = -signal.SIGTERM  # the group SIGTERM ended it, inside the grace
            return self.returncode

    async def go():
        await asyncio.wait_for(proc_util.kill(P()), timeout=2)

    asyncio.run(go())
    assert sent == [(4343, signal.SIGTERM), (4343, signal.SIGKILL)], (
        f"the group is addressed by the leader's own pid, and a child the group killed is not killed again: {sent}"
    )
