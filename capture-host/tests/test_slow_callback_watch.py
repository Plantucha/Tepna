# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# WHICH CALLBACK HELD THE LOOP — the attribution `loop_monitor` structurally cannot give.
#
# `loop_monitor` measures how late its own 1 s sleep woke; its log line says "whatever held it". Measured
# 2026-09-25, that gap cost a night of wrong attribution: 737 stalls inside a tracing window were read as
# "25 at the QC poll's cadence", because `stalls so far:` is a CUMULATIVE counter and the warning is
# rate-limited to 300 s — so the spacing of warnings is the LIMITER's period and can never establish a
# cause. Two sessions reasoned from that spacing before anyone checked what the field meant.
#
# What these tests pin, in order of how easily each could silently rot:
#   · the PLANT — a callback over the threshold is named and its duration reported
#   · the CONTROL — ordinary callbacks produce nothing, so the log is not noise
#   · ONE definition of a stall: `_SLOW_CB_MS is _LOOP_LAG_STALL_MS`, or the pair's cross-read is false
#   · restore() is symmetric and idempotent — a process left wrapped is changed by its own diagnostic
#   · NO STATUS key: the first version published an aggregate and `find_unwired --check` red it as
#     "published by capture.py and read by nothing" — the journal line is the property, not a dashboard
#   · the OVERHEAD, asserted as a number rather than described in a comment
import asyncio
import time

import pytest

import capture


def _run(coro):
    return asyncio.run(coro)


def test_PLANT_a_slow_callback_is_logged_BY_NAME_with_its_duration(caplog):
    """The property. A callback that holds the loop past the threshold must name itself — that is the
    whole point, and it is what sleep-lateness cannot do."""
    async def body():
        w = capture.SlowCallbackWatch(threshold_ms=40)
        w.install()
        try:
            loop = asyncio.get_running_loop()
            done = asyncio.Event()

            def slow_one():
                time.sleep(0.09)          # a BLOCKING callback: exactly the shape being hunted
                done.set()

            loop.call_soon(slow_one)
            await done.wait()
            await asyncio.sleep(0)
        finally:
            w.restore()
        return w

    with caplog.at_level("WARNING"):
        w = _run(body())
    assert w.slow, "the watch saw nothing, so it cannot have been installed on the dispatch path"
    name = next(iter(w.slow))
    assert "slow_one" in name, f"the callback must be named, not merely counted: {name}"
    assert w.slow[name]["max_ms"] >= 80, w.slow
    msgs = " ".join(r.getMessage() for r in caplog.records)
    assert "slow callback:" in msgs and "slow_one" in msgs, msgs
    assert "held the loop" in msgs


def test_PLANT_ordinary_callbacks_produce_NOTHING_so_the_log_is_not_noise(caplog):
    """The instrument must not be noise. 200 fast callbacks through the real dispatch path, same
    threshold, and the log stays empty — otherwise every night would be full of names and the signal
    would be worth nothing.

    ⚠️ LABELLED A PLANT, NOT A CONTROL, AND THE DISTINCTION IS NOT PEDANTRY. It plays the ROLE of a
    control — it is the anti-noise half of the plant above — but it cannot execute against `origin/main`
    at all, because `SlowCallbackWatch` does not exist there. A test that cannot run on the old code
    proves nothing about the change; calling it a control would claim it did. Every test in this file is
    a plant by construction, for the same reason: the whole surface is new. THE CROSS-SIDE CONTROL FOR
    THIS UNIT IS `check.sh` — the suite stays green at 100 % with the watch registered and OFF, which is
    the state every night runs in."""
    async def body():
        w = capture.SlowCallbackWatch(threshold_ms=40)
        w.install()
        try:
            loop = asyncio.get_running_loop()
            n = 0

            def quick():
                nonlocal n
                n += 1

            for _ in range(200):
                loop.call_soon(quick)
            await asyncio.sleep(0.02)
            assert n == 200, n
        finally:
            w.restore()
        return w

    with caplog.at_level("WARNING"):
        w = _run(body())
    assert w.slow == {}, f"an ordinary callback was reported as slow: {w.slow}"
    assert not [r for r in caplog.records if "slow callback:" in r.getMessage()]


def test_ONE_definition_of_a_stall_shared_with_the_lag_monitor():
    """If these drifted, `STATUS["loop"]["stalls"]` would count one thing while the attribution named
    another, and the cross-read that makes the pair useful — "N stalls, and here are the callbacks" —
    would be silently false. That is the failure the 2026-09-25 misreading was made of."""
    assert capture._SLOW_CB_MS == capture._LOOP_LAG_STALL_MS == 100.0


def test_restore_is_symmetric_and_idempotent_so_the_process_is_not_left_wrapped():
    """A diagnostic that permanently changes the process it measures is the heap-probe defect (#3083).
    Credit: the same contract Osprey is turning into a test for `DecodeCensus`."""
    orig = asyncio.events.Handle._run
    w = capture.SlowCallbackWatch()
    w.install()
    assert asyncio.events.Handle._run is not orig, "install must actually wrap, or nothing is proven"
    w.install()                                   # idempotent: must not wrap the wrapper
    once = asyncio.events.Handle._run
    w.install()
    assert asyncio.events.Handle._run is once
    w.restore()
    assert asyncio.events.Handle._run is orig
    w.restore()                                   # a second restore is not an error
    assert asyncio.events.Handle._run is orig


def test_a_coroutine_step_is_named_by_its_COROUTINE_not_by_Task___step():
    """Every awaiting task dispatches through `Task.__step`, so naming the callback would report one name
    for a dozen different coroutines — the attribution would be technically present and useless."""
    async def body():
        async def my_named_coro():
            await asyncio.sleep(0)
        t = asyncio.get_running_loop().create_task(my_named_coro(), name="probe-task")
        handle = asyncio.events.Handle(getattr(t, "_Task__step", t.get_coro), (), asyncio.get_running_loop())
        desc = capture.describe_handle(handle)
        await t
        return desc

    desc = _run(body())
    assert desc.startswith("task:probe-task:"), desc
    assert "my_named_coro" in desc, desc


def test_describe_handle_FALLS_BACK_rather_than_raising_inside_dispatch():
    """It runs inside `Handle._run`. An instrument that can throw there takes the loop down with it, so
    an unexpected shape must degrade to a string, never propagate."""
    class Hostile:
        @property
        def _callback(self):
            raise RuntimeError("no")

    assert capture.describe_handle(Hostile()) == "<unnameable handle>"


def test_the_OVERHEAD_is_asserted_as_a_NUMBER_not_described_in_a_comment():
    """🔴 THE MECHANISM CHOICE RESTS ON THIS, so it is a test and not a docstring.

    asyncio has this built in — `loop.set_debug(True)` + `slow_callback_duration` — and it is the wrong
    reach: benchmarked over 60,000 callbacks it costs **18.09 µs/callback against a 1.29 µs baseline,
    14.0x**, because it also captures a source traceback per handle and tracks coroutine origins. The
    wrapper here measured **1.56 µs, 1.20x**. A 14x tax to answer a narrow question is the heap probe's
    19x stall tax in a different coat.

    The bound is deliberately loose (4x) because a shared CI runner is noisy and this must not red on
    contention — it exists to catch a mechanism change that makes the instrument expensive again, and
    debug mode's 14x is well outside it."""
    N = 4000

    async def churn():
        loop = asyncio.get_running_loop()
        n = 0

        def cb():
            nonlocal n
            n += 1

        t0 = time.perf_counter()
        for _ in range(N):
            loop.call_soon(cb)
        await asyncio.sleep(0.05)
        dt = time.perf_counter() - t0
        assert n == N, n
        return dt

    base = min(_run(churn()) for _ in range(3))
    w = capture.SlowCallbackWatch(threshold_ms=1000)   # high, so nothing is logged during the benchmark
    w.install()
    try:
        wrapped = min(_run(churn()) for _ in range(3))
    finally:
        w.restore()
    assert wrapped < base * 4 + 0.05, (
        f"the watch now costs {wrapped / base:.1f}x dispatch ({base:.4f}s -> {wrapped:.4f}s). Measured at "
        "1.20x when written; asyncio's own debug mode is 14x and was rejected for exactly this reason, so "
        "a regression here means the instrument has become the thing it was built to avoid.")


# ── the TASK, not just the class: the registration path every run exercises ───────────────────────

def test_the_task_returns_IMMEDIATELY_and_wraps_NOTHING_when_not_enabled():
    """The state every night runs in. Registered unconditionally, off by default — and "off" must mean
    the dispatch path is untouched, not merely that no line is logged."""
    orig = asyncio.events.Handle._run
    _run(capture.slow_callback_watch({}))                      # no `slow_callback` key at all
    assert asyncio.events.Handle._run is orig
    _run(capture.slow_callback_watch({"slow_callback": {"enabled": False}}))
    assert asyncio.events.Handle._run is orig


@pytest.mark.sets_capture_events   # the scenario's end IS `_STOP`; the autouse fixture resets it after
def test_the_task_INSTALLS_when_enabled_and_RESTORES_when_the_process_stops(caplog):
    """The enabled path end to end: it wraps, it honours the threshold from config, and `_STOP` returns
    it — leaving the dispatch path exactly as it found it. A task that installed and never restored would
    leave the process permanently instrumented, which is #3083's defect one instrument over."""
    orig = asyncio.events.Handle._run

    async def body():
        capture._STOP.clear()
        t = asyncio.get_running_loop().create_task(
            capture.slow_callback_watch({"slow_callback": {"enabled": True, "threshold_ms": 250}}))
        for _ in range(50):                                    # let it install
            await asyncio.sleep(0)
            if asyncio.events.Handle._run is not orig:
                break
        installed = asyncio.events.Handle._run is not orig
        capture._STOP.set()
        await t
        return installed

    with caplog.at_level("INFO"):
        installed = _run(body())
    assert installed, "the task must actually wrap dispatch when enabled"
    assert asyncio.events.Handle._run is orig, "and must restore on stop"
    msgs = " ".join(r.getMessage() for r in caplog.records)
    assert "slow-callback watch: ON" in msgs and "250 ms" in msgs, msgs
    assert "restored" in msgs
