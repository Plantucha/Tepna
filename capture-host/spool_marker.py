# tepna-capture — spool_marker.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# THE ONE-DAY RUN MARKER for the stored-spool pull, on disk instead of in memory.
#
# `_cpap_spool_loop` held `last_run_date` in a local and started it at `None`, so every daemon
# restart re-entered the coroutine believing no pull had happened. Measured on vigil 2026-10-18 over
# the whole journal retention (residue `2026-10-18-daemon-restart-in-the-window-repeats-the-spool-
# pull`): 74 pull attempts on 43 days, of which 27 on 17 days followed an earlier SUCCESS on the
# same day, and all 27 ran in a different python PID from that success. Repeats inside one PID: 0 —
# the in-process guard was never the gap.
#
# Each repeat is a full AS11 BLE session that re-reads the whole spool page, adds no data, and holds
# the one link the shadow poll and the auto-start detector also need.
#
# 🔴 SAVE AFTER SUCCESS, NOT AT THE ATTEMPT, and the asymmetry is deliberate. The loop advances its
# in-memory `last_run_date` BEFORE the pull so a deferral does not consume the day, and rolls it back
# on `LinkBusy`. The marker records only a pull that returned. So a restart after a FAILED pull
# retries today, and a restart after a successful one does not — which is the measured defect and
# nothing wider.
#
# 🔴 ABSENCE IS NULL (CLAUDE.md §∅). An absent, unreadable or unparsable marker reads as `None`,
# never as today and never as a sentinel date. `None` means "no pull is recorded", which makes the
# loop behave exactly as it did before this module existed — the safe direction, because the cost of
# a wrong `None` is one duplicate pull and the cost of a wrong date is a silently skipped day.
#
# A marker dated in the FUTURE needs no guard: `cpap_harvest.due_now` compares `last_run_date != d`
# for equality only, so a future date matches no window until it arrives, the pull runs today, and
# today's save overwrites it. A floor or a clamp here would be code for a case the predicate already
# handles.

from __future__ import annotations

import datetime as _dt
import os
import re
import tempfile

_DAY = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")

ABSENT = "no marker file"


def _parse(text: str):
    """The date one marker line records, or None. Components are RANGE-VALIDATED.

    `date.fromisoformat` would accept `20261018` and other spellings this file never writes, and a
    reader that accepts more shapes than the writer emits is a reader that cannot tell its own
    output from someone else's."""
    m = _DAY.match(text.strip())
    if m is None:
        return None
    try:
        return _dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        # A real calendar day only: `2026-02-30` matches the pattern and is not a date.
        return None


def load_day(path):
    """`(day, reason)` — the recorded day, and why it is absent when it is.

    The reason is for the journal. A restart that silently reads no marker looks identical to a
    restart that read one, which is the shape this whole row is about, so the caller logs it."""
    try:
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
    except FileNotFoundError:
        return None, ABSENT
    except OSError as exc:
        return None, f"unreadable: {type(exc).__name__}: {exc}"
    day = _parse(text)
    if day is None:
        return None, f"not a date: {text.strip()[:40]!r}"
    return day, None


def save_day(path, day) -> str | None:
    """Record `day`. Returns None on success, or the reason the record did not land.

    ATOMIC: a kill between `open` and the last byte would otherwise leave a truncated line, and
    `2026-10-1` parses as nothing while `2026-10-1` + a stale tail could parse as another day. The
    caller journals a returned reason rather than this module swallowing it, because a marker that
    quietly fails to save brings back the exact repeat it exists to stop."""
    try:
        d = os.path.dirname(path) or "."
        os.makedirs(d, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=d, prefix=".spool-marker-", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(f"{day.isoformat()}\n")
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, path)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:  # read-only volume; nothing was replaced, so the old record is intact
                pass
            raise
    except (OSError, AttributeError, ValueError) as exc:
        return f"{type(exc).__name__}: {exc}"
    return None
