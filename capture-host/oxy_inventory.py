# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# oxy_inventory.py — the OxyII acquisition INVENTORY LEDGER (charter G2).
#
# WHAT IS KNOWN, WHAT IS VERIFIED, WHICH PULL ATTEMPT SUCCEEDED — as an append-only JSONL record
# beside the night files, plus the pure `reconcile()` that G3's restart recovery will consume.
#
# ── Why this exists (OXYII-ACQUISITION-CHARTER §1, row "transactional download / atomic commit") ──
# `pull_session` writes `.dat` directly and decides "already have it" from ONE fact: the device-reported
# size matches the file on disk. That is the whole idempotency story today, and it fails in two ways the
# charter names — a file that was RENAMED or MOVED is re-pulled over a slow BLE link, and a file whose
# bytes arrived but never finalised is trusted because its size is right.
#
# 🔴 SIZE EQUALITY IS NOT COMPLETENESS, AND THIS MODULE'S CENTRAL RULE FOLLOWS FROM IT.
# `oxyii.parse_oxy_trailer`'s own docstring records why: "the ring can report a file's full size via
# cmd=0xF2 BEFORE the trailer flushes, so size-equality is not a reliable 'complete' check; the
# `48 12 5a da` sub-magic at trailer[4:8] is". So a recording reaches VERIFIED only when that trailer
# parses. A right-sized file without it is PARTIAL — known, recorded, and re-pullable — never VERIFIED.
#
# ── Rulings this module is built under ────────────────────────────────────────────────────────────
# R3 · NO SQLITE. Append-only JSONL. A ledger that can be rewritten is a ledger that can lose the row
#      explaining why something was re-pulled; append-only means the history IS the audit.
# R6 · KEEP files are fenced. This module touches nothing else: no capture.py, no pull_session.py, no
#      writers.py. The `_pull_once` ledger-first wiring is G1's row, not this one.
#
# ⚠️ IDENTITY IS NEVER A TIMESTAMP ALONE. A recording is (device id, session stamp) — two rings pulled
# into one tree can carry the same stamp, and a stamp is the ring's RTC, which O2RING-TIME-CAPABILITY
# work measured drifting and resetting on battery events. Size and content hash are VERIFICATION
# fields that change as a transfer progresses; they must not be part of the key or a partial download
# would key differently from its own completion.
from __future__ import annotations

import hashlib
import json
import os
import time

# The four states a recording moves through. Ordered: a later state never silently regresses to an
# earlier one without a row saying so, which is what makes the JSONL an audit rather than a cache.
DISCOVERED = "DISCOVERED"   # the ring listed it; we may have no bytes at all
DOWNLOADING = "DOWNLOADING" # a transfer was in flight when this row was written
PARTIAL = "PARTIAL"         # bytes on disk, but NOT finalised (or short of the reported size)
VERIFYING = "VERIFYING"     # bytes complete on disk, validation in flight
VERIFIED = "VERIFIED"       # bytes on disk, trailer finalised, hash recorded
COMMITTED = "COMMITTED"     # verified AND accepted into the night tree (G1 does the atomic rename)
FAILED = "FAILED"           # a transfer attempt ended badly; `failure` says whether to retry

# ⚠️ DOWNLOADING and VERIFYING are states a CRASH LEAVES BEHIND, never evidence of a live transfer
# (G1 brief §3, crash points 3–5). Nothing in this process can observe another process's in-flight
# work, so a reader that finds one must treat it exactly as PARTIAL. They are distinct from PARTIAL
# only in saying WHERE the crash happened, which is what makes the ten crash points diagnosable.

STATES = (DISCOVERED, DOWNLOADING, PARTIAL, VERIFYING, VERIFIED, COMMITTED, FAILED)
_RANK = {s: i for i, s in enumerate(STATES)}


def identity(device_id: str, session_stamp: str) -> str:
    """The stable key for a recording: device id + session stamp, and NOTHING that changes mid-transfer.

    Returned as a single string so it can key a dict and travel in a JSONL row unambiguously. The
    separator is `/` because neither component may contain one — a device id is a hex/serial token and
    a session stamp is `YYYYMMDDhhmmss` digits."""
    return f"{device_id}/{session_stamp}"


def sha256_bytes(data: bytes) -> str:
    """Content hash of a recording's bytes. Full-file, not sampled: the whole point is to notice a byte
    that changed, and a sampled hash notices only the bytes it sampled."""
    return hashlib.sha256(data).hexdigest()


def classify(data: bytes | None, reported_size: int | None, parse_trailer) -> tuple[str, str]:
    """(state, reason) for a recording, from its bytes and the size the RING reported.

    `parse_trailer` is injected (normally `oxyii.parse_oxy_trailer`) so this stays pure and testable
    without importing the protocol module — and so a caller cannot accidentally validate with something
    weaker.

    THE ORDER OF THESE CHECKS IS THE CONTRACT:
      no bytes            → DISCOVERED  (listed, nothing pulled yet)
      short of reported   → PARTIAL     (transfer incomplete — the cheap, certain case)
      trailer absent      → PARTIAL     (RIGHT SIZE, NOT FINALISED — the case size-equality misses)
      trailer parses      → VERIFIED

    The third branch is the one this module exists for. A caller that stopped at "size matches" would
    call that file complete, which is exactly what `parse_oxy_trailer`'s docstring warns against."""
    if data is None or len(data) == 0:
        return DISCOVERED, "no bytes on disk"
    if reported_size is not None and len(data) < reported_size:
        return PARTIAL, f"short: {len(data)} of {reported_size} reported bytes"
    if parse_trailer(data) is None:
        # Right length (or no reported length to compare) yet no `48 12 5a da` finalisation sub-magic.
        return PARTIAL, "not finalised: no Format-A trailer sub-magic"
    return VERIFIED, "trailer finalised"


def make_row(device_id: str, session_stamp: str, state: str, *, reason: str = "",
             size: int | None = None, reported_size: int | None = None,
             sha256: str | None = None, path: str | None = None,
             attempt: int | None = None, failure: str | None = None,
             at: float | None = None) -> dict:
    """One ledger row. `at` is injectable so tests are deterministic and so no row ever carries a
    fabricated time — a caller that has a real clock passes it, and the default reads the real one."""
    if state not in _RANK:
        raise ValueError(f"unknown state {state!r} — expected one of {', '.join(STATES)}")
    return {
        "id": identity(device_id, session_stamp),
        "device_id": device_id,
        "session": session_stamp,
        "state": state,
        "reason": reason,
        "size": size,
        "reported_size": reported_size,
        "sha256": sha256,
        "path": path,
        "attempt": attempt,
        # The failure CLASS label, not prose. `reason` explains to a human; this is what the retry
        # policy branches on, and `recoverable` is a field of the class rather than an inference
        # from the message — so a permanent failure can never be retried by a string mismatch.
        "failure": failure,
        "at": time.time() if at is None else at,
    }


def append_row(ledger_path: str, row: dict) -> None:
    """Append ONE row. Never rewrites, never truncates — the file is the history.

    Opened in append mode per call rather than held open: the daemon can be killed at any moment, and a
    row that reached the OS is a row that survives. Creates the parent directory if absent so a first
    pull into a fresh night dir does not fail on bookkeeping."""
    # `makedirs(exist_ok=True)` ALONE, with no `isdir` pre-check. The pre-check that was here made
    # three things worse at once: it opened a TOCTOU window (the dir can appear between the check and
    # the call — which is the very race `exist_ok` exists to close), it made `exist_ok` unreachable so
    # nothing could observe whether it was right, and `os.path.dirname(os.path.abspath(...))` is never
    # empty, so its `parent and` arm was dead too. The mutation gate found all four as survivors; the
    # fix is deleting the branch, not asserting around it.
    os.makedirs(os.path.dirname(os.path.abspath(ledger_path)), exist_ok=True)
    with open(ledger_path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(row, sort_keys=True) + "\n")


def load_rows(ledger_path: str) -> list[dict]:
    """Every row, oldest first. A malformed line is SKIPPED, not fatal.

    ⚠️ Tolerant on purpose, and the reason is the append-only design: a kill mid-`write` can leave a
    torn final line, and refusing to read the ledger because of it would turn a recoverable partial
    write into a total loss of history — the opposite of what append-only is for. A torn line is at
    worst one lost record, and the recording it described is still on disk to be re-classified."""
    rows: list[dict] = []
    try:
        with open(ledger_path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except ValueError:
                    continue   # a half-written JSONL line is the normal tail of a log being
                               # appended to right now; the next read gets it once it is complete
                if isinstance(obj, dict) and "id" in obj:
                    rows.append(obj)
    except OSError:
        return []
    return rows


def current(rows: list[dict]) -> dict[str, dict]:
    """Latest row per identity — the ledger's current view.

    LAST ROW WINS, by position, not by `at` or by state rank. Position is the only ordering an
    append-only file actually guarantees: two rows can share an `at` (same-second retry) and a
    deliberate regression (VERIFIED → PARTIAL after a file is found corrupt) MUST be honoured, which
    a max-by-rank would silently discard."""
    out: dict[str, dict] = {}
    for r in rows:
        out[r["id"]] = r
    return out


def undrained(ledger_rows: list[dict], flash_sessions) -> list[str]:
    """Flash sessions with no VERIFIED/COMMITTED row — what a drain still owes. PURE.

    ⚠️ NOT `reconcile()`, and the difference is the axis. `reconcile` answers ledger-vs-DISK ("do the
    bytes we hold still match what we recorded"); this answers ledger-vs-FLASH ("what is still on the
    ring that we have never safely landed"). Same ledger, different other half, and conflating them
    would have a drain skip a session whose bytes never left the ring because a row exists saying we
    once saw it.

    A DISCOVERED or PARTIAL or FAILED row therefore counts as UNDRAINED: those states mean the ring
    listed it or a transfer began, not that anything survived. Only VERIFIED/COMMITTED retire a
    session from the drain, which is the same bar `reconcile` uses for `verified` and for the same
    reason — those are the two states in which bytes are known good."""
    done = {str(r.get("session")) for r in (ledger_rows or [])
            if isinstance(r, dict) and r.get("state") in (VERIFIED, COMMITTED)}
    return sorted({str(x) for x in (flash_sessions or [])} - done)


def reconcile(ledger_rows: list[dict], disk_listing: dict[str, int]) -> dict:
    """Ledger vs what is actually on disk → what G3's restart recovery must do. PURE.

    `disk_listing` maps identity → size in bytes for every recording currently present.

    Four outcomes, and the asymmetry between them is deliberate:
      · `verified`   — ledger says VERIFIED/COMMITTED and the size on disk still matches. Leave alone.
      · `repull`     — ledger says DISCOVERED/PARTIAL, or there is no row at all for something on disk.
      · `missing`    — the ledger knows it, disk does not have it. Re-pullable, and the distinction from
                       `repull` matters because a missing file may mean a moved tree, not a bad transfer.
      · `size_drift` — ledger says VERIFIED but the size on disk CHANGED. Never silently re-trusted and
                       never silently re-pulled: a verified recording that changed underneath us is a
                       fact someone must look at, so it is reported as its own class.

    ⚠️ AN UNKNOWN FILE ON DISK IS `repull`, NOT `verified`. Bytes with no ledger row have never been
    validated by anything — trusting them because they exist is precisely the "size equality means
    complete" assumption this module replaces."""
    cur = current(ledger_rows)
    verified: list[str] = []
    repull: list[str] = []
    missing: list[str] = []
    size_drift: list[str] = []

    for ident, row in cur.items():
        on_disk = disk_listing.get(ident)
        if on_disk is None:
            missing.append(ident)
            continue
        if row.get("state") in (VERIFIED, COMMITTED):
            if row.get("size") is not None and row["size"] != on_disk:
                size_drift.append(ident)
            else:
                verified.append(ident)
        else:
            repull.append(ident)

    for ident in disk_listing:
        if ident not in cur:
            repull.append(ident)

    return {
        "verified": sorted(verified),
        "repull": sorted(repull),
        "missing": sorted(missing),
        "size_drift": sorted(size_drift),
    }
