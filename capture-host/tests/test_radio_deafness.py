# tepna-capture — tests/test_radio_deafness.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# THE NIGHT OF 2026-07-30. hci0 reported `UP RUNNING` with 332 MB of lifetime traffic. Every sensor —
# H10, Verity, O2Ring — failed to connect with plain timeouts. `classify_adapter_health` looked at that
# and said "not wedged", which was CORRECT BY ITS OWN RULES and wrong about the world: clean timeouts on
# an up adapter are exactly what "nobody is wearing them" looks like, and that is the one state the
# watchdog must never power-cycle on.
#
# The signal none of the existing ones carried: a 20 s scan saw ZERO advertisements, in a house that has
# dozens. The receiver was not receiving. `systemctl restart bluetooth` took it from 0 to 91 devices.
#
# `UP RUNNING` is not the same as hearing — the same shape as `connected` not being the same as
# recording (alerts.device_is_recording, one module over, from the night before).

import asyncio

import pytest

import capture
from tests._srcscan import block_source, module_source


@pytest.fixture(autouse=True)
def _clean():
    capture._STOP = asyncio.Event()
    capture._RECOVER = asyncio.Event()
    capture.STATUS.clear()
    capture.STATUS["devices"] = {}
    yield
    capture._STOP.set()
    capture._STOP.clear()


# ---------------------------------------------------------------- the predicate

def test_hearing_nothing_twice_is_deaf():
    """The 2026-07-30 state: nothing connected, nothing heard, and it persisted."""
    assert capture.radio_looks_deaf(0, connected_any=False, consecutive_silent=2) is True


def test_ONE_silent_round_is_not_evidence():
    """A probe can lose the race for the controller, or land in a genuinely quiet moment. Restarting
    bluetooth on a single sample would make the watchdog the flaky thing."""
    assert capture.radio_looks_deaf(0, connected_any=False, consecutive_silent=1) is False


def test_hearing_anything_clears_it():
    """One neighbour's phone is proof the receiver receives. Our sensors being off is not the question."""
    assert capture.radio_looks_deaf(3, connected_any=False, consecutive_silent=5) is False


def test_a_live_link_short_circuits_the_whole_question():
    """A radio holding a connection is demonstrably working, whatever a scan says — and this is also the
    only state in which probing could contend with the daemon's own connects."""
    assert capture.radio_looks_deaf(0, connected_any=True, consecutive_silent=99) is False


def test_the_threshold_is_configurable_and_binds():
    assert capture.radio_looks_deaf(0, False, 2, min_silent_rounds=3) is False
    assert capture.radio_looks_deaf(0, False, 3, min_silent_rounds=3) is True


# ---------------------------------------------------------------- the recovery

def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def test_a_missing_helper_says_so_rather_than_failing_silently(monkeypatch):
    """A recovery that CANNOT run must not look like one that ran. Without the sudoers grant the box
    would otherwise log a restart it never performed and keep sitting deaf."""
    monkeypatch.setattr(capture.helper_path, "resolve", lambda n: "/nonexistent/tepna-restart.sh")
    assert _run(capture._restart_radio()) is False


def test_a_successful_restart_reports_true_and_pauses_the_device_tasks(monkeypatch):
    """_RECOVER must be raised across the restart, or the device tasks fight the controller while
    bluetoothd is coming back — the same discipline the power-cycle rung already uses."""
    seen = {}

    async def fake(*args, timeout=45):
        seen["args"] = args
        seen["recover_during"] = capture._RECOVER.is_set()
        return 0, "bluetooth: active"

    real_sleep = asyncio.sleep      # capture BEFORE patching — capture.asyncio IS asyncio, so a lambda
                                    # calling asyncio.sleep would patch itself into infinite recursion
    monkeypatch.setattr(capture.helper_path, "resolve", lambda n: "/bin/sh")
    monkeypatch.setattr(capture, "_run_helper", fake)
    monkeypatch.setattr(capture.asyncio, "sleep", lambda *_a, **_k: real_sleep(0))
    assert _run(capture._restart_radio()) is True
    assert seen["args"][:2] == ("sudo", "-n"), seen["args"]
    assert seen["args"][-1] == "radio", seen["args"]
    assert capture._RECOVER.is_set() is False, "_RECOVER must be CLEARED again, or capture stays paused"


def test_a_failed_restart_reports_false(monkeypatch):
    """The inverse control — otherwise the test above passes on a function that always returns True."""
    async def fake(*args, timeout=45):
        return 1, "Failed to restart bluetooth.service"

    monkeypatch.setattr(capture.helper_path, "resolve", lambda n: "/bin/sh")
    monkeypatch.setattr(capture, "_run_helper", fake)
    assert _run(capture._restart_radio()) is False


# ---------------------------------------------------------------- wiring

def _src():
    return module_source("capture.py")


def test_the_probe_runs_in_the_NOT_WEDGED_branch():
    """That is the whole point. The wedged branch already recovers; 2026-07-30 was misclassified as
    HEALTHY, so a check that only ran when already suspicious would have changed nothing."""
    src = _src()
    i = src.index('if not h["wedged"]:')
    j = src.index("consecutive += 1", i)
    assert "radio_looks_deaf(" in src[i:j], "the deafness probe must sit in the not-wedged path"


def test_the_probe_only_runs_when_nothing_is_connected():
    """Otherwise it contends with the daemon's own connects — and a live link already answers it."""
    src = _src()
    i = src.index('if not h["wedged"]:')
    seg = src[i:src.index("consecutive += 1", i)]
    assert "connected_any" in seg
    assert "bonding.scan(" in seg


def test_a_failed_probe_is_not_treated_as_silence():
    """A probe that threw tells us about the probe, not the radio. Counting it as silence would let a
    flaky bluetoothctl trigger real restarts."""
    src = _src()
    assert "n_seen = -1" in src
    # Bounded on the block rather than a 200-char guess. (The marker lives in the trailing comment
    # on that line, so this pins prose beside code — left as-is because the assertion is unchanged
    # here by design, but it is why the block is the right bound: a comment reword must not silently
    # move the property out of a window.)
    assert "not evidence" in block_source("capture.py", "n_seen = -1")


def test_the_radio_verb_exists_in_the_helper():
    import os
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sh = open(os.path.join(here, "tepna-restart.sh"), encoding="utf-8").read()
    assert "radio)" in sh, "tepna-restart.sh must expose the radio verb the watchdog calls"
    assert "systemctl restart bluetooth" in sh
    # Asserts the verb is DISCOVERABLE, not the exact usage string — `stop [minutes]` joined the
    # surface on 2026-08-02 and a literal match made an unrelated addition look like a regression here.
    usage = next(l for l in sh.splitlines() if l.startswith("usage()"))
    assert "radio" in usage, "usage must list it, or an operator cannot discover it"


# ---------------------------------------------------------------- driven through the real watchdog

def test_the_watchdog_probes_and_restarts_a_deaf_radio(monkeypatch):
    """End to end through `adapter_watchdog`, in the exact 2026-07-30 shape: adapter UP, one worn
    sensor failing with a plain timeout, classifier says NOT wedged — and the scan hears nothing.

    A predicate nothing reaches saves nobody, and this path sits in the branch that previously just
    logged "adapter healthy again" and continued."""
    from tests.test_capture_coverage_100 import _wedge_rig, _stop_after, _dev
    _wedge_rig(monkeypatch, adapter_up=True)        # UP RUNNING — the whole point
    calls = {"scans": 0, "restarts": 0}

    async def deaf_scan(_adapter=None, seconds=8.0):
        calls["scans"] += 1
        return []                                   # hears NOTHING, as on the night

    async def fake_restart():
        calls["restarts"] += 1
        return True

    monkeypatch.setattr(capture.bonding, "scan", deaf_scan)
    monkeypatch.setattr(capture, "_restart_radio", fake_restart)
    _stop_after(monkeypatch, 3)                     # enough rounds to clear deaf_rounds=2
    cfg = {"devices": [_dev(name="H10")],
           "watchdog": {"interval_sec": 1, "grace_checks": 9, "deaf_rounds": 2, "deaf_scan_sec": 0.1}}
    capture.STATUS["devices"]["H10"] = {"connected": False, "last_error": "TimeoutError('connect timed out')"}
    _run(capture.adapter_watchdog("AA:BB:CC:DD:EE:FF", cfg))
    assert calls["scans"] >= 2, calls
    assert calls["restarts"] >= 1, "a radio that hears nothing twice must be restarted"


def test_the_watchdog_does_NOT_restart_a_radio_that_hears_neighbours(monkeypatch):
    """The inverse control, and the one that matters most: without it the test above passes on a
    watchdog that restarts bluetooth every minute all night. Our sensors being off is NOT deafness."""
    from tests.test_capture_coverage_100 import _wedge_rig, _stop_after, _dev
    _wedge_rig(monkeypatch, adapter_up=True)
    calls = {"restarts": 0}

    async def busy_scan(_adapter=None, seconds=8.0):
        return [object(), object(), object()]       # neighbours heard — the receiver receives

    async def fake_restart():
        calls["restarts"] += 1
        return True

    monkeypatch.setattr(capture.bonding, "scan", busy_scan)
    monkeypatch.setattr(capture, "_restart_radio", fake_restart)
    _stop_after(monkeypatch, 4)
    cfg = {"devices": [_dev(name="H10")],
           "watchdog": {"interval_sec": 1, "grace_checks": 9, "deaf_rounds": 2, "deaf_scan_sec": 0.1}}
    capture.STATUS["devices"]["H10"] = {"connected": False, "last_error": "not found"}
    _run(capture.adapter_watchdog("AA:BB:CC:DD:EE:FF", cfg))
    assert calls["restarts"] == 0, "a radio hearing neighbours must NEVER be restarted"


def test_a_throwing_probe_never_triggers_a_restart(monkeypatch):
    """A probe that raised tells us about the probe, not the radio. Treating it as silence would let a
    flaky bluetoothctl power-cycle the stack all night."""
    from tests.test_capture_coverage_100 import _wedge_rig, _stop_after, _dev
    _wedge_rig(monkeypatch, adapter_up=True)
    calls = {"restarts": 0}

    async def boom(_adapter=None, seconds=8.0):
        raise RuntimeError("bluetoothctl unavailable")

    async def fake_restart():
        calls["restarts"] += 1
        return True

    monkeypatch.setattr(capture.bonding, "scan", boom)
    monkeypatch.setattr(capture, "_restart_radio", fake_restart)
    _stop_after(monkeypatch, 4)
    cfg = {"devices": [_dev(name="H10")],
           "watchdog": {"interval_sec": 1, "grace_checks": 9, "deaf_rounds": 2, "deaf_scan_sec": 0.1}}
    capture.STATUS["devices"]["H10"] = {"connected": False, "last_error": "not found"}
    _run(capture.adapter_watchdog("AA:BB:CC:DD:EE:FF", cfg))
    assert calls["restarts"] == 0


def test_run_helper_actually_runs_a_process():
    """The real subprocess path — mocked everywhere above, so otherwise never executed."""
    rc, out = _run(capture._run_helper("/bin/echo", "hello", timeout=10))
    assert rc == 0 and "hello" in out


def test_run_helper_reports_a_missing_binary_rather_than_raising():
    rc, out = _run(capture._run_helper("/nonexistent/binary-xyz", timeout=5))
    assert rc == 127 and "not found" in out


def test_a_hanging_helper_times_out_instead_of_wedging_the_watchdog():
    """`systemctl restart bluetooth` CAN hang — bluetoothd sitting on a wedged controller is exactly
    the state this recovery runs in. An unbounded wait here would stall the watchdog task for the rest
    of the night, so the one rung that recovers the box would take out the loop that calls it."""
    rc, out = _run(capture._run_helper("/bin/sleep", "5", timeout=0.05))
    assert rc == 124 and "timed out" in out


def test_an_unresolvable_helper_is_a_clean_no_op_not_a_crash(monkeypatch):
    """`helper_path.resolve` raising (an unreadable dir, a permissions change) must degrade to the same
    honest 'cannot restart' as an absent file. A traceback out of `_restart_radio` would propagate into
    `adapter_watchdog` and kill the watchdog outright — losing every OTHER recovery rung too, because
    the radio happened to be unrecoverable."""
    def boom(_name):
        raise OSError("permission denied")

    monkeypatch.setattr(capture.helper_path, "resolve", boom)
    assert _run(capture._restart_radio()) is False
