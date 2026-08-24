# tepna-capture — cpap_spool.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# P4: the TRANSACTIONAL stored-spool synchronization chain (CPAP-ACQ-P4-SPOOL-TRANSACTION brief,
# audit gap G1 — `as11_pull.pull_spool` was a tested protocol function wired into nothing).
#
# The recovery model is HARDWARE-FIXED (audit §7, live AirSense-11): `fromDateTime` is the only
# cursor (spoolId is per-round/ephemeral), a round is the transaction unit, and after any drop the
# device RE-SERVES the same cursor byte-identically — so recovery is discard-partial + re-pull, with
# no offset/resume machinery. ERROR_DATA_UNAVAILABLE is the error terminal (non-recoverable, C5).
#
# THE STORE IS THE CONSUMER CONTRACT (co-signed with the feature arm 2026-08-23, brief §3a):
#   <root>/committed/<compact cursor>-<sha12>.bin   raw round bytes, EXACTLY as the AS11 served them
#                                                   (content-addressed name; immutable post-commit)
#   <root>/incomplete/*.part                        never visible to a consumer by construction
#   <root>/cpap_spool_ledger.jsonl                  append-only; one line per COMMITTED round; the
#                                                   READ INDEX consumers iterate (never listing dirs)
# Consumers are READ-ONLY. Cursors in the ledger are the DEVICE stamp AS-SERVED, verbatim (trailing
# Z included) — the Clock-Contract localisation to box civil time is the CONSUMER's step (the same
# resolution the live EdfSink applies, so live and spool EDFs stamp identically). This module stores
# raw bytes and decodes NOTHING: sample intervals, channels and timestamps inside a round are the
# decode step's business, downstream, where observed-vs-assumed is already policed.
#
# Cursor-commit semantics (the load-bearing rule, brief §3):
#   - a round COMMITS (promote + ledger line) only on a terminal status: NO_MORE_DATA, or a
#     fully-consumed MORE_DATA_PENDING (cursor advances to nextSpoolAddress.fromDateTime);
#   - the line's `committed_cursor` is the fromDateTime to pull NEXT — never the round's own input —
#     so the last ledger line always names exactly where an interrupted sync resumes;
#   - a round that reached no terminal leaves its `.part` and writes NO line; the next run re-pulls
#     the same (uncommitted) cursor and, by the re-serve pin, gets the same bytes (C1).
#
# Idempotency is CONTENT-ADDRESSED, and the promote→ledger ORDER is load-bearing (C3): a crash
# between promote and append leaves a committed file with no line; the re-pull re-serves identical
# bytes, resolves to the SAME name, adopts it (sha-verified — a mismatch REFUSES rather than
# overwrites), and appends the missing line. Duplicate (cursor_in, sha256) lines are deduped, which
# also makes the steady-state NO_MORE re-poll a no-op instead of a slow leak.
#
# Between-rounds drop (brief §6, capture still owed): predicted CLEAN — the committed cursor is
# exactly the next round's input and the re-serve pin applies to any fromDateTime. The prediction is
# carried behind ONE injectable seam (`revalidate`): if tomorrow's capture refutes it, the guard
# (re-issue GetDateTime + probe-pull before trusting a cross-reconnect cursor) lands there, a
# localized change, not a rework.

from __future__ import annotations

import hashlib
import json
import os
import time
from datetime import datetime, timezone

from cpap_acq import FailureClass

COMMITTED_DIR = "committed"
INCOMPLETE_DIR = "incomplete"
LEDGER_NAME = "cpap_spool_ledger.jsonl"

# Statuses a committed ledger line may carry — mirrors as11_pull._ROUND_DONE's two terminals.
STATUS_MORE = "MORE_DATA_PENDING"
STATUS_DONE = "NO_MORE_DATA"


class SpoolConflictError(RuntimeError):
    """The committed store already holds DIFFERENT bytes where this round wants to land.

    Never overwrite: the existing file is evidence (audit §12 — a same-identity/different-bytes
    encounter is a verification conflict to surface, not repair)."""


class SpoolValidationError(RuntimeError):
    """The reassembled round failed length/sha validation — it does not promote (C2)."""


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def compact_cursor(cursor: str) -> str:
    """Filename-safe form of a verbatim device cursor: strip `-`/`:` only.

    `2026-08-14T16:00:00Z` → `20260814T160000Z`. The VERBATIM cursor (Z included) goes in the
    ledger; this compaction exists only so the filename survives every filesystem."""
    return cursor.replace("-", "").replace(":", "")


def round_filename(cursor_in: str, sha: str) -> str:
    """Content-addressed committed name: same cursor + same bytes → same name (C3's no-op re-promote);
    same cursor + different bytes → a DIFFERENT name, so an overwrite is impossible by construction."""
    return f"{compact_cursor(cursor_in)}-{sha[:12]}.bin"


def ensure_layout(root: str) -> None:
    os.makedirs(os.path.join(root, COMMITTED_DIR), exist_ok=True)
    os.makedirs(os.path.join(root, INCOMPLETE_DIR), exist_ok=True)


def ledger_path(root: str) -> str:
    return os.path.join(root, LEDGER_NAME)


def read_ledger(root: str) -> list[dict]:
    """All valid ledger rows, in order. A torn trailing line (crash mid-append) is skipped — the
    round it described either promoted (adopted on the next run, line re-appended) or never
    committed; either way the tail carries no authority."""
    path = ledger_path(root)
    if not os.path.exists(path):
        return []
    rows: list[dict] = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except ValueError:
                continue  # torn tail / garbage line — no authority
    return rows


def committed_rows(rows: list[dict]) -> list[dict]:
    """Only rows that carry the commit contract's keys. A VALID-JSON foreign line (a hand-written
    marker, another tool's note) parses but carries no authority — it must never crash the restart
    path or masquerade as a committed round."""
    return [r for r in rows if "committed_cursor" in r and "round_seq" in r]


def last_committed_cursor(root: str) -> str | None:
    """The fromDateTime the NEXT pull starts from — the restart authority (brief §3)."""
    rows = committed_rows(read_ledger(root))
    return rows[-1]["committed_cursor"] if rows else None


def _row_key(row: dict) -> tuple:
    return (row.get("round", {}).get("from"), row.get("round", {}).get("sha256"))


def make_row(*, device: str, session: str, spool_type: str, cursor_in: str,
             committed_cursor: str, round_seq: int, data: bytes, status: str,
             filename: str, wall=None, mono=None) -> dict:
    """One committed-round ledger line (brief §3 schema + the co-signed contract additions).

    Cursors are VERBATIM device stamps — no localisation here (Clock Contract: the consumer owns
    that step). Clocks are injectable for deterministic tests."""
    wall_iso = wall() if wall is not None else datetime.now(timezone.utc).isoformat()
    mono_s = mono() if mono is not None else time.monotonic()
    return {
        "ts": wall_iso,
        "mono": mono_s,
        "device": device,
        "session": session,
        "spool_type": spool_type,
        "committed_cursor": committed_cursor,
        "round_seq": round_seq,
        "file": filename,
        "round": {"from": cursor_in, "bytes": len(data),
                  "sha256": sha256_bytes(data), "status": status},
    }


def append_ledger(root: str, row: dict) -> None:
    """Append one row, byte-stable (sorted keys — two identical rows serialize identically, the §20
    determinism contract), flushed and fsynced so a committed cursor survives power loss."""
    with open(ledger_path(root), "a", encoding="utf-8") as fh:
        fh.write(json.dumps(row, sort_keys=True) + "\n")
        fh.flush()
        os.fsync(fh.fileno())


def write_part(root: str, filename: str, data: bytes) -> str:
    """Stage the reassembled round under incomplete/ — the final name NEVER holds partial content."""
    ensure_layout(root)
    part = os.path.join(root, INCOMPLETE_DIR, filename + ".part")
    with open(part, "wb") as fh:
        fh.write(data)
        fh.flush()
        os.fsync(fh.fileno())
    return part


def promote(root: str, part_path: str, filename: str, *, expected_sha: str,
            expected_len: int) -> str:
    """Validate then atomically promote a staged round (C2/C3/C4).

    Validation RE-READS the staged bytes (a torn or corrupted `.part` fails here and never
    promotes). If the committed name already exists — the C3 crash window, or the steady-state
    re-poll — the existing bytes are sha-verified and ADOPTED; a mismatch is a SpoolConflictError,
    never an overwrite."""
    final = os.path.join(root, COMMITTED_DIR, filename)
    if os.path.exists(final):
        with open(final, "rb") as fh:
            existing = fh.read()
        if sha256_bytes(existing) != expected_sha:
            raise SpoolConflictError(
                f"{filename}: committed bytes differ from this round — refusing to overwrite")
        if os.path.exists(part_path):
            os.remove(part_path)
        return final
    with open(part_path, "rb") as fh:
        staged = fh.read()
    if len(staged) != expected_len or sha256_bytes(staged) != expected_sha:
        raise SpoolValidationError(
            f"{filename}: staged round failed validation "
            f"(len {len(staged)} vs {expected_len}) — not promoting")
    os.replace(part_path, final)
    dir_fd = os.open(os.path.join(root, COMMITTED_DIR), os.O_RDONLY)
    try:
        os.fsync(dir_fd)
    finally:
        os.close(dir_fd)
    return final


async def sync_spool(pull_round, root: str, *, device: str, session: str,
                     spool_type: str = "Summary", epoch_start: str,
                     max_rounds: int = 64, revalidate=None, on_transition=None,
                     wall=None, mono=None) -> dict:
    """Drive one transactional sync pass: rounds from the last committed cursor to a terminal.

    `pull_round(spool_type, from_dt) -> (bytes, more, next_from)` is INJECTED (production binds
    `as11_pull.pull_spool_round` over an established link; tests bind a script) and is expected to
    raise `As11Error` on the device's ERROR_DATA_UNAVAILABLE terminal and ordinary transport
    exceptions on link loss. This module makes exactly ONE pass — retrying a recoverable stop is
    the recovery driver's decision (P5), not a hidden loop here (spec §31).

    `on_transition(step, reason)` is an optional seam the announced daemon wiring binds to the real
    `cpap_acq.AcqLifecycle` (brief §2's state mapping); the module itself stays pure.
    `revalidate(cursor)` is the between-rounds guard seam (brief §6) — absent by default because the
    hardware evidence predicts the committed cursor survives a reconnect; if tomorrow's capture
    refutes that, the guard lands here without touching the loop.
    """
    ensure_layout(root)
    rows = committed_rows(read_ledger(root))
    seen = {_row_key(r) for r in rows}
    round_seq = rows[-1]["round_seq"] + 1 if rows else 0
    cursor = rows[-1]["committed_cursor"] if rows else epoch_start
    summary = {"rounds_committed": 0, "bytes": 0, "cursor": cursor,
               "stopped": None, "failure": None}
    if on_transition is not None:
        on_transition("SYNCING", f"spool sync from {cursor}")
    for _ in range(max_rounds):
        if revalidate is not None:
            revalidate(cursor)
        try:
            body, more, next_from = await pull_round(spool_type, cursor)
        except Exception as exc:  # noqa: BLE001 — classified below, never swallowed
            if type(exc).__name__ == "As11Error":
                # The device's error terminal (C5): non-recoverable — the driver must STOP, not loop.
                summary["stopped"] = "data-unavailable"
                summary["failure"] = FailureClass.PROTOCOL_FAILURE.label
                if on_transition is not None:
                    on_transition("ERROR", f"spool {spool_type}: {exc}")
                return summary
            # Link loss / timeout: recoverable — the partial round (if any) is DISCARDED WHOLESALE
            # (a post-drop buffered tail makes a partial fragment set untrustworthy, audit §7.3) and
            # the SAME uncommitted cursor is re-pulled next pass (the re-serve pin).
            summary["stopped"] = "transport"
            summary["failure"] = FailureClass.TRANSPORT_FAILURE.label
            if on_transition is not None:
                on_transition("RECOVERING", f"spool {spool_type}: {exc}")
            return summary
        sha = sha256_bytes(body)
        status = STATUS_MORE if more else STATUS_DONE
        filename = round_filename(cursor, sha)
        committed_cursor = next_from if more else cursor
        if (cursor, sha) in seen:
            # Steady-state re-poll of a NO_MORE cursor re-serves the committed round: adopt, no
            # duplicate line, clean stop.
            summary["stopped"] = "no-new-data"
            summary["cursor"] = committed_cursor
            break
        part = write_part(root, filename, body)
        promote(root, part, filename, expected_sha=sha, expected_len=len(body))
        row = make_row(device=device, session=session, spool_type=spool_type,
                       cursor_in=cursor, committed_cursor=committed_cursor,
                       round_seq=round_seq, data=body, status=status,
                       filename=filename, wall=wall, mono=mono)
        append_ledger(root, row)
        seen.add((cursor, sha))
        round_seq += 1
        summary["rounds_committed"] += 1
        summary["bytes"] += len(body)
        summary["cursor"] = committed_cursor
        if not more:
            summary["stopped"] = "no-more-data"
            if on_transition is not None:
                on_transition("VERIFIED", f"spool {spool_type}: sync complete at {committed_cursor}")
            break
        cursor = committed_cursor
    else:
        summary["stopped"] = "max-rounds"
    return summary
