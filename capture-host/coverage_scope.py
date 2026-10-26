# tepna-capture — coverage_scope.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""WHICH `tools/*.py` THE COVERAGE FLOOR NEVER LOOKED AT — the decision logic behind `tools/covscope.py`.

THE DEFECT THIS EXISTS FOR. `pyproject.toml` sets `[tool.coverage.run] source = [".", "deploy"]`, and
coverage's report-time file discovery does not descend into a directory that is not a package. `tools/`
holds no `__init__.py`, so a `tools/*.py` that no test imports is measured NOWHERE — and its absence
from the report reads exactly like 100 % (CLAUDE.md §∅ ABSENCE IS NULL — never a number). The floor is
`--cov-fail-under=100`, so the file nobody tests is the file the floor cannot see.

MEASURED 2026-10-20 at `origin/main` 63f6ac951, the way the gate measures it (`check.sh`, EXIT=0,
TOTAL 100.00 % over 28964 statements): nine of the fourteen `tools/*.py` print a row at 100 %, and
five print no row at all — `find_blindspots.py`, `mutate.py`, `mutate_diff.py`, `mutate_pure.py`,
`mutate_triage.py`. Neither cheap proxy reproduces that answer: an AST walk of `tests/` for imports
names six, and a raw grep for each basename names thirteen, because a test NAMES these files — in a
subprocess argument, in a source read, in prose — and naming is not importing.

WHAT THIS DOES NOT PROPOSE. It does not propose coverage for the five. `tools/` is uncovered BY
DESIGN: the glob, subprocess, argparse and IO live there, the logic that can return a WRONG answer
instead of failing loudly lives one directory up, and `mutation_triage.py`'s header calls that split
"not an oversight to be finished later". This check pins the set instead. Every absent file carries a
reason, and a further file cannot join them in silence.

THE MEMBERSHIP MOVES, AND NOTHING WATCHED IT. `tools/mutate_triage.py` printed a 100 % row on
2026-08-27 and prints none today: #1889 moved the classification up into `mutation_triage.py`, the
tests import the module rather than the tool, and the tool left the denominator with no symptom. That
is the right remedy and an unobserved event at the same time — which is the whole argument for a
check rather than a note.

WHY `population.excluded` IS 0. A pin is not an exclusion. Every declared file is examined, and a
pinned one is examined against a stricter question than the unpinned one: it must still be absent
(else its pin is spent) and it must still exist. Reporting a pinned file as `excluded` would claim it was
set aside unexamined, which is the shape this gate exists to catch.

THE LEDGER GREW ON 2026-10-26, which is the event this check was written for. `tools/verity_sdk_trial.py`
joined it as the seventh pin: a new operator CLI, with its decisions in `verity_sdk_config.py` inside the
floor and a test file covering that module to 100 % of statements and branches. The pin says what the
CLI holds; the module's own tests say the decisions were examined.
"""

from __future__ import annotations

SCOPE_DIR = "tools"
GATE = "capture-host-coverage-scope"
TOOL = "capture-host/tools/covscope.py"
VERDICT_SCHEMA = "tepna.verdict/1"
VERDICT_STATUSES = ("PASS", "FAIL", "SHORTFALL", "UNDERPOWERED", "NOT_RUN", "NOT_APPLICABLE", "UNKNOWN")
# PRE-STATED, and the same sum `--check` exits 1 on. Not derived from the run it judges.
CRITERION = {
    "name": "tools_absent_from_the_coverage_report_without_a_pin",
    "threshold": 0,
    "unit": "files",
    "direction": "lte",
}
EVIDENCE = (
    "capture-host/coverage_scope.py",
    "capture-host/tools/covscope.py",
    "capture-host/pyproject.toml",
)

# ── THE PIN LEDGER ──────────────────────────────────────────────────────────────────────────────────
# Each key is a path relative to `capture-host/`, each value the REASON it sits outside the floor. A
# reason is required (an empty one is a finding), and `find_unwired.py`'s ALLOW_FUNCS is the precedent:
# the escape hatch is an allowlist whose entries each say why. Adding a key is a deliberate statement
# that the file holds no logic that can return a wrong answer — not a way to make this gate quiet.
UNMEASURED_BY_DESIGN: dict[str, str] = {
    "tools/covscope.py": (
        "the CLI of this very check: the glob, the coverage-data read and the object write. Every "
        "decision it reports is made here in coverage_scope.py, inside the floor"
    ),
    "tools/find_blindspots.py": (
        "plumbing only — its own docstring says so and carries an audit stamp (AUDITED 2026-08-28, "
        "VERDICT: KEEP AS IS); every decision lives in blind_spots.py, inside the floor"
    ),
    "tools/mutate.py": (
        "the mutmut driver: subprocess, worker pool, scratch trees. The sweep's decisions live in "
        "mutation_sweep.py, and the one control-flow fact a test needs is asserted over its AST "
        "rather than by importing it (which would add 289 statements at 19 % under a 100 % floor)"
    ),
    "tools/mutate_diff.py": (
        "the diff-scoped driver: git plumbing, invocation and IO; every classification lives in "
        "mutation_diff.py, inside the floor"
    ),
    "tools/mutate_pure.py": (
        "the in-process mutant runner (AST rewrite plus an in-memory module exec), a hand-run "
        "diagnostic. THE WEAKEST PIN IN THIS LEDGER: no test imports it and none names it, so unlike "
        "every other pin here its split was never audited. Logged as residue, not resolved by this pin"
    ),
    "tools/mutate_triage.py": (
        "the CLI over mutation_triage.py, which holds the classification. It printed a 100 % row "
        "until #1889 moved that logic up, and this is the file whose silent exit from the report "
        "argued for the check"
    ),
    "tools/verity_sdk_trial.py": (
        "the CLI of the one-night Verity SDK trial: argparse, the config read and write, the "
        "timestamped backup, the free-space call and the printing. Every decision — which block is "
        "the Verity, which keys may move, the two-key parse proof and the operator warnings — lives "
        "in verity_sdk_config.py one directory up, and tests/test_verity_sdk_config.py covers that "
        "module to 100 % of its statements and branches"
    ),
    "tools/probe_verity_equivalence.py": (
        "a hand-run probe, and a DELIBERATELY WEAK PIN. It rebuilds each claimed-equivalent mutant "
        "from the module source BY LINE NUMBER, so it cannot be a test: under the mutation gate the "
        "source on disk is already rewritten and the line numbers have moved, so the same code run "
        "as a test would compare the wrong lines and kill mutants for the wrong reason, hiding real "
        "survivors across the whole module. Kept out of the suite for that reason, which is also why "
        "no test imports it. Its claims are re-checked by running it, and the equivalence entries it "
        "supports name it"
    ),
}

# The four ways the ledger and the report can disagree. All four red; none is advisory.
FINDING_KEYS = ("unpinned", "pinnedButMeasured", "pinnedButAbsent", "pinnedWithoutReason")


def classify(declared, measured, pins=None) -> dict:
    """PURE. Compare the files on disk against the files the coverage report measured.

    `declared` are the scope's paths relative to `capture-host/`, `measured` the paths the report
    carries a row for. Returns the full report — the four finding lists plus what they were read from,
    so a caller prints the same numbers the verdict carries."""
    pin_map = UNMEASURED_BY_DESIGN if pins is None else pins
    on_disk = sorted(set(declared))
    seen = set(measured)
    unmeasured = [p for p in on_disk if p not in seen]
    return {
        "declared": on_disk,
        "measured": sorted(p for p in on_disk if p in seen),
        "unmeasured": unmeasured,
        "pinned": sorted(pin_map),
        "unpinned": [p for p in unmeasured if p not in pin_map],
        "pinnedButMeasured": sorted(p for p in pin_map if p in seen),
        "pinnedButAbsent": sorted(p for p in pin_map if p not in on_disk),
        "pinnedWithoutReason": sorted(p for p, why in pin_map.items() if not str(why).strip()),
    }


def finding_count(report) -> int:
    """PURE. The criterion's own sum: every way the ledger and the report disagree."""
    return sum(len(report[k]) for k in FINDING_KEYS)


def reason_line(report) -> str | None:
    """PURE. One line naming every disagreement, or `None` when there is none. A reason that names no
    file would be a verdict about nothing, so each clause carries its paths."""
    clauses = []
    if report["unpinned"]:
        clauses.append(
            f"{len(report['unpinned'])} absent from the coverage report with no pin "
            f"({', '.join(report['unpinned'])}) — unmeasured reads as 100 %"
        )
    if report["pinnedButMeasured"]:
        clauses.append(
            f"{len(report['pinnedButMeasured'])} pinned file(s) are now measured, so the pin is spent "
            f"({', '.join(report['pinnedButMeasured'])})"
        )
    if report["pinnedButAbsent"]:
        clauses.append(
            f"{len(report['pinnedButAbsent'])} pinned file(s) are gone from disk "
            f"({', '.join(report['pinnedButAbsent'])})"
        )
    if report["pinnedWithoutReason"]:
        clauses.append(
            f"{len(report['pinnedWithoutReason'])} pin(s) carry no reason ({', '.join(report['pinnedWithoutReason'])})"
        )
    if not clauses:
        return None
    return "; ".join(clauses)


def status_for(report) -> str:
    """PURE. `NOT_RUN` when the scope held nothing — a verdict over an empty glob examined nothing and
    is never a pass. `FAIL` on any disagreement. `PASS` only over a scope that was read."""
    if not report["declared"]:
        return "NOT_RUN"
    if finding_count(report):
        return "FAIL"
    return "PASS"


def verdict_object(report, *, commit, at, tool=TOOL, evidence=None, result_extra=None) -> dict:
    """Build the `tepna.verdict/1`. Pure; the shape is `verdict.py`'s and `checkverdict.py` validates
    it there rather than a second validator restating it here."""
    status = status_for(report)
    reason = reason_line(report)
    if status == "NOT_RUN":
        reason = f"the scope {SCOPE_DIR}/ holds no .py file — nothing was examined"
    produced: dict = {"tool": tool, "commit": commit}
    if commit is None:
        produced["commitReason"] = "not run inside a git checkout"
    counts = {
        "declared": len(report["declared"]),
        "measured": len(report["measured"]),
        "unmeasured": len(report["unmeasured"]),
        "pinned": len(report["pinned"]),
        "findings": finding_count(report),
        **{k: report[k] for k in FINDING_KEYS},
    }
    if result_extra is not None:
        counts.update(result_extra)
    result: dict | None = counts
    return {
        "schema": VERDICT_SCHEMA,
        "gate": GATE,
        "status": status,
        "scope": "internal",
        # A pin is a recorded answer, not an exclusion — see the module docstring.
        "population": {"checked": len(report["declared"]), "eligible": len(report["declared"]), "excluded": 0},
        "criterion": dict(CRITERION),
        "result": None if status == "NOT_RUN" else result,
        "evidence": list(EVIDENCE if evidence is None else evidence),
        "reason": reason,
        "producedBy": produced,
        "at": at,
    }


def refusal_object(why, *, commit, at, tool=TOOL, evidence=None) -> dict:
    """The object for a run that could not read a coverage report. UNKNOWN, never PASS and never FAIL:
    an unreadable report is an absent measurement, and a gate that cannot see its input has decided
    nothing about the tree (CLAUDE.md §∅)."""
    produced: dict = {"tool": tool, "commit": commit}
    if commit is None:
        produced["commitReason"] = "not run inside a git checkout"
    return {
        "schema": VERDICT_SCHEMA,
        "gate": GATE,
        "status": "UNKNOWN",
        "scope": "internal",
        "population": {"checked": 0, "eligible": 0, "excluded": 0},
        "criterion": dict(CRITERION),
        "result": None,
        "evidence": list(EVIDENCE if evidence is None else evidence),
        "reason": why,
        "producedBy": produced,
        "at": at,
    }
