# tepna-capture — mutation_sweep.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The DECISION LOGIC behind `tools/mutate.py`, split out so it sits inside the coverage floor.

Third of the family, after `mutation_triage.py` and `mutation_diff.py`, and for the identical house
reason: `tools/` is outside the coverage denominator until something imports it, which is fine for
`glob`/`subprocess`/`argparse`/IO and NOT fine for logic that can return a WRONG ANSWER rather than
failing loudly. Both functions here decide what a mutation sweep MEASURES, and a wrong answer in
either direction manufactures work or hides it.

🔴 THE BUDGET DEFECT THIS FILE EXISTS TO CLOSE. `tools/mutate.py`'s `clean_run_seconds` timed a
`subprocess.run(... pytest ...)` and returned the elapsed seconds WITHOUT EVER READING ITS RETURN
CODE. A clean run that fails instantly — a collection error, a bad path, a missing plugin — takes
~0.2 s, so the budget derived from it collapses to the 1800 s floor. For a module whose real clean run
is 21.5 s that is 6450 s of budget silently becoming 1800.

That is exactly the failure `budget_for`'s own docstring confesses to ("webmon exceeded the
per-module timeout twice and stayed the one unmeasured module in the audit") — but one level BELOW
where the docstring looked. It blamed the flat 3600 cap; the flat cap was replaced, and the same
outcome remains reachable whenever the measurement itself fails, because **the elapsed time of a
crashed run is still a well-formed float**. A failed measurement is indistinguishable from a fast one.

⚠️ THERE IS DELIBERATELY NO `budget_for(sec) -> int` CONVENIENCE WRAPPER. One was written and then
deleted the same hour, because `find_unwired` correctly reported it as referenced only by its own
tests: the tool needs the REFUSAL, so it calls `budget_verdict`, and nothing else called the int
form. It had been justified as "back-compat" — reasoning carried over from `mutation_diff`, where
`is_string_only` genuinely predated the split and had real callers. This module is NEW; there was no
legacy caller to be compatible with, so the wrapper was a function kept alive by its own tests.

⚠️ THE SAFE DIRECTION HERE IS REFUSAL, NOT A FLOOR. A too-LARGE budget only wastes wall-clock; a
too-small one turns real survivors into timeouts and leaves a module unmeasured while the sweep
reports normally. So an unverified measurement REFUSES rather than quietly taking the floor.
"""
from __future__ import annotations

__all__ = ["SOURCE_SCANNING_TESTS", "select_tests", "deselect_args", "deselect_notes", "DESELECTED_TESTS", "budget_verdict",
           "BUDGET_OK", "BUDGET_REFUSED"]

BUDGET_OK = "ok"
BUDGET_REFUSED = "refused"

# Excluded because mutmut 3 generates ONE file holding every mutant inline and dispatches at runtime,
# so a test that greps SOURCE sees all of them at once. test_no_deprecated_apis.py scans for bleak's
# deprecated bare `adapter` kwarg, and mutmut's `"bluez"` -> `"BLUEZ"` mutation trips it on every run
# including the baseline — which mutmut reports as "not checked" for the whole module. The test is
# right about real source; it simply cannot be asked about generated source.
#
# ⚠️ THE COST IS A FALSE SURVIVOR, and it is worth naming because the exclusion is invisible in the
# output: a mutant killed ONLY by an excluded test is reported as SURVIVING. That is manufactured
# work — someone is sent to write a test for a mutant that is already dead — which is the same harm
# as `mutation_triage`'s false REACHABLE. `select_tests` therefore returns the exclusions it applied
# so the caller can say so, rather than dropping them silently.
# An entry is EITHER a file path (the whole file is dropped from the selection) OR a pytest node id
# `path::test_name` (the file still runs; that one test is deselected). Node-id granularity exists
# because the fatal test can live in the module's PRIMARY test file, where dropping the file would
# gut the selection: `test_capture_runners.py` holds ~280 of capture.py's tests and one that cannot
# survive mutation.
#
# ⚠️ IT IS THE WHOLE-MODULE SCAN THAT IS FATAL, NOT SOURCE-SCANNING GENERALLY — worth knowing before
# adding an entry. `inspect.getsource(capture)` returns every mutant at once, so a test counting an
# occurrence sees 112 where real source has 1. The same file's two FUNCTION-level scans
# (`inspect.getsource(capture.auto_sync_clock)`, `…polar_offline_op`) pass fine and must stay. Six
# test files use `inspect.getsource`; only the module-level form breaks.
#
# A node-id entry loses no mutant-killing power when the test is a source-STRUCTURE assertion — it
# counts call sites, so under generated source it kills nothing anyway. It still runs in the normal
# suite, where it is a valid gate.
SOURCE_SCANNING_TESTS = frozenset({"tests/test_no_deprecated_apis.py"})

# Node-id exclusions, mapped to THE MODULE EACH ONE SCANS. The mapping is not decoration: the
# deselection is applied to every run (harmless — pytest ignores a `--deselect` it does not collect,
# and a test that greps `capture` cannot kill an `alerts` mutant), but the "reads as SURVIVING" note
# is only true for the module the test actually scans. Reporting it for the other 22 modules whose
# selection happens to include this file would manufacture exactly the false risk that
# `mutation_triage`'s false REACHABLE does — someone sent to write a test for a mutant that was never
# at stake.
# ⚠️ A SOURCE SCAN DOES NOT BELONG HERE — route it through `tests/_srcscan.module_source()` instead,
# which skips only that test on a generated file and keeps its mutant-killing power on real source.
# Deselecting is the blunter tool: it drops the test everywhere, including where it works. This table
# is for tests that CANNOT be made mutation-safe that way (a git query about the real repo, a frame
# introspection whose frame is mutmut's trampoline).
#
# The value is THE MODULE WHOSE MUTANT THIS EXCLUSION COULD COST, or None when the test kills no
# source mutant anywhere — an assertion about a file mode or a repo fact cannot be broken by mutating
# a function, so "reads as SURVIVING" would be a false warning rather than an honest one.
DESELECTED_TESTS: dict[str, str | None] = {
    # shells out to `git ls-files -s` for the committed file mode. The scratch tree is a COPY, not a
    # repo, so this cannot pass there — and the test deliberately refuses to skip ("an unverifiable
    # mode is the gap itself"), which is correct in CI and fatal here. It asserts a file mode, so it
    # kills no mutant: None.
    "tests/test_check_script.py::test_check_sh_is_executable_and_shebanged": None,
    # same git-in-the-scratch-tree shape: `git -C HERE ls-files -s` for the committed exec bit. The
    # file's OTHER git tests clone their own repo into a tmpdir and are fine anywhere; only this one
    # asks about the tree it is running in. Asserts a file mode, so it kills no mutant: None.
    "tests/test_vigil_update.py::test_a_unit_that_directly_execs_a_repo_script_requires_the_exec_bit": None,
    # reads `coro.cr_frame.f_locals` to prove a documented config key is threaded into the call. Under
    # mutation the coroutine is mutmut's dispatch trampoline, whose frame locals are not the real
    # function's, so the lookup raises KeyError. Unlike the two above this DOES exercise capture.py
    # behaviour, so the cost is real and gets reported.
    "tests/test_cpap_spool_wire.py::test_every_documented_spool_pull_key_is_actually_READ": "capture.py",
}


def deselect_args(deselected: dict[str, str] | None = None) -> list[str]:
    """`--deselect <nodeid>` pytest args for every node-id exclusion. Pure.

    File-path entries are handled by `select_tests`, which simply does not keep them. Node ids cannot
    be handled that way — the file must still run — so they become explicit pytest deselections.
    Sorted so the emitted config is stable across runs.
    """
    d = DESELECTED_TESTS if deselected is None else deselected
    out: list[str] = []
    for nodeid in sorted(d):
        out += ["--deselect", nodeid]
    return out


def deselect_notes(module: str, kept: list[str],
                   deselected: dict[str, str | None] | None = None) -> list[str]:
    """Node ids worth REPORTING for `module` — those whose file is in the selection AND whose
    exclusion could actually cost a mutant here. Pure.

    Scoped deliberately, twice over. The deselection itself is global; the cost it carries is not.
    A `None` scope reports nowhere, because a test that kills no mutant costs nothing to exclude and
    warning about it manufactures the same false work as a false REACHABLE.
    """
    d = DESELECTED_TESTS if deselected is None else deselected
    # `split("::")[0]` — the FILE part of a node id, however many `::` it carries. No maxsplit: taking
    # [0] makes any maxsplit inert, so passing one adds a parameter that cannot change the result and
    # cannot be tested. It must be `split`, never `rsplit`: a class-based id (`f.py::C::test_m`) would
    # rsplit to `f.py::C`, which matches no entry in `kept`, and the note would silently go missing.
    return sorted(n for n, scanned in d.items()
                  if scanned is not None and scanned == module and n.split("::")[0] in kept)


def select_tests(candidates: list[tuple[str, str]], stem: str,
                 excluded: frozenset[str] = SOURCE_SCANNING_TESTS) -> tuple[list[str], list[str]]:
    """Which test files to run for `stem`, and which were EXCLUDED. Pure.

    `candidates` is `[(path, text)]` — the read is plumbing and stays in the tool, exactly as
    `functions_covering` takes source text rather than a Path.

    Selection is "every test file that names the module", not `test_<stem>.py` alone: the narrow form
    is faster and INFLATES the survivor count, because a mutant killed only by a differently-named
    test reads as surviving. Own-name file first so the most relevant failures surface earliest.

    Returns the exclusions alongside the selection so a caller can report them. Dropping them silently
    is how an excluded test becomes an invisible source of false survivors.

    Only FILE-path exclusions act here. A node id (`path::test`) never equals a candidate path, so the
    file stays selected — which is the point: `deselect_args` drops that one test instead."""
    files_excluded = {e for e in excluded if "::" not in e}
    found = [p for p, text in candidates if stem in text]
    kept = [p for p in found if p not in files_excluded]
    dropped = [p for p in found if p in files_excluded]
    own = f"tests/test_{stem}.py"
    if own in kept:
        kept.remove(own)
        kept.insert(0, own)
    return kept, dropped


def budget_verdict(clean_sec: float, measured_ok: bool) -> tuple[str, int | None, str]:
    """Seconds to allow one module — or a REFUSAL. Returns `(verdict, budget, detail)`.

    `measured_ok` is the caller's answer to "did the clean run actually run?", i.e. its return code.
    Passing True on an unchecked subprocess is the defect this exists to prevent, so the parameter is
    REQUIRED rather than defaulted — a caller must state the fact, not inherit an optimistic default.

    300x the clean run, floor 1800 s: mutmut tests each mutant against only the tests covering the
    mutated function, so per-mutant cost is a fraction of the full selection and the multiplier is
    dominated by mutant COUNT (~2-3 per statement here). Slower than that is not slow, it is stuck."""
    if not measured_ok:
        return BUDGET_REFUSED, None, "the clean run did not pass, so its duration measures nothing"
    if clean_sec <= 0:
        return BUDGET_REFUSED, None, f"implausible clean-run duration {clean_sec!r}"
    return BUDGET_OK, max(1800, int(clean_sec * 300)), f"300x the {clean_sec:.2f}s clean run"
