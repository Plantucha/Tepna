# tepna-capture — tests/test_night_report.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The morning report's whole job is to be unable to overstate a night. Every test here is a form of
# that one question: when an input is missing, does the report say so, or does it print a number?
#
# The shapes are taken from the REAL 2026-09-06 summary on the box, including the fact that it carries
# no `class_b` key at all — a summary written by a daemon predating the back-check. That is not a
# hypothetical: it is what the first night this report would have run on actually looked like.

import json

import night_report as nr

REAL_DEVICES = [{"name": "Wellue O2Ring-S",
                 "streams": {"spo2": 34964, "ppg": 4507305, "ppg2w": 7158455},
                 "coverage": {"spo2": 0.52, "ppg": 0.53}},
                {"name": "Polar H10 02849638", "streams": {"ecg": 31878900}}]
REAL_SUMMARY = {"night": "2026-09-06", "ok": False, "span_sec": 67730, "devices": REAL_DEVICES}

#: 🔴 THE REAL class-B BLOCKS, copied from /srv/tepna/captures/2026-09-08/QC-SUMMARY.json on the box.
#: `nightqc.class_b_runs` returns `{"stream", "held", "rows", "clips", "file", "columns"}` where
#: **`clips` is a DICT** of `{channel: number_of_clip_regions}` — NOT a list, and NOT under a key
#: called `clip`. An earlier version of these tests invented the shape the code had also invented, so
#: both agreed and neither was right: every night reported "0 spans, back-check ok" while this very
#: night carried 25 clipped ppg regions. The fixture is the thing that decides whether this file can
#: see that class of bug at all, so it is copied, never composed.
REAL_CLASS_B = [
    {"stream": "ppg", "held": None, "rows": 25, "clips": {"ppg": 25},
     "file": "Wellue_O2Ring-S_S8AW2100_20260908034935_PPG.txt", "columns": 1},
    {"stream": "ppg2w", "held": None, "rows": 0, "clips": {"ppg2w:ch0": 0, "ppg2w:ch1": 0},
     "file": "Wellue_O2Ring-S_S8AW2100_20260908034935_PPG2W.txt", "columns": 2},
]


def test_the_real_night_reports_hours_and_says_unknown_for_everything_absent():
    """The 2026-09-06 night exactly as it sits on the box: a ring that measured, no back-check key,
    no sniffer verdict. Two readings and two absences, and the absences must be words."""
    r = nr.build("2026-09-06", REAL_SUMMARY, None)
    assert r["line"] == ("2026-09-06: ring 9.7 h, unknown spans, back-check unknown, "
                         "sniffer coverage unknown ?")
    assert r["ring_hours"] == 34964 / 3600
    assert r["spans"] is None and r["back_check"] == "unknown"


def test_nothing_at_all_is_all_unknown_and_never_zero():
    """No summary, no verdict — the shape of a night the box never wrote. Every field is the word,
    and the line must contain no digit that could be read as a measurement."""
    r = nr.build("2026-09-07", None, None)
    assert r["line"] == ("2026-09-07: ring unknown h, unknown spans, back-check unknown, "
                         "sniffer coverage unknown ?")
    assert r["ring_hours"] is None and r["spans"] is None
    assert "0" not in r["line"].split(":", 1)[1], "a zero here would be a measurement nobody took"


#: A CLEAN block — examined and found nothing. Since 2026-09-23 "clean" must be expressed this way
#: rather than as `class_b: []`: an empty list means the producer EXAMINED NOTHING (`class_b_quality`
#: skips an unreadable/headerless/short file with `continue`), so it is `unknown`, not `ok`.
CLEAN_BLOCK = [{"stream": "ppg", "held": None, "rows": 0, "clips": {"ppg": 0},
                "file": "Wellue_O2Ring-S_S8AW2100_20260908034935_PPG.txt", "columns": 1}]


def test_an_EMPTY_back_check_is_UNKNOWN_because_an_empty_list_examined_NOTHING():
    """⚠️ THIS TEST PINNED THE DEFECT AS THE SPEC UNTIL 2026-09-23. It asserted
    `back_check(class_b=[]) == ("ok", 0, 0)` on the reasoning that *"`class_b: []` means it LOOKED and
    found nothing"* — and that premise is contradicted by the producer, in writing.

    `nightqc.class_b_quality` SKIPS a file it cannot judge — unreadable, no waveform column, under the
    minimum run — with `continue`. So `[]` is also what a night produces when every PPG file was
    skipped, i.e. when it examined NOTHING. `nightqc.backcheck_verdict`'s own docstring names this
    exact path and states the rule: *"a clean verdict about files nobody examined cannot be written"*.
    `render`'s footer says it a third time: *"A missing input is never a 0."*

    So an empty list is `unknown`, and "clean" must be expressed as a block that was EXAMINED and
    carried nothing (CLEAN_BLOCK) — which is a different claim and the only one the data supports."""
    assert nr.back_check(dict(REAL_SUMMARY, class_b=[])) == ("unknown", None, None)
    assert nr.back_check(dict(REAL_SUMMARY, class_b=[1, "x", None])) == ("unknown", None, None), \
        "blocks that are not dicts are skipped, so this also examined nothing"
    assert nr.back_check(dict(REAL_SUMMARY, class_b=CLEAN_BLOCK)) == ("ok", 0, 0), \
        "EXAMINED and found nothing is the only shape that may read ok"
    assert nr.back_check(REAL_SUMMARY) == ("unknown", None, None), "an absent key never ran"
    assert nr.back_check(None) == ("unknown", None, None)
    assert nr.back_check({"class_b": "not a list"}) == ("unknown", None, None)


def test_the_REAL_night_that_was_being_reported_as_CLEAN_now_fails():
    """🔴 The regression. This is `/srv/tepna/captures/2026-09-08`'s own class-B blocks, and before the
    key and the type were corrected this night rendered "0 spans, back-check ok" — a fabricated clean
    verdict on a night with 25 clipped ppg regions."""
    r = nr.build("2026-09-08", dict(REAL_SUMMARY, class_b=REAL_CLASS_B), None)
    assert r["spans"] == 25 and r["back_check"] == "fail"
    assert "25 spans, back-check fail" in r["line"]
    assert "0 spans" not in r["line"]


def test_clip_regions_are_summed_ACROSS_channels_and_blocks():
    """`clips` is per CHANNEL — a two-column stream reports `ppg2w:ch0` and `ppg2w:ch1` separately —
    so the night's total is the sum over every channel of every block, not a count of either."""
    blocks = [{"stream": "ppg", "held": None, "clips": {"ppg": 2}},
              {"stream": "ppg2w", "held": None, "clips": {"ppg2w:ch0": 3, "ppg2w:ch1": 1}},
              {"stream": "acc", "held": None, "clips": {}}]
    assert nr.back_check({"class_b": blocks}) == ("fail", 6, 0)


def test_a_ring_absent_from_the_summary_is_unknown_hours_not_zero():
    """A night with no ring entry is a night nobody can speak for. 0.0 would claim the ring was there
    and measured nothing, which is a different and much worse statement."""
    assert nr.build("2026-09-09", {"devices": [{"name": "Polar H10"}]}, None)["ring_hours"] is None
    assert nr.build("2026-09-09", {"devices": []}, None)["ring_hours"] is None
    # …but a ring that genuinely recorded nothing IS zero, and must not be hidden as unknown.
    zero = nr.build("2026-09-09", {"devices": [{"name": "Wellue O2Ring-S",
                                                "streams": {"spo2": 0}}]}, None)
    assert zero["ring_hours"] == 0.0 and "ring 0.0 h" in zero["line"]
    # The third case, and the one between the other two: the ring IS in the summary but its SpO2
    # count is missing or unreadable. Nobody can say how long it ran, so it is `unknown` — reading a
    # broken count as 0.0 would report a ring that was present and idle, which is a different night.
    for streams in ({}, {"spo2": None}, {"spo2": "34964"}):
        blind = nr.build("2026-09-09", {"devices": [{"name": "Wellue O2Ring-S",
                                                     "streams": streams}]}, None)
        assert blind["ring_hours"] is None, streams
        assert "ring unknown h" in blind["line"], streams


def test_the_sniffer_verdict_is_read_from_the_audit_line_and_the_coverage_line():
    ok = nr.sniffer_verdict("AIR AUDIT: OK\n  coverage        : 0.51 (462.1 s) of 900 s requested\n")
    assert ok == ("pass", "0.51")
    bad = nr.sniffer_verdict("AIR AUDIT: FAILED — window: captured 40 s\n  coverage        : 0.04 (40 s)\n")
    assert bad == ("fail", "0.04")
    assert nr.sniffer_verdict(None) == ("unknown", "unknown"), "no verdict is not a clean one"
    assert nr.sniffer_verdict("") == ("unknown", "unknown")
    # A file that exists but carries no verdict line at all — truncated, or a future format.
    assert nr.sniffer_verdict("something else entirely\n") == ("unknown", "unknown")


def test_the_tick_is_only_for_a_PASS_and_the_absent_case_gets_a_question_mark():
    """✓ is a claim. An audit that did not run gets `?`, never ✓ and never ✗ — the reader must be able
    to tell "clean" from "we did not look" at a glance, which is the entire point of the glyph."""
    v = "AIR AUDIT: OK\n  coverage        : 0.98 (880 s) of 900 s requested\n"
    assert "0.98 ✓" in nr.build("2026-09-10", REAL_SUMMARY, v)["line"]
    assert "unknown ?" in nr.build("2026-09-10", REAL_SUMMARY, None)["line"]
    assert "0.04 ✗" in nr.build("2026-09-10", REAL_SUMMARY,
                                "AIR AUDIT: FAILED — x\n  coverage        : 0.04 (40 s)\n")["line"]


def test_read_night_treats_every_unreadable_input_as_absent(tmp_path):
    """Permissions, a truncated JSON, a directory that is not there: all of them are `unknown`, and
    none of them raises. A report that crashes on a bad night tells the operator nothing at all."""
    (tmp_path / "2026-09-11").mkdir()
    r = nr.read_night(str(tmp_path), "2026-09-11", str(tmp_path / "no-such-sniffer-dir"))
    assert r["back_check"] == "unknown" and r["sniffer"] == "unknown"
    (tmp_path / "2026-09-11" / "QC-SUMMARY.json").write_text("{ truncated", encoding="utf-8")
    assert nr.read_night(str(tmp_path), "2026-09-11")["ring_hours"] is None
    # A sniffer directory that EXISTS and holds no verdict yet — which is this box's state today,
    # because the nightly sniffer timer is not installed. It is the production default path, so it
    # must read `unknown` and not raise on the empty listing.
    empty = tmp_path / "sniffer-not-yet"; empty.mkdir()
    quiet = nr.read_night(str(tmp_path), "2026-09-11", str(empty))
    assert quiet["sniffer"] == "unknown" and quiet["coverage"] == "unknown"


def test_read_night_takes_the_NEWEST_verdict_and_renders_the_file(tmp_path):
    night = tmp_path / "2026-09-12"; night.mkdir()
    night.joinpath("QC-SUMMARY.json").write_text(json.dumps(dict(REAL_SUMMARY, class_b=CLEAN_BLOCK)),
                                                 encoding="utf-8")
    sniff = tmp_path / "sniffer"; sniff.mkdir()
    sniff.joinpath("nightly-20260911-0300.pcap.verdict.txt").write_text(
        "AIR AUDIT: FAILED — old\n  coverage        : 0.10 (90 s)\n", encoding="utf-8")
    sniff.joinpath("nightly-20260912-0300.pcap.verdict.txt").write_text(
        "AIR AUDIT: OK\n  coverage        : 0.97 (873 s)\n", encoding="utf-8")
    r = nr.read_night(str(tmp_path), "2026-09-12", str(sniff))
    assert r["coverage"] == "0.97", "the newest verdict is this night's, not the first one listed"
    body = nr.render(r)
    assert body.splitlines()[0] == r["line"]
    assert "back_check   ok" in body and "0 spans" in r["line"]


def test_no_function_here_accepts_or_returns_the_webhook_url():
    """The URL carries a token. This module builds TEXT and never touches delivery, so no future edit
    can leak the secret through the report file — `alerts.Notifier` owns the URL and never logs it."""
    src = open(nr.__file__, encoding="utf-8").read()
    for forbidden in ("webhook_url", "requests.post", "urlopen", "ntfy"):
        assert forbidden not in src, f"{forbidden} must not appear in the report builder"


def test_main_prints_ONLY_the_line_and_writes_the_file(tmp_path, capsys):
    """The caller pipes stdout straight into the notifier, so anything else printed there would end up
    in the operator's phone notification — and a stray traceback line would end up in the webhook."""
    night = tmp_path / "2026-09-13"; night.mkdir()
    night.joinpath("QC-SUMMARY.json").write_text(json.dumps(dict(REAL_SUMMARY, class_b=CLEAN_BLOCK)),
                                                 encoding="utf-8")
    assert nr.main([str(tmp_path), "2026-09-13"]) == 0
    out = capsys.readouterr().out.strip().splitlines()
    assert len(out) == 1 and out[0].startswith("2026-09-13: ring 9.7 h, 0 spans, back-check ok")
    body = night.joinpath("NIGHT-REPORT.txt").read_text(encoding="utf-8")
    assert body.splitlines()[0] == out[0]


def test_main_still_reports_when_the_night_is_unwritable(tmp_path, capsys):
    """A report that fails on a bad night reports nothing, and a bad night is exactly when it is read.
    The file may be impossible; the LINE must still reach the operator."""
    assert nr.main([str(tmp_path), "2026-09-14"]) == 0     # the night dir does not exist at all
    out = capsys.readouterr()
    assert out.out.strip().endswith("sniffer coverage unknown ?")
    assert "could not write" in out.err


def test_main_rejects_a_wrong_argument_count_rather_than_guessing(capsys):
    assert nr.main([]) == 2 and nr.main(["a"]) == 2 and nr.main(["a", "b", "c", "d"]) == 2
    assert "usage:" in capsys.readouterr().err


# ── the gaps mutation testing found ──────────────────────────────────────────────────────────────
# Each of these was a surviving mutant: a line that could be changed with the suite staying green.
# They are grouped here because they share a shape — every one is an input the report can actually
# receive and that no test had ever handed it.

def test_a_back_check_BLOCK_whose_clip_is_not_a_list_contributes_no_spans():
    """A malformed block must not become a span. Counting it as one turns a summary this code cannot
    read into a `fail` verdict — inventing a clipped span nobody measured, which is the same
    fabrication as reporting a number for an absent input, one level in."""
    # A malformed DICT was examined and carried nothing countable — that is `ok`.
    for broken in ({}, {"clips": None}, {"clips": "3"}, {"clips": 7}, {"clips": []}):
        got = nr.back_check({"class_b": [broken]})
        assert got == ("ok", 0, 0), broken
    # A NON-dict is skipped by `continue`, so a list of only those examined NOTHING — `unknown`, not
    # `ok`. Split out 2026-09-23: this loop used to lump the two together and assert `ok` for both,
    # which is the same flattening the empty-list case was making one level up.
    for not_a_block in (None, "nope", 7, []):
        assert nr.back_check({"class_b": [not_a_block]}) == ("unknown", None, None), not_a_block
    mixed = nr.back_check({"class_b": [{"clips": {"ppg": 2}}, {"clips": "nonsense"}]})
    assert mixed == ("fail", 2, 0), "the readable block still counts, the unreadable one adds nothing"
    # A non-integer or negative count is not a region count and must not become one.
    assert nr.back_check({"class_b": [{"clips": {"a": "5", "b": True, "c": -1, "d": 2}}]}) == \
        ("fail", 2, 0)


def test_main_ACCEPTS_a_sniffer_directory_as_its_third_argument_and_uses_it(tmp_path, capsys):
    """`main` takes three arguments, and the third is the one the shell script always passes. Nothing
    exercised that path end-to-end, so a `main` that ignored it — or rejected three arguments outright
    — would have passed every test while the deployed script called it exactly that way."""
    night = tmp_path / "2026-09-15"; night.mkdir()
    night.joinpath("QC-SUMMARY.json").write_text(json.dumps(dict(REAL_SUMMARY, class_b=CLEAN_BLOCK)),
                                                 encoding="utf-8")
    sniff = tmp_path / "sniffer"; sniff.mkdir()
    sniff.joinpath("nightly-20260915-0300.pcap.verdict.txt").write_text(
        "AIR AUDIT: OK\n  coverage        : 0.93 (837 s)\n", encoding="utf-8")
    assert nr.main([str(tmp_path), "2026-09-15", str(sniff)]) == 0
    line = capsys.readouterr().out.strip()
    assert "sniffer coverage 0.93 ✓" in line, "the third argument must actually reach the verdict"
    assert "2026-09-15" in line


def test_the_NEWEST_verdict_is_taken_when_there_are_more_than_two(tmp_path):
    """With exactly two files `names[-1]` and `names[1]` are the same file, so a two-file fixture
    cannot tell "the last" from "the second". Three can."""
    night = tmp_path / "2026-09-16"; night.mkdir()
    sniff = tmp_path / "sniffer"; sniff.mkdir()
    for day, cov in (("14", "0.10"), ("15", "0.50"), ("16", "0.97")):
        sniff.joinpath("nightly-202609%s-0300.pcap.verdict.txt" % day).write_text(
            "AIR AUDIT: OK\n  coverage        : %s (1 s)\n" % cov, encoding="utf-8")
    assert nr.read_night(str(tmp_path), "2026-09-16", str(sniff))["coverage"] == "0.97"


def test_NOT_OK_is_not_OK():
    """🔴 The verdict word is read out of a fixed-width slice of the audit line, and the slice's width
    is what stops a longer phrase leaking a false pass. "AIR AUDIT: NOT OK" must never read as a pass —
    a wider window would find the "OK" in "NOT OK" and report a clean night for a failed audit."""
    assert nr.sniffer_verdict("AIR AUDIT: NOT OK\n  coverage        : 0.90 (1 s)\n")[0] != "pass"
    assert nr.sniffer_verdict("AIR AUDIT: OK\n")[0] == "pass", "…while the real thing still passes"


def test_a_second_AIR_AUDIT_marker_does_not_move_which_verdict_is_read():
    """The verdict is taken from the FIRST marker on the line. A file that quotes the phrase after its
    own verdict — a message, a path, a previous run echoed back — must not flip the reading."""
    assert nr.sniffer_verdict("AIR AUDIT: FAILED — see AIR AUDIT: OK from 09-14\n")[0] == "fail"


def test_a_COLON_inside_the_coverage_value_does_not_move_where_the_number_is_read():
    """The number is everything after the FIRST colon, not the last. A tail carrying its own colon —
    a duration, a timestamp — would otherwise hand back the fragment after that one instead."""
    got = nr.sniffer_verdict("AIR AUDIT: OK\n  coverage        : 0.42 (elapsed 1:23)\n")
    assert got == ("pass", "0.42")


def test_an_AIR_AUDIT_line_with_an_UNRECOGNISED_word_is_a_QUESTION_MARK_not_a_CROSS():
    """🔴 "We did not look" and "it failed" are different facts and get different glyphs. A verdict
    line the parser does not recognise — a future wording, a truncated write, `AIR AUDIT: pending` —
    must fall back to `unknown`/`?`, never to `fail`/`✗`. Reporting a failed audit for one nobody could
    read manufactures a finding, which is the same class of lie as reporting a number for an absence."""
    for line in ("AIR AUDIT: pending\n", "AIR AUDIT: \n", "AIR AUDIT: INCONCLUSIVE — no packets\n"):
        assert nr.sniffer_verdict(line)[0] == "unknown", line
        assert "unknown ?" in nr.build("2026-09-17", REAL_SUMMARY, line)["line"], line
    # …and a recognised one is still read, so the fallback has not swallowed the real cases.
    assert nr.sniffer_verdict("AIR AUDIT: OK\n")[0] == "pass"
    assert nr.sniffer_verdict("AIR AUDIT: FAILED — x\n")[0] == "fail"


def test_a_HELD_stream_FAILS_the_check_even_though_it_reports_ZERO_clips():
    """🔴 The second half of the same bug, and the worse half. `class_b_runs` reports a held stream
    INSTEAD of clip regions — `clips` is then `{}` — because a stream frozen at one value for its whole
    length is ONE fact, not thousands. So a night where the ring's optical stream was pinned throughout
    has zero clips, and the old code called that `ok`: a total sensor failure reported as a clean night.
    It is counted separately rather than folded in, because "25 clipped regions" and "the sensor was
    pinned all night" call for different actions."""
    held = [{"stream": "ppg", "held": {"ratio": 0.99}, "rows": 1, "clips": {}}]
    assert nr.back_check({"class_b": held}) == ("fail", 0, 1)
    line = nr.build("2026-09-08", {"devices": [], "class_b": held}, None)["line"]
    assert "0 spans (1 held), back-check fail" in line
    # Both findings at once, and neither hides the other.
    both = nr.back_check({"class_b": held + [{"stream": "ppg2w", "held": None,
                                              "clips": {"ppg2w:ch0": 4}}]})
    assert both == ("fail", 4, 1)


def test_a_clean_night_does_not_grow_a_permanent_zero_held_note():
    """The held count is shown only when there IS one. A standing "(0 held)" would be one more number
    a reader learns to skip, and this line has to stay readable on a phone at breakfast."""
    clean = nr.build("2026-09-08", dict(REAL_SUMMARY, class_b=CLEAN_BLOCK), None)["line"]
    assert "held" not in clean and "0 spans, back-check ok" in clean


def test_held_streams_are_COUNTED_not_latched_at_one():
    """`held += 1` mutated to `held = 1` is invisible until a night holds TWO streams — and a night
    where both the ring's optical channels are pinned is exactly the night the count matters, because
    "1 held" and "2 held" are different statements about how much of the recording is untrustworthy."""
    two = [{"stream": "ppg", "held": {"ratio": 0.99}, "clips": {}},
           {"stream": "ppg2w", "held": {"ratio": 0.97}, "clips": {}}]
    assert nr.back_check({"class_b": two}) == ("fail", 0, 2)
    assert "(2 held)" in nr.build("2026-09-08", {"devices": [], "class_b": two}, None)["line"]
    three = two + [{"stream": "acc", "held": {"ratio": 1.0}, "clips": {"acc": 4}}]
    assert nr.back_check({"class_b": three}) == ("fail", 4, 3)


# ── ALLAN-STABILITY-GAPS §2.4 — the clock line, in the report file and not in the digest ──────────


def _summary_with_arrival(rows):
    return {"devices": {}, "arrival": rows}


def test_clock_line_names_noise_sigma_n_and_gap_per_stream():
    rows = [{
        "device": "Polar H10 02849638", "meas": "ecg",
        "stability": {"ok": True, "adev_min": 0.0123, "optimal_tau": 64.0, "n": 67715,
                      "classification": {"noise": "white-frequency", "candidates": None}},
        "tau0_uniformity": {"ratio": 1.04, "median": 0.55, "max_gap": 96.8, "n": 67715},
    }]
    lines = nr.clock_lines(_summary_with_arrival(rows))
    assert lines == ["clock H10/ecg: white-frequency · σ_y(τ_opt=64 s)=12.30 ppm · n=67715 · max_gap=96.8×median"]
    rep = nr.build("2026-09-12", _summary_with_arrival(rows), None)
    assert rep["clock"] == lines
    assert "clock H10/ecg" not in rep["line"]  # the digest is untouched
    assert "clock H10/ecg: white-frequency" in nr.render(rep)


def test_clock_line_says_refused_with_the_candidates_and_unknown_for_absent_fields():
    rows = [{
        "device": "Polar VeritySense 0C301E3F", "meas": "ppg",
        "stability": {"ok": True, "adev_min": 0.002,
                      "classification": {"noise": None, "candidates": ["white-frequency", "flicker-frequency"]}},
        # no optimal_tau, no n, no tau0_uniformity — an older QC record
    }]
    (line,) = nr.clock_lines(_summary_with_arrival(rows))
    assert line.startswith("clock VeritySense/ppg: refused(white-frequency/flicker-frequency)")
    assert "τ_opt=unknown s" in line and "n=unknown" in line and "max_gap=unknown×median" in line
    assert "=2.00 ppm" in line


def test_clock_line_skips_streams_without_a_stability_verdict_and_tolerates_junk():
    rows = [
        {"device": "Polar H10 X", "meas": "acc", "stability": {"ok": False, "reason": "too-few-taus"}},
        {"device": "Polar H10 X", "meas": "ecg"},
        "not a row",
        None,
    ]
    assert nr.clock_lines(_summary_with_arrival(rows)) == []
    assert nr.clock_lines(None) == []
    assert nr.clock_lines({"arrival": "junk"}) == []
    assert nr.build("n", None, None)["clock"] == []



# ── THE FIRST CONSUMER OF A VERDICT OBJECT ON THE BOX (VERDICT-CONTRACT §3b) ────────────────────────

def _bc(status, clips=3, held=1, reason="x"):
    return {"schema": "tepna.verdict/1", "gate": "night-backcheck", "status": status,
            "population": {"checked": 2, "eligible": 2, "excluded": 0},
            "criterion": {"name": "clip_regions_plus_held_streams", "threshold": 0, "unit": "count", "direction": "lte"},
            "result": {"clip_regions": clips, "held_streams": held, "files": {}},
            "evidence": ["capture-host/nightqc.py"], "reason": None if status == "PASS" else reason,
            "producedBy": {"tool": "capture-host/nightqc.py", "commit": "abc"}, "at": "2026-09-21T09:00:00Z",
            "scope": "internal"}


def test_the_back_check_field_reads_the_verdict_object_before_the_prose():
    assert nr.back_check_from_verdict(_bc("PASS", 0, 0)) == ("ok", 0, 0)
    assert nr.back_check_from_verdict(_bc("FAIL", 25, 1)) == ("fail", 25, 1)
    for st in ("NOT_RUN", "UNKNOWN", "UNDERPOWERED", "SHORTFALL", "NOT_APPLICABLE"):
        assert nr.back_check_from_verdict(_bc(st))[0] == nr.UNKNOWN, st
    # not the object at all → None, so the caller falls back; never a fabricated ok
    assert nr.back_check_from_verdict(None) is None
    assert nr.back_check_from_verdict({"schema": "tepna.verdict/1", "gate": "night-qc", "status": "PASS"}) is None
    assert nr.back_check_from_verdict({"schema": "other", "gate": "night-backcheck", "status": "PASS"}) is None


def test_build_prefers_the_object_and_falls_back_to_class_b_when_it_is_absent():
    # the summary's class_b says 25 clips; the object says the check was NOT_RUN → the line says unknown
    r = nr.build("2026-09-08", {"class_b": REAL_CLASS_B}, None, _bc("NOT_RUN", None, None, "no file"))
    assert r["back_check"] == nr.UNKNOWN and r["spans"] is None
    r = nr.build("2026-09-08", {"class_b": REAL_CLASS_B}, None, None)      # no object: the old path
    assert r["back_check"] == "fail" and r["spans"] == 25
    r = nr.build("2026-09-08", {"class_b": REAL_CLASS_B}, None, _bc("PASS", 0, 0))
    assert r["back_check"] == "ok" and "back-check ok" in r["line"]


def test_read_night_picks_up_the_verdict_file_beside_the_summary(tmp_path):
    d = tmp_path / "2026-09-19"; d.mkdir()
    (d / "QC-SUMMARY.json").write_text(json.dumps({"class_b": REAL_CLASS_B}))
    (d / "BACKCHECK-VERDICT.json").write_text(json.dumps(_bc("PASS", 0, 0)))
    r = nr.read_night(str(tmp_path), "2026-09-19")
    assert r["back_check"] == "ok" and r["spans"] == 0
    (d / "BACKCHECK-VERDICT.json").write_text("{not json")
    r = nr.read_night(str(tmp_path), "2026-09-19")
    assert r["back_check"] == "fail" and r["spans"] == 25                    # unreadable object → the fallback, honestly
