# tepna-capture — blind_spots.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Find, by READING THE TESTS, the arguments a test double accepts and throws away.

THE OTHER END OF MUTATION TESTING. The normal loop mutates a line, runs the suite, and calls the line
untested if nothing reds — minutes per mutant, and `capture.py` alone holds 1231 of them. But this
repo's recurring defect has a shape that can be seen WITHOUT running anything:

    a test double that accepts an argument and discards it makes the code computing that argument
    unobservable, and coverage still reads 100% because the line ran

That is a property of the DOUBLE, not of the production line, and it is decidable from the test source.
Every discarded parameter is a standing proof that whatever the caller computed for it cannot be
observed by any test using that double — which is the definition of a surviving mutant, established in
milliseconds instead of by a suite run per mutant.

WHAT THIS IS NOT. It does not enumerate mutants and it cannot replace a mutation run: a parameter that
IS recorded may still be unasserted, and a line unrelated to any double is invisible here. It finds one
specific, high-yield, historically-dominant family. Treat a hit as a lead with a proof attached, and a
clean file as "this family is absent", never as "this file is tested".

The canonical FIX is already in the tree: `tests/conftest.py`'s `SubprocessRecorder.__call__` takes
`capture_output`, `text` and `timeout` as REQUIRED keyword arguments and appends every one to
`self.calls`, so a caller that stops passing a timeout reds a test. The canonical DEFECT is the same
function with `**_` in place of those names.
"""
from __future__ import annotations

import ast

# A parameter whose name is `_`, or starts with `_`, is the language's own way of saying "deliberately
# ignored". Honouring that convention is what keeps this from crying wolf on every well-written double.
IGNORED_PREFIX = "_"
# `self`/`cls` are the binding, not data the production code computed.
BOUND_NAMES = frozenset({"self", "cls"})

DISCARDED = "DISCARDED"      # named, never read — the production expression is unobservable
SWALLOWED = "SWALLOWED"      # **kwargs never read — EVERY extra keyword is unobservable at once


def _param_names(args: ast.arguments) -> list[str]:
    """Positional, positional-only and keyword-only names, in source order. Excludes *args/**kwargs —
    those are reported separately because their blast radius is different: one unread `**kw` hides an
    unbounded number of arguments, so it is not one finding of the same size."""
    out = []
    for a in (*args.posonlyargs, *args.args, *args.kwonlyargs):
        out.append(a.arg)
    return out


def _names_read(node: ast.AST) -> set[str]:
    """Every identifier LOADED anywhere inside `node`, including nested functions and comprehensions.

    Deliberately over-approximates. A name that appears only in an f-string, a `locals()` call, or a
    nested closure still counts as read — this must not report a double as blind when some path does
    look at the value. Over-approximating loses findings; under-approximating invents them, and an
    invented one costs a person an afternoon proving a non-bug."""
    seen = set()
    for n in ast.walk(node):
        if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load):
            seen.add(n.id)
        # `del x` / `x = ...` do not count as reads, but an augmented assign (`x += 1`) reads first.
        elif isinstance(n, ast.AugAssign) and isinstance(n.target, ast.Name):
            seen.add(n.target.id)
    return seen


def _body_reads(fn: ast.AST) -> set[str]:
    """Names read in the function BODY only — never its own signature. A default expression
    (`def f(a, b=a)`) is evaluated at definition time in the enclosing scope and says nothing about
    whether the body looks at the parameter.

    A `def` body is a list of statements; a LAMBDA body is a single expression node. Handling only the
    first is how this reported `'Call' object is not iterable` on the first real file it met — and
    lambdas are the densest source of one-line doubles in this suite, so they are not a corner case."""
    body = getattr(fn, "body", [])
    stmts = body if isinstance(body, list) else [body]
    reads: set[str] = set()
    for stmt in stmts:
        reads |= _names_read(stmt)
    return reads


def _is_double(fn: ast.AST, depth: int, in_test_class: bool) -> bool:
    """A double is a callable a test hands to production code: a NESTED def, a lambda, or a method on a
    helper class. A top-level `def test_...` is not one — its parameters are pytest fixtures, and an
    unused fixture is a different smell with a different fix (it is usually requested for its side
    effect, e.g. monkeypatching, which is exactly why it is not read)."""
    if isinstance(fn, ast.Lambda):
        return True
    name = getattr(fn, "name", "")
    if name.startswith("test_"):
        return False
    return depth > 0 or in_test_class


def analyze(source: str, path: str = "<test>") -> list[dict]:
    """Every double in `source` that drops an argument. One record per double, newest-first by line.

    Raises SyntaxError to the caller rather than swallowing it: a test file this cannot parse is a file
    this cannot vouch for, and silently returning [] would read as "no blind spots here" — the precise
    failure mode this module exists to expose.
    """
    tree = ast.parse(source, filename=path)
    out: list[dict] = []

    def visit(node: ast.AST, depth: int, in_class: bool) -> None:
        for child in ast.iter_child_nodes(node):
            is_fn = isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda))
            if is_fn and _is_double(child, depth, in_class):
                _record(child, path, out)
            if isinstance(child, ast.ClassDef):
                visit(child, depth, True)
            elif is_fn:
                visit(child, depth + 1, False)
            else:
                visit(child, depth, in_class)

    visit(tree, 0, False)
    out.sort(key=lambda r: (r["file"], r["line"]))
    return out


def _record(fn: ast.AST, path: str, out: list[dict]) -> None:
    reads = _body_reads(fn)
    named = [p for p in _param_names(fn.args)
             if p not in BOUND_NAMES and not p.startswith(IGNORED_PREFIX)]
    dropped = [p for p in named if p not in reads]

    kw = fn.args.kwarg
    swallowed = bool(kw and not kw.arg.startswith(IGNORED_PREFIX) and kw.arg not in reads)

    if not dropped and not swallowed:
        return
    out.append({
        "file": path,
        "line": fn.lineno,
        "double": getattr(fn, "name", "<lambda>"),
        "discarded": dropped,
        "swallowed": kw.arg if swallowed else None,
        "kind": SWALLOWED if swallowed and not dropped else DISCARDED,
        "n_params": len(named),
    })


def rank(findings: list[dict]) -> list[dict]:
    """Worst first. A double that drops MORE of its signature hides more production code, and one that
    swallows `**kwargs` hides an unbounded amount — so it outranks any fixed count."""
    return sorted(findings,
                  key=lambda r: (r["swallowed"] is None, -len(r["discarded"]), r["file"], r["line"]))


def summarize(findings: list[dict]) -> dict:
    """Totals for a run. `params` is the honest headline: it counts ARGUMENTS made unobservable, not
    doubles, because one double dropping four parameters is four blind production expressions."""
    return {
        "doubles": len(findings),
        "params": sum(len(f["discarded"]) for f in findings),
        "swallowing": sum(1 for f in findings if f["swallowed"]),
        "files": len({f["file"] for f in findings}),
    }
