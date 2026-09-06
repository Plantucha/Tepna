# tepna-capture — tests/test_bluez_wedge_wire.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The PARTIAL-wedge rung, wired into the watchdog.

Brief runner's F1: `_restart_radio()` was reachable ONLY from the deafness rung, which fires solely
`if not connected_any` — so on 2026-08-29, with the CPAP invisible while the H10 and O2Ring streamed,
no rung could fire. The ladder would not have caught the night it was built for.

And the CPAP's unreachability could not have contributed to any verdict even in principle: it is not
a `cfg["devices"]` entry (it arrives as FILES on a timer and would render as a permanently-dead
sensor), so the loop that iterates devices never sees it. It reaches the watchdog through the
DETECTOR's status instead.
"""

from __future__ import annotations

import capture
import bluez_wedge


def _wire(monkeypatch, restarts):
    async def fake_btctl(script, timeout=6):
        return "Connected: yes\n"

    async def fake_restart():
        restarts.append(1)
        return True

    monkeypatch.setattr(capture.bonding, "_btctl", fake_btctl)
    monkeypatch.setattr(capture, "_restart_radio", fake_restart)


def _poll(monkeypatch, cpap_status, restarts):
    """Drive exactly one watchdog poll with a healthy, connected sensor and the given CPAP state."""
    from test_capture_runners import _dev, _run, _stop_after

    _wire(monkeypatch, restarts)
    capture._STOP.clear()
    _stop_after(monkeypatch, 1)
    capture.STATUS["devices"]["H10"] = {"connected": True, "address": "24:AC:AC:02:84:96"}
    capture.STATUS["cpap"] = dict(cpap_status)
    capture.STATUS.pop("cpap_wedge", None)
    cfg = {"watchdog": {"enabled": True, "interval_sec": 60}, "devices": [_dev(name="H10")]}
    _run(capture.adapter_watchdog("hci0", cfg))
    capture._STOP.clear()
    return capture.STATUS.get("cpap_wedge")


def _cpap(streak, seen_min_ago):
    import time as _t
    return {"enabled": True, "unreachable_streak": streak,
            "last_seen_ms": (_t.time() - seen_min_ago * 60.0) * 1000.0,
            "last_unreachable_class": "BleakDeviceNotFoundError"}


def test_THE_2026_08_29_SHAPE_NOW_FIRES_A_RUNG(monkeypatch):
    # CPAP invisible for hours, H10 connected and streaming throughout. Every existing check green;
    # this is the night the ladder missed.
    restarts = []
    verdict = _poll(monkeypatch, _cpap(streak=600, seen_min_ago=120), restarts)
    assert verdict["verdict"] == bluez_wedge.WEDGED, verdict
    assert restarts == [1], "no recovery fired on the exact shape the ladder was built for"
    # the failure CLASS is surfaced too — Brief runner's F2, which the CSV could not answer
    assert verdict["class"] == "BleakDeviceNotFoundError"


def test_A_FEW_MISSES_DO_NOT_RESTART_THE_RADIO(monkeypatch):
    restarts = []
    verdict = _poll(monkeypatch, _cpap(streak=3, seen_min_ago=10), restarts)
    assert verdict["verdict"] == bluez_wedge.WATCHING
    assert restarts == [], "a handful of missed polls dropped every live link"


def test_A_MACHINE_GONE_FOR_DAYS_IS_NOT_A_WEDGE(monkeypatch):
    restarts = []
    verdict = _poll(monkeypatch, _cpap(streak=600, seen_min_ago=60 * 40), restarts)
    assert verdict["verdict"] == bluez_wedge.ABSENT
    assert restarts == []


def test_A_DISABLED_CPAP_IS_NOT_ASSESSED(monkeypatch):
    restarts = []
    st = _cpap(600, 10); st["enabled"] = False
    assert _poll(monkeypatch, st, restarts) is None
    assert restarts == []


def test_A_ZERO_STREAK_IS_NOT_ASSESSED(monkeypatch):
    # Nothing has been missed, so there is no question to answer and no verdict to publish.
    restarts = []
    assert _poll(monkeypatch, _cpap(0, 10), restarts) is None


def test_A_RESTART_THAT_DOES_NOT_HELP_IS_NOT_REPEATED_WITHOUT_BOUND(monkeypatch):
    """The budget's whole purpose: a restart that did not clear the wedge will not clear it on the
    fourth attempt either, and each one drops every live link.

    ⚠️ Driven as ONE watchdog lifetime, several polls — not several watchdogs. The budget is a local
    in `adapter_watchdog`, so polling it through repeated invocations would reset the counter every
    time and test the harness rather than the code. (My first version of this test did exactly that
    and 'passed' the restart cap by starting a fresh watchdog for each poll.)

    The fake restart RE-ARMS the streak, modelling a wedge the restart failed to clear — which is the
    only situation in which the cap can be reached at all."""
    from test_capture_runners import _dev, _run, _stop_after

    restarts = []

    async def fake_btctl(script, timeout=6):
        # Re-arm HERE, once per poll, not inside the restart: the rung clears the streak immediately
        # AFTER `_restart_radio()` returns, so a re-arm from inside the restart is overwritten on the
        # very next line. This models what a persisting wedge really does — misses keep accumulating
        # between polls because the restart did not fix anything.
        capture.STATUS.setdefault("cpap", {})["unreachable_streak"] = 600
        return "Connected: yes\n"

    async def unhelpful_restart():
        restarts.append(1)
        return True

    monkeypatch.setattr(capture.bonding, "_btctl", fake_btctl)
    monkeypatch.setattr(capture, "_restart_radio", unhelpful_restart)
    capture._STOP.clear()
    _stop_after(monkeypatch, bluez_wedge.MAX_RESTARTS_PER_DAY + 3)
    capture.STATUS["devices"]["H10"] = {"connected": True, "address": "24:AC:AC:02:84:96"}
    capture.STATUS["cpap"] = _cpap(600, 120)
    cfg = {"watchdog": {"enabled": True, "interval_sec": 60}, "devices": [_dev(name="H10")]}
    _run(capture.adapter_watchdog("hci0", cfg))
    capture._STOP.clear()

    assert len(restarts) == bluez_wedge.MAX_RESTARTS_PER_DAY, (
        f"spent {len(restarts)} restarts against a budget of {bluez_wedge.MAX_RESTARTS_PER_DAY}")
    # ...and it still SAYS wedged after the budget is gone. The bookkeeping governs the action, never
    # the verdict; a wedged night reading as healthy is the failure this lane exists to prevent.
    assert capture.STATUS["cpap_wedge"]["verdict"] == bluez_wedge.WEDGED


# ── the status signal the rung reads ──────────────────────────────────────────────────────────────
def test_A_FAILED_POLL_INCREMENTS_THE_STREAK_AND_RECORDS_THE_CLASS():
    capture.STATUS["cpap"] = {"enabled": True}
    capture._note_cpap_unreachable(OSError("no route"))
    capture._note_cpap_unreachable(TimeoutError("slow"))
    st = capture.STATUS["cpap"]
    assert st["unreachable_streak"] == 2
    assert st["reachable"] is False
    assert st["last_unreachable_class"] == "TimeoutError"


def test_A_SUCCESSFUL_POLL_RESETS_THE_STREAK_AND_STAMPS_LAST_SEEN():
    import types
    capture.STATUS["cpap"] = {"enabled": True, "unreachable_streak": 9,
                              "last_unreachable_class": "OSError"}

    class _D:
        evidence = {"reachable": True, "fg_state": "Standby"}
        state = types.SimpleNamespace(name="IDLE")
        host_ms = 1.0

    capture._publish_therapy_state(_D(), None)
    st = capture.STATUS["cpap"]
    assert st["unreachable_streak"] == 0
    assert st["reachable"] is True
    assert st["last_unreachable_class"] is None
    assert st["last_seen_ms"] > 0


def test_AN_UNREACHABLE_POLL_DOES_NOT_MOVE_LAST_SEEN():
    # `last_seen_ms` is the only thing separating "bluez lost it" from "it is not here". If a failed
    # poll refreshed it, the window would never expire and every absence would read as a wedge.
    capture.STATUS["cpap"] = {"enabled": True, "last_seen_ms": 1000.0}
    capture._note_cpap_unreachable(OSError("boom"))
    assert capture.STATUS["cpap"]["last_seen_ms"] == 1000.0


# ── the fire journal, end to end through the QC row ───────────────────────────────────────────────
def test_A_FIRING_IS_RECORDED_BEFORE_THE_RESTART_NOT_AFTER(tmp_path, monkeypatch):
    """🔴 ORDER IS THE POINT. `_restart_radio` bounces bluetooth and can take the daemon's own links
    with it, so a record written AFTER the restart is owed by the process most likely to have died
    making it. The fire is written first; the outcome is derived later from the polls that follow,
    so nothing needs a second write."""
    order = []
    restarts = []

    async def fake_btctl(script, timeout=6):
        capture.STATUS.setdefault("cpap", {})["unreachable_streak"] = 600
        return "Connected: yes\n"

    async def watch_restart():
        order.append("restart")
        restarts.append(1)
        return True

    monkeypatch.setattr(capture.bonding, "_btctl", fake_btctl)
    monkeypatch.setattr(capture, "_restart_radio", watch_restart)
    real_record = capture._wedge_fire_record

    def watched_record(root, device, reason, cls):
        order.append("record")
        return real_record(root, device, reason, cls)

    monkeypatch.setattr(capture, "_wedge_fire_record", watched_record)

    from test_capture_runners import _dev, _run, _stop_after
    capture._STOP.clear()
    _stop_after(monkeypatch, 1)
    capture.STATUS["devices"]["H10"] = {"connected": True, "address": "24:AC:AC:02:84:96"}
    capture.STATUS["cpap"] = _cpap(streak=600, seen_min_ago=120)
    cfg = {"watchdog": {"enabled": True, "interval_sec": 60}, "devices": [_dev(name="H10")],
           "root": str(tmp_path)}
    _run(capture.adapter_watchdog("hci0", cfg))
    capture._STOP.clear()

    assert restarts, "the rung did not fire"
    assert order[:2] == ["record", "restart"], f"the fire was recorded after the restart: {order}"
    text = (tmp_path / "WEDGEFIRE.csv").read_text()
    assert "cpap" in text and text.startswith("fired_ms;")


def test_THE_OUTCOME_IS_DERIVED_FROM_THE_POLLS_THAT_FOLLOWED(tmp_path):
    import bluez_wedge as BW
    t0 = 1_788_000_000_000
    (tmp_path / "WEDGEFIRE.csv").write_text(
        "fired_ms;device;reason;error_class\n" + BW.fire_row(t0, "cpap", "missed 20", "BleakError"))
    hdr = "host_ms;a;b;c;d;trigger;e;reachable;fg;u;p;q"
    # the device answered 32 s after the restart — the 2026-08-29 shape
    # a blank line and a TORN row (the daemon died mid-write) must be skipped, not counted as a
    # poll that saw nothing — an unreadable row is not an observation of absence
    back = "\n".join([hdr, "", f"{t0 + 4_000};i;i", f"{t0 + 32_000};i;i;;;;;True;Standby;;;"])
    got = capture._wedge_recoveries(str(tmp_path), back)
    assert got and got[0]["outcome"] == BW.RETURNED

    # ...and with no poll at all in the window it is UNKNOWN, never NOT_RETURNED
    got2 = capture._wedge_recoveries(str(tmp_path), hdr)
    assert got2[0]["outcome"] == BW.UNKNOWN


def test_NO_FIRE_JOURNAL_IS_AN_EMPTY_LIST_NOT_A_CRASH(tmp_path):
    assert capture._wedge_recoveries(str(tmp_path), "") == []


def test_AN_UNWRITABLE_JOURNAL_DOES_NOT_ABORT_THE_RECOVERY(tmp_path):
    # The record is a report ABOUT a recovery; failing to write it must not stop the recovery itself.
    capture._wedge_fire_record(str(tmp_path / "nonexistent-dir"), "cpap", "why", "Cls")  # must not raise


def test_WITHOUT_A_ROOT_THE_FIRE_IS_NOT_WRITTEN_TO_THE_CWD(tmp_path, monkeypatch, caplog):
    """A relative WEDGEFIRE.csv is worse than none: it reads as a durable record while sitting in
    whatever directory the process was started from. Refuse, and SAY so — silence here would be the
    same fabricated-absence this journal exists to prevent."""
    monkeypatch.chdir(tmp_path)
    with caplog.at_level("WARNING"):
        capture._wedge_fire_record("", "cpap", "why", "Cls")
    assert not (tmp_path / "WEDGEFIRE.csv").exists()
    assert "NOT journalled" in caplog.text


def test_A_SECOND_FIRE_APPENDS_IT_DOES_NOT_REWRITE_THE_JOURNAL(tmp_path):
    """The journal is the only durable trace that an intervention happened, so a rewrite is a window
    in which a crash loses every PRIOR fire as well as this one. Two fires, one header, two rows —
    and the second row keeps the first one's bytes."""
    capture._wedge_fire_record(str(tmp_path), "cpap", "first", "BleakDeviceNotFoundError")
    first = (tmp_path / "WEDGEFIRE.csv").read_text()
    capture._wedge_fire_record(str(tmp_path), "cpap", "second", "TimeoutError")
    both = (tmp_path / "WEDGEFIRE.csv").read_text()

    assert both.startswith(first), "the second fire rewrote the first one away"
    assert both.count("fired_ms;") == 1, "the header was written twice"
    assert both.count("\n") == 3 and "first" in both and "second" in both


# ── the REASON, not just the bucket (2026-09-05) ─────────────────────────────────────────────────────
# 🔴 WHY THE CLASS ALONE IS NOT ENOUGH. `last_unreachable_class` separates BleakDeviceNotFoundError
# from InProgress — two classes, two responses. It cannot separate anything INSIDE `As11Error`, and
# every AS11 protocol fault is that one class: a rejected pairing key, a timeout and a malformed frame
# are indistinguishable. Measured 2026-09-04 18:49 → 09-05 06:00: the AirSense stopped accepting our
# masterPairKey and eleven hours of every-30 s failures read exactly like "the machine is off".
class _As11Error(Exception):
    """Stands in for as11_pull.As11Error — same shape: one class, many reasons."""


def _fresh_cpap_status():
    capture.STATUS["cpap"] = {"enabled": True}
    capture._CPAP_UNREACHABLE_MEMO.clear()


def test_THE_UNREACHABLE_MESSAGE_IS_RECORDED_NOT_JUST_THE_CLASS():
    _fresh_cpap_status()
    capture._note_cpap_unreachable(_As11Error("RPC 10 VerificationFailure"))
    st = capture.STATUS["cpap"]
    assert st["last_unreachable_class"] == "_As11Error"
    assert st["last_unreachable_msg"] == "RPC 10 VerificationFailure", \
        "the class is the bucket; only the message says WHY, and it was in hand at the raise"


def test_A_MESSAGELESS_EXCEPTION_RECORDS_NULL_NOT_AN_EMPTY_STRING():
    # An empty string renders as `As11Error: ` — a colon promising a reason that is not there. Null is
    # the honest absence (§2.6: a missing observation is visible, never fabricated).
    _fresh_cpap_status()
    capture._note_cpap_unreachable(_As11Error(""))
    assert capture.STATUS["cpap"]["last_unreachable_msg"] is None


def test_A_LONG_MESSAGE_IS_TRUNCATED_SO_ONE_FAULT_CANNOT_FLOOD_THE_STATE():
    _fresh_cpap_status()
    capture._note_cpap_unreachable(_As11Error("x" * 5000))
    assert len(capture.STATUS["cpap"]["last_unreachable_msg"]) == 200


def test_THE_LOG_IS_RATE_LIMITED_BUT_NEVER_SILENT_ABOUT_A_CHANGE(caplog):
    """The poll is every 30 s; a fault that runs all night is 1320 polls. Log the first, any CHANGE,
    and hourly — never one line per poll, and never silence when the fault becomes a different one."""
    _fresh_cpap_status()
    with caplog.at_level("WARNING"):
        capture._note_cpap_unreachable(_As11Error("RPC 10 VerificationFailure"))   # streak 1 → logs
        for _ in range(30):                                                        # repeats → silent
            capture._note_cpap_unreachable(_As11Error("RPC 10 VerificationFailure"))
        first_phase = caplog.text.count("CPAP poll unreachable")
        capture._note_cpap_unreachable(_As11Error("connection timed out"))         # CHANGED → logs
    assert first_phase == 1, f"31 identical failures must log once, logged {first_phase}"
    assert caplog.text.count("CPAP poll unreachable") == 2, "a changed fault is news and must log"
    assert "connection timed out" in caplog.text
    assert capture.STATUS["cpap"]["unreachable_streak"] == 32


def test_THE_HOURLY_LINE_FIRES_SO_A_LONG_OUTAGE_LEAVES_PERIODIC_PROOF(caplog):
    _fresh_cpap_status()
    with caplog.at_level("WARNING"):
        for _ in range(120):
            capture._note_cpap_unreachable(_As11Error("RPC 10 VerificationFailure"))
    # streak 1 (first) and streak 120 (hourly at a 30 s poll) — not the 118 in between.
    assert caplog.text.count("CPAP poll unreachable") == 2, \
        "one line at the start would scroll away; a line an hour is the evidence an outage leaves"


def test_A_SUCCESSFUL_POLL_CLEARS_THE_MESSAGE_AND_THE_LOG_MEMO(caplog):
    """The memo must not outlive the fault: a fault that heals and returns is a NEW outage, and its
    first line is the one an operator reads."""
    import types
    _fresh_cpap_status()
    capture._note_cpap_unreachable(_As11Error("RPC 10 VerificationFailure"))

    class _D:
        evidence = {"reachable": True, "fg_state": "Standby"}
        state = types.SimpleNamespace(name="IDLE")
        host_ms = 1.0

    capture._publish_therapy_state(_D(), None)
    assert capture.STATUS["cpap"]["last_unreachable_msg"] is None
    assert "msg" not in capture._CPAP_UNREACHABLE_MEMO, \
        "a healed fault must not suppress the first line of the next one"

    # caplog captures WARNING by default, so the setup failure above is ALREADY in it — clear, or this
    # counts a line from a phase it does not describe (it read 2 and the memo was working fine).
    caplog.clear()
    with caplog.at_level("WARNING"):
        capture._note_cpap_unreachable(_As11Error("RPC 10 VerificationFailure"))
    assert caplog.text.count("CPAP poll unreachable") == 1


# ── THE HANDOFF AFTER THE BUDGET IS SPENT ─────────────────────────────────────────────────────────
# Residue `2026-09-04-cpap-wedge-failover-masks-escalation`. Budget spent used to be the END of the
# ladder: the rungs that fix an RTL8761B-class wedge live in `adapter_watchdog` and arm only when a
# scan returns ZERO devices, so a radio deaf to ONE device never reached them. These drive the branch
# that hands off, because a recovery path whose first execution is during an incident is untested.
_INTEL = "28:0C:50:0C:18:FD"


def _poll_spent(monkeypatch, *, usb_id, extra_devices=None, status_extra=None, rebinds=None,
                resets=None, handoffs=2, hci_reset=True):
    """One poll with the per-device restart budget already SPENT, so the handoff branch is reached."""
    from test_capture_runners import _dev, _run, _stop_after

    _wire(monkeypatch, [])
    monkeypatch.setattr(bluez_wedge, "restart_allowed", lambda n: (False, "budget spent (2/2 today)"))

    async def fake_hci(spec=None):
        return "hci9"

    async def fake_rebind(dev_id):
        (rebinds if rebinds is not None else []).append(dev_id)
        return True

    async def fake_cmd(argv, **kw):
        (resets if resets is not None else []).append(list(argv))
        return True

    monkeypatch.setattr(capture, "adapter_hci", fake_hci)
    monkeypatch.setattr(capture, "adapter_usb_id", lambda hci, **kw: usb_id)
    monkeypatch.setattr(capture, "_usb_rebind", fake_rebind)
    monkeypatch.setattr(capture, "_adapter_cmd", fake_cmd)

    capture._STOP.clear()
    _stop_after(monkeypatch, handoffs)
    capture.STATUS["devices"] = {"H10": {"connected": True, "address": "24:AC:AC:02:84:96"}}
    for k, v in (status_extra or {}).items():
        capture.STATUS["devices"][k] = v
    capture.STATUS["cpap"] = _cpap(streak=600, seen_min_ago=120)
    capture.STATUS.pop("cpap_wedge", None)
    cfg = {"watchdog": {"enabled": True, "interval_sec": 60, "hci_reset": hci_reset},
           "devices": [_dev(name="H10")] + list(extra_devices or []),
           "cpap": {"ble_stream": {"adapter": _INTEL}}}
    _run(capture.adapter_watchdog("hci0", cfg))
    capture._STOP.clear()


def test_budget_spent_HANDS_OFF_to_the_adapter_ladder(monkeypatch):
    """The rung the row says was unreachable. It must rebind the USB id DERIVED from the CPAP's own
    adapter — never `watchdog.usb_path`, which on vigil named a third radio."""
    rebinds, resets = [], []
    _poll_spent(monkeypatch, usb_id="1-9", rebinds=rebinds, resets=resets, handoffs=1)
    assert rebinds == ["1-9"], f"the derived USB id was not rebound: {rebinds}"
    assert any("hciconfig" in " ".join(a) for a in resets), resets


def test_the_handoff_is_ONE_PER_DAY_not_every_poll(monkeypatch, caplog):
    """The branch runs on EVERY poll once the budget is spent, so without a bound this would
    power-cycle the radio each minute — worse than the fault it fixes.

    ⚠ `_stop_after(n)` counts SLEEP CALLS, not polls, and the escalate path sleeps TWICE of its own
    accord. The first version of this test passed `n=3`, which the first handoff consumed by itself —
    so the loop never reached a second poll and the test proved nothing about the bound. It is the
    100% coverage floor that surfaced it, as line 5369 never executing. `n` is large enough for a
    second poll now, and the "already spent" line is asserted POSITIVELY rather than inferred from
    the absence of a second rebind."""
    rebinds = []
    with caplog.at_level("ERROR"):
        _poll_spent(monkeypatch, usb_id="1-9", rebinds=rebinds, handoffs=12)
    assert rebinds == ["1-9"], f"handoff repeated: {rebinds}"
    assert any("already spent today" in r.getMessage() for r in caplog.records), \
        "the second poll never reached the bound — this test would pass vacuously"


def test_the_handoff_honours_hci_reset_disabled(monkeypatch):
    """`hci_reset: false` must skip the controller reset and still rebind — the rung is the USB
    re-enumeration, and the reset is an optional step before it."""
    rebinds, resets = [], []
    _poll_spent(monkeypatch, usb_id="1-9", rebinds=rebinds, resets=resets, handoffs=1,
                hci_reset=False)
    assert rebinds == ["1-9"], rebinds
    assert resets == [], f"hci_reset was disabled but a reset ran: {resets}"


def test_no_derivable_usb_path_REFUSES_the_rung(monkeypatch):
    """An internal controller has no bus-port. Refuse and say so — never fall back to the static
    `watchdog.usb_path`, which is how a wrong-radio rebind re-enters."""
    rebinds = []
    _poll_spent(monkeypatch, usb_id=None, rebinds=rebinds, handoffs=1)
    assert rebinds == [], "refused rung still rebound something"


def test_another_live_device_on_that_adapter_BLOCKS_the_handoff(monkeypatch):
    """The gate's reason for existing: this can re-enumerate a radio, so it must not run while that
    radio is serving someone."""
    from test_capture_runners import _dev

    rebinds = []
    _poll_spent(monkeypatch, usb_id="1-9", rebinds=rebinds, handoffs=1,
                extra_devices=[_dev(name="OnIntel", adapter=_INTEL)],
                status_extra={"OnIntel": {"connected": True, "worn": True}})
    assert rebinds == [], "handoff fired while another device on that adapter was streaming"
