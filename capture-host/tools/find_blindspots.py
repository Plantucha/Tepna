#!/usr/bin/env python3
# tepna-capture — tools/find_blindspots.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Scan tests/ for doubles that discard arguments. Seconds, no suite run. See blind_spots.py for why.

    python3 tools/find_blindspots.py              # ranked report
    python3 tools/find_blindspots.py --json       # machine-readable
    python3 tools/find_blindspots.py --file tests/test_capture_runners.py

Plumbing only — every decision lives in `blind_spots.py`, which is inside the coverage floor. Same
split as mutate_triage.py / mutation_triage.py, and for the same reason: the logic that can be WRONG
must be the logic that is tested.

✅ AUDITED 2026-08-28 — VERDICT: KEEP AS IS. Nothing here belongs inside the floor, and this stamp
exists so the question is not re-opened. The 2026-08-27 sweep of the four unimported `tools/*.py`
moved decision logic out of `mutate_diff`, `mutate` and `mutate_pure`; this file was the one that
needed nothing, and the claim above was CHECKED rather than taken on trust:

  · `blind_spots.py` measures 62 statements / 24 branches / 100 %, and `tests/test_blind_spots.py`
    imports it — so "inside the coverage floor" is true, not merely asserted.
  · this file imports neither `ast` nor `re`; its only functions are `_test_files` (a directory glob)
    and `main` (argparse). Nothing here can return a WRONG ANSWER — it either lists files or fails
    loudly.

⚠️ Re-open this only if a function is ADDED here that can give a wrong answer rather than failing. The
criterion is "can it silently mislead", not "is it short" — see `mutation_diff.py`'s header for the
case where getting that backwards shipped a defect.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)

from blind_spots import analyze, rank, summarize  # noqa: E402


def _test_files(root: str, only: str | None) -> list[str]:
    if only:
        return [only]
    d = os.path.join(root, "tests")
    return sorted(os.path.join("tests", f) for f in os.listdir(d)
                  if f.endswith(".py"))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--file", default=None, help="scan one file instead of all of tests/")
    ap.add_argument("--json", action="store_true", help="machine-readable")
    ap.add_argument("--top", type=int, default=25, help="rows to print (default 25)")
    a = ap.parse_args(argv)

    findings: list[dict] = []
    unparsed: list[str] = []
    for rel in _test_files(HERE, a.file):
        p = os.path.join(HERE, rel)
        try:
            with open(p, encoding="utf-8") as fh:
                findings += analyze(fh.read(), rel)
        except SyntaxError as e:            # a file we cannot parse is one we cannot vouch for
            unparsed.append(f"{rel}: {e}")

    s = summarize(findings)
    if a.json:
        print(json.dumps({"summary": s, "unparsed": unparsed, "findings": rank(findings)}, indent=2))
        return 0

    print(f"\n  {s['params']} argument(s) made unobservable by {s['doubles']} double(s) "
          f"across {s['files']} file(s); {s['swallowing']} swallow **kwargs\n")
    for f in rank(findings)[:a.top]:
        what = ", ".join(f["discarded"]) or "-"
        sw = f"  +**{f['swallowed']}" if f["swallowed"] else ""
        print(f"  {f['file']}:{f['line']:<5} {f['double']:<34} drops: {what}{sw}")
    extra = len(findings) - a.top
    if extra > 0:
        print(f"  … and {extra} more (--top {len(findings)} for all)")
    # NEVER let an unparsed file read as a clean one — that is this tool's own version of the bug.
    for u in unparsed:
        print(f"  !! UNPARSED (not scanned): {u}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
