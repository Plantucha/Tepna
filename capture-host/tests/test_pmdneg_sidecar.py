# tepna-capture — tests/test_pmdneg_sidecar.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# PMDNEG.csv — what the DEVICE agreed to, written into the night it agreed in
# (residue 2026-09-22-negotiated-pmd-rate-not-written).
#
# The daemon logged `START ppg (negotiated) -> ok` and nothing else: not the menu the device reported,
# not the rate `polar_pmd.chosen_rate` picked from it. Measured on vigil 2026-09-22, three days of
# journal carry three of those lines for the Verity and ZERO naming a PPG menu or a rate — so "what
# was this stream captured at" had to be inferred after the fact from rows over a stamp span, and a
# night captured at four times the configured rate left only a warning line as its trace.
#
# Three layers, tested separately and then wired, exactly as CLOCKSYNC.csv is:
#   · `writers.append_pmd_negotiation` — header discipline, honest blanks, the empty-menu case,
#     sanitisation, never-raise;
#   · the EMITTER — a real `run_polar` negotiation lands a row, INCLUDING a refused one (behavioural,
#     because a source scan cannot see a wrong argument);
#   · `nightqc.pmd_negotiations` / `rate_reality` — the consumer that turns config-vs-file into
#     config-vs-device-vs-file.

import datetime as dt
import os

import capture
import nightqc
import polar_pmd
import writers

WHEN = dt.datetime(2026, 9, 22, 23, 5, 1)

def _row(tmp_path, **over):
    kw = dict(requested=176, offered=[28, 44, 55, 135, 176], chosen=176, ack="ok", how="negotiated")
    kw.update(over)
    ok = writers.append_pmd_negotiation(str(tmp_path), WHEN, "Polar Sense", "AA:BB:CC", "ppg", **kw)
    return ok, os.path.join(str(tmp_path), "captures", "2026-09-22", writers.PMDNEG_NAME)

# ── the writer ────────────────────────────────────────────────────────────────────────────────────

def test_first_append_writes_the_header_then_one_row_and_a_second_does_not_repeat_it(tmp_path):
    ok, path = _row(tmp_path)
    assert ok
    ok2, _ = _row(tmp_path, chosen=55, requested=None)
    assert ok2
    lines = open(path, encoding="utf-8").read().splitlines()
    assert len(lines) == 3 and lines[0].startswith("Phone timestamp;device;address;stream")
    assert lines[1].split(";")[3:] == ["ppg", "176", "28,44,55,135,176", "176", "ok", "negotiated"]

def test_an_absent_request_is_BLANK_and_an_empty_menu_is_NOT_the_same_as_no_menu(tmp_path):
    """Three different facts that a single 0 would collapse (§∅): the config asked for nothing; the
    device reported a settings block with no rate list (its own default stands); no settings were read
    at all."""
    _row(tmp_path, requested=None, chosen=None, offered=None)
    _row(tmp_path, offered=[])
    lines = open(_row(tmp_path)[1], encoding="utf-8").read().splitlines()
    assert lines[1].split(";")[4:7] == ["", "", ""], "absent request, absent menu, absent rate are blank"
    assert lines[2].split(";")[5] == "none", "a menu the device reported as EMPTY is not an absent menu"

def test_a_refused_start_is_recorded_too(tmp_path):
    """The case an inferred rate cannot see: no rows were written, so rows-over-span says nothing."""
    _row(tmp_path, ack="in_charger", how="fixed", chosen=55)
    got = open(_row(tmp_path)[1], encoding="utf-8").read().splitlines()[1].split(";")
    assert got[6:9] == ["55", "in_charger", "fixed"]

def test_semicolons_and_newlines_cannot_break_the_row_shape(tmp_path):
    _row(tmp_path, ack="weird;status\nline", how="neg;otiated")
    line = open(_row(tmp_path)[1], encoding="utf-8").read().splitlines()[1]
    assert len(line.split(";")) == 9 and "weird,status line" in line

def test_no_root_means_no_row_and_no_error():
    assert writers.append_pmd_negotiation("", WHEN, "d", "a", "ppg", requested=1, offered=[1],
                                          chosen=1, ack="ok", how="negotiated") is False

def test_an_unwritable_root_returns_false_never_raises(tmp_path):
    d = tmp_path / "ro"
    d.mkdir()
    os.chmod(d, 0o500)
    try:
        assert _row(d)[0] is False
    finally:
        os.chmod(d, 0o700)

def test_an_unusable_rate_is_refused_rather_than_written_as_a_lie(tmp_path):
    """A caller that hands a non-numeric menu gets False and a debug line, not a half-written row."""
    assert _row(tmp_path, offered=["fast"])[0] is False

# ── the emitter: a REAL negotiation, through run_polar ────────────────────────────────────────────

def _drive(tmp_path, monkeypatch, status):
    from test_capture_runners import FakePolarClient, _inject_connect, _pdev, _polar_common, _run, _stop_after
    _polar_common(monkeypatch)
    _inject_connect(monkeypatch, FakePolarClient(start_status=status))
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    capture._STOP.clear()          # `_stop_after` sets it; the conftest tripwire is right to ask
    found = [os.path.join(r, n) for r, _d, ns in os.walk(str(tmp_path)) for n in ns if n == writers.PMDNEG_NAME]
    assert len(found) == 1, f"exactly one PMDNEG.csv per night, got {found}"
    return [ln.split(";") for ln in open(found[0], encoding="utf-8").read().splitlines()[1:]]

def test_a_started_negotiation_lands_a_row_naming_the_stream_and_the_ack(tmp_path, monkeypatch):
    rows = _drive(tmp_path, monkeypatch, 0x00)
    assert rows and all(len(r) == 9 for r in rows)
    ecg = [r for r in rows if r[3] == "ecg"]
    assert ecg and ecg[0][7] == "ok" and ecg[0][6].isdigit(), "the rate the daemon will back-time with"

def test_a_REFUSED_negotiation_lands_a_row_as_well(tmp_path, monkeypatch):
    """0x0D in_charger: the stream never starts, so nothing else in the night records that it was
    asked for at all."""
    rows = _drive(tmp_path, monkeypatch, 0x0D)
    assert rows and {r[7] for r in rows} == {"in_charger"}

# ── the consumer ──────────────────────────────────────────────────────────────────────────────────

def _sidecar(tmp_path, rows):
    night = tmp_path / "2026-09-22"
    night.mkdir(exist_ok=True)
    body = ["Phone timestamp;device;address;stream;requested_hz;offered_hz;chosen_hz;ack;how"] + rows
    (night / writers.PMDNEG_NAME).write_text("\n".join(body) + "\n", encoding="utf-8")
    return str(night)

def test_pmd_negotiations_counts_every_start_and_reports_a_rate_only_when_they_AGREE(tmp_path):
    started = {polar_pmd.CTRL_STATUS[c] for c in polar_pmd.CTRL_STATUS if polar_pmd.is_started(c)}
    assert "ok" in started, "the started vocabulary is derived from polar_pmd, not restated here"
    d = _sidecar(tmp_path, [
        "t;Verity;A;ppg;176;28,44,55;55;ok;negotiated",
        "t;Verity;A;ppg;176;28,44,55;55;already_streaming;negotiated",
        "t;Verity;A;acc;52;26,52;52;in_charger;fixed",       # refused: counted, no rate
        "t;Verity;A;gyro;52;26,52;52;ok;negotiated",
        "t;Verity;A;gyro;52;26,52;26;ok;negotiated",          # disagreeing starts
        "torn;row",
    ])
    got = nightqc.pmd_negotiations(d)
    assert got[("Verity", "ppg")] == {"chosen": 55, "offered": "28,44,55", "starts": 2}
    assert got[("Verity", "acc")] == {"chosen": None, "offered": "26,52", "starts": 1}, (
        "a refused START claims no RATE — but it still reports the MENU the device named before "
        "refusing, because the menu is a property of the device and not of the outcome")
    assert got[("Verity", "gyro")] == {"chosen": None, "offered": "26,52", "starts": 2}, (
        "a session that began at two rates was captured at neither — null, not a first or a mean")
    assert nightqc.pmd_negotiations(str(tmp_path / "nope")) == {}

def test_a_device_that_only_ever_REFUSES_still_reports_its_menu(tmp_path):
    """The case the box produced on the day this shipped, and the reason the menu is read from every
    row: a Verity left on its charger refused **63** ACC starts in an hour, each row recording
    `offered 52`, and the reader answered `offered: None` — a null standing where sixty-three
    measurements existed. `chosen` stays null (nothing was captured), `starts` carries the count, and
    the menu is reported because the device named it."""
    d = _sidecar(tmp_path, ["t;Polar Sense;A;acc;52;52;52;in_charger;negotiated"] * 63)
    got = nightqc.pmd_negotiations(d)[("Polar Sense", "acc")]
    assert got == {"chosen": None, "offered": "52", "starts": 63}


def test_a_row_with_NO_menu_at_all_contributes_nothing_to_offered(tmp_path):
    """A blank menu column means no settings were read — an absence, and it must not become the
    device's answer, nor collide with a real menu into a disagreement that nulls both."""
    d = _sidecar(tmp_path, ["t;V;A;ppg;;;;in_charger;fixed", "t;V;A;ppg;176;28,44,55;55;ok;negotiated"])
    assert nightqc.pmd_negotiations(d)[("V", "ppg")] == {"chosen": 55, "offered": "28,44,55", "starts": 2}


def test_a_blank_rate_on_a_started_row_is_an_absence_not_a_zero(tmp_path):
    d = _sidecar(tmp_path, ["t;Verity;A;ppg;;;;ok;negotiated"])
    assert nightqc.pmd_negotiations(d)[("Verity", "ppg")]["chosen"] is None

def test_rate_reality_carries_the_middle_term_and_nulls_it_when_the_night_has_none(tmp_path):
    """config vs file was the whole comparison; the device's own answer sits between them."""
    d = _sidecar(tmp_path, ["t;Verity;A;ppg;176;28,44,55;55;ok;negotiated"])
    open(os.path.join(d, "Polar_VeritySense_0C301E3F_20260922210522_PPG.txt"), "w").write(
        "Phone timestamp;sensor timestamp [ns];channel 0\n")
    dev = {"name": "Verity", "vendor": "Polar", "model": "VeritySense", "device_id": "0C301E3F",
           "streams": ["ppg"], "rates": {"ppg": 176}}
    row = nightqc.rate_reality(d, [dev])[0]
    assert row["negotiated_hz"] == 55 and row["offered_hz"] == "28,44,55" and row["negotiated_starts"] == 1
    assert row["requested_hz"] == 176, "the config's number stays what it always was"
    os.unlink(os.path.join(d, writers.PMDNEG_NAME))
    bare = nightqc.rate_reality(d, [dev])[0]
    assert bare["negotiated_hz"] is None and bare["offered_hz"] is None and bare["negotiated_starts"] == 0
