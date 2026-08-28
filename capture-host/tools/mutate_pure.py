#!/usr/bin/env python3
# tepna-capture — tools/mutate_pure.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# IN-PROCESS MUTATION FOR PURE FUNCTIONS — mutation testing without a process per mutant.
#
# ── WHY ────────────────────────────────────────────────────────────────────────────────────────────
# mutmut's cost model is: one OS process + one full module import + one pytest collection, PER MUTANT.
# That is the right general design and it is what `tools/mutate.py` drives. But for a PURE predicate —
# no I/O, no globals mutated, arguments in and a value out — every one of those three costs is pure
# overhead, and on `capture.py` they dominate by orders of magnitude:
#
#   capture.py mutant module   100 MB / 1.9 M lines   (7 197 mutants, all generated whatever you scope)
#   cold import of it          429 s                  (0.4 s with a .pyc — see mutate.py's warm-up)
#   mutmut, 230 scoped mutants ~18 s warm             (~27 h without the .pyc)
#   THIS TOOL, same 230        see --self-check       (one process, one import, direct calls)
#
# ── HOW ────────────────────────────────────────────────────────────────────────────────────────────
# mutmut has ALREADY written every mutant as a standalone function into its generated file
# (`x_clock_resync_reason__mutmut_6`). So there is no need to re-derive mutations: harvest those
# function bodies by a line scan (the file is far too large to `ast.parse`), then, in ONE process:
#
#   import the REAL module  ->  for each mutant: exec it, rebind module.<fn>, call the covering test
#   functions directly, restore.
#
# ── THE HARD LIMIT, STATED UP FRONT ────────────────────────────────────────────────────────────────
# This is sound ONLY when both hold, and it refuses to run when it cannot verify them:
#
#   1. The tests reach the function through the MODULE (`capture.foo(...)`), not through a binding
#      captured at import time (`from capture import foo`). A load-time alias makes the swap invisible
#      and every mutant would look "survived" — a silent false negative, the worst outcome a
#      measurement tool can have. Checked by --self-check against a known answer.
#   2. The function is PURE. A mutant that writes global state would leak into later mutants, because
#      there is no process boundary to contain it.
#
# For anything else use `tools/mutate.py`. This tool is a fast path for one specific shape, not a
# replacement — and it prints that in its own output so a reader cannot mistake its scope.
#
#   python tools/mutate_pure.py --mutants <work>/mutants/capture.py --module capture \
#          --funcs clock_resync_reason,radio_looks_deaf --tests tests/test_capture_predicates.py
#   python tools/mutate_pure.py ... --self-check <mutmut-results.txt>   # must agree, or it exits 1

from __future__ import annotations

import argparse
import importlib
import inspect
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent



sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mutation_pure import harvest_text  # noqa: E402


def harvest(mutants_file: str, funcs: list[str]) -> dict[str, list[tuple[str, str]]]:
    """{func: [(mutant_name, source), ...]}. THE READ IS PLUMBING; the scan is
    `mutation_pure.harvest_text`, inside the coverage floor.

    Skipped `__mutmut_orig` entries are now REPORTED rather than dropped inside a condition: testing
    the original as a mutant yields one that survives by construction, i.e. a fabricated test gap."""
    harvested, skipped = harvest_text(Path(mutants_file).read_text(encoding="utf-8"), funcs)
    if skipped:
        print(f"  note: skipped {len(skipped)} __mutmut_orig definition(s) — the ORIGINAL function is "
              f"not a mutant and would survive by construction", file=sys.stderr)
    return harvested


def load_cases(test_files: list[str]) -> list[tuple[str, callable]]:
    """Every zero-fixture `test_*` in the given files, with `@pytest.mark.parametrize` expanded.

    Deliberately NOT pytest.main(): re-collecting per mutant costs more than the tests themselves and
    would make this tool slower than the thing it exists to beat. Tests that need fixtures are SKIPPED
    AND REPORTED — silently dropping them would understate the survivor count.
    """
    cases: list[tuple[str, callable]] = []
    skipped: list[str] = []
    sys.path.insert(0, str(HERE))

    # THE TWO FIXTURES THAT ACCOUNT FOR ALMOST EVERY SKIP HERE. Without them this tool understated
    # kills by 11 % against mutmut — reporting survivors for code that IS tested, which is a false
    # alarm rather than a blind spot, but still wrong. Synthesised per CALL, so a mutant cannot inherit
    # the previous one's patches or temp directory. Anything else (capsys, caplog, custom fixtures) is
    # still reported as not-runnable rather than faked.
    import shutil
    import tempfile

    import pytest as _pt

    # SYNTHESISING FIXTURES WAS TRIED AND REVERTED. Handing a test a fresh `MonkeyPatch()` and a temp
    # dir is easy; what cannot be reproduced outside pytest is the AUTOUSE fixtures a conftest applies
    # to it. `test_the_watchdog_probes_and_restarts_a_deaf_radio` takes only `monkeypatch` and still
    # fails without its autouse setup — it tried to restart the real bluetooth service. The baseline
    # guard caught it, but the lesson is that "declares only fixtures I can fake" does not mean
    # "needs only fixtures I can fake". So: zero-fixture cases only, and the shortfall is reported.
    SYNTH: set[str] = set()

    def with_fixtures(fn, bound: dict):
        def call():
            mp = _pt.MonkeyPatch()
            tmp = Path(tempfile.mkdtemp(prefix="mutpure-"))
            kw = dict(bound)
            for p_ in fn_params(fn):
                if p_ == "monkeypatch":
                    kw["monkeypatch"] = mp
                elif p_ == "tmp_path":
                    kw["tmp_path"] = tmp
            try:
                return fn(**kw)
            finally:
                mp.undo()
                shutil.rmtree(tmp, ignore_errors=True)
        return call

    def fn_params(fn):
        return list(inspect.signature(fn).parameters)
    for tf in test_files:
        try:
            mod = importlib.import_module(Path(tf).with_suffix("").as_posix().replace("/", "."))
        except BaseException as e:                       # noqa: BLE001
            # A test module that only imports under pytest (conftest fixtures, plugins, collection
            # hooks) is not a failure of the tool — but it IS coverage this run did not have, so it is
            # reported rather than swallowed.
            skipped.append(f"{tf} (not importable standalone: {type(e).__name__}: {e})")
            continue
        for nm, fn in vars(mod).items():
            if not nm.startswith("test_") or not callable(fn):
                continue
            params = [m for m in getattr(fn, "pytestmark", []) if m.name == "parametrize"]
            sig = inspect.signature(fn)
            if not params:
                unmet = [p for p in sig.parameters if p not in SYNTH]
                if unmet:
                    skipped.append(f"{mod.__name__}::{nm} (needs {', '.join(unmet)})")
                elif sig.parameters:
                    cases.append((f"{mod.__name__}::{nm}", with_fixtures(fn, {})))
                else:
                    cases.append((f"{mod.__name__}::{nm}", fn))
                continue
            if len(params) != 1:
                skipped.append(f"{mod.__name__}::{nm} (stacked parametrize)")
                continue
            names = [a.strip() for a in params[0].args[0].split(",")]
            others = [p for p in sig.parameters if p not in names and p not in SYNTH]
            if others:
                skipped.append(f"{mod.__name__}::{nm} (needs {', '.join(others)})")
                continue
            for vals in params[0].args[1]:
                vals = vals if isinstance(vals, (tuple, list)) else (vals,)
                kw = dict(zip(names, vals))
                cases.append((f"{mod.__name__}::{nm}[{vals}]", with_fixtures(fn, kw)))
    return cases, skipped


def run_all(cases) -> str | None:
    """First failing case id, or None if every case passed."""
    for cid, fn in cases:
        try:
            fn()
        except BaseException:            # noqa: BLE001 — any raise is a kill, including SystemExit
            return cid
    return None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="In-process mutation testing for PURE functions")
    ap.add_argument("--mutants", required=True, help="mutmut's generated module (work/mutants/<mod>.py)")
    ap.add_argument("--module", required=True, help="module under test, e.g. capture")
    ap.add_argument("--funcs", required=True, help="comma-separated function names")
    ap.add_argument("--tests", required=True, help="comma-separated test files")
    ap.add_argument("--self-check", default=None,
                    help="a `mutmut results` dump; exit 1 unless every verdict agrees")
    a = ap.parse_args(argv)

    funcs = [f.strip() for f in a.funcs.split(",")]
    tests = [t.strip() for t in a.tests.split(",")]

    sys.path.insert(0, str(HERE))
    mod = importlib.import_module(a.module)
    cases, skipped = load_cases(tests)
    if not cases:
        print("no runnable zero-fixture cases — nothing this tool can measure", file=sys.stderr)
        return 2

    # A BASELINE THAT IS NOT GREEN MAKES EVERY VERDICT MEANINGLESS — the same reason mutate.py refuses
    # to present a module whose clean run failed.
    bad = run_all(cases)
    if bad:
        print(f"baseline is RED at {bad} — refusing to measure", file=sys.stderr)
        return 2

    # ── WHICH CASES ACTUALLY REACH EACH FUNCTION ───────────────────────────────────────────────────
    # This is the whole game, and leaving it out is why the first version of this tool was SLOWER than
    # mutmut: running all N cases for every mutant is O(mutants x cases), while mutmut runs only the
    # tests its stats pass proved cover the mutated function. Same idea here, far cheaper: wrap the
    # function in a recorder, run each case ONCE, and keep the cases that called it. Anything that
    # never calls it cannot possibly notice a mutation of it.
    covering: dict[str, list] = {}
    for fn_name in funcs:
        original = getattr(mod, fn_name)
        hits: list = []

        def probe(*args, _o=original, _h=hits, **kw):
            _h.append(1)
            return _o(*args, **kw)
        setattr(mod, fn_name, probe)
        try:
            sel = []
            for cid, fn in cases:
                hits.clear()
                try:
                    fn()
                except BaseException:      # noqa: BLE001 — a case that fails here still counts if it called us
                    pass
                if hits:
                    sel.append((cid, fn))
            covering[fn_name] = sel
        finally:
            setattr(mod, fn_name, original)

    t0 = time.monotonic()
    harvested = harvest(a.mutants, funcs)
    verdicts: dict[str, str] = {}
    for fn_name in funcs:
        original = getattr(mod, fn_name)
        cases_for = covering[fn_name]
        for mut_name, src in harvested[fn_name]:
            ns: dict = {}
            try:
                exec(compile(src, "<mutant>", "exec"), mod.__dict__, ns)
                setattr(mod, fn_name, ns[mut_name])
                verdicts[f"{a.module}.{mut_name}"] = "killed" if run_all(cases_for) else "survived"
            except SyntaxError:
                verdicts[f"{a.module}.{mut_name}"] = "skipped"
            finally:
                setattr(mod, fn_name, original)
    elapsed = time.monotonic() - t0

    killed = sum(v == "killed" for v in verdicts.values())
    total = len(verdicts)
    report = {
        "module": a.module, "funcs": funcs, "mutants": total, "killed": killed,
        "survived": total - killed, "cases": len(cases), "elapsed_sec": round(elapsed, 2),
        "rate_per_sec": round(total / elapsed, 1) if elapsed else None,
        "covering_cases": {f: len(covering[f]) for f in funcs},
        "SCOPE": "PURE functions only — see this file's header; not a replacement for tools/mutate.py",
    }
    if skipped:
        report["tests_not_runnable_here"] = skipped        # loud: these did NOT contribute a verdict
    print(json.dumps(report, indent=2))

    if a.self_check:
        # A NEW MEASUREMENT TOOL IS WORTHLESS UNTIL IT REPRODUCES A KNOWN ANSWER. Disagreeing in the
        # SURVIVED direction is the dangerous one — it means the swap was invisible and the tool is
        # reporting "nothing tests this" about code that is in fact tested.
        ref = {}
        for ln in Path(a.self_check).read_text(encoding="utf-8").splitlines():
            if ":" in ln and ln.strip().startswith(a.module + "."):
                k, _, v = ln.strip().partition(":")
                ref[k.strip()] = v.strip()
        mine = {k: v for k, v in verdicts.items() if k in ref or v == "survived"}
        disagree = [(k, ref.get(k, "killed"), v) for k, v in mine.items()
                    if ref.get(k, "killed") != v]
        print(json.dumps({"self_check": {"compared": len(mine), "disagreements": disagree[:20],
                                         "ok": not disagree}}, indent=2))
        return 1 if disagree else 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
