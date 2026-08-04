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

STR_RE = re.compile(r"""(['"]).*?\1""", re.S)


def _strip_strings(s: str) -> str:
    return STR_RE.sub("STR", s)


def classify(minus: str, plus: str) -> tuple[str, str]:
    """-> (bucket, why). Order matters: the most specific unobservable forms are tested first."""
    a, b = minus.strip(), plus.strip()
    if a == b:
        return "EQUIVALENT?", "identical after normalisation"

    # `flush=` is the single largest unobservable family. capsys/capfd read the buffer regardless, so
    # True/False/None are indistinguishable to any assertion on captured output.
    if re.sub(r"flush\s*=\s*\w+", "F", a) == re.sub(r"flush\s*=\s*\w+", "F", b):
        return "UNOBSERVABLE", "differs only in flush= — captured output is identical"

    # mutmut wraps string literals as "XXtextXX" and flips their case. Both are killable ONLY by
    # asserting the exact text, which is what turns a suite into a change-detector.
    if re.search(r'"XX|XX"|\'XX|XX\'', b):
        return "UNOBSERVABLE", "XX-wrapped literal — needs exact-text assertion"
    if a.lower() == b.lower():
        return "UNOBSERVABLE", "case flip only — needs exact-text assertion"

    same_code = _strip_strings(a) == _strip_strings(b)
    is_msg = re.match(r"(print|log|logger|_log|sys\.stderr\.write)\b", a) is not None

    if same_code and is_msg:
        return "PROSE", "log/print wording only, interpolated values intact"
    if same_code:
        return "PROSE", "string literal only, surrounding code unchanged"

    # A dropped/None-d ARGUMENT to a message call is reachable: assert the message NAMES its value.
    if is_msg and re.search(r"\(\s*None|=\s*None|,\s*\)", b):
        return "REACHABLE", "message call lost an argument — assert the message names its value"
    if is_msg:
        return "REACHABLE", "message call changed structurally"
    return "REACHABLE", "code change"


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


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("module")
    ap.add_argument("--total", type=int, help="total mutants (from the audit stats); enables the ceiling")
    ap.add_argument("--work", action="store_true", help="print only the REACHABLE work-list, with diffs")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--python", default=".venv/bin/python")
    a = ap.parse_args()

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

    rows = []
    for mid in surv:
        m, p = mutmut_diff(work, py, mid)
        bucket, why = classify(m, p)
        fn = re.sub(r".*x_?(.+?)__mutmut_\d+.*", r"\1", mid)
        rows.append({"id": mid, "fn": fn, "bucket": bucket, "why": why, "minus": m.strip(), "plus": p.strip()})

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
        killed = a.total - len(surv) - tmo
        unobs = counts.get("UNOBSERVABLE", 0)
        print(f"\n  now      {killed:>4}/{a.total} = {100*killed/a.total:.1f}%")
        print(f"  CEILING  {a.total-unobs:>4}/{a.total} = {100*(a.total-unobs)/a.total:.1f}%"
              f"   ({unobs} unobservable — reachable only by asserting exact wording)")
        reach = counts.get("REACHABLE", 0)
        print(f"  if every REACHABLE dies: {killed+reach}/{a.total} = "
              f"{100*(killed+reach)/a.total:.1f}%   ({reach} mutants of real work)")
    print("\n  --work for the work-list.  Confirm any EQUIVALENT? with a witness search before dismissing.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
