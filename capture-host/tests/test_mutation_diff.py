# tepna-capture — tests/test_mutation_diff.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`mutation_diff` — the decision logic of the diff-scoped mutation gate.

These exist because the logic they cover spent weeks in `tools/`, OUTSIDE the coverage denominator,
where `is_string_only` gave a well-formed WRONG ANSWER and nothing said so. The file shipped a
`--selftest` that no gate invoked, which is a mitigation that runs for nobody."""

import os
import sys

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
    plain = _d('        data = json.loads(Path(p).read_text(encoding="utf-8"))',
               '        data = json.loads(Path(p).read_text(encoding=None))')
    with_unrelated_literal = _d('        src = (Path(work) / "mutants" / m).read_text(encoding="utf-8")',
                                '        src = (Path(work) / "mutants" / m).read_text(encoding=None)')
    assert M.is_string_only(plain) is False
    assert M.is_string_only(with_unrelated_literal) is False, (
        "regression: an unrelated literal elsewhere on the line decided the verdict again")


def test_is_string_only_TRUE_only_when_the_change_lands_inside_a_literal():
    assert M.is_string_only(_d('    log.info("hello")', '    log.info("goodbye")')) is True
    # A genuine literal mutation carrying NO mutmut sentinel — keying on `XX` alone would miss it.
    assert M.is_string_only(_d('    x = "utf-8"', '    x = "UTF-8"')) is True


def test_is_string_only_honours_the_mutmut_XX_sentinel():
    assert M.is_string_only('--- a\n+++ b\n+    s = "XXhelloXX"\n') is True


def test_is_string_only_refuses_when_it_cannot_compare():
    assert M.is_string_only('--- a\n+++ b\n-    x = 1\n') is False        # no added line
    assert M.is_string_only('--- a\n+++ b\n-    a = 1\n-    b = 2\n+    a = 2\n') is False  # unbalanced
    # ⚠️ NOT a refusal: identical lines yield no span, the loop `continue`s, and the function falls
    # through to True — i.e. a no-op diff is EXCLUDED from the gate. Defensible ("nothing to require")
    # but it is the fail-OPEN direction. Pinned as observed behaviour; this unit MOVES the logic and
    # does not change it. Flagged for review rather than silently altered.
    assert M.is_string_only(_d('    x = 1', '    x = 1')) is True


# ── changed_span / _string_spans ────────────────────────────────────────────────────────────────

def test_changed_span_trims_the_common_prefix_and_suffix():
    assert M.changed_span('abc', 'abc') is None
    assert M.changed_span('x = 1', 'x = 2') == (4, 5, 5)


def test_string_spans_tracks_the_delimiter_and_honours_escapes():
    assert M._string_spans('a = "hi"') == [(4, 8)]
    assert M._string_spans("a = 'x' + \"y\"") == [(4, 7), (10, 13)]
    assert M._string_spans(r'a = "he\"llo"') == [(4, 13)]
    assert M._string_spans('a = 1') == []
    assert M._string_spans('a = "unterminated') == [(4, 17)]


# ── functions_covering — now PURE (takes text, not a path) ──────────────────────────────────────

_SRC = "import os\n\n\ndef alpha():\n    return 1\n\n\nclass C:\n    def beta(self):\n        return 2\n"


def test_functions_covering_names_module_functions_and_methods_the_mutmut_way():
    assert M.functions_covering(_SRC, {5}) == {"x_alpha"}
    assert M.functions_covering(_SRC, {10}) == {"xǁCǁbeta"}
    assert M.functions_covering(_SRC, {5, 10}) == {"x_alpha", "xǁCǁbeta"}


def test_functions_covering_yields_nothing_outside_a_function_or_on_bad_source():
    assert M.functions_covering(_SRC, {1}) == set()          # an import line
    assert M.functions_covering("def broken(:\n", {1}) == set()
    assert M.functions_covering("", {1}) == set()            # the caller's unreadable-file case


# ── diff_key ────────────────────────────────────────────────────────────────────────────────────

def test_diff_key_is_whitespace_normalised_and_index_independent():
    assert M.diff_key(_d('    x = 1', '    x = 2')) == M.diff_key(_d('  x  =  1', '  x   =   2'))
    assert '__mutmut_' not in M.diff_key(_d('    x = 1', '    x = 2'))
    assert M.diff_key('--- a\n+++ b\n context only\n') == ''


# ── refusal_reason — the guard against failing OPEN ─────────────────────────────────────────────

def test_refusal_reason_is_None_only_when_the_run_could_actually_check_something():
    assert M.refusal_reason(True, 0) is None
    assert M.refusal_reason(False, 0) is not None
    assert M.refusal_reason(True, 1) is not None
    assert M.refusal_reason(True, None) is not None


# ── classify + the moved selftest ───────────────────────────────────────────────────────────────

def test_classify_splits_all_five_outcomes():
    E = [{"key": "a", "class": "no-distinguishing-input"},
         {"key": "b", "class": "untestable-by-design"},
         {"key": "c", "class": "real-gap"},
         {"key": "d", "class": "no-distinguishing-input"},
         {"key": "e", "class": "no-distinguishing-input"}]
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
    monkeypatch.setattr(M, 'classify', lambda e, s, g: {k: [] for k in
                        ('excused', 'real_gap', 'refuted', 'orphaned', 'unclassified')})
    assert M.selftest() != 0


def test_selftest_FAILS_when_a_killed_mutant_leaks_into_unclassified(monkeypatch):
    real = M.classify

    def leaky(e, s, g):
        out = real(e, s, g)
        out['unclassified'] = out['unclassified'] + [{'key': 'd'}]
        return out

    monkeypatch.setattr(M, 'classify', leaky)
    assert M.selftest() != 0


def test_selftest_FAILS_if_is_string_only_regresses_in_EITHER_direction(monkeypatch):
    """Both directions, because the file records both mistakes: the original bug (a keyword change
    read as string-only because the LINE held a quote) and the tempting over-correction (keying on
    mutmut's XX sentinel alone, which starts REQUIRING genuine literal mutations)."""
    monkeypatch.setattr(M, 'is_string_only', lambda d: True)     # over-broad, the original bug
    assert M.selftest() != 0
    monkeypatch.setattr(M, 'is_string_only', lambda d: False)    # over-narrow, the over-correction
    assert M.selftest() != 0


def test_selftest_FAILS_when_any_span_or_key_helper_regresses(monkeypatch):
    """The remaining selftest guards, each forced. Without these the FAIL branches never execute, so
    the selftest would be trusted for checks that had never once been shown to bite."""
    for name, broken in (
        ('changed_span', lambda a, b: (0, 0, 0)),
        ('_string_spans', lambda ln: []),
        ('diff_key', lambda d: 'constant'),
        ('refusal_reason', lambda v, rc: None),
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
    v, why = M.string_only_verdict(_d('    x = 1', '    x = 1'))
    assert v == M.EMPTY_DIFF, f"a no-op diff came back as {v}"
    assert v != M.STRING_ONLY
    assert 'identical' in why
    assert M.is_string_only(_d('    x = 1', '    x = 1')) is True   # still excluded, deliberately


def test_a_real_log_mutation_is_STRING_ONLY_not_EMPTY_DIFF():
    """The other direction of the same control: the two buckets must not collapse into each other."""
    v, _ = M.string_only_verdict(_d('    log.info("hello")', '    log.info("goodbye")'))
    assert v == M.STRING_ONLY


def test_a_scan_outside_its_competence_REFUSES_instead_of_guessing(monkeypatch):
    """⚠️ `_string_spans` disclaims triple quotes and f-string nesting IN ITS OWN DOCSTRING, and
    outside them it returns a confident WRONG answer rather than failing — the 2026-08-24 defect one
    level down. Refusing is the only honest verdict, and it must not be silently excludable."""
    tq = chr(34) * 3
    v, why = M.string_only_verdict(_d('    x = f(1)  # ' + tq, '    x = f(2)  # ' + tq))
    assert v == M.UNDECIDABLE, f"a triple-quoted line was decided anyway: {v}"
    assert 'competence' in why
    # An unterminated literal is the second detectable case.
    assert M.scan_is_reliable('a = "open') is False
    assert M.scan_is_reliable('a = "closed"') is True
    # An ESCAPED quote must not be mistaken for the terminator — otherwise the scan would call a
    # perfectly readable line unreliable and the gate would start demanding literal mutations.
    assert M.scan_is_reliable('a = "he\\"llo"') is True
    assert M.scan_is_reliable('a = ' + tq + 'x' + tq) is False


def test_UNDECIDABLE_fails_CLOSED_through_the_back_compat_bool():
    """A caller still on the bool API must get the SAFE direction: required, never excluded. This is
    the property that makes the refusal harmless to add — the old API cannot start skipping mutants."""
    tq = chr(34) * 3
    undecidable = _d('    x = f(1)  # ' + tq, '    x = f(2)  # ' + tq)
    assert M.string_only_verdict(undecidable)[0] == M.UNDECIDABLE
    assert M.is_string_only(undecidable) is False


def test_the_bool_and_the_verdict_can_never_disagree():
    """`is_string_only` is DERIVED from the verdict rather than reimplementing it. Pinned because a
    bool and a verdict drifting apart is precisely the defect class this file keeps producing."""
    tq = chr(34) * 3
    for diff in (_d('    x = 1', '    x = 2'), _d('    s = "a"', '    s = "b"'),
                 _d('    x = 1', '    x = 1'), _d('  y = f(1) # ' + tq, '  y = f(2) # ' + tq),
                 '--- a\n+++ b\n+    s = "XXhiXX"\n', '--- a\n+++ b\n-    x = 1\n'):
        expected = M.string_only_verdict(diff)[0] in (M.STRING_ONLY, M.EMPTY_DIFF)
        assert M.is_string_only(diff) is expected


def test_selftest_FAILS_if_the_two_exclusions_collapse_again(monkeypatch):
    """The 1b guard, forced in every direction it can regress. Without this the new selftest checks
    would be trusted having never once been shown to bite."""
    for broken in (lambda d: (M.STRING_ONLY, 'x'), lambda d: (M.EMPTY_DIFF, 'x'),
                   lambda d: (M.REQUIRED, 'x')):
        with monkeypatch.context() as mp:
            mp.setattr(M, 'string_only_verdict', broken)
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
    assert M.scan_is_reliable("(((") is True                       # parens are not a quote sentinel
    assert M.scan_is_reliable(chr(39) * 3) is False                # a real triple-apostrophe
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
    assert M.functions_covering(src, {4}) == {"x_alpha"}     # the `def` line
    assert M.functions_covering(src, {5}) == {"x_alpha"}     # and the body


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
    ok, why = M.annotation_only("def f(x: float): return x",
                                "def f(x: float | None): return x")
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
    monkeypatch.setattr(M, "annotation_only",
                        lambda a, b: (True, "stripped ASTs identical"))
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
    assert M.function_of_mutant("not_a_mutant") == ""     # no __mutmut_N suffix
    assert M.function_of_mutant("") == ""
    assert M.function_of_mutant("x__mutmut_1") == ""      # suffix, but no name left after `x_`
    assert M.function_of_mutant("ǁǁ__mutmut_1") == ""     # separators, no parts
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
    src = ("import contextlib, functools\n"
           "@contextlib.asynccontextmanager\n"
           "async def scope():\n    yield 1\n"
           "@functools.lru_cache()\n"
           "def cached_fn():\n    return 2\n")
    assert M.unmutatable_decorator(src, "scope") == "asynccontextmanager"
    assert M.unmutatable_decorator(src, "cached_fn") == "lru_cache"   # the @foo() CALL form counts


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
