# tepna-capture — checkverdict.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`check.sh`'s verdict as ONE `tepna.verdict/1` object, written beside `.mypy-latest.txt` (VERDICT-CONTRACT
§3d — the runner-level object; wave 2 for the capture-host gate).

`check.sh` decides nothing of its own: it runs seven BLOCKING children (ruff · format · shellcheck · pytest ·
unwired · mypy-ratchet · covscope) and two advisory legs, and its "all gates green" is an aggregation of their
exit codes. This module writes that aggregation down as an object so a downstream reader keys on `status`,
not on the sentence.

A CHILD WITH NO ROW HERE IS UNKNOWN WHATEVER IT MEASURED, and that is a hole, not a safe default:
`format` blocked from 2026-10-05 and had no row until 2026-10-20, so a drifted tree published
`status: UNKNOWN` — "nobody decided" — about a failure `ruff format --check` had measured and named.
The shell exited 1 throughout, so the prose was right and the API was wrong, which is the one direction
§🧾 exists to catch. Every name passed as a blocking child belongs in `CONTRACTS`, `ADOPTED_OURS` or
`UNADOPTED_OURS` on the same commit that makes it blocking.

FOUR CHILDREN ARE EXTERNAL TOOLS WITH A PUBLISHED EXIT-CODE CONTRACT, and §3d reads such a child BY
that contract (Kestrel's ruling, 2026-09-22): the exit code is a machine-readable API the tool already
publishes, so keying on it is not prose-parsing. The mapping lives here, beside the versions it was read
from (ruff 0.16.0 · shellcheck 0.11.0 · pytest 9.1.1), and any code a contract does not name is UNKNOWN:

  · 0 → PASS on every child.
  · the contract's "issues found" code → FAIL (ruff 1 · shellcheck 1 · pytest 1, which is also the
    coverage floor).
  · 127 → NOT_RUN: the TOOL is missing, not the gate failing (CLAUDE.md §🐍 — "a missing TOOL, not a
    failing gate"). It is counted EXCLUDED, and the run is then UNKNOWN (an unplanned exclusion, §3d),
    never PASS over the three that ran.
  · the contract's abnormal codes → UNKNOWN (ruff 2 · shellcheck 2/3/4 · pytest 2/3/4 · pytest 5 = no
    tests collected, a vacuous run — examined nothing, §∅).
  · anything else → UNKNOWN with the code in the reason.

A TOOL OF OURS NEVER GETS THAT EXEMPTION — it adopts `tepna.verdict/1` or counts UNKNOWN BY PROVENANCE.
`find_unwired.py` ADOPTED (residue 2026-10-12-find-unwired-has-not-adopted-the-verdict-schema-so-check-sh-
can-never-read-pass): `--check --verdict-out` writes its own object over the findings it examined, and
this module reads THAT, not the exit code — the exit code still cannot separate a finding from an uncaught
exception, the object can (a crash writes none). So `unwired` is read from its object when it ran and
published one; a missing, unreadable, invalid or foreign object, or a PASS object beside a non-zero exit,
is UNKNOWN. A green run therefore reads PASS, and PASS can no longer mean "unwired was never asked".
`covscope` ADOPTED on arrival (2026-10-20) and is read the same way: it asks whether every `tools/*.py` is
either measured by the coverage floor or pinned with a reason, and its exit 2 is a REFUSAL — no readable
coverage data, so nothing about the tree was examined. Its object says UNKNOWN there, which is exactly what
an exit code alone could not distinguish from a finding.
`UNADOPTED_OURS` stays as the floor for the NEXT tool of ours that joins this gate before it adopts.

`mypy-ratchet` IS NOT A TOOL AND TAKES NO EXEMPTION. It is a function inside `check.sh`, so the codes
below are not a third party's contract read off a tool that might have crashed instead — they are OUR
contract, declared here and chosen there from the state the mypy leg recorded. The distinction the
provenance rule protects is kept rather than waived: the external tool that can abort is mypy itself,
and that abort is exactly what exit 2 carries (NO_COUNT ⇒ UNKNOWN, never FAIL). A conviction (exit 1)
therefore always rests on a count mypy actually printed.

Aggregation is §3d's precedence, not a vote: FAIL > UNKNOWN > PASS, and `checked = 0` is NOT_RUN. The
advisory legs (mypy · devfloors; `format` left the set on 2026-10-05 and blocks now) are NOT in the
population — they cannot fail the run — and ride along in `result.advisory` as the `advisory-state`
tokens `check.sh` already prints. mypy keeps its advisory ROW and its token: the blocking child
`mypy-ratchet` reads that row's recorded state, so the leg that measures and the leg that convicts are
both visible and a reader can see which state produced the verdict.
"""

from __future__ import annotations

import json
import sys

import coverage_scope as CS
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
    # `ruff format --check .` — the same tool and the same two codes, a separate child since 2026-10-05.
    "format": {1: ("FAIL", "files are not formatted"), 2: ("UNKNOWN", "abnormal termination")},
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
    # OURS, and the only row whose codes `check.sh` chooses itself (see the paragraph above).
    "mypy-ratchet": {
        1: ("FAIL", "the mypy count rose above the recorded baseline"),
        2: ("UNKNOWN", "mypy printed no summary line, so the count was never measured"),
    },
}
# Children of OURS that have not adopted the contract: read by PROVENANCE, never by an exit code they do
# not publish — any code but 127 is UNKNOWN. Emptied one name at a time as each adopts (`unwired` was the
# last, and left on 2026-10-12); a new tool of ours joins here until it emits its own object.
UNADOPTED_OURS: frozenset[str] = frozenset()
# Children of OURS that HAVE adopted: `{name: the gate its object must carry}`. Read from the child's own
# object (§3d provenance "object"), never from its exit code alone.
ADOPTED_OURS = {"unwired": "find-unwired", "covscope": "capture-host-coverage-scope"}


def _object_status(name: str, rc: int, obj: dict | None) -> tuple[str, str]:
    """`(status, detail)` for an ADOPTED child of ours from its own object. PURE. An object that is not
    there, does not validate, names another gate, or says PASS beside a non-zero exit decided nothing."""
    if obj is None:
        return "UNKNOWN", f"exit {rc} — no tepna.verdict/1 object was written; an adopted tool of ours must publish one"
    try:
        VD.validate(obj)
    except ValueError as e:
        return "UNKNOWN", f"exit {rc} — its object is not a valid tepna.verdict/1 ({e})"
    if obj["gate"] != ADOPTED_OURS[name]:
        return "UNKNOWN", f"exit {rc} — the object is gate {obj['gate']!r}, not {ADOPTED_OURS[name]!r}"
    if obj["status"] == "PASS" and rc != 0:
        return "UNKNOWN", f"exit {rc} contradicts its own PASS object"
    return obj["status"], f"exit {rc} — its own object: {obj['status']}"


def child_status(name: str, rc: int, obj: dict | None = None) -> tuple[str, str]:
    """`(status, detail)` for one child from its documented exit code — or, for an adopted tool of ours,
    from its own object `obj`. PURE."""
    if rc == 127:
        return "NOT_RUN", "exit 127 — the tool is not installed; nothing was examined"
    if name in ADOPTED_OURS:
        return _object_status(name, rc, obj)
    if name in UNADOPTED_OURS:
        return (
            "UNKNOWN",
            f"exit {rc} — a tool of ours that has not adopted tepna.verdict/1: UNKNOWN by provenance (§3d)",
        )
    if rc == 0:
        return "PASS", "exit 0"
    row = CONTRACTS.get(name, {})
    if rc in row:
        status, meaning = row[rc]
        return status, f"exit {rc} — {meaning}"
    return "UNKNOWN", f"exit {rc} — not a code {name}'s contract names"


def aggregate(
    children: dict[str, int], advisory: dict[str, str] | None = None, objects: dict[str, dict | None] | None = None
) -> dict:
    """§3d over `{child: exit code}` (and `objects`, the adopted children's own objects): FAIL > UNKNOWN >
    PASS; NOT_RUN children are excluded and make the run UNKNOWN (no invocation of check.sh declares an
    exclusion); no child examined ⇒ NOT_RUN. PURE."""
    objs = objects or {}
    rows = {name: child_status(name, rc, objs.get(name)) for name, rc in children.items()}
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
        return VD.make(
            gate=GATE,
            status="NOT_RUN",
            population=pop,
            criterion=CRITERION,
            result=None,
            evidence=ev,
            tool=TOOL,
            reason="no child ran to a verdict" + (f" — {detail(not_run)}" if not_run else ""),
        )
    if failed:
        return VD.make(
            gate=GATE,
            status="FAIL",
            population=pop,
            criterion=CRITERION,
            result=result,
            evidence=ev,
            tool=TOOL,
            reason=f"{len(failed)} of {n} children failed — {detail(failed)}",
        )
    if unknown or not_run:
        return VD.make(
            gate=GATE,
            status="UNKNOWN",
            population=pop,
            criterion=CRITERION,
            result=result,
            evidence=ev,
            tool=TOOL,
            reason="a child left the run undecided — " + detail(unknown + not_run),
        )
    return VD.make(
        gate=GATE,
        status="PASS",
        population=pop,
        criterion=CRITERION,
        result=result,
        evidence=ev,
        tool=TOOL,
        reason=None,
    )


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
    """The object the adoption gate reads (`--verdict-sample`): a green run of the children, with each
    ADOPTED tool of ours read from a synthetic PASS object of its own — the gate's real green shape."""
    unwired = VD.make(
        gate=ADOPTED_OURS["unwired"],
        status="PASS",
        population={"checked": 1, "eligible": 1, "excluded": 0},
        criterion={
            "name": "unexplained_findings_plus_spent_suppressions",
            "threshold": 0,
            "unit": "findings",
            "direction": "eq",
        },
        result={"unexplained": 0},
        evidence=["capture-host/tools/find_unwired.py"],
        reason=None,
        tool="capture-host/tools/find_unwired.py",
    )
    covscope = VD.make(
        gate=ADOPTED_OURS["covscope"],
        status="PASS",
        population={"checked": 14, "eligible": 14, "excluded": 0},
        # SINGLE-SOURCED from the module that states it, not retyped: a sample whose criterion
        # drifts from the gate's own would hand the adoption gate a green object the gate never
        # emits. Retyped, the threshold `0` was a literal no test read — one surviving mutant on
        # 2026-10-20 turned it into `1` and the suite stayed green.
        criterion=CS.CRITERION,
        result={"findings": 0},
        evidence=["capture-host/tools/covscope.py"],
        reason=None,
        tool="capture-host/tools/covscope.py",
    )
    return aggregate(
        {"ruff": 0, "shellcheck": 0, "pytest": 0, "unwired": 0, "covscope": 0},
        {"mypy": "AT_BASELINE", "format": "EMPTY_SCOPE"},
        {"unwired": unwired, "covscope": covscope},
    )


def load_object(path: str) -> dict | None:
    """An adopted child's object off disk, or None when there is none to read (absent, unreadable, not JSON,
    or not an object) — `child_status` turns None into UNKNOWN, so no failure here can read as green."""
    try:
        with open(path, encoding="utf-8") as fh:
            obj = json.load(fh)
    except (OSError, ValueError):
        return None
    return obj if isinstance(obj, dict) else None


# `--refused` with no reason following it: the object is still owed (a refusal that writes nothing
# leaves the previous run's PASS on disk), and §🧾 requires every non-PASS to carry a reason — so the
# absence is NAMED rather than written as an empty string, which reads as "refused, cause unstated".
REFUSAL_REASON_ABSENT = "--refused was given no reason, so this run states none"


def refusal(children: list[str], reason: str) -> dict:
    """`--refused`: check.sh's preflight stopped before any child ran, so no child HAS an exit code —
    the only honest object is NOT_RUN over the children that were eligible (`checked 0`, all excluded,
    §🧾). It exists because the alternative is worse than silence: a refusal that writes nothing leaves
    the PREVIOUS run's `.check-verdict.json` on disk, and a reader keying on the object then reads a
    PASS that describes a tree nobody examined. PURE."""
    n = len(children)
    return VD.make(
        gate=GATE,
        status="NOT_RUN",
        population={"checked": 0, "eligible": n, "excluded": n},
        criterion=CRITERION,
        result=None,
        evidence=[TOOL] + [f"{c} not invoked" for c in children],
        tool=TOOL,
        reason=reason,
    )


def main(argv: list[str]) -> int:
    """`--verdict-sample` · `--write <path> [--advisory k=v ...] [--object name=path ...] name=rc ...` (writes
    the object, prints one line, exits 0 — the exit code check.sh returns stays its own, §3d "the exit code
    STAYS"). `--object` names the file an ADOPTED child wrote its own object to."""
    if argv == ["--verdict-sample"]:
        print(json.dumps(verdict_sample(), indent=1))
        return 0
    if len(argv) < 2 or argv[0] != "--write":
        print(
            "usage: checkverdict.py --verdict-sample | --write <path> [--advisory k=v ...] [--object name=path ...]"
            " [--refused <reason> name ...]"
            " name=rc ...",
            file=sys.stderr,
        )
        return 2
    path, rest = argv[1], argv[2:]
    advisory: dict[str, str] = {}
    objects: dict[str, dict | None] = {}
    pairs: list[str] = []
    refused: str | None = None
    it = iter(rest)
    for a in it:
        if a == "--advisory":
            k, _, v = next(it, "=").partition("=")
            advisory[k] = v
        elif a == "--object":
            k, _, v = next(it, "=").partition("=")
            objects[k] = load_object(v)
        elif a == "--refused":
            refused = next(it, REFUSAL_REASON_ABSENT)
        else:
            pairs.append(a)
    # `--refused` takes the children as BARE NAMES, because a preflight that stopped before the first
    # gate cannot state an exit code for any of them, and `parse_pairs` rightly refuses a pair without
    # one. Fabricating a code here would be the same lie in the other direction.
    obj = refusal(pairs, refused) if refused is not None else aggregate(parse_pairs(pairs), advisory, objects)
    VD.write(path, obj)
    print(f"  verdict: {obj['status']} → {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
