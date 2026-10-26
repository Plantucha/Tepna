#!/usr/bin/env python3
# tepna-capture — tools/scan_signature_only_defaults.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Enumerate every literal default whose ONLY coverage is a test that READS the signature.

THE CLASS. mutmut keeps the ORIGINAL defaults on the visible `def` and dispatches to the mutant at
CALL time, so `inspect.signature(f).parameters["p"].default` reports the original under every mutant
while a call that omits `p` runs the mutant's value. A test written against such a default therefore
cannot observe the mutant it was written for — measured 2026-09-28 on `mutation_diff.stream_bounded`
(`join_sec=10.0 → 11.0` survived the assertion written for it, #3208).

The population is NOT "numeric defaults in signatures". It is a default whose only coverage READS the
signature, so this scan has to classify the coverage and not merely find the defaults. Residue row
`2026-10-12-the-mutated-default-row-is-blocked-on-a-scanner-nobody-has-written` asks for exactly that,
and says why reasoning cannot close it: nothing in the checkout could enumerate the population.

FOUR OUTCOMES, never a bool (`mutation_diff`'s string-literal vocabulary one artifact over):

  · SIGNATURE_ONLY — a signature-reading reference and NO call that omits the parameter. The defect.
  · OBSERVABLE     — at least one call omits the parameter, so the default runs and a mutant is reachable.
  · UNCOVERED      — no TEST references the function, or every test call passes the parameter. The
                     refs come from the test corpus alone, so a PRODUCTION call that omits the
                     parameter is unseen, and so is a test that reaches the default THROUGH
                     production code. UNCOVERED is a statement about test call sites, never a
                     statement that no test would detect a change to the value.
  · UNDECIDABLE    — a static scan is outside its competence here: a `*args` / `**kwargs` splat at the
                     call, a bare-name reference handed somewhere as a callback, or a function name
                     defined in more than one production module. REFUSE, never guess (§∅).

⚠️ ADVISORY, NEVER A GATE, and the exit code is always 0. The bar is the owner's call: a scan like this
turned BLOCKING lands on every open PR at once, which is the cost `STRING-MUTANT-REQUIREDNESS` records
for the sibling question. The report and the `tepna.verdict/1` object are the product. The criterion is
pre-stated so the object is readable, and FAIL means the population is non-empty — not that the diff
under review did anything wrong.

⚠️ MATCHING IS BY FUNCTION NAME, as `find_unwired.py` learned to do: a callback reference carries no
parentheses, and an attribute call (`M.stream_bounded(...)`) carries a module alias this scan does not
resolve. The cost of the bare name is ambiguity, and ambiguity is reported as UNDECIDABLE rather than
attributed to one definition.

⚠️ §🐍 constrains the shape: a hand-advanced `while` index times out under the mutation gate rather
than failing, so every scan here is `for … in enumerate(…)` or an `ast` walk.

Usage:
    python3 tools/scan_signature_only_defaults.py            # report (always exits 0)
    python3 tools/scan_signature_only_defaults.py --json     # machine-readable
    python3 tools/scan_signature_only_defaults.py --verdict-out PATH   # ONE tepna.verdict/1 beside it
    python3 tools/scan_signature_only_defaults.py --verdict-sample     # the adoption gate's object
"""

from __future__ import annotations

import argparse
import ast
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import verdict as _verdict  # noqa: E402

GATE = "scan-signature-only-defaults"
TOOL = "capture-host/tools/scan_signature_only_defaults.py"

SIGNATURE_ONLY = "signature-only"
OBSERVABLE = "observable"
UNCOVERED = "uncovered"
UNDECIDABLE = "undecidable"

# The criterion is PRE-STATED (§🧾): a threshold derived from the data it judges would be UNKNOWN.
CRITERION = {
    "name": "signature_only_defaults",
    "threshold": 0,
    "unit": "defaults",
    "direction": "lte",
}

# The literal kinds the row names. A bool is NOT one of them: `True → False` is a real mutant, but it
# is a different question from a numeric, string or tuple default and the row scoped this one.
_SKIP_DIRS = ("tests", "__pycache__", "deploy", "systemd")

# The attribute reads that make a reference a SIGNATURE READ rather than a call.
_SIG_ATTRS = ("__defaults__", "__kwdefaults__", "__doc__")
_SIG_CALLS = ("signature", "getfullargspec", "getargspec")


def literal_kind(node: ast.AST) -> str | None:
    """`numeric`, `string`, `tuple` — or None for anything else, which this scan does not claim."""
    if isinstance(node, ast.Constant):
        if isinstance(node.value, bool):
            return None
        if isinstance(node.value, (int, float)):
            return "numeric"
        if isinstance(node.value, str):
            return "string"
        return None
    if isinstance(node, ast.Tuple):
        for element in node.elts:
            if literal_kind(element) is None:
                return None
        return "tuple"
    return None


def _is_bound(fn: ast.FunctionDef | ast.AsyncFunctionDef, in_class: bool) -> bool:
    """A method called through an instance or a class drops its first parameter, so every positional
    index this scan compares against a CALL has to drop it too. Measured on the first real run: 17 of
    the 51 ambiguous rows were `__init__`, and every method's index was off by one."""
    if not in_class:
        return False
    for decorator in fn.decorator_list:
        name = decorator.attr if isinstance(decorator, ast.Attribute) else getattr(decorator, "id", None)
        if name == "staticmethod":
            return False
    positional = list(fn.args.posonlyargs) + list(fn.args.args)
    return bool(positional) and positional[0].arg in ("self", "cls")


def _params_with_defaults(fn: ast.FunctionDef | ast.AsyncFunctionDef, in_class: bool = False) -> list[dict]:
    """Every parameter of `fn` carrying a literal default, with the positional index a caller must
    exceed to pass it positionally. A kw-only parameter has no such index."""
    out: list[dict] = []
    bound = 1 if _is_bound(fn, in_class) else 0
    positional = list(fn.args.posonlyargs) + list(fn.args.args)
    first_defaulted = len(positional) - len(fn.args.defaults)
    for offset, default in enumerate(fn.args.defaults):
        kind = literal_kind(default)
        if kind is None:
            continue
        index = first_defaulted + offset
        out.append(
            {
                "param": positional[index].arg,
                "kind": kind,
                "index": index - bound,
                "kwonly": False,
            }
        )
    for offset, kw_default in enumerate(fn.args.kw_defaults):
        if kw_default is None:
            continue
        kind = literal_kind(kw_default)
        if kind is None:
            continue
        out.append({"param": fn.args.kwonlyargs[offset].arg, "kind": kind, "index": None, "kwonly": True})
    return out


def defaults_in_source(text: str, path: str) -> list[dict]:
    """Every literal default defined in one module, keyed by the function's bare name."""
    tree = ast.parse(text)
    found: list[dict] = []
    for owner, node in _functions(tree):
        # A constructor is never CALLED by its own name: `Foo(...)` names the class. So a default on
        # `__init__` is matched against the class, and displayed as the class wrote it.
        if node.name == "__init__" and owner is not None:
            call_name = owner
            display = f"{owner}.__init__"
        elif owner is not None:
            call_name = node.name
            display = f"{owner}.{node.name}"
        else:
            call_name = node.name
            display = node.name
        for entry in _params_with_defaults(node, owner is not None):
            found.append(
                {
                    **entry,
                    "file": path,
                    "function": display,
                    "call_name": call_name,
                    "line": node.lineno,
                }
            )
    return found


def _functions(tree: ast.AST):
    """Every function in a module, paired with the name of the class that owns it, or None."""
    out: list[tuple[str | None, ast.FunctionDef | ast.AsyncFunctionDef]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            for child in node.body:
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    out.append((node.name, child))
        elif isinstance(node, ast.Module):
            for child in node.body:
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    out.append((None, child))
    return out


def _call_name(node: ast.Call) -> str | None:
    if isinstance(node.func, ast.Name):
        return node.func.id
    if isinstance(node.func, ast.Attribute):
        return node.func.attr
    return None


def _sig_read_name(node: ast.AST) -> str | None:
    """The function name a signature-READING expression names, or None."""
    if isinstance(node, ast.Attribute) and node.attr in _SIG_ATTRS:
        target = node.value
        if isinstance(target, ast.Name):
            return target.id
        if isinstance(target, ast.Attribute):
            return target.attr
        return None
    if isinstance(node, ast.Call) and _call_name(node) in _SIG_CALLS and node.args:
        first = node.args[0]
        if isinstance(first, ast.Name):
            return first.id
        if isinstance(first, ast.Attribute):
            return first.attr
        return None
    return None


def _supplies(call: ast.Call, param: str, index: int | None) -> str:
    """`passed`, `omitted` or `undecidable` for ONE parameter at ONE call site."""
    for keyword in call.keywords:
        if keyword.arg is None:
            return UNDECIDABLE  # a ** splat may or may not carry this key
        if keyword.arg == param:
            return "passed"
    for argument in call.args:
        if isinstance(argument, ast.Starred):
            return UNDECIDABLE  # a * splat may or may not reach this position
    if index is not None and len(call.args) > index:
        return "passed"
    return "omitted"


def references_in_source(text: str) -> dict:
    """What one test module says about each function NAME it mentions.

    `sig_reads` — the names it reads a signature of. `calls` — the call nodes per name. `bare` — the
    names it mentions outside a call and outside a signature read, which is a callback handoff this
    scan cannot follow.
    """
    tree = ast.parse(text)
    sig_reads: set[str] = set()
    calls: dict[str, list[ast.Call]] = {}
    attributed: set[int] = set()
    for node in ast.walk(tree):
        name = _sig_read_name(node)
        if name is not None:
            sig_reads.add(name)
            for inner in ast.walk(node):
                attributed.add(id(inner))
            continue
        if isinstance(node, ast.Call):
            called = _call_name(node)
            if called is not None:
                calls.setdefault(called, []).append(node)
                attributed.add(id(node.func))
    bare: set[str] = set()
    for node in ast.walk(tree):
        if id(node) in attributed:
            continue
        if isinstance(node, ast.Name):
            bare.add(node.id)
        elif isinstance(node, ast.Attribute):
            bare.add(node.attr)
    return {"sig_reads": sig_reads, "calls": calls, "bare": bare}


def classify(entry: dict, refs: dict, ambiguous: bool) -> dict:
    """One default's outcome over the whole test corpus."""
    name = entry["call_name"]
    referenced = name in refs["sig_reads"] or name in refs["calls"] or name in refs["bare"]
    if ambiguous and referenced:
        # Two production modules define this name, so no reference can be attributed to one of them.
        return {"outcome": UNDECIDABLE, "reason": "ambiguous-name"}
    if not referenced:
        # Ambiguous or not, no TEST mentions the name. A production call may still run the default.
        return {"outcome": UNCOVERED, "reason": "never referenced"}
    omitted = 0
    passed = 0
    splat = 0
    for call in refs["calls"].get(name, ()):
        verdict_for_call = _supplies(call, entry["param"], entry["index"])
        if verdict_for_call == UNDECIDABLE:
            splat += 1
        elif verdict_for_call == "omitted":
            omitted += 1
        else:
            passed += 1
    # POSITIVE EVIDENCE FIRST. One call that omits the parameter proves the default runs, and a splat
    # or a callback handoff elsewhere does not retract that proof. Doubt only decides a default no
    # call was seen to exercise.
    if omitted:
        return {"outcome": OBSERVABLE, "reason": None}
    if splat:
        return {"outcome": UNDECIDABLE, "reason": "splat-at-call"}
    if name in refs["bare"]:
        return {"outcome": UNDECIDABLE, "reason": "bare-name-reference"}
    if name in refs["sig_reads"]:
        return {"outcome": SIGNATURE_ONLY, "reason": "only a signature read covers this default"}
    return {"outcome": UNCOVERED, "reason": "no call omits it" if passed else "never referenced"}


def production_files(root: str) -> list[str]:
    """Every production `*.py` under `root`, sorted, with the test and deployment trees out."""
    out: list[str] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in _SKIP_DIRS and not d.startswith(".venv"))
        for filename in sorted(filenames):
            if filename.endswith(".py"):
                out.append(os.path.join(dirpath, filename))
    return sorted(out)


def suite_files(root: str) -> list[str]:
    tests = os.path.join(root, "tests")
    if not os.path.isdir(tests):
        return []
    out: list[str] = []
    for dirpath, dirnames, filenames in os.walk(tests):
        dirnames[:] = sorted(d for d in dirnames if d != "__pycache__")
        for filename in sorted(filenames):
            if filename.endswith(".py"):
                out.append(os.path.join(dirpath, filename))
    return sorted(out)


def _merge_refs(paths: list[str]) -> dict:
    merged: dict = {"sig_reads": set(), "calls": {}, "bare": set()}
    for path in paths:
        with open(path, encoding="utf-8") as handle:
            one = references_in_source(handle.read())
        merged["sig_reads"] |= one["sig_reads"]
        merged["bare"] |= one["bare"]
        for name, nodes in one["calls"].items():
            merged["calls"].setdefault(name, []).extend(nodes)
    return merged


def scan(root: str) -> dict:
    """The whole measurement over one checkout."""
    defaults: list[dict] = []
    definitions: dict[str, set[str]] = {}
    for path in production_files(root):
        with open(path, encoding="utf-8") as handle:
            text = handle.read()
        relative = os.path.relpath(path, root)
        for entry in defaults_in_source(text, relative):
            defaults.append(entry)
            definitions.setdefault(entry["call_name"], set()).add(relative)
    refs = _merge_refs(suite_files(root))
    rows: list[dict] = []
    for entry in defaults:
        ambiguous = len(definitions[entry["call_name"]]) > 1
        rows.append({**entry, **classify(entry, refs, ambiguous)})
    counts = {
        key: sum(1 for row in rows if row["outcome"] == key)
        for key in (SIGNATURE_ONLY, OBSERVABLE, UNCOVERED, UNDECIDABLE)
    }
    return {"root": root, "rows": rows, "counts": counts, "modules": len(definitions)}


def _commit() -> str | None:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short=12", "HEAD"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except OSError:  # pragma: no cover - a box without git
        return None
    sha = out.stdout.strip()
    return sha if out.returncode == 0 and sha else None


def verdict_object(result: dict, commit: str | None) -> dict:
    counts = result["counts"]
    eligible = len(result["rows"])
    excluded = counts[UNDECIDABLE]
    checked = eligible - excluded
    offenders = counts[SIGNATURE_ONLY]
    if checked == 0:
        # NOT_RUN examined nothing, so it carries no result — the contract refuses one.
        return _verdict.make(
            gate=GATE,
            status="NOT_RUN",
            population={"checked": 0, "eligible": eligible, "excluded": excluded},
            criterion=dict(CRITERION),
            result=None,
            evidence=[TOOL],
            reason="no literal default was classifiable in this tree",
            tool=TOOL,
            commit=commit,
        )
    if offenders:
        status = "FAIL"
        reason = f"{offenders} default(s) covered only by a signature read"
    else:
        status = "PASS"
        reason = None
    return _verdict.make(
        gate=GATE,
        status=status,
        population={"checked": checked, "eligible": eligible, "excluded": excluded},
        criterion=dict(CRITERION),
        result={
            "signature_only": offenders,
            "observable": counts[OBSERVABLE],
            "uncovered": counts[UNCOVERED],
            "undecidable": excluded,
            "functions_with_literal_defaults": result["modules"],
        },
        evidence=[TOOL],
        reason=reason,
        tool=TOOL,
        commit=commit,
    )


def sample_verdict() -> dict:
    """The adoption gate's object: synthetic, needs no tree and no interpreter floor."""
    synthetic = {
        "root": ".",
        "modules": 1,
        "rows": [{"outcome": SIGNATURE_ONLY}, {"outcome": OBSERVABLE}, {"outcome": UNDECIDABLE}],
        "counts": {SIGNATURE_ONLY: 1, OBSERVABLE: 1, UNCOVERED: 0, UNDECIDABLE: 1},
    }
    return verdict_object(synthetic, None)


def format_report(result: dict) -> str:
    counts = result["counts"]
    lines = [
        f"▸ {GATE} — {len(result['rows'])} literal default(s) over {result['modules']} function(s) that carry one",
        f"  {SIGNATURE_ONLY:<14} {counts[SIGNATURE_ONLY]:>4}   ← the defect: no test call omits it",
        f"  {OBSERVABLE:<14} {counts[OBSERVABLE]:>4}   a call omits it, so a mutant runs",
        f"  {UNCOVERED:<14} {counts[UNCOVERED]:>4}   no test CALL omits it — an indirect reach is unseen",
        f"  {UNDECIDABLE:<14} {counts[UNDECIDABLE]:>4}   outside a static scan's competence",
        "",
    ]
    for row in result["rows"]:
        if row["outcome"] != SIGNATURE_ONLY:
            continue
        lines.append(f"  {row['file']}:{row['line']} {row['function']}({row['param']}=) [{row['kind']}]")
    lines.append("")
    lines.append("  ADVISORY — the exit code is always 0 and the bar is the owner's.")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="literal defaults whose only coverage reads the signature")
    parser.add_argument("--root", default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    parser.add_argument("--json", action="store_true", help="machine-readable rows")
    parser.add_argument("--verdict-out", default=None, help="write ONE tepna.verdict/1 to PATH")
    parser.add_argument("--verdict-sample", action="store_true", help="print the adoption object alone")
    args = parser.parse_args(argv)
    if args.verdict_sample:
        print(json.dumps(sample_verdict()))
        return 0
    result = scan(args.root)
    if args.verdict_out:
        with open(args.verdict_out, "w", encoding="utf-8") as handle:
            json.dump(verdict_object(result, _commit()), handle)
            handle.write("\n")
    if args.json:
        print(json.dumps({"counts": result["counts"], "rows": result["rows"]}))
    else:
        print(format_report(result))
    return 0


if __name__ == "__main__":  # pragma: no cover - CLI
    raise SystemExit(main())
