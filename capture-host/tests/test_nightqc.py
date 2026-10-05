# tepna-capture — tests/test_nightqc.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
import gc
import json
import logging
import inspect
import os
import time

import math
import datetime as _dtmod
from datetime import datetime, timedelta

import pytest
import nightqc
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


_CLOCKLESS_HEADER = "h1;h2\n"


def _starts_stamp(t_floating):
    """A `STARTS.csv` phone stamp for a FLOATING second — the civil components that second names.

    ⚠️ NOT `datetime.fromtimestamp`, which these fixtures used. That formats an ABSOLUTE instant through
    the reader's zone, and the bases here (`_stamp_epoch`, `_end_0923`) are floating — so the pair only
    ever agreed because `nightqc._parse_phone_ts` resolved the stamp back through the same zone, undoing
    the error exactly. Now that the reader reads the sidecar as floating (§🔒 §1, as the box writes it),
    the fixture has to write floating too, or the recorded daemon seam lands one whole offset away and
    `merge_sessions` splits the night in the wrong place."""
    c = _dtmod.datetime(1970, 1, 1) + _dtmod.timedelta(seconds=t_floating)
    return c.strftime("%Y-%m-%dT%H:%M:%S.%f")[:23]


def _cap(night, name, rows, header=None):
    """Write a capture file with a header line + `rows` data lines.

        BY DEFAULT IT CARRIES A HOST CLOCK, because every real capture file does. `i;i` rows under an
        `h1;h2` header are not a capture file in any respect, and that stopped being merely unrealistic when
        `nightqc.recover_writer_offset` began reading the writer's UTC offset out of the files: a night whose
        files carry no clock at all casts no vote, so it refuses — correctly, but it refuses for a reason the
        fixture invented rather than one the behaviour under test is about.

    ONLY THE LAST ROW CARRIES A STAMP, and `_utime` writes it, because the stamp that matters is the
        file's CLOSE time and only `_utime` knows it. The rest are blank, which is what keeps this change from
        cascading into coverage: `file_host_span_sec` scans forward for a first usable row, finds none, and
        returns None — so these files gain a zone witness and NOT a duration basis, and every coverage figure
        is computed from exactly what it was before. An earlier attempt wrote a stamp on every row at 1 Hz;
        that gave an ECG file a 36-hour host span and broke 11 coverage assertions that were right all along.

        The stamp is LOCAL civil time (what `writers._phone_ts` writes: "local civil time, zone-free"), so the
        fixture emulates a writer in the reader's zone — which is what these fixtures have always tacitly
        done, since their mtimes come from `.timestamp()`. The recovered offset is therefore the reader's own,
        and `session + offset` reproduces today's `strptime(stamp).timestamp()` exactly: every span these
        tests assert is unchanged, by construction rather than by tolerance.

        PASS `header=_CLOCKLESS_HEADER` FOR THE DELIBERATELY CLOCKLESS CASE. It is not a legacy shim: the
        refusal path (UNKNOWN, a named reason, no guessed span) has to stay exercised, and a file with no
        clock is the only thing that exercises it. Any explicit `header` likewise suppresses the stamps, so a
        caller testing a specific column layout still gets exactly the layout it asked for."""
    p = os.path.join(night, name)
    with open(p, "w") as fh:
        if header is not None:
            fh.write(header)
            for i in range(rows):
                fh.write(f"{i};{i}\n")
        else:
            fh.write("Phone timestamp;v\n")
            for i in range(rows):
                fh.write(f";{i}\n")  # blank stamp — `_utime` fills the LAST one, see below
    return p


# THE PRODUCTION FILENAME SHAPE, and the mtime that has to come with it.
#
# `writers.capture_filename()` embeds a 14-digit `_YYYYMMDDHHMMSS_` stamp — the instant the connection
# opened — and `_session_of` turns it into the file's session start. A test that plants an 8-digit DATE
# instead takes `_session_of`'s MTIME FALLBACK, which is a supported legacy case and is NOT the path any
# real file takes: it makes session start == mtime, so the span is always 0 and always unjudgeable.
#
# Giving a test the production shape therefore costs an mtime as well as a stamp. Session start comes
# from the civil stamp and session end from the absolute mtime, so pairing a July stamp with a
# written-just-now mtime produced a span of 5,752,585 s — 66 days — rather than a night. `_stamp_epoch`
# expresses the relationship instead of a number, exactly as `_end_0923` does, which is what keeps it
# true in every zone; the tests that use it carry `_tz` for the same reason.
_STAMP_0719 = "20260719220000"


def _stamp_epoch(stamp=_STAMP_0719):
    """The FLOATING seconds a `_YYYYMMDDHHMMSS_` filename stamp resolves to — the same one conversion
    `_session_of` makes, so a fixture's mtimes stay in a civil-time relationship with its filenames.

    It no longer depends on the reader: the value is the components as written, identical in every zone.
    A fixture that wants an mtime in the ABSOLUTE frame beside it adds the offset the fixture is written
    to represent, exactly as `nightqc.recover_writer_offset` recovers it from a real night."""
    return nightqc._session_of(f"X_{stamp}_ECG.txt")


def _summarize_floating(night, devices, wear=None):
    """For fixtures whose MTIMES are floating too — they build them from `_stamp_epoch()` / `_end_0923()`,
    which return floating seconds, so stamp and mtime are both civil and the writer offset is 0 by
    construction. The sibling `_summarize` is for fixtures that build mtimes with `.timestamp()`, where the
    frame is the reader's. The two cannot be told apart at runtime — `mtime - stamp` is a duration in one
    and a duration plus an offset in the other — so each fixture says which it is, which is the point of
    declaring rather than inferring."""
    return nightqc.summarize(night, devices, wear, writer_offset=nightqc.declared_offset(0.0))


def test_parse_capture_name():
    assert nightqc.parse_capture_name("Polar_H10_02849638_20260719000000_ECG.txt") == ("ECG", "txt")
    assert nightqc.parse_capture_name("Wellue_O2Ring-S_S8AW_20260719_SPO2.csv") == ("SPO2", "csv")
    assert nightqc.parse_capture_name("noext") is None  # no extension
    assert nightqc.parse_capture_name("nounderscore.txt") is None  # no `_`
    assert nightqc.parse_capture_name("trailing_.txt") is None  # empty stream tag


def test_count_rows(tmp_path):
    p = _cap(str(tmp_path), "a_b_c_1_ECG.txt", rows=5)
    assert nightqc.count_rows(p) == 5
    header_only = os.path.join(tmp_path, "a_b_c_1_ACC.txt")
    open(header_only, "w").write("just a header\n")
    assert nightqc.count_rows(header_only) == 0  # header-only → 0 rows
    empty = os.path.join(tmp_path, "a_b_c_1_MAG.txt")
    open(empty, "w").close()
    assert nightqc.count_rows(empty) == 0  # empty file → 0
    # Unreadable → None, never 0: a file that cannot be opened did not deliver "nothing" (ABSENCE-SURVEY
    # d2ab13a24151). `is None`, because `== 0` and a falsy check would both pass on the old defect.
    assert nightqc.count_rows(str(tmp_path / "does-not-exist")) is None


@pytest.mark.skipif(hasattr(os, "geteuid") and os.geteuid() == 0, reason="root reads a 0o000 file")
def test_an_unreadable_capture_is_unknown_never_missing_or_zero(tmp_path, _tz):
    """PLANT (ABSENCE-SURVEY d2ab13a24151): one stream file exists and cannot be read. Before the fix it
    counted 0 rows, landed in `missing`, and the verdict FAILed the device for delivering nothing."""
    night = str(tmp_path / "2026-07-19")
    os.makedirs(night)
    t = _stamp_epoch() + 10  # too young to judge coverage, so nothing else can FAIL and mask the plant
    for name, rows in [
        ("Polar_H10_02849638_20260719220000_ECG.txt", 100),
        ("Polar_H10_02849638_20260719220000_ACC.txt", 50),
        ("Polar_H10_02849638_20260719220000_HR.txt", 10),
        ("Wellue_O2Ring-S_S8AW_20260719220000_SPO2.csv", 900),
        ("Wellue_O2Ring-S_S8AW_20260719220000_PPG.txt", 8000),
    ]:
        _utime(_cap(night, name, rows), t)
    locked = os.path.join(night, "Polar_H10_02849638_20260719220000_ACC.txt")
    os.chmod(locked, 0)
    try:
        scanned = {f["file"]: f for f in nightqc.scan_night(night)}
        assert scanned[os.path.basename(locked)]["rows"] is None
        s = _summarize_floating(night, _devices())
        h10 = next(d for d in s["devices"] if d["name"] == "H10")
        assert h10["streams"]["acc"] is None and h10["streams"]["ecg"] == 100
        assert h10["streams"]["hr"] == 10, "the stream AFTER the unreadable one is still counted"
        assert "H10:acc" not in s["missing"]
        assert s["unreadable"] == [f"H10:acc ({os.path.basename(locked)})"]
        assert s["unreadable_files"] == [os.path.basename(locked)]
        assert s["total_rows"] == 100 + 10 + 900 + 8000  # the unknown file is left out, and named
        assert s["ok"] is False
        v = nightqc.qc_verdict(s, _devices(), night_dir=night)
        assert v["status"] == "UNKNOWN" and "H10:acc" in v["reason"], v["reason"]
        assert v["result"] is not None and v["result"]["missing"] == [], v["result"]  # the result travels with UNKNOWN
    finally:
        os.chmod(locked, 0o644)


def test_known_rows_leaves_out_an_unreadable_file_rather_than_zeroing_it():
    assert nightqc.known_rows([{"rows": 3}, {"rows": None}, {"rows": 0}]) == 3
    assert nightqc.known_rows([]) == 0


def test_scan_night_lists_capture_files_only(tmp_path, _tz):
    night = str(tmp_path / "2026-07-19")
    os.makedirs(night)
    _cap(night, "Polar_H10_02849638_20260719220000_ECG.txt", 3)
    _cap(night, "Tepna_20260719220000_LINK.csv", 2)  # a sidecar — tagged, still listed
    open(os.path.join(night, "notes.md"), "w").write("x")  # no `_`+ext capture shape → ignored
    open(os.path.join(night, nightqc._SUMMARY_NAME), "w").write("{}")  # the QC file itself → skipped
    os.mkdir(os.path.join(night, "weird_x_ACC.txt"))  # a DIR with a capture name → not isfile
    scanned = nightqc.scan_night(night)
    files = {r["file"]: r for r in scanned}
    assert set(files) == {"Polar_H10_02849638_20260719220000_ECG.txt", "Tepna_20260719220000_LINK.csv"}
    assert files["Polar_H10_02849638_20260719220000_ECG.txt"]["rows"] == 3


def test_scan_night_missing_dir_is_empty():
    assert nightqc.scan_night("/no/such/night") == []


def _devices():
    return [
        {"name": "H10", "device_id": "02849638", "streams": ["ecg", "acc", "hr"]},
        {"name": "Ring", "device_id": "S8AW", "streams": ["spo2", "ppg"]},
    ]


def test_summarize_all_present_is_ok(tmp_path, _tz):
    night = str(tmp_path / "2026-07-19")
    os.makedirs(night)
    just_started = _stamp_epoch() + 10  # a capture 10 s old: stamped, and not yet judgeable
    for name, rows in [
        ("Polar_H10_02849638_20260719220000_ECG.txt", 100),
        ("Polar_H10_02849638_20260719220000_ACC.txt", 50),
        ("Polar_H10_02849638_20260719220000_HR.txt", 10),
        ("Wellue_O2Ring-S_S8AW_20260719220000_SPO2.csv", 900),
        ("Wellue_O2Ring-S_S8AW_20260719220000_PPG.txt", 8000),
        ("Tepna_20260719220000_LINK.csv", 5),
    ]:
        _utime(_cap(night, name, rows), just_started)
    s = _summarize_floating(night, _devices())
    assert s["ok"] is True and s["missing"] == []
    assert s["night"] == "2026-07-19" and s["files"] == 6
    assert s["total_rows"] == 100 + 50 + 10 + 900 + 8000 + 5
    assert s["sidecars"] == ["LINK"]
    h10 = next(d for d in s["devices"] if d["name"] == "H10")
    assert h10["streams"] == {"ecg": 100, "acc": 50, "hr": 10}


def test_summarize_flags_a_missing_and_header_only_stream(tmp_path, _tz):
    night = str(tmp_path / "2026-07-19")
    os.makedirs(night)
    just_started = _stamp_epoch() + 10
    _utime(_cap(night, "Polar_H10_02849638_20260719220000_ECG.txt", 100), just_started)
    _utime(_cap(night, "Polar_H10_02849638_20260719220000_ACC.txt", 0), just_started)  # header-only → missing
    # HR file absent entirely → also missing; Ring produced nothing at all
    s = nightqc.summarize(night, _devices())
    assert s["ok"] is False
    assert set(s["missing"]) == {"H10:acc", "H10:hr", "Ring:spo2", "Ring:ppg"}
    # A capture 10 s into its session is too short to judge — the `< _MIN_SPAN_SEC` branch. This used to
    # read None because a stampless name made session start == mtime, so the span was 0 by construction
    # and this assertion could not distinguish "just started" from "no stamp".
    assert s["span_sec"] is None


def _utime(p, t):
    """Set the file's mtime to `t` — and, if it carries an empty-stamped host column, write the CIVIL time
    of `t` into its last row.

    THE TWO HAVE TO AGREE. `t` is an absolute instant; the host column is civil time. A night states the
    writer's UTC offset by the distance between them (`nightqc.recover_writer_offset`), so a fixture whose
    last row says nothing cannot state its zone, refuses, and publishes no span — failing the test for a
    reason the fixture invented rather than one the behaviour under test is about.

    Writing it HERE rather than in `_cap` is what makes it right: the close stamp is the mtime, and only
    this function knows the mtime. The distance it produces is exactly the reader's offset with zero lag,
    so every file votes the same bucket and the vote is exact rather than merely inside it."""
    try:
        with open(p, "r+", encoding="utf-8") as fh:
            lines = fh.readlines()
            if lines and lines[0].startswith("Phone timestamp;") and lines[-1].startswith(";"):
                # `fromtimestamp` IS a zone conversion here, and deliberately: the fixture emulates a
                # writer in the reader's zone, so the civil time of `t` is what that writer would log.
                c = _dtmod.datetime.fromtimestamp(t)
                lines[-1] = f"{c.strftime('%Y-%m-%dT%H:%M:%S.')}{c.microsecond // 1000:03d}" + lines[-1]
                fh.seek(0)
                fh.writelines(lines)
                fh.truncate()
    except (OSError, UnicodeDecodeError):
        pass  # a fixture that is not this shape keeps its bytes; the mtime still lands
    os.utime(p, (t, t))


def test_session_of_refuses_when_the_stamp_is_not_a_real_datetime():
    # A file with no usable start stamp has NO FLOATING START, and that is what it now says. It used to
    # answer with the file's mtime, which is an absolute instant in a field whose contract is floating —
    # so whatever `file_interval` did to the field it did to two different frames. `file_interval` reads
    # the None and uses the mtime AS an instant instead, without raising it by an offset it never carried.
    # a 14-digit run that is not a valid YYYYMMDDHHMMSS (month 99) → strptime raises → no floating start
    assert nightqc._session_of("Polar_H10_x_20269999000000_ECG.txt") is None
    # no 14-digit stamp at all → likewise
    assert nightqc._session_of("a_b_c_ECG.txt") is None


def test_folder_date_helpers_reject_a_non_date_name(tmp_path):
    # a folder whose basename is not YYYY-MM-DD (e.g. 'incoming') has no date → no prev-day, no midnight,
    # and summarize simply skips the cross-midnight pooling.
    d = str(tmp_path / "incoming")
    os.makedirs(d)
    assert nightqc._prev_day_dir(d) is None
    assert nightqc._midnight_of(d) is None
    s = nightqc.summarize(d, [])
    assert s["night"] == "incoming" and s["missing"] == []


def test_summarize_unifies_a_cross_midnight_session(tmp_path, _tz):
    """A real overnight begins before midnight, so night_dir splits it across two date folders (each
    connection rolls into a folder by its START date). Coverage must see the WHOLE session across both
    folders — else a device that streamed cleanly across midnight reads as badly degraded (observed live
    2026-07-21→22: H10 showed 37% though it captured ~95%)."""
    from datetime import datetime as _dt

    d21 = str(tmp_path / "2026-07-21")
    os.makedirs(d21)
    d22 = str(tmp_path / "2026-07-22")
    os.makedirs(d22)
    pre = _dt.strptime("20260721233000", "%Y%m%d%H%M%S").timestamp()  # 23:30 — pre-midnight connection
    post = _dt.strptime("20260722001500", "%Y%m%d%H%M%S").timestamp()  # 00:15 — post-midnight reconnect
    # pre-midnight HR (07-21 folder): 1800 rows over 30 min at 1 Hz
    _utime(_cap(d21, "Polar_H10_02849638_20260721233000_HR.txt", 1800), pre + 1800)
    # post-midnight HR (07-22 folder): 1500 rows over 25 min, still being written
    _utime(_cap(d22, "Polar_H10_02849638_20260722001500_HR.txt", 1500), post + 1500)
    devs = [{"name": "H10", "device_id": "02849638", "streams": ["hr"]}]
    s = _summarize(d22, devs)  # QC targets the current (07-22) folder
    # session spans 23:30 → 00:40 ≈ 70 min; per-folder it would have been just the 25-min post half
    assert s["span_sec"] > 3600  # unified across midnight, not the 07-22 half (1500 s)
    assert s["devices"][0]["streams"]["hr"] == 3300  # pre (1800) + post (1500) — one session
    assert 0.7 < s["devices"][0]["coverage"]["hr"] <= 1.05  # ~full, not the deflated per-folder ~0
    assert s["degraded"] == [] and s["missing"] == []


def test_summarize_does_not_pool_a_mid_day_session(tmp_path):
    """A session that started well after midnight must NOT drag in the previous day's folder (that would be
    a needless full re-read and could unify unrelated sittings)."""
    from datetime import datetime as _dt

    d21 = str(tmp_path / "2026-07-21")
    os.makedirs(d21)
    d22 = str(tmp_path / "2026-07-22")
    os.makedirs(d22)
    y = _dt.strptime("20260721140000", "%Y%m%d%H%M%S").timestamp()  # yesterday afternoon
    t = _dt.strptime("20260722140000", "%Y%m%d%H%M%S").timestamp()  # today 14:00 — NOT near midnight
    _utime(_cap(d21, "Polar_H10_02849638_20260721140000_HR.txt", 9999), y + 1000)
    _utime(_cap(d22, "Polar_H10_02849638_20260722140000_HR.txt", 2000), t + 2000)
    s = _summarize(d22, [{"name": "H10", "device_id": "02849638", "streams": ["hr"]}])
    assert s["span_sec"] == 2000  # only today's 14:00 session; yesterday not pooled
    assert s["devices"][0]["streams"]["hr"] == 2000  # yesterday's 9999 rows excluded


def test_summarize_scopes_coverage_to_the_current_session(tmp_path):
    """A date folder can hold an earlier DAYTIME session AND tonight's — the box rolls a folder by the
    session's start date, so a box that ran all day piles both into one YYYY-MM-DD dir. Coverage must be
    judged against the CURRENT session's span, not the ~20 h folder spread — else a stream streaming
    perfectly right now reads as 0% degraded (observed live 2026-07-21, the bug this fixes)."""
    from datetime import datetime as _dt

    night = str(tmp_path / "2026-07-21")
    os.makedirs(night)
    day_start = _dt.strptime("20260721000023", "%Y%m%d%H%M%S").timestamp()  # 00:00 — a daytime session
    eve_start = _dt.strptime("20260721194615", "%Y%m%d%H%M%S").timestamp()  # 19:46 — tonight's session
    # daytime HR: a little data, last written ~15 min into that long-gone session
    _utime(_cap(night, "Polar_H10_02849638_20260721000023_HR.txt", 500), day_start + 900)
    # evening HR: 1 Hz for 2000 s = full rate, still being written now
    _utime(_cap(night, "Polar_H10_02849638_20260721194615_HR.txt", 2000), eve_start + 2000)
    devs = [{"name": "H10", "device_id": "02849638", "streams": ["hr"]}]
    s = nightqc.summarize(night, devs)
    assert s["span_sec"] == 2000  # the EVENING session, NOT ~71000 s (19.7 h)
    h10 = s["devices"][0]
    assert h10["coverage"]["hr"] == 1.0  # live stream reads full — not diluted to ~0 by daytime
    assert s["degraded"] == []
    assert h10["streams"]["hr"] == 2000  # the CURRENT session's rows (the 500 daytime excluded)
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


def test_a_daemon_restart_does_not_merge_two_sessions_into_one_union_span(tmp_path):
    """🔴 SOLID-NIGHT night 1 read FAIL because a night dir holding two capture runs was judged as ONE.

    `merge_sessions` extends a session whenever the next file opens within `_SESSION_GAP_SEC` (3600 s),
    and a daemon RESTART's gap is seconds — so the two runs merge and every span-derived quantity then
    describes the union. Live on 2026-09-24 that made nine streams read coverage 0.46-0.52 with
    `missing: []` and `span_basis: "session"` on every one, and made the H10 report
    `stopped_early_s 18766` (5.2 h) although it never stopped early: the union's end belonged to a
    LATER run than its last write. The real night chained SIX restarts (16:39, 17:05, 17:39, 18:40,
    19:40, 20:03 in its own `STARTS.csv`), each gap far under the threshold; one seam reproduces both
    numbers, which is what this fixture plants.

    The threshold cannot simply be shortened — its docstring records why: a 7-h H10 connection carries
    one 19:46 stamp, so stamp-gap clustering wrongly split such a stream off. The boundary evidence is
    the daemon start, which `writers.append_daemon_start` has been recording to `STARTS.csv` all along
    and `daemon_starts` already parses. `summarize`'s own comment says the two cases are
    indistinguishable BY FILE-ACTIVITY SIGNATURE — true, and this discriminator is not one.

    Clockless fixture rows on purpose (`_cap`, no device clock): that is what makes `file_span_sec`
    None and drives the coverage denominator onto the session span, which is the live shape — NOT the
    deliberate clockless fallback of
    `test_a_clockless_file_falls_back_to_the_session_span_and_SAYS_SO`, and not #3065's absent device.
    """
    import writers

    night = str(tmp_path / "2026-09-24")
    os.makedirs(night)
    s1 = _stamp_epoch("20260924113000")  # run 1 opens
    restart = s1 + 17990  # the daemon restarts 4 h 59 m in
    end2 = s1 + 35407  # run 2's last write (its file opens at s1 + 18000,
    #  10 s after the restart — see the stamp below)

    # run 1, COMPLETE: HR at 1 Hz for 16641 s, then this device is done for the night
    _utime(_cap(night, "Polar_H10_02849638_20260924113000_HR.txt", 16641), s1 + 16641)
    # run 2, PARTIAL: a different device trickles to the end of the folder
    _utime(_cap(night, "Wellue_O2Ring-S_S8AW_20260924163000_SPO2.csv", 3000), end2)
    with open(os.path.join(night, writers.STARTS_NAME), "w") as fh:
        fh.write("Phone timestamp;pid;git;dirty;adapter\n")
        fh.write(_starts_stamp(restart) + ";400443;2cd12712;no;F4:CE:36:2E:CD:98\n")

    devs = [
        {"name": "H10", "device_id": "02849638", "streams": ["hr"]},
        {"name": "Ring", "device_id": "S8AW", "streams": ["spo2"]},
    ]
    s = _summarize_floating(night, devs)

    # THE SEAM IS SEEN: two runs, not one union of 35407 s
    assert len(s["sessions"]) == 2, "a recorded daemon start separates the runs it started"
    assert s["span_sec"] == 16641, "the judged run's OWN span, not the folder union (was 35407)"
    h10 = next(d for d in s["devices"] if d["name"] == "H10")
    # 16641 rows over 16641 s of ITS OWN run is a perfect stream. Merged, it read 16641/35407 = 0.47.
    assert h10["coverage"]["hr"] == 1.0, "a stream perfect through run 1 must not be diluted by run 2"
    assert h10["stopped_early_s"] in (0, None), "it stopped when its run did; the 18766 s came from a later run's end"
    assert s["degraded"] == [], "nothing about run 1 is degraded"
    assert s["session_basis"] == "daemon-starts", "the basis is REPORTED, never assumed"


def test_without_a_STARTS_sidecar_the_session_basis_says_gap_only(tmp_path):
    """∅ ABSENCE IS NULL, applied to the discriminator itself. A night whose daemon predates the
    sidecar did not restart zero times — it did not say (`daemon_starts` returns `starts: None`). So
    the same fixture WITHOUT `STARTS.csv` keeps the old gap-only merge, and the summary says which
    basis it used rather than looking identically scoped. A field that cannot distinguish "no restart"
    from "no evidence of a restart" is the bug this pair exists to prevent."""
    night = str(tmp_path / "2026-09-24")
    os.makedirs(night)
    s1 = _stamp_epoch("20260924113000")
    _utime(_cap(night, "Polar_H10_02849638_20260924113000_HR.txt", 16641), s1 + 16641)
    _utime(_cap(night, "Wellue_O2Ring-S_S8AW_20260924163000_SPO2.csv", 3000), s1 + 35407)
    devs = [
        {"name": "H10", "device_id": "02849638", "streams": ["hr"]},
        {"name": "Ring", "device_id": "S8AW", "streams": ["spo2"]},
    ]
    s = _summarize_floating(night, devs)
    assert s["session_basis"] == "gap-only", "no sidecar ⇒ no boundary evidence, and it says so"
    assert len(s["sessions"]) == 1, "and the merge is unchanged — this is the pre-existing behaviour"
    assert s["span_sec"] == 35407


def test_the_POOLED_half_brings_its_own_seams_from_the_neighbouring_folder(tmp_path):
    """A cross-midnight night is judged from files in TWO folders, and the pre-midnight half's restarts
    are recorded in the PREVIOUS folder's sidecar. Reading only this folder's would segment the pooled
    set on gap alone for exactly the half that was pooled in — a silent reversion — and the basis would
    say `gap-only` while seams from the neighbour were in fact available. Both are asserted here: the
    seam is honoured, and the basis follows the EVIDENCE rather than the folder it came from."""
    import writers

    d21 = str(tmp_path / "2026-07-21")
    os.makedirs(d21)
    d22 = str(tmp_path / "2026-07-22")
    os.makedirs(d22)
    pre = _stamp_epoch("20260721233000")  # 23:30, the pre-midnight run
    post = _stamp_epoch("20260722001500")  # 00:15, the run after the restart
    _utime(_cap(d21, "Polar_H10_02849638_20260721233000_HR.txt", 1800), pre + 1800)
    _utime(_cap(d22, "Polar_H10_02849638_20260722001500_HR.txt", 1500), post + 1500)
    # the restart is recorded in YESTERDAY's folder; today's has no sidecar at all
    with open(os.path.join(d21, writers.STARTS_NAME), "w") as fh:
        fh.write("Phone timestamp;pid;git;dirty;adapter\n")
        fh.write(_starts_stamp(pre + 1900) + ";400443;2cd12712;no;F4:CE:36:2E:CD:98\n")
    devs = [{"name": "H10", "device_id": "02849638", "streams": ["hr"]}]
    s = _summarize_floating(d22, devs)
    assert len(s["sessions"]) == 2, "the neighbour's recorded seam splits the pooled set"
    assert s["span_sec"] == 1800, "the judged run is the pre-midnight one alone, not the 4200 s union"
    assert s["devices"][0]["streams"]["hr"] == 1800, "and it carries only its own rows"
    assert s["session_basis"] == "daemon-starts", (
        "segmented on recorded starts — from the neighbour, which is still the evidence"
    )


def test_summarize_flags_a_degraded_trickle(tmp_path, _tz):
    """A stream that produced data but only a fraction of its rate — the Verity IMU at ~40%, a stream that
    died at hour one — is `degraded`, not a green `ok`. Coverage is delivered rows vs rate × span."""
    night = str(tmp_path / "2026-07-19")
    os.makedirs(night)
    base = _stamp_epoch()
    ecg = _cap(night, "Polar_H10_02849638_20260719220000_ECG.txt", 130000)  # 130 Hz nominal → ~full
    acc = _cap(night, "Polar_H10_02849638_20260719220000_ACC.txt", 40000)  # 200 Hz nominal → ~20%
    hr = _cap(night, "Polar_H10_02849638_20260719220000_HR.txt", 1000)  # 1 Hz nominal → full
    spo2 = _cap(night, "Wellue_O2Ring-S_S8AW_20260719220000_SPO2.csv", 1000)  # O2Ring branch, 1 Hz → full
    ppg = _cap(night, "Wellue_O2Ring-S_S8AW_20260719220000_PPG.txt", 125738)  # 125.738 Hz → full
    # a 1000 s span: ACC last written at session start (died early), ECG current
    for p in (acc, hr, spo2, ppg):
        _utime(p, base)
    _utime(ecg, base + 1000)
    s = _summarize_floating(night, _devices())
    assert s["span_sec"] == 1000
    h10 = next(d for d in s["devices"] if d["name"] == "H10")
    assert h10["coverage"] == {"ecg": 1.0, "acc": 0.2, "hr": 1.0}
    # `(rate assumed)` is deliberate and is asserted, not tolerated: this fixture writes too few rows
    # for `measured_hz` to read a rate, so coverage here is computed against the CONFIGURED rate. A
    # degraded line is worth exactly what its rate is worth, and before `coverage_basis` the two were
    # indistinguishable at the one place an operator actually reads.
    assert s["degraded"] == ["H10:acc 20% (rate assumed)"] and s["ok"] is False
    assert h10["coverage_basis"] == {"ecg": "expected", "acc": "expected", "hr": "expected"}
    assert s["missing"] == []


def test_summarize_coverage_uses_configured_rate_and_skips_unknown(tmp_path, _tz):
    """A device's own `rates` override the nominal denominator; a stream with no reference rate makes no
    coverage claim (better silent than fabricated)."""
    night = str(tmp_path / "2026-07-19")
    os.makedirs(night)
    base = _stamp_epoch()
    acc = _cap(night, "Polar_VeritySense_0C30_20260719220000_ACC.txt", 52000)  # configured 52 Hz → full
    foo = _cap(night, "Polar_VeritySense_0C30_20260719220000_FOO.txt", 10)  # no nominal → no coverage
    _utime(acc, base)
    _utime(foo, base + 1000)
    devs = [
        {"name": "Verity", "device_id": "0C30", "model": "VeritySense", "streams": ["acc", "foo"], "rates": {"acc": 52}}
    ]
    s = _summarize_floating(night, devs)
    v = s["devices"][0]
    assert v["coverage"] == {"acc": 1.0}  # configured 52 Hz used; 'foo' has no rate → omitted
    assert s["degraded"] == [] and s["ok"] is True


def test_summarize_no_data_files_span_is_none(tmp_path, _tz):
    """A night with only a sidecar has no capture span to measure — coverage stays unknown, not zero."""
    night = str(tmp_path / "2026-07-19")
    os.makedirs(night)
    _cap(night, "Tepna_20260719220000_LINK.csv", 5)  # sidecar only, no device data
    s = nightqc.summarize(night, [{"name": "H10", "device_id": "X", "streams": ["ecg"]}])
    assert s["span_sec"] is None and s["missing"] == ["H10:ecg"]


# ── VIGIL: an OPTIONAL backup device that did not join is NOT a fault (known-but-not-expected) ──
def test_summarize_optional_device_absence_is_not_missing_and_stays_ok(tmp_path, _tz):
    night = str(tmp_path / "2026-07-19")
    os.makedirs(night)
    just_started = _stamp_epoch() + 10  # stamped files need a matching mtime or the span is 66 days
    for name, rows in [
        ("Polar_H10_02849638_20260719220000_ECG.txt", 100),
        ("Polar_H10_02849638_20260719220000_ACC.txt", 50),
        ("Polar_H10_02849638_20260719220000_HR.txt", 10),
    ]:
        _utime(_cap(night, name, rows), just_started)
    devices = [
        {"name": "H10", "device_id": "02849638", "streams": ["ecg", "acc", "hr"]},
        {"name": "COOSPO", "device_id": "COOSPO01", "streams": ["hr"], "optional": True},
    ]
    s = _summarize_floating(night, devices)
    assert s["ok"] is True  # the absent optional device does NOT fail the night
    assert "COOSPO:hr" not in s["missing"] and s["missing"] == []
    assert s["optional_absent"] == ["COOSPO:hr"]  # but it is still recorded as known-and-absent


def test_summarize_a_NON_optional_absence_still_fails(tmp_path, _tz):
    night = str(tmp_path / "2026-07-19")
    os.makedirs(night)
    _cap(night, "Polar_H10_02849638_20260719220000_ECG.txt", 100)
    _cap(night, "Polar_H10_02849638_20260719220000_ACC.txt", 50)
    _cap(night, "Polar_H10_02849638_20260719220000_HR.txt", 10)
    devices = [
        {"name": "H10", "device_id": "02849638", "streams": ["ecg", "acc", "hr"]},
        {"name": "Belt", "device_id": "BELT01", "streams": ["hr"]},
    ]  # NOT optional
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

    night = str(tmp_path / "2026-07-24")
    os.makedirs(night)
    first = _dt.strptime("20260723220000", "%Y%m%d%H%M%S").timestamp()  # 22:00, ran 3 h -> 01:00
    after = _dt.strptime("20260724023000", "%Y%m%d%H%M%S").timestamp()  # resumed 02:30 — a 90 min hole
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

    night = str(tmp_path / "2026-07-24")
    os.makedirs(night)
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

    d28 = str(tmp_path / "2026-07-28")
    os.makedirs(d28)
    d29 = str(tmp_path / "2026-07-29")
    os.makedirs(d29)
    pre = _dt.strptime("20260728220542", "%Y%m%d%H%M%S").timestamp()  # 22:05 — the evening connection
    post = _dt.strptime("20260729010859", "%Y%m%d%H%M%S").timestamp()  # 01:08 — past the 1 h gate
    _utime(_cap(d28, "Polar_H10_02849638_20260728220542_HR.txt", 10920), pre + 10920)  # → 01:08:02
    _utime(_cap(d29, "Polar_H10_02849638_20260729010859_HR.txt", 14082), post + 14082)  # → 05:03
    devs = [{"name": "H10", "device_id": "02849638", "streams": ["hr"]}]
    s = _summarize(d29, devs)
    assert s["searched_dirs"] == ["2026-07-29", "2026-07-28"]  # it ASKED next door
    assert s["devices"][0]["streams"]["hr"] == 25002  # both halves, one night
    assert s["span_sec"] > 6 * 3600  # ~7 h, not the 3.9 h post-midnight half
    assert 0.9 < s["devices"][0]["coverage"]["hr"] <= 1.05  # not the deflated 0.53 the box reported
    assert s["degraded"] == [] and s["missing"] == []


def test_summarize_pools_when_the_neighbour_was_still_writing_at_wake(tmp_path):
    """OVERLAP IS CONTIGUITY, NOT ITS ABSENCE. The pooling guard read `0 <= earliest − prev_last_write`,
    which assumes the neighbour folder FINISHED before this folder's first session opened. At a
    multi-device wake that ordering routinely inverts: one device opens its morning fragment (filed under
    today) while another device's night file (filed under yesterday) is still being written. Real case,
    2026-09-01: the O2Ring's 04:20:53 fragment opened while the Verity's night file wrote until 04:23 —
    a −138 s difference the lower bound read as "not contiguous", so a complete 17-file tri-device night
    went unjudged and QC reported the H10 and SpO2 as MISSING from 13 min of morning crumbs. Third failed
    assumption in this guard's family (near-midnight proxy; long reconnect 2026-07-28; simultaneous wake),
    and the comment above the guard already stated the contract — "runs into" includes overlap."""
    from datetime import datetime as _dt

    d31 = str(tmp_path / "2026-08-31")
    os.makedirs(d31)
    d01 = str(tmp_path / "2026-09-01")
    os.makedirs(d01)
    ver = _dt.strptime("20260831225711", "%Y%m%d%H%M%S").timestamp()  # Verity night, 22:57 → 04:23
    oxy = _dt.strptime("20260831225733", "%Y%m%d%H%M%S").timestamp()  # O2Ring night, 22:57 → 04:23
    frag = _dt.strptime("20260901042053", "%Y%m%d%H%M%S").timestamp()  # O2Ring morning fragment, 04:20:53
    _utime(_cap(d31, "Polar_VeritySense_0C301E3F_20260831225711_HR.txt", 19560), ver + 19560)
    _utime(_cap(d31, "Wellue_O2Ring-S_S8AW2100_20260831225733_HR.txt", 19560), oxy + 19560)
    _utime(_cap(d01, "Wellue_O2Ring-S_S8AW2100_20260901042053_HR.txt", 600), frag + 600)
    # A stale daytime fragment in the neighbour folder, like the real 2026-08-31 dir carried (an 04:22
    # sitting from the previous morning). Contiguity must key on the neighbour's LATEST write — keyed
    # on its earliest instead, this 18-h-old file reads as an 18 h gap and pooling wrongly refuses.
    stale = _dt.strptime("20260831042208", "%Y%m%d%H%M%S").timestamp()
    _utime(_cap(d31, "Wellue_O2Ring-S_S8AW2100_20260831042208_HR.txt", 600), stale + 600)
    # The shape under test: the fragment OPENS (04:20:53) before the neighbour's last write (04:23:11).
    assert frag < ver + 19560, "fixture must overlap, or it tests the already-covered gap case"
    devs = [
        {"name": "Verity", "device_id": "0C301E3F", "streams": ["hr"]},
        {"name": "O2Ring", "device_id": "S8AW2100", "streams": ["hr"]},
    ]
    s = _summarize(d01, devs)
    assert s["searched_dirs"] == ["2026-09-01", "2026-08-31"]  # overlap pooled, not rejected
    assert s["missing"] == [], "the night is next door — nothing is missing"
    assert s["devices"][0]["streams"]["hr"] == 19560  # the Verity night is in the verdict
    assert s["degraded"] == []  # and not read as a trickle
    assert s["span_sec"] > 5 * 3600  # the night's span, not the fragment's


def test_summarize_does_not_pool_a_non_contiguous_small_hours_session(tmp_path):
    """The probe widens WHERE we ask, never WHAT we accept. A 02:00 sitting whose neighbour stopped at
    18:00 yesterday is not last night's session, and pooling it would fuse two unrelated sittings — the
    exact failure the mid-day guard exists to prevent, just inside the probe window."""
    from datetime import datetime as _dt

    d28 = str(tmp_path / "2026-07-28")
    os.makedirs(d28)
    d29 = str(tmp_path / "2026-07-29")
    os.makedirs(d29)
    y = _dt.strptime("20260728180000", "%Y%m%d%H%M%S").timestamp()  # yesterday evening, long over
    t = _dt.strptime("20260729020000", "%Y%m%d%H%M%S").timestamp()  # 02:00 — inside the probe window
    _utime(_cap(d28, "Polar_H10_02849638_20260728180000_HR.txt", 600), y + 600)
    _utime(_cap(d29, "Polar_H10_02849638_20260729020000_HR.txt", 600), t + 600)
    devs = [{"name": "H10", "device_id": "02849638", "streams": ["hr"]}]
    s = nightqc.summarize(d29, devs)
    assert s["searched_dirs"] == ["2026-07-29"]  # asked, and the answer was no
    assert s["devices"][0]["streams"]["hr"] == 600  # yesterday's sitting stays out


def test_prev_probe_window_is_a_cost_guard_only():
    """Known answers for the probe window. It decides only whether the contiguity question is ASKED."""
    mid = 1_000_000.0
    assert nightqc.prev_probe_window(mid, mid) is True  # 00:00
    assert nightqc.prev_probe_window(mid + 4101, mid) is True  # 01:08 — the real 2026-07-28 case
    assert nightqc.prev_probe_window(mid + 11.9 * 3600, mid) is True  # 11:54 — still worth asking
    assert nightqc.prev_probe_window(mid + 12 * 3600, mid) is False  # noon — cannot be last night
    assert nightqc.prev_probe_window(mid + 15 * 3600, mid) is False  # 15:00 — never pays for the scan
    assert nightqc.prev_probe_window(mid - 1, mid) is False  # before this folder's midnight
    assert nightqc.prev_probe_window(mid, None) is False  # undatable folder name


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
    got = nightqc._session_of(fname)
    import calendar
    from datetime import datetime

    # timegm, not `.timestamp()`: the expectation must be the components AS WRITTEN, or this test would
    # re-encode the reader's zone and pass in one zone while the code it pins is zone-free.
    expect = float(calendar.timegm(datetime.strptime("20260725225058", "%Y%m%d%H%M%S").timetuple()))
    assert got == expect, "the SERIAL was taken for the stamp — the session key is a different night"


def test_a_run_of_digits_that_is_not_a_plausible_year_is_ignored(tmp_path):
    import nightqc

    assert nightqc._session_of("Polar_H10_99999999999999_ECG.txt") is None, (
        "a 14-digit run with an impossible year must be refused, not strptime'd"
    )


def test_judged_session_answers_for_the_shapes_BOTH_callers_can_hand_it():
    """The shared selector's contract, pinned where the rule lives rather than twice in its callers.

    `None` for no sessions is deliberate and not a dead guard: `judged_session` is consumed by
    `summarize` AND `timeline.build`, each of which guards its own call today, and a helper that raises
    `ValueError` from `max()` on an empty list is a trap for the third caller. The row-vs-recency cases
    are the substance — most ROWS wins over a later end, and a session carrying nothing never wins over
    one that carried something."""
    assert nightqc.judged_session([]) is None, "no sessions is answered, not raised"
    lone = [[0.0, 100.0, [{"rows": 5}]]]
    assert nightqc.judged_session(lone) is lone[0], "one session is that session"
    # most ROWS, though the other ends later — the 2026-08-15 charger shape in miniature
    night, charger = [0.0, 1000.0, [{"rows": 3000}]], [5000.0, 6000.0, [{"rows": 1000}]]
    assert nightqc.judged_session([night, charger]) is night
    # a later EMPTY session never outranks one that carried data (2026-09-14, 2026-09-18 on the box)
    data, empty = [0.0, 1000.0, [{"rows": 2000}]], [5000.0, 6000.0, [{"rows": 0}]]
    assert nightqc.judged_session([data, empty]) is data
    # ...but when EVERY session is empty the tie breaks to the later end, which is what keeps
    # `timeline`'s "connected but silent" view working unchanged
    e1, e2 = [0.0, 1000.0, [{"rows": 0}]], [5000.0, 6000.0, [{"rows": 0}]]
    assert nightqc.judged_session([e1, e2]) is e2


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
    files = [{"file": f"f{i}", "session": i * 0.5 * hour, "mtime": i * 0.5 * hour + hour} for i in range(3)]
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

    dev["rates"]["ppg"] = 55  # asked for what it got
    assert nightqc.rate_reality(str(tmp_path), [dev])[0]["matches_config"] is True


def test_host_jitter_is_rate_agnostic_by_construction():
    """The DEVICE clock supplies the expected cadence, so the same host jitter reports the same at any Hz.

    That is the property that matters when one night may run at 55 Hz and the next at 176: a rate change
    moves the packet period and must not move this. Differencing consecutive `arrival - device` delays
    cancels the device cadence and leaves only what the host added.
    """
    import random
    import nightqc

    for period_ms in (18.14, 5.68):  # 55 Hz and 176 Hz packet cadence
        rng = random.Random(4)
        delays = [400.0 + rng.gauss(0, 10) for _ in range(2000)]  # same host jitter either way
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
        for i in range(6000):  # > _RATE_SAMPLE_ROWS, so the cap must fire
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
    for dev, stream, want in (
        ({"name": "Polar H10"}, "ecg", 130),
        ({"name": "Polar Verity Sense"}, "ppg", 55),
        ({"name": "Wellue O2Ring-S"}, "ppg", 125.738),
    ):
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
        str(tmp_path),
        [{"name": "Polar Verity Sense", "device_id": "0C301E3F", "streams": ["ppg"], "rates": {"ppg": want}}],
    )[0]
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
    row = nightqc.rate_reality(
        str(tmp_path),
        [{"name": "Polar Verity Sense", "device_id": "0C301E3F", "streams": ["ppg"], "rates": {"ppg": want}}],
    )[0]
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
    """18:00 opens a new band; 17:59 still belongs to the previous evening's.

    🔴 THE EDGE MOVED 20 -> 18 ON 2026-10-05 BY OWNER RULING, not by a refit — "the recording defines
    the night", and a recording begins at the first donning after 18:00. This test pinned 20:00 and so
    it moves with the constant; what it still asserts is the PROPERTY, that the edge is exactly where
    the constant says and that the band is one contiguous stretch from it."""
    late = nightqc.night_band(_ts(2026, 8, 14, 18, 0))
    early = nightqc.night_band(_ts(2026, 8, 14, 17, 59))
    assert late != early
    assert late[0] == _ts(2026, 8, 14, 18)
    assert early[0] == _ts(2026, 8, 13, 18)
    assert round(late[1] - late[0]) == 16 * 3600  # 18:00 -> 10:00 is 16 h


def test_a_19_00_DONNING_now_belongs_to_THE_EVENING_IT_STARTED_IN(tmp_path):
    """What the ruling bought, and the one case the old edge got wrong.

    Under 20:00 a 19:00 stamp anchored to the PREVIOUS evening — a band running 20:00 yesterday to
    10:00 today, which does not even contain 19:00 today. #3290 measured the consequence on the box:
    on 2026-10-04 the Verity donned at 19:08 and banded to 10-03 while the ring (22:00) and the H10
    (22:02) banded to 10-04 — one recording split across two bands at the BAND layer, independent of
    the folder and of the outage. Under 18:00 all three land in one band."""
    ts = _ts(2026, 8, 14, 19, 0)
    begin, end = nightqc.night_band(ts)
    assert begin <= ts < end, "a stamp must fall INSIDE the band it is assigned to"
    assert begin == _ts(2026, 8, 14, 18)


def test_the_28_NIGHT_FIT_IS_UNTOUCHED_BY_THE_MOVED_EDGE():
    """The pre-stated control, and the reason it passes is worth recording.

    HRVDEX-ALL-NIGHT-SCOPE-2026-07-20 measured 28 nights: 27 started 21:00-23:00 and one at 01:06. All
    28 land in the same band under either edge — ⚠️ not because the edit is safe, but because those
    hours are OUTSIDE [18:00, 20:00), the only window this constant can reassign. A control whose
    population excludes the affected cases cannot police the change; the real impact is asserted in
    `test_a_19_00_DONNING_...` above and measured in `nightqc._NIGHT_BEGIN_H`'s own comment."""
    for h, m in [(21, 0), (22, 30), (23, 59), (1, 6)]:
        d = 15 if h < 18 else 14
        ts = _ts(2026, 8, d, h, m)
        anchor = nightqc.night_band(ts)[0]
        expected = _ts(2026, 8, 14, 18)
        assert anchor == expected, f"{h:02d}:{m:02d} changed band"


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
    assert v["span_sec"] < (s1 - s0) / 1.5, v  # roughly halved, not merely trimmed
    assert 0.0 < v["row_fraction"] < 1.0, v
    assert v["begin"] == round(_ts(2026, 8, 15, 18))  # the evening the night began (edge moved 20->18)


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
    v = nightqc.night_view(
        (s0, s0 + 3600), [{"span_sec": 3600, "rows": 9}, {"session": s0, "span_sec": 3600, "rows": 1}]
    )
    assert v["rows"] == 1  # only the stamped file contributes


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
    assert s["night"] == "2026-08-15", s["night"]  # still the folder date, still a string
    assert "night_window" in s
    assert s["night_window"] is None or isinstance(s["night_window"], dict)


# ── Level B survivors handed over by the QC author (#1307's advisory mutation gate). Three clusters,
# ── each a BOUNDARY the existing fixtures step over rather than land on.


def test_span_at_exactly_the_minimum_is_judgeable(tmp_path, _tz):
    """`_MIN_SPAN_SEC` is a FLOOR, not a bar to clear.

    `span = span if span >= _MIN_SPAN_SEC else None` — at exactly the floor the span IS judgeable, and
    every existing fixture uses 1000 s, stepping over the boundary rather than landing on it. The `>=`
    -> `>` mutant survives them all: it only changes behaviour for a span of exactly 300 s, which is
    reachable (a 5-minute capture) and turns a real coverage number into `unknown`."""
    night = str(tmp_path / "2026-07-19")
    os.makedirs(night)
    base = _stamp_epoch()
    ecg = _cap(night, "Polar_H10_02849638_20260719220000_ECG.txt", 39000)  # 130 Hz x 300 s -> exactly 1.0
    hr = _cap(night, "Polar_H10_02849638_20260719220000_HR.txt", 300)
    _utime(hr, base)
    _utime(ecg, base + nightqc._MIN_SPAN_SEC)
    s = _summarize_floating(night, [{"name": "H10", "device_id": "02849638", "streams": ["ecg", "hr"]}])
    assert s["span_sec"] == nightqc._MIN_SPAN_SEC
    h10 = next(d for d in s["devices"] if d["name"] == "H10")
    assert h10["coverage"].get("ecg") == 1.0, f"a span of exactly the floor must be judged: {h10['coverage']}"


def test_coverage_exactly_at_the_degraded_threshold_is_not_degraded(tmp_path, _tz):
    """`_DEGRADED_BELOW` is exclusive, and the rounding that feeds it is to 2 dp.

    Two mutants live on this one line pair and both need the SAME fixture to die: `cov < _DEGRADED_BELOW`
    -> `<=` (a stream at exactly the threshold would be flagged), and `round(..., 2)` -> `round(..., 3)`
    (which moves the reported number AND, here, pushes it across the threshold).

    Rows are chosen so the raw ratio is 0.495100 — `round(_, 2)` is 0.5 and NOT degraded, `round(_, 3)`
    is 0.495 and degraded. One fixture, opposite verdicts, so neither mutant can hide."""
    night = str(tmp_path / "2026-07-19")
    os.makedirs(night)
    base = _stamp_epoch()
    ecg = _cap(night, "Polar_H10_02849638_20260719220000_ECG.txt", 64363)  # 64363 / (130*1000) = 0.495100
    hr = _cap(night, "Polar_H10_02849638_20260719220000_HR.txt", 1000)
    _utime(hr, base)
    _utime(ecg, base + 1000)
    s = _summarize_floating(night, [{"name": "H10", "device_id": "02849638", "streams": ["ecg", "hr"]}])
    assert s["span_sec"] == 1000
    h10 = next(d for d in s["devices"] if d["name"] == "H10")
    assert h10["coverage"]["ecg"] == 0.5, f"2 dp rounding: {h10['coverage']}"
    assert not any("ecg" in g for g in s["degraded"]), f"exactly at the threshold is not below it: {s['degraded']}"


def _cap_timed(night, name, rows, hz, t0_ns=1_000_000_000_000):
    """A capture file carrying REAL device timestamps, so `measured_hz` can read a rate off it.

    `_cap` writes `i;i` rows with no clock, which is fine for row-count coverage but makes the
    measured rate unsayable — `measured_hz` reads the `sensor timestamp [ns]` column deliberately (the
    DEVICE clock, not the host stamp, which is back-timed across each packet).

    ⚠️ THE HOST COLUMN IS A CONSTANT PLACEHOLDER, deliberately left as one. Only the device column is
    read here, and no real capture file could look like this: a host clock that never moves across 130,000
    rows is not a clock. It is left because `nightqc.recover_writer_offset` must not believe it — reading
    this file's last host stamp makes a night vote a writer offset of 5,804,100 s (67 days) with a clean
    majority behind it, and the defence belongs in production, where `_OFFSET_MAX_ABS_SEC` refuses a vote
    on its MAGNITUDE. Making the fixture honest instead was measured: it fixed nothing the bound had not
    already fixed, tripled this suite's runtime and emitted 3.4 M deprecation warnings."""
    p = os.path.join(night, name)
    step = int(round(1e9 / hz))
    with open(p, "w") as fh:
        fh.write("Phone timestamp;sensor timestamp [ns];channel 0\n")
        for i in range(rows):
            fh.write(f"2026-07-19T00:00:00.000;{t0_ns + i * step};{i}\n")
    return p


def test_coverage_judges_against_the_MEASURED_rate_not_the_configured_one(tmp_path, _tz):
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
    night = str(tmp_path / "2026-07-19")
    os.makedirs(night)
    base = _stamp_epoch()
    ecg = _cap_timed(night, "Polar_H10_02849638_20260719220000_ECG.txt", 130000, 130.0)
    hr = _cap(night, "Polar_H10_02849638_20260719220000_HR.txt", 1000)
    _utime(hr, base)
    _utime(ecg, base + 1000)
    dev = [{"name": "H10", "device_id": "02849638", "streams": ["ecg", "hr"], "rates": {"ecg": 260}}]
    rr = {(r["device"], r["stream"]): r.get("measured_hz") for r in nightqc.rate_reality(night, dev)}
    assert rr.get(("H10", "ecg")) is not None, f"the fixture must yield a measurable rate: {rr}"
    s = _summarize_floating(night, dev)
    h10 = next(d for d in s["devices"] if d["name"] == "H10")
    assert h10["coverage"]["ecg"] == 1.0, (
        f"judged against the CONFIGURED 260 Hz this reads 0.5; against the measured 130 Hz it is full: "
        f"{h10['coverage']}"
    )


def test_a_device_without_a_name_is_keyed_by_its_device_id(tmp_path, _tz):
    """`name = d.get("name") or did` — a device may carry no name, and then its ID IS its name.

    That fallback is what `_measured_hz_of` is keyed on, so `did = d.get("device_id")` -> `did = None`
    is invisible to every fixture whose devices are named: the name wins and the ID is never consulted.
    A nameless device is the only shape that reaches it, and there the null ID collapses the lookup key
    and coverage silently falls back to the CONFIGURED rate — the same observable as the rest of the
    rate-reality cluster, reached through a different door."""
    night = str(tmp_path / "2026-07-19")
    os.makedirs(night)
    base = _stamp_epoch()
    ecg = _cap_timed(night, "Polar_H10_02849638_20260719220000_ECG.txt", 130000, 130.0)
    _utime(ecg, base + 1000)
    hr = _cap(night, "Polar_H10_02849638_20260719220000_HR.txt", 1000)
    _utime(hr, base)
    dev = [{"device_id": "02849638", "streams": ["ecg", "hr"], "rates": {"ecg": 260}}]  # no "name"
    s = _summarize_floating(night, dev)
    d0 = s["devices"][0]
    assert d0["name"] == "02849638", f"a nameless device is identified by its ID: {d0['name']}"
    assert d0["coverage"]["ecg"] == 1.0, (
        f"keyed by the ID, the measured 130 Hz is found and coverage is full; with a null ID the key "
        f"collapses and it falls back to the configured 260 Hz: {d0['coverage']}"
    )


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
    assert polar["components_ms"]["quantum"] == pytest.approx(
        1.0 / math.sqrt(12), abs=1e-3
    )  # published rounded to 3 dp


def test_the_delivery_term_is_the_ROBUST_sigma_not_the_raw_iqr():
    u = nightqc.timing_uncertainty({"iqr_ms": 13.49})
    assert u["components_ms"]["delivery"] == pytest.approx(10.0, abs=0.01)  # 13.49 / 1.349


def test_terms_combine_in_QUADRATURE_not_by_addition():
    u = nightqc.timing_uncertainty({"iqr_ms": 1.349}, quantised=True)  # delivery 1.0, quantum 288.675
    d, q = u["components_ms"]["delivery"], u["components_ms"]["quantum"]
    assert u["u_ms"] == pytest.approx(math.sqrt(d * d + q * q), abs=1e-3)
    assert u["u_ms"] < d + q  # addition would be larger


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
    u = nightqc.timing_uncertainty({"iqr_ms": 1349.0})  # delivery 1000 vs quantum 0.289
    assert u["dominant_share"] > 0.999
    d, q = u["components_ms"]["delivery"], u["components_ms"]["quantum"]
    assert u["dominant_share"] == pytest.approx(d * d / (d * d + q * q), abs=1e-6)


def _arrival_night(tmp_path, n=400, base_s=0.5):
    """A real `*_PMDARRIVAL.csv` with a crystal-scale wobble on the device axis — the same shape
    `test_jitterfloor` plants — so `arrival_quality` has a stream to judge. An exact synthetic clock
    is a DRAWN axis and would be refused, which is correct and useless here."""
    d = tmp_path / "2026-08-15"
    d.mkdir()
    wobble = (0.31, -0.17, 0.23, -0.29, 0.11, -0.37, 0.19, -0.13)
    jitter = (3, -3)
    lines = ["Phone timestamp;device;meas;first_sensor_ns;last_sensor_ns;n_samples"]
    for i in range(n):
        host_s = i * base_s + jitter[i % 2] / 1000.0
        dev_ns = int(i * base_s * 1e9 + wobble[i % 8] * 1e6)
        stamp = "2026-08-15T02:%02d:%02d.%03d" % (int(host_s // 60), int(host_s % 60), int((host_s * 1000) % 1000))
        lines.append("%s;Polar H10 02849638;ecg;%d;%d;73" % (stamp, dev_ns, dev_ns))
    (d / "Polar_H10_02849638_20260815024240_PMDARRIVAL.csv").write_text("\n".join(lines) + "\n")
    return d


def test_the_budget_reaches_the_per_stream_record(tmp_path):
    """Wired, not merely defined — the defect this repo keeps finding one layer up.
    ⚠️ Until 2026-09-21 this test wrote an `_ECG.csv` and asserted over `arrival_quality`'s rows —
    which lists only `*_PMDARRIVAL.csv`, so `rows == []` and `all()` was TRUE OVER NOTHING. It now
    plants a real arrival file and pins that a row exists before pinning what it carries."""
    rows = nightqc.arrival_quality(str(_arrival_night(tmp_path)))
    assert len(rows) == 1, rows
    assert "u_time" in rows[0], rows[0]


def test_stability_provenance_reaches_the_qc_record(tmp_path):
    """ALLAN-STABILITY-GAPS §2.3, at the level a reader meets it: the per-stream QC record's
    `stability` block names its tau0, n, span, estimator and version — not only in `allan.py`."""
    rows = nightqc.arrival_quality(str(_arrival_night(tmp_path)))
    assert len(rows) == 1
    st = rows[0]["stability"]
    assert st["ok"] is True, st
    for k in ("tau0", "n", "span_s", "estimator", "min_terms", "span_multiple", "version"):
        assert k in st, k
    assert st["n"] == 400 and st["estimator"] == "overlapping-adev"
    # §2.2 step 2a reaches the record too: the instants were passed, so the hole policy is stated
    for k in ("segments", "dropped_intervals", "pooled"):
        assert k in st, k
    assert st["segments"] == 1 and st["pooled"] is False  # this fixture has no hole; see the gap test


# ── ppg2w_contact — the ring's independent coupling vote ───────────────────────────────────────────
# Constants are labelled MEASURED vs CHOSEN at the definition; these tests plant both populations the
# thresholds were measured on and the refusal paths the block must take instead of fabricating. An epoch is
# ONE SECOND OF CLOCK (each row's stamp to the second) — the fixed 100-row epoch it replaced put the doff
# hours late once the stream ran at ~199 rows/s (2026-08-23 on), and a test that only asked `doff_at is not
# None` let that ship. So the doff second is asserted EXACTLY here, at both measured rates.
_T0 = datetime(2026, 1, 1, 0, 0, 0)
RING_HDR_NQ = "Phone timestamp;sensor timestamp [ns];channel 0;channel 1;motion\n"


def _secs(n_rows, per_sec=100, t0=_T0):
    """Each row's phone stamp to the second, at `per_sec` rows per second."""
    return [(t0 + timedelta(seconds=i // per_sec)).isoformat(timespec="seconds") for i in range(n_rows)]


def _worn_rows(n_sec, ratio=1.1, ch1=1_500_000, per_sec=100):
    ch0 = []
    ch1s = []
    for i in range(n_sec * per_sec):
        ch1s.append(ch1 + (i % 7) * 100)  # small texture, well above the floor
        ch0.append(int(ch1s[-1] * ratio))
    return ch0, ch1s


def _off_rows(n_sec, per_sec=100):
    # The measured off-finger signature: ch0 rails, ch1 collapses to ~10^2 counts.
    n = n_sec * per_sec
    return [3_400_000] * n, [150 + (i % 5) for i in range(n)]


def test_ppg2w_a_worn_night_reports_its_band_and_zero_off_epochs():
    ch0, ch1 = _worn_rows(120, ratio=1.1)
    b = nightqc.ppg2w_contact(ch0, ch1, _secs(len(ch0)))
    assert b["epochs"] == 120 and b["off_epochs_pct"] == 0.0
    assert b["off_runs_sustained"] == 0
    assert b["tail_off"] is False and b["tail_start"] is None
    assert abs(b["worn_ratio_median"] - 1.1) < 0.01
    assert b["worn_ratio_iqr"] < 0.01


def test_ppg2w_a_doffed_tail_is_flagged_with_its_run_length_and_its_first_second():
    w0, w1 = _worn_rows(100)
    o0, o1 = _off_rows(30)
    b = nightqc.ppg2w_contact(w0 + o0, w1 + o1, _secs(len(w0) + len(o0)))
    assert b["tail_off"] is True
    assert b["trailing_off_epochs"] == 30
    assert b["tail_start"] == "2026-01-01T00:01:40"  # second 100: where the off-run began
    assert b["off_runs_sustained"] == 1
    assert abs(b["off_epochs_pct"] - 100 * 30 / 130) < 0.1


def test_ppg2w_an_epoch_is_a_SECOND_at_any_row_rate():
    # 2026-08-23 on the stream ran ~199 rows/s: 100 s worn + 30 s off must still be 130 one-second epochs with
    # the doff at second 100 — the fixed-row epoch read this as 260 epochs and put the doff at second 200.
    w0, w1 = _worn_rows(100, per_sec=199)
    o0, o1 = _off_rows(30, per_sec=199)
    b = nightqc.ppg2w_contact(w0 + o0, w1 + o1, _secs(len(w0) + len(o0), per_sec=199))
    assert b["epochs"] == 130 and b["trailing_off_epochs"] == 30
    assert b["tail_start"] == "2026-01-01T00:01:40"


def test_ppg2w_back_timed_stamps_that_step_back_across_a_second_still_make_one_epoch_per_second():
    # Rows are back-timed per frame, so a frame can carry stamps from the previous second after rows of the
    # next one. Grouping CONSECUTIVE labels split each second into several epochs (60 478 "epochs" in a
    # 20 859 s file); the second's VALUE is the epoch.
    w0, w1 = _worn_rows(70)
    secs = _secs(len(w0))
    for k in range(150, len(secs), 100):  # every second boundary, a row from the one before
        secs[k], secs[k - 1] = secs[k - 1], secs[k]
    b = nightqc.ppg2w_contact(w0, w1, secs)
    assert b["epochs"] == 70


def test_ppg2w_ratio_out_of_band_is_off_even_with_ch1_above_the_floor():
    # The CHOSEN band is load-bearing on its own: bright but decoupled channels are not "worn".
    ch0, ch1 = _worn_rows(80, ratio=5.0)  # ch1 healthy, ratio far outside [0.5, 3]
    b = nightqc.ppg2w_contact(ch0, ch1, _secs(len(ch0)))
    assert b["off_epochs_pct"] == 100.0
    assert b["worn_ratio_median"] is None  # nothing qualified as worn…
    assert b["worn_ratio_iqr"] is None  # …so the band is ABSENT, not fabricated from off rows


def test_ppg2w_an_epoch_is_decided_by_its_MAJORITY_not_one_glitch_row():
    ch0, ch1 = _worn_rows(70)
    ch1[500] = 0  # one dead row inside an otherwise worn second
    b = nightqc.ppg2w_contact(ch0, ch1, _secs(len(ch0)))
    assert b["off_epochs_pct"] == 0.0
    ch1[500:549] = [0] * 49  # 49 of that second's 100 rows: still a minority
    assert nightqc.ppg2w_contact(ch0, ch1, _secs(len(ch0)))["off_epochs_pct"] == 0.0
    ch1[500:551] = [0] * 51  # 51: the majority, so that second is off
    assert nightqc.ppg2w_contact(ch0, ch1, _secs(len(ch0)))["off_epochs_pct"] == round(100 / 70, 2)


def test_ppg2w_under_a_minute_refuses_rather_than_reporting():
    ch0, ch1 = _worn_rows(nightqc._PPG2W_MIN_EPOCHS - 1)
    assert nightqc.ppg2w_contact(ch0, ch1, _secs(len(ch0))) is None
    ch0, ch1 = _worn_rows(nightqc._PPG2W_MIN_EPOCHS)
    assert nightqc.ppg2w_contact(ch0, ch1, _secs(len(ch0)))["epochs"] == nightqc._PPG2W_MIN_EPOCHS


def _write_ppg2w(path, ch0, ch1, per_sec=100, t0=_T0, header_again_at=None, torn_at=None):
    hdr = "Phone timestamp;sensor timestamp [ns];channel 0;channel 1;motion\n"
    with open(path, "w") as f:
        f.write("# timebase=host-disciplined\n" + hdr)
        for i, (a, b) in enumerate(zip(ch0, ch1)):
            stamp = (t0 + timedelta(seconds=i / per_sec)).isoformat(timespec="milliseconds")
            f.write(f"{stamp};0;{a};{b};0\n")
            if i == header_again_at:
                f.write(hdr)  # mid-file repeated header — the rotation artifact
            if i == torn_at:
                f.write("bad;row\n")  # a truncated row — rotation tears mid-line too


def test_ppg2w_quality_walks_a_night_places_the_doff_on_the_clock_and_keeps_refusals_visible(tmp_path):
    worn = tmp_path / "Wellue_O2Ring-S_TEST_20260101000000_PPG2W.txt"
    w0, w1 = _worn_rows(100, per_sec=199)
    o0, o1 = _off_rows(30, per_sec=199)
    _write_ppg2w(worn, w0 + o0, w1 + o1, per_sec=199, header_again_at=5000)
    short = tmp_path / "Wellue_O2Ring-S_TEST_20260101010000_PPG2W.txt"
    with open(short, "w") as f:
        f.write(
            "Phone timestamp;sensor timestamp [ns];channel 0;channel 1;motion\n2026-01-01T01:00:00.000;0;100;100;0\n"
        )
    out = nightqc.ppg2w_contact_quality(str(tmp_path))
    assert [b["file"] for b in out] == [worn.name, short.name]
    assert out[0]["usable"] is True and out[0]["epochs"] == 130
    assert out[0]["tail_off"] is True and out[0]["doff_at"] == "2026-01-01T00:01:40"  # EXACT, at 199 rows/s
    assert "tail_start" not in out[0]  # the internal label is consumed, only doff_at is published
    assert out[1]["usable"] is False and "under" in out[1]["reason"]


def test_ppg2w_quality_is_EMPTY_when_the_stream_was_never_captured(tmp_path):
    assert nightqc.ppg2w_contact_quality(str(tmp_path)) == []
    assert nightqc.ppg2w_contact_quality(str(tmp_path / "absent")) == []


def test_ppg2w_stamps_that_are_not_times_cannot_be_placed_on_a_clock_so_the_block_refuses(tmp_path):
    # Every row's second is its stamp: 'notatime' is one "second", so the file cannot establish a minute and
    # is refused — it is not reported as usable with a doff it cannot place.
    p = tmp_path / "Wellue_O2Ring-S_TEST_20260101000000_PPG2W.txt"
    w0, w1 = _worn_rows(100)
    with open(p, "w") as f:
        f.write("Phone timestamp;sensor timestamp [ns];channel 0;channel 1;motion\n")
        for a, b in zip(w0, w1):
            f.write(f"notatime;0;{a};{b};0\n")
    out = nightqc.ppg2w_contact_quality(str(tmp_path))
    assert out[0]["usable"] is False and "under" in out[0]["reason"]


def test_ppg2w_a_tail_label_that_is_not_a_time_yields_doff_at_None(monkeypatch, tmp_path):
    p = tmp_path / "Wellue_O2Ring-S_TEST_20260101000000_PPG2W.txt"
    w0, w1 = _worn_rows(100)
    o0, o1 = _off_rows(30)
    _write_ppg2w(p, w0 + o0, w1 + o1)
    real = nightqc.ppg2w_contact
    monkeypatch.setattr(nightqc, "ppg2w_contact", lambda a, b, s: {**real(a, b, s), "tail_start": "not-a-time"})
    assert nightqc.ppg2w_contact_quality(str(tmp_path))[0]["doff_at"] is None


def test_ppg2w_an_unreadable_entry_is_skipped_not_fatal(tmp_path):
    (tmp_path / "Wellue_O2Ring-S_TEST_20260101000000_PPG2W.txt").mkdir()  # a DIRECTORY with the name
    assert nightqc.ppg2w_contact_quality(str(tmp_path)) == []


def test_ppg2w_an_off_run_that_ENDS_midsession_is_counted_and_is_not_a_doffing():
    # Covers the run-closing branch: worn -> off -> worn. The wearer adjusted the ring and put it back;
    # that is one sustained off-run and NOT a doffing, so tail_off stays False and no doff time exists.
    w0a, w1a = _worn_rows(70)
    o0, o1 = _off_rows(15)
    w0b, w1b = _worn_rows(70)
    ch0, ch1 = w0a + o0 + w0b, w1a + o1 + w1b
    b = nightqc.ppg2w_contact(ch0, ch1, _secs(len(ch0)))
    assert b["off_runs_sustained"] == 1
    assert b["tail_off"] is False and b["tail_start"] is None
    assert b["trailing_off_epochs"] == 0


def _rows_of(pattern, per_sec=1):
    """ch0/ch1/secs from a per-second list of (ch0, ch1) rows — one list entry per row, `per_sec` rows a second."""
    ch0 = [a for a, _ in pattern]
    ch1 = [b for _, b in pattern]
    return ch0, ch1, _secs(len(pattern), per_sec=per_sec)


_ON, _OFF = (1_650_000, 1_500_000), (3_400_000, 150)


def test_ppg2w_the_row_count_is_the_SHORTEST_of_the_three_lists():
    ch0, ch1 = _worn_rows(70)
    secs = _secs(len(ch0))
    cut = 65 * 100
    for lists in ((ch0[:cut], ch1, secs), (ch0, ch1[:cut], secs), (ch0, ch1, secs[:cut])):
        assert nightqc.ppg2w_contact(*lists)["epochs"] == 65


def test_ppg2w_a_second_is_off_only_when_MORE_than_half_its_rows_are():
    one_off = [_OFF, _ON, _ON] * 70  # 1 of 3 rows off in every second -> every second worn
    two_off = [_OFF, _OFF, _ON] * 70  # 2 of 3 -> every second off
    half = ([_OFF] * 50 + [_ON] * 50) * 70  # exactly half of 100 -> NOT more than half -> worn
    assert nightqc.ppg2w_contact(*_rows_of(one_off, per_sec=3))["off_epochs_pct"] == 0.0
    assert nightqc.ppg2w_contact(*_rows_of(two_off, per_sec=3))["off_epochs_pct"] == 100.0
    assert nightqc.ppg2w_contact(*_rows_of(half, per_sec=100))["off_epochs_pct"] == 0.0


def test_ppg2w_the_ratio_band_is_inclusive_at_both_edges_and_the_ch1_floor_is_exclusive():
    def pct(a, b):
        return nightqc.ppg2w_contact(*_rows_of([(a, b)] * 70))["off_epochs_pct"]

    floor = nightqc.PPG2W_CH1_FLOOR
    assert pct(floor, floor) == 100.0  # ch1 AT the floor is not above it
    assert pct(floor + 1, floor + 1) == 0.0
    assert pct(1_000_000, 2_000_000) == 0.0  # ratio exactly PPG2W_RATIO_LO (0.5)
    assert pct(3_000_000, 1_000_000) == 0.0  # ratio exactly PPG2W_RATIO_HI (3.0)
    assert pct(800_000, 2_000_000) == 100.0  # 0.4, under the band


def test_ppg2w_off_runs_are_counted_at_their_exact_length():
    # 9 (short, at the START) · 10 (exactly sustained) · 9 (short, after worn) -> exactly ONE sustained run.
    seq = [_OFF] * 9 + [_ON] * 20 + [_OFF] * 10 + [_ON] * 20 + [_OFF] * 9 + [_ON] * 20
    b = nightqc.ppg2w_contact(*_rows_of(seq))
    assert b["off_runs_sustained"] == 1 and b["tail_off"] is False and b["trailing_off_epochs"] == 0
    tail = nightqc.ppg2w_contact(*_rows_of([_ON] * 60 + [_OFF] * nightqc._PPG2W_RUN_EPOCHS))
    assert tail["tail_off"] is True and tail["trailing_off_epochs"] == nightqc._PPG2W_RUN_EPOCHS  # exactly the bar


def test_ppg2w_the_worn_band_is_reported_to_three_places_from_the_exact_quartiles():
    # 100 worn seconds, ratios 1.00041 + k * 0.0001234: median r[50] = 1.00658, IQR r[75] - r[25] = 0.00617.
    rows = [(round(10_000_000 * (1.00041 + k * 0.0001234)), 10_000_000) for k in reversed(range(100))]
    b = nightqc.ppg2w_contact(*_rows_of(rows))
    assert b["worn_ratio_median"] == 1.007
    assert b["worn_ratio_iqr"] == 0.006
    # m == 4 is the smallest band that has an IQR: r[3] - r[1] over four worn rows among 60 seconds.
    four = [(1_100_000, 1_000_000), (1_200_000, 1_000_000), (1_300_000, 1_000_000), (1_400_000, 1_000_000)]
    b = nightqc.ppg2w_contact(*_rows_of(four + [_OFF] * 56))
    assert b["worn_ratio_iqr"] == 0.2 and b["worn_ratio_median"] == 1.3


def test_ppg2w_quality_an_unusable_session_does_not_end_the_night(tmp_path):
    (tmp_path / "Wellue_O2Ring-S_TEST_20260101000000_PPG2W.txt").write_text(
        RING_HDR_NQ + "2026-01-01T00:00:00.000;0;1;1;0\n"
    )
    w0, w1 = _worn_rows(70)
    _write_ppg2w(tmp_path / "Wellue_O2Ring-S_TEST_20260101010000_PPG2W.txt", w0, w1, t0=_T0 + timedelta(hours=1))
    out = nightqc.ppg2w_contact_quality(str(tmp_path))
    assert [b["usable"] for b in out] == [False, True]


def test_ppg2w_quality_reads_channel_0_and_channel_1_from_their_own_columns(tmp_path):
    ch0, ch1 = _worn_rows(70, ratio=5.0)  # ch1 healthy, ch0 five times it: out of band
    _write_ppg2w(tmp_path / "Wellue_O2Ring-S_TEST_20260101000000_PPG2W.txt", ch0, ch1)
    assert nightqc.ppg2w_contact_quality(str(tmp_path))[0]["off_epochs_pct"] == 100.0


def test_ppg2w_quality_a_byte_that_is_not_utf8_does_not_lose_the_session(tmp_path):
    p = tmp_path / "Wellue_O2Ring-S_TEST_20260101000000_PPG2W.txt"
    w0, w1 = _worn_rows(70)
    _write_ppg2w(p, w0, w1)
    p.write_bytes(p.read_bytes() + b"2026-01-01T00:01:10.000;0;1650000;1500000;\xff\n")
    assert nightqc.ppg2w_contact_quality(str(tmp_path))[0]["usable"] is True


def test_ppg2w_quality_an_unreadable_session_is_LOGGED_by_name_with_its_exception(tmp_path, caplog):
    name = "Wellue_O2Ring-S_TEST_20260101000000_PPG2W.txt"
    (tmp_path / name).mkdir()
    w0, w1 = _worn_rows(70)
    later = "Wellue_O2Ring-S_TEST_20260101010000_PPG2W.txt"  # sorts AFTER the unreadable one
    _write_ppg2w(tmp_path / later, w0, w1, t0=_T0 + timedelta(hours=1))
    with caplog.at_level(logging.WARNING):
        assert [b["file"] for b in nightqc.ppg2w_contact_quality(str(tmp_path))] == [later]
    (rec,) = [r for r in caplog.records if "unreadable" in r.getMessage()]
    assert name in rec.getMessage() and "ABSENT rather than poor" in rec.getMessage()
    assert rec.exc_info and rec.exc_info[0] is not None


def test_ppg2w_a_truncated_row_is_skipped_like_the_repeated_header(tmp_path):
    p = tmp_path / "Wellue_O2Ring-S_TEST_20260101000000_PPG2W.txt"
    w0, w1 = _worn_rows(70)
    _write_ppg2w(p, w0, w1, torn_at=100)
    out = nightqc.ppg2w_contact_quality(str(tmp_path))
    assert out[0]["usable"] is True and out[0]["off_epochs_pct"] == 0.0 and out[0]["epochs"] == 70


# ── ring-clock drift summary (O2Ring _rtclog.csv → nightly verdict) ─────────────────────────────────
def _write_rtclog(tmp_path, rows, name="Wellue_O2Ring-S_S8AW2100_20260819220000_rtclog.csv"):
    hdr = "Phone timestamp;event;rtc_offset_s;battery_state;battery_level;battery_raw2;battery_raw3\n"
    p = tmp_path / name
    p.write_text(hdr + "".join(r + "\n" for r in rows), encoding="utf-8")
    return str(p)


def test_rtc_drift_summary_rolls_reads_into_a_verdict(tmp_path):
    p = _write_rtclog(
        tmp_path,
        [
            "2026-08-19T22:00:00.000;read;1.0;;;;",
            "2026-08-19T22:00:00.000;push;;;;;",  # push has a blank offset — not counted as a read
            "2026-08-20T05:20:00.000;read;3.4;;;;",
        ],
    )
    r = nightqc.rtc_drift_summary(p)
    assert r["reads"] == 2
    assert r["first_offset_s"] == 1.0 and r["last_offset_s"] == 3.4
    assert r["drift_s"] == 2.4  # free-run since the last push
    assert r["span_h"] == 7.3
    assert r["pushes"] == 1 and r["resets"] == 0


def test_rtc_drift_summary_counts_a_battery_reset(tmp_path):
    p = _write_rtclog(
        tmp_path,
        [
            "2026-08-19T22:00:00.000;read;0.0;;;;",
            "2026-08-20T01:00:00.000;reset-suspect;-151.0;;;;",  # a battery event: offset jumped
        ],
    )
    r = nightqc.rtc_drift_summary(p)
    assert r["resets"] == 1 and r["reads"] == 2  # reset-suspect carries an offset, so it counts
    assert r["drift_s"] == -151.0


def test_rtc_drift_summary_none_when_no_readback(tmp_path):
    # a log with only a push (offset blank) has nothing to summarise
    assert nightqc.rtc_drift_summary(_write_rtclog(tmp_path, ["2026-08-19T22:00:00.000;push;;;;;"])) is None
    assert nightqc.rtc_drift_summary(str(tmp_path / "nonexistent_rtclog.csv")) is None


def test_rtc_drift_summary_survives_a_torn_row(tmp_path):
    p = _write_rtclog(
        tmp_path,
        [
            "2026-08-19T22:00:00.000;read;0.5;;;;",
            "truncated",  # a torn tail must not crash the roll-up
            "2026-08-19T22:00:00.000;read;notanumber;;;;",  # nor a garbled offset
        ],
    )
    r = nightqc.rtc_drift_summary(p)
    assert r["reads"] == 1


def test_rtc_drift_summary_span_none_on_bad_stamp(tmp_path):
    p = _write_rtclog(
        tmp_path,
        [
            "notatimestamp;read;1.0;;;;",
            "alsobad;read;2.0;;;;",
        ],
    )
    r = nightqc.rtc_drift_summary(p)
    assert r["reads"] == 2 and r["span_h"] is None


def test_qc_digest_appends_ring_drift():
    summ = {
        "night": "2026-08-19",
        "devices": [
            {
                "name": "O2Ring",
                "coverage": {"spo2": 0.98},
                "rtc": {"reads": 3, "drift_s": 2.4, "span_h": 7.3, "resets": 0, "pushes": 1},
            }
        ],
    }
    line = nightqc.qc_digest(summ)
    assert "O2Ring 98%" in line and "RTC +2.4s" in line


def test_qc_digest_flags_a_battery_reset():
    summ = {
        "night": "n",
        "devices": [
            {
                "name": "O2Ring",
                "coverage": {"spo2": 0.9},
                "rtc": {"reads": 2, "drift_s": -151.0, "span_h": 3.0, "resets": 1, "pushes": 0},
            }
        ],
    }
    assert "1⚠reset" in nightqc.qc_digest(summ)


def test_qc_digest_omits_rtc_when_absent():
    summ = {"night": "n", "devices": [{"name": "H10", "coverage": {"ecg": 0.99}, "rtc": None}]}
    line = nightqc.qc_digest(summ)
    assert "H10 99%" in line and "RTC" not in line


def test_summarize_attaches_ring_rtc_drift(tmp_path, _tz):
    """The discovery path: a `_RTCLOG.csv` beside the ring's capture files is found by device id and
    rolled into that device's per-device entry — the false branch (no rtclog → rtc None) is already
    covered by every other summarize test.

    🔴 THIS FIXTURE USED TO SPELL THE FILE `_rtclog.csv`, LOWERCASE, and that is why the reader's
    case bug survived. `capture_filename` upper-cases every stream tag, so no such file has ever
    existed on the box — the fixture was written from the READER's string rather than the WRITER's
    output, so it exercised the matcher against its own assumption and could not fail. Measured
    2026-09-05: 29 real `_RTCLOG.csv` files on vigil that day, `rtc: null` for every device.
    A fixture must be spelled the way the producing code spells it."""
    night = str(tmp_path / "2026-07-19")
    os.makedirs(night)
    _cap(night, "Wellue_O2Ring-S_S8AW_20260719220000_SPO2.csv", 900)
    _cap(night, "Wellue_O2Ring-S_S8AW_20260719220000_PPG.txt", 8000)
    hdr = "Phone timestamp;event;rtc_offset_s;battery_state;battery_level;battery_raw2;battery_raw3\n"
    (tmp_path / "2026-07-19" / "Wellue_O2Ring-S_S8AW_20260719220000_RTCLOG.csv").write_text(
        hdr + "2026-07-19T22:00:00.000;read;0.0;;;;\n2026-07-20T05:00:00.000;read;1.0;;;;\n", encoding="utf-8"
    )
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
    dat = tmp_path / "d.dat"
    dat.write_bytes(b"\x00" * 100)
    csv = tmp_path / "s.csv"
    csv.write_text("Time,Oxygen Level\n", encoding="utf-8")
    assert nightqc.dat_timefit_summary(str(dat), str(csv), tool_path=str(tmp_path / "no-tool.mjs")) is None


def test_dat_timefit_summary_absent_when_node_missing(tmp_path):
    """A box without a `node` binary on PATH must not crash — subprocess.FileNotFoundError is caught
    by the try/except and the function returns None. Verified by pointing at a definitely-not-a-binary
    path."""
    dat = tmp_path / "d.dat"
    dat.write_bytes(b"\x00" * 100)
    csv = tmp_path / "s.csv"
    csv.write_text("Time,Oxygen Level\n", encoding="utf-8")
    tool = tmp_path / "fake-tool.mjs"
    tool.write_text("//", encoding="utf-8")
    assert (
        nightqc.dat_timefit_summary(str(dat), str(csv), node_bin=str(tmp_path / "no-such-node"), tool_path=str(tool))
        is None
    )


def test_dat_timefit_summary_parses_a_json_run(tmp_path, monkeypatch):
    """When the subprocess returns exit 0 with parseable JSON, `dat_timefit_summary` returns a trimmed
    verdict — `lag_s` comes off `chosenLagS`, `ok`/`reason`/`agree` are carried through, and the tool's
    own input sizes travel too."""
    import subprocess as _sp

    dat = tmp_path / "d.dat"
    dat.write_bytes(b"\x00" * 100)
    csv = tmp_path / "s.csv"
    csv.write_text("Time,Oxygen Level\n", encoding="utf-8")
    tool = tmp_path / "fake-tool.mjs"
    tool.write_text("//", encoding="utf-8")
    fake = _sp.CompletedProcess(
        args=[],
        returncode=0,
        stdout='{"ok":true,"converged":true,"reason":null,"chosenLagS":37,"agree":true,"datSec":900,"csvSec":900}\n',
        stderr="",
    )
    monkeypatch.setattr(nightqc.subprocess, "run", lambda *a, **k: fake)
    out = nightqc.dat_timefit_summary(str(dat), str(csv), tool_path=str(tool))
    assert out == {
        "ok": True,
        "converged": True,
        "reason": None,
        "lag_s": 37,
        "agree": True,
        "dat_sec": 900,
        "csv_sec": 900,
    }


def test_dat_timefit_summary_carries_refusal_reason(tmp_path, monkeypatch):
    """Exit 1 with an `ok:false` JSON is a REFUSAL by the tool — the reason is carried through so a
    caller (qc_digest) can decide whether to surface it."""
    import subprocess as _sp

    dat = tmp_path / "d.dat"
    dat.write_bytes(b"\x00" * 100)
    csv = tmp_path / "s.csv"
    csv.write_text("Time,Oxygen Level\n", encoding="utf-8")
    tool = tmp_path / "fake-tool.mjs"
    tool.write_text("//", encoding="utf-8")
    fake = _sp.CompletedProcess(
        args=[], returncode=1, stdout='{"ok":false,"reason":"no lag with enough overlap"}\n', stderr=""
    )
    monkeypatch.setattr(nightqc.subprocess, "run", lambda *a, **k: fake)
    out = nightqc.dat_timefit_summary(str(dat), str(csv), tool_path=str(tool))
    assert out is not None and out["ok"] is False and out["reason"].startswith("no lag")


def test_dat_timefit_summary_returns_none_on_a_crash(tmp_path, monkeypatch):
    """A non-{0,1} exit code from the tool is a SHAPE failure (Node crashed, missing runtime dep) —
    the function must swallow that and return None so a broken tool cannot red the digest."""
    import subprocess as _sp

    dat = tmp_path / "d.dat"
    dat.write_bytes(b"\x00" * 100)
    csv = tmp_path / "s.csv"
    csv.write_text("Time,Oxygen Level\n", encoding="utf-8")
    tool = tmp_path / "fake-tool.mjs"
    tool.write_text("//", encoding="utf-8")
    fake = _sp.CompletedProcess(args=[], returncode=139, stdout="", stderr="segfault")
    monkeypatch.setattr(nightqc.subprocess, "run", lambda *a, **k: fake)
    assert nightqc.dat_timefit_summary(str(dat), str(csv), tool_path=str(tool)) is None


def test_dat_timefit_summary_returns_none_on_timeout(tmp_path, monkeypatch):
    """A subprocess timeout is caught — the ordinary case on a huge .dat with a short deadline; the
    digest simply omits the .dat fit line rather than throwing."""
    import subprocess as _sp

    dat = tmp_path / "d.dat"
    dat.write_bytes(b"\x00" * 100)
    csv = tmp_path / "s.csv"
    csv.write_text("Time,Oxygen Level\n", encoding="utf-8")
    tool = tmp_path / "fake-tool.mjs"
    tool.write_text("//", encoding="utf-8")

    def _boom(*a, **k):
        raise _sp.TimeoutExpired(cmd="node", timeout=k.get("timeout", 30))

    monkeypatch.setattr(nightqc.subprocess, "run", _boom)
    assert nightqc.dat_timefit_summary(str(dat), str(csv), tool_path=str(tool)) is None


def test_summarize_attaches_the_dat_fit_when_both_sidecars_land(tmp_path, monkeypatch, _tz):
    """The discovery path inside summarize: a `_STORED.dat` (onboard pull) AND a `_SPO2.csv` (live)
    for the same ring → `datfit` attached to that device's entry. `dat_timefit_summary` itself is
    stubbed — the DISCOVERY is under test, and stubbing one level down (subprocess) left the test
    coupled to `../tools/o2ring-dat-timefit.mjs` existing on disk, which is false inside mutmut's
    `mutants/` copy: the default-derivation exists() check returned None before the subprocess stub
    was ever reached, and the mutation gate's baseline run failed on a test that passes everywhere
    else (found via #1929, pre-existing)."""
    night = str(tmp_path / "2026-07-19")
    os.makedirs(night)
    _cap(night, "Wellue_O2Ring-S_S8AW_20260719220000_SPO2.csv", 900)
    (tmp_path / "2026-07-19" / "Wellue_O2Ring-S_S8AW_20260719220000_STORED.dat").write_bytes(b"\x00" * 100)
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

    dat = tmp_path / "d.dat"
    dat.write_bytes(b"\x00" * 100)
    csv = tmp_path / "s.csv"
    csv.write_text("Time,Oxygen Level\n", encoding="utf-8")
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

    dat = tmp_path / "d.dat"
    dat.write_bytes(b"\x00" * 100)
    csv = tmp_path / "s.csv"
    csv.write_text("Time,Oxygen Level\n", encoding="utf-8")
    tool = tmp_path / "fake-tool.mjs"
    tool.write_text("//", encoding="utf-8")
    fake = _sp.CompletedProcess(args=[], returncode=0, stdout="{not json", stderr="")
    monkeypatch.setattr(nightqc.subprocess, "run", lambda *a, **k: fake)
    assert nightqc.dat_timefit_summary(str(dat), str(csv), tool_path=str(tool)) is None


def test_qc_digest_appends_the_dat_fit_line():
    """When a device carries a `datfit` alongside `rtc`, the digest gains a `.dat +Ns` note. On a
    well-behaved night the two agree within the .dat's 1 s quantum — no warning; when they disagree by
    more than that, a `⚠±Ns` flag surfaces on the same line so a reader cannot miss it."""
    # AGREE within 1 s — no warning
    ring_ok = {
        "name": "Ring",
        "coverage": {"spo2": 0.99},
        "rtc": {"reads": 3, "drift_s": 2.4, "span_h": 7.3, "resets": 0, "pushes": 1},
        "datfit": {"ok": True, "lag_s": 2, "agree": True},
    }
    line = nightqc.qc_digest({"night": "n", "devices": [ring_ok]})
    assert ".dat +2s" in line and "⚠" not in line
    # DISAGREE by >1 s — the flag surfaces beside the fit
    ring_bad = {
        "name": "Ring",
        "coverage": {"spo2": 0.99},
        "rtc": {"reads": 3, "drift_s": 0.0, "span_h": 7.3, "resets": 0, "pushes": 1},
        "datfit": {"ok": True, "lag_s": 5, "agree": True},
    }
    line = nightqc.qc_digest({"night": "n", "devices": [ring_bad]})
    assert ".dat +5s" in line and "⚠" in line


def test_qc_digest_dat_fit_without_a_readback_prints_plain():
    """A night can carry the .dat fit WITHOUT an RTC readback (old firmware, or the sidecar predates
    the readback). The fit still prints — it is a measurement on its own — but no disagreement flag
    can be computed, so none appears."""
    ring = {"name": "Ring", "coverage": {"spo2": 0.99}, "rtc": None, "datfit": {"ok": True, "lag_s": 4, "agree": True}}
    line = nightqc.qc_digest({"night": "n", "devices": [ring]})
    assert ".dat +4s" in line and "⚠" not in line and "RTC" not in line


def test_qc_digest_suppresses_an_unconverged_fit():
    """The tool's own #1657 rule, applied one level up: `ok` without `converged` is a single-legged
    lag — the two columns did not confirm each other — and printing it as `.dat +Ns` would hand the
    reader a number the tool itself refuses to call a measurement."""
    ring = {
        "name": "Ring",
        "coverage": {"spo2": 0.99},
        "rtc": None,
        "datfit": {"ok": True, "converged": False, "lag_s": 37, "agree": False},
    }
    line = nightqc.qc_digest({"night": "n", "devices": [ring]})
    assert ".dat" not in line


def test_qc_digest_trusts_ok_when_converged_is_absent():
    """An OLDER tool (before the converged flag) emits no such key; the parser carries None and the
    digest falls back to trusting `ok` — the pre-#1657 behaviour, rather than silently dropping every
    fit from a box with an older checkout."""
    ring = {
        "name": "Ring",
        "coverage": {"spo2": 0.99},
        "rtc": None,
        "datfit": {"ok": True, "converged": None, "lag_s": 4, "agree": True},
    }
    line = nightqc.qc_digest({"night": "n", "devices": [ring]})
    assert ".dat +4s" in line


def test_qc_digest_omits_dat_fit_when_absent():
    """A phone-captured night or a box without Node yields `datfit: None`; the digest must not print
    a hollow `.dat` note."""
    ring = {
        "name": "Ring",
        "coverage": {"spo2": 0.99},
        "rtc": {"reads": 3, "drift_s": 2.4, "span_h": 7.3, "resets": 0, "pushes": 1},
        "datfit": None,
    }
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

    night = str(tmp_path / "2026-07-24")
    os.makedirs(night)
    first = _dt.strptime("20260723213000", "%Y%m%d%H%M%S").timestamp()  # 21:30, the SMALLER half
    after = _dt.strptime("20260724010000", "%Y%m%d%H%M%S").timestamp()  # 01:00, the BIGGER half
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

    d21 = str(tmp_path / "2026-07-21")
    os.makedirs(d21)
    d22 = str(tmp_path / "2026-07-22")
    os.makedirs(d22)
    # ⚠️ YESTERDAY IS DELIBERATELY NON-CONTIGUOUS — it ends at 22:00, two hours before this session
    # opens, well past `_SESSION_GAP_SEC`. That is what makes `_pool` the ONLY thing that can pool it:
    # with `_pool` false the code falls through to `prev_probe_window`, which asks the neighbour and is
    # told no. A contiguous yesterday would be pooled either way, and the first version of this test
    # used one — so it passed under every mutant and killed nothing.
    y = _dt.strptime("20260721200000", "%Y%m%d%H%M%S").timestamp()  # runs 20:00 -> 22:00
    t = _dt.strptime("20260722000000", "%Y%m%d%H%M%S").timestamp()  # EXACTLY midnight
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

    d21 = str(tmp_path / "2026-07-21")
    os.makedirs(d21)
    d22 = str(tmp_path / "2026-07-22")
    os.makedirs(d22)
    y = _dt.strptime("20260721120000", "%Y%m%d%H%M%S").timestamp()  # midday yesterday — unrelated
    t = _dt.strptime("20260722000000", "%Y%m%d%H%M%S").timestamp() + nightqc._SESSION_GAP_SEC
    _utime(_cap(d21, "Polar_H10_02849638_20260721120000_HR.txt", 9999), y + 9999)
    _utime(_cap(d22, "Polar_H10_02849638_20260722010000_HR.txt", 2000), t + 2000)
    s = nightqc.summarize(d22, [{"name": "H10", "device_id": "02849638", "streams": ["hr"]}])
    assert s["searched_dirs"] == ["2026-07-22"], "exactly one gap-width out is NOT near-midnight"
    assert s["devices"][0]["streams"]["hr"] == 2000, "yesterday's unrelated sitting stays excluded"


def test_the_night_band_is_chosen_by_the_sessions_MIDPOINT(tmp_path):
    """Which band a gap is judged against comes from the judged session's MIDPOINT, not either end.

    It only matters for a session straddling `_NIGHT_BEGIN_H` — the hour `night_band` anchors on — and
    then it matters completely, because the two choices name different nights. A 14:00->20:00 session
    has its midpoint at 17:00 (band: yesterday 18:00 -> today 10:00) and its end at 20:00 (band: today
    18:00 -> tomorrow 10:00). An excluded 02:00 sitting is INSIDE the first and OUTSIDE the second, so
    the two disagree about whether this night has a hole.

    ⚠️ THE HOURS MOVED WITH THE CONSTANT (20 -> 18, owner ruling 2026-10-05) and had to: the old
    16:00->22:00 session straddled 20:00 and no longer straddles anything, so under the new edge both
    midpoint and end would pick the SAME band and the test would pass while testing nothing — a green
    that examined no disagreement. The property is unchanged; only the hours that exhibit it moved.

    Mutation found this untested: `(cur[0] + cur[1]) / 2.0` could become `(cur[1] + cur[1]) / 2.0` —
    silently judging against tomorrow's band — with the whole suite green."""
    from datetime import datetime as _dt

    night = str(tmp_path / "2026-07-22")
    os.makedirs(night)
    early = _dt.strptime("20260722020000", "%Y%m%d%H%M%S").timestamp()  # 02:00, the SMALL half
    main = _dt.strptime("20260722140000", "%Y%m%d%H%M%S").timestamp()  # 14:00 -> 20:00, straddles 18:00
    _utime(_cap(night, "Polar_H10_02849638_20260722020000_HR.txt", 1800), early + 1800)
    _utime(_cap(night, "Polar_H10_02849638_20260722140000_HR.txt", 21600), main + 21600)
    s = nightqc.summarize(night, [{"name": "H10", "device_id": "02849638", "streams": ["hr"]}])
    assert s["judged_session"]["rows"] == 21600, "the straddling session is the substantive one"
    assert s["gaps"], "the 02:00 sitting is excluded and must be reported"
    # 02:00 lies inside the MIDPOINT's band and outside the END's. The midpoint is correct: the session
    # began at 14:00, so the night it belongs to is the one that opened at 18:00 YESTERDAY.
    assert "[in-night]" in s["gaps"][0], "judged against the midpoint's band, 02:00 is a hole"
    assert s["ok"] is False, "a hole in the judged night cannot grade green"


# ── §3.1 of CAPTURE-FILESET-RESUME: a resumed set and its fragmented twin must score identically ─────
def _resume_pair(tmp_path, gap_s):
    """Two night dirs describing the SAME real night: one file-set resumed across a reconnect, and the
    fragments the pre-resume writer would have produced instead. Same rows, same wall-clock extent."""
    from datetime import datetime as _dt

    # The mtime must be consistent with the FILENAME STAMP — the session interval is [stamp, mtime],
    # so an mtime on an unrelated epoch yields no span at all and the coverage dict comes back empty.
    t0 = _dt.strptime("20260719220000", "%Y%m%d%H%M%S").timestamp()
    half, tail = 1800, 1800
    resumed = str(tmp_path / "resumed" / "2026-07-19")
    os.makedirs(resumed)
    _utime(_cap(resumed, "Polar_H10_02849638_20260719220000_HR.txt", half + tail), t0 + half + gap_s + tail)
    frag = str(tmp_path / "frag" / "2026-07-19")
    os.makedirs(frag)
    _utime(_cap(frag, "Polar_H10_02849638_20260719220000_HR.txt", half), t0 + half)
    # the second fragment opens `gap_s` after the first stopped writing
    stamp2 = time.strftime("%Y%m%d%H%M%S", time.localtime(t0 + half + gap_s))
    _utime(_cap(frag, f"Polar_H10_02849638_{stamp2}_HR.txt", tail), t0 + half + gap_s + tail)
    return resumed, frag


def _hr_coverage(night):
    # `_resume_pair` builds t0 with `.timestamp()` and stamp2 with `time.localtime`, so this fixture is
    # in the READER's frame and declares it — a one-file night casts one vote and cannot state a zone.
    s = _summarize(night, _devices())
    return next(d for d in s["devices"] if d["name"] == "H10")["coverage"].get("hr"), s


def test_a_resumed_set_and_its_fragmented_twin_score_the_SAME_coverage(tmp_path):
    """CAPTURE-FILESET-RESUME §3.1, the brief's one open work item.

    Whether the writer resumed across a short reconnect or minted a fresh set, the night is the same
    night: the same rows arrived over the same wall-clock extent. If coverage disagrees, then adopting
    resume silently re-scores every historical night against its own successor — a change in the
    NUMBER with no change in the DATA, which is the shape this suite exists to refuse."""
    resumed, frag = _resume_pair(tmp_path, gap_s=120)  # inside the 300 s resume window
    cov_r, s_r = _hr_coverage(resumed)
    cov_f, s_f = _hr_coverage(frag)
    assert s_r["files"] == 1 and s_f["files"] == 2, "the two nights must actually differ in file count"
    assert cov_r is not None, "a coverage of None would make the equality below vacuous"
    assert 0.5 < cov_r < 1.5, f"the fixture should score a plausible ~1.0, got {cov_r}"
    assert cov_r == cov_f, f"resumed {cov_r} vs fragmented {cov_f} — same data, different number"


def test_the_equality_is_SENSITIVE_to_the_span_it_asserts(tmp_path):
    """Anti-vacuity with teeth. The test above passes if `summarize` is span-blind, so this proves the
    assertion can move: separate the fragments by MORE than the session gap and the second becomes a
    different session, which `summarize` scopes away — so the coverage MUST differ. If this ever goes
    equal, the equality above is measuring nothing."""
    resumed, frag = _resume_pair(tmp_path, gap_s=int(nightqc._SESSION_GAP_SEC) + 600)
    cov_r, _ = _hr_coverage(resumed)
    cov_f, s_f = _hr_coverage(frag)
    assert s_f["files"] == 2, "still two files; only their separation changed"
    assert cov_r != cov_f, (
        f"a fragment beyond the session gap must NOT score as the resumed night ({cov_r} == {cov_f}) "
        "— if these are equal, coverage is ignoring the span and the equality test proves nothing"
    )


# ── a configured stream name is not always its file tag (2026-09-05) ─────────────────────────────────
# 🔴 THE FALSE ALARM THIS PREVENTS. The config asks for `acc`; capture.py writes the O2Ring's
# accelerometer via StreamWriter(..., "accraw"), so the file is `..._ACCRAW.txt` while the Verity's
# identical `acc` is `..._ACC.txt`. Measured on vigil 2026-09-05: QC reported
# `missing stream(s): Wellue O2Ring-S:acc` every ~10 min against 38 ACCRAW files and 2.1 MB of live
# accelerometer data. A false MISSING is the most expensive kind of wrong line here — it is the one
# channel whose job is to announce data loss, and a reader who sees it nightly stops believing it.
def _ring_acc_devices():
    return [
        {"name": "Ring", "device_id": "S8AW", "streams": ["spo2", "acc"]},
        {"name": "Verity", "device_id": "0C301E3F", "streams": ["acc"]},
    ]


def test_an_ACCRAW_file_satisfies_the_configured_acc_stream(tmp_path, _tz):
    night = str(tmp_path / "2026-09-05")
    os.makedirs(night)
    _cap(night, "Wellue_O2Ring-S_S8AW_20260905220000_SPO2.csv", 900)
    _cap(night, "Wellue_O2Ring-S_S8AW_20260905220000_ACCRAW.txt", 4000)
    _cap(night, "Polar_VeritySense_0C301E3F_20260905220000_ACC.txt", 3000)
    s = nightqc.summarize(night, _ring_acc_devices())
    assert s["missing"] == [], f"acc arrived as ACCRAW; reporting it missing is the false alarm: {s['missing']}"
    ring = next(d for d in s["devices"] if d["name"] == "Ring")
    assert ring["streams"]["acc"] == 4000, "the ACCRAW rows must be COUNTED, not merely tolerated"


def test_the_plain_ACC_tag_still_satisfies_acc_so_the_union_is_not_a_regression(tmp_path, _tz):
    """The Verity writes `_ACC.txt` and must keep matching — the fix widens the accepted tags, it does
    not move them."""
    night = str(tmp_path / "2026-09-05")
    os.makedirs(night)
    _cap(night, "Polar_VeritySense_0C301E3F_20260905220000_ACC.txt", 3000)
    s = nightqc.summarize(night, [{"name": "Verity", "device_id": "0C301E3F", "streams": ["acc"]}])
    assert s["missing"] == []
    assert s["devices"][0]["streams"]["acc"] == 3000


def test_a_GENUINELY_absent_acc_is_still_reported_missing(tmp_path, _tz):
    """The widened match must not become an unconditional pass — the alarm has to still fire when the
    accelerometer really produced nothing, which is the whole reason the check exists."""
    night = str(tmp_path / "2026-09-05")
    os.makedirs(night)
    _cap(night, "Wellue_O2Ring-S_S8AW_20260905220000_SPO2.csv", 900)
    s = nightqc.summarize(night, [{"name": "Ring", "device_id": "S8AW", "streams": ["spo2", "acc"]}])
    assert s["missing"] == ["Ring:acc"]


def test_stream_file_tags_defaults_to_the_upper_cased_name():
    assert nightqc.stream_file_tags("ecg") == ("ECG",)
    assert nightqc.stream_file_tags("ppg2w") == ("PPG2W",)
    assert set(nightqc.stream_file_tags("acc")) == {"ACC", "ACCRAW"}


def test_rate_reality_reads_the_ring_acc_rate_out_of_an_ACCRAW_file(tmp_path):
    """The SILENT half of the same defect. Coverage reported `acc` missing (loud and wrong); this
    function simply found no candidate file and emitted NO ROW — so the O2Ring's accelerometer rate was
    never checked against its config at all, and an absent row looks exactly like a stream nobody
    configured. One cause, two consumers, two different wrong answers."""
    step = int(1e9 / 50.0)
    p = os.path.join(tmp_path, "Wellue_O2Ring-S_S8AW2100_20260905045318_ACCRAW.txt")
    with open(p, "w") as fh:
        fh.write("Phone timestamp;sensor timestamp [ns];X [raw];Y [raw];Z [raw]\n")
        for i in range(1000):
            fh.write(f"2026-09-05T04:53:18.000;{500_000_000_000 + i * step};1;2;3\n")
    dev = {"name": "Wellue O2Ring-S", "device_id": "S8AW2100", "streams": ["acc"], "rates": {"acc": 50}}
    rows = nightqc.rate_reality(str(tmp_path), [dev])
    assert len(rows) == 1, "no row at all is the silent failure — the rate was never checked"
    assert abs(rows[0]["measured_hz"] - 50.0) < 0.5
    assert rows[0]["matches_config"] is True


# ── the summary's own SHAPE, pinned (2026-09-05) ─────────────────────────────────────────────────────
# These fields are the audit trail the verdict rests on — `judged_dir`, `judged_session`,
# `searched_dirs` exist precisely so a reading can be checked against the ground it was computed from
# (the 2026-07-28 scope failure, where `files: 2` was the tell nobody could see). Nothing asserted
# their VALUES, so the whole block could be renamed, mis-scoped or emptied and the suite stayed green.
def test_the_summary_reports_the_night_it_judged_and_the_session_it_used(tmp_path):
    from datetime import datetime as _dt

    night = str(tmp_path / "2026-07-19")
    os.makedirs(night)
    start = _dt.strptime("20260719220000", "%Y%m%d%H%M%S").timestamp()
    _utime(_cap(night, "Polar_H10_02849638_20260719220000_HR.txt", 1800), start + 1800)
    devs = [{"name": "H10", "device_id": "02849638", "streams": ["hr"]}]

    # ⚠️ A TRAILING SLASH, deliberately. `os.path.basename` of a path ending in "/" is the EMPTY
    # STRING, so `rstrip("/")` is load-bearing rather than cosmetic — and a night whose name reports
    # as "" is a summary that cannot say which night it judged.
    s = _summarize(night + "/", devs)
    assert s["night"] == "2026-07-19", "the trailing slash must be stripped, not basenamed away"
    assert s["judged_dir"] == "2026-07-19"
    assert s["searched_dirs"] and all(isinstance(x, str) and x for x in s["searched_dirs"])
    assert "2026-07-19" in s["searched_dirs"]

    # The session actually judged, by value — start/end/rows, not merely present.
    js = s["judged_session"]
    assert js is not None and js["rows"] == 1800
    assert js["start"] == round(start) and js["end"] == round(start + 1800)

    # `sessions` carries the same triple for every session, oldest first.
    assert s["sessions"] == [{"start": round(start), "end": round(start + 1800), "rows": 1800}]
    assert "arrival" in s and "night_window" in s and "system_files" in s


def test_a_night_with_no_data_reports_no_judged_session_rather_than_a_fabricated_one(tmp_path, _tz):
    night = str(tmp_path / "2026-07-19")
    os.makedirs(night)
    _cap(night, "Tepna_20260719220000_LINK.csv", 5)  # a sidecar only — the box talking about itself
    s = nightqc.summarize(night, [{"name": "H10", "device_id": "02849638", "streams": ["hr"]}])
    assert s["judged_session"] is None, "no session judged is None, never a zero-length one"
    assert s["night_window"] is None
    assert s["sessions"] == [] and s["data_files"] == 0
    # `span` is never reassigned on this path, so this is the ONLY place its initial value is
    # observable — and it is read solely behind falsy guards (`round(span) if span else None`,
    # `if hz and span`), which treat None and "" identically. Probe for the equivalence entry.
    assert s["span_sec"] is None
    assert all(d["coverage"] == {} or all(v is None for v in d["coverage"].values()) for d in s["devices"])


# ── the invariant the gap-adjacency logic RESTS on (2026-09-05) ──────────────────────────────────────
def test_with_starts_supplied_sessions_stay_ORDERED_AND_DISJOINT_though_no_longer_gap_separated():
    """The invariant that SURVIVES daemon-start segmentation, asserted separately from the one that does
    not. `summarize`'s `before`/`after` partition needs disjointness and ordering; it never needed the
    gap separation, and with a recorded seam two sessions may sit seconds apart or TOUCH. So the sweep
    above (no starts) keeps asserting strict separation, and this one asserts what replaces it.

    A file still being written across a restart is the case that would otherwise overlap: its session's
    end is clamped to the seam, which is why disjointness holds by construction rather than by luck."""
    import random

    rng = random.Random(20260926)
    for _ in range(400):
        files, starts = [], []
        for _i in range(rng.randint(1, 12)):
            st_ = rng.uniform(0, 50_000)
            # mtimes deliberately long enough to straddle a nearby seam
            files.append({"session": st_, "mtime": st_ + rng.uniform(0, 8_000), "rows": 1})
        for _i in range(rng.randint(0, 6)):
            starts.append(rng.uniform(0, 50_000))
        rng.shuffle(files)
        out = nightqc.merge_sessions(files, starts=starts)
        assert out == sorted(out, key=lambda x: x[0]), "sessions must come back oldest first"
        for a, b in zip(out, out[1:]):
            assert a[1] <= b[0], f"disjoint — may touch, must never overlap: {a[:2]} then {b[:2]}"
            assert a[0] <= a[1], "and no session may end before it starts"
        # every file is placed exactly once, whatever the seams did
        assert sum(len(x[2]) for x in out) == len(files)


def test_a_session_ending_EXACTLY_at_the_judged_one_s_start_is_still_counted_before():
    """🔴 THE MUTANT THIS KILLS, and the equivalence claim it retires. `before = [s for s in others if
    s[1] <= cur[0]]` carried a `no-distinguishing-input` entry in `tools/mutate-equivalence.json` for
    `<=` vs `<`, justified by `merge_sessions` output being STRICTLY separated — no session's end could
    equal `cur[0]`. Daemon-start segmentation makes exactly that happen: the earlier session is clamped
    to the seam and the next run's first file can open at that same instant. So the claim is false now
    and the entry is gone; this is the input that distinguishes them.

    A file straddling the restart is the natural way to reach it, so this doubles as the straddle case:
    run 1's HR keeps being written for 2000 s after the seam and is still attributed to run 1."""
    T = 100_000.0
    files = [
        {"session": T - 5000, "mtime": T + 2000, "rows": 100},  # straddles the restart
        {"session": T, "mtime": T + 6000, "rows": 5000},
    ]  # the new run, opening AT it
    out = nightqc.merge_sessions(files, starts=[T])
    assert len(out) == 2, "the seam splits them"
    assert out[0][1] == T, "run 1's end is CLAMPED to the seam it was cut at, not its last write"
    assert out[1][0] == T, "and run 2 opens at that same instant — the sessions TOUCH"
    # This is the shape `before`'s `<=` must keep admitting: with `<` the earlier run vanishes from the
    # partition entirely, and a real prior session would stop being reported at all.
    cur = max(out, key=lambda sess: (sum(f["rows"] for f in sess[2]), sess[1]))
    others = [x for x in out if x is not cur]
    assert cur[0] == T and [x for x in others if x[1] <= cur[0]] == others, (
        "the touching session is BEFORE the judged one; `<` would drop it and report no prior session"
    )
    assert [x for x in others if x[1] < cur[0]] == [], (
        "and that is precisely the input that distinguishes `<=` from `<` — hence no equivalence entry"
    )


def test_a_zero_length_run_opening_AT_the_judged_one_s_end_is_not_counted_before():
    """The SECOND retired equivalence, and the one that is a wrong answer rather than a lost report.
    `before`'s bound also carried a `<= cur[0]` vs `<= cur[1]` entry on the same strict-separation
    justification. A run that opens exactly when the judged run ends and delivers nothing — a stream
    that connected at the seam and never produced a row — sits AFTER it; the `cur[1]` form would file it
    as the night's PRIOR session and compute a gap backwards from it. Strict separation made that
    unreachable, a recorded seam makes it reachable, so the claim is retired and this is its input."""
    T = 1000.0
    files = [
        {"session": 0.0, "mtime": T, "rows": 5000},  # the judged run
        {"session": T, "mtime": T, "rows": 0},
    ]  # opened at the seam, delivered nothing
    out = nightqc.merge_sessions(files, starts=[T])
    assert len(out) == 2 and out[1][0] == out[1][1] == T, "a zero-length run, opening at the seam"
    cur = max(out, key=lambda sess: (sum(f["rows"] for f in sess[2]), sess[1]))
    assert cur[0] == 0.0, "the judged run is the one carrying the rows"
    others = [x for x in out if x is not cur]
    assert [x for x in others if x[1] <= cur[0]] == [], "nothing precedes the judged run"
    assert [x for x in others if x[1] <= cur[1]] == others, (
        "and the `cur[1]` form would call this trailing run a PRIOR one — hence no equivalence entry"
    )
    # The same input pins `after`'s bound, whose `>=` vs `>` entry rested on the same separation: a run
    # opening exactly AT the judged run's end is after it, and `>` would lose it from both partitions.
    assert [x for x in others if x[0] >= cur[1]] == others, "it is AFTER the judged run"
    assert [x for x in others if x[0] > cur[1]] == [], (
        "`>` drops it — it would then be in neither partition, which is what disjointness forbids"
    )


def test_a_ZERO_LENGTH_judged_run_does_not_let_a_prior_session_read_as_after_it():
    """The rarest of the retired six (6 distinguishing inputs in 40 000), and a wrong answer when it
    fires. `after = [s for s in others if s[0] >= cur[1]]` carried a `s[0]` vs `s[1]` entry: under strict
    separation a PRIOR session's end could never reach the judged run's end, so keying on either bound
    picked the same set. A judged run that is itself zero-length — every row written inside one second,
    which a 14-digit filename stamp cannot distinguish from an instant — collapses `cur[0] == cur[1]`,
    and then the prior session's end touches it. Keyed on `s[1]` the night's PRIOR session is reported
    as its NEXT one, and `gaps` reads backwards."""
    files = [
        {"session": 0.0, "mtime": 1000.0, "rows": 1},  # the prior run
        {"session": 1000.0, "mtime": 1000.0, "rows": 5000},
    ]  # judged: 5000 rows, zero span
    out = nightqc.merge_sessions(files, starts=[1000.0])
    cur = max(out, key=lambda sess: (sum(f["rows"] for f in sess[2]), sess[1]))
    assert cur[0] == cur[1] == 1000.0, "the judged run has no span of its own"
    others = [x for x in out if x is not cur]
    assert [x for x in others if x[0] >= cur[1]] == [], "the prior run is not after the judged one"
    assert [x for x in others if x[1] >= cur[1]] == others, (
        "keyed on its END it would be — hence no equivalence entry for that bound"
    )


def test_two_sessions_sharing_an_END_make_prev_selection_depend_on_its_key():
    """The `prev = max(before, key=lambda s: s[1])` pair, retired with the rest. Its justification was
    that under strict separation latest-ending IS latest-starting, so the key could not matter. Two
    sessions may now share an end — a zero-length run opening exactly where the previous one was cut —
    and then `max(before)` without a key falls back to comparing the LISTS, which compares `start`
    first and picks the later-starting session, while the keyed form picks the earlier-ending... the
    FIRST maximal element. The two disagree, and `prior_gap_sec` is computed from whichever it gets."""
    files = [
        {"session": 0.0, "mtime": 1000.0, "rows": 1},  # ends at 1000
        {"session": 1000.0, "mtime": 1000.0, "rows": 1},  # opens AND ends at 1000
        {"session": 2000.0, "mtime": 3000.0, "rows": 9000},
    ]  # the judged run
    out = nightqc.merge_sessions(files, starts=[1000.0, 2000.0])
    cur = max(out, key=lambda sess: (sum(f["rows"] for f in sess[2]), sess[1]))
    before = [x for x in out if x is not cur and x[1] <= cur[0]]
    assert len(before) == 2 and before[0][1] == before[1][1] == 1000.0, "two runs sharing one end"
    assert max(before, key=lambda x: x[1])[0] == 0.0, "keyed: the first of the maximal ends"
    assert max(before)[0] == 1000.0, "unkeyed: list order, which picks the later-STARTING one"


def test_merge_sessions_always_yields_DISJOINT_sessions_separated_by_more_than_the_gap():
    """🔴 THIS IS THE PROPERTY THAT MAKES `summarize`'s before/after selection unambiguous, and nothing
    asserted it. `merge_sessions` appends a new session only when `st > sessions[-1][1] + gap_sec`, so
    the output is ordered by start AND strictly separated — no two sessions overlap or touch.

    Everything downstream leans on it. In `summarize`, `before = [s for s in others if s[1] <= cur[0]]`
    and `after = [s for s in others if s[0] >= cur[1]]` partition `others` exactly, and
    `max(before, key=s[1])` picks the same element as max-by-start, because under disjoint ordering the
    latest-ending session IS the latest-starting one.

    ⚠️ THIS SWEEP PASSES NO `starts`, AND THAT IS NOW THE WHOLE OF ITS SCOPE. Since 2026-09-26 a
    recorded daemon start splits two runs however small the gap, so segmented output may TOUCH and the
    separation asserted here holds only for the gap-only path — `test_with_starts_supplied_sessions_stay
    _ORDERED_AND_DISJOINT_though_no_longer_gap_separated` asserts what survives. Nine
    `no-distinguishing-input` claims in `tools/mutate-equivalence.json` cited this test; six of them
    depended on the separation, were measured false under seams (1052, 1040, 68, 21 and 6 distinguishing
    inputs in 40 000 randomized sets) and are retired and killed by real tests. The three that need only
    disjointness now cite that sweep instead. Keep the two apart: weakening this one silently
    re-falsifies them.

    A randomized sweep with a fixed seed rather than a hand-picked case — the claim is universal, so a
    single example would not support it."""
    import random

    rng = random.Random(20260905)
    gap = nightqc._SESSION_GAP_SEC
    for _ in range(400):
        files = []
        for _i in range(rng.randint(1, 12)):
            st_ = rng.uniform(0, 50_000)
            files.append({"session": st_, "mtime": st_ + rng.uniform(0, 5_000), "rows": 1})
        rng.shuffle(files)  # order handed in must not matter
        out = nightqc.merge_sessions(files)
        assert out == sorted(out, key=lambda s: s[0]), "sessions must come back oldest first"
        for a, b in zip(out, out[1:]):
            assert b[0] > a[1] + gap, f"sessions must be strictly separated by more than the gap: {a[:2]} then {b[:2]}"
            assert a[1] < b[0], "and therefore disjoint — no overlap, no touching"
        # Under that separation, latest-ending == latest-starting, which is what makes
        # `max(before, key=lambda s: s[1])` and max-by-start the same choice.
        if len(out) > 1:
            assert max(out, key=lambda s: s[1]) is max(out, key=lambda s: s[0])
            assert min(out, key=lambda s: s[0]) is min(out, key=lambda s: s[1])


# ── the ring-clock verdict actually reaches the summary (2026-09-05) ─────────────────────────────────
def test_the_RTCLOG_sidecar_is_found_and_its_drift_reaches_the_device_block(tmp_path):
    """🔴 THE READER LOOKED FOR THE WRONG CASE. `capture_filename` upper-cases every stream tag, so the
    writer emits `..._RTCLOG.csv`; `summarize` matched `_rtclog.csv` and therefore matched nothing.
    Measured on vigil 2026-09-05: 29 RTCLOG files on disk and `rtc: null` for every device, including
    the ring that wrote them — so `drift_s`, `resets` and `pushes` had never been computed from a real
    night, and nothing said so because a null there is indistinguishable from "no sidecar".

    Same class as the ACCRAW tag mismatch in this file: the reader's filename expectation did not match
    the writer's output, and no test compared the two."""
    night = str(tmp_path / "2026-09-05")
    os.makedirs(night)
    _utime(_cap(night, "Wellue_O2Ring-S_S8AW_20260905045318_SPO2.csv", 900), 1_000_000)
    # The real sidecar's shape, from vigil's own file.
    with open(os.path.join(night, "Wellue_O2Ring-S_S8AW_20260905045318_RTCLOG.csv"), "w") as fh:
        fh.write("Phone timestamp;event;rtc_offset_s;battery_state;battery_level;battery_raw2;battery_raw3\n")
        fh.write("2026-09-05T04:53:52.321;push;;;;;\n")
        fh.write("2026-09-05T04:53:53.365;read;-1.4;;;;\n")
        fh.write("2026-09-05T05:53:53.365;read;-3.9;;;;\n")
    s = nightqc.summarize(night, [{"name": "Ring", "device_id": "S8AW", "streams": ["spo2"]}])
    rtc = s["devices"][0]["rtc"]
    assert rtc is not None, "an RTCLOG on disk must produce a ring-clock verdict, not a null"
    assert rtc["reads"] == 2 and rtc["pushes"] == 1
    assert abs(rtc["drift_s"] - (-3.9 - -1.4)) < 1e-6, "drift is last minus first offset"


def test_a_foreign_device_file_sorting_FIRST_does_not_end_the_sidecar_scan(tmp_path):
    """The scan skips files belonging to other devices with `continue`. A `break` there would stop at
    the first foreign file — and since the directory is walked in sorted order, one alphabetically
    earlier device is enough to hide every sidecar this device wrote."""
    night = str(tmp_path / "2026-09-05")
    os.makedirs(night)
    # "AAAA_..." sorts before "Wellue_...", and belongs to a device not in `dids`.
    _utime(_cap(night, "AAAA_Other_99999999_20260905045318_HR.txt", 10), 1_000_000)
    _utime(_cap(night, "Wellue_O2Ring-S_S8AW_20260905045318_SPO2.csv", 900), 1_000_000)
    with open(os.path.join(night, "Wellue_O2Ring-S_S8AW_20260905045318_RTCLOG.csv"), "w") as fh:
        fh.write("Phone timestamp;event;rtc_offset_s;battery_state;battery_level;battery_raw2;battery_raw3\n")
        fh.write("2026-09-05T04:53:53.365;read;-1.4;;;;\n")
        fh.write("2026-09-05T05:53:53.365;read;-3.9;;;;\n")
    s = nightqc.summarize(night, [{"name": "Ring", "device_id": "S8AW", "streams": ["spo2"]}])
    assert s["devices"][0]["rtc"] is not None, "the foreign file must be SKIPPED, not treated as the end of the scan"


# ── the ring-clock verdict itself (2026-09-05) ───────────────────────────────────────────────────────
# Until the case fix above, `rtc_drift_summary` was reached by NO real night — the caller looked for
# `_rtclog.csv` and the writer produced `_RTCLOG.csv`. Its output now reaches an operator for the first
# time, so the arithmetic it reports is worth pinning rather than inferring.
def _rtclog(tmp_path, rows, name="Wellue_O2Ring-S_S8AW_20260905045318_RTCLOG.csv"):
    p = os.path.join(str(tmp_path), name)
    with open(p, "w", encoding="utf-8") as fh:
        fh.write("Phone timestamp;event;rtc_offset_s;battery_state;battery_level;battery_raw2;battery_raw3\n")
        for r in rows:
            fh.write(r + "\n")
    return p


def test_rtc_drift_counts_every_push_and_reset_not_merely_whether_one_happened(tmp_path):
    """`pushes`/`resets` are COUNTS. A night with three 0xC0 pushes and two battery-reset suspicions is
    a different night from one with a single each — `+= 1` collapsed to `= 1` reports both as 1."""
    p = _rtclog(
        tmp_path,
        [
            "2026-09-05T00:00:00.000;push;;;;;",
            "2026-09-05T00:10:00.000;read;0.0;;;;",
            "2026-09-05T01:00:00.000;push;;;;;",
            "2026-09-05T02:00:00.000;reset-suspect;5.0;;;;",
            "2026-09-05T03:00:00.000;push;;;;;",
            "2026-09-05T04:00:00.000;reset-suspect;9.0;;;;",
            "2026-09-05T05:00:00.000;read;9.4;;;;",
        ],
    )
    r = nightqc.rtc_drift_summary(p)
    assert r["pushes"] == 3 and r["resets"] == 2
    # `reads` counts every OFFSET-bearing row — reads and reset-suspects both carry one.
    assert r["reads"] == 4
    assert r["first_offset_s"] == 0.0 and r["last_offset_s"] == 9.4
    assert r["drift_s"] == 9.4, "drift is last minus first offset, rounded to 0.1 s"


def test_a_MALFORMED_row_is_skipped_and_the_rows_after_it_are_still_read(tmp_path):
    """Both skip paths are `continue`, and a `break` in either silently truncates the night: every
    later read is lost and the drift is computed over a narrower span that LOOKS like a real reading.
    The short-row guard and the non-numeric-offset guard are tested separately because they are
    different branches."""
    short = _rtclog(
        tmp_path,
        [
            "2026-09-05T00:00:00.000;read;0.0;;;;",
            "truncated;row",  # < 3 fields — the short-row guard
            "2026-09-05T05:00:00.000;read;4.0;;;;",
        ],
    )
    r = nightqc.rtc_drift_summary(short)
    assert r["reads"] == 2 and r["drift_s"] == 4.0, "a short row must not end the scan"

    bad = _rtclog(
        tmp_path,
        [
            "2026-09-05T00:00:00.000;read;0.0;;;;",
            "2026-09-05T02:00:00.000;read;not-a-number;;;;",  # the ValueError guard
            "2026-09-05T05:00:00.000;read;4.0;;;;",
        ],
        name="Wellue_O2Ring-S_S8AW_20260905045319_RTCLOG.csv",
    )
    r2 = nightqc.rtc_drift_summary(bad)
    assert r2["reads"] == 2 and r2["drift_s"] == 4.0, "an unparseable offset must not end the scan"


def test_span_h_is_HOURS_and_is_None_when_the_stamps_cannot_be_read(tmp_path):
    """The span is reported in hours; a wrong divisor is invisible on a normal night because rounding
    to 0.1 h hides it, so this pins it over a span long enough to separate 3600 from its neighbours."""
    p = _rtclog(
        tmp_path,
        [
            "2026-09-05T00:00:00.000;read;0.0;;;;",
            "2026-09-13T00:00:00.000;read;1.0;;;;",  # exactly 192 h later
        ],
    )
    assert nightqc.rtc_drift_summary(p)["span_h"] == 192.0

    # Unparseable stamps → span unknown. It must be None, never "" or 0: a zero-hour span reads as a
    # measurement that was never made (§2.6 — a missing observation is visible, never fabricated).
    q = _rtclog(
        tmp_path,
        [
            "not-a-timestamp;read;0.0;;;;",
            "also-not;read;1.0;;;;",
        ],
        name="Wellue_O2Ring-S_S8AW_20260905045320_RTCLOG.csv",
    )
    out = nightqc.rtc_drift_summary(q)
    assert out["span_h"] is None, "an unreadable span is None — not an empty string, not zero"
    assert out["reads"] == 2 and out["drift_s"] == 1.0, "the offsets are still usable"


def test_undecodable_bytes_do_not_kill_the_ring_clock_verdict(tmp_path):
    """The sidecar is read with `errors="replace"`. A single corrupt byte — the O2Ring writes these
    over BLE — must cost that row, not the night's whole clock verdict."""
    p = os.path.join(str(tmp_path), "Wellue_O2Ring-S_S8AW_20260905045321_RTCLOG.csv")
    with open(p, "wb") as fh:
        fh.write(b"Phone timestamp;event;rtc_offset_s;battery_state;battery_level;battery_raw2;battery_raw3\n")
        fh.write(b"2026-09-05T00:00:00.000;read;0.0;;;;\n")
        fh.write(b"2026-09-05T01:00:00.000;read;\xff\xfe;;;;\n")  # undecodable, and not a float
        fh.write(b"2026-09-05T05:00:00.000;read;4.0;;;;\n")
    r = nightqc.rtc_drift_summary(p)
    assert r is not None and r["reads"] == 2 and r["drift_s"] == 4.0


# ── the .dat/SpO2 pairing is called correctly, or not at all (2026-09-05) ────────────────────────────
def _spy_timefit(monkeypatch):
    """Capture how `summarize` CALLS the cross-correlation, rather than what it returns. The tool needs
    Node and a real binary .dat, so its return is None in a test either way — which makes the return
    value useless as an observation and the ARGUMENTS the only thing that can be checked."""
    calls = []

    def _fake(dat_path, spo2_path, **kw):
        calls.append((dat_path, spo2_path))
        return {"lag_s": 1}

    monkeypatch.setattr(nightqc, "dat_timefit_summary", _fake)
    return calls


def test_the_timefit_is_called_with_ABSOLUTE_paths(tmp_path, monkeypatch):
    """`os.path.join(night_dir, fn)` builds the path the tool will open. Dropping `night_dir` yields a
    bare filename that only resolves if the daemon's CWD happens to be the night folder — the same
    CWD-dependence that wrote real AS11 spool data into the checkout on 2026-09-01."""
    calls = _spy_timefit(monkeypatch)
    night = str(tmp_path / "2026-09-05")
    os.makedirs(night)
    _utime(_cap(night, "Wellue_O2Ring-S_S8AW_20260905045318_SPO2.csv", 900), 1_000_000)
    _cap(night, "Wellue_O2Ring-S_S8AW_20260905045318_STORED.dat", 10)
    s = nightqc.summarize(night, [{"name": "Ring", "device_id": "S8AW", "streams": ["spo2"]}])
    assert len(calls) == 1, "both sidecars present — the fit must be attempted exactly once"
    dat, spo2 = calls[0]
    assert os.path.isabs(dat) and os.path.isabs(spo2), f"paths must be absolute, got {dat!r} {spo2!r}"
    assert dat.endswith("_STORED.dat") and spo2.endswith("_SPO2.csv"), "and the right file in each slot"
    assert s["devices"][0]["datfit"] == {"lag_s": 1}


def test_the_timefit_is_NOT_attempted_when_only_one_of_the_pair_is_present(tmp_path, monkeypatch):
    """It cross-correlates two series. With one of them missing there is nothing to correlate, and
    calling the tool with a missing path would spend a 30 s Node timeout per night to learn that."""
    calls = _spy_timefit(monkeypatch)
    night = str(tmp_path / "2026-09-05")
    os.makedirs(night)
    _utime(_cap(night, "Wellue_O2Ring-S_S8AW_20260905045318_SPO2.csv", 900), 1_000_000)
    # no _STORED.dat
    s = nightqc.summarize(night, [{"name": "Ring", "device_id": "S8AW", "streams": ["spo2"]}])
    assert calls == [], "one sidecar is not a pair"
    assert s["devices"][0]["datfit"] is None


def test_a_NON_spo2_file_is_never_mistaken_for_the_spo2_half(tmp_path, monkeypatch):
    """The elif guards `fn.endswith("_SPO2.csv") and spo2_path is None`. Loosened to `or`, the FIRST
    file of any kind claims the SpO2 slot — here the PPG — and the fit then correlates the wrong
    series while still returning a confident-looking lag."""
    calls = _spy_timefit(monkeypatch)
    night = str(tmp_path / "2026-09-05")
    os.makedirs(night)
    _cap(night, "Wellue_O2Ring-S_S8AW_20260905045318_PPG.txt", 8000)  # sorts before SPO2
    _utime(_cap(night, "Wellue_O2Ring-S_S8AW_20260905045318_SPO2.csv", 900), 1_000_000)
    _cap(night, "Wellue_O2Ring-S_S8AW_20260905045318_STORED.dat", 10)
    nightqc.summarize(night, [{"name": "Ring", "device_id": "S8AW", "streams": ["spo2"]}])
    assert len(calls) == 1
    assert calls[0][1].endswith("_SPO2.csv"), f"the SpO2 slot must hold the SpO2 file, got {calls[0][1]}"


def test_the_cross_midnight_pool_is_EXCLUSIVE_at_exactly_the_gap(tmp_path, _tz):
    """The boundary of the pooling guard, which its own comment records getting wrong three times
    (`0 <=` read a −190 s overlap as non-contiguous, and a 17-file night went unjudged). `< gap` and
    `<= gap` differ on exactly one input: a previous folder whose last write is the gap away to the
    second. Pinned so the next correction to this family cannot silently move the edge."""
    from datetime import datetime as _dt

    d21 = str(tmp_path / "2026-07-21")
    os.makedirs(d21)
    d22 = str(tmp_path / "2026-07-22")
    os.makedirs(d22)
    pre = _dt.strptime("20260721233000", "%Y%m%d%H%M%S").timestamp()
    # the previous folder's LAST WRITE lands exactly 00:00:00; the new session opens exactly
    # `_SESSION_GAP_SEC` later (3600 s → 01:00:00), so `<` excludes it and `<=` would pool it.
    _utime(_cap(d21, "Polar_H10_02849638_20260721233000_HR.txt", 1800), pre + 1800)
    post = _dt.strptime("20260722010000", "%Y%m%d%H%M%S").timestamp()
    assert post - (pre + 1800) == nightqc._SESSION_GAP_SEC, "the fixture must sit ON the boundary"
    _utime(_cap(d22, "Polar_H10_02849638_20260722010000_HR.txt", 1500), post + 1500)
    s = _summarize(d22, [{"name": "H10", "device_id": "02849638", "streams": ["hr"]}])
    assert s["devices"][0]["streams"]["hr"] == 1500, (
        "a gap of exactly _SESSION_GAP_SEC is NOT contiguous — the earlier folder must stay excluded"
    )


def test_the_night_window_and_arrival_are_computed_from_THIS_night(tmp_path, monkeypatch):
    """Both fields are handed collaborators that decide what they describe: `night_view(cur, cur[2])`
    is scoped to the judged session AND its files, and `arrival_quality(night_dir)` to this night's
    folder. Passing None to either still returns a shaped value, so the summary would carry a
    confident block computed from nothing."""
    seen = {}

    def _nv(cur, files):
        seen["nv"] = (cur, files)
        return {"ok": 1}

    def _aq(d):
        seen["aq"] = d
        return {"ok": 2}

    monkeypatch.setattr(nightqc, "night_view", _nv)
    monkeypatch.setattr(nightqc, "arrival_quality", _aq)
    night = str(tmp_path / "2026-09-05")
    os.makedirs(night)
    _utime(_cap(night, "Polar_H10_02849638_20260905220000_HR.txt", 1800), 1_000_000)
    s = nightqc.summarize(night, [{"name": "H10", "device_id": "02849638", "streams": ["hr"]}])
    cur, files = seen["nv"]
    assert files is not None and len(files) == 1, "night_view must receive the session's FILES"
    assert files[0]["file"].endswith("_HR.txt")
    assert seen["aq"] == night, "arrival_quality must be asked about this night's directory"
    assert s["night_window"] == {"ok": 1} and s["arrival"] == {"ok": 2}


def test_drift_is_reported_to_a_TENTH_of_a_second(tmp_path):
    """The ring's own quantum is 1 s and the .dat cross-check reports integer seconds, so 0.1 s is the
    resolution this verdict is meaningful at. A finer rounding publishes digits the measurement does
    not have; a coarser one hides real drift."""
    p = _rtclog(
        tmp_path,
        [
            "2026-09-05T00:00:00.000;read;0.0;;;;",
            "2026-09-05T05:00:00.000;read;1.25;;;;",
        ],
        name="Wellue_O2Ring-S_S8AW_20260905045322_RTCLOG.csv",
    )
    assert nightqc.rtc_drift_summary(p)["drift_s"] == 1.2, "0.1 s resolution, not 0.01"


def test_no_SPO2_means_no_fit_even_when_another_file_could_fill_the_slot(tmp_path, monkeypatch):
    """The elif's `and spo2_path is None` is what stops a non-SpO2 file claiming the SpO2 half. With
    a `.dat` present and NO `_SPO2.csv`, a loosened guard hands the PPG to the correlator and the fit
    returns a confident lag computed from the wrong series — worse than no answer."""
    calls = _spy_timefit(monkeypatch)
    night = str(tmp_path / "2026-09-05")
    os.makedirs(night)
    _utime(_cap(night, "Wellue_O2Ring-S_S8AW_20260905045318_PPG.txt", 8000), 1_000_000)
    _cap(night, "Wellue_O2Ring-S_S8AW_20260905045318_STORED.dat", 10)
    s = nightqc.summarize(night, [{"name": "Ring", "device_id": "S8AW", "streams": ["ppg"]}])
    assert calls == [], "no SpO2 series exists — nothing may be correlated against the .dat"
    assert s["devices"][0]["datfit"] is None


def test_the_sidecar_reader_does_not_depend_on_the_BOXES_locale(tmp_path):
    """`open(..., encoding="utf-8")` is explicit so the verdict cannot change with the environment.
    Dropping it falls back to the platform default, which on a differently-configured box is not
    UTF-8 — a class of bug that never reproduces on the developer's machine.

    The probe runs the REAL function in a subprocess under `LC_ALL=C PYTHONUTF8=0` and compares against
    this process's result, rather than reasoning about what the default would be.

    ⚠️ THE FIRST VERSION OF THIS TEST EXAMINED NOTHING. It fed non-ASCII text in a NOTE column, and both
    the original and the `encoding=None` mutant produced the identical dict under the C locale — the
    diff-scoped mutation job on #2219 reported exactly those two survivors (`encoding=None`, and the
    argument dropped). The reason is structural: `errors="replace"` means no decoder can raise, and only
    `float(rtc_offset_s)` and `fromisoformat(Phone timestamp)` reach the output, so garbage in a note
    column is invisible to the verdict under EVERY decoding. The one field through which the decoder is
    observable at all is the offset, and only because `float()` accepts non-ASCII Unicode digits
    (`fromisoformat` does not): `٢.٥` decodes to 2.5 under utf-8 and to replacement characters under
    the C locale's ASCII, where the row is then dropped and `reads` shrinks by one. Probed 2026-09-05:
    identical dicts under utf-8 / None / omitted for the note-column input across three locales;
    DIFFERS on the Unicode-digit input only. So that is the input this test uses — not because a ring
    will ever write one (`RingClockLogWriter._f` emits `f"{v:.6f}"`, ASCII by construction) but because
    a test that cannot distinguish the code it pins from its mutant is not pinning it."""
    import subprocess, sys

    p = _rtclog(
        tmp_path,
        [
            "2026-09-05T00:00:00.000;read;0.0;;;;",
            "2026-09-05T02:00:00.000;read;٢.٥;;;;",  # ARABIC-INDIC 2.5 — the one decoder-sensitive field
            "2026-09-05T05:00:00.000;read;4.0;;;;",
        ],
        name="Wellue_O2Ring-S_S8AW_20260905045323_RTCLOG.csv",
    )
    with open(p, "a", encoding="utf-8") as fh:
        fh.write("2026-09-05T06:00:00.000;note;naïve — °C;;;;\n")
    verdict = nightqc.rtc_drift_summary(p)
    assert verdict["reads"] == 3, "the Unicode-digit offset must be PARSED here, or the probe below compares two drops"
    here = json.dumps(verdict, sort_keys=True)
    env = {**os.environ, "LC_ALL": "C", "LANG": "C", "PYTHONUTF8": "0", "PYTHONCOERCECLOCALE": "0"}
    script = (
        f"import json,sys; sys.path.insert(0,{os.path.dirname(os.path.abspath(nightqc.__file__))!r});"
        f"import nightqc; print(json.dumps(nightqc.rtc_drift_summary({p!r}), sort_keys=True))"
    )
    r = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, env=env)
    assert r.returncode == 0, f"the probe itself failed, which says nothing about encoding:\n{r.stderr[-600:]}"
    assert r.stdout.strip() == here, (
        f"the verdict must not depend on the ambient encoding:\n  C locale : {r.stdout.strip()}\n  this proc: {here}"
    )


# ── one sidecar per CONNECT SESSION, so the verdict pools them (2026-09-05, the first real night) ────
# The case fix above made `rtc` non-null for the first time on vigil 2026-09-05 — and the verdict read
# `reads 1 · pushes 11 · resets 0 · span_h 0.0` against 29 sidecars holding 15 reads, 63 pushes and TWO
# reset-suspect events. `summarize` handed over the FIRST file (`and rtc is None`); the ring had
# reconnected 29 times. A night summarised from its first few minutes hides the one event the field
# exists to surface.
def test_rtc_drift_summary_pools_every_sidecar_and_drops_each_files_header(tmp_path):
    a = _rtclog(
        tmp_path,
        [
            "2026-09-05T02:27:38.000;push;;;;;",
            "2026-09-05T02:27:39.000;read;-1.3;;;;",
        ],
        name="Wellue_O2Ring-S_S8AW_20260905022738_RTCLOG.csv",
    )
    b = _rtclog(
        tmp_path,
        [
            "2026-09-05T04:00:00.000;read;-2.1;;;;",
            "2026-09-05T04:10:00.000;reset-suspect;-151.0;;;;",
        ],
        name="Wellue_O2Ring-S_S8AW_20260905040000_RTCLOG.csv",
    )
    c = _rtclog(
        tmp_path,
        [
            "2026-09-05T06:27:39.000;push;;;;;",
            "2026-09-05T06:27:40.000;read;0.2;;;;",
        ],
        name="Wellue_O2Ring-S_S8AW_20260905062739_RTCLOG.csv",
    )
    r = nightqc.rtc_drift_summary([a, b, c])
    assert r["files"] == 3
    assert r["reads"] == 4 and r["pushes"] == 2 and r["resets"] == 1, (
        "every sidecar's rows count — the reset in the SECOND session is the finding"
    )
    assert r["first_offset_s"] == -1.3 and r["last_offset_s"] == 0.2 and r["drift_s"] == 1.5
    assert r["span_h"] == 4.0, "first read of the first file to last read of the last: 02:27→06:27"
    # A later file's header row is `Phone timestamp;event;…` — three fields, so a naive pool would
    # count it as a row with event "event"; it must be dropped per file, not once.
    assert r["reads"] == 4  # not 4 + a header-shaped row


def test_rtc_drift_summary_one_path_is_the_same_verdict_as_before(tmp_path):
    """The str form is the pre-pooling contract, kept: one path → one file → `files: 1`."""
    p = _rtclog(tmp_path, ["2026-09-05T02:27:39.000;read;-1.3;;;;", "2026-09-05T03:27:39.000;read;-1.9;;;;"])
    r = nightqc.rtc_drift_summary(p)
    assert r == nightqc.rtc_drift_summary([p])
    assert r["files"] == 1 and r["reads"] == 2 and r["drift_s"] == -0.6


def test_rtc_drift_summary_skips_an_unreadable_sidecar_rather_than_nulling_the_night(tmp_path):
    good = _rtclog(tmp_path, ["2026-09-05T02:27:39.000;read;-1.3;;;;", "2026-09-05T05:27:39.000;read;-2.5;;;;"])
    missing = os.path.join(str(tmp_path), "Wellue_O2Ring-S_S8AW_20260905030000_RTCLOG.csv")
    r = nightqc.rtc_drift_summary([missing, good])
    assert r is not None and r["files"] == 1 and r["reads"] == 2, "one torn sidecar must not null the other 28"
    assert nightqc.rtc_drift_summary([missing]) is None, "no readable file → no verdict, as before"
    assert nightqc.rtc_drift_summary([]) is None


def test_summarize_pools_EVERY_rtclog_sidecar_of_the_ring_not_the_first(tmp_path):
    """The real shape of 2026-09-05: many sidecars, the reset-suspect in a LATER one. With
    `and rtc is None` the verdict came from the earliest file and read `resets 0`."""
    night = str(tmp_path / "2026-09-05")
    os.makedirs(night)
    _utime(_cap(night, "Wellue_O2Ring-S_S8AW_20260905022738_SPO2.csv", 900), 1_000_000)
    hdr = "Phone timestamp;event;rtc_offset_s;battery_state;battery_level;battery_raw2;battery_raw3\n"
    with open(os.path.join(night, "Wellue_O2Ring-S_S8AW_20260905022738_RTCLOG.csv"), "w") as fh:
        fh.write(hdr + "2026-09-05T02:27:38.000;push;;;;;\n2026-09-05T02:27:39.000;read;-1.3;;;;\n")
    with open(os.path.join(night, "Wellue_O2Ring-S_S8AW_20260905041000_RTCLOG.csv"), "w") as fh:
        fh.write(hdr + "2026-09-05T04:10:00.000;reset-suspect;-151.0;;;;\n")
    with open(os.path.join(night, "Wellue_O2Ring-S_S8AW_20260905062739_RTCLOG.csv"), "w") as fh:
        fh.write(hdr + "2026-09-05T06:27:40.000;read;0.2;;;;\n")
    s = nightqc.summarize(night, [{"name": "Ring", "device_id": "S8AW", "streams": ["spo2"]}])
    rtc = s["devices"][0]["rtc"]
    assert rtc["files"] == 3, "all three sidecars, not the first"
    assert rtc["resets"] == 1, "the reset in the second session must reach the night's verdict"
    assert rtc["reads"] == 3 and rtc["pushes"] == 1 and rtc["span_h"] == 4.0


# ── Class-B quality signatures: `clip` (pinned at an observed extreme) and `held` ────────────────
# The rules and every constant below are measured, not chosen; the measurements are named in the
# nightqc docstrings. These plants encode the four behaviours that were argued out on 2026-09-06.

_MK = 156  # the ring's beat marker: an out-of-band annotation riding in-band


def _baseline(n=40):
    """A baseline that is deliberately NOT at an extreme — see `test_clip_clean_night_...`."""
    return [100 + int(8 * math.sin(i / 5.0)) for i in range(n)]


_RAMP_DOWN = [87, 78, 68, 57, 47, 37, 28, 19, 10, 4]
_RAMP_UP = [1, 4, 9, 14, 19, 24, 29, 35, 41, 47]


def test_constant_runs_is_keyed_on_length_not_value():
    # zero is a LEGAL sample; only the run length may decide.
    assert nightqc.constant_runs([0, 1, 0, 1, 0], min_run=2) == []
    assert nightqc.constant_runs([5, 0, 0, 0, 5], min_run=3) == [(1, 3, 0)]
    with pytest.raises(ValueError):
        nightqc.constant_runs([1, 1], min_run=1)


def test_count_singletons_edges():
    assert nightqc._count_singletons([]) == 0
    assert nightqc._count_singletons([7]) == 1
    assert nightqc._count_singletons([1, 1, 2, 3, 3]) == 1


def test_held_stream_detects_zero_order_hold_and_refuses_a_short_stream():
    # a 1.5625 Hz update emitted into a 10 Hz record stream: runs of 6 and 7, ratio 6.4
    v = []
    for k in range(60):
        v += [k] * (6 if k % 5 else 7)
    h = nightqc.held_stream(v)
    assert h is not None and h["lengths"] == (6, 7)
    assert 6.0 < h["ratio"] < 7.0 and h["share"] >= 0.90
    assert nightqc.held_stream([1, 2, 3]) is None  # too few transitions to have a shape
    assert nightqc.held_stream(list(range(400))) is None  # ragged, not a hold


def test_held_stream_wants_records_not_columns():
    """A per-column read splices runs across a record change and overstates the ratio.

    Measured on the ring's real ACC: the triplet gives 6.387 (reproducing an independent measurement
    exactly) while X, Y and Z alone read 6.579, 6.613 and 6.603.
    """
    recs = []
    for k in range(120):
        recs += [(k, k // 2)] * 6  # ch1 changes half as often as the record does
    rec_ratio = nightqc.held_stream(recs)["ratio"]
    col_ratio = nightqc.held_stream([r[1] for r in recs])["ratio"]
    assert 5.5 < rec_ratio < 6.5
    assert col_ratio > rec_ratio  # the column splices, so it reads a longer hold


def test_clip_floor_is_one_region():
    v = _baseline() + _RAMP_DOWN + [0] * 30 + _RAMP_UP + _baseline()
    rows = nightqc.class_b_runs(v, stream="ppg", annotations=(_MK,))["rows"]
    # exactly the 30 zeros: the `1` on the ramp-out is one LSB INWARD of the pin, a value the
    # encoding could represent and the device did report, so the span stops short of it.
    assert [(r["rule"], r["n_samples"], r["value"]) for r in rows] == [("clip", 30, 0)]


def test_clip_marker_inside_a_plateau_stays_ONE_region():
    """THE regression this rule exists to survive.

    The ring's `156` marker lands inside plateaus. Left in, it splits one clip into two and the
    population reads as a mixture of two mechanisms that does not exist (measured 2026-09-06: 67-79 %
    of approach ramps read monotone with the marker present, 686/689 with it excluded).
    """
    plain = _baseline() + _RAMP_DOWN + [0] * 30 + _RAMP_UP + _baseline()
    marked = _baseline() + _RAMP_DOWN + [0] * 14 + [_MK] + [0] * 15 + _RAMP_UP + _baseline()
    got = nightqc.class_b_runs(marked, stream="ppg", annotations=(_MK,))["rows"]
    want = nightqc.class_b_runs(plain, stream="ppg", annotations=(_MK,))["rows"]
    assert [(r["first_index"], r["n_samples"]) for r in got] == [(r["first_index"], r["n_samples"]) for r in want]
    # and the failure it prevents, so the assertion above cannot pass vacuously
    unexcluded = nightqc.class_b_runs(marked, stream="ppg")["rows"]
    assert len(unexcluded) == 2 and unexcluded[0]["n_samples"] < 30


def test_clip_ceiling_is_the_positive_control():
    """The ceiling is the rail this stream demonstrably hits; without it the floor has no control."""
    up = [113, 124, 132, 143, 154, 166, 177, 188, 196]
    v = _baseline() + up + [200] * 30 + up[::-1] + _baseline() + [0]
    rows = [r for r in nightqc.class_b_runs(v, stream="ppg", annotations=(_MK,))["rows"] if r["value"] == 200]
    assert [(r["rule"], r["n_samples"]) for r in rows] == [("clip", 30)]
    geo = [g for g in nightqc.clip_regions(v, annotations=(_MK,)) if g["rail"] == 200]
    assert geo[0]["monotone_in"] and geo[0]["monotone_out"] and geo[0]["projects_beyond"]


def test_clip_ignores_a_real_beat_crossing_zero():
    beat = [int(100 + 90 * math.sin(i / 7.0)) for i in range(900)]
    assert nightqc.class_b_runs(beat, stream="ppg", annotations=(_MK,))["rows"] == []


def test_clip_does_not_flag_a_long_constant_run_at_BASELINE():
    """Two-sided without a value list, proven.

    The acceptance file carries a 12,411-sample run at value 100 with deviation 0.27 of the stream's
    own scale. It is a `stuck` stream, not a clip, and nothing here names 0, 100 or 200 to know that —
    100 is simply not an extreme.
    """
    v = [100] * 400 + [90, 110] * 200
    assert nightqc.class_b_runs(v, stream="ppg", annotations=(_MK,))["rows"] == []


def test_clip_finds_NOTHING_in_a_clean_stream():
    """The negative control real data cannot supply, because every real file's extremes are anomalous
    BY CONSTRUCTION — which is exactly why a clean synthetic stream is the only place this can be
    asserted. (Magpie's port flagged 16 spans on 2,000 clean samples before the rail was qualified.)

    A smooth signal genuinely lingers at its own turning point, so `min_run` alone will never reject it
    and neither will the geometry: a turning point is approached monotonically AND projects beyond its
    own extreme, just as a real rail does. The discriminator is that a rail is a histogram SPIKE.
    Measured over eight files: real rails out-count their neighbour 9.0-43.0x, a clean quantised sine
    only 2.3-2.4x, and a lone outlier 1.0x.
    """
    clean = [int(100 + 90 * math.sin(i / 23.0)) for i in range(2000)]
    assert nightqc.rail_value(clean, toward_high=False) is None
    assert nightqc.rail_value(clean, toward_high=True) is None
    assert nightqc.clip_regions(clean, annotations=(_MK,)) == []
    assert nightqc.class_b_runs(clean, stream="ppg", annotations=(_MK,))["rows"] == []


def test_the_rail_is_the_histogram_spike_NOT_the_observed_extreme():
    """🔴 The observed maximum is not the rail, and keying on it drops a whole class silently.

    Measured on 20260905045318 the top of the range is 195:34 · 196:39 · 197:41 · 198:75 · 199:2596 ·
    200:304 — the rail is 199 and 200 is a rare overshoot one quantum above it. A `max`-keyed rule
    hunts at 200, weighs 304 against a 2,596-sample neighbour, and reports no ceiling at all; the
    symptom is "the ceiling behaves unlike the floor", not an error. Found by Magpie against real
    files, 2026-09-06.
    """
    # a rail at 199 with a thin overshoot to 200, exactly the real shape
    v = [100] * 40 + [150, 170, 185, 193] + [199] * 60 + [200] * 3 + [199] * 40 + [193, 185, 170, 150] + [100] * 40
    assert nightqc.rail_value(v, toward_high=True) == 199, "the spike, not the maximum"
    rails = {r["rail"] for r in nightqc.clip_regions(v, annotations=(_MK,))}
    assert 199 in rails and 200 not in rails


def test_a_lone_outlier_is_not_a_rail():
    """The Verity's minimum is a SINGLE sample 556 quanta from anything else — isolated, and not a
    pin. Isolation alone must not qualify a rail or one stray reading invents a class."""
    v = [100 + (i % 7) for i in range(500)] + [-9000]
    assert nightqc.rail_value(v, toward_high=False) is None


def test_class_b_runs_emit_seam_receives_the_sidecar_columns():
    seen = []
    v = _baseline() + _RAMP_DOWN + [0] * 30 + _RAMP_UP + _baseline()
    nightqc.class_b_runs(v, stream="ppg", tick_ms=8.0, annotations=(_MK,), emit=lambda *a: seen.append(a))
    assert len(seen) == 1
    stream, value, first_index, n, dur_ms, closed, rule = seen[0]
    assert (stream, value, n, rule) == ("ppg", 0, 30, "clip")
    assert dur_ms == 30 * 8.0 and closed is True and first_index > 0


def test_class_b_runs_multichannel_reports_per_channel_and_held_once():
    recs = [(x, 50) for x in (_baseline() + _RAMP_DOWN + [0] * 30 + _RAMP_UP + _baseline())]
    out = nightqc.class_b_runs(recs, stream="ppg", annotations=(_MK,))
    assert any(r["stream"] == "ppg:ch0" and r["rule"] == "clip" for r in out["rows"])
    held = []
    nightqc.class_b_runs([(k // 6, 0) for k in range(600)], stream="acc", emit=lambda *a: held.append(a))
    assert len(held) == 1 and held[0][6].startswith("held ratio=")


# ── THE BOUNDED BACK-CHECK (residue 2026-09-21-capture-daemon-qc-digest-peaks-1-3gb) ──────────────
# `class_b_quality` materialised one Python tuple per waveform ROW. Measured on vigil against the
# real 2026-09-21 night (765 MB, four class-B files): VmHWM **1141 MB**, of which the ring's 5.26 M
# two-channel PPG2W alone was 755 MB — inside the daemon that holds every BLE link, at 09:00. The
# columns path costs 8 bytes a sample instead of ~143. These tests pin the two things that makes
# safe: the cheap path must answer IDENTICALLY, and it must stay cheap. On that real night the two
# readers were run against each other: **1116 MB -> 245 MB, and the four blocks compared byte for
# byte identical** (2026-09-22, box-local, same 34 s runtime).


def _stream_with_a_rail():
    """A column the clip rule fires on: baseline, a ramp into a floor plateau, a ramp out."""
    return _baseline() + _RAMP_DOWN + [0] * 30 + _RAMP_UP + _baseline()


def test_class_b_runs_columns_equals_records():
    """The SAME rows read the other way round give the same dict — rows, clips, held, everything.

    This is the whole licence for the columns path. Without it "cheaper" would be a claim about a
    second implementation of the rule rather than about the same rule's input shape."""
    from array import array

    col0 = _stream_with_a_rail()
    col1 = [50] * len(col0)
    recs = list(zip(col0, col1))
    a = nightqc.class_b_runs(recs, stream="ppg", tick_ms=8.0, annotations=(_MK,))
    b = nightqc.class_b_runs(
        columns=[array("q", col0), array("q", col1)], stream="ppg", tick_ms=8.0, annotations=(_MK,)
    )
    assert a == b and a["clips"] == {"ppg:ch0": 1, "ppg:ch1": 0}
    assert [r["rule"] for r in a["rows"]] == ["clip"], "the fixture must actually fire, or this passes vacuously"
    # single channel: the name has no :chN, and both paths still agree
    one_r = nightqc.class_b_runs(col0, stream="ecg", annotations=(_MK,))
    one_c = nightqc.class_b_runs(columns=[array("q", col0)], stream="ecg", annotations=(_MK,))
    assert one_r == one_c and set(one_c["clips"]) == {"ecg"}


def test_held_columns_matches_held_stream_exactly():
    """A HOLD is a property of the RECORD — every channel freezing on the same tick — and the columns
    path must not quietly become the per-column read that `test_held_stream_wants_records_not_columns`
    measures as WRONG (it splices runs across record changes and overstates the ratio)."""
    from array import array

    recs = []
    for k in range(120):
        recs += [(k, k // 2)] * 6
    cols = [array("q", [r[0] for r in recs]), array("q", [r[1] for r in recs])]
    assert nightqc.held_columns(cols) == nightqc.held_stream(recs)
    assert nightqc.held_columns(cols)["lengths"] == (6, 7)
    # and it must still REFUSE what held_stream refuses
    ragged = [array("q", list(range(400)))]
    assert nightqc.held_columns(ragged) is nightqc.held_stream(list(range(400))) is None
    assert nightqc.held_columns([array("q", [1, 2, 3])]) is None  # too few transitions
    assert nightqc.held_columns([array("q", [])]) is None and nightqc.held_columns([]) is None


def test_class_b_runs_refuses_an_ambiguous_or_ragged_call():
    from array import array
    import pytest as _pytest

    with _pytest.raises(TypeError):
        nightqc.class_b_runs(stream="ppg")  # neither
    with _pytest.raises(TypeError):
        nightqc.class_b_runs([1, 2], columns=[array("q", [1, 2])], stream="ppg")  # both
    with _pytest.raises(ValueError):
        nightqc.class_b_runs(columns=[], stream="ppg")  # no channel at all
    with _pytest.raises(ValueError):
        nightqc.held_columns([array("q", [1, 2, 3]), array("q", [1, 2])])  # not one stream's channels


def test_the_back_check_reads_a_night_without_HOLDING_it(tmp_path):
    """The property the row is about, as a bound rather than a hope.

    Measured here at ~40 000 rows x 2 channels: the records reader traced **5.8 MB** of live Python objects at its peak,
    the columns reader **0.9 MB** (6.7x). The bound is 3 MB — comfortably above what
    the bounded reader needs (it also holds the line buffer and the emitted rows) and far below what
    one tuple per row costs, so this fails on the implementation it replaced rather than on noise.
    """
    import tracemalloc

    night = tmp_path / "2026-09-21"
    night.mkdir()
    p = night / "Wellue_O2Ring-S_S8AW2100_20260921212350_PPG2W.txt"
    tile = _stream_with_a_rail()  # the SAME shape the clip tests use, so the rule really fires
    tiles = 40000 // len(tile)
    ch0 = tile * tiles
    rows = ["timestamp [ms];sensor timestamp [ns];channel 0;channel 1;motion"]
    for i, v in enumerate(ch0):
        rows.append("%d;%d;%d;%d;0" % (i * 8, i * 8000000, v, 120 + (i % 11)))
    p.write_text("\n".join(rows) + "\n", encoding="utf-8")

    tracemalloc.start()
    blocks = nightqc.class_b_quality(str(night))
    _cur, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    assert len(blocks) == 1 and blocks[0]["clips"], "the fixture must produce a real block"
    assert blocks[0]["clips"].get("ppg2w:ch0") == tiles, "every planted floor must be found"
    # ⚠️ 3 MB IS NOT A ROUND NUMBER, IT IS A SEPARATION. Run against origin/main's reader on this very
    # fixture the peak is 5.8 MB and this assertion FAILS; on the columns reader it is 0.9 MB. A bound
    # that passes on the implementation it replaced would be worth nothing — so before relaxing this
    # threshold, re-measure both readers on the same fixture and keep the gap, or the test stops being
    # able to tell the two apart and goes on reporting green about a reader it never examined.
    assert peak < 3_000_000, f"the back-check held {peak / 1e6:.1f} MB of a 40 000-row file"


def test_clip_regions_handles_empty_and_all_annotation_input():
    assert nightqc.clip_regions([]) == []
    assert nightqc.clip_regions([_MK] * 50, annotations=(_MK,)) == []


def test_clip_at_a_file_edge_has_no_room_to_read_an_approach():
    """A plateau touching the first or last sample cannot have its approach read, and the geometry
    says so with `projects_beyond is None` rather than guessing a shape from a truncated window."""
    head = [0] * 30 + _RAMP_UP + _baseline()
    geo = [g for g in nightqc.clip_regions(head, annotations=(_MK,)) if g["first_index"] == 0]
    assert geo and geo[0]["projects_beyond"] is None and geo[0]["monotone_in"] is False
    tail = _baseline() + _RAMP_DOWN + [0] * 30
    last = nightqc.clip_regions(tail, annotations=(_MK,))[-1]
    assert last["monotone_out"] is False  # nothing after it to be monotone in
    rows = nightqc.class_b_runs(tail, stream="ppg", annotations=(_MK,))["rows"]
    assert rows[-1]["closed"] is False  # the run is still open at the end of the file


def test_marker_inside_the_APPROACH_RAMP_is_stepped_over():
    """The real-corpus signature, and the one the plateau plant does not cover.

    Measured 2026-09-06 on 20260905045318: of the 26 zero events whose approach read non-monotone,
    26/26 had a `156` in the approach WINDOW (and 0/95 of the monotone ones did). The marker breaks the
    ramp from outside the plateau as well as from inside it, so both windows must step over it.

    ⚠️ Note WHERE the marker sits. A 156 early in a descending ramp leaves it non-increasing (156 is
    above everything after it) and breaks nothing; it is the marker ADJACENT to the plateau, after the
    ramp has fallen below it, that inverts the last step — which is exactly the `[0, 0, 0, 0, 0, 156]`
    window shape the corpus produced. A plant that puts it anywhere else passes while testing nothing.
    """
    exit_ramp = [1, 4, _MK, 9, 14, 19, 24, 29, 35, 41, 47]  # and one deeper in the departure
    v = _baseline() + _RAMP_DOWN + [_MK] + [0] * 30 + [_MK] + exit_ramp + _baseline()
    geo = [g for g in nightqc.clip_regions(v, annotations=(_MK,)) if g["rail"] == 0]
    assert geo, "the plateau is still found"
    assert geo[0]["monotone_in"] and geo[0]["monotone_out"], (
        "with the marker stepped over, the ramp either side reads monotone"
    )
    blind = [g for g in nightqc.clip_regions(v) if g["rail"] == 0]
    assert blind and not blind[0]["monotone_in"] and not blind[0]["monotone_out"], (
        "undeclared, the adjacent marker inverts the last step of the ramp on both sides"
    )


def test_annotation_gap_is_bounded_so_a_marker_burst_cannot_merge_two_plateaus():
    """Unbounded stepping is safe on today's corpus and wrong in principle.

    Consecutive-`156` runs on 20260905045318 are 1:5383 · 2:11 · 3:3 · 4:2 · 5:3 · 6:3 — max 6 — so the
    bound of 8 never fires on real data. It bounds the case where a marker BURST separates two real
    plateaus: merged, the region's span would be mostly annotation.
    """
    burst = _baseline() + _RAMP_DOWN + [0] * 12 + [_MK] * 20 + [0] * 12 + _RAMP_UP + _baseline()
    at_floor = nightqc._rail_runs(
        burst,
        0,
        toward_high=False,
        max_spread=1,
        min_run=8,
        annotations=(_MK,),
        annotation_gap_max=nightqc._ANNOTATION_GAP_MAX,
    )
    assert len(at_floor) == 2, "a 20-row burst is longer than the bound, so the plateaus stay apart"
    assert all(r[1] < 20 for r in at_floor), "and no span swallows the 20 annotation rows"
    # a burst SHORTER than the bound is still stepped over, giving one plateau spanning it
    short = _baseline() + _RAMP_DOWN + [0] * 12 + [_MK] * 6 + [0] * 12 + _RAMP_UP + _baseline()
    merged = nightqc._rail_runs(
        short,
        0,
        toward_high=False,
        max_spread=1,
        min_run=8,
        annotations=(_MK,),
        annotation_gap_max=nightqc._ANNOTATION_GAP_MAX,
    )
    assert len(merged) == 1 and merged[0][1] >= 30, "12 + 6 markers + 12 reported as one span"


def test_rail_value_refuses_a_stream_with_nothing_to_compare_against():
    """A rail is defined RELATIVE to its neighbour, so a stream with no neighbour has no rail.

    Both arms matter: an empty stream, and a stream of one repeated value — the latter is the flat-
    lined case, which is a `stuck` stream and must not be re-reported here as a clip against itself.
    """
    assert nightqc.rail_value([], toward_high=True) is None
    assert nightqc.rail_value([7] * 500, toward_high=True) is None
    assert nightqc.rail_value([7] * 500, toward_high=False) is None
    assert nightqc.clip_regions([7] * 500) == []


def test_rail_needs_something_inward_of_the_spike():
    """A two-valued stream whose commoner value is the HIGHER one has no floor rail: scanning from the
    low edge, the spike is the top value and there is nothing inward of it to out-count."""
    v = [1] * 20 + [2] * 300
    assert nightqc.rail_value(v, toward_high=False) is None


def _write_ppg(night, name, values, header="Phone timestamp;sensor timestamp [ns];channel 0\n"):
    p = os.path.join(night, name)
    with open(p, "w") as fh:
        fh.write(header)
        for i, v in enumerate(values):
            fh.write(f"2026-09-05T04:53:{i % 60:02d}.000;0;{v}\n")
    return p


def test_class_b_quality_scans_a_night_and_reaches_the_seam(tmp_path):
    """The production path: the per-night back-check finds the capture, runs the detector, and the
    rows reach the sidecar seam. Without this the detector would be reachable only from tests."""
    night = str(tmp_path)
    clipped = _baseline() + _RAMP_DOWN + [0] * 30 + _RAMP_UP + _baseline()
    _write_ppg(night, "Wellue_O2Ring-S_X_20260905045318_PPG.txt", clipped)
    seen = []
    blocks = nightqc.class_b_quality(night, emit=lambda *a: seen.append(a))
    assert [b["file"] for b in blocks] == ["Wellue_O2Ring-S_X_20260905045318_PPG.txt"]
    assert seen and seen[0][6] == "clip" and seen[0][1] == 0
    # and the marker is declared for this tag, so a marker-split plateau is still ONE span
    marked = _baseline() + _RAMP_DOWN + [0] * 14 + [_MK] + [0] * 15 + _RAMP_UP + _baseline()
    _write_ppg(night, "Wellue_O2Ring-S_X_20260905045319_PPG2W.txt", marked)
    got = []
    nightqc.class_b_quality(night, emit=lambda *a: got.append(a))
    ppg2w = [g for g in got if g[0] == "ppg2w"]
    ppg = [g for g in got if g[0] == "ppg"]
    assert len(ppg2w) == 1
    # the marker-split plateau reports the SAME span as the unmarked one — the invariant that
    # matters, not the magic number beside it.
    assert ppg2w[0][3] == ppg[0][3] == 30


def _write_rows(night, name, header, rows, preamble=""):
    p = os.path.join(night, name)
    with open(p, "w") as fh:
        fh.write(preamble + header + "\n")
        for i, r in enumerate(rows):
            fh.write(f"2026-09-05T04:53:{i % 60:02d}.000;{';'.join(str(v) for v in r)}\n")
    return p


def test_class_b_quality_scans_waveform_columns_by_NAME_not_position(tmp_path):
    """The third term beside sample and annotation: a STATUS column is not a waveform.

    PPG2W's real row is `channel 0;channel 1;motion`, and `motion` is the ring's stillness byte whose
    correct reading is a constant `0` — a rail by every distributional test. The reader took every
    column after the two stamps by position, so a still night reported the 24-bit stream's stillest
    hours as its worst (156 spans, a 700,409-sample run, ch0/ch1 clean, 2026-09-06). ECG's
    `timestamp [ms]` was scanned the same way and pushed the real ECG to `ecg:ch1`. Both files also
    open with the box's `# timebase=` line ahead of the header, which the old reader consumed AS the
    header.
    """
    night = str(tmp_path)
    clean = _baseline() * 4
    n = len(clean)
    # plant: a still ring — the motion byte as the ring writes it, 0 with a brief stir now and then,
    # both PPG channels clean. The stirs matter: an all-zero column is refused by `rail_value` as a
    # stream with nothing to compare against, so a constant plant would read clean under the OLD
    # reader too and prove nothing (verified: this shape yields 2 `ppg2w:ch2` clips on it).
    motion = [0 if i % 97 else 1 + i % 3 for i in range(n)]
    _write_rows(
        night,
        "Wellue_O2Ring-S_X_20260905045318_PPG2W.txt",
        "Phone timestamp;sensor timestamp [ns];channel 0;channel 1;motion",
        [(0, 3_000_000 + v, 12_000 + v, m) for v, m in zip(clean, motion)],
        preamble="# timebase=host-disciplined\n",
    )
    (block,) = nightqc.class_b_quality(night)
    assert block["columns"] == ["channel 0", "channel 1"], "the status byte is not scanned"
    assert block["rows"] == [] and set(block["clips"]) == {"ppg2w:ch0", "ppg2w:ch1"}, (
        "a still ring is not a clipped one"
    )
    # the same plant with a REAL rail on channel 0 still reds — the exclusion did not blind the scan
    railed = _baseline() + _RAMP_DOWN + [0] * 30 + _RAMP_UP + _baseline()
    _write_rows(
        night,
        "Wellue_O2Ring-S_X_20260905045318_PPG2W.txt",
        "Phone timestamp;sensor timestamp [ns];channel 0;channel 1;motion",
        [(0, 3_000_000 + v, 12_000 + (i % 7), 0) for i, v in enumerate(railed)],
    )
    (block,) = nightqc.class_b_quality(night)
    assert [r["stream"] for r in block["rows"]] == ["ppg2w:ch0"] and block["rows"][0]["n_samples"] == 30
    # ECG: the device axis column is not a channel, so the H10's ECG is `ecg`, not `ecg:ch1`
    _write_rows(
        night,
        "Polar_H10_X_20260905045318_ECG.txt",
        "Phone timestamp;sensor timestamp [ns];timestamp [ms];ecg [uV]",
        [(841982897265081688 + i, i * 7.692308, v) for i, v in enumerate(railed)],
    )
    ecg = [b for b in nightqc.class_b_quality(night) if b["stream"] == "ecg"]
    assert ecg[0]["columns"] == ["ecg [uV]"] and set(ecg[0]["clips"]) == {"ecg"}
    # a row whose width disagrees with the header is torn, not re-interpreted
    with open(os.path.join(night, "Polar_H10_X_20260905045318_ECG.txt"), "a") as fh:
        fh.write(f"2026-09-05T04:54:00.000;0;{n * 7.692308};5;extra\n")
    assert [b for b in nightqc.class_b_quality(night) if b["stream"] == "ecg"][0]["rows"] == ecg[0]["rows"]
    # a header naming NO waveform column is absent, not clean
    _write_rows(
        night,
        "Wellue_O2Ring-S_Y_20260905045318_PPG2W.txt",
        "Phone timestamp;sensor timestamp [ns];motion",
        [(0, 0)] * n,
    )
    assert all(b["file"] != "Wellue_O2Ring-S_Y_20260905045318_PPG2W.txt" for b in nightqc.class_b_quality(night))
    assert nightqc._waveform_columns("") == ()


def test_class_b_quality_is_empty_when_the_night_holds_nothing_it_reads(tmp_path, caplog):
    """Nothing to report is not everything healthy — an empty list, never a clean verdict."""
    night = str(tmp_path)
    assert nightqc.class_b_quality(night) == []
    _write_ppg(night, "Polar_H10_X_20260905045318_RR.txt", [800, 810, 790])  # not a class-B tag
    _write_ppg(night, "Wellue_O2Ring-S_X_20260905045318_PPG.txt", [5, 6, 7])  # too few rows
    open(os.path.join(night, "Wellue_O2Ring-S_X_20260905045319_PPG.txt"), "w").close()  # 0 bytes
    with caplog.at_level(logging.WARNING, logger="tepna-capture"):
        assert nightqc.class_b_quality(night) == []
    assert caplog.records == [], "a 0-byte open capture is too few rows, not a malformed header"
    assert nightqc.class_b_quality(os.path.join(night, "does-not-exist")) == []
    # the row floor is `<`: a file carrying exactly `_CLIP_MIN_RUN` rows IS scanned
    _write_ppg(night, "Wellue_O2Ring-S_X_20260905045318_PPG.txt", [5, 6, 7, 8, 9][: nightqc._CLIP_MIN_RUN])
    assert [b["file"] for b in nightqc.class_b_quality(night)] == ["Wellue_O2Ring-S_X_20260905045318_PPG.txt"]


def test_class_b_quality_skips_a_row_or_a_file_without_ending_the_scan(tmp_path, caplog):
    """Every `continue` in the scan is a SKIP, and a skip must not read as a stop.

    Planted so that the thing after the skipped thing carries the verdict: a torn row sits in the
    MIDDLE of the file ahead of the rail, and a too-short file sorts AHEAD of the railed one. A
    reader that broke out at either would report the night clean. The box's preamble also carries a
    byte that is not UTF-8 (a `\\xff` on the `# timebase=` line): the reader decodes with
    `errors="replace"`, so that byte costs one character, not the file.
    """
    night = str(tmp_path)
    railed = _baseline() + _RAMP_DOWN + [0] * 30 + _RAMP_UP + _baseline()
    p = _write_rows(
        night,
        "Wellue_O2Ring-S_X_20260905045318_PPG2W.txt",
        "Phone timestamp;sensor timestamp [ns];channel 0;channel 1;motion",
        [(0, 3_000_000 + v, 12_000 + (i % 7), 0) for i, v in enumerate(railed)],
    )
    body = open(p, "rb").read().split(b"\n")
    body.insert(5, b"2026-09-05T04:53:05.000;0;3000100;12000;0;extra")  # torn: too wide
    body.insert(3, b"2026-09-05T04:53:03.000;0;not-a-number;12000;0")  # torn: unparsable
    with open(p, "wb") as fh:
        fh.write(b"# timebase=host-disciplined \xff\n" + b"\n".join(body))
    _write_ppg(night, "Wellue_O2Ring-S_A_20260905045318_PPG.txt", [5, 6, 7])  # sorts first; too few
    with caplog.at_level(logging.WARNING, logger="tepna-capture"):
        blocks = nightqc.class_b_quality(night)
    assert caplog.records == []
    assert [b["file"] for b in blocks] == ["Wellue_O2Ring-S_X_20260905045318_PPG2W.txt"]
    assert [r["stream"] for r in blocks[0]["rows"]] == ["ppg2w:ch0"] and blocks[0]["rows"][0]["n_samples"] == 30


def test_class_b_quality_names_the_file_in_both_ABSENT_warnings(tmp_path, monkeypatch, caplog):
    """The two absences are logged, and a log line that omits the file names nothing a reader can act on."""
    night = str(tmp_path)
    _write_rows(
        night,
        "Wellue_O2Ring-S_Y_20260905045318_PPG2W.txt",
        "Phone timestamp;sensor timestamp [ns];motion",
        [(0, 0)] * 40,
    )
    _write_ppg(night, "Wellue_O2Ring-S_Z_20260905045318_PPG.txt", _baseline())  # sorts AFTER the bad file
    later = ["Wellue_O2Ring-S_Z_20260905045318_PPG.txt"]
    with caplog.at_level(logging.WARNING, logger="tepna-capture"):
        assert [b["file"] for b in nightqc.class_b_quality(night)] == later, "an absent file skips, not stops"
    (rec,) = caplog.records
    assert rec.getMessage() == (
        "night-QC: Wellue_O2Ring-S_Y_20260905045318_PPG2W.txt names no waveform "
        "column in its header, so its class-B quality is ABSENT rather than clean"
    )
    caplog.clear()
    real_open = open

    def boom(path, *a, **k):
        if str(path).endswith("_PPG2W.txt"):
            raise OSError("unreadable")
        return real_open(path, *a, **k)

    monkeypatch.setattr("builtins.open", boom)
    with caplog.at_level(logging.WARNING, logger="tepna-capture"):
        assert [b["file"] for b in nightqc.class_b_quality(night)] == later, "an absent file skips, not stops"
    (rec,) = caplog.records
    assert rec.getMessage() == (
        "night-QC: Wellue_O2Ring-S_Y_20260905045318_PPG2W.txt is unreadable, so its "
        "class-B quality is ABSENT rather than clean — the two must not read alike"
    )
    assert rec.exc_info and rec.exc_info[0] is OSError, "the traceback travels with the warning"


def test_class_b_quality_skips_torn_rows_and_survives_an_unreadable_file(tmp_path, monkeypatch):
    """A torn row is expected at a live file's tail; an unreadable file is ABSENT, not clean."""
    night = str(tmp_path)
    p = _write_ppg(
        night, "Wellue_O2Ring-S_X_20260905045318_PPG.txt", _baseline() + _RAMP_DOWN + [0] * 30 + _RAMP_UP + _baseline()
    )
    with open(p, "a") as fh:
        fh.write("2026-09-05T04:54:00.000;0;not-a-number\n")  # torn tail row, skipped
        fh.write("short;row\n")  # too few fields, skipped
    assert nightqc.class_b_quality(night)[0]["rows"], "the torn rows did not erase the verdict"
    real_open = open

    def boom(path, *a, **k):
        if str(path).endswith("_PPG.txt"):
            raise OSError("unreadable")
        return real_open(path, *a, **k)

    monkeypatch.setattr("builtins.open", boom)
    assert nightqc.class_b_quality(night) == []


def test_the_rail_tolerance_is_OUTWARD_only():
    """`_PLATEAU_LSB` exists for the OVERSHOOT past the pin, not for the approach to it.

    The ring's ceiling rail is 199 and flickers up to 200; admitting that flicker is what merges one
    plateau otherwise reported as 118 + 81 regions. A symmetric tolerance — which this file carried
    until 2026-09-06 — also admits a 198 under a 199 ceiling and a 1 above a 0 floor, which are values
    the encoding CAN represent and the device DID report. It extended every span by a sample at each
    end and opened ceiling spans during the ramp. Making it outward-only brought this implementation
    to exact parity with the independent JS port: 170 spans, floor 91, ceiling 79, 5,647 samples.
    """
    assert nightqc._at_rail(199, 199, True, 1) and nightqc._at_rail(200, 199, True, 1)
    assert not nightqc._at_rail(198, 199, True, 1), "one LSB short of the pin is measured signal"
    assert nightqc._at_rail(0, 0, False, 1)
    assert not nightqc._at_rail(1, 0, False, 1), "and so is one LSB above a floor rail"


def test_a_pin_shorter_than_min_run_is_not_reported():
    """`_CLIP_MIN_RUN` is the floor on what reaches the sidecar.

    ⚠️ The stream must carry a QUALIFYING rail, or this passes for the wrong reason. A first draft
    used one short pin on a clean baseline and asserted no regions — which was true because
    `rail_value` found no rail at all (3 zeros against 1 neighbour is a ratio of 3.0, under
    `_RAIL_SPIKE_MIN`), so `min_run` was never consulted and the assertion tested nothing.
    """
    long_pins = (_baseline() + _RAMP_DOWN + [0] * 30 + _RAMP_UP) * 3
    short_pin = _RAMP_DOWN + [0] * 3 + _RAMP_UP + _baseline()
    v = long_pins + short_pin
    assert nightqc.rail_value(v, toward_high=False) == 0, "the rail qualifies, so min_run is reached"
    spans = nightqc.clip_regions(v, min_run=5, annotations=(_MK,))
    assert [r["n_samples"] for r in spans] == [30, 30, 30], "the 3-sample pin is under the bar"
    assert all(r["n_samples"] >= 5 for r in spans)


def test_a_BLE_hole_in_the_arrival_record_is_CUT_not_compacted(tmp_path):
    """§2.2 step 2a at the QC level: a 60 s hole in a 0.5 s cadence produces two segments and
    `pooled: True` in the per-stream stability block — the ledger says how the curve treated it."""
    d = tmp_path / "2026-08-15"
    d.mkdir()
    lines = ["Phone timestamp;device;meas;first_sensor_ns;last_sensor_ns;n_samples"]
    wobble = (0.31, -0.17, 0.23, -0.29, 0.11, -0.37, 0.19, -0.13)
    for i in range(600):
        host_s = i * 0.5 + (3 if i % 2 == 0 else -3) / 1000.0 + (60.0 if i >= 300 else 0.0)
        dev_ns = int(i * 0.5e9 + wobble[i % 8] * 1e6 + (60.0e9 if i >= 300 else 0))
        stamp = "2026-08-15T02:%02d:%02d.%03d" % (int(host_s // 60), int(host_s % 60), int((host_s * 1000) % 1000))
        lines.append("%s;Polar H10 02849638;ecg;%d;%d;73" % (stamp, dev_ns, dev_ns))
    (d / "Polar_H10_02849638_20260815024240_PMDARRIVAL.csv").write_text("\n".join(lines) + "\n")
    rows = nightqc.arrival_quality(str(d))
    assert len(rows) == 1
    st = rows[0]["stability"]
    assert st["ok"] is True, st
    assert st["pooled"] is True and st["segments"] == 2 and st["dropped_intervals"] == 1


# ── coverage is against the DEVICE's own span (2026-09-24) ──────────────────────────────────────────
# It used to divide one device's rows by the SESSION span — the union across devices — so a device that
# stopped early was charged for the time another kept recording, and "stopped early" and "dropped packets
# while recording" produced the same number. They are opposite findings: one is correct behaviour, the
# other is the loss this metric exists to catch.

_DEV_0923 = [
    {"name": "H10", "device_id": "02849638", "streams": ["ecg"]},
    {"name": "Verity", "device_id": "0C301E3F", "streams": ["ppg"]},
    {"name": "Ring", "device_id": "S8AW2100", "streams": ["ppg"]},
]
_SPAN_0923 = 20200  # 23:13:18 -> 04:49:58, the real session span
# THE SAMPLE RATE IS THE FREE PARAMETER HERE, AND THE SPANS ARE NOT.
#
# Every number the 09-23 tests below assert is a coverage RATIO or an absolute count of SECONDS, and
# coverage is `rows / (measured_hz * span)` where `rows` is written as `own_s * hz`. The rate therefore
# CANCELS: 0.9945 / 0.9158 / 0.9257, the 0.6 in-recording loss, the 0.55 session denominator and the
# 1701 / 1501 `stopped_early_s` are all properties of the geometry alone. The real 130 / 55 / 125 Hz
# bought nothing except bytes — 6 million rows, and `_cap_timed` writes one line each.
#
# It bought 1.6 GB, measured: those tests plus their three-zone parametrization retained
# 1,684,021,248 bytes of `tmp_path`, ~1.7 GB per retained run. A mutation run spawns a pytest per
# mutant, so 37 retained directories exhausted the rig's shared /tmp quota on 2026-09-24 and every
# session's gates began failing with EDQUOT. Holding the spans and dropping the rate to 2 Hz keeps
# every asserted value identical — verified, not assumed — at 1/53 of the bytes.
_QC_HZ = 2.0


def _end_0923():
    """The session END as an epoch, DERIVED from the earliest filename stamp rather than hardcoded.

    ⚠️ This was a literal epoch and the three tests below passed in EDT and failed in CI's UTC by
    exactly 14,400 s. `_session_of` turns the `_YYYYMMDDHHMMSS_` filename stamp into an epoch with
    `datetime.strptime(...).timestamp()` — a NAIVE datetime, so the conversion uses the READER's zone —
    while `mtime` is an absolute epoch that does not move. Pairing a fixed epoch with a civil filename
    stamp is therefore only self-consistent in the zone the epoch was chosen in.

    The production data has a civil-time relationship between the two, so the fixture expresses that
    relationship instead of a number: the end is the stamp's own epoch plus the span, which holds in
    any zone. The `_tz` fixture then runs the twin in two of them so this cannot regress silently."""
    return nightqc._session_of("X_20260923231318_PPG.txt") + _SPAN_0923


@pytest.fixture(params=["UTC", "America/New_York", "Asia/Kolkata"])
def _tz(request):
    """Run a test in a named zone. CI is UTC and the rig is EDT, and a span that depends on the reader's
    zone passes in one and fails in the other — which is how this arrived.

    `Asia/Kolkata` is the third on purpose: it is a HALF-HOUR offset, so it catches a sign error or a
    rounding-to-the-hour that two whole-hour zones agree on. `loss_audit`'s suite was verified across the
    same three before being declared zone-safe."""
    old_tz = os.environ.get("TZ")
    os.environ["TZ"] = request.param
    time.tzset()
    try:
        yield request.param
    finally:
        if old_tz is None:
            os.environ.pop("TZ", None)
        else:
            os.environ["TZ"] = old_tz
        time.tzset()


def _night_0923(tmp_path, h10_early=0):
    """The measured 2026-09-23 geometry: one session 23:13:18 -> 04:49:58 (span 20,200 s), with each
    device's OWN recording extent as it really was."""
    night = str(tmp_path / "2026-09-23")
    os.makedirs(night)
    for name, own, hz, early in [
        ("Polar_H10_02849638_20260923231432_ECG.txt", 20089, _QC_HZ, h10_early),
        ("Polar_VeritySense_0C301E3F_20260923231318_PPG.txt", 18499, _QC_HZ, 1701),
        ("Wellue_O2Ring-S_S8AW2100_20260923231349_PPG.txt", 18699, _QC_HZ, 1501),
    ]:
        # `+ 1`: `_cap_timed` stamps row i at i/hz, so N rows span (N-1)/hz. One extra row makes the
        # device span EXACTLY `own` instead of one sample short of it. At 130 Hz that shortfall was
        # 1/130 s and rounded away; at any lower rate it does not, and the Verity's 18,499 s read 18,498.
        # The geometry should not depend on the sample rate, which is the whole point of `_QC_HZ`.
        _utime(_cap_timed(night, name, int(own * hz) + 1, hz), _end_0923() - early)
    return night


# ── WHY A DEVICE STOPPED EARLY — carried from `loss_audit.wear_ends`, never inferred here ──────────
def _wear(name, at, reason):
    """A `loss_audit.wear_by_device`-shaped mapping for one device."""
    return {name: {"available": True, "ends": [], "worn_end": {"at": at, "reason": reason, "file": "f"}}}


def test_an_early_stop_carries_the_wear_units_reason_and_boundary(tmp_path, _tz):
    """THE 09-23 GEOMETRY. The Verity stopped 1701 s before the session end and the wear unit says it was
    a `doff`, so the seconds and the reason read together instead of the reader joining two files."""
    s = nightqc.summarize(_night_0923(tmp_path), _DEV_0923, _wear("Verity", "2026-09-24T04:21:42", "doff"))
    v = next(d for d in s["devices"] if d["name"] == "Verity")
    assert v["stopped_early_s"] == 1701 and v["stopped_early_reason"] == "doff"
    assert v["worn_end_at"] == "2026-09-24T04:21:42"
    # the devices the mapping says nothing about are still NOT DETERMINED, not "no reason"
    assert next(d for d in s["devices"] if d["name"] == "Ring")["stopped_early_reason"] is None


def test_the_device_that_defines_the_session_end_gets_a_boundary_but_no_reason(tmp_path, _tz):
    """⚠️ THE H10 CASE, and the reason `stopped_early_reason` is not simply the wear reason. Its
    `stopped_early_s` is 0 because it is the device that stopped LAST — it defines the session end — and a
    reason there would read as a fault where there is none. It still came off before its file did: on
    2026-09-23 the strap streamed an empty 28 min after 04:21:47, and that window held 2,766 of the
    night's 2,767 "PVCs" (#3001). `worn_end_at` is published whether or not the device stopped early, so
    that gap is READABLE rather than inferred."""
    s = nightqc.summarize(_night_0923(tmp_path), _DEV_0923, _wear("H10", "2026-09-24T04:21:47", "doff"))
    h = next(d for d in s["devices"] if d["name"] == "H10")
    assert h["stopped_early_s"] == 0, "the device that stopped last defines the session end"
    assert h["stopped_early_reason"] is None, "a 0-second early stop has no reason to name"
    assert h["worn_end_at"] == "2026-09-24T04:21:47", "and the wear boundary is still published"


def test_an_unclassified_quiet_end_travels_verbatim(tmp_path, _tz):
    """`quiet-end-unclassified` is the wear unit saying it COULD NOT TELL. Shortening or mapping it here
    would turn "I do not know" into a verdict, so it passes through exactly as written."""
    s = nightqc.summarize(
        _night_0923(tmp_path), _DEV_0923, _wear("Verity", "2026-09-24T04:21:42", "quiet-end-unclassified")
    )
    v = next(d for d in s["devices"] if d["name"] == "Verity")
    assert v["stopped_early_reason"] == "quiet-end-unclassified"


@pytest.mark.parametrize(
    "wear",
    [
        None,
        {},
        {"Verity": None},
        {"Verity": {"available": False}},
        {"Verity": {"available": True, "worn_end": None}},
        {"Verity": {"available": True, "worn_end": {"at": "x", "reason": ""}}},
    ],
    ids=["no-mapping", "empty", "device-null", "unavailable", "no-worn-end", "blank-reason"],
)
def test_every_way_of_not_knowing_the_reason_reads_null(tmp_path, wear):
    """FOUR HOPS CAN GO ABSENT and none of them means "worn to the end": no mapping, no entry for the
    device, an unavailable wear block, or a block with no `worn_end`. A blank reason is the fifth — a
    string that is present and says nothing is not a reason."""
    s = nightqc.summarize(_night_0923(tmp_path), _DEV_0923, wear)
    v = next(d for d in s["devices"] if d["name"] == "Verity")
    assert v["stopped_early_s"] == 1701, "the seconds are measured either way"
    assert v["stopped_early_reason"] is None


def test_attach_wear_is_the_one_place_wear_reaches_a_summary(tmp_path, _tz):
    """`summarize` routes its own return through `attach_wear`, so there is ONE mapping rather than two
    that can diverge. Calling it again on an already-attached summary must give the same answer."""
    night = _night_0923(tmp_path)
    wear = _wear("Verity", "2026-09-24T04:21:42", "doff")
    once = nightqc.summarize(night, _DEV_0923, wear)
    twice = nightqc.attach_wear(nightqc.summarize(night, _DEV_0923), wear)
    pick = lambda s: {d["name"]: (d["stopped_early_reason"], d["worn_end_at"]) for d in s["devices"]}
    assert (
        pick(once)
        == pick(twice)
        == {"H10": (None, None), "Verity": ("doff", "2026-09-24T04:21:42"), "Ring": (None, None)}
    )


def test_neither_the_join_nor_the_wear_scan_is_offloaded_to_a_child(tmp_path):
    """⚠️ A REGRESSION GUARD FOR A SILENT HANG, not a style check.

    `capture._qc_offload` sends its target to a SPAWNED child when `_importable_by_reference` says the
    module still binds that name to that object. Several poller tests patch `nightqc.summarize` with a
    LAMBDA precisely so that check fails and the poll runs on a thread — a frozen `time.monotonic` and a
    spawned child cannot coexist, because `multiprocessing` reads it for its deadlines and the child's
    result never arrives. An earlier draft offloaded the wear scan as a SECOND child, which is a
    module-level name those patches do not cover: `check.sh` then wedged twice at 98 % with all 24 xdist
    workers idle and the controller in `futex_do_wait`, and the single test hung with a `multiprocessing`
    queue feeder alive beside it.

    So the scan's target stays `nightqc.summarize`, the wear scan goes on a thread (as `write_night`
    already does with the same work), and the join is pure."""
    import capture

    assert capture._importable_by_reference(nightqc.summarize), "the seam the poller tests patch"
    src = inspect.getsource(capture.qc_poller)
    assert "_qc_offload(nightqc.summarize," in src, "the scan's target must stay `nightqc.summarize`"
    assert "_qc_offload(loss_audit" not in src, "the wear scan must NOT get a child of its own"
    assert "to_thread(loss_audit.wear_by_device" in src, "it runs on a thread, like write_night"
    assert "_qc_offload(nightqc.attach_wear" not in src, "the join is pure — never offloaded"
    # and the join really is pure: it reads no file, so it cannot need a child
    assert nightqc.attach_wear({"devices": []}, None) == {"devices": []}


def test_attach_wear_steps_over_a_device_entry_that_is_not_a_dict():
    """`attach_wear` is public and can be handed a summary from anywhere — a JSON file rewritten by hand,
    an older schema. A junk entry is stepped over rather than crashing the join for the devices beside
    it: the fields it could not set stay None, which already means "not determined"."""
    summary = {
        "devices": [
            "not a dict",
            {"name": "Verity", "stopped_early_s": 1701, "stopped_early_reason": None, "worn_end_at": None},
        ]
    }
    got = nightqc.attach_wear(summary, _wear("Verity", "2026-09-24T04:21:42", "doff"))
    assert got["devices"][0] == "not a dict", "left exactly as it came"
    assert got["devices"][1]["stopped_early_reason"] == "doff", "and the real device is still joined"


def test_the_poller_joins_a_wear_scan_and_survives_its_failure(monkeypatch):
    """The wear scan is a REPORT, not the QC. If it raises, the night still gets its summary and the
    reasons stay None — which already means "not determined"."""
    summary = {
        "devices": [{"name": "Verity", "stopped_early_s": 1701, "stopped_early_reason": None, "worn_end_at": None}]
    }
    assert nightqc.attach_wear(dict(summary), None)["devices"][0]["stopped_early_reason"] is None
    got = nightqc.attach_wear(
        {"devices": [dict(summary["devices"][0])]}, _wear("Verity", "2026-09-24T04:21:42", "doff")
    )
    assert got["devices"][0]["stopped_early_reason"] == "doff"


def _cap_timed_with_gap(night, name, hz, own_s, keep):
    """A file whose DEVICE CLOCK spans `own_s` but which delivers only `keep` of its rows, missing in one
    contiguous block — an in-recording loss, as against a stream that simply stopped.

    `measured_hz` reads the MEDIAN inter-sample delta, so one gap does not move the rate; that is what
    makes the loss show up in coverage instead of being absorbed into the denominator."""
    p = os.path.join(night, name)
    step = int(round(1e9 / hz))
    t0 = 1_000_000_000_000
    n = int(own_s * hz)
    half = int(n * keep / 2)
    with open(p, "w") as fh:
        fh.write("Phone timestamp;sensor timestamp [ns];channel 0\n")
        for i in list(range(half)) + list(range(n - half, n)):
            fh.write(f"2026-07-19T00:00:00.000;{t0 + i * step};{i}\n")
    return p


def test_the_0923_twin_session_span_gave_092_and_the_device_span_gives_100(tmp_path, _tz):
    """THE TWIN, on the real geometry. Under the SESSION span each device's own extent divided by 20,200 s
    is 0.9945 / 0.9158 / 0.9257 — the three numbers actually published for 2026-09-23, to four decimals —
    and QC's own `gaps` was EMPTY for that night, so nothing was missing. Under each device's own span the
    same files read 1.00, and the 28.4 and 25.0 minutes become `stopped_early_s` instead of 8 % of
    nothing."""
    s = nightqc.summarize(_night_0923(tmp_path), _DEV_0923)
    assert s["span_sec"] == _SPAN_0923, "the session span is the union across devices"

    by = {d["name"]: d for d in s["devices"] if d.get("coverage")}
    # THE OLD DENOMINATOR, twice: recomputed from each device's own span (so the twin carries the
    # arithmetic) AND read back off the published `session_coverage` field (so it is the code's number
    # and not the test's). The two agreeing is the twin.
    assert round(by["H10"]["span_sec"] / _SPAN_0923, 4) == 0.9945
    assert round(by["Verity"]["span_sec"] / _SPAN_0923, 4) == 0.9158
    assert round(by["Ring"]["span_sec"] / _SPAN_0923, 4) == 0.9257
    assert by["H10"]["session_coverage"] == {"ecg": 0.99}
    assert by["Verity"]["session_coverage"] == {"ppg": 0.92}
    assert by["Ring"]["session_coverage"] == {"ppg": 0.93}

    assert by["H10"]["coverage"] == {"ecg": 1.0}
    assert by["Verity"]["coverage"] == {"ppg": 1.0}
    assert by["Ring"]["coverage"] == {"ppg": 1.0}
    assert by["Verity"]["stopped_early_s"] == 1701 and by["Ring"]["stopped_early_s"] == 1501
    assert by["H10"]["stopped_early_s"] == 0, "the device that stopped last defines the session end"
    assert by["Verity"]["span_basis"] == {"ppg": "device"}
    assert by["Verity"]["session_end"] == round(_end_0923()), "the end it is measured against is named"
    # No `wear` argument was passed, so the reason is NOT DETERMINED — never "no reason", and never
    # "worn to the end". The tests below pass one.
    assert by["Verity"]["stopped_early_reason"] is None
    assert by["Verity"]["worn_end_at"] is None


def test_an_IN_RECORDING_loss_still_reads_as_a_loss_under_the_new_denominator(tmp_path, _tz):
    """THE CASE THE METRIC EXISTS FOR, and the one a device-span denominator could have blinded. The
    Verity here keeps its FULL span and loses 40 % of its rows in one block: coverage must fall to 0.6
    while `stopped_early_s` stays 0, so the two situations are distinguishable rather than sharing a
    number. A deeper loss must still reach `degraded`, which is the alert path — `_DEGRADED_BELOW` is
    unchanged at 0.5."""
    night = str(tmp_path / "2026-09-23")
    os.makedirs(night)
    _utime(_cap_timed(night, "Polar_H10_02849638_20260923231432_ECG.txt", int(20089 * _QC_HZ), _QC_HZ), _end_0923())
    _utime(
        _cap_timed_with_gap(night, "Polar_VeritySense_0C301E3F_20260923231318_PPG.txt", _QC_HZ, 18499, 0.6), _end_0923()
    )
    by = {d["name"]: d for d in _summarize_floating(night, _DEV_0923)["devices"] if d.get("coverage")}
    assert by["Verity"]["coverage"] == {"ppg": 0.6}, "an in-recording loss is still a loss"
    assert by["Verity"]["stopped_early_s"] == 0, "it did not stop early — it dropped rows"
    assert by["Verity"]["span_basis"] == {"ppg": "device"}
    assert by["Verity"]["session_coverage"] == {"ppg": 0.55}, "the old number, kept and named"

    # A SECOND night in its own subdir, keeping the 09-23 stamps: a filename stamp that POSTDATES the
    # mtime is not a session at all, and reusing 09-24 names with an 09-24 04:49 mtime made one.
    night2 = str(tmp_path / "deeper" / "2026-09-23")
    os.makedirs(night2)
    _utime(_cap_timed(night2, "Polar_H10_02849638_20260923231432_ECG.txt", int(20089 * _QC_HZ), _QC_HZ), _end_0923())
    _utime(
        _cap_timed_with_gap(night2, "Polar_VeritySense_0C301E3F_20260923231318_PPG.txt", _QC_HZ, 18499, 0.4),
        _end_0923(),
    )
    s2 = _summarize_floating(night2, _DEV_0923)
    assert any("Verity:ppg" in line for line in s2["degraded"]), (
        f"a deep in-recording loss must still reach the alert path: {s2['degraded']}"
    )


def test_a_stream_that_DIED_EARLY_now_reads_as_an_early_stop_and_not_as_lost_packets(tmp_path, _tz):
    """⚠️ THE DELIBERATE SHIFT, pinned so it is visible rather than emergent. A stream that stopped at
    hour one of a six-hour session used to read coverage 0.17 and land in `degraded`; against its own span
    it delivered everything it sent, so it now reads 1.00 with `stopped_early_s` carrying the five hours.

    That is the definition coverage states for itself — "did we receive the packets the device was
    SENDING" — and it is strictly more informative, because the old number could not tell this from a
    stream that lost five hours of packets while still connected. But it does mean the EARLY STOP no
    longer reaches `degraded` on its own, and nothing consumes `stopped_early_s` yet: whether an early
    stop is a fault depends on WHY (a doff is correct behaviour, a link loss is not), which is Wren's
    wear-end unit and the `stopped_early_reason` slot above."""
    night = str(tmp_path / "2026-09-23")
    os.makedirs(night)
    _utime(_cap_timed(night, "Polar_H10_02849638_20260923231432_ECG.txt", int(20089 * _QC_HZ), _QC_HZ), _end_0923())
    # the Verity records one hour and stops, five hours before the H10 does
    _utime(
        _cap_timed(night, "Polar_VeritySense_0C301E3F_20260923231318_PPG.txt", int(3600 * _QC_HZ), _QC_HZ),
        _end_0923() - 16489,
    )
    s = nightqc.summarize(night, _DEV_0923)
    by = {d["name"]: d for d in s["devices"] if d.get("coverage")}
    assert by["Verity"]["coverage"] == {"ppg": 1.0}, "it sent one hour and we received one hour"
    assert by["Verity"]["stopped_early_s"] == 16489, "the missing five hours are HERE, named"
    # AND THE ALERT IS NOT LOST: `session_coverage` keeps the old number and `degraded` keys on it, so a
    # died-at-hour-one stream still raises exactly what it raised before. No threshold was invented to
    # keep that; the number that was already there is simply named instead of overwritten.
    assert by["Verity"]["session_coverage"] == {"ppg": 0.18}
    assert any("Verity:ppg" in line for line in s["degraded"]), s["degraded"]


def test_a_clockless_file_falls_back_to_the_session_span_and_SAYS_SO(tmp_path, _tz):
    """§∅ in the direction that matters here: a file carrying no device clock cannot bound its own start,
    and dropping such files from the span would move the start later, shorten the span and INFLATE
    coverage. So the denominator falls back to the session span and `span_basis` reports it — the same
    shape `coverage_basis` uses for an unmeasured rate."""
    night = str(tmp_path / "2026-07-19")
    os.makedirs(night)
    _utime(_cap(night, "Polar_H10_02849638_20260719220000_ECG.txt", 130000), _stamp_epoch() + 1000)
    _utime(_cap(night, "Polar_H10_02849638_20260719220000_ACC.txt", 40000), _stamp_epoch())
    h10 = next(d for d in _summarize_floating(night, _devices())["devices"] if d["name"] == "H10")
    assert h10["span_basis"] == {"ecg": "session", "acc": "session"}
    assert h10["span_sec"] is None, "an unbounded span is None, never a number"


# ── FIXTURE FIDELITY: a time claim must be made on a fixture that carries time ─────────────────────
#
# `_cap` writes clockless `i;i` rows, so `writers.file_span_sec` returns None for every file it makes
# and no device span can be computed from one. That is correct for a test whose claim is about SESSION
# grouping — which is decided by filename stamps and mtimes, both of which `_cap` + `_utime` model
# faithfully — and wrong for a test whose claim is about a device's own span, rate or coverage basis.
#
# THE GAP THIS CLOSES, measured 2026-09-24: all 170 tests in this file passed IDENTICALLY before and
# after #3009 changed the coverage denominator from the session span to the device's own span, because
# every fixture fell back to the session span and the new path was never reached. The suite could not
# see a live behavioural change, and the zone defect that came with it surfaced only in CI. A green
# suite said nothing, which is the most expensive thing a suite can say.
#
# ⚠️ THE ANSWER IS NOT "MOVE THEM ALL". Two of the entries below assert the ASSUMED-RATE path on
# purpose — `_cap` writes too few rows for `measured_hz` to read a rate, so coverage is computed
# against the configured one and the row reads `(rate assumed)`. Moving those onto timed fixtures would
# turn their basis to `measured` and delete the coverage they exist to provide. A third is the
# fallback test itself, whose whole claim is that a clockless file falls back and says so.
#
# So each time-claiming test on `_cap` is listed here with the reason its claim does not need stamps,
# and the scan below fails on any that is not — and on any entry that no longer matches a real test,
# so the list cannot rot into a rubber stamp.
_TIME_CLAIM_WORDS = (
    r"\b(span|coverage|gap|stop|stopped|rate|hz|clock|stamp|zone|session|early"
    r"|duration|silent|drift|epoch|minute|hour|second)\b"
)

_CLOCKLESS_BY_DESIGN = {
    # #3266 survivor kills. Both are SESSION-level: a span from a filename stamp to an mtime, and coverage
    # as rows over that span against the EXPECTED rate — no device clock takes part in either.
    "test_a_degraded_line_ROUNDS_its_percent_and_never_truncates_it": "session-span coverage against the expected rate; the claim is the printed percent",
    "test_span_reason_is_NULL_when_there_is_a_span_and_session_end_NULL_when_there_is_not": "session span from stamp and mtime; the claim is which fields are null",
    # SESSION-LEVEL CLAIMS. Decided by filename stamps and mtimes; a device clock plays no part, and
    # the outputs asserted (`span_sec` at the session level, `gaps`, pooling) are computed without one.
    "test_summarize_unifies_a_cross_midnight_session": "session grouping across a date-folder boundary",
    "test_summarize_does_not_pool_a_mid_day_session": "session grouping — pooling refusal",
    # The seam pair: a DEVICE clock would give each file its own span and destroy the very shape being
    # reproduced — live night 1 had `span_sec: None` and `span_basis: "session"` on every stream, which
    # is only reachable from clockless files. The claim is about session BOUNDS (filename stamps, mtimes
    # and a recorded daemon start), so no device stamp takes part in it.
    "test_a_daemon_restart_does_not_merge_two_sessions_into_one_union_span": "session splitting at a recorded daemon start",
    "test_without_a_STARTS_sidecar_the_session_basis_says_gap_only": "the absent-evidence control for that split",
    "test_the_POOLED_half_brings_its_own_seams_from_the_neighbouring_folder": "session splitting across a pooled folder boundary",
    "test_summarize_scopes_coverage_to_the_current_session": "session SCOPING; its epochs derive from the same strptime().timestamp() production uses, so it is zone-invariant by construction",
    "test_a_box_wide_outage_does_not_get_the_night_graded_green": "session splitting at _SESSION_GAP_SEC",
    "test_an_uninterrupted_night_reports_no_gap_and_stays_green": "the no-gap control",
    "test_summarize_pools_when_the_reconnect_took_longer_than_the_gap": "pooling by contiguity",
    "test_summarize_pools_when_the_neighbour_was_still_writing_at_wake": "pooling by overlap",
    "test_summarize_does_not_pool_a_non_contiguous_small_hours_session": "pooling refusal by contiguity",
    "test_span_at_exactly_the_minimum_is_judgeable": "the SESSION span floor _MIN_SPAN_SEC",
    # The mirror of the entry above, and it is listed for the same reason: the claim is that a span
    # UNDER the floor names why it cannot be judged. The shortness is produced by filename stamp +
    # mtime arithmetic alone and no device stamp is read for it, exactly as in the judgeable case.
    "test_span_reason_NAMES_the_minimum_when_the_span_is_too_short": "the SESSION span floor _MIN_SPAN_SEC, refusing arm",
    "test_an_in_night_hole_BEFORE_the_judged_half_also_reds": "gap classification against the night band",
    "test_pooling_boundary_exactly_at_midnight_pools": "pooling boundary, lower",
    "test_pooling_boundary_exactly_at_the_gap_does_not_pool": "pooling boundary, upper",
    "test_the_night_band_is_chosen_by_the_sessions_MIDPOINT": "which band a gap is judged against",
    "test_a_foreign_device_file_sorting_FIRST_does_not_end_the_sidecar_scan": "file-scan continuation",
    "test_the_cross_midnight_pool_is_EXCLUSIVE_at_exactly_the_gap": "pooling boundary, exclusive",
    "test_the_night_window_and_arrival_are_computed_from_THIS_night": "collaborator scoping",
    # NO FILES AT ALL — there is no span to carry.
    "test_summarize_no_data_files_span_is_none": "a night of only a sidecar has no capture span",
    # THE ASSUMED-RATE PATH, ON PURPOSE. Timed fixtures would make the basis `measured` and delete the
    # coverage these provide; both assert `(rate assumed)` / `coverage_basis == expected` explicitly.
    "test_summarize_flags_a_degraded_trickle": "asserts the CONFIGURED-rate path and its `(rate assumed)` label",
    "test_summarize_coverage_uses_configured_rate_and_skips_unknown": "asserts the configured-rate denominator and the skip when no rate is known",
    # THE FALLBACK ITSELF.
    "test_a_clockless_file_falls_back_to_the_session_span_and_SAYS_SO": "its claim IS that a clockless file falls back and reports `span_basis: session`",
}


def _time_claiming_clockless_tests():
    """Every test in this file whose docstring makes a time claim and which builds its night with the
    CLOCKLESS `_cap` only. Keyed on the FIXTURE CALL, not on a name or a leaf: what a test is made of
    is the property in question, and a name-keyed scan would be the wrong tool for the same reason the
    schema scanner's leaf key was."""
    import ast
    import re

    tree = ast.parse(open(__file__).read())
    out = {}
    for t in ast.walk(tree):
        if not (isinstance(t, ast.FunctionDef) and t.name.startswith("test_")):
            continue
        calls = {c.func.id for c in ast.walk(t) if isinstance(c, ast.Call) and isinstance(c.func, ast.Name)}
        if (
            "_cap" in calls
            and "_cap_timed" not in calls
            and re.search(_TIME_CLAIM_WORDS, ast.get_docstring(t) or "", re.I)
        ):
            out[t.name] = True
    return out


def test_every_time_claiming_test_on_a_clockless_fixture_is_declared():
    """A time claim made on a fixture that carries no time is the gap this file had: 170 tests passed
    identically across #3009's change of denominator because every one of them fell back to the session
    span. Any new test that claims time on `_cap` must either move to `_cap_timed` or say here why its
    claim does not need stamps."""
    found = _time_claiming_clockless_tests()
    undeclared = sorted(set(found) - set(_CLOCKLESS_BY_DESIGN))
    assert not undeclared, (
        "these make a time claim on the clockless `_cap`: move them to `_cap_timed` (and take the `_tz` "
        f"fixture), or declare why the claim needs no stamps: {undeclared}"
    )


def test_no_declaration_outlives_the_test_it_excuses():
    """The other half, and the one that rots silently: an entry for a test that was renamed, deleted or
    already moved to `_cap_timed` is a line nobody reads that makes the list look considered. Spent
    entries are the failure mode of every allowlist in this repo."""
    found = _time_claiming_clockless_tests()
    spent = sorted(set(_CLOCKLESS_BY_DESIGN) - set(found))
    assert not spent, f"declared but no longer a time-claiming clockless test: {spent}"


def test_the_scan_can_actually_see_one():
    """The anti-vacuity control. Both assertions above pass over an EMPTY population if the scan is
    broken — an AST walk that matches nothing reports the same green as a file with nothing to find,
    which is this repo's most-repeated defect. So the scan must find the population it is scanning."""
    found = _time_claiming_clockless_tests()
    assert len(found) >= 15, f"the scan found {len(found)} — it is not seeing the file"
    assert "test_a_clockless_file_falls_back_to_the_session_span_and_SAYS_SO" in found, (
        "the deliberately-clockless test must be visible to the scan that excuses it"
    )


# ── THE QC POLL PATH RETAINS NO DECODED JSON — measured, and guarded ─────────────────────────────
# The heap probe's first real night (#2999, 2026-09-24) showed `json/decoder.py:361` growing by
# +182,469 live objects in one hour, and the QC poll was the leading suspect: it decodes the PREVIOUS
# `QC-SUMMARY.json` every poll and merges any foreign keys into the new one by reference
# (`capture.py:7973`). Measured here instead of reasoned about: over N = 2, 3, 8 and 16 polls of the real
# `summarize` + that merge + `write_verdicts`, `json/decoder.py` retains **+0 objects at every N**, and
# the whole path's retention is ~0.6 KiB per poll — about 12 KiB/h against the observed 9.2 MiB/h, three
# orders of magnitude short. The per-poll figure FALLS as N rises (34 → 13.8 objects), which is amortised
# warm-up, not accumulation. So the poller is exonerated and the holder is elsewhere; residue
# `2026-09-25-json-retention-is-not-the-qc-poll` records that and what to measure next.


def _poll_once(night, devs):
    """`summarize` + the poller's read-modify-write merge of the previous summary + the verdicts."""
    summ = nightqc.summarize(night, devs)
    qc = os.path.join(night, "QC-SUMMARY.json")
    if os.path.exists(qc):
        with open(qc, encoding="utf-8") as fh:
            prior = json.load(fh)
        if isinstance(prior, dict):
            for k, v in prior.items():
                summ.setdefault(k, v)
    with open(qc, "w", encoding="utf-8") as fh:
        json.dump(summ, fh, indent=2)
    nightqc.write_verdicts(night, summ, devs)


def _decoder_retention(fn, n):
    """Live bytes+objects attributable to `json/decoder.py` that survive `n` calls of `fn`."""
    import tracemalloc

    gc.collect()
    tracemalloc.start()
    try:
        base = tracemalloc.take_snapshot()
        for _ in range(n):
            fn()
        gc.collect()
        top = tracemalloc.take_snapshot().compare_to(base, "lineno")
    finally:
        tracemalloc.stop()
    dec = [s for s in top if "json/decoder.py" in str(s.traceback)]
    return sum(s.size_diff for s in dec), sum(s.count_diff for s in dec)


def test_the_qc_poll_retains_NO_decoded_json_across_repetitions(tmp_path):
    """A GUARD ON A GOOD PROPERTY. It passes today; it fails the day someone caches prior summaries."""
    night = str(tmp_path / "2026-09-24")
    os.makedirs(night)
    devs = _devices()
    _cap(night, "Polar_H10_02849638_20260924220000_ECG.txt", 3000)
    _cap(night, "Polar_H10_02849638_20260924220000_ACC.txt", 1200)
    _poll_once(night, devs)  # warm: first poll builds the caches
    size, count = _decoder_retention(lambda: _poll_once(night, devs), 4)
    assert count == 0, (
        f"the poll path now retains {count} decoded-JSON objects ({size} B) across 4 polls. It decodes "
        "the previous QC-SUMMARY every poll and merges foreign keys BY REFERENCE; holding those across "
        "polls turns a per-poll read into an accumulator. Measured 0 at N=2/3/8/16 when this was written."
    )


def test_CONTROL_the_retention_instrument_can_SEE_a_held_decoded_object(tmp_path):
    """ANTI-VACUITY for the guard above, which asserts a ZERO. A measurement that reports 0 because it
    cannot see anything would pass it forever, so the same function is pointed at a loop that retains on
    purpose and must report growth."""
    blob = json.dumps({"rows": [{"i": i, "s": f"value-{i}"} for i in range(200)]})
    held: list = []
    size, count = _decoder_retention(lambda: held.append(json.loads(blob)), 4)
    assert count > 0 and size > 0, (
        f"the instrument reported {count} objects / {size} B for four deliberately retained decodes — "
        "it cannot see retention, so the zero it reports for the poll path means nothing"
    )
    assert len(held) == 4


# ── THE DIGEST NAMES ITS DENOMINATOR — the human-facing twin of #3067 ────────────────────────────
# #3067 stopped the VERDICT presenting a session-basis coverage as the device's. This line is the same
# conflation for a human reader: on a night whose directory holds two capture sessions, a device that
# recorded perfectly through one of them reads ~52 %, and "H10 52%" is indistinguishable from packet loss.


def test_PLANT_the_digest_marks_a_SESSION_basis_percentage(tmp_path):
    summ = {
        "night": "2026-09-24",
        "devices": [
            {
                "name": "Polar H10 02849638",
                "coverage": {"ecg": 0.52, "acc": 0.52},
                "span_basis": {"ecg": "session", "acc": "session"},
            }
        ],
    }
    line = nightqc.qc_digest(summ)
    assert "52%~session" in line, f"a union-span figure must say so: {line}"


def test_PLANT_the_digest_marks_an_UNLABELLED_basis_too(tmp_path):
    """Not knowing the denominator is not the same as knowing it was the device's — an older summary
    read back by this reader must not have `device` inferred for it."""
    summ = {"night": "2026-09-24", "devices": [{"name": "H10", "coverage": {"ecg": 0.52}}]}
    assert "52%~basis?" in nightqc.qc_digest(summ)


def test_CONTROL_a_device_basis_percentage_is_printed_BARE_as_before(tmp_path):
    """The ordinary case must not gain noise. Passes on origin/main too, where no suffix exists at all."""
    summ = {
        "night": "2026-09-24",
        "devices": [{"name": "H10", "coverage": {"ecg": 0.98}, "span_basis": {"ecg": "device"}}],
    }
    line = nightqc.qc_digest(summ)
    assert "H10 98%" in line and "~" not in line, line


def test_the_SOLID_NIGHT_terms_do_not_consume_nightqc_coverage_and_must_not_start(tmp_path):
    """A GUARD ON A GOOD PROPERTY, not a fix.

    The multi-session defect (`2026-09-25-coverage-spans-two-capture-sessions`) infects every quantity
    derived from a night DIRECTORY's span. `solid_night_inputs.completeness` is immune because it divides
    by the WORN INTERVAL — `rate × (end - start)` with `rows_between(p, start, end)` — and reads no QC
    object at all. That immunity is a property nobody wrote down, so a later refactor could wire the
    term to QC's coverage for convenience and silently inherit the union-span artifact.

    Keyed on the SOURCE, because the property is "does not read it" and a behavioural test cannot
    observe an absence of coupling. Read through `_srcscan.module_source`, NOT raw: a raw read of a
    mutatable module makes mutmut report "failed to collect stats" and the whole module goes unmeasured —
    caught here by `test_mutation_hygiene.py` on the first run of this test."""
    from _srcscan import module_source

    for mod in ("solid_night.py", "solid_night_inputs.py"):
        src = module_source(mod)
        for forbidden in ("QC-SUMMARY", "QC-VERDICT", "qc_verdict", "qc_digest"):
            assert forbidden not in src, (
                f"{mod} now reads {forbidden}: the SOLID-NIGHT terms are scored on the worn interval, and "
                "a QC coverage is scored on the night directory's span — which is the union across "
                "capture sessions. Wiring them together re-imports the multi-session artifact."
            )
    # Non-vacuity: the scan must be able to fail, and the strings must be the ones production uses.
    assert "QC-SUMMARY" in module_source("nightqc.py")


# ── qc_digest's UNKILLED MUTANTS — brought into scope by touching the function ────────────────────
# The mutation gate is diff-scoped, so editing one line of `qc_digest` put its whole mutant set in scope
# and surfaced eight survivors that predate this change. Each is killed below by an assertion on the
# behaviour it changes, not by widening a baseline: "change that line and the suite stays green" is the
# defect, and the remedy is an observation, never an allowlist entry.


def _digest_dev(**kw):
    base = {"name": "H10", "coverage": {"ecg": 0.98}, "span_basis": {"ecg": "device"}}
    base.update(kw)
    return base


def test_the_digest_SKIPS_a_non_dict_device_and_keeps_going(tmp_path):
    """Kills `continue` → `break` (mutmut_26): a malformed entry must not silence every device after it.
    A summary is read back off disk, so one foreign row is exactly what this loop guards against."""
    line = nightqc.qc_digest({"night": "2026-09-24", "devices": ["not-a-dict", _digest_dev()]})
    assert "H10 98%" in line, f"a bad entry before a real device hid it: {line}"


def test_the_digest_reports_a_RANGE_when_a_devices_streams_diverge(tmp_path):
    """Kills the `pct` truncation (mutmut_37). A device whose acc and ppg диverge 41 %/95 % must not be
    summarised as one number — the range is the point, and only a divergent fixture can see it."""
    wide = nightqc.qc_digest(
        {
            "night": "n",
            "devices": [
                _digest_dev(coverage={"ppg": 0.41, "acc": 0.95}, span_basis={"ppg": "device", "acc": "device"})
            ],
        }
    )
    assert "41–95%" in wide, wide
    tight = nightqc.qc_digest(
        {
            "night": "n",
            "devices": [
                _digest_dev(coverage={"ppg": 0.97, "acc": 0.98}, span_basis={"ppg": "device", "acc": "device"})
            ],
        }
    )
    assert "97%" in tight and "–" not in tight.split("H10 ")[1][:8], tight


def test_the_digest_keeps_the_DRIFT_when_it_appends_a_reset(tmp_path):
    """Kills `extra +=` → `extra =` (mutmut_79): the reset must be appended to the drift, not replace it.
    Losing the drift silently is the worse half — a reset count with no drift reads as benign."""
    line = nightqc.qc_digest(
        {
            "night": "n",
            "devices": [_digest_dev(rtc={"reads": 3, "drift_s": 2.4, "span_h": 7.3, "resets": 2, "pushes": 1})],
        }
    )
    assert "RTC +2.4s" in line and "2⚠reset" in line, line


def test_the_dat_vs_rtc_disagreement_fires_ABOVE_one_second_and_not_AT_it(tmp_path):
    """Kills `gap > 1` → `gap >= 1` (mutmut_124) and `> 2` (mutmut_125) together, by pinning both sides of
    the boundary: the .dat's own quantum is 1 s, so a 1 s disagreement is agreement and 2 s is not.

    ⚠️ The `datfit` fixture carries `ok` and `converged` because the renderer requires both — my first
    version omitted them, the `.dat` segment never rendered at all, and the "no flag at 1 s" half passed
    VACUOUSLY while the "flag at 2 s" half failed and said so. A fixture that omits what production
    supplies is the recurring defect, and here it made one assertion hollow and one honest."""

    def line(lag, drift):
        return nightqc.qc_digest(
            {
                "night": "n",
                "devices": [
                    _digest_dev(
                        rtc={"reads": 2, "drift_s": drift, "span_h": 6.0, "resets": 0, "pushes": 1},
                        datfit={"ok": True, "lag_s": lag, "converged": True},
                    )
                ],
            }
        )

    assert "⚠±" not in line(3.4, 2.4), "a 1 s gap is the .dat's quantum, not a disagreement"
    # ⚠️ 1.5, NOT 2.0. My first fixture used lag 4.4 / drift 2.4, whose float gap is 2.0000000000000004 —
    # so `gap > 2` was STILL true and the `> 2` mutant survived a test written to kill it. A boundary
    # fixture must sit strictly BETWEEN the true threshold and the mutant's, never on either.
    assert "⚠±2s" in line(3.9, 2.4), "a 1.5 s gap is above the 1 s quantum and must be flagged"


def test_the_digest_omits_the_device_segment_ENTIRELY_when_no_device_reported(tmp_path):
    """Kills `if parts` → `if (parts) or True` (mutmut_137): with no device segment the mutant joins an
    EMPTY string into the line, so the digest reads "night n — · no data: X" with a dangling separator."""
    line = nightqc.qc_digest({"night": "n", "devices": [{"name": "Ring", "coverage": {}, "streams": {}}]})
    assert line is not None and "no data: Ring" in line, line
    assert "—  · " not in line and not line.split("— ")[1].startswith("· "), f"empty segment joined: {line}"


def test_the_digest_lists_at_most_FOUR_missing_streams(tmp_path):
    """Kills `missing[:4]` → `[:5]` (mutmut_158). The cap exists because this line goes to a webhook with
    a length budget; a fifth entry is the thing the slice is for."""
    line = nightqc.qc_digest({"night": "n", "devices": [_digest_dev()], "missing": ["a:1", "b:2", "c:3", "d:4", "e:5"]})
    assert "e:5" not in line, f"the fifth missing stream must be dropped: {line}"
    assert all(k in line for k in ("a:1", "b:2", "c:3", "d:4")), line


def test_an_ABSENT_device_does_not_stop_the_digest_reading_the_REST(tmp_path):
    """Kills the absent-branch `continue` → `break`: a device that produced nothing must not hide every
    device after it. This is the same shape as the non-dict guard above, one branch further down, and it
    is the branch a real night hits — a docked Verity ahead of a recording H10."""
    line = nightqc.qc_digest(
        {
            "night": "n",
            "devices": [
                {"name": "Verity", "coverage": {}, "streams": {}},
                _digest_dev(coverage={"ecg": 0.99}, span_basis={"ecg": "device"}),
            ],
        }
    )
    assert "H10 99%" in line, f"an absent device before a recording one hid it: {line}"
    assert "no data: Verity" in line, line


def test_the_digest_line_is_EXACTLY_this_for_a_known_summary(tmp_path):
    """THE WHOLE FORMAT, pinned as one string.

    The per-behaviour assertions above each kill a mutant I could read. Two survivors in the pct
    formatting could not be read at all — `mutate_diff`'s printed diff is truncated for them — so this
    pins the rendered line character for character instead. A formatting mutant anywhere in the device
    segment, the separators, the ordering or the suffixes changes this string, which is the one assertion
    that does not require knowing WHICH change to expect."""
    summ = {
        "night": "2026-09-24",
        "devices": [
            _digest_dev(
                name="H10",
                coverage={"ecg": 0.99, "acc": 0.98},
                span_basis={"ecg": "device", "acc": "device"},
                rtc={"reads": 3, "drift_s": 2.4, "span_h": 7.3, "resets": 1, "pushes": 1},
                datfit={"ok": True, "lag_s": 3.9, "converged": True},
            ),
            _digest_dev(
                name="Verity",
                coverage={"ppg": 0.41, "acc": 0.95},
                span_basis={"ppg": "session", "acc": "session"},
                rtc=None,
            ),
            {"name": "Ring", "coverage": {}, "streams": {}},
        ],
        "missing": ["a:1", "b:2", "c:3", "d:4", "e:5"],
    }
    # Read off the real renderer and then checked element by element rather than assumed: H10's 0.98/0.99
    # agree within 0.05 so one number (the LO, 98 %) · the RTC group and the .dat group are SEPARATE
    # parenthesised suffixes · a 1.5 s gap renders "±2s" at `.0f` · the Verity's session basis is marked ·
    # the ring has no numeric coverage so it is "no data" · and the fifth missing stream is dropped.
    assert nightqc.qc_digest(summ) == (
        "night 2026-09-24 — H10 98% (RTC +2.4s/1⚠reset) (.dat +3.9s ⚠±2s),"
        " Verity 41–95%~session · no data: Ring · missing: a:1, b:2, c:3, d:4"
    )


def test_the_range_threshold_is_STRICT_at_exactly_five_points(tmp_path):
    """Kills `(hi - lo) < 0.05` → `<= 0.05` (mutmut_37), and the pair that kills it is not the obvious one.

    🔴 THE TRAP, WHICH IS THE WHOLE VALUE OF THIS TEST. The instinctive fixture is 0.90/0.95, and it
    CANNOT kill the mutant: `0.95 - 0.90` is `0.04999999999999993`, below the threshold under BOTH
    operators, so both render "90%". Every plausible 5-point pair behaves that way except one — in binary,
    `0.55-0.50`, `0.80-0.75` and `1.00-0.95` are all `0.050000000000000044` (above under both), while
    `0.15-0.10` is below under both. **Only `hi - lo` computed from 0.0 and 0.05 is EXACTLY the double
    0.05**, which is the single point where strict and non-strict disagree.

    So a character-exact golden over ordinary coverage values survives this mutant, and anyone testing it
    with 0.90/0.95 would conclude it is equivalent and ledger it as unkillable. It is not: a device with
    one stream at 0 % and another at 5 % is an ordinary failed-capture night.

    Found by Osprey, who regenerated the mutant and read its source after `mutate_diff`'s printed diff
    truncated mid-literal; arithmetic re-verified here before use."""

    def pct(lo, hi):
        line = nightqc.qc_digest(
            {
                "night": "n",
                "devices": [_digest_dev(coverage={"a": lo, "b": hi}, span_basis={"a": "device", "b": "device"})],
            }
        )
        return line.split("H10 ")[1].split(" ")[0].rstrip(",")

    assert (0.05 - 0.0).hex() == (0.05).hex(), "the fixture rests on this being the exact double 0.05"
    assert pct(0.0, 0.05) == "0–5%", "a gap of EXACTLY 0.05 is not 'within 0.05' — strict, so a range"
    # And the pair that does NOT distinguish them, asserted so the trap is pinned rather than described:
    assert pct(0.90, 0.95) == "90%", "0.04999999999999993 is under the threshold either way"


# ---------------------------------------------------------------------------------------------------
# §🔒 §1/§5 — A SPAN MUST NOT DEPEND ON THE ZONE OF THE BOX READING IT.
# residue 2026-09-24-session-span-resolves-a-floating-stamp-in-the-readers-zone
#
# `_session_of` turns the `_YYYYMMDDHHMMSS_` filename stamp — a FLOATING civil time written with no zone
# — into an epoch through the reader's zone, while the other end of the same subtraction was `mtime`, an
# ABSOLUTE instant. Measured on the real 2026-09-09 night before the fix: the judged session span read
# 116,853 s under TZ=UTC, 102,453 s under America/New_York and 149,253 s under Asia/Tokyo — one EDT
# offset and one JST offset apart, from the same files. The UTC figure is 32.5 h for a single session,
# which is the tell: the mixed frame inflates the span past anything physical and nothing objected.
# ---------------------------------------------------------------------------------------------------

_ZONE_STAMP = "20260909212938"
_ZONE_STEP_NS = 1_000_000_000  # 1 Hz, so span_sec is exactly rows-1 with no truncation


def _zone_night(
    tmp_path,
    *,
    offsets=(14400.0, 14400.0, 14400.0),
    rows=601,
    stamp=_ZONE_STAMP,
    lags=None,
    streams=("ECG", "ACC", "HR"),
):
    """A night of `len(offsets)` files from ONE connection, built to a KNOWN writer offset per file.

    Each file carries a device clock covering exactly `rows - 1` seconds and an mtime placed at
    `floating(stamp) + span + offset`, so `mtime − (stamp + span)` — the `extent` basis
    `nightqc.recover_writer_offset` falls back to — is that file's `offset` exactly. One stamp and several
    stream tags is the real shape of a multi-stream connection (an H10 opens ECG, ACC and HR together), so
    the files form a single session rather than three.

    ⚠️ THE MTIME MUST SIT AFTER THE STAMP IN EVERY ZONE. An earlier one collapses `max(session, mtime)`
    onto the stamp and the span reads 0 in all zones at once — which satisfies "identical in every zone"
    while measuring nothing. That vacuous pass actually happened here; the value-pinning twin below is
    what caught it, and is why both tests exist rather than one.
    """
    d = tmp_path / "captures" / "2026-09-09"
    d.mkdir(parents=True, exist_ok=True)
    span = (rows - 1) * _ZONE_STEP_NS / 1e9
    t0 = nightqc.floating_stamp_s(stamp)
    for i, off in enumerate(offsets):
        p_ = d / f"Polar_H10_02849638_{stamp}_{streams[i % len(streams)]}.txt"
        _write_stream_ns(str(p_), _ZONE_STEP_NS, rows=rows)
        lag = 0.0 if lags is None else lags[i]
        os.utime(str(p_), ((t0 + span + off + lag),) * 2)
    return str(d), span


def test_the_RECORDED_offset_is_preferred_and_a_DST_SEAM_refuses_one_value(tmp_path):
    """Residue `2026-09-28-writer-records-no-utc-offset`. The box recorded its zone NOWHERE, so every
    reader inferred it from `mtime` against a last row — a bounded vote that refuses a night which
    captured almost nothing (measured on 2026-09-14, and on 2026-08-08 where two killed sessions split
    the vote three ways). From 2026-10-05 `writers.append_start` records it at session open, and this is
    the read side `recover_writer_offset`'s docstring was written in anticipation of.

    Six outcomes, because the interesting ones are the absences:
      · one row, or several AGREEING → `declared`, with every recovery field None (a declared value has
        no voters, and "no voters" must not read as "zero agreed");
      · rows DISAGREEING → None. A night whose sessions opened at different offsets spans a DST change,
        and one `offset_sec` would be wrong for half of it — §∅, a discontinuity refuses rather than
        publishing one side of itself as the whole;
      · a BLANK → None, never 0, because 0 is a real offset reported by a box running UTC;
      · a UTC box's recorded 0 → 0.0, which is the leg that proves the blank is not read as a value;
      · a PRE-2026-10-05 five-column file → None, "nothing recorded", not a parse error;
      · no file at all → None.
    """
    d = tmp_path / "captures" / "2026-08-15"
    d.mkdir(parents=True, exist_ok=True)
    HEAD = "Phone timestamp;pid;git;dirty;adapter;utc_offset_sec"

    def starts(rows, header=HEAD):
        (d / "STARTS.csv").write_text(header + "\n" + "".join(r + "\n" for r in rows), encoding="utf-8")

    starts(["2026-08-15T15:49:45.000;1;abc;no;hci0;-14400"])
    one = nightqc.recorded_writer_offset(str(d))
    assert one is not None and one["offset_sec"] == -14400.0, one
    assert one["basis"] == "declared", one
    # the recovery fields are None, not 0 and not empty tallies — `declared_offset`'s own contract
    assert one["voters"] is None and one["modal_share"] is None and one["unanimous"] is None, one

    starts(["a;1;x;no;hci0;-14400", "b;2;x;no;hci0;-14400"])
    agree = nightqc.recorded_writer_offset(str(d))
    assert agree is not None and agree["offset_sec"] == -14400.0, agree

    starts(["a;1;x;no;hci0;-14400", "b;2;x;no;hci0;-18000"])
    assert nightqc.recorded_writer_offset(str(d)) is None, "a DST seam must refuse, not pick a side"

    starts(["a;1;x;no;hci0;"])
    assert nightqc.recorded_writer_offset(str(d)) is None, "a blank is not 0"

    starts(["a;1;x;no;hci0;0"])
    utc = nightqc.recorded_writer_offset(str(d))
    assert utc is not None and utc["offset_sec"] == 0.0, "a box running UTC records a REAL 0"

    starts(["a;1;x;no;hci0"], header="Phone timestamp;pid;git;dirty;adapter")
    assert nightqc.recorded_writer_offset(str(d)) is None, "a pre-2026-10-05 layout recorded nothing"

    (d / "STARTS.csv").unlink()
    assert nightqc.recorded_writer_offset(str(d)) is None

    # ── the rows that contribute NO vote, each for its own reason ────────────────────────────────────
    # A TRUNCATED row (fewer cells than the column) is not a zero offset and not an error: a killed
    # write can leave one, and the remaining rows still carry the night's answer.
    starts(["a;1;x;no;hci0;-14400", "b;2;x"])
    short = nightqc.recorded_writer_offset(str(d))
    assert short is not None and short["offset_sec"] == -14400.0, short
    # A NON-NUMERIC cell likewise — neither an offset nor a zero.
    starts(["a;1;x;no;hci0;-14400", "b;2;x;no;hci0;not-a-number"])
    junk = nightqc.recorded_writer_offset(str(d))
    assert junk is not None and junk["offset_sec"] == -14400.0, junk
    # …and when the ONLY row is unusable, nothing was recorded — not 0.
    starts(["b;2;x;no;hci0;not-a-number"])
    assert nightqc.recorded_writer_offset(str(d)) is None


def test_an_UNREADABLE_starts_file_falls_back_rather_than_claiming_an_offset(tmp_path):
    """∅ The `except OSError` path, driven rather than left to inspection. An absent STARTS.csv is the
    expected case for every night captured before 2026-10-05; an unreadable one is rarer and must take
    the SAME branch, because the safe direction is an inferred offset and never a guessed recorded one."""
    d = tmp_path / "captures" / "2026-08-15"
    d.mkdir(parents=True, exist_ok=True)
    # a DIRECTORY where the file should be: `open` raises IsADirectoryError, an OSError
    (d / "STARTS.csv").mkdir()
    assert nightqc.recorded_writer_offset(str(d)) is None


def test_the_recorded_offset_is_read_BY_HEADER_NAME_not_by_position(tmp_path):
    """The column was APPENDED to a five-column file, and this repo has already paid for a positional
    read of a grown row: appending `alarm_raw` to OXYFRAME silently moved three writer tests onto
    different columns, one asserting `flag_raw` and getting `199` from `ppg_offset`.

    So a row with a FURTHER column appended after `utc_offset_sec` must still read the offset correctly —
    which a `cells[-1]` or `cells[5]` implementation would not."""
    d = tmp_path / "captures" / "2026-08-15"
    d.mkdir(parents=True, exist_ok=True)
    (d / "STARTS.csv").write_text(
        "Phone timestamp;pid;git;dirty;adapter;utc_offset_sec;a_future_column\n" + "a;1;x;no;hci0;-14400;whatever\n",
        encoding="utf-8",
    )
    got = nightqc.recorded_writer_offset(str(d))
    assert got is not None and got["offset_sec"] == -14400.0, got
    # …and when the offset moves to a different INDEX, the name still finds it
    (d / "STARTS.csv").write_text(
        "Phone timestamp;utc_offset_sec;pid;git;dirty;adapter\n" + "a;-18000;1;x;no;hci0\n", encoding="utf-8"
    )
    moved = nightqc.recorded_writer_offset(str(d))
    assert moved is not None and moved["offset_sec"] == -18000.0, moved


def _recovered(night):
    files = nightqc.scan_night(night)
    data = [f for f in files if f["stream"] not in nightqc._SIDECAR_TAGS]
    return nightqc.recover_writer_offset(night, data), data


def _spans_in(zone, night):
    """The night's session spans AS PRODUCTION COMPUTES THEM — recover the offset, then merge on it."""
    old = os.environ.get("TZ")
    os.environ["TZ"] = zone
    time.tzset()
    try:
        off, data = _recovered(night)
        sessions = nightqc.merge_sessions(data, offset_sec=off["offset_sec"])
        return [round(e - s, 3) for s, e, _f in sessions]
    finally:
        if old is None:
            os.environ.pop("TZ", None)
        else:
            os.environ["TZ"] = old
        time.tzset()


# ── `recover_writer_offset`: the vote, the bound, the floor and the tally ──────────────────────────────
#
# Every assertion below pins a DECISION rather than a branch: which votes count, which are refused on
# magnitude, how many voters the floor demands under unanimity and without it, and what the refusal SAYS.
# A mutation survivor on any of them would mean a night could recover a zone it has no evidence for.


def _vote_file(night, name, *, d, rows=3, ns_step=None, last=None):
    """A capture file whose `last-row` vote is EXACTLY `d` seconds.

    The last row's host stamp is written as the civil components of a chosen FLOATING second `last`, so
    `file_last_row_floating_s` reads back exactly `last`; the mtime is then placed at `last + d`. That
    makes `mtime − floating(last row)` equal `d` to the microsecond, which is what lets a test sit a vote
    precisely ON a bound or precisely at a bucket edge instead of near one.

    `ns_step` adds a device-clock column so the file also has a `span_sec`, i.e. an `extent` basis.
    """
    last = nightqc.floating_stamp_s(_ZONE_STAMP) if last is None else last
    c = _dtmod.datetime(1970, 1, 1) + _dtmod.timedelta(seconds=last)
    stamp = c.strftime("%Y-%m-%dT%H:%M:%S.") + f"{c.microsecond // 1000:03d}"
    head = "Phone timestamp;sensor timestamp [ns];v" if ns_step else "Phone timestamp;v"
    p_ = os.path.join(night, name)
    with open(p_, "w", encoding="utf-8") as fh:
        fh.write(head + "\n")
        for i in range(rows):
            # Only the LAST row carries a stamp: `file_host_span_sec` then finds no first usable row and
            # returns None, so these files carry a vote and no duration basis — the vote is what is under
            # test here, and a span would change the session geometry as a side effect.
            s = stamp if i == rows - 1 else ""
            fh.write(f"{s};{i * ns_step};{i}\n" if ns_step else f"{s};{i}\n")
    os.utime(p_, ((last + d),) * 2)
    return p_


def _night_of_votes(tmp_path, ds, *, rows=3, names=None):
    """A night whose i-th data file votes `ds[i]`. Distinct stream tags, one shared session stamp."""
    d = tmp_path / "captures" / "2026-09-09"
    d.mkdir(parents=True, exist_ok=True)
    tags = names or ["ECG", "ACC", "HR", "PPG", "PPI", "SPO2", "GYRO", "MAG"]
    for i, dv in enumerate(ds):
        _vote_file(str(d), f"Polar_H10_02849638_{_ZONE_STAMP}_{tags[i]}.txt", d=dv, rows=rows)
    return str(d)


def test_a_vote_EXACTLY_at_the_magnitude_bound_is_an_offset_and_is_counted(tmp_path):
    """`>` not `>=`, and which side the bound falls on is a DECISION, not a detail.

    +14:00 is a real zone in use (Line Islands, Kiribati), and `_OFFSET_MAX_ABS_SEC` is exactly that. A
    vote landing ON it is therefore the widest LEGITIMATE offset there is; refusing it would make the one
    zone furthest from UTC the one zone that cannot be recovered."""
    night = _night_of_votes(tmp_path, [nightqc._OFFSET_MAX_ABS_SEC] * 3)
    off, _data = _recovered(night)
    assert off["offset_sec"] == nightqc._OFFSET_MAX_ABS_SEC and off["basis"] == "recovered", off
    assert off["voters"] == 3, off


def test_a_vote_just_BEYOND_the_bound_is_refused_and_leaves_no_voter(tmp_path):
    """One bucket past +14:00 is not a zone, and no majority can make it one — the bound is checked before
    a vote is counted, so such a file does not appear in `voters` at all rather than appearing and losing."""
    night = _night_of_votes(tmp_path, [nightqc._OFFSET_MAX_ABS_SEC + nightqc._OFFSET_BUCKET_SEC] * 3)
    off, _data = _recovered(night)
    assert off["offset_sec"] is None and off["voters"] == 0, off
    assert off["voters_by_basis"] == {"last-row": 0, "extent": 0}, off["voters_by_basis"]


def test_the_tally_COUNTS_its_voters_and_names_which_basis_each_used(tmp_path):
    """Two `last-row` voters and one `extent` voter, so an increment that saturates at 1, decrements, or
    steps by 2 is visible — and so is a tally seeded at 1 instead of 0.

    The `extent` voter is the reachable shape it exists for: its host stamp is a CONSTANT far outside the
    bound (what `_cap_timed` writes), so the `last-row` vote is refused on magnitude and the file falls
    through to its own recorded duration."""
    d = tmp_path / "captures" / "2026-09-09"
    d.mkdir(parents=True, exist_ok=True)
    t0 = nightqc.floating_stamp_s(_ZONE_STAMP)
    _vote_file(str(d), f"Polar_H10_02849638_{_ZONE_STAMP}_ECG.txt", d=14400.0)
    _vote_file(str(d), f"Polar_H10_02849638_{_ZONE_STAMP}_ACC.txt", d=14400.0)
    # An out-of-bound last-row stamp (the 2000-epoch constant), plus a real device clock: 1000 rows at
    # 1 Hz, so `span_sec` is 999 s and the extent vote is mtime − (stamp + 999).
    p3 = d / f"Polar_H10_02849638_{_ZONE_STAMP}_HR.txt"
    _write_stream_ns(str(p3), _ZONE_STEP_NS, rows=1000)
    os.utime(str(p3), ((t0 + 999.0 + 14400.0),) * 2)

    off, _data = _recovered(str(d))
    assert off["offset_sec"] == 14400.0 and off["voters"] == 3, off
    assert off["voters_by_basis"] == {"last-row": 2, "extent": 1}, off["voters_by_basis"]
    assert off["modal_share"] == 1.0 and off["outliers"] == [], off


def test_a_NON_VOTING_file_does_not_end_the_scan(tmp_path):
    """`continue`, not `break`, in both skip paths — a sidecar and a rows-0 file each sit BEFORE a real
    voter here (sorted by name), so breaking on either loses every voter after it and the night refuses
    with `voters: 0` while three files could have spoken."""
    d = tmp_path / "captures" / "2026-09-09"
    d.mkdir(parents=True, exist_ok=True)
    # A LINK sidecar sorts first by vendor name and is excluded by tag, not by content.
    _vote_file(str(d), f"Tepna_{_ZONE_STAMP}_LINK.csv", d=14400.0)
    # A header-only data file: no rows, so the row guard skips it. ⚠️ ITS NAME MUST SORT FIRST — `scan_night`
    # returns files in name order, so a skipped file placed AFTER every voter proves nothing: `break` there
    # loses nothing and the mutant survives a test that looks like it covers it. A lower device id puts it
    # ahead of the voters. (Measured: with this file named `…_SPO2.csv` it sorted last and the `continue`
    # here was reported as a live survivor by the gate on the landing head.)
    empty = d / f"Polar_H10_00000000_{_ZONE_STAMP}_PPI.txt"
    empty.write_text("Phone timestamp;v\n", encoding="utf-8")
    os.utime(str(empty), (nightqc.floating_stamp_s(_ZONE_STAMP) + 14400.0,) * 2)
    # And a file that HAS rows and still cannot vote — no host column and no recorded extent, so neither
    # basis can speak. That is the second skip, and it is a different line from the row guard above: this
    # one is reached only after both bases have been tried and both came back empty. It sorts first, so
    # breaking here would lose every voter after it.
    mute = d / f"Polar_H10_02849638_{_ZONE_STAMP}_ACC.txt"
    mute.write_text(_CLOCKLESS_HEADER + "1;1\n2;2\n", encoding="utf-8")
    os.utime(str(mute), (nightqc.floating_stamp_s(_ZONE_STAMP) + 14400.0,) * 2)
    for tag in ("ECG", "HR", "PPG"):
        _vote_file(str(d), f"Polar_H10_02849638_{_ZONE_STAMP}_{tag}.txt", d=14400.0)

    off, _data = _recovered(str(d))
    assert off["voters"] == 3 and off["offset_sec"] == 14400.0, off


def test_file_intervals_DEFAULT_offset_treats_the_values_as_already_in_one_frame():
    """`offset_sec=0.0` by default, and the default is the whole reason the signature stayed
    back-compatible: it means "these values are already in one frame", which is true of every synthetic
    file dict in this suite and of the module's previous behaviour. A non-zero default would shift every
    such caller silently, which is exactly the class of error this unit exists to remove."""
    f = {"file": "Polar_H10_02849638_20260909212938_ECG.txt", "rows": 9, "session": 1000.0, "mtime": 2000.0}
    assert nightqc.file_interval(f) == (1000.0, 2000.0, "mtime")


def test_TWO_VOTERS_WHO_DISAGREE_are_refused_though_two_who_agree_are_not(tmp_path):
    """The whole point of the revised floor, and the pair that proves it is a REVISION and not a hole.

    `≥2 when unanimous, else ≥3 with a strict majority`. Two agreeing voters are two independent
    measurements concurring; two disagreeing are undecidable, and a floor that let them through would
    resolve a 1-1 split by tie-break — inventing a zone rather than measuring one. This also pins
    `unanimous = bool(votes) AND one bucket`: under `or`, any non-empty vote list reads as unanimous, so
    the pair below would recover a zone off a coin toss.
    """
    agree = _night_of_votes(tmp_path / "agree", [14400.0, 14400.0])
    off_a, _ = _recovered(agree)
    assert off_a["offset_sec"] == 14400.0 and off_a["unanimous"] is True, off_a

    split = _night_of_votes(tmp_path / "split", [14400.0, 18000.0])
    off_s, _ = _recovered(split)
    assert off_s["offset_sec"] is None and off_s["unanimous"] is False, off_s
    assert off_s["voters"] == 2 and "the floor is 3" in off_s["reason"], off_s["reason"]
    # ...and the reason must NOT claim unanimity it does not have, nor omit it when it holds.
    assert "for a unanimous vote" not in off_s["reason"], off_s["reason"]
    lone = _night_of_votes(tmp_path / "lone", [14400.0])
    off_l, _ = _recovered(lone)
    assert off_l["unanimous"] is True and "the floor is 2 for a unanimous vote" in off_l["reason"], off_l


def test_a_bucket_holding_EXACTLY_HALF_is_not_a_strict_majority(tmp_path):
    """`<= 0.5`, not `< 0.5`. Four voters split two-and-two hold exactly half each, and a rule that
    accepted that would be resolving the split by whichever bucket the maximum happened to pick — the
    tie-break the floor exists to refuse. The reason names the largest bucket so an operator can see how
    close the night came rather than only that it failed."""
    night = _night_of_votes(tmp_path, [14400.0, 14400.0, 18000.0, 18000.0])
    off, _data = _recovered(night)
    assert off["offset_sec"] is None and off["voters"] == 4, off
    assert off["reason"] and "no strict majority" in off["reason"], off["reason"]
    assert "largest bucket holds 2" in off["reason"], off["reason"]


def test_the_modal_share_is_published_to_THREE_decimals(tmp_path):
    """Four of six, i.e. 0.6666…, so 3 decimals and 4 differ (0.667 vs 0.6667). The share is a published
    measure of how well-supported the recovered offset is; a reader comparing nights needs one precision,
    not whichever the arithmetic happened to produce."""
    night = _night_of_votes(tmp_path, [14400.0] * 4 + [18000.0] * 2)
    off, _data = _recovered(night)
    assert off["offset_sec"] == 14400.0 and off["voters"] == 6, off
    assert off["modal_share"] == 0.667, off["modal_share"]
    assert len(off["outliers"]) == 2, off["outliers"]


# ── `daemon_starts`: the FRAME its stamps are raised into, and the window they are tested against ──────
#
# The sidecar's stamps are floating civil time; the file spans they are compared against are in whichever
# frame the caller asked for. Every assertion here pins that one relationship, because getting it wrong is
# how the same night came to count a different number of restarts "inside capture" in New York than in
# Tokyo — and the answer looked equally plausible both times.


def _starts_night(tmp_path, minutes, *, span_min=(300, 420), rows=5, writer_offset=0.0):
    """A night with one data file spanning `span_min` past midnight and daemon starts at `minutes`.

    Everything is FLOATING: the filename stamp, the mtime and the sidecar stamps, so the fixture is in one
    frame and `offset_sec` is the only thing that moves anything."""
    import writers as _w

    night = tmp_path / "captures" / "2026-09-10"
    night.mkdir(parents=True, exist_ok=True)
    t0 = nightqc.floating_stamp_s("20260910000000")
    stamp = _dtmod.datetime(1970, 1, 1) + _dtmod.timedelta(seconds=t0 + span_min[0] * 60)
    name = "Polar_VeritySense_0C301E3F_%s_PPG.txt" % stamp.strftime("%Y%m%d%H%M%S")
    f = night / name
    f.write_text(_CLOCKLESS_HEADER + "".join(f"{i};{i}\n" for i in range(rows)), encoding="utf-8")
    # The mtime models a writer at `writer_offset`: floating end plus the offset, which is exactly the
    # relationship `recover_writer_offset` measures. At 0.0 the fixture is wholly floating.
    os.utime(str(f), ((t0 + span_min[1] * 60 + writer_offset,) * 2))
    with open(os.path.join(str(night), _w.STARTS_NAME), "w", encoding="utf-8") as fh:
        fh.write("Phone timestamp;pid;git;dirty;adapter\n")
        for i, m in enumerate(minutes):
            fh.write(_starts_stamp(t0 + m * 60) + f";{400 + i};2cd12712;no;AA\n")
    return str(night), t0


def test_daemon_start_stamps_are_RAISED_by_the_offset_and_in_the_right_direction(tmp_path):
    """`t + shift`, with `shift` the offset itself and 0.0 only when there is no offset.

    Four separate decisions live on those two lines — whether a shift is applied at all, which value it
    takes, which direction it runs, and what happens when the offset is unknown — and each is a way for a
    recorded seam to land somewhere the night never was. A negated shift puts a 04:00 restart at 20:00 the
    previous day; a shift of 0 under a known offset leaves every seam an offset away from the spans it is
    compared with, which is the original defect wearing a different hat."""
    night, t0 = _starts_night(tmp_path, [240])
    base = nightqc.daemon_starts(night, offset_sec=None)["stamps"]
    assert base == [t0 + 240 * 60], base  # floating frame: unshifted, and no crash
    assert nightqc.daemon_starts(night)["stamps"] == base, "the default offset is 0.0, i.e. one frame"
    raised = nightqc.daemon_starts(night, offset_sec=7200.0)["stamps"]
    assert raised == [t0 + 240 * 60 + 7200.0], raised  # + and not -, and 7200 and not 0 or 1


def test_a_start_ON_either_edge_of_a_capture_span_counts_as_inside(tmp_path):
    """`a <= t <= b`, both ends inclusive, and both ends are decisions.

    A restart at the instant a file opened interrupted that capture; so did one at the instant of its last
    write. Excluding either edge under-reports interruption at exactly the moments most likely to produce
    one — a daemon restart is what opens and closes a capture, so the edges are where starts CLUSTER
    rather than a measure-zero curiosity."""
    night, _t0 = _starts_night(tmp_path, [300, 360, 420])  # open edge · middle · last-write edge
    # The ABSOLUTE frame, where a file is live from its stamp to its last write; in the floating frame a
    # clockless file is a point and has no edges to sit on.
    got = nightqc.daemon_starts(night, offset_sec=0.0)
    assert got["starts"] == 3 and got["inside_capture"] == 3, got


def test_a_SIDECAR_never_contributes_a_span_for_a_start_to_fall_inside(tmp_path):
    """The span population is DATA files, read from each record's own `stream` key.

    The LINK sidecar here spans a stretch no sensor was recording in, and a restart sits inside it. Counted,
    it would report an interruption of a capture that was not happening — the box's own bookkeeping
    mistaken for signal, which is the distinction `_SIDECAR_TAGS` exists to hold."""
    night, t0 = _starts_night(tmp_path, [600])  # 10:00, outside the 05:00-07:00 capture
    link = os.path.join(night, "Tepna_20260910093000_LINK.csv")
    with open(link, "w", encoding="utf-8") as fh:
        fh.write(_CLOCKLESS_HEADER + "".join(f"{i};{i}\n" for i in range(5)))
    os.utime(link, ((t0 + 660 * 60,) * 2))  # 09:30 -> 11:00, containing the 10:00 start
    # The ABSOLUTE frame, so the sidecar has a real interval for the start to be inside — in the floating
    # frame a clockless file is a point and the question could not arise.
    got = nightqc.daemon_starts(night, offset_sec=0.0)
    assert got["starts"] == 1 and got["inside_capture"] == 0, got


def test_the_spans_a_start_is_tested_against_are_RAISED_by_the_same_offset(tmp_path):
    """One frame on BOTH sides, which is the whole point: the stamps are raised and so are the intervals.

    Passing the offset to the stamps but letting the intervals default to 0.0 would compare a raised stamp
    against an unraised window — an offset apart, and silently. Here the start sits inside the capture only
    when both sides move together, so a window left behind reports no interruption at all."""
    for off in (0.0, 7200.0, -3600.0):
        # The fixture is built to that same writer offset, so the start is inside the capture ONLY when the
        # stamps and the intervals are raised together — leave either behind and it falls an offset away.
        night, _t0 = _starts_night(tmp_path / f"o{off}", [360], writer_offset=off)
        got = nightqc.daemon_starts(night, offset_sec=off)
        assert got["inside_capture"] == 1, (off, got)

    # AND THE CONVERSE, which is what makes the pair decisive. A start at 04:00 is BEFORE a capture that
    # opened at 05:00, so it must read as outside. Raise the stamp by the offset but let the interval keep
    # its default 0.0 and the window's start slides back two hours, swallowing it — an interruption
    # reported for a capture that had not begun. Only the window's own start moving catches this.
    night, _t0 = _starts_night(tmp_path / "before", [240], writer_offset=7200.0)
    got = nightqc.daemon_starts(night, offset_sec=7200.0)
    assert got["starts"] == 1 and got["inside_capture"] == 0, got


# ── `merge_sessions` and `scan_night`: ordering, the gap edge, and a span basis that is not recomputed ──


def test_sessions_are_ordered_by_where_they_START_not_where_they_END(tmp_path):
    """A file that opens EARLIER but ends sooner must still be considered first.

    Sorting by end reorders exactly the pair that matters — a long connection opened at 22:00 and a short
    one opened at 23:00 that both stop at midnight — and `merge_sessions` folds each file into the running
    session by comparing its START against the coverage so far. Fed out of order, the earlier file opens a
    session that the later one then appears to precede, and the output stops being ordered at all."""
    long_early = {
        "file": "X_20260909220000_ECG.txt",
        "rows": 10,
        "session": 1000.0,
        "mtime": 9000.0,
        "span_sec": None,
        "host_span_sec": None,
    }
    short_late = {
        "file": "X_20260909230000_ACC.txt",
        "rows": 10,
        "session": 2000.0,
        "mtime": 2500.0,
        "span_sec": None,
        "host_span_sec": None,
    }
    out = nightqc.merge_sessions([short_late, long_early])
    assert [s[0] for s in out] == sorted(s[0] for s in out), out
    assert out[0][0] == 1000.0, out


def test_a_gap_of_EXACTLY_the_threshold_opens_a_NEW_session(tmp_path):
    """`st <= end + gap` merges, so a file opening exactly `gap_sec` after the last write is the LAST one
    that still belongs to the running session — and one microsecond later starts a new one.

    Which side the threshold falls on is a decision, not a rounding detail: it decides whether a night with
    a reconnect exactly at the boundary is judged as one session or two, and every span-derived number
    downstream follows that choice."""
    a = {
        "file": "X_20260909220000_ECG.txt",
        "rows": 10,
        "session": 0.0,
        "mtime": 0.0,
        "span_sec": None,
        "host_span_sec": None,
    }
    at_edge = dict(a, file="X_20260909230000_ACC.txt", session=nightqc._SESSION_GAP_SEC, mtime=nightqc._SESSION_GAP_SEC)
    past_edge = dict(at_edge, session=nightqc._SESSION_GAP_SEC + 1, mtime=nightqc._SESSION_GAP_SEC + 1)
    assert len(nightqc.merge_sessions([a, at_edge])) == 1, "exactly at the gap still belongs"
    assert len(nightqc.merge_sessions([a, past_edge])) == 2, "one second past it does not"


def test_a_file_with_a_DEVICE_clock_is_not_also_given_a_host_span(tmp_path):
    """`None if _span else ...` — the host span is a LAST RESORT, computed only where the device clock
    cannot answer.

    Two reasons it must not be computed alongside: it is a different quantity (when the HOST was writing,
    not what the device clocked), so carrying both invites a caller to difference them; and it costs a
    second read of a file that has already answered. A file that states its own span must therefore report
    `host_span_sec: None` — absence here means "not needed", and the field's own contract says a consumer
    may never read it as a zero."""
    night = tmp_path / "captures" / "2026-09-09"
    night.mkdir(parents=True)
    p = night / f"Polar_H10_02849638_{_ZONE_STAMP}_ECG.txt"
    _write_stream_ns(str(p), _ZONE_STEP_NS, rows=20)
    rec = next(f for f in nightqc.scan_night(str(night)) if f["stream"] == "ECG")
    assert rec["span_sec"] == 19.0, rec["span_sec"]
    assert rec["host_span_sec"] is None, rec["host_span_sec"]


def test_the_start_that_OPENED_a_session_does_not_also_split_it(tmp_path):
    """`sessions[-1][0] < t`, strictly — the seam test is keyed on the session's own start and must EXCLUDE
    it.

    A daemon start at the instant a session opened is the start that opened it. Counting it as a seam
    splits that session from its own first file, so a night begun by a recorded restart — which is the
    normal case, since the daemon writes a start every time it comes up — would be reported as two runs
    where there was one, and every span-derived number would describe a fragment. Anything strictly after
    the opening still splits, which is the case the `starts` evidence exists for."""
    a = {
        "file": "X_20260909220000_ECG.txt",
        "rows": 10,
        "session": 1000.0,
        "mtime": 1500.0,
        "span_sec": None,
        "host_span_sec": None,
    }
    b = dict(a, file="X_20260909220100_ACC.txt", session=1600.0, mtime=2000.0)
    at_open = nightqc.merge_sessions([a, b], starts=[1000.0])
    assert len(at_open) == 1, ("the start that opened the session is not a seam within it", at_open)
    after = nightqc.merge_sessions([a, b], starts=[1000.1])
    assert len(after) == 2, ("a start after the opening DOES split", after)


def test_an_UNDECODABLE_BYTE_in_the_STARTS_sidecar_does_not_lose_the_night(tmp_path):
    """`errors="replace"` on the sidecar read, for the same reason as the voter read.

    `daemon_starts` runs inside `summarize`, so raising here does not cost the restart count — it costs the
    night's whole QC summary. The rows this parses are ASCII by format (an ISO stamp, a pid, a hash, a
    yes/no, an address), so a substituted U+FFFD cannot change which stamps are read: the torn byte sits in
    the ADAPTER field of the first row, and both stamps must still be found."""
    import writers as _w

    night, t0 = _starts_night(tmp_path, [])
    path = os.path.join(night, _w.STARTS_NAME)
    with open(path, "wb") as fh:
        fh.write(b"Phone timestamp;pid;git;dirty;adapter\n")
        fh.write(_starts_stamp(t0 + 300 * 60).encode() + b";400;2cd12712;no;AA\xff\xfe:BB\n")
        fh.write(_starts_stamp(t0 + 360 * 60).encode() + b";401;2cd12712;no;CC\n")
    got = nightqc.daemon_starts(night, offset_sec=0.0)
    assert got["starts"] == 2, got
    assert got["stamps"] == [t0 + 300 * 60, t0 + 360 * 60], got["stamps"]


def test_a_host_span_is_NOT_computed_for_a_file_that_states_its_own(tmp_path):
    """`None if _span else ...` — and the fixture has to carry BOTH clocks or the assertion is vacuous.

    A file with a device clock AND advancing host stamps is the only shape that separates them: computing
    the host span anyway would return a real number here, not None. Two reasons it must not: the host span
    is a different quantity (when the HOST was writing, not what the device clocked), so carrying both
    invites a caller to difference them; and it costs a second read of a file that has already answered."""
    night = tmp_path / "captures" / "2026-09-09"
    night.mkdir(parents=True)
    p = night / f"Polar_H10_02849638_{_ZONE_STAMP}_ECG.txt"
    t0 = nightqc.floating_stamp_s(_ZONE_STAMP)
    rows = ["Phone timestamp;sensor timestamp [ns];v"]
    for i in range(20):
        c = _dtmod.datetime(1970, 1, 1) + _dtmod.timedelta(seconds=t0 + i)
        rows.append(f"{c.strftime('%Y-%m-%dT%H:%M:%S.000')};{i * _ZONE_STEP_NS};{i}")
    p.write_text("\n".join(rows) + "\n", encoding="utf-8")
    rec = next(f for f in nightqc.scan_night(str(night)) if f["stream"] == "ECG")
    assert rec["span_sec"] == 19.0, rec["span_sec"]
    # The host stamps span 19 s too, so this is None only because it was never asked for.
    assert nightqc.file_host_span_sec(str(p)) == 19.0, "the fixture really does carry a host span"
    assert rec["host_span_sec"] is None, rec["host_span_sec"]


def test_an_UNPARSEABLE_stamp_does_not_end_the_backward_walk(tmp_path):
    """`continue`, not `break`, on a stamp that is present but not a datetime.

    The two skips in this walk are different: one steps past a row too SHORT to hold the column, the other
    past a row whose column holds something that is not a stamp — a partially flushed value, a vendor
    string, a trailing marker. The last row written is the likeliest to be torn, so stopping there answers
    "this file has no host stamp" for a file whose previous 40,000 rows all carry one, and the night loses
    a voter it had.

    Found by mutating every `continue` in the function in turn rather than the one the report named: the
    short-row skip was already pinned and this one was not."""
    p = tmp_path / "Polar_H10_02849638_20260909212938_ECG.txt"
    p.write_text("Phone timestamp;v\n2026-09-09T21:30:00.250;1\nnot-a-timestamp;2\n", encoding="utf-8")
    got = nightqc.file_last_row_floating_s(str(p))
    expect = nightqc.floating_stamp_s("20260909213000") + 0.25
    assert got is not None and abs(got - expect) < 1e-9, (got, expect)


def test_scan_night_walks_PAST_what_it_cannot_use_rather_than_stopping(tmp_path):
    """All three skips are `continue`: the QC summary itself, a name that is not a capture file, and a
    directory where a file was expected.

    Each sorts BEFORE something real here, so breaking on any of them truncates the night's file list — and
    a short file list is the 2026-07-28 shape, where a scope failure read as nine simultaneous device
    failures. The scan must return every capture file and every sidecar regardless of what sits between
    them alphabetically.

    Found by mutating each `continue` in turn: two were already pinned and the third was not."""
    night = tmp_path / "captures" / "2026-09-09"
    night.mkdir(parents=True)
    (night / "1-notes.txt").write_text("free text\n", encoding="utf-8")  # not a capture name
    (night / nightqc._SUMMARY_NAME).write_text("{}\n", encoding="utf-8")  # the summary itself
    # A DIRECTORY whose name parses as a capture file, sorting before the real ones. This is the only shape
    # that reaches the `isfile` guard — a plainly-named directory is turned away by the NAME check first, so
    # a test using one leaves this branch unexercised while appearing to cover it. The real case is a scan
    # listing a path that is not a regular file: a stray mount, an interrupted move, a tool's work dir.
    (night / f"Polar_H10_02849638_{_ZONE_STAMP}_AAA.txt").mkdir()
    for tag in ("ECG", "ACC"):
        _vote_file(str(night), f"Polar_H10_02849638_{_ZONE_STAMP}_{tag}.txt", d=14400.0)
    _vote_file(str(night), f"Tepna_{_ZONE_STAMP}_LINK.csv", d=14400.0)

    got = nightqc.scan_night(str(night))
    assert sorted(f["stream"] for f in got) == ["ACC", "ECG", "LINK"], [f["file"] for f in got]


# ── `file_interval`'s FLOATING branch: the duration, its sign and the basis it names ───────────────────
#
# Reachable only when the writer offset could not be recovered, which is exactly when a reader has least
# else to go on — so the interval it builds has to be right, and it has to SAY which clock stated it.


def _iv(**f):
    return nightqc.file_interval(
        {"file": "Polar_H10_02849638_20260909212938_ECG.txt", "rows": 9, "mtime": 9_999_999.0, **f}, None
    )


def test_the_floating_interval_uses_the_DEVICE_clock_and_names_it(tmp_path):
    """`span_sec` present: the end is start PLUS that span, and the basis is `device-clock`.

    Three decisions in one line, each separately wrong-able: which key is read, which direction the
    duration runs, and what the interval claims as its authority. A negated duration would put the end
    BEFORE the start and read as a session that finished before it opened."""
    assert _iv(session=1000.0, span_sec=60.0, host_span_sec=None) == (1000.0, 1060.0, "device-clock")


def test_the_floating_interval_falls_back_to_the_HOST_span_and_names_THAT(tmp_path):
    """No device clock, so the host stamps are the only record of extent — and the basis must change with
    it. Reporting `device-clock` over a host-derived span would credit the device with a number it never
    wrote, which is the whole distinction `file_host_span_sec`'s docstring insists on."""
    assert _iv(session=1000.0, span_sec=None, host_span_sec=42.0) == (1000.0, 1042.0, "host-stamp")


def test_the_floating_interval_of_a_file_with_NO_extent_is_a_POINT_and_says_none(tmp_path):
    """Neither clock: the file is a point at its start, named `none`. Never `mtime` — in this frame an
    mtime is an absolute instant and would be an offset away — and never a fabricated end."""
    assert _iv(session=1000.0, span_sec=None, host_span_sec=None) == (1000.0, 1000.0, "none")


# ── `recover_writer_offset`: what is EXCLUDED from the vote ────────────────────────────────────────────


def test_a_SIDECAR_WITH_ROWS_is_excluded_from_the_vote_even_when_it_could_speak(tmp_path):
    """A sidecar is the box talking about itself, and the exclusion is by TAG, not by whether it happens
    to be unreadable.

    The LINK file here carries rows and a perfectly readable stamp voting an hour away from the three data
    files. Included, it would drag the modal share from 1.0 to 0.75 and put a zone the sensors never saw
    into the tally — so this pins both the `or` (a sidecar is skipped whatever its row count) and that the
    tag is read from the record's own `stream` key."""
    d = tmp_path / "captures" / "2026-09-09"
    d.mkdir(parents=True, exist_ok=True)
    _vote_file(str(d), f"Tepna_{_ZONE_STAMP}_LINK.csv", d=18000.0)
    for tag in ("ECG", "ACC", "HR"):
        _vote_file(str(d), f"Polar_H10_02849638_{_ZONE_STAMP}_{tag}.txt", d=14400.0)
    off, _data = _recovered(str(d))
    assert off["voters"] == 3 and off["modal_share"] == 1.0, off
    assert off["offset_sec"] == 14400.0 and off["outliers"] == [], off


def test_the_EXTENT_basis_reads_the_HOST_span_when_there_is_no_device_clock(tmp_path):
    """The `extent` fallback's second source, on the only shape that reaches it.

    The file's last host stamp is far outside the ±14 h bound, so its `last-row` vote is refused on
    magnitude and it falls through to its own recorded extent — and it carries no device column, so that
    extent can only come from `host_span_sec`. Reading `span_sec` alone there would leave the file with no
    duration and no vote at all, and the night one voter short."""
    d = tmp_path / "captures" / "2026-09-09"
    d.mkdir(parents=True, exist_ok=True)
    t0 = nightqc.floating_stamp_s(_ZONE_STAMP)
    for tag in ("ECG", "ACC"):
        _vote_file(str(d), f"Polar_H10_02849638_{_ZONE_STAMP}_{tag}.txt", d=14400.0)
    # Host stamps spanning 100 s, both ends readable (so `host_span_sec` answers), on a 2000-epoch base
    # far from the mtime — so the last-row vote is out of bound and the extent is what speaks.
    p3 = d / f"Polar_H10_02849638_{_ZONE_STAMP}_HR.txt"
    rows = ["Phone timestamp;v"]
    for i in range(11):
        c = _dtmod.datetime(2000, 1, 1) + _dtmod.timedelta(seconds=i * 10)
        rows.append(f"{c.strftime('%Y-%m-%dT%H:%M:%S.000')};{i}")
    p3.write_text("\n".join(rows) + "\n", encoding="utf-8")
    os.utime(str(p3), ((t0 + 100.0 + 14400.0),) * 2)

    off, _data = _recovered(str(d))
    assert off["voters"] == 3, off
    assert off["voters_by_basis"] == {"last-row": 2, "extent": 1}, off["voters_by_basis"]
    assert off["offset_sec"] == 14400.0 and off["modal_share"] == 1.0, off


# ── `file_last_row_floating_s`: a torn row is WALKED PAST, never indexed into ──────────────────────────


def test_a_TORN_row_is_walked_past_rather_than_indexed_into(tmp_path):
    """The length test guards the index on the SAME line, so it must be `or` and it must be `<=`.

    The host column sits SECOND here, which is what makes the guard live: a row with exactly one field
    has `len(parts) == idx`, so `<` would fall through to `parts[idx]` and raise IndexError out of a
    function whose whole contract is to answer None or a number — taking the night's QC with it. `and`
    raises on the same row for the same reason. The readable row below it must still be found."""
    p = tmp_path / "Polar_H10_02849638_20260909212938_ECG.txt"
    good = "2026-09-09T21:30:00.250"
    p.write_text("v;Phone timestamp\n1;" + good + "\n2\n", encoding="utf-8")
    got = nightqc.file_last_row_floating_s(str(p))
    expect = nightqc.floating_stamp_s("20260909213000") + 0.25
    # 1e-9, not 1e-6: the microsecond field is divided by 1e6, and a tolerance as wide as the quantity
    # being converted cannot see that divisor change at all — a loose bound makes the assertion a shape
    # check wearing a value check's clothes.
    assert got is not None and abs(got - expect) < 1e-9, (got, expect)


def test_an_UNDECODABLE_BYTE_does_not_raise_out_of_the_voter_read(tmp_path):
    """`errors="replace"` on BOTH reads — the header scan and the tail — and neither is decorative.

    A capture file can carry a torn byte: a truncated write, a filesystem hiccup, a partial frame. This
    runs once per data file while a night is being scored, so an exception here does not cost a vote, it
    costs the whole night's QC summary. The substituted U+FFFD cannot change the decision either, because
    the lines this reader matches are ASCII by format — a fixed vocabulary, digits and `;` — so replacing
    an undecodable byte leaves both the structure and the stamp it parses untouched.

    Both halves are exercised: the bad bytes sit in a COMMENT line the header scan must walk past, and
    again in a data field inside the tail window, and the readable stamp must still be found."""
    p = tmp_path / "Polar_H10_02849638_20260909212938_ECG.txt"
    p.write_bytes(b"# timebase=host\xff\xfe-disciplined\nPhone timestamp;v\n;1\n2026-09-09T21:30:00.250;\xff\xfe\n")
    got = nightqc.file_last_row_floating_s(str(p))
    expect = nightqc.floating_stamp_s("20260909213000") + 0.25
    assert got is not None and abs(got - expect) < 1e-9, (got, expect)


# ── `_parse_phone_ts` keeps MILLISECOND precision, deliberately ────────────────────────────────────────


def test_the_sidecar_stamp_is_read_to_MILLISECONDS_and_no_finer(tmp_path):
    """`[:23]`, so `2026-09-24T22:01:29.526789` reads as .526 and not .526789.

    `writers._phone_ts` writes exactly three fractional digits, so three is the precision the format
    carries; a longer fraction can only come from a foreign producer, and silently honouring it would make
    two stamps of the same documented format compare unequal. Pinned as a decision rather than left to the
    slice width."""
    got = nightqc._parse_phone_ts("2026-09-24T22:01:29.526789")
    base = nightqc.floating_stamp_s("20260924220129")
    assert got is not None and abs(got - (base + 0.526)) < 1e-9, (got, base)


# ── `file_last_row_floating_s`: every way a file can decline to vote ───────────────────────────────────
#
# It is the ONE reader of the evidence the writer offset is recovered from, so each way it returns None is
# a way a night loses a voter — and a night that loses enough voters refuses and publishes no span. These
# are not defensive branches: three of the four are shapes the real corpus contains (an empty file left by
# a rejected PMD START, a `# timebase=host-disciplined` preamble, a sidecar that vanished under a scan).


def test_a_file_with_no_bytes_casts_no_vote(tmp_path):
    p = tmp_path / "Polar_H10_02849638_20260909212938_ECG.txt"
    p.write_text("", encoding="utf-8")
    assert nightqc.file_last_row_floating_s(str(p)) is None, "an empty file has no last row"


def test_a_LEADING_COMMENT_does_not_hide_the_header(tmp_path):
    """The ring's host-disciplined streams open with `# timebase=host-disciplined`. Reading line 1 as the
    header made every one of them report "no host column" — measured on the real 2026-09-09 `_PPG2W.txt`,
    which refused while its sibling `_PLETHA.txt` (no comment line) answered. Same bug, same shape, in a
    second reader of the same files."""
    p = tmp_path / "Wellue_O2Ring-S_S8AW_20260909212938_PPG2W.txt"
    p.write_text(
        "# timebase=host-disciplined\n# device=O2Ring\nPhone timestamp;v\n2026-09-09T21:30:00.500;1\n", encoding="utf-8"
    )
    got = nightqc.file_last_row_floating_s(str(p))
    assert got is not None and abs(got - (nightqc.floating_stamp_s("20260909213000") + 0.5)) < 1e-6, got


def test_a_file_that_is_ALL_preamble_casts_no_vote(tmp_path):
    """Bounded, and the bound is the point: without it a large file whose header never arrives would be
    read whole just to conclude it cannot say. Past the bound the answer is "cannot say", not "keep going"."""
    p = tmp_path / "Polar_H10_02849638_20260909212938_ECG.txt"
    p.write_text("".join("# padding\n" for _ in range(nightqc._HOST_SPAN_SCAN_ROWS + 5)), encoding="utf-8")
    assert nightqc.file_last_row_floating_s(str(p)) is None


def test_an_UNREADABLE_path_casts_no_vote_rather_than_raising(tmp_path):
    """A directory where a file was expected is the reachable case — a scan lists a path, the path changes
    under it. One unreadable file must not abort a whole night's QC; it costs a vote, and the night's own
    refusal reports the shortfall by voter count."""
    d = tmp_path / "Polar_H10_02849638_20260909212938_ECG.txt"
    d.mkdir()
    assert nightqc.file_last_row_floating_s(str(d)) is None


def test_an_UNSTAMPED_file_is_placed_at_its_mtime_and_NOT_raised_by_the_offset(tmp_path):
    """§🔒 §1 in the other direction. `_session_of` answers None for a name carrying no start stamp, and
    that file's mtime is ALREADY an absolute instant — so it is used as one. Adding the writer offset to a
    value that never carried one is the same frame error mirrored, and it would move such a file by four
    hours on this box. A stampless file is a one-file session at its own last write."""
    f = {"file": "a_b_c_ECG.txt", "session": None, "mtime": 1_700_000_000.0, "rows": 7}
    assert nightqc.file_interval(f, 14400.0) == (1_700_000_000.0, 1_700_000_000.0, "mtime")
    # ...and in the FLOATING frame it cannot be placed at all, because it has nothing floating to place it
    # by — which is what `summarize` must survive rather than crash on (see the `sessions` gate there).
    assert nightqc.file_interval(f, None) is None


def test_PLANT_a_session_span_is_the_same_number_in_every_reader_zone(tmp_path):
    """THE PLANT. Four zones: one whole hour each side of UTC, one HALF-hour (Kolkata, which catches a
    sign error or a rounding that two whole-hour zones agree on), and UTC itself. A span is a DURATION —
    the same quantity whoever reads the files — and a reader in Tokyo must not see a different night than
    CI does. Measured before the fix, on the real 2026-09-09: 116,853 s in UTC, 102,453 s in New York,
    149,253 s in Tokyo, one whole offset apart each time.
    """
    night, _span = _zone_night(tmp_path)
    got = {z: _spans_in(z, night) for z in ("UTC", "America/New_York", "Asia/Kolkata", "Asia/Tokyo")}
    assert len(set(map(tuple, got.values()))) == 1, (
        "the session span moved with the reader's zone — §🔒 §1: a floating civil stamp resolved through "
        "the local zone and then differenced against an absolute mtime",
        got,
    )


def test_PLANT_the_span_is_the_recorded_duration_because_the_offset_WAS_applied(tmp_path):
    """And it is the right number, not merely a stable one — pinning the value is what stops "identical in
    every zone" being satisfied by a constant.

    The fixture places every mtime one `offset` past the end of its own data, so the session's elapsed
    time IS that data's duration once the offset has been applied to the start. Forgetting to apply it
    leaves `mtime − floating(stamp)` instead, which is longer by the whole offset — so this separates
    "the start was raised into the mtime frame" from "the start was left floating", which no test of
    stability alone can do.
    """
    night, span = _zone_night(tmp_path)
    for zone in ("UTC", "America/New_York", "Asia/Kolkata"):
        (got,) = _spans_in(zone, night)
        assert abs(got - span) == 0, ("the session is as long as the data it holds", zone, got, span)
        assert abs(got - (span + 14400.0)) > 1, (
            "the span is longer by exactly the writer offset — the start was never raised out of floating civil time",
            zone,
            got,
        )


def test_PLANT_a_half_hour_writer_offset_is_recovered_exactly(tmp_path):
    """A 45- or 30-minute zone must survive the bucket, or the recovery silently serves whole hours only.

    19,800 s is +05:30. It is a whole multiple of the 15-minute bucket — which is the reason the bucket is
    15 minutes and not an hour — so it must come back exactly, not rounded to 18,000 or 21,600.
    """
    night, _span = _zone_night(tmp_path, offsets=(19800.0,) * 3)
    off, _data = _recovered(night)
    assert off["offset_sec"] == 19800.0 and off["basis"] == "recovered", off
    assert off["modal_share"] == 1.0 and off["outliers"] == [], off


def test_PLANT_a_two_bucket_night_recovers_the_modal_offset_and_NAMES_its_outlier(tmp_path):
    """Three files agree, one is an hour out — a killed session, whose mtime sits long past its last row.

    The modal bucket wins and the dissenter is REPORTED rather than averaged in: averaging would produce
    an offset no file voted for, and dropping it silently would hide the one file worth looking at. This
    is the case the strict majority exists for, and the case the ±14 h bound does NOT cover — an hour out
    is a plausible zone, so only the vote can settle it.
    """
    night, _span = _zone_night(
        tmp_path, offsets=(14400.0, 14400.0, 14400.0, 18000.0), streams=("ECG", "ACC", "HR", "PPG")
    )
    off, _data = _recovered(night)
    assert off["offset_sec"] == 14400.0, off
    assert off["modal_share"] == 0.75 and off["voters"] == 4, off
    assert off["outliers"] == ["Polar_H10_02849638_20260909212938_PPG.txt"], off["outliers"]


def test_PLANT_too_few_voters_reads_UNKNOWN_with_a_REASON_and_no_guessed_span(tmp_path):
    """One file cannot state the night's zone, and the night says so instead of guessing.

    §∅: the refusal carries a NAMED reason, `offset_sec` is null rather than 0, `frame` says the session
    bounds are floating civil values and not instants, and `span_sec` is null with `span_reason` carrying
    the cause through — a bare null could not distinguish "no data", "under the judgeable minimum" and
    "no frame to measure in", which need different fixes.
    """
    night, _span = _zone_night(tmp_path, offsets=(14400.0,), streams=("ECG",))
    off, _data = _recovered(night)
    assert off["offset_sec"] is None and off["basis"] is None, off
    assert off["voters"] == 1 and off["reason"] and "floor is 2" in off["reason"], off
    s = nightqc.summarize(night, [{"name": "H10", "device_id": "02849638", "streams": ["ecg"]}])
    assert s["span_sec"] is None and s["span_reason"] == off["reason"], (s["span_sec"], s["span_reason"])
    assert s["writer_offset"]["frame"] == "floating", s["writer_offset"]


def test_PLANT_a_vote_beyond_any_real_zone_is_refused_on_its_MAGNITUDE(tmp_path):
    """No majority can make 67 days a time zone.

    The bound is on the QUANTITY and is checked before a vote is counted, which is what makes it a bound
    and not a clamp (§🔒 §7's discipline for `CK_AXIS_MAX_PPM`). Measured need, not a hypothetical: the
    suite's own `_cap_timed` writes a CONSTANT host stamp, and reading it recovered an "offset" of
    5,804,100 s behind a clean 0.667 majority.
    """
    night, _span = _zone_night(tmp_path, offsets=(5_804_100.0,) * 3)
    off, _data = _recovered(night)
    assert off["offset_sec"] is None and off["voters"] == 0, off
    assert off["reason"] and "could vote" in off["reason"], off


def test_PLANT_the_vote_ROUNDS_so_a_millisecond_cannot_move_the_zone(tmp_path):
    """The real 2026-09-27, which flooring got wrong by fifteen minutes.

    Every real UTC offset is an exact multiple of the bucket, so the true value sits exactly ON a boundary
    — where flooring is decided by arbitrarily small jitter of either sign. These two voters land 1 ms and
    10 s BELOW 14,400 (an mtime marginally ahead of its own last row, which is ordinary), and flooring
    sent both to 13,500. A millisecond must not be able to name a different zone.
    """
    night, _span = _zone_night(tmp_path, offsets=(14400.0, 14400.0), lags=(-0.001, -10.038), streams=("ECG", "ACC"))
    off, _data = _recovered(night)
    assert off["offset_sec"] == 14400.0, (off, "a sub-second shortfall moved the recovered zone")
    assert off["unanimous"] is True and off["voters"] == 2, off


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# THE `summarize` SURVIVOR DRAIN — the 41 entries #3188 left in the ledger
#
# `mutation-survivors.json` carried 41 open entries, every one on `nightqc.summarize` and every one
# reported against #3188 — my own unit. The ledger hands this drain a LIST, which changes what done
# means: the acceptance is every listed entry accounted for (killed here, recorded equivalent with an
# argument, or its line deleted because it decides nothing), not a green rollup.
#
# They are drained by FAMILY, because the families are the finding. A mutant that survives a whole
# unit's test suite is telling you which decision nobody asserted, and four of these families are the
# same decision seen four times: a condition neutered to a constant (`or True` / `and False`), a
# boundary moved by one (`<=` → `<`), an argument dropped at a call site, and a `dict(base, **kw)`
# rebuilt without its base.
# ══════════════════════════════════════════════════════════════════════════════════════════════════


def _touching_night(tmp_path):
    """Three sessions that TOUCH at both edges of the judged one, via recorded DAEMON SEAMS.

    ⚠️ Abutting sessions cannot be built from file gaps, and my first attempt at this fixture proved it:
    `merge_sessions` extends a session whenever the next file opens within `_SESSION_GAP_SEC` (3600 s), so
    three files laid end to end merge into ONE session and `gaps` comes back empty. `merge_sessions`'s own
    docstring says where touching sessions come from instead — *"when a seam splits, the earlier session's
    end is clamped to the seam … Sessions may now TOUCH or sit closer than `gap_sec` … the invariant that
    survives is disjointness, not separation."*

    So each boundary here is a recorded start in `STARTS.csv` with a file opening at exactly that second:
    the earlier session's end is clamped to the seam and the next session starts on it, giving
    `earlier.end == judged.start` and `judged.end == later.start` — the input that separates
    `s[1] <= cur[0]` from `s[1] < cur[0]` and `s[0] >= cur[1]` from `s[0] > cur[1]`.

    Floating throughout (`_stamp_epoch`, floating mtimes, `_summarize_floating`), which is the frame the
    box writes and the only one in which a seam stamp and a filename stamp mean the same thing."""
    import writers

    night = str(tmp_path / "2026-09-24")
    os.makedirs(night)
    t0 = _stamp_epoch("20260924210000")
    seam1 = t0 + 600  # run 1 ends / run 2 opens, on the same second
    seam2 = seam1 + 7200  # run 2 ends / run 3 opens, on the same second
    _utime(_cap(night, "Polar_H10_02849638_" + _floating_stampname(t0) + "_HR.txt", 600), seam1)
    _utime(_cap(night, "Polar_H10_02849638_" + _floating_stampname(seam1) + "_HR.txt", 7200), seam2)
    _utime(_cap(night, "Polar_H10_02849638_" + _floating_stampname(seam2) + "_HR.txt", 300), seam2 + 300)
    with open(os.path.join(night, writers.STARTS_NAME), "w") as fh:
        fh.write("Phone timestamp;pid;git;dirty;adapter\n")
        fh.write(_starts_stamp(seam1) + ";400443;2cd12712;no;F4:CE:36:2E:CD:98\n")
        fh.write(_starts_stamp(seam2) + ";400444;2cd12712;no;F4:CE:36:2E:CD:98\n")
    devs = [{"name": "H10", "device_id": "02849638", "streams": ["hr"]}]
    return night, devs, t0, seam1, seam2


def _floating_stampname(t_floating):
    """A 14-digit filename stamp for a FLOATING second — the inverse of `_stamp_epoch`, and deliberately
    not `datetime.fromtimestamp`, which would push the name through the reader's zone."""
    return (_dtmod.datetime(1970, 1, 1) + _dtmod.timedelta(seconds=t_floating)).strftime("%Y%m%d%H%M%S")


def test_the_session_partition_is_DISJOINT_BUT_MAY_TOUCH(tmp_path):
    """The invariant the before/after partition leans on, pinned — because the whole boundary family of
    survivors is only killable if sessions CAN touch, and only equivalent if they cannot. Asserting it
    here means the next reader does not have to re-derive which it is from two docstrings."""
    night, devs, t0, seam1, seam2 = _touching_night(tmp_path)
    s = _summarize_floating(night, devs)
    ss = (
        [(x["start"], x["end"]) for x in s["sessions"]]
        if isinstance(s["sessions"][0], dict)
        else [(x[0], x[1]) for x in s["sessions"]]
    )
    assert len(ss) == 3, (ss, "two recorded seams must split three runs")
    for (a0, a1), (b0, b1) in zip(ss, ss[1:]):
        assert a1 <= b0, (ss, "sessions must stay ordered and DISJOINT")
        assert a1 == b0, (ss, "…and this fixture makes them TOUCH, which is what the boundary family needs")


def test_PLANT_a_TOUCHING_neighbour_is_still_an_excluded_neighbour(tmp_path):
    """`s[1] <= cur[0]` → `s[1] < cur[0]`, and its mirror `s[0] >= cur[1]` → `s[0] > cur[1]`.

    A session that ends on the exact second the judged one begins is excluded from coverage just as much
    as one that ends an hour earlier — its rows are not counted, so the report has to name it. Under the
    strict comparison it disappears from `gaps` and the night grades as though nothing had been discarded:
    the §A2 regression with a zero-length gap."""
    night, devs, t0, seam1, seam2 = _touching_night(tmp_path)
    s = _summarize_floating(night, devs)
    assert s["judged_session"]["rows"] == 7200, (s["judged_session"], "the biggest run must be judged")
    joined = " | ".join(s["gaps"])
    assert "earlier session" in joined, f"the TOUCHING earlier session was dropped from the report: {s['gaps']}"
    assert "later session" in joined, f"the TOUCHING later session was dropped from the report: {s['gaps']}"
    assert "600 rows" in joined, f"the earlier run's rows must be named: {s['gaps']}"
    assert "300 rows" in joined, f"the later run's rows must be named: {s['gaps']}"
    assert s["prior_gap_sec"] == 0, (s["prior_gap_sec"], "a touching session is a ZERO gap, not no gap")


def test_the_gap_line_names_the_NEAR_edge_of_each_neighbour(tmp_path):
    """Four survivors lived in the message text: `_hhmm(prev[1])->_hhmm(cur[0])` mutated to `cur[1]`, and
    `_hhmm(cur[1])->_hhmm(nxt[0])` mutated to `nxt[1]`. A gap runs from the end of what came before to the
    start of what comes next; naming the FAR edge reports the gap plus a whole session, which is the
    number a reader would act on."""
    night, devs, t0, seam1, seam2 = _touching_night(tmp_path)
    s = _summarize_floating(night, devs)
    hh = nightqc._hhmm
    earlier = [g for g in s["gaps"] if "earlier session" in g]
    later = [g for g in s["gaps"] if "later session" in g]
    assert earlier and later, s["gaps"]
    assert earlier[0].startswith(f"{hh(seam1)}->{hh(seam1)}"), (
        earlier[0],
        "the earlier gap runs to the JUDGED start; naming its end reports a 2 h span as the gap",
    )
    assert later[0].startswith(f"{hh(seam2)}->{hh(seam2)}"), (
        later[0],
        "the later gap runs to the NEXT run's start, not to its end",
    )


# ── the drain's second family: a CONDITION NEUTERED TO A CONSTANT ────────────────────────────────────
# Six survivors were `X if cond else Y` with `cond` replaced by `(cond) or True` / `(cond) and False`.
# Each one publishes a decision, so each is killable by asserting BOTH arms — which is the gap: the suite
# asserted the common arm of every one of them and never the other.


def test_span_reason_is_None_when_the_span_IS_judgeable(tmp_path):
    """`None if span else "under the minimum judgeable span"` → `(span) and False` makes every night carry
    the refusal, including nights with hours of capture. The common arm was asserted; this is the other."""
    night, devs, t0, seam1, seam2 = _touching_night(tmp_path)
    s = _summarize_floating(night, devs)
    assert s["span_sec"] and s["span_sec"] > nightqc._MIN_SPAN_SEC, s["span_sec"]
    assert s["span_reason"] is None, (
        s["span_reason"],
        "a judgeable span must carry NO reason — a reason beside a real span reads as a refusal",
    )


def test_span_reason_NAMES_the_minimum_when_the_span_is_too_short(tmp_path):
    """The mirror, and the arm `or True` erases: a night under `_MIN_SPAN_SEC` must say WHY its coverage is
    unknown. `None` there is §∅ inverted — an absent reason beside an absent number."""
    night = str(tmp_path / "2026-09-24")
    os.makedirs(night)
    t0 = _stamp_epoch("20260924230000")
    # 120 s of elapsed capture: under the 300 s floor, so the span cannot judge a rate
    _utime(_cap(night, "Polar_H10_02849638_" + _floating_stampname(t0) + "_HR.txt", 120), t0 + 120)
    devs = [{"name": "H10", "device_id": "02849638", "streams": ["hr"]}]
    s = _summarize_floating(night, devs)
    assert s["span_sec"] is None or s["span_sec"] < nightqc._MIN_SPAN_SEC, s["span_sec"]
    assert s["span_reason"] == "under the minimum judgeable span", s["span_reason"]


def test_the_writer_offset_frame_says_ABSOLUTE_when_an_offset_IS_known(tmp_path):
    """`"floating" if offset is None else "absolute"` → `or True` publishes every night as floating. A
    reader uses `frame` to decide whether `sessions` are instants or civil values, so a night whose offset
    WAS recovered must say absolute — and the suite only ever asserted the refusing arm."""
    night, devs, t0, seam1, seam2 = _touching_night(tmp_path)
    s = _summarize(night, devs)  # declared frame: an offset IS known
    wo = s["writer_offset"]
    assert wo["offset_sec"] is not None, wo
    assert wo["frame"] == "absolute", (wo, "an offset was recovered, so these are instants, not civil values")


def test_a_degraded_line_omits_rate_assumed_when_the_rate_was_MEASURED(tmp_path):
    """`("" if basis == "measured" else " (rate assumed)")` → `and False` appends the qualifier to every
    degraded line, including one computed against a rate read off the file. The existing test asserts the
    `(rate assumed)` arm (`H10:acc 20% (rate assumed)`); nothing asserted its absence, so the mutant that
    always appends it survived."""
    night = str(tmp_path / "2026-09-24")
    os.makedirs(night)
    t0 = _stamp_epoch("20260924220000")
    # A TIMED ACC file: enough rows for `measured_hz` to read a rate off its own device clock, but only
    # part of the session's span covered — degraded, with a MEASURED basis.
    _cap_timed(night, "Polar_H10_02849638_" + _floating_stampname(t0) + "_ACC.txt", 4000, 200)
    _utime(os.path.join(night, "Polar_H10_02849638_" + _floating_stampname(t0) + "_ACC.txt"), t0 + 20)
    _utime(_cap(night, "Polar_H10_02849638_" + _floating_stampname(t0) + "_HR.txt", 3600), t0 + 3600)
    devs = [{"name": "H10", "device_id": "02849638", "streams": ["acc", "hr"]}]
    s = _summarize_floating(night, devs)
    measured = [d for d in s["devices"] if d["name"] == "H10"][0].get("coverage_basis", {})
    # Asserted, never skipped: a skip here turned `basis = None` into a green run (mutant 385, #3266) —
    # the mutant makes the basis unmeasured, the skip fired, and a skip counts as a pass.
    assert measured.get("acc") == "measured", measured
    acc_lines = [x for x in s["degraded"] if x.startswith("H10:acc")]
    assert acc_lines, s["degraded"]
    assert "(rate assumed)" not in acc_lines[0], (
        acc_lines[0],
        "the rate was MEASURED off the file's own clock; the qualifier claims otherwise",
    )


def test_a_night_dir_that_is_not_a_directory_does_not_raise(tmp_path):
    """`sorted(os.listdir(night_dir)) if os.path.isdir(night_dir) else []` → `or True` calls `listdir` on a
    path that is not a directory. The guard exists because QC is pointed at folders that may not exist yet
    (the midnight rollover creates tomorrow's name), and a crash there takes the whole summary with it."""
    missing = str(tmp_path / "2026-09-30")  # never created
    s = nightqc.summarize(missing, [{"name": "H10", "device_id": "02849638", "streams": ["hr"]}])
    assert s["files"] == 0 and s["total_rows"] == 0, s
    assert s["span_sec"] is None, s["span_sec"]
    assert s["span_reason"] == "no capture data", s["span_reason"]  # mutant 130: no data names its reason


# ── and the third: dict(base, **kw) REBUILT WITHOUT ITS BASE ─────────────────────────────────────────


def test_the_published_writer_offset_keeps_the_recovery_it_describes(tmp_path):
    """`dict(_off, frame=…)` → `dict(frame=…)` drops everything the inference rests on and leaves only the
    label. `frame` alone is unauditable — the whole point of publishing this block is that a reader can
    check the offset, its basis and its voter count rather than take the frame on trust."""
    night, devs, t0, seam1, seam2 = _touching_night(tmp_path)
    wo = _summarize(night, devs)["writer_offset"]
    for k in ("offset_sec", "basis", "frame"):
        assert k in wo, (sorted(wo), f"{k} was dropped — the frame label survived its own evidence")


def test_the_pooled_daemon_record_keeps_its_other_keys(tmp_path):
    """`dict(_daemon, stamps=…)` → `dict(stamps=…)` keeps the merged stamps and throws the rest of the
    record away, so `starts` and `inside_capture` vanish and nothing can say how many restarts were
    recorded — only that some stamps exist.

    ⚠️ MY FIRST VERSION OF THIS TEST DID NOT REACH THE LINE. It asserted `session_basis` on a
    single-folder fixture, and this merge only runs when a PREVIOUS night is pooled across midnight — so
    the mutant survived a test written for it, which is the whole reason each of these is verified against
    its own mutation rather than assumed to bite. The fixture now spans two date folders with a recorded
    daemon start in EACH, which is the only shape that executes the merge."""
    import writers
    from datetime import datetime as _dt

    d27 = str(tmp_path / "2026-09-27")
    os.makedirs(d27)
    d28 = str(tmp_path / "2026-09-28")
    os.makedirs(d28)
    pre = _dt.strptime("20260927233000", "%Y%m%d%H%M%S").timestamp()
    post = _dt.strptime("20260928001500", "%Y%m%d%H%M%S").timestamp()
    _utime(_cap(d27, "Polar_H10_02849638_20260927233000_HR.txt", 1800), pre + 1800)
    _utime(_cap(d28, "Polar_H10_02849638_20260928001500_HR.txt", 1500), post + 1500)
    for folder, stamp in ((d27, pre), (d28, post)):
        with open(os.path.join(folder, writers.STARTS_NAME), "w") as fh:
            fh.write("Phone timestamp;pid;git;dirty;adapter\n")
            fh.write(_starts_stamp(stamp) + ";400443;2cd12712;no;F4:CE:36:2E:CD:98\n")
    devs = [{"name": "H10", "device_id": "02849638", "streams": ["hr"]}]
    s = _summarize(d28, devs)
    d = s["daemon"]
    assert d["stamps"], d
    assert "starts" in d and d["starts"] is not None, (
        d,
        "the merge kept the pooled stamps and dropped the count they came from",
    )
    assert "inside_capture" in d, (d, "the record's other keys must survive the stamp merge")


def test_data_settled_asks_about_the_DATA_and_treats_NO_DATA_as_unsettled():
    """`nightqc.data_settled` — pure, and the predicate E8 put in the loss poller's eligibility gate.

    Three cases, and the third is the one with an opinion in it. A folder holding NO capture file is
    NOT settled: there is nothing to judge, and calling it settled invites a verdict over an empty
    population (§🧾 — a PASS over `checked: 0` is the examined-nothing shape). `capture.py` also guards
    `_m is not None` before calling this, for mypy narrowing and because that branch is reachable every
    midnight; this asserts the contract directly rather than leaving it to the caller's belt."""
    now = 1_000_000.0
    assert nightqc.data_settled(now - 1200.0, 1200.0, now) is True, "exactly at the bound is settled"
    assert nightqc.data_settled(now - 1199.0, 1200.0, now) is False, "one second short is not"
    assert nightqc.data_settled(now - 4 * 3600.0, 1200.0, now) is True
    assert nightqc.data_settled(None, 1200.0, now) is False, (
        "a folder with no capture file has nothing to judge — 'settled' would licence a verdict over an "
        "empty population"
    )
    # A file stamped in the FUTURE (a clock step, or a copy preserving mtimes) is not settled: the
    # arithmetic goes negative and the night waits, which is the safe direction — judging it would
    # measure a span the box does not believe in yet.
    assert nightqc.data_settled(now + 60.0, 1200.0, now) is False


def test_the_daemon_s_OWN_lifecycle_LOG_never_ages_a_night_even_once_it_PARSES(tmp_path):
    """🔴 E16 · THE EXCLUSION MUST HOLD BY RULE, NOT BY A MISSING UNDERSCORE.

    `OXYLIFE.csv` was excluded from `newest_data_mtime` everywhere it mattered, and for the wrong
    reason: the writer uses one FIXED name per night (deliberately — an unstamped name makes the append
    idempotent), a name with no `_` does not parse as a capture name at all, so `parse_capture_name`
    returned None and every consumer dropped it as "not a capture file". Stamp that writer the way LINK
    and CLOCK are stamped and `Tepna_<box>_OXYLIFE.csv` parses, with a tag that was in no exclusion set:
    the daemon's own chatter would then age the night, which moves `_current_night` and restarts the
    settle clock `data_settled` exists to run down. 2026-09-28 is what that costs — 35 reconnect cycles
    after the doff, 171 OXYLIFE rows, SOLID-NIGHT still UNKNOWN two hours after the sensors were off.

    So this test asks the question the old code could not answer: with the chatter made PARSEABLE, does
    the night still age only on device data? Both spellings are planted, which is why it would have
    failed before the fix and cannot pass by accident now."""
    d = tmp_path / "2026-10-03"
    d.mkdir()
    old = time.time() - 4 * 3600.0
    data = d / "Wellue_O2Ring-S_S8AW2100_20261003213651_PPG.txt"
    data.write_text("x\n")
    os.utime(data, (old, old))
    # Both forms of the daemon's lifecycle log, written THIS INSTANT.
    (d / "OXYLIFE.csv").write_text("x\n")  # the fixed name as the writer spells it today
    (d / "Tepna_box01_OXYLIFE.csv").write_text("x\n")  # the stamped form — this one PARSES
    assert nightqc.parse_capture_name("Tepna_box01_OXYLIFE.csv") == ("OXYLIFE", "csv"), (
        "the plant is only a plant if the stamped name really does parse — if this ever stops being "
        "true the test below passes for a reason that has nothing to do with the rule it checks"
    )

    newest = nightqc.newest_data_mtime(str(d))
    assert newest == pytest.approx(old, abs=2.0), (
        "the night must age on its PPG file, four hours quiet — not on either spelling of the daemon's "
        f"own lifecycle log written a moment ago (got {newest}, data at {old})"
    )
    assert nightqc.data_settled(newest, 1200.0, time.time()) is True, (
        "and the night is therefore judgeable: the data went quiet four hours ago, and the box talking "
        "about itself is not a reason to keep a verdict waiting"
    )

    # CONTROL · the same folder with REAL data arriving now is NOT settled, or the assertion above
    # would pass for a predicate that simply always says yes.
    fresh = d / "Polar_H10_02849638_20261003213651_ECG.txt"
    fresh.write_text("x\n")
    assert nightqc.data_settled(nightqc.newest_data_mtime(str(d)), 1200.0, time.time()) is False


def _unreadable_mtime(monkeypatch, bad_path):
    """Make exactly one path raise on `getmtime`. A directory will not do it — `newest_data_mtime`
    guards with `os.path.isfile` first, so a directory is skipped silently and the handler under test
    never runs."""
    real = os.path.getmtime

    def fake(path):
        if os.path.basename(str(path)) == os.path.basename(str(bad_path)):
            raise OSError(5, "Input/output error")
        return real(path)

    monkeypatch.setattr(nightqc.os.path, "getmtime", fake)


def test_a_file_whose_mtime_cannot_be_READ_is_named_in_the_warning_with_its_exception(tmp_path, monkeypatch, caplog):
    """The handler's own comment says the cost: skipping a file makes the night look OLDER than it is,
    and a caller uses this to pick the ACTIVE night. So the warning is the only evidence the answer is
    short — and nothing observed it. Five mutants lived in this one call
    (`nightqc.x_newest_data_mtime__mutmut_32/33/35/36/40`): the path argument replaced by `None` or
    dropped, and `exc_info` set to `None`/`False` or dropped. Each leaves the suite green while
    destroying either WHICH file is unreadable or WHY."""
    d = tmp_path / "2026-10-04"
    d.mkdir()
    bad = d / "Polar_H10_02849638_20261004213651_ECG.txt"
    bad.write_text("x\n")
    _unreadable_mtime(monkeypatch, bad)
    with caplog.at_level(logging.WARNING):
        nightqc.newest_data_mtime(str(d))
    recs = [r for r in caplog.records if "cannot age this night" in r.msg]
    assert len(recs) == 1, [r.msg for r in caplog.records]
    rec = recs[0]
    # `getMessage()` and not `r.msg`: that is what renders the arguments, so a dropped or nulled path
    # is visible here and nowhere else.
    assert bad.name in rec.getMessage(), rec.getMessage()
    assert rec.exc_info and rec.exc_info[0] is OSError, rec.exc_info


def test_an_unreadable_file_does_not_STOP_the_scan_at_itself(tmp_path, monkeypatch):
    """`continue` → `break` (`__mutmut_41`). With `break` the scan abandons the night at its first
    unreadable file, so every later file — including the newest — is never seen and the night reads
    older than it is, or absent. `os.listdir` order is not specified, so it is pinned here: the
    unreadable file comes FIRST, which is the only order in which the two spellings differ."""
    d = tmp_path / "2026-10-04"
    d.mkdir()
    bad = d / "Polar_H10_02849638_20261004213651_ECG.txt"
    good = d / "Wellue_O2Ring-S_S8AW2100_20261004213651_PPG.txt"
    bad.write_text("x\n")
    good.write_text("x\n")
    when = time.time() - 600.0
    os.utime(good, (when, when))
    monkeypatch.setattr(nightqc.os, "listdir", lambda _p: [bad.name, good.name])
    _unreadable_mtime(monkeypatch, bad)

    newest = nightqc.newest_data_mtime(str(d))
    assert newest == pytest.approx(when, abs=2.0), (
        f"the scan must carry on past the unreadable file and age the night on {good.name} "
        f"(got {newest}, expected ~{when})"
    )


# ── #3266's diff-scoped survivors in the functions the unreadable-file fix touched ─────────────────────
# Each test names the mutant it kills. The row-apportioning ones call `night_view` directly with files
# placed ON the band edges, because only an edge separates `<` from `<=` and a point from a span.


def _band_session():
    b0, b1 = nightqc.night_band(_stamp_epoch("20260719230000"))
    return b0, b1, (b0, b1, [])


def test_night_view_skips_an_unreadable_file_and_keeps_counting_the_rest():
    """mutant 30: `continue` -> `break` stops at the unreadable file and drops every file after it."""
    b0, b1, sess = _band_session()
    files = [{"session": b0 + 10, "rows": None}, {"session": b0 + 20, "rows": 100, "span_sec": None}]
    assert nightqc.night_view(sess, files)["rows"] == 100


def test_night_view_places_a_spanless_file_as_a_POINT_at_the_band_end():
    """mutant 38: an unknown span read as 1.0 s would apportion half of a file starting 0.5 s before the
    band's end; as a point inside the band it carries all of its rows."""
    b0, b1, sess = _band_session()
    assert nightqc.night_view(sess, [{"session": b1 - 0.5, "rows": 100, "span_sec": None}])["rows"] == 100


def test_night_view_apportions_a_sub_second_span_rather_than_treating_it_as_a_point():
    """mutant 42: `dur <= 1` would make a 0.5 s file a point; half of it lies past the band's end."""
    b0, b1, sess = _band_session()
    assert nightqc.night_view(sess, [{"session": b1 - 0.25, "rows": 100, "span_sec": 0.5}])["rows"] == 50


def test_night_view_SUMS_point_files_and_spanned_files():
    """mutants 43 / 53: `rows =` instead of `+=` keeps only the last file of each kind."""
    b0, b1, sess = _band_session()
    points = [{"session": b0 + 10, "rows": 100, "span_sec": None}, {"session": b0 + 20, "rows": 7, "span_sec": None}]
    spans = [{"session": b0 + 10, "rows": 100, "span_sec": 60}, {"session": b0 + 100, "rows": 7, "span_sec": 60}]
    assert nightqc.night_view(sess, points)["rows"] == 107
    assert nightqc.night_view(sess, spans)["rows"] == 107


def test_night_view_band_is_HALF_OPEN_for_a_point_file():
    """mutants 49 / 50: a point exactly at the band's start is inside it, one exactly at its end is not."""
    b0, b1, sess = _band_session()
    assert nightqc.night_view(sess, [{"session": b0, "rows": 100, "span_sec": None}])["rows"] == 100
    assert nightqc.night_view(sess, [{"session": b1, "rows": 100, "span_sec": None}])["rows"] == 0


def test_a_degraded_line_ROUNDS_its_percent_and_never_truncates_it(tmp_path):
    """`int(scov * 100)` printed 0.29 as 28 % (0.29 * 100 == 28.999999999999996) — mutant 430's arithmetic,
    and a real misreport. 290 rows of 1 Hz HR over a 1000 s session is 0.29."""
    night = str(tmp_path / "2026-07-19")
    os.makedirs(night)
    t0 = _stamp_epoch()
    _utime(_cap(night, "Polar_H10_02849638_20260719220000_HR.txt", 290), t0 + 1000)
    s = _summarize_floating(night, [{"name": "H10", "device_id": "02849638", "streams": ["hr"]}])
    assert s["degraded"] == ["H10:hr 29% (rate assumed)"], s["degraded"]


def test_a_device_span_of_EXACTLY_the_minimum_is_judged_on_the_device_basis(tmp_path):
    """mutant 329: `dev_span <= _MIN_SPAN_SEC` would refuse a device span that sits ON the minimum."""
    night = str(tmp_path / "2026-07-19")
    os.makedirs(night)
    t0 = _stamp_epoch()
    p = _cap_timed(night, "Polar_H10_02849638_20260719220000_HR.txt", 301, 1)
    assert nightqc.file_span_sec(p) == nightqc._MIN_SPAN_SEC, "the fixture must sit ON the boundary"
    _utime(p, t0 + 600)
    s = _summarize_floating(night, [{"name": "H10", "device_id": "02849638", "streams": ["hr"]}])
    h10 = s["devices"][0]
    assert h10["span_basis"] == {"hr": "device"} and h10["span_sec"] == 300, h10


def test_span_reason_is_NULL_when_there_is_a_span_and_session_end_NULL_when_there_is_not(tmp_path):
    """mutant 130: `_span_reason = ""` — an empty string where there is no reason; mutant 529: `and` ->
    `or` publishes a session end for a session too short to have a span."""
    night = str(tmp_path / "2026-07-19")
    os.makedirs(night)
    t0 = _stamp_epoch()
    _utime(_cap(night, "Polar_H10_02849638_20260719220000_HR.txt", 3600), t0 + 3600)
    dev = [{"name": "H10", "device_id": "02849638", "streams": ["hr"]}]
    s = _summarize_floating(night, dev)
    assert s["span_sec"] == 3600 and s["span_reason"] is None
    short = str(tmp_path / "2026-07-20")
    os.makedirs(short)
    _utime(_cap(short, "Polar_H10_02849638_20260720220000_HR.txt", 10), _stamp_epoch("20260720220000") + 10)
    s2 = _summarize_floating(short, dev)
    assert s2["span_sec"] is None and s2["devices"][0]["session_end"] is None, s2["devices"][0]


# ── #3266: the offset and partition survivors, sized by Codex (read-only) and verified by mutant ───────
# A DECLARED writer offset of 5 h: filename stamps and STARTS rows are floating civil time, mtimes are
# absolute = floating + offset. Only a NONZERO offset separates "raised into the mtime frame" from
# "left floating", and every earlier fixture here was built at offset 0.

_X = 5 * 3600.0


def _abs_cap(night, t_open, rows, t_end, offset=_X):
    p = _cap(night, "Polar_H10_02849638_" + _floating_stampname(t_open) + "_HR.txt", rows)
    os.utime(p, (t_end + offset,) * 2)
    return p


def _starts(night, *seams):
    import writers

    with open(os.path.join(night, writers.STARTS_NAME), "w") as fh:
        fh.write("Phone timestamp;pid;git;dirty;adapter\n")
        for i, t in enumerate(seams):
            fh.write(_starts_stamp(t) + f";{400443 + i};2cd12712;no;F4:CE:36:2E:CD:98\n")


_DEV_HR = [{"name": "H10", "device_id": "02849638", "streams": ["hr"]}]


def test_daemon_seams_are_raised_into_the_mtime_frame_by_the_DECLARED_offset(tmp_path):
    """mutants 21 / 145: `daemon_starts` or `merge_sessions` called without the offset puts the seams and
    the file intervals in different frames 5 h apart, so the two seams split nothing and the three runs
    merge. The same night at offset 0 is the twin: under the declared offset it must partition the same."""
    night = str(tmp_path / "2026-09-24")
    os.makedirs(night)
    t0 = _stamp_epoch("20260924210000")
    seam1, seam2 = t0 + 600, t0 + 7800
    _abs_cap(night, t0, 600, seam1)
    _abs_cap(night, seam1, 7200, seam2)
    _abs_cap(night, seam2, 300, seam2 + 300)
    _starts(night, seam1, seam2)
    s = nightqc.summarize(night, _DEV_HR, writer_offset=nightqc.declared_offset(_X))
    assert [(x["start"], x["end"]) for x in s["sessions"]] == [
        (round(t0 + _X), round(seam1 + _X)),
        (round(seam1 + _X), round(seam2 + _X)),
        (round(seam2 + _X), round(seam2 + 300 + _X)),
    ], s["sessions"]
    assert s["daemon"]["stamps"] == [seam1 + _X, seam2 + _X]


def test_the_POOLED_previous_folders_seams_are_raised_by_the_offset_too(tmp_path):
    """mutants 101 / 104: the previous folder's `daemon_starts` without the offset leaves ITS seam floating,
    so the split it records inside the pooled half disappears."""
    d23 = str(tmp_path / "2026-09-23")
    d24 = str(tmp_path / "2026-09-24")
    os.makedirs(d23)
    os.makedirs(d24)
    a = _stamp_epoch("20260923220000")
    seam = a + 3600  # 23:00: run A ends, run B opens on the same second
    _abs_cap(d23, a, 3600, seam)
    _abs_cap(d23, seam, 3000, seam + 3000)  # B runs to 23:50
    _starts(d23, seam)
    c = _stamp_epoch("20260924001000")  # 00:10, inside the near-midnight pool window
    _abs_cap(d24, c, 3000, c + 3000)
    s = nightqc.summarize(d24, _DEV_HR, writer_offset=nightqc.declared_offset(_X))
    assert len(s["searched_dirs"]) == 2, s["searched_dirs"]
    assert [x["start"] for x in s["sessions"]] == [round(a + _X), round(seam + _X)], s["sessions"]


def test_pooling_asks_contiguity_in_ONE_frame_under_a_nonzero_offset(tmp_path):
    """mutant 81: `(earliest - offset) - prev_last` puts the floating start 2 offsets away from the
    absolute last write. The previous folder ends 00:00 and this one opens 01:30 — 90 min, not contiguous
    — but the mutant reads it as 90 min minus 10 h and pools a separate sitting."""
    d23 = str(tmp_path / "2026-09-23")
    d24 = str(tmp_path / "2026-09-24")
    os.makedirs(d23)
    os.makedirs(d24)
    a = _stamp_epoch("20260923230000")
    _abs_cap(d23, a, 3600, a + 3600)  # last write 00:00
    c = _stamp_epoch("20260924013000")
    _abs_cap(d24, c, 1800, c + 1800)
    s = nightqc.summarize(d24, _DEV_HR, writer_offset=nightqc.declared_offset(_X))
    assert len(s["searched_dirs"]) == 1, s["searched_dirs"]
    assert s["devices"][0]["streams"]["hr"] == 1800


def test_a_zero_length_session_TOUCHING_the_judged_one_is_reported_once_on_its_own_side(tmp_path):
    """mutants 181 / 183: sessions may TOUCH at a daemon seam, and a zero-length one sharing the judged
    session's edge satisfies BOTH mutated predicates — it would be reported as earlier AND later."""
    for judged_first, own_side in ((True, "later session"), (False, "earlier session")):
        night = str(tmp_path / ("a" if judged_first else "b") / "2026-09-24")
        os.makedirs(night)
        t0 = _stamp_epoch("20260924210000")
        seam = t0 + 600
        _abs_cap(night, t0, 600 if judged_first else 1, seam, offset=0.0)
        _abs_cap(night, seam, 1 if judged_first else 600, seam, offset=0.0)  # zero length: opens AT its last write
        _starts(night, seam)
        s = _summarize_floating(night, _DEV_HR)
        assert len(s["sessions"]) == 2, s["sessions"]
        assert len(s["gaps"]) == 1 and own_side in s["gaps"][0], (judged_first, s["gaps"])
