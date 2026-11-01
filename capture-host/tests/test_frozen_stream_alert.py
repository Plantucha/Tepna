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

import pytest

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
    devs = [
        {"name": "H10", "device_id": "02849638", "streams": ["ecg"]},
        {"name": "Verity", "device_id": "0C301E3F", "streams": ["ppg"]},
    ]
    got = {d["name"]: d.get("silent_sec") for d in nightqc.summarize(str(night), devs)["devices"]}
    assert got["H10"] == 0, "the device holding the newest write is silent for zero seconds"
    assert got["Verity"] == 4000


def test_summarize_reports_none_for_a_device_that_wrote_nothing(tmp_path):
    night = tmp_path / "2026-07-26"
    night.mkdir()
    _cap(night, "Polar_H10_02849638_20260726000000_ECG.txt", 1000, 1_700_000_000)
    devs = [
        {"name": "H10", "device_id": "02849638", "streams": ["ecg"]},
        {"name": "Absent", "device_id": "ZZZZ", "streams": ["ppg"]},
    ]
    got = {d["name"]: d.get("silent_sec") for d in nightqc.summarize(str(night), devs)["devices"]}
    assert got["Absent"] is None


def test_a_live_status_that_is_not_a_dict_is_NAMED_not_stepped_over():
    """⚠️ THE FLAKE THIS EXISTS FOR. On main under `-n 4`, `qc_poller` logged
    `AttributeError("'str' object has no attribute 'get'")` and reddened #3024, #3027 and 320d7a6e. The
    handler logged only the repr, so the message named neither the device nor the value nor the frame —
    and three sessions read `summ` as the suspect, though `summ["isolation"] = …` on the line after the
    offload proves it is a dict. Both consumers of `STATUS["devices"]` dereference a per-device entry
    with `.get`, so a non-dict entry raises THERE.

    They now refuse by name: the device, the type, and the value. That does not fix whatever writes one
    — production only ever writes `setdefault(name, {})` — but the next occurrence says which device and
    what arrived, which is the difference between a defect and a rumour."""
    qc = {"devices": [{"name": "H10", "silent_sec": 9999.0}]}
    for fn, args in (
        (alerts.arrival_canary, (qc, {"H10": "connected"})),
        (alerts.frozen_devices, (qc, {"H10": "connected"}, 60.0)),
    ):
        with pytest.raises(TypeError) as ei:
            fn(*args)
        msg = str(ei.value)
        assert "'H10'" in msg and "str" in msg and "connected" in msg, msg
    # None is not a fault — it is an unknown state, and both already read it as no evidence
    assert alerts.arrival_canary(qc, {"H10": None}) == []
    assert alerts.frozen_devices(qc, {"H10": None}, 60.0) == []


# ── THE SUMMARY SIDE OF THE SAME GUARD (residue: the qc poll's `'str' object has no attribute 'get'`)
# #3034 named a non-dict LIVE STATUS and left the SUMMARY side unguarded, so the exact error it was
# written to abolish still had a live path: `frozen_devices` walks `qc["devices"]` and calls
# `d.get("name")` with no check. Measured on main before this fix — both of these raise the bare
# `AttributeError: 'str' object has no attribute 'get'`, which is the signature that reddened three
# PRs and `main` itself three times on 2026-09-24:
#
#     frozen_devices({"devices": "H10"},   {}, 1.0)   # a STRING iterates as CHARACTERS
#     frozen_devices({"devices": ["H10"]}, {}, 1.0)   # a list holding a non-dict
#
# The first is the nastier shape and the reason the type is checked before the loop rather than only
# inside it: `for d in "H10"` is legal, yields 'H','1','0', and reports a fault about a device that
# does not exist rather than failing outright.


def test_a_string_devices_value_is_REFUSED_not_iterated_as_characters():
    """`qc["devices"]` must be a list. A str is iterable, so an unguarded loop walks its letters."""
    with pytest.raises(TypeError) as ei:
        alerts.frozen_devices({"devices": "H10"}, {}, 1.0)
    msg = str(ei.value)
    assert "devices" in msg and "str" in msg, msg
    assert "H10" in msg, "the refusal must quote what arrived, or it names no producer"


def test_a_non_dict_device_entry_is_REFUSED_naming_its_index_and_value():
    """The element guard, mirroring #3034's `live status for <name> is <type>` on the other side."""
    with pytest.raises(TypeError) as ei:
        alerts.frozen_devices({"devices": [{"name": "H10", "silent_sec": 99}, "wat"]}, {}, 1.0)
    msg = str(ei.value)
    assert "1" in msg and "str" in msg and "wat" in msg, msg


def test_a_well_formed_summary_still_works():
    """ANTI-VACUITY: the guards must not convict the shape the producer actually emits."""
    out = alerts.frozen_devices({"devices": [{"name": "H10", "silent_sec": 900}]}, {"H10": {"connected": True}}, 600.0)
    assert out == ["H10"]
    assert alerts.frozen_devices({"devices": []}, {}, 1.0) == []
    assert alerts.frozen_devices({}, {}, 1.0) == []


# ── A SILENCE THE BOX ITSELF CAUSED (measured 2026-11-01 15:00) ────────────────────────────────
# The ring and the Sense had written nothing for ~1750 s, the rule fired, and the watchdog restarted
# the daemon mid-afternoon. The Sense was in an offline-recording op and the ring was off the finger.
# Neither state was readable here, though the charger clause had always been the same kind of clause.


def _st(**kw):
    """One STATUS["devices"] entry. `connected` defaults to True — every test below is about a device
    whose link is up, which is the only state this rule judges."""
    return {"connected": True, **kw}


def test_a_device_in_an_offline_recording_op_is_not_frozen():
    """THE Sense at 15:00. A PS-FTP download holds the link and the device sends no live sample."""
    qc = _qc({"Sense": 1750})
    live = {"Sense": _st(address="AA:BB")}
    assert alerts.frozen_devices(qc, live, 600, ["AA:BB"]) == []


def test_a_device_off_the_body_is_not_frozen():
    """THE ring at 15:00. `worn is False` is the device's own word for "nothing to send"."""
    assert alerts.frozen_devices(_qc({"Ring": 1750}), {"Ring": _st(worn=False)}, 600) == []


def test_an_unknown_wear_state_explains_nothing():
    """§∅ — absence is not an explanation. `worn` is absent on a device with no wear detection and None
    before the first frame, so neither may suppress the one alert that sees a mid-night freeze."""
    assert alerts.frozen_devices(_qc({"V": 1750}), {"V": _st()}, 600) == ["V"]
    assert alerts.frozen_devices(_qc({"V": 1750}), {"V": _st(worn=None)}, 600) == ["V"]


def test_another_devices_pause_explains_nothing():
    """ANTI-VACUITY: the offline slot is global, so the pause list names addresses rather than meaning
    "a pull is running somewhere". A device that is not in it is still judged."""
    qc = _qc({"Sense": 1750})
    live = {"Sense": _st(address="AA:BB")}
    assert alerts.frozen_devices(qc, live, 600, ["CC:DD"]) == ["Sense"]


def test_a_device_with_no_address_is_not_matched_against_the_pauses():
    """A device status with no address cannot be in the pause list, and `None in [...]` must never be
    the question asked."""
    assert alerts.frozen_devices(_qc({"X": 1750}), {"X": _st()}, 600, [None]) == ["X"]


def test_the_pause_argument_is_optional_and_defaults_to_nothing_known():
    """Back-compatible: the three-argument call keeps the charger-and-worn answer, never a wrong one."""
    live = {"Sense": _st(address="AA:BB")}
    assert alerts.frozen_devices(_qc({"Sense": 1750}), live, 600) == ["Sense"]
    assert alerts.frozen_devices(_qc({"Sense": 1750}), live, 600, None) == ["Sense"]


def test_the_explanation_is_NAMED_and_each_state_has_its_own_word():
    """A suppression owes a reason of its own. A borrowed one sends the next reader after the wrong
    subsystem, which is §∅'s rule about a named `null` applied to a silence."""
    assert alerts.explained_silence(_st(charging=True)) == "charging"
    assert alerts.explained_silence(_st(worn=False)) == "not-worn"
    assert alerts.explained_silence(_st(address="AA:BB"), ["AA:BB"]) == "offline-op"
    assert alerts.explained_silence(_st(address="AA:BB"), ["CC:DD"]) is None
    assert alerts.explained_silence(_st()) is None
    # the charger wins over the pull, and that order is not arbitrary: a docked device is silent for the
    # whole dock, while a pull ends in seconds — the longer-lived state is the one worth naming.
    assert alerts.explained_silence(_st(charging=True, address="AA:BB"), ["AA:BB"]) == "charging"


# ── THE TWO BOUNDARIES THE MUTATION GATE FOUND UNOBSERVED (#4242, 2026-11-01) ───────────────────────
# The unit is the FUNCTION, so touching `frozen_devices` put its whole body in scope and two mutants
# survived on lines this diff never edited. Both are real gaps rather than equivalences, and each one
# names a behaviour a reader would assume was already pinned.
def test_frozen_devices_reports_a_device_silent_EXACTLY_as_long_as_the_threshold():
    """`silent < threshold_sec` skips, so the threshold itself REPORTS. Flipping that one comparison to
    `<=` moves the boundary by one device-poll and no test saw it. The threshold is the point at which a
    silence becomes a fault, not the last moment it is still forgiven."""
    qc = _qc({"H10": 600})
    live = {"H10": _st()}
    assert alerts.frozen_devices(qc, live, 600) == ["H10"]
    assert alerts.frozen_devices(qc, live, 600.5) == [], "just under the threshold is still forgiven"


def test_frozen_devices_keeps_WALKING_past_a_device_it_skips():
    """The skip is a `continue`, and a `break` there passed every test — because no test had a reportable
    device AFTER a skipped one. One quiet device first in the summary would then have hidden every frozen
    device behind it, which is a false all-clear and the worst failure this rule has."""
    qc = _qc({"quiet": 1, "H10": 900})
    live = {"quiet": _st(), "H10": _st()}
    assert alerts.frozen_devices(qc, live, 600) == ["H10"]
