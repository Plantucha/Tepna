# tepna-capture — mutation_set.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The DECISION LOGIC behind `tools/mutate_set.py`, split out so it sits inside the coverage floor.

WHAT THIS ANSWERS. `requirements-dev.txt` pins mutmut, and its own comment tells the next session to
upgrade every venv, re-run the gate and re-baseline survivors before moving that pin. Exactly one
comparison decides whether re-baselining is owed: the ordered mutant NAMES each module generates,
under the version before the move and the version after. A survivor is keyed by its name
(`x_<func>__mutmut_<n>`), so a set that did not move leaves every baselined survivor addressing the
same mutant, and a set that moved leaves the baseline pointing at code nobody generated.

WHY THE TREE COMMIT IS PART OF THE ARTIFACT. Two runs under two venvs are a measurement of mutmut only
while the SOURCE is held still. Compare an artifact written before a source edit against one written
after, and every moved module reads as a mutmut change. `compare_sets` therefore REFUSES two artifacts that
name different tree commits, rather than reporting a difference it cannot attribute.

WHY THE NAMES AND NOT THE RAW MUTATIONS. mutmut can enumerate a module two ways, and they do not
agree. `create_mutations` is cheap — measured 2026-11-02 on `capture.py`: 24151 mutations in 4.7 s at
285 MiB. `mutate_file_contents` runs that and then combines the mutants into one source file, which
NAMES them — 23539 named mutants in 170.7 s, holding a 554 MiB string. The 612 missing from the cheap
count are mutations no trampoline names, so a survivor can never be keyed to one. The expensive call
is the only one whose population a baseline addresses, and the cheap count is recorded here so nobody
substitutes it for a speed-up.

WHY `covered_lines=None` IS THE GATE'S OWN POPULATION. mutmut can restrict mutation to covered lines.
This module asks for every line, and under `check.sh`'s 100 % statement-and-branch floor those two
populations are the same set. A floor that ever drops below 100 % breaks that equality, which is why
the floor is named here rather than assumed.
"""

from __future__ import annotations

import datetime as _dt
from collections.abc import Mapping, Sequence

import verdict as VD

SCHEMA = "tepna.mutation-set/1"
GATE = "mutant-set-diff"
TOOL = "capture-host/tools/mutate_set.py"

CRITERION = {
    "name": "modules_whose_named_mutant_set_moved",
    "threshold": 0,
    "unit": "modules",
    "direction": "lte",
}

EVIDENCE = (
    "capture-host/tools/mutate_set.py",
    "capture-host/mutation_set.py",
)


def artifact(
    *,
    mutmut: str,
    python: str,
    commit: str | None,
    modules: Mapping[str, Sequence[str]],
    at: str | None = None,
) -> dict:
    """One side of the comparison: the named mutants each module generates under one venv.

    `commit` is the tree the names were read from, and `None` says the tree was not a checkout (§∅) —
    `compare_sets` refuses such an artifact rather than guessing that two of them share a tree."""
    return {
        "schema": SCHEMA,
        "mutmut": mutmut,
        "python": python,
        "commit": commit,
        "at": at or _now(),
        "modules": {name: list(names) for name, names in modules.items()},
    }


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def refusal(before: Mapping, after: Mapping) -> str | None:
    """The reason the two sides cannot be compared, or `None`. Every arm here is a broken PREMISE, not
    a finding: the answer is UNKNOWN, never a FAIL that would read as a mutmut change."""
    for label, side in (("before", before), ("after", after)):
        if side.get("schema") != SCHEMA:
            return f"the {label} artifact is not a {SCHEMA} object"
        if side.get("commit") is None:
            return f"the {label} artifact names no tree commit, so the two sides cannot be held to one tree"
    if before["commit"] != after["commit"]:
        return (
            f"the two artifacts name different trees ({before['commit']} and {after['commit']}), "
            "so a moved module cannot be attributed to the version change"
        )
    missing = sorted(set(before["modules"]) ^ set(after["modules"]))
    if missing:
        return f"one side is missing module(s) the other enumerated: {', '.join(missing)}"
    return None


def compare_sets(before: Mapping, after: Mapping) -> dict:
    """Per-module added and removed mutant names, over the modules both sides enumerated."""
    shared = sorted(set(before["modules"]) & set(after["modules"]))
    moved = {}
    reordered = []
    for name in shared:
        was, now = list(before["modules"][name]), list(after["modules"][name])
        added = [m for m in now if m not in set(was)]
        removed = [m for m in was if m not in set(now)]
        if added or removed:
            moved[name] = {"added": added, "removed": removed}
        elif was != now:
            # THE CRITERION IS A SET, AND A SET HAS NO ORDER. Every name on one side is on the other,
            # so each baselined survivor still addresses the mutant it was baselined against. Reported
            # because it is a real change in mutmut's output, and not counted because it costs no
            # re-baselining.
            reordered.append(name)
    return {
        "mutmut": {"before": before["mutmut"], "after": after["mutmut"]},
        "checked": len(shared),
        "moved": moved,
        "reordered": reordered,
    }


def verdict_object(report: Mapping, *, commit: str | None, at: str | None = None) -> dict:
    """PASS only when a version actually changed and no module's named set moved."""
    moved = report["moved"]
    checked = report["checked"]
    if report["mutmut"]["before"] == report["mutmut"]["after"]:
        status = "NOT_APPLICABLE"
        reason = f"both sides ran mutmut {report['mutmut']['before']}, so this comparison says nothing about a pin move"
    elif checked == 0:
        status = "NOT_RUN"
        reason = "neither side enumerated a module, so nothing was examined"
    elif moved:
        status = "FAIL"
        reason = f"{len(moved)} module(s) generate a different named mutant set: {', '.join(sorted(moved))}"
    else:
        status = "PASS"
        reason = None
    # §🧾: `NOT_RUN` and `NOT_APPLICABLE` carry `result: null`, and `verdict.validate` enforces it. A
    # status that examined nothing, or whose rule does not bind, has no measurement to report.
    result = (
        None
        if status in ("NOT_RUN", "NOT_APPLICABLE")
        else {
            "movedModules": len(moved),
            "moved": dict(moved),
            "reorderedModules": list(report["reordered"]),
            "mutmut": dict(report["mutmut"]),
        }
    )
    return VD.make(
        gate=GATE,
        status=status,
        population={"checked": checked, "eligible": checked, "excluded": 0},
        criterion=dict(CRITERION),
        result=result,
        evidence=list(EVIDENCE),
        reason=reason,
        tool=TOOL,
        commit=commit,
        at=at,
    )


def refusal_object(reason: str, *, commit: str | None, at: str | None = None) -> dict:
    """UNKNOWN over a population of nothing, carrying no result: the comparison could not look (§4b)."""
    return VD.make(
        gate=GATE,
        status="UNKNOWN",
        population={"checked": 0, "eligible": 0, "excluded": 0},
        criterion=dict(CRITERION),
        result=None,
        evidence=list(EVIDENCE),
        reason=reason,
        tool=TOOL,
        commit=commit,
        at=at,
    )
