# tepna-capture — writers tests (the SUITE-CRITICAL layer)
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
# Locks in the ~10% HR-bug fix: `timestamp [ms]` must be RELATIVE + FRACTIONAL (not integer/absolute),
# else the ECGDex fs inference reads 143 Hz instead of 130.
import datetime as _dt

import writers


def test_capture_filename_is_contiguous_stamp_not_psl_shape():
    # NOT PSL parity — PSL separates date and time (…_YYYYMMDD_HHMMSS_KIND); we write them
    # contiguous. The old name asserted parity that does not hold and encoded the same
    # misreading as writers.py's comment, so it passed while the bug shipped
    # (ENGINE-VERIFICATION-FINDINGS §1.2). dex-ingest.js now accepts BOTH shapes.
    t = _dt.datetime(2026, 7, 16, 21, 34, 51)
    assert writers.capture_filename("Polar", "H10", "02849638", t, "ecg", "txt") \
        == "Polar_H10_02849638_20260716213451_ECG.txt"
    # explicit: the stamp is 14 contiguous digits, NOT the PSL underscore-separated shape
    assert "_20260716_213451_" not in writers.capture_filename("Polar", "H10", "02849638", t, "ecg", "txt")


def test_ecg_ms_column_is_relative_and_fractional(tmp_path):
    p = tmp_path / "ecg.txt"
    w = writers.StreamWriter(str(p), "ecg")
    t = _dt.datetime(2026, 7, 16, 21, 34, 53, 930000)
    ns0 = 599636646177065964
    w.write_ecg(t, ns0, 0.0, 4)
    w.write_ecg(t, ns0 + 7_692_308, 0.0, 2)      # +7.692308 ms at 130 Hz
    w.close()
    rows = p.read_text().splitlines()
    assert rows[0] == "Phone timestamp;sensor timestamp [ns];timestamp [ms];ecg [uV]"
    # ms column: first row exactly "0.0", second row fractional relative ms (NOT rounded to 7 or 8)
    assert rows[1].split(";")[2] == "0.0"
    assert rows[2].split(";")[2] == "7.692308"
    # phone timestamp: LOCAL-CIVIL, zone-free, ms precision (Clock Contract §1)
    assert rows[1].split(";")[0] == "2026-07-16T21:34:53.930"
    # raw sensor_ns carried verbatim as the secondary column
    assert rows[1].split(";")[1] == str(ns0)


def test_ppg_writes_four_channels(tmp_path):
    p = tmp_path / "ppg.txt"
    w = writers.StreamWriter(str(p), "ppg")
    w.write_ppg(_dt.datetime(2026, 7, 16), 100, 0.0, (10, 20, 30), 40)
    w.close()
    rows = p.read_text().splitlines()
    # Real PSL Verity header (corpus: Polar_Sense_*_PPG.txt) — "channel N", and NO timestamp [ms]
    # column, so the channels start at index 2. We used to emit "ppg0;ppg1;ppg2" AND an extra ms column,
    # which shifted every channel by one and made PPGDex/MotionDex silently read the wrong fields.
    assert rows[0] == "Phone timestamp;sensor timestamp [ns];channel 0;channel 1;channel 2;ambient"
    assert rows[1].split(";")[2:] == ["10", "20", "30", "40"]


def test_spo2_csv_is_vihealth_layout(tmp_path):
    p = tmp_path / "spo2.csv"
    w = writers.Spo2CsvWriter(str(p))
    w.write(_dt.datetime(2026, 7, 16, 21, 34, 53), 97, 62, 5)
    w.close()
    rows = p.read_text().splitlines()
    assert rows[0] == "Time,Oxygen Level,Pulse Rate,Motion"
    # HH:MM:SS DD/MM/YYYY local-civil (the exact shape OxyDex's oxydex-spo2 adapter parses)
    assert rows[1] == "21:34:53 16/07/2026,97,62,5"


def test_streamwriter_periodic_flush_lands_rows_before_close(tmp_path):
    # A hard kill / power loss mid-night must not lose the buffered tail: the writer flushes on a
    # wall-clock cadence, so rows are readable from a SEPARATE handle before close() ever runs.
    p = tmp_path / "ecg.txt"
    w = writers.StreamWriter(str(p), "ecg", flush_interval=0.0)   # 0.0 => flush on every row
    ns0 = 599636646177065964
    for i in range(50):
        w.write_ecg(_dt.datetime(2026, 7, 16, 21, 34, 53), ns0 + i * 7_692_308, 0.0, i)
    on_disk = p.read_text().splitlines()          # NOT closed yet
    assert len(on_disk) == 51                      # header + 50 rows already on disk
    assert on_disk[1].split(";")[2] == "0.0"       # rel-ms invariant survives the flush path
    w.close()


def test_spo2writer_periodic_flush_lands_rows_before_close(tmp_path):
    p = tmp_path / "spo2.csv"
    w = writers.Spo2CsvWriter(str(p), flush_interval=0.0)
    for i in range(4):
        w.write(_dt.datetime(2026, 7, 16, 21, 34, 53 + i), 97, 60 + i, 3)
    on_disk = p.read_text().splitlines()          # NOT closed yet
    assert len(on_disk) == 5                        # header + 4 rows already on disk
    w.close()


# ── writers coverage wave 2 (FOLLOWUPS §2) — night_dir + every per-stream row/header ────────────────
# Only ecg/ppg/spo2 were row-tested; acc/gyro/mag/ppi/hr headers + row formats, the PPI flag-bit split,
# HR's one-row-per-RR behaviour, and night_dir were unpinned (49% mutation score). These assert exact
# bytes so a header typo, a wrong separator/column, a flipped flag bit, or a broken RR loop reds.
import os as _os

_PHONE = _dt.datetime(2026, 7, 16, 21, 34, 53, 930000)
_PTS = "2026-07-16T21:34:53.930"


def _write_read(tmp_path, stream, fn):
    p = str(tmp_path / (stream + ".txt"))
    w = writers.StreamWriter(p, stream, fsync=False)
    fn(w)
    w.close()
    return open(p).read().splitlines(), w


def test_night_dir_is_captures_slash_local_date(tmp_path):
    d = writers.night_dir(str(tmp_path), _dt.datetime(2026, 7, 16, 21, 34, 53))
    assert d == _os.path.join(str(tmp_path), "captures", "2026-07-16")   # per-night folder by LOCAL date
    assert _os.path.isdir(d)                                             # created lazily


def test_write_acc_header_and_row(tmp_path):
    rows, _ = _write_read(tmp_path, "acc", lambda w: w.write_acc(_PHONE, 1000, 0.0, 10, -20, 30))
    # Real PSL ACC header (corpus: Polar_H10_*_ACC.txt) — NO timestamp [ms] column. That column is
    # ECG-ONLY in Polar Sensor Logger; emitting it here shifted X/Y/Z by one for every consumer.
    assert rows[0] == "Phone timestamp;sensor timestamp [ns];X [mg];Y [mg];Z [mg]"
    assert rows[1] == f"{_PTS};1000;10;-20;30"


def test_write_gyro_and_mag_headers_carry_correct_units(tmp_path):
    gr, _ = _write_read(tmp_path, "gyro", lambda w: w.write_gyro(_PHONE, 5, 0.0, 1, 2, 3))
    mr, _ = _write_read(tmp_path, "mag", lambda w: w.write_mag(_PHONE, 5, 0.0, 4, 5, 6))
    # Real PSL GYRO/MAGN headers (corpus: Polar_Sense_*_GYRO.txt / *_MAGN.txt) — no ms column either.
    assert gr[0] == "Phone timestamp;sensor timestamp [ns];X [dps];Y [dps];Z [dps]"
    assert gr[1] == f"{_PTS};5;1;2;3"
    assert mr[0] == "Phone timestamp;sensor timestamp [ns];X [G];Y [G];Z [G]"
    assert mr[1] == f"{_PTS};5;4;5;6"


def test_write_ppi_header_and_flag_bit_decomposition(tmp_path):
    # flags 0b101 → blocker=1, skinContact=0, skinContactSupported=1 (bits 0,1,2)
    rows, _ = _write_read(tmp_path, "ppi", lambda w: w.write_ppi(_PHONE, 5000, 60, 1000, 5, 0b101))
    assert rows[0].endswith("PP-interval [ms];error estimate [ms];blocker;skin contact;skin contact supported")
    assert rows[1] == f"{_PTS};5000;60;1000;5;1;0;1"


def test_write_hr_one_row_per_rr_and_blank_when_empty(tmp_path):
    def fn(w):
        w.write_hr(_PHONE, 7000, 55, [800, 810])   # 2 RR → 2 rows, HR repeated
        w.write_hr(_PHONE, 7000, 56, [])           # no RR → single blank-RR row
    rows, w = _write_read(tmp_path, "hr", fn)
    assert rows[0] == "Phone timestamp;sensor timestamp [ns];HR [bpm];RR-interval [ms]"
    assert rows[1:] == [f"{_PTS};7000;55;800", f"{_PTS};7000;55;810", f"{_PTS};7000;56;"]
    assert w.rows == 3                              # 2 RR rows + 1 blank-RR row


def test_ms_column_is_ecg_only_matching_real_polar_sensor_logger(tmp_path):
    """Ground truth from the real PSL corpus: `timestamp [ms]` appears on ECG and NOWHERE else.
    Emitting it on acc/ppg/gyro/mag put every downstream field one column out, which is why MotionDex
    read the ms value as X and PPGDex read it as channel 0 — silently, with no parse error."""
    ecg, _ = _write_read(tmp_path, "ecg", lambda w: w.write_ecg(_PHONE, 1000, 0.0, 42))
    assert "timestamp [ms]" in ecg[0], "ECG must KEEP the ms column — real PSL has it"
    for kind, call in (("acc", lambda w: w.write_acc(_PHONE, 1, 0.0, 1, 2, 3)),
                       ("gyro", lambda w: w.write_gyro(_PHONE, 1, 0.0, 1, 2, 3)),
                       ("mag", lambda w: w.write_mag(_PHONE, 1, 0.0, 1, 2, 3)),
                       ("ppg", lambda w: w.write_ppg(_PHONE, 1, 0.0, (1, 2, 3), 4))):
        rows, _ = _write_read(tmp_path, kind, call)
        assert "timestamp [ms]" not in rows[0], f"{kind} must NOT carry the ms column (ECG-only in PSL)"
        assert len(rows[0].split(";")) == len(rows[1].split(";")), f"{kind} header/row column count mismatch"


def test_missing_identity_names_exactly_the_blank_fields():
    """The gate both the capture daemon and the Remember API run on. A device that passes this is one
    `capture_filename` can name; one that fails would land as `__<id>_..._ECG.txt`, unroutable."""
    good = {"name": "H10", "vendor": "Polar", "model": "H10", "device_id": "12345678"}
    assert writers.missing_identity(good) == []
    assert writers.missing_identity({**good, "vendor": ""}) == ["vendor"]
    assert writers.missing_identity({**good, "vendor": "", "model": None}) == ["vendor", "model"]
    assert writers.missing_identity({}) == ["name", "vendor", "model", "device_id"]
    # whitespace is not an identity — it would produce ` _ _id_...` filenames
    assert writers.missing_identity({**good, "model": "   "}) == ["model"]
    # the unrecognised-sensor shape guessDevice() actually emits (blank vendor+model, id from the MAC)
    assert writers.missing_identity({"name": "AC028496", "vendor": "", "model": "",
                             "device_id": "AC028496"}) == ["vendor", "model"]


def test_identity_fields_are_the_ones_the_filename_interpolates():
    """Guards the pair from drifting: every field capture_filename() puts in the name must be gated."""
    for f in ("vendor", "model", "device_id"):
        assert f in writers.IDENTITY_FIELDS


def test_the_remember_api_gates_on_identity_before_it_persists():
    """SOURCE SCAN, because webmon.py needs aiohttp and the test env has none — a skipped test here
    would be no gate at all, and this leg is exactly the one that was missing (the daemon checked,
    the API did not). Asserts the ordering that matters: reject BEFORE the config write."""
    import os
    src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "webmon.py")).read()
    body = src[src.index("async def remember("):]
    body = body[:body.index("\n    async def ")]
    assert "missing_identity(" in body, "Remember API no longer validates device identity"
    assert body.index("missing_identity(") < body.index("_save()"), \
        "identity is checked AFTER the config write — the bad entry is already persisted"
    assert "status=400" in body, "a rejected device must fail loudly, not return a success shape"
