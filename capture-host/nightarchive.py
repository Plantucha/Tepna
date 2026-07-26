# tepna-capture — nightarchive.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# NIGHT OFFLOAD. Getting a finished night off the box to where it gets analysed used to be a manual copy.
# This mirrors each COMPLETED night (not tonight — it is still being written) to a configured destination:
# a NAS mount, the tepna-web served directory, a backup disk. Idempotent and resumable — a per-night
# `.archived` marker means a night is copied once, and a partial copy re-runs only the files that differ.
#
# MIRROR, never move: the source is left in place for the disk-retention guard (diskguard) to prune on its
# own schedule. Offload and retention are separate concerns — copying a night must never be what deletes it.
from __future__ import annotations

import os
import shutil

import diskguard

_MARKER = ".archived"


def pending_nights(captures_dir: str, active: "str | set[str]", marker: str = _MARKER) -> list[str]:
    """Completed night dirs that lack the archived marker — every `YYYY-MM-DD` except the `active` ones
    (the nights still being written). `active` is a set of night names (from diskguard.active_nights) so
    a session that ran past midnight, leaving TWO in-progress date dirs, protects both; a bare string is
    also accepted for the single-date case. Mirroring by file activity, not the wall clock, is what stops
    the live night being copied — and then marked done — the instant the clock ticks past midnight."""
    skip = {active} if isinstance(active, str) else set(active)
    out = []
    for n in diskguard.list_nights(captures_dir):
        if n in skip:
            continue                                   # still being written — not done yet
        if os.path.exists(os.path.join(captures_dir, n, marker)):
            continue                                   # already mirrored
        out.append(n)
    return out


def unarchived_nights(captures_dir: str, dest: str | None = None, marker: str = _MARKER) -> set[str]:
    """Night dirs whose second copy cannot be CONFIRMED right now — the retention gate
    (VIGIL-OVERNIGHT-FINDINGS §P3.2). `diskguard.plan_prune` deletes by AGE alone, which treats "old"
    as "safe to lose". Age is not evidence of safety; a second copy you can currently see is.

    ⚠️ THE MARKER ALONE IS NOT THAT EVIDENCE. `.archived` records that a copy was once MADE, not that
    it still EXISTS. Measured on the real box 2026-07-25: 6 of 10 nights carried the marker while the
    backup volume was **absent** (`dest_present:false`) — so a marker-only gate would have happily
    deleted the on-box copy of a night whose mirror had gone away with the disk, losing both. When
    `dest` is given, a night counts as archived only if the marker is present AND `dest/<night>` is
    actually there; a dest that is missing entirely means NOTHING can be confirmed, so every night is
    protected.

    Passing `dest=None` falls back to marker-only (used where the destination is not knowable).

    Deliberately fails SAFE throughout: a night whose marker or mirror cannot be read (permission, I/O
    error on a failing disk — precisely when this runs hot) is reported unconfirmed, so the doubt
    protects the data instead of licensing its deletion."""
    nights = diskguard.list_nights(captures_dir)
    if dest is not None:
        try:
            if not os.path.isdir(dest):
                return set(nights)             # backup volume unmounted/gone — confirm nothing, keep all
        except OSError:
            return set(nights)
    out: set[str] = set()
    for n in nights:
        try:
            if not os.path.exists(os.path.join(captures_dir, n, marker)):
                out.add(n)
            elif dest is not None and not os.path.isdir(os.path.join(dest, n)):
                out.add(n)                     # marker says copied, but the copy is not there any more
        except OSError:
            out.add(n)
    return out


def archive_night(captures_dir: str, night: str, dest: str,
                  marker: str = _MARKER, _copy=shutil.copy2) -> int:
    """Mirror one night's files to `dest/<night>/`, then drop the marker. Idempotent: a file already at the
    destination with the same size is skipped, so a re-run after a partial copy only moves what differs.
    Returns the number of files actually copied. `_copy` is injectable for tests."""
    src = os.path.join(captures_dir, night)
    dst = os.path.join(dest, night)
    os.makedirs(dst, exist_ok=True)
    copied = 0
    for name in sorted(os.listdir(src)):
        if name == marker:
            continue
        sp = os.path.join(src, name)
        if not os.path.isfile(sp):
            continue                                   # only files (no nested dirs on the box)
        dp = os.path.join(dst, name)
        if os.path.exists(dp) and os.path.getsize(dp) == os.path.getsize(sp):
            continue                                   # already mirrored, unchanged — resume-safe
        _copy(sp, dp)
        copied += 1
    open(os.path.join(src, marker), "w").close()       # mark done so this night is not re-scanned
    return copied
