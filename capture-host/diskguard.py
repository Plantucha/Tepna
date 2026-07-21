# tepna-capture — diskguard.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# STORAGE GUARD. The box writes ~1.2 GB/night, unattended, forever. Nothing here used to watch the disk,
# so a full filesystem turned every subsequent night into a silent loss: StreamWriter's fsync just started
# failing and the capture kept "running". This module gives the daemon two cheap, SAFE tools:
#
#   • disk_report()  — how much room is left (surfaced in status.json + the alert path).
#   • plan_prune()   — WHICH old nights to delete under an explicit age-retention policy.
#
# Deliberately conservative: pruning is AGE-BASED and OPT-IN (keep_nights <= 0 disables it entirely). A
# low-free-space condition is an *alert*, never an excuse to auto-delete this week's data to chase bytes —
# eating recent recordings to free space would trade a disk warning for an unrecoverable data loss, which
# is strictly worse. So the emergency signal is loud, and the deletion is bounded by the retention count.
from __future__ import annotations

import os
import re
import shutil
import time

# A night directory is EXACTLY writers.night_dir()'s layout: <root>/captures/YYYY-MM-DD. Matching on the
# strict date shape means the sibling `incoming/` and `stored/` dirs (and anything else) are never touched.
_NIGHT_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

_GiB = 1024 ** 3


def disk_report(path: str, min_free_gb: float = 0.0) -> dict:
    """Free/total bytes for the filesystem holding `path`, plus a `low` flag when free < min_free_gb.

    `path` need not exist yet — we walk up to the nearest existing parent so a not-yet-created root still
    reports the filesystem it will live on (rather than raising)."""
    probe = path
    while probe and not os.path.exists(probe):
        probe = os.path.dirname(probe) or "/"   # walk up; a relative path bottoms out at "/", which exists
    u = shutil.disk_usage(probe or "/")
    free_gb = u.free / _GiB
    return {
        "free_gb": round(free_gb, 2),
        "total_gb": round(u.total / _GiB, 2),
        "free_pct": round(100 * u.free / u.total, 1) if u.total else 0.0,
        "low": bool(min_free_gb > 0 and free_gb < min_free_gb),
    }


def list_nights(captures_dir: str) -> list[str]:
    """Sorted (oldest first) YYYY-MM-DD night directory names under `captures_dir`. [] if absent."""
    try:
        entries = os.listdir(captures_dir)
    except OSError:
        return []
    return sorted(n for n in entries
                  if _NIGHT_RE.match(n) and os.path.isdir(os.path.join(captures_dir, n)))


def active_nights(captures_dir: str, settle_sec: float, _now=time.time) -> set[str]:
    """Night dirs still being WRITTEN — any file modified within `settle_sec`. This is the anchor a
    24/7 daemon needs at midnight: a session that started before midnight keeps appending to its
    START-date folder well past 00:00, so the wall-clock date is the WRONG key for "which night is in
    progress" — file activity is the right one. Everything reading (QC), mirroring (archive), or pruning
    (retention) a night must treat an active night as untouchable and act only on settled ones.

    Returns a set — a cross-midnight reconnect that opened a fresh date dir can leave TWO active at once
    (the pre- and post-midnight folders), and both must be protected. `_now` is injectable for tests."""
    now = _now()
    out: set[str] = set()
    for n in list_nights(captures_dir):
        d = os.path.join(captures_dir, n)
        try:
            for f in os.listdir(d):
                p = os.path.join(d, f)
                if os.path.isfile(p) and (now - os.path.getmtime(p)) < settle_sec:
                    out.add(n)
                    break
        except OSError:
            continue                              # a night that vanished mid-scan is simply not active
    return out


def plan_prune(nights: list[str], keep_nights: int, protect: set[str] | None = None) -> list[str]:
    """Which nights to delete: everything OLDER than the newest `keep_nights`, minus any in `protect`
    (always at least tonight's date, so an in-progress capture is never swept). Oldest-first.

    keep_nights <= 0 disables pruning entirely (returns []): deleting a user's recordings must be an
    explicit, configured choice, never a silent default."""
    if keep_nights is None or keep_nights <= 0 or len(nights) <= keep_nights:
        return []
    protect = protect or set()
    stale = nights[:-keep_nights]                 # newest keep_nights are retained; the rest are stale
    return [n for n in stale if n not in protect]


def prune_old_nights(captures_dir: str, keep_nights: int, protect: set[str] | None = None,
                     _rm=shutil.rmtree) -> list[str]:
    """Execute plan_prune() against the real tree: rmtree each stale night, return the ones removed. A
    delete that fails (permission/race) is skipped, not fatal — freeing space must never crash capture.
    `_rm` is injectable so the planning can be exercised without touching disk."""
    removed = []
    for n in plan_prune(list_nights(captures_dir), keep_nights, protect):
        try:
            _rm(os.path.join(captures_dir, n))
            removed.append(n)
        except OSError:
            pass
    return removed
