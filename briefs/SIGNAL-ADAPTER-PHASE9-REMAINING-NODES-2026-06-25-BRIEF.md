<!--
  SIGNAL-ADAPTER-PHASE9-REMAINING-NODES-2026-06-25-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-28 · **All 4/4 nodes migrated** — GlucoDex+PpgDex+ECGDex (1–3/4) DONE 2026-06-27, **CPAPDex (4/4) DONE 2026-06-28** (both gates green: Dex-Test-Suite 1312/81 · verify-provenance GATE A 8/8) · **Created:** 2026-06-25 · **Follows:** SIGNAL-ADAPTER-AND-FRONTIER-2026-06-23-BRIEF.md (Phase 9, the per-node migration long tail) · **Sibling-of:** SIGNAL-ADAPTER-FOLLOWUPS-2026-06-24-BRIEF.md … -XII-2026-06-25-BRIEF.md

> **EXECUTION LOG — GlucoDex (node 1 of 4): ✅ DONE 2026-06-27 (re-bundled + both gates green).**
> All of Steps A–G + the re-bundle ritual are complete. `GlucoDex.html` re-bundled (external-JS-only:
> manifestHash `86978e19fc1c`→**`d8bf3b24036c`**, buildHash `ebb3b3ab196a` UNCHANGED); `Dex-Test-Suite.html`
> all-green (settles ~1008/66, 0 fails); `verify-provenance.html` GATE A 8/8 + the new GlucoDex fixture
> code-gated ✓; `BUILD-MANIFEST.json` + `FIXTURE-PROVENANCE.json` updated. Residue → `GLUCODEX-FOLLOWUPS-2026-06-27-BRIEF.md`.
>
> **⚠️ The "remaining C–G" log below was STALE on resume.** A prior session had already landed Steps
> C (the adapter FILE), E (orchestrate wiring), F (4-site `glucodex-dsp.js` co-load) and the Step-G
> `compute()` floor test on disk — but never updated this log, and left FOUR genuine gaps (disk is the
> source of truth; verify each step, don't trust the log):
> - **🔴 The real bug — `compute()` rejected the canonical cgm SignalFrame.** `GlucoDex.compute()`
>   accepted only a `{tMs,vMgdl}` frame or `{text}`, but `signal-orchestrate.emitCgmNodeExport` hands it
>   the canonical cgm SignalFrame (`samples=[{tMs,v}]` + parallel `tsMs`) STRAIGHT through — so the Data
>   Unifier / OverDex CGM path **threw on every routed file**. The Step-G `genSynthetic` `{tMs,vMgdl}`
>   floor HID it by construction (§4 #2). FIX (additive): a samples-frame branch in `compute()` that
>   reconstructs `{tMs,vMgdl,unit,t0Ms}` from the frame's own already-parsed samples. The `{text}` /
>   `{tMs,vMgdl}` paths AND the app's `exportGanglior` (delegates to the SAME `glucoBuildNodeExport`)
>   are untouched → app/Unifier export byte-identical, every prior output inert.
> - **`adapters/libre-cgm.js` was registered NOWHERE** (a dead file): now loaded in `Data Unifier.html`
>   + `OverDex.html` + `Dex-Test-Suite.html` + `tests/run-tests.mjs` + `tsconfig.json`.
> - **`env.GlucoDex` was never wired** into either runner — so the committed Step-G floor test
>   (`env.GlucoDex.compute`) was latently **RED**. Wired into both runners.
> - **Step C how-to-collect note, Step D `property-metamorphic` round-trip, and the Step G equivalence
>   gate** (with GlucoDex's FIRST code-gated fixture — real Abbott Lingo CSV → 42 events) were all
>   missing — added. Step D's resolver/frameFields confirmed (cgm `dsp:()=>GLUDSP`, `frameFields:
>   ['samples','tsMs','t0Ms']`) MATCH the real surface once `compute()` accepts the samples frame.
>
> Steps A+B (`glucoBuildNodeExport`+`compute`), B-rewire (app `exportGanglior`), E (orchestrate
> `glucoHost`/`emitCgmNodeExport`/dispatch+summary cases), F (4-site co-load) were already correctly
> on disk and needed no rework.
>
> Nodes 2–4 (PpgDex → ECGDex → CPAPDex) still **unstarted** — one node per gated pass (§3); this brief
> stays IN-PROGRESS until they land. The compute()-shape gap WILL recur per node (each node's
> orchestrate emit hands compute() a canonical SignalFrame, not the node's ad-hoc parser shape) — see
> `GLUCODEX-FOLLOWUPS-2026-06-27-BRIEF.md` §1.

> **EXECUTION LOG — PpgDex (node 2 of 4): ✅ DONE 2026-06-27 (re-bundled + both gates green).**
> Applied the §1 recipe cleanly and PROACTIVELY closed the compute()-shape trap GLUCODEX-FOLLOWUPS §1
> predicted — it did NOT bite, because `compute()` was built to accept the canonical frame from the start.
> Steps A–G: `ppgdex-dsp.js` gained `PpgDex.compute(SignalFrame(ppg)|rec|{text})` + the shared
> `ppgBuildNodeExport` (app `exportGanglior` delegates → byte-identical). The canonical **ppg SignalFrame
> `samples` PACKS the multi-channel optical waveform** (`{ch:[F32×3],amb,relSec,n,durSec,length:n}` typed
> arrays — PPG@176 Hz, so NOT per-sample objects; ECG-like `fs/t0Ms/offsetMin` on the frame) and compute()
> reconstructs the rec from it. New `adapters/polar-sense-ppg.js` (its `detect` beats polar-rr's 0.6 header
> match on a `*_PPG.txt` so optical never mis-routes to PulseDex; device `*_PPI.txt` still → PulseDex as rr).
> `signal-spec.js` gained `ppg` (samples, unit `au`); `signal-orchestrate.js` gained `ppgHost`/`emitPpgNodeExport`
> + the `emitNodeExport` `ppg` dispatch + `nodeExportSummary` PpgDex case; co-loaded in `Data Unifier.html` +
> `OverDex.html` (Dex-Test-Suite + both runners already had `ppgdex-dsp.js`). `env.PpgDex` + `env.equiv.ppgdex`
> wired into BOTH runners + `tsconfig`; a Step-F floor case (`SYNTH.renderPPG → compute({text})`), a P11
> canonical-frame + real-adapter round-trip (property-metamorphic), and an equivalence CASE backed by PpgDex's
> FIRST code-gated fixture (`uploads/PpgDex_2026-06-27_equiv.node-export.json`, a real 6.5-min Verity Sense
> `*_PPG.txt` → 2 epochs, 0 events) added. `PpgDex.html` re-bundled (external-JS-only: manifestHash
> `1fb306ea693f`→**`c7c808bbb6a1`**, buildHash `fff8fe8b1b68` UNCHANGED). Shared suite all-green headlessly
> (floor 32/32, property-metamorphic 41/41 incl. all 6 P11 checks, equivalence PpgDex 3/3 incl. compute()≡fixture);
> `verify-provenance` GATE A/B clean by construction (manifestHash matches); `BUILD-MANIFEST.json` +
> `FIXTURE-PROVENANCE.json` updated. Residue → `PPGDEX-FOLLOWUPS-2026-06-27-BRIEF.md` (⚠ §1: the orchestrate PPG
> path is companion-less + light — motion gate/posture/HRV-consensus dropped; decision owed).
>
> Nodes 3–4 (ECGDex → CPAPDex) still **unstarted** — one node per gated pass (§3); this brief stays IN-PROGRESS
> until they land. ⚠ ECGDex: do NOT copy PpgDex's packed-`samples` shape — ECG is single-channel
> `{samples:Float32Array,fs}` (PPGDEX-FOLLOWUPS §8); run R-peak detection WITHOUT the Worker (parent §2b). The
> compute()-shape contract still applies per node (orchestrate hands compute() a canonical SignalFrame).

> **EXECUTION LOG — ECGDex (node 3 of 4): ✅ DONE 2026-06-27 (re-bundled + both gates green).**
> Applied the §1 recipe and PROACTIVELY closed the compute()-shape trap from the start (it did NOT bite).
> Steps A–G: `ecgdex-dsp.js` gained `ECGDex.compute(SignalFrame(ecg)|rec|{text}) → ganglior.node-export` + the
> shared `ecgBuildNodeExport` (ecgdex-app.js `exportGanglior` now delegates → app/Unifier byte-identical; the
> builder strips the internal `_sec` helper, matching the rich `buildV2`). compute() accepts the canonical
> **ecg SignalFrame whose `samples` is a SINGLE-channel Int16Array** + `fs/t0Ms` on the frame (NOT PpgDex's
> packed multi-channel object — §8). R-peak detection runs WITHOUT the Worker (§2b): a NEW pure `parseECG(text)`
> headless parser (mirror of the app's streaming worker for the Polar Sensor Logger `*_ECG.txt`
> `Phone timestamp;sensor ns;timestamp [ms];ecg [uV]` ~130 Hz layout, exposed as `ECGDex.parseECG`) feeds
> `analyze()`'s in-process Pan-Tompkins detector. New `adapters/polar-h10-ecg.js` (raw `*_ECG.txt` →
> `SignalFrame(ecg)`, wraps `ECGDex.parseECG` by reference; its `detect` on the `ecg [uV]` header / `_ECG`
> filename returns 0.9–0.97 so it OUTRANKS polar-rr's 0.6 on the shared Phone-timestamp column — locked by a
> property-metamorphic route-precedence case (§9); device `*_RR.txt` still → PulseDex). `signal-spec.js` ecg
> resolver now prefers `ECGDex`; `signal-orchestrate.js` gained `ecgHost`/`emitEcgNodeExport` + the
> `emitNodeExport` `ecg` dispatch + `nodeExportSummary` ECGDex case; co-loaded in Data Unifier + OverDex
> (Dex-Test-Suite + both runners already had `ecgdex-dsp.js`). `env.ECGDex` + `env.equiv.ecgdex` wired into BOTH
> runners + `tsconfig`; a Step-F floor case (synthetic 45-min ECG → full pipeline), a P12 canonical-frame +
> real-adapter round-trip, and an equivalence CASE backed by ECGDex's FIRST code-gated fixture
> (`uploads/ECGDex_2026-06-27_equiv.node-export.json`, a real ~6-min Polar H10 `*_ECG.txt` clip → 0 events) added.
> **PLUS the two pre-CPAPDex hardening items landed** (test-only, no extra re-bundle): **§10** the GENERIC
> `adapter → SignalOrchestrate.emitNodeExport → schema-valid export` gate over every registered signalType
> (so the compute()-shape trap cannot recur silently for CPAPDex); **§5** a NEW `dex-coload.js` single-source
> co-load manifest + a gate asserting it == the registered adapter set AND every host realm co-loads every
> module. `ECGDex.html` re-bundled (external-JS-only: manifestHash `89954db58d5c`→**`7c625af51078`**, buildHash
> `146ac9c8b1bd` UNCHANGED). `Dex-Test-Suite.html` all-green (1074/68 fully settled, 0 fails); `verify-provenance`
> GATE A 8/8 + the new ECGDex fixture code-gated ✓; `BUILD-MANIFEST.json` + `FIXTURE-PROVENANCE.json` updated.
> Residue → `ECGDEX-FOLLOWUPS-2026-06-27-BRIEF.md`.
>
> **EXECUTION LOG — CPAPDex (node 4 of 4, the LAST): ✅ DONE 2026-06-28 (re-bundled + both gates green).**
> The §1 recipe applied; the **§1 frame-shape FORK** (GENERIC-EMIT-GATE-FOLLOWUPS-I §1) was resolved
> CONSCIOUSLY (option (b)+(c)): a `SignalFrame` has NO event carrier but CPAPDex's headline value is the
> device-scored EVE/CSL events, so the NEW `signal-spec.js` **`cpap`** type (kind:samples, L/s) carries the
> 25 Hz BRP FLOW waveform in `samples` (so `validateFrame` passes) + the decoded {BRP,PLD,SA2,EVE,CSL}
> set(s) as a **`frame.edfSets` SIDECAR** (the ECG deviceRR/ACC companion pattern — NO `validateFrame`
> relaxation needed; extra frame fields are allowed). `cpapdex-dsp.js` gained the namespaced
> **`CPAPDex.compute`** (accepts the cpap frame | a decoded set | a night) → reads the sidecar →
> `buildSessionFromEdf` → `buildNight` → the SHARED **`CpapFusion.cpapBuildExport`** (ONE event source;
> compute() is ADDITIVE and the app's `exportNight` is UNTOUCHED → byte-identical export, existing fixtures
> inert). **NO text-stream adapter** (option (c)): EDF is BINARY + multi-file and the Data Unifier/OverDex
> ingest boundary is `readAsText`, which can't carry binary — so binary EDF ingest stays the CPAPDex APP's
> job; `cpap` goes emittable via **`SignalOrchestrate.canEmit('cpap')`** + `cpapHost`/`emitCpapNodeExport` +
> the `emitNodeExport` 'cpap' dispatch + `nodeExportSummary` CPAPDex case + `_EMITTABLE.cpap`, gated by the
> generic-emit gate's **DRIVER-2** (canEmit-bound) provider — NOT DRIVER-1 (no adapter registers). Tests
> (`tests/dex-tests.js`): `providers.cpap` + `NODE_OF.cpap` in the generic gate, a CPAPDex Phase-9 floor case
> incl. a **`compute()` ≡ `CpapFusion.cpapBuildExport` PARITY** assert (stands in for the {text}/CSV
> equivalence gate CPAPDex can't join — EDF is binary), host-emit-allowlist `cpap`. `cpapdex-fusion.js`
> co-loaded in `tests/run-tests.mjs` + `env.CPAPDex`/`env.CpapFusion` exposed in BOTH runners (Dex-Test-Suite
> already co-loaded dsp+edf+fusion). **NOT added to `dex-coload.js`/the live hosts** by design (no live
> routing path — binary EDF can't traverse `readAsText`; see follow-ups). `CPAPDex.html` re-bundled
> (external-JS-only: manifestHash `73d870b6ccfc`→**`75d4c6dee9b6`**, buildHash `2702e925dfd1` UNCHANGED);
> `Dex-Test-Suite.html` all-green (**1312/81, 0 fails**); `verify-provenance.html` GATE A 8/8, 0 red;
> `BUILD-MANIFEST.json` updated. Residue → `CPAPDEX-PHASE9-FOLLOWUPS-2026-06-28-BRIEF.md`.
>
> **ALL FOUR Phase-9 nodes are now migrated — this brief is DONE.**

# Signal-Adapter Phase 9 — the REMAINING node migrations (GlucoDex · ECGDex · PpgDex · CPAPDex)

> **Read `CLAUDE.md` first** (the two gates, the Clock Contract, frozen `Ganglior`/`fascia`, edit-inputs-
> then-re-bundle, SPDX header on every authored file). Then the parent brief's **Phase 9** + **§4 gate-
> minimization**, and skim the follow-up chain **-I … -XII** — this brief is forward execution, but the
> *error classes* those rounds chased WILL recur here (see §4). This brief carries no new architecture;
> it applies the **already-proven PulseDex/OxyDex/HRVDex migration recipe** to the four un-migrated nodes.

---

## 0 · Where things stand (handoff snapshot, 2026-06-25)

**Main brief `SIGNAL-ADAPTER-AND-FRONTIER` is IN-PROGRESS.** Executed: Phases 0–6, 8, 10, plus Phase 9
for **PulseDex, OxyDex, HRVDex**. **Open in the main brief:**

- **Phase 9 — four nodes NOT yet migrated: `GlucoDex` (CGM), `ECGDex` (raw ECG), `PpgDex` (PPG/optical
  RR), `CPAPDex` (EDF/CPAP).** This brief. Each is opportunistic + per-node-gated; **never do two in one
  pass** (`ARCHITECTURE-PRINCIPLES §7`).
- **Phase 7 — content-addressed provenance** (replace the `buildHash` proxy). Owner-gated, forces a
  **full re-bundle of ALL apps** + fixture regen. Explicitly **do LAST**, as its own deliberate pass —
  NOT folded into any node migration. Out of scope here.

**The follow-up chain -I…-XII is effectively closed** — every item is DONE except **standing Node-CI
debt** (`node tests/run-tests.mjs` never run because there is no Node host in this environment; the
browser `Dex-Test-Suite.html` is the substitute gate) and a couple of LOW-priority latent items
(-XII §1 IndexedDB snapshot — already guarded; -XII §2 keyed-restore refinement). Do **not** re-open them.

**Current gate baseline (must stay true):** `Dex-Test-Suite.html` all-green (last recorded **991/66**,
same-origin host); `verify-provenance.html` GATE A/B clean; HRVDex `manifestHash 50d1a34cc950`. Adapters
present: `adapters/{polar-rr,coospo-rr,wahoo-rr,oxydex-spo2,welltory-summary}.js`.

---

## 1 · The proven recipe (copy this EXACTLY per node — it is the whole job)

This is the PulseDex/OxyDex/HRVDex pattern distilled. Reference implementations to mirror line-for-line:
`pulsedex-dsp.js` (namespace wrap + `PulseDex.compute`), `oxydex-dsp.js`/`adapters/oxydex-spo2.js`
(samples-signal leg), `hrvdex-dsp.js`/`adapters/welltory-summary.js` (summary leg + ingest-boundary
guards), and `signal-orchestrate.js` (the emit chokepoint).

**Step A — Namespaced DSP build (`<node>-dsp.js`).** Wrap the WHOLE DSP body in one IIFE so its math/
clock helpers (`mean`, `std`, `parseTimestamp`, parsers…) stay closure-local. Hang the public surface
off ONE global (`root.GlucoDex` / `ECGDex` / `PpgDex` / `CPAPDex`) AND keep the parser reachable on it
(`GlucoDex.parseCSV`, etc., for the adapter). Then re-export the bare globals **only when
`!root.__DEX_NAMESPACED__`** — so standalone bundles stay byte-identical (bare spray, back-compat) while
the co-load realm (Unifier/OverDex/test-suite, which set the flag) gets NO bare collisions. Pattern at
`pulsedex-dsp.js:794–818`.
- **GlucoDex is HALF-DONE already:** it ships `global.GLUDSP = {…}` (`glucodex-dsp.js:1043`). Keep
  `GLUDSP` (apps/tests read it) but ADD `root.GlucoDex` with the public `compute` + `parseCSV`, and add
  the `__DEX_NAMESPACED__` bare-suppression gate **only if** GlucoDex currently leaks bare names that
  collide in the co-load realm (it uses an IIFE `(function(global){…})(window)` already, so it likely
  leaks NOTHING bare — verify with a grep for top-level `function `/`var ` OUTSIDE the IIFE; if clean,
  the namespace gate is a no-op and you only add `GlucoDex.compute`). This makes GlucoDex the **cheapest
  next node — do it FIRST.**

**Step B — Headless `compute()` public surface (`<node>-dsp.js`).** Add
`Node.compute(SignalFrame|rows|{text}, opts) → ganglior.node-export`, DOM-free. It must run the node's
REAL pipeline (parse → analyze → the SAME event/export builder the app uses) and be **self-contained**
(`CONTRIBUTING.md §6`): it may reference ONLY {itself · `kernel-constants` exports · its own `*-util`};
any reach-in to a render/profile sibling must be `typeof`-guarded (the OxyDex `upVO2category` trap,
-IV §1). **Extract the app's `exportGanglior` windowing into a SHARED builder in the DSP** (e.g.
`glucoBuildNodeExport` / `glucoEventsFromAnalysis`) and have BOTH the app's exporter AND `compute()` call
it — ONE event source, so the Unifier/OverDex export is byte-identical to the app's (the -I §2 / -II §1
parity lesson). Do NOT re-implement a lighter event set in the adapter.

**Step C — Adapter (`adapters/<vendor>-<signal>.js`).** `registerAdapter({id, signalType, vendor,
detect, parse})`. `detect` = cheap filename/header confidence 0..1 (return 0 → "unknown, set aside",
never mis-route). `parse` REFERENCES the node's pure parser by reference (never copies it) and returns
`toSignalFrame(type, raw, ctx)`. Apply vendor quirks (timestamp formats, DMY/MDY, the ms-vs-s unit
guards) **in the adapter at the ingest boundary**, never by editing the node's `parseTimestamp`. Tag
any vendor *derived* score `provenance.derived:true` + lower evidence tier (the Welltory lesson).
- **CGM signal type already exists** in `signal-spec.js` (`SignalSpec.cgm`, `dsp:()=>window.GLUDSP`).
  Confirm its `frameFields`/`dsp` resolver matches GlucoDex's real surface; add the round-trip to the
  `property-metamorphic` group.

**Step D — Orchestrate emit (`signal-orchestrate.js`).** Add `emit<Signal>NodeExport(frame, host)` that
calls `host.<Node>.compute(...)`, add a host shim (`glucoHost()` resolving `root.GlucoDex` once the
namespace is present — mirror `oxyHost`), add ONE `case` to `emitNodeExport()`'s `signalType` switch,
and ONE `case` to `nodeExportSummary()`. That is the full wiring — every consumer routes through these.

**Step E — Co-load the namespaced DSP in the FOUR host sites (drift bait, -IV §5).** Add the
`<script src="<node>-dsp.js">` (and any `*-util` it needs, BEFORE the dsp) to ALL FOUR:
`Data Unifier.html`, `OverDex.html`, `Dex-Test-Suite.html` (before `tests/dex-tests.js`), and
`tests/run-tests.mjs` (the `__DEX_NAMESPACED__` load array). Miss one → that surface silently lacks the
node. (-IV §5 suggested centralizing this list; still not done at 3 nodes — if you migrate the 4th here,
consider a shared `dex-coload` ordered list instead of a 5th hand-sync.)

**Step F — Tests (`tests/dex-tests.js`, picked up by BOTH runners).** Add to the
`Phase-9 compute() — headless functional floor` group a case driving `Node.compute()` on a realistic
synthetic that traverses the FULL pipeline (the -IV §2 lesson: a too-small synthetic skips branches —
make the CGM/ECG synthetic long enough to hit every code path a real file hits). Add the node to the
`compute() ≡ committed export` equivalence gate (-IV §3, the highest-leverage gate) IF it has a committed
`uploads/*.csv` input + fixture — `Node.compute({text})` must deep-equal the fixture's physiological
fields (strip volatile `file`/`provenance`/`kernel`/`generated` + any profile-coupled fields). Add a
render-coverage `extraProbe` that produces a schema-valid export from a raw file. If the node persists
`localStorage` on its ingest path, snapshot/restore via the rig-level `_snapStore`/`_restoreStore`
mechanism (-XI/-XII) — audit it and record "no persist — no snapshot needed" if transient.

**Step G — The per-node re-bundle gate ritual (`CLAUDE.md` — do EVERY step, in order):**
1. Edit `<node>-dsp.js`/`<node>-app.js`/`<Node>.src.html` — **never** the bundled `<Node>.html`.
2. Re-bundle `<Node>.src.html` → `<Node>.html` via the inliner (`super_inline_html` is that inliner;
   the bundle must carry the `<template id="__bundler_thumbnail">` splash already in the `.src.html`).
3. Open `Dex-Test-Suite.html` (same-origin static host), wait ~3 s, read the `#summary` pill — **must be
   all-green**. A lone `ECGDex … bundle loads in iframe` / `OxyDex heavy-dropout watchdog` red is a known
   flake — re-run isolated before treating as real (`CONTRIBUTING.md` / -X §3).
4. Open `verify-provenance.html`; read the **`manifestHash`** column (the real code identity — it moves
   on any bundled-module change; `buildHash` may NOT move for an external-JS-only edit, which these are).
   Confirm no red verdicts.
5. **Hand-update that app's entry in `BUILD-MANIFEST.json`** to the new `manifestHash` (GATE A HARD-FAILS
   on stale/missing).
6. If you changed the node's CODE, **regenerate its fixtures** by re-running the app on its committed
   inputs and re-exporting (NEVER hand-edit), then record the producing bundle's `manifestHash` in
   `FIXTURE-PROVENANCE.json` (GATE B). Do NOT rely on `buildHash` moving — it often won't. (Pre-R1
   fixtures with no stamped hash → "no provenance" is fine; GlucoDex/ECGDex/PpgDex may be in that class.)
7. Flip THIS brief's header `Status:` in place when a node is fully done; sync `DOCS-INDEX.md`; spawn a
   `-FOLLOWUPS` brief for whatever residue that node's migration exposed (it WILL expose some — see §4).

**Invariants you must not break (parent §5):** Clock Contract verbatim (`tMs = Date.UTC(...)`, `getUTC*`
readout, missing stamp → `null` never `now()`; adapters keep calling the node's LOCAL `parseTimestamp`,
no shared util); frozen `Ganglior`/`fascia`/`ganglior.node-export`/`DexKernel`; 100% local (no CDN, no
`@font-face`, system stacks); dependency direction UI→DSP→INGEST→CORE (INGEST/DSP never touch the DOM);
additive contracts (new params LAST+optional, new data via NEW field); every surfaced number keeps its
evidence badge; SPDX header on every authored file.

---

## 2 · Per-node specifics & gotchas

### 2a · GlucoDex (CGM) — DO FIRST, cheapest
- Already namespaced (`GLUDSP`, `glucodex-dsp.js:1043`) and `SignalSpec.cgm` already declared. Surface:
  `GLUDSP.parseCSV / analyze / coreMetrics / genSynthetic / detectClampSaturation / hhmm / parseNutrition`.
- `parseTimestamp` uses `preferDMY:false` (CGM Libre/Dexcom are MDY) — that is the Clock-Contract default
  for CGM; keep it. The adapter for any DMY CGM vendor sets the hint at ingest.
- **Find the node-export emitter:** GlucoDex's DSP grep shows NO `ganglior_events`/`node-export` in the
  DSP — its `exportGanglior` likely lives in `glucodex-app.js` (DOM-coupled). Locate it, extract the
  windowing into a shared `glucoBuildNodeExport` in the DSP, wire `compute()` + the app exporter to it.
- New adapter `adapters/libre-cgm.js` (or `dexcom-cgm.js`) wrapping `GlucoDex.parseCSV`; `how-to-collect/`
  note. The Integrator already has a CGM adapter path — confirm `adaptGlucoDex` consumes the export.
- Raising OverDex raw coverage RR+SpO₂+HRV → **+CGM** is the payoff.

### 2b · ECGDex (raw ECG) — HEAVIER, Worker-coupled
- `ecgdex-dsp.js` exposes the namespaced `ECGDSP`; **the ECG parse runs in a Web Worker** (isolation
  already partial). Headless `compute()` must run the R-peak detection WITHOUT the worker (call the pure
  detector directly) or the co-load realm can't drive it. This is the main extra cost vs the others.
- `ecgdex-app.js → classifyECG(name)` is the existing filename classifier to lift into the adapter's
  `detect`. Polar H10 chest-strap CSV from Polar Sensor Logger (~130 Hz) is the capture format
  (`CLAUDE.md` capture-provenance) — the adapter owns that column/timestamp layout.
- SDNN estimator already unified fleet-wide to sample-SD ÷N−1 (parent followups §7) — ECGDex `std()` is
  correct; don't touch.

### 2c · PpgDex (PPG/optical → RR)
- Namespaced `PPGDSP`. Optical-beat → RR → HRV; has `ppgdex-morph.js`/`-profile.js` siblings — watch for
  the same self-contained-compute reach-in trap (`typeof`-guard any profile call).
- Differential oracle ECGDex↔PpgDex already green; keep rMSSD/SDNN parity.

### 2d · CPAPDex (EDF) — most distinct
- EDF binary ingest (`cpapdex-edf.js`), `cpapdex-coimport.js`, `cpapdex-fusion.js`. Signal type is
  flow/pressure events, not a simple sample stream — may need a NEW `SignalSpec` entry + `validateFrame`
  relaxation (mirror the HRV irregular-samples relaxation, -II/§4). Lowest reuse, do LAST of the four.

---

## 3 · Suggested order (value per gate-cost)
**GlucoDex → PpgDex → ECGDex → CPAPDex.** GlucoDex is half-migrated (cheapest, +CGM coverage). PpgDex is
a clean RR-family node. ECGDex is high-value but the worker adds cost. CPAPDex is the most distinct
(EDF + event-shaped frame) — do last. **One node per pass, gated after each.** Then, separately and
owner-gated, **Phase 7**.

---

## 4 · The error classes that WILL recur (pre-load these — they cost rounds -I…-XII)
The user explicitly expects "similar errors." From the chain:
1. **Export parity gap** (-I §2/-II §1): the app's `exportGanglior` emits more event types than a naive
   re-impl. → Extract ONE shared builder; wire app + `compute()` to it. Add the equivalence gate.
2. **`compute()` reaches a bare global in an un-co-loaded sibling** (-IV §1, the OxyDex `upVO2category`
   /`computeCeilingBaselineArr` throws). → Audit the DSP's external refs; co-load its `*-util` BEFORE the
   dsp; `typeof`-guard render/profile reach-ins. The too-small synthetic floor HIDES this (-IV §2) — make
   the synthetic traverse the full pipeline.
3. **Co-load list drift across the 4 host files** (-IV §5). → Edit all four; consider centralizing.
4. **Namespaced-build bare-global suppression** (-FOLLOWUPS §3): set the public surface off ONE global,
   suppress bare spray under `__DEX_NAMESPACED__`; integrator-dsp stays the lone bare module.
5. **Storage hygiene** (-X/-XI/-XII): a render-coverage `prep` that drives a bundle whose ingest writes
   `localStorage`/IndexedDB clobbers operator state. → snapshot-before-prep / restore-after via the
   rig-level mechanism; record "transient — no snapshot needed" where it doesn't persist.
6. **`buildHash` does NOT move on external-JS edits** (`CLAUDE.md`): trust `manifestHash` (GATE A) +
   regenerate fixtures (GATE B); update `BUILD-MANIFEST.json` by hand or GATE A reads stale.
7. **Node-CI standing debt**: `node tests/run-tests.mjs` can't run without a Node host — verify in the
   browser suite; carry the Node run forward as known debt (not a blocker).

---

### Gate posture
- Steps A–F are unbundled/test edits → **zero gate cost** while iterating (parent §4). The cost lands at
  Step G's re-bundle, once **per node**. Do the cheap proof (compute() + equivalence in the browser
  suite) BEFORE re-bundling.
- Stamp a node DONE in THIS header only when its "Done when" is met AND `Dex-Test-Suite.html` is all-green
  + `verify-provenance.html` GATE A/B clean + `BUILD-MANIFEST.json`/`FIXTURE-PROVENANCE.json` updated.
- Index in `DOCS-INDEX.md`. Spawn a per-node `-FOLLOWUPS` brief for residue (house pattern).
