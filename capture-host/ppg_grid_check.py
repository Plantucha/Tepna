# tepna-capture — ppg_grid_check.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# WHICH O2RING PPG FILES CARRY A FABRICATED TIMELINE?
#
# Nights captured between 2026-07-22 and 2026-07-25 were written by the frame-to-frame gap logic that
# rectified BLE arrival jitter into monotonic fabricated elapsed time (VIGIL-PPG-GRID-AUDIT §1). The fix
# is forward-only, so those files still claim more elapsed time than really passed — up to +1.8 % on the
# worst measured file, +210 s across 11.18 h of corpus.
#
# WHY THIS MARKS RATHER THAN REPAIRS. Re-deriving the correct grid needs the per-frame arrival times, and
# they are NOT recoverable from the file:
#   1. Frame boundaries are invisible. Each sample is stamped `arr - (nps-1-i)/fs`, so INSIDE a frame the
#      phone step is exactly 1/fs — and ACROSS a jitter-free boundary it is ALSO exactly 1/fs. A boundary
#      only becomes visible once jitter has moved it, i.e. precisely the information we would need in
#      order to undo that jitter.
#   2. The phone column is millisecond-quantized (`_phone_ts` truncates to ms) while the true step is
#      7.953 ms, so it lands on 8000/7000 us and the sub-ms structure is already gone.
# Any "repair" would therefore be an approximation — fabricating a grid to replace a fabricated grid,
# which is the exact failure class this work exists to remove. Marking is the honest option.
#
# The MEASUREMENT is still exact: it needs only the FIRST and LAST rows (device-clock span vs host-clock
# span), where millisecond quantization is negligible against a span of hundreds of seconds. `rows/wall`
# is reported alongside because it is what separates the two explanations — a grid that ran ahead while
# samples kept arriving at nominal rate is fabricated time, not lost data.
#
# Usage:  python3 ppg_grid_check.py <captures-root> [--threshold-pct 0.2] [--quiet]
# Exit 0 = every file within tolerance; exit 1 = at least one file's timeline is materially inflated.

from __future__ import annotations
import argparse
import datetime as _dt
import os
import re
import sys

# Above this the file's timeline is materially wrong and its beat intervals should not be trusted for
# HRV. The fixed algorithm lands at ~0.05 % on the same corpus, so 0.2 % sits clear of it while still
# catching every night the old code touched (worst measured: 1.79 %).
DEFAULT_THRESHOLD_PCT = 0.2

# Nominal O2Ring PPG rate (capture.py O2PPG_FS_DEFAULT). Only used as the yardstick for "did the samples
# actually arrive?" — see _verdict.
NOMINAL_FS = 125.738

# Below this span the endpoint-only measurement is too noisy to judge: the phone column is quantized to
# 1 ms, and a session of a few seconds is dominated by its own start/stop edges. Report, never flag.
MIN_SPAN_S = 60.0

# At or above this fraction of nominal, the link delivered essentially every sample, so elapsed time the
# grid claims on TOP of that was invented rather than lost. Below it, samples really were missing and the
# advance is at least partly a legitimate record of loss — which this tool must not mislabel.
NEAR_NOMINAL_FRAC = 0.98

_O2_PPG_RE = re.compile(r"^Wellue_O2Ring-[\w-]+_\w+_\d{14}_PPG\.txt$")


def _verdict(m: dict, threshold_pct: float, nominal_fs: float = NOMINAL_FS) -> str:
    """'inflated' | 'lossy' | 'ok' | 'unjudgeable'.

    The whole finding rests on separating two explanations for a grid that ran ahead of the host clock:
    time the link LOST (legitimate — that is what the gap insertion is for) versus time the code
    INVENTED. `rows/wall` settles it. A file whose samples arrived at nominal rate cannot have lost the
    seconds its grid claims."""
    if m["wall_s"] < MIN_SPAN_S:
        return "unjudgeable"
    if m["inflation"] * 100.0 <= threshold_pct:
        return "ok"
    if m["rows_per_wall"] >= NEAR_NOMINAL_FRAC * nominal_fs:
        return "inflated"
    return "lossy"


def _first_and_last_row(path: str) -> tuple[str, str, int] | None:
    """(first_data_line, last_data_line, row_count) — streamed, never loading the file whole (these run
    30-80 MB). Returns None if the file has fewer than two data rows, which is not judgeable."""
    first = last = None
    n = 0
    try:
        with open(path, "r", errors="replace") as fh:
            fh.readline()                       # header
            for line in fh:
                line = line.rstrip("\n")
                if not line:
                    continue
                if first is None:
                    first = line
                last = line
                n += 1
    except OSError:
        return None
    if n < 2 or first is None or last is None:
        return None
    return first, last, n


def grid_inflation(path: str) -> dict | None:
    """Measure one O2Ring PPG file's claimed elapsed time against the host clock.

    Returns {rows, wall_s, grid_s, inflation, fabricated_s, rows_per_wall} or None when the file is
    unreadable / too short / malformed. Never raises, and never guesses: a file it cannot judge reports
    None rather than a reassuring zero."""
    got = _first_and_last_row(path)
    if got is None:
        return None
    first, last, rows = got
    try:
        fp, lp = first.split(";"), last.split(";")
        if len(fp) < 3 or len(lp) < 3:
            return None
        t0 = _dt.datetime.fromisoformat(fp[0])
        t1 = _dt.datetime.fromisoformat(lp[0])
        ns0, ns1 = int(fp[1]), int(lp[1])
    except (ValueError, IndexError):
        return None
    wall = (t1 - t0).total_seconds()
    grid = (ns1 - ns0) / 1e9
    if wall <= 0:
        return None
    return {
        "rows": rows,
        "wall_s": wall,
        "grid_s": grid,
        "inflation": grid / wall - 1.0,
        "fabricated_s": grid - wall,
        # Samples delivered per second of REAL time. At nominal this says the link lost nothing, so any
        # inflation above is fabricated rather than a record of loss.
        "rows_per_wall": rows / wall,
    }


def scan(root: str) -> list[tuple[str, dict]]:
    """[(relative_path, measurement)] for every O2Ring PPG file under `root`, sorted by path. Walks the
    night folders; a file that cannot be judged is skipped rather than reported as clean."""
    out = []
    for dirpath, _dirnames, filenames in os.walk(root):
        for fn in sorted(filenames):
            if not _O2_PPG_RE.match(fn):
                continue
            full = os.path.join(dirpath, fn)
            m = grid_inflation(full)
            if m is not None:
                out.append((os.path.relpath(full, root), m))
    out.sort(key=lambda r: r[0])
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Flag O2Ring PPG files whose timeline claims more elapsed "
                                             "time than really passed (VIGIL-PPG-GRID-AUDIT §1).")
    ap.add_argument("root", help="captures root (the folder holding the YYYY-MM-DD night dirs)")
    ap.add_argument("--threshold-pct", type=float, default=DEFAULT_THRESHOLD_PCT,
                    help=f"flag above this inflation percentage (default {DEFAULT_THRESHOLD_PCT})")
    ap.add_argument("--quiet", action="store_true", help="print only the flagged files")
    a = ap.parse_args(argv)

    results = scan(a.root)
    if not results:
        print(f"no O2Ring PPG files found under {a.root}")
        return 0

    tallied = [(p, m, _verdict(m, a.threshold_pct)) for p, m in results]
    flagged = [(p, m) for p, m, v in tallied if v == "inflated"]
    print(f"{'file':50s} {'rows':>9s} {'wall_s':>9s} {'inflation':>10s} {'rows/wall':>10s}  verdict")
    print("-" * 104)
    for p, m, v in tallied:
        if a.quiet and v != "inflated":
            continue
        print(f"{p[-50:]:50s} {m['rows']:9d} {m['wall_s']:9.1f} "
              f"{m['inflation']:+9.3%} {m['rows_per_wall']:10.3f}  "
              + {"inflated": "<-- TIMELINE INFLATED", "lossy": "lossy link (advance is real)",
                 "ok": "ok", "unjudgeable": f"span <{MIN_SPAN_S:.0f}s — not judgeable"}[v])
    print("-" * 104)
    counts = {k: sum(1 for _p, _m, v in tallied if v == k)
              for k in ("inflated", "lossy", "ok", "unjudgeable")}
    total_fab = sum(m["fabricated_s"] for _p, m in flagged)
    print(f"{len(results)} file(s) measured — {counts['inflated']} INFLATED, {counts['lossy']} lossy, "
          f"{counts['ok']} ok, {counts['unjudgeable']} too short to judge")
    print(f"fabricated elapsed time in the inflated set: {total_fab:+.1f} s")
    if flagged:
        print("\nThese files' BEAT TIMELINES are stretched at each phantom gap. Their sample RATE is "
              "unaffected\n(PpgDex derives fs from the MEDIAN ns delta), so amplitude/morphology work is "
              "fine — but do not\ntrust them for HRV. They cannot be repaired: see this module's header "
              "for why the per-frame\narrival times are unrecoverable from the file.")
    return 1 if flagged else 0


if __name__ == "__main__":          # pragma: no cover — CLI entry
    sys.exit(main())
