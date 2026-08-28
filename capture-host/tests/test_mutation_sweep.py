# tepna-capture — tests/test_mutation_sweep.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`mutation_sweep` — what a mutation sweep MEASURES, and when it must refuse to guess.

These exist because the logic lived in `tools/mutate.py`, outside the coverage denominator, where a
budget derived from a clean run that never actually ran was indistinguishable from a real one."""

import os
import sys


sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import mutation_sweep as S  # noqa: E402


# ── budget: a FAILED measurement must not become a plausible number ─────────────────────────────

def test_a_clean_run_that_DID_NOT_PASS_refuses_instead_of_taking_the_floor():
    """🔴 THE DEFECT THIS UNIT CLOSES. `clean_run_seconds` discarded the subprocess return code, so a
    clean run failing in ~0.2 s (collection error, bad path, missing plugin) produced a budget of
    max(1800, 60) = the FLOOR. For webmon — 21.5 s clean, 6450 s real budget — that is a silent
    collapse to 1800 s, which is the documented "exceeded the per-module timeout twice and stayed
    unmeasured" outcome arriving through a different door.

    The elapsed time of a crashed run is still a well-formed float. Nothing downstream could tell."""
    verdict, budget, why = S.budget_verdict(0.2, measured_ok=False)
    assert verdict == S.BUDGET_REFUSED
    assert budget is None, "a failed measurement produced a number anyway"
    assert 'measures nothing' in why
    # ⚠️ The control that matters: the refusal and the floor must not be the same answer.
    ok_verdict, ok_budget, _ = S.budget_verdict(0.2, measured_ok=True)
    assert ok_verdict == S.BUDGET_OK and ok_budget == 1800
    assert budget != ok_budget


def test_a_passing_clean_run_scales_at_300x_with_an_1800s_floor():
    assert S.budget_verdict(0.2, True)[1] == 1800          # floor dominates a fast module
    assert S.budget_verdict(21.5, True)[1] == 6450         # webmon: 300x, well above the floor
    assert S.budget_verdict(10.0, True)[0] == S.BUDGET_OK


def test_an_implausible_duration_refuses_even_when_the_run_passed():
    """Zero or negative elapsed time is not a fast module, it is a broken clock or a stubbed call."""
    for bad in (0.0, -1.0):
        verdict, budget, why = S.budget_verdict(bad, True)
        assert verdict == S.BUDGET_REFUSED and budget is None
        assert 'implausible' in why


def test_no_int_convenience_wrapper_survives_without_a_caller():
    """`budget_for(sec) -> int` was written, then deleted the same hour when `find_unwired` reported
    it as referenced only by these tests. The tool needs the REFUSAL and calls `budget_verdict`;
    nothing called the int form. Pinned so it does not get re-added on the same false rationale —
    "back-compat" was carried over from `mutation_diff`, where the wrapper had real prior callers."""
    assert not hasattr(S, 'budget_for')


# ── selection: an exclusion must be REPORTED, never dropped silently ────────────────────────────

# ⚠️ THE OWN-NAME FILE IS DELIBERATELY NOT FIRST HERE. It used to be, and that made
# `test_..._own_file_first` pass WITHOUT the reordering ever running: `kept[0]` was already correct
# by accident of fixture order, so `own = f"tests/test_{stem}.py" -> own = None` survived mutation.
# Ordering it after `test_other.py` makes the reorder load-bearing — the assertion now fails unless
# the code actually moves it. Same root cause as the single-dot names in mutation_triage: a fixture
# that reaches the right answer for the wrong reason observes nothing.
_CANDS = [
    ("tests/test_alpha.py", "import alpha\n"),
    ("tests/test_other.py", "clockcfg is mentioned here\n"),
    ("tests/test_no_deprecated_apis.py", "clockcfg appears but this test greps SOURCE\n"),
    ("tests/test_clockcfg.py", "from clockcfg import x\n"),
    ("tests/test_unrelated.py", "nothing to see\n"),
]


def test_selection_takes_every_file_that_NAMES_the_module_own_file_first():
    """The own-name file must be MOVED to the front, not merely happen to be there — `_CANDS` lists
    it third precisely so this assertion observes the reordering rather than the fixture's order."""
    kept, dropped = S.select_tests(_CANDS, "clockcfg")
    assert [p for p, _ in _CANDS].index("tests/test_clockcfg.py") > 0, "fixture must not pre-sort it"
    assert kept[0] == "tests/test_clockcfg.py", "the own-name file must lead"
    assert set(kept) == {"tests/test_clockcfg.py", "tests/test_other.py"}
    assert "tests/test_unrelated.py" not in kept


def test_an_excluded_test_is_RETURNED_not_silently_dropped():
    """⚠️ THE COST OF THE EXCLUSION IS A FALSE SURVIVOR — a mutant killed ONLY by an excluded test is
    reported as SURVIVING, sending someone to write a test for a mutant that is already dead. That
    cost was invisible: the exclusion happened inside a list comprehension and nothing said so."""
    kept, dropped = S.select_tests(_CANDS, "clockcfg")
    assert dropped == ["tests/test_no_deprecated_apis.py"]
    assert "tests/test_no_deprecated_apis.py" not in kept


def test_selection_is_stable_when_the_module_has_no_own_test_file():
    kept, dropped = S.select_tests(_CANDS, "alpha")
    assert kept == ["tests/test_alpha.py"] and dropped == []
    assert S.select_tests(_CANDS, "absent") == ([], [])


def test_a_caller_may_override_the_exclusion_set():
    kept, dropped = S.select_tests(_CANDS, "clockcfg", excluded=frozenset())
    assert "tests/test_no_deprecated_apis.py" in kept and dropped == []
