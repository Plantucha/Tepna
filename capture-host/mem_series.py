# tepna-capture — mem_series.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The daemon's memory SERIES, read back from its own `mem: VmRSS …` journal lines.

Row `2026-10-13-daemon-mem-block-not-drawn`. `mem_log_line` writes one line per `mem.log_sec`, and
`status.json` keeps only the newest snapshot, so the journal is the one surface on the box that holds
the night's shape. This module turns those lines into points for the monitor to draw.

THE DECISION THE ROW ASKED FOR — which shape each key is:
  · every kB figure, and the arena `heaps` count, is a LEVEL: a restart starts a new process with its
    own level, and a curve of levels across a restart is honest if the restart is MARKED;
  · the gc `collections` totals are CUMULATIVE since process start, so a restart resets them to zero
    and a stitched curve reads as "the problem went away" (the trap row
    `2026-09-16-ble-counters-not-drawn` names). They are reported per process, never across one.
So the series is split into one SEGMENT PER DAEMON PID, and no point carries a value from another PID.

§∅: a figure the line printed as `null`, or a segment an older line does not carry (`VmSwap`, the
windowed VmHWM), is `None` — never 0. `read_mem_series` returns `None`, never an empty series, when the
journal cannot be read: an empty series says "the daemon logged nothing", which is a different fact.

Clock Contract §1: `tMs` is floating wall-clock ms from the journal stamp's components as written and
`offsetMin` carries the zone the stamp declared — both read by `journal_line.stamp_of`, which owns the
journal line's grammar for every series here."""

from __future__ import annotations

import datetime as _dt
import re
import subprocess

import journal_line

#: `(output key, the label mem_log_line prints)`. Order is the line's own order.
KB_FIELDS = (
    ("rss_kb", "VmRSS"),
    ("rss_anon_kb", "RssAnon"),
    ("swap_kb", "VmSwap"),
    ("main_arena_kb", "main arena"),
    ("hblkhd_kb", "hblkhd"),
    ("uordblks_kb", "uordblks"),
    ("fordblks_kb", "fordblks"),
    ("keepcost_kb", "keepcost"),
    ("system_kb", "system"),
    ("rest_kb", "rest"),
    ("mmap_kb", "mmap"),
    ("hwm_kb", "VmHWM since last line"),
)
#: The row's decision, published with the series so a reader never has to infer it.
SHAPES = {k: "level" for k, _ in KB_FIELDS} | {"heaps": "level", "gc_collections": "cumulative-per-pid"}

_FIELD = {label: re.compile(r"(?:^|[ ·])" + re.escape(label) + r" (null|\d+)(?: kB)?") for _, label in KB_FIELDS}
_HEAPS = re.compile(r"all arenas heaps (null|\d+)")
_COLLECTIONS = re.compile(r"collections ((?:null|\d+)(?:,(?:null|\d+))*)")
MEM_NEEDLE = "INFO mem: VmRSS "


def _num(s: str) -> int | None:
    return None if s == "null" else int(s)


def parse_mem_line(line: str) -> dict | None:
    """One journal line → `{pid, tMs, offsetMin, <fields>}`, or `None` when it is not a mem line."""
    if MEM_NEEDLE not in line:
        return None
    head = journal_line.stamp_of(line)
    if head is None:
        return None
    body = line[line.index(MEM_NEEDLE) + len("INFO mem: ") :]
    row: dict = dict(head)
    for key, label in KB_FIELDS:
        f = _FIELD[label].search(body)
        row[key] = _num(f.group(1)) if f else None
    h = _HEAPS.search(body)
    row["heaps"] = _num(h.group(1)) if h else None
    c = _COLLECTIONS.search(body)
    row["gc_collections"] = [_num(v) for v in c.group(1).split(",")] if c else None
    return row


def series(lines) -> dict:
    """Mem lines → one segment per PID, in the order the PIDs first appear, points in time order.

    A PID that appears, disappears and appears again (it cannot on Linux within a night, but a journal
    window can span a PID reuse) stays ONE segment only while it is contiguous; a reappearance after
    another PID opens a new segment, so no segment spans a restart."""
    segments: list[dict] = []
    for ln in lines:
        row = parse_mem_line(ln)
        if row is None:
            continue
        pid = row.pop("pid")
        if not segments or segments[-1]["pid"] != pid:
            segments.append({"pid": pid, "points": []})
        segments[-1]["points"].append(row)
    for seg in segments:
        seg["points"].sort(key=lambda p: p["tMs"])
    return {"schema": "tepna.mem-series/1", "shapes": SHAPES, "segments": segments}


def read_mem_series(hours: float, now: _dt.datetime | None = None, run=None) -> dict | None:
    """The last `hours` of the capture unit's mem lines, or `None` when journalctl cannot be read."""
    # Resolved at call time, not bound as a default: a default binds at import, so a test cannot swap
    # it without patching `__defaults__`, and mutmut's trampoline never reads the patched tuple.
    if run is None:
        run = subprocess.run
    until = now or _dt.datetime.now()
    since = until - _dt.timedelta(hours=hours)
    try:
        r = run(
            [
                "journalctl",
                "-u",
                "tepna-capture",
                "--no-pager",
                "-o",
                "short-iso",
                "--grep",
                "mem: VmRSS",
                "--since",
                since.strftime("%Y-%m-%d %H:%M:%S"),
                "--until",
                until.strftime("%Y-%m-%d %H:%M:%S"),
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    # journalctl exits 1 AND prints `-- No entries --` when `--grep` matches nothing (measured on vigil
    # 2026-10-20): an empty window, not an unreadable one. Any other non-zero exit is unreadable.
    if r.returncode == 1 and "-- No entries --" in r.stdout:
        lines: list[str] = []
    elif r.returncode != 0:
        return None
    else:
        lines = r.stdout.split("\n")
    out = series(lines)
    out["window"] = {
        "hours": hours,
        "since": since.isoformat(timespec="seconds"),
        "until": until.isoformat(timespec="seconds"),
    }
    return out
