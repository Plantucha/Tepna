#!/usr/bin/env python3
# tepna-capture — tools/mutate.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# MUTATION AUDIT for capture-host — the Python half of the gap TEST-AUDIT-FINDINGS §34 recorded, and
# the sibling of the JS side's tools/mutate.mjs.
#
# WHY, ON A TREE THAT IS ALREADY AT 100%. Coverage answers "was this line executed?". Mutation answers
# "would any test NOTICE if it were wrong?" Those are different questions, and the gap between them is
# exactly where a fully-covered line sits under an assertion that never looks at the value it produced.
#
# ⚠️ THIS IS AN AUDIT TOOL, NOT A GATE. A survivor proves only that the suite cannot see a change at
# that line — nothing more. Many survivors are legitimately untestable: an unreachable defensive
# branch, a log string, a float boundary, a `or 0` on a value that is never None in practice. Wiring a
# whole-tree kill-rate threshold into CI means redding on those, and a gate that reds on the
# untestable gets switched off — which is worse than not having it. The form that belongs in CI is
# DIFF-SCOPED: mutate only the lines a PR touched and require those killed. Not built here yet.
#
# ── Three things about mutmut 3.x that cost an hour each, recorded so they cost nobody else ──────────
#
# 1. `mutmut run --paths-to-mutate X` is 2.x. In 3.7 `run` takes ONLY `--max-children` and positional
#    mutant-name globs; scoping is config-file work. Check the CLI against the version you install.
# 2. `create_mutants` processes EVERY path in `source_paths` before the name filter is applied, so
#    `source_paths = ["."]` walks into `.venv` and dies generating invalid syntax for aiohttp — and
#    even a correct 27-module list spends its whole budget generating mutants for capture.py that a
#    `"diskguard.*"` filter then discards. ONE module per run is the only fast shape.
# 3. mutmut copies the tree to `mutants/` and runs pytest THERE. Any test that reads the filesystem
#    relative to its own location behaves differently in the copy — `test_shell_surface.py` finds no
#    `.sh` files and fails unconditionally, which would mark every mutant "killed" and report a
#    beautiful, meaningless 100%. Per-module test selection avoids it; a whole-suite run does not.
#
# Each run happens in a scratch copy under /tmp so the live pyproject.toml is never rewritten (the
# capture-host tree is shared with a running daemon and other sessions).
#
#   python tools/mutate.py diskguard alerts bonding clockcfg
#   python tools/mutate.py --list

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
VENV_PY = HERE / ".venv" / "bin" / "python"

# ⚠️ TESTS THAT SCAN SOURCE TEXT CANNOT RUN AGAINST A MUTANT FILE, and excluding them is correctness,
# not convenience. mutmut 3 generates ONE file holding every mutant inline (`x_f__mutmut_1`, `_2`, …)
# and dispatches at runtime — so a test that greps the source sees all of them at once. Measured:
# test_no_deprecated_apis.py scans for bleak's deprecated bare `adapter` kwarg, and mutmut's string
# mutation of `"bluez"` → `"BLUEZ"` inside pull_session.py trips it on EVERY run including the
# baseline, which mutmut then reports as "not checked" for the whole module. The test is right about
# real source; it simply cannot be asked about generated source.
SOURCE_SCANNING_TESTS = {"tests/test_no_deprecated_apis.py"}

# Modules whose value is the JSON they print rather than a contract anyone depends on.
SKIP = {"probe_oxyii_ppg.py", "probe_polar_onboard.py", "ppg_grid_check.py", "adapter_ab.py"}

CONFIG = """
[tool.pytest.ini_options]
testpaths = ["tests"]

[tool.mutmut]
source_paths = [{source!r}]
also_copy = [{also_copy}]
pytest_add_cli_args_test_selection = [{tests}]
do_not_mutate = ["tests/*"]
"""


def modules() -> list[str]:
    return sorted(p.name for p in HERE.glob("*.py") if p.name not in SKIP)


def tests_for(module: str) -> list[str]:
    """Test files that MENTION this module, own-name file first.

    Scoping to `test_<module>.py` alone is what makes a run fast, but it also inflates the survivor
    count: a mutant killed only by, say, test_capture_coverage_100.py would be reported as surviving.
    So the selection is every test file that imports or names the module — still a small subset of 78,
    and honest about what it checked."""
    stem = module[:-3]
    own = HERE / "tests" / f"test_{stem}.py"
    found = []
    for t in sorted((HERE / "tests").glob("test_*.py")):
        try:
            if stem in t.read_text(encoding="utf-8"):
                found.append(f"tests/{t.name}")
        except OSError:
            continue
    found = [f for f in found if f not in SOURCE_SCANNING_TESTS]
    if own.exists() and f"tests/{own.name}" in found:
        found.remove(f"tests/{own.name}")
        found.insert(0, f"tests/{own.name}")
    return found


def run_one(module: str, only: str | None = None, tests_override: list[str] | None = None,
            timeout: int = 3600) -> dict:
    """`only` is a mutant-name glob, `tests_override` a hand-picked selection.

    Both exist for capture.py, where the name-substring heuristic in `tests_for` is useless — "capture"
    appears in 76 of 78 test files, so scoping buys nothing and a full-suite run per mutant is
    hopeless. For a 3,600-line module the honest unit of work is one SUBSYSTEM: mutate the clock
    functions with `--only 'capture.x__now__*'` against the four clock test files."""
    tests = tests_override or tests_for(module)
    if not tests:
        return {"module": module, "error": "no test file names this module"}
    scratch = Path(tempfile.mkdtemp(prefix=f"mut-{module[:-3]}-"))
    work = scratch / "work"
    # Copy the tree WITHOUT .venv/mutants — 7.7 MB, so this is cheaper than being clever.
    shutil.copytree(HERE, work, ignore=shutil.ignore_patterns(
        ".venv", "mutants", "__pycache__", "*.pyc", ".coverage*", "htmlcov"))
    # Every OTHER module is copied verbatim (imports must resolve) but only `module` is mutated.
    # ⚠️ THE COPY MUST CONTAIN EVERYTHING A TEST READS FROM DISK, not just what Python imports — and
    # enumerating that by hand is a losing game. Two baselines died proving it: test_radio_deafness
    # reads `tepna-restart.sh`, and test_webmon_endpoints serves `monitor.html`, neither of which is
    # importable and both of which I initially omitted. So copy EVERYTHING except the mutated module
    # (mutmut supplies that) and the build/venv noise. The failure mode this prevents is worse than a
    # slow copy: a baseline that fails inside mutants/ reports "not checked", and one that fails
    # SILENTLY would mark every mutant killed and hand back a meaningless 100%.
    ignore = {".venv", "mutants", "__pycache__", ".coverage", "htmlcov", module}
    extras = sorted(p.name + ("/" if p.is_dir() else "")
                    for p in HERE.iterdir()
                    if p.name not in ignore and not p.name.startswith(".coverage"))
    also = ", ".join(repr(x) for x in extras)
    (work / "pyproject.toml").write_text(CONFIG.format(
        source=module, also_copy=also, tests=", ".join(repr(t) for t in tests)), encoding="utf-8")
    env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
    stem = module[:-3]
    proc = subprocess.run([str(VENV_PY), "-m", "mutmut", "run", only or f"{stem}.*"],
                          cwd=work, capture_output=True, text=True, env=env, timeout=timeout)
    res = subprocess.run([str(VENV_PY), "-m", "mutmut", "results"],
                         cwd=work, capture_output=True, text=True, env=env, timeout=300)
    out = {"module": module, "tests": tests, "rc": proc.returncode,
           "results": res.stdout, "tail": proc.stdout[-2000:] or proc.stderr[-2000:],
           "work": str(work)}
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Mutation audit for capture-host (audit tool, not a gate)")
    ap.add_argument("modules", nargs="*", help="module names, with or without .py")
    ap.add_argument("--list", action="store_true", help="list mutatable modules and their test files")
    ap.add_argument("--only", default=None, help="mutant-name glob, e.g. 'capture.x__now__*'")
    ap.add_argument("--tests", default=None, help="comma-separated test files, overriding the heuristic")
    ap.add_argument("--timeout", type=int, default=3600,
                    help="seconds per module; webmon (524 stmts x 12 test files) needs more than the default")
    a = ap.parse_args(argv)
    if a.list:
        for m in modules():
            print(f"{m:24s} {len(tests_for(m))} test file(s)")
        return 0
    targets = [m if m.endswith(".py") else m + ".py" for m in a.modules]
    for m in targets:
        print(f"\n=== {m} ===", flush=True)
        r = run_one(m, only=a.only, timeout=a.timeout,
                    tests_override=[x.strip() for x in a.tests.split(",")] if a.tests else None)
        print(json.dumps({k: v for k, v in r.items() if k != "results"}, indent=2)[:1200], flush=True)
        print(r.get("results", "")[:4000], flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
