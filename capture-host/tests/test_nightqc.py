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
    assert s["degraded"] == []
    assert h10["streams"]["hr"] == 2000                 # the CURRENT session's rows (the 500 daytime excluded)
    # ...AND THE EXCLUSION IS REPORTED (CAPTURE-HOST-DEEP-AUDIT §A2). `ok is True` here was the
    # assertion pinning the defect green: this test's scenario is a benign daytime sitting, but the
    # file-activity signature is IDENTICAL to a night interrupted by a >1 h box-wide outage — in which
    # case the same code path discarded the whole pre-outage half and graded the remainder green.
    # Nothing here can tell the two apart, so the exclusion is surfaced instead of guessed about, and
    # the benign case is visible in `gaps` as exactly what it is.
    assert s["ok"] is False, "a session was excluded from the judgement — `ok` cannot claim the night"
    assert len(s["sessions"]) == 2
    assert s["prior_gap_sec"] == round(eve_start - (day_start + 900))
    assert "excluded from coverage" in s["gaps"][0] and "500 rows" in s["gaps"][0]


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


# ── the box-wide outage that graded itself green (CAPTURE-HOST-DEEP-AUDIT §A2) ──────────────────
def test_a_box_wide_outage_does_not_get_the_night_graded_green(tmp_path):
    """THE §A2 regression. `summarize` keeps only the session reaching the newest write, so an outage
    longer than _SESSION_GAP_SEC made it discard the whole pre-outage half of the night — and then
    report `coverage: 1.0, silent_sec: 0, ok: true` over the remainder, with no field saying a word.

    Reachability is not hypothetical: the measured 2026-07-24 box-wide silence ran 03:33->04:32, i.e.
    58.6 min — 85 s under the threshold. This has already come within a minute and a half of firing."""
    from datetime import datetime as _dt
    night = str(tmp_path / "2026-07-24"); os.makedirs(night)
    first = _dt.strptime("20260723220000", "%Y%m%d%H%M%S").timestamp()   # 22:00, ran 3 h -> 01:00
    after = _dt.strptime("20260724023000", "%Y%m%d%H%M%S").timestamp()   # resumed 02:30 — a 90 min hole
    _utime(_cap(night, "Polar_H10_02849638_20260723220000_HR.txt", 10800), first + 10800)
    _utime(_cap(night, "Polar_H10_02849638_20260724023000_HR.txt", 7200), after + 7200)
    devs = [{"name": "H10", "device_id": "02849638", "streams": ["hr"]}]
    s = nightqc.summarize(night, devs)

    # The scoping itself is KEPT — that part was deliberate and is not the defect.
    assert s["span_sec"] == 7200, "still scoped to the current session"
    assert s["devices"][0]["coverage"]["hr"] == 1.0
    assert s["missing"] == [] and s["degraded"] == []
    # What changes is that it can no longer claim the night on that basis.
    assert s["ok"] is False, "half the night was discarded and it still graded green"
    assert s["prior_gap_sec"] == round(after - (first + 10800))
    assert [x["rows"] for x in s["sessions"]] == [10800, 7200], "both halves are reported"
    assert s["gaps"] and "10800 rows" in s["gaps"][0]


def test_an_uninterrupted_night_reports_no_gap_and_stays_green(tmp_path):
    """The control. If `gaps` fired on an ordinary night — one session, or a reconnect inside the gap
    threshold — `ok` would be false every night and the signal would be worthless."""
    from datetime import datetime as _dt
    night = str(tmp_path / "2026-07-24"); os.makedirs(night)
    t = _dt.strptime("20260724220000", "%Y%m%d%H%M%S").timestamp()
    _utime(_cap(night, "Polar_H10_02849638_20260724220000_HR.txt", 3600), t + 3600)
    # a reconnect 10 min later — well inside _SESSION_GAP_SEC, so it is the SAME session
    t2 = t + 4200
    _utime(_cap(night, "Polar_H10_02849638_20260724231000_HR.txt", 3600), t2 + 3600)
    s = nightqc.summarize(night, [{"name": "H10", "device_id": "02849638", "streams": ["hr"]}])
    assert s["gaps"] == [] and s["prior_gap_sec"] is None
    assert len(s["sessions"]) == 1, "a reconnect inside the threshold is one session, not two"
    assert s["ok"] is True


def test_summarize_pools_when_the_reconnect_took_longer_than_the_gap(tmp_path):
    """THE NEAR-MIDNIGHT PROXY IS NOT THE QUESTION. Pooling used to be gated on "did this folder open just
    after midnight", which stands in for "does last night continue here" only while the reconnect is quicker
    than _SESSION_GAP_SEC. Real case, 2026-07-28: the H10 dropped at 01:08:10 and returned at 01:08:59 —
    4101 s past midnight, 501 s over the gate — so its 107 MB 01:08→05:03 half landed in tomorrow's folder
    with pooling off. The night was judged twice and wrong both times (07-28: ecg 0.53, 3.4 h "silent",
    ok=false; 07-29: ecg 1.0 but no Verity or O2Ring at all). Contiguity with the neighbour is the property
    that actually matters, and it does not care how long the reconnect took."""
    from datetime import datetime as _dt
    d28 = str(tmp_path / "2026-07-28"); os.makedirs(d28)
    d29 = str(tmp_path / "2026-07-29"); os.makedirs(d29)
    pre = _dt.strptime("20260728220542", "%Y%m%d%H%M%S").timestamp()    # 22:05 — the evening connection
    post = _dt.strptime("20260729010859", "%Y%m%d%H%M%S").timestamp()   # 01:08 — past the 1 h gate
    _utime(_cap(d28, "Polar_H10_02849638_20260728220542_HR.txt", 10920), pre + 10920)   # → 01:08:02
    _utime(_cap(d29, "Polar_H10_02849638_20260729010859_HR.txt", 14082), post + 14082)  # → 05:03
    devs = [{"name": "H10", "device_id": "02849638", "streams": ["hr"]}]
    s = nightqc.summarize(d29, devs)
    assert s["searched_dirs"] == ["2026-07-29", "2026-07-28"]   # it ASKED next door
    assert s["devices"][0]["streams"]["hr"] == 25002            # both halves, one night
    assert s["span_sec"] > 6 * 3600                             # ~7 h, not the 3.9 h post-midnight half
    assert 0.9 < s["devices"][0]["coverage"]["hr"] <= 1.05      # not the deflated 0.53 the box reported
    assert s["degraded"] == [] and s["missing"] == []


def test_summarize_does_not_pool_a_non_contiguous_small_hours_session(tmp_path):
    """The probe widens WHERE we ask, never WHAT we accept. A 02:00 sitting whose neighbour stopped at
    18:00 yesterday is not last night's session, and pooling it would fuse two unrelated sittings — the
    exact failure the mid-day guard exists to prevent, just inside the probe window."""
    from datetime import datetime as _dt
    d28 = str(tmp_path / "2026-07-28"); os.makedirs(d28)
    d29 = str(tmp_path / "2026-07-29"); os.makedirs(d29)
    y = _dt.strptime("20260728180000", "%Y%m%d%H%M%S").timestamp()      # yesterday evening, long over
    t = _dt.strptime("20260729020000", "%Y%m%d%H%M%S").timestamp()      # 02:00 — inside the probe window
    _utime(_cap(d28, "Polar_H10_02849638_20260728180000_HR.txt", 600), y + 600)
    _utime(_cap(d29, "Polar_H10_02849638_20260729020000_HR.txt", 600), t + 600)
    devs = [{"name": "H10", "device_id": "02849638", "streams": ["hr"]}]
    s = nightqc.summarize(d29, devs)
    assert s["searched_dirs"] == ["2026-07-29"]        # asked, and the answer was no
    assert s["devices"][0]["streams"]["hr"] == 600     # yesterday's sitting stays out


def test_prev_probe_window_is_a_cost_guard_only():
    """Known answers for the probe window. It decides only whether the contiguity question is ASKED."""
    mid = 1_000_000.0
    assert nightqc.prev_probe_window(mid, mid) is True                    # 00:00
    assert nightqc.prev_probe_window(mid + 4101, mid) is True             # 01:08 — the real 2026-07-28 case
    assert nightqc.prev_probe_window(mid + 11.9 * 3600, mid) is True      # 11:54 — still worth asking
    assert nightqc.prev_probe_window(mid + 12 * 3600, mid) is False       # noon — cannot be last night
    assert nightqc.prev_probe_window(mid + 15 * 3600, mid) is False       # 15:00 — never pays for the scan
    assert nightqc.prev_probe_window(mid - 1, mid) is False               # before this folder's midnight
    assert nightqc.prev_probe_window(mid, None) is False                  # undatable folder name


# ── the stamp regex must be the ANCHORED sibling, not a bare 14-digit run (audit F5, 2026-08-01) ──────
#
# `writers._DATE14` solves the identical problem with `^(?:19|20)\d{12}$` after parsing the field from
# the right, and its comment states why: "Anchoring the stamp to a plausible YEAR is what makes it
# decidable — an 8-digit serial like 02849638 is not a date." `_STAMP_RE` was the lone divergent sibling:
# an unanchored `_(\d{14})_` that takes the FIRST 14-digit run in the name, wherever it sits.

def test_a_14_digit_device_serial_is_not_read_as_the_session_stamp(tmp_path):
    import nightqc
    # A device whose serial happens to be 14 digits, followed by the real capture stamp.
    fname = "Polar_H10_20250101000000_20260725225058_ECG.txt"
    got = nightqc._session_of(fname, mtime=1.0)
    from datetime import datetime
    expect = datetime.strptime("20260725225058", "%Y%m%d%H%M%S").timestamp()
    assert got == expect, "the SERIAL was taken for the stamp — the session key is a different night"


def test_a_run_of_digits_that_is_not_a_plausible_year_is_ignored(tmp_path):
    import nightqc
    assert nightqc._session_of("Polar_H10_99999999999999_ECG.txt", mtime=7.0) == 7.0, (
        "a 14-digit run with an impossible year must fall back to mtime, not be strptime'd"
    )


def test_merge_sessions_does_not_depend_on_the_order_it_is_HANDED_the_files():
    """The docstring promises sessions "oldest first", and the merge is what makes that true — but the
    merge is also what DEPENDS on it, and nothing gated either half.

    The loop compares each file against `sessions[-1]` alone. That single-pass shape is only correct
    because the input was sorted by start stamp first; hand it the same files in a different order and
    two stretches of one continuous connection land in separate sessions. It is the same failure the
    docstring already records one paragraph up — a 7-h H10 connection split into isolated points —
    reached by a different route, and it matters because both consumers derive a coverage DENOMINATOR
    from the session they pick (`nightqc.summarize`, `timeline.build`, audit §A4a).

    `scan_night` happens to hand them over name-sorted today. That is a property of one caller, not of
    this function, and `summarize` already concatenates a previous day's scan onto the front of it.
    """
    # one continuous 3-h session: three files opening 30 min apart, each written for an hour
    hour = 3600.0
    files = [{"file": f"f{i}", "session": i * 0.5 * hour, "mtime": i * 0.5 * hour + hour}
             for i in range(3)]
    chronological = nightqc.merge_sessions(files)
    assert len(chronological) == 1, "the fixture is not one session; the test below proves nothing"
    assert chronological[0][0] == 0.0 and chronological[0][1] == 2.0 * hour

    for order in ([2, 0, 1], [1, 2, 0], [2, 1, 0]):
        shuffled = nightqc.merge_sessions([files[i] for i in order])
        assert len(shuffled) == 1, (
            f"input order {order} split ONE continuous session into {len(shuffled)} — the coverage "
            f"denominator both consumers derive from this is wrong by that factor"
        )
        assert shuffled == chronological, f"input order {order} changed the merged interval"


def test_merge_sessions_returns_genuinely_separate_sessions_oldest_first():
    """The control for the test above: order-independence must not have been bought by merging
    everything. Two sittings a clear `gap_sec` apart stay two, and they come back oldest first however
    they were handed over."""
    hour = 3600.0
    early = {"file": "early", "session": 0.0, "mtime": hour}
    late = {"file": "late", "session": 6 * hour, "mtime": 7 * hour}
    for files in ([early, late], [late, early]):
        got = nightqc.merge_sessions(files)
        assert [s[0] for s in got] == [0.0, 6 * hour], f"not two sessions oldest-first: {got}"


# ─── READY FOR ANY Hz — the rate is a fact to be read, not a config value to be trusted ──────────

def test_measured_hz_reads_the_rate_off_the_device_stamps(tmp_path):
    """The rate a file CARRIES, not the one that was requested.

    `polar_pmd`'s SDK-MODE block documents the way these diverge: streams must be stopped before SDK
    mode is entered or the device answers 0x0C, which sits in TRANSIENT_STATUS — so a caller that only
    asks `is_transient` reads the refusal as "try again later" and records the whole night at 55 Hz
    believing it asked for 176. Verified against real captures at 176.41, 55.11, 130.0 and 50.74 Hz.
    """
    import nightqc
    for hz in (55.0, 176.0, 130.0):
        p = os.path.join(tmp_path, f"X_{int(hz)}_PPG.txt")
        step = int(1e9 / hz)
        with open(p, "w") as fh:
            fh.write("Phone timestamp;sensor timestamp [ns];channel 0\n")
            for i in range(1000):
                fh.write(f"2026-08-12T02:00:00.000;{500_000_000_000 + i * step};1\n")
        got = nightqc.measured_hz(p)
        assert abs(got - hz) < 0.01, f"{hz} Hz file measured as {got}"


def test_measured_hz_refuses_rather_than_guessing(tmp_path):
    """Every refusal path returns None. A rate this cannot establish must not be reported as a number —
    the whole point is to be the one claim that cannot be wrong about itself."""
    import nightqc
    assert nightqc.measured_hz(os.path.join(tmp_path, "absent.txt")) is None
    noscol = os.path.join(tmp_path, "no_col_PPG.txt")
    with open(noscol, "w") as fh:
        fh.write("Time,Oxygen Level\n12:00:00 01/01/2026,98\n" * 400)
    assert nightqc.measured_hz(noscol) is None, "a non-PMD layout must not be judged"
    short = os.path.join(tmp_path, "short_PPG.txt")
    with open(short, "w") as fh:
        fh.write("Phone timestamp;sensor timestamp [ns];channel 0\n")
        for i in range(20):
            fh.write(f"2026-08-12T02:00:00.000;{500_000_000_000 + i * 18_000_000};1\n")
    assert nightqc.measured_hz(short) is None, "too few rows to divide by"
    stalled = os.path.join(tmp_path, "stall_PPG.txt")
    with open(stalled, "w") as fh:
        fh.write("Phone timestamp;sensor timestamp [ns];channel 0\n")
        for _ in range(400):
            fh.write("2026-08-12T02:00:00.000;500000000000;1\n")
    assert nightqc.measured_hz(stalled) is None, "a stalled counter cannot name a rate"


def test_rate_reality_catches_the_rate_that_was_asked_for_but_not_delivered(tmp_path):
    """THE FAILURE THIS EXISTS FOR: config asks 176 Hz, the device records 55.

    Coverage does notice — delivered rows are 31% of expected, so the stream reports `degraded` — but
    that names it a link fault, which is the wrong thing to chase. This names it a rate fault.
    """
    import nightqc
    step = int(1e9 / 55.0)
    p = os.path.join(tmp_path, "Polar_VeritySense_0C301E3F_20260812020000_PPG.txt")
    with open(p, "w") as fh:
        fh.write("Phone timestamp;sensor timestamp [ns];channel 0\n")
        for i in range(1000):
            fh.write(f"2026-08-12T02:00:00.000;{500_000_000_000 + i * step};1\n")
    dev = {"name": "Polar Verity Sense", "device_id": "0C301E3F", "streams": ["ppg"], "rates": {"ppg": 176}}
    row = nightqc.rate_reality(str(tmp_path), [dev])[0]
    assert row["requested_hz"] == 176.0
    assert abs(row["measured_hz"] - 55.0) < 0.1
    assert row["matches_config"] is False, row

    dev["rates"]["ppg"] = 55        # asked for what it got
    assert nightqc.rate_reality(str(tmp_path), [dev])[0]["matches_config"] is True


def test_host_jitter_is_rate_agnostic_by_construction():
    """The DEVICE clock supplies the expected cadence, so the same host jitter reports the same at any Hz.

    That is the property that matters when one night may run at 55 Hz and the next at 176: a rate change
    moves the packet period and must not move this. Differencing consecutive `arrival - device` delays
    cancels the device cadence and leaves only what the host added.
    """
    import random
    import nightqc
    for period_ms in (18.14, 5.68):        # 55 Hz and 176 Hz packet cadence
        rng = random.Random(4)
        delays = [400.0 + rng.gauss(0, 10) for _ in range(2000)]   # same host jitter either way
        j = nightqc.host_jitter(delays)
        # difference of two N(0,10) has sd 14.1, so IQR = 1.349 * 14.1 ~ 19 ms — independent of period
        assert abs(j["iqr_ms"] - 19.0) < 2.0, (period_ms, j)
        assert j["n"] == 1999


def test_host_jitter_refuses_below_a_hundred_packets():
    import nightqc
    assert nightqc.host_jitter([]) is None
    assert nightqc.host_jitter([1.0] * 50) is None
    assert nightqc.host_jitter([1.0] * 200) is not None


def test_host_jitter_surfaces_a_step_rather_than_averaging_it_away():
    """A counter reset or a wedged stack is a STEP, and `worst_ms` is what shows it. On the real
    2026-08-11 ring the reset appeared here as 24,189,016 ms — an obvious artefact rather than a
    slightly wider IQR, which is the point of reporting the tail beside the spread."""
    import nightqc
    d = [400.0] * 500 + [400.0 + 24_189_016.0] * 500
    j = nightqc.host_jitter(d)
    assert j["worst_ms"] >= 24_189_016.0
    assert j["iqr_ms"] < 1.0, "the step must not be smeared into the everyday spread"


def test_measured_hz_stops_at_max_rows_and_skips_unparseable_lines(tmp_path):
    """The row cap and both skip paths. The cap is why a 456 MB PPG file can be asked its rate at all;
    the skips are why one truncated or non-numeric line does not sink the measurement."""
    import nightqc
    p = os.path.join(tmp_path, "big_PPG.txt")
    step = int(1e9 / 176.0)
    with open(p, "w") as fh:
        fh.write("Phone timestamp;sensor timestamp [ns];channel 0\n")
        for i in range(6000):                     # > _RATE_SAMPLE_ROWS, so the cap must fire
            if i == 10:
                fh.write("truncated-line-with-no-semicolon\n")
            elif i == 20:
                fh.write(f"2026-08-12T02:00:00.000;not-a-number;{i}\n")
            else:
                fh.write(f"2026-08-12T02:00:00.000;{500_000_000_000 + i * step};{i}\n")
    got = nightqc.measured_hz(p)
    assert abs(got - 176.0) < 0.5, got
    # the cap really did stop early: a tiny cap must still measure the same rate
    assert abs(nightqc.measured_hz(p, max_rows=300) - 176.0) < 0.5


def test_size_of_an_unreadable_path_is_zero():
    """`rate_reality` picks the LARGEST candidate file; a path that vanishes between listing and sizing
    must sort last rather than raise."""
    import nightqc
    assert nightqc._size("/nonexistent/never/here.txt") == 0


def test_dev_matches_falls_back_from_id_to_alias_to_model():
    """Three routes, because a device's id is corrected over time and older files keep the old one —
    the same reason `writers.device_ids` exists."""
    import nightqc
    dev_id = {"device_id": "0C301E3F", "device_id_aliases": ["AC0C301E"], "name": "Polar Verity Sense"}
    assert nightqc._dev_matches("Polar_VeritySense_0C301E3F_x_PPG.txt", dev_id) is True
    assert nightqc._dev_matches("Polar_VeritySense_AC0C301E_x_PPG.txt", dev_id) is True, "alias route"
    assert nightqc._dev_matches("Polar_VeritySense_DEADBEEF_x_PPG.txt", dev_id) is False, "a different unit"
    dev_noid = {"name": "Polar Verity Sense"}
    assert nightqc._dev_matches("Polar_VeritySense_ANY_x_PPG.txt", dev_noid) is True, "model route"
    assert nightqc._dev_matches("Polar_H10_02849638_x_ECG.txt", dev_noid) is False


def test_measured_hz_never_judges_the_o2ring_row_rate_as_a_sample_rate(tmp_path):
    """THE O2RING TRAP, pinned. Its pleth file writes one row per sample PLUS one per inserted `156`
    beat marker, so a row count yields ~125.7 for a 125.000 Hz ADC — a row rate wearing a sample
    rate's units, and exactly the kind of confident-but-wrong number this function exists to avoid.

    The layout guard is what saves it: no `sensor timestamp [ns]` column, no verdict. That guard is
    load-bearing rather than incidental, so it gets a test of its own.
    """
    import nightqc
    p = os.path.join(tmp_path, "Wellue_O2Ring-S_S8AW2100_20260812020000_PPG.txt")
    with open(p, "w") as fh:
        fh.write("Time,ch0,ch1,ch2,ambient\n")
        for i in range(2000):
            fh.write(f"{i},1,2,3,4\n")
    assert nightqc.measured_hz(p) is None, "a non-PMD layout must yield no rate at all"


def test_rate_reality_survives_an_unreadable_night_directory():
    """A night folder that vanished or was never created must yield no rows, not raise — `summarize`
    calls this before the coverage loop, so an exception here would take the whole QC summary with it."""
    import nightqc
    assert nightqc.rate_reality("/nonexistent/night", [{"name": "x", "streams": ["ppg"]}]) == []


def test_tau0_is_the_mean_packet_interval_in_seconds_exactly():
    """Pinned exactly, because tau0 SCALES the whole Allan curve: sigma_y is divided by tau, so a wrong
    tau0 rescales every point and still produces a plausible-looking curve with the right shape. Ten
    arithmetic mutations survived a shape-only test here."""
    import nightqc
    # 5 packets spanning 4 intervals of 250 ms → tau0 = 0.25 s exactly
    pairs = [(1000.0, 0.0), (1250.0, 0.0), (1500.0, 0.0), (1750.0, 0.0), (2000.0, 0.0)]
    assert nightqc._tau0_of(pairs) == 0.25
    # it is a mean over intervals (n-1), not over packets (n) — the classic off-by-one
    assert nightqc._tau0_of(pairs) != (2000.0 - 1000.0) / 1000.0 / len(pairs)
    # HOST stamps only: the second member of each pair must never enter it
    poisoned = [(1000.0, 9e9), (1250.0, -9e9), (1500.0, 5.0), (1750.0, 0.0), (2000.0, 7.0)]
    assert nightqc._tau0_of(poisoned) == 0.25, "the delay column leaked into the sample interval"
    # ms → s, exactly
    assert nightqc._tau0_of([(0.0, 0.0), (2000.0, 0.0)]) == 2.0


def test_tau0_refuses_below_two_packets_and_returns_zero_not_one():
    """A 0.0 makes `allan.adev` refuse (`tau0 <= 0`); a 1.0 would silently claim a one-second interval
    and produce a whole curve on an axis that was never measured."""
    import nightqc
    assert nightqc._tau0_of([]) == 0.0
    assert nightqc._tau0_of([(1.0, 0.0)]) == 0.0
    assert nightqc._tau0_of([(0.0, 0.0), (1000.0, 0.0)]) == 1.0, "two packets IS enough"


def test_an_unconfigured_or_unmeasurable_rate_is_unjudged_not_failed(tmp_path):
    """A user may change a device's rate at any time, and a future sensor may offer rates nobody
    documented — so `matches_config` must be None where either number is unknown, never False. A
    verdict of False on an unfamiliar sensor would read as a fault in a night that is perfectly fine."""
    import nightqc
    step = int(1e9 / 176.0)
    p = os.path.join(tmp_path, "Polar_VeritySense_0C301E3F_20260812020000_PPG.txt")
    with open(p, "w") as fh:
        fh.write("Phone timestamp;sensor timestamp [ns];channel 0\n")
        for i in range(1000):
            fh.write(f"2026-08-12T02:00:00.000;{500_000_000_000 + i * step};1\n")
    # a device with NO configured rate for this stream, and no model nominal to fall back on
    dev = {"name": "Some Future Sensor", "device_id": "0C301E3F", "streams": ["ppg"]}
    row = nightqc.rate_reality(str(tmp_path), [dev])[0]
    assert row["measured_hz"] is not None, "the rate is still MEASURED and reported"
    assert row["matches_config"] is None, "unjudged, because there is nothing to judge it against"


def test_an_unknown_device_does_not_inherit_another_models_rate_table():
    """`_model_of` defaults an unrecognised device to "O2Ring" so its callers always get a string.
    That default must never reach the nominal table: a future sensor would otherwise be judged against
    the O2Ring's 125.738 Hz row rate — a coverage figure and a rate verdict both computed from a model
    the device is not. Found by asking what happens when a user attaches something undocumented."""
    import nightqc
    unknown = {"name": "Some Future Sensor", "streams": ["ppg"]}
    assert nightqc._model_of(unknown) == "O2Ring", "the default is unchanged for its other callers"
    assert nightqc._recognised_model(unknown) is None
    assert nightqc._expected_hz(unknown, "ppg") is None, "no borrowed rate"
    # …while every device the suite DOES know still resolves
    for dev, stream, want in (({"name": "Polar H10"}, "ecg", 130),
                              ({"name": "Polar Verity Sense"}, "ppg", 55),
                              ({"name": "Wellue O2Ring-S"}, "ppg", 125.738)):
        assert nightqc._expected_hz(dev, stream) == want, (dev, stream)
    # and a CONFIGURED rate always wins, for known and unknown alike
    assert nightqc._expected_hz({"name": "Some Future Sensor", "rates": {"ppg": 400}}, "ppg") == 400.0


def _write_stream(path, hz, rows=1000):
    step = int(1e9 / hz)
    with open(path, "w") as fh:
        fh.write("Phone timestamp;sensor timestamp [ns];v\n")
        for i in range(rows):
            fh.write(f"2026-08-12T02:00:00.000;{500_000_000_000 + i * step};1\n")


def test_rate_reality_picks_the_right_device_and_the_largest_of_its_files(tmp_path):
    """Two devices in one night, and several fragments per stream. The filename filter must not let
    the OTHER device's file answer for this one, and the largest fragment must win — the short
    reconnect fragments cannot settle a rate and would report a spurious mismatch."""
    import nightqc
    _write_stream(os.path.join(tmp_path, "Polar_VeritySense_0C301E3F_20260812010000_PPG.txt"), 55.0, rows=300)
    _write_stream(os.path.join(tmp_path, "Polar_VeritySense_0C301E3F_20260812020000_PPG.txt"), 176.0, rows=4000)
    _write_stream(os.path.join(tmp_path, "Polar_VeritySense_DEADBEEF_20260812030000_PPG.txt"), 25.0, rows=9000)
    dev = {"name": "Polar Verity Sense", "device_id": "0C301E3F", "streams": ["ppg"], "rates": {"ppg": 176}}
    row = nightqc.rate_reality(str(tmp_path), [dev])[0]
    assert abs(row["measured_hz"] - 176.0) < 0.5, "the LARGEST file of THIS device must win"
    assert row["matches_config"] is True


def test_rate_reality_keeps_scanning_past_a_stream_with_no_files(tmp_path):
    """`continue`, not `break`: a configured stream that produced nothing must not stop the streams
    after it being reported. Streams are walked in sorted order, so `acc` precedes `ppg` here."""
    import nightqc
    _write_stream(os.path.join(tmp_path, "Polar_VeritySense_0C301E3F_20260812020000_PPG.txt"), 176.0, rows=4000)
    dev = {"name": "Polar Verity Sense", "device_id": "0C301E3F", "streams": ["acc", "ppg"]}
    rows = nightqc.rate_reality(str(tmp_path), [dev])
    assert [r["stream"] for r in rows] == ["ppg"], rows


def test_the_rate_tolerance_is_ten_percent_of_the_REQUESTED_rate_inclusive(tmp_path):
    """Two things at once, both of which survived a looser test: the bound is a FRACTION of the
    requested rate (not a fixed window, and not divided by it), and it is INCLUSIVE — a device sitting
    exactly on the bound matches, since the bound is the tolerance rather than the first failure."""
    import nightqc
    p = os.path.join(tmp_path, "Polar_VeritySense_0C301E3F_20260812020000_PPG.txt")
    _write_stream(p, 55.0, rows=4000)
    mk = lambda want: nightqc.rate_reality(  # noqa: E731 - a local factory, not worth a helper
        str(tmp_path), [{"name": "Polar Verity Sense", "device_id": "0C301E3F",
                         "streams": ["ppg"], "rates": {"ppg": want}}])[0]
    assert mk(50.5)["matches_config"] is True, "55 vs 50.5 is 8.9% — inside"
    assert mk(49.0)["matches_config"] is False, "55 vs 49 is 12.2% — outside"
    # THE BOUND SCALES WITH THE REQUESTED RATE. A fixed window, or one DIVIDED by the rate, cannot do
    # both of these: at 55 Hz a 5 ms-equivalent slack is generous, at 176 Hz the same absolute slack is
    # tiny. 176 vs 165 is 6.3% (inside) where 55 vs 49 was 12.2% (outside) on a smaller absolute gap.
    _write_stream(p, 176.0, rows=4000)
    assert mk(165.0)["matches_config"] is True, "6.3% at 176 Hz is inside — an absolute window would not be"
    assert mk(150.0)["matches_config"] is False, "17.3% is outside at any rate"
    assert abs(165.0 - 176.0) > abs(55.0 - 49.0), "the inside case has the LARGER absolute gap"
