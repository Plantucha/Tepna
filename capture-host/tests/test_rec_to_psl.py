# tepna-capture — tests/test_rec_to_psl.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The `.REC` → PSL converter. Tests are built from SYNTHESISED containers rather than a captured file so
# they run without the corpus, and because the properties worth pinning are the ones that were learned
# the expensive way against real bytes:
#
#   * the frame BOUNDARY. A 281-byte record is 10 header + 269 payload + 2 trailing, and slicing to the
#     next frame's offset feeds those 2 bytes to the delta decoder, which reads them as a block header
#     that cannot complete and discards all 52 good samples. That failure produced a plausible-looking
#     0.55 s of output from a 283 s recording.
#   * the TIMEBASE. Stamps are UTC; the Clock Contract stores floating LOCAL. Writing UTC through must be
#     declared, not silent, because the wrong answer is a plausible one.
#   * timing comes from `sensor_ns`, never a frame index — cadence varies with stream bandwidth.

import datetime as _dt
import os
import struct

import pytest

import polar_pmd as pmd
import rec_to_psl as r2p
import writers

STAMP = "2026-08-03 12:01:20"
POLAR_EPOCH = _dt.datetime(2000, 1, 1)


def _ns(dt):
    return int((dt - POLAR_EPOCH).total_seconds() * 1e9)


def _header(stamp=STAMP, rate=55, res=22, ch=4):
    """17-byte header, ASCII stamp at 0x11, then a 2-byte field, then the settings TLVs at 0x26."""
    b = bytearray(b"\x00\x2b\x4c\x7c\x3d\x01" + b"\x00" * 7 + b"\x75\xba\x6d\xf9")
    assert len(b) == 0x11, len(b)
    b += stamp.encode("ascii")
    b += b"\x00\x0b"                                   # the 2-byte field at 0x24
    assert len(b) == 0x26, len(b)
    b += bytes([0x00, 0x01]) + struct.pack("<H", rate)
    b += bytes([0x01, 0x01]) + struct.pack("<H", res)
    b += bytes([0x04, 0x01, ch])
    return bytes(b)


def _acc_frame(ns, n=5, pad=2):
    """An UNCOMPRESSED ACC frame (frame_type 1) plus the trailing bytes a real record carries."""
    body = b"".join(struct.pack("<hhh", 10 + i, 20 + i, 1000 + i) for i in range(n))
    return bytes([pmd.ACC]) + struct.pack("<Q", ns) + b"\x01" + body + b"\xAB" * pad


def _build(stamp=STAMP, nframes=3, gap_ms=2400, n=5, pad=2):
    t0 = _dt.datetime.fromisoformat(stamp) + _dt.timedelta(seconds=2)
    out = bytearray(_header(stamp, rate=52, res=16, ch=3))
    for k in range(nframes):
        out += _acc_frame(_ns(t0 + _dt.timedelta(milliseconds=gap_ms * k)), n, pad)
    return bytes(out)


def _write(tmp_path, data, name="ACC.REC"):
    p = tmp_path / name
    p.write_bytes(data)
    return str(p)


# ── header ───────────────────────────────────────────────────────────────────────────────────────────

def test_the_header_declares_the_recording_settings():
    h = r2p.parse_header(_header())
    assert h["stamp_utc"] == STAMP
    assert h["fs"] == 55 and h["resolution_bits"] == 22 and h["channels"] == 4


def test_an_unreadable_stamp_is_none_rather_than_a_guess():
    bad = bytearray(_header())
    bad[0x11:0x11 + 4] = b"\xff\xfe\xfd\xfc"
    assert r2p.parse_header(bytes(bad))["stamp_utc"] is None


def test_tlv_parsing_stops_at_the_first_unknown_setting_id():
    """The block is not length-prefixed, so parsing must stop on something it does not recognise rather
    than walk into the sample data and report interleaved ids as values."""
    h = r2p.parse_header(_header() + bytes([0x7F, 0x01, 0x00, 0x00]))
    assert set(h["settings"]) <= {0x00, 0x01, 0x04}


# ── frames ───────────────────────────────────────────────────────────────────────────────────────────

def test_frames_are_found_and_are_all_one_stream(tmp_path):
    res = r2p.convert(_write(tmp_path, _build()))
    assert res["n_frames"] == 3
    assert res["meas"] == "acc"


def test_no_anchor_means_no_frames_rather_than_a_wild_search():
    """Without a header stamp there is no window to constrain the search, and an unconstrained scan over
    delta-compressed payload matches by chance."""
    assert r2p.find_frames(b"\x02" + b"\x00" * 200, None) == []


def test_frames_outside_the_recording_window_are_rejected(tmp_path):
    data = bytearray(_build(nframes=2))
    data += _acc_frame(_ns(_dt.datetime(2033, 5, 1)))          # a spurious far-future match
    res = r2p.convert(_write(tmp_path, bytes(data)))
    assert res["n_frames"] == 2, "a timestamp outside the 24 h window must not be accepted"


# ── the boundary, which is the whole point ──────────────────────────────────────────────────────────

def test_the_two_trailing_bytes_do_not_cost_the_frame(tmp_path):
    """With pad=2 the naive slice (to the next frame's offset) hands the decoder 2 extra bytes. Every
    sample must still be recovered — this is the bug that turned 283 s of PPG into 0.55 s."""
    res = r2p.convert(_write(tmp_path, _build(nframes=3, n=5, pad=2)))
    assert len(res["rows"]) == 15, f"expected 3x5 samples, got {len(res['rows'])}"
    assert not res["warnings"]


def test_a_record_with_no_padding_also_decodes(tmp_path):
    res = r2p.convert(_write(tmp_path, _build(nframes=2, n=4, pad=0)))
    assert len(res["rows"]) == 8


def test_an_undecodable_frame_is_reported_not_silently_dropped(tmp_path, monkeypatch):
    def boom(*a, **k):
        raise ValueError("frame_type 0x7f not decoded")
    monkeypatch.setattr(r2p.pmd, "decode_frame", boom)
    res = r2p.convert(_write(tmp_path, _build(nframes=2)))
    assert res["rows"] == []
    assert len(res["warnings"]) == 2 and "not decoded" in res["warnings"][0]


def test_a_frame_that_decodes_to_nothing_counts_as_a_gap(tmp_path, monkeypatch):
    monkeypatch.setattr(r2p.pmd, "decode_frame", lambda *a, **k: (pmd.ACC, []))
    res = r2p.convert(_write(tmp_path, _build(nframes=3)))
    assert res["rows"] == []
    assert any("treated as gaps" in w for w in res["warnings"])


def test_a_file_with_no_frames_says_so(tmp_path):
    res = r2p.convert(_write(tmp_path, _header()))
    assert res["rows"] == [] and "no PMD frames" in res["warnings"][0]


# ── timebase ────────────────────────────────────────────────────────────────────────────────────────

def test_the_offset_is_applied_to_every_row(tmp_path):
    """The device stamps UTC; the Clock Contract stores floating LOCAL. The shift happens once, at this
    boundary, or a night lands hours off and looks entirely plausible."""
    utc = r2p.convert(_write(tmp_path, _build()), tz_offset_min=0)
    loc = r2p.convert(_write(tmp_path, _build()), tz_offset_min=-240)
    assert (utc["rows"][0][0] - loc["rows"][0][0]).total_seconds() == 240 * 60
    assert utc["rows"][0][1] == loc["rows"][0][1], "sensor_ns is the device's own and must not shift"


def test_timing_comes_from_sensor_ns_not_from_a_frame_index(tmp_path):
    """Cadence varies with stream bandwidth (PPG ~944 ms, ACC ~2.4 s) because the device batches by
    BYTES. A consumer that assumed even spacing would mis-time every frame after the first."""
    res = r2p.convert(_write(tmp_path, _build(nframes=3, gap_ms=2400)))
    ns = [row[1] for row in res["rows"]]
    assert ns == sorted(ns)
    assert (ns[-1] - ns[0]) / 1e9 > 4.0, "frames must be placed by their own stamps"


# ── writing + CLI ───────────────────────────────────────────────────────────────────────────────────

def test_the_psl_header_matches_the_stream(tmp_path):
    src = _write(tmp_path, _build())
    res = r2p.convert(src)
    dest = str(tmp_path / "out.txt")
    n = r2p.write_psl(res, dest)
    lines = open(dest).read().splitlines()
    assert n == 15
    assert lines[0] == r2p.HEADERS[pmd.ACC]
    assert lines[1].count(";") == 4, "timestamp, sensor_ns, then 3 axes"


def test_a_stream_with_no_known_layout_is_REFUSED_not_written_under_a_guess(tmp_path):
    """Replaces `…_still_gets_a_usable_header`, which asserted the old `;v0;v1;v2` fallback and called it
    usable. It is not usable by anything: it only checked the header STARTS WITH "Phone timestamp;sensor
    timestamp", which the guess satisfies while naming no real column after it.

    ⚠️ THIS TEST USED `ppi` AS ITS EXAMPLE, and PPI is now supported — the refusal is what drove the
    layout being added, so its own case graduated. `ecg` is the remaining measurement the frame scan
    accepts (it walks all of `pmd.MEAS_NAME`) that HEADERS does not cover, so the path is still
    reachable for real input rather than only for a hand-built dict. If ECG is ever added here, this
    test must be re-pointed at whatever is left — asserting the refusal of a stream that no longer
    exists would be a gate that cannot fire.

    Refusing costs a re-run once the layout is added. The guess costs a mislabelled file nobody knows to
    distrust."""
    assert set(pmd.MEAS_NAME) - set(r2p.HEADERS) == {pmd.ECG}, \
        "the unsupported set moved — re-point this test at a stream that really has no layout"
    res = {"meas": "ecg", "rows": [(_dt.datetime(2026, 8, 3, 1, 2, 3), 1, (1, 2, 3))]}
    dest = str(tmp_path / "o.txt")
    with pytest.raises(ValueError, match="no PSL layout"):
        r2p.write_psl(res, dest)
    assert not os.path.exists(dest), "a refused conversion must leave no half-written file behind"


# ── PPI: the layout that has to match the LIVE writer, byte for byte ─────────────────────────────────
# PPI is the one stream whose row is not `…;{sensor_ns};{values}`, and getting it wrong is invisible:
# `parseDevicePPI` is POSITIONAL, so a file in PMD wire order (hr first) is read with the sensor clock
# as the interval, every beat falls outside the physiological window, every beat is filtered, and the
# device-PPI lane reports `nDevice: 0` — "the device produced nothing". That is DEEP-AUDIT-V F18, and
# the test that let it through asserted a HEADER STRING.
#
# So the gate here is not a string. `writers.write_ppi` is the LIVE path — the code that produced all
# 107 `*_PPI.txt` in the Polar Sensor Logger corpus — and the offline converter must be
# indistinguishable from it. Two independent writers, one validated against vendor bytes.

_BEAT = (50, 1190, 0, 0b110)                 # hr, pp_ms, err_ms, flags: contact + contactSupported
_WHEN = _dt.datetime(2026, 6, 10, 21, 15, 41, 114000)
# Transcribed from a real capture (Polar_H10_02849638_20260610_211534_PPI.txt, first data row). The
# corpus carries only `0;1;1` across all 38k rows, so the flag COLUMNS get adversarial cases below.
_REAL_ROW = "2026-06-10T21:15:41.114;1190;0;0;1;1;50"


def _live_row(tmp_path, when, beat, name="live.txt"):
    """The row the LIVE writer produces for this beat, read back off disk."""
    hr, pp_ms, err_ms, flags = beat
    w = writers.StreamWriter(str(tmp_path / name), "ppi", fsync=False)
    w.write_ppi(when, 0, hr, pp_ms, err_ms, flags)
    w.close()
    return open(tmp_path / name).read().splitlines()[1]


def test_the_offline_PPI_row_is_byte_identical_to_the_LIVE_writer(tmp_path):
    """The property that actually matters: a night recovered off the flash must be indistinguishable
    from the same night streamed. Anything else and the Dexes read two dialects of one format."""
    assert r2p._ppi_row(_WHEN, _BEAT) == _live_row(tmp_path, _WHEN, _BEAT)


def test_the_offline_PPI_row_matches_a_REAL_vendor_row(tmp_path):
    """…and both match a row Polar Sensor Logger itself wrote. This is the end of the chain: agreeing
    with our own live writer would be worth little if the live writer had drifted from the vendor."""
    assert r2p._ppi_row(_WHEN, _BEAT) == _REAL_ROW
    assert _live_row(tmp_path, _WHEN, _BEAT) == _REAL_ROW
    assert r2p.HEADERS[pmd.PPI] == writers.StreamWriter.HEADERS["ppi"], \
        "the offline header must be the live header, not a second copy that can drift"


def test_the_INTERVAL_leads_and_HR_TRAILS_which_is_the_opposite_of_the_wire(tmp_path):
    """F18 itself. PMD sends `(hr, pp, err, flags)`; PSL writes hr LAST. The values here are chosen so
    the two orders cannot be confused: 50 is not a plausible interval and 1190 is not a plausible HR,
    so a wire-order file fails on the numbers, not on a column count."""
    cols = r2p._ppi_row(_WHEN, _BEAT).split(";")
    assert len(cols) == 7
    assert cols[1] == "1190", "column 1 must be the PP interval in ms"
    assert cols[6] == "50", "hr must TRAIL — in wire order this column would hold the flags"
    assert 300 <= int(cols[1]) <= 2000, "…and it must land inside the physiological window"


@pytest.mark.parametrize("flags,expect", [
    (0b000, ("0", "0", "0")),      # nothing set
    (0b001, ("1", "0", "0")),      # blocker only — the firmware says this beat is not valid
    (0b010, ("0", "1", "0")),      # contact WITHOUT support declared
    (0b100, ("0", "0", "1")),      # support declared, not in contact — the desk case
    (0b110, ("0", "1", "1")),      # the only combination the real corpus contains
    (0b111, ("1", "1", "1")),
])
def test_the_flag_BYTE_explodes_into_three_columns_in_bit_order(tmp_path, flags, expect):
    """`blocker;contact;contact` — the vendor's own duplicate naming, which is why the ORDER cannot be
    read off the header and has to be pinned here. bit0 blocker, bit1 skinContact, bit2
    skinContactSupported. Every real row is `0;1;1`, so these are committed adversarial twins: without
    them a swapped bit1/bit2 reproduces the entire corpus."""
    beat = (50, 1190, 0, flags)
    assert tuple(r2p._ppi_row(_WHEN, beat).split(";")[3:6]) == expect
    assert r2p._ppi_row(_WHEN, beat) == _live_row(tmp_path, _WHEN, beat, f"f{flags}.txt")


def test_the_RETURNED_COUNT_is_what_actually_reached_the_FILE(tmp_path):
    """`write_psl` returns `len(res["rows"])` — a CLAIM about what it wrote, made without looking. Every
    other test here wrote a single PPI row, so turning the loop's `continue` into a `break` truncated
    the file to one beat while the return value still said twelve, and nothing noticed (mutate-diff,
    #1149). A count that is computed rather than observed is the §4b family: a report of success about
    something never examined. Assert against the bytes on disk, not against the input length."""
    rows, t = [], _WHEN
    for pp in (1190, 1150, 1210, 1175, 1160):
        rows.append((t, 0, (50, pp, 0, 0b110)))
        t += _dt.timedelta(milliseconds=pp)
    dest = str(tmp_path / "many.txt")
    n = r2p.write_psl({"meas": "ppi", "rows": rows}, dest)
    lines = open(dest).read().splitlines()
    assert n == len(rows) == len(lines) - 1, "the count returned is not the count written"
    assert [ln.split(";")[1] for ln in lines[1:]] == ["1190", "1150", "1210", "1175", "1160"], \
        "every beat must reach the file, in order — a truncation reads exactly like a short recording"


def test_PPI_carries_NO_device_clock_column(tmp_path):
    """Every `sensor_ns` the box has written for PPI is 0 — the frames have no usable device clock — so
    the column is absent rather than present-and-zero. A zero column would be read as a real timebase."""
    res = {"meas": "ppi", "rows": [(_WHEN, 8_400_000_000_000_000_000, _BEAT)]}
    dest = str(tmp_path / "ppi.txt")
    assert r2p.write_psl(res, dest) == 1
    head, row = open(dest).read().splitlines()
    assert "sensor timestamp" not in head
    assert "8400000000000000000" not in row, "the device clock leaked into the row"
    assert row == _REAL_ROW


def test_a_known_stream_still_converts(tmp_path):
    """The control — refusing the unknown must not break the four layouts that ARE verified."""
    res = {"meas": "acc", "rows": [(_dt.datetime(2026, 8, 3, 1, 2, 3), 1, (1, 2, 3))]}
    dest = str(tmp_path / "acc.txt")
    assert r2p.write_psl(res, dest) == 1
    assert open(dest).read().splitlines()[0] == r2p.HEADERS[pmd.ACC]


def test_main_writes_the_file_and_declares_the_timebase(tmp_path, capsys):
    src = _write(tmp_path, _build())
    out = str(tmp_path / "converted.txt")
    assert r2p.main([src, "-o", out, "--tz-offset-min", "-240"]) == 0
    printed = capsys.readouterr().out
    assert "local civil" in printed, "the timebase actually written must be stated"
    assert "delivered_fs" in printed
    assert open(out).read().count("\n") == 16


def test_main_declares_utc_when_no_offset_is_given(tmp_path, capsys):
    assert r2p.main([_write(tmp_path, _build()), "-o", str(tmp_path / "o.txt")]) == 0
    assert "UTC (device stamps, unshifted)" in capsys.readouterr().out


def test_main_writes_a_report_when_asked(tmp_path, capsys):
    rp = str(tmp_path / "r.json")
    r2p.main([_write(tmp_path, _build()), "-o", str(tmp_path / "o.txt"), "--json", rp])
    capsys.readouterr()
    import json
    assert json.load(open(rp))["n_samples"] == 15


def test_main_exits_nonzero_when_nothing_decoded(tmp_path, capsys):
    assert r2p.main([_write(tmp_path, _header()), "-o", str(tmp_path / "o.txt")]) == 1
    capsys.readouterr()


def test_a_tlv_truncated_mid_value_stops_rather_than_reading_past_the_end():
    """A count that promises more bytes than the header holds must not walk off the end."""
    h = r2p.parse_header(_header()[:0x26] + bytes([0x00, 0x04, 0x37]))   # says 4 values, supplies 1
    assert h["settings"].get(0x00) in ([], [0x37], None) or len(h["settings"][0x00]) < 4


def test_a_stamp_that_parses_as_text_but_not_as_a_date_yields_no_anchor(tmp_path):
    """`fromisoformat` is the only validator; 19 printable bytes that are not a date must degrade to
    "no frames" rather than raise."""
    bad = bytearray(_build())
    bad[0x11:0x11 + 19] = b"not-a-date---------"
    res = r2p.convert(_write(tmp_path, bytes(bad)))
    assert res["n_frames"] == 0 and "no PMD frames" in res["warnings"][0]


def test_convert_on_a_file_whose_stamp_is_unreadable_bytes(tmp_path):
    """Not the same path as an unparseable DATE: here `stamp_utc` is None, so the anchor block is
    skipped entirely rather than raising inside it."""
    bad = bytearray(_build())
    bad[0x11:0x11 + 6] = b"\xff\xfe\xfd\xfc\xfb\xfa"
    res = r2p.convert(_write(tmp_path, bytes(bad)))
    assert res["header"]["stamp_utc"] is None
    assert res["n_frames"] == 0


# ── _first_setting: the typed replacement for `(tlv.get(k) or [None])[0]` ──────────────────────
#
# The idiom it replaces read as "first value, else None" and could not be typed: `[None]` is a
# `list[None]`, not the `list[int]` a settings map holds. These pin the behaviour that had to be
# preserved exactly across that swap — including the present-but-EMPTY case, which is the one a
# careless rewrite gets wrong (`vals[0]` on `[]` raises; the old `or` treated `[]` as absent).


def test_first_setting_returns_the_first_value():
    assert r2p._first_setting([176, 2, 22]) == 176


def test_first_setting_returns_none_when_absent():
    # dict.get miss — the common path for a setting the recording never carried.
    assert r2p._first_setting(None) is None


def test_first_setting_treats_present_but_empty_as_absent():
    # The old `(tlv.get(k) or [None])[0]` relied on `[]` being falsy. Indexing directly would
    # raise IndexError here, so this is the case that proves the swap kept the contract.
    assert r2p._first_setting([]) is None


def test_first_setting_keeps_a_falsy_first_value():
    # `0` is a legitimate setting value and must NOT be confused with absence — the `or` in the
    # old idiom guarded the LIST, never its contents, and that distinction has to survive.
    assert r2p._first_setting([0, 9]) == 0
