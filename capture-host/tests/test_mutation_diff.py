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
