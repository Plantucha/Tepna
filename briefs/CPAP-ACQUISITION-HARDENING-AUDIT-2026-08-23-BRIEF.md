<!--
  CPAP-ACQUISITION-HARDENING-AUDIT-2026-08-23-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-23 · **Follows:** `CPAP-BLE-CAPTURE-2026-08-21-BRIEF.md` (the AS11 link + live stream this hardens), `RESMED-AS11-PROTOCOL-REFERENCE-2026-08-21-BRIEF.md` (the protocol facts), `CPAP-AUTOHARVEST-FOLLOWUPS-II-2026-08-03-BRIEF.md` (the mature WiFi-SD path whose patterns this reuses) · **Lead:** Mutator (multi-device acquisition-hardening; this is the CPAP arm, aligned to Mutator's shared-seam constraints) · **Affects (audit only — no code in this brief):** `capture-host/as11_*.py`, `capture-host/cpap_*.py`

# CPAP acquisition hardening — PHASE 0 audit (the tree is not greenfield)

> **Scope discipline.** This is the audit the owner's hardening spec asks for as PHASE 0, and *only*
> that — no code, no architecture committed. The spec text reads as greenfield; the tree is not, and
> the whole value of this pass is separating **what already exists and works** from **the concrete
> gaps**, so no one rewrites a strength to make it look different. Owner designation: **Mutator is
> lead** on the cross-device effort; every shared-seam decision below defers to Mutator's stated
> constraints (recorded in §5).

## 0 · One-paragraph verdict

CPAP acquisition in Tepna is **two independent paths**, at very different maturity:

1. **WiFi-SD harvest** (`cpap_harvest.py`, 937 lines, ez Share card over HTTP) — **mature**: atomic
   `.part`→`os.replace` commit, short-read detection, idempotent skip-if-present, a completeness test
   against declared length, coexistence gating, WiFi lifecycle, 14 test files. It already satisfies
   most of the spec's stored-data / atomicity / idempotency requirements **for the SD path**.
2. **BLE AS11** (`as11_link.py` · `as11_pull.py` · `as11_cipher.py` · `cpap_stream.py`) — **new and
   partial**: a clean, injectable, independently-tested protocol core (framing, SRP-6a, session,
   RPC, spool round, live stream) with a live-stream lifecycle controller — but **the live path
   preserves nothing but the BUS**, and **the spool path is wired into nothing at all**.

**The protocol core is a strength to protect, not rewrite** (spec §1). The real gaps are all in the
layer *around* the BLE path: independent raw preservation, spool persistence + atomic commit +
idempotency, explicit lifecycle/provenance, gap accounting, restart recovery. That is exactly the
shape Mutator predicted for the sibling O2Ring task — *"layers 2–4 exist; the gap is transactional
stored-sync + restart-safe state."*

## 1 · Existing architecture — what is already good (do NOT rewrite)

### 1a · The AS11 protocol core is clean and layered (spec §1, §2 Layer A/B)
`as11_link.py` is pure wire logic — framing, SRP-6a (RFC 5054 2048-bit), session-key derivation, RPC
builders, spool + stream request builders — **stdlib-only**, no BUS, no physiology, no scheduling. The
one non-stdlib primitive (AES-256-CBC) is **dependency-injected** (`as11_cipher.make_cipher`), so the
gated `capture-host` module gains no crypto dep and the whole path is unit-testable with an identity
cipher over plaintext frames. `as11_pull.py` orchestrates (establish · stream · pull_spool_round ·
pull_spool) over injected `write`/`recv_frame`. **This is the injectable transport model the spec
mandates (§2 Layer B), already in place.** `test_as11_link.py` / `test_as11_pull.py` /
`test_as11_cipher.py` exercise it against a fake device.

### 1b · READ-ONLY by construction (a safety property the spec does not even ask for)
`as11_link.py`'s header records that no therapy- or state-changing RPC is built anywhere — every
builder is a read (session auth, Get, GetDateTime, StartSpool, PullSpoolFragments, StartStream). This
is stronger than the spec's data-integrity clauses and must be preserved: adding a write must stay a
deliberate, reviewed act.

### 1c · Device timestamp is already preserved verbatim (spec §12, invariant §40.5)
`as11_pull.stream` yields `start_time` as **the device clock, verbatim as sent** (ISO-8601), with an
explicit comment that this layer *"never fabricates or corrects a timestamp — the box applies its own
stratum-1 / host-axis stamp downstream."* The Clock-Contract discipline the spec demands (device time
never silently replaced by host time) is **already honored at the capture edge.**

### 1d · Flow and Mask Pressure are already separate streams (spec §9, invariant §40 flow/pressure)
`cpap_stream.BRP_CHANNELS` maps `PatientFlow`→`cpap_flow` and `MaskPressure`→`cpap_pressure` as
**distinct** bus keys with distinct labels/units; `fs` is derived from the sample interval, not
hard-coded. They are never combined. StartStream **verifies the device marked every requested dataId
valid** — a partial accept raises rather than silently streaming a subset.

### 1e · Coexistence gate already exists and is already isolated (spec §20)
`cpap_stream.gate(meta)` refuses to start a 2.4 GHz BLE stream while any wearable is delivering —
because the CPAP transmitter sits beside the sensors it would interfere with. **Confirmed: CPAP AS11
DOES share the BLE radio** (`capture._cpap_ble_connect` opens `bleak` on an `hci` adapter). Per lead
(Mutator §5.2), the correct move is to **isolate behind this existing gate, not build a global
scheduler** — the seam is already the right shape.

### 1f · The WiFi-SD path is the reference implementation for the spec's stored-data clauses
`cpap_harvest.EzShare.fetch` already does what spec §22–§24 ask, for its own transport: `.part` temp →
completeness check against declared `Content-Length` → `os.replace` atomic promote; a short read is
**left as `.part`** (never promoted) so the next run re-fetches; an already-complete `.part` is promoted
via a cheap HEAD rather than re-downloaded. `reap_stale_part` and `should_fetch` give idempotent
skip-if-present. **This is the pattern the BLE spool path must adopt — not reinvent.**

## 2 · Concrete gaps (demonstrated, not assumed)

Each is a real absence in the tree, checked against the files — not a spec box ticked by default.

- **G1 · The BLE spool path is wired into nothing.** `as11_pull.pull_spool` is a tested protocol
  function with **no caller in `capture.py`** (grep: only `_cpap_ble_connect` + the live
  `LiveStreamController` are wired). So the entire spec chain DISCOVER→IDENTIFY→QUEUE→RETRIEVE→
  REASSEMBLE→VALIDATE→COMMIT (§21) does not exist for BLE. This is the single largest gap and the
  natural first build target.
- **G2 · The live stream's only sink is the BUS (spec Layer E violation, §8, §18, invariant §40.7).**
  `cpap_stream.stream_to_bus` pushes each batch to `bus.push` and **preserves nothing independently**.
  A subscriber problem is scientific data loss. There is no raw-preservation path beside the BUS.
- **G3 · No explicit acquisition lifecycle / state machine (spec §3).** `LiveStreamController` has a
  binary running/not-running; there is no DISCONNECTED…LIVE_CAPTURING…SYNCING…VERIFIED model, no
  recorded transitions with reason + monotonic + wall time.
- **G4 · No gap accounting for the BLE path (spec §16).** A dropped BLE notification, a StreamData for
  a foreign `streamId` (silently `continue`d today), a stall — none are counted. DATA_PRESENT vs
  DATA_MISSING vs DATA_INVALID is not represented.
- **G5 · No bounded ingestion queue / backpressure (spec §7, §17, invariant §40.8).** `stream_to_bus`
  awaits `bus.push` inline in the read loop; there is no bounded queue between the notify callback and
  the sink, no queue-depth telemetry, no explicit overflow accounting.
- **G6 · No restart recovery / persistent acquisition state for BLE (spec §25, §26, invariant §40.10).**
  The live path is pure RAM; a crash mid-stream or mid-(future)-spool leaves no durable record of what
  was captured or verified.
- **G7 · Provenance is thin for BLE (spec §28).** The mature WiFi path logs richly; the BLE path emits
  little structured provenance (no CONNECTION_ESTABLISHED / AUTHENTICATION_SUCCEEDED / STREAM_INTERRUPTED
  / CLOCK_MEASURED / DOWNLOAD_VERIFIED event stream).
- **G8 · No device↔host clock-offset capture for CPAP (spec §12–§14).** `get_date_time` (device clock
  read) exists but is **not called** in the live/stream path; the device-vs-box offset the capture is
  designed to enable is never measured or recorded over time.
- **G9 · Reconnect/recovery is absent (spec §6).** `LiveStreamController` cancels on stop; there is no
  bounded-retry, backoff, LIVE_INTERRUPTED→RECONNECT→RESUME path, and no guard against duplicate
  callbacks after a reconnect (invariant §40.3) — because reconnect does not exist yet.
- **G10 · Failure classification is flat (spec §30).** Errors surface as `As11Error` / generic
  exceptions; there is no TRANSPORT/AUTH/PROTOCOL/TIMEOUT/FRAME_CORRUPTION/STREAM_STALL/STORAGE/
  VALIDATION taxonomy driving recovery policy.

## 3 · Clean-room attestation — scoped, with the protocol core GRANDFATHERED

⚠️ **The spec's clean-room clause cannot be signed blanket, and here is why.** `as11_link.py`'s header
already records provenance: it was *"written against the protocol DOCUMENTATION in
m-kozlowski/airbreak-plus docs/as11 … which descends from osresearch/airbreak. Those are prose/table
specifications, not code. This module is NOT derived from any GPL implementation."* That is a
documentation lineage, not a source-code copy — but it is **recorded lineage**, and a blanket "no
external anything was inspected" attestation would be **false**. Per lead (Mutator §5, the same trap
in `oxyii.py`'s header): scope the clean-room attestation to **NEW code written under this hardening
work**, and grandfather the protocol core with its existing documented attribution intact. A false
attestation is worse than none.

## 4 · Proposed sequencing (defers to lead for the shared seams)

Following the spec's phase order, filtered by §2's gaps, under Mutator's constraints (§5):

- **P1 · Independent raw preservation for the live stream (G2).** A raw sidecar writer beside the BUS
  push — reusing the daemon's append-only writer idiom (`writers.py` family), **not** a new format,
  **not** SQLite. The BUS stays a pure distribution layer; the sidecar becomes the authoritative copy.
- **P2 · Explicit BLE lifecycle + provenance events (G3, G7, G10).** Smallest state model that fits;
  transitions logged to the existing journal/STATUS surfaces (Mutator §5.1 — additive, no new BUS
  semantics). Failure taxonomy introduced here because recovery policy (P4) needs it.
- **P3 · Gap accounting + bounded queue (G4, G5).** Count foreign/dropped/stalled frames; a bounded
  queue with depth telemetry between callback and sink; overflow recorded, never silent.
- **P4 · Wire + harden the BLE spool path (G1) with the WiFi-path patterns (§1f).** DISCOVER→…→COMMIT,
  `.part`→atomic-promote, idempotent identity (device + recording id + start + size/hash, never
  timestamp alone), reassembly validation. Reuse `cpap_harvest`'s proven shape.
- **P5 · Reconnect/recovery + restart state (G6, G9).** Bounded retry/backoff, LIVE_INTERRUPTED path,
  restart-safe record of what was verified — as an **append-only ledger/JSONL sidecar** (Mutator §5.3:
  no shared SQLite, no forked DEVICE/CLOCK_MEASUREMENT tables; clock offset has existing homes).
- **P6 · Clock-offset capture (G8).** Call `get_date_time` at session establish + periodically; record
  device/host/offset over time in the **existing** clock-provenance surfaces (ring-clock sidecar #1564
  / `clock_offset.py` / PMDARRIVAL), never a second source of truth.
- **P7 · Replay + chaos tests (spec §39) against the real committed CPAP captures.**
- **P8 · Hardware validation — an overnight real-device capture (spec §42).**

Each phase is one work-unit, one PR, gated by `capture-host/check.sh` (100% branch coverage — any new
module must clear it) — and announced before touching `capture.py`/`writers.py` (Mutator §5.4).

## 5 · Lead's shared-seam constraints (adopted verbatim; source: Mutator, 2026-08-23)

1. **TelemetryBus / BUS: additive only.** No new BUS semantics; lifecycle events land in the existing
   journal/STATUS surfaces, not new BUS channels.
2. **No global scheduler this round.** Isolate each device's coexistence behind existing seams (for
   CPAP: the `cpap_stream.gate()` already confirmed above). Design the boundary cleanly for a future
   unifier; build no unifier now.
3. **No shared SQLite schema.** The daemon idiom is append-only journals / JSONL sidecars, which
   nightqc/provenance already read. Any persistence stays CPAP-private; **do not** create shared
   DEVICE / CLOCK_MEASUREMENT tables — clock-offset history already has homes and a table would be a
   second source of truth.
4. **`capture.py` / `writers.py` are the worst collision surfaces** (5600 / shared). Whoever is
   committed first announces before touching them; the other rebases rather than pre-merging. `tests/`
   conflicts are the norm — restore and re-insert (CLAUDE.md §👥.2c).
5. **Clean-room scoped to NEW code; grandfather the protocol core** with its recorded attribution (§3).

## Done when (this AUDIT brief)

- [x] Existing CPAP architecture documented — two paths, maturity split, strengths named (§1).
- [x] Concrete gaps demonstrated against the tree, not assumed from the spec (§2, G1–G10).
- [x] Clean-room attestation scoped; protocol-core lineage grandfathered (§3).
- [x] Phased sequencing proposed under the lead's constraints (§4–§5).
- [ ] Lead (Mutator) reviews the sequencing and confirms the shared-seam boundary before P1 opens.
- [ ] Each build phase spawns its own executable brief + PR; this brief only orders them.
