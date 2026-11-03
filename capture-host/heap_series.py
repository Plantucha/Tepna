# tepna-capture — heap_series.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The heap probe's rows, read back as a SERIES on the same axis as the memory journal.

Row `2026-09-25-heap-growth-is-json-retention-not-a-buffer-leak`. The stall was blamed on `RssAnon`
climbing 128 → 245 MB at ~21 MB/h, and the probe answers with `traced_bytes`, which is tracemalloc's
own accounting of what it instrumented. Those are TWO POPULATIONS. The writer already puts both in one
row — `heap_report_row` carries `rss_kb` beside `traced_bytes` — and until this module nothing read
`heap-probe.json` at all, so the two reached no common axis and neither figure was evidence about the
other.

THE AXIS IS `tMs`, floating wall-clock ms, the same unit `mem_series` publishes, so a reader can draw
the probe's sparse points against the journal's dense ones without converting anything. The probe
stamps each row with a naive local ISO, so `offsetMin` is `None` by Clock Contract §2 rule 3, and
`journal_line` owns the encoding for both series.

§∅ — THE ABSENCES THIS MODULE REFUSES TO ROUND OFF:
  · an absent or unreadable probe file gives `points: None` and a named `reason`, never `[]`: an empty
    list says the probe ran and recorded nothing, which is the opposite finding;
  · the probe is opt-in on the box and last ran 2026-09-25, so `file.ageHours` travels with every read
    and a stale file can never be drawn as tonight;
  · a rate needs two rows that BOTH streamed. An interval with `covered_capture` false produces an
    empty diff for the same reason a leak-free interval does, so such a pair is `NOT_APPLICABLE` with
    its figures `None` — never a flat 21 MB/h presented as a measurement;
  · a figure the row carried as `null` stays `None` through the rate, and the pair names it in
    `absent`, because a growth of `None` and a growth of 0 are different answers."""

from __future__ import annotations

import datetime as _dt
import json
import os

import journal_line

#: The probe's own filename. `capture.HEAP_PROBE_NAME` is the writer's copy and a test pins the two
#: together, because a reader looking at the wrong name reports an absent file rather than a defect.
PROBE_NAME = "heap-probe.json"

#: The `/proc/self/status` keys the writer samples, in its order. Pinned to `capture._RSS_KEYS` by the
#: same test, for the same reason.
RSS_KEYS = ("VmRSS", "RssAnon", "RssFile", "VmSwap")

#: The shape of each published figure, said with the series so a reader never infers it (`mem_series`
#: publishes the same decision). `traced_peak_bytes` is a running maximum since tracemalloc started, so
#: it is neither a level that can fall nor a per-process total.
SHAPES = {
    "traced_bytes": "level",
    "traced_peak_bytes": "high-water-per-run",
    "gc_tracked_objects": "level",
    "rss_kb": "level",
}

SCHEMA = "tepna.heap-series/1"
_HOUR_MS = 3600000.0


def probe_path(root: str) -> str:
    """Where the probe writes under a capture root — the one place this path is spelled for a reader."""
    return os.path.join(root, "captures", PROBE_NAME)


def _int(v) -> int | None:
    """A figure the row carried as an integer, else `None`. `True` is not a byte count."""
    return v if isinstance(v, int) and not isinstance(v, bool) else None


def probe_point(row) -> dict | None:
    """PURE: one probe row → one point on `tMs`, or `None` when the row carries no readable stamp.

    A row whose stamp this cannot read is dropped and COUNTED by `series`, never placed at the time of
    the read: a point at the wrong instant is worse than a point that is missing, because it reads as
    evidence about an interval nobody measured."""
    if not isinstance(row, dict):
        return None
    head = journal_line.stamp_iso(str(row.get("at", "")))
    if head is None:
        return None
    rss = row.get("rss_kb")
    covered = row.get("covered_capture")
    return {
        "tMs": head["tMs"],
        "offsetMin": head["offsetMin"],
        "traced_bytes": _int(row.get("traced_bytes")),
        "traced_peak_bytes": _int(row.get("traced_peak_bytes")),
        "gc_tracked_objects": _int(row.get("gc_tracked_objects")),
        "rss_kb": {k: _int(rss.get(k)) for k in RSS_KEYS} if isinstance(rss, dict) else None,
        # The row's own licence to be read as a measurement. Absent rather than false when the row
        # never said: an older row that predates the field did not declare an uncovered interval.
        "covered_capture": covered if isinstance(covered, bool) else None,
        "status": row.get("status") if isinstance(row.get("status"), str) else None,
        "reason": row.get("reason") if isinstance(row.get("reason"), str) else None,
    }


def _per_hour(a: int | None, b: int | None, span_ms: int) -> float | None:
    """The rate between two figures, or `None` when either end was never measured (§∅)."""
    if a is None or b is None:
        return None
    return round((b - a) * _HOUR_MS / span_ms, 3)


def _rss_anon(p: dict) -> int | None:
    return p["rss_kb"]["RssAnon"] if p["rss_kb"] else None


def rates(points: list[dict]) -> list[dict]:
    """Adjacent pairs → the two growth rates over ONE interval, which is what the row asked for.

    Both figures are read over the SAME span, so `traced_bytes_per_hour` and `rss_anon_kb_per_hour` are
    finally comparable: tracemalloc's 9.2 MiB/h and the journal's 21 MB/h were never measured over one
    interval, so neither was evidence about the other."""
    out: list[dict] = []
    for a, b in zip(points, points[1:]):
        span = b["tMs"] - a["tMs"]
        pair: dict = {"fromTMs": a["tMs"], "toTMs": b["tMs"], "spanMs": span}
        if span <= 0:
            pair |= {"traced_bytes_per_hour": None, "rss_anon_kb_per_hour": None, "status": "NOT_APPLICABLE"}
            pair["reason"] = (
                "two rows at the same stamp or out of order — a rate over a zero or negative span is not a rate"
            )
        elif a["covered_capture"] is not True or b["covered_capture"] is not True:
            pair |= {"traced_bytes_per_hour": None, "rss_anon_kb_per_hour": None, "status": "NOT_APPLICABLE"}
            pair["reason"] = (
                "an interval that did not stream, or did not say — an empty diff here is the absence of "
                "capture, not the absence of growth"
            )
        else:
            pair |= {
                "traced_bytes_per_hour": _per_hour(a["traced_bytes"], b["traced_bytes"], span),
                "rss_anon_kb_per_hour": _per_hour(_rss_anon(a), _rss_anon(b), span),
                "status": "OK",
                "reason": None,
            }
        pair["absent"] = [k for k in ("traced_bytes_per_hour", "rss_anon_kb_per_hour") if pair[k] is None]
        out.append(pair)
    return out


def series(doc) -> dict:
    """The probe document → points in time order, plus the rates over its own intervals."""
    rows = doc.get("rows") if isinstance(doc, dict) else None
    if not isinstance(rows, list):
        return {
            "schema": SCHEMA,
            "shapes": SHAPES,
            "points": None,
            "rates": None,
            "rowsUnreadable": None,
            "reason": "the probe file carries no `rows` list, so nothing was read — which is not an empty series",
        }
    points = [p for p in (probe_point(r) for r in rows) if p is not None]
    points.sort(key=lambda p: p["tMs"])
    return {
        "schema": SCHEMA,
        "shapes": SHAPES,
        "points": points,
        "rates": rates(points),
        "rowsUnreadable": len(rows) - len(points),
        "reason": None,
    }


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def _no_series(file: dict) -> dict:
    """A read that produced no series — the file block says which absence it was (§∅)."""
    return {
        "schema": SCHEMA,
        "shapes": SHAPES,
        "points": None,
        "rates": None,
        "rowsUnreadable": None,
        "reason": file["reason"],
        "file": file | {"lastRunTMs": None, "ageHours": None},
    }


def read_heap_series(path: str, now: _dt.datetime | None = None, read=None) -> dict:
    """The probe file as a series, with the file's own state and age beside it.

    Never `None` and never raises: a reader has to be able to tell an absent probe from a probe that
    ran and found nothing, and both from a file that could not be parsed. `file.state` is `read`,
    `absent` or `unreadable`, and only `read` carries points."""
    # Resolved at call time rather than bound as a default, for `mem_series`' reason: a default binds at
    # import, so a test cannot swap it without patching `__defaults__`, which mutmut's trampoline never
    # reads.
    if read is None:
        read = _read
    file: dict = {"state": "read", "path": path, "reason": None}
    try:
        text = read(path)
    except FileNotFoundError:
        return _no_series(
            file
            | {
                "state": "absent",
                "reason": "no probe file at this path — the probe is opt-in on the box and may never have run",
            }
        )
    except OSError as e:
        return _no_series(
            file | {"state": "unreadable", "reason": f"the probe file could not be read ({type(e).__name__})"}
        )
    try:
        doc = json.loads(text)
    except ValueError as e:
        return _no_series(file | {"state": "unreadable", "reason": f"the probe file is not JSON ({type(e).__name__})"})
    out = series(doc)
    last = out["points"][-1]["tMs"] if out["points"] else None
    # The age is half the reason this read exists: the probe last ran 2026-09-25, and a series drawn
    # with no age beside it reads as tonight's heap.
    ref_ms = journal_line.floating_ms(now or _dt.datetime.now())
    age = None if last is None else round((ref_ms - last) / _HOUR_MS, 2)
    return {**out, "file": file | {"lastRunTMs": last, "ageHours": age}}
