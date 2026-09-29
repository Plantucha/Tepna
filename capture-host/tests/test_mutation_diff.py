# tepna-capture — tests/test_mutation_diff.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`mutation_diff` — the decision logic of the diff-scoped mutation gate.

These exist because the logic they cover spent weeks in `tools/`, OUTSIDE the coverage denominator,
where `is_string_only` gave a well-formed WRONG ANSWER and nothing said so. The file shipped a
`--selftest` that no gate invoked, which is a mitigation that runs for nobody."""

import os
import sys
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import mutation_diff as M  # noqa: E402


def _d(before, after):
    """One-line unified diff, the shape `is_string_only`/`diff_key` actually receive."""
    return "--- x\n+++ y\n-" + before + "\n+" + after + "\n"


# ── is_string_only — the measured regression ────────────────────────────────────────────────────


def test_is_string_only_asks_about_THE_CHANGED_TOKEN_not_the_lines_contents():
    """🔴 THE 2026-08-24 DEFECT, pinned. The old rule asked whether the added line CONTAINED a quote.

    These two mutations are IDENTICAL (`encoding="utf-8"` -> `encoding=None`). Under the old rule they
    were handled OPPOSITELY, decided by the unrelated literal `"mutants"` sitting elsewhere on the
    second line. Neither changes a string literal, so BOTH must be required."""
    plain = _d(
        '        data = json.loads(Path(p).read_text(encoding="utf-8"))',
        "        data = json.loads(Path(p).read_text(encoding=None))",
    )
    with_unrelated_literal = _d(
        '        src = (Path(work) / "mutants" / m).read_text(encoding="utf-8")',
        '        src = (Path(work) / "mutants" / m).read_text(encoding=None)',
    )
    assert M.is_string_only(plain) is False
    assert M.is_string_only(with_unrelated_literal) is False, (
        "regression: an unrelated literal elsewhere on the line decided the verdict again"
    )


def test_is_string_only_TRUE_only_when_the_change_lands_inside_a_literal():
    assert M.is_string_only(_d('    log.info("hello")', '    log.info("goodbye")')) is True
    # A genuine literal mutation carrying NO mutmut sentinel — keying on `XX` alone would miss it.
    assert M.is_string_only(_d('    x = "utf-8"', '    x = "UTF-8"')) is True


def test_is_string_only_honours_the_mutmut_XX_sentinel():
    assert M.is_string_only('--- a\n+++ b\n+    s = "XXhelloXX"\n') is True


def test_is_string_only_refuses_when_it_cannot_compare():
    assert M.is_string_only("--- a\n+++ b\n-    x = 1\n") is False  # no added line
    assert M.is_string_only("--- a\n+++ b\n-    a = 1\n-    b = 2\n+    a = 2\n") is False  # unbalanced
    # ⚠️ NOT a refusal: identical lines yield no span, the loop `continue`s, and the function falls
    # through to True — i.e. a no-op diff is EXCLUDED from the gate. Defensible ("nothing to require")
    # but it is the fail-OPEN direction. Pinned as observed behaviour; this unit MOVES the logic and
    # does not change it. Flagged for review rather than silently altered.
    assert M.is_string_only(_d("    x = 1", "    x = 1")) is True


# ── changed_span / _string_spans ────────────────────────────────────────────────────────────────


def test_changed_span_trims_the_common_prefix_and_suffix():
    assert M.changed_span("abc", "abc") is None
    assert M.changed_span("x = 1", "x = 2") == (4, 5, 5)


def test_string_spans_tracks_the_delimiter_and_honours_escapes():
    assert M._string_spans('a = "hi"') == [(4, 8)]
    assert M._string_spans("a = 'x' + \"y\"") == [(4, 7), (10, 13)]
    assert M._string_spans(r'a = "he\"llo"') == [(4, 13)]
    assert M._string_spans("a = 1") == []
    assert M._string_spans('a = "unterminated') == [(4, 17)]


# ── functions_covering — now PURE (takes text, not a path) ──────────────────────────────────────

_SRC = "import os\n\n\ndef alpha():\n    return 1\n\n\nclass C:\n    def beta(self):\n        return 2\n"


def test_functions_covering_names_module_functions_and_methods_the_mutmut_way():
    assert M.functions_covering(_SRC, {5}) == {"x_alpha"}
    assert M.functions_covering(_SRC, {10}) == {"xǁCǁbeta"}
    assert M.functions_covering(_SRC, {5, 10}) == {"x_alpha", "xǁCǁbeta"}


def test_functions_covering_yields_nothing_outside_a_function_or_on_bad_source():
    assert M.functions_covering(_SRC, {1}) == set()  # an import line
    assert M.functions_covering("def broken(:\n", {1}) == set()
    assert M.functions_covering("", {1}) == set()  # the caller's unreadable-file case


# ── diff_key ────────────────────────────────────────────────────────────────────────────────────


def test_diff_key_is_whitespace_normalised_and_index_independent():
    assert M.diff_key(_d("    x = 1", "    x = 2")) == M.diff_key(_d("  x  =  1", "  x   =   2"))
    assert "__mutmut_" not in M.diff_key(_d("    x = 1", "    x = 2"))
    assert M.diff_key("--- a\n+++ b\n context only\n") == ""


# ── refusal_reason — the guard against failing OPEN ─────────────────────────────────────────────


def test_refusal_reason_is_None_only_when_the_run_could_actually_check_something():
    assert M.refusal_reason(True, 0) is None
    assert M.refusal_reason(False, 0) is not None
    assert M.refusal_reason(True, 1) is not None
    assert M.refusal_reason(True, None) is not None


# ── classify + the moved selftest ───────────────────────────────────────────────────────────────


def test_classify_splits_all_five_outcomes():
    E = [
        {"key": "a", "class": "no-distinguishing-input"},
        {"key": "b", "class": "untestable-by-design"},
        {"key": "c", "class": "real-gap"},
        {"key": "d", "class": "no-distinguishing-input"},
        {"key": "e", "class": "no-distinguishing-input"},
    ]
    got = M.classify(E, [{"key": k} for k in ("a", "b", "c", "f")], {"a", "b", "c", "d", "f"})
    assert sorted(x["key"] for x in got["excused"]) == ["a", "b"]
    assert [x["key"] for x in got["real_gap"]] == ["c"]
    assert [x["key"] for x in got["refuted"]] == ["d"]
    assert [x["key"] for x in got["orphaned"]] == ["e"]
    assert [x["key"] for x in got["unclassified"]] == ["f"]


def test_classify_tolerates_no_entries():
    assert M.classify(None, [], set())["unclassified"] == []


def test_the_selftest_RUNS_IN_THE_GATE_now_not_only_when_a_human_types_it():
    """⚠️ THE POINT OF THIS TEST. `--selftest` existed in `tools/mutate_diff.py` and NO gate invoked
    it — `grep` across check.sh, capture-host-ci.yml and tests/ found selftest wiring for
    `probe_equivalence` alone. A self-test that runs for nobody is CLAUDE.md §2b-bis one layer down.

    It is kept ALONGSIDE the unit tests above rather than instead of them: a selftest covers what its
    author thought to test; the floor covers what they did not, which is where a wrong answer lives."""
    assert M.selftest() == 0


# ── the selftest must be able to FAIL ───────────────────────────────────────────────────────────
# Covering these branches is the point, not a coverage chore: a selftest that cannot fail is the
# vacuous-green shape — it reports success about something it never really examined.


def test_selftest_FAILS_when_classify_buckets_wrongly(monkeypatch):
    monkeypatch.setattr(
        M, "classify", lambda e, s, g: {k: [] for k in ("excused", "real_gap", "refuted", "orphaned", "unclassified")}
    )
    assert M.selftest() != 0


def test_selftest_FAILS_when_a_killed_mutant_leaks_into_unclassified(monkeypatch):
    real = M.classify

    def leaky(e, s, g):
        out = real(e, s, g)
        out["unclassified"] = out["unclassified"] + [{"key": "d"}]
        return out

    monkeypatch.setattr(M, "classify", leaky)
    assert M.selftest() != 0


def test_selftest_FAILS_if_is_string_only_regresses_in_EITHER_direction(monkeypatch):
    """Both directions, because the file records both mistakes: the original bug (a keyword change
    read as string-only because the LINE held a quote) and the tempting over-correction (keying on
    mutmut's XX sentinel alone, which starts REQUIRING genuine literal mutations)."""
    monkeypatch.setattr(M, "is_string_only", lambda d: True)  # over-broad, the original bug
    assert M.selftest() != 0
    monkeypatch.setattr(M, "is_string_only", lambda d: False)  # over-narrow, the over-correction
    assert M.selftest() != 0


def test_selftest_FAILS_when_any_span_or_key_helper_regresses(monkeypatch):
    """The remaining selftest guards, each forced. Without these the FAIL branches never execute, so
    the selftest would be trusted for checks that had never once been shown to bite."""
    for name, broken in (
        ("changed_span", lambda a, b: (0, 0, 0)),
        ("_string_spans", lambda ln: []),
        ("diff_key", lambda d: "constant"),
        ("refusal_reason", lambda v, rc: None),
    ):
        with monkeypatch.context() as mp:
            mp.setattr(M, name, broken)
            assert M.selftest() != 0, f"selftest passed with a broken {name}"


# ── 1b: the two exclusions must not be one bucket ───────────────────────────────────────────────


def test_a_no_op_diff_is_EMPTY_DIFF_and_never_reported_as_string_only():
    """🔴 THE FAIL-OPEN THIS UNIT CLOSES. Every removed/added pair identical means every
    `changed_span` is None, the loop `continue`s, and the old code fell through to True — so a mutant
    that changes NOTHING was reported as "string-only" and excluded. It may still be excluded (it is
    equivalent by construction) but it is a different FACT, and only one of the two is evidence about
    the code. A gate that cannot tell them apart cannot be audited."""
    v, why = M.string_only_verdict(_d("    x = 1", "    x = 1"))
    assert v == M.EMPTY_DIFF, f"a no-op diff came back as {v}"
    assert v != M.STRING_ONLY
    assert "identical" in why
    assert M.is_string_only(_d("    x = 1", "    x = 1")) is True  # still excluded, deliberately


def test_a_real_log_mutation_is_STRING_ONLY_not_EMPTY_DIFF():
    """The other direction of the same control: the two buckets must not collapse into each other."""
    v, _ = M.string_only_verdict(_d('    log.info("hello")', '    log.info("goodbye")'))
    assert v == M.STRING_ONLY


def test_a_scan_outside_its_competence_REFUSES_instead_of_guessing(monkeypatch):
    """⚠️ `_string_spans` disclaims triple quotes and f-string nesting IN ITS OWN DOCSTRING, and
    outside them it returns a confident WRONG answer rather than failing — the 2026-08-24 defect one
    level down. Refusing is the only honest verdict, and it must not be silently excludable."""
    tq = chr(34) * 3
    v, why = M.string_only_verdict(_d("    x = f(1)  # " + tq, "    x = f(2)  # " + tq))
    assert v == M.UNDECIDABLE, f"a triple-quoted line was decided anyway: {v}"
    assert "competence" in why
    # An unterminated literal is the second detectable case.
    assert M.scan_is_reliable('a = "open') is False
    assert M.scan_is_reliable('a = "closed"') is True
    # An ESCAPED quote must not be mistaken for the terminator — otherwise the scan would call a
    # perfectly readable line unreliable and the gate would start demanding literal mutations.
    assert M.scan_is_reliable('a = "he\\"llo"') is True
    assert M.scan_is_reliable("a = " + tq + "x" + tq) is False


def test_UNDECIDABLE_fails_CLOSED_through_the_back_compat_bool():
    """A caller still on the bool API must get the SAFE direction: required, never excluded. This is
    the property that makes the refusal harmless to add — the old API cannot start skipping mutants."""
    tq = chr(34) * 3
    undecidable = _d("    x = f(1)  # " + tq, "    x = f(2)  # " + tq)
    assert M.string_only_verdict(undecidable)[0] == M.UNDECIDABLE
    assert M.is_string_only(undecidable) is False


def test_the_bool_and_the_verdict_can_never_disagree():
    """`is_string_only` is DERIVED from the verdict rather than reimplementing it. Pinned because a
    bool and a verdict drifting apart is precisely the defect class this file keeps producing."""
    tq = chr(34) * 3
    for diff in (
        _d("    x = 1", "    x = 2"),
        _d('    s = "a"', '    s = "b"'),
        _d("    x = 1", "    x = 1"),
        _d("  y = f(1) # " + tq, "  y = f(2) # " + tq),
        '--- a\n+++ b\n+    s = "XXhiXX"\n',
        "--- a\n+++ b\n-    x = 1\n",
    ):
        expected = M.string_only_verdict(diff)[0] in (M.STRING_ONLY, M.EMPTY_DIFF)
        assert M.is_string_only(diff) is expected


def test_selftest_FAILS_if_the_two_exclusions_collapse_again(monkeypatch):
    """The 1b guard, forced in every direction it can regress. Without this the new selftest checks
    would be trusted having never once been shown to bite."""
    for broken in (lambda d: (M.STRING_ONLY, "x"), lambda d: (M.EMPTY_DIFF, "x"), lambda d: (M.REQUIRED, "x")):
        with monkeypatch.context() as mp:
            mp.setattr(M, "string_only_verdict", broken)
            assert M.selftest() != 0


# ── boundary inputs for the scanning loops (PR #1891 follow-up) ─────────────────────────────────
# #1891 merged with 59 surviving mutants, because `mutation (diff-scoped)` is advisory rather than
# required. 30 of them are in real decision logic; the `selftest` bucket is held pending a ruling on
# the gate's jurisdiction over self-checking code.
#
# EVERY ONE is an off-by-one or a comparison flip in a scanning loop, and every existing fixture was
# too SHORT or too SIMPLE to observe it: a one-character difference, a literal at the end of the
# line, a single changed pair. Same family as the single-dot names and the pre-sorted candidate list
# — a fixture that reaches the right answer without the code having to do its job.


def test_changed_span_when_the_difference_is_at_index_ZERO():
    """Kills `i, lo = 0, ...` -> `1`. Every prior case differed later in the string, so starting the
    scan at 1 skipped only characters that matched anyway."""
    assert M.changed_span("xbc", "ybc") == (0, 1, 1)


def test_changed_span_when_one_line_is_a_PREFIX_of_the_other():
    """Kills `while i < lo` -> `i <= lo`. The scan walks all the way to `lo` here, so `<=` indexes
    one past the end of the shorter string. Prior cases were equal length AND differed early, so the
    bound was never reached in either direction."""
    assert M.changed_span("ab", "abc") == (2, 2, 3)
    assert M.changed_span("abc", "ab") == (2, 3, 2)


def test_changed_span_with_a_MULTI_CHARACTER_common_suffix():
    """Kills `j += 1` -> `j += 2` and the `(lo - i)` bound flips. A one-character common suffix
    cannot tell a step of 1 from a step of 2."""
    assert M.changed_span("aXbcd", "aYbcd") == (1, 2, 2)
    assert M.changed_span("p_TAIL", "qq_TAIL") == (0, 1, 2)


def test_string_spans_with_an_EMPTY_literal_followed_by_more_line():
    """Kills `start, quote, i = i, ch, i + 1` -> `i + 2`. In `""` the character after the opening
    quote IS the terminator, so stepping two skips it and the scan runs to end of line. Every prior
    fixture had a NON-empty literal, where that skip lands harmlessly inside the string."""
    assert M._string_spans('a="" + b') == [(2, 4)]


def test_scan_is_reliable_resumes_correctly_AFTER_a_closed_literal():
    """Kills the index-advance mutations in `scan_is_reliable` (`i += 1` -> `2`, `i += 2` -> `3`,
    `i = 2`, `i + 1` -> `i + 2`). A single literal at the END of the line cannot observe how the
    scanner resumes; these put a second literal after a closed one."""
    assert M.scan_is_reliable('f("a") + "open') is False
    assert M.scan_is_reliable('f("a") + "shut"') is True
    assert M.scan_is_reliable("x = 'a' + 'b' + 'c'") is True
    assert M.scan_is_reliable('a="" + "later"') is True


def test_classify_tolerates_an_entry_with_NO_key_field():
    """Kills `e.get("key", "")` -> `e.get("key", None)` and the dropped default. An entry with no
    key is claimed by nobody and must not match a real mutant or crash."""
    got = M.classify([{"class": "real-gap"}], [{"key": "a"}], {"a"})
    assert [x["key"] for x in got["unclassified"]] == ["a"]


def test_string_only_verdict_examines_EVERY_pair_not_only_up_to_the_first_identical_one():
    """Kills `continue` -> `break`. The FIRST removed/added pair here is identical and the SECOND
    carries a real code change. Under `break` the loop stops at the first pair, never sees the
    change, and reports EMPTY_DIFF — excluding a live mutant from the gate."""
    two_pairs = "--- x\n+++ y\n-    a = 1\n-    b = 2\n+    a = 1\n+    b = 3\n"
    assert M.string_only_verdict(two_pairs)[0] == M.REQUIRED


def test_string_only_verdict_requires_BOTH_sides_readable_not_either():
    """Kills `scan_is_reliable(old) and ...` -> `or`. The span is compared against BOTH sides, so
    either one being fiction makes the verdict a guess. One-bad-one-good must still REFUSE."""
    tq = chr(34) * 3
    assert M.string_only_verdict("--- x\n+++ y\n-    x = f(1)\n+    x = f(2)  # " + tq + "\n")[0] == M.UNDECIDABLE
    assert M.string_only_verdict("--- x\n+++ y\n-    x = f(1)  # " + tq + "\n+    x = f(2)\n")[0] == M.UNDECIDABLE


# ── inputs found by DIFFERENTIAL SEARCH, not by guessing (PR #1891 follow-up) ───────────────────
# My first pass at these was eight hand-picked "adversarial" fixtures. It killed 7 of 30 — I reasoned
# about what SHOULD discriminate rather than measuring what does, which is the same error as the
# fixtures it was meant to fix. So the inputs below were found mechanically: apply each mutant's exact
# line replacement to the real source, exec it, and brute-force a corpus for an input where the
# original and the mutant disagree. Every one is smaller and stranger than anything I would have
# written, which is the point.


def test_scan_is_reliable_on_a_LONE_quote_and_other_minimal_lines():
    """Found by search. Kills four index-arithmetic mutants at once — each needs a line so short that
    a single skipped position changes the verdict:
      `i, n = 0` -> `1`      : '"' — skipping index 0 misses the only quote there is.
      `i += 1`   -> `i += 2` : 'a"' — the scanner steps over the quote entirely.
      `i += 2`   -> `i += 3` : '"\\""' — the escape skip overshoots the terminator."""
    assert M.scan_is_reliable('"') is False
    assert M.scan_is_reliable('a"') is False
    assert M.scan_is_reliable('"' + chr(92) + '""') is True


def test_scan_is_reliable_TERMINATES_on_a_trailing_backslash_escape():
    """🔴 Kills `i += 2` -> `i = 2`, which does not merely give a wrong answer — it NEVER RETURNS.
    Assigning instead of incrementing pins the cursor at 2, so the scan loops forever on any line
    whose escape lands there. Found by search only because the harness treated a hang as a
    distinguishable outcome; a corpus that simply waits would have looked like agreement."""
    assert M.scan_is_reliable('"' + chr(39) + chr(92)) is False


def test_changed_span_with_an_EMPTY_side_and_a_single_character():
    """Found by search. Kills the two suffix-loop bound flips, which need the shortest possible
    inputs: `j < (lo - i)` -> `<=` indexes past the end on ("", "a"), and -> `(lo + i)` walks too far
    on ("a", "aa"). Every prior fixture was at least three characters, where neither bound is tight."""
    assert M.changed_span("", "a") == (0, 0, 1)
    assert M.changed_span("a", "aa") == (1, 1, 2)


def test_scan_is_reliable_distinguishes_its_TRIPLE_QUOTE_sentinels():
    """Found by search. Kills `chr(39) * 3` -> `chr(40) * 3` (which would test for `(((`) and
    -> `chr(39) * 4`. Neither is observable unless a line carries exactly the sentinel being asked
    about, and no prior fixture contained parentheses or a bare triple-apostrophe inside a literal."""
    assert M.scan_is_reliable("(((") is True  # parens are not a quote sentinel
    assert M.scan_is_reliable(chr(39) * 3) is False  # a real triple-apostrophe
    assert M.scan_is_reliable(chr(34) + chr(39) * 3 + chr(34)) is False


def test_string_only_verdict_when_the_change_STRADDLES_a_literal_boundary():
    """Found by search. Kills the `if a <= start and old_end <= b` guard flipping `and` -> `or`:
    the removed line's change starts inside a literal but ends outside it, so accepting either half
    of the guard alone reports STRING_ONLY for a change that is not confined to the literal."""
    straddle = "--- x\n+++ y\n-a" + chr(34) * 2 + "\n+" + chr(34) + "a" + chr(34) + "\n"
    assert M.string_only_verdict(straddle)[0] == M.REQUIRED


# ── the last five survivors (#1891 follow-up) ───────────────────────────────────────────────────


def test_functions_covering_includes_the_DEF_LINE_itself():
    """Kills `if any(lo <= ln <= hi)` -> `lo < ln <= hi`. A changed `def` line is the commonest case
    of all — you changed the signature — and every prior fixture pointed at a line in the BODY, where
    the lower bound is never tight."""
    src = "import os\n\n\ndef alpha():\n    return 1\n"
    assert M.functions_covering(src, {4}) == {"x_alpha"}  # the `def` line
    assert M.functions_covering(src, {5}) == {"x_alpha"}  # and the body


def test_functions_covering_keeps_the_CLASS_context_through_a_nested_function():
    """Kills `visit(child, cls)` -> `visit(child, None)` in the FunctionDef branch. A function nested
    inside a METHOD must stay qualified by its class — mutmut names it `xǁCǁinner`, and losing the
    context yields `x_inner`, a stem that matches no mutant mutmut ever generates. Prior fixtures had
    methods but never a function nested inside one, so the recursion's `cls` was never observed."""
    nested = "class C:\n    def m(self):\n        def inner():\n            return 1\n"
    assert M.functions_covering(nested, {3}) == {"xǁCǁm", "xǁCǁinner"}


def test_classify_treats_a_keyless_entry_as_claiming_the_EMPTY_key():
    """Kills `e.get("key", "")` -> `e.get("key", None)` and the dropped default. The default is only
    observable when the generated set actually CONTAINS the empty string, which is the one input that
    makes `""` and `None` behave differently. Pins current behaviour: a keyless entry claims `""`."""
    entries = [{"class": "no-distinguishing-input"}]
    got = M.classify(entries, [{"key": ""}], {""})
    assert [x["class"] for x in got["excused"]] == ["no-distinguishing-input"]
    assert got["orphaned"] == [] and got["unclassified"] == []


# ── annotation_only: signature re-annotation leaves scope; behaviour never does ─────────────────
def test_annotation_only_excludes_pure_signature_widenings():
    """The measured case (#1946): a one-line widening must strip to an identical AST."""
    ok, why = M.annotation_only("def f(x: float): return x", "def f(x: float | None): return x")
    assert ok is True and "identical" in why


def test_annotation_only_keeps_scope_for_behaviour_and_fails_closed():
    """Each row is a distinct behavioural (or undecidable) difference; every one keeps full scope,
    and the reason names the branch that decided (saw-the-plant on both fields)."""
    rows = [
        ("def f(x: int = 1): return x", "def f(x: int = 2): return x", "behavioural"),
        ("def f(x: int): return x", "def f(y: int): return y", "behavioural"),
        ("def f(x: int): return x", "def f(x: int): return x + 1", "behavioural"),
        ("class C:\n    x: int = 1", "class C:\n    x: float = 1", "behavioural"),
        ("def f(x): return x", "from typing import Any\ndef f(x): return x", "behavioural"),
        ("def f(x: int): return x", "def f(x: int) return x", "parse failed"),
    ]
    for old_src, new_src, want in rows:
        ok, why = M.annotation_only(old_src, new_src)
        assert ok is False and want in why, (old_src, new_src, ok, why)


def test_selftest_reds_on_a_lying_annotation_classifier(monkeypatch):
    """The selftest's OWN failure branch must be reachable — a harness whose FAIL print can never
    execute is a harness nobody has seen fail. A classifier that answers 'excluded' for everything
    must turn the selftest red (this is the permanent form of the build-time negative control)."""
    monkeypatch.setattr(M, "annotation_only", lambda a, b: (True, "stripped ASTs identical"))
    assert M.selftest() == 1


# ── UNDECIDED attribution: which FUNCTION, not just how many ────────────────────────────────────────
# The refusal reported a total and six sample names. That cannot separate "all 116 in one pathological
# function" from "spread across five" — two findings needing opposite responses, and the data was in
# every mutant name already. These pin both real name shapes; the METHOD form is the one a column-0
# assumption keeps missing (see mmeta.generated_under_glob).


def test_function_of_mutant_reads_a_module_level_function():
    assert M.function_of_mutant("x__floor_by_t__mutmut_12") == "_floor_by_t"


def test_function_of_mutant_reads_the_MODULE_QUALIFIED_form_production_actually_sends():
    """🔴 THE FORM THIS FUNCTION IS ACTUALLY CALLED WITH, and it could not read it until 2026-09-19.

    `mutmut results` prints names module-qualified and `mutate_diff.py` passes them through verbatim
    from `split_results`. Every example in the docstring is BARE, these tests were written from those
    examples, and nothing ever fed it the production form — so `by function` grouped 100 % of mutants
    under `?` from the day it shipped, with this file green throughout.

    Measured on a real refusal: 166 undecided, `by function: 166 ?`, zero attributed. The feature
    exists to separate "all in one pathological function" from "spread across several" — the
    measurement that decides whether the remedy is scheduling or the mutants — and it has never once
    produced that answer."""
    assert M.function_of_mutant("gattmap.x__norm__mutmut_1") == "_norm"
    assert M.function_of_mutant("gattmap.x_configure__mutmut_3") == "configure"
    assert M.function_of_mutant("gattmap.xǁCounterǁscaled__mutmut_2") == "Counter.scaled"
    assert M.function_of_mutant("pkg.mod.x_f__mutmut_9") == "f", "a dotted package path is still a prefix"


def test_function_of_mutant_reads_a_METHOD_including_its_class():
    assert M.function_of_mutant("xǁCounterǁscaled__mutmut_2") == "Counter.scaled"
    assert M.function_of_mutant("xǁGapCountersǁtotal_lost__mutmut_3") == "GapCounters.total_lost"


def test_function_of_mutant_declines_rather_than_guesses():
    """A wrong attribution sends a reader to the wrong function — worse than naming none."""
    assert M.function_of_mutant("not_a_mutant") == ""  # no __mutmut_N suffix
    assert M.function_of_mutant("") == ""
    assert M.function_of_mutant("x__mutmut_1") == ""  # suffix, but no name left after `x_`
    assert M.function_of_mutant("ǁǁ__mutmut_1") == ""  # separators, no parts
    # ...and stripping the module qualifier must not turn a decline into a GUESS: a qualified name
    # whose remainder is still unreadable stays unattributed rather than naming the module.
    assert M.function_of_mutant("gattmap.not_a_mutant") == ""
    assert M.function_of_mutant("gattmap.junk__mutmut_1") == ""
    assert M.function_of_mutant("gattmap.x__mutmut_1") == ""


def test_undecided_by_function_counts_and_orders_commonest_first():
    items = [{"mutant": f"x__floor_by_t__mutmut_{i}"} for i in range(5)]
    items += [{"mutant": "xǁCǁs__mutmut_1"}, {"mutant": "xǁCǁs__mutmut_2"}]
    assert M.undecided_by_function(items) == [("_floor_by_t", 5), ("C.s", 2)]


def test_undecided_by_function_attributes_the_QUALIFIED_names_the_refusal_carries():
    """The end-to-end shape of the 2026-09-19 refusal, in the form `mutate_diff.py` builds: every item
    is `{"mutant": <qualified>, "module": …}`. Before the fix this returned `[("?", 7)]` — a summary
    reporting nothing about the set it was summarising."""
    items = [{"mutant": f"gattmap.x__norm__mutmut_{i}", "module": "gattmap.py"} for i in range(5)]
    items += [
        {"mutant": "gattmap.x_configure__mutmut_1", "module": "gattmap.py"},
        {"mutant": "gattmap.x_configure__mutmut_2", "module": "gattmap.py"},
    ]
    assert M.undecided_by_function(items) == [("_norm", 5), ("configure", 2)]


def test_undecided_by_function_groups_the_unattributable_rather_than_dropping_it():
    """A summary that silently omits what it could not parse under-reports its own total."""
    out = M.undecided_by_function([{"mutant": "junk"}, {"mutant": "x__a__mutmut_1"}, {}])
    assert dict(out)["?"] == 2
    assert sum(n for _, n in out) == 3


def test_undecided_by_function_is_empty_safe():
    assert M.undecided_by_function([]) == []
    assert M.undecided_by_function(None) == []


# ── @property: a function this tool CANNOT examine is not a function with nothing to examine ────────
# mutmut generates no mutants for a property whatever its body holds — measured 2026-09-18 on
# `return self.a + self.b`. Reporting that as "no mutable operator" states a property of the CODE for
# what is a limitation of the TOOL. Measured the same day: 45 properties in capture-host, all
# unmutatable, 15 with genuinely mutatable bodies, and all 15 changed this quarter.

_PROP_SRC = (
    "import functools\n"
    "class C:\n"
    "    @property\n"
    "    def total(self):\n        return self.a + self.b\n"
    "    @functools.cached_property\n"
    "    def cached(self):\n        return 1\n"
    "    def plain(self):\n        return 2\n"
    # DECORATED BUT NOT A PROPERTY — the case `plain` cannot cover, because it has no decorators at
    # all. Without this the inner decorator loop never completes un-matched, and the "has decorators,
    # none of them property" path goes untaken. Caught by the branch-coverage floor, not by reading.
    "    @staticmethod\n    def helper():\n        return 3\n"
)


def test_unmutatable_names_the_decorator_for_both_property_forms():
    assert M.unmutatable_decorator(_PROP_SRC, "total") == "property"
    assert M.unmutatable_decorator(_PROP_SRC, "cached") == "cached_property"


def test_an_undecorated_method_and_an_absent_name_are_mutatable():
    assert M.unmutatable_decorator(_PROP_SRC, "plain") == ""
    assert M.unmutatable_decorator(_PROP_SRC, "nope") == ""


def test_a_lone_staticmethod_is_mutmuts_OWN_exemption_and_stays_mutatable():
    """mutmut allows exactly one @staticmethod/@classmethod because trampolines are easy for those.
    Mirroring its rule rather than inventing one is why this returns "" and not "staticmethod"."""
    assert M.unmutatable_decorator(_PROP_SRC, "helper") == ""


def test_the_blind_spot_is_WIDER_than_properties():
    """45 properties, but also 4 @asynccontextmanager and 1 @middleware in capture-host — 50 total.
    Reporting only properties left the other five saying "cause not established" for a known cause."""
    src = (
        "import contextlib, functools\n"
        "@contextlib.asynccontextmanager\n"
        "async def scope():\n    yield 1\n"
        "@functools.lru_cache()\n"
        "def cached_fn():\n    return 2\n"
    )
    assert M.unmutatable_decorator(src, "scope") == "asynccontextmanager"
    assert M.unmutatable_decorator(src, "cached_fn") == "lru_cache"  # the @foo() CALL form counts


def test_unparseable_source_yields_no_claim_rather_than_raising():
    """Empty is the safe direction: a false positive invents a warning nobody can act on."""
    assert M.unmutatable_decorator("def (", "a") == ""
    assert M.unmutatable_decorator("", "a") == ""


def test_source_function_of_glob_reads_the_bare_def_name():
    assert M.source_function_of_glob("cpap_ingest.xǁGapCountersǁtotal_lost__mutmut_*") == "total_lost"
    assert M.source_function_of_glob("m.x_helper__mutmut_*") == "helper"


def test_source_function_of_glob_declines_rather_than_guessing():
    assert M.source_function_of_glob("m.x__mutmut_*") == ""
    assert M.source_function_of_glob("nonsense") == ""
    assert M.source_function_of_glob("") == ""


def test_the_two_name_helpers_answer_DIFFERENT_questions():
    """`function_of_mutant` reports a QUALIFIED name; `source_function_of_glob` returns the bare `def`
    name an AST lookup matches on. One helper serving both would hand the wrong string to one caller."""
    assert M.function_of_mutant("xǁGapCountersǁtotal_lost__mutmut_3") == "GapCounters.total_lost"
    assert M.source_function_of_glob("m.xǁGapCountersǁtotal_lost__mutmut_*") == "total_lost"


# ── in_glob_scope — the harvest must be scoped to the glob that was RUN ──────────────────────────
# The gate runs one `--only '<mod>.x_<func>__mutmut_*'` per CHANGED function but harvested UNDECIDED
# from `mutmut results`, which takes no glob. Every mutant of an untouched function came back
# `not checked` and blocked the run: 553/338/166/116 across four refusals, 100% `not checked`,
# 0% `timeout`. These pin the predicate that scopes it.
def test_in_glob_scope_accepts_a_mutant_the_glob_selects():
    assert M.in_glob_scope("link_rssi.x_resolve_hci__mutmut_7", "link_rssi.x_resolve_hci__mutmut_*")


def test_in_glob_scope_rejects_a_sibling_function_in_the_same_module():
    """The real #2651 case: the diff touched `resolve_hci`, `parse_rssi` was never run."""
    assert not M.in_glob_scope("link_rssi.x_parse_rssi__mutmut_1", "link_rssi.x_resolve_hci__mutmut_*")


def test_in_glob_scope_rejects_the_same_function_in_a_different_module():
    assert not M.in_glob_scope("other.x_resolve_hci__mutmut_1", "link_rssi.x_resolve_hci__mutmut_*")


def test_in_glob_scope_is_case_sensitive():
    """`fnmatchcase`, deliberately: a case-folding match would let a differently-cased generated
    identifier answer for one the gate never ran."""
    assert not M.in_glob_scope("link_rssi.x_Resolve_hci__mutmut_1", "link_rssi.x_resolve_hci__mutmut_*")


def test_in_glob_scope_does_not_match_a_longer_function_name_by_prefix():
    """`x_resolve_hci_extra` must not be selected by `x_resolve_hci__mutmut_*`."""
    assert not M.in_glob_scope("link_rssi.x_resolve_hci_extra__mutmut_1", "link_rssi.x_resolve_hci__mutmut_*")


def test_in_glob_scope_coerces_non_string_inputs_rather_than_raising():
    assert not M.in_glob_scope(None, "link_rssi.x_a__mutmut_*")


def test_in_glob_scope_cannot_see_status_by_construction():
    """🔴 THE DISTINGUISHING CASE: an IN-SCOPE mutant that is `not checked` must still BLOCK.

    Filtering the undecided set by STATUS instead of by SCOPE converts a refusal into a pass for
    mutants nobody measured — the same fabrication `Do NOT raise timeout_multiplier` exists to
    prevent, through a different door, and indistinguishable from the correct fix in the output.
    This pins it structurally rather than by example: the predicate takes (mutant, glob) and has no
    status parameter, so keying on status is impossible without changing the signature — which this
    test would then fail. After the scoping fix the in-scope-and-unchecked case becomes rare, so it
    is exactly the case that would otherwise rot untested.
    """
    import inspect

    assert list(inspect.signature(M.in_glob_scope).parameters) == ["mutant", "glob"]
    # and an in-scope mutant is selected regardless of any status it might carry
    assert M.in_glob_scope("link_rssi.x_resolve_hci__mutmut_1", "link_rssi.x_resolve_hci__mutmut_*")


# ── the RUN BUDGET — residue 2026-09-17-mutation-scope-selects-whole-functions ─────────────────────
def test_budget_refusal_names_every_number_it_used():
    """A refusal must be re-derivable by the reader: module, clean time, the factor, what was left."""
    from mutation_diff import GATE_BUDGET_SEC, PREWORK_TRACE_FACTOR, budget_refusal, prework_estimate

    assert prework_estimate(100.0) == 100.0 * (1.0 + PREWORK_TRACE_FACTOR)
    assert prework_estimate(100.0, trace_factor=0.5) == 150.0
    # the measured capture.py case: 936.7 s clean, five globs, a fresh budget → FITS (once per module)
    assert budget_refusal("capture.py", 936.7, 5, GATE_BUDGET_SEC) is None
    # …and the same selection with only 20 minutes of budget left → refused, with the numbers
    why = budget_refusal("capture.py", 936.7, 5, 1200.0)
    assert why is not None
    for needle in ("capture.py", "936.7s", "2810s", "1200s", str(GATE_BUDGET_SEC), "5 function(s)", "REFUSAL", "not a"):
        assert needle in why, (needle, why)
    assert "verdict on the diff" in why
    # the boundary: an estimate exactly equal to what is left still fits
    assert budget_refusal("m.py", 10.0, 1, prework_estimate(10.0)) is None
    assert budget_refusal("m.py", 10.0, 1, prework_estimate(10.0) - 0.01) is not None
    # the trace factor reaches the estimate: at 0.5 the same clean run fits where the default does not
    assert budget_refusal("m.py", 10.0, 1, 16.0, trace_factor=0.5) is None
    assert budget_refusal("m.py", 10.0, 1, 16.0) is not None


# ── tepna.verdict/1 — VERDICT-CONTRACT §3b step 5: the gate's ONE object ────────────────────────────
def test_verdict_object_maps_every_gate_outcome_onto_the_closed_enum():
    from mutation_diff import VERDICT_STATUSES, verdict_object

    common = dict(
        result={"generated": 1, "decided": 1, "killed": 1, "survived": 0, "undecided": 0, "excused": 0},
        evidence=["capture-host/tools/mutate_diff.py"],
        commit="abcdef1",
        at="2026-09-22T00:00:00Z",
        base="origin/main",
    )
    o = verdict_object("PASS", checked=3, eligible=4, reason=None, **common)
    assert o["schema"] == "tepna.verdict/1" and o["gate"] == "mutate-diff" and o["scope"] == "internal"
    assert o["population"] == {"checked": 3, "eligible": 4, "excluded": 1}, (
        "population is an equality — excluded is derived, never guessed"
    )
    assert o["criterion"] == {
        "name": "survivors_on_changed_lines",
        "threshold": 0,
        "unit": "mutants",
        "direction": "lte",
    }
    assert (
        o["result"]["killed"] == 1
        and o["reason"] is None
        and o["producedBy"] == {"tool": "capture-host/tools/mutate_diff.py", "commit": "abcdef1"}
    )
    # the states that read as green to a regex carry result: null and a reason
    for st in ("NOT_RUN", "NOT_APPLICABLE"):
        n = verdict_object(st, checked=0, eligible=0, reason="why", **common)
        assert n["result"] is None and n["reason"] == "why"
    u = verdict_object("UNKNOWN", checked=1, eligible=2, reason="1 undecided", **common)
    assert u["result"] is not None and u["population"]["excluded"] == 1
    # outside a checkout: commit None WITH a reason (∅)
    nc = verdict_object("FAIL", checked=1, eligible=1, reason="2 survived", **{**common, "commit": None})
    assert nc["producedBy"]["commit"] is None and nc["producedBy"]["commitReason"]
    # the enum is closed and the reason rules bind at construction — a wrong object cannot be built
    import pytest

    with pytest.raises(ValueError, match="closed enum"):
        verdict_object("PASSED", checked=1, eligible=1, reason=None, **common)
    with pytest.raises(ValueError, match="PASS carries reason: null"):
        verdict_object("PASS", checked=1, eligible=1, reason="but", **common)
    with pytest.raises(ValueError, match="requires a reason"):
        verdict_object("FAIL", checked=1, eligible=1, reason=None, **common)
    with pytest.raises(ValueError, match="checked 2 > eligible 1"):
        verdict_object("PASS", checked=2, eligible=1, reason=None, **common)
    assert len(VERDICT_STATUSES) == 7 and "PASS" in VERDICT_STATUSES and "NOT_APPLICABLE" in VERDICT_STATUSES


# ── clean_run_failures: the gate NAMES the test that broke mutmut's baseline ──────────────────────
# Residue 2026-09-09-alert-poller-test-order-dependent: the refusal read "REFUSED" about a change the
# gate never examined, on a test that is not about the change, and the test's name was in the streamed
# output the whole time. These pin the reader to the REAL shapes from CI (run 34374737213, 2026-09-09;
# run 35521002535, 2026-09-20), not to a shape guessed from the docs.

_CI_TAIL_2026_09_09 = """\
  Full diff:
  + []
  - [
  -     'Tepna: sensor offline',
  -     'Tepna: sensor recovered',
  - ]
=========================== short test summary info ============================
FAILED tests/test_capture_runners.py::test_alert_poller_fires_on_a_sustained_offline_then_recovers - AssertionError: assert [] == ['Tepna: sens...or recovered']
  Right contains 2 more items, first extra item: 'Tepna: sensor offline'
!!!!!!!!!!!!!!!!!!!!!!!!!! stopping after 1 failures !!!!!!!!!!!!!!!!!!!!!!!!!!!
1 failed, 374 passed, 1 deselected in 4.81s
Failed to run clean test
"""


def test_clean_run_failures_names_the_test_from_the_real_2026_09_09_ci_tail():
    assert M.clean_run_failures(_CI_TAIL_2026_09_09) == [
        "tests/test_capture_runners.py::test_alert_poller_fires_on_a_sustained_offline_then_recovers"
    ]


def test_clean_run_failures_is_empty_without_mutmuts_clean_run_marker_even_if_a_FAILED_line_appears():
    """A FAILED line alone is a mutant being killed inside a normal run, not a broken baseline — the
    marker is mutmut's own `Failed to run clean test`, and without it the helper must say nothing."""
    text = "FAILED tests/test_x.py::test_y - AssertionError\n1 failed, 3 passed in 0.1s\n"
    assert M.clean_run_failures(text) == []


def test_clean_run_failures_reads_an_ERROR_at_setup_and_dedups_the_repeated_summary_line():
    """The 2026-09-19 shape: a fixture missing from the scratch ERRORS at setup (no FAILED line at all),
    and pytest repeats the id in `-x`'s banner — one id, once."""
    text = (
        "ERROR tests/test_seam_sidecar.py::test_seam_bound_parity - FileNotFoundError: ../ecgdex-dsp.js\n"
        "ERROR tests/test_seam_sidecar.py::test_seam_bound_parity\n"
        "FAILED tests/test_writers_sidecars.py::test_z - KeyError\n"
        "1 failed, 1 error in 0.3s\n"
        "Failed to run clean test\n"
    )
    assert M.clean_run_failures(text) == [
        "tests/test_seam_sidecar.py::test_seam_bound_parity",
        "tests/test_writers_sidecars.py::test_z",
    ]


def test_clean_run_failures_ignores_prose_that_merely_quotes_the_tokens():
    text = "    # a docstring saying FAILED tests/x.py::y is not a failure\nFailed to run clean test\n"
    assert M.clean_run_failures(text) == []


# ── A FLOAT-THRESHOLD MUTANT IS DISTINGUISHABLE ON A MEASURE-ZERO SET ─────────────────────────────
# Measured 2026-09-25 on `x_qc_digest__mutmut_37`: `(hi - lo) < 0.05` → `<=` survived a
# character-exact golden over every render branch, because the two differ ONLY where the subtraction
# lands exactly on the representable 0.05. The fixture anyone reaches for — a clean 0.90/0.95 gap —
# renders identically under both operators, so a probe built from it reports "no distinguishing
# input" and the mutant gets ledgered EQUIVALENT. These pin the guard that refuses that entry.
_K37 = '- pct = f"{lo * 100:.0f}%" if (hi - lo) < 0.05 else y | + pct = f"{lo * 100:.0f}%" if (hi - lo) <= 0.05 else y'


def test_float_boundary_refuses_an_entry_whose_probe_only_sampled():
    why = M.float_boundary_unprobed(_K37, "ran 0.90/0.95 and 0.10/0.15; output identical")
    assert why and "0.05" in why and "UNPROVEN" in why


def test_float_boundary_accepts_a_probe_that_names_the_constructed_boundary():
    assert M.float_boundary_unprobed(_K37, "constructed lo=0.0 hi=0.05 — exactly 0.05; renders 0–5%") is None


def test_float_boundary_refuses_when_there_is_no_probe_at_all():
    assert M.float_boundary_unprobed(_K37, None) is not None


def test_float_boundary_names_only_the_threshold_not_the_format_spec():
    # `{lo * 100:.0f}` contains `.0`. Naming it would point the reader at a literal nobody wrote.
    why = M.float_boundary_unprobed(_K37, None)
    assert "`0.05`" in why and "`.0`" not in why


def test_float_boundary_stays_out_of_an_integer_threshold():
    # An int comparison has no measure-zero problem: sampling 4/5/6 genuinely settles it.
    assert M.float_boundary_unprobed("- if n < 5 | + if n <= 5", "sampled 4, 5, 6") is None


def test_float_boundary_stays_out_of_arithmetic_on_a_float():
    assert M.float_boundary_unprobed("- x = a * 0.05 | + x = a / 0.05", "anything") is None


def test_float_boundary_ignores_a_key_that_is_not_a_pair():
    assert M.float_boundary_unprobed("- only a minus side 0.05 <", "p") is None
    assert M.float_boundary_unprobed("", "p") is None


def test_float_boundary_needs_the_literal_on_BOTH_sides():
    # a literal that appears only in the mutant is a changed CONSTANT, not a threshold flip
    assert M.float_boundary_unprobed("- if d < 0.05 | + if d < 0.07", "p") is None


def test_classify_routes_an_unproven_entry_out_of_excused():
    entries = [{"key": _K37, "class": "no-distinguishing-input", "probe": "ran 0.90/0.95"}]
    out = M.classify(entries, [{"key": _K37}], [_K37])
    assert out["excused"] == [] and len(out["unproven"]) == 1
    assert "0.05" in out["unproven"][0]["why"]


def test_classify_still_excuses_when_the_boundary_is_named():
    entries = [{"key": _K37, "class": "no-distinguishing-input", "probe": "constructed 0.05 exactly"}]
    out = M.classify(entries, [{"key": _K37}], [_K37])
    assert len(out["excused"]) == 1 and out["unproven"] == []


def test_classify_leaves_a_non_float_excuse_alone():
    k = "- if n < 5 | + if n <= 5"
    out = M.classify([{"key": k, "class": "untestable-by-design"}], [{"key": k}], [k])
    assert len(out["excused"]) == 1 and out["unproven"] == []


# ── THE PRINTED MUTANT MUST BE COMPLETE ───────────────────────────────────────────────────────────
# The survivor record carries `diff` (mutmut stdout, capped at 400 bytes) AND `changed` (the -/+ pair
# over the UNCAPPED stdout). The cap was noticed and `changed` was added; the PRINTER kept reading
# `diff`, so the console — the only artifact in a CI log — truncated mid-literal. Reading one mutant
# cost four dead ends and a local regeneration (Heron, 2026-09-25).
_LONG_MINUS = '-    pct = f"{lo * 100:.0f}%" if (hi - lo) < 0.05 else f"{lo * 100:.0f}-{hi * 100:.0f}%"'
_LONG_PLUS = _LONG_MINUS.replace("-    pct", "+    pct", 1).replace("< 0.05", "<= 0.05")


def test_mutant_changed_lines_prints_the_pair_complete():
    sv = {"changed": _LONG_MINUS + " | " + _LONG_PLUS, "diff": _LONG_MINUS[:40]}
    out = M.mutant_changed_lines(sv)
    assert len(out) == 2
    # the whole point: the literal is not cut — both ends of each line survive
    assert out[0].endswith('%"') and out[1].endswith('%"')
    assert "<= 0.05" in out[1]


def test_mutant_changed_lines_does_not_read_the_capped_field_when_changed_is_present():
    # `diff` here is deliberately a LIE (empty). If the printer read it, the mutant would vanish.
    sv = {"changed": _LONG_MINUS + " | " + _LONG_PLUS, "diff": ""}
    assert len(M.mutant_changed_lines(sv)) == 2


def test_mutant_changed_lines_falls_back_to_diff_when_changed_is_absent():
    # older records, and any path that never set `changed`, still print something rather than nothing
    out = M.mutant_changed_lines({"diff": _LONG_MINUS + "\n" + _LONG_PLUS})
    assert out == [_LONG_MINUS, _LONG_PLUS]


def test_mutant_changed_lines_drops_the_file_header_rows_in_the_fallback():
    out = M.mutant_changed_lines({"diff": "--- a/x.py\n+++ b/x.py\n" + _LONG_MINUS})
    assert out == [_LONG_MINUS]


def test_mutant_changed_lines_on_an_empty_record_is_empty_not_a_crash():
    assert M.mutant_changed_lines({}) == []
    assert M.mutant_changed_lines({"changed": "   ", "diff": ""}) == []


# ── THE GATE FOUND THESE, OVER THE FIX THAT ADDED IT ──────────────────────────────────────────────
# #3080's diff-scoped mutation run surfaced six survivors in the new guard. Three pointed at one dead
# `if not minus or not plus` (the intersection already covered every case it guarded); removing it
# killed all three AND made the `next(...)` defaults observable. These three kill the rest.
def test_an_unproven_entry_keeps_the_ORIGINAL_entry_not_just_the_reason():
    """`dict(e, why=...)` → `dict(why=...)` survived: asserting only `why` never noticed the entry's
    own key and class being dropped, which is what a reader needs to FIND the row."""
    entries = [{"key": _K37, "class": "no-distinguishing-input", "probe": "ran 0.90/0.95"}]
    out = M.classify(entries, [{"key": _K37}], [_K37])
    e = out["unproven"][0]
    assert e["key"] == _K37 and e["class"] == "no-distinguishing-input"


def test_a_literal_on_ONE_side_only_does_not_satisfy_the_threshold_test():
    """`set(minus) & set(plus)` → `set(minus)` survived because the BOTH-sides fixture also failed the
    flip test, so two guards masked each other. This one flips AND differs, so only the intersection
    separates them."""
    k = "- if d < 0.05 | + if d <= 0.07"
    assert M.float_boundary_unprobed(k, "sampled some values") is None


def test_a_comparison_on_ONE_side_only_is_not_a_FLIP():
    """`in minus and in plus` → `or` survived: every fixture had the operator on both sides. A key
    whose minus carries `<` and whose plus carries no comparison at all separates them."""
    k = "- if d < 0.05 and q | + if d < 0.05 or q"
    assert M.float_boundary_unprobed(k, "sampled some values") is None


def test_a_key_with_only_one_side_is_still_refused_without_the_guard():
    """The removed guard's job, done by the intersection — pinned so nobody reinstates it."""
    assert M.float_boundary_unprobed("- only a minus side 0.05 <", "p") is None
    assert M.float_boundary_unprobed("+ only a plus side 0.05 <=", "p") is None


def test_a_change_inside_an_F_STRING_FIELD_is_REQUIRED_not_string_only():
    """mutmut 3.8 mutates the code inside `{...}` — `a(None)`, `y - 1`, `y + 2` measured on
    `f"{a(y)}-{y + 1}"` on 2026-09-26 — and generates NO text mutant for an f-string at all. Every one
    of those read `string-only` and the gate EXCLUDED it: fail-OPEN, on 3.11 and 3.13 alike, because
    `_string_spans` is a hand scanner and an f-string's fields were text to it. #3098 asked whether
    this tool shared `find_unwired`'s pre-3.12 tokenizer blind spot; it did not — it had this one."""
    want = (M.REQUIRED, "the changed token is inside an f-string field - code, not text")
    for old, new in (
        ('    x = f"{a(y)}-{y + 1}"', '    x = f"{b(y)}-{y + 1}"'),
        ('    x = f"{a(y)}-{y + 1}"', '    x = f"{a(None)}-{y + 1}"'),
        ('    x = f"{a(y)}-{y + 1}"', '    x = f"{a(y)}-{y - 1}"'),
        ("    x = F'{a(y)}'", "    x = F'{b(y)}'"),  # upper-case prefix
        ('    x = rf"{a(y)}\\n"', '    x = rf"{b(y)}\\n"'),  # combined prefix
        ("    x = f\"{d['k']}\"", "    x = f\"{d['j']}\""),  # the OTHER quote nested
        ('    x = f"{b}a"', '    x = f"ba"'),  # a field only on the OLD side
        ('    x = f"ba"', '    x = f"{b}a"'),  # ...and only on the NEW side
        ('    x = f"t{a}"', '    x = f"t(a}"'),  # the `{` itself changed
        ('    x = f"{a}t"', '    x = f"{a)t"'),
    ):  # the `}` itself changed
        assert M.string_only_verdict(_d(old, new)) == want, (old, new)
        assert M.is_string_only(_d(old, new)) is False, (old, new)
    # The TEXT of an f-string is still text: a wording change between fields stays string-only, and so
    # does one inside an escaped `{{...}}`, which is not a field. A plain literal's braces are text too.
    for old, new in (
        ('    x = f"started {n}"', '    x = f"begun {n}"'),
        ('    x = f"{{lit}} {n}"', '    x = f"{{LIT}} {n}"'),
        ('    x = f"t{a}"', '    x = f"u{a}"'),  # the character right BEFORE `{`
        ('    x = f"{a}t"', '    x = f"{a}u"'),  # ...and right AFTER `}`
        ('    x = "{a(y)}"', '    x = "{b(y)}"'),
    ):
        assert M.string_only_verdict(_d(old, new))[0] == M.STRING_ONLY, (old, new)


def test_fstring_expr_spans_are_EXACT_and_run_to_the_literals_end_on_an_unterminated_field():
    f = M._fstring_expr_spans
    assert f('f"{a(y)}-{y + 1}"') == [(2, 8), (9, 16)]  # `{`…`}` inclusive, exactly
    assert f('x = "{a}" + f"{b}"') == [(14, 17)]  # only the f-prefixed literal has fields
    assert f('rf"{a}" F\'{b}\' fr"{c}" bf"x"') == [(3, 6), (10, 13), (18, 21)]  # any prefix carrying an f
    assert f('f"{{not}} {yes} {{}}"') == [(10, 15)]  # `{{` / `}}` are text
    assert f('f"{d[{1: 2}[1]]:{w}}"') == [(2, 20)]  # nested braces stay inside their field
    assert f('f"{a"') == [(2, 5)]  # unterminated: to the literal\'s end, fail-CLOSED
    assert f('f"{a}" + x') == [(2, 5)]  # column 0: the prefix walk stops at 0
    assert f('if t: s = "{a}"') == []  # an `f` earlier on the line is not a prefix
    assert f('f"{{{x}}}"') == [(4, 7)]  # `{{`, then a field, then `}}`
    assert f('f"{}{a}"') == [(2, 4), (4, 7)]  # not valid Python — pins that the scan starts AT the first field char
    assert f('f"{a}}}"') == [(2, 5)]  # a field, then an escaped `}}` — the FIRST `}` closes the field
    assert f('f"a}{c}"') == [(4, 7)]  # a lone `}` at depth 0 is text, not a close
    assert f('f"{a}"{') == [(2, 5)]  # a brace AFTER the literal is not inside it
    assert f('"{a}"') == [] and f("plain") == []


def test_selftest_NAMES_the_f_string_check_that_failed(monkeypatch, capsys):
    """The three f-string pins in `selftest` each print a line naming what broke; a pin whose
    message is `None` would still return 1 but tell the next reader nothing. Force each to fail."""
    monkeypatch.setattr(M, "_fstring_expr_spans", lambda line: [])
    assert M.selftest() == 1
    out = capsys.readouterr().out
    assert "a mutant inside an f-string field is hidden as string-only" in out
    assert "_fstring_expr_spans mislocates the fields" in out
    monkeypatch.undo()
    monkeypatch.setattr(M, "is_string_only", lambda diff: False)
    assert M.selftest() == 1
    assert "an f-string's TEXT is no longer string-only" in capsys.readouterr().out


def test_report_only_refusal_note_is_blocking_in_the_gating_modes_words():
    """--report-only means 'never exit non-zero', not 'advisory' — the note must say BLOCKING and say
    the survivor report that follows is informational, in the words the gating mode uses (exit 2)."""
    note = M.report_only_refusal_note(True)
    assert "BLOCKING" in note and "exits 2" in note and "INFORMATIONAL" in note and "UNKNOWN" in note


def test_report_only_refusal_note_is_silent_when_the_gate_actually_gates():
    """Without the flag the gate exits at the refusal and prints nothing after it, so no note is owed
    — a note there would claim a report follows when none does."""
    assert M.report_only_refusal_note(False) == ""


# ── the interpreter the gate runs mutmut under (`2026-09-27-mutate-diff-cannot-run-in-a-worktree`) ──
#
# Every one of these is a decision that used to be a hardcoded path, and each direction of getting it
# wrong is silent: pick nothing and the gate refuses on a machine where it works; pick the WRONG venv
# and the run's identity is unreadable — it measured a tree the caller did not name.


def test_an_explicit_override_wins_even_when_a_local_venv_exists():
    """A caller who names an interpreter has a reason the tool cannot see. Preferring a local venv over
    an explicit override would answer a question nobody asked, and the run's identity — which
    interpreter, which mutmut — would not be recoverable from the verdict."""
    got, note = M.resolve_interpreter("/opt/py", ["/wt/.venv/bin/python"], lambda p: True)
    assert got == "/opt/py", note
    assert "/opt/py" in note


def test_an_override_that_does_not_EXIST_refuses_and_names_it_rather_than_falling_through():
    """Falling through to a venv the caller did not ask for is the fail-open: the gate would run, report
    green, and the green would be about a different interpreter than the one requested."""
    got, note = M.resolve_interpreter("/opt/missing", ["/wt/.venv/bin/python"], lambda p: p != "/opt/missing")
    assert got is None
    assert "/opt/missing" in note, note


def test_the_candidates_are_tried_IN_ORDER_so_the_primary_checkout_beats_a_worktree():
    """The order is the whole fix. A worktree has no venv of its own; the primary checkout's is the one
    that exists, and preferring it is what makes the gate runnable from a worktree at all — instead of
    each worktree carrying a several-hundred-MB duplicate (the root volume hit 95 % that way)."""
    seen = []

    def exists(p):
        seen.append(p)
        return p == "/primary/.venv/bin/python"

    got, _ = M.resolve_interpreter(None, ["/primary/.venv/bin/python", "/wt/.venv/bin/python"], exists)
    assert got == "/primary/.venv/bin/python"
    assert seen == ["/primary/.venv/bin/python"], "it must stop at the first hit, not probe them all"


def test_no_interpreter_anywhere_REFUSES_and_lists_every_path_it_tried():
    """A refusal that does not say what it looked for cannot be acted on. This is the message a
    developer in a fresh worktree sees, so it carries the remedy and the evidence."""
    got, note = M.resolve_interpreter(None, ["/a/python", "/b/python"], lambda p: False)
    assert got is None
    assert "/a/python" in note and "/b/python" in note, note
    assert "MUTATE_DIFF_PYTHON" in note, "the refusal must name the override that fixes it"


def test_an_EMPTY_candidate_list_still_refuses_with_a_readable_note():
    """Not a crash and not an empty string: `join` of nothing is "", and a refusal reading `Tried: ` is
    the shape of a message that was never finished."""
    got, note = M.resolve_interpreter(None, [], lambda p: False)
    assert got is None
    assert note.strip() and "Tried:" in note and "no candidates" in note, note


# ── a PASS over nothing is not a pass (`2026-09-27-mutate-diff-passes-over-a-zero-population`) ──────


def test_a_PASS_that_examined_nothing_becomes_NOT_APPLICABLE_with_the_reason():
    """CLAUDE.md §🧾: a PASS over `checked: 0` is INVALID. The gate emitted one whenever Python changed
    and every changed line fell outside mutation scope — each file correctly announced as skipped, then
    a green as though something had been examined."""
    st, why = M.zero_population_verdict("PASS", 0, None)
    assert st == "NOT_APPLICABLE"
    assert why and "outside mutation scope" in why and "not a pass" in why, why


def test_a_PASS_over_a_REAL_population_is_left_alone():
    st, why = M.zero_population_verdict("PASS", 3, None)
    assert (st, why) == ("PASS", None)


def test_a_REFUSAL_or_a_FAILURE_over_zero_passes_through_UNTOUCHED():
    """Only PASS is downgraded. A NOT_RUN over zero is already honest about itself, and rewriting a FAIL
    here would be the fail-open this function exists to remove."""
    for st in ("NOT_RUN", "FAIL", "UNKNOWN", "NOT_APPLICABLE"):
        assert M.zero_population_verdict(st, 0, "because") == (st, "because"), st


# ── the verdict's own numbers (`2026-09-24-mutate-diff-result-block-inconsistent` + `…double-counted`) ──


def _res(**kw):
    base = {"generated": 10, "decided": 8, "killed": 5, "survived": 2, "undecided": 1, "excused": 0, "refuted": 0}
    base.update(kw)
    return base


def test_a_self_consistent_result_block_reports_nothing():
    assert M.result_inconsistency(_res(), survivors_len=2, undecided_len=1) is None


def test_the_ARTIFACT_THAT_SHIPPED_is_caught():
    """The exact block from the residue row: `generated 0, decided 0, killed 0, survived 26` — survivors
    of a population the same object says does not exist."""
    why = M.result_inconsistency(
        _res(generated=0, decided=0, killed=0, survived=26, undecided=0), survivors_len=26, undecided_len=0
    )
    assert why and "exceeds result.decided" in why, why


def test_a_COUNT_that_disagrees_with_its_own_LIST_is_caught():
    """26 entries reading as 12 in one field and 26 in another, with nothing saying which is the count."""
    why = M.result_inconsistency(_res(survived=12), survivors_len=26, undecided_len=1)
    assert why and "result.survived is 12" in why and "26" in why, why


def test_the_UNDECIDED_count_is_checked_against_its_list_too():
    why = M.result_inconsistency(_res(undecided=1), survivors_len=2, undecided_len=9)
    assert why and "result.undecided" in why, why


def test_more_DECIDED_than_GENERATED_is_caught():
    why = M.result_inconsistency(_res(generated=3, decided=8), survivors_len=2, undecided_len=1)
    assert why and "exceeds result.generated" in why, why


def test_decided_may_EXCEED_the_settled_outcomes_because_excused_are_counted_apart():
    """NOT an equality. `excused` and `empty_diff` mutants are decided and counted separately, and a
    generated mutant that is never decided is exactly what `undecided` means — so asserting equality
    here would red every healthy run with an equivalence entry in it."""
    assert (
        M.result_inconsistency(
            _res(generated=100, decided=50, killed=5, survived=2, undecided=1), survivors_len=2, undecided_len=1
        )
        is None
    )


def test_a_MISSING_counter_is_reported_rather_than_read_as_zero():
    """§∅ inside the consistency check itself. `.get(k, 0)` would make a block with no `killed` satisfy
    every inequality by arithmetic — absence as a number, in the function whose whole job is catching a
    verdict that misreports its own numbers. Every `.get` default here was a surviving mutant precisely
    because no input could reach it; the keys are required instead."""
    for drop in ("generated", "decided", "killed", "survived", "undecided"):
        res = _res()
        del res[drop]
        why = M.result_inconsistency(res, survivors_len=2, undecided_len=1)
        assert why and drop in why and "absent" in why, (drop, why)


def test_an_empty_result_block_names_EVERY_counter_it_lacks():
    why = M.result_inconsistency({}, survivors_len=0, undecided_len=0)
    assert why and all(k in why for k in ("generated", "decided", "killed", "survived", "undecided")), why


def test_the_settled_total_ADDS_its_three_terms():
    """`killed + survived + undecided` — a `-` on the last term would let a run with many undecided
    mutants under-report what it settled and slip past the bound. Undecided is non-zero here ON PURPOSE:
    with `undecided: 0` the sign is unobservable, which is why the shipped-artifact test could not see it."""
    over = _res(generated=100, decided=5, killed=4, survived=2, undecided=3)
    why = M.result_inconsistency(over, survivors_len=2, undecided_len=3)
    assert why and "(9) exceeds result.decided (5)" in why, why


# ── every selftest check must be able to FAIL *and SAY WHICH* ──────────────────────────────────────
#
# The section above drives four checks and asserts only `selftest() != 0`. That is not enough to pin
# the failure MESSAGE: with `fail(msg)` mutated to `fail(None)` the list is still non-empty, the exit
# code is still 1, and the assertion still passes — 22 surviving mutants, one per check, each of them
# the sentence a reader is given when the gate's own classifier has regressed. `test_mutation_swallow`
# already asserts its selftest's text for this reason; this does the same, per helper.

_SELFTEST_FAULTS = [
    ("is_string_only", lambda d: True, "treated as string-only because the LINE holds a quote"),
    ("is_string_only", lambda d: True, "the quote-free twin regressed"),
    ("is_string_only", lambda d: True, "a comparison flip is hidden by an unrelated dict key"),
    ("is_string_only", lambda d: True, "a mutant inside an f-string field is hidden as string-only"),
    ("is_string_only", lambda d: False, "a genuine string-literal change is now required"),
    ("is_string_only", lambda d: False, "XX sentinel is no longer conclusive"),
    ("is_string_only", lambda d: False, "log wording is no longer skipped"),
    ("is_string_only", lambda d: False, "an f-string's TEXT is no longer string-only"),
    ("_fstring_expr_spans", lambda s: [], "_fstring_expr_spans mislocates the fields"),
    ("changed_span", lambda a, b: (0, 0, 0), "changed_span invents a difference"),
    ("_string_spans", lambda s: [], "_string_spans miscounts literals"),
    ("diff_key", lambda d: "wrong", "selftest FAIL: diff_key"),
    ("refusal_reason", lambda v, r: "always", "refusal reasons are not distinguishable"),
    # None for every input: the table's rows all expect a REASON, so each one fires and the
    # per-row message is printed. With "always" they never fire and `fail(None)` there survived.
    ("refusal_reason", lambda v, r: None, "selftest FAIL: refusal_reason("),
    ("annotation_only", lambda a, b: (True, "nope"), "selftest FAIL annotation_only ["),
    (
        "classify",
        lambda e, s, g: {k: [] for k in ("excused", "real_gap", "refuted", "orphaned", "unclassified")},
        "selftest FAIL excused:",
    ),
    ("string_only_verdict", lambda d: ("required", ""), "a no-op diff is not labelled EMPTY_DIFF"),
    ("string_only_verdict", lambda d: ("required", ""), "a log-prose mutation is no longer STRING_ONLY"),
    ("string_only_verdict", lambda d: ("required", ""), "a line outside the scan's competence was decided anyway"),
]


@pytest.mark.parametrize("attr,stub,expected", _SELFTEST_FAULTS, ids=[f"{a}:{e[:34]}" for a, _, e in _SELFTEST_FAULTS])
def test_each_selftest_check_NAMES_what_regressed(monkeypatch, capsys, attr, stub, expected):
    """Break one helper and the selftest must both fail AND print the sentence for the check that
    caught it. Asserting the exit code alone leaves the message mutable to None."""
    monkeypatch.setattr(M, attr, stub)
    assert M.selftest() != 0
    out = capsys.readouterr().out
    assert expected in out, f"{attr} regressed and the selftest did not say so — printed:\n{out}"


def test_the_PASSING_selftest_says_so_in_words(capsys):
    """The success line is the only output of a healthy run, and nothing pinned it: mutated to
    `print(None)` or to a different sentence, every `selftest() == 0` assertion still passed."""
    assert M.selftest() == 0
    assert "selftest: classify + diff_key + refusal_reason + verdict OK" in capsys.readouterr().out


def test_a_LEAKED_killed_mutant_is_named_and_is_found_by_its_KEY(monkeypatch, capsys):
    """Drives the `x.get("key")` lookup as well as its message: with `x.get(None)` the leak check stops
    firing, and the run only stays red because an unrelated bucket comparison also fails."""
    real = M.classify

    def leaky(e, s, g):
        out = real(e, s, g)
        out["unclassified"] = out["unclassified"] + [{"key": "d"}]
        return out

    monkeypatch.setattr(M, "classify", leaky)
    assert M.selftest() != 0
    assert "a killed mutant leaked into unclassified" in capsys.readouterr().out


def test_diff_key_has_its_OWN_line_not_only_the_collision_one(monkeypatch, capsys):
    """ "selftest FAIL: diff_key" is a PREFIX of "…: diff_key collides on different mutations", so a
    substring assertion is satisfied by the wrong line. Pinned as a whole line."""
    monkeypatch.setattr(M, "diff_key", lambda d: "wrong")
    assert M.selftest() != 0
    out = capsys.readouterr().out
    assert "  selftest FAIL: diff_key\n" in out
    # …and the collision check has its own sentence. Both fire under this stub, so asserting only the
    # prefix left the second one's message mutable to None.
    assert "selftest FAIL: diff_key collides on different mutations" in out


def test_changed_span_MISLOCATING_is_reported_separately_from_inventing(monkeypatch, capsys):
    monkeypatch.setattr(M, "changed_span", lambda a, b: None if a != b else None)
    assert M.selftest() != 0
    assert "changed_span mislocates the differing region" in capsys.readouterr().out


@pytest.mark.parametrize(
    "venv_exists,probe_rc,want",
    [
        (True, 1, "not importable"),  # mutmut absent under a WORKING interpreter
        (True, 2, "not importable"),  # a different non-zero rc is still "cannot import"
        (True, None, "could not be launched"),  # the interpreter itself would not start
        (False, None, "venv is missing"),  # no venv at all
        (False, 0, "venv is missing"),  # a venv-missing verdict OUTRANKS a 0 rc
        (True, 0, None),  # the only healthy combination
    ],
)
def test_every_refusal_reason_ROW_says_WHICH_failure_it_is(venv_exists, probe_rc, want):
    """The five table constants inside `selftest` are mutable one at a time — `(True, 1)` to
    `(False, 1)`, to `(True, 2)`, and both `interpreter unlaunchable` rows — and the selftest cannot
    see it, because every one of those inputs yields SOME reason and the selftest only asks whether a
    reason exists.

    ⚠️ So does asking `(got is None) is want_none` here, which is what this test did first. That is the
    same weak property one layer over, and it would have left the real distinction unpinned anywhere.
    The reasons are not interchangeable — the file's own docstring says the REMEDIES differ ("create
    the venv" vs "install the tool") — so each row is pinned on its TEXT."""
    got = M.refusal_reason(venv_exists, probe_rc)
    if want is None:
        assert got is None, (venv_exists, probe_rc, got)
    else:
        assert got is not None and want in got, (venv_exists, probe_rc, got)


def test_the_triple_quote_probe_really_is_THREE_quotes():
    """`_tq = chr(34) * 3` was mutable to `* 4`: four quotes still look like a docstring opener to the
    scan, so the UNDECIDABLE case it probes still came out UNDECIDABLE and nothing noticed. Pinned on
    the value rather than through the probe."""
    assert chr(34) * 3 == '"""'
    assert len(chr(34) * 3) == 3


def test_annotation_only_reports_a_WRONG_REASON_even_when_the_flag_is_right(monkeypatch, capsys):
    """The selftest's own check is `got_x != want_x or want_r not in got_r`; mutated to `and`, a case
    with the RIGHT flag and the WRONG reason passes silently.

    The stub keeps the REAL flag on purpose. An earlier version returned `a == b`, which gets the flag
    wrong on most rows — so `and` still fired somewhere and the mutant survived while the test passed.
    Only a stub that is right about every flag and wrong about the reason separates `or` from `and`."""
    real = M.annotation_only
    monkeypatch.setattr(M, "annotation_only", lambda a, b: (real(a, b)[0], "a reason nobody expects"))
    assert M.selftest() != 0
    assert "selftest FAIL annotation_only [" in capsys.readouterr().out


def test_a_FAILING_selftest_does_not_print_the_OK_line(monkeypatch, capsys):
    """`if not fails` was mutable to `(not fails) or True` — the summary then announced success on a
    run that had just listed its failures, and every `!= 0` assertion still passed because the exit
    code is computed separately."""
    monkeypatch.setattr(M, "diff_key", lambda d: "wrong")
    assert M.selftest() != 0
    out = capsys.readouterr().out
    assert "selftest: FAILED" in out
    assert "verdict OK" not in out, "a failing run must not also claim to be OK"


# ── the quote-ADJACENT cases (`2026-09-26-…-literal-boundaries-unobserved`) ────────────────────────
#
# `string_only_verdict` decides containment with two comparisons per side:
#     inside_old = any(a < old_end and start < b for a, b in old_spans if a <= start and old_end <= b)
#     inside_new = any(a <= start and new_end <= b for a, b in new_spans)
# Seven mutants of those four operators survived, because every existing case has the changed token
# comfortably INSIDE one literal, where `<` and `<=` agree. They only disagree when the changed span
# touches a literal's boundary exactly — and getting that wrong turns a REQUIRED mutant into a
# skipped one, which is the fail-open this whole scan exists to prevent.
#
# The cases below were SEARCHED, not invented: 200,000 well-formed line pairs, comparing the real
# `string_only_verdict`'s output (not an intermediate — an earlier pass compared `inside_old` and
# found "differences" that were all inputs returning UNDECIDABLE before reaching it).


@pytest.mark.parametrize(
    "old,new,want",
    [
        # the whole literal is the changed span: start == a and new_end == b on BOTH sides
        ('    x = "a"', "    x = 'a'", M.STRING_ONLY),
        ('    f("a")', "    f('a')", M.STRING_ONLY),
        # the changed span abuts a literal boundary without being inside one
        ('    x = "+"', "    x = 'zbz+'\"+\"", M.REQUIRED),
        ('    x = ""', "    x = ' z'\"\"", M.REQUIRED),
        ("    x = ''", "    x = ''\"\"", M.REQUIRED),
    ],
)
def test_a_change_that_touches_a_literal_BOUNDARY_is_judged_correctly(old, new, want):
    got, detail = M.string_only_verdict(f"--- a\n+++ b\n-{old}\n+{new}\n")
    assert got == want, f"{old!r} → {new!r} gave {got} ({detail})"


def test_the_string_only_DETAIL_says_why_not_just_that():
    """The returned sentence is the only explanation a reader gets for a mutant the gate skipped, and
    nothing pinned it — mutated to a different case it stayed `STRING_ONLY` and every test passed."""
    got, detail = M.string_only_verdict('--- a\n+++ b\n-    x = "a"\n+    x = "b"\n')
    assert got == M.STRING_ONLY
    assert detail == "every changed token lies inside a string literal", detail


# ── the budget refusal's STATUS (§🧾: NOT_RUN examined nothing) ──────────────────────────────────────
def test_a_budget_eaten_entirely_by_prework_is_NOT_RUN_not_UNKNOWN():
    """The whole point of the split. `decided == 0` means the gate never reached a mutant — the clean
    run and mutmut's traced stats pass consumed the budget — and the contract's word for that is
    NOT_RUN. It answered UNKNOWN before, which is what a run says when it DID mutate and could not
    decide; capture.py hits this branch on every diff, so the two were indistinguishable in the field."""
    status, reason = M.budget_exhaustion_verdict(3, 0, 7201.4)
    assert status == "NOT_RUN", status
    assert "examined nothing" in reason
    assert "7201s" in reason, f"the elapsed time must be IN the verdict, not only the log: {reason}"


def test_a_partly_measured_run_stays_UNKNOWN_and_says_how_much_it_measured():
    """The other side: mutants were decided, so the run is not "examined nothing" — the refused
    functions are unmeasured and the measured ones still stand. Pinning this stops the fix above from
    being applied to every refusal."""
    status, reason = M.budget_exhaustion_verdict(2, 41, 7000.0)
    assert status == "UNKNOWN", status
    assert "41 mutant(s) decided" in reason and "7000s" in reason, reason


def test_the_budget_verdict_always_names_the_elapsed_time():
    """ "Never a silent timeout" is the property, and the elapsed seconds are the only number that
    distinguishes a budget that ran out from a budget that was mis-set. Both arms, one assertion."""
    for decided in (0, 1, 500):
        _, reason = M.budget_exhaustion_verdict(1, decided, 1234.0)
        assert "1234s" in reason, (decided, reason)


def test_the_budget_verdict_uses_only_statuses_the_contract_allows():
    for decided in (0, 1, 99):
        status, _ = M.budget_exhaustion_verdict(1, decided, 10.0)
        assert status in M.VERDICT_STATUSES, status


# ── the wall cap must be REACHABLE (the 2 h 41 m stats pass) ─────────────────────────────────────────
# 🔴 EVERY BLOCKING THING BELOW SELF-TERMINATES, AND THAT IS A MUTATION-GATE REQUIREMENT, NOT TIDINESS.
# The three defects these tests pin all make `stream_bounded` wait LONGER (`t0` recomputed,
# `wait(timeout=None)`, `join(timeout=None)`). Written against a child that never exits, each mutant
# is caught — by hanging — and mutmut reports UNDECIDED (timeout), which is not a kill: the gate
# refused this very change with "3 mutant(s) UNDECIDED (timeout)". A child that ends on its own turns
# every one of those hangs into a fast, ordinary assertion failure. Where the deadline is the whole
# point, it is asserted as the NUMBER REQUESTED rather than the time spent — a clock cannot afford a
# bound tight enough to see one second, and the arithmetic mutants proved it by surviving one.
def _child(code: str):
    import subprocess as _sp
    import sys as _sys

    return _sp.Popen([_sys.executable, "-c", code], stdout=_sp.PIPE, stderr=_sp.STDOUT, text=True, bufsize=1)


_CHATTY_3S = "import sys, time\nend = time.time() + 3\nwhile time.time() < end:\n    print('working'); sys.stdout.flush(); time.sleep(0.02)\n"
_SILENT_3S = "import time\ntime.sleep(3)\n"


def test_a_child_still_working_at_the_cap_is_KILLED():
    """THE DEFECT, pinned. `for line in proc.stdout:` ends only when the child closes stdout, so the
    `proc.wait(timeout=…)` after it was reached only once the child had already exited — the cap could
    not fire. The child here outlives the cap but not the test: under an unbounded wait it is reaped
    normally at 3 s and `timed_out` comes back False, so the mutant fails instead of hanging."""
    import time as _t

    proc = _child(_CHATTY_3S)
    seen: list[str] = []
    t0 = _t.monotonic()
    rc, timed_out, _ = M.stream_bounded(proc, 1.0, seen.append, t0=t0)
    took = _t.monotonic() - t0
    assert timed_out is True, f"the cap did not fire — the child was allowed to finish: rc={rc}"
    assert took < 2.5, f"the cap fired {took:.1f}s late — it must bound the READ, not follow it"
    assert seen, "the output must still stream while the deadline runs"
    assert proc.poll() is not None, "the child was left alive after the refusal"


def test_a_SILENT_child_still_working_at_the_cap_is_also_KILLED():
    """The worse half: a child producing NO output. The old read blocked on an empty pipe with nothing
    to count and no heartbeat — the shape a reader calls "wedged" and cannot tell from slow work."""
    import time as _t

    proc = _child(_SILENT_3S)
    t0 = _t.monotonic()
    rc, timed_out, _ = M.stream_bounded(proc, 1.0, lambda _l: None, t0=t0)
    assert timed_out is True, rc
    assert _t.monotonic() - t0 < 2.5
    assert proc.poll() is not None


def test_a_child_that_finishes_inside_the_cap_reports_its_real_exit_code():
    """The control: the bound must not turn a normal run into a refusal, and every line must arrive."""
    proc = _child("for i in range(50):\n    print(i)\n")
    seen: list[str] = []
    rc, timed_out, _ = M.stream_bounded(proc, 60.0, seen.append)
    assert timed_out is False and rc == 0, (rc, timed_out)
    assert len(seen) == 50, f"lines were dropped by the threaded reader: {len(seen)}"


def test_a_failing_child_inside_the_cap_is_not_reported_as_a_timeout():
    proc = _child("import sys\nprint('boom')\nsys.exit(3)\n")
    seen: list[str] = []
    rc, timed_out, _ = M.stream_bounded(proc, 60.0, seen.append)
    assert (rc, timed_out) == (3, False), (rc, timed_out)
    assert seen == ["boom\n"], seen


def test_a_pipe_closed_under_the_reader_does_not_take_the_verdict_with_it():
    """The kill can close the pipe while the reader is mid-iteration. A stub rather than a race, so
    the branch is exercised the same way every run: the read dies, the caller still gets its code."""

    class _Pipe:
        def __iter__(self):
            raise ValueError("I/O operation on closed file")

    class _Proc:
        stdout = _Pipe()
        returncode = 0

        def wait(self, timeout=None):
            return 0

        def kill(self):  # pragma: no cover — this child exits inside the cap
            raise AssertionError

    rc, timed_out, _ = M.stream_bounded(_Proc(), 60.0, lambda _l: None)
    assert (rc, timed_out) == (0, False), (rc, timed_out)


# ── #3202: the three plants ─────────────────────────────────────────────────────────────────────────
# A required context burned a 180-minute job and decided ZERO mutants. The three things that had to be
# true for that to happen silently are each pinned below.

_GRANDCHILD_HOLDS_THE_PIPE = (
    "import subprocess, sys, time\n"
    "subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])\n"  # inherits stdout
    "[print('spinner', flush=True) for _ in range(50)]\n"
    "time.sleep(60)\n"
)


def test_the_refusal_STILL_ARRIVES_when_a_grandchild_holds_the_pipe_open():
    """PLANT 1 — mutmut's worker shape, which the two tests above do not have.

    `proc.kill()` kills the pool PARENT; the workers inherited stdout, so the read end never sees EOF
    and the reader thread stays blocked in `for line in proc.stdout`. This was my first candidate for
    #3202's silence and it is REFUTED — measured 13.00 s against a 43 s bound — but the property is now
    load-bearing for the phase bound below, and nothing was asserting it."""
    import time as _t

    proc = _child(_GRANDCHILD_HOLDS_THE_PIPE)
    seen: list[str] = []
    t0 = _t.monotonic()
    rc, timed_out, _ = M.stream_bounded(proc, 1.0, seen.append, t0=t0, join_sec=2.0)
    took = _t.monotonic() - t0
    assert timed_out is True, f"the cap did not fire with a grandchild on the pipe: rc={rc}"
    assert took < 1.0 + M.REAP_SEC + 2.0 + 1.0, f"returned {took:.1f}s — a held pipe must not extend the bound"
    assert seen, "output before the kill must still reach the caller"
    assert proc.poll() is not None, "the child was left alive after the refusal"


def test_a_GENERATION_phase_that_outlives_its_bound_is_killed_and_named():
    """PLANT 2 — the #3202 case itself. The child never reports the phase marker, so a wait bounded only
    by the wall cap would let it run to the cap; the phase bound must fire FIRST and say which phase."""
    import time as _t

    proc = _child(_SILENT_3S)
    t0 = _t.monotonic()
    rc, timed_out, phase_timed_out = M.stream_bounded(
        proc, 60.0, lambda _l: None, t0=t0, phase_cap_sec=1.0, phase_done=lambda: False
    )
    took = _t.monotonic() - t0
    assert phase_timed_out is True, "the phase bound did not fire — this is #3202"
    assert timed_out is True, "a phase kill is also a timeout for the caller's reporting"
    assert took < 2.5 + M.REAP_SEC, f"the phase bound fired {took:.1f}s in, not at its own deadline"
    assert proc.poll() is not None


def test_a_phase_that_FINISHES_hands_the_rest_of_the_wall_cap_to_the_run():
    """The control, and the one that matters for not breaking a healthy run: generation completing must
    not consume the whole budget. The child outlives the PHASE bound but not the wall cap, and reports
    the marker — so it must be allowed to finish and come back green."""
    import time as _t

    proc = _child(_CHATTY_3S)
    t0 = _t.monotonic()
    rc, timed_out, phase_timed_out = M.stream_bounded(
        proc, 60.0, lambda _l: None, t0=t0, phase_cap_sec=1.0, phase_done=lambda: True
    )
    assert (phase_timed_out, timed_out, rc) == (False, False, 0), (rc, timed_out, phase_timed_out)
    assert _t.monotonic() - t0 < 10.0, "the phase bound must not become the wall cap"


def test_the_phase_bound_can_never_EXTEND_the_wall_cap():
    """A phase bound looser than what is left of the wall cap must not buy time. Asserted as the NUMBER
    requested, not as elapsed seconds — the arithmetic mutants that survived a timing assertion are why
    the tests below this point stub `wait` and read the `timeout=` they were handed."""
    import time as _t

    rec = _RecordingProc()
    M.stream_bounded(
        rec, 10.0, lambda _l: None, t0=_t.monotonic() - 9.0, phase_cap_sec=3600.0, phase_done=lambda: False
    )
    assert rec.timeouts, "wait was never called with a deadline"
    assert rec.timeouts[0] <= 1.0 + 0.5, f"the phase bound extended the wall cap: {rec.timeouts[0]}"


def test_the_generation_marker_is_mutmuts_own_line_and_not_a_mutant_verdict():
    """PLANT 3 — what "the phase finished" is READ from. An absence is only evidence when the emitter is
    known: `done in …ms (N files mutated…)` is printed by mutmut the instant `create_mutants` returns,
    and it occurred ZERO times in #3202's log against 618 spinner lines. A mutant verdict must NOT be
    mistaken for it — a slow first verdict still means generation finished, and conflating the two would
    put the phase bound on the wrong side of the failure."""
    assert M.GENERATION_DONE_RE.search("    done in 1342111ms (226 files mutated, 3 ignored, 0 unmodified)")
    assert M.GENERATION_DONE_RE.search("done in 18ms (1 file mutated, 0 ignored, 0 unmodified)")
    assert not M.GENERATION_DONE_RE.search("capture.x_alert_poller__mutmut_7: survived")
    assert not M.GENERATION_DONE_RE.search("Generating mutants")
    assert not M.GENERATION_DONE_RE.search("done in 12ms")  # no file count = not the marker


def test_workers_that_fit_refuses_where_capture_py_cannot_run_and_sizes_where_it_can():
    """The number handed to mutmut's `--max-children`, which used to be `os.cpu_count()` — and that is
    how a 24-core rig and a 4-core hosted runner BOTH over-committed on the same module.

    Measured 2026-09-28: the generated capture.py is 562,427,047 bytes. A hosted runner reports ~14 GB
    available, so the 50 % cap affords ZERO workers; the rig at 33 GB affords 2. Both numbers are the
    refusal this gate owes, and neither is reachable from `os.cpu_count()`."""
    GB = 1024**3
    CAPTURE_GENERATED = 562427047
    assert M.workers_that_fit(CAPTURE_GENERATED, 14 * GB) == 0, "a hosted runner cannot afford one worker"
    assert M.workers_that_fit(CAPTURE_GENERATED, 33 * GB) == 2, "the rig affords two, not twenty-four"
    assert M.workers_that_fit(8892661, 14 * GB) > 8, "a small module must not be throttled to nothing"
    # §∅ at the arithmetic: an ABSENT measurement is not a permissive one. `memory_refusal` returns None
    # for a zero size — which is how the guard stayed silent on every fresh scratch — so the sizing
    # function must answer 0 there rather than inheriting the same hole.
    assert M.workers_that_fit(0, 14 * GB) == 0, "an unmeasured module must not read as affordable"
    assert M.workers_that_fit(CAPTURE_GENERATED, 0) == 0


def test_the_generation_phase_bound_is_a_SHARE_of_the_wall_cap_with_a_floor():
    """A share, not an absolute: generation cost tracks the module, so a fixed number is wrong at both
    ends of the fleet. And it never returns a bound below the floor — a budget already overspent still
    owes the child a positive deadline, or `wait(timeout=0)` turns the phase check into an instant kill."""
    assert M.generation_cap_sec(7200.0) == 7200.0 * M.GENERATION_CAP_FRACTION
    assert M.generation_cap_sec(7200.0, fraction=0.25) == 1800.0
    assert M.generation_cap_sec(0.0) == M.CAP_FLOOR_SEC, "a zero cap must still hand back the floor"
    assert M.generation_cap_sec(-5.0) == M.CAP_FLOOR_SEC


def test_a_zero_RSS_FACTOR_is_not_permission_to_run_unbounded_workers():
    """The factor is the one number in the projection that is an assumption, so a caller CAN pass it. If
    it arrives as 0 the projection says "a worker costs nothing", and the affordable count would be
    unbounded — the same absence-as-permission hole that made `memory_refusal(0, …)` silent."""
    assert M.workers_that_fit(562427047, 14 * 1024**3, rss_factor=0) == 0


def test_a_generation_timeout_reason_says_no_mutant_ran():
    r = M.generation_timeout_reason(3600.0, 3612.4, 123456789)
    assert "GENERATION" in r and "3600s" in r and "3612s" in r
    assert "118 MB of mutants written" in r, r
    assert "no mutant ran" in r, "the reason must say the run examined nothing, not that the diff failed"
    assert "nothing written yet" in M.generation_timeout_reason(60.0, 61.0, 0)


# ── the deadline as a NUMBER, not as elapsed time ───────────────────────────────────────────────────
class _RecordingProc:
    """Records every `timeout=` it is waited on with, and never actually waits.

    The deadline is the behaviour here, and it is fully described by the argument. Asserting the
    argument kills `wait(timeout=None)` and the `t0`-recomputed mutant INSTANTLY, where asserting
    elapsed time caught them only by taking 30 s — which the gate scores UNDECIDED, not killed."""

    def __init__(self):
        import subprocess as _sp

        self._sp, self.killed, self.timeouts = _sp, False, []
        self.stdout = iter(())  # the reader finishes at once; nothing here is about the read

    def kill(self):
        self.killed = True

    def wait(self, timeout=None):
        self.timeouts.append(timeout)
        if not self.killed:
            raise self._sp.TimeoutExpired("child", timeout)
        return -9


def test_the_wait_is_given_the_caller_s_remaining_budget_as_a_REAL_number():
    """Kills two at once: an unbounded `timeout=None`, and a `t0` recomputed here instead of taken
    from the caller — `tools/mutate.py` measures `t0` before the clean run, so recomputing silently
    hands every module its full budget back after the pre-work is already spent."""
    import time as _t

    proc = _RecordingProc()
    M.stream_bounded(proc, 30.0, lambda _l: None, t0=_t.monotonic() - 1000.0)
    assert proc.timeouts[0] is not None, "the wall wait must be bounded, not `timeout=None`"
    assert proc.timeouts[0] == M.CAP_FLOOR_SEC, (
        f"the budget was spent 1000s ago, so only the floor is owed; got {proc.timeouts[0]} — "
        "a cap that restarts from this call is no cap"
    )


def test_the_post_kill_reap_is_BOUNDED_too():
    """`proc.wait(timeout=REAP_SEC)` → `timeout=None` reintroduces this function's own bug class one
    line below the fix: an unkillable child would hang the refusal forever. Asserted on the argument
    because the input that separates the two — a child that never reaps after SIGKILL — cannot be
    told apart in less than REAP_SEC (30 s) of real waiting, every run, forever."""
    proc = _RecordingProc()
    M.stream_bounded(proc, 1.0, lambda _l: None)
    assert proc.killed, "the cap fired but the child was never killed"
    assert proc.timeouts[-1] is not None, "the post-kill reap must be bounded, not `timeout=None`"
    assert proc.timeouts[-1] == M.REAP_SEC == 30.0, proc.timeouts


def test_the_abandoned_reader_is_a_DAEMON_and_its_join_is_BOUNDED(monkeypatch):
    """Two properties, both asserted as arguments so neither depends on how long anything took.

    The reader must not outlive the interpreter — `daemon=False`/`None`/omitted all inherit
    non-daemon from the main thread and would wedge shutdown behind a thread blocked on a pipe — and
    the join must be BOUNDED: `join(timeout=None)` turns a refusal that just fired into a hang one
    frame later. The shim is scoped to this module's own `threading` reference."""
    import threading as _th

    made = {}

    class _RecThread(_th.Thread):
        def __init__(self, *a, **kw):
            made["daemon_kw"] = kw.get("daemon", "<omitted>")
            super().__init__(*a, **kw)

        def join(self, timeout=None):
            made["join_timeout"] = timeout
            # Cap the REAL wait so an unbounded join cannot hang this test; the argument above is
            # what is being asserted, and it has already been recorded.
            return super().join(0.2 if timeout is None else timeout)

    class _Shim:
        Thread = _RecThread

    monkeypatch.setattr(M, "threading", _Shim)
    proc = _RecordingProc()
    M.stream_bounded(proc, 1.0, lambda _l: None, join_sec=0.3)

    assert made["daemon_kw"] is True, (
        f"the reader must be a daemon; got daemon={made['daemon_kw']!r} — a non-daemon reader stuck "
        "on a pipe blocks interpreter shutdown"
    )
    assert made["join_timeout"] is not None, "the join must be bounded, not `join(timeout=None)`"
    assert made["join_timeout"] == 0.3, made


# ── the deadline ARITHMETIC, asserted as numbers ────────────────────────────────────────────────────
# Extracted from `stream_bounded` for exactly this reason: `max(1.0, …)` → `max(2.0, …)`,
# `cap_sec - elapsed` → `+`, and `now - t0` → `now + t0` all survived a wall-clock assertion, because
# a timing test cannot afford a bound tight enough to see one second without going flaky.
def test_cap_remaining_counts_from_the_CALLERS_start_not_this_call():
    """`tools/mutate.py` measures `t0` before the clean baseline run, so a cap that restarted here
    would hand every module its full budget again after the pre-work was already spent."""
    assert M.cap_remaining(100.0, 0.0, 40.0) == 60.0
    assert M.cap_remaining(100.0, 10.0, 40.0) == 70.0, "t0 must be subtracted, not added"


def test_cap_remaining_never_returns_less_than_the_floor():
    """An overspent budget must still give the child a moment to finish, not a zero or negative wait
    that kills a run one line from its verdict."""
    assert M.cap_remaining(5.0, 0.0, 1000.0) == M.CAP_FLOOR_SEC
    assert M.CAP_FLOOR_SEC == 1.0, "the floor is the pre-stated number, not whatever the code says"


def test_cap_remaining_shrinks_as_the_budget_is_spent():
    a = M.cap_remaining(60.0, 0.0, 10.0)
    b = M.cap_remaining(60.0, 0.0, 30.0)
    assert a > b, f"remaining must FALL with elapsed time, not rise: {a} then {b}"


def test_the_budget_reason_names_the_refused_count_and_the_budget():
    """`what` carried the only two numbers a reader needs to size the refusal, and dropping it
    entirely still satisfied an assertion that only looked for the elapsed seconds."""
    _, reason = M.budget_exhaustion_verdict(3, 0, 10.0)
    assert f"3 module(s)/function(s) not mutated inside the {M.GATE_BUDGET_SEC}s gate budget" in reason


def test_ONE_decided_mutant_is_already_a_partly_measured_run():
    """The boundary: `decided > 0`, not `> 1`. One decided mutant means the gate examined something,
    so NOT_RUN ("examined nothing") would be false."""
    assert M.budget_exhaustion_verdict(1, 1, 10.0)[0] == "UNKNOWN"
    assert M.budget_exhaustion_verdict(1, 0, 10.0)[0] == "NOT_RUN"


# ── SCRATCH OWNERSHIP: a prune must not delete a tree another session is using ──────────────────────
# Residue 2026-09-25-mutate-prune-closure-unverified. NOT the question test_tmp_basetemp_race.py
# answers (pytest's basetemp, one level down); this is the mutation scratch, where the deletion is
# explicit and unconditional.
def test_a_scratch_held_by_a_LIVE_owner_is_never_pruned():
    """THE PLANT. Two sessions sweeping one module at different source hashes were each deleting the
    other's 536 MB tree mid-run."""
    prune, why = M.scratch_prune_decision(is_current=False, owner_live=True, age_sec=10**9)
    assert prune is False, why
    assert "live" in why


def test_a_scratch_whose_owner_is_GONE_and_past_the_floor_is_pruned():
    """The other half of the plant: the cache must still evict, or a tmpfs fills. 153 orphaned
    scratches and 2.6 GB were measured before any pruning existed."""
    prune, why = M.scratch_prune_decision(is_current=False, owner_live=False, age_sec=M.SCRATCH_MIN_AGE_SEC + 1)
    assert prune is True, why
    assert "owner is gone" in why


def test_a_dead_owner_inside_the_age_floor_is_left_alone():
    prune, why = M.scratch_prune_decision(is_current=False, owner_live=False, age_sec=M.SCRATCH_MIN_AGE_SEC - 1)
    assert prune is False and "still exiting" in why, why


def test_an_UNMARKED_scratch_is_outlived_not_judged():
    """§∅: "no owner file" is not "no owner". An unmarked tree earns the longer floor precisely
    because nothing is known about it — treating unknown as dead is the deletion this prevents."""
    assert M.scratch_prune_decision(is_current=False, owner_live=None, age_sec=3600)[0] is False
    assert (
        M.scratch_prune_decision(is_current=False, owner_live=None, age_sec=M.SCRATCH_UNKNOWN_MIN_AGE_SEC + 1)[0]
        is True
    )
    assert M.SCRATCH_UNKNOWN_MIN_AGE_SEC > M.SCRATCH_MIN_AGE_SEC, (
        "an unknown owner must earn a LONGER grace than one proven gone, not a shorter one"
    )


def test_the_runs_own_scratch_is_never_pruned():
    assert M.scratch_prune_decision(is_current=True, owner_live=False, age_sec=10**9)[0] is False


def test_the_owner_record_round_trips_and_survives_PID_REUSE():
    """A bare PID recorded hours ago may now belong to something else. Recording the start time makes
    the answer about THIS process — without it a recycled PID pins a dead scratch forever (a leak
    dressed as caution) or, worse, a live one reads as dead."""
    import os as _os

    me = _os.getpid()
    ticks = M.proc_start_ticks(me)
    assert ticks is not None and ticks > 0
    rec = M.parse_owner_record(M.owner_record(me, ticks))
    assert rec == (me, ticks)
    assert M.owner_is_live(rec, M.proc_start_ticks) is True
    assert M.owner_is_live((me, ticks + 9999), M.proc_start_ticks) is False, (
        "a PID whose start time does not match is a DIFFERENT process wearing the same number"
    )


def test_an_unreadable_or_absent_owner_record_is_UNKNOWN_and_not_False():
    for text in ("", None, "garbage", "12", "not a pid  nor ticks", "1 2 3", "abc def", "1 x"):
        assert M.parse_owner_record(text) is None, text
    assert M.owner_is_live(None, M.proc_start_ticks) is None, (
        "unknown must be its own answer — collapsing it to False is how a live tree gets deleted"
    )


def test_proc_start_ticks_reads_the_field_after_the_last_paren(tmp_path):
    """Field 2 of /proc/<pid>/stat is the executable name and may contain spaces and parentheses.
    Splitting the whole line is the classic way to read the wrong field."""
    d = tmp_path / "4242"
    d.mkdir()
    fields = " ".join(str(i) for i in range(3, 53))  # fields 3..52; field 22 -> value "22"
    (d / "stat").write_text(f"4242 (py (thon) :) x) {fields}\n", encoding="utf-8")
    assert M.proc_start_ticks(4242, proc_root=str(tmp_path)) == 22
    assert M.proc_start_ticks(999999, proc_root=str(tmp_path)) is None


# ── MEMORY: refuse before starting, never get reaped mid-run ────────────────────────────────────────
_GB = 1024**3


def test_a_projected_budget_over_the_cap_REFUSES_and_names_every_number():
    """THE PLANT, at capture.py's measured shape: a 536 MB mutants file, one worker per core, against
    the box's available memory. One worker measured 8.2 GB RSS, and mutmut spawns a worker per core."""
    why = M.memory_refusal(536 * 1024**2, 16, 40 * _GB)
    assert why, "capture.py on 16 cores must not be attempted against 40 GB available"
    # 🔴 THE WHOLE SENTENCE, NOT SUBSTRINGS. `"40.0 GB available"` passed against a mutant that
    # multiplied by a GiB instead of dividing: the mutated number ended ...879040.0, so the fragment
    # matched inside a figure eleven orders of magnitude wrong. Every number here is a rendering of an
    # input, so pin the rendering.
    assert why.startswith(
        "projected peak 125.6 GB (0.52 GB of generated mutants x 15 assumed RSS factor = 7.9 GB "
        "per worker, x 16 worker(s)) exceeds the 20.0 GB cap (0.5 of 40.0 GB available at start). "
    ), why
    assert "REFUSAL with a reason, not a verdict on the diff" in why


def test_a_projected_budget_UNDER_the_cap_runs():
    """The control: the bound must not refuse work that fits. A 10 MB module on 4 workers is 0.6 GB."""
    assert M.memory_refusal(10 * 1024**2, 4, 40 * _GB) is None


def test_the_cap_is_a_fraction_of_AVAILABLE_and_is_pre_stated():
    """Exactly at the cap fits; a byte over refuses. Pinning the boundary stops the fraction drifting
    into "whatever is free", which is the other half of the fleet."""
    per_worker = 1.0 * _GB
    mutants = int(per_worker / M.WORKER_RSS_PER_MUTANTS_BYTE)
    avail = int(4 * per_worker / M.MEM_CAP_FRACTION)  # cap == 4 workers' worth
    assert M.memory_refusal(mutants, 4, avail) is None
    assert M.memory_refusal(mutants, 5, avail), "one worker past the cap must refuse"
    assert M.MEM_CAP_FRACTION == 0.5 and M.WORKER_RSS_PER_MUTANTS_BYTE == 15.0, (
        "both are PRE-STATED; a threshold derived from the data it judges is UNKNOWN (§🧾)"
    )


def test_memory_refusal_says_nothing_when_it_cannot_measure():
    """§∅: an unmeasured input is not a small one. With no mutants file, no worker count or no
    /proc/meminfo, the projection has no basis — refusing on a zero would block every run."""
    assert M.memory_refusal(0, 16, 40 * _GB) is None
    assert M.memory_refusal(536 * 1024**2, 0, 40 * _GB) is None
    assert M.memory_refusal(536 * 1024**2, 16, 0) is None


def test_available_is_read_from_MemAvailable_not_MemFree():
    """MemFree excludes reclaimable page cache and would refuse runs that fit comfortably."""
    text = "MemTotal:       61000000 kB\nMemFree:          500000 kB\nMemAvailable:   40000000 kB\n"
    assert M.available_bytes_from_meminfo(text) == 40000000 * 1024
    assert M.available_bytes_from_meminfo("MemTotal: 1 kB\n") is None
    assert M.available_bytes_from_meminfo("") is None
    assert M.available_bytes_from_meminfo("MemAvailable:   notanumber kB\n") is None


def test_a_memory_refusal_that_decided_nothing_is_NOT_RUN():
    status, reason = M.memory_exhaustion_verdict(2, 0)
    assert status == "NOT_RUN" and "examined nothing" in reason
    assert M.memory_exhaustion_verdict(2, 7)[0] == "UNKNOWN"
    assert "7 mutant(s) were decided" in M.memory_exhaustion_verdict(2, 7)[1]


# ── the prune ON REAL DIRECTORIES (the plant), not just the decision ────────────────────────────────
def _scratch(root, name, *, owner=None, age_sec=0.0):
    import os as _os
    import time as _t

    d = root / name
    (d / "work").mkdir(parents=True)
    if owner is not None:
        (d / M.SCRATCH_OWNER_FILE).write_text(owner + "\n", encoding="utf-8")
    if age_sec:
        old = _t.time() - age_sec
        _os.utime(d, (old, old))
    return d


def test_the_prune_spares_a_LIVE_owners_scratch_and_removes_an_abandoned_one(tmp_path):
    """THE PLANT, end to end on real directories with the real /proc: a peer's live tree survives and
    an abandoned one is reclaimed IN THE SAME SWEEP — so "it kept everything" cannot pass for a fix."""
    import os as _os

    me = _os.getpid()
    live = M.owner_record(me, M.proc_start_ticks(me))
    dead = M.owner_record(999999, 1)  # no such process

    peer = _scratch(tmp_path, "mut-capture-aaaaaaaaaaaa", owner=live, age_sec=10**6)
    gone = _scratch(tmp_path, "mut-capture-bbbbbbbbbbbb", owner=dead, age_sec=10**6)
    mine = _scratch(tmp_path, "mut-capture-cccccccccccc", owner=live)
    other_module = _scratch(tmp_path, "mut-webmon-dddddddddddd", owner=dead, age_sec=10**6)

    pruned, held = M.prune_scratches(tmp_path, "capture", mine)

    assert peer.exists(), "a live peer's scratch was deleted — the whole defect"
    assert mine.exists(), "this run's own scratch was deleted"
    assert not gone.exists(), "an abandoned scratch was not reclaimed; the cache never evicts"
    assert other_module.exists(), "the prune reached outside its own module"
    assert pruned == ["mut-capture-bbbbbbbbbbbb"], pruned
    assert any("mut-capture-aaaaaaaaaaaa" in h and "live" in h for h in held), held


def test_the_prune_reports_WHY_each_survivor_was_kept(tmp_path):
    """A prune that removed a peer's tree used to print only the name. The reason is the one line
    that could have named the mistake."""
    import os as _os

    me = _os.getpid()
    _scratch(tmp_path, "mut-oxy-111111111111", owner=M.owner_record(me, M.proc_start_ticks(me)))
    _scratch(tmp_path, "mut-oxy-222222222222")  # unmarked, young
    _scratch(tmp_path, "mut-oxy-333333333333", owner=M.owner_record(999999, 1))  # dead, young
    pruned, held = M.prune_scratches(tmp_path, "oxy", tmp_path / "mut-oxy-current")
    assert pruned == [], pruned
    assert len(held) == 3
    assert any("live process" in h for h in held)
    assert any("no owner marker" in h for h in held)
    assert any("still exiting" in h for h in held)


def test_an_unmarked_scratch_past_the_long_floor_is_finally_reclaimed(tmp_path):
    """The leak guard: unmarked trees must not accumulate forever. 153 orphaned scratches and 2.6 GB
    were measured before pruning existed at all."""
    old = _scratch(tmp_path, "mut-ecg-999999999999", age_sec=M.SCRATCH_UNKNOWN_MIN_AGE_SEC + 60)
    pruned, held = M.prune_scratches(tmp_path, "ecg", tmp_path / "mut-ecg-current")
    assert pruned == [old.name] and not old.exists(), (pruned, held)


def test_a_file_that_merely_looks_like_a_scratch_is_not_touched(tmp_path):
    (tmp_path / "mut-ppg-abcabcabcabc").write_text("not a directory", encoding="utf-8")
    pruned, held = M.prune_scratches(tmp_path, "ppg", tmp_path / "mut-ppg-current")
    assert (pruned, held) == ([], []) and (tmp_path / "mut-ppg-abcabcabcabc").exists()


def test_a_name_that_cannot_be_stat_ed_is_skipped_not_crashed_on(tmp_path):
    """A dangling symlink, or a directory a concurrent sweep removed between the glob and the stat.
    Deterministic here via the symlink: `glob` lists it and `stat` follows it to nothing."""
    (tmp_path / "mut-hrv-aaaaaaaaaaaa").symlink_to(tmp_path / "does-not-exist")
    real = _scratch(tmp_path, "mut-hrv-bbbbbbbbbbbb", owner=M.owner_record(999999, 1), age_sec=10**6)
    pruned, held = M.prune_scratches(tmp_path, "hrv", tmp_path / "mut-hrv-current")
    assert pruned == [real.name], pruned
    assert (tmp_path / "mut-hrv-aaaaaaaaaaaa").is_symlink(), "the dangling name was touched"


# ── draining the gate's report on THIS change (survivors on my own new lines) ────────────────────────
def test_a_non_directory_does_not_STOP_the_sweep(tmp_path):
    """`continue` → `break` on the non-directory branch. The earlier file test had nothing after the
    file, so ending the loop there looked identical to skipping it — the prunable tree must sort
    AFTER the file for the difference to exist at all."""
    (tmp_path / "mut-ppg-aaaaaaaaaaaa").write_text("not a directory", encoding="utf-8")
    later = _scratch(tmp_path, "mut-ppg-zzzzzzzzzzzz", owner=M.owner_record(999999, 1), age_sec=10**6)
    pruned, _ = M.prune_scratches(tmp_path, "ppg", tmp_path / "mut-ppg-current")
    assert pruned == [later.name], f"the sweep stopped at the file instead of skipping it: {pruned}"


def test_the_prune_honours_the_CALLERS_clock_and_reports_the_true_age(tmp_path):
    """Two survivors: `now` recomputed instead of taken from the caller, and the age floored at 1.0
    instead of 0.0. Both are invisible unless the age reaches the reason text."""
    import os as _os

    d = _scratch(tmp_path, "mut-cpap-aaaaaaaaaaaa", owner=M.owner_record(999999, 1))
    mtime = _os.stat(d).st_mtime
    # +60, not the mtime itself: with `now` recomputed from the wall clock the age is ~0.00s, which
    # renders as "0s" exactly like the injected value would — the mutant hid inside the format.
    _pruned, held = M.prune_scratches(tmp_path, "cpap", tmp_path / "mut-cpap-current", now=mtime + 60.0)
    assert len(held) == 1
    assert "only 60s old" in held[0], f"the caller's clock was ignored: {held[0]}"
    # And the floor is 0.0, not 1.0: a clock that runs backwards must report no age, not one second.
    _p2, h2 = M.prune_scratches(tmp_path, "cpap", tmp_path / "mut-cpap-current", now=mtime - 5.0)
    assert "only 0s old" in h2[0], h2


def test_the_current_scratch_is_spared_even_with_NO_live_owner(tmp_path):
    """`is_current=(old_dir == current)` → `is_current=None`. The earlier test's own scratch had a
    LIVE owner, so it was kept for the other reason and the mutation made no difference."""
    mine = _scratch(tmp_path, "mut-ecg-aaaaaaaaaaaa", owner=M.owner_record(999999, 1), age_sec=10**6)
    pruned, held = M.prune_scratches(tmp_path, "ecg", mine)
    assert pruned == [] and mine.exists(), "this run deleted its OWN scratch mid-run"
    assert held == [], "the current scratch is not a 'held' survivor; it is simply this run's"


def test_the_prune_can_be_observed_without_deleting_and_ignores_errors(tmp_path):
    """The `remove` seam, and the `ignore_errors=True` it is called with. A concurrent sweep removing
    the same tree between this run's stat and its rmtree must not crash the sweep — that is the whole
    reason the flag is set, and nothing observed it."""
    seen = []

    def _remove(path, **kw):
        seen.append((path.name, kw))

    doomed = _scratch(tmp_path, "mut-motion-aaaaaaaaaaaa", owner=M.owner_record(999999, 1), age_sec=10**6)
    pruned, _ = M.prune_scratches(tmp_path, "motion", tmp_path / "mut-motion-current", remove=_remove)
    assert pruned == [doomed.name] and doomed.exists(), "the injected remove was bypassed"
    assert seen == [(doomed.name, {"ignore_errors": True})], seen


def test_an_owner_marker_that_is_not_UTF_8_does_not_take_the_sweep_down(tmp_path):
    """A marker is advisory; a corrupt one must read as UNKNOWN, not raise out of the sweep."""
    d = _scratch(tmp_path, "mut-glu-aaaaaaaaaaaa")
    (d / M.SCRATCH_OWNER_FILE).write_bytes(b"\xff\xfe not utf-8 \x00")
    import os as _os

    _old = __import__("time").time() - 10**6  # age the DIR after writing into it: a write to a
    _os.utime(d, (_old, _old))  # child updates the parent's mtime and undoes it
    pruned, _ = M.prune_scratches(tmp_path, "glu", tmp_path / "mut-glu-current")
    assert pruned == [d.name], "an undecodable marker must fall back to the unmarked path"


def test_the_age_floors_are_exclusive_at_the_boundary():
    """`age < floor` → `age <= floor`. Exactly AT the floor the grace is over."""
    assert M.scratch_prune_decision(is_current=False, owner_live=False, age_sec=M.SCRATCH_MIN_AGE_SEC)[0] is True
    assert M.scratch_prune_decision(is_current=False, owner_live=None, age_sec=M.SCRATCH_UNKNOWN_MIN_AGE_SEC)[0] is True


def test_proc_start_ticks_NAMES_its_encoding(tmp_path):
    """`encoding="utf-8"` → `None`/omitted. /proc/<pid>/stat's comm field is arbitrary BYTES, so on a
    C-locale box an accented process name decodes to UnicodeDecodeError — a ValueError, which this
    function swallows into None, and a live owner then reads as DEAD and its scratch is deleted.
    Heron hit the same class on the PMD-arrival sidecar.

    CPython resolves the default encoding in C, so no in-process patch reaches it; `-X
    warn_default_encoding -W error::EncodingWarning` is the supported lever, and it holds on a UTF-8
    machine and a C-locale one alike. Same shape as
    test_solid_night_inputs.py::…_under_warn_default_encoding, including its two rules:

      · IN-PROCESS FIRST, not redundant — mutmut selects a mutant's tests from COVERAGE and a
        subprocess is invisible to the tracer, so without this call the test never runs against the
        mutants it kills and both `encoding=` survivors read as unkillable.
      · NO `env=` — the child must INHERIT `MUTANT_UNDER_TEST`, or it runs the original function
        however the parent was mutated. A handwritten env dict here is what made this test pass
        under plain pytest and survive under the gate.
    """
    import subprocess
    import sys

    d = tmp_path / "4242"
    d.mkdir()
    fields = " ".join(str(i) for i in range(3, 53))
    (d / "stat").write_bytes(f"4242 (caf\u00e9) {fields}\n".encode())

    assert M.proc_start_ticks(4242, proc_root=str(tmp_path)) == 22

    src = (
        "import mutation_diff as M\n"
        f"got = M.proc_start_ticks(4242, proc_root={str(tmp_path)!r})\n"
        "assert got == 22, got\n"
    )
    r = subprocess.run(
        [sys.executable, "-X", "warn_default_encoding", "-W", "error::EncodingWarning", "-c", src],
        capture_output=True,
        text=True,
        cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    )
    assert r.returncode == 0, r.stderr[-600:]


def test_a_ONE_BYTE_module_against_a_ONE_BYTE_box_still_refuses():
    """`mutants_bytes <= 0` → `<= 1`. The absence guard must not swallow the smallest REAL
    measurement: one byte of generated mutants is a measurement, and against one byte of available
    memory it does not fit."""
    assert M.memory_refusal(1, 1, 1), "a 1-byte measurement is not an absent one (§∅)"


def test_a_projection_EXACTLY_at_the_cap_fits():
    """`projected <= cap` → `projected < cap`. Only an exact equality separates them, and a boundary
    built by integer division never lands on it."""
    mutants = 1_000_000  # 15 MB per worker, exactly
    per_worker = mutants * M.WORKER_RSS_PER_MUTANTS_BYTE
    avail = int(4 * per_worker / M.MEM_CAP_FRACTION)  # cap == exactly 4 workers' worth
    assert per_worker * 4 == avail * M.MEM_CAP_FRACTION, "the test must land ON the boundary"
    assert M.memory_refusal(mutants, 4, avail) is None, "exactly at the cap must FIT"


def test_ONE_worker_over_the_cap_still_refuses():
    """`workers <= 0` → `workers <= 1` made a single-worker run unmeasurable by the guard, and one
    worker is exactly the 8.2 GB case the fleet's per-process limit is about."""
    assert M.memory_refusal(536 * 1024**2, 1, 1 * _GB), "one worker over the cap must refuse"


def test_a_single_BYTE_of_available_memory_is_still_a_measurement():
    """`available_bytes <= 0` → `<= 1`. A box reporting one byte available is absurd but REPORTED,
    and a reported one is not an absence (§∅)."""
    assert M.memory_refusal(536 * 1024**2, 16, 1), "1 byte available is a measurement, not a gap"


def test_MemAvailable_is_read_even_without_a_unit_suffix():
    """`len(parts) >= 2` → `> 2`/`>= 3` assumed a trailing `kB` the format does not promise."""
    assert M.available_bytes_from_meminfo("MemAvailable:   40000000\n") == 40000000 * 1024


def test_the_memory_verdict_names_how_many_functions_it_refused():
    """`what = None` survived an assertion that only looked for 'examined nothing'."""
    _, reason = M.memory_exhaustion_verdict(3, 0)
    assert reason.startswith("3 function(s) not mutated — projected memory exceeds the run's cap"), reason


def test_ONE_decided_mutant_makes_a_memory_refusal_UNKNOWN_not_NOT_RUN():
    """`decided > 0` → `> 1`, the same boundary the budget verdict has and this one lacked."""
    assert M.memory_exhaustion_verdict(1, 1)[0] == "UNKNOWN"
    assert M.memory_exhaustion_verdict(1, 0)[0] == "NOT_RUN"


# ── MUTATION SCOPE FOLLOWS SEMANTIC CHANGE, NOT LINE MOVEMENT ───────────────────────────────────────
# Sized by the 2026-09-28 whole-tree reformat: 8,859 hunks across 423 files for a change that altered
# no behaviour, which cannot finish inside the gate budget and so refuses — a required refusal on a
# PR whose mutants were never in question. Under this rule the same diff scopes to 20 functions.
_REFORMATTED = '''
def f(a, b):
    """Doc."""
    return (
        a
        + b
    )
'''
_ORIGINAL = '''
def f(a, b):
    """Doc."""
    return a + b
'''


def test_a_function_only_REFLOWED_is_not_in_scope():
    """THE PLANT. Same AST, different text — the formatter moved lines it did not change."""
    names, why = M.functions_with_changed_ast(_ORIGINAL, _REFORMATTED)
    assert why is None
    assert names == set(), f"a reflow put {names} in mutation scope"


def test_a_ONE_TOKEN_semantic_edit_IS_in_scope():
    """THE CONTROL, and the half that makes the plant worth anything: the rule must still catch a
    real change in the same shape of file. `a + b` → `a - b` is one token."""
    names, _ = M.functions_with_changed_ast(_ORIGINAL, _REFORMATTED.replace("+ b", "- b"))
    assert names == {"x_f"}, names


def test_a_changed_STRING_is_a_semantic_change():
    """No blanking. A blanked comparison would scope a changed log line, format string or SQL
    fragment to NOTHING, which is the hole this rule must not open — a string value is behaviour."""
    a = 'def g():\n    log("started")\n'
    b = 'def g():\n    log("stopped")\n'
    assert M.functions_with_changed_ast(a, b)[0] == {"x_g"}


def test_a_re_indented_DOCSTRING_no_longer_scopes_and_here_is_why_that_CHANGED():
    """⚠️ THIS TEST ASSERTED THE OPPOSITE IN #3199, deliberately, and is inverted here deliberately.

    #3199 scoped a docstring change on the reasoning that the rule must never decide "which strings
    matter". That reasoning still holds for every other string. What changed is a MEASUREMENT: mutmut
    3.8 generates ZERO mutants for a docstring node (a function of [docstring + `return 1`] yields
    exactly one mutant, `return 2`). So the docstring statement is not a string the rule is judging —
    it is the one node with no mutants behind it, which is a syntactic fact rather than a preference.

    The cost of the old answer was measured too: 14 docstring re-indents pulled capture.py into a
    reformat's mutation scope and CI cancelled the job at its 180-minute timeout."""
    a = 'def h():\n    """Line.\n      indented."""\n    return 1\n'
    b = 'def h():\n    """Line.\n    indented."""\n    return 1\n'
    assert M.functions_with_changed_ast(a, b)[0] == set()


def test_an_UNPARSEABLE_revision_narrows_nothing_and_says_why():
    """§∅ — a question we cannot answer is not an answer of "no change". An unparseable side must
    leave scope exactly as the line scan found it, with the reason printed."""
    names, why = M.functions_with_changed_ast("def f():\n    return 1\n", "def f(:\n")
    assert names == set() and why and "does not parse" in why, (names, why)


def test_a_NEW_function_is_in_scope_and_a_DELETED_one_is_not():
    """A function only in the head revision changed (it appeared). One only in the base generates no
    mutants at all, so it is not scope — there is nothing to mutate."""
    a = "def keep():\n    return 1\n\n\ndef gone():\n    return 2\n"
    b = "def keep():\n    return 1\n\n\ndef fresh():\n    return 3\n"
    assert M.functions_with_changed_ast(a, b)[0] == {"x_fresh"}


def test_a_method_is_mangled_BY_ITS_CLASS_like_the_line_scan_does():
    """🔴 THE NAMES MUST MATCH `functions_covering`'s MANGLING or the intersection is silently empty
    and EVERY function drops out of scope — a gate that reports green on everything. Measured exactly
    that on the first version: 0 functions scoped where 19 was the right answer."""
    a = "class A:\n    def m(self):\n        return 1\n\n\nclass B:\n    def m(self):\n        return 2\n"
    b = "class A:\n    def m(self):\n        return 1\n\n\nclass B:\n    def m(self):\n        return 99\n"
    assert M.functions_with_changed_ast(a, b)[0] == {"xǁBǁm"}


def test_an_ASYNC_function_is_judged_the_same_way():
    a = "async def go():\n    return 1\n"
    assert M.functions_with_changed_ast(a, a.replace("1", "2"))[0] == {"x_go"}
    assert M.functions_with_changed_ast(a, "async def go():\n    return (\n        1\n    )\n")[0] == set()


def test_a_def_in_an_EXCEPT_ELSE_or_FINALLY_is_seen_by_BOTH_walkers():
    """🔴 THE TWIN OF THE MANGLING BUG: the two walkers must agree on MEMBERSHIP, only ever on
    content. `functions_covering` walks `ast.iter_child_nodes` — every field, including `handlers`,
    `orelse` and `finalbody` — so a `def` inside `except:`, `else:` or `finally:` is in scope by the
    line scan. Walking `node.body` alone missed all three, so the intersection dropped genuinely
    edited functions SILENTLY and with no reason printed. The `except ImportError: def shim(...)`
    shape is real in this tree (optional-dependency shims)."""
    old = (
        "try:\n    import foo\nexcept ImportError:\n    def shim(a): return a + 1\n"
        "if True: pass\nelse:\n    def alt(b): return b * 2\n"
        "class K:\n    if True: pass\n    else:\n        def m(self): return 1\n"
    )
    new = old.replace("a + 1", "a + 2").replace("b * 2", "b * 3").replace("return 1", "return 9")
    changed, why = M.functions_with_changed_ast(old, new)
    assert why is None
    assert changed == {"x_shim", "x_alt", "x\u01c1K\u01c1m"}, changed
    # …and the two walkers see the SAME SET, which is the property that makes the intersection safe.
    assert M.functions_covering(new, set(range(1, new.count("\n") + 2))) == changed


def test_a_def_in_a_FINALLY_is_reached_too():
    old = "def outer():\n    try:\n        pass\n    finally:\n        def inner():\n            return 1\n"
    assert M.functions_with_changed_ast(old, old.replace("return 1", "return 2"))[0] == {"x_outer", "x_inner"}


def test_a_nested_def_inside_a_METHOD_keeps_its_class(sub=None):
    """`visit(child, cls)` → `visit(child, None)` survived: a function nested inside a method would
    be named `x_inner` instead of `xǁKǁinner`, so it would never match the stem the line scan hands
    over and would drop out of scope silently. Asserted against `functions_covering` rather than a
    literal, because the two agreeing IS the property."""
    src = "class K:\n    def m(self):\n        def inner():\n            return 1\n        return inner\n"
    changed, _ = M.functions_with_changed_ast(src, src.replace("return 1", "return 2"))
    assert changed == {"x\u01c1K\u01c1m", "x\u01c1K\u01c1inner"}, changed
    assert changed == M.functions_covering(src, set(range(1, 9)))


def test_two_defs_under_ONE_stem_are_compared_TOGETHER():
    """`out.get(stem, "")` → `out.get(None, "")` survived: the accumulation is what makes a stem mean
    "every body under this name". Without it only the LAST body is compared, so a change to the
    FIRST of two same-named defs is invisible — and both collapse to one mutant glob, so the gate
    would mutate a function whose edit this rule said was not there."""
    dup = "def f():\n    return 1\n\n\ndef f():\n    return 2\n"
    assert M.functions_covering(dup, set(range(1, 9))) == {"x_f"}
    assert M.functions_with_changed_ast(dup, dup.replace("return 1", "return 9"))[0] == {"x_f"}, (
        "a change to the FIRST body under a shared stem was not seen"
    )
    assert M.functions_with_changed_ast(dup, dup.replace("return 2", "return 9"))[0] == {"x_f"}


# ── A CHANGE CONFINED TO A DOCSTRING HAS NOTHING TO MUTATE ──────────────────────────────────────────
# MEASURED on mutmut 3.8 before this rule was written: a function of [docstring + `return 1`] generates
# exactly ONE mutant (`return 2`) and ZERO touch the docstring. So the docstring statement is the one
# node with no mutants behind it, and scoping a function for it re-mutates a body that did not change.
# Cost of not having this: 14 docstring re-indents pulled capture.py (20,021 mutants, ~22 min to
# GENERATE on 24 cores) into a reformat's scope, and CI cancelled the job at 180 minutes.
_DOC_A = 'def g(x):\n    """Summary.\n      indented line."""\n    return x + 1\n'
_DOC_B = 'def g(x):\n    """Summary.\n    indented line."""\n    return x + 1\n'


def test_a_RE_INDENTED_docstring_scopes_nothing():
    """THE PLANT. This is the shape a formatter produces, and the only difference is the docstring."""
    assert M.functions_with_changed_ast(_DOC_A, _DOC_B)[0] == set()


def test_a_docstring_change_PLUS_a_token_change_still_scopes():
    """THE CONTROL, and the half that keeps the rule honest: the exemption is for a change CONFINED
    to the docstring, never for a function that also changed."""
    assert M.functions_with_changed_ast(_DOC_A, _DOC_B.replace("x + 1", "x + 2"))[0] == {"x_g"}


def test_a_REWRITTEN_docstring_also_scopes_nothing():
    """Not just re-indentation — any docstring-only edit. There is still nothing to mutate."""
    both = _DOC_A.replace("Summary.", "A completely different summary sentence.")
    assert M.functions_with_changed_ast(_DOC_A, both)[0] == set()


def test_a_changed_NON_docstring_string_still_scopes():
    """The line between this rule and a hole: only the DOCSTRING statement is exempt. A log line, a
    format string or an SQL fragment is an ordinary string constant and mutmut does mutate it."""
    a = 'def h():\n    """Doc."""\n    log("started")\n'
    b = 'def h():\n    """Doc."""\n    log("stopped")\n'
    assert M.functions_with_changed_ast(a, b)[0] == {"x_h"}


def test_ADDING_or_REMOVING_a_docstring_scopes_nothing_either():
    """Both directions, because `_strip_docstring` must treat an absent docstring the same as a
    present one — otherwise adding one reads as a body change."""
    without = "def k():\n    return 7\n"
    with_doc = 'def k():\n    """Now documented."""\n    return 7\n'
    assert M.functions_with_changed_ast(without, with_doc)[0] == set()
    assert M.functions_with_changed_ast(with_doc, without)[0] == set()


def test_a_function_whose_BODY_IS_ONLY_a_docstring_is_handled():
    """`clone.body = body[1:]` would leave an EMPTY body, which is not valid AST. Stripping must
    substitute a `Pass` or this raises instead of answering."""
    a = 'def only():\n    """One."""\n'
    b = 'def only():\n    """Two."""\n'
    assert M.functions_with_changed_ast(a, b)[0] == set()


def test_the_rule_does_NOT_use_ast_get_docstring_with_its_default_cleaning():
    """🔴 THE TRAP, pinned because it gave a confidently wrong answer on every real case.
    `ast.get_docstring(node)` defaults to `clean=True` and normalises leading whitespace, so a
    RE-INDENTED docstring compares EQUAL through it — which would report "no difference at all",
    scope NOTHING anywhere, and do it silently. This asserts the two docstrings genuinely differ in
    their RAW text while `clean=True` cannot see it, so a future reader cannot conclude the cleaned
    comparison would have been equivalent."""
    import ast as _ast

    a, b = _ast.parse(_DOC_A).body[0], _ast.parse(_DOC_B).body[0]
    assert _ast.get_docstring(a) == _ast.get_docstring(b), "clean=True hides it — that is the trap"
    assert _ast.get_docstring(a, clean=False) != _ast.get_docstring(b, clean=False), (
        "the raw docstrings DO differ, which is why the rule compares structurally instead"
    )


def test_a_changed_DECORATOR_scopes_the_function():
    """`ast.dump(d)` → `ast.dump(None)` survived: every decorator would dump identically, so two
    functions differing ONLY in their decorators compare equal and the function is dropped from
    scope. A decorator change is a behaviour change — it is what wraps the call — and the signature
    and decorator list are dumped precisely because the body alone does not carry them."""
    a = "@retry\ndef f():\n    return 1\n"
    b = "@cache\ndef f():\n    return 1\n"
    assert M.functions_with_changed_ast(a, b)[0] == {"x_f"}
    # …and adding one where there was none.
    assert M.functions_with_changed_ast("def f():\n    return 1\n", a)[0] == {"x_f"}


def test_a_changed_SIGNATURE_scopes_the_function():
    """The sibling property, for the same reason: `ast.dump(node.args)` is in the comparison because
    a parameter list change is not visible in the body statements."""
    assert M.functions_with_changed_ast("def f(a):\n    return 1\n", "def f(a, b=2):\n    return 1\n")[0] == {"x_f"}


# ── the COMMITTED generated-size record ─────────────────────────────────────────────────────────────
# Every CI run is a fresh scratch, so a size remembered only beside the scratch is a size CI never has.
# The record is what lets a hosted runner refuse capture.py at 0 workers in minute one, NAMED, instead of
# burning the generation budget to rediscover it.


def test_the_size_record_round_trips_and_a_hash_MISS_IS_ABSENT():
    """The keying is the whole safety property: a size measured from a DIFFERENT version of the source is
    a guess wearing a measurement's clothes. So a miss must be absent, never the nearest entry."""
    text = M.merge_mutants_size("", "capture.py", "7cf809a4bbf4", 562427047, "2026-09-28", "rig-x870")
    rec = M.mutants_size_record(text)
    assert rec[("capture.py", "7cf809a4bbf4")] == 562427047
    assert rec.get(("capture.py", "8c405e68387e")) is None, "a different source hash must not inherit a size"
    assert rec.get(("other.py", "7cf809a4bbf4")) is None, "a different module must not inherit it either"


def test_the_record_survives_being_unreadable_or_absent():
    """A record that cannot be parsed must read as NO KNOWLEDGE, not as a crash and not as a zero that
    some caller treats as permissive. The tool runs on hosts where this file may not exist at all."""
    assert M.mutants_size_record("") == {}
    assert M.mutants_size_record("{not json") == {}
    assert M.mutants_size_record('{"sizes": {"bad-key": 12}}') == {}, "a key with no @hash is not a row"
    assert M.mutants_size_record('{"sizes": {"m.py@abc": 0}}') == {}, "a zero size is absence, not a measurement"
    assert M.mutants_size_record('{"sizes": {"m.py@abc": -5}}') == {}
    assert M.mutants_size_record('{"sizes": {"m.py@abc": "big"}}') == {}
    assert M.mutants_size_record('{"sizes": {"@abc": 5}}') == {}
    assert M.mutants_size_record('{"sizes": {"m.py@": 5}}') == {}
    assert M.mutants_size_record('{"sizes": {"m.py@abc": 7}}') == {("m.py", "abc"): 7}, "a bare int is a size"


def test_a_re_measurement_REPLACES_and_says_what_it_superseded():
    """The same source hash generating a different size means the GENERATOR changed (a mutmut bump), and
    the newer number describes the mutmut this tree pins. Keeping both, or averaging, would describe
    neither — but the old value stays visible so the change is not silent."""
    t1 = M.merge_mutants_size("", "m.py", "aaa", 100, "2026-09-01", "rig")
    t2 = M.merge_mutants_size(t1, "m.py", "aaa", 250, "2026-09-28", "rig")
    import json as _j

    entry = _j.loads(t2)["sizes"]["m.py@aaa"]
    assert entry["generatedBytes"] == 250
    assert entry["supersedes"] == 100, "a replaced measurement must stay visible"
    # Idempotent on an unchanged measurement: re-recording the same size adds no `supersedes` noise.
    t3 = M.merge_mutants_size(t2, "m.py", "aaa", 250, "2026-09-29", "rig")
    assert "supersedes" not in _j.loads(t3)["sizes"]["m.py@aaa"]
    # …and a corrupt file is rebuilt rather than inherited, so one bad write cannot poison every later one.
    assert (
        _j.loads(M.merge_mutants_size("{not json", "m.py", "aaa", 7, "d", "h"))["sizes"]["m.py@aaa"]["generatedBytes"]
        == 7
    )


def test_the_committed_record_in_this_tree_parses_and_is_keyed_to_real_modules():
    """The file itself, not a fixture: a record nobody can parse is a record that silently stops helping,
    and the keys must name modules this tree actually has."""
    import pathlib as _p

    path = _p.Path(__file__).resolve().parent.parent / "tools" / "mutation-sizes.json"
    assert path.exists(), "the committed size record is missing"
    rec = M.mutants_size_record(path.read_text(encoding="utf-8"))
    assert rec, "the committed record parses to nothing — every CI run is a fresh scratch and would learn nothing"
    root = path.parent.parent
    for module, src_hash in rec:
        assert (root / module).exists(), f"{module} is recorded but not in the tree"
        assert len(src_hash) == 12 and all(c in "0123456789abcdef" for c in src_hash), src_hash


def test_an_unknown_size_is_capped_and_NEVER_the_core_count():
    """🔴 The first cut of this fix fell back to `os.cpu_count()` when no size was known — the exact
    over-commit it exists to prevent, alive in the one branch that matters, because the FIRST run on any
    source hash is the unknown case and that is the case #3202 was."""
    assert M.UNKNOWN_SIZE_WORKERS < 8, "the unknown-size fallback must be small, not a core count"
    assert M.workers_that_fit(0, 14 * 1024**3) == 0, "an unknown size affords nothing to derive from"


# ── the 29 survivors #3208's own gate found in the code above ───────────────────────────────────────
# The gate decided all 204 mutants over these six functions and 29 lived. They were real gaps, not
# equivalent mutants, and two are findings rather than coverage debt: nothing asserted the committed
# record's SERIALISATION (an unstable one churns the diff on every write), and nothing asserted that one
# malformed row does not silently drop every row after it.


def test_the_record_SERIALISATION_is_stable_because_the_file_is_committed():
    """`json.dumps(doc, indent=2) + "\\n"` → `indent=None`, `indent=3`, or no indent at all all survived.
    For a COMMITTED file that is not cosmetic: an unstable serialisation rewrites the whole file on every
    `--record-sizes`, so a one-entry measurement lands as a whole-file diff and the next session cannot
    see what changed."""
    text = M.merge_mutants_size("", "m.py", "aaa", 100, "2026-09-28", "rig")
    assert text.endswith("}\n"), "the record must end with exactly one newline — a committed file needs it"
    assert text.startswith('{\n  "'), f"two-space indent, not compact and not three: {text[:20]!r}"
    assert '\n  "sizes": {\n    "m.py@aaa": {\n      "generatedBytes": 100' in text, text[:400]
    # …and the schema and note are part of the record, not decoration: a reader who finds this file needs
    # to know what wrote it and that hand-editing it destroys its only value.
    import json as _j

    doc = _j.loads(text)
    assert doc["schema"] == "tepna.mutation-sizes/1"
    assert "NEVER hand-edited" in doc["note"]
    assert "--record-sizes" in doc["note"], "the note must name the tool that writes it"
    assert "absent, not a default" in doc["note"], "the note must state that a miss is absence"


def test_ONE_malformed_row_does_not_drop_every_row_after_it():
    """`continue` → `break` survived. For a file whose whole job is remembering sizes, that turns a single
    bad row into silent amnesia for everything below it — and amnesia reads as "nothing to worry about",
    which is the §∅ failure this PR exists to fix, one layer along."""
    rec = M.mutants_size_record('{"sizes": {"aaa-no-at": 5, "good.py@abc123abc123": 7, "zzz.py@def456def456": 9}}')
    assert rec == {("good.py", "abc123abc123"): 7, ("zzz.py", "def456def456"): 9}, rec


def test_the_module_is_everything_before_the_FIRST_at_sign():
    """`partition` → `rpartition` survived, and the two disagree only on a key with more than one `@`. The
    documented key is `<module>@<hash>`, so the hash is the LAST field and the module is the first — but a
    key with two `@` is malformed either way, and what matters is that it does not resolve to a module this
    tree has. Pinned so the choice is deliberate rather than whichever function was typed."""
    rec = M.mutants_size_record('{"sizes": {"a@b@c": 5}}')
    assert rec == {("a", "b@c"): 5}, f"partition semantics: module is before the FIRST @, got {rec}"


def test_a_ONE_BYTE_size_is_a_measurement():
    """`size > 0` → `size > 1` survived. One byte is absurd for a generated module and that is exactly why
    it must be KEPT: the rule is "absence is absent", not "small values are absent". A guard that silently
    discards implausible measurements is a guard that decides what the data may say."""
    assert M.mutants_size_record('{"sizes": {"m.py@abc": 1}}') == {("m.py", "abc"): 1}


def test_the_generation_reason_defaults_to_NOTHING_WRITTEN_and_distinguishes_one_byte():
    """Two survivors here: the `mutants_bytes=0` default (never exercised, because every call passed it)
    and the `> 0` ternary. A caller that cannot measure the partial file must get "nothing written yet",
    and one byte must NOT read as nothing."""
    assert "nothing written yet" in M.generation_timeout_reason(60.0, 61.0), "the default must be the absent case"
    assert "nothing written yet" not in M.generation_timeout_reason(60.0, 61.0, 1)
    assert "0 MB of mutants written" in M.generation_timeout_reason(60.0, 61.0, 1)


def test_workers_that_fit_boundaries_are_pinned_at_the_EXACT_edge():
    """Seven survivors were boundary arithmetic: `<= 0` → `< 0` / `<= 1`, `or` → `and`, `//` → `/`. Each
    needs the value ON the edge, which no test had."""
    GB = 1024**3
    # `or` → `and`: one bad input is enough, both are not required.
    assert M.workers_that_fit(0, 14 * GB) == 0, "no size is enough to refuse on its own"
    assert M.workers_that_fit(562427047, 0) == 0, "no memory reading is enough to refuse on its own"
    # `<= 0` → `< 0` and `<= 1`: exactly 0 and exactly 1.
    assert M.workers_that_fit(1, 14 * GB) > 0, "a 1-byte module is measured, so it must be sized, not refused"
    assert M.workers_that_fit(-1, 14 * GB) == 0
    assert M.workers_that_fit(562427047, 1) == 0, "one byte available affords nothing"
    # `//` → `/`: the count is a WHOLE number of workers. With `/` this returns the same int after the
    # outer int(), so the discriminating case is one where the quotient's fraction matters to the caller:
    # assert the type and that a fractional affordance floors rather than rounds up.
    n = M.workers_that_fit(3 * GB, 14 * GB, rss_factor=1.0)
    assert isinstance(n, int) and n == 2, f"7 GB cap / 3 GB per worker must FLOOR to 2, got {n!r}"


def test_the_PHASE_branch_bounds_its_reap_and_its_remaining_wall_wait():
    """Three survivors lived in the phase branch's waits: the post-kill `proc.wait(timeout=REAP_SEC)`
    becoming `rc = None` or `timeout=None`, and the "phase finished, wait out the rest" call becoming
    `timeout=None`. The UNPHASED path already asserts its `timeout=` arguments (`_RecordingProc` below);
    adding the branch duplicated the code without duplicating the assertion, which is exactly how a fix
    reintroduces the bug class it was written for one indent over."""
    rec = _RecordingProc()
    M.stream_bounded(rec, 1.0, lambda _l: None, phase_cap_sec=1.0, phase_done=lambda: False)
    assert rec.killed, "the phase deadline fired but the child was never killed"
    assert len(rec.timeouts) >= 2, f"expected a bounded wait then a bounded reap, got {rec.timeouts}"
    assert rec.timeouts[-1] == M.REAP_SEC, (
        f"the post-kill reap must be bounded by REAP_SEC, got {rec.timeouts[-1]!r} — `timeout=None` here "
        "hands an unkillable child the power to hang the refusal forever"
    )
    # …and when the phase DID finish, the remaining wall wait is bounded too, not `timeout=None`.
    rec2 = _RecordingProc()
    M.stream_bounded(rec2, 30.0, lambda _l: None, phase_cap_sec=1.0, phase_done=lambda: True)
    assert all(t is not None for t in rec2.timeouts), (
        f"every wait must carry a deadline; got {rec2.timeouts} — an unbounded second wait is the original "
        "unreachable-cap defect, restored in the phase path"
    )


def test_a_HALF_DECLARED_phase_falls_through_instead_of_calling_None():
    """`phase_cap_sec is not None AND phase_done is not None` → `OR` survived. With `or`, declaring only
    one of the pair enters the phase branch and calls `phase_done()` on `None`, so the guard I added would
    raise inside the wait instead of behaving like an unphased call. Both half-declared shapes must fall
    through, and the third member must still come back False."""
    proc = _child("import sys\nprint('done')\nsys.exit(0)\n")
    rc, timed_out, phase_timed_out = M.stream_bounded(proc, 60.0, lambda _l: None, phase_cap_sec=1.0)
    assert (rc, timed_out, phase_timed_out) == (0, False, False), (rc, timed_out, phase_timed_out)
    proc2 = _child("import sys\nprint('done')\nsys.exit(0)\n")
    rc2, timed_out2, phase2 = M.stream_bounded(proc2, 60.0, lambda _l: None, phase_done=lambda: False)
    assert (rc2, timed_out2, phase2) == (0, False, False), (rc2, timed_out2, phase2)


def test_the_JOIN_bound_is_a_CONSTANT_because_a_default_cannot_be_mutation_tested():
    """🔴 `join_sec=10.0` → `11.0` survived an `inspect.signature(...).default == 10.0` assertion, and the
    reason is mutmut's dispatch, not the assertion: the generated module wraps the function as

        @_mutmut_mutated(mutants_x_stream_bounded__mutmut)
        def stream_bounded(proc, cap_sec, on_line, t0=None, join_sec=10.0, …)

    — a `def` that keeps the ORIGINAL defaults, dispatching to the mutant dict at CALL time. So signature
    introspection reads 10.0 under every mutant and CANNOT kill a default-value mutation. Same family as
    #3181's "survives mutmut's trampoline". The load-bearing number therefore lives as a module constant,
    which is not decorated and so is visible to mutation; the signature merely references it.

    No behavioural test can separate a 10 s join from an 11 s one without spending the difference in real
    seconds on every run, which is the trade `cap_remaining`'s tests already record for the deadline."""
    assert M.JOIN_SEC == 10.0, "the pre-stated join bound moved without a reason"
    import inspect

    assert inspect.signature(M.stream_bounded).parameters["join_sec"].default == M.JOIN_SEC, (
        "the signature must reference the constant, not re-declare the number — a second copy is a second "
        "thing to mutate, and the signature copy is the one mutation testing cannot see"
    )


def test_the_distinguishable_workers_that_fit_boundaries_the_probe_FOUND():
    """I assumed all six surviving boundary mutants were masked by the later guards. An exhaustive probe
    over 1,980 input combinations refuted three of them, and assuming would have put three KILLABLE
    mutants into the equivalence ledger — which the ledger reports as REFUTED, but only once someone runs
    it. Each needs a non-default `rss_factor`/`cap_fraction`, and both are public parameters."""
    # `available_bytes <= 0` → `<= 1`: distinguished only when ONE byte available still affords a worker,
    # which needs a per-worker cost at or below it.
    assert M.workers_that_fit(1, 1, rss_factor=1.0, cap_fraction=1.0) == 1, "1 byte available, 1 byte per worker"
    # `per_worker <= 0` → `<= 1`: distinguished by a sub-byte per-worker cost.
    # …and the SAME input kills `//` → `/`: floor, not true division. In binary 1.0/0.001 is 1000.0 while
    # `1.0 // 0.001` is 999.0, so `/` reports one worker MORE than the cap affords. Over-committing by one
    # worker is the whole failure this function exists to prevent, so the floor is the behaviour and not a
    # style choice — and the expected value is READ FROM THE FUNCTION's own arithmetic, which is why this
    # assertion first failed with my hand-computed 1000 against the real 999.
    assert M.workers_that_fit(1, 1, rss_factor=0.001, cap_fraction=1.0) == 999
    assert M.workers_that_fit(1, 1, rss_factor=0.001, cap_fraction=0.5) == 499


def test_the_MB_scale_in_the_generation_reason_is_MEBIbytes():
    """`1024.0 ** 2` → `1025.0 ** 2` survived: the two agree after `:.0f` for almost every size, so the
    distinguishing input has to be found rather than guessed — 210,501,632 bytes reads 201 MB against
    1024² and 200 MB against 1025². A reason line that misreports how far a killed run got is a small
    thing, but it is the only number that survives the kill."""
    r = M.generation_timeout_reason(60.0, 61.0, 210501632)
    assert "201 MB of mutants written" in r, r


# ── A ZERO THAT WAS NEVER A MEASUREMENT ───────────────────────────────────────────────────────────
# `unmeasured_zero` is the third statement of one rule, after `zero_population_verdict` (a PASS over
# checked 0 is not a pass) and `result_inconsistency` (a verdict whose counters disagree cannot vouch
# for itself). Those two guard the VERDICT; this guards the counts it is assembled from, which is
# where the failure has actually shipped — twice, in the same three-line function.
#
# The control is the point of the whole design and is asserted first: a function with no mutable
# operator genuinely counts 0, and refusing there would red a rename, a docstring edit or a reformat.
def test_a_clean_zero_over_a_population_that_WAS_examined_is_not_refused():
    """THE CONTROL. This is why a bare zero was ever trusted, and it must keep working."""
    scan = {
        "helper": "generated_under_glob",
        "glob": "m.x_identity__mutmut_*",
        "matched": 0,
        "corroborated": 0,
        "examined": 138,  # the file HAS mutants — 138 of them, for other functions
        "registered": 138,
        "sourceBytes": 40000,
    }
    assert M.unmeasured_zero(scan) is None, (
        "a function with no mutable operator counts 0 over a file that was read — benign, and the "
        "measured 2026-08-24 case (oxy_inventory.identity) that refusing here would have redded"
    )


def test_a_healthy_nonzero_count_is_not_refused():
    scan = {
        "helper": "generated_under_glob",
        "glob": "m.x_f__mutmut_*",
        "matched": 44,
        "corroborated": 44,
        "examined": 399,
        "registered": 399,
        "sourceBytes": 407771,
    }
    assert M.unmeasured_zero(scan) is None


def test_PLANT_the_construct_is_present_and_the_scan_cannot_see_it():
    """The historical bug, in the shape it actually had: 44 mutants registered, 0 counted.

    Pre-#3214 this returned 0 for every coroutine and the caller read it as "nothing to mutate". The
    integer was indistinguishable from the control above; only the corroboration separates them."""
    scan = {
        "helper": "generated_under_glob",
        "glob": "wifi_uplink.x__run__mutmut_*",
        "matched": 0,
        "corroborated": 44,
        "examined": 355,
        "registered": 399,
        "sourceBytes": 407771,
    }
    why = M.unmeasured_zero(scan)
    assert why is not None
    assert "0" in why and "44" in why and "disagree" in why
    assert "generated_under_glob" in why, "the refusal names the helper, not just the symptom"


def test_the_disagreement_is_checked_in_BOTH_directions():
    """A definition scan finding MORE than mutmut registered is equally a miscount. "Ours is higher so
    we are fine" is the reasoning that keeps a blind spot — there is no safe direction to be wrong in."""
    scan = {
        "helper": "generated_under_glob",
        "glob": "m.x_f__mutmut_*",
        "matched": 9,
        "corroborated": 4,
        "examined": 20,
        "registered": 15,
        "sourceBytes": 900,
    }
    assert M.unmeasured_zero(scan) is not None


def test_PLANT_the_scan_read_nothing_at_all():
    """An absent mutants file. A crash BEFORE generation writes neither mutants nor meta, so every
    count is 0 and the benign arm reports "nothing to mutate" — a coverage claim over a file that
    does not exist."""
    scan = {
        "helper": "generated_under_glob",
        "glob": "m.x_f__mutmut_*",
        "matched": 0,
        "corroborated": 0,
        "examined": 0,
        "registered": 0,
        "sourceBytes": 0,
    }
    why = M.unmeasured_zero(scan)
    assert why is not None and "absent or empty" in why
    assert "generated_under_glob" in why


def test_an_EMPTY_POPULATION_refuses_even_when_the_file_had_bytes():
    """The file was read and contained no mutant definitions at all. Not the same as an absent file —
    a truncated or half-written mutants file has bytes and no population — and equally not a count."""
    scan = {
        "helper": "generated_under_glob",
        "glob": "m.x_f__mutmut_*",
        "matched": 0,
        "corroborated": 0,
        "examined": 0,
        "registered": 0,
        "sourceBytes": 120,
    }
    assert "examined an empty population" in (M.unmeasured_zero(scan) or "")


def test_a_scan_without_corroboration_still_gets_the_population_checks():
    """`decided_scan` has no independent second count — the meta is the only record — so it carries
    `examined` and no `corroborated`, and the disagreement rule must not fire on its absence."""
    assert (
        M.unmeasured_zero(
            {"helper": "decided_under_glob", "glob": "m.x_f__mutmut_*", "matched": 0, "underGlob": 2, "examined": 3}
        )
        is None
    )
    why = M.unmeasured_zero(
        {"helper": "decided_under_glob", "glob": "m.x_f__mutmut_*", "matched": 0, "underGlob": 0, "examined": 0}
    )
    assert why is not None and "decided_under_glob" in why


def test_the_refusal_reason_is_a_sentence_a_reader_can_act_on():
    """Every non-PASS carries a reason (§🧾), and a reason naming only the symptom sends the reader to
    the wrong file. These name the HELPER, so the next person starts where the defect is."""
    for scan in (
        {
            "helper": "generated_under_glob",
            "glob": "g",
            "matched": 0,
            "corroborated": 3,
            "examined": 10,
            "registered": 13,
            "sourceBytes": 50,
        },
        {
            "helper": "generated_under_glob",
            "glob": "g",
            "matched": 0,
            "corroborated": 0,
            "examined": 0,
            "registered": 0,
            "sourceBytes": 0,
        },
    ):
        why = M.unmeasured_zero(scan)
        assert why and why[0].islower() and scan["helper"] in why and len(why) > 40


def test_the_refusal_NAMES_THE_GLOB_when_the_scan_carries_one():
    """Seven mutants survived on the two label lines because every test above asserted the HELPER and
    none asserted the glob. A refusal that says "generated_under_glob examined an empty population"
    without saying *for which function* sends the reader to a 2000-line module with no starting point,
    and on a run with several globs it is not even attributable."""
    why = M.unmeasured_zero(
        {
            "helper": "generated_under_glob",
            "glob": "wifi_uplink.x__run__mutmut_*",
            "matched": 0,
            "corroborated": 0,
            "examined": 0,
            "registered": 0,
            "sourceBytes": 0,
        }
    )
    assert "wifi_uplink.x__run__mutmut_*" in why
    assert "for wifi_uplink.x__run__mutmut_*" in why, "and reads as a sentence, not a bare token"


def test_a_scan_WITHOUT_a_glob_does_not_say_for_None():
    """The other half of the same line. `where` is conditional precisely so a scan with no glob reads
    cleanly; dropping the condition prints `for None`, which looks like a function actually called
    None and is worse than saying nothing."""
    why = M.unmeasured_zero(
        {
            "helper": "generated_under_glob",
            "matched": 0,
            "corroborated": 0,
            "examined": 0,
            "registered": 0,
            "sourceBytes": 0,
        }
    )
    assert why is not None
    assert "None" not in why, "no stray None leaks into a message a human reads"
    assert why.startswith("generated_under_glob read an absent")


def test_a_scan_with_NO_HELPER_still_produces_a_readable_refusal():
    """The `scan.get` default. A scan from a future caller that omits the key must not produce
    "None examined an empty population" — the fallback is what keeps the sentence a sentence."""
    why = M.unmeasured_zero({"matched": 0, "examined": 0})
    assert why is not None and "None" not in why
    assert why.startswith("a counting helper"), "the fallback label, not the absence of one"


# ── EVERY TERMINAL EMITS A VERDICT ────────────────────────────────────────────────────────────────
def test_the_crash_refusal_is_UNKNOWN_when_part_of_the_diff_WAS_measured():
    """The mixed case, and it is the COMMON one: the driver refuses if ANY glob crashed "even when
    others ran cleanly". A run that fully mutated six functions and lost a seventh did not examine
    nothing, and saying NOT_RUN about it describes the reader's ignorance rather than the run."""
    status, reason = M.crash_refusal_verdict(1, 44)
    assert status == "UNKNOWN"
    assert "44 mutant(s) were decided" in reason
    assert "unmeasured, not killed" in reason
    # …and it says WHAT happened, not only how much. `what` survived as `None` because every
    # assertion here was on the second half of the sentence: a reason reading "None; 44 mutant(s)
    # were decided" is well-formed, passes a substring check, and tells the reader nothing about the
    # crash that caused the refusal.
    assert "1 glob(s) recorded 0 tested mutants" in reason
    assert "crashed AFTER generation" in reason


def test_the_crash_refusal_is_NOT_RUN_when_nothing_was_decided_anywhere():
    status, reason = M.crash_refusal_verdict(3, 0)
    assert status == "NOT_RUN"
    assert "NOT ONE mutant was decided" in reason
    assert "examined nothing" in reason
    assert "3 glob(s) recorded 0 tested mutants" in reason and "crashed AFTER generation" in reason


def test_the_crash_split_is_the_SAME_RULE_as_its_three_siblings():
    """Four refusals, one split — a fourth spelling of it would be a fourth thing to get wrong.
    Asserted as a property over all of them rather than restated per function."""
    cases = [
        M.crash_refusal_verdict(1, 0),
        M.memory_exhaustion_verdict(1, 0),
        M.budget_exhaustion_verdict(1, 0, 10.0),
    ]
    assert [s for s, _ in cases] == ["NOT_RUN"] * 3, "nothing decided ⇒ the run examined nothing"
    cases = [
        M.crash_refusal_verdict(1, 7),
        M.memory_exhaustion_verdict(1, 7),
        M.budget_exhaustion_verdict(1, 7, 10.0),
    ]
    assert [s for s, _ in cases] == ["UNKNOWN"] * 3, "something decided ⇒ measured in part, cannot speak for the rest"
    # THE BOUNDARY, which is where the split actually lives. `decided > 0` → `decided > 1` survived:
    # under it a run that decided exactly ONE mutant reports "examined nothing". One is not nothing —
    # that mutant was run, and its result is the only thing standing between this run and a false
    # NOT_RUN. Asserted for all three so the boundary cannot drift apart between them.
    cases = [
        M.crash_refusal_verdict(1, 1),
        M.memory_exhaustion_verdict(1, 1),
        M.budget_exhaustion_verdict(1, 1, 10.0),
    ]
    assert [s for s, _ in cases] == ["UNKNOWN"] * 3, "ONE decided mutant is something, not nothing"


def test_EVERY_TERMINAL_IN_main_EMITS_A_VERDICT_OBJECT():
    """THE CLASS, not the instance. `return 2` sat in the §3 crash refusal for months: the one exit
    from `main()` that produced no `tepna.verdict/1` object and, with `--json`, wrote no artifact — so
    a consumer polling that file saw the PREVIOUS run's verdict, or nothing, for a run that refused.
    §🧾 requires one object from every gate that decides something, and nothing asserted it.

    Checked on the AST, not on the text: a reformat moves `return` lines and this must survive that
    (measured the hard way on #3196, where a whole-tree reformat broke four source-text scans).

    Two exits are allowed BY NAME and for a stated reason, never by a count — an allowlist that says
    "and two others" is how the third one gets in."""
    import ast as _ast
    import pathlib as _pl

    src = (_pl.Path(__file__).resolve().parent.parent / "tools" / "mutate_diff.py").read_text()
    main = next(n for n in _ast.walk(_ast.parse(src)) if isinstance(n, _ast.FunctionDef) and n.name == "main")
    # Names bound to the result of an `emit(...)` call: `_b = emit(...)` then `return _b` emits.
    emitted_names = {
        t.id
        for node in _ast.walk(main)
        if isinstance(node, _ast.Assign)
        and isinstance(node.value, _ast.Call)
        and isinstance(node.value.func, _ast.Name)
        and node.value.func.id == "emit"
        for t in node.targets
        if isinstance(t, _ast.Name)
    }
    assert emitted_names, "no `x = emit(...)` found — the scan is looking at the wrong function"
    # `_refusal` holds a previously emitted verdict under --report-only; it is re-returned, not a new exit.
    emitted_names.add("_refusal")

    nested = {d for d in _ast.walk(main) if isinstance(d, _ast.FunctionDef) and d is not main}
    nested_returns = {r for d in nested for r in _ast.walk(d) if isinstance(r, _ast.Return)}

    ALLOWED = {
        "selftest()": "--selftest runs the pure selftest and is not a gate verdict about a diff",
        "0": "--verdict-sample prints a synthetic object itself and exits; the adoption gate reads stdout",
    }
    offenders = []
    for node in _ast.walk(main):
        if not isinstance(node, _ast.Return) or node in nested_returns:
            continue
        v = node.value
        if isinstance(v, _ast.Call) and isinstance(v.func, _ast.Name) and v.func.id == "emit":
            continue
        if isinstance(v, _ast.Name) and v.id in emitted_names:
            continue
        if v is not None and _ast.unparse(v) in ALLOWED:
            continue
        offenders.append((node.lineno, _ast.unparse(v) if v else "None"))
    assert not offenders, (
        "every exit from main() must go through emit(), which is what builds the verdict object and "
        f"writes --json. Not via emit: {offenders}"
    )
