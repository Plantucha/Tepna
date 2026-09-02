<!--
  CPAP-ACQUISITION-HARDENING-AUDIT-2026-08-23-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED (parked 2026-09-02 — the living CHARTER for the P1–P5 programme; it outlives its phases and cannot be closed by them. P1 (#1679-era `cpap_record.py`) and P2 (`cpap_acq.py`) are DONE, P4 is one hardware capture from done. Two things hold the master checklist open: **P3 has no brief at all** (`briefs/CPAP-ACQ-P3-*` does not exist) while §8 records INV7 as *module built, held* and INV8 as *pending P3 brief*; and **INV8 and INV11 have no artifact** — there is no `continuity_status` field anywhere in `capture-host/`, and no owner/lock for INV11's one-acquisition-owner-at-a-time rule, which §8 itself marks *pending wiring*. Ten of twelve invariants are code-backed and cited. **Owner:** lead (spawn P3) · **Next step:** the P3 executable brief — INV8 and INV11 both hang off it) · **Created:** 2026-08-23

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
`cpap_stream.gate(status_devices)` refuses to start a 2.4 GHz BLE stream while any sensor is **on a
body** — because the CPAP transmitter sits beside the sensors it would interfere with. **Confirmed:
CPAP AS11 DOES share the BLE radio** (`capture._cpap_ble_connect` opens `bleak` on an `hci` adapter).
Per the acquisition-hardening lead (session codename Mutator, 2026-08-23, §5.2), the correct move is to
**isolate behind this existing gate, not build a global scheduler** — the seam is already the right
shape.

> ⚠️ **Corrected 2026-08-23 (post-#1674):** the original audit described `gate(meta)` reading
> `bus.meta()` and blocking on any *active stream*. A concurrent feature-arm change (Vigil box)
> refactored it to `gate(status_devices)`, single-sourced on `telemetry.on_body`, blocking on
> `on_body is not False` (on-body OR unknown) rather than active-delivery — a docked/charging sensor is
> no longer a false blocker (the 2026-07-26 docked-sensors bug `cpap_harvest.blocking_devices`
> records). The **substance of the finding is unchanged and if anything strengthened**: the gate exists,
> is isolated to one function, and is the right coexistence seam; the mechanism is now cleaner. Recorded
> because the audit must describe the current code, not the code at audit time.

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

## 4 · Sequencing (lead-approved 2026-08-23, with amendments)

Following the spec's phase order, filtered by §2's gaps, under the lead's constraints (§5). **P2 was
reordered AHEAD of P1** (§5a) because the feature arm holds the live-stream ingestion point P1 taps.

- **P2 (FIRST) · Explicit BLE lifecycle + provenance events + failure taxonomy (G3, G7, G10).** A
  **standalone new module** (state machine + provenance event types + failure classes) with its own
  tests — touches neither the ingestion function nor `capture.py`, so it is collision-free with the
  feature arm's in-flight EDF wiring. Transitions logged to the existing journal/STATUS surfaces (§5.1
  — additive, no new BUS semantics). Failure taxonomy lives here because recovery (P5) needs it.
- **P1 (HELD) · Independent raw preservation for the live stream (G2).** A raw sidecar writer that
  **taps the feature arm's single ingestion point** once it lands (not co-editing `stream_to_bus`),
  reusing the daemon's append-only writer idiom (`writers.py` family) — **not** a new format, **not**
  SQLite. The BUS stays pure distribution; the sidecar is the authoritative acquisition record. EDF is
  the *product*, the sidecar is the *record* (§6). Held until the ingestion point exists.
- **P3 · Gap accounting + bounded queue (G4, G5).** Count foreign/dropped/stalled frames; a bounded
  queue with depth telemetry between callback and sink; overflow recorded, never silent. Note the
  hardware finding that a **buffered fragment can arrive ~230 ms after a link drop** (§7.3) — the drop
  boundary is fuzzy; last-seen ≠ last-sent.
- **P4 · Wire + harden the BLE spool path (G1) with the WiFi-path patterns (§1f) — recovery model now
  HARDWARE-PINNED (§7).** DISCOVER→…→COMMIT, `.part`→atomic-promote. The recovery model is settled by
  real-device evidence: **`fromDateTime` is the only cursor; a round is the transaction unit; on any
  drop, discard the partial round and re-pull from the last committed `fromDateTime`** — the device
  re-serves from start byte-identically, so no offset/resume machinery. Idempotent identity uses device
  + recording cursor + size/hash, never timestamp alone. Reuse `cpap_harvest`'s proven `.part` shape.
- **P5 · Reconnect/recovery + restart state (G6, G9).** Bounded retry/backoff, LIVE_INTERRUPTED path,
  restart-safe record of what was verified — as an **append-only ledger/JSONL sidecar** (§5.3: no
  shared SQLite, no forked DEVICE/CLOCK_MEASUREMENT tables).
- **P6 · Clock-offset capture (G8).** Call `get_date_time` at session establish + periodically; record
  device/host/offset over time in a **CPAP-OWN sidecar in the journal idiom** (§5b amendment — NOT the
  ring-clock sidecar or PMDARRIVAL, which are device-specific; `clock_offset.py` only if it genuinely
  fits). Never a second source of truth.
- **P7 · Replay + chaos tests (spec §39) against the real committed CPAP captures** + the recorded
  hardware evidence (§7).
- **P8 · Hardware validation — an overnight real-device capture (spec §42).**

Each phase is one work-unit, one PR, gated by `capture-host/check.sh` (100% branch coverage — any new
module must clear it) — and announced before touching `capture.py`/`writers.py` (§5.4). **Every phase
brief expands "Mutator" on first use** as *"the acquisition-hardening lead (session codename Mutator,
2026-08-23)"* (§5c amendment).

### §5a–c · The lead's three amendments (accepted 2026-08-23)

- **§5a — P2 reordered ahead of P1.** The feature arm (Vigil box) is wiring the live-stream ingestion
  point + EDF; the lead's ruling is that ingestion must be a **single tappable point** (bus.push + raw
  sidecar + EDF builder all fan out from one place). P1's sidecar taps it rather than co-editing the
  same function, so P1 holds until that scaffolding lands; P2 (collision-free) proceeds first.
- **§5b — P6 gets a CPAP-OWN clock sidecar,** not the device-specific ring/PMDARRIVAL surfaces
  (corrects §4-P6's original over-loose wording).
- **§5c — expand "Mutator" on first use** in every phase brief.

## 6 · The two arms — feature vs hardening (recorded so the split is not re-litigated)

The owner is running **two arms on CPAP under one lead** (the acquisition-hardening lead, session
codename Mutator, 2026-08-23):

| | **Feature arm** (Vigil box) | **Hardening arm** (this brief) |
|---|---|---|
| owns | EDF-on-disk product, monitor UI, pairing, the single tappable ingestion point | raw preservation, lifecycle, gap accounting, transactional spool, restart safety |
| product vs record | **EDF is the PRODUCT** | the raw sidecar is the **authoritative acquisition record** |
| files | `cpap_stream.py` ingestion, `capture.py` wiring, a new EDF writer | new lifecycle/sidecar/spool modules that *tap* the ingestion point |

Both arms are bound by the same §5 constraints; the feature arm is pointed at §5 and announce-before-
touch counts for `capture.py` for both. The daemon nightly BLE pull (P4's transactional chain) is
**this arm's**, confirmed — the feature arm was told not to build it.

## 7 · P4 hardware evidence — AS11 spool recovery (Vigil box, live AirSense 11, 2026-08-23)

Real-device runs on the box (`/srv/tepna/probe/pulls/spool-evidence.jsonl` clean;
`spool-drop-evidence.jsonl` drop+re-serve), READ-ONLY on the free radio, wearables untouched. **Two
findings verified against the protocol core before recording** (cross-session claims pass no gate):

- **§7.1 · `spoolId` is per-round/ephemeral; the continuation cursor is `nextSpoolAddress.<type>.
  fromDateTime`.** Clean pull: round1 spoolId=6 → seq0 SPOOL_INCOMPLETE → seq1
  SPOOL_COMPLETE_MORE_DATA_PENDING with `fromDateTime=2026-08-14T16:00:00Z`; round2 spoolId=7 from that
  cursor → SPOOL_COMPLETE_NO_MORE_DATA. ✅ **The code already implements this** —
  `as11_pull.pull_spool_round` re-reads `spoolId` per round and reads
  `nextSpoolAddress[spool_type]["fromDateTime"]` as the cursor. Hardware *validates* the core.
- **§7.2 · Terminal statuses** — seq all SPOOL_INCOMPLETE until MORE_DATA_PENDING or NO_MORE_DATA;
  ERROR_DATA_UNAVAILABLE is the error terminal. ✅ Matches `_ROUND_DONE` + the raise.
- **§7.3 · A mid-transfer drop delivers a buffered tail** — one queued fragment arrived ~230 ms after
  the disconnect before the link died. Last-SEEN ≠ last-SENT; the drop boundary is fuzzy (feeds P3).
- **§7.4 · RE-SERVE (the key P4 fact):** after a drop, reconnect + re-establish + StartSpool from the
  SAME `fromDateTime` → seq0 **byte-identical** to the pre-drop seq0. The device re-serves from start;
  no offset resume, no skip.

⟹ **P4 recovery model, empirically fixed:** `fromDateTime` is the only cursor; the round is the
transaction unit; on any drop, discard the partial round and re-pull from the last *committed* cursor.
This maps onto `.part`→atomic-promote: promote a round on NO_MORE_DATA or a fully-consumed
MORE_DATA_PENDING (advancing the committed cursor); a crash mid-round leaves the `.part`, the next run
re-pulls that cursor from scratch → same bytes → clean promote. **Idempotent by construction.** One
further capture requested (drop *between* rounds — the exact transaction boundary P4 commits on).

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

## 8 · Acceptance criteria — the owner's 12 invariants (§22, verbatim 2026-08-23)

The owner's findings spec (2026-08-23) ratified this chain and named **twelve invariants as the
program's acceptance criteria** — the master checklist every phase is measured against. Verbatim, with
the phase that establishes each and its status:

| # | invariant | phase | status |
|---|---|---|---|
| INV1 | Every stored sample belongs to exactly one acquisition session. | P1 record + P2 session id | pending P1 |
| INV2 | Every acquisition session has an explicit lifecycle. | P2 (`cpap_acq` state machine) | **SHIPPED #1679** |
| INV3 | Raw samples are never silently replaced by derived values. | P1 (raw preserved; no interpretation in acquisition) | pending P1 |
| INV4 | Device timestamps are never silently replaced by host timestamps. | P1 record + Clock Contract | core already honors (`as11_pull.stream` yields device time verbatim) |
| INV5 | Observed sample interval is preferred over requested interval. | P1/P3 (record device-reported interval; prefer observed) | pending P1 |
| INV6 | Partial spool rounds cannot advance the committed cursor. | P4 (brief §3 cursor-commit rule) | **DESIGNED** (P4 §3) |
| INV7 | A transport gap is represented explicitly. | P3 (gap accounting) | **MODULE BUILT** (P3, held) |
| INV8 | Recovery does not imply continuity until continuity is verified. | P3/P5 (continuity-status field) | pending P3 brief |
| INV9 | The live bus is not the sole authoritative copy. | P1 (raw sidecar beside the bus — the centerpiece) | pending P1 |
| INV10 | Unknown state remains unknown. | P2 + Clock Contract (null never fabricated) | **SHIPPED #1679** (no fabricated state; illegal transition raises) |
| INV11 | One CPAP acquisition owner exists at a time. | P2 wiring (feature-arm controller §7 race fix, then serialized wiring) | pending wiring |
| INV12 | A successful shutdown is distinguishable from an abrupt failure. | P2 (SHUTTING_DOWN→DISCONNECTED vs ERROR) | **SHIPPED #1679** |

**Guiding principle (owner, §1/§11):** *the bus must be a VIEW of the acquisition, not the
acquisition* — live and spool CONVERGE on ONE canonical CPAP observation, so the P1 raw record and the
P4 committed store are **projections of one representation**, not two timing/provenance models. INV9 is
the load-bearing one: the durable record, never the bus, is authoritative.

## Done when (this AUDIT brief)

- [x] Existing CPAP architecture documented — two paths, maturity split, strengths named (§1).
- [x] Concrete gaps demonstrated against the tree, not assumed from the spec (§2, G1–G10).
- [x] Clean-room attestation scoped; protocol-core lineage grandfathered (§3).
- [x] Phased sequencing proposed under the lead's constraints (§4–§5).
- [x] Lead reviewed and APPROVED the sequencing (2026-08-23, #1674 comment) with three amendments,
      all folded in: §5a P2-ahead-of-P1, §5b CPAP-own clock sidecar, §5c expand "Mutator" first-use.
- [x] Feature/hardening arm split recorded (§6); `gate()` §1e corrected to the current code (post-#1674).
- [x] P4 recovery model hardware-pinned by a real AirSense-11 run (§7) — and the run *validated* the
      existing `pull_spool` core rather than finding a defect.
- [ ] Each build phase spawns its own executable brief + PR; this brief only orders them (P2 first).
- [x] The owner's §22 twelve invariants recorded as the program's acceptance criteria (§8), each mapped
      to its phase. INV2/INV10/INV12 shipped (#1679), INV6 designed (P4 §3), INV7 module built (P3).
- [ ] **MASTER CHECKLIST — all 12 invariants (§8) satisfied and test-backed** before the program is
      DONE. This brief stays the living charter until then.
