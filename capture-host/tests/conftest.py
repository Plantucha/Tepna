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


@_pytest.fixture(autouse=True)
def _fresh_power_engines():
    """`capture._POWER` holds one per-ring power engine per process — the same object the daemon keeps
    for a whole night. Left alone, a test that drives "Ring" into storm cooldown / backoff / synced-idle
    silently DEFERS the next test's pull and that test fails on a gate it never touched. Guarded: many
    test files never import capture (bleak-free lanes), and the fixture must not become the importer."""
    mod = sys.modules.get("capture")
    if mod is not None and hasattr(mod, "_POWER"):
        mod._POWER.clear()
    yield
    mod = sys.modules.get("capture")
    if mod is not None and hasattr(mod, "_POWER"):
        mod._POWER.clear()


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


# ── the alert notifier double ───────────────────────────────────────────────────────────────────────
# THIRTEEN ad-hoc `async def send(self, title, message, **kw): sent.append(title)` doubles existed in
# this suite, and every one of them threw the message and the keywords away. `tools/find_blindspots.py`
# found them by reading the tests; a mutation run then confirmed what it cost — swapping `free_gb` and
# `free_pct` in the "disk low" alert body survives the WHOLE suite (2851 passed), i.e. an alert reading
# "Only 3 GB free (87%)" for a box at 87 GB / 3% is unobservable. So is inverting the sentence that
# capture.py:3243 calls "actively misleading" in its own comment.
#
# The cure is the one `SubprocessRecorder` already uses: record every argument, and let the test assert
# on the ones it cares about. `.titles` keeps the old call sites' shape so converting a test is a
# rename, not a rewrite.
class AlertRecorder:
    """Stands in for the notifier. Records the FULL call — title, message and keywords.

    `deliver` decides the return value (alerts.Notifier.send returns True only when actually sent), so a
    caller that branches on the result can still be driven. Dedupe keys arrive in `kw` and are recorded
    rather than dropped: `key`/`dedupe_sec` are what make an alert fire once per episode instead of once
    per poll, and a double that swallows them cannot tell those two behaviours apart."""

    def __init__(self, deliver=True):
        self.calls = []            # [(title, message, kwargs)]
        self.deliver = deliver

    async def send(self, title, message, **kw):
        self.calls.append((title, message, dict(kw)))
        return self.deliver

    @property
    def titles(self):
        return [t for t, _m, _k in self.calls]

    @property
    def messages(self):
        return [m for _t, m, _k in self.calls]

    @property
    def last(self):
        return self.calls[-1]


@_pytest.fixture
def alert_recorder():
    """Factory, not an instance — several tests need more than one notifier, or one that refuses."""
    return AlertRecorder


# ── leaked module-global events (residue `2026-09-06-runner-gate-events-leak-between-tests`) ─────────
# `capture` carries three module-global `asyncio.Event`s — `_STOP`, `_RECOVER`, `_OXYII_PAUSE` — and
# tests `.set()` them DIRECTLY rather than through `monkeypatch`, so nothing restores them. All three
# gate the runners' loops (`while not _STOP.is_set() and not _RECOVER.is_set() and not
# _OXYII_PAUSE.is_set()`), so one left set makes every later runner test spin in an outer idle gate and
# reach NONE of the code it names — while still passing, because a test that observes nothing looks
# exactly like a test whose subject behaved. Measured: planting either `_RECOVER` or `_OXYII_PAUSE`
# reproduced a run-level plant recording zero observations, byte-identical to a full-suite failure.
#
# TWO MECHANISMS, DELIBERATELY, because they answer different questions:
#   · the RESET (clear before) stops one test's leak reaching the next — it makes the suite correct;
#   · the TRIPWIRE (assert after, naming the test) says WHO leaked — it keeps the suite honest.
# A reset alone would silence this class forever without ever naming a new instance of it, which is
# how the repo accumulates findings it cannot see recur.
#
# THE SET IS DISCOVERED, NOT LISTED. `_capture_events()` introspects the module, so a fourth event
# added later is covered the day it appears. Hard-coding today's three would encode the count as the
# invariant — and the count is exactly what a new leak changes. (Enumerating is also how `_STOP` was
# found at all: grepping the failure only showed the two events that happened to be in one message.)
import asyncio as _asyncio
import threading as _threading


def _capture_events():
    """Every module-global Event on `capture`, as (name, event). Discovered, never listed."""
    import capture as _capture

    return sorted(
        (n, getattr(_capture, n))
        for n in dir(_capture)
        if isinstance(getattr(_capture, n, None), (_threading.Event, _asyncio.Event))
    )


@_pytest.fixture(autouse=True)
def _capture_events_are_not_leaked(request):
    """Reset before, tripwire after. The tripwire runs BEFORE the trailing clear so it can still see
    what the test left; the clear then runs regardless, so one leak cannot cascade."""
    for _name, ev in _capture_events():
        ev.clear()
    yield
    leaked = [n for n, ev in _capture_events() if ev.is_set()]
    for _name, ev in _capture_events():
        ev.clear()
    if leaked and not request.node.get_closest_marker("sets_capture_events"):
        raise AssertionError(
            f"{request.node.nodeid} left {', '.join(leaked)} SET. These are module globals that gate "
            f"the runner loops, so leaving one set makes later runner tests reach none of the code "
            f"they name while still passing. Set them via `monkeypatch`, or clear them in the test. "
            f"A test that sets one AS PART OF ITS SCENARIO declares that with "
            f"`@pytest.mark.sets_capture_events` — the fixture is a reset, not a ban, and the marker "
            f"is what keeps this tripwire silent on correct code and loud on a real leak."
        )


@_pytest.fixture(autouse=True)
def _sample_writer_count_is_not_leaked(request):
    """`writers._open_sample_writers` is a PROCESS-GLOBAL counter (residue
    2026-09-20-open-writer-counter-leaks-across-tests). A test that opens a StreamWriter and never closes
    it leaves it > 0 for every later test in the process — and with it > 0, `capture._now()` takes its
    ABSORB branch on a clock divergence instead of re-anchoring, so a fake-monotonic anchor leaked by an
    earlier test becomes a permanent hours-off `_now()`. That was the second half of the #2715
    mutation-lane failure; the first half (the anchor) is reset by the fixture above this one's sibling.

    Same shape as `_capture_events_are_not_leaked`: reset before, tripwire after, marker to declare a
    deliberate leftover. The reset is what fixes the contamination; the tripwire is what stops the
    next leak from being invisible until a mutation run orders the tests differently."""
    import writers as _w
    _w._open_sample_writers = 0
    yield
    left = _w._open_sample_writers
    _w._open_sample_writers = 0
    if left and not request.node.get_closest_marker("leaves_writers_open"):
        raise AssertionError(
            f"{request.node.nodeid} left writers._open_sample_writers = {left}. It opened a sample writer "
            f"and never closed it, which would make every later test's capture._now() absorb clock steps "
            f"instead of re-anchoring. Close what you open (or use the writer as a context manager); a "
            f"test whose SCENARIO ends with a file open declares that with "
            f"`@pytest.mark.leaves_writers_open`."
        )


@_pytest.fixture(autouse=True)
def _bonding_select_is_the_configured_address(request):
    """`bonding.bluez_address` (2026-09-12) resolves the configured adapter to the address BlueZ lists,
    through `link_rssi.dbus_hci` (a `/sys/class/bluetooth` glob + busctl) and `resolve_hci` (`hcitool dev`).
    Every watchdog / bond / forget test would otherwise spawn those probes on the test host and get an
    answer that depends on ITS radios. Pinned to identity here — the configured address is what
    `select` gets — and the resolver itself is tested, unpinned, in test_bonding.py; test_link_rssi.py
    exercises the sources directly. Guarded like `_fresh_power_engines`: never the importer.

    Saved/restored by hand, NOT via `monkeypatch`: a conftest autouse fixture that REQUESTS
    `monkeypatch` instantiates it ahead of every module-level autouse fixture, so `monkeypatch` is
    torn down LAST — after a module's own reset fixture, which then meets whatever a test patched
    in. Measured: `test_link_distress_wire._reset` called `.clear()` on the `None` its test had
    planted into `_RADIO_EVENTS`."""
    if request.module.__name__ in ("test_bonding", "test_link_rssi"):
        yield
        return
    mod = sys.modules.get("bonding")
    if mod is None:
        yield
        return

    async def identity(adapter_mac):
        return adapter_mac

    saved = mod.bluez_address
    mod.bluez_address = identity
    try:
        yield
    finally:
        mod.bluez_address = saved


@_pytest.fixture(autouse=True)
def _no_fsync_barrier_spans_tests():
    """Drain the off-loop fsync worker between tests. Same discipline as the capture-event reset
    above, for the same reason: a PROCESS-GLOBAL side effect that outlives the test that caused it.

    🔴 THE FAILURE THIS CLOSES, measured on `main` 2026-09-10. `writers` runs one daemon thread for
    the whole process (the barrier was moved off the event loop in #2382). A barrier queued by one
    test can therefore fire DURING AN UNRELATED LATER TEST — and
    `test_chaos_ordering.py::test_both_writers_fsync_the_file_BEFORE_the_directory` installs a spy on
    the global `os.fsync`, so the stray barrier was recorded as an extra `'file'` call and the
    ordering assertion read `['dir', 'file']` instead of ending on `'dir'`.

    ⚠️ NOTHING WAS WRONG WITH THE ORDERING IT WAS CHECKING. `cpap_spool` is synchronous throughout —
    `write_part` calls `os.fsync` directly and `promote` fsyncs only the directory — so the
    transactional guarantee held the whole time. The failure was a true report about a false subject,
    which is why it reproduced in CI and not locally: it depends on which tests share a worker
    process and in what order, and xdist distributes them differently every run.

    A drain, not a ban: tests that exercise the real worker are correct to queue barriers, and this
    only guarantees none is still in flight when the next test starts."""
    yield
    import writers
    writers._drain_fsync(timeout=5.0)


@_pytest.fixture(autouse=True)
def _capture_clock_anchor_is_not_leaked():
    """Restore `capture._now()`'s anchor after every test. Same family as the two resets above: a
    PROCESS-GLOBAL side effect written by the CODE, not by the test, so `monkeypatch` never sees it.

    🔴 THE FAILURE THIS CLOSES, measured in the mutation lane of #2715 (2026-09-20). `_now()` predicts
    wall time from an anchor — `_anchor_wall + (monotonic − _anchor_mono)` — and `_reanchor()` writes
    those globals from inside the code. `test_capture_clock*.py` monkeypatch `capture._time` to a fake
    monotonic counter and drive `_now()`; the patch on `_time` is restored, the anchor the code wrote
    under it is not. Every later `_now()` in that process then predicts from a real wall anchor with a
    FAKE monotonic origin — measured four hours off (a file stamped 18:23 UTC in a run at 14:3x UTC).
    Downstream, `test_THE_RING_RESUMES_ITS_FILE_SET…` failed with the resume having HAPPENED (by
    filename collision on the stale stamp) and the "resuming file-set" line never emitted, because
    `resumable_set` judges its window against the leaked `now`. Under xdist the clock tests mostly
    sit on another worker; mutmut's clean baseline is one sequential process, so it saw it every time.

    ⚠️ FOUR NAMES, NOT THE POPULATION. These are the globals `_reanchor()` writes; `capture.py` holds
    other module-level state that tests have been seen to leak the same way (`STATUS`, `ADAPTER`,
    `_RADIO_EVENTS` — `test_failover_planted_wedge` 3/19 under one full run, 19/19 alone). That
    population is not enumerated here; this fixture closes the clock leak it was written for.
    Snapshot before, restore after — never `_reanchor()` here, which would itself write globals."""
    import capture
    keep = {k: getattr(capture, k) for k in ("_anchor_wall", "_anchor_mono", "_anchor_utcoff", "_civil_shift")}
    yield
    for k, v in keep.items():
        setattr(capture, k, v)
