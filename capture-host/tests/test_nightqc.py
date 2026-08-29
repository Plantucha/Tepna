# tepna-capture — tests/test_nightqc.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
import os

import math
import datetime as _dtmod

import pytest
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
    # ...AND THE EXCLUSION IS REPORTED (CAPTURE-HOST-DEEP-AUDIT §A2), BUT NO LONGER REDS THE NIGHT
    # (FINISHED-WORK §D). The history matters. `ok is True` here was once the assertion pinning a real
    # defect green — the file-activity signature of this benign sitting is IDENTICAL to a night
    # interrupted by a >1 h box-wide outage, and that path discarded the pre-outage half and graded
    # the remainder green. So the exclusion was surfaced and `ok` went false rather than guessing.
    #
    # What changed is that a SECOND discriminator exists, and it is not the file-activity signature:
    # WHERE the excluded session sits against the judged night's band. This sitting ran 00:00->00:15,
    # wholly before the judged evening session's band opens at 20:00 — it belongs to the previous
    # night, so it cannot be a hole in this one. The 2026-07-24 outage below sits INSIDE the band and
    # still reds, which is the pair this rule has to get right.
    #
    # `ok` false on every day carrying any daytime capture is what made it uninformative: the module's
    # own comment records it false on 20 of the last 20 nights.
    assert s["ok"] is True, "an exclusion outside the judged night's band is not a hole in this night"
    assert len(s["sessions"]) == 2
    assert s["prior_gap_sec"] == round(eve_start - (day_start + 900))
    # STILL REPORTED, and now labelled — the exclusion is never hidden, it is only re-scoped.
    assert "excluded from coverage" in s["gaps"][0] and "500 rows" in s["gaps"][0]
    assert "[outside-band]" in s["gaps"][0], "the class must be visible, never a silent green"
    assert s["gaps_in_night"] == [], "nothing was excluded from the night itself"


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
    """THE §A2 regression. An outage longer than _SESSION_GAP_SEC splits the night, and `summarize`
    judges ONE session — so half the night is discarded and the remainder could report
    `coverage: 1.0, silent_sec: 0, ok: true` with no field saying a word.

    Reachability is not hypothetical: the measured 2026-07-24 box-wide silence ran 03:33->04:32, i.e.
    58.6 min — 85 s under the threshold. This has already come within a minute and a half of firing.

    ⚠️ UPDATED 2026-08-15, and the guarantee is unchanged while one incidental fact is. `summarize` no
    longer keeps "the session reaching the newest write" — it keeps the one with the most ROWS, because
    the old rule made it judge a DAYTIME session (on 2026-08-15, a Verity streaming into its charger) and
    report the night as an excluded gap. So here the BIGGER half is judged rather than the later one.

    That change re-opened this very regression through a door this test could not see: gap detection
    looked only BEFORE the judged session, which was safe only while the judged session was always the
    newest. With the earlier half judged, the discarded half sits AFTER it and was invisible — the night
    would have graded green having thrown away part of itself. Gap detection is now two-sided, and the
    assertions below check the LATER-side exclusion rather than the earlier-side one. `ok is False` — the
    thing this test exists for — is asserted identically."""
    from datetime import datetime as _dt
    night = str(tmp_path / "2026-07-24"); os.makedirs(night)
    first = _dt.strptime("20260723220000", "%Y%m%d%H%M%S").timestamp()   # 22:00, ran 3 h -> 01:00
    after = _dt.strptime("20260724023000", "%Y%m%d%H%M%S").timestamp()   # resumed 02:30 — a 90 min hole
    _utime(_cap(night, "Polar_H10_02849638_20260723220000_HR.txt", 10800), first + 10800)
    _utime(_cap(night, "Polar_H10_02849638_20260724023000_HR.txt", 7200), after + 7200)
    devs = [{"name": "H10", "device_id": "02849638", "streams": ["hr"]}]
    s = nightqc.summarize(night, devs)

    # The scoping itself is KEPT — that part was deliberate and is not the defect.
    assert s["span_sec"] == 10800, "scoped to the judged session — now the BIGGER half, not the later one"
    assert s["judged_session"]["rows"] == 10800, "the substantive half is judged"
    assert s["devices"][0]["coverage"]["hr"] == 1.0
    assert s["missing"] == [] and s["degraded"] == []
    # THE GUARANTEE, unchanged: it cannot claim the night while half of it was discarded.
    assert s["ok"] is False, "half the night was discarded and it still graded green"
    assert [x["rows"] for x in s["sessions"]] == [10800, 7200], "both halves are reported"
    # The discarded half is now AFTER the judged one, which one-sided detection could not see.
    assert s["gaps"], "the outage must be named"
    assert "7200 rows" in s["gaps"][0] and "later session" in s["gaps"][0]
    # THE GUARD ON §D's RE-SCOPING. This half sits at 02:30-04:30, inside the judged night's band, so
    # it must classify in-night and keep reding. If the placement rule ever admitted it, the regression
    # this whole test exists for would be back with a green on top.
    assert "[in-night]" in s["gaps"][0]
    assert s["gaps_in_night"] == s["gaps"], "an in-night hole is exactly what `ok` must read"
    assert s["prior_gap_sec"] is None, "nothing precedes the judged half; the hole is on the other side"


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


def _write_stream_ns(path, step, rows=1000):
    """Write with an EXPLICIT ns step. `_write_stream` truncates 1e9/hz, so the rate it produces is
    1e9/int(1e9/hz) — close to `hz` but not equal to it, which is fine for tolerance tests and fatal
    for a boundary test that must land on the bound BIT-EXACTLY."""
    with open(path, "w") as fh:
        fh.write("Phone timestamp;sensor timestamp [ns];v\n")
        for i in range(rows):
            fh.write(f"2026-08-12T02:00:00.000;{500_000_000_000 + i * step};1\n")


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
    # NOTE THE ORDER: the BIG file sorts FIRST by name. With the big one last, `max(..., key=_size)`
    # and a mutant picking by name or by list position agree, and the test passes while proving
    # nothing — that is exactly how this survived the first round.
    _write_stream(os.path.join(tmp_path, "Polar_VeritySense_0C301E3F_20260812010000_PPG.txt"), 176.0, rows=4000)
    _write_stream(os.path.join(tmp_path, "Polar_VeritySense_0C301E3F_20260812020000_PPG.txt"), 55.0, rows=300)
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


def test_the_rate_tolerance_bound_is_INCLUSIVE_at_a_bit_exact_boundary(tmp_path):
    """`<=`, not `<`, on an input that lands on the bound EXACTLY in IEEE-754.

    Finding it took a search rather than a guess. `measured_hz` returns 1e9/step for an integer ns
    step, and `_RATE_MISMATCH_TOL * want` rounds onto a different float grid, so almost no pair
    satisfies `abs(measured - want) == 0.10 * want` exactly — 7.2e7 candidates around nine plausible
    rates yielded none. Sweeping the ns step itself found one immediately. Both equalities below are
    asserted, so if a future refactor moves either grid this test FAILS rather than silently
    degrading into the approximate test it is here to replace.
    """
    import nightqc
    step, want = 2007919, 553.3645087830291
    _write_stream_ns(os.path.join(tmp_path, "Polar_VeritySense_0C301E3F_20260812020000_PPG.txt"), step, rows=4000)
    measured = 1e9 / step
    assert abs(measured - want) == nightqc._RATE_MISMATCH_TOL * want, "precondition: exactly on the bound"
    row = nightqc.rate_reality(str(tmp_path), [{"name": "Polar Verity Sense", "device_id": "0C301E3F",
                                                "streams": ["ppg"], "rates": {"ppg": want}}])[0]
    # The row REPORTS `round(got, 2)` but `rate_reality` COMPARES the unrounded `got`. Assert against
    # the rounded value, and keep the unrounded one in the bound check above — conflating the two is
    # what made the first version of this test fail on a correct implementation.
    assert row["measured_hz"] == round(measured, 2), "precondition: the file really measures 1e9/step"
    assert row["matches_config"] is True, "on the bound is INSIDE the bound — the tolerance IS the tolerance"


# ─── the night band: a session is not a night ───────────────────────────────────────────────────

def _ts(y, mo, d, h, mi=0):
    return _dtmod.datetime(y, mo, d, h, mi).timestamp()


def test_either_side_of_one_midnight_is_the_SAME_night():
    """THE property. 22:30 and 02:42 straddling one midnight must land in one band — that is what makes
    this a night rather than a date. If they split, nothing else here matters."""
    a = nightqc.night_band(_ts(2026, 8, 14, 22, 30))
    b = nightqc.night_band(_ts(2026, 8, 15, 2, 42))
    assert a == b, (a, b)


def test_the_band_boundary_is_where_it_claims_to_be():
    """20:00 opens a new band; 19:59 still belongs to the previous evening's."""
    late = nightqc.night_band(_ts(2026, 8, 14, 20, 0))
    early = nightqc.night_band(_ts(2026, 8, 14, 19, 59))
    assert late != early
    assert late[0] == _ts(2026, 8, 14, 20)
    assert early[0] == _ts(2026, 8, 13, 20)
    assert round(late[1] - late[0]) == 14 * 3600          # 20:00 -> 10:00 is 14 h


def test_a_session_wholly_inside_the_band_keeps_all_of_itself():
    files = [{"session": _ts(2026, 8, 15, 2, 42), "span_sec": 3.35 * 3600, "rows": 1000}]
    v = nightqc.night_view((files[0]["session"], files[0]["session"] + 3.35 * 3600), files)
    assert v["row_fraction"] == pytest.approx(1.0)
    assert v["span_sec"] == pytest.approx(3.35 * 3600, abs=2)


def test_a_session_running_through_midday_is_CLIPPED_and_its_rows_apportioned():
    """The defect this exists for: 20.39 h of continuous recording is not a 20.39 h night."""
    s0 = _ts(2026, 8, 15, 10, 1)
    s1 = _ts(2026, 8, 16, 6, 25)
    files = [{"session": s0, "span_sec": s1 - s0, "rows": 1000}]
    v = nightqc.night_view((s0, s1), files)
    assert v["span_sec"] < (s1 - s0) / 1.5, v            # roughly halved, not merely trimmed
    assert 0.0 < v["row_fraction"] < 1.0, v
    assert v["begin"] == round(_ts(2026, 8, 15, 20))     # the evening the night began


def test_a_session_entirely_in_daylight_yields_no_night_rows():
    s0, s1 = _ts(2026, 8, 15, 11), _ts(2026, 8, 15, 16)
    v = nightqc.night_view((s0, s1), [{"session": s0, "span_sec": s1 - s0, "rows": 500}])
    assert v["span_sec"] == 0
    assert v["rows"] == 0 and v["row_fraction"] == pytest.approx(0.0)


def test_night_view_is_None_without_files_rather_than_a_zeroed_record():
    """A zeroed record would read as 'the night captured nothing', which is a different claim."""
    assert nightqc.night_view((0.0, 1.0), []) is None


def test_a_zero_span_file_is_a_POINT_in_time_not_a_division_by_zero():
    inside = _ts(2026, 8, 15, 2)
    outside = _ts(2026, 8, 15, 13)
    v_in = nightqc.night_view((inside, inside + 60), [{"session": inside, "span_sec": 0, "rows": 7}])
    v_out = nightqc.night_view((outside, outside + 60), [{"session": outside, "span_sec": 0, "rows": 7}])
    assert v_in["rows"] == 7
    assert v_out["rows"] == 0


def test_a_file_without_a_session_stamp_is_skipped_not_guessed():
    s0 = _ts(2026, 8, 15, 2)
    v = nightqc.night_view((s0, s0 + 3600), [{"span_sec": 3600, "rows": 9},
                                             {"session": s0, "span_sec": 3600, "rows": 1}])
    assert v["rows"] == 1                                 # only the stamped file contributes


def test_row_fraction_is_None_when_there_are_no_rows_to_take_a_fraction_OF():
    s0 = _ts(2026, 8, 15, 2)
    v = nightqc.night_view((s0, s0 + 3600), [{"session": s0, "span_sec": 3600, "rows": 0}])
    assert v["row_fraction"] is None


def test_overlap_is_zero_for_disjoint_intervals_and_never_negative():
    assert nightqc._overlap(0, 10, 20, 30) == 0
    assert nightqc._overlap(20, 30, 0, 10) == 0
    assert nightqc._overlap(0, 10, 5, 20) == 5


def test_night_window_is_published_WITHOUT_clobbering_the_existing_night_key(tmp_path):
    """Regression for a collision the existing suite caught. `night` was already the folder DATE string
    ("2026-07-19", "incoming"); publishing the band under that name silently replaced it with a dict.
    The two are different facts and both are published."""
    d = tmp_path / "2026-08-15"
    d.mkdir()
    (d / "Polar_H10_02849638_20260815024240_ECG.csv").write_text("h\n" + "r\n" * 400)
    s = nightqc.summarize(str(d), [])
    assert s["night"] == "2026-08-15", s["night"]          # still the folder date, still a string
    assert "night_window" in s
    assert s["night_window"] is None or isinstance(s["night_window"], dict)

# ── Level B survivors handed over by the QC author (#1307's advisory mutation gate). Three clusters,
# ── each a BOUNDARY the existing fixtures step over rather than land on.

def test_span_at_exactly_the_minimum_is_judgeable(tmp_path):
    """`_MIN_SPAN_SEC` is a FLOOR, not a bar to clear.

    `span = span if span >= _MIN_SPAN_SEC else None` — at exactly the floor the span IS judgeable, and
    every existing fixture uses 1000 s, stepping over the boundary rather than landing on it. The `>=`
    -> `>` mutant survives them all: it only changes behaviour for a span of exactly 300 s, which is
    reachable (a 5-minute capture) and turns a real coverage number into `unknown`."""
    night = str(tmp_path / "2026-07-19"); os.makedirs(night)
    base = 1_000_000.0
    ecg = _cap(night, "Polar_H10_02849638_20260719_ECG.txt", 39000)   # 130 Hz x 300 s -> exactly 1.0
    hr = _cap(night, "Polar_H10_02849638_20260719_HR.txt", 300)
    _utime(hr, base)
    _utime(ecg, base + nightqc._MIN_SPAN_SEC)
    s = nightqc.summarize(night, [{"name": "H10", "device_id": "02849638", "streams": ["ecg", "hr"]}])
    assert s["span_sec"] == nightqc._MIN_SPAN_SEC
    h10 = next(d for d in s["devices"] if d["name"] == "H10")
    assert h10["coverage"].get("ecg") == 1.0, f"a span of exactly the floor must be judged: {h10['coverage']}"


def test_coverage_exactly_at_the_degraded_threshold_is_not_degraded(tmp_path):
    """`_DEGRADED_BELOW` is exclusive, and the rounding that feeds it is to 2 dp.

    Two mutants live on this one line pair and both need the SAME fixture to die: `cov < _DEGRADED_BELOW`
    -> `<=` (a stream at exactly the threshold would be flagged), and `round(..., 2)` -> `round(..., 3)`
    (which moves the reported number AND, here, pushes it across the threshold).

    Rows are chosen so the raw ratio is 0.495100 — `round(_, 2)` is 0.5 and NOT degraded, `round(_, 3)`
    is 0.495 and degraded. One fixture, opposite verdicts, so neither mutant can hide."""
    night = str(tmp_path / "2026-07-19"); os.makedirs(night)
    base = 1_000_000.0
    ecg = _cap(night, "Polar_H10_02849638_20260719_ECG.txt", 64363)   # 64363 / (130*1000) = 0.495100
    hr = _cap(night, "Polar_H10_02849638_20260719_HR.txt", 1000)
    _utime(hr, base)
    _utime(ecg, base + 1000)
    s = nightqc.summarize(night, [{"name": "H10", "device_id": "02849638", "streams": ["ecg", "hr"]}])
    assert s["span_sec"] == 1000
    h10 = next(d for d in s["devices"] if d["name"] == "H10")
    assert h10["coverage"]["ecg"] == 0.5, f"2 dp rounding: {h10['coverage']}"
    assert not any("ecg" in g for g in s["degraded"]), f"exactly at the threshold is not below it: {s['degraded']}"


def _cap_timed(night, name, rows, hz, t0_ns=1_000_000_000_000):
    """A capture file carrying REAL device timestamps, so `measured_hz` can read a rate off it.

    `_cap` writes `i;i` rows with no clock, which is fine for row-count coverage but makes the
    measured rate unsayable — `measured_hz` reads the `sensor timestamp [ns]` column deliberately (the
    DEVICE clock, not the host stamp, which is back-timed across each packet)."""
    p = os.path.join(night, name)
    step = int(round(1e9 / hz))
    with open(p, "w") as fh:
        fh.write("Phone timestamp;sensor timestamp [ns];channel 0\n")
        for i in range(rows):
            fh.write(f"2026-07-19T00:00:00.000;{t0_ns + i * step};{i}\n")
    return p


def test_coverage_judges_against_the_MEASURED_rate_not_the_configured_one(tmp_path):
    """A device configured for one rate and delivering another must be judged against what it DID.

    `hz = _measured_hz_of.get((name, s)) or _expected_hz(d, s)` — the measured rate wins, and six
    mutants across the rate-reality path (a null night_dir, null devices, a null key in the
    comprehension, a null device_id, a null lookup key) all collapse to one observable: the measured
    map goes empty and coverage falls back to the CONFIGURED rate.

    The device is configured at 260 Hz and delivers 130. Judged on measured that is full coverage;
    judged on configured it is 50 % and reads degraded — so one fixture separates them and every
    mutant on that path fails it.

    ⚠️ This needs `_cap_timed`, not `_cap`: without a device-clock column the measured rate is
    unsayable, the fallback fires for a legitimate reason, and the test would pass for the wrong one."""
    night = str(tmp_path / "2026-07-19"); os.makedirs(night)
    base = 1_000_000.0
    ecg = _cap_timed(night, "Polar_H10_02849638_20260719_ECG.txt", 130000, 130.0)
    hr = _cap(night, "Polar_H10_02849638_20260719_HR.txt", 1000)
    _utime(hr, base)
    _utime(ecg, base + 1000)
    dev = [{"name": "H10", "device_id": "02849638", "streams": ["ecg", "hr"], "rates": {"ecg": 260}}]
    rr = {(r["device"], r["stream"]): r.get("measured_hz") for r in nightqc.rate_reality(night, dev)}
    assert rr.get(("H10", "ecg")) is not None, f"the fixture must yield a measurable rate: {rr}"
    s = nightqc.summarize(night, dev)
    h10 = next(d for d in s["devices"] if d["name"] == "H10")
    assert h10["coverage"]["ecg"] == 1.0, (
        f"judged against the CONFIGURED 260 Hz this reads 0.5; against the measured 130 Hz it is full: "
        f"{h10['coverage']}")


def test_a_device_without_a_name_is_keyed_by_its_device_id(tmp_path):
    """`name = d.get("name") or did` — a device may carry no name, and then its ID IS its name.

    That fallback is what `_measured_hz_of` is keyed on, so `did = d.get("device_id")` -> `did = None`
    is invisible to every fixture whose devices are named: the name wins and the ID is never consulted.
    A nameless device is the only shape that reaches it, and there the null ID collapses the lookup key
    and coverage silently falls back to the CONFIGURED rate — the same observable as the rest of the
    rate-reality cluster, reached through a different door."""
    night = str(tmp_path / "2026-07-19"); os.makedirs(night)
    base = 1_000_000.0
    ecg = _cap_timed(night, "Polar_H10_02849638_20260719_ECG.txt", 130000, 130.0)
    _utime(ecg, base + 1000)
    hr = _cap(night, "Polar_H10_02849638_20260719_HR.txt", 1000)
    _utime(hr, base)
    dev = [{"device_id": "02849638", "streams": ["ecg", "hr"], "rates": {"ecg": 260}}]   # no "name"
    s = nightqc.summarize(night, dev)
    d0 = s["devices"][0]
    assert d0["name"] == "02849638", f"a nameless device is identified by its ID: {d0['name']}"
    assert d0["coverage"]["ecg"] == 1.0, (
        f"keyed by the ID, the measured 130 Hz is found and coverage is full; with a null ID the key "
        f"collapses and it falls back to the configured 260 Hz: {d0['coverage']}")


# ─── GUM timing-uncertainty budget ──────────────────────────────────────────────────────────────

def test_no_jitter_measurement_makes_the_budget_UNKNOWN_not_small():
    """With no delivery term the total would be the quantum alone and read ~0.3 ms — a confident claim
    about a link whose real jitter is tens of ms. An absent input is not a small one."""
    assert nightqc.timing_uncertainty(None) is None
    assert nightqc.timing_uncertainty({}) is None
    assert nightqc.timing_uncertainty({"iqr_ms": None}) is None


def test_delivery_dominates_a_polar_stream_and_the_quantum_dominates_the_RING():
    """The distinction the literature says a binary flag cannot make: same 'trusted' verdict, different
    limiting term, different fix. Polar -> attack the link; ring -> the 1 s axis IS the floor."""
    polar = nightqc.timing_uncertainty({"iqr_ms": 45.0})
    ring = nightqc.timing_uncertainty({"iqr_ms": 17.0}, quantised=True)
    assert polar["dominant"] == "delivery"
    assert ring["dominant"] == "quantum"
    assert ring["components_ms"]["quantum"] == pytest.approx(1000.0 / math.sqrt(12), abs=1e-3)
    assert polar["components_ms"]["quantum"] == pytest.approx(1.0 / math.sqrt(12), abs=1e-3)  # published rounded to 3 dp


def test_the_delivery_term_is_the_ROBUST_sigma_not_the_raw_iqr():
    u = nightqc.timing_uncertainty({"iqr_ms": 13.49})
    assert u["components_ms"]["delivery"] == pytest.approx(10.0, abs=0.01)   # 13.49 / 1.349


def test_terms_combine_in_QUADRATURE_not_by_addition():
    u = nightqc.timing_uncertainty({"iqr_ms": 1.349}, quantised=True)     # delivery 1.0, quantum 288.675
    d, q = u["components_ms"]["delivery"], u["components_ms"]["quantum"]
    assert u["u_ms"] == pytest.approx(math.sqrt(d * d + q * q), abs=1e-3)
    assert u["u_ms"] < d + q                                              # addition would be larger


def test_the_oscillator_is_reported_BESIDE_the_budget_and_never_inside_it():
    """The first draft folded `adev_min * optimal_tau` into the total and read 173 ms for the H10 where
    the real per-event figure is 34 — a 5x overstatement, because an arrival-stamped event does not ride
    the device clock at all. `free_run` answers a different question and must not move `u_ms`."""
    jit = {"iqr_ms": 45.0}
    stab = {"ok": True, "adev_min": 0.119158, "optimal_tau": 1453.2}
    bare = nightqc.timing_uncertainty(jit)
    with_osc = nightqc.timing_uncertainty(jit, stability=stab, tau_s=1453.2)
    assert with_osc["u_ms"] == bare["u_ms"], "free-run drift must not enter the budget"
    assert "oscillator" not in with_osc["components_ms"]
    assert with_osc["free_run"]["drift_ms"] == pytest.approx(0.119158 * 1453.2, abs=0.01)
    assert with_osc["free_run"]["tau_s"] == pytest.approx(1453.2, abs=0.1)


def test_free_run_needs_a_usable_curve_and_a_tau_or_it_is_None():
    jit = {"iqr_ms": 5.0}
    assert nightqc.timing_uncertainty(jit)["free_run"] is None
    assert nightqc.timing_uncertainty(jit, stability={"ok": False}, tau_s=100)["free_run"] is None
    assert nightqc.timing_uncertainty(jit, stability={"ok": True, "adev_min": 0.1}, tau_s=None)["free_run"] is None
    assert nightqc.timing_uncertainty(jit, stability={"ok": True, "adev_min": 0}, tau_s=100)["free_run"] is None
    assert nightqc.timing_uncertainty(jit, stability="not a dict", tau_s=100)["free_run"] is None


def test_dominant_share_is_a_VARIANCE_share_so_it_says_whether_the_fix_is_worth_it():
    """0.99 means nothing else matters; a middling share means the dominant term is not the story."""
    u = nightqc.timing_uncertainty({"iqr_ms": 1349.0})          # delivery 1000 vs quantum 0.289
    assert u["dominant_share"] > 0.999
    d, q = u["components_ms"]["delivery"], u["components_ms"]["quantum"]
    assert u["dominant_share"] == pytest.approx(d * d / (d * d + q * q), abs=1e-6)


def test_the_budget_reaches_the_per_stream_record(tmp_path):
    """Wired, not merely defined — the defect this repo keeps finding one layer up."""
    d = tmp_path / "2026-08-15"
    d.mkdir()
    (d / "Polar_H10_02849638_20260815024240_ECG.csv").write_text("h\n" + "r\n" * 400)
    rows = nightqc.arrival_quality(str(d))
    assert all("u_time" in r for r in rows), rows


# ── ppg2w_contact — the ring's independent coupling vote ───────────────────────────────────────────
# Constants are labelled MEASURED vs CHOSEN at the definition; these tests plant both populations the
# thresholds were measured on and the refusal paths the block must take instead of fabricating.

def _worn_rows(n_ep, ratio=1.1, ch1=1_500_000):
    ch0 = []
    ch1s = []
    for i in range(n_ep * nightqc._PPG2W_ROWS_PER_EPOCH):
        ch1s.append(ch1 + (i % 7) * 100)          # small texture, well above the floor
        ch0.append(int(ch1s[-1] * ratio))
    return ch0, ch1s


def _off_rows(n_ep):
    # The measured off-finger signature: ch0 rails, ch1 collapses to ~10^2 counts.
    n = n_ep * nightqc._PPG2W_ROWS_PER_EPOCH
    return [3_400_000] * n, [150 + (i % 5) for i in range(n)]


def test_ppg2w_a_worn_night_reports_its_band_and_zero_off_epochs():
    ch0, ch1 = _worn_rows(120, ratio=1.1)
    b = nightqc.ppg2w_contact(ch0, ch1)
    assert b["off_epochs_pct"] == 0.0
    assert b["off_runs_sustained"] == 0
    assert b["tail_off"] is False
    assert abs(b["worn_ratio_median"] - 1.1) < 0.01
    assert b["worn_ratio_iqr"] < 0.01


def test_ppg2w_a_doffed_tail_is_flagged_with_its_run_length():
    w0, w1 = _worn_rows(100)
    o0, o1 = _off_rows(30)
    b = nightqc.ppg2w_contact(w0 + o0, w1 + o1)
    assert b["tail_off"] is True
    assert b["trailing_off_epochs"] == 30
    assert b["off_runs_sustained"] == 1
    assert abs(b["off_epochs_pct"] - 100 * 30 / 130) < 0.1


def test_ppg2w_ratio_out_of_band_is_off_even_with_ch1_above_the_floor():
    # The CHOSEN band is load-bearing on its own: bright but decoupled channels are not "worn".
    ch0, ch1 = _worn_rows(80, ratio=5.0)          # ch1 healthy, ratio far outside [0.5, 3]
    b = nightqc.ppg2w_contact(ch0, ch1)
    assert b["off_epochs_pct"] == 100.0
    assert b["worn_ratio_median"] is None          # nothing qualified as worn…
    assert b["worn_ratio_iqr"] is None             # …so the band is ABSENT, not fabricated from off rows


def test_ppg2w_an_epoch_is_decided_by_its_MAJORITY_not_one_glitch_row():
    ch0, ch1 = _worn_rows(70)
    ch1[500] = 0                                   # one dead row inside an otherwise worn epoch
    b = nightqc.ppg2w_contact(ch0, ch1)
    assert b["off_epochs_pct"] == 0.0


def test_ppg2w_under_a_minute_refuses_rather_than_reporting():
    ch0, ch1 = _worn_rows(nightqc._PPG2W_MIN_EPOCHS - 1)
    assert nightqc.ppg2w_contact(ch0, ch1) is None


def test_ppg2w_quality_walks_a_night_and_keeps_refusals_visible(tmp_path):
    hdr = "Phone timestamp;sensor timestamp [ns];channel 0;channel 1;motion\n"
    worn = tmp_path / "Wellue_O2Ring-S_TEST_20260101000000_PPG2W.txt"
    w0, w1 = _worn_rows(100)
    o0, o1 = _off_rows(30)
    with open(worn, "w") as f:
        f.write(hdr)
        rows = list(zip(w0 + o0, w1 + o1))
        for i, (a, b) in enumerate(rows):
            f.write(f"2026-01-01T00:00:{i % 60:02d}.000;0;{a};{b};0\n")
            if i == 5000:
                f.write(hdr)                       # mid-file repeated header — the rotation artifact
    short = tmp_path / "Wellue_O2Ring-S_TEST_20260101010000_PPG2W.txt"
    with open(short, "w") as f:
        f.write(hdr + "2026-01-01T01:00:00.000;0;100;100;0\n")
    out = nightqc.ppg2w_contact_quality(str(tmp_path))
    assert [b["file"] for b in out] == [worn.name, short.name]
    assert out[0]["usable"] is True
    assert out[0]["tail_off"] is True and out[0]["doff_at"] is not None
    assert out[1]["usable"] is False and "under" in out[1]["reason"]


def test_ppg2w_quality_is_EMPTY_when_the_stream_was_never_captured(tmp_path):
    assert nightqc.ppg2w_contact_quality(str(tmp_path)) == []
    assert nightqc.ppg2w_contact_quality(str(tmp_path / "absent")) == []


def test_ppg2w_a_bad_first_timestamp_yields_doff_at_None_not_a_crash(tmp_path):
    p = tmp_path / "Wellue_O2Ring-S_TEST_20260101000000_PPG2W.txt"
    w0, w1 = _worn_rows(100)
    o0, o1 = _off_rows(30)
    with open(p, "w") as f:
        f.write("Phone timestamp;sensor timestamp [ns];channel 0;channel 1;motion\n")
        for a, b in zip(w0 + o0, w1 + o1):
            f.write(f"notatime;0;{a};{b};0\n")
    out = nightqc.ppg2w_contact_quality(str(tmp_path))
    assert out[0]["tail_off"] is True and out[0]["doff_at"] is None


def test_ppg2w_an_unreadable_entry_is_skipped_not_fatal(tmp_path):
    (tmp_path / "Wellue_O2Ring-S_TEST_20260101000000_PPG2W.txt").mkdir()   # a DIRECTORY with the name
    assert nightqc.ppg2w_contact_quality(str(tmp_path)) == []


def test_ppg2w_an_off_run_that_ENDS_midsession_is_counted_and_is_not_a_doffing():
    # Covers the run-closing branch: worn -> off -> worn. The wearer adjusted the ring and put it back;
    # that is one sustained off-run and NOT a doffing, so tail_off stays False and no doff time exists.
    w0a, w1a = _worn_rows(70)
    o0, o1 = _off_rows(15)
    w0b, w1b = _worn_rows(70)
    b = nightqc.ppg2w_contact(w0a + o0 + w0b, w1a + o1 + w1b)
    assert b["off_runs_sustained"] == 1
    assert b["tail_off"] is False
    assert b["trailing_off_epochs"] == 0


def test_ppg2w_a_truncated_row_is_skipped_like_the_repeated_header(tmp_path):
    p = tmp_path / "Wellue_O2Ring-S_TEST_20260101000000_PPG2W.txt"
    w0, w1 = _worn_rows(70)
    with open(p, "w") as f:
        f.write("Phone timestamp;sensor timestamp [ns];channel 0;channel 1;motion\n")
        for i, (a, b) in enumerate(zip(w0, w1)):
            f.write(f"2026-01-01T00:00:00.000;0;{a};{b};0\n")
            if i == 100:
                f.write("bad;row\n")               # a truncated row — rotation tears mid-line too
    out = nightqc.ppg2w_contact_quality(str(tmp_path))
    assert out[0]["usable"] is True and out[0]["off_epochs_pct"] == 0.0


# ── ring-clock drift summary (O2Ring _rtclog.csv → nightly verdict) ─────────────────────────────────
def _write_rtclog(tmp_path, rows, name="Wellue_O2Ring-S_S8AW2100_20260819220000_rtclog.csv"):
    hdr = "Phone timestamp;event;rtc_offset_s;battery_state;battery_level;battery_raw2;battery_raw3\n"
    p = tmp_path / name
    p.write_text(hdr + "".join(r + "\n" for r in rows), encoding="utf-8")
    return str(p)


def test_rtc_drift_summary_rolls_reads_into_a_verdict(tmp_path):
    p = _write_rtclog(tmp_path, [
        "2026-08-19T22:00:00.000;read;1.0;;;;",
        "2026-08-19T22:00:00.000;push;;;;;",          # push has a blank offset — not counted as a read
        "2026-08-20T05:20:00.000;read;3.4;;;;",
    ])
    r = nightqc.rtc_drift_summary(p)
    assert r["reads"] == 2
    assert r["first_offset_s"] == 1.0 and r["last_offset_s"] == 3.4
    assert r["drift_s"] == 2.4                          # free-run since the last push
    assert r["span_h"] == 7.3
    assert r["pushes"] == 1 and r["resets"] == 0


def test_rtc_drift_summary_counts_a_battery_reset(tmp_path):
    p = _write_rtclog(tmp_path, [
        "2026-08-19T22:00:00.000;read;0.0;;;;",
        "2026-08-20T01:00:00.000;reset-suspect;-151.0;;;;",   # a battery event: offset jumped
    ])
    r = nightqc.rtc_drift_summary(p)
    assert r["resets"] == 1 and r["reads"] == 2          # reset-suspect carries an offset, so it counts
    assert r["drift_s"] == -151.0


def test_rtc_drift_summary_none_when_no_readback(tmp_path):
    # a log with only a push (offset blank) has nothing to summarise
    assert nightqc.rtc_drift_summary(_write_rtclog(tmp_path, ["2026-08-19T22:00:00.000;push;;;;;"])) is None
    assert nightqc.rtc_drift_summary(str(tmp_path / "nonexistent_rtclog.csv")) is None


def test_rtc_drift_summary_survives_a_torn_row(tmp_path):
    p = _write_rtclog(tmp_path, [
        "2026-08-19T22:00:00.000;read;0.5;;;;",
        "truncated",                                     # a torn tail must not crash the roll-up
        "2026-08-19T22:00:00.000;read;notanumber;;;;",   # nor a garbled offset
    ])
    r = nightqc.rtc_drift_summary(p)
    assert r["reads"] == 1


def test_rtc_drift_summary_span_none_on_bad_stamp(tmp_path):
    p = _write_rtclog(tmp_path, [
        "notatimestamp;read;1.0;;;;",
        "alsobad;read;2.0;;;;",
    ])
    r = nightqc.rtc_drift_summary(p)
    assert r["reads"] == 2 and r["span_h"] is None


def test_qc_digest_appends_ring_drift():
    summ = {"night": "2026-08-19", "devices": [
        {"name": "O2Ring", "coverage": {"spo2": 0.98},
         "rtc": {"reads": 3, "drift_s": 2.4, "span_h": 7.3, "resets": 0, "pushes": 1}}]}
    line = nightqc.qc_digest(summ)
    assert "O2Ring 98%" in line and "RTC +2.4s" in line


def test_qc_digest_flags_a_battery_reset():
    summ = {"night": "n", "devices": [
        {"name": "O2Ring", "coverage": {"spo2": 0.9},
         "rtc": {"reads": 2, "drift_s": -151.0, "span_h": 3.0, "resets": 1, "pushes": 0}}]}
    assert "1⚠reset" in nightqc.qc_digest(summ)


def test_qc_digest_omits_rtc_when_absent():
    summ = {"night": "n", "devices": [{"name": "H10", "coverage": {"ecg": 0.99}, "rtc": None}]}
    line = nightqc.qc_digest(summ)
    assert "H10 99%" in line and "RTC" not in line


def test_summarize_attaches_ring_rtc_drift(tmp_path):
    """The discovery path: a `_rtclog.csv` beside the ring's capture files is found by device id and
    rolled into that device's per-device entry — the false branch (no rtclog → rtc None) is already
    covered by every other summarize test."""
    night = str(tmp_path / "2026-07-19"); os.makedirs(night)
    _cap(night, "Wellue_O2Ring-S_S8AW_20260719_SPO2.csv", 900)
    _cap(night, "Wellue_O2Ring-S_S8AW_20260719_PPG.txt", 8000)
    hdr = "Phone timestamp;event;rtc_offset_s;battery_state;battery_level;battery_raw2;battery_raw3\n"
    (tmp_path / "2026-07-19" / "Wellue_O2Ring-S_S8AW_20260719_rtclog.csv").write_text(
        hdr + "2026-07-19T22:00:00.000;read;0.0;;;;\n2026-07-20T05:00:00.000;read;1.0;;;;\n", encoding="utf-8")
    s = nightqc.summarize(night, _devices())
    ring = next(d for d in s["devices"] if d["name"] == "Ring")
    assert ring["rtc"] is not None
    assert ring["rtc"]["reads"] == 2 and ring["rtc"]["drift_s"] == 1.0
    # a non-ring device gets no rtc
    assert all(d["rtc"] is None for d in s["devices"] if d["name"] != "Ring")


def test_dat_timefit_summary_absent_when_paths_missing(tmp_path):
    """FINISHED-WORK-IMPROVEMENTS §B4 — the tool cannot be run without both inputs, so the caller
    must SILENTLY return None (the ordinary case on a phone-captured night or a box without Node)."""
    assert nightqc.dat_timefit_summary("", "") is None
    assert nightqc.dat_timefit_summary(str(tmp_path / "no.dat"), str(tmp_path / "no.csv")) is None


def test_dat_timefit_summary_absent_when_tool_missing(tmp_path):
    """A pointer to a non-existent tool path returns None rather than raising — a box without the
    tool checked in is a fine ordinary case; the digest just omits the .dat fit line."""
    dat = tmp_path / "d.dat"; dat.write_bytes(b"\x00" * 100)
    csv = tmp_path / "s.csv"; csv.write_text("Time,Oxygen Level\n", encoding="utf-8")
    assert nightqc.dat_timefit_summary(str(dat), str(csv), tool_path=str(tmp_path / "no-tool.mjs")) is None


def test_dat_timefit_summary_absent_when_node_missing(tmp_path):
    """A box without a `node` binary on PATH must not crash — subprocess.FileNotFoundError is caught
    by the try/except and the function returns None. Verified by pointing at a definitely-not-a-binary
    path."""
    dat = tmp_path / "d.dat"; dat.write_bytes(b"\x00" * 100)
    csv = tmp_path / "s.csv"; csv.write_text("Time,Oxygen Level\n", encoding="utf-8")
    tool = tmp_path / "fake-tool.mjs"; tool.write_text("//", encoding="utf-8")
    assert nightqc.dat_timefit_summary(str(dat), str(csv),
                                       node_bin=str(tmp_path / "no-such-node"),
                                       tool_path=str(tool)) is None


def test_dat_timefit_summary_parses_a_json_run(tmp_path, monkeypatch):
    """When the subprocess returns exit 0 with parseable JSON, `dat_timefit_summary` returns a trimmed
    verdict — `lag_s` comes off `chosenLagS`, `ok`/`reason`/`agree` are carried through, and the tool's
    own input sizes travel too."""
    import subprocess as _sp
    dat = tmp_path / "d.dat"; dat.write_bytes(b"\x00" * 100)
    csv = tmp_path / "s.csv"; csv.write_text("Time,Oxygen Level\n", encoding="utf-8")
    tool = tmp_path / "fake-tool.mjs"; tool.write_text("//", encoding="utf-8")
    fake = _sp.CompletedProcess(args=[], returncode=0, stdout='{"ok":true,"converged":true,"reason":null,"chosenLagS":37,"agree":true,"datSec":900,"csvSec":900}\n', stderr="")
    monkeypatch.setattr(nightqc.subprocess, "run", lambda *a, **k: fake)
    out = nightqc.dat_timefit_summary(str(dat), str(csv), tool_path=str(tool))
    assert out == {"ok": True, "converged": True, "reason": None, "lag_s": 37, "agree": True, "dat_sec": 900, "csv_sec": 900}


def test_dat_timefit_summary_carries_refusal_reason(tmp_path, monkeypatch):
    """Exit 1 with an `ok:false` JSON is a REFUSAL by the tool — the reason is carried through so a
    caller (qc_digest) can decide whether to surface it."""
    import subprocess as _sp
    dat = tmp_path / "d.dat"; dat.write_bytes(b"\x00" * 100)
    csv = tmp_path / "s.csv"; csv.write_text("Time,Oxygen Level\n", encoding="utf-8")
    tool = tmp_path / "fake-tool.mjs"; tool.write_text("//", encoding="utf-8")
    fake = _sp.CompletedProcess(args=[], returncode=1, stdout='{"ok":false,"reason":"no lag with enough overlap"}\n', stderr="")
    monkeypatch.setattr(nightqc.subprocess, "run", lambda *a, **k: fake)
    out = nightqc.dat_timefit_summary(str(dat), str(csv), tool_path=str(tool))
    assert out is not None and out["ok"] is False and out["reason"].startswith("no lag")


def test_dat_timefit_summary_returns_none_on_a_crash(tmp_path, monkeypatch):
    """A non-{0,1} exit code from the tool is a SHAPE failure (Node crashed, missing runtime dep) —
    the function must swallow that and return None so a broken tool cannot red the digest."""
    import subprocess as _sp
    dat = tmp_path / "d.dat"; dat.write_bytes(b"\x00" * 100)
    csv = tmp_path / "s.csv"; csv.write_text("Time,Oxygen Level\n", encoding="utf-8")
    tool = tmp_path / "fake-tool.mjs"; tool.write_text("//", encoding="utf-8")
    fake = _sp.CompletedProcess(args=[], returncode=139, stdout="", stderr="segfault")
    monkeypatch.setattr(nightqc.subprocess, "run", lambda *a, **k: fake)
    assert nightqc.dat_timefit_summary(str(dat), str(csv), tool_path=str(tool)) is None


def test_dat_timefit_summary_returns_none_on_timeout(tmp_path, monkeypatch):
    """A subprocess timeout is caught — the ordinary case on a huge .dat with a short deadline; the
    digest simply omits the .dat fit line rather than throwing."""
    import subprocess as _sp
    dat = tmp_path / "d.dat"; dat.write_bytes(b"\x00" * 100)
    csv = tmp_path / "s.csv"; csv.write_text("Time,Oxygen Level\n", encoding="utf-8")
    tool = tmp_path / "fake-tool.mjs"; tool.write_text("//", encoding="utf-8")
    def _boom(*a, **k):
        raise _sp.TimeoutExpired(cmd="node", timeout=k.get("timeout", 30))
    monkeypatch.setattr(nightqc.subprocess, "run", _boom)
    assert nightqc.dat_timefit_summary(str(dat), str(csv), tool_path=str(tool)) is None


def test_summarize_attaches_the_dat_fit_when_both_sidecars_land(tmp_path, monkeypatch):
    """The discovery path inside summarize: a `_STORED.dat` (onboard pull) AND a `_SPO2.csv` (live)
    for the same ring → `datfit` attached to that device's entry. `dat_timefit_summary` itself is
    stubbed — the DISCOVERY is under test, and stubbing one level down (subprocess) left the test
    coupled to `../tools/o2ring-dat-timefit.mjs` existing on disk, which is false inside mutmut's
    `mutants/` copy: the default-derivation exists() check returned None before the subprocess stub
    was ever reached, and the mutation gate's baseline run failed on a test that passes everywhere
    else (found via #1929, pre-existing)."""
    night = str(tmp_path / "2026-07-19"); os.makedirs(night)
    _cap(night, "Wellue_O2Ring-S_S8AW_20260719_SPO2.csv", 900)
    (tmp_path / "2026-07-19" / "Wellue_O2Ring-S_S8AW_20260719_STORED.dat").write_bytes(b"\x00" * 100)
    seen = {}
    def _fit(dat_path, spo2_path, **k):
        seen["dat"], seen["spo2"] = dat_path, spo2_path
        return {"ok": True, "lag_s": 3, "agree": True}
    monkeypatch.setattr(nightqc, "dat_timefit_summary", _fit)
    s = nightqc.summarize(night, _devices())
    ring = next(d for d in s["devices"] if d["name"] == "Ring")
    assert ring["datfit"] is not None and ring["datfit"]["ok"] is True and ring["datfit"]["lag_s"] == 3
    # the discovery handed the REAL pair to the fit — both paths, not just a truthy call
    assert seen["dat"].endswith("_STORED.dat") and seen["spo2"].endswith("_SPO2.csv")
    # devices without the pair carry None — the ordinary case is unchanged
    assert all(d["datfit"] is None for d in s["devices"] if d["name"] != "Ring")


def test_dat_timefit_summary_derives_the_default_tool_path(tmp_path, monkeypatch):
    """With `tool_path=None` the function derives `../tools/o2ring-dat-timefit.mjs` relative to
    nightqc.py itself — the checked-in location — and proceeds. Subprocess is stubbed so the test
    exercises the derivation, not Node."""
    import subprocess as _sp
    dat = tmp_path / "d.dat"; dat.write_bytes(b"\x00" * 100)
    csv = tmp_path / "s.csv"; csv.write_text("Time,Oxygen Level\n", encoding="utf-8")
    seen = {}
    def _spy(args, **k):
        seen["tool"] = args[1]
        return _sp.CompletedProcess(args=args, returncode=0, stdout='{"ok":true,"chosenLagS":1}', stderr="")
    monkeypatch.setattr(nightqc.subprocess, "run", _spy)
    # The derivation is under test, not the tool's presence on disk: inside mutmut's `mutants/`
    # copy `../tools/` does not exist, and the pre-stub exists() check would return None before the
    # spy ever ran. exists() is stubbed to pass for every path this test itself created or derives.
    monkeypatch.setattr(nightqc.os.path, "exists", lambda p: True)
    out = nightqc.dat_timefit_summary(str(dat), str(csv))
    assert out is not None and out["ok"] is True
    assert seen["tool"].endswith(os.path.join("tools", "o2ring-dat-timefit.mjs"))


def test_dat_timefit_summary_returns_none_on_unparseable_stdout(tmp_path, monkeypatch):
    """Exit 0 with garbage stdout is a SHAPE failure — trust stdout only when it parses; a truncated
    or interleaved write must not become a half-read verdict."""
    import subprocess as _sp
    dat = tmp_path / "d.dat"; dat.write_bytes(b"\x00" * 100)
    csv = tmp_path / "s.csv"; csv.write_text("Time,Oxygen Level\n", encoding="utf-8")
    tool = tmp_path / "fake-tool.mjs"; tool.write_text("//", encoding="utf-8")
    fake = _sp.CompletedProcess(args=[], returncode=0, stdout="{not json", stderr="")
    monkeypatch.setattr(nightqc.subprocess, "run", lambda *a, **k: fake)
    assert nightqc.dat_timefit_summary(str(dat), str(csv), tool_path=str(tool)) is None


def test_qc_digest_appends_the_dat_fit_line():
    """When a device carries a `datfit` alongside `rtc`, the digest gains a `.dat +Ns` note. On a
    well-behaved night the two agree within the .dat's 1 s quantum — no warning; when they disagree by
    more than that, a `⚠±Ns` flag surfaces on the same line so a reader cannot miss it."""
    # AGREE within 1 s — no warning
    ring_ok = {"name": "Ring", "coverage": {"spo2": 0.99},
               "rtc": {"reads": 3, "drift_s": 2.4, "span_h": 7.3, "resets": 0, "pushes": 1},
               "datfit": {"ok": True, "lag_s": 2, "agree": True}}
    line = nightqc.qc_digest({"night": "n", "devices": [ring_ok]})
    assert ".dat +2s" in line and "⚠" not in line
    # DISAGREE by >1 s — the flag surfaces beside the fit
    ring_bad = {"name": "Ring", "coverage": {"spo2": 0.99},
                "rtc": {"reads": 3, "drift_s": 0.0, "span_h": 7.3, "resets": 0, "pushes": 1},
                "datfit": {"ok": True, "lag_s": 5, "agree": True}}
    line = nightqc.qc_digest({"night": "n", "devices": [ring_bad]})
    assert ".dat +5s" in line and "⚠" in line


def test_qc_digest_dat_fit_without_a_readback_prints_plain():
    """A night can carry the .dat fit WITHOUT an RTC readback (old firmware, or the sidecar predates
    the readback). The fit still prints — it is a measurement on its own — but no disagreement flag
    can be computed, so none appears."""
    ring = {"name": "Ring", "coverage": {"spo2": 0.99}, "rtc": None,
            "datfit": {"ok": True, "lag_s": 4, "agree": True}}
    line = nightqc.qc_digest({"night": "n", "devices": [ring]})
    assert ".dat +4s" in line and "⚠" not in line and "RTC" not in line


def test_qc_digest_suppresses_an_unconverged_fit():
    """The tool's own #1657 rule, applied one level up: `ok` without `converged` is a single-legged
    lag — the two columns did not confirm each other — and printing it as `.dat +Ns` would hand the
    reader a number the tool itself refuses to call a measurement."""
    ring = {"name": "Ring", "coverage": {"spo2": 0.99}, "rtc": None,
            "datfit": {"ok": True, "converged": False, "lag_s": 37, "agree": False}}
    line = nightqc.qc_digest({"night": "n", "devices": [ring]})
    assert ".dat" not in line


def test_qc_digest_trusts_ok_when_converged_is_absent():
    """An OLDER tool (before the converged flag) emits no such key; the parser carries None and the
    digest falls back to trusting `ok` — the pre-#1657 behaviour, rather than silently dropping every
    fit from a box with an older checkout."""
    ring = {"name": "Ring", "coverage": {"spo2": 0.99}, "rtc": None,
            "datfit": {"ok": True, "converged": None, "lag_s": 4, "agree": True}}
    line = nightqc.qc_digest({"night": "n", "devices": [ring]})
    assert ".dat +4s" in line


def test_qc_digest_omits_dat_fit_when_absent():
    """A phone-captured night or a box without Node yields `datfit: None`; the digest must not print
    a hollow `.dat` note."""
    ring = {"name": "Ring", "coverage": {"spo2": 0.99},
            "rtc": {"reads": 3, "drift_s": 2.4, "span_h": 7.3, "resets": 0, "pushes": 1},
            "datfit": None}
    line = nightqc.qc_digest({"night": "n", "devices": [ring]})
    assert ".dat" not in line and "RTC" in line

def test_gap_class_fails_closed_on_every_branch():
    """`_gap_class` is the only thing in this module that can turn a red into a green, so each of its
    branches is pinned directly rather than left to whichever ones `summarize` happens to reach.

    The degenerate-band case is UNREACHABLE through `summarize` — `night_band` always returns a real
    interval — which is exactly why it needs a unit test: an unreachable branch is untested code that
    reads as covered, and this one decides whether an unjudgeable night keeps its gaps."""
    b0, b1 = 1000.0, 2000.0
    assert nightqc._gap_class([[1500, 2500]], b0, b1) == "in-night", "overlapping the band is a hole"
    assert nightqc._gap_class([[2100, 2500]], b0, b1) == "outside-band", "wholly after it is out of scope"
    assert nightqc._gap_class([[0, 500]], b0, b1) == "outside-band", "wholly before it is out of scope"
    # STRADDLING COUNTS AS IN-NIGHT. Part of the excluded capture IS inside the night, so the night
    # has a hole; that the rest of it is not does not make the hole smaller.
    assert nightqc._gap_class([[1900, 2100]], b0, b1) == "in-night", "straddling the edge is still a hole"
    # ⚠️ ANY overlap at all, not "enough" overlap. `> 0` is the whole test and a mutant weakening it to
    # `> 1` survived every assertion above, because they all overlap by 100 s. A sub-second intrusion
    # into the night is still an intrusion — there is no threshold below which a hole stops counting,
    # and inventing one would be exactly the silent green this rule exists to prevent.
    assert nightqc._gap_class([[1999.5, 2500]], b0, b1) == "in-night", "half a second of overlap is overlap"
    assert nightqc._gap_class([[2000.0, 2500]], b0, b1) == "outside-band", "touching the edge is not overlap"
    # ANY overlapping member condemns the whole entry — one out-of-scope session does not launder it.
    assert nightqc._gap_class([[0, 500], [1500, 1600]], b0, b1) == "in-night"
    # A BAND THAT IS NOT A BAND CANNOT GRANT A GREEN. This rule's only power is to relax a verdict, so
    # it must act on positive evidence that the excluded time was outside the night — never on absence.
    assert nightqc._gap_class([[2100, 2500]], 2000.0, 1000.0) == "in-night", "no usable band ⇒ keep the gap"
    assert nightqc._gap_class([[2100, 2500]], 1000.0, 1000.0) == "in-night", "a zero-width band is not a band"


def test_an_in_night_hole_BEFORE_the_judged_half_also_reds(tmp_path):
    """The mirror of the 2026-07-24 case, and it is not redundant with it.

    There the judged (bigger) half came FIRST and the hole sat after it. Here the bigger half comes
    SECOND, so the excluded in-night session sits BEFORE it — a different branch, and one a mutation
    run caught as untested: `gaps_in_night.append(line)` on the earlier-side path could be changed
    freely with the suite still green, because every existing in-night assertion ran on the later side.

    Both halves are inside the night band, so the entry must classify in-night and `ok` must red."""
    from datetime import datetime as _dt
    night = str(tmp_path / "2026-07-24"); os.makedirs(night)
    first = _dt.strptime("20260723213000", "%Y%m%d%H%M%S").timestamp()   # 21:30, the SMALLER half
    after = _dt.strptime("20260724010000", "%Y%m%d%H%M%S").timestamp()   # 01:00, the BIGGER half
    _utime(_cap(night, "Polar_H10_02849638_20260723213000_HR.txt", 3600), first + 3600)
    _utime(_cap(night, "Polar_H10_02849638_20260724010000_HR.txt", 10800), after + 10800)
    devs = [{"name": "H10", "device_id": "02849638", "streams": ["hr"]}]
    s = nightqc.summarize(night, devs)
    assert s["judged_session"]["rows"] == 10800, "the substantive half is judged — the LATER one here"
    assert s["gaps"], "the hole must be named"
    assert "earlier session" in s["gaps"][0], "the exclusion is on the earlier side"
    assert "[in-night]" in s["gaps"][0], "21:30 is inside the band; this is a hole, not a sitting"
    assert s["gaps_in_night"] == s["gaps"], "an earlier in-night hole must reach `ok`, same as a later one"
    assert s["ok"] is False, "half the night was discarded and it still graded green"


def test_pooling_boundary_exactly_at_midnight_pools(tmp_path):
    """`0 <= earliest - midnight < _SESSION_GAP_SEC` — the LOWER bound, pinned at exactly 0.

    A session opening on the stroke of midnight is the canonical cross-midnight case: its other half is
    in yesterday's folder by construction. Mutation found this untested — `0 <=` could become `1 <=` or
    `0 <`, both of which stop pooling a session starting exactly at 00:00:00, and every existing pooling
    test starts strictly after midnight so none of them could see it."""
    from datetime import datetime as _dt
    d21 = str(tmp_path / "2026-07-21"); os.makedirs(d21)
    d22 = str(tmp_path / "2026-07-22"); os.makedirs(d22)
    # ⚠️ YESTERDAY IS DELIBERATELY NON-CONTIGUOUS — it ends at 22:00, two hours before this session
    # opens, well past `_SESSION_GAP_SEC`. That is what makes `_pool` the ONLY thing that can pool it:
    # with `_pool` false the code falls through to `prev_probe_window`, which asks the neighbour and is
    # told no. A contiguous yesterday would be pooled either way, and the first version of this test
    # used one — so it passed under every mutant and killed nothing.
    y = _dt.strptime("20260721200000", "%Y%m%d%H%M%S").timestamp()      # runs 20:00 -> 22:00
    t = _dt.strptime("20260722000000", "%Y%m%d%H%M%S").timestamp()      # EXACTLY midnight
    _utime(_cap(d21, "Polar_H10_02849638_20260721200000_HR.txt", 7200), y + 7200)
    _utime(_cap(d22, "Polar_H10_02849638_20260722000000_HR.txt", 3600), t + 3600)
    s = nightqc.summarize(d22, [{"name": "H10", "device_id": "02849638", "streams": ["hr"]}])
    assert s["searched_dirs"] == ["2026-07-22", "2026-07-21"], "a midnight start pools yesterday unconditionally"
    assert [x["rows"] for x in s["sessions"]] == [7200, 3600], "both sittings are seen once yesterday is in scope"


def test_pooling_boundary_exactly_at_the_gap_does_not_pool(tmp_path):
    """The UPPER bound, pinned at exactly `_SESSION_GAP_SEC`.

    `< _SESSION_GAP_SEC` is a strict inequality: a session opening exactly one gap-width after midnight
    is NOT near-midnight, and pooling it would fuse two unrelated sittings. Mutation found this
    untested too — `<` could become `<=` with every existing test still green.

    ⚠️ The near-midnight test is only a PROXY, and this file records it failing in production on
    2026-07-28 (a reconnect 501 s past the gap put half a night in tomorrow's folder). That is why the
    `prev_probe_window` fallback exists and why the boundary itself has to be exact: the proxy is
    allowed to be wrong, but it must be wrong in a known place."""
    from datetime import datetime as _dt
    d21 = str(tmp_path / "2026-07-21"); os.makedirs(d21)
    d22 = str(tmp_path / "2026-07-22"); os.makedirs(d22)
    y = _dt.strptime("20260721120000", "%Y%m%d%H%M%S").timestamp()      # midday yesterday — unrelated
    t = _dt.strptime("20260722000000", "%Y%m%d%H%M%S").timestamp() + nightqc._SESSION_GAP_SEC
    _utime(_cap(d21, "Polar_H10_02849638_20260721120000_HR.txt", 9999), y + 9999)
    _utime(_cap(d22, "Polar_H10_02849638_20260722010000_HR.txt", 2000), t + 2000)
    s = nightqc.summarize(d22, [{"name": "H10", "device_id": "02849638", "streams": ["hr"]}])
    assert s["searched_dirs"] == ["2026-07-22"], "exactly one gap-width out is NOT near-midnight"
    assert s["devices"][0]["streams"]["hr"] == 2000, "yesterday's unrelated sitting stays excluded"


def test_the_night_band_is_chosen_by_the_sessions_MIDPOINT(tmp_path):
    """Which band a gap is judged against comes from the judged session's MIDPOINT, not either end.

    It only matters for a session straddling 20:00 — the hour `night_band` anchors on — and then it
    matters completely, because the two choices name different nights. A 16:00->22:00 session has its
    midpoint at 19:00 (band: yesterday 20:00 -> today 10:00) and its end at 22:00 (band: today 20:00 ->
    tomorrow 10:00). An excluded 02:00 sitting is INSIDE the first and OUTSIDE the second, so the two
    disagree about whether this night has a hole.

    Mutation found this untested: `(cur[0] + cur[1]) / 2.0` could become `(cur[1] + cur[1]) / 2.0` —
    silently judging against tomorrow's band — with the whole suite green."""
    from datetime import datetime as _dt
    night = str(tmp_path / "2026-07-22"); os.makedirs(night)
    early = _dt.strptime("20260722020000", "%Y%m%d%H%M%S").timestamp()   # 02:00, the SMALL half
    main = _dt.strptime("20260722160000", "%Y%m%d%H%M%S").timestamp()    # 16:00 -> 22:00, straddles 20:00
    _utime(_cap(night, "Polar_H10_02849638_20260722020000_HR.txt", 1800), early + 1800)
    _utime(_cap(night, "Polar_H10_02849638_20260722160000_HR.txt", 21600), main + 21600)
    s = nightqc.summarize(night, [{"name": "H10", "device_id": "02849638", "streams": ["hr"]}])
    assert s["judged_session"]["rows"] == 21600, "the straddling session is the substantive one"
    assert s["gaps"], "the 02:00 sitting is excluded and must be reported"
    # 02:00 lies inside the MIDPOINT's band and outside the END's. The midpoint is correct: the session
    # began at 16:00, so the night it belongs to is the one that opened at 20:00 YESTERDAY.
    assert "[in-night]" in s["gaps"][0], "judged against the midpoint's band, 02:00 is a hole"
    assert s["ok"] is False, "a hole in the judged night cannot grade green"
