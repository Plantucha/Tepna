<!--
  HOST-EMIT-ALLOWLIST-2026-06-27-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-27 · **Created:** 2026-06-27 · **Surfaced-by:** ECG-PPG-FOLLOWUPS-HANDOFF-2026-06-27-BRIEF.md §2(b) execution (the "discovered residue")

# Host emit allowlist — let the migrated nodes (cgm/ppg/ecg) emit in the live hosts

> **Read `CLAUDE.md` first** (the two gates, the loose-`<script src>` host model, edit-inputs-then-re-bundle).
> This is a small, self-contained correctness fix in the two consumer **hosts** (Data Unifier · OverDex), not
> in any node. It was surfaced while executing companion-bundle ingest (HANDOFF §2(b)): wiring the ECG/PPG
> companion path end-to-end exposed that the hosts never actually emit ecg/ppg (nor cgm) in the live UI.

## The bug

Both hosts gated their emit UI to a **hardcoded `rr/spo2/hrv` literal**, written before the cgm → ppg → ecg
nodes were migrated onto the `SignalFrame`/`compute()` seam:

- `data-unifier-app.js` — `var canEmit = f && f.usable && res.valid.ok && (f.signalType === 'rr' || f.signalType === 'spo2' || f.signalType === 'hrv');`
- `overdex-app.js` — auto-emit guard `… && (sigType === 'rr' || sigType === 'spo2' || sigType === 'hrv')`

So a dropped CGM / PPG / ECG file **routed + validated + framed** correctly but the host never called
`SignalOrchestrate.emitNodeExport` on it — the live UI silently produced no Ganglior export for three nodes
that fully support one. `signal-orchestrate.emitNodeExport` already dispatches all six signal types
(`rr/spo2/hrv/cgm/ppg/ecg`); only the host gate lagged. Two independent literals = exactly the drift the
fleet's "one source of truth" rule exists to prevent (the next node, EEGDex, would lag a third time).

## The fix (executed 2026-06-27)

ONE shared predicate, both hosts gate on it — a node lights up in a single place:

- **`signal-orchestrate.js`** — new `SignalOrchestrate.canEmit(signalType)` over `_EMITTABLE =
  { rr, spo2, hrv, cgm, ppg, ecg }` (exactly the types `emitNodeExport` dispatches; aux channels
  acc/hr/gyro/magn/ppi and unmigrated eeg/flow are **not** emitters). `canEmit(null/undefined)` → `false`
  (no fabrication).
- **`data-unifier-app.js`** — `canEmit` now `… && !!(window.SignalOrchestrate && window.SignalOrchestrate.canEmit(f.signalType))`.
- **`overdex-app.js`** — auto-emit guard now `… && ORCH.canEmit(sigType)`.

All three are loose `<script src>` (the hosts are NOT bundled, and `signal-orchestrate.js` is co-loaded, not
inlined into a node) → **no re-bundle**, no manifestHash movement, no fixture impact.

## Gate (Dex-Test-Suite group "Host emit allowlist")

Asserts `canEmit` is `true` for all six emittable types, `false` for aux/unmigrated/null, that every
emittable type actually has an `emitNodeExport` dispatch (the predicate can't advertise a broken path), and —
when the host sources are in `env` — that both hosts route through the shared predicate (no surviving
`rr/spo2/hrv` literal to drift). Suite all-green **1176/75**.

## Done when — ✅ all met (2026-06-27)

- [x] Both hosts emit for cgm/ppg/ecg (in addition to rr/spo2/hrv) via ONE shared `SignalOrchestrate.canEmit`.
- [x] No second hardcoded signal-type literal survives in either host (gate-asserted).
- [x] `Dex-Test-Suite.html` all-green incl. the new group; loose-file change → no re-bundle, gates unaffected.

## Residue / forward note

- **Live-drop manual verification still standing debt.** The companion-bundle ingest (HANDOFF §2(b)) + this
  allowlist are both gated headlessly; neither has had a real file dragged onto the live Data Unifier/OverDex
  UI and the resulting export eyeballed. That manual live-drop pass is tracked in the child follow-up briefs
  (ECGDEX-FOLLOWUPS-II / PPGDEX-FOLLOWUPS LOW items) and is not blocked by this change — `canEmit` now lets
  those drops actually produce an export to inspect.
- **EEGDex** (the planned Muse node) only needs adding `eeg` to `_EMITTABLE` once it has a `compute()`/emit
  path — the one place, by design.
