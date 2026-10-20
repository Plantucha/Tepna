#!/usr/bin/env python3
# tepna-capture — tools/covscope.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Is every `tools/*.py` either MEASURED by the coverage floor or PINNED with a reason? Seconds, no suite.

    python3 tools/covscope.py                                  # the report, decides nothing
    python3 tools/covscope.py --check                          # 0 clean · 1 findings · 2 refused
    python3 tools/covscope.py --check --verdict-out PATH        # ... and write the tepna.verdict/1
    python3 tools/covscope.py --json                           # the same report, machine-readable
    python3 tools/covscope.py --verdict-sample                  # a synthetic object, no tree needed

Plumbing only — the glob, the coverage-data read, the printing and the object write. Every decision
lives in `coverage_scope.py`, which is inside the coverage floor. Same split as
`find_blindspots.py` / `blind_spots.py`, and for the same reason: the logic that can be WRONG must be
the logic that is tested. `coverage_scope.py`'s docstring holds the defect and the measurement.

WHAT IT READS, AND WHY NOT THE PRINTED TABLE. The coverage DATA file (`.coverage`, written by the
`pytest --cov` gate), through `coverage.CoverageData.measured_files()`. Reading the printed table
would mean parsing a human report; reading the data asks the same question of the same artifact.
Measured 2026-10-20 at `origin/main` 63f6ac951: the data names the same nine `tools/*.py` the table
printed rows for, nine of nine.

THE EXIT-CODE CONTRACT (`checkverdict.py` reads the OBJECT, not this code — the two must agree):
    0  PASS        every declared tool is measured or pinned, and no pin is spent
    1  FAIL        at least one disagreement; the lines above name every one of them
    2  UNKNOWN     REFUSED — no readable coverage data, so nothing about the tree was examined
A refusal is never a pass. An unreadable report is an absent measurement (CLAUDE.md §∅), and this gate
would otherwise report "every tool is fine" about a run that never looked at one.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import sys
from pathlib import Path
from types import ModuleType

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

import coverage_scope as CS  # noqa: E402
import verdict as VD  # noqa: E402

# `ModuleType | None`, written out: without the annotation mypy infers the module type from the
# successful import and reds the None arm, which is the arm that matters (a box without the package
# must REFUSE, never crash on import).
_coverage: ModuleType | None
try:
    import coverage as _coverage_mod

    _coverage = _coverage_mod
except ImportError:
    _coverage = None

REFUSED = 2


def _now_utc() -> str:
    """The instant this run decided, to the second. Plumbing, like `mutate_diff.py`'s own."""
    return _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def declared_tools(root: Path) -> list[str]:
    """The scope on disk, relative to `capture-host/`. Non-recursive, like every other enumeration of
    this directory (`verdict-adoption.mjs`'s `tools/*.mjs`, `find_unwired`'s scans)."""
    return sorted(f"{CS.SCOPE_DIR}/{p.name}" for p in sorted((root / CS.SCOPE_DIR).glob("*.py")))


def measured_paths(data_file: Path, root: Path) -> tuple[list[str] | None, str | None]:
    """`(paths, refusal)` — the files the coverage data carries, relative to `root`. Exactly one of the
    two is None. Every refusal says what was unreadable; none of them is silent."""
    if _coverage is None:
        return None, "the interpreter has no `coverage` module, so no coverage data can be read at all"
    if not data_file.exists():
        return None, (
            f"no coverage data at {data_file} — run the pytest gate first "
            "(`pytest --cov`); this check reads that run's data and cannot produce it"
        )
    data = _coverage.CoverageData(basename=str(data_file))
    data.read()
    files = data.measured_files()
    if not files:
        return None, f"the coverage data at {data_file} carries no measured file — it examined nothing"
    return sorted(os.path.relpath(f, root) for f in files), None


def staleness(data_file: Path, root: Path, declared: list[str]) -> str | None:
    """The refusal for data written BEFORE the scope it would be read against, or None. A report that
    predates a tool file cannot have seen it, and reading it anyway would answer about a scope that no
    longer exists."""
    data_mtime = data_file.stat().st_mtime
    newest = max(((root / p).stat().st_mtime, p) for p in declared)
    if data_mtime < newest[0]:
        return (
            f"the coverage data at {data_file} predates {newest[1]} "
            f"({data_mtime:.0f} < {newest[0]:.0f}), so it was written against a different scope"
        )
    return None


def _print_report(report: dict, status: str, reason: str | None) -> None:
    print(f"  scope       : {CS.SCOPE_DIR}/*.py under {HERE}")
    print(f"  declared    : {len(report['declared'])}")
    print(f"  measured    : {len(report['measured'])}")
    print(f"  pinned      : {len(report['pinned'])} (unmeasured by design, each with a reason)")
    for key in CS.FINDING_KEYS:
        for path in report[key]:
            print(f"  \033[31m✗ {key:20s}\033[0m {path}")
    print(f"  status      : {status}")
    if reason:
        print(f"  reason      : {reason}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="exit non-zero on a finding or a refusal")
    ap.add_argument("--json", action="store_true", help="print the report as JSON")
    ap.add_argument("--verdict-out", metavar="PATH", help="write the tepna.verdict/1 object here")
    ap.add_argument("--verdict-sample", action="store_true", help="print a synthetic object and exit")
    ap.add_argument("--data", default=".coverage", metavar="PATH", help="the coverage data file (default .coverage)")
    args = ap.parse_args(argv)

    at = _now_utc()
    commit = VD.commit_sha(str(HERE))

    if args.verdict_sample:
        sample = CS.classify(
            ["tools/pinned_cli.py", "tools/measured.py", "tools/new_unpinned.py"],
            ["tools/measured.py"],
            {"tools/pinned_cli.py": "plumbing only; the decisions live one directory up"},
        )
        print(json.dumps(CS.verdict_object(sample, commit=commit, at=at), indent=2))
        return 0

    root = HERE
    data_file = Path(args.data)
    if not data_file.is_absolute():
        data_file = root / data_file
    declared = declared_tools(root)
    measured, refusal = measured_paths(data_file, root)
    if refusal is None and declared:
        refusal = staleness(data_file, root, declared)

    if refusal is not None:
        obj = CS.refusal_object(refusal, commit=commit, at=at)
        print(f"  \033[33m⚠ REFUSED\033[0m {refusal}")
    else:
        report = CS.classify(declared, measured)
        obj = CS.verdict_object(report, commit=commit, at=at)
        if args.json:
            print(json.dumps(report, indent=2))
        else:
            _print_report(report, obj["status"], obj["reason"])

    # VALIDATED BEFORE IT LANDS: `VD.write` refuses a malformed object, so a reader never sees one
    # this gate could not have meant. A crash here writes nothing, and `checkverdict.py` reads a
    # missing object as UNKNOWN rather than as a green child.
    if args.verdict_out:
        VD.write(args.verdict_out, obj)

    if not args.check:
        return 0
    if obj["status"] == "UNKNOWN":
        return REFUSED
    return 0 if obj["status"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
