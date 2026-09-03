# tepna-capture — tests/test_parse_dat.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`parse_dat.py` — Wellue O2Ring S Format-A `.dat` decode.

The module shipped with no test file at all, which is the case `pyproject.toml` names as the thing
the coverage gate exists to prevent: an untested file reads as zero-coverage DEBT rather than as a
finding. It was 66 % (34 uncovered statements) and blocking #2132.

⚠️ **THE FIXTURE RULE, and it governs every byte below: a fixture must not be able to do something
the hardware cannot.** Two suites in this fleet went green this week while proving a property of
their own fake — a FakeDev answering `0xFF` where no ring we own does, and a FakeGattClient answering
a DIS characteristic this ring does not implement. So the invalid-sample tests here use the values
the device ACTUALLY emits — `0` for finger-off, and a sub-50 reading — and never an impossible
`spo2 = 150`, which would exercise the same `50 <= s <= 100` arm while proving nothing about a real
recording. Where a byte's reachability on hardware is genuinely unknown, the test says so rather
than implying it was verified.

Real `.dat` files are gitignored, so the regression story is SELF-CONSISTENCY (mean valid SpO2 ≈
trailer avg ±1; n_samples ≈ total_seconds) rather than a golden fixture — the module's own docstring
makes that the contract, and `test_self_consistency_*` pins both halves of it.
"""

import datetime
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import parse_dat  # noqa: E402


HDR = b"\x00" * parse_dat.HEADER_LEN


def _samples(*triples):
    """Body bytes from (spo2, pulse, motion) triples — raw values, exactly as the device writes."""
    b = bytearray(HDR)
    for s, h, mo in triples:
        b += bytes([s, h, mo])
    return bytes(b)


TERMINATOR = bytes([0xFF, 0xFF, 0x00])


def _file(*triples, trailer=None):
    """A REALISTIC recording: header + samples + terminator + optional trailer.

    ⚠️ The terminator is not decoration. Without it the parser walks straight into the 48-byte
    trailer and decodes 16 phantom samples — which is correct behaviour on a file no ring writes.
    My first draft of these tests omitted it and asserted `decoded 3 samples` against a real answer
    of 19; the fixture, not the parser, was wrong. That is the fixture rule catching its own author,
    so the helper now makes the honest shape the default.
    """
    return _samples(*triples) + TERMINATOR + (trailer or b"")


def _trailer(total_seconds=3, avg_spo2=97, score=78, avg_hr=64, min_spo2=95):
    t = bytearray(parse_dat._TRAILER_LEN)
    t[4:8] = parse_dat._SUBMAGIC
    t[12] = total_seconds & 0xFF
    t[13] = (total_seconds >> 8) & 0xFF
    t[34] = avg_spo2
    t[35] = min_spo2
    t[36] = 3
    t[37] = 1
    t[39] = 0
    t[40] = 0
    t[41] = 1
    t[42] = score
    t[47] = avg_hr
    return bytes(t)


# ── parse_oxy_dat ────────────────────────────────────────────────────────────────────────────────

def test_samples_decode_at_1hz_with_motion_scaled():
    """`sec` is the 1 Hz index and `motion` is the raw byte doubled (the OxyDex CSV scaling)."""
    meta, samples, trailer = parse_dat.parse_oxy_dat(_samples((97, 64, 3), (96, 65, 0)))
    assert meta == {"header_len": 10, "sample_hz": 1, "n_samples": 2, "finalized": False}
    assert [s["sec"] for s in samples] == [0, 1]
    assert [s["spo2"] for s in samples] == [97, 96]
    assert [s["motion"] for s in samples] == [6, 0]
    assert trailer is None


def test_the_terminator_ends_the_stream_and_is_not_a_sample():
    """Both bytes must be 0xFF — that is the documented end-of-data marker."""
    data = _samples((97, 64, 1)) + bytes([0xFF, 0xFF, 0x00]) + bytes([98, 66, 1])
    meta, samples, _ = parse_dat.parse_oxy_dat(data)
    assert meta["n_samples"] == 1, "decoding continued past the terminator"


def test_finger_off_reads_as_None_not_as_a_low_reading():
    """`0` is what the ring writes with the finger off. It must not become a 0 % SpO2 datum.

    Deliberately NOT tested with `spo2 = 150`: that hits the same `50 <= s <= 100` arm while being a
    value no O2Ring emits, so it would prove a property of the fixture rather than of a recording.
    """
    _, samples, _ = parse_dat.parse_oxy_dat(_samples((0, 64, 0), (48, 64, 0)))
    assert [s["spo2"] for s in samples] == [None, None]
    assert [s["pulse"] for s in samples] == [64, 64], "a bad SpO2 must not invalidate its pulse"


def test_a_zero_pulse_reads_as_None():
    """`0` is the device's no-reading pulse; the sample survives with `pulse=None`."""
    _, samples, _ = parse_dat.parse_oxy_dat(_samples((97, 0, 0)))
    assert samples[0]["pulse"] is None and samples[0]["spo2"] == 97


def test_a_trailing_partial_record_is_dropped_not_padded():
    """A pull cut mid-record must not invent a sample from 1–2 bytes."""
    _, samples, _ = parse_dat.parse_oxy_dat(_samples((97, 64, 1)) + b"\x61\x40")
    assert len(samples) == 1


def test_the_trailer_is_read_only_behind_its_submagic():
    body = _samples((97, 64, 1), (96, 65, 1), (98, 63, 1))
    meta, samples, trailer = parse_dat.parse_oxy_dat(body + TERMINATOR + _trailer())
    assert meta["finalized"] is True and len(samples) == 3, "the terminator must stop the decode"
    assert trailer["total_seconds"] == 3 and trailer["avg_spo2"] == 97 and trailer["avg_hr"] == 64
    assert trailer["o2_score_x10"] == 78


def test_a_scrambled_trailer_is_refused_rather_than_decoded():
    """An over-read USB pull scrambles the trailer; the wrong bytes must not be read as stats."""
    bad = bytearray(_trailer())
    bad[4:8] = b"\x00\x00\x00\x00"
    meta, _, trailer = parse_dat.parse_oxy_dat(_file((97, 64, 1), trailer=bytes(bad)))
    assert trailer is None and meta["finalized"] is False


def test_an_absent_o2_score_is_None_not_255():
    """`0xFF` in the score byte means "not computed" — surfacing 255 would be a fabricated score."""
    _, _, trailer = parse_dat.parse_oxy_dat(_file((97, 64, 1), trailer=_trailer(score=0xFF)))
    assert trailer["o2_score_x10"] is None


# ── oxy_start_dt ─────────────────────────────────────────────────────────────────────────────────

def test_the_start_instant_comes_from_the_filename_stamp():
    assert parse_dat.oxy_start_dt("/x/20260830132000.dat") == datetime.datetime(2026, 8, 30, 13, 20, 0)


@pytest.mark.parametrize("name", ["", None, "recording.dat", "/x/1234567890123.dat"])
def test_no_stamp_means_UNDATED_never_a_fabricated_time(name):
    """House rule #2: a missing stamp yields None. `datetime.now()` here would be a fabricated instant."""
    assert parse_dat.oxy_start_dt(name) is None


def test_a_14_digit_run_that_is_not_a_date_is_refused():
    """Digits are not calendar validity — `99999999999999` matches the regex and is not a time."""
    assert parse_dat.oxy_start_dt("99999999999999.dat") is None


# ── self_consistency ─────────────────────────────────────────────────────────────────────────────

def test_consistency_is_undecidable_without_a_trailer():
    ok, notes = parse_dat.self_consistency([{"spo2": 97}], None)
    assert ok is None, "a missing trailer must be UNDECIDABLE, not a pass and not a failure"
    assert "no valid trailer" in notes[0]


def test_consistency_passes_when_the_body_matches_the_trailer():
    samples = [{"spo2": 97} for _ in range(100)]
    ok, notes = parse_dat.self_consistency(samples, {"avg_spo2": 97, "total_seconds": 100})
    assert ok is True and len(notes) == 2


def test_consistency_fails_when_the_mean_is_off_by_more_than_one():
    samples = [{"spo2": 92} for _ in range(100)]
    ok, _ = parse_dat.self_consistency(samples, {"avg_spo2": 97, "total_seconds": 100})
    assert ok is False


def test_all_samples_invalid_is_a_FAILURE_not_a_vacuous_pass():
    """No comparable SpO2 means the check proved nothing — it must not report ok."""
    ok, notes = parse_dat.self_consistency([{"spo2": None}], {"avg_spo2": 97, "total_seconds": 1})
    assert ok is False and "no valid spo2 samples" in notes[0]


def test_the_count_tolerance_scales_so_a_long_night_is_not_false_flagged():
    """A 6.2 h night legitimately drops a few 1 Hz samples; a fixed ±2 would red every real file."""
    samples = [{"spo2": 97} for _ in range(22462)]
    ok, _ = parse_dat.self_consistency(samples, {"avg_spo2": 97, "total_seconds": 22472})
    assert ok is True
    # …and the percentage is still a bound, not a blank cheque.
    ok2, _ = parse_dat.self_consistency(samples, {"avg_spo2": 97, "total_seconds": 30000})
    assert ok2 is False


# ── write_csv ────────────────────────────────────────────────────────────────────────────────────

def test_csv_writes_absolute_times_when_the_start_is_known(tmp_path):
    out = tmp_path / "o.csv"
    samples = [{"sec": 0, "spo2": 97, "pulse": 64, "motion": 6},
               {"sec": 1, "spo2": None, "pulse": None, "motion": 0}]
    parse_dat.write_csv(str(out), samples, datetime.datetime(2026, 8, 30, 13, 20, 0))
    rows = out.read_text().strip().split("\n")
    assert rows[0] == "sec,time,spo2,pulse,motion"
    assert rows[1].startswith("0,2026-08-30T13:20:00,97,64,6")
    assert rows[2] == "1,2026-08-30T13:20:01,,,0", "None must write EMPTY, never the string 'None'"


def test_csv_leaves_time_blank_when_the_recording_is_undated(tmp_path):
    out = tmp_path / "o.csv"
    parse_dat.write_csv(str(out), [{"sec": 0, "spo2": 97, "pulse": 64, "motion": 0}], None)
    assert out.read_text().strip().split("\n")[1] == "0,,97,64,0"


# ── the synthetic builder, and the round trip the module documents ───────────────────────────────

def test_the_synthetic_dat_round_trips_through_the_real_parser():
    """This is the module's own regression: build → parse → self-consistency, no golden file."""
    data, n, avg = parse_dat._build_synthetic_dat()
    meta, samples, trailer = parse_dat.parse_oxy_dat(data)
    assert meta["n_samples"] == n and trailer["total_seconds"] == n and trailer["avg_spo2"] == avg
    ok, _ = parse_dat.self_consistency(samples, trailer)
    assert ok is True


def test_the_synthetic_fixture_cannot_emit_a_reading_the_ring_cannot():
    """The fixture rule, asserted rather than trusted.

    Every SpO2 byte must be one the hardware produces: 0 (finger off) or 50–100. A builder that
    drifted into 101–254 would still round-trip and would still pass every test above, while pinning
    a recording no O2Ring can write.
    """
    data, _, _ = parse_dat._build_synthetic_dat()
    body = data[parse_dat.HEADER_LEN:-parse_dat._TRAILER_LEN]
    for i in range(0, len(body) - 2, 3):
        s, h = body[i], body[i + 1]
        if s == 0xFF and h == 0xFF:
            break
        assert s == 0 or 50 <= s <= 100, f"synthetic SpO2 {s} is not a value this ring emits"
        assert 0 <= h < 0xFF, f"synthetic pulse {h} is not a value this ring emits"


# ── main() ───────────────────────────────────────────────────────────────────────────────────────

def test_main_decodes_a_file_and_reports_the_trailer(tmp_path, capsys, monkeypatch):
    dat = tmp_path / "20260830132000.dat"
    body = _samples(*[(97, 64, 1) for _ in range(3)])
    dat.write_bytes(body + TERMINATOR + _trailer())
    monkeypatch.setattr(sys, "argv", ["parse_dat.py", str(dat)])
    parse_dat.main()
    out = capsys.readouterr().out
    assert "decoded 3 samples" in out and "trailer stats:" in out
    assert "self-consistency: PASS" in out
    assert (tmp_path / "20260830132000.csv").exists(), "the default output path is <dat>.csv"


def test_main_says_UNDATED_rather_than_inventing_a_start(tmp_path, capsys, monkeypatch):
    dat = tmp_path / "nostamp.dat"
    dat.write_bytes(_file((97, 64, 1)))
    monkeypatch.setattr(sys, "argv", ["parse_dat.py", str(dat), "-o", str(tmp_path / "x.csv")])
    parse_dat.main()
    out = capsys.readouterr().out
    assert "UNDATED" in out and "No start time is fabricated" in out


def test_main_reports_a_missing_trailer_rather_than_staying_silent(tmp_path, capsys, monkeypatch):
    dat = tmp_path / "20260830132000.dat"
    dat.write_bytes(_file((97, 64, 1)))
    monkeypatch.setattr(sys, "argv", ["parse_dat.py", str(dat)])
    parse_dat.main()
    assert "no valid 48-byte trailer" in capsys.readouterr().out


def test_main_flags_a_failed_consistency_with_the_offset_hint(tmp_path, capsys, monkeypatch):
    """The CHECK branch must name the likely cause — a shifted FILE_DATA header offset."""
    dat = tmp_path / "20260830132000.dat"
    dat.write_bytes(_file((80, 64, 1), trailer=_trailer(total_seconds=999, avg_spo2=97)))
    monkeypatch.setattr(sys, "argv", ["parse_dat.py", str(dat)])
    parse_dat.main()
    out = capsys.readouterr().out
    assert "self-consistency: CHECK" in out and "header offset" in out


def test_main_requires_a_file_or_selftest(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["parse_dat.py"])
    with pytest.raises(SystemExit) as e:
        parse_dat.main()
    assert e.value.code == 2, "argparse error exit"


def test_main_selftest_exits_zero(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["parse_dat.py", "--selftest"])
    with pytest.raises(SystemExit) as e:
        parse_dat.main()
    assert e.value.code == 0
