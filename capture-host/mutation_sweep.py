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

__all__ = ["SOURCE_SCANNING_TESTS", "select_tests", "budget_verdict",
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
SOURCE_SCANNING_TESTS = frozenset({"tests/test_no_deprecated_apis.py"})


def select_tests(candidates: list[tuple[str, str]], stem: str,
                 excluded: frozenset[str] = SOURCE_SCANNING_TESTS) -> tuple[list[str], list[str]]:
    """Which test files to run for `stem`, and which were EXCLUDED. Pure.

    `candidates` is `[(path, text)]` — the read is plumbing and stays in the tool, exactly as
    `functions_covering` takes source text rather than a Path.

    Selection is "every test file that names the module", not `test_<stem>.py` alone: the narrow form
    is faster and INFLATES the survivor count, because a mutant killed only by a differently-named
    test reads as surviving. Own-name file first so the most relevant failures surface earliest.

    Returns the exclusions alongside the selection so a caller can report them. Dropping them silently
    is how an excluded test becomes an invisible source of false survivors."""
    found = [p for p, text in candidates if stem in text]
    kept = [p for p in found if p not in excluded]
    dropped = [p for p in found if p in excluded]
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
