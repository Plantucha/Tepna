# tepna-capture — tests/test_qc_judged_session.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`nightqc.summarize` must judge the SUBSTANTIVE session, not the most recent one.

It used to pick `max(sessions, key=lambda s: s[1])` — the session reaching the latest write — because QC
runs in the morning, so the newest session IS the night. True while the box recorded only at night; false
once it recorded continuously, and silently so: a later DAYTIME session becomes "current" and the whole
night is reported as an excluded gap.

Measured 2026-08-15, the day a Verity sat streaming noise in its charger all morning:

    02:42->06:03   2 977 473 rows   <- the night
    10:01->12:12   1 716 348 rows   <- JUDGED, and it was the charger

H10 and O2Ring were absent from the morning session, so QC called them `missing` and returned ok=false.
It judged the garbage and reported the night as a hole — which is why `ok` was false on 20 of the last 20
nights, and why the alarm could not have told anyone about the charger: it says the same thing every night.
"""
import os
import sys
from datetime import datetime as _dt

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import nightqc  # noqa: E402

_DEV = [{"name": "Polar H10 02849638", "vendor": "Polar", "streams": ["ecg"],
         "address": "AA:BB:CC:DD:EE:FF"}]


def _rows(d, name, rows, mtime):
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, name)
    with open(p, "w") as fh:
        fh.write("Phone timestamp;sensor timestamp [ns];timestamp [ms];ecg [uV]\n")
        for i in range(rows):
            fh.write(f"2026-08-15T02:4{i % 10}:0{i % 10};{i};0.0;{i}\n")
    os.utime(p, (mtime, mtime))
    return p


def _two_sessions(tmp_path, night_rows, later_rows):
    """A big night session, then a small later one — the 2026-08-15 shape.

    ⚠️ MTIMES ARE ABSOLUTE AND DERIVED FROM THE FILENAMES, never from `time.time()`. The first version
    stamped them `now - 6h` and `now - 60s` while the filenames said 02:42 and 10:01 — two clocks that
    drift apart as the day advances. `merge_sessions` reads both, so whether the fixture produced ONE
    session or TWO depended on the hour the suite happened to run: it passed at noon and failed at 15:16,
    with the two sessions merged into one 4200-row block. A fixture whose meaning changes with wall-clock
    time is not a fixture. `test_nightqc.py` already used absolute stamps; this now matches it."""
    d = str(tmp_path / "2026-08-15")
    night = _dt.strptime("20260815024240", "%Y%m%d%H%M%S").timestamp()
    later = _dt.strptime("20260815100132", "%Y%m%d%H%M%S").timestamp()
    _rows(d, "Polar_H10_02849638_20260815024240_ECG.txt", night_rows, night + 3 * 3600)
    _rows(d, "Polar_VeritySense_0C301E3F_20260815100132_PPG.txt", later_rows, later + 600)
    return d


def test_THE_BIGGER_SESSION_IS_JUDGED_even_though_it_is_older(tmp_path):
    """The regression. The later session is newer; the night has more rows and must win."""
    d = _two_sessions(tmp_path, night_rows=4000, later_rows=200)
    r = nightqc.summarize(d, _DEV)
    js = r["judged_session"]
    assert js is not None, "the judged session must be reported, not implied"
    assert js["rows"] == 4000, f"judged the wrong session: {js}"


def test_the_LATEST_session_would_have_been_the_wrong_one(tmp_path):
    """The counterfactual, so the test above cannot pass for an unrelated reason: under the old rule the
    small, newer session wins on end-time and would have been judged."""
    d = _two_sessions(tmp_path, night_rows=4000, later_rows=200)
    r = nightqc.summarize(d, _DEV)
    sessions = r["sessions"]
    assert len(sessions) >= 2, "the fixture must actually produce two sessions"
    latest = max(sessions, key=lambda s: s["end"])
    assert latest["rows"] != r["judged_session"]["rows"], (
        "latest and substantive coincide here, so this fixture cannot distinguish the rules")


def test_a_single_session_day_is_unchanged(tmp_path):
    d = str(tmp_path / "2026-08-15")
    night = _dt.strptime("20260815024240", "%Y%m%d%H%M%S").timestamp()
    _rows(d, "Polar_H10_02849638_20260815024240_ECG.txt", 4000, night + 3 * 3600)
    r = nightqc.summarize(d, _DEV)
    assert r["judged_session"]["rows"] == 4000


def test_ties_break_toward_the_LATER_session(tmp_path):
    """Preserves the old behaviour where rows cannot discriminate — the days the rule was written for."""
    d = _two_sessions(tmp_path, night_rows=1000, later_rows=1000)
    r = nightqc.summarize(d, _DEV)
    sessions = r["sessions"]
    latest = max(sessions, key=lambda s: s["end"])
    assert r["judged_session"]["end"] == latest["end"]


def test_no_data_reports_no_judged_session(tmp_path):
    d = str(tmp_path / "2026-08-15")
    os.makedirs(d, exist_ok=True)
    r = nightqc.summarize(d, _DEV)
    assert r["judged_session"] is None, "a verdict with no ground must not claim one"
