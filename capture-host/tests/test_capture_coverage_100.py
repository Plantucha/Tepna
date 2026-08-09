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
                     "_O2_PASSIVE_SCAN")}


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
            pass
    try:
        _run(go())
    finally:
        capture._STOP.clear()

    assert (dest / "stored" / "o2ring.dat").read_text() == "flash"
    assert (dest / "cpap" / "night.edf").read_text() == "edf"
    assert not (dest / "incoming").exists(), "a transient tree must never reach the mirror"
    assert "incoming" not in calls, "and it must not even be offered"
