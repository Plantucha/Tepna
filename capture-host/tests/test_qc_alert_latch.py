# tepna-capture — tests/test_qc_alert_latch.py
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""The QC poller's alert latches survive a daemon restart.

MEASURED on the capture box from 2026-10-19 to 2026-11-01: 5 of 19 morning digests and 5 of 7
"night has a gap" alerts were repeats, and each repeat followed a restart. These tests restart the
poller on the same captures root and require silence from the second run.
"""

import asyncio
import datetime as dt
import json
import os

import pytest

import alerts
import capture

NIGHT = "2026-08-18"


def _run(coro):
    return asyncio.run(coro)


def _stop_after(monkeypatch, n):
    calls = {"n": 0}

    async def fake_sleep(_s):
        calls["n"] += 1
        if calls["n"] >= n:
            capture._STOP.set()

    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    return calls


class _N:
    def __init__(self):
        self.sent = []

    async def send(self, title, message, **kw):
        self.sent.append(title)
        return True


def _night(tmp_path, monkeypatch, missing):
    os.makedirs(str(tmp_path / "captures" / NIGHT), exist_ok=True)
    monkeypatch.setattr(capture, "_current_night", lambda captures, settle: NIGHT)
    monkeypatch.setattr(
        capture.nightqc,
        "summarize",
        lambda night, devices: {
            "night": NIGHT,
            "missing": list(missing),
            "devices": [{"name": "H10", "coverage": {"ecg": 0.96}}],
        },
    )
    monkeypatch.setattr(capture, "_now", lambda: dt.datetime(2026, 8, 18, 9, 30))


def _restart_twice(tmp_path, monkeypatch, qc):
    """Run the poller, stop it, and run it again on the same root. Returns each run's titles."""
    runs = []
    for _ in range(2):
        capture._STOP.clear()
        calls = _stop_after(monkeypatch, 2)
        n = _N()
        _run(capture.qc_poller({"qc": qc, "devices": []}, str(tmp_path), n))
        assert calls["n"] >= 2, "the poller ran no poll, so silence proves nothing"
        runs.append(n.sent)
    return runs


# ── pure ──────────────────────────────────────────────────────────────────────────────────────────
def test_the_latch_round_trips():
    saved = alerts.qc_latch_to_save(dt.date(2026, 11, 2), {"2026-11-01", "2026-10-31"})
    assert saved == {"digest_sent": "2026-11-02", "gap_alerted": ["2026-10-31", "2026-11-01"]}
    assert alerts.qc_latch_restored(json.loads(json.dumps(saved))) == (
        dt.date(2026, 11, 2),
        {"2026-10-31", "2026-11-01"},
    )


def test_an_absent_digest_saves_as_null_and_reads_back_absent():
    assert alerts.qc_latch_to_save(None, []) == {"digest_sent": None, "gap_alerted": []}
    assert alerts.qc_latch_restored({"digest_sent": None, "gap_alerted": []}) == (None, set())


def test_the_latch_keeps_only_the_latest_nights():
    nights = [f"2026-10-{d:02d}" for d in range(1, 31)]
    kept = alerts.qc_latch_to_save(None, nights)["gap_alerted"]
    assert len(kept) == alerts.QC_LATCH_KEEP == 14
    assert kept == nights[-14:]


def test_a_bad_latch_reads_as_absent_part_by_part():
    assert alerts.qc_latch_restored(None) == (None, set())
    assert alerts.qc_latch_restored(["2026-11-01"]) == (None, set())
    assert alerts.qc_latch_restored({}) == (None, set())
    assert alerts.qc_latch_restored({"digest_sent": "not a date", "gap_alerted": ["n1"]}) == (None, {"n1"})
    assert alerts.qc_latch_restored({"digest_sent": 20261102, "gap_alerted": "n1"}) == (None, set())
    assert alerts.qc_latch_restored({"digest_sent": "2026-11-02", "gap_alerted": ["n1", 7, None]}) == (
        dt.date(2026, 11, 2),
        {"n1"},
    )


# ── the wire ──────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.sets_capture_events
def test_a_restart_does_not_send_the_morning_digest_again(tmp_path, monkeypatch):
    _night(tmp_path, monkeypatch, missing=[])
    first, second = _restart_twice(tmp_path, monkeypatch, {"poll_sec": 1, "digest_hour": 9})
    assert first == ["Tepna night QC"], first
    assert second == [], second
    with open(tmp_path / "captures" / alerts.QC_LATCH_NAME) as fh:
        assert json.load(fh)["digest_sent"] == "2026-08-18"


@pytest.mark.sets_capture_events
def test_a_restart_does_not_send_the_gap_alert_again(tmp_path, monkeypatch):
    _night(tmp_path, monkeypatch, missing=["H10:acc"])
    first, second = _restart_twice(tmp_path, monkeypatch, {"poll_sec": 1, "digest_hour": -1, "alert_after_sec": 0})
    assert first == ["Tepna: night has a gap"], first
    assert second == [], second
    with open(tmp_path / "captures" / alerts.QC_LATCH_NAME) as fh:
        assert json.load(fh)["gap_alerted"] == [NIGHT]


@pytest.mark.sets_capture_events
def test_with_no_latch_file_the_poller_still_alerts_once(tmp_path, monkeypatch):
    _night(tmp_path, monkeypatch, missing=["H10:acc"])
    capture._STOP.clear()
    _stop_after(monkeypatch, 3)
    n = _N()
    _run(
        capture.qc_poller(
            {"qc": {"poll_sec": 1, "digest_hour": -1, "alert_after_sec": 0}, "devices": []}, str(tmp_path), n
        )
    )
    assert n.sent == ["Tepna: night has a gap"]


@pytest.mark.sets_capture_events
def test_an_unreadable_latch_is_named_and_the_poller_still_alerts(tmp_path, monkeypatch, caplog):
    _night(tmp_path, monkeypatch, missing=["H10:acc"])
    with open(tmp_path / "captures" / alerts.QC_LATCH_NAME, "w") as fh:
        fh.write("{not json")
    capture._STOP.clear()
    _stop_after(monkeypatch, 2)
    n = _N()
    with caplog.at_level("WARNING"):
        _run(
            capture.qc_poller(
                {"qc": {"poll_sec": 1, "digest_hour": -1, "alert_after_sec": 0}, "devices": []}, str(tmp_path), n
            )
        )
    assert n.sent == ["Tepna: night has a gap"]
    assert "the qc latch starts empty" in caplog.text


@pytest.mark.sets_capture_events
def test_an_unchanged_latch_is_not_rewritten(tmp_path, monkeypatch):
    _night(tmp_path, monkeypatch, missing=[])
    writes = []
    real = capture._write_quiet_state
    monkeypatch.setattr(capture, "_write_quiet_state", lambda p, s, w="": (writes.append(s), real(p, s, w)))
    capture._STOP.clear()
    _stop_after(monkeypatch, 4)
    _run(capture.qc_poller({"qc": {"poll_sec": 1, "digest_hour": 9}, "devices": []}, str(tmp_path), _N()))
    assert writes == [{"digest_sent": "2026-08-18", "gap_alerted": []}], writes
