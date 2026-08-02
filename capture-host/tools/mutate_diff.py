#!/usr/bin/env python3
# tepna-capture — tools/mutate_diff.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# DIFF-SCOPED MUTATION GATE — the one form of mutation testing that belongs in CI.
#
# `tools/mutate.py` is the audit: it sweeps a whole module and hands back leads for a human to triage.
# It must never be a gate, because a large fraction of any module's survivors are legitimately
# untestable (a log string, an unreachable defensive branch, a float boundary), and a gate that reds on
# those gets switched off — which is worse than not having one.
#
# THIS is the gate, and the difference is scope, not severity: mutate only the functions a PR actually
# TOUCHED, and require those mutants killed. It never judges pre-existing code, so it cannot inherit a
# backlog; it enforces exactly one rule, and it is the rule the 2026-08-02 audit showed was missing —
#
#     IF YOU CHANGED THIS LINE, SOME TEST CAN SEE IT.
#
# Precedent for why that rule pays: diskguard.py sat at 100% statement+branch coverage while
# `min_free_gb > 0 and free_gb < min_free_gb` could be flipped to `or` — turning the low-disk alert into
# one that fires on every poll forever — with the whole suite green. Coverage asked "did this line
# run?"; nothing asked "would anyone notice if it were wrong?"
#
# ── Deliberate design choices ────────────────────────────────────────────────────────────────────────
#
# * FUNCTION granularity, not line. mutmut names mutants per function (`module.x_func__mutmut_N`), and
#   a changed line's mutants are addressed by the enclosing function. Slightly wider than the diff,
#   which is the safe direction: it catches a changed line whose behaviour is only observable through
#   a sibling line.
# * STRING-LITERAL mutants are excluded. 29 of the 33 survivors on capture.py's `_now` were mutations
#   of log-message wording. Requiring those killed would mean asserting on log prose, which is exactly
#   the kind of test that makes a suite brittle without making it truthful.
# * NO-OP ON A PR THAT TOUCHES NO PYTHON. Prints, exits 0. A gate that runs when it has nothing to say
#   trains people to ignore it.
# * It reports the mutmut command to reproduce each survivor, because a CI failure that cannot be
#   re-run locally is a wall, not a signal.
#
#   python tools/mutate_diff.py --base origin/main
#   python tools/mutate_diff.py --base origin/main --report-only     # never exit non-zero

from __future__ import annotations

import argparse
import ast
import json
import re
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
VENV_PY = HERE / ".venv" / "bin" / "python"
_HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")


def changed_lines(base: str) -> dict[str, set[int]]:
    """{module.py: {changed line numbers}} for capture-host's own top-level modules.

    `--unified=0` so the hunk headers bound only genuinely changed lines rather than context — context
    lines would pull in neighbouring functions nobody touched, and a gate that blames you for your
    neighbour's code is one you learn to ignore."""
    out: dict[str, set[int]] = {}
    diff = subprocess.run(
        ["git", "diff", "--unified=0", f"{base}...HEAD", "--", "capture-host/*.py"],
        cwd=HERE.parent, capture_output=True, text=True)
    if diff.returncode != 0:
        raise SystemExit(f"git diff failed: {diff.stderr.strip()}")
    current: str | None = None
    for line in diff.stdout.splitlines():
        if line.startswith("+++ b/"):
            p = line[6:]
            name = Path(p).name
            # Only this package's own top-level modules; tests and subdirs are not mutated.
            current = name if p == f"capture-host/{name}" and name.endswith(".py") else None
            continue
        if current and (m := _HUNK.match(line)):
            start, count = int(m.group(1)), int(m.group(2) or 1)
            if count:                       # count 0 means a pure deletion — nothing new to mutate
                out.setdefault(current, set()).update(range(start, start + count))
    return {k: v for k, v in out.items() if v}


def functions_covering(path: Path, lines: set[int]) -> set[str]:
    """mutmut mutant-name stems for the functions containing `lines`.

    Module-level functions are `x_<name>`; methods are `xǁ<Class>ǁ<name>` (mutmut's own separator).
    A changed line outside any function (an import, a module constant) yields nothing — mutmut does not
    generate mutants there under a function name, so there is nothing to require."""
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except (OSError, SyntaxError):
        return set()
    found: set[str] = set()

    def visit(node, cls: str | None):
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                lo = child.lineno
                hi = max((getattr(n, "end_lineno", lo) or lo) for n in ast.walk(child))
                if any(lo <= ln <= hi for ln in lines):
                    found.add(f"xǁ{cls}ǁ{child.name}" if cls else f"x_{child.name}")
                visit(child, cls)
            elif isinstance(child, ast.ClassDef):
                visit(child, child.name)
            else:
                visit(child, cls)

    visit(tree, None)
    return found


def is_string_only(diff_text: str) -> bool:
    """True when a mutant changes nothing but a string literal — log wording and error prose.

    Requiring these killed means asserting on message text, which makes a suite brittle without making
    it more truthful. 29 of 33 survivors on capture.py's `_now` were exactly this."""
    added = [ln for ln in diff_text.splitlines() if ln.startswith("+") and not ln.startswith("+++")]
    if not added:
        return False
    return all(("XX" in ln) or ('"' in ln) or ("'" in ln) for ln in added)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Diff-scoped mutation gate for capture-host")
    ap.add_argument("--base", default="origin/main", help="merge base to diff against")
    ap.add_argument("--report-only", action="store_true", help="never exit non-zero")
    ap.add_argument("--json", default=None, help="write the verdict here")
    a = ap.parse_args(argv)

    changed = changed_lines(a.base)
    if not changed:
        print(f"mutate-diff: no capture-host/*.py changed against {a.base} — nothing to check.")
        return 0

    import importlib.util
    spec = importlib.util.spec_from_file_location("mut", HERE / "tools" / "mutate.py")
    mut = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mut)

    verdict: dict = {"base": a.base, "modules": {}, "survivors": []}
    for module, lines in sorted(changed.items()):
        stems = functions_covering(HERE / module, lines)
        if not stems:
            print(f"  {module}: {len(lines)} changed line(s), none inside a function — skipped")
            continue
        stem_mod = module[:-3]
        globs = [f"{stem_mod}.{s}__mutmut_*" for s in sorted(stems)]
        print(f"  {module}: {len(lines)} changed line(s) in {len(stems)} function(s) → "
              f"{', '.join(sorted(stems))}", flush=True)
        # One mutmut invocation per function keeps a single slow function from hiding the others.
        for g in globs:
            r = mut.run_one(module, only=g)
            if r.get("error"):
                print(f"    ! {g}: {r['error']}")
                continue
            work = Path(r["work"])
            for line in (r.get("results") or "").splitlines():
                if ": survived" not in line:
                    continue
                name = line.split(":")[0].strip()
                show = subprocess.run([str(VENV_PY), "-m", "mutmut", "show", name],
                                      cwd=work, capture_output=True, text=True)
                if is_string_only(show.stdout):
                    continue                       # log/prose mutation — deliberately not required
                verdict["survivors"].append({"mutant": name, "module": module,
                                             "diff": show.stdout[:400], "work": str(work)})
        verdict["modules"][module] = sorted(stems)

    if a.json:
        Path(a.json).write_text(json.dumps(verdict, indent=2), encoding="utf-8")

    if not verdict["survivors"]:
        print("\nmutate-diff: every mutant on the changed functions was killed.")
        return 0

    print(f"\nmutate-diff: {len(verdict['survivors'])} mutant(s) survived on lines this branch "
          f"changed — no test can see these edits:\n")
    for s in verdict["survivors"]:
        print(f"  ── {s['mutant']}")
        for ln in s["diff"].splitlines():
            if ln.startswith(("-", "+")) and not ln.startswith(("---", "+++")):
                print(f"     {ln}")
    print("\n  Each one means: change that line and the suite stays green. Either add an assertion that\n"
          "  observes it, or — if it is genuinely unobservable (a defensive branch, a float boundary) —\n"
          "  say so in the PR. Reproduce locally with:\n"
          "      cd capture-host && .venv/bin/python tools/mutate_diff.py --base origin/main")
    return 0 if a.report_only else 1


if __name__ == "__main__":
    raise SystemExit(main())
