# tepna-capture — tests/test_cpap_edf.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""cpap_edf — the bit-accurate ResMed EDF/EDF+ writer + reader.

Two layers of proof:

* SELF-CONTAINED (runs in CI): the constructors build BRP/PLD/EVE files from synthetic data, and every
  one round-trips write→read→write BYTE-IDENTICALLY — which exercises the header layout, the int16
  scaling, the EDF+ TAL annotation encoding, and the recomputed CRC-16/CCITT-FALSE checksum. The CRC
  itself is pinned to its published test vector.

* CORPUS-GATED (skipped where uploads/ is absent — real recordings are gitignored, Tepna is public): the
  gold standard — decode a GENUINE AirSense 11 file and re-encode it; the bytes must match exactly. That
  is what proves the writer reproduces what the device wrote, checksum and all.
"""
import glob
import os
import struct

import cpap_edf as E
import pytest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOADS = os.path.join(os.path.dirname(HERE), "uploads")


# ── the checksum ────────────────────────────────────────────────────────────────
def test_crc16_matches_the_published_ccitt_false_vector():
    # CRC-16/CCITT-FALSE("123456789") == 0x29B1 (the canonical check value)
    assert E.crc16_ccitt(b"123456789") == 0x29B1


def test_crc16_of_empty_is_the_init_value():
    assert E.crc16_ccitt(b"") == 0xFFFF


# ── digital scaling ───────────────────────────────────────────────────────────────
def test_digital_scales_and_clamps():
    # Flow.40ms: phys[-2,3] dig[-1000,1500]; scale 0.002 L/s per digit, digital 0 ⇒ 0 L/s
    assert E._digital(0.0, -2.0, 3.0, -1000, 1500) == 0
    assert E._digital(3.0, -2.0, 3.0, -1000, 1500) == 1500
    assert E._digital(-2.0, -2.0, 3.0, -1000, 1500) == -1000
    assert E._digital(99.0, -2.0, 3.0, -1000, 1500) == 1500, "over-range clamps to digMax"
    assert E._digital(-99.0, -2.0, 3.0, -1000, 1500) == -1000, "under-range clamps to digMin"


# ── BRP constructor ─────────────────────────────────────────────────────────────
def _read_back(edf):
    return E.read_edf(E.write_edf(edf))


def test_build_brp_shape_and_scaling():
    flow = [0.0, 1.0, -1.0] + [0.0] * 22        # 25 samples = one 1 s record
    press = [10.0] * 25
    edf = E.build_brp(flow, press, (2026, 6, 13, 23, 14, 33), "23221590541", record_seconds=1)
    back = _read_back(edf)
    assert [s.label.strip() for s in back.signals] == ["Flow.40ms", "Press.40ms", "Crc16"]
    assert back.reserved.strip() == "EDF" and back.n_records == 1 and back.record_duration.strip() == "1.00"
    assert back.startdate == "13.06.26" and back.starttime == "23.14.33"
    assert back.recording_id.strip() == "Startdate 13-JUN-2026 X X X SRN=23221590541 MID=46 VID=3"
    flow_sig = back.signals[0]
    assert flow_sig.dim.strip() == "L/s" and flow_sig.spr == 25
    assert flow_sig.samples[0] == 0 and flow_sig.samples[1] == 500 and flow_sig.samples[2] == -500


def test_build_brp_zero_pads_partial_records():
    edf = E.build_brp([0.5] * 30, [12.0] * 30, (2026, 1, 1, 0, 0, 0), "S1", record_seconds=1)
    assert edf.n_records == 2, "30 samples over 25/record ⇒ 2 records, the 2nd zero-padded"
    assert len(edf.signals[0].samples) == 50


def test_build_brp_rejects_mismatched_lengths():
    with pytest.raises(ValueError, match="same sample count"):
        E.build_brp([0.0] * 25, [0.0] * 50, (2026, 1, 1, 0, 0, 0), "S1", record_seconds=1)


# ── PLD constructor ─────────────────────────────────────────────────────────────
def test_build_pld_fills_missing_channels_with_zero():
    edf = E.build_pld({"Leak.2s": [0.5, 1.0]}, (2026, 6, 13, 0, 0, 0), "S1", record_seconds=2)
    back = _read_back(edf)
    labels = [s.label.strip() for s in back.signals]
    assert labels[0] == "MaskPress.2s" and labels[-1] == "Crc16" and len(labels) == 10
    assert back.n_records == 2, "2 samples at 1/record (2 s record) ⇒ 2 records"
    leak = next(s for s in back.signals if s.label.startswith("Leak"))
    # Leak.2s phys[0,2] dig[0,100] ⇒ 0.5 L/s → 25, 1.0 → 50
    assert leak.samples[0] == 25
    mask = next(s for s in back.signals if s.label.startswith("MaskPress"))
    assert set(mask.samples) == {0}, "an unsupplied channel is zero-filled, not omitted"


def test_build_pld_empty_is_a_zero_record_file():
    edf = E.build_pld({}, (2026, 1, 1, 0, 0, 0), "S1")
    assert edf.n_records == 0 and _read_back(edf).n_records == 0


# ── EVE constructor (EDF+ TAL annotations) ───────────────────────────────────────
def _tal_bytes(edf, r, ann_spr=31):
    ann = next(s for s in edf.signals if "Annotation" in s.label)
    return struct.pack(f"<{ann_spr}h", *ann.samples[r * ann_spr:(r + 1) * ann_spr]).rstrip(b"\x00")


def test_build_eve_tal_format_matches_the_device():
    edf = E.build_eve([(186, 12, "Central Apnea"), (282, 41, "Obstructive Apnea")],
                      (2026, 6, 13, 23, 14, 33), "23221590541")
    assert edf.reserved == "EDF+D" and edf.record_duration == "0.00"
    # a 'Recording starts' TAL is prepended, then one event per record
    assert edf.n_records == 3
    assert _tal_bytes(edf, 0) == b"+0\x14\x14\x00+0\x150\x14Recording starts\x14"
    assert _tal_bytes(edf, 1) == b"+0\x14\x14\x00+186\x1512\x14Central Apnea\x14"
    assert _tal_bytes(edf, 2) == b"+0\x14\x14\x00+282\x1541\x14Obstructive Apnea\x14"
    # and it round-trips byte-identically through the encoder
    assert E.write_edf(E.read_edf(E.write_edf(edf))) == E.write_edf(edf)


def test_build_eve_keeps_an_existing_recording_starts_marker():
    edf = E.build_eve([(0, 0, "Recording starts"), (5, 3, "Hypopnea")], (2026, 1, 1, 0, 0, 0), "S1")
    assert edf.n_records == 2, "an existing Recording-starts marker is not duplicated"


def test_build_eve_omits_duration_when_none():
    edf = E.build_eve([(90, None, "Arousal")], (2026, 1, 1, 0, 0, 0), "S1")
    assert _tal_bytes(edf, 1) == b"+0\x14\x14\x00+90\x14Arousal\x14", "no 0x15/duration field when None"


def test_build_eve_rejects_an_annotation_that_overflows_the_record():
    with pytest.raises(ValueError, match="exceeds"):
        E.build_eve([(0, 0, "X" * 100)], (2026, 1, 1, 0, 0, 0), "S1")


# ── reader guards ───────────────────────────────────────────────────────────────
def test_read_edf_rejects_a_truncated_header():
    with pytest.raises(ValueError, match="too short"):
        E.read_edf(b"\x00" * 100)


def test_read_edf_rejects_an_inconsistent_header_byte_count():
    edf = E.build_brp([0.0] * 25, [0.0] * 25, (2026, 1, 1, 0, 0, 0), "S1", record_seconds=1)
    raw = bytearray(E.write_edf(edf))
    raw[184:192] = b"999     "     # corrupt the header-bytes field
    with pytest.raises(ValueError, match="header-bytes"):
        E.read_edf(bytes(raw))


def test_write_edf_without_a_crc_lane_emits_plain_records():
    """Not every EDF has a Crc16 lane; a signal-only file must still encode and round-trip."""
    sig = E.Signal("X", " " * 80, "u", "0", "10", "0", "100", " " * 80, 2, " " * 32, [1, 2, 3, 4])
    edf = E.Edf("0", "p", "r", "01.01.26", "00.00.00", "EDF", 2, "1.00", [sig])
    back = E.read_edf(E.write_edf(edf))
    assert len(back.signals) == 1 and back.signals[0].samples == [1, 2, 3, 4]


# ── the gold standard: byte-identity against genuine AirSense 11 files ────────────
def _corpus_edfs():
    return sorted(glob.glob(os.path.join(UPLOADS, "*.edf")))


@pytest.mark.skipif(not _corpus_edfs(), reason="uploads/ corpus absent (gitignored; run locally)")
@pytest.mark.parametrize("path", _corpus_edfs()[:8])
def test_reencoding_a_real_file_is_byte_identical(path):
    """THE bit-accuracy proof: decode a real ResMed file and re-encode it — including recomputing the
    per-record CRC-16/CCITT-FALSE — and the bytes must match exactly OUTSIDE the patient field.

    ⚠️ THE COMMITTED FIXTURES ARE DE-IDENTIFIED AND THAT IS WHY THIS TEST COULD NOT SEE THE HEADER
    CRCs. A card file's patient field reads `X X X X E9F8 2B58`; every fixture in `uploads/` reads
    `X X X X`, the CRC tokens stripped before commit. So this test asserted byte-identity against
    inputs whose patient field had already been blanked — it passed for as long as the writer ALSO
    emitted nothing there, and it could not have caught the omission. That is the gap, not a
    weakening of the proof.

    The writer now restores those CRCs, so re-encoding a de-identified fixture legitimately differs
    from it — MEASURED, on all 9: exactly 8 bytes, span 16..24, inside the patient field, every time.
    Byte-identity including the patient field is verified against genuine card files instead:
    1351/1351 over `DATALOG/*/*.edf` of all five types, with an all-zeros control matching 0/1351.

    The exclusion is bounded to `[8, 88)` on purpose. A drift anywhere else still fails here."""
    raw = open(path, "rb").read()
    out = E.write_edf(E.read_edf(raw))
    assert len(out) == len(raw), f"length diverged from the device file: {path}"
    diff = [i for i in range(len(raw)) if raw[i] != out[i]]
    assert all(8 <= i < 88 for i in diff), (
        f"re-encode diverged OUTSIDE the patient field at {[i for i in diff if not 8 <= i < 88][:8]}: "
        f"{path} — the de-identification exemption covers bytes 8..87 and nothing else")


# ── exact-field assertions (self-contained; the corpus byte-identity test skips inside the mutation
#    scratch, so every header field a constructor writes is pinned here directly) ────────────────────────
def test_constructed_brp_every_header_field_is_exact():
    edf = E.build_brp([0.0] * 25, [10.0] * 25, (2026, 6, 13, 23, 14, 33), "23221590541", record_seconds=1)
    b = E.read_edf(E.write_edf(edf))
    assert b.version.strip() == "0"
    # The device writes TWO header CRCs here — `X X X X <crc1> <crc2>` — so pinning the bare
    # prefix is what let the omission ship. Prefix AND shape, with the values checked against
    # the scheme in test_cpap_edf_sa2.py rather than hard-coded, since they move with the header.
    _pat = b.patient_id.split()
    assert _pat[:4] == ["X", "X", "X", "X"], f"de-identified prefix lost: {b.patient_id!r}"
    assert len(_pat) == 6, f"expected two header CRC tokens, got {b.patient_id!r}"
    assert all(len(t) == 4 and all(c in "0123456789ABCDEF" for c in t) for t in _pat[4:]), \
        f"CRC tokens must be 4 upper-case hex digits: {_pat[4:]}"
    assert b.recording_id.strip() == "Startdate 13-JUN-2026 X X X SRN=23221590541 MID=46 VID=3"
    assert b.startdate == "13.06.26" and b.starttime == "23.14.33"
    assert b.reserved.strip() == "EDF" and b.record_duration.strip() == "1.00" and b.n_records == 1
    flow, press, crc = b.signals
    for s in (flow, press, crc):
        assert s.transducer == " " * 80, "transducer field must be blank, not None-stringified"
        assert s.prefilter == " " * 80, "prefilter field must be blank"
        assert s.reserved == " " * 32, "signal-reserved field must be blank"
    assert (flow.label.strip(), flow.dim.strip(), flow.pmin.strip(), flow.pmax.strip(),
            flow.dmin.strip(), flow.dmax.strip()) == ("Flow.40ms", "L/s", "-2.00", "3.00", "-1000", "1500")
    assert (press.label.strip(), press.dim.strip(), press.pmin.strip(), press.pmax.strip(),
            press.dmin.strip(), press.dmax.strip()) == ("Press.40ms", "cmH2O", "0.00", "40.00", "0", "2000")
    # Crc16 carries the ASYMMETRIC physical strings verbatim ('-32768.0' one decimal, '32767.00' two)
    assert (crc.label.strip(), crc.pmin, crc.pmax, crc.dmin.strip(), crc.dmax.strip(), crc.spr) == \
           ("Crc16", "-32768.0", "32767.00", "-32768", "32767", 1)


def test_constructed_brp_uses_the_documented_default_record_length():
    edf = E.build_brp([0.0] * 1500, [0.0] * 1500, (2026, 1, 1, 0, 0, 0), "S1")  # default record_seconds
    assert edf.record_duration == "60.00" and edf.signals[0].spr == 1500, "default is a 60 s / 25 Hz record"


def test_constructed_pld_specs_are_exact():
    b = E.read_edf(E.write_edf(E.build_pld({"Leak.2s": [0.0]}, (2026, 1, 1, 0, 0, 0), "S1", record_seconds=2)))
    got = [(s.label.strip(), s.dim.strip(), s.pmin.strip(), s.pmax.strip(), s.dmin.strip(), s.dmax.strip())
           for s in b.signals]
    assert got == [
        ("MaskPress.2s", "cmH2O", "0.00", "40.00", "0", "2000"),
        ("Press.2s", "cmH2O", "0.00", "50.00", "0", "2500"),
        ("EprPress.2s", "cmH2O", "0.00", "30.00", "0", "1500"),
        ("Leak.2s", "L/s", "0.00", "2.00", "0", "100"),
        ("RespRate.2s", "bpm", "0.00", "90.00", "0", "450"),
        ("TidVol.2s", "L", "0.00", "4.00", "0", "200"),
        ("MinVent.2s", "L/min", "0.00", "30.00", "0", "240"),
        ("Snore.2s", "", "0.00", "5.00", "0", "250"),
        ("FlowLim.2s", "", "0.00", "1.00", "0", "100"),
        ("Crc16", "", "-32768.0", "32767.00", "-32768", "32767"),
    ]


def test_recording_id_carries_the_exact_mid_and_vid():
    edf = E.build_eve([(1, 1, "Hypopnea")], (2026, 1, 1, 0, 0, 0), "SER99")
    assert "SRN=SER99 MID=46 VID=3" in edf.recording_id, "default MID/VID must be 46/3, not off by one"


def test_partial_records_are_padded_with_ZERO_flow_not_one():
    # one sample then 24 padding samples; Flow digital 0 == 0 L/s, and the pad must be 0, not 1.0 L/s
    edf = E.build_brp([0.0] + [0.0] * 0, [0.0], (2026, 1, 1, 0, 0, 0), "S1", record_seconds=1)
    assert set(edf.signals[0].samples[1:]) == {0}, "padding is zero-flow, never a fabricated 1.0"


def test_read_edf_accepts_a_minimal_zero_signal_header():
    # exactly 256 bytes, ns=0 ⇒ a valid header with no signals. Pins `< 256` (not `<= 256`).
    hdr = (b"0       " + b" " * 80 + b" " * 80 + b"01.01.26" + b"00.00.00" + b"256     "
           + b" " * 44 + b"0       " + b"1.00    " + b"0   ")
    assert len(hdr) == 256
    edf = E.read_edf(hdr)
    assert edf.signals == [] and edf.n_records == 0


def test_constructed_eve_signal_headers_are_exact():
    """The EVE annotation + Crc16 signal headers must carry the device's exact fields — not just the
    right TAL bytes. Pins every field the Signal constructor sets."""
    b = E.read_edf(E.write_edf(E.build_eve([(1, 1, "Hypopnea")], (2026, 1, 1, 0, 0, 0), "S1")))
    ann, crc = b.signals
    assert ann.label.strip() == "EDF Annotations" and ann.dim.strip() == "" and ann.spr == 31
    assert ann.pmin == "-32768.0" and ann.pmax == "32767.00"
    assert ann.dmin.strip() == "-32768" and ann.dmax.strip() == "32767"
    assert ann.transducer == " " * 80 and ann.prefilter == " " * 80 and ann.reserved == " " * 32
    assert crc.label.strip() == "Crc16"


def test_tal_annotation_that_exactly_fills_the_record_is_accepted():
    # byte_width = 31*2 = 62; a TAL of exactly 62 bytes must be ALLOWED (pins `>` not `>=`).
    # layout: '+0\x14\x14\x00' (5) + '+0\x150\x14<label>\x14\x00' (7 + len) = 12 + len ⇒ len 50 fills it.
    edf = E.build_eve([(0, 0, "L" * 50)], (2026, 1, 1, 0, 0, 0), "S1")
    assert edf.n_records == 2, "a 62-byte annotation fills the record exactly and is not rejected"


# ── remaining exactness: PLD header, padding, the crc lane value, and the reserved-field offset ─────────
def test_constructed_pld_header_is_exact():
    edf = E.build_pld({"Leak.2s": [0.0]}, (2026, 6, 13, 0, 0, 0), "SER7")   # default record_seconds
    assert edf.record_duration == "60.00", "default PLD record is 60 s"
    assert "SRN=SER7 MID=46 VID=3" in edf.recording_id


def test_pld_pads_each_channel_to_the_exact_record_length():
    # 3 supplied samples at 30/record ⇒ 1 record ⇒ every channel padded to exactly 30, never 30+len
    edf = E.build_pld({"Leak.2s": [0.1, 0.2, 0.3]}, (2026, 1, 1, 0, 0, 0), "S1")
    assert edf.n_records == 1
    for s in edf.signals:
        assert len(s.samples) == edf.n_records * s.spr, f"{s.label.strip()} padded to the wrong length"


def test_the_crc_lane_holds_the_computed_checksum_not_a_placeholder():
    """write_edf must RECOMPUTE the Crc16 lane from each record's data bytes — not emit the [0]
    placeholder. Pins that the crc signal is found and filled (a crc_idx=None mutation drops to zeros)."""
    import struct as _s
    flow = [0.3, -0.4, 0.5] + [0.1] * 22
    press = [12.0, 13.0, 14.0] + [10.0] * 22
    edf = E.build_brp(flow, press, (2026, 1, 1, 0, 0, 0), "S1", record_seconds=1)
    raw = E.write_edf(edf)
    back = E.read_edf(raw)
    flow_s, press_s, crc_s = back.signals
    # recompute the expected checksum over record 0's data bytes (flow ‖ pressure, int16 LE)
    rec = _s.pack("<25h", *flow_s.samples[:25]) + _s.pack("<25h", *press_s.samples[:25])
    expected = E.crc16_ccitt(rec)
    assert (crc_s.samples[0] & 0xFFFF) == expected, "the Crc16 lane must carry the real checksum"
    assert crc_s.samples[0] != 0, "a zeroed crc lane means the checksum was never computed"


def test_signal_reserved_field_is_read_from_the_correct_offset():
    """A distinct per-signal reserved value must survive a round-trip — pins the reserveds column offset
    in read_edf (a wrong `o + ns*40 + ns*80` lands on the blank prefilter and reads spaces undetected)."""
    sig = E.Signal("S", " " * 80, "u", "0", "10", "0", "100", " " * 80, 1, "RESV-MARKER".ljust(32), [7])
    edf = E.Edf("0", "p", "r", "01.01.26", "00.00.00", "EDF", 1, "1.00", [sig])
    back = E.read_edf(E.write_edf(edf))
    assert back.signals[0].reserved.strip() == "RESV-MARKER", "reserved read from the wrong column"
