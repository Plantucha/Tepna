# tepna-capture — mutation_swallow.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# SURVIVORS ATTRIBUTABLE TO A SWALLOWED ARGUMENT — the population residue
# `2026-09-20-fake-accepts-and-drops-is-suite-wide` said nobody had.
#
# A test double that ACCEPTS an argument and drops it is indistinguishable from one that CHECKS it, so
# every mutant of that argument survives while coverage reads 100 %. The residue's two syntax greps
# (58/35 files by one pattern, 24/29 by another) count CANDIDATES — fakes that swallow — and a fake that
# legitimately does not care about a kwarg is correct code. The population that is a DEFECT is the
# intersection: a surviving mutant whose change sits inside an argument of a call, where the module's own
# test selection fakes that callee with a signature that never reads the argument. This module computes
# that intersection from the mutation gate's own survivor records; `tools/mutate_swallow.py` is the
# plumbing that feeds it artifacts and test files.
#
# Pure: every function takes text or records and returns data. No filesystem, no subprocess.
from __future__ import annotations

import ast
import textwrap
from typing import TypedDict

__all__ = ["CallArg", "Fake", "Attribution", "parse_key", "call_argument_of", "swallowing_fakes", "attribute"]


class CallArg(TypedDict):
    callee: str
    kind: str          # "pos" | "kw"
    which: int | str   # positional index or keyword name


class Fake(TypedDict):
    name: str          # the callee the fake stands in for
    line: int
    shape: str         # "def" | "lambda" | "setattr-lambda" | "setattr-def"
    unused: list[str]  # parameters the body never reads (the swallowed ones)


class Attribution(TypedDict):
    survivors: int
    call_argument: int
    attributable: int
    rows: list[dict]   # one per attributable survivor: module, key, callee, arg, fakes[{test, line, shape, unused}]
    candidates: dict   # test file → count of swallowing fakes (the grep-shaped population, stated beside)


def parse_key(key: str) -> tuple[str, str] | None:
    """A survivor `key` is `-<before> | +<after>` (one changed line each side). None when it is not."""
    # Split on ` | +` — the AFTER side always starts with `+`, and a BEFORE line can itself contain
    # ` | ` (a bitwise or, a table row), so a bare ` | ` split would cut the wrong place.
    if not key.startswith("-"):
        return None
    i = key.find(" | +")   # the FIRST such bar: the before line is one source line and cannot contain it
    if i == -1:
        return None
    return key[1:i], key[i + 4:]


def _parse_line(line: str) -> ast.AST | None:
    """Parse ONE source line as a statement, wrapping it so a fragment (`return x`, `elif …`, an
    indented body line) still parses. Four wrappers, tried in order; None when none parses."""
    s = textwrap.dedent(line)
    if s.rstrip().endswith(":"):
        s = s + "\n    pass"   # a header line (`if …:`, `elif …:`, `def …:`) needs a body to parse
    for wrap in (s, "def _f():\n    " + s.replace("\n", "\n    "), "async def _f():\n    " + s.replace("\n", "\n    "),
                 "def _f():\n    if True:\n        pass\n    " + s.replace("\n", "\n    ")):
        try:
            return ast.parse(wrap)
        except SyntaxError:
            continue   # this wrapper did not fit the fragment — the next one may; None only after all four
    return None


def _callee_name(f: ast.expr) -> str | None:
    if isinstance(f, ast.Name):
        return f.id
    if isinstance(f, ast.Attribute):
        return f.attr
    return None


def call_argument_of(before: str, after: str) -> CallArg | None:
    """Where the mutation sits, when it sits INSIDE AN ARGUMENT of a call whose callee is unchanged.

    Walks both lines' trees in parallel (a mutation changes a value, not the shape — a shape change
    returns None rather than guessing) and reports the innermost changed Call's differing argument."""
    tb, ta = _parse_line(before), _parse_line(after)
    if tb is None or ta is None:
        return None
    # Pair the CALLS by walk order, not every node: `f(data)` → `f(None)` swaps a Name (which carries a
    # `ctx` child) for a Constant (which does not), so whole-tree node counts differ while the call
    # structure is identical. Pairing calls keeps that mutation visible.
    nb = [n for n in ast.walk(tb) if isinstance(n, ast.Call)]
    na = [n for n in ast.walk(ta) if isinstance(n, ast.Call)]
    if len(nb) != len(na):
        return None
    best: CallArg | None = None
    for b, a in zip(nb, na):
        if ast.dump(b) == ast.dump(a):
            continue
        if ast.dump(b.func) != ast.dump(a.func):
            continue   # the CALLEE changed — that is not an argument mutation
        callee = _callee_name(b.func)
        if callee is None:
            continue
        for i, (x, y) in enumerate(zip(b.args, a.args)):
            if ast.dump(x) != ast.dump(y):
                best = {"callee": callee, "kind": "pos", "which": i}
        for kx, ky in zip(b.keywords, a.keywords):
            if ast.dump(kx) != ast.dump(ky):
                best = {"callee": callee, "kind": "kw", "which": kx.arg or "**"}
    # the LAST differing Call in walk order is the innermost (ast.walk is breadth-first: parents first)
    return best


def _params(args: ast.arguments) -> list[str]:
    names = [a.arg for a in args.posonlyargs + args.args + args.kwonlyargs]
    if args.vararg:
        names.append(args.vararg.arg)
    if args.kwarg:
        names.append(args.kwarg.arg)
    return [n for n in names if n not in ("self", "cls")]


def _unused(params: list[str], body: list[ast.stmt] | ast.expr) -> list[str]:
    nodes: list[ast.AST] = list(body) if isinstance(body, list) else [body]
    used = {n.id for stmt in nodes for n in ast.walk(stmt) if isinstance(n, ast.Name)}
    return [p for p in params if p not in used]


def _setattr_target(call: ast.Call) -> str | None:
    """`monkeypatch.setattr(obj, "name", fake)` / `setattr(obj, "name", fake)` → "name"."""
    f = call.func
    if not ((isinstance(f, ast.Attribute) and f.attr == "setattr") or (isinstance(f, ast.Name) and f.id == "setattr")):
        return None
    if len(call.args) >= 2 and isinstance(call.args[1], ast.Constant) and isinstance(call.args[1].value, str):
        return call.args[1].value
    return None


def swallowing_fakes(test_text: str) -> list[Fake]:
    """Every fake in one test file whose signature accepts a parameter its body never reads.

    Four spellings, all keyed on the NAME the fake stands in for: `def seek(self, *a, **k)`, a method of
    a fake class; `seek = lambda *a, **k: 0`; `monkeypatch.setattr(mod, "seek", lambda *a, **k: 0)`;
    `monkeypatch.setattr(mod, "seek", fake_fn)` where `fake_fn` is a def in the same file. A fake whose
    every parameter is read is NOT listed — it may still be wrong, but it is not a swallower."""
    try:
        tree = ast.parse(test_text)
    except SyntaxError:
        return []
    out: list[Fake] = []
    bound: set[int] = set()
    # defs first, in a pass of their own: a `setattr(mod, "x", fake)` may precede `def fake` in the file
    defs: dict[str, ast.FunctionDef | ast.AsyncFunctionDef] = {
        n.name: n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
    }
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            unused = _unused(_params(node.args), node.body)
            if unused and not node.name.startswith("test_"):
                out.append({"name": node.name, "line": node.lineno, "shape": "def", "unused": unused})
        elif isinstance(node, ast.Assign) and isinstance(node.value, ast.Lambda) and len(node.targets) == 1:
            t = node.targets[0]
            name = t.id if isinstance(t, ast.Name) else t.attr if isinstance(t, ast.Attribute) else None
            unused = _unused(_params(node.value.args), node.value.body)
            if name and unused:
                out.append({"name": name, "line": node.lineno, "shape": "lambda", "unused": unused})
        elif isinstance(node, ast.Call):
            target = _setattr_target(node)
            if target is None or len(node.args) < 3:
                continue
            fake = node.args[2]
            if isinstance(fake, ast.Lambda):
                unused = _unused(_params(fake.args), fake.body)
                if unused:
                    out.append({"name": target, "line": node.lineno, "shape": "setattr-lambda", "unused": unused})
            elif isinstance(fake, ast.Name) and fake.id in defs:
                d = defs[fake.id]
                unused = _unused(_params(d.args), d.body)
                if unused:
                    out.append({"name": target, "line": node.lineno, "shape": "setattr-def", "unused": unused})
                    bound.add(d.lineno)
    # A def that a setattr binds to a callee is ONE fake, reported under the callee's name — drop its
    # bare-def row so the candidate count does not carry the same swallower twice.
    return [f for f in out if not (f["shape"] == "def" and f["line"] in bound)]


def attribute(survivors: list[dict], tests_by_module: dict[str, dict[str, str]]) -> Attribution:
    """The intersection. `survivors`: gate records with `module` + `key`; `tests_by_module`: for each
    module, `{test path: text}` — the SELECTION the gate ran, not the whole suite, because a fake in a
    test the gate never ran cannot have let the mutant survive."""
    seen: set[tuple[str, str]] = set()
    rows: list[dict] = []
    n_call = 0
    fakes_cache: dict[str, list[Fake]] = {}
    candidates: dict[str, int] = {}
    for tests in tests_by_module.values():
        for path, text in tests.items():
            if path not in fakes_cache:
                fakes_cache[path] = swallowing_fakes(text)
                if fakes_cache[path]:
                    candidates[path] = len(fakes_cache[path])
    for s in survivors:
        mod, key = s.get("module"), s.get("key")
        if not isinstance(mod, str) or not isinstance(key, str):
            continue   # not a gate record — never counted as read
        ident = (mod, key)
        if ident in seen:
            continue
        seen.add(ident)
        parsed = parse_key(key)
        if parsed is None:
            continue
        arg = call_argument_of(*parsed)
        if arg is None:
            continue
        n_call += 1
        hits = []
        for path in tests_by_module[mod] if mod in tests_by_module else ():
            for f in fakes_cache[path]:
                if f["name"] == arg["callee"]:
                    hits.append({"test": path, "line": f["line"], "shape": f["shape"], "unused": f["unused"]})
        if hits:
            rows.append({"module": ident[0], "key": ident[1], "callee": arg["callee"], "arg": f"{arg['kind']}:{arg['which']}", "fakes": hits})
    return {"survivors": len(seen), "call_argument": n_call, "attributable": len(rows), "rows": rows, "candidates": candidates}
