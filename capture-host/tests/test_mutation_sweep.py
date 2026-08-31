# tepna-capture — tests/test_mutation_sweep.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`mutation_sweep` — what a mutation sweep MEASURES, and when it must refuse to guess.

These exist because the logic lived in `tools/mutate.py`, outside the coverage denominator, where a
budget derived from a clean run that never actually ran was indistinguishable from a real one."""

import os
import sys
from pathlib import Path


sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

HERE = Path(__file__).resolve().parent.parent

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


def test_the_file_part_of_a_CLASS_BASED_node_id_still_matches():
    """A node id can carry more than one `::` — pytest writes `file.py::Class::test_m` for a method.
    Only the FIRST segment is the file, so the split must be left-anchored: `rsplit` would yield
    `tests/test_c.py::TestC`, which matches no entry in `kept`, and the note would vanish with no
    error anywhere. Every other case in this file has exactly one `::`, where split and rsplit agree
    — so this is the only shape that can tell them apart."""
    d = {"tests/test_c.py::TestC::test_m": "capture.py"}
    kept = ["tests/test_c.py"]
    assert S.deselect_notes("capture.py", kept, d) == ["tests/test_c.py::TestC::test_m"]
    assert S.deselect_notes("capture.py", ["tests/test_c.py::TestC"], d) == [], \
        "the file part is the whole first segment, not everything up to the last separator"


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


def test_the_driver_bounds_a_SINGLE_mutant_not_just_the_module():
    """A per-module cap cannot see one spinning mutant, so the per-mutant knob must stay set.

    Measured 2026-08-30 on `capture.x_clock_watchdog__mutmut_*`: one worker at 29:26 CPU out of 29:27
    wall with 23 siblings idle, while capture.py's derived module cap sat at 243370 s (67.6 hours) —
    nowhere near hit, and nothing else was going to stop it. Mutating a sleep inside a watchdog loop
    is an ordinary way to get a mutant that never returns.

    mutmut already enforces this per mutant, as
    `(estimated_time_of_tests + timeout_constant) * timeout_multiplier` via SIGXCPU, where the estimate
    is the summed duration of the tests covering that function. The driver simply never set the knob,
    and the default 15 is generous once many tests cover one function — the mutant above needed a sum
    of only ~116 s to buy half an hour. This pins the setting: it is one line in a format string, which
    is exactly the kind of line a refactor drops without any test noticing.

    NOTE this reads `tools/mutate.py`, which is NOT a mutatable module (`_mutatable_modules()` globs the
    capture-host ROOT), so the raw read is safe and does not need `_srcscan`.
    """
    src = (HERE / "tools" / "mutate.py").read_text(encoding="utf-8")
    # Anchor on the TABLE and read forward. `src.split("timeout_multiplier")[0]` splits at the first
    # occurrence, which is the header comment ABOVE explaining the setting — the very idiom
    # `tests/_srcscan.py` warns about, and it fails here the moment the thing is documented.
    assert "[tool.mutmut]" in src, "the driver no longer writes a [tool.mutmut] table"
    table = src.split("[tool.mutmut]", 1)[1].split('"""', 1)[0]
    assert "timeout_multiplier = 3.0" in table, (
        "the per-mutant timeout is unset inside [tool.mutmut] — a runaway mutant will hang the whole "
        f"run behind the module cap, which cannot distinguish it from honest work. Table was:\n{table}")


def test_the_CLEAN_RUN_applies_the_deselections_too():
    """The baseline must run the SAME selection the mutants will, or it licenses a different thing.

    This is the defect that kept `capture.py` unmeasurable through #1954, #1959 and a re-run against
    current main. `deselect_args()` was wired into the mutmut CONFIG — so MUTANT runs honoured it —
    and NOT into `clean_run_seconds`. The two tests that ask git about the tree they run in therefore
    failed in the baseline (mutmut's scratch is a copy, not a repo), `clean_ok` came back False, and
    every glob died with "no budget: the clean run did not pass", so `mutate_diff` REFUSED. The gate
    reported a failure that looked like a mutation finding and was a harness gap.

    Reproduced 2026-08-31 by `git archive origin/main | tar -x` into a non-git dir: exactly 2 failed,
    5537 passed — both of them entries in DESELECTED_TESTS. With the args applied, the same two files
    give 42 passed, 2 deselected.

    Anchored on the FUNCTION via ast, not on a substring: `deselect_args` also appears at the config
    site and in this module's imports, so a bare `in src` would pass while the baseline still ignored
    it — the same first-occurrence trap that bit the timeout pin above.
    """
    import ast

    src = (HERE / "tools" / "mutate.py").read_text(encoding="utf-8")
    fn = next((n for n in ast.walk(ast.parse(src))
               if isinstance(n, ast.FunctionDef) and n.name == "clean_run_seconds"), None)
    assert fn is not None, "clean_run_seconds is gone — this pin is stale, not passing"
    calls = {ast.unparse(c.func) for c in ast.walk(fn) if isinstance(c, ast.Call)}
    assert "deselect_args" in calls, (
        "clean_run_seconds no longer applies deselect_args(), so the baseline runs a DIFFERENT "
        "selection than the mutants. A test that cannot pass in a scratch tree then fails the clean "
        "run, and every mutant reports 'no budget' — a harness gap wearing the shape of a finding.")


def test_a_refusing_clean_run_SAYS_WHICH_TEST_FAILED():
    """A refusal must carry its reason, or the run that already knows makes you go find out.

    `clean_run_seconds` passes `capture_output=True` and used to throw the report away, returning only
    `False`. Downstream that became "no budget: the clean run did not pass, so its duration measures
    nothing" and then `mutate-diff: REFUSING` — honest, and undiagnosable. Three CI runs and a local
    reproduction went into identifying a test the failing run had already named to itself.

    The failure here is almost always a test that cannot pass in mutmut's scratch tree (a COPY, not a
    repo), and the remedy is a `DESELECTED_TESTS` entry — which you can only write if you are told the
    node id.

    Pinned structurally on the function, not on a substring: `r.stdout` and `returncode` appear
    elsewhere in the module, so `in src` would pass while this function stayed silent."""
    import ast

    src = (HERE / "tools" / "mutate.py").read_text(encoding="utf-8")
    fn = next((n for n in ast.walk(ast.parse(src))
               if isinstance(n, ast.FunctionDef) and n.name == "clean_run_seconds"), None)
    assert fn is not None, "clean_run_seconds is gone — this pin is stale, not passing"
    assert any(isinstance(n, ast.Call) and getattr(n.func, "id", "") == "print"
               for n in ast.walk(fn)), (
        "clean_run_seconds no longer reports the failure it captured — a refusal that cannot name "
        "the failing test sends the next reader through the whole diagnosis again")
    assert any(isinstance(n, ast.If) for n in ast.walk(fn)), \
        "the report must be conditional on failure, not printed over a passing run"
