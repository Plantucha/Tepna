# tepna-capture — tests/test_link_distress_wire.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The daemon half of the radio-distress signal: the rate it observes, and the event a switch emits.

The decision lives in `link_distress` (pure, tested next door, bands pre-stated in
`briefs/RADIO-FAILOVER-DISTRESS-SIGNAL-2026-08-29-BRIEF.md`). What is tested HERE is what the daemon
feeds it and what it does with the answer.
"""

import json
import os

import pytest

import capture

BASE = {"AA:BB": {"ring": [0.20, 0.23, 0.31, 0.19]}}  # the ring's own four non-storm nights


@pytest.fixture(autouse=True)
def _reset():
    capture._LINK_DISTRESS_SEEN.clear()
    capture._RADIO_EVENTS.clear()
    capture.STATUS.pop("radio_switches", None)
    capture.STATUS.pop("radio_distress", None)
    yield
    capture._LINK_DISTRESS_SEEN.clear()
    capture._RADIO_EVENTS.clear()


def test_a_device_seen_ONCE_has_no_rate_and_is_not_reported_as_zero():
    """🔴 Reporting 0/h from a single sample would be a measured calm that nobody measured — and it
    is the reading a fresh daemon has for its whole first poll."""
    assert capture.link_distress_scan("AA:BB", {"ring": {"link_epoch": 1}}, BASE, 0.0) == {}


def test_the_rate_is_link_epoch_GROWTH_over_the_window():
    """`link_epoch` is the reconnect counter the 25 s sampling cannot miss (E5)."""
    capture.link_distress_scan("AA:BB", {"ring": {"link_epoch": 1}}, BASE, 0.0)
    got = capture.link_distress_scan("AA:BB", {"ring": {"link_epoch": 15}}, BASE, 3600.0)["ring"]
    assert got["state"] == capture.link_distress.DISTRESSED
    assert got["observed"] == 14.0 and got["band"] == 8.0


def test_a_QUIET_hour_on_the_same_baseline_is_OK():
    """The control: it must be the rate that decides, not the passage of time."""
    capture.link_distress_scan("AA:BB", {"ring": {"link_epoch": 1}}, BASE, 0.0)
    assert (
        capture.link_distress_scan("AA:BB", {"ring": {"link_epoch": 2}}, BASE, 3600.0)["ring"]["state"]
        == capture.link_distress.OK
    )


def test_NO_BASELINE_for_this_adapter_is_UNKNOWN_never_a_trigger():
    """The AX210 arrives with zero nights, and no box has a baseline file at all yet."""
    capture.link_distress_scan("NEW:MAC", {"ring": {"link_epoch": 1}}, BASE, 0.0)
    got = capture.link_distress_scan("NEW:MAC", {"ring": {"link_epoch": 99}}, BASE, 3600.0)["ring"]
    assert got["state"] == capture.link_distress.UNKNOWN


def test_a_device_with_NO_link_epoch_is_skipped_not_defaulted():
    assert capture.link_distress_scan("AA:BB", {"x": {}}, BASE, 0.0) == {}
    assert capture.link_distress_scan("AA:BB", {"x": None}, BASE, 0.0) == {}
    assert capture.link_distress_scan("AA:BB", None, BASE, 0.0) == {}


def test_history_OLDER_than_the_window_is_dropped():
    """This morning's storm must not be tonight's verdict."""
    capture.link_distress_scan("AA:BB", {"ring": {"link_epoch": 1}}, BASE, 0.0)
    capture.link_distress_scan("AA:BB", {"ring": {"link_epoch": 200}}, BASE, 100.0)
    # ...far beyond the window: the old samples age out, leaving too few to rate.
    assert (
        capture.link_distress_scan(
            "AA:BB", {"ring": {"link_epoch": 201}}, BASE, 100.0 + capture._LINK_DISTRESS_WINDOW_S + 10
        )
        == {}
    )


def test_a_counter_that_went_BACKWARDS_does_not_produce_a_negative_rate():
    """A daemon restart resets `link_epoch`. A negative rate would be refused downstream anyway, but
    it must not be manufactured here."""
    capture.link_distress_scan("AA:BB", {"ring": {"link_epoch": 50}}, BASE, 0.0)
    got = capture.link_distress_scan("AA:BB", {"ring": {"link_epoch": 1}}, BASE, 3600.0)["ring"]
    assert got["observed"] == 0.0 and got["state"] == capture.link_distress.OK


# ── baselines ──────────────────────────────────────────────────────────────────────────────────


def test_an_absent_or_corrupt_baseline_file_is_EMPTY_not_an_error(tmp_path):
    assert capture._link_baselines(str(tmp_path)) == {}
    p = capture._link_baseline_path(str(tmp_path))
    os.makedirs(os.path.dirname(p), exist_ok=True)
    for bad in ("{oops", "[1,2]", "null", '"text"'):
        open(p, "w").write(bad)
        assert capture._link_baselines(str(tmp_path)) == {}, bad
    json.dump(BASE, open(p, "w"))
    assert capture._link_baselines(str(tmp_path)) == BASE


# ── the switch event ───────────────────────────────────────────────────────────────────────────


def test_the_switch_event_reaches_STATUS_not_only_the_log():
    """🔴 A `log.critical` is not a surface: it scrolls, it is not in /api/state, and nothing joins it
    to a night. Radio churn has to be visible to something that survives the night."""
    ev = capture.link_distress.switch_event(
        device="ring", from_mac="AA:BB", to_mac="CC:DD", cause="wedged", verdict={"detail": "ladder spent"}
    )
    capture._radio_switch_event(ev)
    assert capture.STATUS["radio_switches"][-1]["from"] == "AA:BB"
    assert capture.STATUS["radio_switches"][-1]["cause"] == "wedged"


def test_the_event_log_is_BOUNDED():
    """An event log that grows without limit is its own outage."""
    for i in range(120):
        capture._radio_switch_event({"from": f"m{i}", "to": "x", "cause": "wedged", "detail": None})
    assert len(capture.STATUS["radio_switches"]) == 50
    assert capture.STATUS["radio_switches"][-1]["from"] == "m119"


def test_a_reporting_FAILURE_does_not_undo_the_switch(monkeypatch):
    """The switch already happened. Failing to describe it must not raise into the watchdog."""
    monkeypatch.setattr(capture, "_RADIO_EVENTS", None)  # append() will raise
    capture._radio_switch_event({"from": "a", "to": "b"})  # must not raise


def test_two_samples_at_the_SAME_INSTANT_yield_no_rate():
    """A rate needs elapsed time. Two polls landing on one monotonic instant would divide by zero, and
    a guard that instead produced a huge number would fabricate a storm out of a scheduling artifact."""
    capture.link_distress_scan("AA:BB", {"ring": {"link_epoch": 1}}, BASE, 500.0)
    assert capture.link_distress_scan("AA:BB", {"ring": {"link_epoch": 99}}, BASE, 500.0) == {}


def test_a_FAILING_scan_does_not_cost_the_watchdog_its_poll(monkeypatch):
    """🔴 The distress scan is a REPORT. The watchdog's job is recovering a wedged radio, and a
    reporting bug must never be able to stop it — that would turn a diagnostic into an outage."""
    from test_capture_runners import _dev, _run, _stop_after

    async def fake_btctl(script, timeout=6):
        return "Connected: yes\n"

    def boom(*a, **k):
        raise RuntimeError("scan exploded")

    monkeypatch.setattr(capture.bonding, "_btctl", fake_btctl)
    monkeypatch.setattr(capture, "link_distress_scan", boom)
    capture._STOP.clear()
    _stop_after(monkeypatch, 1)
    cfg = {"watchdog": {"enabled": True, "interval_sec": 60}, "devices": [_dev(name="H10")]}
    capture.STATUS["devices"]["H10"] = {"connected": True, "address": "24:AC:AC:02:84:96"}
    _run(capture.adapter_watchdog("hci0", cfg))  # must complete the poll, not raise
    capture._STOP.clear()
