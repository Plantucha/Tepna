<!--
  CPAP-ACQ-P4-SPOOL-TRANSACTION-2026-08-23-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS — 2026-08-23 · **Created:** 2026-08-23 · **Executes:** `CPAP-ACQUISITION-HARDENING-AUDIT-2026-08-23-BRIEF.md` P4 · **Depends:** `CPAP-ACQ-P2-LIFECYCLE-2026-08-23-BRIEF.md` (the state machine this maps onto) · **Lead:** the acquisition-hardening lead (session codename Mutator, 2026-08-23) · **Affects (design brief — no code yet):** a NEW `capture-host/cpap_spool.py`, `capture-host/as11_pull.py` (unchanged — validated by hardware), the `.part`→commit pattern from `cpap_harvest.py`

# CPAP acquisition — P4: the transactional stored-spool synchronization chain

Design brief for the transactional BLE spool path (audit gap **G1** — the spool path is a tested
protocol function wired into nothing). The recovery model is not proposed here; it is **fixed by real
AirSense-11 hardware** (audit §7, evidence on the box at `/srv/tepna/probe/pulls/`). This brief maps
that evidence onto the P2 lifecycle and the WiFi path's proven `.part`→atomic-promote, so P4 is a
wiring + persistence job, not a research job.

## 1 · The pin: the recovery model is hardware-fixed, and the protocol core already implements it

From audit §7 (verified against `as11_pull.pull_spool_round` before recording):

- **`fromDateTime` is the only cursor.** `spoolId` is per-round/ephemeral; the continuation cursor is
  `nextSpoolAddress.<type>.fromDateTime`. The code already re-reads `spoolId` per round and reads that
  cursor — hardware *validates* the core, it does not correct it.
- **Terminal statuses:** seq all `SPOOL_INCOMPLETE` until `SPOOL_COMPLETE_MORE_DATA_PENDING` or
  `…NO_MORE_DATA`; `ERROR_DATA_UNAVAILABLE` is the error terminal.
- **RE-SERVE:** after a drop, StartSpool from the SAME `fromDateTime` re-serves seq0 **byte-identical**.
  The device does not resume from an offset and does not skip.
- **Buffered tail:** a dropped link can still deliver one queued fragment ~230 ms after the disconnect —
  last-SEEN ≠ last-SENT (this is P3's concern; here it means a partial round's fragment set is not
  trustworthy and must be discarded wholesale, never patched).

⟹ **The round is the transaction unit, keyed on its input `fromDateTime`. On any drop, discard the
partial round and re-pull from the last COMMITTED cursor.** No offset/resume machinery — the re-serve
guarantees a clean restart. This is the entire recovery design, and it is proof, not conjecture.

## 2 · The chain, mapped onto the P2 lifecycle

Spec §21's DISCOVER→IDENTIFY→QUEUE→RETRIEVE→REASSEMBLE→VALIDATE→COMMIT maps onto `cpap_acq` states:

| chain step | P2 state | what happens |
|---|---|---|
| DISCOVER + IDENTIFY | READY → SYNC_PENDING | read the last committed cursor from the ledger; if none, a configured far-past `fromDateTime` |
| QUEUE + RETRIEVE | SYNC_PENDING → SYNCING | `as11_pull.pull_spool_round` from the committed cursor |
| REASSEMBLE + VALIDATE | (in SYNCING) | fragments reassembled in `seq` order by the existing core; a round validates on a terminal status |
| COMMIT | SYNCING → VERIFIED | promote the round's `.part`, advance + persist the committed cursor |
| any drop | SYNCING → RECOVERING → CONNECTING | discard the partial `.part`, re-establish, re-pull the SAME (uncommitted) cursor |

A permanent failure (`ERROR_DATA_UNAVAILABLE`, an auth/protocol error on re-establish) → `SYNCING →
ERROR` with the P2 `FailureClass`; the recovery driver (P5) reads `recoverable` and stops rather than
looping.

## 3 · The durable record — an append-only JSONL ledger (no SQLite, §5.3)

`cpap_spool_ledger.jsonl` beside the night's capture dir. One line per committed round, append-only,
so a crash can never corrupt earlier commits (the same durability the WiFi `.part` gives, extended to
the cursor). The ledger is the restart authority (P5): on startup, the last line's `committed_cursor`
is where the next pull resumes.

```
{"ts":"<host wall ISO>","mono":<float>,"device":"<id>","session":"<acq id>",
 "spool_type":"Summary","committed_cursor":"2026-08-14T16:00:00Z",
 "round":{"from":"2026-01-01T00:00:00Z","bytes":7128,"sha256":"<hex>","status":"MORE_DATA_PENDING"}}
```

**Cursor-commit semantics (the load-bearing rule):**
- A round is COMMITTED — its bytes promoted from `.part` and its `committed_cursor` written — only on a
  **terminal** status: `NO_MORE_DATA` (sync done) or a **fully-consumed** `MORE_DATA_PENDING` (advance
  the cursor to its `nextSpoolAddress.fromDateTime`).
- The `committed_cursor` a line carries is the `fromDateTime` to pull NEXT — never the round's own
  input. So the ledger's last line always names exactly where an interrupted sync resumes.
- A round that did NOT reach a terminal status leaves its `.part` and writes NO ledger line; the next
  run re-pulls its (still-uncommitted) input cursor and, by §1's re-serve, gets the same bytes.

### 3a · Consumer contract — LOCKED 2026-08-23 (co-signed with the feature arm)

Agreed verbatim in the lead↔feature-arm exchange (P4 execution moved to the lead by owner order):
**store layout** `committed/<compact cursor>-<sha12>.bin` (raw round bytes, content-addressed,
immutable) + `cpap_spool_ledger.jsonl` as the consumer's READ INDEX (iterate rows, read named
files, never list directories); `.part` staging lives under `incomplete/`, invisible to consumers
by construction. **Reliance semantics:** row ⇒ file exists + sha256-matches + cleanly-terminated;
`committed_cursor` of row N == `round.from` of row N+1 (device-skip gaps surface as breaks);
`round_seq` is the producer's restart authority, `round.from` the consumer's time anchor — both in
every row, plus `spool_type` for stream routing. **Clock Contract:** cursors are the DEVICE stamp
AS-SERVED, verbatim (`Z` included) — localisation to box civil time is the CONSUMER's step, the
same resolution the live EdfSink applies, so live and spool EDFs stamp identically. **Layering:**
the ledger carries transaction metadata only; decoded facts (channels, intervals) live in the raw
bytes and surface at the consumer's decode — whether the fragment self-describes its interval is
resolved empirically at the first committed real round, selecting between the consumer's two
already-built paths (observed-authoritative vs documented-40ms-default+warn).

## 4 · Atomic commit — the WiFi path's proven shape, reused (spec §24, §1f of the audit)

`cpap_harvest.EzShare.fetch` already does exactly this for HTTP; P4 reuses the shape for BLE:

1. Reassembled round bytes → `<round>.part` (never the final name).
2. Validate: byte length matches the reassembled total; `sha256` computed; terminal status reached.
3. `os.replace(part, final)` — atomic promote. A crash before this leaves only the `.part`.
4. Append the ledger line (advancing the cursor) — AFTER the promote, so a crash between 3 and 4 leaves
   a promoted round with no ledger advance, and the next run re-pulls that cursor, re-serves identical
   bytes, and re-promotes idempotently (the promote is content-addressed by `sha256`, so a duplicate
   commit is a no-op, not a corruption).

**Idempotent identity (spec §23):** a stored recording is identified by `device + committed_cursor +
sha256(bytes)`, never `fromDateTime` alone. Seeing the same round twice (a re-pull after a
crash-between-3-and-4) promotes to the same content-addressed name → no duplicate.

## 5 · Planted controls (the tests that make the design a claim, spec §40)

Each is a chaos injection with a pre-stated pass:

- **C1 · kill mid-round** (drop after seq0, before terminal): the `.part` stays, NO ledger line is
  written, and a re-pull from the same cursor yields **byte-identical** bytes → clean promote. (Directly
  exercises §1's re-serve.)
- **C2 · corrupt one byte of a reassembled round** before validate: the length/sha check fails, the
  round does NOT promote, no ledger line, the cursor does not advance. An invalid transfer never becomes
  a trusted recording (invariant §40.2).
- **C3 · crash between promote (step 3) and ledger append (step 4):** restart re-pulls the same cursor,
  re-serves identical bytes, re-promotes to the same content-addressed name (no-op), and writes the
  ledger line. No duplicate recording (invariant §40.11), and the committed data survived.
- **C4 · a verified recording is never overwritten by a partial** (invariant §40.1): a later partial
  round for an already-committed cursor cannot promote over the committed content-addressed file — the
  ledger's committed_cursor has already advanced past it.
- **C5 · `ERROR_DATA_UNAVAILABLE`** → SYNCING→ERROR with a non-recoverable `FailureClass`; the recovery
  driver stops, does not loop (spec §31).

## 6 · Open design input — the between-rounds drop (Vigil box owes the capture)

The one scenario the current evidence does not yet cover: a drop **after** round 1's `fromDateTime` is
committed but **before** StartSpool of round 2. **Predicted answer:** re-pull from the committed cursor
yields round 2 clean (the committed cursor is exactly round 2's input, and §1's re-serve applies to any
`fromDateTime`). **What changes if wrong:** if the device treats a cursor differently across a
reconnect at a round boundary (e.g. an idle-timeout invalidating the last `nextSpoolAddress`), then the
cursor-commit rule in §3 needs a re-validation step — re-issue GetDateTime + a probe pull to confirm
the cursor is still honored before trusting it. The design is written to make that a localized change
(one guard before the round loop), not a rework. Vigil box has the capture routed (lead's #1676
approval); this brief flips to IN-PROGRESS when the evidence lands and confirms or refutes the
prediction.

## 7 · What P4 does NOT do

- No physiological interpretation (that is CPAPDex, downstream).
- No EDF (that is the feature arm's product; the raw round bytes + ledger are the authoritative record,
  §6 of the audit — EDF is derived from them).
- No change to `as11_pull.py` (the hardware validated it; touching it would violate audit §1).
- No daemon wiring in this increment — P4 lands the module + its planted-control tests; the single
  announced `capture.py` touch that schedules the nightly pull rides with the P1/P3 wiring (§5a/§P3).

## Done when

- [ ] `capture-host/cpap_spool.py` — the round-transaction driver over `as11_pull.pull_spool_round`,
      `.part`→content-addressed atomic promote, append-only JSONL cursor ledger. Pure/injected transport,
      100% branch.
- [ ] C1–C5 planted controls pass as tests.
- [ ] The between-rounds capture (§6) resolved — prediction confirmed, or the localized guard added.
- [ ] `capture-host/check.sh` green.
- [ ] Follow-up: the single daemon-wiring touch (nightly pull) rides with P1/P3, announced.
