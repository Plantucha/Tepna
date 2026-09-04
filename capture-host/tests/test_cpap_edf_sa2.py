# tepna-capture — tests/test_cpap_edf_sa2.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`build_sa2` and the derived EDF dictionary.

The AS11 writes SA2.edf every therapy night whether or not the optional wired oximeter is attached;
with none attached it is the -1 sentinel end to end. That makes the CONTAINER exceptionally well
evidenced — 294 files on the reference card, one declaration set — and leaves the channel empty,
which is the opening: the O2Ring can fill it.

⚠️ The fixture rule. Every constant asserted below came out of `tools/derive_edf_dict.py` reading a
real card, not out of a spec or a guess. Where the card cannot settle something — the encoding of a
REAL oximetry sample, which no file on that card contains — the test says so instead of inventing a
value that would pass while proving nothing.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import cpap_edf  # noqa: E402
import cpap_edf_dict  # noqa: E402


def _read(raw):
    return cpap_edf.read_edf(raw)


def _sig(edf, label):
    """`read_edf` leaves labels space-padded to the 16-byte EDF field; it does not strip, and
    other callers depend on that. Match on the trimmed name here rather than changing it."""
    return next(s for s in edf.signals if s.label.strip() == label)


def _decl(edf):
    return [tuple(str(v).strip() for v in
                  (s.label, s.dim, s.pmin, s.pmax, s.dmin, s.dmax, s.spr))
            for s in edf.signals]


def test_the_dictionary_carries_its_own_evidence():
    """A table without provenance is indistinguishable from a table someone typed."""
    for kind, spec in cpap_edf_dict.TYPES.items():
        assert spec["variants"] == 1, f"{kind} has more than one declaration set — do not trust it"
        assert spec["files"] >= 1 and spec["records"] >= 1
        assert spec["signals"], f"{kind} has no signals"


def test_annotation_types_are_EDF_plus_D_with_zero_record_seconds():
    """Measured, and easy to 'correct' into being wrong: EVE/CSL really do declare 0.00 and EDF+D."""
    for kind in ("EVE", "CSL"):
        assert cpap_edf_dict.TYPES[kind]["record_seconds"] == "0.00"
        assert cpap_edf_dict.TYPES[kind]["header_const"]["reserved"] == "EDF+D"
    assert cpap_edf_dict.TYPES["BRP"]["header_const"]["reserved"] == "EDF"


def test_a_written_sa2_matches_the_dictionary_declaration():
    """The whole point of a derived table: the writer is checked against the card, not against itself."""
    raw = cpap_edf.build_sa2([(0, 97, 64), (1, 96, 65)], (2026, 8, 30, 23, 0, 0), "23221590541")
    edf = _read(cpap_edf.write_edf(raw))
    assert cpap_edf.declaration_matches("SA2", _decl(edf), cpap_edf_dict.TYPES) == []


def test_a_gap_is_filled_with_the_sentinel_not_closed_up():
    """THE defect this API exists to prevent: a dropout must not shift every later sample earlier."""
    edf = _read(cpap_edf.write_edf(
        cpap_edf.build_sa2([(0, 97, 64), (30, 95, 66)], (2026, 8, 30, 23, 0, 0), "S")))
    spo2 = _sig(edf, "SpO2.1s")
    assert spo2.samples[0] == 97
    assert spo2.samples[30] == 95, "the second reading must stay at second 30, not slide to second 1"
    assert all(v == cpap_edf.SA2_ABSENT for v in spo2.samples[1:30]), "the gap must be sentinel"


def test_no_reading_never_becomes_a_zero_percent_desaturation():
    """`_num_signal` would clamp -1 to dig_min 0. A fabricated 0 % SpO2 is worse than a gap."""
    edf = _read(cpap_edf.write_edf(
        cpap_edf.build_sa2([(0, None, None)], (2026, 8, 30, 23, 0, 0), "S")))
    for lab in ("SpO2.1s", "Pulse.1s"):
        sig = _sig(edf, lab)
        assert sig.samples[0] == -1, f"{lab} sentinel was clamped into the declared range"


def test_the_tail_pads_with_the_sentinel_too():
    """Zero-padding a short record ends every recording with a burst of 0 % SpO2."""
    edf = _read(cpap_edf.write_edf(
        cpap_edf.build_sa2([(0, 97, 64)], (2026, 8, 30, 23, 0, 0), "S")))
    spo2 = _sig(edf, "SpO2.1s")
    assert len(spo2.samples) == 60, "one 60 s record"
    assert all(v == -1 for v in spo2.samples[1:])


def test_duplicate_and_negative_offsets_are_refused():
    """Both would silently lose a reading; neither is recoverable after the fact."""
    with pytest.raises(ValueError, match="duplicate sample offset"):
        cpap_edf.build_sa2([(5, 97, 64), (5, 96, 65)], (2026, 8, 30, 23, 0, 0), "S")
    with pytest.raises(ValueError, match="negative sample offset"):
        cpap_edf.build_sa2([(-1, 97, 64)], (2026, 8, 30, 23, 0, 0), "S")


def test_an_empty_recording_produces_a_header_only_file():
    edf = _read(cpap_edf.write_edf(cpap_edf.build_sa2([], (2026, 8, 30, 23, 0, 0), "S")))
    assert edf.n_records == 0


def test_record_count_rounds_up_to_whole_records():
    """61 seconds is two records, not one and a bit."""
    edf = _read(cpap_edf.write_edf(
        cpap_edf.build_sa2([(60, 97, 64)], (2026, 8, 30, 23, 0, 0), "S")))
    assert edf.n_records == 2


def test_the_serial_reaches_the_recording_id():
    edf = _read(cpap_edf.write_edf(
        cpap_edf.build_sa2([(0, 97, 64)], (2026, 8, 30, 23, 0, 0), "23221590541")))
    assert "SRN=23221590541" in edf.recording_id
    assert "SRN=UNKNOWN" not in edf.recording_id


def test_declaration_matches_names_the_field_that_differs():
    """A bool would not be actionable; the difference has to say which field and both values."""
    wrong = [("Pulse.1s", "bpm", "0.00", "300.00", "0", "300", "60"),
             ("SpO2.1s", "%", "0.00", "100.00", "0", "200", "60"),
             ("Crc16", "", "-32768.0", "32767.00", "-32768", "32767", "1")]
    diffs = cpap_edf.declaration_matches("SA2", wrong, cpap_edf_dict.TYPES)
    assert len(diffs) == 1
    assert "SpO2.1s dig_max" in diffs[0] and "'200'" in diffs[0] and "'100'" in diffs[0]


def test_an_unknown_type_is_reported_not_silently_passed():
    diffs = cpap_edf.declaration_matches("NOPE", [], cpap_edf_dict.TYPES)
    assert diffs and "not in the dictionary" in diffs[0]


@pytest.mark.skipif(not os.path.isdir("/srv/tepna/captures/cpap/DATALOG"),
                    reason="no reference card on this box — the dictionary cannot be re-checked here")
def test_the_dictionary_still_matches_the_real_card():
    """The one test that can catch the table going stale. Skips honestly rather than faking a card."""
    import glob
    import struct  # noqa: F401
    checked = 0
    for kind in ("BRP", "PLD", "SA2"):
        hits = glob.glob(f"/srv/tepna/captures/cpap/DATALOG/*/*_{kind}.edf")
        for path in hits[:3]:
            with open(path, "rb") as f:
                raw = f.read()          # read_edf unpacks every record; a truncated buffer raises
            edf = cpap_edf.read_edf(raw)
            assert cpap_edf.declaration_matches(kind, _decl(edf), cpap_edf_dict.TYPES) == [], path
            checked += 1
    assert checked, "the card is present but yielded no files — the glob is wrong, not the card"



def test_a_wrong_signal_COUNT_is_reported_before_the_field_walk():
    """A file with the right labels but a missing channel must not slip through on a zip() that
    silently stops at the shorter sequence."""
    short = [("Pulse.1s", "bpm", "0.00", "300.00", "0", "300", "60"),
             ("SpO2.1s", "%", "0.00", "100.00", "0", "100", "60")]      # Crc16 absent
    diffs = cpap_edf.declaration_matches("SA2", short, cpap_edf_dict.TYPES)
    assert any("2 signals on disk, 3 in the dictionary" in d for d in diffs)
