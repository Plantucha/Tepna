#!/usr/bin/env python3
# tepna-capture — tools/backfill_arrival.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# READ-ONLY BACKFILL of the arrival diagnostics over nights already captured.
#
# `QC-SUMMARY.json` is a SNAPSHOT written when the night was captured, so a night recorded before a
# diagnostic existed does not gain it. The inputs are still there, though: `arrival_quality` derives
# everything from the `*_PMDARRIVAL.csv` sidecars and writes nothing, so an old night can be re-analysed
# in place without touching a byte of it.
#
# THIS TOOL NEVER WRITES INTO A CAPTURE DIRECTORY. It prints to stdout, or to a path you name with
# `--json` — and it refuses that path if it lands inside a night being read, because the one way this
# could do harm is by overwriting the summary it is meant to supplement.
#
#     python3 tools/backfill_arrival.py /srv/tepna/captures/2026-08-1*
#     python3 tools/backfill_arrival.py --json /tmp/backfill.json /srv/tepna/captures/2026-08-12
#
# A night with no sidecar reports `sidecars: 0` rather than being skipped silently — "nothing to
# measure" and "measured nothing" are different answers, and only one of them is a data limitation.

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import nightqc  # noqa: E402


def backfill(night_dir: str) -> dict:
    """Every derived arrival field for one night. Reads the sidecars; writes nothing."""
    sidecars = sorted(
        f for f in os.listdir(night_dir) if f.endswith("_PMDARRIVAL.csv")
    ) if os.path.isdir(night_dir) else []
    rows = nightqc.arrival_quality(night_dir) if sidecars else []
    return {
        "night": os.path.basename(os.path.realpath(night_dir)),
        "sidecars": len(sidecars),
        "streams": [
            {
                "file": r.get("file"),
                "device": r.get("device"),
                "meas": r.get("meas"),
                "rows": r.get("rows"),
                "quantised": r.get("quantised"),
                "device_stamp_constant": r.get("device_stamp_constant"),
                "jitter": r.get("jitter"),
                "lattice": r.get("lattice"),
                "u_time": r.get("u_time"),
                "offset": r.get("offset"),
            }
            for r in rows
        ],
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("nights", nargs="+", help="capture night directories to re-analyse")
    ap.add_argument("--json", dest="out", help="write the report here (never inside a night)")
    a = ap.parse_args(argv)

    if a.out:
        dest = os.path.abspath(a.out)
        for n in a.nights:
            root = os.path.realpath(n)
            if os.path.commonpath([dest, root]) == root:
                # The whole point of this tool is that the capture stays untouched.
                print(f"refusing to write inside a night being read: {dest}", file=sys.stderr)
                return 2

    report = [backfill(n) for n in a.nights]
    if a.out:
        with open(dest, "w", encoding="utf-8") as fh:
            json.dump(report, fh, indent=1, sort_keys=True)
        print(f"wrote {dest}")
    else:
        json.dump(report, sys.stdout, indent=1, sort_keys=True)
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
