# tepna-capture — tests/test_mutate_diff_emit_scope.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`emit` must be callable from every exit `main` has, including the three that return first.

WHY THIS FILE EXISTS. `emit` is a closure over `main`'s locals, and `main` is 1600 lines long, so a
counter declared beside the loop that FILLS it reads fine and is still unbound on every path that
returns before that loop. That shipped: `_timeout_retry` was declared 101 lines below the first
`emit` call, and the gate died with `NameError` and exit 1 on every PR whose diff held no
`capture-host/*.py` — which is most of them, and `mutation (diff-scoped)` is a REQUIRED context.

The three early returns are not equally harmless. The worst is the preflight REFUSAL, whose entire
purpose is to stop a gate that cannot look from reporting green: it exits 2 so a caller can tell
"could not check" from "found survivors", and a `NameError` collapses that distinction into an
ordinary crash.

So this file holds two kinds of test, and the structural one is the point. The three behavioural
legs pin the three paths that exist TODAY. The AST check fails on the next name bound late,
including on a path nobody has written yet.
"""

import ast
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
TOOL = HERE.parent / "tools" / "mutate_diff.py"


def _inside_git_work_tree() -> bool:
    """Is `HERE.parent` a git work tree — the one thing the annotation leg cannot do without?

    🔴 THIS FILE DECIDED NOTHING FOR A WHOLE MODULE BECAUSE ONE LEG FAILED WHERE IT CANNOT RUN.
    mutmut's scratch is a `copytree` of `capture-host/` into `/tmp`, so the mutants tree is not a
    git repository and `git show <merge-base>:capture-host/<module>` cannot resolve. The driver
    then takes its documented fail-closed path, keeps full scope, and reports `NOT_APPLICABLE` for
    a DIFFERENT reason than the annotation check this leg names — so the assertion on the reason
    string fails. That failure lands in mutmut's CLEAN-TEST pass, which stops at the first failure,
    so every mutant of `mutation_diff.py` was recorded as "generated but 0 tested" and
    `mutate_diff` refused the whole diff at exit 2 with `NOT_RUN`. It bites ONLY a PR that changes
    `mutation_diff.py`, because this file names that module and is pulled into its selected test
    set only then — which is exactly why it reads as "only my diff is broken" (measured 2026-10-20
    on #3744, reproduced in 0.20 s inside the leftover `/tmp/mut-mutation_diff-*/work/mutants/`).

    A leg whose claim is unreadable in an environment SKIPS there and says so; it does not fail,
    and it does not weaken its assertion to one that holds everywhere. Under the gate that
    evaluates it — `check.sh`, the `test` job, a bare `pytest` — this returns True and the leg runs
    in full.
    """
    r = subprocess.run(
        ["git", "rev-parse", "--is-inside-work-tree"],
        cwd=str(HERE.parent),
        capture_output=True,
        text=True,
    )
    return r.returncode == 0 and r.stdout.strip() == "true"


# ── THE STRUCTURAL CHECK ────────────────────────────────────────────────────────────────────────


def _main_scope_bindings(fn: ast.FunctionDef) -> dict[str, int]:
    """First binding line of each name bound in `fn`'s OWN scope.

    The walk stops at every nested scope, and that is not an optimisation. A comprehension target or
    an inner function's local is not the name `emit` reads: descending into them reported `k` — a
    comprehension variable inside `emit` itself — as a late binding of `main`. A nested function's
    own NAME is a binding of this scope, so it is recorded before the body is skipped.
    """
    first: dict[str, int] = {}
    own_scope = (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)
    unnamed_scope = (ast.Lambda, ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)

    def walk(node: ast.AST) -> None:
        for child in ast.iter_child_nodes(node):
            if isinstance(child, own_scope):
                first.setdefault(child.name, child.lineno)
                continue
            if isinstance(child, unnamed_scope):
                continue
            if isinstance(child, ast.Name) and isinstance(child.ctx, ast.Store):
                first.setdefault(child.id, child.lineno)
            if isinstance(child, ast.arg):
                first.setdefault(child.arg, child.lineno)
            walk(child)

    walk(fn)
    return first


def _bound_anywhere(fn: ast.FunctionDef) -> set[str]:
    """Every name bound ANYWHERE inside `fn`, nested scopes included.

    This is the other half of the pair. `emit`'s reads are collected over the whole subtree, so a
    comprehension inside it contributes both the names it reads from the enclosing scope (which is
    the point) and its own target `k` (which is not a reference to anything outside). Subtracting
    this set leaves the names `emit` genuinely borrows from `main`.
    """
    out: set[str] = set()
    for node in ast.walk(fn):
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
            out.add(node.id)
        elif isinstance(node, ast.arg):
            out.add(node.arg)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            out.add(node.name)
    return out


def test_every_name_emit_reads_is_bound_before_the_first_emit_call():
    tree = ast.parse(TOOL.read_text(encoding="utf-8"))
    main = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "main")
    emit = next(n for n in ast.walk(main) if isinstance(n, ast.FunctionDef) and n.name == "emit")

    reads = {n.id for n in ast.walk(emit) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load)}
    emit_locals = _bound_anywhere(emit)
    bindings = _main_scope_bindings(main)
    calls = [
        n.lineno
        for n in ast.walk(main)
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "emit"
    ]
    assert calls, "no emit() call found — this check would pass vacuously"
    earliest = min(calls)

    late = sorted(
        (name, bindings[name])
        for name in reads
        if name in bindings and name not in emit_locals and bindings[name] > earliest
    )
    assert late == [], (
        "emit() reads these names from main's scope, bound AFTER the first emit() call at line "
        f"{earliest}, so every return above their binding raises NameError: {late}"
    )


def test_the_structural_check_is_not_vacuous():
    """It must fail on the shape it exists to catch, measured against a planted copy.

    The planted source moves one binding below the first `emit` call. Without this leg the check
    above could pass because it found nothing to look at.
    """
    src = TOOL.read_text(encoding="utf-8")
    # Put `_timeout_retry` back where the defect had it: at main scope, below every early return.
    needle = '    _timeout_retry: dict = {"retried": 0, "settled": [], "stillTimingOut": [], "newlyTimingOut": []}\n'
    anchor = '    if _timeout_retry["retried"]:\n'
    assert src.count(needle) == 1, "the binding this plant moves is no longer a single line"
    # The anchor appears twice; the FIRST is what `replace(..., 1)` takes, and both sit far below
    # every early return, which is all the plant needs.
    assert src.count(anchor) >= 1, "the plant anchor is gone"
    planted = src.replace(needle, "", 1).replace(anchor, needle + anchor, 1)
    tree = ast.parse(planted)
    main = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "main")
    emit = next(n for n in ast.walk(main) if isinstance(n, ast.FunctionDef) and n.name == "emit")
    reads = {n.id for n in ast.walk(emit) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load)}
    emit_locals = _bound_anywhere(emit)
    bindings = _main_scope_bindings(main)
    earliest = min(
        n.lineno
        for n in ast.walk(main)
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "emit"
    )
    late = [n for n in reads if n in bindings and n not in emit_locals and bindings[n] > earliest]
    assert "_timeout_retry" in late, f"the planted late binding was not detected: {late}"


# ── THE THREE EARLY RETURNS ─────────────────────────────────────────────────────────────────────


# Each leg runs the tool in a CHILD process, and that is not fastidiousness.
#
# Importing `tools/mutate_diff.py` into the pytest process puts it in the coverage denominator, and
# the gate runs `--cov-fail-under=100`. Measured: importing it here adds 756 statements at 12 %
# covered, so the floor fails on a file no test was written against. It is absent from the
# denominator today because `[tool.coverage.run] source = [".", "deploy"]` scans for unexecuted files
# only inside IMPORTABLE subdirectories, and `tools/` has no `__init__.py` — so the whole of
# `capture-host/tools/*.py` sits outside a 100 % floor until something imports it. A child process is
# not measured, so these legs exercise the real `main()` without moving that line. The hole itself is
# logged as residue; this file must not be what decides it.
RUNNER = r"""
import importlib.util, json, sys

spec = importlib.util.spec_from_file_location("mutate_diff_under_test", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
patch = json.loads(sys.argv[2])
if "changed" in patch:
    mod.changed_lines = lambda base, _c=patch["changed"]: {k: set(v) for k, v in _c.items()}
if "annotation_only" in patch:
    mod.annotation_only = lambda old, new, _r=patch["annotation_only"]: (bool(_r[0]), _r[1])
if "refusal" in patch:
    mod.refusal_reason = lambda *a, _r=patch["refusal"], **k: _r

# The verdict object nulls `result` over `checked: 0`, so the counters emit assembled never reach
# the JSON on these three paths. This spy keeps them, which is how a leg can assert that the
# hoisted counter still starts at zero rather than merely that nothing raised.
_vo = mod.verdict_object


def _spy(status, **kw):
    with open(sys.argv[3] + ".counters", "w", encoding="utf-8") as fh:
        json.dump(kw.get("result"), fh)
    return _vo(status, **kw)


mod.verdict_object = _spy
raise SystemExit(mod.main(["--base", "HEAD", "--json", sys.argv[3]]))
"""


def _run(tmp_path, patch):
    runner = tmp_path / "run_mutate_diff.py"
    runner.write_text(RUNNER, encoding="utf-8")
    out = tmp_path / "verdict.json"
    proc = subprocess.run(
        [sys.executable, str(runner), str(TOOL), json.dumps(patch), str(out)],
        cwd=str(HERE.parent),
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert "Traceback" not in proc.stderr, f"the gate crashed instead of emitting:\n{proc.stderr}"
    assert out.exists(), f"emit() must write the --json record on every path\n{proc.stdout}{proc.stderr}"
    counters = json.loads(Path(str(out) + ".counters").read_text(encoding="utf-8"))
    # Every early return is a run in which nothing was retried, so both counters read zero. They are
    # asserted here rather than in each leg because all three legs make the same claim about them.
    assert counters["timeoutRetried"] == 0, counters
    assert counters["boundTooTight"] == 0, counters
    return proc.returncode, json.loads(out.read_text(encoding="utf-8"))["verdict"], proc.stdout


def test_no_capture_host_python_changed_is_not_applicable_at_exit_zero(tmp_path):
    code, v, _ = _run(tmp_path, {"changed": {}})
    assert code == 0
    assert v["status"] == "NOT_APPLICABLE"
    assert v["population"] == {"checked": 0, "eligible": 0, "excluded": 0}
    assert "no capture-host/*.py changed" in v["reason"]
    # `result` is null by contract over `checked: 0`, so the object cannot carry the counter whose
    # late binding caused the crash. What this leg proves is that `emit` RAN to its end: it reads
    # `_timeout_retry` on its third line, before anything it writes.
    assert v["result"] is None


def test_annotation_only_change_is_not_applicable_at_exit_zero(tmp_path):
    if not _inside_git_work_tree():
        pytest.skip(f"no git work tree at {HERE.parent} — the base version this leg's reason names is unreadable")
    code, v, out = _run(
        tmp_path,
        {"changed": {"verdict.py": [1]}, "annotation_only": [True, "signature annotations only"]},
    )
    assert code == 0
    assert v["status"] == "NOT_APPLICABLE"
    assert "signature-annotation-only" in v["reason"]
    assert "EXCLUDED from mutation scope" in out


def test_preflight_refusal_is_not_run_at_exit_two(tmp_path):
    """The refusal that exists so a blind gate never reads green. It must REACH its own verdict."""
    code, v, out = _run(
        tmp_path,
        {
            "changed": {"verdict.py": [1]},
            "annotation_only": [False, ""],
            "refusal": "mutmut is not importable",
        },
    )
    assert code == 2, "exit 2 is what lets a caller tell `could not check` from `found survivors`"
    assert v["status"] == "NOT_RUN"
    assert "mutmut is not importable" in v["reason"]
    assert "must not report green" in out


def test_the_three_legs_red_when_the_binding_moves_back(tmp_path):
    """The negative control for the legs, not just for the AST check.

    A copy of the tool with `_timeout_retry` back below the early returns must raise `NameError` on
    all three paths. Without this, the three legs above would still pass on the broken file if some
    other change made `emit` stop reading the counter.
    """
    src = TOOL.read_text(encoding="utf-8")
    needle = '    _timeout_retry: dict = {"retried": 0, "settled": [], "stillTimingOut": [], "newlyTimingOut": []}\n'
    anchor = '    if _timeout_retry["retried"]:\n'
    assert src.count(needle) == 1
    # The copy has to live BESIDE the original. The tool resolves its own siblings from `__file__` at
    # import time — `mutation_diff`, then `mmeta` by path — so a copy under /tmp dies on those imports
    # and never reaches the defect. The leading dot keeps it out of every `*.py` glob (ruff, pytest and
    # the unwired scan all skip it), and the finally removes it even when an assertion fires.
    broken = TOOL.parent / f".mutate_diff_late_binding_{os.getpid()}.py"
    assert not broken.exists(), f"{broken} already exists — refusing to overwrite it"
    runner = tmp_path / "run_mutate_diff.py"
    runner.write_text(RUNNER, encoding="utf-8")
    try:
        broken.write_text(src.replace(needle, "", 1).replace(anchor, needle + anchor, 1), encoding="utf-8")
        for patch in (
            {"changed": {}},
            {"changed": {"verdict.py": [1]}, "annotation_only": [True, "annotations only"]},
            {"changed": {"verdict.py": [1]}, "annotation_only": [False, ""], "refusal": "no mutmut"},
        ):
            proc = subprocess.run(
                [
                    sys.executable,
                    str(runner),
                    str(broken),
                    json.dumps(patch),
                    str(tmp_path / "v.json"),
                ],
                cwd=str(HERE.parent),
                capture_output=True,
                text=True,
                timeout=120,
            )
            assert proc.returncode == 1, f"expected the crash, got {proc.returncode} for {patch}"
            assert "NameError" in proc.stderr, f"expected NameError for {patch}:\n{proc.stderr}"
            assert "_timeout_retry" in proc.stderr
    finally:
        broken.unlink(missing_ok=True)
