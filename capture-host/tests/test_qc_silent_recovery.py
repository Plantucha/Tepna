# tepna-capture — tests/test_qc_silent_recovery.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The outer recovery for a runner that died behind a live link.
#
# On 2026-07-28 every device runner went silent at 22:16:22, seconds after the H10 ACKed
# `START ecg → ok`. The links stayed up, the process stayed healthy (LINK.csv growing, webmon serving,
# systemd watchdog fed), and QC logged the same nine missing streams every ten minutes for 6 h 14 m
# without acting. ~6 h of a sleep study was lost.
#
# The in-session stall watchdog could not catch it: any_stream_stalled is evaluated INSIDE run_polar's
# hold loop, so when the runner dies the watchdog dies with it. These tests pin the predicate that sees
# the failure from OUTSIDE, and the exclusions that stop it firing on the many benign ways a stream is
# legitimately at zero.

import alerts


THRESH = 900.0


def _qc(streams, name="Polar H10 02849638"):
    return {"devices": [{"name": name, "streams": streams, "coverage": {}, "silent_sec": None}]}


def _live(name="Polar H10 02849638", **kw):
    st = {"connected": True}
    st.update(kw)
    return {name: st}


# ── the failure itself ────────────────────────────────────────────────────────────────────────────
def test_connected_with_every_stream_at_zero_is_reported():
    got = alerts.silent_devices(_qc({"ecg": 0, "acc": 0, "hr": 0}), _live(), 6 * 3600, THRESH)
    assert got == ["Polar H10 02849638"]


def test_the_night_of_2026_07_28_all_nine_streams():
    qc = {"devices": [
        {"name": "Wellue O2Ring-S", "streams": {"spo2": 0, "ppg": 0}},
        {"name": "Polar H10 02849638", "streams": {"ecg": 0, "acc": 0, "hr": 0}},
        {"name": "Polar Verity Sense", "streams": {"ppg": 0, "acc": 0, "gyro": 0, "mag": 0}},
    ]}
    live = {"Wellue O2Ring-S": {"connected": True},
            "Polar H10 02849638": {"connected": True},
            "Polar Verity Sense": {"connected": True}}
    assert len(alerts.silent_devices(qc, live, 6 * 3600, THRESH)) == 3


# ── exclusions: every one of these is a stream legitimately at zero ───────────────────────────────
def test_a_young_night_is_never_reported():
    """A just-started night is legitimately empty — acting on it would re-negotiate every night."""
    assert alerts.silent_devices(_qc({"ecg": 0}), _live(), THRESH - 1, THRESH) == []


def test_a_device_that_produced_something_is_frozen_devices_territory():
    assert alerts.silent_devices(_qc({"ecg": 12345, "acc": 0}), _live(), 6 * 3600, THRESH) == []


def test_a_disconnected_device_is_a_different_fault():
    """Out of range / switched off has offline_alert_due; dropping a link that is already down is noise."""
    assert alerts.silent_devices(_qc({"ecg": 0}), _live(connected=False), 6 * 3600, THRESH) == []


def test_a_charging_device_is_silent_by_design():
    assert alerts.silent_devices(_qc({"ecg": 0}), _live(charging=True), 6 * 3600, THRESH) == []


def test_a_device_absent_from_live_state_is_never_reported():
    """An unknown state is not evidence of a fault — same rule frozen_devices follows."""
    assert alerts.silent_devices(_qc({"ecg": 0}), {}, 6 * 3600, THRESH) == []


def test_a_device_with_no_declared_streams_is_not_reported():
    assert alerts.silent_devices(_qc({}), _live(), 6 * 3600, THRESH) == []


def test_the_feature_is_disablable():
    assert alerts.silent_devices(_qc({"ecg": 0}), _live(), 6 * 3600, 0) == []
    assert alerts.silent_devices(_qc({"ecg": 0}), _live(), 6 * 3600, -1) == []


# ── it must not duplicate frozen_devices ─────────────────────────────────────────────────────────
def test_the_two_predicates_are_disjoint():
    """frozen_devices needs a prior write to measure silence FROM; this one is the never-wrote case.
    A given device can never satisfy both, so no failure is ever announced twice."""
    wrote_then_stopped = {"devices": [{"name": "D", "streams": {"ppg": 9000}, "silent_sec": 4000}]}
    never_wrote = {"devices": [{"name": "D", "streams": {"ppg": 0}, "silent_sec": None}]}
    live = {"D": {"connected": True}}
    assert alerts.frozen_devices(wrote_then_stopped, live, 600) == ["D"]
    assert alerts.silent_devices(wrote_then_stopped, live, 6 * 3600, THRESH) == []
    assert alerts.frozen_devices(never_wrote, live, 600) == []
    assert alerts.silent_devices(never_wrote, live, 6 * 3600, THRESH) == ["D"]


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# THE ACTION — qc_poller must DROP THE LINK, not just log a 28th time
# ══════════════════════════════════════════════════════════════════════════════════════════════════
import asyncio
import os

import capture


ADDR = "24:AC:AC:02:84:96"
NAME = "Polar H10 02849638"


def _harness(monkeypatch, tmp_path, polls, *, streams=None, paused=False, recovering=False,
             cfg_qc=None):
    """Drive qc_poller for `polls` iterations on a fake clock that advances 1000 s per poll, so the
    night ages deterministically even though the suite patches asyncio.sleep to return instantly."""
    os.makedirs(str(tmp_path / "captures" / "2026-07-28"), exist_ok=True)
    clock = {"t": 0.0}
    monkeypatch.setattr(capture._time, "monotonic", lambda: clock["t"])

    def _summ(night, devices):
        clock["t"] += 1000.0
        return {"night": "2026-07-28", "missing": [f"{NAME}:ecg"],
                "devices": [{"name": NAME, "streams": streams if streams is not None else {"ecg": 0}}]}
    monkeypatch.setattr(capture, "_current_night", lambda captures, settle: "2026-07-28")
    monkeypatch.setattr(capture.nightqc, "summarize", _summ)

    dropped = []

    async def _fake_drop(address, timeout=6.0):
        dropped.append(address)
        return True
    monkeypatch.setattr(capture, "force_link_drop", _fake_drop)

    calls = {"n": 0}

    async def fake_sleep(_s):
        calls["n"] += 1
        if calls["n"] >= polls:
            capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)

    capture.STATUS["devices"][NAME] = {"connected": True, "charging": False, "address": ADDR}
    capture._POLAR_PAUSED.discard(ADDR)
    capture._RECOVER.clear()
    if paused:
        capture._POLAR_PAUSED.add(ADDR)
    if recovering:
        capture._RECOVER.set()
    capture._STOP.clear()
    cfg = {"qc": cfg_qc if cfg_qc is not None else
           {"poll_sec": 1, "recover_after_sec": 500, "recover_cooldown_sec": 5000},
           "devices": [{"name": NAME, "address": ADDR, "streams": ["ecg"]}]}
    try:
        asyncio.run(capture.qc_poller(cfg, str(tmp_path), None))
    finally:
        capture._STOP.clear()
        capture._POLAR_PAUSED.discard(ADDR)
        capture._RECOVER.clear()
        capture.STATUS["devices"].pop(NAME, None)
    return dropped


def test_a_totally_silent_connected_device_gets_its_link_dropped(tmp_path, monkeypatch):
    """The 6 h 14 m of 2026-07-28, compressed: QC sees zero rows behind a live link and ACTS."""
    assert _harness(monkeypatch, tmp_path, 2) == [ADDR]


def test_a_young_night_is_left_alone(tmp_path, monkeypatch):
    """One poll ⇒ watched == 0 < recover_after_sec. A night that just started is not a fault."""
    assert _harness(monkeypatch, tmp_path, 1) == []


def test_the_cooldown_stops_a_reconnect_storm(tmp_path, monkeypatch):
    """Four polls span 3000 s of fake clock against a 5000 s cooldown — one drop, not three."""
    assert _harness(monkeypatch, tmp_path, 4) == [ADDR]


def test_a_device_that_is_streaming_is_never_touched(tmp_path, monkeypatch):
    assert _harness(monkeypatch, tmp_path, 4, streams={"ecg": 99999}) == []


def test_an_offline_pull_owns_the_link_and_is_not_fought(tmp_path, monkeypatch):
    """_POLAR_PAUSED means a PS-FTP pull holds the device; zero rows is expected, not a fault."""
    assert _harness(monkeypatch, tmp_path, 3, paused=True) == []


def test_the_adapter_watchdog_is_not_fought_either(tmp_path, monkeypatch):
    assert _harness(monkeypatch, tmp_path, 3, recovering=True) == []


def test_the_recovery_is_opt_in_by_default(tmp_path, monkeypatch):
    """No qc.recover_after_sec in config ⇒ the module default (0) ⇒ the radio is never touched.
    This guard is the first on the box that ACTS unprompted; it does not arm itself."""
    assert capture._QC_RECOVER_AFTER_S == 0.0
    assert _harness(monkeypatch, tmp_path, 4, cfg_qc={"poll_sec": 1}) == []
