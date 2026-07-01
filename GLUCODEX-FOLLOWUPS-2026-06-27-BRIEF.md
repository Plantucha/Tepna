<!--
  GLUCODEX-FOLLOWUPS-2026-06-27-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-30 (node-residue closeout — §3 Integrator GlucoDex end-to-end ingest gate EXECUTED (real committed fixture + clamp down-weight, 11/11) + §7 co-load centralization CONFIRMED done; §5 render-diff DEFERRED (browser-rig-only), §4/§8 standing debt; residue → NODE-RESIDUE-FOLLOWUPS-2026-06-30-BRIEF.md; prior progress: §1 generic compute()-shape gate DONE 2026-06-28 — test-only, Dex-Test-Suite all-green; §2 clamp-saturation honesty flag DONE 2026-06-27 — both gates green; **§6 dawn_surge event-byte coverage DONE 2026-06-30 — test-only (deterministic hand-built CGM frame → dawn_surge byte-shape + reproducibility), all-green**; §3–§5, §7, §8 open) · **Created:** 2026-06-27 · **Follows:** SIGNAL-ADAPTER-PHASE9-REMAINING-NODES-2026-06-25-BRIEF.md (GlucoDex leg, node 1 of 4 — executed/DONE 2026-06-27) · **Sibling-of:** SIGNAL-ADAPTER-FOLLOWUPS-I…-XII

# GlucoDex Phase-9 — follow-ups (what surfaced executing the GlucoDex node migration)

> **Read `CLAUDE.md` first** (the two gates, the Clock Contract, frozen `Ganglior`/`fascia`, edit-inputs-
> then-re-bundle). Then the parent `SIGNAL-ADAPTER-PHASE9-REMAINING-NODES` brief (esp. §1 recipe, §4 the
> recurring error classes). This file is the residue the GlucoDex leg exposed — most of it is **forward
> guidance for the PpgDex → ECGDex → CPAPDex legs** (the same traps WILL bite them), plus a couple of
> genuine GlucoDex correctness/verification items. Nothing here blocks the GlucoDex DONE stamp; all are
> follow-ups.

## 0 · What the GlucoDex leg shipped (context)

`GlucoDex.compute()` now accepts the canonical cgm `SignalFrame` (`samples=[{tMs,v}]` + parallel `tsMs`)
that `signal-orchestrate.emitCgmNodeExport` hands it; `adapters/libre-cgm.js` is now loaded in all 4
host sites + `tsconfig`; `env.GlucoDex` + `env.equiv.glucodex` wired into both runners; a cgm round-trip
(P10) added to `property-metamorphic`; the equivalence gate gained a GlucoDex leg backed by GlucoDex's
first code-gated fixture (`uploads/GlucoDex_2026-06-27_equiv.node-export.json`, real Abbott Lingo CSV →
42 events). `GlucoDex.html` re-bundled (manifestHash `86978e19fc1c`→`d8bf3b24036c`, buildHash
`ebb3b3ab196a` unchanged). Both gates green. See the parent brief's execution log for the full account.

---

## 1 · ✅ DONE 2026-06-28 — generic adapter→emit→export gate (was ⚠ HIGHEST — the compute()-shape recurrence guard)

**EXECUTED 2026-06-28 (test-only, no re-bundle — `Dex-Test-Suite.html` all-green, 0 fails).** Picked option **(b)**,
the ONE generic gate. **Verify-don't-trust finding:** the BASE gate already existed — landed during the ECGDex leg
(credited `PPGDEX-FOLLOWUPS §10`; group **'Phase-9 generic adapter → emit → schema-valid export (every signalType)'**
in `tests/dex-tests.js`), already wired into BOTH runners. This brief's §1 tracking was simply stale. So this pass did
NOT rebuild it — it **HARDENED** it so it genuinely protects CPAPDex *regardless of how that node lands*:
- Refactored the per-signalType body into a memoized `exercise(st)` (build the canonical frame → `validateFrame` →
  REAL `SignalOrchestrate.emitNodeExport` → assert schema-valid `ganglior.node-export`), shared by both drivers.
- **DRIVER 1** (unchanged guarantee): every signalType with a REGISTERED ADAPTER must have a provider here.
- **DRIVER 2 (NEW — the fix):** bind coverage to the **EMIT ALLOWLIST**, not just the adapter registry. Candidate
  universe = `SignalSpec.types()` ∪ registered adapters ∪ the providers ∪ the `_EMITTABLE` keys parsed from
  `signal-orchestrate.js` source; for EVERY type with `SignalOrchestrate.canEmit()===true`, a provider that yields a
  schema-valid export is REQUIRED here. **Why this matters for CPAPDex specifically:** it is the most distinct node
  (EDF/flow, event-not-stream) and can go live by flipping `canEmit` + a SignalSpec entry (`flow` ALREADY exists in
  `signal-spec.js`) — or a bespoke `_EMITTABLE` add — WITHOUT registering a classic sample-stream adapter, which would
  slip DRIVER 1's adapter-only loop. DRIVER 2 reds the instant a node becomes emittable without a gated emit path.
- **Red-fires proof (replicated the predicate on live globals):** today RED=`[]` (no false reds); simulate
  `canEmit('flow')=true` with no provider → RED=`[flow]`; simulate a bespoke `cpap` added straight to the allowlist →
  RED=`[cpap]`. So "cannot recur silently for node 4" now holds for `flow`, a renamed type, OR a fully-bespoke one.
- Pure test-layer (`tests/dex-tests.js` ONLY — `signal-orchestrate.js` UNTOUCHED) → **no re-bundle, no provenance-gate
  impact**; generic group **31/31** (incl. the 6 new emit-allowlist assertions), whole suite all-green.
- **Residue (no follow-up brief — single-section execution):** the brief-tracking inconsistency (GLUCODEX §1 ↔
  ECGDEX/PPGDEX §10 both naming the same gate) is now reconciled here; §§3–§7 of this brief remain open as before.

<details><summary>Original §1 (the forward analysis that scoped this — kept for the rationale)</summary>

**What happened on GlucoDex.** `GlucoDex.compute()` accepted only a `{tMs,vMgdl}` frame or `{text}`. But
the orchestrate emit (`emitCgmNodeExport`) hands `compute()` the **canonical `SignalFrame`** the adapter
produced (`samples=[{tMs,v}]`, `tsMs[]`, `unit`, `t0Ms`) STRAIGHT through — a shape `compute()` did not
recognise, so it **threw on every CGM file routed through the Data Unifier / OverDex.** It was LATENT
(no live UI test) and the Step-G `compute()` functional floor HID it, because that floor drives
`genSynthetic` which returns the `{tMs,vMgdl}` shape — it never builds a samples-frame.

**Why it recurs.** This is structural, not GlucoDex-specific. For EVERY migrated node the contract is:
*adapter → `toSignalFrame(type,…)` → `emit<Signal>NodeExport(frame)` → `Node.compute(frame)`.* So each
node's `compute()` MUST accept the **canonical SignalFrame for its signal type**, not just the node's own
ad-hoc parser output. The per-node `genSynthetic`/`{text}` floor exercises the parser shape, not the
frame shape — so the gap is invisible to the floor by construction (the §4 #2 lesson, now PROVEN a 2nd
time after OxyDex's `upVO2category`).

- **PpgDex** (`PPGDSP`, signal `ppg`/RR-family): confirm `PpgDex.compute()` accepts the canonical frame
  its adapter emits (samples for optical, or intervals for the derived-RR leg). Check the `signal-spec.js`
  PpgDex `frameFields` vs what `compute()` destructures.
- **ECGDex** (`ECGDSP`, signal `ecg`, `kind:'samples'`, carries `fs`): the canonical ecg frame is
  `{samples:Float32Array|number[], fs, t0Ms}` — make sure the headless (non-Worker) `compute()` reads
  `samples`+`fs` off the frame, not a node-private parser struct.
- **CPAPDex** (EDF/flow, the most distinct): likely needs a NEW `SignalSpec` entry + a `validateFrame`
  relaxation; its frame shape is event/flow, not a sample stream — highest risk of a shape mismatch.

**Do (cheapest, highest-leverage — pick ONE):**
- **(a) Per-node, mirror P10:** for each migrated node add a `property-metamorphic` round-trip that builds
  the node's canonical `SignalFrame` (from `genSynthetic` or the adapter) and asserts
  `Node.compute(frame)` returns a schema-valid `ganglior.node-export` (NOT just `compute({parserShape})`).
  This is what caught GlucoDex.
- **(b) BETTER — one generic gate:** add a single test group that, for every registered adapter, runs
  `adapter.parse(syntheticInput) → frame → SignalOrchestrate.emitNodeExport(frame)` and asserts a
  schema-valid export. This makes "the orchestrate emit path actually works for this signal type" a
  CHECKED fleet-wide invariant — the gap then cannot recur silently for node 3 or 4. Requires each node's
  host shim (`pulseHost`/`oxyHost`/…) be resolvable in the test realm (they are — co-loaded). Strongly
  recommended before the CPAPDex leg.

</details>

---

## 2 · ✅ DONE 2026-06-27 — GlucoDex node-export clamp-saturation honesty flag (correctness, CGM-specific)

**EXECUTED 2026-06-27 (both gates green).** `glucodex-dsp.js glucoBuildNodeExport` now surfaces
`recording.clamp` — `{ detected, vendor, floor, ceiling, blindMetrics }` when a clip is detected, else
`{ detected:false }` (ALWAYS present, so a consumer knows it was CHECKED) — and stamps clip-FLOOR
`nocturnal_hypo` events `meta.clampFloor:true`. `analyze()` already computes
`clampSat = detectClampSaturation(parsed.vMgdl)` and returns it on `r.clampSat` (verified wired:
glucodex-dsp.js:804 → :830 → the export reads `r.clampSat` :1058). The Integrator's `adaptGlucoDex`
(`integrator-dsp.js`) now reads it → `summary.clampSat` + DOWN-WEIGHTS the clip-floor hypos (`conf ×0.5`,
`clampFloor:true` on the adapted event) so fusion trusts them less; absent clamp field (legacy/clean export)
→ `null`, no down-weight (back-compat). Additive + contract-safe: a non-clamped file's event stream is
byte-identical (the event map is a no-op when `!floorSat`). GlucoDex + Integrator re-bundled
(`d8bf3b24036c→5bd14ef5c05b`, `c991bd461fe5→026e1d6ef0e1`; buildHashes UNCHANGED — external-JS-only);
the GlucoDex equiv fixture was REGENERATED (`GlucoDex.compute({text: lingo CSV})`) + its manifestHash
re-recorded in `FIXTURE-PROVENANCE.json`. New Dex-Test-Suite group **'GlucoDex clamp-saturation honesty
flag'** locks both the emit side (clamp field + `meta.clampFloor` on the clip-floor hypos + clean-export
byte-identity) and the consume side (`adaptGlucoDex` surfaces `clampSat` + down-weights) via a SYNTHETIC
clamped `r`. Dex-Test-Suite all-green **1176/75**; verify-provenance GATE A 8/8 + GATE B reproducible.

> **⚠ PREMISE CORRECTION (finding from the fixture regen — do not re-investigate).** The original §2 text
> below asserted this brief's input (the committed Lingo CSV) clips to 55–200 and that its 37
> `nocturnal_hypo` events fire off a clipped 55-floor. **That is NOT true for this file.** Re-running
> `detectClampSaturation(parsed.vMgdl)` on it returns `detected:false, vendor:null`, `floor:{value:54,
> count:61, pct:0.75, saturated:false}`, `ceiling:{value:169, … saturated:false}` (n=8094, min **54**,
> max **169** — nowhere near a 200 ceiling, and only 0.75% of readings near the low — a natural hypo tail,
> not a hard-floor pile-up). So `detectClampSaturation` is working correctly and does NOT false-positive:
> the 37 hypos are **genuine low-glucose detections, not clip artifacts.** Consequently the regenerated
> equiv fixture's ONLY delta vs the prior one is the added `recording.clamp:{detected:false}`; its 42
> events (incl. the 37 hypos) are byte-unchanged and NONE carry `meta.clampFloor` (clean path). The
> clamp-DETECTED behavior is therefore exercised by the synthetic unit test, not by this clean fixture
> — the honest outcome (the export reports a clamp only when one is robustly detected). The implementation
> below stands; only the original §2 framing of *this input* was an over-assumption.

<details><summary>Original §2 (superseded framing — kept for the design rationale, which is sound)</summary>

**What surfaced.** The equivalence fixture's input is a real **Abbott Lingo** export, which **clips
readings to 55–200 mg/dL**. `glucodex-dsp.js detectClampSaturation` correctly detects this
(`vendor:'lingo'`, `blindMetrics:['tbr1','tbr2','lbgi','min','nocturnalHypo',…]`) — BUT
`glucoBuildNodeExport` carries only `recording{source,startEpochMs,events}` + `ganglior_events`. The
clamp flag is **NOT in the node-export.** Consequence: the fixture emits **37 `nocturnal_hypo` events**
fired off the clipped 55-floor — and a fusion consumer (the Integrator) has **no way to know the CGM was
clamped**, so it cannot down-weight those clip-floor hypos (they may be clip artifacts, not true hypos).
This is the same class as the Welltory black-box `provenance.derived` honesty lesson (-III §2), one layer
down: a measured-looking event stream whose reliability is materially qualified by an ingest fact the
export discards.

**Do (decision needed — additive, contract-safe).** Surface `clampSat` in the node-export when detected:
e.g. `recording.clamp = { detected, vendor, floor, ceiling, blindMetrics }` (new field, back-compat),
and/or stamp the affected events `meta.clampFloor:true`. Then teach the Integrator's `adaptGlucoDex` to
read it (down-weight or tier-demote clip-floor `nocturnal_hypo`). This is a `glucodex-dsp.js` change →
re-bundle + regen the GlucoDex equiv fixture (its 37 hypos would gain the flag) + both gates. **Budget for
the fixture to move.** If declined, document WHY in the registry/export doc so the next coder doesn't
assume the export is clamp-aware.

</details>

---

## 3 · Integrator `adaptGlucoDex` end-to-end consumption — UNVERIFIED (verification debt)

The parent brief §2a said "the Integrator already has a CGM adapter path — confirm `adaptGlucoDex`
consumes the export." This leg verified the **emit** side (Unifier/OverDex → `emitCgmNodeExport` →
schema-valid export) headlessly, but did **NOT** drive the Integrator's fusion ingest of the new light
`recording + ganglior_events` GlucoDex export. **Do:** feed `uploads/GlucoDex_2026-06-27_equiv.node-export.json`
to `IntegratorDSP`/`adaptGlucoDex` and assert it ingests (events mapped, `tMs` reconstructed via
`startEpochMs` + `t`, no throw on the absent series). Add it to the Integrator fusion test group if a seam
exists. (Ties into §2 — the clamp flag, if added, is what the Integrator would consume.)

---

## 4 · Live UI drop-zone verification owed (standing debt, mirrors -IV §1 / -V §4 for OxyDex)

Everything proven this leg is **headless** (compute + P10 round-trip + equivalence gate). A real **Abbott
Lingo / Dexcom CSV dropped into the live Data Unifier / OverDex drop-zone** — routes to `libre-cgm` →
`emitCgmNodeExport` → renders a GlucoDex summary in the actual UI — was **not** exercised (the
render-coverage rig is unrunnable in a cross-origin preview sandbox, -VI §5). Carry forward with the
OxyDex live-drop debt. NB the headless path now genuinely works (the §1 fix), so this is confirmation,
not discovery.

---

## 5 · GlucoDex has NO render-coverage `extraProbe` + NO live-app-export≡compute() diff (test hardening, LOW)

- The parent brief §1F asked for "a render-coverage `extraProbe` that produces a schema-valid export from
  a raw file." Deferred — the headless equiv gate + P10 cover schema-validity, but no probe drives the
  **GlucoDex.html bundle's** ingest→render→export in an iframe. (Storage hygiene -XI/-XII: the -XI audit
  classed GlucoDex ingest **transient** — re-confirm it writes no `localStorage` on the ingest path; if so,
  no snapshot needed.)
- The **-VIII §1 live `appExport ≡ compute()` diff** (`captureAppExport`) covers OxyDex/PulseDex/HRVDex
  but **not GlucoDex**. GlucoDex parity is by-construction (app `exportGanglior` delegates to the same
  `glucoBuildNodeExport`), so this is hardening, not a known gap — add GlucoDex to the `captureAppExport`
  render-coverage rig to make it a checked invariant. LOW.

---

## 6 · Event-byte coverage misses `dawn_surge` (test hardening, LOW)

The GlucoDex equiv fixture (Lingo CSV) emits `nocturnal_hypo` + `glucose_excursion` but **zero
`dawn_surge`** — so that third impulse's `t`/`tMs`/`conf`/`meta` byte-shape is untested (the gate
byte-checks only impulses actually present). If full per-impulse event coverage is wanted (as -VII §2 did
for HRVDex/PulseDex), add a small purpose-built CGM CSV with a ≥20 mg/dL dawn rise → one `dawn_surge`,
wire `env.equiv.glucodex_events` in both runners + a CASE. LOW (the two dominant impulses ARE byte-checked
on a real file).

---

## 7 · Co-load / adapter-load list is now hand-synced across 5 sites (maintainability, MEDIUM — act before CPAPDex)

Landing `libre-cgm.js` touched the SAME adapter `<script>`/load block in **five** places: `Data
Unifier.html`, `OverDex.html`, `Dex-Test-Suite.html`, `tests/run-tests.mjs`, `tsconfig.json` (and
`glucodex-dsp.js` was already in 4 co-load sites). The parent §1E (echoing -IV §5) flagged this and said
"if you migrate the 4th node, consider a shared `dex-coload` ordered list instead of a 5th hand-sync." We
are now at **3 of 4 nodes done with a 5-wide hand-sync** for adapters + 4-wide for DSPs. **Strongly
recommend** extracting a single ordered manifest (one array of adapter + DSP module paths) that all hosts
+ both runners + tsconfig read/generate from, BEFORE the CPAPDex leg — otherwise CPAPDex makes it a 6th
hand-sync and a miss silently drops a node from a surface (-IV §5).

---

## 8 · Standing Node-CI debt — `node tests/run-tests.mjs` not run (carry forward)

GlucoDex was wired into `run-tests.mjs` (`env.GlucoDex`, the `equiv.glucodex` pair, `adapters/libre-cgm.js`
in the load array) but verified only via the browser `Dex-Test-Suite.html` (no Node host in this
environment). The Node path — `env.equiv.glucodex`, the P10 round-trip, the GlucoDex floor, and that the
IIFE evals clean under `node:vm` with `__DEX_NAMESPACED__` — is unverified in Node. Same standing debt as
-IV §7 / -V §4 / -VI §3 / -VII §3 / -VIII §2. Not a blocker; run when a Node host is available.

---

### Priority summary
- **✅ DONE 2026-06-27:** §2 (clamp-saturation honesty flag in the export + Integrator down-weight — both
  gates green; see the §2 premise-correction finding).
- **✅ DONE 2026-06-28:** §1 (compute()-shape recurrence — the generic adapter→emit→export gate; base already landed
  in the ECGDex leg as `PPGDEX-FOLLOWUPS §10`, now HARDENED here to bind coverage to the emit allowlist
  (`canEmit` ∪ `SignalSpec` ∪ parsed `_EMITTABLE`), not just the adapter registry, so CPAPDex can't dodge via a
  bespoke/early-emittable path; test-only, no re-bundle; Dex-Test-Suite all-green; red-fires for flow/cpap).
- **⚠ before the next node legs:** §7 (centralize the co-load list before CPAPDex).
- **⚠ GlucoDex correctness:** §2 (clamp honesty in the export — decision + likely re-bundle/fixture move),
  §3 (Integrator `adaptGlucoDex` ingest).
- **LOW / verification debt:** §4 (live UI drop), §5 (render-coverage probe + live-export diff), §6
  (`dawn_surge` byte coverage), §8 (Node-CI).
