# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""oxy_transfer — the O2Ring download as a TRANSACTION (G1).

`OXYII-G1-TRANSACTIONAL-SYNC-2026-08-23-BRIEF.md`. G2 (`oxy_inventory`) gave the vocabulary and the
ledger; G3 (`oxy_restart`) gave the cold-start recovery plan. This module is the part that actually
moves bytes, and therefore the only part where a crash can lose a recording.

THE SHAPE IS DICTATED BY THE CRASH POINTS, NOT BY TIDINESS (brief §2). Discovery, selection,
download, verify and commit are five separate functions because **every boundary between them is a
crash point with a different correct recovery**, and a monolithic `_pull_once` cannot express that
difference. `select()` is PURE, so the retry-vs-restart policy is a unit test rather than a field
observation.

THE COST IS LINK ACQUISITION, NOT BYTES (brief §1, from G5's 409-pull journal): a median 78 KB moved
inside a p90 69.2 s handoff window means throughput is irrelevant and connection count is
everything. **Every retry is a fresh acquisition, so the retry policy IS the performance policy** —
that is why the attempt bound below is small and explicit rather than generous.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

import oxy_inventory as inv
from cpap_acq import FailureClass

# ── validation depth ──────────────────────────────────────────────────────────────────────────────
# 🔴 WHAT `VERIFIED` ACTUALLY CLAIMS HERE, stated so nothing downstream can quietly widen it.
# Brief §4 defines three layers: (1) expected-vs-received size, (2) finalisation via the Format-A
# trailer, (3) a semantic record-boundary walk. Layers 1–2 are implemented; **layer 3 is NOT**, and
# needs a subset port of the JS record parser — a real work item with a real cost.
#
# So a VERIFIED row from this module means "size matched and the trailer is finalised". It does NOT
# mean "parses as a recording". Those are different claims and conflating them is the false
# completion the charter forbids, so the depth is written INTO the ledger row rather than left to be
# assumed by a reader. When layer 3 lands, this constant changes and old rows remain honest about
# what they were checked against.
VALIDATION_DEPTH = "size+finalised+records"

# Format-A geometry, for the layer-3 record-boundary walk. Measured against real 95 KB / 81 KB `.dat`
# files: a 10-byte header signature, then N × 3-byte 1 Hz records, then a 48-byte session-stats trailer,
# with `(size - 10 - 48) / 3 == trailer.total_seconds` holding EXACTLY. (The `ff ff` end-marker the JS
# parser breaks on sits ~10 records before the trailer and is COUNTED in that arithmetic — so the marker
# walk yields total_seconds−10, not the count; the size/trailer arithmetic is the reliable invariant.)
_FMT_A_HEADER = bytes([0x01, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x00])
_RECORD_LEN = 3
_TRAILER_LEN = 48

# ⚠️ THE TWO FSYNCS BELOW ARE NOT COVERED BY THE UNIT SUITE, and that is a fact about the instrument
# rather than about the invariant. Removing either — the file's before verify, the directory's after
# rename — leaves every test in `test_oxy_transfer.py` green, because durability is not observable
# from a unit test. Verified by re-application, not assumed. It IS observable to fault injection (a
# crash-at-syscall harness killing between write and rename), so it is a named open item for the
# OxyII chaos lane, not a permanent unknown. Do not delete these lines because "nothing fails".

# Bounded retry (brief §6). With an hourly poller a recording that fails three times is unavailable
# for three hours; three attempts INSIDE one pull window cost ~3.5 min of link at p90. These are
# different budgets and this bound belongs to the second.
MAX_ATTEMPTS = 3

# Re-serve-from-start is the default because the drop behaviour is UNMEASURED (brief §5): the direct
# test needs a physical ring wake. A wrong resume offset produces a file that is the right size and
# silently corrupt; a redundant re-serve costs one acquisition (~69 s p90). The asymmetry decides it.
RESTART = "restart"
RESUME = "resume"


@dataclass(frozen=True)
class Resume:
    """The recovery decision, behind ONE function so the drop test flips one body (brief §5)."""

    mode: str
    offset: int
    reason: str


@dataclass(frozen=True)
class Selection:
    """What we will fetch and WHY. The reason is carried, not re-derived, so the ledger can record
    the same sentence the policy used."""

    ident: str
    device_id: str
    session: str
    action: str  # "download" | "skip"
    reason: str
    resume: Resume | None = None
    attempt: int = 1


@dataclass(frozen=True)
class DownloadResult:
    bytes_written: int
    complete: bool
    failure: FailureClass | None
    reason: str


@dataclass(frozen=True)
class VerifyResult:
    ok: bool
    depth: str
    reason: str
    size: int
    sha256: str | None


_BY_LABEL = {f.label: f for f in FailureClass}


def _is_recoverable(label: str | None) -> bool:
    """Is a recorded failure worth another acquisition?

    ⚠️ An UNKNOWN label is treated as recoverable, and that direction is deliberate. Retrying a
    permanent failure wastes one acquisition, bounded by `max_attempts`; declining to retry a
    recoverable one loses a recording for good. When the two error directions cost different
    amounts, the default belongs to the cheaper one."""
    if label is None:
        return True
    cls = _BY_LABEL.get(label)
    return True if cls is None else cls.recoverable


def list_sessions(lister) -> list[dict]:
    """What the ring says it has. Read-only, cheap, and **committing to nothing** (brief §2).

    `lister()` is injected so this is testable without a device and so the transport stays out of
    the policy: everything downstream consumes plain dicts. Entries missing a `device_id` or
    `session` are dropped rather than defaulted — an identity we cannot form is one we could never
    reconcile against the ledger, and inventing one would put a fabricated key in an append-only
    file."""
    out: list[dict] = []
    for item in lister() or []:
        device_id = item.get("device_id")
        session = item.get("session")
        if not device_id or not session:
            continue
        out.append({"device_id": device_id, "session": session, "reported_size": item.get("reported_size")})
    return out


def resume_strategy(partial_bytes: int, reported_size: int | None, *, allow_resume: bool = False) -> Resume:
    """Whether to re-serve from the start or resume mid-file — brief §5, spec §17.

    ⚠️ `allow_resume` exists so the scheduled physical drop test flips ONE flag rather than a policy
    scattered through the transfer loop. It defaults False on purpose: until that test runs, the
    AS11 re-serve-from-start analogy is the only in-house precedent, and it is the safe half of an
    asymmetric bet (a redundant acquisition versus a silently spliced file)."""
    if partial_bytes <= 0:
        return Resume(RESTART, 0, "no partial bytes on disk")
    if reported_size is not None and partial_bytes >= reported_size:
        # Size-complete but unfinalised: the missing part is the TRAILER, which the ring flushes
        # after reporting full size (G2's rule). Resuming from the end would append nothing and
        # re-verify the same unfinalised file forever, so this must re-serve.
        return Resume(RESTART, 0, "size-complete but unfinalised — trailer never flushed")
    if not allow_resume:
        return Resume(RESTART, 0, f"re-serve default: mid-file resume unmeasured, discarding {partial_bytes} B")
    return Resume(RESUME, partial_bytes, f"resuming at {partial_bytes} B of {reported_size} B")


def select(listing, ledger_rows, *, max_attempts: int = MAX_ATTEMPTS, allow_resume: bool = False) -> list[Selection]:
    """What to fetch, given what the ring lists and what the ledger already knows. **PURE** — no
    device, no disk, no clock (brief §2, spec §15).

    `listing` is what `list_sessions()` returned: dicts with `device_id`, `session`, and optionally
    `reported_size`. Policy: NEW → download · PARTIAL/in-flight → resume-or-restart · VERIFIED or
    COMMITTED → skip · FAILED → bounded retry.

    ⚠️ DOWNLOADING and VERIFYING are treated exactly as PARTIAL. They are states a crash LEAVES
    behind (crash points 3–5): seeing one means the process died mid-flight, never that a transfer is
    live — this function has no way to observe a live one and must not pretend otherwise."""
    cur = inv.current(ledger_rows)
    out: list[Selection] = []
    for item in listing:
        device_id = item["device_id"]
        session = item["session"]
        ident = inv.identity(device_id, session)
        reported = item.get("reported_size")
        row = cur.get(ident)

        if row is None:
            # Routed through resume_strategy even though a new recording obviously restarts: the
            # brief's criterion is that the re-serve/resume choice exists in exactly ONE place and
            # is provable by grep. A second construction site here would be true today and wrong the
            # first time the policy changes.
            out.append(
                Selection(
                    ident,
                    device_id,
                    session,
                    "download",
                    "new — no ledger row",
                    resume_strategy(0, reported, allow_resume=allow_resume),
                    1,
                )
            )
            continue

        state = row.get("state")
        if state in (inv.VERIFIED, inv.COMMITTED):
            out.append(Selection(ident, device_id, session, "skip", f"already {state}"))
            continue

        attempt = (row.get("attempt") or 0) + 1
        if state == inv.FAILED:
            if not _is_recoverable(row.get("failure")):
                out.append(
                    Selection(
                        ident, device_id, session, "skip", f"permanent failure ({row.get('failure')}) — not retried"
                    )
                )
                continue
            if attempt > max_attempts:
                out.append(
                    Selection(ident, device_id, session, "skip", f"attempts exhausted ({attempt - 1}/{max_attempts})")
                )
                continue

        have = row.get("size") or 0
        resume = resume_strategy(have, reported, allow_resume=allow_resume)
        out.append(Selection(ident, device_id, session, "download", f"{state} — {resume.reason}", resume, attempt))
    return out


def download(fetch, part_path: str, selection: Selection, *, reported_size: int | None = None) -> DownloadResult:
    """Bytes → `.part`. The only long-running step, and the only one that touches the link.

    `fetch(offset)` yields chunks. The `.part` suffix is load-bearing: a crash here (crash point 3)
    must leave something that is obviously NOT a recording, so no reader can adopt it. Nothing
    outside the `.part` is written.

    ⚠️ A short read is `TRUNCATED_TRANSFER`, which is neither a timeout nor corruption (brief §6).
    The ring simply stopped sending — the single most likely mid-transfer outcome when the wearer
    walks away — and it has its own retry policy, so collapsing it into TRANSPORT_FAILURE would
    discard the distinction the taxonomy exists to keep."""
    # ⚠️ THE SUFFIX IS ENFORCED HERE, not left to the caller. Crash points 3 and 4 require that a
    # kill mid-transfer leaves something no reader can adopt, and "the caller passes a .part path"
    # is a convention, not a guarantee — a single wrong argument would silently write a half file
    # under the name of a real recording. Refusing is the only version of that invariant the module
    # can actually hold.
    if not part_path.endswith(".part"):
        raise ValueError(f"download target must end in .part, got {part_path!r}")
    mode = "r+b" if selection.resume and selection.resume.mode == RESUME else "wb"
    written = 0
    try:
        with open(part_path, mode) as fh:
            if selection.resume and selection.resume.mode == RESUME:
                fh.seek(selection.resume.offset)
                # ⚠️ TRUNCATE, do not merely seek. `r+b` overwrites in place and leaves anything
                # past the new end intact, so resuming over a LONGER stale `.part` splices old tail
                # bytes onto new ones — a file that is plausible, wrongly sized, and silently
                # corrupt. Measured before this line existed: offset 2 over b"ABXYZW" writing b"cd"
                # produced b"ABcdZW" while `bytes_written` reported 4. This is the exact failure
                # §5 cites as the reason re-serve is the default, so the resume path must not carry
                # it into the day that flag is flipped.
                fh.truncate(selection.resume.offset)
                written = selection.resume.offset
            for chunk in fetch(selection.resume.offset if selection.resume else 0):
                fh.write(chunk)
                written += len(chunk)
            fh.flush()
            # Crash point 4 lives immediately after this fsync: the bytes are durable and the file
            # still is not adopted. That ordering is what makes the window survivable.
            os.fsync(fh.fileno())
    except OSError as exc:
        return DownloadResult(written, False, FailureClass.STORAGE_FAILURE, f"write failed: {exc}")
    except Exception as exc:  # transport objects raise their own types; the class is what matters
        return DownloadResult(written, False, FailureClass.TRANSPORT_FAILURE, f"transport failed: {exc}")

    if reported_size is not None and written < reported_size:
        return DownloadResult(
            written, False, FailureClass.TRUNCATED_TRANSFER, f"short: {written} B of {reported_size} B"
        )
    return DownloadResult(written, True, None, f"{written} B received")


def verify(part_path: str, reported_size: int | None, parse_trailer) -> VerifyResult:
    """`.part` → validated or rejected. **Reads only** — crash point 5 requires that a crash during
    verification cannot have written anything outside the `.part`, and the cheapest way to guarantee
    that is a function with no writes at all.

    Layer order is the contract (brief §4), cheapest first, and each layer's failure is reported as
    itself rather than as a generic rejection:
      1. size — a short file stops here and never reaches the parser.
      2. finalisation — the Format-A trailer. **Size equality is not completeness**: the ring reports
         full size BEFORE the trailer flushes, so a file can be exactly the right length and still
         be missing the only thing that proves it finished.
      3. record-boundary walk — a Format-A header, a whole number of 3-byte records between header and
         trailer, and that record count matching the trailer's declared `total_seconds`. This is the
         layer that catches a shifted record grid a right-sized, finalised file can still hide."""
    try:
        with open(part_path, "rb") as fh:
            data = fh.read()
    except OSError as exc:
        return VerifyResult(False, VALIDATION_DEPTH, f"unreadable: {exc}", 0, None)

    size = len(data)
    if reported_size is not None and size != reported_size:
        return VerifyResult(False, VALIDATION_DEPTH, f"size {size} B != reported {reported_size} B", size, None)
    trailer = parse_trailer(data)
    if trailer is None:
        return VerifyResult(False, VALIDATION_DEPTH, "not finalised — no valid Format-A trailer", size, None)
    # Layer 3 — the record-boundary walk. Size and a valid trailer do NOT prove the bytes BETWEEN them
    # are a whole recording: the ring reports size before the trailer flushes, and a dropped or
    # duplicated chunk shifts the 3-byte record grid while leaving both the length and the trailer
    # intact. Three invariants, each measured against real .dat files (§geometry above):
    if data[: len(_FMT_A_HEADER)] != _FMT_A_HEADER:
        return VerifyResult(False, VALIDATION_DEPTH, "record boundary: not a Format-A header", size, None)
    body = size - len(_FMT_A_HEADER) - _TRAILER_LEN
    # A negative body needs no separate guard: parse_trailer already required >= 48 B, and every
    # size < 58 leaves `body` non-divisible-by-3 or yields a negative record count that fails the
    # total_seconds match below — so an adversarial header/trailer overlap still reds, without an
    # uncoverable branch. (Python floors: -50 % 3 == 1; -3 // 3 == -1.)
    if body % _RECORD_LEN != 0:
        return VerifyResult(
            False,
            VALIDATION_DEPTH,
            f"record boundary: {body} B between header and trailer is not a whole number of {_RECORD_LEN}-B records",
            size,
            None,
        )
    n_records = body // _RECORD_LEN
    if n_records != trailer.get("total_seconds"):
        return VerifyResult(
            False,
            VALIDATION_DEPTH,
            f"record boundary: {n_records} records != trailer total_seconds {trailer.get('total_seconds')}",
            size,
            None,
        )
    return VerifyResult(
        True, VALIDATION_DEPTH, f"size+finalised+records: {n_records} records at {size} B", size, inv.sha256_bytes(data)
    )


def commit(part_path: str, final_path: str) -> str:
    """Atomic rename into the night tree — the ONLY irreversible step.

    `os.replace` is atomic within a filesystem, which is what crash point 7 requires: either the old
    name or the new name exists, never neither. The directory fsync afterwards is what makes that
    survive a power loss rather than merely a process kill — without it the rename can be durable in
    the page cache and absent on disk.

    ⚠️ RENAME FIRST, LEDGER SECOND (brief §3, crash point 8). This deliberately opens a window where
    disk is ahead of the ledger, which G3 classifies as `repull` — one redundant fetch, never a loss.
    The inverse order costs exactly the same one fetch but leaves a ledger claiming a file that does
    not exist, and a committed file with a stale ledger is recoverable by inspection while the
    reverse is not."""
    os.replace(part_path, final_path)
    dirfd = os.open(os.path.dirname(os.path.abspath(final_path)), os.O_RDONLY)
    try:
        os.fsync(dirfd)
    finally:
        os.close(dirfd)
    return final_path
