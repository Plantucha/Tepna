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
    assert s["span_sec"] is None                                  # freshly written → too short to judge


def _utime(p, t):
    os.utime(p, (t, t))


def test_session_of_falls_back_when_the_stamp_is_not_a_real_datetime():
    # a 14-digit run that is not a valid YYYYMMDDHHMMSS (month 99) → strptime raises → use the mtime
    assert nightqc._session_of("Polar_H10_x_20269999000000_ECG.txt", 123.0) == 123.0
    # no 14-digit stamp at all → mtime
    assert nightqc._session_of("a_b_c_ECG.txt", 456.0) == 456.0


def test_folder_date_helpers_reject_a_non_date_name(tmp_path):
    # a folder whose basename is not YYYY-MM-DD (e.g. 'incoming') has no date → no prev-day, no midnight,
    # and summarize simply skips the cross-midnight pooling.
    d = str(tmp_path / "incoming"); os.makedirs(d)
    assert nightqc._prev_day_dir(d) is None
    assert nightqc._midnight_of(d) is None
    s = nightqc.summarize(d, [])
    assert s["night"] == "incoming" and s["missing"] == []


def test_summarize_unifies_a_cross_midnight_session(tmp_path):
    """A real overnight begins before midnight, so night_dir splits it across two date folders (each
    connection rolls into a folder by its START date). Coverage must see the WHOLE session across both
    folders — else a device that streamed cleanly across midnight reads as badly degraded (observed live
    2026-07-21→22: H10 showed 37% though it captured ~95%)."""
    from datetime import datetime as _dt
    d21 = str(tmp_path / "2026-07-21"); os.makedirs(d21)
    d22 = str(tmp_path / "2026-07-22"); os.makedirs(d22)
    pre = _dt.strptime("20260721233000", "%Y%m%d%H%M%S").timestamp()    # 23:30 — pre-midnight connection
    post = _dt.strptime("20260722001500", "%Y%m%d%H%M%S").timestamp()   # 00:15 — post-midnight reconnect
    # pre-midnight HR (07-21 folder): 1800 rows over 30 min at 1 Hz
    _utime(_cap(d21, "Polar_H10_02849638_20260721233000_HR.txt", 1800), pre + 1800)
    # post-midnight HR (07-22 folder): 1500 rows over 25 min, still being written
    _utime(_cap(d22, "Polar_H10_02849638_20260722001500_HR.txt", 1500), post + 1500)
    devs = [{"name": "H10", "device_id": "02849638", "streams": ["hr"]}]
    s = nightqc.summarize(d22, devs)                    # QC targets the current (07-22) folder
    # session spans 23:30 → 00:40 ≈ 70 min; per-folder it would have been just the 25-min post half
    assert s["span_sec"] > 3600                         # unified across midnight, not the 07-22 half (1500 s)
    assert s["devices"][0]["streams"]["hr"] == 3300     # pre (1800) + post (1500) — one session
    assert 0.7 < s["devices"][0]["coverage"]["hr"] <= 1.05  # ~full, not the deflated per-folder ~0
    assert s["degraded"] == [] and s["missing"] == []


def test_summarize_does_not_pool_a_mid_day_session(tmp_path):
    """A session that started well after midnight must NOT drag in the previous day's folder (that would be
    a needless full re-read and could unify unrelated sittings)."""
    from datetime import datetime as _dt
    d21 = str(tmp_path / "2026-07-21"); os.makedirs(d21)
    d22 = str(tmp_path / "2026-07-22"); os.makedirs(d22)
    y = _dt.strptime("20260721140000", "%Y%m%d%H%M%S").timestamp()      # yesterday afternoon
    t = _dt.strptime("20260722140000", "%Y%m%d%H%M%S").timestamp()      # today 14:00 — NOT near midnight
    _utime(_cap(d21, "Polar_H10_02849638_20260721140000_HR.txt", 9999), y + 1000)
    _utime(_cap(d22, "Polar_H10_02849638_20260722140000_HR.txt", 2000), t + 2000)
    s = nightqc.summarize(d22, [{"name": "H10", "device_id": "02849638", "streams": ["hr"]}])
    assert s["span_sec"] == 2000                        # only today's 14:00 session; yesterday not pooled
    assert s["devices"][0]["streams"]["hr"] == 2000     # yesterday's 9999 rows excluded


def test_summarize_scopes_coverage_to_the_current_session(tmp_path):
    """A date folder can hold an earlier DAYTIME session AND tonight's — the box rolls a folder by the
    session's start date, so a box that ran all day piles both into one YYYY-MM-DD dir. Coverage must be
    judged against the CURRENT session's span, not the ~20 h folder spread — else a stream streaming
    perfectly right now reads as 0% degraded (observed live 2026-07-21, the bug this fixes)."""
    from datetime import datetime as _dt
    night = str(tmp_path / "2026-07-21"); os.makedirs(night)
    day_start = _dt.strptime("20260721000023", "%Y%m%d%H%M%S").timestamp()   # 00:00 — a daytime session
    eve_start = _dt.strptime("20260721194615", "%Y%m%d%H%M%S").timestamp()   # 19:46 — tonight's session
    # daytime HR: a little data, last written ~15 min into that long-gone session
    _utime(_cap(night, "Polar_H10_02849638_20260721000023_HR.txt", 500), day_start + 900)
    # evening HR: 1 Hz for 2000 s = full rate, still being written now
    _utime(_cap(night, "Polar_H10_02849638_20260721194615_HR.txt", 2000), eve_start + 2000)
    devs = [{"name": "H10", "device_id": "02849638", "streams": ["hr"]}]
    s = nightqc.summarize(night, devs)
    assert s["span_sec"] == 2000                        # the EVENING session, NOT ~71000 s (19.7 h)
    h10 = s["devices"][0]
    assert h10["coverage"]["hr"] == 1.0                 # live stream reads full — not diluted to ~0 by daytime
    assert s["degraded"] == [] and s["ok"] is True
    assert h10["streams"]["hr"] == 2000                 # the CURRENT session's rows (the 500 daytime excluded)


def test_summarize_flags_a_degraded_trickle(tmp_path):
    """A stream that produced data but only a fraction of its rate — the Verity IMU at ~40%, a stream that
    died at hour one — is `degraded`, not a green `ok`. Coverage is delivered rows vs rate × span."""
    night = str(tmp_path / "2026-07-19"); os.makedirs(night)
    base = 1_000_000.0
    ecg = _cap(night, "Polar_H10_02849638_20260719_ECG.txt", 130000)   # 130 Hz nominal → ~full
    acc = _cap(night, "Polar_H10_02849638_20260719_ACC.txt", 40000)    # 200 Hz nominal → ~20%
    hr = _cap(night, "Polar_H10_02849638_20260719_HR.txt", 1000)       # 1 Hz nominal → full
    spo2 = _cap(night, "Wellue_O2Ring-S_S8AW_20260719_SPO2.csv", 1000)  # O2Ring branch, 1 Hz → full
    ppg = _cap(night, "Wellue_O2Ring-S_S8AW_20260719_PPG.txt", 125738)  # 125.738 Hz → full
    # a 1000 s span: ACC last written at session start (died early), ECG current
    for p in (acc, hr, spo2, ppg):
        _utime(p, base)
    _utime(ecg, base + 1000)
    s = nightqc.summarize(night, _devices())
    assert s["span_sec"] == 1000
    h10 = next(d for d in s["devices"] if d["name"] == "H10")
    assert h10["coverage"] == {"ecg": 1.0, "acc": 0.2, "hr": 1.0}
    assert s["degraded"] == ["H10:acc 20%"] and s["ok"] is False    # nothing missing, but ACC trickled
    assert s["missing"] == []


def test_summarize_coverage_uses_configured_rate_and_skips_unknown(tmp_path):
    """A device's own `rates` override the nominal denominator; a stream with no reference rate makes no
    coverage claim (better silent than fabricated)."""
    night = str(tmp_path / "2026-07-19"); os.makedirs(night)
    base = 1_000_000.0
    acc = _cap(night, "Polar_VeritySense_0C30_20260719_ACC.txt", 52000)   # configured 52 Hz → full
    foo = _cap(night, "Polar_VeritySense_0C30_20260719_FOO.txt", 10)      # no nominal → no coverage
    _utime(acc, base); _utime(foo, base + 1000)
    devs = [{"name": "Verity", "device_id": "0C30", "model": "VeritySense",
             "streams": ["acc", "foo"], "rates": {"acc": 52}}]
    s = nightqc.summarize(night, devs)
    v = s["devices"][0]
    assert v["coverage"] == {"acc": 1.0}          # configured 52 Hz used; 'foo' has no rate → omitted
    assert s["degraded"] == [] and s["ok"] is True


def test_summarize_no_data_files_span_is_none(tmp_path):
    """A night with only a sidecar has no capture span to measure — coverage stays unknown, not zero."""
    night = str(tmp_path / "2026-07-19"); os.makedirs(night)
    _cap(night, "Tepna_20260719_LINK.csv", 5)                     # sidecar only, no device data
    s = nightqc.summarize(night, [{"name": "H10", "device_id": "X", "streams": ["ecg"]}])
    assert s["span_sec"] is None and s["missing"] == ["H10:ecg"]


# ── VIGIL: an OPTIONAL backup device that did not join is NOT a fault (known-but-not-expected) ──
def test_summarize_optional_device_absence_is_not_missing_and_stays_ok(tmp_path):
    night = str(tmp_path / "2026-07-19"); os.makedirs(night)
    _cap(night, "Polar_H10_02849638_20260719_ECG.txt", 100)
    _cap(night, "Polar_H10_02849638_20260719_ACC.txt", 50)
    _cap(night, "Polar_H10_02849638_20260719_HR.txt", 10)
    devices = [{"name": "H10", "device_id": "02849638", "streams": ["ecg", "acc", "hr"]},
               {"name": "COOSPO", "device_id": "COOSPO01", "streams": ["hr"], "optional": True}]
    s = nightqc.summarize(night, devices)
    assert s["ok"] is True                                  # the absent optional device does NOT fail the night
    assert "COOSPO:hr" not in s["missing"] and s["missing"] == []
    assert s["optional_absent"] == ["COOSPO:hr"]            # but it is still recorded as known-and-absent


def test_summarize_a_NON_optional_absence_still_fails(tmp_path):
    night = str(tmp_path / "2026-07-19"); os.makedirs(night)
    _cap(night, "Polar_H10_02849638_20260719_ECG.txt", 100)
    _cap(night, "Polar_H10_02849638_20260719_ACC.txt", 50)
    _cap(night, "Polar_H10_02849638_20260719_HR.txt", 10)
    devices = [{"name": "H10", "device_id": "02849638", "streams": ["ecg", "acc", "hr"]},
               {"name": "Belt", "device_id": "BELT01", "streams": ["hr"]}]    # NOT optional
    s = nightqc.summarize(night, devices)
    assert s["ok"] is False and "Belt:hr" in s["missing"] and s["optional_absent"] == []
