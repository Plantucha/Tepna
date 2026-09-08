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


def test_an_EMPTY_back_check_is_ok_with_zero_spans_and_an_ABSENT_one_is_unknown():
    """The distinction the whole file exists for. `class_b: []` means it LOOKED and found nothing;
    no `class_b` key means it never ran. Flattening those is how a report starts lying."""
    ran = nr.back_check(dict(REAL_SUMMARY, class_b=[]))
    assert ran == ("ok", 0), "an empty list is a completed check with nothing to report"
    assert nr.back_check(REAL_SUMMARY) == ("unknown", None), "an absent key never ran"
    assert nr.back_check(None) == ("unknown", None)
    assert nr.back_check({"class_b": "not a list"}) == ("unknown", None)


def test_clipped_spans_are_counted_across_sessions_and_fail_the_check():
    r = nr.build("2026-09-08", dict(REAL_SUMMARY, class_b=[{"clip": [1, 2]}, {"clip": []},
                                                           {"clip": [3]}]), None)
    assert r["spans"] == 3 and r["back_check"] == "fail"
    assert "3 spans, back-check fail" in r["line"]


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
    night.joinpath("QC-SUMMARY.json").write_text(json.dumps(dict(REAL_SUMMARY, class_b=[])),
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
    night.joinpath("QC-SUMMARY.json").write_text(json.dumps(dict(REAL_SUMMARY, class_b=[])),
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
