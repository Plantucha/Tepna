# tepna-capture — pytest bootstrap
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
# Put capture-host/ on sys.path so tests can `import oxyii` etc. regardless of pytest version/cwd.
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ── recording subprocess double ──────────────────────────────────────────────────────────────────────
# CAPTURE-HOST-SUBPROCESS-SURFACE-2026-08-04 §2. The whole privileged surface of cpap_harvest reaches
# the outside world through one `subprocess.run`, so a double for it is the unit of work — but only if
# it RECORDS. A double that accepts an argument and discards it makes the code computing that argument
# unobservable while coverage still reads 100 %, which is the defect this campaign keeps finding.
#
# Note what is deliberately NOT defaulted: `capture_output`, `text` and `timeout` are REQUIRED keyword
# arguments here even though the real `subprocess.run` defaults them. Production passes all three; if a
# change drops one, the real call would silently inherit a default (uncaptured output, bytes instead of
# str, no deadline) and every assertion about the RESULT would still pass. Requiring them turns that
# into a TypeError at the call site instead.
import subprocess as _subprocess

import pytest as _pytest


class RecordedRun:
    """One recorded `subprocess.run` call."""

    def __init__(self, argv, kw):
        self.argv, self.kw = list(argv) if argv is not None else argv, dict(kw)

    @property
    def program(self):
        return self.argv[0] if self.argv else None

    @property
    def sudo(self):
        return bool(self.argv) and self.argv[:2] == ["sudo", "-n"]


class SubprocessRecorder:
    """Replaces `subprocess.run`. `reply` is a callable taking the argv and returning a completed-process
    stand-in, or an exception INSTANCE to raise (so the caller's except-arms can be driven)."""

    def __init__(self):
        self.calls = []
        self.reply = lambda argv: _Completed(0, "", "")

    def __call__(self, argv=None, *, capture_output, text, timeout, **rest):
        self.calls.append(RecordedRun(argv, dict(capture_output=capture_output, text=text,
                                                 timeout=timeout, **rest)))
        r = self.reply(argv)
        if isinstance(r, BaseException):
            raise r
        return r

    def argv_for(self, program):
        return [c.argv for c in self.calls if c.argv and program in c.argv]

    @property
    def last(self):
        return self.calls[-1]


class _Completed:
    def __init__(self, returncode=0, stdout="", stderr=""):
        self.returncode, self.stdout, self.stderr = returncode, stdout, stderr


@_pytest.fixture
def recorded_run(monkeypatch):
    """Patches `subprocess.run` in the cpap_harvest module namespace and hands back the recorder."""
    import cpap_harvest

    rec = SubprocessRecorder()
    monkeypatch.setattr(cpap_harvest._subprocess if hasattr(cpap_harvest, "_subprocess")
                        else cpap_harvest.subprocess, "run", rec)
    return rec


@_pytest.fixture
def completed():
    """Factory for a completed-process stand-in, so tests do not each define one."""
    return _Completed


@_pytest.fixture
def timeout_error():
    return _subprocess.TimeoutExpired


# ── recording ASYNC subprocess double ────────────────────────────────────────────────────────────────
# The sibling of SubprocessRecorder for `storage_targets._run`, which goes through
# `asyncio.create_subprocess_exec` rather than `subprocess.run`.
# CAPTURE-HOST-SUBPROCESS-SURFACE-2026-08-04 §4 step 4.
#
# Same rule about defaults: `stdout` and `stderr` are REQUIRED here. The real
# create_subprocess_exec defaults both to None, which means INHERIT — the child would write straight to
# the daemon's own stdout and `communicate()` would hand back None. Every assertion about the returned
# text still passes in that world, because "" and None both stringify to nothing useful. Requiring them
# turns a dropped redirect into a TypeError instead of a silently unread stream.


class _FakeProc:
    def __init__(self, returncode=0, out=b"", err=b""):
        self.returncode, self._out, self._err = returncode, out, err
        self.killed = False

    async def communicate(self, stdin=None):
        return self._out, self._err

    def kill(self):
        self.killed = True

    async def wait(self):
        return self.returncode


class AsyncSubprocessRecorder:
    """Replaces `asyncio.create_subprocess_exec`. `reply` takes the argv list and returns a _FakeProc,
    or an exception INSTANCE to raise so the caller's except-arms are drivable."""

    def __init__(self):
        self.calls = []
        self.reply = lambda argv: _FakeProc(0, b"", b"")

    async def __call__(self, *argv, stdout, stderr, **rest):
        self.calls.append(RecordedRun(list(argv), dict(stdout=stdout, stderr=stderr, **rest)))
        r = self.reply(list(argv))
        if isinstance(r, BaseException):
            raise r
        return r

    def argv_for(self, program):
        return [c.argv for c in self.calls if c.argv and program in c.argv]

    @property
    def last(self):
        return self.calls[-1]


@_pytest.fixture
def recorded_exec(monkeypatch):
    """Patches `asyncio.create_subprocess_exec` in the storage_targets namespace."""
    import storage_targets

    rec = AsyncSubprocessRecorder()
    monkeypatch.setattr(storage_targets.asyncio, "create_subprocess_exec", rec)
    return rec


@_pytest.fixture
def fake_proc():
    return _FakeProc
