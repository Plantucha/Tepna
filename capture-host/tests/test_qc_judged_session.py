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

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import nightqc  # noqa: E402
import datetime as _wrapdt


# ── THESE FIXTURES DECLARE THEIR FRAME RATHER THAN HAVING IT INFERRED ──────────────────────────────────
#
# They build a file's start from a floating civil stamp and its mtime from `.timestamp()`, so the two are
# already in ONE frame — the reader's — by construction. `nightqc.summarize` otherwise RECOVERS the
# writer's UTC offset from the files (`recover_writer_offset`), and a synthetic file carrying no usable
# clock casts no vote, so the night refuses and publishes no span: a failure the fixture invented rather
# than one the behaviour under test is about.
#
# Declaring it states the premise instead of making the module re-derive it from invented file contents,
# and it is PUBLISHED as `basis: "declared"` so a reader can never mistake it for a measurement. The tests
# that exercise the recovery and the refusal themselves call `nightqc.summarize` / `timeline.build`
# directly and must keep doing so.
def _declared_reader_frame(night):
    """`declared_offset(...)` for the reader's own UTC offset at this night — the frame these fixtures
    build in. Read off a real filename stamp rather than from `time.timezone`, so it is the offset in
    force ON THAT DATE and a fixture dated across a DST boundary stays correct."""
    for f in nightqc.scan_night(night):
        if f.get("session") is None:
            continue
        stamp = f["file"].split("_")[-2]
        try:
            absolute = _wrapdt.datetime.strptime(stamp, "%Y%m%d%H%M%S").timestamp()
        except ValueError:
            continue  # not a 14-digit stamp — try the next file; a legacy name states no frame
        return nightqc.declared_offset(absolute - f["session"])
    return nightqc.declared_offset(0.0)


def _summarize(night, devices, wear=None):
    return nightqc.summarize(night, devices, wear, writer_offset=_declared_reader_frame(night))


_DEV = [{"name": "Polar H10 02849638", "vendor": "Polar", "streams": ["ecg"], "address": "AA:BB:CC:DD:EE:FF"}]


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
        "latest and substantive coincide here, so this fixture cannot distinguish the rules"
    )


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


# ── the gap must name the NEAREST session, not just some session ────────────────────────────────────
# ⚠️ THE MUTATION GATE FOUND THIS, and lint could not. With only one session on each side, `max(before,
# key=lambda s: s[1])` and `min(after, key=lambda s: s[0])` are indistinguishable from `key=None` — a
# one-element max returns that element whatever it is keyed on. Every such mutant SURVIVED, so the tests
# proved the gap was reported and said nothing about whether the right session was named. These fixtures
# put several sessions on each side so the key function has work to do.
def _many_sessions(tmp_path):
    """Three earlier sessions, the judged one, and two later — all absolute, none derived from now()."""
    d = str(tmp_path / "2026-08-15")

    def at(hhmmss, rows, name):
        t = _dt.strptime("20260815" + hhmmss, "%Y%m%d%H%M%S").timestamp()
        _rows(d, name, rows, t + 900)
        return t

    at("000500", 50, "Polar_H10_02849638_20260815000500_ECG.txt")  # earliest
    at("020000", 60, "Polar_H10_02849638_20260815020000_ECG.txt")
    at("040000", 70, "Polar_H10_02849638_20260815040000_ECG.txt")  # NEAREST earlier
    at("080000", 900, "Polar_H10_02849638_20260815080000_ECG.txt")  # judged (most rows)
    at("120000", 80, "Polar_H10_02849638_20260815120000_ECG.txt")  # NEAREST later
    at("180000", 90, "Polar_H10_02849638_20260815180000_ECG.txt")  # furthest later
    return d


def _many_earlier_sessions_OUTSIDE_the_band(tmp_path):
    """Three earlier sessions and the judged one, with every earlier session OUTSIDE the night band.

    ⚠️ WHY THE EARLIER SIDE NEEDED ITS OWN FIXTURE, 2026-10-12. `_many_sessions` puts its three earlier
    sessions inside the judged night's band, and an in-night session now JOINS the judgement rather
    than being excluded from it — so `before` comes back empty there and `max(before, key=...)` is
    never reached. The mutant that line carries is only killable over an EXCLUDED population of more
    than one, which is what this fixture builds: the judged run opens exactly on `_NIGHT_BEGIN_H`, so
    everything earlier lies before the band and stays out on the evidence."""
    d = str(tmp_path / "2026-08-15")

    def at(hhmmss, rows, name):
        t = _dt.strptime("20260815" + hhmmss, "%Y%m%d%H%M%S").timestamp()
        _rows(d, name, rows, t + 900)
        return t

    at("103000", 50, "Polar_H10_02849638_20260815103000_ECG.txt")  # earliest
    at("120000", 60, "Polar_H10_02849638_20260815120000_ECG.txt")
    at("140000", 70, "Polar_H10_02849638_20260815140000_ECG.txt")  # NEAREST earlier
    at("180000", 900, "Polar_H10_02849638_20260815180000_ECG.txt")  # judged, on the band's own edge
    return d


def test_the_earlier_gap_is_measured_to_the_NEAREST_earlier_session(tmp_path):
    r = _summarize(_many_earlier_sessions_OUTSIDE_the_band(tmp_path), _DEV)
    earlier = [g for g in r["gaps"] if "earlier session" in g]
    assert earlier, f"an earlier gap must be reported: {r['gaps']}"
    # 14:00 session ends ~14:15; judged starts 18:00 -> 225 min. Keyed on the WRONG session it would be
    # ~450 min (from 10:30) — so the number itself distinguishes right from wrong.
    assert "225min" in earlier[0] or "224min" in earlier[0], earlier[0]
    assert "3 earlier session(s)" in earlier[0] and "180 rows" in earlier[0], earlier[0]
    assert "[outside-band]" in earlier[0], (earlier[0], "before the band opens is outside it")


def test_the_three_earlier_IN_NIGHT_sessions_JOIN_the_judgement(tmp_path):
    """The other half of the 2026-10-12 join, on the fixture that used to exclude them.

    `_many_sessions` holds its three earlier sessions inside the judged band, so each one is counted
    in and the hole before it is published. The two later sessions sit past the band's close and stay
    excluded — one fixture, both outcomes."""
    r = _summarize(_many_sessions(tmp_path), _DEV)
    assert r["sessions_judged"] == 4, (r["sessions_judged"], "the judged run plus its three in-night neighbours")
    assert [g for g in r["gaps"] if "earlier session" in g] == [], "an in-night session is joined, not excluded"
    assert len(r["joined_gaps"]) == 3, r["joined_gaps"]
    assert "04:15->08:00 225min gap" in r["joined_gaps"][-1], r["joined_gaps"][-1]
    # THE TOTAL, NOT THE LAST ONE. `night_gap_min` sums every hole inside the judged night —
    # 00:20->02:00 (100 min) + 02:15->04:00 (105 min) + 04:15->08:00 (225 min). Asserting only the
    # count and the text of one line leaves `_joined_gap_sec += …` indistinguishable from `=`, which
    # publishes the LAST hole as the night's whole gap and shortens the span by the other two
    # (mutant nightqc.x_summarize__mutmut_211).
    assert r["night_gap_min"] == 430, (r["night_gap_min"], "100 + 105 + 225, every hole and not the last")
    assert r["gaps_in_night"] == [], "a joined session is no longer a hole left out of the night"
    later = [g for g in r["gaps"] if "later session" in g]
    assert len(later) == 1 and "[outside-band]" in later[0], later


def _a_zero_length_session_opens_the_night(tmp_path):
    """A stampless file two hours before the judged run, which is a session of ZERO length.

    `file_interval` places a file carrying no start stamp at its own last write, so its session starts
    and ends on the same instant (`test_an_UNSTAMPED_file_is_placed_at_its_mtime_…`). Two hours apart,
    so `merge_sessions` keeps the two separate."""
    d = str(tmp_path / "2026-08-15")
    zero = _dt.strptime("20260815000000", "%Y%m%d%H%M%S").timestamp()
    judged = _dt.strptime("20260815020000", "%Y%m%d%H%M%S").timestamp()
    _rows(d, "Polar_H10_02849638_20260815020000_ECG.txt", 900, judged + 900)
    _rows(d, "Polar_H10_02849638_ECG.txt", 30, zero)
    return d


def test_a_ZERO_LENGTH_session_inside_the_band_cannot_join_BUT_IS_A_HOLE_IN_THE_NIGHT(tmp_path):
    """The join's one asymmetric edge, and the two opposite powers that meet on it.

    The stampless 00:00 opener is a session of zero length sitting an hour and a half INSIDE the band
    it is tested against, and `_overlap` scores it 0.0 against every band. Each caller now reads its
    own rule, in its own conservative direction (residue
    `2026-10-12-a-zero-length-session-inside-the-band-reads-outside-band`):

    * `_overlaps_band` decides the JOIN, which absorbs a session and the hole before it into the
      judged night. It acts on measured overlap only, so a point never joins — `sessions_judged`
      stays 1 and the 120 min hole is not taken into the night's span.
    * `_gap_class` decides the LABEL, whose only power is to turn a red into a labelled green. It
      places a point by containment, the idiom `night_view` already uses, so a point inside the band
      reads `in-night` and the night carries the hole. `outside-band` here was a green resting on
      evidence the overlap never gathered.

    It also settles the `excluded` set's own geometry: a session can only JOIN with a positive length,
    so a joined session's end is strictly after `_judged_start` and its start strictly before
    `_cur_end`. Neither the `before` nor the `after` test can ever hold for one — which is why the two
    `excluded` identity mutants (251, 253) have no distinguishing input and are recorded in
    `tools/mutate-equivalence.json` rather than killed here."""
    r = _summarize(_a_zero_length_session_opens_the_night(tmp_path), _DEV)
    assert r["sessions_judged"] == 1, (r["sessions_judged"], "a point has no overlap, so it cannot join")
    assert r["joined_gaps"] == [] and r["night_gap_min"] == 0, r
    earlier = [g for g in r["gaps"] if "earlier session" in g]
    assert len(earlier) == 1, r["gaps"]
    assert "00:00->02:00 120min gap" in earlier[0], earlier[0]
    assert "[in-night]" in earlier[0], (earlier[0], "a point inside the band is placed by containment")
    assert r["gaps_in_night"] == earlier, "and the night carries it: the label cannot grant an unmeasured green"


def test_a_ZERO_WIDTH_BAND_JOINS_NOTHING_and_keeps_every_exclusion(tmp_path, monkeypatch):
    """A band that is not a band grants no join, and `_overlaps_band` is what makes that true.

    The band's width is `24 - _NIGHT_BEGIN_H + _NIGHT_END_H` hours, so `BEGIN = 24` with `END = 0`
    collapses it to a single instant. That is unreachable through today's constants, which is exactly
    why it is pinned here: the join is the module's one power to absorb a session AND the hole before
    it into the judged night, and it may act only on positive evidence that the session was in the
    night.

    `_overlaps_band` reads `_overlap(...) > 0`, and `_overlap` of a zero-width band is 0.0 for every
    session, including one containing the instant. So the three in-night neighbours that join under
    the real band stay excluded here, the judged night keeps its own span, and every gap stays a gap.
    The same fixture joins three sessions one test above; the only thing changed is the band."""
    monkeypatch.setattr(nightqc, "_NIGHT_BEGIN_H", 24)
    monkeypatch.setattr(nightqc, "_NIGHT_END_H", 0)
    night = _many_sessions(tmp_path)
    b0, b1 = nightqc.night_band(_dt.strptime("20260815080000", "%Y%m%d%H%M%S").timestamp())
    assert b1 == b0, (b0, b1, "the premise: the fixture's own band is a single instant")
    r = _summarize(night, _DEV)
    assert r["sessions_judged"] == 1, (r["sessions_judged"], "an unusable band is no evidence of a join")
    assert r["joined_gaps"] == [] and r["night_gap_min"] == 0, r
    # AND THE LABEL FAILS CLOSED THE OTHER WAY. `_gap_class` keeps every exclusion in the night, so
    # the night reports its holes rather than laundering them as out of scope.
    assert [g for g in r["gaps"] if "earlier session" in g], r["gaps"]
    assert r["gaps_in_night"] == r["gaps"], (r["gaps_in_night"], "no usable band ⇒ keep the gaps")


def test_the_later_gap_is_measured_to_the_NEAREST_later_session(tmp_path):
    r = _summarize(_many_sessions(tmp_path), _DEV)
    later = [g for g in r["gaps"] if "later session" in g]
    assert later, f"a later gap must be reported: {r['gaps']}"
    # judged ends ~08:15; nearest later starts 12:00 -> ~225 min. The furthest would be ~585.
    assert "225min" in later[0] or "224min" in later[0], later[0]


def test_every_excluded_session_is_counted_on_its_own_side(tmp_path):
    r = nightqc.summarize(_many_sessions(tmp_path), _DEV)
    earlier = [g for g in r["gaps"] if "earlier session" in g][0]
    later = [g for g in r["gaps"] if "later session" in g][0]
    assert "3 earlier session(s)" in earlier, earlier
    assert "2 later session(s)" in later, later
    assert "180 rows" in earlier, earlier  # 50 + 60 + 70
    assert "170 rows" in later, later  # 80 + 90


# ── AN EMPTY JOINED SESSION IS A HOLE, NOT CAPTURE TIME ─────────────────────────────────────────────
#
# The join absorbs an in-band session AND the hole before it into the judged night, then subtracts the
# holes BETWEEN the joined sessions. A session that recorded nothing is not a hole between two
# sessions, so nothing subtracted it and its whole duration stayed in the coverage denominator.
#
# MEASURED 2026-11-03, read-only, over the box's own 102 `QC-SUMMARY.json` files: 23 carry
# `sessions_judged` and can be replayed, and 18 of the 21 multi-session nights among them are inflated.
# Two nights published a span over twice their own recording. The shape is an evening of daemon
# restarts before anyone puts a sensor on.
def _an_empty_session_joins_the_night(tmp_path, early_rows=0, lock_early=False, judged_rows=900):
    """An in-band early session, then the judged one — absolute stamps, never derived from now().

    The early session runs 02:00->02:40 and the judged 04:00->04:15, so the gap between them is 80 min
    (over `_SESSION_GAP_SEC`, so they stay two sessions) and the judged midpoint puts both inside one
    band. The arithmetic the tests below read is therefore fixed by the fixture: the envelope is 135
    min, the hole between is 80, and the early session's own duration is 40."""
    d = str(tmp_path / "2026-08-15")
    early = _dt.strptime("20260815020000", "%Y%m%d%H%M%S").timestamp()
    judged = _dt.strptime("20260815040000", "%Y%m%d%H%M%S").timestamp()
    _rows(d, "Polar_H10_02849638_20260815020000_ECG.txt", early_rows, early + 2400)
    if lock_early:
        # A SESSION HOLDING AN UNREADABLE FILE BESIDE AN EMPTY ONE. Both halves are needed: the
        # unreadable file is what makes the session's rows UNKNOWN, and the zero-row file beside it is
        # what makes `known_rows` sum to 0 anyway — which is the input that tells a predicate reading
        # DEMONSTRATED emptiness apart from one reading the sum.
        locked = _rows(d, "Polar_VeritySense_0C301E3F_20260815020000_PPG.txt", 7, early + 2400)
        os.chmod(locked, 0)
    _rows(d, "Polar_H10_02849638_20260815040000_ECG.txt", judged_rows, judged + 900)
    return d


def test_AN_EMPTY_JOINED_SESSION_LEAVES_THE_COVERAGE_SPAN(tmp_path):
    """The defect. 135 min envelope − 80 min hole = 55 min published, over a night that recorded 15.

    Residue `2026-11-03-an-empty-daemon-session-stretches-the-coverage-span`. The early session held a
    header and no rows, so it contributed nothing to any numerator while 40 of those 55 minutes were
    its own duration — and every device on the night was then graded against a denominator 3.7x its
    own recording."""
    r = _summarize(_an_empty_session_joins_the_night(tmp_path), _DEV)
    assert r["sessions_judged"] == 2, (r["sessions_judged"], "the premise: the empty session joins")
    assert r["span_sec"] == 900, (r["span_sec"], "the judged session's own 15 min, and nothing else")
    assert r["span_reason"] is None, r["span_reason"]
    assert len(r["empty_joined"]) == 1, r["empty_joined"]
    line = r["empty_joined"][0]
    assert "40min empty session" in line, line
    assert "1 file(s), 0 rows" in line, line
    assert "[in-night empty]" in line, line
    assert line in r["gaps"], (r["gaps"], "a reader of `gaps` alone must see it too")
    # Its minutes join the hole total, because that is the one number for time inside the judged
    # window that nobody was recording in: 80 min of gap plus 40 of empty session.
    assert r["night_gap_min"] == 120, r["night_gap_min"]


def test_the_empty_session_is_a_HOLE_and_not_an_EXCLUSION(tmp_path):
    """The remedy's shape, and why it is not the one the row proposed.

    The row proposed that a session recording nothing not join at all. It would have fixed the span and
    broken something else: an excluded in-night session writes `gaps_in_night`, and `ok` reads that
    list, so every night with a daemon restart before donning would have gone red for a session nobody
    was wearing a sensor during. Charging the minutes to the hole total keeps the session in the night,
    leaves `ok` answering the question it states, and corrects the denominator."""
    r = _summarize(_an_empty_session_joins_the_night(tmp_path), _DEV)
    assert r["gaps_in_night"] == [], (r["gaps_in_night"], "nothing was excluded, so nothing is red")
    assert r["joined_gaps"] and "[in-night joined]" in r["joined_gaps"][0], r["joined_gaps"]
    assert r["empty_joined"][0] not in r["joined_gaps"], "a hole between sessions is different news"
    assert len(r["sessions"]) == 2 and any(s["rows"] == 0 for s in r["sessions"]), r["sessions"]


def test_CONTROL_a_joined_session_WITH_rows_keeps_its_duration_in_the_span(tmp_path):
    """The ordinary case is untouched, and this is the fixture that proves the fix is not just a
    narrower span for everyone: the same geometry with 60 rows in the early session publishes the old
    55 min, because those 40 minutes WERE capture time."""
    r = _summarize(_an_empty_session_joins_the_night(tmp_path, early_rows=60), _DEV)
    assert r["sessions_judged"] == 2, r["sessions_judged"]
    assert r["span_sec"] == 3300, (r["span_sec"], "135 min envelope minus the 80 min hole")
    assert r["empty_joined"] == [], r["empty_joined"]
    assert r["night_gap_min"] == 80, r["night_gap_min"]


def test_a_joined_session_whose_rows_are_UNKNOWN_KEEPS_its_duration(tmp_path):
    """∅ UNKNOWN IS NOT ZERO, on the side that costs us the span rather than the side that is convenient.

    The early session holds one unreadable file and one that recorded nothing, so `known_rows` sums to
    0 while the honest answer is that nobody knows what the session held. Subtracting its duration
    would narrow the denominator — raising every coverage figure — on the strength of files nothing
    could read. So it keeps its 40 minutes and the night keeps whatever shortfall that produces."""
    night = _an_empty_session_joins_the_night(tmp_path, lock_early=True)
    locked = os.path.join(night, "Polar_VeritySense_0C301E3F_20260815020000_PPG.txt")
    try:
        r = _summarize(night, _DEV)
        assert r["unreadable_files"] == [os.path.basename(locked)], r["unreadable_files"]
        assert r["sessions_judged"] == 2, r["sessions_judged"]
        assert r["span_sec"] == 3300, (r["span_sec"], "the wide span stands where the rows are unknown")
        assert r["empty_joined"] == [], (r["empty_joined"], "an unknown session is not a demonstrated one")
    finally:
        os.chmod(locked, 0o644)


def test_a_window_whose_EVERY_session_recorded_nothing_refuses_with_its_OWN_reason(tmp_path):
    """∅ A borrowed reason is a wrong one. Every judged session is a hole here, so the arithmetic lands
    on exactly 0 and the floor would have called it "under the minimum judgeable span" — a true
    statement about the floor standing in for the fact, which is that the window is empty, not short."""
    r = _summarize(_an_empty_session_joins_the_night(tmp_path, judged_rows=0), _DEV)
    assert r["sessions_judged"] == 2, r["sessions_judged"]
    assert r["span_sec"] is None, r["span_sec"]
    assert r["span_reason"] == "no joined session recorded a readable row", r["span_reason"]
    assert len(r["empty_joined"]) == 2, r["empty_joined"]


# The device list the two tests below need, and the reason it is not `_DEV`: attribution is a device_id
# FIELD comparison (`writers.file_device_id`), so a record carrying no `device_id` claims no file and
# every per-device figure stays null. `_DEV` is left as it is deliberately — the tests above read the
# NIGHT's numbers, and lighting up the device path there would change what they measure.
_DEV_ATTRIBUTED = [
    {
        "name": "Polar H10 02849638",
        "vendor": "Polar",
        "model": "H10",
        "device_id": "02849638",
        "streams": ["ecg"],
        "address": "AA:BB:CC:DD:EE:FF",
    }
]

#: The empty session's own published line, asserted whole. Its ENDS were the part no test read, and they
#: are what names the minutes being discounted — a line reading `04:15->04:15` for a 15 min hole is the
#: same arithmetic reported against the wrong window.
_TRAILING_EMPTY_LINE = (
    "04:00->04:15 15min empty session; 1 file(s), 0 rows, not charged to the night's coverage [in-night empty]"
)


def _an_empty_session_TRAILS_the_night(tmp_path, late_rows=0):
    """The mirror of the fixture above: the empty session arrives AFTER the judged one.

    Order is load-bearing for `stopped_early_s`, which measures from this device's last write to the end
    of the judged window. An empty session BEFORE the device started sits outside that window; one after
    it stopped sits inside it, and is the shape that charges a device idle minutes as an early stop."""
    d = str(tmp_path / "2026-08-15")
    judged = _dt.strptime("20260815020000", "%Y%m%d%H%M%S").timestamp()
    late = _dt.strptime("20260815040000", "%Y%m%d%H%M%S").timestamp()
    _rows(d, "Polar_H10_02849638_20260815020000_ECG.txt", 900, judged + 2400)
    _rows(d, "Polar_VeritySense_0C301E3F_20260815040000_PPG.txt", late_rows, late + 900)
    return d


def test_an_empty_TRAILING_session_is_NOT_an_EARLY_STOP_for_the_device(tmp_path):
    """The H10 wrote its last row at 02:40 and the judged window ends at 04:15. Every second between the
    two is a hole — 80 min of gap, then 15 min of empty session — so the honest figure is 0.

    Only the Polar H10 is configured, so the empty file belongs to another device and `_dev_end` stays at
    the H10's own last write. That is what makes the subtraction observable from outside."""
    r = _summarize(_an_empty_session_TRAILS_the_night(tmp_path), _DEV_ATTRIBUTED)
    assert r["sessions_judged"] == 2, (r["sessions_judged"], "the premise: the empty session joins")
    assert r["empty_joined"] == [_TRAILING_EMPTY_LINE], r["empty_joined"]
    assert r["devices"][0]["streams"] == {"ecg": 900}, "the premise: the H10's file is attributed to it"
    assert r["devices"][0]["stopped_early_s"] == 0, r["devices"][0]["stopped_early_s"]


def test_CONTROL_a_TRAILING_session_WITH_rows_IS_a_real_early_stop(tmp_path):
    """The same night, the same clocks, 60 rows in the late session. Those 15 minutes are now time the
    box really was recording, so the H10 did stop early and the figure must say so. Without this leg a
    `stopped_early_s` hard-wired to 0 would pass the test above."""
    r = _summarize(_an_empty_session_TRAILS_the_night(tmp_path, late_rows=60), _DEV_ATTRIBUTED)
    assert r["empty_joined"] == [], r["empty_joined"]
    assert r["devices"][0]["stopped_early_s"] == 900, r["devices"][0]["stopped_early_s"]


def test_recorded_nothing_reads_DEMONSTRATED_emptiness_and_not_a_zero_sum():
    """The predicate, on its own terms. `known_rows` leaves an unreadable file out rather than counting
    it as zero, so a group whose files could not be read SUMS to 0 — and the one thing this must never
    do is read that sum as "recorded nothing"."""
    assert nightqc.recorded_nothing([{"rows": 0}]) is True
    assert nightqc.recorded_nothing([{"rows": 0}, {"rows": 0}]) is True
    assert nightqc.recorded_nothing([{"rows": 1}]) is False
    assert nightqc.recorded_nothing([{"rows": None}]) is False, "unknown, never zero"
    assert nightqc.recorded_nothing([{"rows": None}, {"rows": 0}]) is False, "a zero sum is not evidence"
    assert nightqc.recorded_nothing([{"rows": None}, {"rows": 5}]) is False


# ── A POINT SESSION INSIDE THE JUDGED WINDOW IS REPORTED, NOT SWALLOWED ─────────────────────────────
# `before` reads `s[1] <= _judged_start` and `after` reads `s[0] >= _cur_end`. The two are a pair, not a
# partition: a session strictly inside the judged envelope satisfies neither, and only a session of ZERO
# length can sit there. A join needs positive overlap with the band, and an excluded session between two
# joined ones overlaps the band they both overlap. So the containment fix residue
# `2026-10-12-a-zero-length-session-inside-the-band-reads-outside-band` made to `_gap_class` never
# reached the point sessions inside a judged window, because neither list selected one to classify.
def _a_point_session_sits_INSIDE_the_judged_window(tmp_path, point_rows):
    """Four placed sessions around the judged one, with a point session INSIDE it.

    The band runs 18:00 to 10:00, so the 11:00 session lies before it and the next noon lies after it,
    and both stay excluded on the evidence. The 19:00 run is judged on rows, the 23:00 run overlaps the
    band and joins it, and the stampless file at 21:00 is a session of zero length in the hole between
    them (`file_interval` places an unstamped file at its own last write). Both neighbours are needed:
    with only one side populated, the interior set could be read off either list alone."""
    d = str(tmp_path / "2026-08-15")

    def at(day, hhmmss, rows, name):
        t = _dt.strptime(day + hhmmss, "%Y%m%d%H%M%S").timestamp()
        _rows(d, name, rows, t + 900)
        return t

    at("20260815", "110000", 50, "Polar_H10_02849638_20260815110000_ECG.txt")  # before the band opens
    at("20260815", "190000", 900, "Polar_H10_02849638_20260815190000_ECG.txt")  # judged, on rows
    at("20260815", "230000", 60, "Polar_H10_02849638_20260815230000_ECG.txt")  # in-night, so it joins
    at("20260816", "120000", 70, "Polar_H10_02849638_20260816120000_ECG.txt")  # after the band closes
    point = _dt.strptime("20260815210000", "%Y%m%d%H%M%S").timestamp()
    _rows(d, "Polar_H10_02849638_ECG.txt", point_rows, point)
    return d


def test_a_POINT_SESSION_inside_the_judged_window_IS_REPORTED_and_reds_the_night(tmp_path):
    """30 rows the judgement never read, in a night that used to grade on silence about them."""
    r = _summarize(_a_point_session_sits_INSIDE_the_judged_window(tmp_path, point_rows=30), _DEV)
    assert r["sessions_judged"] == 2, (r["sessions_judged"], "the 19:00 run and the 23:00 one it joins")
    inside = r["excluded_inside"]
    assert len(inside) == 1, (inside, "the point alone: the other two exclusions sit beside the window")
    assert "21:00 point session inside the judged window" in inside[0], inside[0]
    assert "1 file(s), 30 rows, not read by the judgement" in inside[0], inside[0]
    assert "[in-night]" in inside[0], (inside[0], "a point inside the band is placed by containment")
    assert inside[0] in r["gaps"], "every exclusion is reported in `gaps` as well"
    assert r["gaps_in_night"] == inside, "capture the judgement never read cannot grade green"
    assert r["ok"] is False, "and `ok` reads `gaps_in_night`"
    # The neighbours beside the window are still reported, still labelled, and still not red.
    assert len([g for g in r["gaps"] if "earlier session" in g]) == 1, r["gaps"]
    assert len([g for g in r["gaps"] if "later session" in g]) == 1, r["gaps"]
    assert [g for g in r["gaps_in_night"] if "session(s)" in g] == [], r["gaps_in_night"]


def test_CONTROL_a_point_session_that_recorded_NOTHING_is_published_and_reds_nothing(tmp_path):
    """The same night and the same geometry, with no row in the point's file.

    A point takes no minutes out of the night, so rows are the only loss it can carry. With every file
    readable and no row in any of them, the judgement left nothing unread. Without this leg an
    unconditional append would pass the test above."""
    r = _summarize(_a_point_session_sits_INSIDE_the_judged_window(tmp_path, point_rows=0), _DEV)
    inside = r["excluded_inside"]
    assert len(inside) == 1, (inside, "it is still published: the night read nothing from it")
    assert "0 rows, not read by the judgement" in inside[0], inside[0]
    assert r["gaps_in_night"] == [], "no time and no row is nothing the judgement failed to read"


def _clock_logs_after_the_night(tmp_path):
    """The 2026-11-05 shape: a night session, then the ring on its charger writing only clock logs.

    The judged session is H10 ECG 04:00->04:15. After it, inside the band, the ring writes a 22-row
    `_RTCLOG.csv` from 06:18 and `radioclock` writes a `_RADIOCLOCK.csv` from 06:45 to 09:09. No device
    sample is written after 04:15. Absolute stamps, never derived from now()."""
    d = str(tmp_path / "2026-08-15")
    judged = _dt.strptime("20260815040000", "%Y%m%d%H%M%S").timestamp()
    _rows(d, "Polar_H10_ABCD0001_20260815040000_ECG.txt", 900, judged + 900)
    rtc = os.path.join(d, "Wellue_O2Ring-S_0001_20260815061800_RTCLOG.csv")
    with open(rtc, "w") as fh:
        fh.write("Phone timestamp;event;rtc_offset_s;battery_state;battery_level;battery_raw2;battery_raw3\n")
        for i in range(22):
            fh.write(f"2026-08-15T06:{18 + i}:00.000;read;-0.5;;;;\n")
    os.utime(rtc, (judged + 9600, judged + 9600))
    radio = os.path.join(d, "20260815T064500_AA-BB-CC-DD-EE-FF_RADIOCLOCK.csv")
    with open(radio, "w") as fh:
        fh.write(
            "Phone timestamp;device;meas;last_sensor_ns;conn_handle;event_counter;anchor_us;vs_rx_ns;"
            "acl_rx_ns;device_clock;anchor_epoch\n"
        )
        for i in range(145):
            h, m = divmod(6 * 60 + 45 + i, 60)
            fh.write(f"2026-08-15T{h:02d}:{m:02d}:00.000;AA:BB:CC:DD:EE:FF;;;810;{i};{i};{i};{i};none-not-pmd;1\n")
    os.utime(radio, (judged + 18540, judged + 18540))
    return d


def test_CLOCK_LOGS_AFTER_THE_NIGHT_DO_NOT_STRETCH_ITS_SPAN(tmp_path):
    """Residue `2026-11-05-clock-logs-join-the-night-as-device-data`. On the box, night 2026-11-04 read
    73 % at 05:00 and 58 % at 09:09, because two morning sessions made of clock logs alone joined it.
    A clock log is the box's record of a device's clock, not the device's samples."""
    r = _summarize(_clock_logs_after_the_night(tmp_path), _DEV)
    assert r["sessions_judged"] == 1, (r["sessions_judged"], r["gaps"])
    assert r["span_sec"] == 900, (r["span_sec"], "the night's own 15 min, not the morning's clock logs")
    assert r["joined_gaps"] == [] and r["empty_joined"] == [], (r["joined_gaps"], r["empty_joined"])
    assert {"RTCLOG", "RADIOCLOCK"} <= set(r["sidecars"]), (r["sidecars"], "they are named, not dropped")


def _stream_sidecars_around_the_night(tmp_path, arrival=True, runs=True):
    """The 2026-11-06 shape: per-stream sidecars on both sides of a night's samples.

    The judged session is H10 ECG 04:00->04:15. Before it, a Verity that cannot start writes a
    header-only `_PMDARRIVAL.csv` every 20 min from 02:00. After it, the H10's `_ACCRUNS.txt`, stamped
    with the ECG's own start, is rewritten at 06:00 when the daemon stops. Absolute stamps only."""
    d = str(tmp_path / "2026-08-15")
    judged = _dt.strptime("20260815040000", "%Y%m%d%H%M%S").timestamp()
    _rows(d, "Polar_H10_ABCD0001_20260815040000_ECG.txt", 900, judged + 900)
    if arrival:
        for k in range(6):
            name = f"Polar_VeritySense_ABCD0002_20260815{2 + k // 3:02d}{(k % 3) * 20:02d}00_PMDARRIVAL.csv"
            path = os.path.join(d, name)
            with open(path, "w") as fh:
                fh.write("Phone timestamp;device;meas;first_sensor_ns;last_sensor_ns;n_samples;first_sample_idx\n")
            start = judged - 7200 + k * 1200
            os.utime(path, (start + 60, start + 60))
    if runs:
        path = os.path.join(d, "Polar_H10_ABCD0001_20260815040000_ACCRUNS.txt")
        with open(path, "w") as fh:
            fh.write("start_idx;end_idx;value\n0;40;1\n")
        os.utime(path, (judged + 7200, judged + 7200))
    return d


def test_A_HEADER_ONLY_ARRIVAL_LOG_DOES_NOT_OPEN_THE_NIGHT_EARLY(tmp_path):
    """Residue `2026-11-06-stream-sidecars-set-the-night-span`. On the box the Verity's failed starts
    opened night 2026-11-05 at 16:03, 2.5 h before anyone wore a device."""
    r = _summarize(_stream_sidecars_around_the_night(tmp_path, runs=False), _DEV)
    assert r["span_sec"] == 900, (r["span_sec"], "the night's own 15 min, not the arrival logs before it")
    assert r["judged_session"]["start"] == r["sessions"][0]["start"], (r["sessions"], "one session: the ECG")


def test_A_RUNS_SIDECAR_REWRITTEN_AT_THE_DAEMON_STOP_DOES_NOT_STRETCH_THE_NIGHT(tmp_path):
    """The same residue, the other end: RUNS sidecars rewritten at the 08:55 stop held the session open
    from 06:09, when the last sample came."""
    r = _summarize(_stream_sidecars_around_the_night(tmp_path, arrival=False), _DEV)
    assert r["span_sec"] == 900, (r["span_sec"], "the night's own 15 min, not the RUNS file's last write")


def test_both_stream_sidecars_together_leave_the_span_at_the_samples(tmp_path):
    r = _summarize(_stream_sidecars_around_the_night(tmp_path), _DEV)
    assert r["span_sec"] == 900 and len(r["sessions"]) == 1, (r["span_sec"], r["sessions"])


@pytest.mark.parametrize(
    ("tag", "sidecar"),
    [
        ("PMDARRIVAL", True),
        ("ACCRUNS", True),
        ("PPGSEAMS", True),
        ("ACC.TXT.META", True),
        ("LINK", True),
        ("RTCLOG", True),
        ("ECG", False),
        ("PPG", False),
        ("ACC", False),
        ("SPO2", False),
        (None, False),
    ],
)
def test_is_sidecar_names_every_kind_of_file_the_box_writes_about_a_stream(tag, sidecar):
    assert nightqc.is_sidecar(tag) is sidecar, tag
