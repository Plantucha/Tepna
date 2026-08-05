# tepna-capture — tests/test_blind_spots.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# `blind_spots.analyze` reads the TESTS and reports arguments a double throws away. A wrong answer is
# harmful in both directions and neither is loud: a false positive costs someone an afternoon proving a
# non-bug, and a false negative reads as "this family is absent here", which is the exact reassurance
# the tool exists to withhold. Every case below is a shape taken from this suite, not an invented one.
import pytest

from blind_spots import DISCARDED, SWALLOWED, analyze, rank, summarize


def _one(src):
    out = analyze(src, "t.py")
    assert len(out) == 1, f"expected exactly one finding, got {out}"
    return out[0]


# ── the family this exists to find ──────────────────────────────────────────────────────────────────
def test_a_nested_double_that_drops_a_named_argument_is_reported():
    """The real shape: 13 copies of this lived in test_capture_runners.py, and the discarded `message`
    hid a swapped GB/% in a user-facing alert that survived the entire suite."""
    f = _one("""
def test_x():
    sent = []
    class N:
        async def send(self, title, message, **kw):
            sent.append(title)
""")
    assert f["discarded"] == ["message"]
    assert f["swallowed"] == "kw"
    assert f["double"] == "send"
    assert f["line"] == 5


def test_a_lambda_body_is_a_single_expression_not_a_list():
    """The first real file crashed this with `'Call' object is not iterable`. A def's body is a list of
    statements; a lambda's is one expression node — and lambdas are the densest doubles in this suite,
    so mishandling them is not a corner case."""
    f = _one("def test_x():\n    g = lambda addr, timeout: probe(addr)\n")
    assert f["discarded"] == ["timeout"] and f["double"] == "<lambda>"


def test_kwargs_that_is_never_read_is_reported_as_SWALLOWED():
    """One unread `**kw` hides an unbounded number of arguments, so it is not one finding of the same
    size as a named drop — it gets its own kind and outranks named drops."""
    f = _one("def test_x():\n    def d(a, **kw):\n        return a\n")
    assert f["kind"] == SWALLOWED and f["swallowed"] == "kw" and f["discarded"] == []


def test_a_named_drop_alongside_swallowed_kwargs_is_kind_DISCARDED():
    f = _one("def test_x():\n    def d(a, b, **kw):\n        return a\n")
    assert f["kind"] == DISCARDED and f["discarded"] == ["b"] and f["swallowed"] == "kw"


def test_positional_only_and_keyword_only_parameters_are_both_counted():
    f = _one("def test_x():\n    def d(a, /, b, *, c):\n        return b\n")
    assert f["discarded"] == ["a", "c"], "posonly and kwonly are arguments too"


# ── what it must NOT report (a false positive costs an afternoon) ────────────────────────────────────
def test_a_double_that_reads_every_argument_is_clean():
    assert analyze("def test_x():\n    def d(a, b, **kw):\n        return (a, b, kw)\n", "t.py") == []


def test_self_and_cls_are_the_binding_not_data():
    assert analyze("class Helper:\n    def m(self, a):\n        return a\n", "t.py") == []


def test_an_underscore_prefixed_parameter_is_deliberately_ignored():
    """`_`-prefixed is the language's own way of saying "I am dropping this on purpose". Honouring it is
    what keeps the tool from crying wolf on every well-written double."""
    assert analyze("def test_x():\n    def d(a, _unused, **_kw):\n        return a\n", "t.py") == []


def test_a_test_function_is_not_a_double():
    """A `def test_...`'s parameters are pytest FIXTURES. An unused fixture is a different smell with a
    different fix — it is usually requested for its side effect (monkeypatching), which is precisely
    why the body never names it."""
    assert analyze("def test_x(tmp_path, monkeypatch):\n    pass\n", "t.py") == []


def test_a_test_METHOD_in_a_test_class_is_not_a_double_either():
    """THIS is the case the `test_` guard actually carries, and the reason it is not redundant.

    A top-level `def test_x` is already excluded by being at depth 0, so the first version of the test
    above passed with the guard DELETED — it ran the line without observing it, and coverage read 100%.
    Inside a class the depth rule no longer applies, so without the guard every pytest test method in a
    `class TestFoo` would be reported as a double dropping its fixtures. Found by mutating this module
    with its own discipline."""
    assert analyze("class TestThing:\n    def test_x(self, tmp_path, monkeypatch):\n        pass\n",
                   "t.py") == []


def test_a_name_read_only_inside_a_nested_closure_still_counts_as_read():
    """Over-approximating loses findings; under-approximating invents them. This must resolve toward
    silence."""
    assert analyze("def test_x():\n    def d(a):\n        def inner():\n            return a\n"
                   "        return inner\n", "t.py") == []


def test_an_augmented_assignment_reads_before_it_writes():
    assert analyze("def test_x():\n    def d(a):\n        a += 1\n", "t.py") == []


def test_a_name_used_only_in_an_fstring_counts_as_read():
    assert analyze("def test_x():\n    def d(a):\n        return f'{a}'\n", "t.py") == []


# ── the tool's own honesty ───────────────────────────────────────────────────────────────────────────
def test_a_file_that_cannot_be_parsed_raises_rather_than_reporting_clean():
    """Returning [] for an unparseable file would read as "no blind spots here" — this module's own
    version of the bug it hunts."""
    with pytest.raises(SyntaxError):
        analyze("def (:\n", "broken.py")


def test_rank_puts_kwargs_swallowers_first_then_the_widest_drops():
    findings = analyze("""
def test_x():
    def one(a):
        pass
    def two(a, b, c):
        pass
    def three(a, **kw):
        return a
""", "t.py")
    order = [f["double"] for f in rank(findings)]
    assert order[0] == "three", "an unbounded swallow outranks any fixed count"
    assert order[1:] == ["two", "one"], "then widest drop first"


def test_summarize_counts_ARGUMENTS_not_doubles():
    """One double dropping four parameters is four blind production expressions, and reporting it as
    "1 double" understates the surface by 4x."""
    s = summarize(analyze("def test_x():\n    def d(a, b, c):\n        pass\n", "t.py"))
    assert s == {"doubles": 1, "params": 3, "swallowing": 0, "files": 1}


def test_findings_are_ordered_by_file_then_line():
    out = analyze("def test_x():\n    def b(q):\n        pass\n    def a(q):\n        pass\n", "t.py")
    assert [f["line"] for f in out] == [2, 4]


def test_a_method_on_a_helper_class_is_a_double_even_at_module_level():
    """`class SubprocessRecorder:` sits at module level in conftest.py; its `__call__` is still a double
    handed to production code."""
    f = _one("class Rec:\n    def __call__(self, argv, timeout):\n        self.calls.append(argv)\n")
    assert f["discarded"] == ["timeout"]


# ── THE CANARY: a planted blind spot in a REAL test file ─────────────────────────────────────────────
# Every test above runs on a two-line synthetic snippet, and that is not enough. The JS sibling of this
# analyser passed its own 6/6 self-test while being completely blind on the real 33k-line suite: small
# inputs exercise none of the complexity that actually breaks a scanner (reassignment, accumulators,
# in-place mutation, out-parameters, scope collisions). It reported ZERO and read as a clean bill of
# health; a planted defect of exactly the hunted shape was what exposed it, in seconds, after five
# rounds of hand-tuning had not. See `briefs/JS-SEALED-ASSERTION-DEAD-END-2026-08-05-BRIEF.md`.
#
# So: plant a known-bad double into a REAL file from this suite and require it back. This fails the day
# `analyze` starts returning nothing useful on real input — the one failure the unit tests cannot see,
# because they never feed it a real file.
import os

import blind_spots

_HERE = os.path.dirname(os.path.abspath(__file__))

_PLANT = '''

def _canary_outer():
    def _canary_double(recorded, discarded_argument, **swallowed):
        return recorded
    return _canary_double
'''


def _a_real_test_file():
    """The biggest real test file — the one with the most syntax for a scanner to trip over."""
    p = os.path.join(_HERE, "test_capture_runners.py")
    with open(p, encoding="utf-8") as fh:
        return fh.read()


def test_the_analyzer_finds_a_PLANTED_blind_spot_in_a_REAL_test_file():
    """The canary. Not a snippet — a genuine 3000-line file with the defect appended."""
    src = _a_real_test_file() + _PLANT
    found = blind_spots.analyze(src, "planted.py")
    mine = [f for f in found if f["double"] == "_canary_double"]
    assert len(mine) == 1, "the planted double must be found in a real file, not just in a snippet"
    assert mine[0]["discarded"] == ["discarded_argument"], mine[0]
    assert mine[0]["swallowed"] == "swallowed", mine[0]


def test_the_analyzer_is_not_silently_blind_on_the_real_suite():
    """A second, blunter canary: the real file must yield findings at all.

    If a change makes `analyze` resolve nothing on real input it will return `[]`, and `[]` reads as
    "this file is clean" — the exact false-green that killed the JS attempt. This does NOT pin a count
    (doubles get fixed, and a moving number would be a merge tax); it pins that the scanner still sees
    SOMETHING in a file known to be full of them."""
    found = blind_spots.analyze(_a_real_test_file(), "test_capture_runners.py")
    assert len(found) > 20, (
        f"only {len(found)} finding(s) in the suite's densest test file — the scanner has probably "
        "stopped resolving real input rather than the file having been cleaned up")


def test_a_clean_real_file_yields_nothing_so_the_canary_cannot_pass_on_noise():
    """The control for the canary above: the analyzer must not report findings for a real file whose
    doubles all record their arguments. Without this, `len(found) > 20` could be satisfied by a scanner
    that flags everything, which is just as useless as one that flags nothing."""
    clean = "\n\n".join(
        f"def test_case_{i}():\n"
        f"    def double_{i}(a, b, **kw):\n"
        f"        return (a, b, kw)\n"
        for i in range(30))
    assert blind_spots.analyze(clean, "clean.py") == []


# ── the scope seed, the path, and the counter — found by mutating this module ────────────────────────
# CI's diff-scoped mutation gate flagged 44 survivors here and the PR merged past it (the check is not
# required, and I did not read it). The canary above killed 24 of them by feeding the analyzer a real
# file. These pin what remained and is behavioural.

def test_a_top_level_helper_that_is_not_a_test_is_still_not_a_double():
    """THE SCOPE SEED. Three separate mutants — `depth > 0` → `>= 0`, `visit(tree, 1, …)`, and
    `visit(tree, 0, True)` — all have the same effect: every module-level function becomes a "double".
    A test file's own helpers (`def _run(coro)`, `def _write_read(...)`) would then be reported for
    every parameter they do not read, burying the real findings in noise. Nothing caught it, because
    the snippets all used NESTED functions and the real-file canary counts findings rather than
    checking which ones."""
    src = ("def _helper(unused_param):\n"
           "    return 1\n"
           "\n"
           "def test_real(monkeypatch):\n"
           "    pass\n")
    assert blind_spots.analyze(src, "t.py") == [], (
        "a module-level helper is not handed to production code — flagging it is noise, and it is "
        "what makes a report unreadable")


def test_a_finding_carries_the_path_it_was_given():
    """`_record(child, path, out)` → `_record(child, None, out)` survived: every finding's `file` went
    None and no test looked. The tool groups and sorts by file, and its whole output is
    `file:line double` — a None there makes the report unusable while the counts stay right."""
    f = _one("def test_x():\n    def d(a, b):\n        return a\n")
    assert f["file"] == "t.py", "the finding must name the file it came from"
    both = blind_spots.analyze("def test_x():\n    def d(a, b):\n        return a\n", "other.py")
    assert both[0]["file"] == "other.py", "…and it must be the path passed in, not a constant"


def test_summarize_counts_each_swallower_once():
    """`sum(1 for …)` → `sum(2 for …)` survived because the only summarize test had ZERO swallowers,
    and 2×0 == 1×0. A doubled count would overstate the unbounded-blast-radius family — the one the
    tool ranks first — by exactly 2x."""
    s = blind_spots.summarize(blind_spots.analyze(
        "def test_x():\n"
        "    def one(a, **kw):\n"
        "        return a\n"
        "    def two(b, **kw2):\n"
        "        return b\n", "t.py"))
    assert s["swallowing"] == 2, f"two doubles swallow kwargs, not {s['swallowing']}"
    assert s["doubles"] == 2
