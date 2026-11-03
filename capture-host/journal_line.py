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


#: A BARE ISO stamp with no journal prefix: what `heap_report_row` writes into each heap-probe row
#: (`_now().isoformat(timespec="seconds")`, naive local civil time, so it declares no zone).
ISO = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)([+-]\d{2}:?\d{2}|Z)?$")


def floating_ms(when: _dt.datetime) -> int:
    """A civil datetime → floating wall-clock ms: its components as written, encoded as if UTC (§1).

    Public because `heap_series` needs the SAME encoding for the clock it compares a probe row against,
    and an age computed with a second encoder is an age across two axes."""
    return int((when.replace(tzinfo=None) - _dt.datetime(1970, 1, 1)).total_seconds() * 1000)


def _floating(stamp: str, zone: str | None) -> tuple[int, int | None]:
    """`(tMs, offsetMin)`: the stamp's components verbatim as if UTC, and the zone it declared."""
    t_ms = floating_ms(_dt.datetime.fromisoformat(stamp.replace(",", ".")))
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


def stamp_iso(text: str) -> dict | None:
    """One BARE ISO stamp → `{tMs, offsetMin}`, or `None` when it is not one.

    The second grammar this module owns, for the same reason it owns the first: `heap_series` reads the
    heap probe's stamps and `mem_series` reads the journal's, and two copies of the encoding are two
    places the axis drifts apart in silence.

    Clock Contract §2: components verbatim, a declared zone in `offsetMin` and `None` without one
    (rule 3), a shape this grammar does not recognise is `None` rather than the time of the read
    (rule 6), and components are range-validated (rule 7) — `2026-02-30T00:00:00` matches the shape
    and is not a calendar day."""
    m = ISO.match(text.strip())
    if m is None:
        return None
    try:
        t_ms, off = _floating(m.group(1), m.group(2))
    except ValueError:
        return None
    return {"tMs": t_ms, "offsetMin": off}
