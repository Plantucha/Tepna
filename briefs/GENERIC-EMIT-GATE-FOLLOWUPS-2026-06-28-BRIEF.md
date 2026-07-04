<!--
  GENERIC-EMIT-GATE-FOLLOWUPS-2026-06-28-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-28 — §2 (soft-skip → visible RED for emittable `canEmit` types) + §3(a) (CONTRIBUTING: only ✓all-green/0-fails is authoritative, counts are advisory) + §4 (one-canonical-section reconciliation verified: GLUCODEX §1 DONE w/ cross-refs, DOCS-INDEX synced) all landed; test-/doc-layer, **no re-bundle**, Dex-Test-Suite all-green. §3(b) deterministic-summary DEFERRED (optional "pick-one" alt to §3(a), see §3); §1 stays forward-guidance for the CPAPDex leg. Spawned **GENERIC-EMIT-GATE-FOLLOWUPS-II-2026-06-28-BRIEF.md** (residue: §1 Node-CI ratify of the §2 realm-sensitivity · §2 the deferred §3(b) deterministic summary · §3 `_EMITTABLE` source-regex hardening before the CPAPDex `_EMITTABLE` edit) · **Created:** 2026-06-28 · **Follows:** GLUCODEX-FOLLOWUPS-2026-06-27-BRIEF.md §1 (the generic compute()-shape gate — executed/hardened 2026-06-28) · **Relates:** PPGDEX-FOLLOWUPS-2026-06-27-BRIEF.md §10 (the gate's origin), SIGNAL-ADAPTER-PHASE9-REMAINING-NODES-2026-06-25-BRIEF.md (CPAPDex = node 4/4), HOST-EMIT-ALLOWLIST-2026-06-27-BRIEF.md (`SignalOrchestrate.canEmit`)

# Generic adapter→emit→export gate — follow-ups (residue from hardening GLUCODEX-FOLLOWUPS §1)

> **Read `CLAUDE.md` first** (the two gates, the Clock Contract, the re-bundle ritual). This brief is the
> residue that surfaced while executing **GLUCODEX-FOLLOWUPS §1** — landing the emit-allowlist binding on the
> generic gate so the compute()-shape trap cannot recur on **CPAPDex (node 4/4)**. Everything here is
> **test-/harness-layer**; nothing requires a re-bundle and nothing blocks any node DONE stamp.

## 0 · What the §1 execution shipped (context — verify, don't trust)

The generic gate **already existed** (group `'Phase-9 generic adapter → emit → schema-valid export (every
signalType)'` in `tests/dex-tests.js`) — landed in the ECGDex leg, credited `PPGDEX-FOLLOWUPS §10`; the
GLUCODEX §1 "open" status was stale. This pass **hardened** it (no rebuild):
- Refactored the per-signalType body into a memoized `exercise(st)` (build canonical frame → `validateFrame`
  → REAL `SignalOrchestrate.emitNodeExport` → assert schema-valid `ganglior.node-export`).
- **DRIVER 1** (unchanged): every signalType with a REGISTERED ADAPTER must have a provider here.
- **DRIVER 2 (new):** binds coverage to the **EMIT ALLOWLIST** — every `SignalOrchestrate.canEmit()===true`
  type (universe = `SignalSpec.types()` ∪ adapters ∪ providers ∪ the `_EMITTABLE` keys parsed from
  `signal-orchestrate.js` source) must ALSO have a provider + schema-valid export here.
- **Red-fires proof** (predicate replicated on live globals): today RED `[]`; `canEmit('flow')=true` no
  provider → `[flow]`; bespoke `cpap` added straight to the allowlist → `[cpap]`.
- Test-only (`tests/dex-tests.js`), `signal-orchestrate.js` untouched → no re-bundle, no provenance-gate
  impact. Generic group 31/31; whole suite all-green, 0 fails.

---

## 1 · ⚠ HIGHEST (forward → CPAPDex) — the gate now FORCES a provider, but the REAL cost is the FRAME-SHAPE decision  — ✅ N/A THIS PASS (forward-guidance; lands WITH the CPAPDex Phase-9 leg)

The gate guarantees CPAPDex cannot go emittable without a green `adapter → frame → emitNodeExport → schema-valid
export` path in the suite. But **writing that provider is where the genuine design work lands**, and it is NOT
a mechanical add — it is exactly the "highest risk of a shape mismatch" the parent brief flagged:

- **A `SignalFrame` has NO event carrier.** `signal-frame.js` only ever populates `intervals` (kind
  `intervals`) or `samples`+`fs` (kind `samples`), plus `tsMs`/`t0Ms`/`sqi`. `signal-spec.js` declares
  `flow: { kind:'samples', unit:'L/s', frameFields:['samples','fs','t0Ms'] }` → a flow frame can carry the
  **25 Hz BRP flow waveform** and nothing else. But CPAPDex's actual value is **device-scored EVE/CSL events**
  (AHI, OA/CA/H indices, RERA, periodic-breathing) read from the **EDF annotations** — NOT derivable from the
  flow waveform alone (`cpapdex-registry.js` grades them `measured` = the firmware scoring IS the ground truth).
  So a flow-waveform-only frame would **drop CPAPDex's headline measured metrics.**
- **Consequence — a real fork the provider author must resolve, deliberately:**
  - **(a)** Express CPAPDex ingest as a classic `flow` `SignalFrame` (waveform only) and have `compute()`
    re-derive what it can — loses the device-scored events. Almost certainly wrong for this node.
  - **(b)** Extend the frame/emit contract so the EDF-scored events ride to `compute()` (a NEW frame field, or
    a `ctx`-carried event sidecar à la `pairCompanions`/`ctx.companions`), with a `validateFrame` rule for it.
  - **(c)** Accept that CPAPDex's EDF ingest is **bespoke** (not a sample/interval `SignalFrame` at all — it is
    multi-signal + pre-scored) and have its provider build whatever object `emitNodeExport`'s new `cpap`/`flow`
    case actually hands `CPAPDex.compute()`. **DRIVER 2 still forces this**: the moment `canEmit` is flipped,
    a missing/again-shape-wrong provider reds — which is the whole point of the binding.
  Pick one **consciously** and write it in `cpapdex-registry.js`/the export doc so the next coder doesn't
  assume the export is event-bearing when it isn't (the Welltory/GlucoDex honesty-flag lesson, one layer up).

- **Three hand-sync points inside the gate** the provider author must touch together (a miss is caught, but
  know them up front): in `tests/dex-tests.js`'s generic group — (1) `providers.<type>` (build the canonical
  frame); (2) `NODE_OF.<type> = 'CPAPDex'` (so `exercise()` resolves the namespace — a missing entry reds the
  "namespace co-loaded" assertion, not the provider one, which is a confusing failure mode); (3) the
  `SignalOrchestrate` side — a `cpapHost`/`emitCpapNodeExport` + the `emitNodeExport` dispatch case + adding
  the type to `_EMITTABLE` (and moving it OFF the `canEmit(...)===false` list in the 'Host emit allowlist'
  group, which will ALSO red on the flip — by design).
- **Co-load the synthetic frame-source in BOTH runners.** `exercise()` **soft-skips** (passes without running
  the schema-valid assertion) when a provider returns `null` because its generator isn't in `env` (see §2).
  So if CPAPDex's provider depends on a `genSyntheticEDF`/`SYNTH.renderFlow`-style source, that source must be
  co-loaded in `Dex-Test-Suite.html` **and** `tests/run-tests.mjs` — otherwise the provider exists but never
  actually verifies an export in that realm. A render-coverage `renderCoverageCPAPDex` leg already exists in
  `Dex-Test-Suite.html`; align the headless provider with it.

**Do:** when the CPAPDex Phase-9 leg lands, treat "make the generic-gate provider green" as the forcing checklist
for the export-shape decision above — not a box to tick after the fact.

---

## 2 · LOW (harness) — DRIVER-2 soft-skip can pass a provider WITHOUT verifying its export  — ✅ DONE 2026-06-28

> **Executed:** `exercise(st)` in `tests/dex-tests.js` no longer blanket-passes a falsy (un-co-loaded) frame.
> For an **emittable** type (`SO.canEmit(st)===true`) a missing synth frame-source is now a **visible RED**
> ("synth frame-source NOT co-loaded in this realm — the schema-valid export is NOT verified here"); for a
> non-emittable type the soft-skip is preserved, and an older `canEmit`-less `SignalOrchestrate` falls back
> to the old soft-skip (back-compat). Latent today (all 6 emittable providers' sources ARE co-loaded in both
> runners) → no new RED; the teeth bite the *next* node whose generator is missing in a realm. Pairs with §1
> "co-load the synth source in BOTH runners".

`exercise(st)` marks `covered[st]=true` and returns when a provider returns a falsy frame (`generator not in
env — soft skip`). DRIVER 2's existence assertion (`provider present`) then passes, and no schema-valid emit is
checked **in that realm**. This is intentional resilience (a missing synth generator in one runner shouldn't red
the whole gate), but it means the emit-allowlist binding only fully bites where the provider's frame-source is
co-loaded. Today every provider's source IS co-loaded in both runners, so this is latent. **Do (optional):** for
emittable types, downgrade the soft-skip to a **visible WARN/RED** (e.g. assert the frame-source IS present for a
`canEmit` type), so a future node whose synth source is missing in a realm can't quietly skip its own export
verification there. Pairs with §1's "co-load in both runners".

---

## 3 · LOW/MEDIUM (harness-wide) — Dex-Test-Suite pass/group COUNTS are NOT a stable regression baseline  — ✅ DONE 2026-06-28 (option a); option b DEFERRED

> **Executed (a):** `CONTRIBUTING.md` gate #1 now states only `✓ all green` / `0 fails` is authoritative and
> the absolute pass-/group-COUNTS are advisory snapshots (render-coverage legs boot real bundles async →
> timing-dependent counts; observed ~1084→1146 / 68→72 in one session, all green) — don't diff a recorded
> count to detect a regression. **(b) DEFERRED** (the optional "and/or" half): making the summary
> deterministic (`Promise.all` the `APP_COVERAGE` render legs before the final paint) touches the
> `Dex-Test-Suite.html` summary rig for zero behavioral gain today; left for whoever wants count-assertable
> CI. (a) alone satisfies the "pick one".

Observed directly this run: across reloads in one session the summary read **1084/68 → 1103/69 → (≈77 groups) →
1146/72**, every time **✓ all green, 0 fails**. The browser-only **render-coverage** legs boot REAL app bundles
in a hidden iframe and are included/sized by **timing** (watchdog/try-catch per leg), so the absolute pass- and
group-counts drift run-to-run with no code change. Implication: the many execution logs that record an exact
count (`1176/75`, `1100/71`, `1124/72`, …) are recording a **snapshot, not an invariant** — diffing those numbers
to detect a regression will produce false alarms. The reliable signal is the pill (`✓ all green` / `0 fails`),
which is what `CLAUDE.md` already tells you to read. **Do (pick one):** (a) document in `CONTRIBUTING.md` that only
all-green/0-fails is authoritative and counts are advisory; and/or (b) make the summary deterministic — `Promise.all`
the `APP_COVERAGE` render-coverage legs before the final paint (or render "N legs pending/skipped") so a recorded
count is reproducible. (b) also makes the count safe to assert in CI.

---

## 4 · LOW (docs hygiene) — ONE logical gate was tracked under THREE section IDs  — ✅ DONE 2026-06-28 (verified)

> **Verified:** the gate's ONE canonical owner-section is the `tests/dex-tests.js` group
> `'Phase-9 generic adapter → emit → schema-valid export (every signalType)'` (its source comment
> cross-refs PPGDEX-FOLLOWUPS §10 = origin + GLUCODEX-FOLLOWUPS §1 = DRIVER-2 hardening). `GLUCODEX-FOLLOWUPS
> §1` is now `DONE 2026-06-28` with both cross-refs (not re-numbered), and the DOCS-INDEX status table is in
> sync — so the stale-status drift that left §1 "open" while the gate already shipped cannot recur. Forward
> rule recorded: when one deliverable is referenced from N briefs, give it ONE owner-section and have the
> others `See X §N` it rather than re-numbering.

The same generic gate is `GLUCODEX-FOLLOWUPS §1(b)` ≡ `PPGDEX-FOLLOWUPS §10` ≡ referenced again in the ECGDex
leg. That split is exactly why GLUCODEX §1 sat "open" while the gate had already shipped (the stale-status drift
`CLAUDE.md` warns about). Reconciled this pass (GLUCODEX §1 now DONE with cross-refs; DOCS-INDEX synced).
**Do:** when one deliverable is referenced from multiple briefs, give it ONE canonical owner-section and have the
others link it (`See X §N`) rather than re-numbering it — so status flips in one place. No code.

---

### Priority summary
- **⚠ before/with the CPAPDex leg:** §1 (the gate forces a provider — resolve the EDF event-vs-`SignalFrame`
  shape decision deliberately; mind the 3 hand-sync points + co-load the synth source in both runners).
- **LOW / harness hardening:** §2 (soft-skip can skip export verification for an un-co-loaded provider),
  §3 (suite counts are timing-dependent — trust all-green/0-fails, optionally make the summary deterministic).
- **LOW / docs:** §4 (one item, one canonical section — avoid the multi-brief renumber that caused the §1 drift).
