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


# ── node-id exclusions: the file must still run, one test must not ────────────────────────────────
#
# The file-granular exclusion above has no move when the fatal test lives in the module's PRIMARY
# test file — dropping `test_capture_runners.py` would remove ~280 of capture.py's tests to silence
# one. These pin the narrower instrument.


def test_a_node_id_exclusion_KEEPS_the_file():
    """The whole point: the file stays selected, so its other tests still kill mutants."""
    cands = [("tests/test_capture_runners.py", "capture things")]
    kept, dropped = S.select_tests(cands, "capture",
                                   excluded=frozenset({"tests/test_capture_runners.py::test_x"}))
    assert kept == ["tests/test_capture_runners.py"], "a node id must not drop its file"
    assert dropped == [], "a node id is not a file exclusion"


def test_deselect_args_emits_pytest_flags_sorted():
    args = S.deselect_args({"tests/b.py::test_2": "m.py", "tests/a.py::test_1": "m.py"})
    assert args == ["--deselect", "tests/a.py::test_1", "--deselect", "tests/b.py::test_2"], \
        "sorted, so the emitted config is stable across runs"
    assert S.deselect_args({}) == []


def test_the_note_is_scoped_to_the_module_the_test_actually_SCANS():
    """⚠️ The deselection is global; the cost it carries is not. The live entry greps
    a module-level source scan of capture, so it cannot kill an `alerts` mutant — reporting "reads as
    SURVIVING" for alerts.py would manufacture the same false risk as a false REACHABLE, and did:
    scoping took the note from 23 modules to 1."""
    d = {"tests/test_capture_runners.py::test_x": "capture.py"}
    kept = ["tests/test_capture_runners.py"]
    assert S.deselect_notes("capture.py", kept, d) == ["tests/test_capture_runners.py::test_x"]
    assert S.deselect_notes("alerts.py", kept, d) == [], "not reported where it cannot cost anything"


def test_the_note_is_silent_when_the_file_is_not_even_selected():
    d = {"tests/test_capture_runners.py::test_x": "capture.py"}
    assert S.deselect_notes("capture.py", ["tests/test_other.py"], d) == []


def test_a_None_scope_reports_nowhere():
    """A test that kills no mutant costs nothing to exclude, so warning about it would manufacture
    the same false work as a false REACHABLE. The git-mode assertion is exactly that: mutating a
    function cannot break a claim about a committed file mode."""
    d = {"tests/test_check_script.py::test_mode": None}
    kept = ["tests/test_check_script.py"]
    assert S.deselect_notes("capture.py", kept, d) == []
    assert S.deselect_notes("check_script.py", kept, d) == []
    assert S.deselect_args(d) == ["--deselect", "tests/test_check_script.py::test_mode"],         "still deselected — silent about cost is not the same as not applied"


def test_the_live_entries_are_pinned_with_their_reasons():
    """Pins the real exclusions, so deleting one is a deliberate act rather than an accident. The two
    are here because they cannot be made mutation-safe by routing through `_srcscan`: two shell out to
    git against the tree they run in (the scratch tree is a copy, not a repo), and one reads a
    coroutine's frame locals (under mutation that frame is mutmut's dispatch trampoline). A source scan
    is NOT in this table — `module_source()` handles those without losing the test."""
    assert S.DESELECTED_TESTS == {
        "tests/test_check_script.py::test_check_sh_is_executable_and_shebanged": None,
        "tests/test_vigil_update.py::test_a_unit_that_directly_execs_a_repo_script_requires_the_exec_bit": None,
        "tests/test_cpap_spool_wire.py::test_every_documented_spool_pull_key_is_actually_READ": "capture.py",
    }
    assert sum(v is None for v in S.DESELECTED_TESTS.values()) == 2, \
        "the free ones assert a committed FILE MODE; mutating a function cannot break that"
    assert "::" not in "".join(S.SOURCE_SCANNING_TESTS), "file entries stay file-granular"
