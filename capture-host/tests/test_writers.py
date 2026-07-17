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
