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


def pending_nights(captures_dir: str, tonight: str, marker: str = _MARKER) -> list[str]:
    """Completed night dirs (every `YYYY-MM-DD` except `tonight`) that lack the archived marker."""
    out = []
    for n in diskguard.list_nights(captures_dir):
        if n == tonight:
            continue                                   # still being written — not done yet
        if os.path.exists(os.path.join(captures_dir, n, marker)):
            continue                                   # already mirrored
        out.append(n)
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
