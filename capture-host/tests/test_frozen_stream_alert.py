# tepna-capture — tests/test_frozen_stream_alert.py
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""A sensor that is CONNECTED and sending nothing.

On 2026-07-25 the Verity acknowledged four PMD streams `ok` at 23:51:23 and then wrote nothing until
04:16:01 — 4 h 25 m — with the link up the whole time. The unbounded-GATT-read that caused it is
fixed, but nothing would have TOLD anyone: that is the gap this closes.

QC already alerts on `missing`, which means "this stream produced nothing all night". It cannot see
this failure, because the moment 04:16 arrived those streams had rows and stopped being missing. The
detectable signature is different and much sharper:

    the night is still being written, this device is connected, it is not on a charger,
    and it has written nothing for a long time

Each clause earns its place by excluding a false positive that would otherwise fire nightly:
  • "still being written" — at the end of a night everything goes quiet; that is bedtime ending.
  • "connected" — a sensor out of range or switched off is already covered by the offline alert.
  • "not charging" — a docked ring is silent by design, every single morning.
"""
import alerts
import nightqc


# ── the pure decision ─────────────────────────────────────────────────────────────────────────
def _qc(silent):
    return {"devices": [{"name": n, "silent_sec": s} for n, s in silent.items()]}


def _live(**kw):
    return {n: {"connected": c, "charging": g} for n, (c, g) in kw.items()}


def test_a_connected_sensor_silent_too_long_is_frozen():
    """THE Verity. Link up, nothing arriving, and the rest of the box still recording."""
    got = alerts.frozen_devices(_qc({"Verity": 4000}), _live(Verity=(True, False)), 600)
    assert got == ["Verity"]


def test_a_charging_sensor_is_not_frozen():
    """The ring sits on its dock silent every morning. Alerting on that trains you to ignore alerts."""
    assert alerts.frozen_devices(_qc({"Ring": 4000}), _live(Ring=(True, True)), 600) == []


def test_a_disconnected_sensor_is_not_frozen():
    """Out of range or switched off is a different fault with its own alert — offline_alert_due."""
    assert alerts.frozen_devices(_qc({"H10": 4000}), _live(H10=(False, False)), 600) == []


def test_a_sensor_writing_normally_is_not_frozen():
    assert alerts.frozen_devices(_qc({"H10": 3}), _live(H10=(True, False)), 600) == []


def test_a_sensor_that_never_wrote_at_all_is_not_reported_here():
    """`silent_sec` is None when a device produced nothing — that is `missing`, and it already has an
    alert. Reporting it twice under two names is noise."""
    assert alerts.frozen_devices(_qc({"X": None}), _live(X=(True, False)), 600) == []


def test_a_device_absent_from_live_status_is_not_guessed_at():
    assert alerts.frozen_devices(_qc({"Ghost": 4000}), {}, 600) == []


def test_every_frozen_device_is_reported_not_just_the_first():
    got = alerts.frozen_devices(_qc({"A": 4000, "B": 5000}), _live(A=(True, False), B=(True, False)), 600)
    assert got == ["A", "B"]


# ── the fact it decides on ────────────────────────────────────────────────────────────────────
def _cap(night, name, rows, mtime):
    import os
    p = night / name
    p.write_text("h\n" + "x\n" * rows)
    os.utime(p, (mtime, mtime))
    return p


def test_summarize_reports_how_long_each_device_has_been_silent(tmp_path):
    """Measured against the night's NEWEST write, not wall-clock now: a night read back later must not
    report every device as frozen, and the question is always 'silent while others were writing'."""
    night = tmp_path / "2026-07-26"
    night.mkdir()
    _cap(night, "Polar_H10_02849638_20260726000000_ECG.txt", 1000, 1_700_000_000)
    _cap(night, "Polar_VeritySense_0C301E3F_20260726000000_PPG.txt", 1000, 1_700_000_000 - 4000)
    devs = [{"name": "H10", "device_id": "02849638", "streams": ["ecg"]},
            {"name": "Verity", "device_id": "0C301E3F", "streams": ["ppg"]}]
    got = {d["name"]: d.get("silent_sec") for d in nightqc.summarize(str(night), devs)["devices"]}
    assert got["H10"] == 0, "the device holding the newest write is silent for zero seconds"
    assert got["Verity"] == 4000


def test_summarize_reports_none_for_a_device_that_wrote_nothing(tmp_path):
    night = tmp_path / "2026-07-26"
    night.mkdir()
    _cap(night, "Polar_H10_02849638_20260726000000_ECG.txt", 1000, 1_700_000_000)
    devs = [{"name": "H10", "device_id": "02849638", "streams": ["ecg"]},
            {"name": "Absent", "device_id": "ZZZZ", "streams": ["ppg"]}]
    got = {d["name"]: d.get("silent_sec") for d in nightqc.summarize(str(night), devs)["devices"]}
    assert got["Absent"] is None
