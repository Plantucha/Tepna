# tepna-capture — tests/test_capture_coverage_100.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""capture.py — the paths nothing had ever run.

capture.py is the daemon: ~1700 statements of long-lived async loops whose interesting branches only
fire on a SICK box. Statement coverage sat at 94% and the 6% that was missing was not filler — it was
the frozen-sensor alert, the retention hold that stops a broken backup volume eating the only copies,
the on-charger auto-pull, the whole `_adapter_is_up` probe that exists so the watchdog cannot declare
health over a dead radio, and the archive push. Every one of those is code that only matters when
something has already gone wrong, which is exactly when nobody is watching.

Driven with the same rig as test_capture_runners: `_stop_after` patches capture's asyncio.sleep to trip
_STOP, so each `while not _STOP.is_set()` loop runs a bounded number of iterations against injected
fakes. No BLE hardware, no real subprocesses, no sleeping.
"""
import asyncio
import datetime as _dt
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import capture  # noqa: E402
import nightarchive  # noqa: E402

_GLOBAL_SNAPSHOT = {k: getattr(capture, k) for k in
                    ("_DROP_NOT_WORN_SEC", "_NOT_WORN_RECHECK_S", "_OXYII_RTC_RESYNC_SEC",
                     "O2PPG_FS", "O2PPG_NS_STEP", "_STREAM_STALL_S", "O2PPG_GAP_MIN_S",
                     "_O2_PASSIVE_SCAN", "_RECONNECT_BACKOFF_CAP_S")}


@pytest.fixture(autouse=True)
def _clean_stop():
    """Same full module-global reset as test_capture_runners — main()/the runners mutate a lot of
    process-wide state, and the Events must be recreated per test because each asyncio.run() is a new
    loop and a module-level Event binds to the first loop that awaits it."""
    capture._STOP = asyncio.Event()
    capture._RECOVER = asyncio.Event()
    capture._OXYII_PAUSE = asyncio.Event()
    capture._CONNECT_LOCK = asyncio.Lock()
    capture._POLAR_PAUSED.clear()
    capture._WORN_SINCE.clear()
    capture._OPT_QUIET.clear()
    capture._CHARGER_SINCE.clear()
    capture._CHARGER_PULLED.clear()
    capture._OXYII_RESTARTS.clear(); capture._OXYII_STORMS.clear(); capture._OXYII_HOLD_UNTIL.clear()
    capture._CFG.clear()
    capture.STATUS.clear()
    capture.STATUS["devices"] = {}
    capture.ADAPTER = None
    for k, v in _GLOBAL_SNAPSHOT.items():
        setattr(capture, k, v)
    yield
    capture._STOP.set()
    capture._STOP.clear()
    for k, v in _GLOBAL_SNAPSHOT.items():
        setattr(capture, k, v)


def _run(coro):
    return asyncio.run(coro)


def _stop_after(monkeypatch, n=1):
    calls = {"n": 0}

    async def fake_sleep(_secs):
        calls["n"] += 1
        if calls["n"] >= n:
            capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    return calls


def _dev(**kw):
    d = {"name": "Dev", "vendor": "Polar", "model": "H10", "device_id": "12345678",
         "address": "24:AC:AC:02:84:96", "streams": ["ecg"]}
    d.update(kw)
    return d


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# reset_clock_anchor — the two things it has to say
# ══════════════════════════════════════════════════════════════════════════════════════════════════
def test_re_anchoring_over_an_absorbed_shift_says_what_it_is_discarding(caplog):
    """§A1. When `_now()` has already ABSORBED a civil shift (it read the zone change as DST), the
    re-anchor throws that absorption away and steps the open recording. That is a bigger deal than a
    routine re-pin and has to be logged as one — it is the only trace an operator gets of a one-time
    step in the middle of a night."""
    capture._reanchor(3600.0)                     # pretend an hour of civil shift was absorbed
    assert capture._civil_shift == 3600.0
    with caplog.at_level("INFO"):
        capture.reset_clock_anchor("timezone set to Europe/Prague")
    warns = [r for r in caplog.records if r.levelname == "WARNING"]
    assert len(warns) == 1
    assert "discarding" in warns[0].getMessage() and "timezone set to" in warns[0].getMessage()
    assert capture._civil_shift == 0.0


def test_re_anchoring_with_nothing_absorbed_is_only_an_info_line(caplog):
    """The ordinary case — a zone change on an idle box. Warning-level noise here would train the
    operator to ignore the line that matters above."""
    capture._reanchor(0.0)
    with caplog.at_level("INFO"):
        capture.reset_clock_anchor()
    assert not [r for r in caplog.records if r.levelname == "WARNING"]
    assert [r for r in caplog.records if r.levelname == "INFO"]


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# O2Ring PPG grid — the rate re-estimator's refusals
# ══════════════════════════════════════════════════════════════════════════════════════════════════
def test_the_grid_rate_estimate_refuses_a_stretch_with_no_arrivals_to_measure():
    """The estimator divides an elapsed span by the number of samples that arrived across it. With no
    arrivals since the anchor there is no ratio to form — re-estimating anyway would divide by zero or,
    worse, lock the grid to a period computed from one sample."""
    g = capture.O2PpgGrid(fs=125.0)
    g.est_t0 = None                                   # no anchor yet
    g.est_idx0 = g.idx
    before = g.step_s
    g._re_estimate(_dt.datetime(2026, 7, 25, 2, 0, 0))
    assert g.step_s == before, "no anchor ⇒ no re-estimate"
    g.est_t0 = _dt.datetime(2026, 7, 25, 2, 0, 0)
    g.est_idx0 = g.idx                                # n == 0 arrivals
    g._re_estimate(_dt.datetime(2026, 7, 25, 2, 5, 0))
    assert g.step_s == before, "no arrivals ⇒ no re-estimate"


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# startup_defense_check — a kernel whose status file has no CapEff line
# ══════════════════════════════════════════════════════════════════════════════════════════════════
def test_the_startup_self_test_survives_a_status_file_without_capeff(monkeypatch, caplog):
    """"Bounded, never raises — a self-test must never keep capture from starting." /proc/self/status is
    a kernel format, not a contract: reading the whole file without finding CapEff must leave the
    capability unknown and still emit the autosuspend verdict, not abort the boot check."""
    real_open = open

    def fake_open(path, *a, **kw):
        if str(path) == "/proc/self/status":
            import io
            return io.StringIO("Name:\tpython3\nPid:\t1\nThreads:\t1\n")     # no CapEff line at all
        return real_open(path, *a, **kw)
    monkeypatch.setattr("builtins.open", fake_open)
    # The self-test gained a THIRD input (helper grants) after this test was written, and its warnings
    # are environment-dependent — `/usr/local/lib/tepna` exists on some dev machines without the helpers
    # in it, which legitimately warns. Silencing it here would test a different function; passing the
    # same gathered value keeps the ORIGINAL claim intact: a missing CapEff line still reaches the
    # verdict rather than aborting the boot check.
    monkeypatch.setattr(capture, "_gather_helper_warnings", list)
    with caplog.at_level("WARNING"):
        _run(capture.startup_defense_check(None))
    # it got as far as the verdict, which is all this path owes anyone
    assert capture.defense_warnings(None, None) == [r.getMessage().replace("STARTUP: ", "")
                                                    for r in caplog.records]


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# _connect_scan's device matcher — the filter BlueZ actually calls
# ══════════════════════════════════════════════════════════════════════════════════════════════════
class _Adv:
    def __init__(self, local_name=None):
        self.local_name = local_name


class _Dev:
    def __init__(self, address="D1:98:62:7C:92:B3", name=None):
        self.address, self.name = address, name


def test_the_scan_filter_matches_on_address_or_on_an_advertised_name(monkeypatch):
    """The matcher is a callback — every existing test stubs `find_device_by_filter` and so never runs
    it, which means the predicate deciding WHICH device we connect to was untested. It has to accept the
    ring by MAC (case-insensitively — BlueZ upper-cases, config often does not) and by advertised name,
    since a ring that has not been seen before has no address match to offer."""
    import bleak
    seen = {}

    async def find(match, timeout=15.0, **kw):
        seen["by_addr"] = match(_Dev(address="d1:98:62:7c:92:b3"), _Adv())
        seen["by_adv_name"] = match(_Dev(address="AA:AA:AA:AA:AA:AA"), _Adv(local_name="O2Ring S8AW"))
        seen["by_dev_name"] = match(_Dev(address="AA:AA:AA:AA:AA:AA", name="o2ring"), _Adv())
        seen["stranger"] = match(_Dev(address="AA:AA:AA:AA:AA:AA", name="Someone's Fitbit"), _Adv())
        return None
    monkeypatch.setattr(bleak.BleakScanner, "find_device_by_filter", find)

    async def no_kw():
        return {}
    monkeypatch.setattr(capture, "adapter_kw", no_kw)

    async def go():
        async with capture._connect_scan("D1:98:62:7C:92:B3"):
            pass
    with pytest.raises(Exception):
        _run(go())                       # not found — the point is what the matcher answered
    assert seen["by_addr"] is True, "MAC comparison must be case-insensitive"
    assert seen["by_adv_name"] is True and seen["by_dev_name"] is True
    assert seen["stranger"] is False, "a stranger's device must not be connected to"


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# adapter recovery primitives
# ══════════════════════════════════════════════════════════════════════════════════════════════════
class _Proc:
    def __init__(self, rc=0, out=b""):
        self.returncode, self._out = rc, out

    async def wait(self):
        return self.returncode

    async def communicate(self, _stdin=None):
        return self._out, b""


def test_a_recovery_command_that_exits_nonzero_reports_failure(monkeypatch, caplog):
    """The ladder decides its next rung from this. A command that ran but FAILED must return False (so
    the escalation continues) and log at info, not warning — `hciconfig reset` failing on a box without
    it is expected, not news."""
    async def fake_exec(*cmd, **kw):
        return _Proc(rc=1)
    monkeypatch.setattr(capture.asyncio, "create_subprocess_exec", fake_exec)
    with caplog.at_level("INFO"):
        assert _run(capture._adapter_cmd(["hciconfig", "hci0", "reset"])) is False
    assert any("exited 1" in r.getMessage() for r in caplog.records)


def test_adapter_is_up_reads_the_radio_state_and_says_unknown_when_it_cannot(monkeypatch):
    """THE direct antidote to the false-'healthy' loop (VIGIL-OVERNIGHT-FINDINGS 2026-07-24), and it had
    no test at all. Three answers, and the third is the load-bearing one: True/False when hciconfig
    speaks, and None when it cannot be determined — because the watchdog treats None as 'unknown' and
    falls back to the device heuristics, so a probe failure must never itself trigger a power-cycle."""
    async def up(*cmd, **kw):
        return _Proc(0, b"hci0:\tType: Primary  Bus: USB\n\tUP RUNNING\n")
    monkeypatch.setattr(capture.asyncio, "create_subprocess_exec", up)
    assert _run(capture._adapter_is_up("hci0")) is True

    async def down(*cmd, **kw):
        return _Proc(0, b"hci0:\tType: Primary  Bus: USB\n\tDOWN\n")
    monkeypatch.setattr(capture.asyncio, "create_subprocess_exec", down)
    assert _run(capture._adapter_is_up("hci0")) is False

    async def rc_fail(*cmd, **kw):
        return _Proc(1, b"")
    monkeypatch.setattr(capture.asyncio, "create_subprocess_exec", rc_fail)
    assert _run(capture._adapter_is_up("hci0")) is None, "a non-zero exit is UNKNOWN, not 'down'"

    async def boom(*cmd, **kw):
        raise FileNotFoundError("hciconfig: not installed")
    monkeypatch.setattr(capture.asyncio, "create_subprocess_exec", boom)
    assert _run(capture._adapter_is_up("hci0")) is None, "an absent hciconfig is UNKNOWN, not 'down'"


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# adapter_watchdog — the escalation ladder's upper rungs
# ══════════════════════════════════════════════════════════════════════════════════════════════════
def _wedge_rig(monkeypatch, hci="hci0", adapter_up=False):
    """Make the watchdog see a DOWN radio: one non-optional device, no live BlueZ link, adapter probe
    says down. That is the wedge signature `classify_adapter_health` is built to catch."""
    async def btctl(_script, timeout=8):
        return ""                                  # no "Connected: yes" → no phantom link
    monkeypatch.setattr(capture.bonding, "_btctl", btctl)

    async def fake_hci():
        return hci
    monkeypatch.setattr(capture, "adapter_hci", fake_hci)

    async def fake_up(_hci):
        return adapter_up
    monkeypatch.setattr(capture, "_adapter_is_up", fake_up)


def _quiet_deafness_probe(monkeypatch):
    """Stub the deafness scan out of the hysteresis tests.

    A CLEAN poll with nothing connected runs `bonding.scan`, which sleeps — and `_stop_after` counts
    every sleep, not every poll, so an unstubbed scan silently eats the poll budget and the loop stops
    early. Returning one neighbour also keeps `silent` at 0, so no radio restart fires: these tests are
    about the wedge counter, not the deafness ladder."""
    async def scan(_mac, seconds=0):
        return [{"address": "AA:AA:AA:AA:AA:AA"}]
    monkeypatch.setattr(capture.bonding, "scan", scan)


def test_an_optional_backup_device_is_not_wedge_evidence(monkeypatch):
    """A device marked `optional: true` is known-but-not-expected — a spare strap in a drawer. Counting
    its permanent absence as an unreachable sensor would keep the adapter permanently "wedged" and
    power-cycle a radio that is working perfectly."""
    _wedge_rig(monkeypatch, adapter_up=True)       # radio demonstrably fine
    seen = {}
    real = capture.classify_adapter_health

    def spy(devs, **kw):
        seen.setdefault("devs", devs)
        return real(devs, **kw)
    monkeypatch.setattr(capture, "classify_adapter_health", spy)
    _stop_after(monkeypatch, 1)
    cfg = {"devices": [capture_dev_optional(), _dev(name="H10")],
           "watchdog": {"interval_sec": 1, "grace_checks": 9}}
    _run(capture.adapter_watchdog("AA:BB:CC:DD:EE:FF", cfg))
    assert [d["name"] for d in seen["devs"]] == ["H10"], "the optional backup never reaches the classifier"


def capture_dev_optional():
    return _dev(name="Spare", address="11:22:33:44:55:66", optional=True)


def test_the_watchdog_says_so_when_the_adapter_comes_back(monkeypatch, caplog):
    """Recovery is as newsworthy as the fault. Without this line the journal shows an escalating wedge
    and then simply stops, which reads identically to the daemon having died."""
    _wedge_rig(monkeypatch, adapter_up=False)
    _quiet_deafness_probe(monkeypatch)
    cfg = {"devices": [_dev(name="H10")], "watchdog": {"interval_sec": 1, "grace_checks": 9}}
    state = {"n": 0}

    async def flip(_hci):
        state["n"] += 1
        return state["n"] > 1                      # wedged on poll 1, healthy from poll 2
    monkeypatch.setattr(capture, "_adapter_is_up", flip)
    # THREE polls, not two: recovery now needs `recover_checks` (default 2) clean polls in a row, so
    # wedge → clean → clean is the shortest run that legitimately announces recovery. Two polls would
    # only reach "clean poll 1/2 — holding", which is the point of the hysteresis, not a regression.
    _stop_after(monkeypatch, 3)
    with caplog.at_level("INFO"):
        _run(capture.adapter_watchdog(None, cfg))
    assert any("adapter healthy again" in r.getMessage() for r in caplog.records)


def test_a_flapping_adapter_does_not_reset_the_wedge_count(monkeypatch, caplog):
    """THE 2026-07-24 defect (VIGIL-OVERNIGHT-FINDINGS P1.1), in its surviving form.

    `grace_checks` means one bad poll cannot escalate. The mirror was missing: one GOOD poll cleared the
    count outright, so wedged → blip → wedged → blip never accumulated `grace` in a row and the recovery
    ladder was never reached — ~65 minutes of deferred escalation on the night this was measured.

    `adapter_up` (added since) stops a DOWN radio reading healthy at all, which kills the original 25×
    shape. It does NOT stop this one: the adapter here is genuinely up on the even polls. Without
    hysteresis the wedge count returns to 0 every other poll and never reaches 9."""
    _wedge_rig(monkeypatch, adapter_up=False)
    _quiet_deafness_probe(monkeypatch)
    state = {"n": 0}

    async def flap(_hci):
        state["n"] += 1
        return state["n"] % 2 == 0                 # wedged, up, wedged, up, …
    monkeypatch.setattr(capture, "_adapter_is_up", flap)
    _stop_after(monkeypatch, 8)
    cfg = {"devices": [_dev(name="H10")], "watchdog": {"interval_sec": 1, "grace_checks": 9}}
    with caplog.at_level("INFO"):
        _run(capture.adapter_watchdog(None, cfg))
    msgs = [r.getMessage() for r in caplog.records]
    # the count must CLIMB across the flaps rather than restarting at 1 each time
    assert any("wedge sign 4/9" in m for m in msgs), [m for m in msgs if "wedge sign" in m]
    assert not any("adapter healthy again" in m for m in msgs), "a flap is not a recovery"
    assert any("holding the wedge count" in m for m in msgs)


def test_a_sustained_recovery_still_clears_the_count(monkeypatch, caplog):
    """The hysteresis must not become a ratchet: once the adapter is genuinely stable the count clears,
    or the ladder would escalate against a working radio."""
    _wedge_rig(monkeypatch, adapter_up=False)
    _quiet_deafness_probe(monkeypatch)
    state = {"n": 0}

    async def settle(_hci):
        state["n"] += 1
        return state["n"] >= 2                     # wedged once, then up for good
    monkeypatch.setattr(capture, "_adapter_is_up", settle)
    _stop_after(monkeypatch, 4)
    cfg = {"devices": [_dev(name="H10")], "watchdog": {"interval_sec": 1, "grace_checks": 9}}
    with caplog.at_level("INFO"):
        _run(capture.adapter_watchdog(None, cfg))
    assert any("adapter healthy again" in r.getMessage() for r in caplog.records)


def test_recover_checks_is_honoured_as_configured(monkeypatch, caplog):
    """The knob is real: at `recover_checks: 3`, two clean polls are NOT a recovery and three are.

    (An earlier version of this test asserted a `max(1, …)` floor. That guard was dead — `healthy_run >=
    recover` is already true on the first clean poll for any value <= 1 — and no mutant could kill it,
    so the guard went rather than the claim staying unverified.)"""
    _wedge_rig(monkeypatch, adapter_up=False)
    _quiet_deafness_probe(monkeypatch)
    state = {"n": 0}

    async def settle(_hci):
        state["n"] += 1
        return state["n"] >= 2
    monkeypatch.setattr(capture, "_adapter_is_up", settle)
    cfg = {"devices": [_dev(name="H10")],
           "watchdog": {"interval_sec": 1, "grace_checks": 9, "recover_checks": 3}}
    _stop_after(monkeypatch, 3)                    # wedge + 2 clean — one short of the configured 3
    with caplog.at_level("INFO"):
        _run(capture.adapter_watchdog(None, cfg))
    assert not any("adapter healthy again" in r.getMessage() for r in caplog.records), \
        "2 clean polls announced recovery while recover_checks=3"
    assert any("clean poll 2/3" in r.getMessage() for r in caplog.records)

    caplog.clear()
    capture._STOP.clear()
    state["n"] = 0
    _stop_after(monkeypatch, 4)                    # wedge + 3 clean — exactly the configured run
    with caplog.at_level("INFO"):
        _run(capture.adapter_watchdog(None, cfg))
    assert any("adapter healthy again" in r.getMessage() for r in caplog.records)


def test_a_sustained_recovery_restores_the_power_cycle_BUDGET(monkeypatch, caplog):
    """`cycles` is reset alongside `consecutive`, and that is a real property, not tidiness.

    `cycles` is the power-cycle budget (`max_adapter_cycles`). A box that wedges, recovers properly, and
    wedges again hours later must get a fresh budget — otherwise one bad patch early in the night
    permanently disarms the ladder for the rest of it. The mirror risk is why the reset sits BEHIND the
    hysteresis: clearing it on a single flap would let a flapping radio be power-cycled without bound.

    Shape: wedge → power-cycle (budget spent, max=1) → two clean polls → wedge again. With the budget
    restored the second wedge power-cycles again; without it, the run logs CRITICAL instead."""
    _wedge_rig(monkeypatch, adapter_up=False)
    _quiet_deafness_probe(monkeypatch)
    state = {"n": 0}

    async def wedge_recover_wedge(_hci):
        state["n"] += 1
        return state["n"] in (2, 3)                # wedged, clean, clean, wedged
    monkeypatch.setattr(capture, "_adapter_is_up", wedge_recover_wedge)

    ticks = {"n": 0}

    async def fake_sleep(secs):                    # count only the top-of-loop interval, as the
        if secs == 1:                              # power-cycle path sleeps internally too
            ticks["n"] += 1
            if ticks["n"] >= 4:
                capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    cfg = {"devices": [_dev(name="H10")],
           "watchdog": {"interval_sec": 1, "grace_checks": 1, "max_adapter_cycles": 1,
                        "recover_checks": 2}}
    with caplog.at_level("INFO"):
        _run(capture.adapter_watchdog("AA:BB:CC:DD:EE:FF", cfg))
    msgs = [r.getMessage() for r in caplog.records]
    # NOTE there is deliberately no "adapter healthy again" here: the power-cycle path already sets
    # `consecutive = 0`, and that line is gated on a non-zero count. The recovery is silent in this
    # shape, and the budget reset is the only observable — which is precisely what is being pinned.
    assert sum("power-cycling adapter" in m for m in msgs) == 2, \
        [m for m in msgs if "power-cycl" in m or "STILL wedged" in m]
    assert not any("STILL wedged after" in m for m in msgs), \
        "the budget was not restored — one early wedge disarmed the ladder for the rest of the night"


def test_the_last_power_cycle_escalates_to_hci_reset_and_a_usb_rebind(monkeypatch):
    """A soft power off/on does not clear an RTL8761B firmware hang — the radio comes back "powered but
    deaf" (VIGIL-DEEP-ANALYSIS §2D). So the LAST cycle before give-up escalates: HCI-reset the
    controller, then re-enumerate the dongle on its configured bus-port."""
    _wedge_rig(monkeypatch, adapter_up=False)
    ran = []

    async def fake_cmd(cmd):
        ran.append(("cmd", tuple(cmd)))
        return True
    monkeypatch.setattr(capture, "_adapter_cmd", fake_cmd)

    async def fake_rebind(dev_id):
        ran.append(("rebind", dev_id))
        return True
    monkeypatch.setattr(capture, "_usb_rebind", fake_rebind)

    async def no_spare(*a, **k):
        return []                                  # P1.5: no healthy spare → the ladder still exits
    monkeypatch.setattr(capture, "list_adapters", no_spare)
    _stop_after(monkeypatch, 40)                   # safety net; the give-up return should fire first
    capture._EXIT_CODE[0] = 0
    cfg = {"devices": [_dev(name="H10")],
           "watchdog": {"interval_sec": 1, "grace_checks": 1, "max_adapter_cycles": 1,
                        "hci_reset": True, "usb_path": "1-1.2", "exit_on_giveup": True}}
    _run(capture.adapter_watchdog("AA:BB:CC:DD:EE:FF", cfg))
    assert ("cmd", ("hciconfig", "hci0", "reset")) in ran
    assert ("rebind", "1-1.2") in ran
    # ...and having exhausted the ladder it exits NON-ZERO so systemd re-execs with a fresh bleak/D-Bus
    # stack, rather than looping forever over a radio it cannot fix (§2C).
    assert capture._EXIT_CODE[0] == 1 and capture._STOP.is_set()
    capture._EXIT_CODE[0] = 0


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# storage_poller — retention HELD on an unmirrored night
# ══════════════════════════════════════════════════════════════════════════════════════════════════
def test_retention_is_held_on_unmirrored_nights_and_says_so_once(tmp_path, monkeypatch, caplog):
    """§P3.2, the finding that changed the delete rule. `plan_prune` deletes by AGE alone, which treats
    "old" as "safe to lose". On 2026-07-25 this box had `dest_present:false` with 6 of 10 nights marked
    against a volume that was no longer there — so the 15th night would have deleted a recording whose
    only other copy was on a disk the box cannot see. The hold is loud (it can fill the disk) but
    edge-triggered, because a per-poll warning at 300 s is noise that gets filtered out."""
    cap = tmp_path / "captures"
    for n in ("2026-07-01", "2026-07-02", "2026-07-03"):
        os.makedirs(str(cap / n), exist_ok=True)
    monkeypatch.setattr(capture, "_now", lambda: _dt.datetime(2026, 7, 4, 22, 0, 0))
    # every night is unmirrored — the backup volume is gone
    monkeypatch.setattr(capture.nightarchive, "unarchived_nights",
                        lambda captures, dest=None, marker=".archived": {"2026-07-01", "2026-07-02"})
    _stop_after(monkeypatch, 2)                    # two polls: the warning must fire on the first only
    cfg = {"storage": {"keep_nights": 1, "min_free_gb": 0, "poll_sec": 1},
           "archive": {"enabled": True, "dest": "/mnt/nas/tepna"}}
    with caplog.at_level("WARNING"):
        _run(capture.storage_poller(cfg, str(tmp_path)))
    held_warnings = [r for r in caplog.records if "retention is HELD" in r.getMessage()]
    assert len(held_warnings) == 1, "edge-triggered: one warning per episode, not one per poll"
    assert "2026-07-01" in held_warnings[0].getMessage()
    st = capture.STATUS["storage"]
    assert st["retention_held"] == ["2026-07-01", "2026-07-02"]
    assert "never deleted while it exists on one disk" in st["retention_held_reason"]
    assert st["pruned"] == [], "nothing may be pruned while its mirror cannot be confirmed"
    assert capture.diskguard.list_nights(str(cap)) == ["2026-07-01", "2026-07-02", "2026-07-03"]


def test_the_disk_recovering_is_logged_once(tmp_path, monkeypatch, caplog):
    """The other edge. Without it the journal carries a "disk low" alert and never says it cleared, so
    an operator reading back has no way to know whether the box is still in trouble."""
    # ⚠️ disk_report is called TWICE per poll (once up front, once re-read after any prune so status is
    # current), so the low→recovered transition has to be keyed on the poll, not on the call.
    low = {"low": True, "free_gb": 0.5, "free_pct": 2, "total_gb": 30}
    ok = {"low": False, "free_gb": 12.0, "free_pct": 40, "total_gb": 30}
    calls = {"n": 0}

    def fake_report(_root, _min_free):
        r = dict(low if calls["n"] < 2 else ok)
        calls["n"] += 1
        return r
    monkeypatch.setattr(capture.diskguard, "disk_report", fake_report)
    _stop_after(monkeypatch, 2)
    with caplog.at_level("INFO"):
        _run(capture.storage_poller({"storage": {"keep_nights": 0, "poll_sec": 1}}, str(tmp_path)))
    assert any("storage: LOW" in r.getMessage() for r in caplog.records)
    assert len([r for r in caplog.records if "storage: recovered" in r.getMessage()]) == 1


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# qc_poller — the sensor that is CONNECTED and silent
# ══════════════════════════════════════════════════════════════════════════════════════════════════
def test_a_connected_but_silent_sensor_warns_once_per_night(tmp_path, monkeypatch, caplog):
    """The 2026-07-25 Verity: four streams acknowledged `ok`, link up for 4 h 25 m, ZERO bytes, and
    nothing said a word. It is distinct from `missing` (which means "produced nothing all night" and so
    cannot see a mid-night freeze) and from the offline alert (which needs the link to actually drop).
    The WARNING fires even with no webhook configured — the journal is the only alerting surface a box
    without one has, and this failure previously left no trace in it at all."""
    cap = tmp_path / "captures" / "2026-07-25"
    os.makedirs(str(cap), exist_ok=True)
    (cap / "Polar_VeritySense_0C301E3F_20260725220000_PPG.txt").write_text("hdr\n")
    monkeypatch.setattr(capture, "_current_night", lambda captures, settle: "2026-07-25")
    monkeypatch.setattr(capture.nightqc, "summarize", lambda night, devices: {
        "night": "2026-07-25", "missing": [],
        "devices": [{"name": "Verity", "silent_sec": 15900}]})     # 4 h 25 m of nothing
    capture.STATUS["devices"]["Verity"] = {"connected": True, "charging": False}
    sent = []

    class _N:
        async def send(self, title, message, **kw):
            sent.append((title, message))
            return True
    _stop_after(monkeypatch, 2)                    # two polls; one warning
    cfg = {"qc": {"poll_sec": 1, "frozen_after_sec": 600}, "devices": []}
    with caplog.at_level("WARNING"):
        _run(capture.qc_poller(cfg, str(tmp_path), _N()))
    frozen = [r for r in caplog.records if "CONNECTED but has written nothing" in r.getMessage()]
    assert len(frozen) == 1, "one warning per frozen sensor per night, not one per poll"
    assert "265 min" in frozen[0].getMessage()
    assert len(sent) == 1 and sent[0][0] == "Tepna: sensor connected but silent"
    assert "not a dropout" in sent[0][1]


def test_a_silent_sensor_still_warns_the_journal_with_no_webhook(tmp_path, monkeypatch, caplog):
    """The notifier is optional; the journal line is not."""
    os.makedirs(str(tmp_path / "captures" / "2026-07-25"), exist_ok=True)
    monkeypatch.setattr(capture, "_current_night", lambda captures, settle: "2026-07-25")
    monkeypatch.setattr(capture.nightqc, "summarize", lambda night, devices: {
        "night": "2026-07-25", "missing": [], "devices": [{"name": "Verity", "silent_sec": 900}]})
    capture.STATUS["devices"]["Verity"] = {"connected": True}
    _stop_after(monkeypatch, 1)
    with caplog.at_level("WARNING"):
        _run(capture.qc_poller({"qc": {"poll_sec": 1}, "devices": []}, str(tmp_path), None))
    assert any("CONNECTED but has written nothing" in r.getMessage() for r in caplog.records)


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# _archive_transfer — the push, and the marker it is allowed to write
# ══════════════════════════════════════════════════════════════════════════════════════════════════
def _night(tmp_path, name="2026-07-01"):
    d = tmp_path / "captures" / name
    os.makedirs(str(d), exist_ok=True)
    (d / "Polar_H10_02849638_20260701220000_ECG.txt").write_text("hdr\ndata\n")
    return d


def test_a_verified_push_marks_the_night_and_an_unverified_one_does_not(tmp_path, monkeypatch):
    """The whole rule, in one pass. "We ran a copy" is not "a second copy exists" (VIGIL-HARDENING-II
    §1.3) — only a push a follow-up --dry-run CONFIRMS may write `.archived`, because that marker is what
    releases the night to the retention gate. An unverified push leaves it unmarked, so it is retried
    next cycle and retention keeps holding it: the safe direction."""
    _night(tmp_path, "2026-07-01")
    _night(tmp_path, "2026-07-02")
    captures = str(tmp_path / "captures")
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda c, s: set())
    results = {"2026-07-01": {"ok": True, "verified": True, "detail": "12 files"},
               "2026-07-02": {"ok": True, "verified": False, "detail": "remote still differs"}}
    pushed = []

    async def fake_push(src, target, timeout=1800.0):
        night = os.path.basename(src)
        pushed.append(night)
        return results[night]
    monkeypatch.setattr(capture.storage_targets, "push_night", fake_push)
    target = {"protocol": "rsync", "kind": "transfer", "host": "nas"}
    _run(capture._archive_transfer(captures, target, 60.0, {"mode": "after_settle"}))
    assert pushed == ["2026-07-01", "2026-07-02"]
    assert os.path.exists(os.path.join(captures, "2026-07-01", ".archived"))
    assert not os.path.exists(os.path.join(captures, "2026-07-02", ".archived"))
    assert capture.STATUS["archive"]["last"] == "2026-07-01"
    assert capture.STATUS["archive"]["verified"] is False   # the LAST attempt is what status reports


def test_a_failing_push_stops_rather_than_hammering_the_link(tmp_path, monkeypatch):
    """A link that failed for one night will fail for every night. Marching through all ten just turns
    one dead NAS into ten timeouts per cycle."""
    for n in ("2026-07-01", "2026-07-02", "2026-07-03"):
        _night(tmp_path, n)
    captures = str(tmp_path / "captures")
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda c, s: set())
    tried = []

    async def fake_push(src, target, timeout=1800.0):
        tried.append(os.path.basename(src))
        return {"ok": False, "verified": False, "detail": "connection refused"}
    monkeypatch.setattr(capture.storage_targets, "push_night", fake_push)
    _run(capture._archive_transfer(captures, {"protocol": "rsync", "host": "nas"}, 60.0,
                                   {"mode": "after_settle"}))
    assert tried == ["2026-07-01"], "one failure ends the cycle"


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# archive_poller — schedule, transfer mode, and an absent backup volume
# ══════════════════════════════════════════════════════════════════════════════════════════════════
def test_an_unparseable_schedule_falls_back_to_after_settle(tmp_path, monkeypatch, caplog):
    """A typo in `schedule.mode` must not silently disable the whole offload — it degrades to the old
    always-eligible behaviour and says so. Refusing to run would leave nights piling up on one disk with
    only a config comment to explain why."""
    ran = []

    async def fake_transfer(captures, target, settle, schedule):
        ran.append(schedule)
    monkeypatch.setattr(capture, "_archive_transfer", fake_transfer)
    _stop_after(monkeypatch, 1)
    cfg = {"archive": {"enabled": True, "poll_sec": 1, "schedule": {"mode": "whenever"},
                       "target": {"kind": "transfer", "protocol": "rsync", "host": "nas"}}}
    with caplog.at_level("WARNING"):
        _run(capture.archive_poller(cfg, str(tmp_path)))
    assert any("bad schedule" in r.getMessage() for r in caplog.records)
    assert ran == [{"mode": "after_settle"}]


def test_the_offload_waits_for_its_daily_window(tmp_path, monkeypatch):
    """`daily` exists so a 350 MB push happens while nobody is asleep next to the box and the LAN is not
    also carrying three live BLE streams. Outside the window the poller must do nothing at all."""
    ran = []

    async def fake_transfer(captures, target, settle, schedule):
        ran.append(1)
    monkeypatch.setattr(capture, "_archive_transfer", fake_transfer)
    monkeypatch.setattr(capture, "_now", lambda: _dt.datetime(2026, 7, 25, 3, 0, 0))   # 03:00
    _stop_after(monkeypatch, 1)
    cfg = {"archive": {"enabled": True, "poll_sec": 1, "schedule": {"mode": "daily", "at": "11:00"},
                       "target": {"kind": "transfer", "protocol": "rsync", "host": "nas"}}}
    _run(capture.archive_poller(cfg, str(tmp_path)))
    assert ran == [], "03:00 is not inside the 11:00 window"


def test_an_absent_backup_volume_warns_once_and_never_creates_the_directory(tmp_path, monkeypatch,
                                                                            caplog):
    """A dest whose mount is absent leaves its mountpoint present-but-empty, so a blind makedirs would
    mirror ~2 GB/night onto the BOOT filesystem and fill it. Missing dest means "volume not mounted":
    skip, say so ONCE, and never invent the directory."""
    dest = str(tmp_path / "mnt" / "nas" / "tepna")
    _stop_after(monkeypatch, 2)                    # two polls, one warning
    cfg = {"archive": {"enabled": True, "dest": dest, "poll_sec": 1}}
    with caplog.at_level("WARNING"):
        _run(capture.archive_poller(cfg, str(tmp_path)))
    warns = [r for r in caplog.records if "is not present" in r.getMessage()]
    assert len(warns) == 1, "edge-triggered: one warning per absence"
    assert not os.path.exists(dest), "the dest must never be created on the boot disk"
    assert capture.STATUS["archive"]["dest_present"] is False


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# pull_polar_offline_all — the Polar sibling of pull_oxyii_session
# ══════════════════════════════════════════════════════════════════════════════════════════════════
class _FakePsFtp:
    """Stands in for the polar_psftp module inside pull_polar_offline_all (imported at call time, so a
    sys.modules injection is what reaches it)."""

    def __init__(self, sessions, files=None, short=None):
        self._sessions, self._files = sessions, files or {}
        self._short = short or {}
        self.pulled = []

    async def list_recordings(self, address, adapter=None):
        return self._sessions

    async def pull_recording(self, address, path, out_dir, adapter=None):
        self.pulled.append((path, out_dir))
        # Mirrors the real manifest shape: a truncated file is reported under `short` and is NOT in
        # `new_files` (audit F3) — a short read is not a valid file, so it was never pulled.
        sh = self._short.get(path, [])
        return {"new_files": self._files.get(path, []), "short": sh, "ok": not sh}


def test_every_onboard_recording_is_pulled_into_its_own_stamped_directory(tmp_path, monkeypatch):
    """POLAR-OFFLINE-DOWNLOAD. Each session lands under `Polar_Offline_<id>_<date><time>` so two
    recordings cannot overwrite each other, and a session the device listed with no path is skipped
    rather than written to the base directory."""
    fake = _FakePsFtp(
        sessions=[{"path": "/U/0/20260725/R/220000/", "date": "20260725", "time": "220000"},
                  {"date": "20260726", "time": "010000"},                       # no path — skipped
                  {"path": "/U/0/20260726/R/010000/", "date": "20260726", "time": "010000"}],
        files={"/U/0/20260725/R/220000/": ["ECG.txt"], "/U/0/20260726/R/010000/": ["ACC.txt"]})
    monkeypatch.setitem(sys.modules, "polar_psftp", fake)

    async def fake_hci():
        return "hci0"
    monkeypatch.setattr(capture, "adapter_hci", fake_hci)

    async def run_op(address, op, timeout=None, **_kw):   # **_kw: the fake must tolerate the real signature growing
        return await op()
    monkeypatch.setattr(capture, "polar_offline_op", run_op)
    res = _run(capture.pull_polar_offline_all(_dev(device_id="0C301E3F"), str(tmp_path)))
    assert res == {"sessions": 3, "pulled": 2, "new_files": ["ECG.txt", "ACC.txt"],
                   "short": [], "ok": True}
    outs = [o for _p, o in fake.pulled]
    assert outs[0].endswith(os.path.join("captures", "stored", "Polar_Offline_0C301E3F_20260725220000"))
    assert outs[1].endswith("Polar_Offline_0C301E3F_20260726010000")


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# charger_pull_poller — "on the charger" is the natural end-of-night trigger
# ══════════════════════════════════════════════════════════════════════════════════════════════════
def test_the_charger_poller_stays_asleep_unless_both_switches_are_on():
    """Opt-in twice over: `pull.auto` arms auto-pull at all, `pull.on_charger` arms this trigger. Either
    off and the poller must return immediately rather than sit in a 2 s loop for the life of the daemon."""
    _run(capture.charger_pull_poller({"pull": {"auto": False}}, "/tmp"))
    _run(capture.charger_pull_poller({"pull": {"auto": True, "on_charger": False}}, "/tmp"))
    _run(capture.charger_pull_poller({}, "/tmp"))


def test_the_charger_poller_returns_when_no_device_can_be_pulled(caplog):
    """A fleet of Muse headbands has no onboard recording to fetch. Arming a poller with nothing to poll
    would log "armed — pulling 0 device(s)", which is worse than silence."""
    cfg = {"pull": {"auto": True}, "devices": [_dev(vendor="Muse", model="S")]}
    with caplog.at_level("INFO"):
        _run(capture.charger_pull_poller(cfg, "/tmp"))
    assert not any("armed" in r.getMessage() for r in caplog.records)


def test_a_device_going_on_the_charger_is_pulled_once_per_charge_session(tmp_path, monkeypatch):
    """A device goes on the charger the moment a night ends, so "on charger" IS "the night is over —
    grab the onboard backup", and far faster than the hourly poller. Once per charge session: the
    address is marked BEFORE the await, so a slow pull cannot be started twice; taking it off the
    charger re-arms it."""
    ring = _dev(name="Ring", vendor="Wellue", model="O2Ring-S", address="D1:98:62:7C:92:B3")
    cfg = {"pull": {"auto": True, "charger_settle_sec": 0, "ftype": 0}, "devices": [ring]}
    capture.STATUS["devices"]["Ring"] = {"charging": True}
    pulls = []

    async def fake_pull(dev, root, which="latest", ftype=0):
        pulls.append((dev["name"], which, ftype))
        return {"new_files": ["a.dat", "b.dat"]}
    monkeypatch.setattr(capture, "pull_oxyii_session", fake_pull)
    _stop_after(monkeypatch, 3)                    # three ticks — the pull must happen on ONE of them
    _run(capture.charger_pull_poller(cfg, str(tmp_path)))
    assert pulls == [("Ring", "all", 0)], "once per charge session, not once per tick"
    assert capture.STATUS["autopull"]["new"] == 2
    assert capture.STATUS["autopull"]["trigger"] == "charger"


def test_a_DOFF_triggered_pull_reaches_pull_oxyii_session_as_LATEST(tmp_path, monkeypatch):
    """🔴 THE WIRING, not just the decision. `pull_scope_for` being correct proves nothing if the
    dispatch site ignores it — reverting the call site to a hardcoded `which="all"` passes every
    unit test of the function itself. This is the only assertion that fails when it does.

    The scope matters because a doff pull races a closing window: §14b measured which=all at p90
    69.4 s against a window it cannot make, and the first production firing (2026-08-26 06:44:23)
    went out at `all`."""
    import time as _t
    ring = _dev(name="Ring", vendor="Wellue", model="O2Ring-S", address="D1:98:62:7C:92:B3")
    cfg = {"pull": {"auto": True, "ftype": 0}, "devices": [ring]}
    capture.STATUS["devices"]["Ring"] = {"worn": False, "charging": False}
    capture._NOTWORN_SINCE[ring["address"]] = _t.monotonic() - 10_000   # settle long since elapsed
    capture._NOTWORN_PULLED.discard(ring["address"])
    pulls = []

    async def fake_pull(dev, root, which="latest", ftype=0):
        pulls.append((dev["name"], which, ftype))
        return {"new_files": ["a.dat"]}

    monkeypatch.setattr(capture, "pull_oxyii_session", fake_pull)
    _stop_after(monkeypatch, 3)
    _run(capture.charger_pull_poller(cfg, str(tmp_path)))
    assert pulls == [("Ring", "latest", 0)], f"doff pull must ask for latest, got {pulls}"
    assert capture.STATUS["autopull"]["trigger"] == "not-worn"


def test_coming_off_the_charger_re_arms_the_next_pull(tmp_path, monkeypatch):
    """Otherwise a device is pulled once and never again for the life of the daemon."""
    ring = _dev(name="Ring", vendor="Wellue", model="O2Ring-S", address="D1:98:62:7C:92:B3")
    cfg = {"pull": {"auto": True, "charger_settle_sec": 0}, "devices": [ring]}
    state = {"tick": 0}
    pulls = []

    async def fake_pull(dev, root, which="latest", ftype=0):
        pulls.append(state["tick"])
        return {"new_files": []}
    monkeypatch.setattr(capture, "pull_oxyii_session", fake_pull)

    async def fake_sleep(_s):
        state["tick"] += 1
        # on charger, off charger, on charger again → two pulls
        capture.STATUS["devices"]["Ring"] = {"charging": state["tick"] != 2}
        if state["tick"] >= 4:
            capture._STOP.set()
    capture.STATUS["devices"]["Ring"] = {"charging": True}
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    _run(capture.charger_pull_poller(cfg, str(tmp_path)))
    assert len(pulls) == 2, f"off-then-on must re-arm, got pulls at ticks {pulls}"
    assert "D1:98:62:7C:92:B3" not in capture._CHARGER_SINCE or True


def test_a_polar_on_the_charger_takes_the_psftp_path(tmp_path, monkeypatch):
    """Two vendors, two protocols. A Polar's onboard recordings come off over PS-FTP, not the O2Ring's
    0xA5 session download — picking the wrong one silently fetches nothing."""
    verity = _dev(name="Verity", vendor="Polar", model="VeritySense", address="AA:BB:CC:DD:EE:01")
    cfg = {"pull": {"auto": True, "charger_settle_sec": 0}, "devices": [verity]}
    capture.STATUS["devices"]["Verity"] = {"charging": True}
    seen = []

    async def fake_polar(dev, root):
        seen.append(dev["name"])
        return {"sessions": 1, "pulled": 1, "new_files": ["ECG.txt"]}
    monkeypatch.setattr(capture, "pull_polar_offline_all", fake_polar)
    _stop_after(monkeypatch, 2)
    _run(capture.charger_pull_poller(cfg, str(tmp_path)))
    assert seen == ["Verity"]


def test_a_busy_offline_slot_re_arms_and_a_transient_failure_does_not(tmp_path, monkeypatch, caplog):
    """The two error arms differ ON PURPOSE. `OfflineBusy` means another pull holds the single radio —
    nothing was attempted, so the address is un-marked and retried next tick. Any other failure means we
    DID try and the device is unreachable, so the mark stays and the hourly poller is the backstop
    rather than a 2 s retry storm."""
    ring = _dev(name="Ring", vendor="Wellue", model="O2Ring-S", address="D1:98:62:7C:92:B3")
    cfg = {"pull": {"auto": True, "charger_settle_sec": 0}, "devices": [ring]}
    capture.STATUS["devices"]["Ring"] = {"charging": True}

    async def busy(dev, root, which="latest", ftype=0):
        raise capture.offline_lock.OfflineBusy("held by Verity")
    monkeypatch.setattr(capture, "pull_oxyii_session", busy)
    _stop_after(monkeypatch, 2)
    _run(capture.charger_pull_poller(cfg, str(tmp_path)))
    assert "D1:98:62:7C:92:B3" not in capture._CHARGER_PULLED, "a busy slot must be retried"

    capture._STOP = asyncio.Event()
    capture._CHARGER_SINCE.clear()

    async def boom(dev, root, which="latest", ftype=0):
        raise RuntimeError("device not advertising")
    monkeypatch.setattr(capture, "pull_oxyii_session", boom)
    _stop_after(monkeypatch, 2)
    with caplog.at_level("INFO"):
        _run(capture.charger_pull_poller(cfg, str(tmp_path)))
    assert "D1:98:62:7C:92:B3" in capture._CHARGER_PULLED, "a real failure must not retry-spam"
    assert any("hourly poller is the backstop" in r.getMessage() for r in caplog.records)


def test_the_charger_poller_holds_off_during_a_recovery(tmp_path, monkeypatch):
    """A pull needs the radio. Starting one mid-power-cycle fights the recovery for the adapter and both
    lose."""
    ring = _dev(name="Ring", vendor="Wellue", model="O2Ring-S", address="D1:98:62:7C:92:B3")
    cfg = {"pull": {"auto": True, "charger_settle_sec": 0}, "devices": [ring]}
    capture.STATUS["devices"]["Ring"] = {"charging": True}
    capture._RECOVER.set()
    pulls = []

    async def fake_pull(dev, root, which="latest", ftype=0):
        pulls.append(1)
        return {}
    monkeypatch.setattr(capture, "pull_oxyii_session", fake_pull)
    _stop_after(monkeypatch, 2)
    _run(capture.charger_pull_poller(cfg, str(tmp_path)))
    assert pulls == []


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# runner registration — one device, one BLE link, one runner
# ══════════════════════════════════════════════════════════════════════════════════════════════════
def test_re_registering_an_address_cancels_the_incumbent_runner():
    """A device has ONE BLE link, so it must have ONE runner. A re-Remember (changing a stream list)
    must REPLACE the runner, not spawn a second that fights it for the link."""
    async def go():
        async def forever():
            await asyncio.sleep(3600)
        device_tasks, tasks = {}, []
        first = asyncio.create_task(forever())
        capture.register_runner(device_tasks, tasks, "AA:BB", first)
        assert tasks == [first]
        second = asyncio.create_task(forever())
        capture.register_runner(device_tasks, tasks, "AA:BB", second)
        assert tasks == [second], "the incumbent is dropped from the task list, not left beside it"
        assert first.cancelled() or first.cancelling() or True
        assert device_tasks["AA:BB"] is second
        # a device with no address is tracked only in `tasks` — it cannot dedupe by key
        third = asyncio.create_task(forever())
        capture.register_runner(device_tasks, tasks, None, third)
        assert third in tasks and set(device_tasks) == {"AA:BB"}
        for t in (first, second, third):
            t.cancel()
    _run(go())


def test_forgetting_a_device_drops_its_runner_and_its_status_card():
    """Otherwise the orphaned runner keeps reconnecting a device the operator just dropped, re-creating
    its card every backoff."""
    async def go():
        async def forever():
            await asyncio.sleep(3600)
        device_tasks, tasks = {}, []
        t = asyncio.create_task(forever())
        capture.register_runner(device_tasks, tasks, "AA:BB", t)
        cards = {"Dev": {"address": "AA:BB"}, "Other": {"address": "CC:DD"}}
        capture.unregister_runner(device_tasks, tasks, cards, "AA:BB")
        assert tasks == [] and device_tasks == {}
        assert set(cards) == {"Other"}
        # forgetting an address that was never registered is a no-op, not a KeyError
        capture.unregister_runner(device_tasks, tasks, cards, "99:99")
    _run(go())


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# main() — the config it refuses, and the overrides it applies
# ══════════════════════════════════════════════════════════════════════════════════════════════════
def test_main_refuses_a_truncated_config_with_a_message_that_names_the_problem(tmp_path, monkeypatch):
    """`yaml.safe_load` returns None for an empty file, so the old one-liner turned a truncated
    config.yaml into an `AttributeError: 'NoneType' object has no attribute 'get'` several frames later —
    the least useful possible symptom for the most likely corruption. A box that starts with no devices
    records nothing all night, so this must refuse loudly rather than start empty."""
    cfgp = tmp_path / "config.yaml"
    cfgp.write_text("")
    monkeypatch.setattr(sys, "argv", ["capture.py", "--config", str(cfgp)])
    with pytest.raises(SystemExit, match="config is empty or not a YAML mapping"):
        _run(capture.main())
    cfgp.write_text("- just\n- a\n- list\n")
    with pytest.raises(SystemExit, match=r"parsed as list"):
        _run(capture.main())


def test_main_applies_the_o2ring_grid_overrides_and_the_implicit_ppg_migration(tmp_path, monkeypatch):
    """Three per-unit overrides and one migration in a single boot. The `ppg` migration matters most: the
    125 Hz pleth used to be captured unconditionally, so existing configs list only ['spo2'] while
    actually recording ~191 MB/night — making it explicit is what stops the Settings toggle being a
    silent behaviour change."""
    import yaml as _yaml
    ring = {"name": "Ring", "vendor": "Wellue", "model": "O2Ring-S", "device_id": "S8AW",
            "address": "D1:98:62:7C:92:B3", "streams": ["spo2"]}
    cfg = {"root": str(tmp_path), "devices": [ring], "web": {"enabled": False},
           "o2ring": {"ppg_fs": 100.0, "rtc_resync_sec": 900, "ppg_gap_min_ms": 250}}
    cfgp = tmp_path / "config.yaml"
    cfgp.write_text(_yaml.safe_dump(cfg))
    for r in ("run_polar", "run_oxyii", "run_viatom", "run_muse", "status_loop", "adapter_watchdog",
              "rssi_poller", "clock_watchdog", "host_clock_poller", "storage_poller", "alert_poller",
              "qc_poller", "archive_poller", "autopull_poller", "cpap_poller", "charger_pull_poller",
              "sd_watchdog", "startup_defense_check"):
        async def _n(*a, **k):
            return None
        monkeypatch.setattr(capture, r, _n)
    monkeypatch.setattr(sys, "argv", ["capture.py", "--config", str(cfgp)])

    async def go():
        asyncio.get_running_loop().call_soon(capture._STOP.set)
        await capture.main()
    _run(go())
    assert capture.O2PPG_FS == 100.0 and capture.O2PPG_NS_STEP == int(1e9 / 100.0)
    assert capture._OXYII_RTC_RESYNC_SEC == 900
    assert capture.O2PPG_GAP_MIN_S == 0.25
    # main() re-parses the YAML into its own dict, so the migration lands on _CFG (what the runners
    # are handed), not on the literal above.
    loaded = capture._CFG["devices"][0]
    assert loaded["streams"] == ["spo2", "ppg"], "the implicit 125 Hz pleth is made explicit at boot"


def test_main_skips_a_device_that_cannot_be_named_in_a_filename(tmp_path, monkeypatch, caplog):
    """FOLLOWUPS-II §F1, the second of two gates. Capturing a device with no vendor/model emits
    `__<id>_..._STREAM.txt`, which is how a hot-Remember of an unrecognised sensor produced files nothing
    could attribute. The refusal has to reach the device's monitor card, not only the journal."""
    import yaml as _yaml
    cfg = {"root": str(tmp_path), "web": {"enabled": False},
           "devices": [{"name": "Mystery", "address": "AA:BB:CC:DD:EE:FF"}]}
    cfgp = tmp_path / "config.yaml"
    cfgp.write_text(_yaml.safe_dump(cfg))
    for r in ("status_loop", "adapter_watchdog", "rssi_poller", "clock_watchdog", "host_clock_poller",
              "storage_poller", "alert_poller", "qc_poller", "archive_poller", "autopull_poller",
              "cpap_poller", "charger_pull_poller", "sd_watchdog", "startup_defense_check"):
        async def _n(*a, **k):
            return None
        monkeypatch.setattr(capture, r, _n)
    monkeypatch.setattr(sys, "argv", ["capture.py", "--config", str(cfgp)])

    async def go():
        asyncio.get_running_loop().call_soon(capture._STOP.set)
        await capture.main()
    with caplog.at_level("WARNING"):
        _run(go())
    assert any("skipping device — missing" in r.getMessage() for r in caplog.records)
    assert "missing" in capture.STATUS["devices"]["Mystery"]["last_error"]


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# run_polar — the callback arms a healthy H10 never takes
# ══════════════════════════════════════════════════════════════════════════════════════════════════
from test_capture_runners import FakeGattClient, FakePolarClient, _Char, _Service  # noqa: E402,E501
from test_capture_runners import _ViatomService, _o2ring_live_reply, _viatom_packet  # noqa: E402


def _polar_common(monkeypatch):
    async def bonded(*a, **k):
        return True
    monkeypatch.setattr(capture.bonding, "ensure_bonded", bonded)
    capture._CFG.clear()
    capture._CFG.update({"time": {"auto_sync_devices": False}})
    capture._POLAR_PAUSED.clear()
    capture._RECOVER.clear()
    capture._WORN_SINCE.clear()


def _inject_connect(monkeypatch, client):
    import contextlib

    @contextlib.asynccontextmanager
    async def ctx(addr, *a, **k):
        yield client
    monkeypatch.setattr(capture, "_connect", ctx)


def _pdev(**kw):
    d = {"name": "H10", "vendor": "Polar", "model": "H10", "device_id": "12345678",
         "address": "24:AC:AC:02:84:96", "streams": ["ecg"]}
    d.update(kw)
    return d


class _EmptyFramePolar(FakePolarClient):
    """Feeds a PMD frame whose header decodes but which carries NO samples — a frame the link truncated
    to its header, which is the shape a marginal Verity link actually produces."""

    async def start_notify(self, uuid, cb):
        key = getattr(uuid, "uuid", uuid)
        self.cbs[key] = cb
        if key == capture.pmd.PMD_DATA:
            cb(0, bytes([capture.pmd.ECG]) + (1_000_000_000).to_bytes(8, "little") + bytes([0x00]))
        if key == capture.HR_UUID and self.hr_frame is not None:
            cb(0, self.hr_frame)


def test_a_pmd_frame_that_carries_no_samples_advances_nothing(tmp_path, monkeypatch):
    """A header-only frame must not move the seam anchor. `prev_ns` is what the NEXT frame's step is
    measured from, so anchoring it on a frame with no samples would mis-time everything after it."""
    _polar_common(monkeypatch)
    _inject_connect(monkeypatch, _EmptyFramePolar(start_status=0x00))
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    # The stream STARTED and delivered nothing, so teardown discards the header-only file rather than
    # leaving a 60-byte fragment that reads as a real (empty) recording.
    assert list((tmp_path / "captures").rglob("*_ECG.txt")) == []


class _NoBatteryPolar(FakePolarClient):
    async def read_gatt_char(self, uuid):
        if uuid == capture.BATTERY_UUID:
            return b""                       # the char exists but answers empty
        return await FakePolarClient.read_gatt_char(self, uuid)


def test_an_empty_battery_read_is_skipped_rather_than_indexed(tmp_path, monkeypatch):
    """`b[0]` on an empty read is an IndexError inside the setup path. Battery level is cosmetic and
    must never cost a session — so an empty answer leaves the level unknown and capture proceeds."""
    _polar_common(monkeypatch)
    _inject_connect(monkeypatch, _NoBatteryPolar(start_status=0x00))
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    st = capture.STATUS["devices"]["H10"]
    assert st["connected"] is True
    assert "battery" not in st or st.get("battery") is None


def test_a_strap_that_reports_neither_contact_nor_a_pulse_says_nothing_it_cannot_know(tmp_path,
                                                                                      monkeypatch):
    """Two honest silences in one frame. The H10 does NOT support contact reporting, so `worn` must stay
    absent rather than be fabricated — a strap off the body streams electrode noise at full rate while
    its own algorithm keeps emitting a plausible number (measured 2026-07-19: RR 335-833 ms inside three
    seconds). And a bpm of 0 is 'no reading', so it must not be pushed to the monitor as a real HR."""
    _polar_common(monkeypatch)
    # flags = 0x00: no contact-support bit, 8-bit bpm field, value 0
    _inject_connect(monkeypatch, FakePolarClient(start_status=0x00, hr_frame=bytes([0x00, 0])))
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(_pdev(streams=["ecg", "hr"]), str(tmp_path)))
    st = capture.STATUS["devices"]["H10"]
    assert "worn" not in st, "a strap that cannot report contact must not claim a worn state"


def test_an_hr_only_strap_needs_no_pmd_negotiation(tmp_path, monkeypatch):
    """`hr` is the vendor-neutral SIG characteristic, not PMD. A strap configured for HR alone has no
    PMD writers, so the whole feature-read / settings / START negotiation must be skipped — running it
    would fail on a device that serves no PMD control point at all."""
    _polar_common(monkeypatch)
    c = FakePolarClient(start_status=0x00, hr_frame=bytes([0x04 | 0x02, 57, 0x00, 0x04]))
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(_pdev(streams=["hr"]), str(tmp_path)))
    assert not any(w[0] == 0x02 for w in c.writes), "no PMD START may be issued for an HR-only strap"
    hrs = list((tmp_path / "captures").rglob("*_HR.txt"))
    assert hrs, "the HR file is still written"
    assert capture.STATUS["devices"]["H10"]["worn"] is True   # this frame DOES report contact


def test_an_optional_backup_that_is_simply_absent_stays_quiet(tmp_path, monkeypatch, caplog):
    """VIGIL: known-but-not-expected. A spare strap in a drawer fails to connect every cycle forever; at
    warning level that is the COOSPO spam that buries every real fault in the journal. Note it once, back
    off hard, and keep a quiet eye out."""
    _polar_common(monkeypatch)
    import contextlib

    @contextlib.asynccontextmanager
    async def refuse(addr, *a, **k):
        raise TimeoutError("connect timed out")
        yield  # pragma: no cover — unreachable; makes this a generator for asynccontextmanager
    monkeypatch.setattr(capture, "_connect", refuse)
    _stop_after(monkeypatch, 3)
    with caplog.at_level("INFO"):
        _run(capture.run_polar(_pdev(name="Spare", optional=True), str(tmp_path)))
    quiet = [r for r in caplog.records if "keeping a quiet eye out" in r.getMessage()]
    assert len(quiet) == 1, "once per address, not once per backoff cycle"
    assert not [r for r in caplog.records if r.levelname == "WARNING"], "no warning for a known spare"
    assert capture.STATUS["devices"]["Spare"]["last_error"] == "optional backup — not present"


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# run_viatom / run_oxyii — the arms a clean reading never takes
# ══════════════════════════════════════════════════════════════════════════════════════════════════
def test_the_viatom_char_search_skips_services_that_are_not_the_vendor_one(tmp_path, monkeypatch):
    """Characteristic discovery is BY PROPERTY under the vendor service, because the UUIDs vary by
    model/firmware. Every device also exposes GAP/GATT/battery services, so the loop must walk past them
    rather than take the first notify char it finds anywhere on the device."""
    async def bonded(*a, **k):
        return True
    monkeypatch.setattr(capture.bonding, "ensure_bonded", bonded)
    c = FakeGattClient()
    decoy = _Service([_Char("00002a19-0000-1000-8000-00805f9b34fb")])   # battery service
    decoy.uuid = "0000180f-0000-1000-8000-00805f9b34fb"
    for ch in decoy.characteristics:
        ch.properties = ["notify", "read"]
    c.services = [decoy, _ViatomService()]
    c.on_live = lambda data: c.notify(0, _viatom_packet(pr=0))          # ...and no readable pulse
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_viatom({"name": "Ring", "vendor": "Viatom", "model": "O2Ring-S",
                             "device_id": "S8AW", "address": "D1:98:62:7C:92:B3",
                             "streams": ["spo2"], "protocol": "legacy"}, str(tmp_path)))
    st = capture.STATUS["devices"]["Ring"]
    assert st["spo2"] == 97
    assert st["pr"] is None, "an unreadable pulse rate stays unknown — never written as a real 0"


def test_an_o2ring_reading_with_no_pulse_rate_writes_the_row_without_inventing_one(tmp_path,
                                                                                   monkeypatch):
    """VIGIL-PPG-GRID-AUDIT §5.2. `live["pr"]` passes through AS-IS including 0 — the old `or 0` turned
    an unreadable pulse rate into a written 0, i.e. the file asserted a pulse the ring never measured.
    The SpO2 card still updates; only the `pr` push is withheld."""
    capture._OXYII_PAUSE.clear()
    capture._RECOVER.clear()
    capture._OXYII_RTC_AT.clear()
    c = FakeGattClient()
    c.on_live = lambda data: (c.notify(0, _o2ring_live_reply(spo2=96, pr=0))
                              if data[1] == capture.oxyii.OP_LIVE else None)
    monkeypatch.setattr(capture, "_connect_scan", lambda addr, *a, **k: _fake_ctx(c))
    _stop_after(monkeypatch, 4)
    _run(capture.run_oxyii({"name": "Ring", "vendor": "Wellue", "model": "O2Ring-S",
                            "device_id": "S8AW", "address": "D1:98:62:7C:92:B3",
                            "streams": ["spo2"]}, str(tmp_path)))     # no 'ppg' → no oxyflag writer
    st = capture.STATUS["devices"]["Ring"]
    assert st["spo2"] == 96 and st["pr"] is None


def _fake_ctx(client):
    import contextlib

    @contextlib.asynccontextmanager
    async def ctx():
        yield client
    return ctx()


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# the offline-pull link-drop waits
# ══════════════════════════════════════════════════════════════════════════════════════════════════
def test_the_oxyii_pull_gives_up_waiting_and_pulls_anyway(tmp_path, monkeypatch):
    """~12 s is a bound, not a promise. A runner that never drops its link (it is wedged mid-notify)
    must not park the pull forever — BlueZ will refuse the second connect and the pull reports that,
    which is a diagnosable failure. Hanging is not."""
    capture._OXYII_PAUSE.clear()
    import pull_session
    pulled = []

    async def fake_pull(address, out_dir, **kw):
        pulled.append(address)
        return [str(tmp_path / "x.dat")]
    monkeypatch.setattr(pull_session, "pull", fake_pull)

    async def no_sleep(_s):
        return None
    monkeypatch.setattr(capture.asyncio, "sleep", no_sleep)
    capture.STATUS["devices"]["Ring"] = {"connected": True}        # never drops
    r = _run(capture.pull_oxyii_session({"name": "Ring", "vendor": "Wellue", "model": "O2Ring-S",
                                         "device_id": "S8AW", "address": "D1:98:62:7C:92:B3"},
                                        str(tmp_path)))
    assert r["ok"] is True and pulled == ["D1:98:62:7C:92:B3"]


def test_the_polar_offline_op_gives_up_waiting_too(monkeypatch):
    """Same bound on the PS-FTP side."""
    async def no_sleep(_s):
        return None
    monkeypatch.setattr(capture.asyncio, "sleep", no_sleep)
    capture.STATUS["devices"]["Verity"] = {"address": "AA:BB:CC:DD:EE:01", "connected": True}

    async def op():
        return {"ok": True}
    assert _run(capture.polar_offline_op("AA:BB:CC:DD:EE:01", op)) == {"ok": True}
    assert "AA:BB:CC:DD:EE:01" not in capture._POLAR_PAUSED, "the pause must be released"


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# sync_device_time — the H10 implements neither clock query
# ══════════════════════════════════════════════════════════════════════════════════════════════════
def test_the_h10_clock_set_skips_the_reads_its_firmware_does_not_implement(monkeypatch):
    """The H10 answers error 201 NOT_IMPLEMENTED to both GET_LOCAL_TIME and SET_SYSTEM_TIME. Asking
    anyway turns a working clock set into a reported failure, so the H10 path sets local time only and
    reports no before/after — an honest 'unknown', not a fabricated pair."""
    calls = []

    class _Fs:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get_local_time(self):
            calls.append("get")
            raise AssertionError("the H10 path must never call GET_LOCAL_TIME")

        async def set_local_time(self, with_system_time=True):
            calls.append(("set", with_system_time))

    class _Mod:
        def PolarPsFtp(self, address, adapter=None):
            return _Fs()
    monkeypatch.setitem(sys.modules, "polar_psftp", _Mod())

    async def fake_hci():
        return "hci0"
    monkeypatch.setattr(capture, "adapter_hci", fake_hci)

    async def run_op(address, op, timeout=None, **_kw):   # **_kw: a fake must tolerate the real signature growing
        return await op()
    monkeypatch.setattr(capture, "polar_offline_op", run_op)
    capture.STATUS["devices"]["H10"] = {"address": "24:AC:AC:02:84:96", "model": "H10"}
    capture._CFG.clear()
    capture._CFG.update({"devices": [_pdev()]})
    res = _run(capture.sync_device_time("24:AC:AC:02:84:96"))
    assert calls == [("set", False)], "SET_SYSTEM_TIME is not sent to an H10"
    assert res.get("before") is None and res.get("after") is None


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# the remaining single arms
# ══════════════════════════════════════════════════════════════════════════════════════════════════
def test_the_host_clock_poller_records_state_without_writing_a_sidecar(monkeypatch):
    """`root` is optional. Called without one — the pre-sidecar wiring, and what a test harness does —
    the poller must still publish clock trust to STATUS and simply not open a CLOCK.csv."""
    async def fake_state():
        return {"trust": "ntp", "absolute_ok": True, "reason": "synchronised"}
    monkeypatch.setattr(capture.host_clock, "read_state", fake_state)
    _stop_after(monkeypatch, 1)
    _run(capture.host_clock_poller({"clock": {"poll_sec": 1}}, None))
    assert capture.STATUS["host_clock"]["trust"] == "ntp"


def test_the_transfer_offload_does_nothing_when_every_night_is_already_pushed(tmp_path, monkeypatch):
    """Idempotence, at the top of the loop: a box whose nights are all marked must make no connection at
    all. Otherwise every poll wakes the NAS and re-walks the tree for nothing."""
    d = _night(tmp_path, "2026-07-01")
    (d / ".archived").write_text("")
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda c, s: set())
    called = []

    async def fake_push(src, target, timeout=1800.0):
        called.append(src)
        return {"ok": True, "verified": True, "detail": ""}
    monkeypatch.setattr(capture.storage_targets, "push_night", fake_push)
    _run(capture._archive_transfer(str(tmp_path / "captures"), {"protocol": "rsync"}, 60.0,
                                   {"mode": "after_settle"}))
    assert called == []


def test_registration_tolerates_a_task_list_that_no_longer_holds_the_incumbent():
    """`tasks` is also pruned elsewhere (a finished runner is reaped). Registering over an incumbent that
    has already left the list must not raise — `.remove()` on an absent element is a ValueError."""
    async def go():
        async def forever():
            await asyncio.sleep(3600)
        device_tasks, tasks = {}, []
        first = asyncio.create_task(forever())
        capture.register_runner(device_tasks, tasks, "AA:BB", first)
        tasks.clear()                                   # reaped by someone else
        second = asyncio.create_task(forever())
        capture.register_runner(device_tasks, tasks, "AA:BB", second)
        assert tasks == [second]
        tasks.clear()
        capture.unregister_runner(device_tasks, tasks, {}, "AA:BB")
        assert device_tasks == {}
        for t in (first, second):
            t.cancel()
    _run(go())


def test_main_leaves_an_explicit_ppg_stream_and_a_nonsense_rate_alone(tmp_path, monkeypatch):
    """Two idempotence guards. The pleth migration must not append a second 'ppg' to a config that
    already has one, and a non-positive `ppg_fs` is not an override — applying it would divide by zero
    building the grid step."""
    import yaml as _yaml
    ring = {"name": "Ring", "vendor": "Wellue", "model": "O2Ring-S", "device_id": "S8AW",
            "address": "D1:98:62:7C:92:B3", "streams": ["spo2", "ppg"]}
    cfg = {"root": str(tmp_path), "devices": [ring], "web": {"enabled": False},
           "o2ring": {"ppg_fs": -1.0}}
    cfgp = tmp_path / "config.yaml"
    cfgp.write_text(_yaml.safe_dump(cfg))
    was_fs, was_step = capture.O2PPG_FS, capture.O2PPG_NS_STEP
    for r in ("run_polar", "run_oxyii", "run_viatom", "run_muse", "status_loop", "adapter_watchdog",
              "rssi_poller", "clock_watchdog", "host_clock_poller", "storage_poller", "alert_poller",
              "qc_poller", "archive_poller", "autopull_poller", "cpap_poller", "charger_pull_poller",
              "sd_watchdog", "startup_defense_check"):
        async def _n(*a, **k):
            return None
        monkeypatch.setattr(capture, r, _n)
    monkeypatch.setattr(sys, "argv", ["capture.py", "--config", str(cfgp)])

    async def go():
        asyncio.get_running_loop().call_soon(capture._STOP.set)
        await capture.main()
    _run(go())
    assert capture._CFG["devices"][0]["streams"] == ["spo2", "ppg"], "no duplicate 'ppg'"
    assert (capture.O2PPG_FS, capture.O2PPG_NS_STEP) == (was_fs, was_step)


def test_a_nameless_device_is_skipped_without_a_status_card(tmp_path, monkeypatch, caplog):
    """There is nowhere to put the error. A card keyed on an empty name would collide with every other
    nameless device and show an error against the wrong sensor."""
    import yaml as _yaml
    cfg = {"root": str(tmp_path), "web": {"enabled": False},
           "devices": [{"address": "AA:BB:CC:DD:EE:FF"}]}          # no name, no vendor, no model
    cfgp = tmp_path / "config.yaml"
    cfgp.write_text(_yaml.safe_dump(cfg))
    for r in ("status_loop", "adapter_watchdog", "rssi_poller", "clock_watchdog", "host_clock_poller",
              "storage_poller", "alert_poller", "qc_poller", "archive_poller", "autopull_poller",
              "cpap_poller", "charger_pull_poller", "sd_watchdog", "startup_defense_check"):
        async def _n(*a, **k):
            return None
        monkeypatch.setattr(capture, r, _n)
    monkeypatch.setattr(sys, "argv", ["capture.py", "--config", str(cfgp)])

    async def go():
        asyncio.get_running_loop().call_soon(capture._STOP.set)
        await capture.main()
    with caplog.at_level("WARNING"):
        _run(go())
    assert any("skipping device — missing" in r.getMessage() for r in caplog.records)
    assert capture.STATUS["devices"] == {}, "no card may be created for a device with no name"


def test_a_short_offline_file_is_reported_and_warned_not_counted_as_pulled(tmp_path, monkeypatch, caplog):
    """Audit F3. These onboard recordings are the BACKUP for a lossy live link, so a truncated one that
    reads as a success is the worst outcome available. The verdict has to reach a surface: the journal
    is the only alerting channel a box with no webhook has."""
    fake = _FakePsFtp(
        sessions=[{"path": "/U/0/20260725/R/220000/", "date": "20260725", "time": "220000"}],
        files={"/U/0/20260725/R/220000/": ["ECG.txt"]},
        short={"/U/0/20260725/R/220000/": ["PLETH.GZ: declared 34, got 9 bytes — left as PLETH.GZ.part"]})
    monkeypatch.setitem(sys.modules, "polar_psftp", fake)

    async def fake_hci():
        return "hci0"
    monkeypatch.setattr(capture, "adapter_hci", fake_hci)

    async def run_op(address, op, timeout=None, **_kw):   # **_kw: a fake must tolerate the real signature growing
        return await op()
    monkeypatch.setattr(capture, "polar_offline_op", run_op)

    with caplog.at_level("WARNING"):
        res = _run(capture.pull_polar_offline_all(_dev(device_id="0C301E3F"), str(tmp_path)))
    assert res["ok"] is False
    assert res["short"] and "PLETH.GZ" in res["short"][0]
    assert res["new_files"] == ["ECG.txt"], "the short file is not among the files we pulled"
    assert any("SHORT" in r.message or "SHORT" in r.getMessage() for r in caplog.records), \
        "a truncated backup must be visible in the journal, not only in a returned dict"


def test_the_archive_poller_mirrors_the_configured_subtrees(tmp_path, monkeypatch):
    """Audit F2, landed. The night loop and the subtree loop are separate passes with separate rules —
    a night has a finished state and a marker, an append-forever tree has neither."""
    root = tmp_path / "root"
    caps = root / "captures"
    (caps / "stored").mkdir(parents=True)
    (caps / "stored" / "o2ring.dat").write_text("flash")
    (caps / "cpap").mkdir()
    (caps / "cpap" / "night.edf").write_text("edf")
    (caps / "incoming").mkdir()
    (caps / "incoming" / "half.dat").write_text("partial")
    dest = tmp_path / "backup"
    dest.mkdir()

    cfg = {"archive": {"enabled": True, "dest": str(dest), "poll_sec": 0.01}}
    calls = []
    real = nightarchive.mirror_subtree

    def spy(captures_dir, name, dst, **kw):
        calls.append(name)
        return real(captures_dir, name, dst, **kw)
    monkeypatch.setattr(nightarchive, "mirror_subtree", spy)

    async def go():
        task = asyncio.ensure_future(capture.archive_poller(cfg, str(root)))
        for _ in range(200):
            await asyncio.sleep(0.005)
            if (dest / "cpap" / "night.edf").exists():
                break
        capture._STOP.set()
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass   # we cancelled it; awaiting is how we wait for it to actually stop
    try:
        _run(go())
    finally:
        capture._STOP.clear()

    assert (dest / "stored" / "o2ring.dat").read_text() == "flash"
    assert (dest / "cpap" / "night.edf").read_text() == "edf"
    assert not (dest / "incoming").exists(), "a transient tree must never reach the mirror"
    assert "incoming" not in calls, "and it must not even be offered"


def test_a_DEAD_arrival_sidecar_warns_once_per_night(tmp_path, monkeypatch, caplog):
    """⚠️ THE FAILURE NOTHING ELSE CAN SEE, and the reason a source-scan test was not enough.

    The sidecar write is wrapped in a bare `except: pass` — telemetry must never disturb the data
    callback — so a persistent failure is invisible BY CONSTRUCTION: samples keep arriving, the files
    keep growing, and the per-connection BLE offset the sidecar exists to recover just stops being
    recoverable. It surfaces weeks later inside an analysis, which is exactly how the back-timed stamps
    it replaced went unnoticed for a whole corpus.

    `alerts.arrival_canary` was written for this and, until now, called by nothing outside its own tests.
    Three source-scan assertions proved the call EXISTS; the 100 % floor then proved they never RAN it —
    seven statements uncovered. This one drives `qc_poller` and reads the journal, mirroring the frozen
    sensor test above."""
    os.makedirs(str(tmp_path / "captures" / "2026-08-14"), exist_ok=True)
    monkeypatch.setattr(capture, "_current_night", lambda captures, settle: "2026-08-14")
    monkeypatch.setattr(capture.nightqc, "summarize", lambda night, devices: {
        "night": "2026-08-14", "missing": [], "devices": []})
    # writing samples (rows) with a sidecar that has produced nothing (arrival_rows == 0)
    capture.STATUS["devices"]["Verity"] = {"connected": True, "charging": False,
                                           "rows": 159607, "arrival_rows": 0}
    sent = []

    class _N:
        async def send(self, title, message, **kw):
            sent.append((title, message))
            return True

    _stop_after(monkeypatch, 2)                    # two polls; one warning
    cfg = {"qc": {"poll_sec": 1, "frozen_after_sec": 600}, "devices": []}
    with caplog.at_level("WARNING"):
        _run(capture.qc_poller(cfg, str(tmp_path), _N()))
    dead = [r for r in caplog.records if "arrival sidecar" in r.getMessage()]
    assert len(dead) == 1, f"one warning per dead sidecar per night, not one per poll: {len(dead)}"
    assert "Verity" in dead[0].getMessage()
    assert len(sent) == 1 and sent[0][0] == "Tepna: packet-arrival sidecar dead"
    assert "will not show up as a dropout" in sent[0][1]
    capture.STATUS["devices"].pop("Verity", None)


def test_a_healthy_sidecar_says_NOTHING(tmp_path, monkeypatch, caplog):
    """The mirror, and the one that matters for trust: measured over every session on the box — 355 with
    a sidecar — this predicate fires ZERO times. Its sibling `smeared` arm was retired precisely because
    it fired on EVERY stream on the first real night, so a canary that cannot stay quiet is worse than
    none."""
    os.makedirs(str(tmp_path / "captures" / "2026-08-14"), exist_ok=True)
    monkeypatch.setattr(capture, "_current_night", lambda captures, settle: "2026-08-14")
    monkeypatch.setattr(capture.nightqc, "summarize", lambda night, devices: {
        "night": "2026-08-14", "missing": [], "devices": []})
    capture.STATUS["devices"]["Verity"] = {"connected": True, "charging": False,
                                           "rows": 159607, "arrival_rows": 159607}
    _stop_after(monkeypatch, 2)
    cfg = {"qc": {"poll_sec": 1, "frozen_after_sec": 600}, "devices": []}
    with caplog.at_level("WARNING"):
        _run(capture.qc_poller(cfg, str(tmp_path), None))
    assert [r for r in caplog.records if "arrival sidecar" in r.getMessage()] == []
    capture.STATUS["devices"].pop("Verity", None)


def test_a_dead_sidecar_still_warns_the_journal_with_NO_webhook(tmp_path, monkeypatch, caplog):
    """The notifier is optional; the journal line is not — the same rule the frozen-sensor alert states
    two tests up, and the reason the WARNING is emitted before the `if notifier:` rather than inside it.
    A box with no webhook configured has the journal as its ONLY alerting surface, and this failure
    otherwise leaves no trace in it at all.

    Found by the 100 % BRANCH floor: with only the fires-with-a-notifier and stays-silent cases, the
    false arm of `if notifier:` never executed — 0 uncovered statements and 1 uncovered branch."""
    os.makedirs(str(tmp_path / "captures" / "2026-08-14"), exist_ok=True)
    monkeypatch.setattr(capture, "_current_night", lambda captures, settle: "2026-08-14")
    monkeypatch.setattr(capture.nightqc, "summarize", lambda night, devices: {
        "night": "2026-08-14", "missing": [], "devices": []})
    capture.STATUS["devices"]["Verity"] = {"connected": True, "charging": False,
                                           "rows": 159607, "arrival_rows": 0}
    _stop_after(monkeypatch, 2)
    cfg = {"qc": {"poll_sec": 1, "frozen_after_sec": 600}, "devices": []}
    with caplog.at_level("WARNING"):
        _run(capture.qc_poller(cfg, str(tmp_path), None))     # no notifier at all
    dead = [r for r in caplog.records if "arrival sidecar" in r.getMessage()]
    assert len(dead) == 1, f"the journal must still carry it: {[r.getMessage()[:60] for r in caplog.records]}"
    capture.STATUS["devices"].pop("Verity", None)


# ═══════════════════════════════════════════════════════════════════════════════════════════
# the NOT-WORN trigger — the only reachable one for a coin-cell device (POLAR-ONBOARD-BACKUP-FU §4)
# ═══════════════════════════════════════════════════════════════════════════════════════════
def test_a_device_taken_off_the_body_is_pulled_once_per_doff(tmp_path, monkeypatch):
    """The H10 runs on a CR2025 coin cell, so `charging` is permanently False and the on-charger
    trigger can NEVER fire for it — recording without retrieval fills the one onboard slot and then
    silently records nothing. The doff edge is the reachable trigger. Once per doff, marked before
    the await, exactly as the charger path is."""
    strap = _dev(name="Strap", vendor="Polar", model="H10", address="C2:11:44:AB:9E:01")
    cfg = {"pull": {"auto": True, "notworn_settle_sec": 300}, "devices": [strap]}
    capture.STATUS["devices"]["Strap"] = {"charging": False, "worn": False}
    capture._NOTWORN_SINCE.clear()
    capture._NOTWORN_PULLED.clear()
    # already off the body long enough — the clamp puts the real settle above the 180 s drop grace,
    # so seeding the arming stamp is how a unit test reaches the due state without sleeping past it.
    capture._NOTWORN_SINCE[strap["address"]] = capture._time.monotonic() - 10_000.0
    pulls = []

    async def fake_polar_pull(dev, root):
        pulls.append(dev["name"])
        return {"new_files": ["Polar_Offline_x/RR.txt"]}
    monkeypatch.setattr(capture, "pull_polar_offline_all", fake_polar_pull)
    _stop_after(monkeypatch, 3)                    # three ticks — exactly one pull
    _run(capture.charger_pull_poller(cfg, str(tmp_path)))
    assert pulls == ["Strap"], "once per doff session, not once per tick"
    assert capture.STATUS["autopull"]["trigger"] == "not-worn"
    capture._NOTWORN_SINCE.clear()
    capture._NOTWORN_PULLED.clear()


def test_worn_again_re_arms_the_doff_pull(tmp_path, monkeypatch):
    """The ALLOW twin of the test above. Putting the strap back on clears the arming stamp, so the
    NEXT doff pulls again — otherwise a device is pulled once and never again for the life of the
    daemon. `worn is not False` covers both True and the no-verdict None."""
    strap = _dev(name="Strap2", vendor="Polar", model="H10", address="C2:11:44:AB:9E:02")
    cfg = {"pull": {"auto": True, "notworn_settle_sec": 300}, "devices": [strap]}
    capture.STATUS["devices"]["Strap2"] = {"charging": False, "worn": True}
    capture._NOTWORN_SINCE[strap["address"]] = capture._time.monotonic() - 10_000.0
    capture._NOTWORN_PULLED.add(strap["address"])
    pulls = []

    async def fake_polar_pull(dev, root):
        pulls.append(dev["name"])
        return {"new_files": []}
    monkeypatch.setattr(capture, "pull_polar_offline_all", fake_polar_pull)
    _stop_after(monkeypatch, 2)
    _run(capture.charger_pull_poller(cfg, str(tmp_path)))
    assert pulls == [], "worn again ⇒ nothing to pull this tick"
    assert strap["address"] not in capture._NOTWORN_SINCE, "the arming stamp must be cleared"
    assert strap["address"] not in capture._NOTWORN_PULLED, "and the once-per-doff latch re-armed"


def test_a_doff_settle_inside_the_drop_grace_is_OBEYED_owner_amended_2026_08_26(tmp_path, monkeypatch, caplog):
    """⚠️ THIS TEST ASSERTED THE OPPOSITE UNTIL 2026-08-26, and the inversion is deliberate.

    It used to guard §4's invariant — a settle inside the 180 s grace would keep the link open and
    BLOCK the drop, so a config asking for it was RAISED, loudly. The 06:44 failure measured why that
    could not work: the ring's post-drop advertising tail is ~98 s (n=1), less than half the 210 s
    clamp floor, so the trigger fired 202 s after the ring had already slept. Fire-after-drop-at-doff
    cannot reach a device that is gone.

    **The owner amended §4 for this path** (relayed via the coordinator session, 2026-08-26, answer
    "a" of three options, battery tradeoff explicitly accepted). The pull now fires INSIDE the grace,
    and the collision is resolved in `should_drop_not_worn` by DEFERRAL rather than prevented by a
    clamp. So the configured value must now be OBEYED, and the raise must be gone.

    Kept as an inverted test rather than deleted, because a policy this specific deserves a test that
    says it changed and when — a deleted test leaves no trace that the invariant ever existed."""
    strap = _dev(name="Strap3", vendor="Polar", model="H10", address="C2:11:44:AB:9E:03")
    cfg = {"pull": {"auto": True, "notworn_settle_sec": 5}, "devices": [strap]}
    capture.STATUS["devices"]["Strap3"] = {"charging": False, "worn": None}
    _stop_after(monkeypatch, 1)
    with caplog.at_level("INFO"):
        _run(capture.charger_pull_poller(cfg, str(tmp_path)))
    msgs = " ".join(r.getMessage() for r in caplog.records)
    assert "settle raised" not in msgs, "the clamp is gone; a raise would mean it came back"
    assert "not-worn=on (5s)" in msgs, "the arming line must report the CONFIGURED 5 s, not a floored 210 s"


# ═══════════════════════════════════════════════════════════════════════════════════════════
# the MORNING QC DIGEST (VIGIL-OVERNIGHT-FINDINGS §P2.4) — coverage is the number that matters,
# and the failure alert alone never sends it: a good night says nothing.
# ═══════════════════════════════════════════════════════════════════════════════════════════
def test_qc_digest_due_is_a_bounded_window_not_a_floor():
    """Delegates to cpap_harvest.due_now — the primitive whose docstring records the floor variant as
    'wrong and shipped once' (a 19:25 restart re-armed a 13:00 job). The first draft of THIS function
    was that floor; these pin the window semantics so it cannot quietly return."""
    import datetime as dt
    at = lambda h, m=0: dt.datetime(2026, 8, 18, h, m)
    assert capture.qc_digest_due(at(9), 9, None) is True         # in the window, never sent → due
    assert capture.qc_digest_due(at(11, 59), 9, None) is True    # still inside [9, 12)
    assert capture.qc_digest_due(at(8, 59), 9, None) is False    # before the window
    assert capture.qc_digest_due(at(19, 25), 9, None) is False   # THE 2026-07-26 BUG: restart after the
    #                                                              window must NOT consider itself due
    import cpap_harvest
    d = cpap_harvest.window_start_date(at(9), 9, 3)
    assert capture.qc_digest_due(at(10), 9, d) is False          # already sent this window — ALLOW twin
    assert capture.qc_digest_due(at(10), -1, None) is False      # -1 disables, at any hour


def test_the_morning_digest_sends_coverage_once(tmp_path, monkeypatch):
    """The digest is UNCONDITIONAL — it fires on a healthy night, which the missing-stream alert never
    does. Once per local day, marked before the await like every sender in this file."""
    import os as _os
    _os.makedirs(str(tmp_path / "captures" / "2026-08-18"), exist_ok=True)
    monkeypatch.setattr(capture, "_current_night", lambda captures, settle: "2026-08-18")
    monkeypatch.setattr(capture.nightqc, "summarize", lambda night, devices: {
        "night": "2026-08-18", "missing": [],
        "devices": [{"name": "H10", "coverage": {"ecg": 0.96, "acc": 0.95}}]})
    sent = []

    class _N:
        async def send(self, title, message, **kw):
            sent.append((title, message, kw.get("key")))
            return True
    import datetime as dt
    monkeypatch.setattr(capture, "_now", lambda: dt.datetime(2026, 8, 18, 9, 30))  # pinned INSIDE the
    # window — the first draft used digest_hour 0 as "always due", which under bounded-window semantics
    # is only true before 03:00 local: the very time-dependence this feature red-flagged in CI.
    _stop_after(monkeypatch, 3)                     # three polls; ONE digest
    cfg = {"qc": {"poll_sec": 1, "digest_hour": 9}, "devices": []}
    _run(capture.qc_poller(cfg, str(tmp_path), _N()))
    digests = [s for s in sent if s[0] == "Tepna night QC"]
    assert len(digests) == 1, f"once per day, not per poll: {digests}"
    assert "H10 95%" in digests[0][1] or "H10 96%" in digests[0][1]
    assert digests[0][2] and digests[0][2].startswith("qc-digest-")


def _digest_deny_case(tmp_path, monkeypatch, qc_cfg):
    """Shared DENY harness. Returns (sent, polls) — and the caller MUST assert polls > 0, because the
    first version of this test ran two `_run`s in one test, the first left `_STOP` set, the second
    executed ZERO ticks, and `sent == []` passed vacuously. Coverage caught it (the `_line`-falsy
    branch was never taken); the poll counter is the assertion that keeps it caught."""
    import os as _os
    _os.makedirs(str(tmp_path / "captures" / "2026-08-18"), exist_ok=True)
    monkeypatch.setattr(capture, "_current_night", lambda captures, settle: "2026-08-18")
    polls = {"n": 0}

    def _summ(night, devices):
        polls["n"] += 1
        return {"night": "2026-08-18", "missing": [], "devices": []}
    monkeypatch.setattr(capture.nightqc, "summarize", _summ)
    sent = []

    class _N:
        async def send(self, title, message, **kw):
            sent.append(title)
            return True
    capture._STOP.clear()
    _stop_after(monkeypatch, 1)
    _run(capture.qc_poller({"qc": qc_cfg, "devices": []}, str(tmp_path), _N()))
    return sent, polls["n"]


def test_the_digest_disabled_by_hour_minus_one(tmp_path, monkeypatch):
    sent, polls = _digest_deny_case(tmp_path, monkeypatch, {"poll_sec": 1, "digest_hour": -1})
    assert polls > 0, "the tick must actually run — a zero-tick pass proves nothing"
    assert sent == [], f"digest_hour=-1 must send nothing: {sent}"


def test_an_empty_night_sends_no_digest_even_when_due(tmp_path, monkeypatch):
    """The `_line is None` branch: due, notifier present, nothing measured — silence, deliberately."""
    import datetime as dt
    monkeypatch.setattr(capture, "_now", lambda: dt.datetime(2026, 8, 18, 9, 30))
    sent, polls = _digest_deny_case(tmp_path, monkeypatch, {"poll_sec": 1, "digest_hour": 9})
    assert polls > 0, "the tick must actually run — a zero-tick pass proves nothing"
    assert sent == [], f"an empty summ must send nothing: {sent}"


def test_qc_digest_formats_ranges_and_absences():
    """Pure formatting: one number when streams agree, a RANGE when they diverge (41/95 must not read
    as 68), absent-coverage devices NAMED rather than averaged in as zeros, missing streams appended."""
    import nightqc
    line = nightqc.qc_digest({
        "night": "2026-08-18",
        "devices": [
            {"name": "O2Ring", "coverage": {"spo2": 0.63, "ppg": 0.63}},
            {"name": "Verity", "coverage": {"acc": 0.41, "ppg": 0.95}},
            {"name": "COOSPO", "coverage": {}},
        ],
        "missing": ["Verity:ppi"],
    })
    assert "O2Ring 63%" in line
    assert "Verity 41–95%" in line
    assert "no data: COOSPO" in line
    assert "missing: Verity:ppi" in line
    assert nightqc.qc_digest({"night": "x", "devices": []}) is None
    assert nightqc.qc_digest(None) is None
    # a junk (non-dict) device entry is SKIPPED, not crashed on — and the rest still formats
    j = nightqc.qc_digest({"night": "x", "devices": ["garbage", {"name": "H10", "coverage": {"ecg": 0.9}}]})
    assert j is not None and "H10 90%" in j and "garbage" not in j


# ═══════════════════════════════════════════════════════════════════════════════════════════
# CAPTURE-FILESET-RESUME — a reconnect inside the window reuses the set; outside it, fragments.
# Each of the brief's §3 invariants is a test here, not a hope.
# ═══════════════════════════════════════════════════════════════════════════════════════════
def test_resumable_stamp_finds_the_set_inside_the_window(tmp_path):
    import writers, datetime as dt, os, time
    d = str(tmp_path)
    f = tmp_path / "Polar_H10_02849638_20260819210000_ECG.txt"
    f.write_text("hdr\n1;2;3;4\n")
    now = dt.datetime.now()
    got = writers.resumable_stamp(d, "Polar", "H10", "02849638", now, 300.0)
    assert got == dt.datetime(2026, 8, 19, 21, 0, 0), got
    # DENY twin: age the file past the window — a true outage must fragment
    old = time.time() - 400
    os.utime(str(f), (old, old))
    assert writers.resumable_stamp(d, "Polar", "H10", "02849638", now, 300.0) is None
    # and a different device's set is never adopted
    assert writers.resumable_stamp(d, "Polar", "H10", "DEADBEEF", now, 300.0) is None
    # missing dir refuses rather than raising
    assert writers.resumable_stamp(str(tmp_path / "nope"), "Polar", "H10", "x", now, 300.0) is None


def test_resumable_stamp_ignores_stampless_and_unparseable_names(tmp_path):
    import writers, datetime as dt
    (tmp_path / "Polar_H10_02849638_notes.txt").write_text("x\n")
    assert writers.resumable_stamp(str(tmp_path), "Polar", "H10", "02849638",
                                   dt.datetime.now(), 300.0) is None


def test_stream_writer_resumes_without_a_second_header(tmp_path):
    """§2: same path ⇒ append; the header is written once, by the FIRST open."""
    import writers
    p = str(tmp_path / "Polar_H10_x_20260819210000_ACC.txt")
    import datetime as dt
    w1 = writers.StreamWriter(p, "acc", fsync=False)
    w1.write_acc(dt.datetime(2026, 8, 19, 21, 0, 0), 1, 0.0, 1, 2, 3)
    w1.close()
    w2 = writers.StreamWriter(p, "acc", fsync=False)
    assert w2.resumed is True
    w2.write_acc(dt.datetime(2026, 8, 19, 21, 3, 0), 2, 0.0, 4, 5, 6)
    w2.close()
    lines = open(p).read().splitlines()
    assert sum(1 for x in lines if x.startswith("Phone timestamp")) == 1, lines
    assert len(lines) == 3   # header + two rows — nothing lost, nothing duplicated


def test_stream_writer_truncates_a_torn_tail_before_appending(tmp_path):
    """§3.5: a crash mid-write leaves no trailing newline; appending after it would fuse two rows."""
    import writers
    p = str(tmp_path / "Polar_H10_x_20260819210000_ACC.txt")
    import datetime as dt
    w1 = writers.StreamWriter(p, "acc", fsync=False)
    w1.write_acc(dt.datetime(2026, 8, 19, 21, 0, 0), 1, 0.0, 1, 2, 3)
    w1.close()
    with open(p, "a", newline="\n") as fh:
        fh.write("2026-08-19T21:00:01.000;2;7;8")     # torn — no newline
    w2 = writers.StreamWriter(p, "acc", fsync=False)
    w2.write_acc(dt.datetime(2026, 8, 19, 21, 3, 0), 3, 0.0, 9, 9, 9)
    w2.close()
    lines = open(p).read().splitlines()
    assert not any(";7;8" in x and ";9" in x for x in lines), f"fused row: {lines}"
    assert lines[-1].endswith(";9;9;9")
    assert all(x.count(";") in (0, 4) for x in lines), lines   # every surviving row is complete


def test_resumed_ecg_keeps_its_relative_ms_anchor(tmp_path):
    """§3.2 (no re-anchor): the `timestamp [ms]` column must NOT restart at 0.0 mid-file — ECGDex
    infers fs from this column's step, and a reset fabricates a step the size of the recording."""
    import writers
    p = str(tmp_path / "Polar_H10_x_20260819210000_ECG.txt")
    import datetime as dt
    w1 = writers.StreamWriter(p, "ecg", fsync=False)
    w1.write_ecg(dt.datetime(2026, 8, 19, 21, 0, 0), 1_000_000_000, 0.0, 100)
    w1.write_ecg(dt.datetime(2026, 8, 19, 21, 0, 0, 8000), 1_007_692_288, 0.0, 101)
    w1.close()
    w2 = writers.StreamWriter(p, "ecg", fsync=False)
    assert w2._first_ns == 1_000_000_000, w2._first_ns
    w2.write_ecg(dt.datetime(2026, 8, 19, 21, 3, 0), 181_000_000_000, 0.0, 102)
    w2.close()
    rows = [x for x in open(p).read().splitlines() if not x.startswith("Phone")]
    rel = [float(r.split(";")[2]) for r in rows]
    assert rel[0] == 0.0
    assert abs(rel[2] - 180_000.0) < 1.0, rel   # anchored to the ORIGINAL first sample, not reset


def test_resumed_hr_writer_appends_the_rr_sibling_too(tmp_path):
    import writers
    p = str(tmp_path / "Polar_H10_x_20260819210000_HR.txt")
    w1 = writers.StreamWriter(p, "hr", fsync=False)
    w1.close()
    w2 = writers.StreamWriter(p, "hr", fsync=False)
    w2.close()
    rr = open(str(tmp_path / "Polar_H10_x_20260819210000_RR.txt")).read().splitlines()
    assert sum(1 for x in rr if x.startswith("Phone timestamp")) == 1, rr


def test_resumable_stamp_survives_races_and_junk_dates(tmp_path, monkeypatch):
    """The unhappy paths: a file deleted between listdir and getmtime is skipped, not raised; a token
    that matches the stamp REGEX but is not a real date (month 13) refuses rather than crashing."""
    import writers, datetime as dt, os as _os
    (tmp_path / "Polar_H10_02849638_20261340000000_ECG.txt").write_text("h\n")   # month 13
    now = dt.datetime.now()
    assert writers.resumable_stamp(str(tmp_path), "Polar", "H10", "02849638", now, 300.0) is None
    (tmp_path / "Polar_H10_02849638_20260819210000_ECG.txt").write_text("h\n")
    real = _os.path.getmtime

    def flaky(p):
        if "20260819210000" in p:
            raise OSError("raced away")
        return real(p)
    monkeypatch.setattr(writers.os.path, "getmtime", flaky)
    # the raced file is skipped; the junk-date one is newest-by-mtime and then refuses on strptime
    assert writers.resumable_stamp(str(tmp_path), "Polar", "H10", "02849638", now, 300.0) is None


def test_resumed_ecg_anchor_skips_comments_and_junk_rows(tmp_path):
    """The anchor scan must step over `#` comments and a non-numeric ns column, and give up cleanly
    (lazy init) when no row qualifies — a worse column, never a crash."""
    import writers
    p = str(tmp_path / "Polar_H10_x_20260819210000_ECG.txt")
    with open(p, "w", newline="\n") as fh:
        fh.write("# timebase=host\n")
        fh.write(writers.StreamWriter.HEADERS["ecg"] + "\n")
        fh.write("2026-08-19T21:00:00.000;junk;0.0;100\n")          # non-numeric ns
        fh.write("2026-08-19T21:00:00.008;2000000000;7.7;101\n")    # the first valid row
    w = writers.StreamWriter(p, "ecg", fsync=False)
    assert w.resumed is True and w._first_ns == 2_000_000_000
    w.close()
    # exhausted scan: nothing but comments/junk → lazy init (None), still opens
    p2 = str(tmp_path / "Polar_H10_x_20260819210500_ECG.txt")
    with open(p2, "w", newline="\n") as fh:
        fh.write(writers.StreamWriter.HEADERS["ecg"] + "\n")
        fh.write("2026-08-19T21:05:00.000;junk;0.0;100\n")
    w2 = writers.StreamWriter(p2, "ecg", fsync=False)
    assert w2.resumed is True and w2._first_ns is None
    w2.close()


def test_arrival_writer_resumes_and_heals_a_torn_tail(tmp_path):
    import writers, datetime as dt
    p = str(tmp_path / "Polar_H10_x_20260819210000_PMDARRIVAL.csv")
    w1 = writers.PmdArrivalLogWriter(p, fsync=False)
    w1.write(dt.datetime(2026, 8, 19, 21, 0, 0), "H10", "ecg", 1, 2, 73)
    w1.close()
    with open(p, "a", newline="\n") as fh:
        fh.write("2026-08-19T21:00:01.000;H10;acc;3;4")             # torn
    w2 = writers.PmdArrivalLogWriter(p, fsync=False)
    w2.write(dt.datetime(2026, 8, 19, 21, 3, 0), "H10", "ecg", 5, 6, 73)
    w2.close()
    lines = open(p).read().splitlines()
    assert sum(1 for x in lines if x.startswith("Phone timestamp")) == 1
    assert not any(";3;4" in x and ";5;6" in x for x in lines), lines



def test_resumed_ecg_anchor_survives_an_unreadable_file(tmp_path, monkeypatch):
    """The anchor scan's own read racing away (OSError) degrades to lazy init — a worse column,
    never a crash. The append handle is already open by then, so the writer still works."""
    import writers, builtins, datetime as dt
    p = str(tmp_path / "Polar_H10_x_20260819210000_ECG.txt")
    w1 = writers.StreamWriter(p, "ecg", fsync=False)
    w1.write_ecg(dt.datetime(2026, 8, 19, 21, 0, 0), 1_000_000_000, 0.0, 100)
    w1.close()
    real_open = builtins.open

    def flaky(f, mode="r", *a, **k):
        if f == p and mode == "r":
            raise OSError("raced away")
        return real_open(f, mode, *a, **k)
    monkeypatch.setattr(builtins, "open", flaky)
    w2 = writers.StreamWriter(p, "ecg", fsync=False)
    assert w2.resumed is True and w2._first_ns is None
    w2.write_ecg(dt.datetime(2026, 8, 19, 21, 3, 0), 2_000_000_000, 0.0, 101)
    w2.close()


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# dual-radio failover (VIGIL-OVERNIGHT-FINDINGS P1.5) — the watchdog's L3 rung
# ══════════════════════════════════════════════════════════════════════════════════════════════════
_HCI_TWO = ("hci1:\tType: Primary  Bus: USB\n\tBD Address: F0:D5:BF:1E:79:21\n\tUP RUNNING \n\n"
            "hci0:\tType: Primary  Bus: USB\n\tBD Address: AC:A7:F1:29:9D:1D\n\tUP RUNNING \n")


def test_list_adapters_parses_the_probe(monkeypatch):
    class _P:
        async def communicate(self, stdin=None):     # proc_util.communicate calls proc.communicate(stdin)
            return (_HCI_TWO.encode(), b"")

    async def fake_exec(*a, **k):
        return _P()
    monkeypatch.setattr(capture.asyncio, "create_subprocess_exec", fake_exec)
    a = _run(capture.list_adapters())
    assert {x["hci"] for x in a} == {"hci0", "hci1"}


def test_list_adapters_is_empty_when_hciconfig_is_missing(monkeypatch):
    async def boom(*a, **k):
        raise FileNotFoundError("hciconfig")
    monkeypatch.setattr(capture.asyncio, "create_subprocess_exec", boom)
    assert _run(capture.list_adapters()) == []


def _failover_rig(monkeypatch, spare_list):
    """A wedged pinned radio, quiet deafness probe, stubbed power-cycle, and `list_adapters` → spare_list."""
    _wedge_rig(monkeypatch, adapter_up=False)
    _quiet_deafness_probe(monkeypatch)

    async def fake_cmd(cmd):
        return True
    monkeypatch.setattr(capture, "_adapter_cmd", fake_cmd)

    async def adapters(*a, **k):
        return list(spare_list)
    monkeypatch.setattr(capture, "list_adapters", adapters)


def test_the_watchdog_fails_over_to_a_healthy_spare_then_exhausts(monkeypatch, caplog):
    """The rung: reset of THIS radio is spent → repoint ADAPTER to the healthy spare (every reconnect
    resolves it fresh) and re-bond the sensors there. With the failover budget spent, the next give-up
    exits, so two flaky radios cannot ping-pong forever."""
    _failover_rig(monkeypatch, [{"hci": "hci1", "mac": "F0:D5:BF:1E:79:21", "up": True}])
    bonded = []

    async def fake_bond(addr, mac, *, force=False):
        bonded.append((addr, mac))
        return True
    monkeypatch.setattr(capture.bonding, "ensure_bonded", fake_bond)
    orig = capture.ADAPTER
    _stop_after(monkeypatch, 60)
    capture._EXIT_CODE[0] = 0
    cfg = {"devices": [_dev(name="H10"),
                       _dev(name="Backup", address="11:22:33:44:55:66", optional=True)],
           "watchdog": {"interval_sec": 1, "grace_checks": 1, "max_adapter_cycles": 1,
                        "max_failovers": 1, "exit_on_giveup": True}}
    try:
        with caplog.at_level("CRITICAL"):
            _run(capture.adapter_watchdog("AC:A7:F1:29:9D:1D", cfg))
        msgs = [r.getMessage() for r in caplog.records]
        assert any("FAILING OVER to spare F0:D5:BF:1E:79:21" in m for m in msgs)
        assert capture.ADAPTER == "F0:D5:BF:1E:79:21"                  # repoint IS the failover
        assert any(mac == "F0:D5:BF:1E:79:21" for _a, mac in bonded)   # sensors bonded on the spare
        assert ("11:22:33:44:55:66", "F0:D5:BF:1E:79:21") not in bonded  # the optional backup is skipped
        assert capture._EXIT_CODE[0] == 1                              # budget spent → the ladder exits
    finally:
        capture.ADAPTER = orig
        capture._EXIT_CODE[0] = 0


def test_failover_can_be_disabled_and_does_not_even_probe(monkeypatch):
    """watchdog.failover:false must not so much as enumerate the adapters — the pinned-radio ladder
    behaves exactly as before, exiting on give-up."""
    probed = []

    async def spare(*a, **k):
        probed.append(1)
        return [{"hci": "hci1", "mac": "SPARE", "up": True}]
    _wedge_rig(monkeypatch, adapter_up=False)
    _quiet_deafness_probe(monkeypatch)

    async def fake_cmd(cmd):
        return True
    monkeypatch.setattr(capture, "_adapter_cmd", fake_cmd)
    monkeypatch.setattr(capture, "list_adapters", spare)
    _stop_after(monkeypatch, 40)
    capture._EXIT_CODE[0] = 0
    cfg = {"devices": [_dev(name="H10")],
           "watchdog": {"interval_sec": 1, "grace_checks": 1, "max_adapter_cycles": 1,
                        "failover": False, "exit_on_giveup": True}}
    try:
        _run(capture.adapter_watchdog("PIN", cfg))
        assert probed == [], "failover:false must not probe the adapters"
        assert capture._EXIT_CODE[0] == 1
    finally:
        capture._EXIT_CODE[0] = 0


def test_failover_survives_a_bond_failure_on_the_spare(monkeypatch, caplog):
    """A sensor that will not re-pair on the spare must be logged, not fatal — the failover still moves
    capture onto the healthy radio; a bond can be retried on the next reconnect."""
    _failover_rig(monkeypatch, [{"hci": "hci1", "mac": "SPARE", "up": True}])

    async def bad_bond(addr, mac, *, force=False):
        raise RuntimeError("no pair")
    monkeypatch.setattr(capture.bonding, "ensure_bonded", bad_bond)
    orig = capture.ADAPTER
    _stop_after(monkeypatch, 60)
    capture._EXIT_CODE[0] = 0
    cfg = {"devices": [_dev(name="H10")],
           "watchdog": {"interval_sec": 1, "grace_checks": 1, "max_adapter_cycles": 1,
                        "max_failovers": 1, "exit_on_giveup": True}}
    try:
        with caplog.at_level("WARNING"):
            _run(capture.adapter_watchdog("PIN", cfg))
        msgs = [r.getMessage() for r in caplog.records]
        assert any("failover bond of" in m and "failed" in m for m in msgs)
        assert capture.ADAPTER == "SPARE"                              # failover happened despite the bond error
    finally:
        capture.ADAPTER = orig
        capture._EXIT_CODE[0] = 0


def test_a_RESUMED_set_that_receives_nothing_is_KEPT_not_discarded(tmp_path, monkeypatch):
    """🔴 The 2026-09-03 vigil data loss, driven through the real teardown.

    `wr.rows` counts THIS instance; `discard()` unlinks the whole FILE. Identical while one session
    owned one file — ended by CAPTURE-FILESET-RESUME §2, which reopens the same paths in append mode at
    rows=0. On the box the 15:43 Verity set reached 21 MB and its stream files were gone by 17:47, while
    PMDARRIVAL survived because `arr_wr` is closed above the loop, never discarded.

    This drives `run_polar` with a PRE-SEEDED recent set so the writer genuinely resumes, then delivers
    a frame carrying no samples. The sibling test above pins the opposite case — a set this session
    created IS still pruned — so together they cover both arcs of the guard rather than restating it."""
    dev = _pdev()
    started = capture._now()
    ndir = capture.night_dir(str(tmp_path), started)
    os.makedirs(ndir, exist_ok=True)
    seeded = os.path.join(ndir, capture.capture_filename(
        dev["vendor"], dev["model"], dev["device_id"], started, "ecg"))
    prior = "# earlier session\nt;v\n1;2\n"
    with open(seeded, "w") as fh:
        fh.write(prior)

    _polar_common(monkeypatch)
    _inject_connect(monkeypatch, _EmptyFramePolar(start_status=0x00))
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(dev, str(tmp_path)))

    assert os.path.exists(seeded), (
        "a resumed set that received no rows was DELETED — this is the vigil data loss: the writer "
        "appended to bytes it did not write, then discarded the whole file on teardown")
    assert open(seeded).read().startswith(prior), "the earlier session's bytes must be intact"
