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


# ── the SA2 axis: device-stamped like its BRP neighbour, or refused ──────────────────────────────────
class _Off:
    """Stands in for acq_evidence.ClockOffset — `measured` is `offset_sec is not None`, and
    `offset_sec` is POSITIVE when the DEVICE reads LATER than the reference."""

    def __init__(self, offset_sec):
        self.offset_sec = offset_sec

    @property
    def measured(self):
        return self.offset_sec is not None


def test_an_unmeasured_offset_REFUSES_rather_than_writing_an_unknown_axis():
    """`ClockOffset.unknown()` means nobody measured the difference. Writing anyway asserts an
    alignment that was never established, and the resulting EDF is well-formed and wrong by an
    unmeasured amount — the same fabrication `offset_for_envelope` refuses when it declines to render
    None as a zero."""
    with pytest.raises(ValueError, match="UNKNOWN"):
        cpap_edf.device_start_from_host((2026, 6, 13, 22, 0, 0), _Off(None))


def test_offset_ZERO_is_a_measured_result_and_must_NOT_refuse():
    """0.0 is a legitimate measurement — the clocks agreed. Treating it as absent is exactly the
    conflation `ClockOffset.measured` exists to prevent."""
    assert cpap_edf.device_start_from_host((2026, 6, 13, 22, 0, 0), _Off(0.0)) == (2026, 6, 13, 22, 0, 0)


def test_the_SIGN_is_pinned_not_just_the_magnitude():
    """🔴 A magnitude-only assertion passes under BOTH conventions, which is why this checks direction.

    `as11_clock` measures the AS11 ~21 min FAST, so `ClockOffset` carries ~ +1260 s and the instant
    the host calls 22:00:00 the device calls 22:21:00. Getting it backwards yields 21:39:00 — still a
    plausible clock story, and a 42-minute error against the BRP beside it."""
    got = cpap_edf.device_start_from_host((2026, 6, 13, 22, 0, 0), _Off(21 * 60))
    assert got == (2026, 6, 13, 22, 21, 0), "device reads LATER, so the device-axis start is LATER"
    assert got != (2026, 6, 13, 21, 39, 0), "sign inverted — this is the 42-minute failure"


def test_a_device_behind_the_host_moves_the_start_EARLIER():
    """The opposite sign must also hold, or the test above passes on a hard-coded addition."""
    assert cpap_edf.device_start_from_host((2026, 6, 13, 22, 0, 0), _Off(-90)) == (2026, 6, 13, 21, 58, 30)


def test_the_conversion_carries_across_a_day_boundary():
    """Civil-tuple arithmetic done by hand is where `t -= 86400` lives. This one goes through
    datetime, so the rollover is the library's problem rather than ours."""
    assert cpap_edf.device_start_from_host((2026, 6, 13, 23, 50, 0), _Off(20 * 60)) == (2026, 6, 14, 0, 10, 0)


def test_build_sa2_applies_NO_correction_of_its_own():
    """The builder stays a pure encoder: whatever start it is handed is what lands in the header. The
    axis decision belongs to the caller, once, at `device_start_from_host`."""
    edf = cpap_edf.build_sa2([(0, 95, 60)], (2026, 6, 13, 22, 21, 0), "S1", record_seconds=60)
    assert edf.starttime.strip() == "22.21.00"


def test_a_POPULATED_sa2_round_trips_through_our_own_reader():
    """The scaling arithmetic for REAL readings, which no other test reaches — every existing SA2 test
    exercises the sentinel path because every SA2 in the corpus is entirely sentinel.

    ⚠️ WHAT THIS DOES AND DOES NOT PROVE. It proves our encoder and decoder agree and that the declared
    ranges produce the physical values we intend. It does NOT prove the AS11 writes SpO2 as a plain
    integer percent — that is the standing `[INF]`, and it is unfalsifiable here: measured 2026-09-04
    across **267 SA2.edf**, every SpO2.1s and Pulse.1s channel decoded, **zero non-sentinel samples**.
    A round-trip against our own convention cannot settle the device's. Naming the limit in the test is
    the point; a green here must never be read as the encoding being confirmed."""
    samples = [(0, 97, 58), (1, 96, 59), (2, None, 60), (3, 95, None)]
    edf = cpap_edf.build_sa2(samples, (2026, 6, 13, 22, 21, 0), "S1", record_seconds=60)
    back = cpap_edf.read_edf(cpap_edf.write_edf(edf))

    got = {s.label.strip(): s.samples for s in back.signals if s.label.strip() in ("SpO2.1s", "Pulse.1s")}
    assert set(got) == {"SpO2.1s", "Pulse.1s"}, "both oximetry channels must survive the round trip"

    # 1:1 declared mapping: digital == physical percent / bpm, so a real reading is its own value.
    assert got["SpO2.1s"][:4] == [97, 96, cpap_edf.SA2_ABSENT, 95]
    assert got["Pulse.1s"][:4] == [58, 59, 60, cpap_edf.SA2_ABSENT]

    # and the two channels are independent — a missing SpO2 must not blank the pulse beside it
    assert got["Pulse.1s"][2] == 60, "sample 2 has no SpO2 but a real pulse"
    assert got["SpO2.1s"][3] == 95, "sample 3 has no pulse but a real SpO2"


# ── the two header CRCs the AS11 writes into the patient field ───────────────────────────────────────
def test_a_written_file_carries_BOTH_header_crcs_in_the_patient_field():
    """A real card writes `X X X X F69F D4BA`; this writer used to emit `X X X X`, so its output was
    well-formed and still distinguishable from a device file at byte 8 — an unstated exception to the
    module header's "byte-identical to what the device would have written".

    Measured over 1351 EDFs of all five types: crc1 = CCITT(hdr[0x19:256]) 1351/1351,
    crc2 = CCITT(signal block) 1351/1351, all-zeros control 0/1351."""
    edf = cpap_edf.build_sa2([(0, 97, 60)], (2026, 6, 13, 22, 21, 0), "S1", record_seconds=60)
    raw = cpap_edf.write_edf(edf)
    parts = raw[8:88].decode("latin1").split()
    assert parts[:4] == ["X", "X", "X", "X"], "the de-identified prefix must survive"
    assert len(parts) == 6, f"expected two CRC tokens after the prefix, got {parts}"

    ns = int(raw[252:256])
    hdr_bytes = 256 + ns * 256
    assert int(parts[4], 16) == cpap_edf.crc16_ccitt(raw[0x19:256]), "crc1 is over hdr[0x19:256]"
    assert int(parts[5], 16) == cpap_edf.crc16_ccitt(raw[256:hdr_bytes]), "crc2 is over the signal block"


def test_the_crc_range_starts_PAST_the_bytes_it_writes():
    """🔴 The property that makes this implementable at all. crc1 begins at byte 25 and the longest
    patient string ("X X X X F69F D4BA", 17 chars) ends at byte 24, so stamping the value cannot
    change the range that produced it. If the range ever moved down, the file would be self-
    invalidating and this test is what says so."""
    assert cpap_edf._CRC1_FROM == 0x19
    assert cpap_edf._CRC1_FROM >= 8 + len("X X X X FFFF FFFF"), \
        "the covered range must start past the longest patient string, or writing the CRC breaks it"


def test_stamping_is_IDEMPOTENT_so_a_re_encode_does_not_drift():
    """Writing the CRC changes bytes 8..24, which crc1 does not cover — so encoding twice must give
    the same bytes. A drift here would mean every re-encode produced a different file."""
    edf = cpap_edf.build_sa2([(0, 95, 58)], (2026, 1, 2, 3, 4, 5), "S2", record_seconds=60)
    once = cpap_edf.write_edf(edf)
    twice = cpap_edf.write_edf(cpap_edf.read_edf(once))
    assert once == twice, "re-encoding a written file must be a fixed point"


def test_a_header_only_buffer_is_left_alone_rather_than_crashing():
    """An empty recording has no signal block to hash. It must fail where it already failed, not here."""
    edf = cpap_edf.build_sa2([], (2026, 1, 1, 0, 0, 0), "S3", record_seconds=60)
    cpap_edf.write_edf(edf)          # must not raise


def test_an_edf_with_NO_signals_is_returned_unstamped_rather_than_crashing():
    """The guard's other arc. `hdr_bytes == _MAIN` for a zero-signal Edf, so there is no signal block
    to hash and `crc2` has no meaning — the buffer comes back untouched instead of hashing an empty
    span and writing a confident-looking CRC over nothing.

    Reachable rather than defensive: `Edf(..., signals=[])` is constructible, and the coverage gate
    found this arc unexercised. A guard nothing drives is a guard nobody knows works."""
    empty = cpap_edf.Edf("0", "X X X X", "rec", "13.06.26", "23.14.33", "EDF", 0, "1.00", [])
    raw = cpap_edf.write_edf(empty)
    assert raw[8:88].decode("latin1").rstrip() == "X X X X", \
        "a zero-signal file must keep the bare patient field — there is nothing to checksum"
    assert len(raw) == 256, "header only, no signal block"
