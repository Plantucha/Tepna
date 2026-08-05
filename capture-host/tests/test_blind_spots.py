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
