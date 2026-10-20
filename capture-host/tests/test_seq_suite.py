# tepna-capture — tests/test_seq_suite.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`tools/seq_suite.py` — the ordered whole-suite run and the verdict it answers with.

Every test here drives the tool with a FAKE pytest, because the real one takes about nineteen minutes
and the thing under test is not pytest. What is under test is the reading: which lines are node ids,
where `checked` comes from, and whether a failure that passes alone is told apart from one that does
not. The one test that runs a real subprocess runs `python -c`, to prove the seam merges both streams.
"""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools"))
import seq_suite as S  # noqa: E402


class Fake:
    """A scripted pytest. Each call pops the next reply; an exhausted script answers green, which is
    what a classification re-run of a test that passes alone looks like."""

    def __init__(self, *replies, writes=None):
        self.replies = list(replies)
        self.writes = writes or {}
        self.calls = []

    def __call__(self, cmd, cwd):
        self.calls.append(cmd)
        for path, text in self.writes.items():
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(text)
        self.writes = {}
        return self.replies.pop(0) if self.replies else (0, "")


def _junit(n):
    return f'<?xml version="1.0"?><testsuites><testsuite name="pytest" tests="{n}"/></testsuites>'


def test_the_SUBPROCESS_SEAM_merges_stdout_and_stderr(tmp_path):
    """pytest writes a collection error to stderr and the short summary to stdout. A reader of one
    stream alone sees a run that examined nothing as a run with nothing to report."""
    code = "import sys; print('on-out'); print('on-err', file=sys.stderr)"
    rc, out = S._run([sys.executable, "-c", code], str(tmp_path))
    assert rc == 0
    assert "on-out" in out and "on-err" in out


def test_a_NODE_ID_IS_TAKEN_BY_SHAPE_so_the_count_line_and_a_traceback_are_not_ids():
    """`--collect-only -q` prints the ids, then a blank line and a count. On a bad tree it also prints
    an indented traceback, whose frames can hold `::` — so the column-0 test is load-bearing."""
    out = "tests/a.py::test_x\ntests/b.py::test_y\n\n  tests/c.py::test_indented\n2 tests collected\n"
    assert S.collect_order(out) == ["tests/a.py::test_x", "tests/b.py::test_y"]


def test_an_EMPTY_COLLECTION_is_an_empty_list_rather_than_a_guess():
    assert S.collect_order("") == []


def test_FAILING_IDS_come_from_the_short_summary_and_keep_the_file_path():
    """The junit XML carries a dotted classname, so an id rebuilt from it loses the path of any test
    in a class. `-rf` prints the id verbatim, and the reason after ` - ` is not part of it."""
    out = (
        "FAILED tests/a.py::test_x - AssertionError: nope\n"
        "ERROR tests/b.py::test_y\n"
        "PASSED tests/c.py::test_z\n"
        "FAILED\n"
    )
    assert S.failing_ids(out) == ["tests/a.py::test_x", "tests/b.py::test_y"]


def test_CHECKED_SUMS_EVERY_TESTSUITE_and_a_missing_attribute_counts_zero():
    """pytest writes one `<testsuite>` inside `<testsuites>`, but the schema allows several, and a
    suite element with no `tests` attribute is a report that counted nothing."""
    both = '<testsuites><testsuite tests="3"/><testsuite/></testsuites>'
    assert S.junit_checked(both) == 3
    assert S.junit_checked('<testsuite tests="7"/>') == 7


def test_an_UNPARSEABLE_JUNIT_REPORT_is_None_rather_than_zero():
    """A population this tool cannot state is one it must not invent. Zero would read as a run that
    examined nothing, which is a different fact."""
    assert S.junit_checked("<testsuite tests=") is None


def test_READING_AN_ABSENT_FILE_is_None(tmp_path):
    assert S._read(str(tmp_path / "nope.xml")) is None
    p = tmp_path / "there.xml"
    p.write_text("hi", encoding="utf-8")
    assert S._read(str(p)) == "hi"


def test_the_RIG_LOCK_is_exclusive_and_a_second_holder_gets_None(tmp_path):
    """`flock` and not a pid file: a crawl SIGKILLed mid-mutation leaves a pid file behind and a lock
    it never held, so a pid file would skip every later pass."""
    path = str(tmp_path / "rig.lock")
    first = S._lock(path)
    assert first is not None
    assert S._lock(path) is None
    first.close()
    second = S._lock(path)
    assert second is not None
    second.close()


def test_a_POSITION_THE_COLLECTION_DOES_NOT_HOLD_is_None_rather_than_an_index():
    """A parametrised id the collection printed differently is a real gap in this tool. A fabricated
    index would hide it behind a plausible number."""
    order = ["tests/a.py::test_x", "tests/b.py::test_y"]
    assert S._positions(order, ["tests/b.py::test_y", "tests/z.py::test_q"]) == {
        "tests/b.py::test_y": 2,
        "tests/z.py::test_q": None,
    }


def test_CLASSIFY_SPLITS_BY_THE_LONE_RERUN_not_by_the_first_failure():
    """Passing alone means the neighbours failed it. Failing alone means the tree is red and the order
    had nothing to do with it. Without the split a bird cannot tell a blind spot from a bug."""
    order = ["tests/a.py::test_x", "tests/b.py::test_y"]
    fake = Fake((0, ""), (1, "boom"))
    dependent, alone = S.classify(order, order, "py", "/tmp", 180, run=fake)
    assert dependent == [{"nodeid": "tests/a.py::test_x", "position": 1, "of": 2}]
    assert alone == [{"nodeid": "tests/b.py::test_y", "position": 2, "of": 2}]
    assert fake.calls[0][-1] == "tests/a.py::test_x"


def test_the_ADOPTION_SAMPLE_is_a_valid_object():
    """The adoption gate reads a real object from every tool that prints a verdict word, and this is
    the one shape that costs no suite run."""
    v = S.sample()
    assert v["gate"] == "seq-suite" and v["status"] == "PASS"
    assert v["criterion"]["name"] == "ordered_run_failures"


def test_a_HELD_RIG_LOCK_is_NOT_RUN_and_examines_nothing(tmp_path):
    """The crawl and this run are the two whole-tree consumers on the rig. Overlapping them makes both
    slower and neither trustworthy, so a held lock skips the pass with a reason."""
    path = str(tmp_path / "rig.lock")
    held = S._lock(path)
    fake = Fake()
    v = S.run_once(python="py", cwd="/tmp", timeout=180, junit="/tmp/j.xml", lock=path, run=fake)
    held.close()
    assert v["status"] == "NOT_RUN"
    assert v["population"] == {"checked": 0, "eligible": 0, "excluded": 0}
    assert v["result"] is None and path in v["reason"]
    assert fake.calls == []


def test_a_FREE_RIG_LOCK_is_TAKEN_FOR_THE_WHOLE_RUN_and_released(tmp_path):
    path = str(tmp_path / "rig.lock")
    junit = str(tmp_path / "j.xml")
    fake = Fake((0, "tests/a.py::test_x\n"), (0, ""), writes={junit: _junit(1)})
    v = S.run_once(python="py", cwd="/tmp", timeout=180, junit=junit, lock=path, run=fake)
    assert v["status"] == "PASS"
    assert S._lock(path) is not None


def test_A_COLLECTION_THAT_FAILS_IS_NOT_RUN_rather_than_a_pass_over_nothing(tmp_path):
    """A non-zero collect exit with ids on stdout is the dangerous case: the ids look like a suite.
    The contract gives a NOT_RUN no `result`, so the exit code has to reach the reader as prose."""
    fake = Fake((2, "tests/a.py::test_x\n"))
    v = S.run_once(python="py", cwd="/tmp", timeout=180, junit="/tmp/j.xml", lock=None, run=fake)
    assert v["status"] == "NOT_RUN" and "collect exit 2, 1 id(s)" in v["reason"]
    assert v["population"] == {"checked": 0, "eligible": 1, "excluded": 1}


def test_AN_EMPTY_COLLECTION_IS_NOT_RUN_even_when_pytest_exits_zero(tmp_path):
    fake = Fake((0, "no tests ran\n"))
    v = S.run_once(python="py", cwd="/tmp", timeout=180, junit="/tmp/j.xml", lock=None, run=fake)
    assert v["status"] == "NOT_RUN" and v["population"]["eligible"] == 0


def test_AN_ABSENT_JUNIT_REPORT_IS_UNKNOWN_because_the_run_has_no_population(tmp_path):
    """The run executed, so this is not NOT_RUN. What is missing is the denominator, and a verdict
    without one is the examined-nothing shape the contract refuses."""
    junit = str(tmp_path / "gone.xml")
    fake = Fake((0, "tests/a.py::test_x\n"), (1, "FAILED tests/a.py::test_x\n"))
    v = S.run_once(python="py", cwd="/tmp", timeout=180, junit=junit, lock=None, run=fake)
    assert v["status"] == "UNKNOWN"
    assert "absent or unreadable" in v["reason"]
    assert v["result"]["failed"] == ["tests/a.py::test_x"]


def test_MORE_JUNIT_TESTS_THAN_THE_COLLECTION_OFFERED_IS_UNKNOWN(tmp_path):
    """`excluded` is a subtraction, so a junit count above the collection would make it negative and
    break the population equality. The tool says it cannot reconcile them instead."""
    junit = str(tmp_path / "j.xml")
    fake = Fake((0, "tests/a.py::test_x\n"), (0, ""), writes={junit: _junit(5)})
    v = S.run_once(python="py", cwd="/tmp", timeout=180, junit=junit, lock=None, run=fake)
    assert v["status"] == "UNKNOWN" and v["reason"] == S.OVER_COUNT


def test_A_GREEN_ORDERED_RUN_IS_PASS_with_the_collection_as_its_denominator(tmp_path):
    junit = str(tmp_path / "j.xml")
    fake = Fake((0, "tests/a.py::test_x\ntests/b.py::test_y\n"), (0, ""), writes={junit: _junit(2)})
    v = S.run_once(python="py", cwd="/tmp", timeout=180, junit=junit, lock=None, run=fake)
    assert v["status"] == "PASS" and v["reason"] is None
    assert v["population"] == {"checked": 2, "eligible": 2, "excluded": 0}
    assert v["result"]["orderDependent"] == [] and v["result"]["failsAlone"] == []


def test_A_FAILURE_IS_FAIL_AND_CARRIES_THE_SPLIT_AND_THE_POSITION(tmp_path):
    """The criterion is the ordered run, so any failure is a FAIL. The split and the position are what
    make the object actionable: one of these tests passes alone, the other does not."""
    junit = str(tmp_path / "j.xml")
    out = "FAILED tests/a.py::test_x - nope\nFAILED tests/b.py::test_y - nope\n"
    fake = Fake(
        (0, "tests/a.py::test_x\ntests/b.py::test_y\n"), (1, out), (0, ""), (1, "still"), writes={junit: _junit(2)}
    )
    v = S.run_once(python="py", cwd="/tmp", timeout=180, junit=junit, lock=None, run=fake)
    assert v["status"] == "FAIL"
    assert v["result"]["orderDependent"] == [{"nodeid": "tests/a.py::test_x", "position": 1, "of": 2}]
    assert v["result"]["failsAlone"] == [{"nodeid": "tests/b.py::test_y", "position": 2, "of": 2}]
    assert "1 test(s) pass alone" in v["reason"]


def test_A_SKIPPED_TEST_LEAVES_EXCLUDED_NON_ZERO_and_the_equality_holds(tmp_path):
    """pytest can abort after an error with fewer cases in the report than the collection offered.
    `checked` comes from the report, so the difference lands in `excluded` instead of vanishing."""
    junit = str(tmp_path / "j.xml")
    fake = Fake((0, "tests/a.py::test_x\ntests/b.py::test_y\n"), (0, ""), writes={junit: _junit(1)})
    v = S.run_once(python="py", cwd="/tmp", timeout=180, junit=junit, lock=None, run=fake)
    assert v["population"] == {"checked": 1, "eligible": 2, "excluded": 1}


def test_THE_SAMPLE_FLAG_PRINTS_THE_OBJECT_AND_RUNS_NOTHING(capsys):
    assert S.main(["--verdict-sample"], run=Fake()) == 0
    assert json.loads(capsys.readouterr().out)["gate"] == "seq-suite"


def test_MAIN_WRITES_THE_VERDICT_AND_EXITS_ZERO_ONLY_ON_PASS(tmp_path, capsys):
    """The exit code carries the verdict so the unit's journal shows it, and the object is still the
    product: the owner's ruling is that a failure files nothing by itself."""
    junit = str(tmp_path / "j.xml")
    out_path = str(tmp_path / "verdict.json")
    green = Fake((0, "tests/a.py::test_x\n"), (0, ""), writes={junit: _junit(1)})
    rc = S.main(["--junit", junit, "--verdict-out", out_path, "--cwd", "/tmp"], run=green)
    capsys.readouterr()
    assert rc == 0
    assert json.load(open(out_path, encoding="utf-8"))["status"] == "PASS"
    red = Fake((0, "tests/a.py::test_x\n"), (1, "FAILED tests/a.py::test_x\n"), (1, "still"), writes={junit: _junit(1)})
    assert S.main(["--junit", junit, "--cwd", "/tmp"], run=red) == 1
    capsys.readouterr()
