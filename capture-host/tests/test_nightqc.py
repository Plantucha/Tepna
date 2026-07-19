# tepna-capture — tests/test_nightqc.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
import os

import nightqc


def _cap(night, name, rows, header="h1;h2\n"):
    """Write a capture file with a header line + `rows` data lines."""
    p = os.path.join(night, name)
    with open(p, "w") as fh:
        fh.write(header)
        for i in range(rows):
            fh.write(f"{i};{i}\n")
    return p


def test_parse_capture_name():
    assert nightqc.parse_capture_name("Polar_H10_02849638_20260719000000_ECG.txt") == ("ECG", "txt")
    assert nightqc.parse_capture_name("Wellue_O2Ring-S_S8AW_20260719_SPO2.csv") == ("SPO2", "csv")
    assert nightqc.parse_capture_name("noext") is None            # no extension
    assert nightqc.parse_capture_name("nounderscore.txt") is None  # no `_`
    assert nightqc.parse_capture_name("trailing_.txt") is None     # empty stream tag


def test_count_rows(tmp_path):
    p = _cap(str(tmp_path), "a_b_c_1_ECG.txt", rows=5)
    assert nightqc.count_rows(p) == 5
    header_only = os.path.join(tmp_path, "a_b_c_1_ACC.txt")
    open(header_only, "w").write("just a header\n")
    assert nightqc.count_rows(header_only) == 0                    # header-only → 0 rows
    empty = os.path.join(tmp_path, "a_b_c_1_MAG.txt")
    open(empty, "w").close()
    assert nightqc.count_rows(empty) == 0                          # empty file → 0
    assert nightqc.count_rows(str(tmp_path / "does-not-exist")) == 0  # missing → 0 (OSError swallowed)


def test_scan_night_lists_capture_files_only(tmp_path):
    night = str(tmp_path / "2026-07-19"); os.makedirs(night)
    _cap(night, "Polar_H10_02849638_20260719_ECG.txt", 3)
    _cap(night, "Tepna_20260719_LINK.csv", 2)                      # a sidecar — tagged, still listed
    open(os.path.join(night, "notes.md"), "w").write("x")          # no `_`+ext capture shape → ignored
    open(os.path.join(night, nightqc._SUMMARY_NAME), "w").write("{}")  # the QC file itself → skipped
    os.mkdir(os.path.join(night, "weird_x_ACC.txt"))               # a DIR with a capture name → not isfile
    scanned = nightqc.scan_night(night)
    files = {r["file"]: r for r in scanned}
    assert set(files) == {"Polar_H10_02849638_20260719_ECG.txt", "Tepna_20260719_LINK.csv"}
    assert files["Polar_H10_02849638_20260719_ECG.txt"]["rows"] == 3


def test_scan_night_missing_dir_is_empty():
    assert nightqc.scan_night("/no/such/night") == []


def _devices():
    return [{"name": "H10", "device_id": "02849638", "streams": ["ecg", "acc", "hr"]},
            {"name": "Ring", "device_id": "S8AW", "streams": ["spo2", "ppg"]}]


def test_summarize_all_present_is_ok(tmp_path):
    night = str(tmp_path / "2026-07-19"); os.makedirs(night)
    _cap(night, "Polar_H10_02849638_20260719_ECG.txt", 100)
    _cap(night, "Polar_H10_02849638_20260719_ACC.txt", 50)
    _cap(night, "Polar_H10_02849638_20260719_HR.txt", 10)
    _cap(night, "Wellue_O2Ring-S_S8AW_20260719_SPO2.csv", 900)
    _cap(night, "Wellue_O2Ring-S_S8AW_20260719_PPG.txt", 8000)
    _cap(night, "Tepna_20260719_LINK.csv", 5)
    s = nightqc.summarize(night, _devices())
    assert s["ok"] is True and s["missing"] == []
    assert s["night"] == "2026-07-19" and s["files"] == 6
    assert s["total_rows"] == 100 + 50 + 10 + 900 + 8000 + 5
    assert s["sidecars"] == ["LINK"]
    h10 = next(d for d in s["devices"] if d["name"] == "H10")
    assert h10["streams"] == {"ecg": 100, "acc": 50, "hr": 10}


def test_summarize_flags_a_missing_and_header_only_stream(tmp_path):
    night = str(tmp_path / "2026-07-19"); os.makedirs(night)
    _cap(night, "Polar_H10_02849638_20260719_ECG.txt", 100)
    _cap(night, "Polar_H10_02849638_20260719_ACC.txt", 0)         # header-only → counts as missing
    # HR file absent entirely → also missing; Ring produced nothing at all
    s = nightqc.summarize(night, _devices())
    assert s["ok"] is False
    assert set(s["missing"]) == {"H10:acc", "H10:hr", "Ring:spo2", "Ring:ppg"}
