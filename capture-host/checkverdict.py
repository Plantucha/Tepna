# tepna-capture — checkverdict.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`check.sh`'s verdict as ONE `tepna.verdict/1` object, written beside `.mypy-latest.txt` (VERDICT-CONTRACT
§3d — the runner-level object; wave 2 for the capture-host gate).

`check.sh` decides nothing of its own: it runs four BLOCKING children (ruff · shellcheck · pytest · unwired)
and two advisory legs, and its "all gates green" is an aggregation of their exit codes. This module writes
that aggregation down as an object so a downstream reader keys on `status`, not on the sentence.

CHILDREN ARE EXTERNAL TOOLS WITH A DOCUMENTED EXIT-CODE CONTRACT, and that is the one place this deviates
from §3d's "an exit-code child is UNKNOWN by provenance": that clause is the lever that makes a runner's
PASS wait for its adopters, and ruff / shellcheck / pytest will never adopt `tepna.verdict/1`. Their exit
code IS their published verdict, so each child's status is read off that contract — and any code the
contract does not name is UNKNOWN, never a guess:

  · 0 → PASS on every child.
  · the contract's "issues found" code → FAIL (ruff 1 · shellcheck 1 · pytest 1, which is also the
    coverage floor · unwired 1).
  · 127 → NOT_RUN: the TOOL is missing, not the gate failing (CLAUDE.md §🐍 — "a missing TOOL, not a
    failing gate"). It is counted EXCLUDED, and the run is then UNKNOWN (an unplanned exclusion, §3d),
    never PASS over the three that ran.
  · the contract's abnormal codes → UNKNOWN (ruff 2 · shellcheck 2/3/4 · pytest 2/3/4 · pytest 5 = no
    tests collected, a vacuous run — examined nothing, §∅).
  · anything else → UNKNOWN with the code in the reason.

⚠ A child whose failure and crash share an exit code cannot be told apart HERE — `find_unwired.py`
exits 1 for both a finding and an uncaught exception. That is the honest limit of an exit-code child
and the reason §3d wants children to emit their own object; it is recorded, not papered over.

Aggregation is §3d's precedence, not a vote: FAIL > UNKNOWN > PASS, and `checked = 0` is NOT_RUN. The
advisory legs (mypy · format) are NOT in the population — they cannot fail the run — and ride along in
`result.advisory` as the `advisory-state` tokens `check.sh` already prints.
"""

from __future__ import annotations

import json
import sys

import verdict as VD

GATE = "capture-host-check"
TOOL = "capture-host/check.sh"
CRITERION = {
    "name": "children_failing (any FAIL ⇒ FAIL; UNKNOWN never green; NOT_RUN counted excluded)",
    "threshold": 0,
    "unit": "failing children",
    "direction": "eq",
}
DEFAULT_OUT = ".check-verdict.json"

# The published exit-code contracts, one row per child: `{code: (status, what it means)}`. 0 and 127 are
# shared by every child and handled first; a code absent from a row is UNKNOWN with the number named.
CONTRACTS: dict[str, dict[int, tuple[str, str]]] = {
    "ruff": {1: ("FAIL", "violations found"), 2: ("UNKNOWN", "abnormal termination")},
    "shellcheck": {
        1: ("FAIL", "some files had issues"),
        2: ("UNKNOWN", "some files could not be processed"),
        3: ("UNKNOWN", "invoked with bad syntax"),
        4: ("UNKNOWN", "invoked with bad options"),
    },
    "pytest": {
        1: ("FAIL", "tests failed, or the coverage floor was not reached"),
        2: ("UNKNOWN", "interrupted"),
        3: ("UNKNOWN", "internal error"),
        4: ("UNKNOWN", "usage error"),
        5: ("UNKNOWN", "no tests collected — a vacuous run examined nothing"),
    },
    "unwired": {1: ("FAIL", "unexplained findings (or an uncaught exception — the two share the code)")},
}


def child_status(name: str, rc: int) -> tuple[str, str]:
    """`(status, detail)` for one child from its documented exit code. PURE."""
    if rc == 0:
        return "PASS", "exit 0"
    if rc == 127:
        return "NOT_RUN", "exit 127 — the tool is not installed; nothing was examined"
    row = CONTRACTS.get(name, {})
    if rc in row:
        status, meaning = row[rc]
        return status, f"exit {rc} — {meaning}"
    return "UNKNOWN", f"exit {rc} — not a code {name}'s contract names"


def aggregate(children: dict[str, int], advisory: dict[str, str] | None = None) -> dict:
    """§3d over `{child: exit code}`: FAIL > UNKNOWN > PASS; NOT_RUN children are excluded and make the
    run UNKNOWN (no invocation of check.sh declares an exclusion); no child examined ⇒ NOT_RUN. PURE."""
    rows = {name: child_status(name, rc) for name, rc in children.items()}
    statuses = {name: st for name, (st, _) in rows.items()}
    not_run = [n for n, st in statuses.items() if st == "NOT_RUN"]
    failed = [n for n, st in statuses.items() if st == "FAIL"]
    unknown = [n for n, st in statuses.items() if st == "UNKNOWN"]
    n = len(children)
    pop = {"checked": n - len(not_run), "eligible": n, "excluded": len(not_run)}
    result = {
        "children": n,
        "pass": sum(1 for st in statuses.values() if st == "PASS"),
        "fail": len(failed),
        "unknown": len(unknown),
        "notRun": len(not_run),
        "firstFailure": failed[0] if failed else None,
        "exitCodes": dict(children),
        "statuses": statuses,
        "advisory": dict(advisory or {}),
    }
    detail = lambda names: "; ".join(f"{k}: {rows[k][1]}" for k in names)  # noqa: E731
    ev = [TOOL] + [f"{k} exit {v}" for k, v in children.items()]
    if pop["checked"] == 0:
        return VD.make(gate=GATE, status="NOT_RUN", population=pop, criterion=CRITERION, result=None, evidence=ev,
                       tool=TOOL, reason="no child ran to a verdict" + (f" — {detail(not_run)}" if not_run else ""))
    if failed:
        return VD.make(gate=GATE, status="FAIL", population=pop, criterion=CRITERION, result=result, evidence=ev,
                       tool=TOOL, reason=f"{len(failed)} of {n} children failed — {detail(failed)}")
    if unknown or not_run:
        return VD.make(gate=GATE, status="UNKNOWN", population=pop, criterion=CRITERION, result=result, evidence=ev,
                       tool=TOOL, reason="a child left the run undecided — " + detail(unknown + not_run))
    return VD.make(gate=GATE, status="PASS", population=pop, criterion=CRITERION, result=result, evidence=ev,
                   tool=TOOL, reason=None)


def parse_pairs(pairs: list[str]) -> dict[str, int]:
    """`name=code` arguments → `{name: int}`; a malformed pair raises (a runner that cannot state a
    child's code has not stated it)."""
    out: dict[str, int] = {}
    for p in pairs:
        name, _, code = p.partition("=")
        if not name or not code.lstrip("-").isdigit():
            raise ValueError(f"expected name=exitcode, got {p!r}")
        out[name] = int(code)
    return out


def verdict_sample() -> dict:
    """The object the adoption gate reads (`--verdict-sample`): a green run of the four children."""
    return aggregate({"ruff": 0, "shellcheck": 0, "pytest": 0, "unwired": 0},
                     {"mypy": "AT_BASELINE", "format": "EMPTY_SCOPE"})


def main(argv: list[str]) -> int:
    """`--verdict-sample` · `--write <path> [--advisory k=v ...] name=rc ...` (writes the object, prints one
    line, exits 0 — the exit code check.sh returns stays its own, §3d "the exit code STAYS")."""
    if argv == ["--verdict-sample"]:
        print(json.dumps(verdict_sample(), indent=1))
        return 0
    if len(argv) < 2 or argv[0] != "--write":
        print("usage: checkverdict.py --verdict-sample | --write <path> [--advisory k=v ...] name=rc ...", file=sys.stderr)
        return 2
    path, rest = argv[1], argv[2:]
    advisory: dict[str, str] = {}
    pairs: list[str] = []
    it = iter(rest)
    for a in it:
        if a == "--advisory":
            k, _, v = next(it, "=").partition("=")
            advisory[k] = v
        else:
            pairs.append(a)
    obj = aggregate(parse_pairs(pairs), advisory)
    VD.write(path, obj)
    print(f"  verdict: {obj['status']} → {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
