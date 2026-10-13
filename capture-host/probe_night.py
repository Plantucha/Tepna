# tepna-capture — probe_night.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""probe_night — a night the box spent PROBING is DECLARED, never inferred.

SOLID-NIGHT-COWEAR-AND-PROBE-2026-10-13-BRIEF §2. Two declarations, either one enough, and the verdict
names which one spoke:

  · the JOURNAL — the daemon start that covers the night logged `heap probe: ARMED`
    (`capture.py consume_heap_request`). The heap probe injects event-loop stalls of 1-12 s on purpose
    (measured 2026-09-25: 25 stalls, 58 of the 64 H10 host gaps over 1 s inside the traced window,
    `capture.py:12033`), so a night it traced cannot be judged solid or not solid. The judge keeps no
    journal of its own, so `loss_audit` — which already reads the journal once for the night — writes
    the records beside the night and this module reads them (the same route as `clock_events`).
  · the MONITOR TOGGLE — `PROBE-NIGHT.json` in the night folder, written through the capture-host API
    by a button on `monitor.html`.

🔴 NOTHING HERE INFERS A PROBE FROM THE DATA (owner, 2026-10-12: stop inferring a cause from a shape).
A night with probe-shaped gaps and no declaration fails exactly as it does today.

⚠️ TURNING THE TOGGLE OFF REWRITES THE MARKER, IT NEVER DELETES IT. A declaration and its withdrawal are
both operator statements about the night, and §∅ keeps correction beside the captured bytes, dated and
attributed — a deleted marker would leave the night reading as though nobody had ever said anything.
"""

from __future__ import annotations

import datetime as _dt
import json
import os

MARKER_NAME = "PROBE-NIGHT.json"
#: The journal line `heap_probe` writes once the request is consumed and the probe will trace.
ARMED_NEEDLE = "heap probe: ARMED"
BY_MONITOR = "monitor"
SOURCE_JOURNAL = "journal"
SOURCE_MARKER = "monitor"
#: How many superseded toggle statements the marker keeps. An evening of on/off presses is a handful.
HISTORY_KEEP = 32
UNNAMED = "probe night: declared, and the declaration carries no time"


def now_iso() -> str:
    """The stamp a declaration carries — LOCAL civil time to the second, the clock every night folder,
    journal line and audit row on this box is written in (Clock Contract §1: a floating wall-clock
    stamp, never an instant with a zone bolted on)."""
    return _dt.datetime.now().isoformat(timespec="seconds")


def read_marker(night_dir: str) -> dict | None:
    """The night's toggle marker, or `None` when there is none to read.

    `None` covers absent, unreadable and not-an-object alike — all three mean the operator has said
    nothing about this night, which is a different fact from `on: false` (said, then withdrawn)."""
    # ⚠️ READ THE BYTES AND LET `json.loads` DECODE THEM. `open(..., encoding="utf-8")` gave the
    # diff-scoped gate two survivors it cannot be given an assertion for: `encoding=None` and a dropped
    # kwarg both fall back to the locale encoding, which IS utf-8 on this box and in CI, so no test can
    # tell them from the explicit argument. `json.loads` over bytes is utf-8 by RFC 8259 with no
    # argument to drop, and a mutated mode string makes `open` raise instead.
    try:
        with open(os.path.join(night_dir, MARKER_NAME), "rb") as fh:
            obj = json.loads(fh.read())
    except (OSError, ValueError):
        return None
    return obj if isinstance(obj, dict) else None


def write_marker(night_dir: str, *, on: bool, at: str, by: str = BY_MONITOR) -> dict:
    """Write the night's probe flag and return it. The previous statement moves into `history`.

    `os.replace` on a temporary file, so a reader never sees half a marker — and the history is why the
    replace is not lossy: every statement this file has carried is still in it."""
    prev = read_marker(night_dir)
    hist: list[dict] = []
    if prev is not None:
        hist = [h for h in (prev.get("history") or []) if isinstance(h, dict)]
        hist.append({"on": prev.get("on") is True, "at": prev.get("at"), "by": prev.get("by")})
    obj = {"on": bool(on), "at": at, "by": str(by), "history": hist[-HISTORY_KEEP:]}
    path = os.path.join(night_dir, MARKER_NAME)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=2)
        fh.write("\n")
    os.replace(tmp, path)
    return obj


def armed_records(audit: dict | None) -> list[dict] | None:
    """The night's `heap probe: ARMED` records from the loss audit, or `None` when nobody read them.

    🔴 `None` AND `[]` SAY DIFFERENT THINGS and the difference decides a night: `[]` is "the journal was
    read and no probe armed", which lets the ordinary judge run; `None` is "nothing read the journal",
    which licenses no claim either way (§∅). An audit written before this record existed also reads
    `None` — it did not look."""
    if not isinstance(audit, dict):
        return None
    recs = audit.get("probe_armed")
    if not isinstance(recs, list):
        return None
    return [r for r in recs if isinstance(r, dict)]


def declaration(night_dir: str, audit: dict | None = None) -> dict | None:
    """`{on, source, at, reason}` when this night is a DECLARED probe night, else `None`.

    The journal is read first because it is a fact about the run rather than a statement about the
    night: a toggle turned off cannot un-arm a probe that traced. A toggle turned off with no journal
    declaration leaves the ordinary judge in force, which is exactly what `None` says here."""
    recs = armed_records(audit)
    if recs:
        at = str(recs[0].get("at") or "") or None
        return {
            "on": True,
            "source": SOURCE_JOURNAL,
            "at": at,
            "reason": f"probe night: declared by journal heap-probe ARMED at {at}" if at else UNNAMED,
        }
    marker = read_marker(night_dir)
    if marker is not None and marker.get("on") is True:
        at = str(marker.get("at") or "") or None
        return {
            "on": True,
            "source": SOURCE_MARKER,
            "at": at,
            "reason": f"probe night: declared by monitor toggle at {at}" if at else UNNAMED,
        }
    return None


def state(night_dir: str, audit: dict | None = None) -> dict:
    """Every field the monitor chip paints, for one night.

    `marker_on` is `None` until a toggle has been pressed for this night, and `journal_armed` is `None`
    until an audit has read the journal — neither absence is a `false`."""
    marker = read_marker(night_dir)
    recs = armed_records(audit)
    decl = declaration(night_dir, audit)
    at = (
        decl["at"] if decl is not None else (str(marker.get("at")) if marker is not None and marker.get("at") else None)
    )
    return {
        "night": os.path.basename(night_dir.rstrip("/")) or None,
        "on": decl is not None,
        "source": decl["source"] if decl is not None else None,
        "at": at,
        "reason": decl["reason"] if decl is not None else None,
        "marker_on": marker.get("on") is True if marker is not None else None,
        "journal_armed": None if recs is None else bool(recs),
    }
