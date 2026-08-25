<!--
  CPAP-ACQ-P2-LIFECYCLE-2026-08-23-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-25 — 2026-08-23 · **Created:** 2026-08-23 · **Executes:** `CPAP-ACQUISITION-HARDENING-AUDIT-2026-08-23-BRIEF.md` P2 (reordered ahead of P1 per §5a) · **Lead:** the acquisition-hardening lead (session codename Mutator, 2026-08-23) · **Affects:** `capture-host/cpap_acq.py` (NEW), `capture-host/tests/test_cpap_acq.py` (NEW)

# CPAP acquisition — P2: the lifecycle state machine, provenance record, and failure taxonomy

Executes P2 of the hardening audit, and the FIRST phase built because the lead reordered it ahead of
P1 (§5a): the feature arm (Vigil box) holds the live-stream ingestion point P1 must tap, so P2 — which
touches nothing they touch — proceeds first.

## What it closes

Audit gaps **G3** (no lifecycle state machine), **G7** (thin BLE provenance), **G10** (flat failure
taxonomy). Today the live path is a binary running/not-running with no recorded transitions; this gives
the acquisition an explicit, auditable lifecycle whose every move is a legal-checked, timestamped
provenance record.

## What it is (and is not)

A **standalone new module**, `cpap_acq.py` — pure logic, no transport, no async, no BUS, no physiology.
It is the vocabulary P1's raw sidecar and P5's recovery driver both consume; wiring it into the daemon
is a later, announced step (it touches neither `cpap_stream.py`'s ingestion function nor `capture.py`,
so it is collision-free with the feature arm).

- **`AcqState`** — the 16-state lifecycle (spec §3): DISCONNECTED…DISCOVERED…CONNECTING…AUTHENTICATED…
  READY…LIVE_CAPTURING / LIVE_INTERRUPTED…SYNC_PENDING…SYNCING…VERIFIED…RECOVERING…SHUTTING_DOWN…ERROR.
- **`LEGAL_TRANSITIONS`** — an explicit frozenset of legal (from, to) edges. A move not in it RAISES
  `InvalidTransition` and does NOT happen (spec §3: invalid transitions must not silently occur — and no
  partial record is appended). Kept as data so the whole legal graph is auditable and testable in one
  place. Recovery re-enters at CONNECTING, never a prior protocol state (spec §6: a reconnect must not
  assume prior state remains valid).
- **`FailureClass`** — the taxonomy (spec §30) with a `recoverable` property. The recovery driver (P5)
  branches on it: a permanent auth/protocol/storage/validation failure must NOT trigger endless
  reconnects (spec §31); a transport/timeout/stall/device-unavailable failure may retry.
- **`Transition`** — an immutable provenance record carrying every field spec §3 requires: prev + new
  state, reason, host monotonic AND wall time (both — monotonic orders across a clock step, wall places
  on the stratum-1 timeline), device identity, acquisition-session identity, and the failure class on an
  error/interrupt edge. `as_row()` emits a `;`-delimited row matching the `writers.LinkLogWriter`
  sidecar idiom (P2 persistence models it; an absent field is BLANK, never a fabricated zero).
- **`AcqLifecycle`** — the tracker: current state + immutable history, `to()`/`can()`/`fail()`, with
  INJECTED clocks so tests are deterministic. `fail()` diverts a recoverable failure DURING live capture
  to LIVE_INTERRUPTED (a transport drop is not a session end — spec §4), everything else to ERROR.

## Aligned to the lead's constraints

- **Additive, no new BUS semantics (§5.1):** transitions are a provenance record; nothing here touches
  the BUS. Persistence (a later increment) uses the journal/sidecar idiom.
- **No SQLite (§5.3):** the record is a `;`-delimited row for an append-only sidecar, not a table.
- **No scheduler (§5.2):** this is a per-acquisition tracker, not a cross-device scheduler.
- **Clean-room (§5.5):** entirely new code, no external anything — attested below.

## Done when

- [x] `cpap_acq.py` implements `AcqState` · `LEGAL_TRANSITIONS` · `FailureClass` · `Transition` ·
      `AcqLifecycle`, pure and clock-injected.
- [x] Invalid transitions raise and do not mutate state/history (spec §3).
- [x] Recovery re-enters CONNECTING; a live recoverable drop → LIVE_INTERRUPTED; a permanent failure →
      ERROR (spec §4, §6, §31).
- [x] Failure taxonomy splits recoverable from permanent, every member classified (spec §30).
- [x] `Transition` carries all spec-§3 fields + a `;`-delimited sidecar row with blank-not-zero absents.
- [x] `tests/test_cpap_acq.py` — 20 tests, `cpap_acq.py` at **100% statement + branch**.
- [x] `capture-host/check.sh` green (ruff · shellcheck · pytest `--cov-fail-under=100`) — *(long
      since: the gate has run green fleet-wide on every capture-host PR after this brief's units.)*
- [x] Follow-up: P1 (raw sidecar tapping the feature arm's ingestion point) opens once that point lands.
      *(P1 opened AND completed — cpap_record.py, #1708; its brief flipped DONE 2026-08-24.)*

## Clean-room attestation

Implementation was developed independently without inspecting, accessing, copying, translating, or
adapting source code from external implementations. `cpap_acq.py` is entirely new code — a state
machine, an enum taxonomy, and a dataclass record — based solely on the existing Tepna repository, the
CPAP acquisition-hardening audit, the daemon's own idioms (`writers.LinkLogWriter` sidecar format,
injected `time.monotonic`), the hardware-observed AS11 recovery model (audit §7), and general software
engineering principles.
