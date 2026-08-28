# tepna-capture — tests/test_mutation_pure.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`mutation_pure.harvest_text` — which mutants get tested at all.

Both directions of a mistake here are SILENT and both corrupt the measurement: under-harvest and a
mutant is never tested and never counted (a higher kill rate over a smaller total, with nothing saying
one went missing); over-harvest and the ORIGINAL is tested as a mutant, surviving by construction and
fabricating a test gap. That is why the scan belongs inside the coverage floor."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import mutation_pure as P  # noqa: E402


def _gen(*defs):
    """A generated-mutants file, in mutmut's actual layout."""
    return "".join(f"def {n}():\n{body}\n" for n, body in defs)


def test_the_ORIGINAL_is_skipped_and_REPORTED_never_silently_dropped():
    """🔴 Over-harvest is the dangerous direction. `__mutmut_orig` IS the unmutated function, so it
    passes every test by construction and would be reported as SURVIVED — a fabricated test gap
    sending someone to write an assertion that already exists. It is excluded AND returned, because an
    exclusion the caller cannot see is one nobody can audit."""
    txt = _gen(("x_foo__mutmut_orig", "    return 1"), ("x_foo__mutmut_1", "    return 2"))
    harvested, skipped = P.harvest_text(txt, ["foo"])
    assert [n for n, _ in harvested["foo"]] == ["x_foo__mutmut_1"]
    assert skipped == ["x_foo__mutmut_orig"]


def test_a_mutant_body_ends_at_the_DEDENT_not_at_a_blank_line():
    """Under-harvest, the quiet direction. A blank line has no indentation; treating it as the end of
    the body would truncate every function with a paragraph break, and the exec'd mutant would then
    be a different function than mutmut generated — silently."""
    body = "    a = 1\n\n    return a + 1"
    txt = _gen(("x_foo__mutmut_1", body), ("x_foo__mutmut_2", "    return 9"))
    harvested, _ = P.harvest_text(txt, ["foo"])
    src = dict(harvested["foo"])["x_foo__mutmut_1"]
    assert "return a + 1" in src, "the body was cut at the blank line"
    assert "x_foo__mutmut_2" not in src, "the body ran past its own dedent into the next mutant"


def test_a_function_NOT_asked_for_is_not_harvested():
    txt = _gen(("x_foo__mutmut_1", "    return 1"), ("x_bar__mutmut_1", "    return 2"))
    harvested, _ = P.harvest_text(txt, ["foo"])
    assert [n for n, _ in harvested["foo"]] == ["x_foo__mutmut_1"]
    assert "bar" not in harvested


def test_several_requested_functions_are_kept_apart():
    txt = _gen(("x_foo__mutmut_1", "    return 1"), ("x_bar__mutmut_1", "    return 2"),
               ("x_bar__mutmut_2", "    return 3"))
    harvested, _ = P.harvest_text(txt, ["foo", "bar"])
    assert [n for n, _ in harvested["foo"]] == ["x_foo__mutmut_1"]
    assert [n for n, _ in harvested["bar"]] == ["x_bar__mutmut_1", "x_bar__mutmut_2"]


def test_an_ASYNC_mutant_is_harvested_like_any_other():
    """`DEF` accepts `async def`; mutmut generates those for async functions and dropping them would
    be a silent under-harvest confined to exactly the async code."""
    txt = "async def x_foo__mutmut_1():\n    return 1\n"
    harvested, _ = P.harvest_text(txt, ["foo"])
    assert [n for n, _ in harvested["foo"]] == ["x_foo__mutmut_1"]


def test_an_INDENTED_mutant_definition_is_harvested_and_bounded_by_its_own_indent():
    """mutmut writes at module level, but the scan is indent-relative rather than column-zero, and
    that is load-bearing: it is what lets a body end at its own dedent instead of at column 0."""
    txt = "class C:\n    def x_foo__mutmut_1(self):\n        return 1\n    def other(self):\n        return 2\n"
    harvested, _ = P.harvest_text(txt, ["foo"])
    src = dict(harvested["foo"])["x_foo__mutmut_1"]
    assert "return 1" in src and "other" not in src


def test_an_empty_file_and_an_absent_function_yield_empty_not_an_error():
    assert P.harvest_text("", ["foo"]) == ({"foo": []}, [])
    assert P.harvest_text(_gen(("x_bar__mutmut_1", "    return 1")), ["foo"]) == ({"foo": []}, [])


# ── mutants the diff-scoped gate found alive on harvest_text ────────────────────────────────────
# Nine survived, and the root cause was one habit of mine: the assertions above use `in` rather than
# `==`. A body with its newlines stripped, or one sliced from line 0 instead of the def, still
# CONTAINS the substring — so the fixture answered for the code again. These pin the exact text, with
# a target that is neither the first nor the last definition in the file.

_MULTI = (
    "def x_foo__mutmut_1():\n    return 1\n"
    "def x_bar__mutmut_1():\n    a = 1\n\n    return a\n"
    "def x_foo__mutmut_2():\n    return 2\n"
    "# trailing module content that belongs to no mutant\n"
)


def test_a_harvested_body_is_EXACTLY_its_own_source_newlines_included():
    """Kills `splitlines(keepends=True)` -> `False`/`None` and `start = n` -> `None`.

    `bar` is deliberately the MIDDLE definition: slicing from line 0 would swallow `foo`'s first
    mutant, and an `in` assertion could not tell. Dropping the line endings joins the body into one
    line, which an `in` assertion also cannot tell. Exact equality sees both."""
    harvested, _ = P.harvest_text(_MULTI, ["bar"])
    assert dict(harvested["bar"])["x_bar__mutmut_1"] == "def x_bar__mutmut_1():\n    a = 1\n\n    return a\n"


def test_the_LAST_definition_stops_at_its_own_dedent_not_at_end_of_file():
    """Kills `close(len(lines))` -> `close(None)`. `lines[start:None]` runs to EOF, which is identical
    unless something follows the last mutant — so the fixture carries a trailing module-level line."""
    harvested, _ = P.harvest_text(_MULTI, ["foo"])
    last = dict(harvested["foo"])["x_foo__mutmut_2"]
    assert last == "def x_foo__mutmut_2():\n    return 2\n"
    assert "trailing module content" not in last


def test_every_harvested_mutant_of_a_function_is_exact_and_in_file_order():
    """Kills the `cur`/`indent` sentinel swaps (`None` -> `""`, `0` -> `1`, `1` -> `2`): each corrupts
    either which lines are collected or where a body ends, and all of them survive an `in` check."""
    harvested, _ = P.harvest_text(_MULTI, ["foo"])
    assert [n for n, _ in harvested["foo"]] == ["x_foo__mutmut_1", "x_foo__mutmut_2"]
    assert [s for _, s in harvested["foo"]] == [
        "def x_foo__mutmut_1():\n    return 1\n",
        "def x_foo__mutmut_2():\n    return 2\n",
    ]


def test_a_body_indented_by_a_SINGLE_space_is_still_a_body():
    """Kills `" " * (indent + 1)` -> `(indent + 2)`. One-space indentation is legal Python and rare
    enough that no fixture had it; under the mutant the body ends immediately and the mutant source
    collapses to its `def` line, which every earlier assertion would have accepted."""
    src = "def x_foo__mutmut_1():\n return 1\n# tail\n"
    harvested, _ = P.harvest_text(src, ["foo"])
    assert dict(harvested["foo"])["x_foo__mutmut_1"] == "def x_foo__mutmut_1():\n return 1\n"
