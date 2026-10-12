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
# ── Bounding a run, added 2026-08-02 after webmon went unmeasured ────────────────────────────────────
#
# 4. THE PER-MODULE CAP WAS A FLAT `--timeout 3600`, and a flat number fits nothing here: it is ~15000x
#    pull_session's clean run and not quite 2x what webmon needs. webmon blew it TWICE and, because
#    TimeoutExpired propagated straight out of run_one, each attempt died with a traceback and left no
#    measurement at all — so the audit recorded webmon as simply unmeasured rather than as "ran this
#    long, got this far". The cap is now DERIVED from the module's own clean run (300x, floor 1800 s);
#    a cap that IS hit still reports its partial counts, behind an explicit `timed_out` flag; and
#    `--budget` skips an over-budget module loudly. Ported from the JS sibling tools/mutate.mjs (#702),
#    which reached the same conclusions on the same day from the same failure.
# 5. MEASURE FIRST, THEN DECIDE. `--estimate` times one clean run of the selection and prints what the
#    module will cost, without generating a single mutant. Measured 2026-08-02 on 24 cores:
#      pull_session     5 test files,  45 tests →  0.2-6.3 s clean ·  466 mutants
#      storage_targets  4 test files            →  ~0.4 s clean    · 1073 mutants
#      webmon          11 test files, 518 tests → 22.3 s clean     · 2345 mutants → 6680 s cap
#    The spread is the point: the dominant cost is the test SELECTION, and mutmut pays it once for
#    stats collection (a coverage pass over every selected test) before testing a single mutant.
# 6. A SKIP IS NOT A PASS — `main` exits non-zero when any module was skipped, for the same reason the
#    tool refuses to present a timed-out module as complete.
#
# Each run happens in a scratch copy under /tmp so the live pyproject.toml is never rewritten (the
# capture-host tree is shared with a running daemon and other sessions).
#
#   python tools/mutate.py diskguard alerts bonding clockcfg
#   python tools/mutate.py webmon --estimate         # what will this cost, before it costs it?
#   python tools/mutate.py --list

from __future__ import annotations

import argparse
import json
import os
import shutil
import pathlib
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
VENV_PY = HERE / ".venv" / "bin" / "python"

# §2 (OXYII-G1-FOLLOWUPS) — mutmut's exit-code cache is a function of the TESTS, but this file keys its
# scratch REUSE on the module source hash alone, so a scratch reused after a test was added/modified
# serves stale verdicts and the new killer goes uncredited on the first run. mmeta invalidates just the
# results cache (keeping the expensive mutant source + warm .pyc) when the test tree moves. Loaded by
# path: these tools run as scripts, so sys.path[0] is tools/, not the root where mmeta lives.
import importlib.util as _ilu  # noqa: E402

_mmspec = _ilu.spec_from_file_location("mmeta", HERE / "mmeta.py")
mmeta = _ilu.module_from_spec(_mmspec)
_mmspec.loader.exec_module(mmeta)

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

# ── TREE-SCAN TESTS ARE DESELECTED UNDER MUTATION, IN BOTH PHASES ──────────────────────────────
# A TREE-SCAN test — one whose subject is the tree (source TEXT or file PROPERTIES) rather than any
# code behaviour — must be deselected under mutation. mutmut copies the tree to mutants/ and rewrites
# each module to hold every mutant variant, so both readings measure a CORRECT MEASUREMENT OF THE
# WRONG ARTIFACT: generated source, or a copied file whose permissions and neighbours differ.
#
# The two halves were found one after the other, and the second only became visible once the first
# was fixed — which is why the marker covers the CAUSE rather than either symptom:
#   · SOURCE TEXT — multiplication preserves PRESENCE and destroys COUNTS.
#   · FILE PROPERTIES — note 3 above: a test that reads the filesystem relative to its own location
#     "fails unconditionally, which would mark every mutant killed and report a beautiful,
#     meaningless 100%".
#
# Measured 2026-08-26: `test_only_the_clock_sync_call_site_opts_in` does `inspect.getsource(capture)`
# and counts lines containing `presence_check_s=`, asserting exactly 1. mutmut rewrites the module to
# hold every mutant variant of every function, so the count came back **112**, the baseline aborted
# (`failed to collect stats. runner returned 1`), and NO mutant was ever evaluated. capture.py — the
# daemon's largest and most wiring-dense module — had therefore never been successfully diff-mutated.
#
# Deselected in BOTH phases on purpose, and the second is the one that matters more:
#   · STATS COLLECTION — otherwise the baseline fails and the run reports nothing at all (loud).
#   · THE MUTANT RUNS  — otherwise a source-scan test failing against rewritten source would FAKE-KILL
#                        every mutant, inflating the kill rate with a false green (silent, worse).
#
# The marker, rather than making the assertions presence-based: a count catches what presence cannot —
# the 112 case is precisely a count doing its job — so weakening every source scan to save the runner
# would trade a real check for a convenience.
CONFIG = """
[tool.pytest.ini_options]
testpaths = ["tests"]
markers = ["tree_scan: inspects the TREE (source text or file properties), not behaviour"]

[tool.mutmut]
source_paths = [{source!r}]
also_copy = [{also_copy}]
pytest_add_cli_args_test_selection = [{tests}, "-m", "not tree_scan"]
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


def clean_run_seconds(tests: list[str]) -> float:
    """Time ONE clean run of this module's test selection, in the live tree.

    This is the number that decides what a module costs, and it spans two orders of magnitude across
    this repo — measured 2026-08-02: pull_session 0.23 s (5 files, 45 tests) · storage_targets 0.4 s ·
    webmon 21.5 s (11 files, 518 tests). mutmut then pays it once for stats collection (a coverage
    pass over the whole selection) before a single mutant is tested, which is why a module can blow a
    fixed cap during SETUP and report nothing at all.

    Borrowed from tools/mutate.mjs (#702), which reached the same conclusion on the JS side: measure
    the clean run, then derive the bound from it rather than guessing a flat number."""
    t0 = time.monotonic()
    subprocess.run([str(VENV_PY), "-m", "pytest", "-q", "-p", "no:cacheprovider",
                    "-m", "not tree_scan", *tests],
                   cwd=HERE, capture_output=True, text=True, timeout=3600)
    return time.monotonic() - t0


def budget_for(clean_sec: float) -> int:
    """Seconds to allow one module, derived from its own clean run rather than picked.

    A FLAT 3600 was not a cap so much as a promise never to notice — it is 15000x pull_session's clean
    run and barely 2x what webmon needs once stats collection is paid, which is exactly how webmon
    "exceeded the per-module timeout twice" and stayed the one unmeasured module in the audit.

    300x the clean run, floor 1800 s: mutmut tests each mutant against only the tests covering the
    mutated function, so the per-mutant cost is a fraction of the full selection — the multiplier is
    dominated by mutant COUNT (~2-3 per statement here), and 300 leaves room for both. Slower than
    that is not slow, it is stuck."""
    return max(1800, int(clean_sec * 300))


def run_one(module: str, only: str | None = None, tests_override: list[str] | None = None,
            timeout: int | None = None, budget: int = 0, estimate_only: bool = False,
            reuse: bool = True) -> dict:
    """`only` is a mutant-name glob, `tests_override` a hand-picked selection.

    Both exist for capture.py, where the name-substring heuristic in `tests_for` is useless — "capture"
    appears in 76 of 78 test files, so scoping buys nothing and a full-suite run per mutant is
    hopeless. For a 3,600-line module the honest unit of work is one SUBSYSTEM: mutate the clock
    functions with `--only 'capture.x__now__*'` against the four clock test files."""
    # FIRST STATEMENT, deliberately. Two earlier attempts put the first heartbeat after the scratch
    # copy and then after test discovery, and both times the caller still saw ~70 s of nothing —
    # because the guess about where the time went was wrong, twice. The only placement that cannot be
    # wrong is before anything else runs; every later phase overwrites this line.
    # `module` carries the .py suffix; `stem` does not, and the verdict heartbeat below uses `stem`.
    # Writing both under one name matters more than which: a reader polling two different paths sees
    # a phase vanish and concludes the code never ran — which is exactly what happened three times
    # while diagnosing this, each time "fixed" by moving the beat earlier for no reason.
    _stem = module[:-3] if module.endswith(".py") else module
    _prog = pathlib.Path(f"/tmp/mutate-{_stem}.progress")

    def _beat(msg: str, final: bool = False) -> None:
        """Every line carries the PID and a wall-clock stamp, and the last one says LIVE=no.

        Without those a finished run's last line is indistinguishable from a running one — a reader
        polls, sees `1231 mutants  killed=1081`, and cannot tell whether that is this run's progress or
        yesterday's leftovers. Reporting a stale file as live is worse than reporting nothing, and it is
        the same failure that had a completed run sitting unnoticed for six hours on 2026-08-04.
        """
        _prog.write_text(f"{_stem}  {msg}\n"
                         f"  pid={os.getpid()}  updated={time.strftime('%H:%M:%S')}  "
                         f"LIVE={'no' if final else 'yes'}\n")
    _beat("starting — selecting tests")
    tests = tests_override or tests_for(module)
    if not tests:
        return {"module": module, "error": "no test file names this module"}
    _beat("timing the clean baseline suite  (mutmut not started)")
    clean = clean_run_seconds(tests)
    cap = timeout if timeout is not None else budget_for(clean)
    plan = {"module": module, "tests": tests, "clean_run_sec": round(clean, 2),
            "timeout_sec": cap, "derived": timeout is None}
    if budget and clean > budget:
        # LOUD, with the numbers and the way out — the mjs sibling's --budget, same reasoning: a module
        # silently skipped is indistinguishable from one that passed.
        return {**plan, "skipped": f"clean run {clean:.1f}s exceeds --budget {budget}s",
                "advice": f"narrow it: --tests '{tests[0]},...' (currently {len(tests)} files), "
                          f"or scope it: --only '{module[:-3]}.x_<func>__mutmut_*'"}
    if estimate_only:
        return {**plan, "estimate_only": True}
    # REUSE A SCRATCH WHOSE MUTANTS ARE STILL VALID. The generated mutant file is a pure function of the
    # MUTATED MODULE — mutmut copies the tests but never mutates them (`do_not_mutate = ["tests/*"]`).
    # So regenerating on a test-only change rebuilds a byte-identical 100 MB file and throws away the
    # warm .pyc with it. Measured on capture.py: 22 min per iteration became 18 s. A mutation pass is
    # many iterations of "edit a test, re-measure", so this is the difference between usable and not.
    # Keyed on the module's own hash, so a source change can never silently reuse stale mutants.
    import hashlib
    src_hash = hashlib.sha256((HERE / module).read_bytes()).hexdigest()[:12]
    reusable = Path(tempfile.gettempdir()) / f"mut-{module[:-3]}-{src_hash}"
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
    # PRUNE THIS MODULE'S STALE SCRATCHES. Two reasons this is not optional. (1) /tmp is tmpfs on the
    # capture host — a scratch is RAM, and webmon's is 115 MB, capture's 152 MB. (2) The reuse above is
    # a CACHE, and a cache without eviction is a leak: one directory per module VERSION, so a module
    # edited ten times during a pass leaves ten. Measured 2026-08-03 before this existed: 153 orphaned
    # scratches, 2.6 GB. Everything for this module that is not the current hash goes.
    pruned = []
    for old_dir in Path(tempfile.gettempdir()).glob(f"mut-{module[:-3]}-*"):
        if old_dir != reusable and old_dir.is_dir():
            pruned.append(old_dir.name)
            shutil.rmtree(old_dir, ignore_errors=True)
    if pruned:
        plan["pruned_scratches"] = pruned
    if reuse and (reusable / "work" / "mutants" / module).exists():
        scratch, work = reusable, reusable / "work"
        # REFRESH THE WHOLE tests/ TREE, not just the selected files. Copying only the selection was a
        # real bug: `tests/_srcscan.py` is a HELPER, never named in a selection, so a scratch predating
        # it kept an old tests/ and every run died with `ModuleNotFoundError: tests._srcscan` — which
        # mutmut reports as "Failed to collect list of tests", i.e. a beautiful, meaningless 100%.
        # Any new conftest, fixture module or helper would have done the same. tests/ is small; copy it.
        for sub in ("", "mutants"):
            dest_root = work / sub / "tests" if sub else work / "tests"
            shutil.rmtree(dest_root, ignore_errors=True)
            shutil.copytree(HERE / "tests", dest_root,
                            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        plan["reused_scratch"] = str(scratch)
    else:
        scratch = reusable if reuse else Path(tempfile.mkdtemp(prefix=f"mut-{module[:-3]}-"))
        work = scratch / "work"
        shutil.rmtree(scratch, ignore_errors=True)
        # Copy the tree WITHOUT .venv/mutants — 7.7 MB, so this is cheaper than being clever.
        # The two phases BEFORE mutmut starts — copying the tree and running the clean baseline —
        # are ~84 s on cpap_harvest and had no signal at all, because `t0` (and therefore the verdict
        # heartbeat) starts after them. A caller watching the progress file saw nothing for that whole
        # stretch, which is precisely the window in which "starting" and "wedged" look identical.
        _beat("copying scratch tree  (mutmut not started)")
        shutil.copytree(HERE, work, ignore=shutil.ignore_patterns(
            ".venv", "mutants", "__pycache__", "*.pyc", ".coverage*", "htmlcov"))
    (work / "pyproject.toml").write_text(CONFIG.format(
        source=module, also_copy=also, tests=", ".join(repr(t) for t in tests)), encoding="utf-8")
    # §2 — clear mutmut's cached verdicts for this module iff the test tree changed since the scratch was
    # last run, so an added or modified killer is credited on the FIRST run rather than the second. The
    # stamp lives in the reusable scratch (keyed on src_hash), which survives the prune; on a fresh
    # scratch there is no meta yet, so this only records the current test hash for the next reuse.
    if mmeta.refresh_results_if_tests_changed(work, module, HERE / "tests", scratch / ".tests-hash"):
        plan["invalidated_results"] = "tests changed since last run"
    # ⚠️ BYTECODE CACHING IS LOAD-BEARING HERE, and disabling it is what made capture.py unmeasurable.
    # mutmut writes ONE module holding every mutant, so capture.py's is 100 MB / 1.9 M lines. Compiling
    # that costs 429 s; with a .pyc beside it, 0.4 s (measured 2026-08-03). mutmut starts a FRESH
    # PROCESS PER MUTANT, so with PYTHONDONTWRITEBYTECODE=1 every one of them recompiled from scratch —
    # 7 197 mutants x 429 s is 36 days, which is why the audit recorded this module as sampled at 1 %.
    # The flag was there to avoid .pyc litter; the scratch is a throwaway /tmp copy, so there is nothing
    # to keep clean. Letting the first import write the cache makes every later one free.
    env = {**os.environ}
    env.pop("PYTHONDONTWRITEBYTECODE", None)
    stem = module[:-3]
    t0 = time.monotonic()
    # ⚠️ A CAP THAT IS HIT MUST STILL PRODUCE A MEASUREMENT. Before this, `timeout=` raised
    # TimeoutExpired straight out of run_one and the tool died with a traceback — so the two runs that
    # blew the cap on webmon left NOTHING behind, not even "webmon ran for an hour and got this far",
    # and webmon went into the audit as simply unmeasured. mutmut writes its results incrementally, so
    # the partial verdict is on disk and worth reading; what is not honest is presenting it as
    # complete, hence the explicit `timed_out` flag on the record.
    # STREAMED, NOT CAPTURED. mutmut prints a live counter, and `capture_output=True` swallowed it —
    # which is why a 26-minute cpap_harvest run looked identical to a wedged one, and why the runbook
    # had to record "there is no live progress" as a fact rather than a bug. It also means a run killed
    # by the cap left no trace of how far it got. Tee it to stderr (stdout stays the JSON record) and
    # keep the text for `tail`.
    timed_out, rc, buf = False, None, []
    proc = subprocess.Popen([str(VENV_PY), "-m", "mutmut", "run", only or f"{stem}.*"],
                            cwd=work, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, env=env, bufsize=1)
    # A PROGRESS FILE, not just a stream. Streaming to stderr only helps someone watching a terminal;
    # a run launched in the background surfaces nothing until it exits, so a 26-minute cpap_harvest run
    # is silent to the caller either way. This file is rewritten on every verdict so anyone — a person,
    # or an agent polling it — can answer "how far in, and is it moving" at any instant.
    seen = {"killed": 0, "survived": 0, "timeout": 0, "n": 0, "ids": set()}
    try:
        for line in proc.stdout:                       # line-buffered; mutmut rewrites one status line
            buf.append(line)
            sys.stderr.write(line)
            sys.stderr.flush()
            # COUNT DISTINCT MUTANT IDS, not verdict LINES. mutmut re-emits a killed mutant's line
            # more than once, so line-counting reported 2463 mutants for a module that has 1231 — a
            # progress figure that is confidently wrong is worse than none, because it is the number a
            # reader uses to decide whether to keep waiting. The survivor count was right by luck:
            # those are emitted once.
            # HEARTBEAT THROUGH THE SILENT PHASE. mutmut generates every mutant before running any,
            # and on cpap_harvest that phase alone is 5-6 minutes with no verdict to count — which is
            # exactly the stretch where a caller most wants to know the difference between "working"
            # and "wedged". It does print a spinner there; counting those gives the phase a pulse.
            if "Generating mutants" in line:
                _beat(f"generating mutants  {time.monotonic() - t0:.0f}s elapsed  (no verdicts yet)")
                continue
            for mark, key in (("\N{PARTY POPPER}", "killed"), ("\N{DOTTED LINE FACE}", "survived"),
                              ("\N{ALARM CLOCK}", "timeout"), ("\N{SLIGHTLY FROWNING FACE}", "survived")):
                if mark in line:
                    mid = re.search(r"[\w.]+__mutmut_\d+", line)
                    if not mid or mid.group(0) in seen["ids"]:
                        break
                    seen["ids"].add(mid.group(0))
                    seen[key] += 1
                    seen["n"] += 1
                    el = time.monotonic() - t0
                    rate = seen["n"] / el if el > 0 else 0
                    _beat(f"{seen['n']} mutants  {el:.0f}s elapsed  {rate:.1f}/s  "
                          f"killed={seen['killed']} survived={seen['survived']} timeout={seen['timeout']}")
                    break
        rc = proc.wait(timeout=max(1, cap - (time.monotonic() - t0)))
    except subprocess.TimeoutExpired:
        timed_out = True
        proc.kill()
        proc.wait(timeout=30)
    finally:
        if proc.stdout:
            proc.stdout.close()
    tail = "".join(buf)[-2000:]
    elapsed = time.monotonic() - t0
    res = subprocess.run([str(VENV_PY), "-m", "mutmut", "results"],
                         cwd=work, capture_output=True, text=True, env=env, timeout=300)
    # ⚠️ THE SCRATCH ID IS PART OF THE RESULT, because MUTANT IDS ARE ONLY COMPARABLE WITHIN ONE
    # GENERATION. mutmut numbers mutants positionally per function, so `x_f__mutmut_34` in one scratch
    # and another are the same NAME and not necessarily the same MUTATION. Diffing survivor sets across
    # generations silently produces fabricated deltas: on 2026-08-03 that reported "14 regressions" in
    # run_polar that did not exist — the baseline scratch had been deleted by this tool's own pruning
    # and the comparison was against a different generation. Record it so a reader can check, and warn
    # loudly when a prune destroyed something a previous run may have measured against.
    out = {**plan, "rc": rc, "elapsed_sec": round(elapsed, 1), "timed_out": timed_out,
           "scratch_id": scratch.name, "mutant_generation": src_hash,
           "results": res.stdout, "tail": tail, "work": str(work)}
    _beat(f"FINISHED  rc={rc}  {round(elapsed, 1)}s", final=True)
    if plan.get("pruned_scratches"):
        out["WARNING"] = (
            f"pruned {len(plan['pruned_scratches'])} older scratch(es) for this module: "
            f"{plan['pruned_scratches']}. Survivor IDs from those runs are NOT comparable with this "
            f"one — mutant numbering is positional per generation. Re-measure the baseline.")
    if timed_out:
        out["partial"] = ("PARTIAL — the cap was hit, so the counts below cover only the mutants that "
                          "finished. Do not read an unrun mutant as a survivor.")
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Mutation audit for capture-host (audit tool, not a gate)")
    ap.add_argument("modules", nargs="*", help="module names, with or without .py")
    ap.add_argument("--list", action="store_true", help="list mutatable modules and their test files")
    ap.add_argument("--only", default=None, help="mutant-name glob, e.g. 'capture.x__now__*'")
    ap.add_argument("--tests", default=None, help="comma-separated test files, overriding the heuristic")
    ap.add_argument("--timeout", type=int, default=None,
                    help="seconds per module; default is DERIVED from the module's own clean run "
                         "(300x, floor 1800) instead of a flat number that fits nothing")
    ap.add_argument("--budget", type=int, default=0,
                    help="skip a module whose clean run exceeds this many seconds, loudly")
    ap.add_argument("--no-reuse", action="store_true",
                    help="rebuild the scratch even when the module's mutants are still valid")
    ap.add_argument("--estimate", action="store_true",
                    help="time the clean run and print what the module will cost, then stop")
    a = ap.parse_args(argv)
    if a.list:
        for m in modules():
            print(f"{m:24s} {len(tests_for(m))} test file(s)")
        return 0
    targets = [m if m.endswith(".py") else m + ".py" for m in a.modules]
    skipped = 0
    for m in targets:
        print(f"\n=== {m} ===", flush=True)
        r = run_one(m, only=a.only, timeout=a.timeout, budget=a.budget, estimate_only=a.estimate,
                    reuse=not a.no_reuse,
                    tests_override=[x.strip() for x in a.tests.split(",")] if a.tests else None)
        if r.get("skipped"):
            skipped += 1
        # ⚠️ THE VERDICT FIELDS COME FIRST AND ARE NEVER TRUNCATED. This used to be a flat
        # `json.dumps(...)[:1600]`, and on capture.py — whose plan lists 95 test files — the 1600 chars
        # were spent on the test list, so `rc`, `elapsed_sec` and `timed_out` were CUT OFF ENTIRELY.
        # Those are exactly the fields §1 of the runbook tells you to check, and a signal-killed run
        # (rc -15, timed_out false) or a failed one is unreadable without them. Measured 2026-08-03: an
        # rc guard reported "FAILED rc=" on a run that had in fact succeeded. Verdict first, then the
        # bulky plan, and the truncation only ever eats the tail.
        # The estimate fields belong here too: `--estimate` has no rc, so listing only run fields left
        # a useless `{"module": ...}` at the top and demoted the numbers the flag exists to print.
        verdict = {k: r[k] for k in ("module", "rc", "elapsed_sec", "timed_out", "partial",
                                     "skipped", "error", "estimate_only", "clean_run_sec",
                                     "timeout_sec", "derived", "advice", "reused_scratch",
                                     "scratch_id", "mutant_generation", "WARNING",
                                     "work") if k in r}
        print(json.dumps(verdict, indent=2), flush=True)
        rest = {k: v for k, v in r.items() if k not in verdict and k != "results"}
        if rest:
            print(json.dumps(rest, indent=2)[:1600], flush=True)
        print(r.get("results", "")[:4000], flush=True)
    # A skip is not a pass. Exit non-zero so a caller that skipped everything cannot mistake the run
    # for a clean one — the same reason the tool refuses to report a timed-out module as complete.
    return 1 if skipped else 0


if __name__ == "__main__":
    raise SystemExit(main())
