# tepna-capture — tests/test_blind_spots.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# `blind_spots.analyze` reads the TESTS and reports arguments a double throws away. A wrong answer is
# harmful in both directions and neither is loud: a false positive costs someone an afternoon proving a
# non-bug, and a false negative reads as "this family is absent here", which is the exact reassurance
# the tool exists to withhold. Every case below is a shape taken from this suite, not an invented one.
import pytest

import blind_spots as _B_MOD
from blind_spots import DISCARDED, SWALLOWED, analyze, rank, summarize

B_FILE = _B_MOD.__file__


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
    assert analyze("class TestThing:\n    def test_x(self, tmp_path, monkeypatch):\n        pass\n", "t.py") == []


def test_a_name_read_only_inside_a_nested_closure_still_counts_as_read():
    """Over-approximating loses findings; under-approximating invents them. This must resolve toward
    silence."""
    assert (
        analyze(
            "def test_x():\n    def d(a):\n        def inner():\n            return a\n        return inner\n", "t.py"
        )
        == []
    )


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
    findings = analyze(
        """
def test_x():
    def one(a):
        pass
    def two(a, b, c):
        pass
    def three(a, **kw):
        return a
""",
        "t.py",
    )
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

_PLANT = """

def _canary_outer():
    def _canary_double(recorded, discarded_argument, **swallowed):
        return recorded
    return _canary_double
"""


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
        "stopped resolving real input rather than the file having been cleaned up"
    )


def test_a_clean_real_file_yields_nothing_so_the_canary_cannot_pass_on_noise():
    """The control for the canary above: the analyzer must not report findings for a real file whose
    doubles all record their arguments. Without this, `len(found) > 20` could be satisfied by a scanner
    that flags everything, which is just as useless as one that flags nothing."""
    clean = "\n\n".join(
        f"def test_case_{i}():\n    def double_{i}(a, b, **kw):\n        return (a, b, kw)\n" for i in range(30)
    )
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
    src = "def _helper(unused_param):\n    return 1\n\ndef test_real(monkeypatch):\n    pass\n"
    assert blind_spots.analyze(src, "t.py") == [], (
        "a module-level helper is not handed to production code — flagging it is noise, and it is "
        "what makes a report unreadable"
    )


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
    s = blind_spots.summarize(
        blind_spots.analyze(
            "def test_x():\n    def one(a, **kw):\n        return a\n    def two(b, **kw2):\n        return b\n", "t.py"
        )
    )
    assert s["swallowing"] == 2, f"two doubles swallow kwargs, not {s['swallowing']}"
    assert s["doubles"] == 2


def test_a_file_that_cannot_be_parsed_names_ITSELF_in_the_error():
    """Kills `ast.parse(source, filename=path)` → `ast.parse(source, )`.

    `analyze` deliberately raises SyntaxError to the caller rather than returning [] — its docstring
    says why: silently returning nothing would read as "no blind spots here". But the exception is
    only actionable if it names the file, and the `filename=` was asserted nowhere, so dropping it
    changed the error from `x/y.py` to `<unknown>` with every test still green. A sweep over hundreds
    of test files that cannot say WHICH one failed to parse is not much better than silence."""
    with pytest.raises(SyntaxError) as excinfo:
        analyze("def (:\n", path="tests/x_y.py")
    assert excinfo.value.filename == "tests/x_y.py", excinfo.value.filename


def test_ENCLOSURE_is_the_whole_question_and_both_ways_in_count_the_same():
    """Pins the contract `_is_double` was collapsed to (2026-10-04).

    It used to take `(depth: int, in_test_class: bool)` and return `depth > 0 or in_test_class`, so
    the integer was never a depth: only its sign mattered, and either argument could decide alone.
    Five mutants of `analyze` were unkillable because of it — `depth + 1` → `depth + 2`, and
    `False`/`True`/`None` at three call sites — none of which can change the answer for a node that
    is already enclosed. The parameters were dead structure and the gate is what measured it.

    These four cases are the collapsed contract, and each one now has a mutant behind it: flipping
    `visit(tree, False)` promotes case 1 to a double, and flipping either `visit(child, True)`
    demotes cases 2 and 3."""
    src = (
        "def helper(a, b):\n"           # 1 · top level, drops b — NOT a double
        "    return a\n"
        "def outer():\n"
        "    def inner(a, b):\n"        # 2 · nested in a function — IS a double
        "        return a\n"
        "class Helper:\n"
        "    def meth(self, a, b):\n"   # 3 · method on a helper class — IS a double
        "        return a\n"
        "def test_t(a, b):\n"           # 4 · a test function — NEVER a double
        "    return a\n"
    )
    found = {r["double"] for r in analyze(src, path="t.py")}
    assert "inner" in found, "a function nested in a function is a double"
    assert "meth" in found, "a method on a helper class is a double — the OTHER way of being enclosed"
    assert "helper" not in found, (
        "a top-level helper was reported as a double — the scan started as if already enclosed"
    )
    assert "test_t" not in found, "a test function's unused parameter is a fixture, not a dropped arg"


def test_enclosure_survives_a_statement_in_between():
    """Kills `visit(child, enclosed)` → `visit(child, None)` in the pass-through branch.

    A double is not always a direct child of the function that encloses it — put it under an `if`,
    a `with` or a `for` and the walk reaches it through the branch that forwards the flag unchanged.
    Every other test nests the double DIRECTLY, where that branch is never taken, so a mutant that
    drops the flag there changed nothing. `None` is falsy, so the inner double silently stopped being
    one: the scan would under-report exactly the doubles that sit inside a conditional helper."""
    src = "def outer():\n    if True:\n        def inner(a, b):\n            return a\n"
    found = {r["double"] for r in analyze(src, path="t.py")}
    assert "inner" in found, "a double under an `if` lost its enclosure on the way down"


# ── THE EQUIVALENCE BATTERY (tools/mutate-equivalence.json, blind_spots.py) ────────────────────────
# `visit(tree, False)` → `visit(tree, None)` survives every test. Both are falsy and `enclosed` is
# consumed only by `if _is_double(...)`, so no source can tell them apart — but that claim is worth
# recording only if the instrument can detect a difference at all, so the canaries run FIRST.
import types

from _srcscan import module_source

_BS_CANARIES = [
    ("visit(tree, False)", "visit(tree, True)", "every top-level function becomes a double"),
    ("visit(child, True)", "visit(child, False)", "nothing nested is a double any more"),
    ('if fn.name.startswith("test_")', 'if fn.name.endswith("test_")', "test functions stop being exempt"),
]
_BS_CANDIDATE = ("visit(tree, False)", "visit(tree, None)")

_BS_CORPUS = [
    "def helper(a, b):\n    return a\n",
    "def outer():\n    def inner(a, b):\n        return a\n",
    "class H:\n    def meth(self, a, b):\n        return a\n",
    "def test_t(a, b):\n    return a\n",
    "f = lambda a, b: a\n",
    "def outer():\n    if True:\n        def inner(a, b):\n            return a\n",
    "class H:\n    def m(self):\n        def deep(a, b):\n            return a\n",
    # ⚠️ AN ENCLOSED `test_*`, and the battery is wrong without it: the exemption only CHANGES an
    # answer where the node would otherwise be a double, i.e. where it is enclosed. With the test
    # function at top level, `startswith` and `endswith` both end at `return enclosed` = False and
    # the canary goes uncaught — which is how the canary rule caught this battery being too narrow
    # before it certified anything.
    "class H:\n    def test_m(self, a, b):\n        return a\n",
    "def outer():\n    def test_inner(a, b):\n        return a\n",
    "def outer(**kw):\n    return 1\n",
    "def outer():\n    def inner(**kw):\n        return 1\n",
    "",
]


def _bs_variant(before=None, after=None):
    src = module_source("blind_spots.py")
    if before is not None:
        assert src.count(before) >= 1, f"anchor {before!r} absent — the battery would test nothing"
        src = src.replace(before, after)
    mod = types.ModuleType("blind_spots_variant")
    exec(compile(src, B_FILE, "exec"), mod.__dict__)
    return mod


def _bs_observe(mod):
    out = []
    for i, src in enumerate(_BS_CORPUS):
        try:
            out.append(sorted((r["double"], r["kind"], tuple(r["discarded"])) for r in mod.analyze(src, f"t{i}.py")))
        except SyntaxError as e:  # part of the observable behaviour, and it names the file
            out.append(("SyntaxError", e.filename))
    return out


def test_the_falsy_enclosure_constant_is_unkillable_and_the_battery_can_PROVE_it():
    base = _bs_observe(_bs_variant())
    assert any(r for r in base), "the corpus found no doubles at all — it measures nothing"

    for before, after, why in _BS_CANARIES:
        assert _bs_observe(_bs_variant(before, after)) != base, (
            f"canary NOT caught ({why}) — this battery cannot detect a difference"
        )

    before, after = _BS_CANDIDATE
    assert _bs_observe(_bs_variant(before, after)) == base, (
        f"{before!r} -> {after!r} IS distinguishable — a test gap, not an equivalence"
    )
