# tepna-capture — battery_history.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# THE BATTERY TREND THE MONITOR DRAWS. Every LINK row already carries `battery_pct`; the monitor showed
# only the latest one. On 2026-10-13 → 10-23 the H10 coin cell fell 90 → 50 → 10 % over a week and
# then died, and a chip that shows one number at a time hid the fall. This reads the last few nights'
# LINK files and returns one point per device per hour: the LOWEST reading in that hour, because a coin
# cell's level sags under load and recovers at rest, and the sag is the warning.
#
# Times are the rows' own floating wall-clock stamps (Clock Contract §1): `tMs` is the stamp's
# components encoded as if UTC. An empty battery cell is no reading, never 0 % (∅ ABSENCE IS NULL).
from __future__ import annotations

import calendar
import os
import re

DAYS = 7
_NIGHT = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_STAMP = re.compile(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})")
_DAY_MS = 86_400_000


def _hour_ms(stamp: str) -> int | None:
    """The floating `tMs` of the hour a LINK stamp falls in, or None for a stamp that does not parse."""
    m = _STAMP.match(stamp)
    if not m:
        return None
    y, mo, d, h, mi = (int(g) for g in m.groups())
    if not (1 <= mo <= 12 and 1 <= d <= 31 and h <= 23 and mi <= 59):
        return None
    return calendar.timegm((y, mo, d, h, 0, 0)) * 1000


def _pct(cell: str) -> int | None:
    try:
        v = int(cell)
    except ValueError:
        return None
    return v if 0 <= v <= 100 else None


def read_link(path: str, lows: dict[str, dict[int, int]]) -> None:
    """Fold one LINK file into `lows[device][hour_tMs] = lowest pct`. Columns are found by NAME from the
    header row, so a column added later cannot shift the reading onto a different field."""
    cols: dict[str, int] | None = None
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            if line.startswith("#"):
                continue
            f = line.rstrip("\n").split(";")
            if cols is None:
                cols = {k: i for i, k in enumerate(f)}
                if not {"Phone timestamp", "device", "battery_pct"} <= cols.keys():
                    return  # not a LINK layout this reader knows: read nothing rather than guess
                continue
            if len(f) < len(cols):
                continue  # a torn last row
            hour = _hour_ms(f[cols["Phone timestamp"]])
            pct = _pct(f[cols["battery_pct"]])
            dev = f[cols["device"]]
            if hour is None or pct is None or not dev:
                continue
            per = lows.setdefault(dev, {})
            if hour not in per or pct < per[hour]:
                per[hour] = pct


def build(captures: str, days: int = DAYS) -> dict:
    """`{"days", "devices": {name: {"points": [[tMs, pct], ...], "last": pct, "d24": change | None}}}`.

    `points` covers the `days` before the newest reading of ANY device, oldest first. `d24` is the last
    point minus the last point at least 24 h before it (None when the history is shorter than that)."""
    try:
        nights = sorted(n for n in os.listdir(captures) if _NIGHT.match(n))[-(days + 1) :]
    except OSError:
        nights = []
    lows: dict[str, dict[int, int]] = {}
    for n in nights:
        d = os.path.join(captures, n)
        for fn in sorted(os.listdir(d)):
            if fn.startswith("Tepna_") and fn.endswith("_LINK.csv"):
                read_link(os.path.join(d, fn), lows)
    newest = max((h for per in lows.values() for h in per), default=None)
    out: dict = {"days": days, "devices": {}}
    if newest is None:
        return out
    floor = newest - days * _DAY_MS
    for dev, per in sorted(lows.items()):
        pts = sorted((h, p) for h, p in per.items() if h >= floor)
        if not pts:
            continue
        last_t, last_p = pts[-1]
        before = [p for h, p in pts if h <= last_t - _DAY_MS]
        out["devices"][dev] = {
            "points": [[h, p] for h, p in pts],
            "last": last_p,
            "d24": (last_p - before[-1]) if before else None,
        }
    return out
