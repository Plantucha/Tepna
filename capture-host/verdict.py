# tepna-capture — verdict.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`tepna.verdict/1` — a gate answers in ONE fixed shape; prose is explanation, not the API.

VERDICT-CONTRACT-2026-09-21 §1, owner 2026-09-21: *"a downstream machine cannot reliably distinguish
PASS / FAIL / NOT RUN / NOT APPLICABLE / UNDERPOWERED / SHORTFALL / UNKNOWN without parsing prose. That
is dangerous."* The box-side nightly gates are the first thing a clinician or the sealed-night reader
will ever see, so they emit the object beside the file they already write.

This module is the Python half of the contract: `make()` builds an object, `validate()` refuses a
malformed one (the same rules `verdict.js` applies in the JS lane), `write()` puts it beside a report
atomically. The rules that matter most are the ones that refuse the examined-nothing shape:

  · `status` is one of EXACTLY seven values — no synonyms, no case variants.
  · `population` is three integers with `checked + excluded == eligible` (an equality, not a floor —
    memory `gate-must-publish-its-denominator`).
  · a PASS with `checked == 0`, an empty `evidence`, or a non-null `reason` is invalid: that is a pass
    about nothing, refused at the type level. Every other status REQUIRES a reason.
  · `producedBy.commit` is a 7–40 hex sha, or null WITH a `commitReason` (absence says why).
  · `criterion` names the rule, threshold, unit and direction, and it was written before the
    measurement (memory `pre-state-the-threshold`) — the builders in nightqc.py carry theirs as
    module constants for exactly that reason.

`at` is a REAL UTC instant — provenance of the run, not a floating recording time — so the Clock
Contract's floating rule does not apply here, and this docstring says so as §1 asks.
"""

from __future__ import annotations

import datetime as _dt
import json
import os
import re

import build_id

SCHEMA = "tepna.verdict/1"
STATUSES = ("PASS", "FAIL", "SHORTFALL", "UNDERPOWERED", "NOT_RUN", "NOT_APPLICABLE", "UNKNOWN")
DIRECTIONS = ("lte", "gte", "eq", "within")
SCOPES = ("internal", "publishable")
_SHA = re.compile(r"^[0-9a-f]{7,40}$")
NO_GIT_REASON = "the tree this ran in is not a git checkout (build_id.probe found no sha)"

_commit: str | None | bool = False  # False = not probed yet; None = probed, no .git


def commit_sha(repo_dir: str | None = None) -> str | None:
    """The short sha of the tree this code runs in, probed ONCE (a subprocess); None when git cannot
    say (a tarball deploy) — and the object then carries null, never a placeholder."""
    global _commit
    if _commit is False:
        here = repo_dir or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        _commit = build_id.probe(here).get("git")
    return _commit  # type: ignore[return-value]


def make(
    *,
    gate: str,
    status: str,
    population: dict,
    criterion: dict,
    result,
    evidence: list,
    reason: str | None,
    tool: str,
    commit: str | None = None,
    at: str | None = None,
) -> dict:
    """Build a `tepna.verdict/1` object and validate it. Raises ValueError on a malformed one — a gate
    that cannot state its verdict in the shape has not stated it."""
    obj = {
        "schema": SCHEMA,
        "gate": gate,
        "status": status,
        "population": dict(population),
        "criterion": dict(criterion),
        "result": result,
        "evidence": list(evidence),
        "reason": reason,
        "producedBy": _produced_by(tool, commit_sha() if commit is None else commit),
        "at": at or _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "scope": "internal",
    }
    validate(obj)
    return obj


def _produced_by(tool: str, commit: str | None) -> dict:
    """{tool, commit} — or, when the tree is not a checkout, {tool, commit: null, commitReason}: absence
    says why (§∅), and verdict.js refuses a bare null."""
    if commit is None:
        return {"tool": tool, "commit": None, "commitReason": NO_GIT_REASON}
    return {"tool": tool, "commit": commit}


def unknown(*, gate: str, criterion: dict, evidence: list, tool: str, exc: BaseException) -> dict:
    """A crash is not a verdict: the catch-all shape, naming the exception."""
    return make(
        gate=gate,
        status="UNKNOWN",
        population={"checked": 0, "eligible": 0, "excluded": 0},
        criterion=criterion,
        result=None,
        evidence=evidence,
        reason=f"the gate raised {type(exc).__name__}: {exc}",
        tool=tool,
    )


def validate(obj: dict) -> None:
    """Refuse anything that is not exactly the contract. Mirrors verdict.js."""
    if not isinstance(obj, dict) or obj.get("schema") != SCHEMA:
        raise ValueError(f"schema must be {SCHEMA!r}")
    if not isinstance(obj.get("gate"), str) or not obj["gate"]:
        raise ValueError("gate must be a non-empty string")
    st = obj.get("status")
    if st not in STATUSES:
        raise ValueError(f"status {st!r} is not one of {STATUSES}")
    pop = obj.get("population")
    if not isinstance(pop, dict) or set(pop) != {"checked", "eligible", "excluded"}:
        raise ValueError("population must be exactly {checked, eligible, excluded}")
    for k in ("checked", "eligible", "excluded"):
        if not isinstance(pop[k], int) or isinstance(pop[k], bool) or pop[k] < 0:
            raise ValueError(f"population.{k} must be a non-negative integer")
    if pop["checked"] + pop["excluded"] != pop["eligible"]:
        raise ValueError("population: checked + excluded must equal eligible")
    crit = obj.get("criterion")
    if not isinstance(crit, dict) or set(crit) != {"name", "threshold", "unit", "direction"}:
        raise ValueError("criterion must be exactly {name, threshold, unit, direction}")
    if crit["direction"] not in DIRECTIONS:
        raise ValueError(f"criterion.direction {crit['direction']!r} is not one of {DIRECTIONS}")
    if not isinstance(crit["name"], str) or not crit["name"] or not isinstance(crit["unit"], str):
        raise ValueError("criterion.name must be a non-empty string and criterion.unit a string")
    thr = crit["threshold"]
    if crit["direction"] == "within":
        if not (
            isinstance(thr, list)
            and len(thr) == 2
            and all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in thr)
        ):
            raise ValueError("criterion.threshold for 'within' must be a [lo, hi] pair")
    elif not isinstance(thr, (int, float)) or isinstance(thr, bool):
        raise ValueError("criterion.threshold must be a finite number")
    if obj.get("result") is not None and not isinstance(obj["result"], dict):
        raise ValueError("result must be an object of measured quantities, or null")
    ev = obj.get("evidence")
    if not isinstance(ev, list) or not all(isinstance(e, str) and e for e in ev):
        raise ValueError("evidence must be a list of non-empty strings")
    reason = obj.get("reason")
    if st == "PASS":
        if reason is not None:
            raise ValueError("a PASS carries reason: null")
        if pop["checked"] == 0:
            raise ValueError("a PASS over checked: 0 is the examined-nothing shape")
        if not ev:
            raise ValueError("a PASS needs evidence")
        if obj.get("result") is None:
            raise ValueError("a PASS carries a result")
    elif not isinstance(reason, str) or not reason:
        raise ValueError(f"a {st} requires a reason")
    if st in ("FAIL", "SHORTFALL"):
        if obj.get("result") is None:
            raise ValueError(f"a {st} carries a result — what was measured")
        if not ev:
            raise ValueError(f"a {st} needs evidence")
    if st == "UNDERPOWERED" and not any(ch.isdigit() for ch in str(reason)):
        raise ValueError("an UNDERPOWERED reason names the minimum and the count as numbers")
    if st in ("NOT_RUN", "NOT_APPLICABLE") and obj.get("result") is not None:
        raise ValueError(f"a {st} carries result: null")
    pb = obj.get("producedBy")
    if (
        not isinstance(pb, dict)
        or not {"tool", "commit"} <= set(pb) <= {"tool", "commit", "commitReason"}
        or not isinstance(pb["tool"], str)
        or not pb["tool"]
    ):
        raise ValueError("producedBy must be {tool, commit[, commitReason]}")
    if pb["commit"] is None:
        if not isinstance(pb.get("commitReason"), str) or not pb["commitReason"]:
            raise ValueError("producedBy.commit is null without a commitReason (say why)")
    elif not isinstance(pb["commit"], str) or not _SHA.match(pb["commit"]):
        raise ValueError("producedBy.commit is a 7–40 hex sha or null")
    at = obj.get("at")
    if not isinstance(at, str) or not at.endswith("Z"):
        raise ValueError("at must be a UTC instant ending in Z")
    _dt.datetime.fromisoformat(at.replace("Z", "+00:00"))
    if obj.get("scope") not in SCOPES:
        raise ValueError(f"scope must be one of {SCOPES}")


def write(path: str, obj: dict) -> None:
    """Atomic write beside the report (`<path>.tmp` then rename), after validating."""
    validate(obj)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=2)
    os.replace(tmp, path)
