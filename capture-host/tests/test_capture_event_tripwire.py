# tepna-capture — tests/test_capture_event_tripwire.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The guard for residue `2026-09-06-runner-gate-events-leak-between-tests`. `capture` carries three
# module-global `asyncio.Event`s that gate the runner loops; tests `.set()` them directly, and nothing
# restored them. A leaked event makes every later runner test spin in an outer idle gate and reach NONE
# of the code it names — while still passing, because a test that observes nothing looks exactly like a
# test whose subject behaved.
#
# MEASURED, and the numbers are the point:
#   · tripwire WITHOUT the reset  → 191 errors across 12 files. That is NOT an inventory: with nothing
#     clearing the event, every test after the first leak also "leaves it set", so the list is the
#     leaker plus its whole downstream. The reset is a PRECONDITION for measuring, not a later phase.
#   · tripwire WITH the reset     → 21 errors. Those are the real setters, and all 21 are deliberate.
#   · reset applied, tripwire off → 0 failures. NOTHING depended on the leak, so the reset is safe.
# Both numbers were needed: the first alone would have named 191 innocent tests.

import os
import shutil
import subprocess
import sys
import textwrap

import pytest

import capture

_TESTS = os.path.dirname(os.path.abspath(__file__))


def _events():
    from conftest import _capture_events

    return _capture_events()


def test_the_event_set_is_DISCOVERED_not_listed():
    """The tripwire introspects `capture` rather than naming today's events, so a fourth added later is
    covered the day it appears. PLANTED BOTH WAYS: a new event must show up, and removing it must take
    it back out — a discovery that cannot lose a member is just a hard-coded list with extra steps."""
    import asyncio

    before = {n for n, _ in _events()}
    assert {"_STOP", "_RECOVER", "_OXYII_PAUSE"} <= before, before
    capture._TRIPWIRE_PROBE_EVENT = asyncio.Event()
    try:
        assert "_TRIPWIRE_PROBE_EVENT" in {n for n, _ in _events()}, \
            "a newly added module-global Event was not discovered — the set is not being introspected"
    finally:
        del capture._TRIPWIRE_PROBE_EVENT
    assert {n for n, _ in _events()} == before


def test_every_test_starts_with_the_events_CLEAR():
    """The reset half. This test asserts the precondition every other test in the suite silently
    relies on; it is the whole reason a leak can no longer reach a later test."""
    assert [n for n, ev in _events() if ev.is_set()] == []


@pytest.mark.sets_capture_events
def test_a_marked_test_MAY_set_an_event_and_still_pass():
    """PAIRED OPPOSITE (and the reason the marker exists). The fixture is a RESET, not a BAN: 21 tests
    set one of these events as part of their scenario. If the guard failed them too it would be noise,
    and a noisy guard gets disabled — so the marker must genuinely exempt, and this test is the proof.
    Without it, 'the tripwire fires on a leak' would be satisfied by a tripwire that fires on
    EVERYTHING."""
    capture._RECOVER.set()
    assert capture._RECOVER.is_set()
    # deliberately NOT cleared — the autouse fixture's trailing clear is what contains it


def test_the_tripwire_NAMES_the_leaking_test(tmp_path):
    """THE PLANT. A throwaway test that leaks `_RECOVER`, run through the REAL conftest in a child
    pytest, must fail AND name itself and the event.

    It runs as a subprocess against a directory under `tests/` on purpose: `tests/conftest.py` applies
    to subdirectories, so this exercises the shipped fixture rather than a re-implementation of its
    logic. Asserting on a copy of the rule is how a guard passes while the wiring is dead."""
    probe = os.path.join(_TESTS, f"_tripwire_probe_{os.getpid()}")
    os.makedirs(probe, exist_ok=True)
    try:
        with open(os.path.join(probe, "test_leaks.py"), "w") as f:
            f.write(textwrap.dedent("""
                import capture

                def test_a_throwaway_test_that_leaks_recover():
                    capture._RECOVER.set()
                    assert True          # the BODY passes — the leak is the only defect
            """))
        r = subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider",
                            os.path.join(probe, "test_leaks.py")],
                           capture_output=True, text=True, timeout=300, cwd=os.path.dirname(_TESTS))
        out = r.stdout + r.stderr
        assert r.returncode != 0, f"the tripwire did not fire on a leaking test:\n{out}"
        assert "test_a_throwaway_test_that_leaks_recover" in out, \
            f"the tripwire fired but did not NAME the leaking test — which is its entire job:\n{out}"
        assert "_RECOVER" in out, f"the tripwire did not name the leaked event:\n{out}"
    finally:
        shutil.rmtree(probe, ignore_errors=True)


def test_a_clean_throwaway_test_is_NOT_flagged(tmp_path):
    """THE MIRROR of the plant. Without it, a tripwire that failed every test would pass the test
    above — the plant proves it fires, this proves it discriminates."""
    probe = os.path.join(_TESTS, f"_tripwire_clean_{os.getpid()}")
    os.makedirs(probe, exist_ok=True)
    try:
        with open(os.path.join(probe, "test_clean.py"), "w") as f:
            f.write("def test_a_throwaway_test_that_leaks_nothing():\n    assert True\n")
        r = subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider",
                            os.path.join(probe, "test_clean.py")],
                           capture_output=True, text=True, timeout=300, cwd=os.path.dirname(_TESTS))
        assert r.returncode == 0, f"a test that leaked nothing was flagged:\n{r.stdout}{r.stderr}"
    finally:
        shutil.rmtree(probe, ignore_errors=True)


# ── THE FLAG WAS NEVER THE WHOLE STATE: AN ASYNCIO EVENT ALSO CARRIES A LOOP BINDING ───────────────
# `asyncio.Event.wait()` binds the event to the running loop the first time it is reached with the flag
# UNSET (`asyncio/locks.py:210` calls `self._get_loop()`; the line above returns early when `self._value`
# is true — which is why a set event never binds). `asyncio.run` then closes that loop, and `clear()`
# resets the flag and leaves the binding. So a test that awaited an unset module-global event poisoned
# the next test to do the same in its own loop: `RuntimeError: ... is bound to a different event loop`.
#
# ⚠️ THE REMEDY ALREADY EXISTED AND WAS FILE-LOCAL, WHICH IS THE ACTUAL DEFECT. `test_capture_runners.py`
# has carried an autouse `_clean_stop` since the runner work that recreates `_STOP`, `_RECOVER`,
# `_OXYII_PAUSE` and `_CONNECT_LOCK` fresh each test, and its comment names this mechanism outright. But
# `_main_with_cfg` — the helper that actually runs `capture.main()` — is IMPORTED by other files, and
# they get none of that protection: `test_starts_sidecar.py` imports it and is exactly where this fired,
# at worker gw18 on 2026-09-27. A protection that lives beside one caller of a shared helper is not a
# protection of the helper.
#
# It did not look like a loop binding, either. The RuntimeError propagates out of the test BEFORE its
# trailing `capture._STOP.clear()`, so `_capture_events_are_not_leaked` fires second and reports
# "left _STOP SET" — the flag, not the binding, and one layer downstream of the fault.
# Residue `2026-09-27-a-module-global-asyncio-event-keeps-its-loop-binding-between-tests`.
#
# THE PAIR BELOW IS ONE PLANT IN TWO TESTS, and it must be two, in THIS file: the reset runs BETWEEN
# tests, so two `asyncio.run` calls inside one test would be unaffected by it — and placed in
# `test_capture_runners.py` the pair passes either way, because `_clean_stop` already recreates the
# events there. A plant is only a plant in a file that lacks the local fix.


def _await_the_stop_unset():
    """One `asyncio.run` reaching `capture._STOP.wait()` with the flag UNSET — the binding condition."""
    import asyncio as _a

    import capture as _capture

    async def body():
        _a.get_event_loop().call_later(0.01, _capture._STOP.set)
        await _capture._STOP.wait()

    _a.run(body())


@pytest.mark.sets_capture_events
def test_awaiting_an_unset_event_binds_a_loop_that_must_not_outlive_this_test_FIRST():
    """Half one: bind it. Passes with or without the fix — the FIRST binding is harmless, which is why
    the second half carries the assertion and this one is the setup."""
    import capture as _capture

    _capture._STOP.clear()
    _await_the_stop_unset()
    assert getattr(_capture._STOP, "_loop", None) is not None, (
        "this half must really reach `wait()` unset and bind — otherwise the pair is vacuous and the "
        "second half proves nothing about the reset"
    )


@pytest.mark.sets_capture_events
def test_awaiting_an_unset_event_binds_a_loop_that_must_not_outlive_this_test_SECOND():
    """Half two, and the assertion. A DIFFERENT loop, the same module-global event: without the reset
    replacing the object this raises `RuntimeError: ... is bound to a different event loop`. Verified
    against the unfixed fixture — 2 passed with the fix, and the same pair failed here without it."""
    import capture as _capture

    _capture._STOP.clear()
    _await_the_stop_unset()          # must not raise
    assert _capture._STOP.is_set(), "and the wait really completed — the timer fired and it returned"
