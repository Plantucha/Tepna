# tepna-capture — writers tests (the SUITE-CRITICAL layer)
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
# Locks in the ~10% HR-bug fix: `timestamp [ms]` must be RELATIVE + FRACTIONAL (not integer/absolute),
# else the ECGDex fs inference reads 143 Hz instead of 130.
import datetime as _dt

import writers


def test_capture_filename_matches_polar_sensor_logger():
    t = _dt.datetime(2026, 7, 16, 21, 34, 51)
    assert writers.capture_filename("Polar", "H10", "02849638", t, "ecg", "txt") \
        == "Polar_H10_02849638_20260716213451_ECG.txt"


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
    assert rows[0].endswith("ppg0;ppg1;ppg2;ambient")
    assert rows[1].split(";")[3:] == ["10", "20", "30", "40"]


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
    assert rows[0] == "Phone timestamp;sensor timestamp [ns];timestamp [ms];X [mg];Y [mg];Z [mg]"
    assert rows[1] == f"{_PTS};1000;0.0;10;-20;30"


def test_write_gyro_and_mag_headers_carry_correct_units(tmp_path):
    gr, _ = _write_read(tmp_path, "gyro", lambda w: w.write_gyro(_PHONE, 5, 0.0, 1, 2, 3))
    mr, _ = _write_read(tmp_path, "mag", lambda w: w.write_mag(_PHONE, 5, 0.0, 4, 5, 6))
    assert gr[0].endswith("X [dps];Y [dps];Z [dps]") and gr[1] == f"{_PTS};5;0.0;1;2;3"
    assert mr[0].endswith("X [G];Y [G];Z [G]") and mr[1] == f"{_PTS};5;0.0;4;5;6"


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
