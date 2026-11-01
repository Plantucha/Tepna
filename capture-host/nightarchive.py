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
#
# ⚠️ WHAT THIS DOES *NOT* COVER, STATED RATHER THAN IMPLIED (audit F2, 2026-08-01). "Every night lives on
# two disks" is true of NIGHTS and only of nights: every function here iterates `diskguard.list_nights`,
# whose `_NIGHT_RE` is a strict `^\d{4}-\d{2}-\d{2}$`. Two sibling subtrees under `captures/` are
# therefore outside the mirror entirely, and nothing said so:
#
#   captures/stored/    the ONBOARD device-flash pulls (Polar PS-FTP, O2Ring .dat) — i.e. the backup
#                       that exists precisely BECAUSE the live BLE link is lossy. One copy.
#   captures/cpap/      the harvested ResMed EDFs. One copy.
#
# They are also outside `diskguard`'s pruner, so this is a single-copy EXPOSURE, not a deletion path —
# nothing here will lose them, but nothing here protects them either. Extending coverage is a disk-budget
# decision for the box's owner (stored/ grows without bound and is never pruned), so it is deliberately
# NOT taken unilaterally; `uncovered_subtrees()` below reports the exposure so the monitor can show it
# instead of a "backup working" that quietly means "backup working for some of your data".
from __future__ import annotations

import os
import shutil
import time

import diskguard
import nightqc

_MARKER = ".archived"

# NEVER mirrored, whatever the config says. `incoming/` holds partial in-flight downloads; a mirrored
# partial is worse than no mirror, because it looks like data. A code-level refusal rather than a
# default, so it cannot be configured away by someone listing "everything under captures/".
_INELIGIBLE_SUBTREES = frozenset({"incoming"})


def rel_files(night_dir: str, marker: str = _MARKER) -> list[str]:
    """Every file in `night_dir`, as a path relative to it, marker excluded, sorted.

    ⚠️ THE SHARED ENUMERATOR, AND IT IS THE POINT (audit F1, 2026-08-01). `archive_night` copies exactly
    this set and `_mirror_matches` confirms exactly this set, so the copier and the confirmer cannot
    disagree about what a night CONTAINS. They used to agree only by coincidence — both skipped anything
    that was not a plain top-level file — and that coincidence was a data-loss path: a night holding a
    subdirectory was reported fully mirrored while the subdirectory had never been copied, which is what
    releases the local copy to `prune_old_nights`. Every other branch in this module fails safe; that one
    failed OPEN, in the single function standing between "old" and "deleted".

    Raises OSError rather than swallowing it: every caller here turns that into "unconfirmed", and the
    doubt must protect the data rather than license its deletion.

    ⚠️ `onerror=_raise` IS THE LOAD-BEARING ARGUMENT. `os.walk` IGNORES errors by default — an
    unreadable night would walk to an EMPTY list, which reads as "this night contains nothing", which
    `_mirror_matches` would then confirm as fully mirrored. That is the same fail-OPEN this function was
    written to remove, reintroduced one default argument down. Caught by the pre-existing
    `test_mirror_matches_is_false_when_the_source_cannot_be_read`; do not drop it."""

    def _raise(err: OSError):
        raise err

    out: list[str] = []
    for dirpath, _dirnames, filenames in os.walk(night_dir, onerror=_raise):
        for fn in filenames:
            rel = os.path.relpath(os.path.join(dirpath, fn), night_dir)
            if rel == marker:
                continue
            out.append(rel)
    return sorted(out)


def _grew_since_marker(night_dir: str, marker: str) -> bool:
    """True when any file in `night_dir` is newer than its `.archived` marker — i.e. the night gained
    data AFTER it was mirrored, so the mirror is now incomplete. Fails SAFE: anything unreadable counts
    as grown, because a re-offer costs only the files that differ while a wrong skip loses them.

    Walks the night at every depth (`rel_files`): it used to scan only the top level, so a night that
    gained data ONLY inside a subdirectory looked finished and was never re-offered."""
    try:
        m = os.stat(os.path.join(night_dir, marker)).st_mtime
    except OSError:
        return True
    try:
        rels = rel_files(night_dir, marker)
    except OSError:
        return True
    for rel in rels:
        try:
            if os.stat(os.path.join(night_dir, rel)).st_mtime > m:
                return True
        except OSError:
            return True
    return False


# How long a night may sit with its DEVICE data settled while something else in the folder keeps being
# written, before the protection that holds it is reported as stalled. A stated constant, not a config
# key: the number answers "is one lone writer parking a finished night", and that question does not
# change per box. Six hours is well past any real doff-to-settle gap and well short of the measured
# stall (one `OXYLIFE*.csv` moved 14 h after the night's other 89 files settled, 2026-10-29).
COPY_STALL_AFTER_SEC = 6 * 3600.0


def copy_blocked_nights(
    captures_dir: str, settle_sec: float, _now=time.time, _newest=nightqc.newest_data_mtime
) -> set[str]:
    """The nights a non-destructive COPY must skip: those whose DEVICE data is still arriving.

    🔴 NOT `diskguard.active_nights`, AND THAT IS THE WHOLE POINT. That set answers "is ANYTHING
    writing in this folder" and is right to count any file, because its contract is a protect-list for
    DESTRUCTIVE work (prune, retention) where a folder someone writes to must be left alone. A mirror
    or a push is not destructive. `archive_night` is idempotent and size-diffed and `pending_nights`
    re-offers a night whose source grew, so a copy taken while a sidecar is mid-write costs the next
    cycle the changed bytes and nothing else. `nightqc.data_settled` already drew this line for the QC
    poller, which borrowed the wider answer and therefore never judged a night at all.

    The protection had NO CEILING, so one periodic writer parked a whole night without bound: measured
    on the capture box 2026-10-29, the 2026-10-28 night held 1.1 GB over 90 files, 89 of them settled
    at 05:14, and one 284 KB `OXYLIFE*.csv` moved at 19:24 the next evening. The deployed selector
    returned that night active and `pending_nights` empty, 6.5 h after the last push, while
    `status.recording` read false and `status.live_loss.open_files` read 0.

    A folder with NO device-capture file is NOT blocked, which is a deliberate difference from
    `data_settled`, where `None` means "nothing to judge" and so cannot be settled. Here the question
    is whether a DEVICE is still appending; no capture file means no device append and nothing a copy
    can tear. The midnight decoy folder — sidecars only, no data — is exactly that case, and holding a
    copy for it is how the stall reproduces.

    Fails SAFE in the same direction as `active_nights`: a night we cannot read counts as blocked,
    because the doubt must not license the copy of a half-written file we then mark confirmed.
    `_now` and `_newest` are injectable for tests."""
    now = _now()
    out: set[str] = set()
    for n in diskguard.list_nights(captures_dir):
        d = os.path.join(captures_dir, n)
        try:
            newest = _newest(d)
        except OSError:
            out.add(n)
            continue
        if newest is not None and (now - newest) < settle_sec:
            out.add(n)
    return out


def stalled_protection(
    captures_dir: str,
    settle_sec: float,
    stall_after_sec: float = COPY_STALL_AFTER_SEC,
    _now=time.time,
    _newest=nightqc.newest_data_mtime,
) -> list[dict]:
    """The nights `diskguard.active_nights` still holds although their DEVICE data settled long ago.

    One row per night, oldest settled first: `{night, data_age_sec, any_age_sec}`. A night qualifies
    when all three hold — its device data exists and settled (`data_age_sec >= settle_sec`), something
    else in the folder is still fresh (`any_age_sec < settle_sec`), and the data has been settled past
    `stall_after_sec`. That is the shape of the measured defect: a lone periodic writer, every device
    file long quiet, the folder held active without bound.

    This REPORTS; it does not gate. `copy_blocked_nights` above already unblocks the copy, so this
    exists because the stall was SILENT for 6.5 h: `archive.ok` describes the last ATTEMPT, which
    passed, so nothing anywhere said a night had stopped being offered. A bound with no alarm trades a
    stall you can measure for one you cannot.

    Ages are `None`-free by construction — a night with no device data never qualifies, so no row
    carries a measurement that was not taken."""
    now = _now()
    rows: list[dict] = []
    for n in diskguard.list_nights(captures_dir):
        d = os.path.join(captures_dir, n)
        try:
            newest = _newest(d)
            any_m = _newest_any_mtime(d)
        except OSError:
            continue  # unreadable is not evidence of a stall — copy_blocked_nights holds it instead
        if newest is None or any_m is None:
            continue
        data_age = now - newest
        any_age = now - any_m
        if data_age >= settle_sec and any_age < settle_sec and data_age > stall_after_sec:
            rows.append({"night": n, "data_age_sec": data_age, "any_age_sec": any_age})
    rows.sort(key=lambda r: -r["data_age_sec"])
    return rows


def _newest_any_mtime(night_dir: str) -> float | None:
    """Newest mtime among ANY file directly in `night_dir`, or None when it holds none.

    The counterpart to `nightqc.newest_data_mtime`, which excludes sidecars by tag. The pair is what
    lets a caller say "the devices are quiet AND something else is not" without re-deriving either
    rule. Top level only, matching `diskguard.active_nights`, whose verdict this explains."""
    newest = None
    for f in os.listdir(night_dir):
        p = os.path.join(night_dir, f)
        if os.path.isfile(p):
            m = os.path.getmtime(p)
            if newest is None or m > newest:
                newest = m
    return newest


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
            continue  # still being written — not done yet
        nd = os.path.join(captures_dir, n)
        if os.path.exists(os.path.join(nd, marker)) and not _grew_since_marker(nd, marker):
            continue  # mirrored, and unchanged since
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
                return set(nights)  # backup volume unmounted/gone — confirm nothing, keep all
        except OSError:
            return set(nights)
    out: set[str] = set()
    for n in nights:
        try:
            if not os.path.exists(os.path.join(captures_dir, n, marker)):
                out.add(n)
            elif dest is not None and not _mirror_matches(os.path.join(captures_dir, n), os.path.join(dest, n), marker):
                out.add(n)  # the copy is absent, or short of what the source holds
        except OSError:
            out.add(n)
    return out


def _mirror_matches(src: str, dst: str, marker: str) -> bool:
    """True only when every file under `src` — AT ANY DEPTH — exists under `dst` at the same size. Fails
    SAFE (False) on anything it cannot read: an unconfirmed mirror must never license a delete.

    Size parity rather than a content hash on purpose — this runs in the storage poller against nights
    that are gigabytes, and the failure being guarded (a mirror that stopped early, or was made while
    the night was still growing) shows up as missing or short files, not as equal-length corruption.

    Enumerates through `rel_files`, the same call `archive_night` copies from — so "what was confirmed"
    and "what was copied" are the same set by construction rather than by two functions happening to
    skip the same things (audit F1)."""
    try:
        if not os.path.isdir(dst):
            return False
        for rel in rel_files(src, marker):
            if os.path.getsize(os.path.join(dst, rel)) != os.path.getsize(os.path.join(src, rel)):
                return False
    except OSError:
        return False
    return True


def archive_night(captures_dir: str, night: str, dest: str, marker: str = _MARKER, _copy=shutil.copy2) -> int:
    """Mirror one night's files to `dest/<night>/`, then drop the marker. Idempotent: a file already at the
    destination with the same size is skipped, so a re-run after a partial copy only moves what differs.
    Returns the number of files actually copied. `_copy` is injectable for tests."""
    src = os.path.join(captures_dir, night)
    dst = os.path.join(dest, night)
    os.makedirs(dst, exist_ok=True)
    copied = 0
    # `rel_files` (not a top-level listdir): a night is flat today, but the confirmer runs off this same
    # enumeration, so anything this loop declines to copy would otherwise be confirmed as mirrored
    # anyway — the F1 data-loss path. Copying at depth keeps the pair honest without a special case.
    for rel in rel_files(src, marker):
        sp = os.path.join(src, rel)
        dp = os.path.join(dst, rel)
        if os.path.exists(dp) and os.path.getsize(dp) == os.path.getsize(sp):
            continue  # already mirrored, unchanged — resume-safe
        os.makedirs(os.path.dirname(dp), exist_ok=True)
        _copy(sp, dp)
        copied += 1
    open(os.path.join(src, marker), "w").close()  # mark done so this night is not re-scanned
    return copied


def mirror_subtree(captures_dir: str, name: str, dest: str, _copy=shutil.copy2) -> int:
    """Mirror one APPEND-FOREVER subtree (`stored/`, `cpap/`) to `dest/<name>/`. Returns files copied.

    Why this is not `archive_night` (audit F2, landed 2026-08-01). A night has a finished state, which
    is what the `.archived` marker records and what `pending_nights` reasons about. These trees never
    finish: a pull lands whenever a device comes off the charger, a harvest whenever the CPAP card is
    read. So there is no marker and no completion question — just a size-diffed mirror on every cycle,
    which is idempotent and copies only what is new.

    ⚠️ MIRRORING IS NOT A LICENCE TO DELETE. These trees stay outside `diskguard`, permanently: every
    pruning path goes through `list_nights`, whose `_NIGHT_RE` cannot match `stored` or `cpap`. Do not
    "unify" that later on the grounds that they now have a second copy — that is precisely the loop the
    F1 fix removed, where a confirmation gate ended up licensing the delete of the only complete copy.
    They are cheap to keep: measured before landing this, 1.5 MB and 534 MB against ~942 MB PER NIGHT.

    Refuses a night directory (those belong to `archive_night`, which knows not to touch an active one)
    and anything in `_INELIGIBLE_SUBTREES`."""
    if name in _INELIGIBLE_SUBTREES or diskguard._NIGHT_RE.match(name):
        return 0
    src = os.path.join(captures_dir, name)
    if not os.path.isdir(src):
        return 0  # not every box has every subtree
    dst = os.path.join(dest, name)
    copied = 0
    for rel in rel_files(src, _MARKER):
        sp, dp = os.path.join(src, rel), os.path.join(dst, rel)
        if os.path.exists(dp) and os.path.getsize(dp) == os.path.getsize(sp):
            continue
        os.makedirs(os.path.dirname(dp), exist_ok=True)
        _copy(sp, dp)
        copied += 1
    return copied


def uncovered_subtrees(captures_dir: str, covered: "tuple[str, ...] | set[str]" = ()) -> list[dict]:
    """Directories under `captures/` that hold data but are OUTSIDE the mirror — reported, not fixed.

    The archive iterates strict `YYYY-MM-DD` night dirs (see the module header), so `stored/` and
    `cpap/` — the onboard device-flash pulls and the harvested CPAP EDFs — have exactly one copy. That
    is a defensible scope; it is not a defensible SILENCE, because the storage card's only signal today
    is a mirrored-nights count that reads as "the backup is working".

    Returns `[{name, files, bytes}]`, name-sorted, for any non-night directory that actually contains
    files. Empty when nothing is uncovered — a box that only records nights surfaces nothing and the
    monitor stays quiet. Best-effort throughout: this is a REPORTER, and it must never be able to
    disturb capture.

    `covered` is what the archive now mirrors (`archive.include_subtrees`) and is SUBTRACTED, so this
    became the guard for the NEXT subtree someone adds rather than a permanent complaint about the two
    that are handled. A reporter that always fires is a reporter nobody reads."""
    out: list[dict] = []
    try:
        entries = sorted(os.scandir(captures_dir), key=lambda e: e.name)
    except OSError:
        return out
    nights = set(diskguard.list_nights(captures_dir))
    skip = nights | set(covered) | _INELIGIBLE_SUBTREES
    for e in entries:
        try:
            if not e.is_dir() or e.name in skip or e.name.startswith("."):
                continue
            files = size = 0
            for rel in rel_files(e.path, _MARKER):
                files += 1
                size += os.path.getsize(os.path.join(e.path, rel))
        except OSError:
            continue  # unreadable: reporting is best-effort, never a capture risk
        if files:
            out.append({"name": e.name, "files": files, "bytes": size})
    return out
