# tepna-capture — journal_line.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The grammar of one `journalctl -o short-iso` line: its stamp, its zone and the PID that wrote it.

Row `2026-10-20-ble-backoff-rate-is-drawn-as-a-level-not-a-curve`. `mem_series` was the first module to
read the daemon's own journal back as a series, and `ble_series` is the second. Two copies of the stamp
regex are two places the line grammar drifts apart in silence, so the grammar has one owner from here.

Clock Contract §1 and §2: `_floating` reads the stamp's components AS WRITTEN and encodes them as if
UTC, so the series is viewer-timezone-independent; `offsetMin` carries the zone the stamp declared, and
is `None` for a stamp that declared none. Never `datetime.fromisoformat` on the zone — the components
are the truth and the zone is metadata beside them."""

from __future__ import annotations

import datetime as _dt
import re

#: The `-o short-iso` prefix: `<stamp><zone?> <host> <unit>[<pid>]: `.
STAMP = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)([+-]\d{2}:?\d{2}|Z)? \S+ \S+?\[(\d+)\]: ")


def _floating(stamp: str, zone: str | None) -> tuple[int, int | None]:
    """`(tMs, offsetMin)`: the stamp's components verbatim as if UTC, and the zone it declared."""
    naive = _dt.datetime.fromisoformat(stamp.replace(",", "."))
    t_ms = int((naive - _dt.datetime(1970, 1, 1)).total_seconds() * 1000)
    if zone is None:
        return t_ms, None
    if zone == "Z":
        return t_ms, 0
    sign = -1 if zone[0] == "-" else 1
    hh, mm = zone[1:3], zone[-2:]
    return t_ms, sign * (int(hh) * 60 + int(mm))


def stamp_of(line: str) -> dict | None:
    """One journal line → `{pid, tMs, offsetMin}`, or `None` when the line carries no journal prefix.

    The PID is the identity every series here segments on: a restart is a new process, and a value
    carried across one is a fall or a reset that never happened."""
    m = STAMP.match(line)
    if m is None:
        return None
    t_ms, off = _floating(m.group(1), m.group(2))
    return {"pid": int(m.group(3)), "tMs": t_ms, "offsetMin": off}
