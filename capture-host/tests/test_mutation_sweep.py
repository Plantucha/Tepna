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
    assert "measures nothing" in why
    # ⚠️ The control that matters: the refusal and the floor must not be the same answer.
    ok_verdict, ok_budget, _ = S.budget_verdict(0.2, measured_ok=True)
    assert ok_verdict == S.BUDGET_OK and ok_budget == 1800
    assert budget != ok_budget


def test_a_passing_clean_run_scales_at_300x_with_an_1800s_floor():
    assert S.budget_verdict(0.2, True)[1] == 1800  # floor dominates a fast module
    assert S.budget_verdict(21.5, True)[1] == 6450  # webmon: 300x, well above the floor
    assert S.budget_verdict(10.0, True)[0] == S.BUDGET_OK


def test_an_implausible_duration_refuses_even_when_the_run_passed():
    """Zero or negative elapsed time is not a fast module, it is a broken clock or a stubbed call."""
    for bad in (0.0, -1.0):
        verdict, budget, why = S.budget_verdict(bad, True)
        assert verdict == S.BUDGET_REFUSED and budget is None
        assert "implausible" in why


def test_no_int_convenience_wrapper_survives_without_a_caller():
    """`budget_for(sec) -> int` was written, then deleted the same hour when `find_unwired` reported
    it as referenced only by these tests. The tool needs the REFUSAL and calls `budget_verdict`;
    nothing called the int form. Pinned so it does not get re-added on the same false rationale —
    "back-compat" was carried over from `mutation_diff`, where the wrapper had real prior callers."""
    assert not hasattr(S, "budget_for")


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
    kept, dropped = S.select_tests(cands, "capture", excluded=frozenset({"tests/test_capture_runners.py::test_x"}))
    assert kept == ["tests/test_capture_runners.py"], "a node id must not drop its file"
    assert dropped == [], "a node id is not a file exclusion"


def test_deselect_args_emits_pytest_flags_sorted():
    args = S.deselect_args({"tests/b.py::test_2": "m.py", "tests/a.py::test_1": "m.py"})
    assert args == ["--deselect", "tests/a.py::test_1", "--deselect", "tests/b.py::test_2"], (
        "sorted, so the emitted config is stable across runs"
    )
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
    assert S.deselect_notes("capture.py", ["tests/test_c.py::TestC"], d) == [], (
        "the file part is the whole first segment, not everything up to the last separator"
    )


def test_a_None_scope_reports_nowhere():
    """A test that kills no mutant costs nothing to exclude, so warning about it would manufacture
    the same false work as a false REACHABLE. The git-mode assertion is exactly that: mutating a
    function cannot break a claim about a committed file mode."""
    d = {"tests/test_check_script.py::test_mode": None}
    kept = ["tests/test_check_script.py"]
    assert S.deselect_notes("capture.py", kept, d) == []
    assert S.deselect_notes("check_script.py", kept, d) == []
    assert S.deselect_args(d) == ["--deselect", "tests/test_check_script.py::test_mode"], (
        "still deselected — silent about cost is not the same as not applied"
    )


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
    assert sum(v is None for v in S.DESELECTED_TESTS.values()) == 2, (
        "the free ones assert a committed FILE MODE; mutating a function cannot break that"
    )
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
    # The knob is TEMPLATED since the timeout retry, because the gate re-runs a timed-out mutant at a
    # wider bound (residue `2026-10-19-a-mutant-whose-cost-is-a-wait-spends-its-own-bound`). What this
    # pin protects is unchanged: the table must still SET the knob, and the ordinary value must still be
    # the narrow one — a template that defaulted to mutmut's own 15.0 would restore the half-hour mutant
    # above while reading as configured.
    assert "timeout_multiplier = {timeout_multiplier}" in table, (
        "the per-mutant timeout is unset inside [tool.mutmut] — a runaway mutant will hang the whole "
        f"run behind the module cap, which cannot distinguish it from honest work. Table was:\n{table}"
    )
    import ast as _ast

    _consts = {}
    for _n in _ast.parse(src).body:
        if isinstance(_n, _ast.Assign) and isinstance(_n.targets[0], _ast.Name):
            if isinstance(_n.value, _ast.Constant):
                _consts[_n.targets[0].id] = _n.value.value
    assert _consts.get("TIMEOUT_MULTIPLIER") == 3.0, (
        f"the ORDINARY per-mutant bound is no longer the narrow one: {_consts.get('TIMEOUT_MULTIPLIER')!r}"
    )
    # 15.0 is mutmut's own default (`mutmut/configuration.py`), so the retry bound is PRE-STATED
    # upstream rather than derived from the run it judges (CLAUDE.md §🧾).
    assert _consts.get("WIDE_TIMEOUT_MULTIPLIER") == 15.0, (
        f"the retry bound is no longer mutmut's own default: {_consts.get('WIDE_TIMEOUT_MULTIPLIER')!r}"
    )
    _run_one = next(n for n in _ast.walk(_ast.parse(src)) if isinstance(n, _ast.FunctionDef) and n.name == "run_one")
    _defaults = dict(zip([a.arg for a in _run_one.args.args][-len(_run_one.args.defaults) :], _run_one.args.defaults))
    _tm = _defaults.get("timeout_multiplier")
    assert isinstance(_tm, _ast.Name) and _tm.id == "TIMEOUT_MULTIPLIER", (
        "run_one's bound no longer defaults to the narrow constant, so an ordinary caller may be "
        "running every mutant at the retry bound"
    )


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
    fn = next(
        (n for n in ast.walk(ast.parse(src)) if isinstance(n, ast.FunctionDef) and n.name == "clean_run_seconds"), None
    )
    assert fn is not None, "clean_run_seconds is gone — this pin is stale, not passing"
    calls = {ast.unparse(c.func) for c in ast.walk(fn) if isinstance(c, ast.Call)}
    assert "deselect_args" in calls, (
        "clean_run_seconds no longer applies deselect_args(), so the baseline runs a DIFFERENT "
        "selection than the mutants. A test that cannot pass in a scratch tree then fails the clean "
        "run, and every mutant reports 'no budget' — a harness gap wearing the shape of a finding."
    )


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
    fn = next(
        (n for n in ast.walk(ast.parse(src)) if isinstance(n, ast.FunctionDef) and n.name == "clean_run_seconds"), None
    )
    assert fn is not None, "clean_run_seconds is gone — this pin is stale, not passing"
    assert any(isinstance(n, ast.Call) and getattr(n.func, "id", "") == "print" for n in ast.walk(fn)), (
        "clean_run_seconds no longer reports the failure it captured — a refusal that cannot name "
        "the failing test sends the next reader through the whole diagnosis again"
    )
    assert any(isinstance(n, ast.If) for n in ast.walk(fn)), (
        "the report must be conditional on failure, not printed over a passing run"
    )


def test_the_clean_run_report_includes_the_ASSERTION_BODY_not_just_the_summary():
    """pytest's `FAILED …` line carries only the FIRST line of an assertion message.

    The body is where the reason lives. Reporting the summary alone produced
    `AssertionError: shellcheck findings:` with nothing after it — and that emptiness was read as
    evidence the tool had printed nothing, which sent a diagnosis down a wrong branch. It was the
    reporter truncating, not the tool being silent.

    A reporter that drops the body is worse than one that reports nothing: it manufactures a confident
    wrong conclusion out of its own filtering. Verified against a plant whose detail lines exist only
    in the body.

    Anchored on the function via ast; `FAILURES` is a common enough token that a substring check over
    the module would pass while this function still printed only the summary."""
    import ast

    src = (HERE / "tools" / "mutate.py").read_text(encoding="utf-8")
    fn = next(
        (n for n in ast.walk(ast.parse(src)) if isinstance(n, ast.FunctionDef) and n.name == "clean_run_seconds"), None
    )
    assert fn is not None, "clean_run_seconds is gone — this pin is stale, not passing"
    consts = {n.value for n in ast.walk(fn) if isinstance(n, ast.Constant) and isinstance(n.value, str)}
    assert any("FAILURES" in c for c in consts), (
        "clean_run_seconds no longer reads pytest's FAILURES section, so a refusal reports only the "
        "first line of the assertion — the part that says WHAT failed is dropped"
    )


# ── the exit code: a run that decided NOTHING must not read as a pass ────────────────────────────
#
# 🔴 `tools/mutate.py main()` ended `return 1 if skipped else 0`, so the skip count was the only
# fact that reached the shell. A `--only` glob matching no mutant put `"rc": 1` in the JSON, printed
# a full `mutmut results` listing where every line read `not checked`, and exited 0 over a 128 s run
# (measured 2026-10-18 on `writers.x_LinkLogWriter*__mutmut_*`; the corrected glob gave 42 mutants
# and one real survivor nobody had logged). The assertions below pin the reason TEXT, not a
# substring of it: a reason an operator cannot act on is the defect wearing a non-zero exit code.


def test_a_clean_sweep_exits_zero_because_A_SURVIVOR_IS_NOT_A_FAILURE():
    """`tools/mutate.py` is an audit tool. Survivors are its output, not its verdict."""
    code, reasons = S.sweep_exit_verdict([{"module": "writers.py", "rc": 0}, {"module": "oxyii.py", "rc": 0}])
    assert (code, reasons) == (0, [])


def test_a_GLOB_THAT_MATCHED_NOTHING_is_named_rather_than_left_as_a_return_code():
    """The measured case. `rc: 1` alone sends the reader to the tail; the glob is the first suspect."""
    rec = {
        "module": "writers.py",
        "rc": 1,
        "only": "writers.x_LinkLogWriter*__mutmut_*",
        "tail": "AssertionError: " + S.NO_MATCH_ASSERTION + "\n",
    }
    code, reasons = S.sweep_exit_verdict([rec])
    assert code == 1
    assert reasons == [
        "writers.py: mutmut exited 1 — the --only glob 'writers.x_LinkLogWriter*__mutmut_*' matched "
        "no mutant. mutmut 3.x names a method's mutants module.xǁClassǁmethod__mutmut_N, "
        "never Class_method"
    ]


def test_the_SEPARATOR_in_that_advice_is_the_character_mutmut_actually_uses():
    """U+01C1 LATIN LETTER LATERAL CLICK, not a pipe and not two ASCII bars.

    The advice exists to stop a second wrong glob. Spelling the separator with `||` would send the
    reader to a name mutmut never emits, which is the original defect with extra steps."""
    assert "ǁ" in S.sweep_exit_verdict([{"module": "w.py", "rc": 1, "only": "g", "tail": S.NO_MATCH_ASSERTION}])[1][0]
    assert (
        "||" not in S.sweep_exit_verdict([{"module": "w.py", "rc": 1, "only": "g", "tail": S.NO_MATCH_ASSERTION}])[1][0]
    )


def test_a_non_zero_run_WITHOUT_mutmuts_no_match_words_still_names_its_selection():
    """mutmut can fail for its own reasons. Naming the glob as the cause would be a fabrication, so
    the reason states the selection as a fact and stops."""
    code, reasons = S.sweep_exit_verdict([{"module": "writers.py", "rc": 2, "only": "writers.x_f__*", "tail": "boom"}])
    assert (code, reasons) == (1, ["writers.py: mutmut exited 2 — the selection was --only 'writers.x_f__*'"])


def test_a_non_zero_run_with_NO_selection_does_not_invent_one():
    code, reasons = S.sweep_exit_verdict([{"module": "writers.py", "rc": 3, "only": None}])
    assert (code, reasons) == (1, ["writers.py: mutmut exited 3"])


def test_an_ABSENT_TAIL_is_not_a_crash_and_is_not_a_match():
    """A run killed before it wrote a tail has `tail` absent or None. `None` is not a string, and
    reading the glob advice off it would be an absence treated as evidence either way."""
    for tail in (None, ""):
        code, reasons = S.sweep_exit_verdict([{"module": "w.py", "rc": 1, "only": "g", "tail": tail}])
        assert (code, reasons) == (1, ["w.py: mutmut exited 1 — the selection was --only 'g'"]), tail


def test_EVERY_way_a_run_can_decide_nothing_exits_non_zero_with_its_own_reason():
    """One record each, so a single shared reason cannot stand in for the set. The old code exited 0
    on all but the first."""
    cases = [
        (
            {"module": "a.py", "error": "no budget: the clean run did not pass"},
            "a.py: the run never started — no budget: the clean run did not pass",
        ),
        (
            {"module": "b.py", "skipped": "clean run 40.0s exceeds --budget 30s"},
            "b.py: skipped — clean run 40.0s exceeds --budget 30s. A skip is not a pass",
        ),
        (
            {"module": "c.py", "rc": 1, "generation_timed_out": "…"},
            "c.py: nothing was examined — mutant generation hit its own cap",
        ),
        (
            {"module": "d.py", "rc": 0, "results_timed_out": "…"},
            "d.py: the mutants' verdicts were never read — the results pass hit its cap",
        ),
        (
            {"module": "e.py", "rc": -9, "timed_out": True},
            "e.py: PARTIAL — the wall cap was hit, so unfinished mutants have no verdict",
        ),
        ({"module": "f.py"}, "f.py: no return code was recorded, so nothing says the run finished"),
        ({"module": "g.py", "rc": 1}, "g.py: mutmut exited 1"),
    ]
    for rec, want in cases:
        assert S.sweep_exit_verdict([rec]) == (1, [want]), rec


def test_an_ESTIMATE_owes_no_verdict_and_a_sweep_of_estimates_exits_zero():
    """`--estimate` prints a cost and stops. It has no `rc`, so the absent-return-code reason above
    would fire on every estimate and make the flag unusable."""
    assert S.sweep_exit_verdict([{"module": "a.py", "estimate_only": True, "clean_run_sec": 21.5}]) == (0, [])


def test_ONE_record_contributes_ONE_reason_and_it_names_the_EARLIEST_phase():
    """A generation that never finished also has a non-zero return code and a hit wall cap. Naming
    the later symptom sends the reader to the wrong phase to make smaller."""
    rec = {
        "module": "capture.py",
        "rc": 1,
        "timed_out": True,
        "generation_timed_out": "generation hit 600s",
        "results_timed_out": "results hit 300s",
        "only": "capture.x__now__*",
        "tail": S.NO_MATCH_ASSERTION,
    }
    assert S.sweep_exit_verdict([rec]) == (1, ["capture.py: nothing was examined — mutant generation hit its own cap"])


def test_a_MIXED_sweep_reports_every_undecided_module_in_order_and_skips_the_clean_ones():
    code, reasons = S.sweep_exit_verdict(
        [
            {"module": "a.py", "rc": 0},
            {"module": "b.py", "rc": 1},
            {"module": "c.py", "rc": 0},
            {"module": "d.py", "skipped": "too slow"},
        ]
    )
    assert code == 1
    assert reasons == ["b.py: mutmut exited 1", "d.py: skipped — too slow. A skip is not a pass"]


def test_a_sweep_that_NAMED_NO_MODULE_does_not_exit_zero():
    """`modules` is `nargs="*"`, so `mutate.py` with no arguments printed nothing, examined nothing
    and exited 0 — the glob defect one level up. `--list` returns before this."""
    assert S.sweep_exit_verdict([]) == (1, ["no module was examined — name at least one module, or use --list"])


def test_the_TOOL_reads_this_verdict_and_NO_LONGER_counts_only_skips():
    """`tools/mutate.py` is outside the coverage denominator, so the wiring is pinned by ast: the
    decision can be correct here and never reached there, which is how the old comment came to claim
    an invariant — "the same reason the tool refuses to report a timed-out module as complete" — that
    the code did not hold."""
    import ast

    src = (HERE / "tools" / "mutate.py").read_text(encoding="utf-8")
    fn = next(
        (n for n in ast.walk(ast.parse(src)) if isinstance(n, ast.FunctionDef) and n.name == "main"),
        None,
    )
    assert fn is not None, "mutate.py main() is gone — this pin is stale, not passing"
    called = {n.func.id for n in ast.walk(fn) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}
    assert "sweep_exit_verdict" in called, "main() decides its own exit code again"
    returns = [n for n in ast.walk(fn) if isinstance(n, ast.Return)]
    assert returns, "main() has no return"
    # The old shape was `return 1 if skipped else 0`: an IfExp over a counter. Any return that is a
    # bare conditional on a name is this defect coming back under a different variable.
    assert not any(isinstance(r.value, ast.IfExp) for r in returns), (
        "main() returns a conditional again — the exit code is being decided from a count rather than from the records"
    )


def test_the_record_CARRIES_the_selection_it_ran():
    """`sweep_exit_verdict` can only name the glob if the run recorded it. The plan had no `only`
    key, so the JSON could not distinguish a whole-module sweep from a one-function one."""
    import ast

    src = (HERE / "tools" / "mutate.py").read_text(encoding="utf-8")
    fn = next(
        (n for n in ast.walk(ast.parse(src)) if isinstance(n, ast.FunctionDef) and n.name == "run_one"),
        None,
    )
    assert fn is not None, "run_one is gone — this pin is stale, not passing"
    keys = {
        k.value
        for n in ast.walk(fn)
        if isinstance(n, ast.Dict)
        for k in n.keys
        if isinstance(k, ast.Constant) and isinstance(k.value, str)
    }
    assert "only" in keys, "run_one's record no longer carries the selection it ran"


def test_a_sweep_does_not_STOP_at_the_first_module_that_decided_nothing():
    """Every skip in the loop is a `continue`, and a `break` reads identically on any sweep whose
    undecided module happens to be LAST. The cost of the difference is an operator who fixes one
    module, re-runs the whole sweep, and finds the next — once per module. So the pin is one sweep
    carrying every undecided shape at once, with the reasons in the records' own order."""
    records = [
        {"module": "a.py", "estimate_only": True},
        {"module": "b.py", "error": "no budget"},
        {"module": "c.py", "skipped": "too slow"},
        {"module": "d.py", "rc": 1, "generation_timed_out": "gen cap"},
        {"module": "e.py", "rc": 0, "results_timed_out": "results cap"},
        {"module": "f.py", "rc": -9, "timed_out": True},
        {"module": "g.py"},
        {"module": "h.py", "rc": 0},
        {"module": "i.py", "rc": 1},
    ]
    code, reasons = S.sweep_exit_verdict(records)
    assert code == 1
    assert reasons == [
        "b.py: the run never started — no budget",
        "c.py: skipped — too slow. A skip is not a pass",
        "d.py: nothing was examined — mutant generation hit its own cap",
        "e.py: the mutants' verdicts were never read — the results pass hit its cap",
        "f.py: PARTIAL — the wall cap was hit, so unfinished mutants have no verdict",
        "g.py: no return code was recorded, so nothing says the run finished",
        "i.py: mutmut exited 1",
    ]


def test_a_record_with_NO_MODULE_NAME_still_produces_a_readable_reason():
    """`r.get("module", "?")`'s default is reached only by a record the tool did not build, which no
    other test here supplies. `str(None)` would print `None: mutmut exited 1` — a module named None,
    which reads as a fact rather than as a gap."""
    code, reasons = S.sweep_exit_verdict([{"rc": 1}])
    assert (code, reasons) == (1, ["?: mutmut exited 1"])


def test_the_TOOLS_printed_prefix_carries_NO_contract_status_word():
    """The row is `decides`/`adopted` since 2026-10-19, so `checkWordOnlyClaim` no longer binds — and
    the property it forced is worth keeping on its own terms. One surface carries the status now: the
    object. A `NOTHING DECIDED` prefix that also said `NOT_RUN` would give a reader and a grep two
    answers of different ages from one run, and the prose is the one that cannot be validated."""
    import ast

    src = (HERE / "tools" / "mutate.py").read_text(encoding="utf-8")
    fn = next(
        (n for n in ast.walk(ast.parse(src)) if isinstance(n, ast.FunctionDef) and n.name == "main"),
        None,
    )
    assert fn is not None, "mutate.py main() is gone — this pin is stale, not passing"
    printed = [
        n for n in ast.walk(fn) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "print"
    ]
    assert printed, "main() prints nothing"
    words = (
        "REFUSED",
        "VERDICT",
        "TALLY",
        "RECOVERED",
        "UNDERPOWERED",
        "SHORTFALL",
        "NOT_RUN",
        "NOT_APPLICABLE",
        "PASS",
        "FAIL",
    )
    for call in printed:
        for lit in (n.value for n in ast.walk(call) if isinstance(n, ast.Constant) and isinstance(n.value, str)):
            hit = [w for w in words if w in lit]
            assert not hit, f"main() prints a contract status word {hit} in {lit!r}; the object carries the status"


# ── the verdict object: which PHASE declined decides the status ─────────────────────────────────


def test_a_sweep_that_EXAMINED_NOTHING_is_NOT_RUN_over_checked_zero():
    """§🧾 separates the two zero-population statuses by what happened: `NOT_RUN` examined
    nothing. A sweep naming no module is that case, and the reason is the one the exit code prints."""
    code, reasons = S.sweep_exit_verdict([])
    f = S.sweep_verdict_fields([], reasons)
    assert code == 1
    assert f["status"] == "NOT_RUN"
    assert f["population"] == {"checked": 0, "eligible": 0, "excluded": 0}
    assert f["result"] is None
    assert f["reason"] == "no module was examined — name at least one module, or use --list"


def test_the_EMPTY_records_reason_has_a_FALLBACK_so_no_object_is_reasonless():
    """Every non-PASS carries a reason, and `verdict.make` refuses one that does not. The reasons come
    from the caller, so the builder cannot assume they are non-empty."""
    f = S.sweep_verdict_fields([], [])
    assert f["status"] == "NOT_RUN"
    assert f["reason"] == "the sweep named no module, so nothing was examined"


def test_an_ESTIMATE_ONLY_run_is_NOT_APPLICABLE_because_no_mutant_ever_EXISTED():
    """`--estimate` prices the sweep and stops before generation, so the kill requirement does not
    bind — the contract's own definition of NOT_APPLICABLE. The priced modules are EXCLUDED, not
    unexamined-eligible, and the identity holds."""
    recs = [{"module": "nightqc.py", "estimate_only": True}, {"module": "capture.py", "estimate_only": True}]
    f = S.sweep_verdict_fields(recs, [])
    assert f["status"] == "NOT_APPLICABLE"
    assert f["population"] == {"checked": 0, "eligible": 2, "excluded": 2}
    assert f["result"] is None
    assert "priced 2 module(s)" in f["reason"]


def test_an_UNDECIDED_module_is_UNKNOWN_and_NEVER_FAIL():
    """⚠️ A SURVIVOR IS NOT A FAILURE, and a module whose generation timed out says nothing about
    that module's tests. FAIL would claim it was measured and found wanting."""
    recs = [{"module": "writers.py", "generation_timed_out": True}]
    code, reasons = S.sweep_exit_verdict(recs)
    f = S.sweep_verdict_fields(recs, reasons)
    assert code == 1
    assert f["status"] == "UNKNOWN"
    assert f["result"] == {"modules": 1, "priced": 0, "examined": 1, "undecided": 1}
    assert f["reason"] == "writers.py: nothing was examined — mutant generation hit its own cap"


def test_UNDECIDED_counts_MODULES_and_the_reasons_ride_the_object_in_order():
    """One record contributes at most one reason, so the count is a module count. A reader of the
    object alone must still be able to name every module that declined."""
    recs = [{"module": "a.py", "rc": 0}, {"module": "b.py", "rc": 2, "only": None}, {"module": "c.py", "skipped": "no"}]
    code, reasons = S.sweep_exit_verdict(recs)
    f = S.sweep_verdict_fields(recs, reasons)
    assert code == 1
    assert f["result"]["undecided"] == 2
    assert f["result"]["examined"] == 3
    assert f["reason"] == "b.py: mutmut exited 2; c.py: skipped — no. A skip is not a pass"


def test_a_CLEAN_sweep_is_PASS_and_its_EVIDENCE_names_the_modules_examined():
    """A PASS with empty evidence is invalid under the contract, and "the tool ran" is not evidence of
    what it ran over. The module paths are what a reader can go and check."""
    recs = [{"module": "nightqc.py", "rc": 0}, {"module": "capture.py", "rc": 0}]
    code, reasons = S.sweep_exit_verdict(recs)
    f = S.sweep_verdict_fields(recs, reasons)
    assert (code, reasons) == (0, [])
    assert f["status"] == "PASS"
    assert f["reason"] is None
    assert f["population"] == {"checked": 2, "eligible": 2, "excluded": 0}
    assert f["evidence"] == [
        "capture-host/tools/mutate.py",
        "capture-host/mutation_sweep.py",
        "capture-host/nightqc.py",
        "capture-host/capture.py",
    ]


def test_a_record_with_NO_MODULE_NAME_contributes_no_evidence_PATH():
    """`run_one` can return a record without a module name, and `capture-host/` alone is not a path a
    reader can open. The reason still names the module as `?`, which is the readable absence."""
    recs = [{"rc": 0}, {"module": "capture.py", "rc": 0}]
    f = S.sweep_verdict_fields(recs, [])
    assert f["evidence"][-1] == "capture-host/capture.py"
    assert "capture-host/" not in f["evidence"][2:-1]
    assert f["population"] == {"checked": 2, "eligible": 2, "excluded": 0}


def test_a_MIXED_priced_and_examined_sweep_keeps_the_population_IDENTITY():
    recs = [{"module": "a.py", "estimate_only": True}, {"module": "b.py", "rc": 0}]
    f = S.sweep_verdict_fields(recs, [])
    pop = f["population"]
    assert pop["checked"] + pop["excluded"] == pop["eligible"] == 2
    assert f["status"] == "PASS"
    assert f["result"] == {"modules": 2, "priced": 1, "examined": 1, "undecided": 0}


def test_EVERY_status_this_builder_can_produce_SURVIVES_verdict_validate():
    """The builder fills in fields; `verdict.make` validates them. A shape that only the happy path
    validates is a gate that crashes on the run that matters."""
    import verdict as VD

    cases = [
        ([], []),
        ([{"module": "a.py", "estimate_only": True}], []),
        ([{"module": "a.py", "rc": 0}], []),
        ([{"module": "a.py", "rc": 7, "only": None}], ["a.py: mutmut exited 7"]),
    ]
    seen = set()
    for recs, reasons in cases:
        obj = VD.make(
            gate=S.SWEEP_GATE,
            criterion=S.SWEEP_CRITERION,
            tool="capture-host/tools/mutate.py",
            **S.sweep_verdict_fields(recs, reasons),
        )
        VD.validate(obj)
        seen.add(obj["status"])
    assert seen == {"NOT_RUN", "NOT_APPLICABLE", "PASS", "UNKNOWN"}


def test_the_CRITERION_is_the_same_sum_the_EXIT_CODE_uses():
    """A criterion written beside the measurement it judges is a target. This one is pre-stated as a
    module constant and names the sum `sweep_exit_verdict` already exits non-zero on."""
    assert S.SWEEP_CRITERION == {"name": "undecided_modules", "threshold": 0, "unit": "modules", "direction": "lte"}
    recs = [{"module": "a.py", "rc": 1, "only": None}]
    code, reasons = S.sweep_exit_verdict(recs)
    f = S.sweep_verdict_fields(recs, reasons)
    assert (code != 0) == (f["result"]["undecided"] > S.SWEEP_CRITERION["threshold"])
