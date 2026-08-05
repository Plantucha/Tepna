#!/usr/bin/env python3
# tepna-capture — tools/mutate_triage.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Triage a module's mutation survivors, and state the CEILING before anyone aims at a number.

WHY THIS EXISTS. `tools/mutate.py` answers "which mutants survived". That is the cheap half. The
expensive half is deciding which of them a test could ever kill — and getting that wrong is not a
small error. On 2026-08-04 a hand estimate said `pull_session` could reach 94.4 %; the work delivered
72.1 %, because the estimate counted 85 `print()` survivors as reachable when 30 of them differ only
in `flush=`, which no assertion on captured output can see.

So this tool refuses to report a kill rate without also reporting what is UNREACHABLE:

  UNOBSERVABLE  no test can distinguish it. `flush=` alone (capsys reads the buffer either way),
                mutmut's `"XX…XX"` literal wrapping, and case flips inside a string — killable only by
                asserting exact wording, which pins phrasing and reds the build on every message edit.
  EQUIVALENT?   the mutation is real but may be unobservable in context. Flagged, never assumed —
                confirm with a witness search before dismissing (see --witness).
  PROSE         a log/error string whose VALUES are intact. Killable only via exact text. Leave it.
  REACHABLE     everything else. This is the work-list, and it is usually a fifth of the survivors.

CEILING = (total - UNOBSERVABLE) / total. Aim above it and the only way to get there is to assert
wording, which is a worse suite than a lower number.

Usage:
  python3 tools/mutate_triage.py <module>              # triage the newest scratch for <module>
  python3 tools/mutate_triage.py <module> --work       # print only the REACHABLE work-list, with diffs
  python3 tools/mutate_triage.py <module> --json       # machine-readable, for a brief's table
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import subprocess
import sys
import time

# The CLASSIFIER lives in `mutation_triage.py`, one directory up, because that directory is inside the
# coverage floor and this one is not. These ~40 lines of decision logic are the only part of this tool
# that can silently mislead — the plumbing below is deliberately left uncovered. See that module's
# header for why the split is partial on purpose.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from mutation_triage import ceiling, classify, concentration  # noqa: E402


def newest_scratch(module: str) -> str | None:
    hits = sorted(glob.glob(f"/tmp/mut-{module}-*/work"), key=os.path.getmtime, reverse=True)
    return hits[0] if hits else None


def mutmut_results(work: str, python: str) -> tuple[list[str], int]:
    out = subprocess.run([python, "-m", "mutmut", "results"], cwd=work,
                         capture_output=True, text=True, timeout=600).stdout
    surv = [ln.strip().split(":")[0] for ln in out.splitlines() if ln.strip().endswith(": survived")]
    tmo = sum(1 for ln in out.splitlines() if ln.strip().endswith(": timeout"))
    return surv, tmo


def mutmut_diff(work: str, python: str, mid: str) -> tuple[str, str]:
    out = subprocess.run([python, "-m", "mutmut", "show", mid], cwd=work,
                         capture_output=True, text=True, timeout=60).stdout
    minus = [l[1:] for l in out.splitlines() if l.startswith("-") and not l.startswith("---")]
    plus = [l[1:] for l in out.splitlines() if l.startswith("+") and not l.startswith("+++")]
    return (minus[0] if minus else ""), (plus[0] if plus else "")


def rank_all(py: str) -> int:
    """Which module's next pass is cheapest — the question eight passes were spent answering by hand.

    Sorted by the size of the largest reachable cluster, not by how much is left: a dense cluster is
    one fixture, a scattered set of the same size is several.
    """
    mods = sorted({os.path.basename(os.path.dirname(w))[4:].rsplit("-", 1)[0]
                   for w in glob.glob("/tmp/mut-*/work")})
    rows = []
    for m in mods:
        work = newest_scratch(m)
        if not work:
            continue
        try:
            surv, tmo = mutmut_results(work, py)
        except Exception:                                   # noqa: BLE001 — a half-written scratch
            continue
        if not surv:
            continue
        fns = []
        for mid in surv:
            a, b = mutmut_diff(work, py, mid)
            if classify(a, b)[0] == "REACHABLE":
                fns.append(re.sub(r".*x_?(.+?)__mutmut_\d+.*", r"\1", mid))
        c = concentration(fns)
        rows.append((m, len(surv), tmo, c))
    rows.sort(key=lambda r: -r[3]["top_n"])
    print("%-18s %9s %10s %-22s %7s" % ("module", "survivors", "reachable", "largest cluster", "share"))
    for m, ns, tmo, c in rows:
        top = f"{c['top']}={c['top_n']}" if c["top"] else "-"
        print("%-18s %9d %10d %-22s %6.0f%%" % (m, ns, c["total"], top, 100 * c["top_share"]))
    print("\n  Sorted by LARGEST CLUSTER, not by what is left: a dense cluster is one fixture, a")
    print("  scattered set of the same size is several. Measured over eight passes on 2026-08-04.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("module", nargs="?")
    ap.add_argument("--total", type=int, help="total mutants (from the audit stats); enables the ceiling")
    ap.add_argument("--work", action="store_true", help="print only the REACHABLE work-list, with diffs")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--rank", action="store_true",
                    help="rank every module with a scratch by how cheap its next pass is")
    ap.add_argument("--python", default=".venv/bin/python")
    a = ap.parse_args()

    py_early = os.path.abspath(a.python)
    if a.rank:
        return rank_all(py_early)

    work = newest_scratch(a.module)
    if not work:
        print(f"no scratch for {a.module} — run tools/mutate.py first", file=sys.stderr)
        return 2
    py = os.path.abspath(a.python)

    surv, tmo = mutmut_results(work, py)
    if not surv:
        print("mutmut results returned NO survivors — that is a poisoned/mid-run read, not a clean "
              "sweep. Do not divide by it.", file=sys.stderr)
        return 2

    # PROGRESS TO STDERR. One `mutmut show` per survivor is ~0.2 s, so 280 survivors is a minute of
    # silence — long enough to be indistinguishable from a hang, which is how a finished run went
    # unnoticed for six hours. stdout stays clean so --json and --work remain pipeable.
    rows = []
    n = len(surv)
    t0 = time.monotonic()
    for i, mid in enumerate(surv, 1):
        if i == 1 or i % 10 == 0 or i == n:
            el = time.monotonic() - t0
            eta = (el / i) * (n - i) if i else 0.0
            print(f"\r  triaging {i}/{n}  ({100*i//n}%)  eta {eta:4.0f}s ",
                  end="", file=sys.stderr, flush=True)
        m, p = mutmut_diff(work, py, mid)
        bucket, why = classify(m, p)
        fn = re.sub(r".*x_?(.+?)__mutmut_\d+.*", r"\1", mid)
        rows.append({"id": mid, "fn": fn, "bucket": bucket, "why": why, "minus": m.strip(), "plus": p.strip()})
    print("\r" + " " * 48 + "\r", end="", file=sys.stderr, flush=True)

    if a.work:
        for r in rows:
            if r["bucket"] == "REACHABLE":
                print(f"{r['fn']:<20} {r['id'].split('.')[-1]}\n   -{r['minus'][:78]}\n   +{r['plus'][:78]}")
        return 0

    counts: dict[str, int] = {}
    for r in rows:
        counts[r["bucket"]] = counts.get(r["bucket"], 0) + 1

    if a.json:
        print(json.dumps({"module": a.module, "survivors": len(surv), "timeouts": tmo,
                          "counts": counts, "rows": rows}, indent=2))
        return 0

    print(f"{a.module}: {len(surv)} survivors, {tmo} timeouts")
    for b in ("REACHABLE", "EQUIVALENT?", "PROSE", "UNOBSERVABLE"):
        if counts.get(b):
            print(f"  {b:<14} {counts[b]:>4}")
    if a.total:
        unobs, reach = counts.get("UNOBSERVABLE", 0), counts.get("REACHABLE", 0)
        c = ceiling(a.total, len(surv), tmo, unobs, reach)
        print(f"\n  now      {c['killed']:>4}/{a.total} = {c['now_pct']:.1f}%")
        print(f"  CEILING  {c['ceiling']:>4}/{a.total} = {c['ceiling_pct']:.1f}%"
              f"   ({unobs} unobservable — reachable only by asserting exact wording)")
        print(f"  if every REACHABLE dies: {c['if_all_reachable']}/{a.total} = "
              f"{c['if_all_reachable_pct']:.1f}%   ({reach} mutants of real work)")
    print("\n  --work for the work-list.  Confirm any EQUIVALENT? with a witness search before dismissing.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
