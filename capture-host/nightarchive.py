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


def _grew_since_marker(night_dir: str, marker: str) -> bool:
    """True when any file in `night_dir` is newer than its `.archived` marker — i.e. the night gained
    data AFTER it was mirrored, so the mirror is now incomplete. Fails SAFE: anything unreadable counts
    as grown, because a re-offer costs only the files that differ while a wrong skip loses them."""
    try:
        m = os.stat(os.path.join(night_dir, marker)).st_mtime
    except OSError:
        return True
    try:
        entries = list(os.scandir(night_dir))
    except OSError:
        return True
    for e in entries:
        if e.name == marker:
            continue
        try:
            if e.is_file() and e.stat().st_mtime > m:
                return True
        except OSError:
            return True
    return False


def pending_nights(captures_dir: str, active: "str | set[str]", marker: str = _MARKER) -> list[str]:
    """Completed night dirs that still need mirroring — every `YYYY-MM-DD` except the `active` ones
    (the nights still being written). `active` is a set of night names (from diskguard.active_nights) so
    a session that ran past midnight, leaving TWO in-progress date dirs, protects both; a bare string is
    also accepted for the single-date case. Mirroring by file activity, not the wall clock, is what stops
    the live night being copied — and then marked done — the instant the clock ticks past midnight.

    ⚠️ THE MARKER IS NOT A ONE-WAY LATCH (CAPTURE-HOST-DEEP-AUDIT §C4). It used to be: any night
    carrying `.archived` was skipped forever, and nothing anywhere removes the marker. But
    `writers.night_dir` keys a folder on the SESSION'S START DATE, so an early-morning session and that
    evening's session share one `YYYY-MM-DD` dir with a multi-hour daytime lull between them — during
    which the night looks finished, gets mirrored, and is marked done. Everything written that evening
    then never reached the mirror, while `unarchived_nights` reported the copy confirmed (it checked
    only that `dest/<night>/` exists) and `prune_old_nights` deleted the local — and only complete —
    copy. Measured on the real box: 7 of 11 nights have a genuine premature-archive window, e.g.
    2026-07-20 quiet for 5.08 h with 828.8 MB written afterwards.

    So a night whose SOURCE has grown since the marker is offered again. `archive_night` is idempotent
    and size-diffed, so the re-offer costs only the new files.

    VIGIL-HARDENING-II §1.3 hardened the DESTINATION side of exactly this reasoning — "the marker
    records that a copy was MADE, not that it still EXISTS" — and the identical argument was never
    applied to the source side: not that the source has not GROWN since."""
    skip = {active} if isinstance(active, str) else set(active)
    out = []
    for n in diskguard.list_nights(captures_dir):
        if n in skip:
            continue                                   # still being written — not done yet
        nd = os.path.join(captures_dir, n)
        if os.path.exists(os.path.join(nd, marker)) and not _grew_since_marker(nd, marker):
            continue                                   # mirrored, and unchanged since
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

    ⚠️ NOR IS THE DESTINATION DIRECTORY'S EXISTENCE (CAPTURE-HOST-DEEP-AUDIT §C4). This checked only
    that `dest/<night>/` was there, which is satisfied by a mirror made when the night was half-written —
    the premature-archive case `pending_nights` now re-offers. Between the two, a night could be
    released to `prune_old_nights` while the local copy was the only COMPLETE one. Confirmation is now
    per-file: every source file must exist at the destination at the same size.

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
            elif dest is not None and not _mirror_matches(os.path.join(captures_dir, n),
                                                          os.path.join(dest, n), marker):
                out.add(n)                     # the copy is absent, or short of what the source holds
        except OSError:
            out.add(n)
    return out


def _mirror_matches(src: str, dst: str, marker: str) -> bool:
    """True only when every file under `src` exists under `dst` at the same size. Fails SAFE (False) on
    anything it cannot read: an unconfirmed mirror must never license a delete.

    Size parity rather than a content hash on purpose — this runs in the storage poller against nights
    that are gigabytes, and the failure being guarded (a mirror that stopped early, or was made while
    the night was still growing) shows up as missing or short files, not as equal-length corruption."""
    try:
        if not os.path.isdir(dst):
            return False
        have = {e.name: e.stat().st_size for e in os.scandir(dst) if e.is_file()}
        for e in os.scandir(src):
            if e.name == marker or not e.is_file():
                continue
            if have.get(e.name) != e.stat().st_size:
                return False
    except OSError:
        return False
    return True


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
