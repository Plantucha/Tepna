# tepna-capture — tests/test_starts_sidecar.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# STARTS.csv — the night's daemon starts, and how many landed inside a capture
# (residue 2026-09-10-daemon-restarts-are-idle-gated).
#
# OBSERVABILITY, NOT A FIX, and the tests are shaped by that. An earlier row read a high restart COUNT
# as evidence of fragmentation; the harm was then measured and was not there — 9 restarts in capture
# hours over four nights, 0 of them inside a live capture, because the deploy path gates on idleness.
# What remained true is that nothing REPORTED the count, so the next person to suspect fragmentation
# had to re-derive it from journalctl. So the count now ships — and it never ships alone, because a
# bare count is exactly what misled. Every assertion below pins the pair, not the number.

import datetime as dt
import os

import capture
import night_report
import nightqc
import writers

WHEN = dt.datetime(2026, 9, 10, 5, 12, 39)


def _start(tmp_path, **over):
    kw = dict(pid=4242, git="b89c192", dirty=False, adapter="AA:BB:CC:DD:EE:FF")
    kw.update(over)
    ok = writers.append_daemon_start(str(tmp_path), WHEN, **kw)
    return ok, os.path.join(str(tmp_path), "captures", "2026-09-10", writers.STARTS_NAME)


# ── the writer ────────────────────────────────────────────────────────────────────────────────────

def test_one_header_then_a_row_per_start_and_the_pid_separates_two_in_one_second(tmp_path):
    _start(tmp_path)
    ok, path = _start(tmp_path, pid=4243)
    assert ok
    lines = open(path, encoding="utf-8").read().splitlines()
    assert len(lines) == 3 and lines[0].startswith("Phone timestamp;pid;git;dirty;adapter")
    assert lines[1].split(";")[1] == "4242" and lines[2].split(";")[1] == "4243", (
        "two starts inside one second are two rows, told apart by pid")


def test_dirty_is_a_TRISTATE_and_unknown_is_blank_never_clean(tmp_path):
    _start(tmp_path, dirty=None)
    _start(tmp_path, dirty=True)
    _start(tmp_path, dirty=False, git=None)
    rows = [ln.split(";") for ln in open(_start(tmp_path)[1], encoding="utf-8").read().splitlines()[1:]]
    assert [r[3] for r in rows[:3]] == ["", "yes", "no"], "git could not tell us is not a clean tree"
    assert rows[2][2] == "", "an absent sha is blank, not a fabricated one"


def test_no_root_and_an_unwritable_root_both_return_false_and_never_raise(tmp_path):
    assert writers.append_daemon_start("", WHEN, pid=1, git=None, dirty=None, adapter=None) is False
    d = tmp_path / "ro"
    d.mkdir()
    os.chmod(d, 0o500)
    try:
        assert _start(d)[0] is False
    finally:
        os.chmod(d, 0o700)


# ── the reader: the COUNT and the harm term, together ─────────────────────────────────────────────

def _night(tmp_path, stamps, *, rows_in_file=True, span=(5 * 60, 7 * 60)):
    """A night dir with one data file whose span is `span` minutes past midnight, and `stamps`
    (minutes past midnight) as daemon starts."""
    night = tmp_path / "captures" / "2026-09-10"
    night.mkdir(parents=True, exist_ok=True)
    base = dt.datetime(2026, 9, 10)
    name = "Polar_VeritySense_0C301E3F_%s_PPG.txt" % (base + dt.timedelta(minutes=span[0])).strftime("%Y%m%d%H%M%S")
    p = night / name
    p.write_text("Phone timestamp;sensor timestamp [ns];channel 0\n" + ("x;1;2\n" if rows_in_file else ""),
                 encoding="utf-8")
    os.utime(p, ((base + dt.timedelta(minutes=span[1])).timestamp(),) * 2)
    for i, m in enumerate(stamps):
        writers.append_daemon_start(str(tmp_path), base + dt.timedelta(minutes=m),
                                    pid=100 + i, git="b89c192", dirty=False, adapter=None)
    return str(night)


def test_a_start_INSIDE_a_capturing_file_span_is_counted_and_one_outside_is_not(tmp_path):
    d = _night(tmp_path, [4 * 60, 6 * 60, 8 * 60])       # before · inside · after
    got = nightqc.daemon_starts(d)
    assert got["starts"] == 3 and got["inside_capture"] == 1
    assert len(got["stamps"]) == 3 and got["stamps"] == sorted(got["stamps"])


def test_a_file_that_carried_NO_ROWS_is_not_a_capture_to_interrupt(tmp_path):
    d = _night(tmp_path, [6 * 60], rows_in_file=False)
    got = nightqc.daemon_starts(d)
    assert got["starts"] == 1 and got["inside_capture"] == 0


def test_an_absent_sidecar_is_NULL_not_zero(tmp_path):
    """A night whose daemon predates the sidecar did not restart zero times — it did not say."""
    night = tmp_path / "captures" / "2026-09-10"
    night.mkdir(parents=True)
    assert nightqc.daemon_starts(str(night)) == {"starts": None, "inside_capture": None, "stamps": []}


def test_a_torn_row_and_an_unparseable_stamp_are_dropped_not_dated_now(tmp_path):
    d = _night(tmp_path, [6 * 60])
    with open(os.path.join(d, writers.STARTS_NAME), "a", encoding="utf-8") as fh:
        fh.write("torn;row\n")
        fh.write("not-a-stamp;7;abc;no;\n")
    got = nightqc.daemon_starts(d)
    assert got["starts"] == 1, "a start we cannot place is not a start at this instant"
    assert nightqc._parse_phone_ts("nonsense") is None


def test_the_summary_carries_it_without_walking_the_night_twice(tmp_path):
    d = _night(tmp_path, [6 * 60])
    summ = nightqc.summarize(d, [])
    assert summ["daemon"]["starts"] == 1 and summ["daemon"]["inside_capture"] == 1


# ── the report: the pair in the FILE, never in the one-line digest ────────────────────────────────

def test_the_report_renders_the_count_WITH_its_harm_term(tmp_path):
    rep = night_report.build("2026-09-10", {"daemon": {"starts": 9, "inside_capture": 0}}, None)
    assert rep["restarts"] == "9 (0 inside a capture)"
    assert "restarts" not in rep["line"], "§2.4: the one-line digest stays what it is"
    rendered = [ln for ln in night_report.render(rep).splitlines() if ln.startswith("restarts")]
    assert rendered == ["restarts     9 (0 inside a capture)"], rendered
    bare = night_report.build("2026-09-10", {}, None)
    assert bare["restarts"] == night_report.UNKNOWN, "no sidecar is unknown, not a clean 0"


# ── the emitter: a real startup writes one row ────────────────────────────────────────────────────

def test_starting_the_daemon_lands_exactly_one_row(tmp_path, monkeypatch):
    from test_capture_runners import _main_with_cfg
    cfg = {"root": str(tmp_path), "web": {"enabled": False}, "devices": []}
    _main_with_cfg(tmp_path, monkeypatch, cfg)
    found = [os.path.join(r, n) for r, _d, ns in os.walk(str(tmp_path)) for n in ns
             if n == writers.STARTS_NAME]
    assert len(found) == 1, f"one row per start, in tonight's night dir: {found}"
    rows = open(found[0], encoding="utf-8").read().splitlines()
    assert len(rows) == 2 and rows[1].split(";")[1] == str(os.getpid())
    capture._STOP.clear()
