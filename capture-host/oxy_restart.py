# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# oxy_restart.py — RESTART-SAFE ACQUISITION STATE (charter G3).
#
# On start, the daemon knows nothing. This turns "what is on disk" plus "what the ledger says" into a
# work plan, and the whole design follows from one charter sentence:
#
#     "an interrupted transfer is re-queued or explicitly restarted, NEVER SILENTLY TRUSTED.
#      RAM state is derivable, never authoritative."
#
# ── WHY A RESTART IS THE DANGEROUS MOMENT ─────────────────────────────────────────────────────────
# A kill between download and commit leaves bytes that LOOK finished: right name, plausible size,
# no process holding them. Every cheap check says "we have it". The ledger is the only thing that
# knows a commit never happened, which is why `reconcile()` is consumed here rather than re-deriving
# state from the filesystem — the filesystem cannot distinguish "complete" from "abandoned".
#
# 🔴 EVERY UNCERTAIN STATE BECOMES WORK. There is no branch here that turns doubt into trust. A
# recording is left alone ONLY when the ledger says COMMITTED and the bytes on disk still match the
# size that was committed. Anything else — partial, verified-but-uncommitted, size drifted, unknown
# bytes, a stray `.part` — is re-queued or quarantined. Re-pulling a recording we already had costs
# one BLE transfer (median 78 KB, charter G5); trusting one we did not costs the night.
#
# ── R3/R6 ─────────────────────────────────────────────────────────────────────────────────────────
# No SQLite: the ledger is `oxy_inventory`'s append-only JSONL. No capture.py / pull_session.py /
# writers.py touch — this is the planner, G1 owns the transfer that acts on it.
from __future__ import annotations

import oxy_inventory as inv

# What the planner can decide. One recording lands in exactly one of these.
INTACT = "intact"          # COMMITTED and the bytes still match — the only "do nothing"
COMMIT = "commit"          # VERIFIED but never COMMITTED — the kill-between-download-and-commit case
REPULL = "repull"          # partial, unknown, or missing — fetch it again
QUARANTINE = "quarantine"  # bytes changed under a COMMITTED/VERIFIED row — a human decides


def plan(ledger_rows: list[dict], disk_listing: dict[str, int], part_files: "dict[str, int] | None" = None) -> dict:
    """The startup work plan. PURE — no I/O, no clock, no filesystem.

    `disk_listing` maps identity → size for finished files; `part_files` maps identity → size for any
    `.part` transfer files left behind. Returns lists keyed by the four actions above, plus `reasons`
    so an operator can see WHY each one was classified — a plan whose reasoning is invisible gets
    overridden by whoever reads it.

    `reconcile()` does the ledger↔disk half (charter: G3 consumes it, and re-deriving that logic here
    would be a second copy free to disagree). This adds what reconcile cannot see: the difference
    between VERIFIED and COMMITTED, and the `.part` files of a transfer that never finished."""
    part_files = part_files or {}
    rec = inv.reconcile(ledger_rows, disk_listing)
    cur = inv.current(ledger_rows)

    out: dict[str, list[str]] = {INTACT: [], COMMIT: [], REPULL: [], QUARANTINE: []}
    reasons: dict[str, str] = {}

    def put(action: str, ident: str, why: str) -> None:
        out[action].append(ident)
        reasons[ident] = why

    for ident in rec["verified"]:
        # `reconcile` calls a row VERIFIED-or-COMMITTED with a matching size "verified". Only the
        # second is finished. The first is precisely the kill-between-download-and-commit case: the
        # bytes are validated, the commit never ran, and NOTHING on disk records that difference.
        state = (cur.get(ident) or {}).get("state")
        if state == inv.COMMITTED:
            put(INTACT, ident, "committed, size unchanged")
        else:
            put(COMMIT, ident, "verified but never committed — the commit step did not run")

    for ident in rec["repull"]:
        known = ident in cur
        put(REPULL, ident, "partial or discovered — transfer incomplete" if known
            else "bytes on disk with no ledger row — never validated by anything")

    for ident in rec["missing"]:
        put(REPULL, ident, "ledger knows it, disk does not — moved tree or lost file")

    for ident in rec["size_drift"]:
        # NOT re-pulled and NOT trusted. A recording that changed after being verified is a fact
        # someone must look at: re-pulling would destroy the evidence, trusting it would launder it.
        put(QUARANTINE, ident, "size changed under a verified row — neither trusted nor overwritten")

    # ⚠️ A `.part` IS NEVER ADOPTED, whatever its size. It is by definition a transfer that did not
    # finish, so its bytes have passed no trailer check; "it looks the right size" is the reasoning
    # `oxy_inventory.classify` exists to refuse. Every one is re-pulled, and the stale file is the
    # caller's to discard — recorded here so the plan says so rather than leaving it implied.
    for ident in part_files:
        # 🔴 BRANCH ON THE ACTION, NOT ON THE REASON TEXT. This read
        # `reasons[ident].startswith("committed")` — a human-readable string used as control flow, so
        # re-wording a message silently changed behaviour and any consumer of `reasons` became a
        # consumer of an undeclared contract. `out[INTACT]` is exactly equivalent (the committed
        # branch is the only writer of INTACT) and cannot be broken by editing prose.
        #
        # It also settles what the reason strings ARE: with nothing matching on them they are prose,
        # which is what lets the mutation gate's log-prose exclusion apply honestly. While this line
        # existed, an upper/lower-cased reason was a REAL defect wearing a string-literal costume —
        # excluding it as prose would have been excluding a live break.
        if ident in out[INTACT]:
            # A committed recording with a leftover `.part` beside it: the file is fine, the debris
            # is not. Keep INTACT and let the caller sweep — re-pulling a good recording to tidy up
            # would be the more destructive of the two options.
            continue
        if ident not in out[REPULL]:
            for a in (INTACT, COMMIT, QUARANTINE):
                if ident in out[a]:
                    out[a].remove(ident)
            put(REPULL, ident, "unfinished .part left by an interrupted transfer — never adopted")
        else:
            reasons[ident] += "; unfinished .part present"

    return {
        INTACT: sorted(out[INTACT]),
        COMMIT: sorted(out[COMMIT]),
        REPULL: sorted(out[REPULL]),
        QUARANTINE: sorted(out[QUARANTINE]),
        "reasons": reasons,
        "stale_parts": sorted(part_files),
    }


def is_trusted(planned: dict, ident: str) -> bool:
    """Does the plan say this recording needs nothing? The ONLY affirmative answer in the module, and
    it is deliberately one line so the whole trust surface can be read at once."""
    return ident in planned[INTACT]
