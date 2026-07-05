<!--
  SIGNAL-ADAPTER-FOLLOWUPS-2026-06-24-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-07-04 · **Created:** 2026-06-24 · **Follows:** SIGNAL-ADAPTER-AND-FRONTIER-2026-06-23-BRIEF.md

> **CLOSED — DONE 2026-07-04 (live drop-through discharged in an interactive session).** The last owed
> executable item (the manual raw-file DROP through the drop-zone UI, tracked here + as -IV §1 / -V §4b)
> was run against the REAL served tools: **Data Unifier** emits a valid `ganglior.node-export` for all
> three raw signal types — RR→**PulseDex** (4 ev), SpO₂ O2Ring→**OxyDex** (15 ev), Welltory→**HRVDex**
> — and **OverDex** fuses a raw O2Ring CSV + a raw RR file **LIVE** (computed via each node's headless
> `compute()`, not `*_ganglior.json` passthrough) beside a passed-through ECGDex export. **This surfaced +
> FIXED a real bug the prior 12 rounds never hit** (all earlier HRV testing bypassed the adapter):
> `adapters/welltory-summary.js` built `tsMs` in FILE order, so a real newest-first Welltory CSV produced
> a `usable`-but-**INVALID** frame (`validateFrame` rejects a backwards `tsMs` step — the floating-`tMs`
> law) → the HRV emit path was **silently dead** in BOTH the Unifier and OverDex. Fix: the adapter now
> sorts parsed rows ascending by `_tMs` at the ingest boundary (mirrors the app's `commitRows` + VII §1's
> `hrvBuildNodeExport` sort) → frame valid, `t0Ms`/`startEpochMs` = EARLIEST sample, `spanDays` +29.
> The adapter is unbundled *source*; the two orchestrators **inline** it (OWNED but **NON-provenance** —
> no `BUILD-MANIFEST`/fixture, `tools/build.mjs` §6), so the identical edit was mirrored into
> `Data Unifier.html` + `OverDex.html` (drift-free == build output). **Zero provenance-gate cost** — no
> node bundle touched, GATE A/B untouched by construction. **Residual is external/node-gated only** (not
> deferrable by effort here): **§5** Coospo `detect()` hardening + fixture (no real Coospo export exists —
> `how-to-collect/coospo-rr.md` already asks a contributor); **§6** EEGDex/SpiroDex `SignalSpec` resolvers
> (those nodes aren't built); **§8** manifest-projected `*-cross.js` defs + Integrator GRADE row (no
> generated node needs them yet). Re-open each when its gating dependency lands. (§§1·2·3·4·7·9 were
> already DONE; -IV §5 co-load-list drift is since RESOLVED by `dex-coload.js`.)
> **Re-confirmed 2026-06-25 (FOLLOWUPS-II–V execution pass).** §§1·2 re-checked at the user's request:
> both remain correctly DONE — `signal-orchestrate.js` calls `pw.PulseDex.compute()` (no `_pdSeriesStats`
> reach-in) and the full event set (hrv_drop + stress_peak + short branch) is emitted via the shared
> `pdEventsFromResult`; the `pulsedex-dsp · signal-orchestrate` source-mirror group stays green in
> `Dex-Test-Suite.html`. Nothing to redo. The ONLY still-open items here are **EXTERNAL-GATED**, not
> deferrable-by-effort: **§5** (Coospo `detect()` hardening + fixture) needs a real Coospo export in hand
> (none exists — the capture note already asks a contributor for one); **§6** (EEGDex/SpiroDex `SignalSpec`
> resolvers) is unverifiable until those nodes are built; **§8** (manifest-projected `*-cross.js` defs +
> Integrator GRADE row) is forward-deferred until a generated node first needs them. All other items
> (§§1·2·3·4·7·9) are DONE.
> **Progress:** §7 RESOLVED (2026-06-24, SDNN unify). §9 RATIFIED (2026-06-24) — 9d shipped, 9a
> consolidated to the single `signal-orchestrate.js` chokepoint, 9b·9c forward-deferred by design.
> **§§1·2·9a DONE (2026-06-24)** — PulseDex Phase-9 keystone shipped: `PulseDex.compute()` public
> headless surface; the orchestrator reach-in + the hrv_drop-only re-impl are gone; full event parity
> (stress_peak + short branch); PulseDex re-bundled (manifestHash cc20b9abc9bd→727f854ede71, buildHash
> unchanged); Dex-Test-Suite 880/61, verify-provenance GATE A/B clean. **§4 DONE (2026-06-24)** — both
> legs shipped: OxyDex Phase-9 (`OxyDex.compute()` + `adapters/oxydex-spo2.js` + isolated `oxyHost` +
> SpO₂ routing; manifestHash 1f2486a7358a→17dae138c04b) AND HRVDex Phase-9 (`HRVDex.compute()` +
> pure `_hrvParseSummaryRows` + shared `hrvBuildNodeExport` + `adapters/welltory-summary.js` carrying
> the Baevsky unit guard + black-box `provenance.derived` tagging + isolated `hrvHost`/`emitSummaryNodeExport`;
> manifestHash e4771b6a6289→167894a53541, buildHash unchanged). OverDex raw coverage RR→RR+SpO₂+HRV.
> Dex-Test-Suite all-green, both gates clean. §5 PARTIAL (2026-06-24) — `how-to-collect/coospo-rr.md`
> shipped; fixture + `detect()` hardening still gated on a real Coospo file. **§3 DONE (2026-06-25)** —
> namespaced DSP builds removed the per-node isolation iframes (co-load in ONE realm) + unified
> `emitNodeExport` dispatch (-II §4) + Node-side `compute()` functional floor (-II §3); all 3 apps
> re-bundled (manifestHash moved, buildHash unchanged), Dex-Test-Suite 936/64, both gates clean.
> **§§6·8 remain open** (EEGDex·SpiroDex resolvers / first generated node).

# Signal-Adapter spine — follow-ups (what surfaced executing Phases 0–2)

> The spine shipped: `signal-spec.js` / `signal-frame.js` / `signal-adapters.js`, the unbundled
> `Data Unifier.html` + `data-unifier-app.js` with `adapters/polar-rr.js` + `adapters/coospo-rr.js`,
> and the `property-metamorphic` group in `tests/dex-tests.js`. `Dex-Test-Suite.html` is all-green
> (712 passing); **zero gate cost** (no existing `*-dsp.js/*-app.js/*-cross.js` edited, no bundle
> re-built). These items are the residue — none block the spine; each is sequenced by gate cost like
> the parent brief.

---

## 1 · ✅ DONE (2026-06-24) — The unifier reached into PulseDex INTERNALS (bare, underscore-prefixed globals)

`data-unifier-app.js`'s `emitNodeExport` calls the isolated PulseDex window's `_pdSeriesStats`,
`artifactClean`, `rmssd`, `mean` directly. Those are **private** (underscore stems, no namespace) — not
a stable contract. If PulseDex renames one, the unifier's HRV emit breaks **silently** (it falls back
to a raw mean, never erroring). This is exactly the "no shared public compute surface" smell the parent
brief flags. **Fix (couples to Phase 9):** when PulseDex is migrated, expose a headless
`PulseDex.compute(frame|vals) → ganglior.node-export` public entry; the unifier (and OverDex) calls
that instead of internals, and the emitted event set becomes **identical** to the app's `exportGanglior`
(see item 2). Until then the reach-in is load-bearing — leave a `// TODO: call PulseDex.compute once
migrated` at the call site. **GATE COST:** none now (unifier is unbundled); the public-surface work is
folded into PulseDex's Phase-9 pass.

> **DONE (2026-06-24).** PulseDex now exposes `PulseDex.compute(SignalFrame(rr)|vals) →
> ganglior.node-export` (pulsedex-dsp.js, DOM-free). `signal-orchestrate.js` (where this reach-in was
> consolidated per §9a — `data-unifier-app.js`/`overdex-app.js` both route through it) calls
> `pw.PulseDex.compute()` in the isolated host; the `_pdSeriesStats`/`artifactClean`/`rmssd`/`mean`
> reach-in is **deleted**. A rename inside PulseDex can no longer silently break the unifier — the
> contract is the public method. PulseDex re-bundled, both gates clean.

## 2 · ✅ DONE (2026-06-24) — node-export event parity was PARTIAL (vagal-drop only, no `stress_peak`)

The unifier's windowing re-implements only the relative+absolute **`hrv_drop`** rule; PulseDex's real
`exportGanglior` (in `pulsedex-app.js`, DOM-coupled, not headless) also emits **`stress_peak`** windows
and a short-reading single-event branch. So a Unifier-emitted export is Integrator-valid but **lighter**
than the same recording run through `PulseDex.html`. Acceptable for the spine; resolved for free by
item 1's `compute()` (which would host the full windowing headlessly). Note it so no one treats the two
exports as byte-equal.

> **DONE (2026-06-24).** Resolved exactly as predicted by §1's `compute()`. `pdEventsFromResult` (in
> pulsedex-dsp.js, shared by the app's `exportGanglior` AND `compute()`) emits the FULL set —
> `hrv_drop` **and** `stress_peak` windows **and** the short-reading single-event branch — lifted
> verbatim from `exportGanglior`. A Unifier/OverDex export is now byte-identical to the same recording
> run through `PulseDex.html`. Locked by the `pulsedex-dsp · signal-orchestrate` test group + the
> render-coverage `compute()` probe.

## 3 · ✅ DONE (2026-06-25) — namespaced DSP builds removed the isolation iframes (the §3 blocker)

> **DONE (2026-06-25) — the namespaced-build / iframe-removal pass.** Each migrated `*-dsp.js`
> (pulsedex/oxydex/hrvdex) now ships a NAMESPACED build: the whole DSP body is wrapped in ONE IIFE so
> its math/clock helpers stay closure-local; the public surface hangs off `root.PulseDex`/`OxyDex`/
> `HRVDex` (plus `PulseDex.parseRRInput` / `OxyDex.parseCSV` for the adapters); and the bare-global
> re-export is suppressed when `root.__DEX_NAMESPACED__` is set — so standalone bundles still spray bare
> globals (runtime byte-identical, back-compat intact) while the Data Unifier / OverDex / Dex-Test-Suite
> set the flag and **co-load all three DSPs (+ `oxydex-util.js`) in ONE realm**. `signal-orchestrate.js`
> was rewritten: the three `<iframe srcdoc>` isolation hosts are **GONE** — `pulseHost`/`oxyHost`/
> `hrvHost` now resolve to co-loaded host shims; `integrator-dsp.js` is the lone bare-global module on
> the page, so nothing collides. The per-signal `emit{RR,SpO2,Summary}NodeExport` are kept as named
> wrappers under a NEW unified `signalType`-dispatched `emitNodeExport(frame)` (**-II §4**), and OverDex +
> the Unifier now call the single dispatch (the per-signal switch is gone). The Node-side `compute()`
> functional floor (**-II §3**) moved into `tests/dex-tests.js` so BOTH runners co-load the namespaced
> DSPs and execute `compute()` on synthetic input. **The functional floor exposed + FIXED a latent gap:**
> the OxyDex headless path needs `oxydex-util.js` (`computeCeilingBaselineArr`) AND, for ≥1 h files,
> `upVO2category` from `oxydex-profile.js` — neither was loaded by the OLD isolation iframe (so isolated
> `OxyDex.compute` would have thrown on real overnight O2Ring files); now `oxydex-util.js` is co-loaded and
> the `upVO2category` call is guarded so the headless path is self-contained. All three apps re-bundled,
> **buildHash UNCHANGED** on each (external-JS-only): PulseDex manifestHash 727f854ede71→3c85d78cd9c2,
> OxyDex 17dae138c04b→336f500532da, HRVDex 167894a53541→b06db90abaa7 (BUILD-MANIFEST updated, GATE A).
> Both OxyDex code-gated fixtures re-VERIFIED export-inert (re-ran `OxyDex.compute({text})` on the
> committed 26157- + 21806-row O2Ring inputs → every physiological field byte-identical; only the
> non-computed file/provenance/kernel metadata + strip-listed vo2est/karv differ) → manifestHash
> re-recorded in FIXTURE-PROVENANCE (GATE B). Dex-Test-Suite all-green (936/64; +17-assertion functional
> floor + 3 orchestrate source-mirror assertions proving the iframe is gone + the dispatch). **The
> optional single-file `Data Unifier.html` bundle is now UNBLOCKED but deliberately NOT taken** — the
> Unifier/OverDex are live folder/drop tools that stay unbundled (§9c), so no provenance fixture is owed.

The isolation host loads `pulsedex-dsp.js` into a sandboxed `<iframe srcdoc>` with **relative** script
`src`. That resolves fine served over http (the preview, a static host) but the inliner can't inline a
child document referenced only by `srcdoc` string — so the optional "ship a single-file `Data
Unifier.html`" (parent brief Phase 1, the one place you'd take on a provenance fixture) needs either an
inliner-aware isolation shim or the Phase-9 `compute()` surface (no iframe needed). **Recommendation:**
do NOT bundle the unifier until item 1 removes the iframe; keep it unbundled (zero gate cost) meanwhile.

## 4 · ✅ DONE (2026-06-24) — OxyDex + HRVDex parsers extracted; SpO₂ + HRV-summary wired

The isolated-parser pattern is proven for PulseDex RR (fully headless, only the name collision to
isolate). The spo2 (OxyDex `parseCSV`) and HRVDex-summary adapters remain blocked on those nodes'
**DOM/`localStorage` side effects at load/parse** (parent brief §1 + Phase-1 isolation note). Two
adapter homes that DON'T exist yet and carry punch-list value when they do:
- **`adapters/oxydex-spo2.js`** — needs OxyDex's pure `parseCSV` factored out (or a DOM-stub host).
- **`adapters/welltory-summary.js`** — needs HRVDex's pure summary parser factored out (or a DOM-stub
  host). It is the right home for **two** open correctness items: tagging Welltory's black-box composites
  `provenance.derived:true` / lower tier, and applying the **Baevsky SI/CSI ms-vs-s unit guard**. ✅ The
  guard's pure logic now EXISTS + is tested (`quantity.js → DexUnits.guardBaevsky` / `baevskySI`, group
  "Units as quantities — Baevsky guard"); what remains is **wiring it at the HRVDex summary-CSV ingest
  boundary** — a node edit, so it rides HRVDex's Phase-9 (gated) pass, NOT a drive-by.

> **OxyDex leg DONE (2026-06-24).** `adapters/oxydex-spo2.js` ships (routes O2Ring/Wellue CSVs →
> SignalFrame(spo2)), and OxyDex exposes a headless `OxyDex.compute(SignalFrame(spo2)|rows|{text}) →
> ganglior.node-export` (pure parseCSV → processNight → the SHARED `oxyBuildNightElement`, which
> `exportJSON` now also uses). oxydex-dsp.js's top-level `#uploadArea` wiring is guarded so it LOADS
> headless; `signal-orchestrate.js` boots a SEPARATE isolated OxyDex host (`oxyHost`) and emits via
> `emitSpO2NodeExport`; the Data Unifier + OverDex now route & run SpO₂ raw files, so **OverDex's
> raw-file coverage rises RR-only → RR + SpO₂** (§9b). The Integrator's `adaptOxyDex` already
> synthesizes `spo2_desaturation` + `autonomic_arousal` from `desatProfile`/`hr_spikes`. Export-inert:
> re-running the bundle on the committed O2Ring input (26 145 rows) reproduced the fixture
> BYTE-IDENTICALLY → OxyDex re-bundled (manifestHash 1f2486a7358a→17dae138c04b, buildHash unchanged),
> Dex-Test-Suite 892/62, verify-provenance GATE A/B clean.
> **HRVDex leg DONE (2026-06-24).** `adapters/welltory-summary.js` ships (routes Welltory-style HRV
> summary CSVs → `SignalFrame(hrv)` — a cgm-style IRREGULAR-samples frame: `samples` = the parsed
> measurement rows, per-sample `tsMs`, no `fs`), and HRVDex exposes a headless
> `HRVDex.compute(SignalFrame(hrv)|rows|{text}) → ganglior.node-export` (pure `_hrvParseSummaryRows` → the
> SHARED `hrvBuildNodeExport`/`hrvEventsFromRows`, which `hrvdex-app.js` `exportGanglior` now delegates
> to — ONE event/export source). `parseCSV` is now `commitRows(_hrvParseSummaryRows(text))`, so the
> reading path is DOM-free and loads headless. `signal-orchestrate.js` boots a SEPARATE isolated HRVDex
> host (`hrvHost`) and emits via `emitSummaryNodeExport`; the Data Unifier + OverDex now route & run HRV
> summary CSVs, so **OverDex's raw-file coverage rises RR+SpO₂ → RR+SpO₂+HRV**. The two open
> correctness items landed in the adapter (the summary INGEST boundary): (1) **Baevsky SI/CSI ms-vs-s
> unit guard** (`DexUnits.guardBaevsky`/`baevskySI`) normalizes `Mode`/`MxDMn` to seconds + recomputes a
> unit-safe Stress Index per row, flagging implausible values (surfaced, never silently scaled); (2)
> Welltory's subjective scores are **black-box composites** → the frame is stamped
> `provenance.derived:true` and the shared builder tags the `stress_high` event `meta.derived:true` at
> the `'heuristic'` tier (`hrv_low` stays `'measured'`). CORE additions: `signal-spec.js` gained the
> `hrv` type; `signal-frame.js` `validateFrame` now accepts an irregular samples frame carrying
> per-sample `tsMs` without `fs` (cgm/hrv spot-reads). External-JS-only edit (hrvdex-dsp.js +
> hrvdex-app.js) → HRVDex re-bundled (manifestHash e4771b6a6289→167894a53541; buildHash de20db283366
> UNCHANGED, no inline-script/style shell edit; BUILD-MANIFEST GATE A updated). No HRVDex code-gated
> fixtures (uploads/*.json are pre-R1 'no provenance') → GATE B unaffected. Dex-Test-Suite all-green
> (new `HRVDex Phase-9 — compute() surface + summary adapter` group + property-metamorphic irregular-
> samples P6b + an `HRVDex.compute()` render-coverage probe; welltory-summary.js added to both runners +
> tsconfig + the Unifier/OverDex HTML alongside quantity.js). Minor residue surfaced (a CORE
> `validateFrame` relaxation for irregular `tsMs` samples + 3 doc/test/cosmetic items) → spawned
> `SIGNAL-ADAPTER-FOLLOWUPS-II-2026-06-24-BRIEF.md` (all zero gate cost).

## 5 · ◐ PARTIAL (2026-06-24, capture note shipped) — No real sample for Coospo; `detect()` is signature-thin

`coospo-rr.js` only fires when an explicit `coospo|hw9|h808` mark is in the filename or header; a
generically-named Coospo RR CSV returns confidence 0 (→ "unknown", set aside, not mis-routed — safe,
but a miss). The parent brief (§2.4) says **pair each adapter with a `how-to-collect/` capture note**;
that's not done for Coospo, and we have **no real Coospo export** to tighten the header signature
against. **Do when a real file exists:** add `how-to-collect/coospo-rr.md` + a fixture, and harden
`detect`. Same applies to any future Polar-RR file whose header differs from the assumed `RR-interval`
/ `Phone timestamp` columns.

> **Progress (2026-06-24):** `how-to-collect/coospo-rr.md` **shipped** (mirrors the `wahoo-tickr-rr.md`
> pattern: device, RR-CSV export steps, the `detect` confidence rule, and the MDY Clock-Contract note).
> Still **gated on a real Coospo export** (none in hand): the **fixture** and the **`detect()` hardening**
> against an actual generic-filename header can't be done without one — the note explicitly asks a
> contributor to supply the file. Doc-only, zero gate cost; the adapter was not touched.

## 7 · ✅ RESOLVED (2026-06-24) — SDNN estimator unified fleet-wide

The Phase-5 differential oracle surfaced a real cross-node discrepancy: **rMSSD is byte-identical**
everywhere, but **SDNN used different estimators** — `ecgdex-dsp.js` and `pulsedex-dsp.js` computed
**population** SD (`√(Σ/N)`), while `ppgdex-dsp.js` + `hrvdex-dsp.js` used **sample** SD (`√(Σ/(N−1))`).
**FIXED:** unified on **sample SD (÷N−1)** — the HRV Task Force (Malik et al. 1996) / Kubios / NeuroKit2
convention, which also removes a systematic offset ahead of the planned Kubios/NeuroKit2 agreement run.
PpgDex/HRVDex were already correct; `pulsedex-dsp.js` + `ecgdex-dsp.js` `std()` were changed (one line
each, with the existing `N<2 → 0` guard). HRVDex needed no change (it reads the imported SDNN value, it
doesn't compute it from RR). Both apps re-bundled; **Dex-Test-Suite all-green (848/60)**, the Phase-5
group now asserts DIRECT convergence (ratio ECGDex:PpgDex = 1.000); **verify-provenance GATE A re-passed**
(manifestHash ECGDex 43f2bfe9b3bb→89954db58d5c, PulseDex 725190b5c0a8→b889677acc89; buildHash unchanged,
external-JS-only; BUILD-MANIFEST.json updated). GATE B unaffected (no code-gated fixtures for these
bundles). Note: this also shifts every std-derived dispersion (epoch SDNN, cross-night SDNN baselines,
Bland–Altman SD) by √(N/(N−1)) — negligible (<0.1%) for full-night SDNN, slightly larger on short epochs;
intended.

## 6 · `SignalSpec` resolvers for new signal types are placeholders

`eeg`/`flow`/`hr`/`acc` entries point `dsp` at globals (`EEGDSP`, `SPIRODSP`, …) that don't exist —
correct as forward declarations (EEGDex/SpiroDex still need real new DSP per §0), but **unverified**.
When EEGDex/SpiroDex land, confirm the resolver names match what those nodes actually expose, and add
an `eeg`/`flow` round-trip to the `property-metamorphic` group.

## 8 · Phase-3 residue (manifest-as-single-source) — what's still hand-synced

Phase 3 projected the **registry** (`dex-registry-gen.js`) and the **reference guide** (`dex-gen.js`,
now cohesion-wired) from one manifest, proven on EEGDex through `cohesion-badges`. Two projection
targets named in the parent brief's Phase-3 "Work" are **deliberately deferred** (no generated node
needs them yet):
- **`*-cross.js` metric-def block** (`OXY_DEFS`/`CPAP_DEFS`/ECGDex `METRICS[]`, …) — generate it from
  the manifest when a generated node first needs a cross-night envelope. Until then it stays
  hand-written for the existing nodes (forward-first).
- **Integrator `GRADE_SOURCES`/`GRADE_MIRROR` row** for any fusion-surfaced metric — add to the
  generator when a generated node first emits a fused metric. The existing mirror stays hand-written +
  test-anchored (`Integrator evidence-grade mirror ≡ node registries`).

Also: the generated `codegen/generated/eegdex-reference.html` carries the `[PASTE DESIGN SYSTEM CSS
HERE]` placeholder (evidence/badge layer IS reconciled; the **layout** stylesheet is not inlined) — it
passes the text-based `cohesion-badges` gate but is an intentional scaffold, not a styled shippable
guide. Inline the design-system CSS only if/when EEGDex graduates from planned to a shipped node.
**Gate cost:** none (codegen + generated files + `tests/dex-tests.js`/runner wiring — no bundle, no
existing `*-dsp.js/*-app.js/*-cross.js` edited).

---

**Gate note:** items 1, 2, 4 (the `compute()` surface) ride PulseDex's / OxyDex's **Phase-9** migrations
(pay the re-bundle gate once per node, not per fix). **Item 3 (namespaced builds / iframe removal) is
DONE (2026-06-25)** — it paid the re-bundle gate for all 3 migrated apps. Items 5, 6 are unbundled/doc/test work → **zero
gate cost**. If you address an item, flip this header in place (never rename) and reflect it in
`DOCS-INDEX.md`; spawn `-FOLLOWUPS-II` only if new residue surfaces.

---

## 9 · ✦ RATIFIED (2026-06-24) — Phase-10 residue (what surfaced executing the OverDex capstone)

OverDex shipped (`OverDex.html` + `overdex-walk.js` + `overdex-app.js`), built on the **extracted shared
`signal-orchestrate.js`** — the unifier's isolated-PulseDex host + `emitRRNodeExport` lifted out of
`data-unifier-app.js` so OverDex reuses it rather than copying it. That move **consolidated** item 1's
reach-in (it now lives in ONE module instead of being a copy waiting to be made), but did **not** remove
it — these carry forward:

- **9a · OverDex inherits items 1–3 transitively.** Its RR path calls the same private PulseDex globals
  (`_pdSeriesStats`, `artifactClean`) and re-implements only the `hrv_drop` windowing (no `stress_peak`,
  item 2). When PulseDex's Phase-9 `compute()` lands, **both** the unifier and OverDex switch to it in
  one edit to `signal-orchestrate.js` — the single chokepoint is now the payoff of the extraction.
  **✅ DONE (2026-06-24):** PulseDex Phase-9 landed and the predicted one-edit happened —
  `signal-orchestrate.js` now calls `pw.PulseDex.compute()`, so BOTH the unifier and OverDex emit the
  full PulseDex event set (items 1+2 closed) through that single chokepoint. No reach-in remains.
- **9b · Orchestrator path (a) — headless-drive a SEALED bundle in a hidden iframe — is NOT built.**
  OverDex implements only path (b)-lite (isolated DSP for RR) + `*_ganglior.json` passthrough. A raw
  vendor file for a node that has **neither** an adapter **nor** a pre-export (e.g. a raw O2Ring CSV, a
  raw Lingo CGM CSV) is therefore correctly **set aside as unknown**, not run. So the mixed-folder demo
  fuses OxyDex/GlucoDex **only via their already-exported** `*_ganglior.json`, not from their raw files.
  Honest + safe (never guessed), but state it: OverDex's raw-file coverage == adapter coverage (RR
  only) until either more adapters land (item 4) or the hidden-iframe bundle-driver is built. Per the
  brief, reliability rises with every Phase-9 migration; building the iframe driver is the alternative
  for un-migrated nodes — deferred, not done.
  **Update (2026-06-24):** OxyDex Phase-9 (§4) landed, so OverDex's raw-file coverage is now **RR +
  SpO₂** (Polar/Coospo/Wahoo RR → PulseDex; O2Ring/Wellue CSV → OxyDex), both via live isolated
  compute — not just `*_ganglior.json` passthrough. The hidden-iframe sealed-bundle driver is still
  not built; coverage continues to rise one node-migration at a time (CGM/ECG raw still pass through
  as exports until their Phase-9).
- **9c · OverDex is unbundled and should STAY unbundled** — same iframe-isolation blocker as the unifier
  (item 3), and a folder-walk tool is inherently live-served anyway. No provenance fixture taken.
- **9d · (fixed in passing) `#fusion` base CSS was `display:none`; showing it via `style.display=''`
  fell back to `none`** — the result panel silently rendered zero-height until set to `'block'`. Trivial,
  fixed in `overdex-app.js`; noted so any future host-canvas/result panel with a `display:none` base
  uses an explicit display value, not `''`, to reveal.

**Gate cost of Phase 10:** none. New unbundled files; the `data-unifier-app.js` / `Data Unifier.html`
edits are unbundled UI the test suite does not import (grep-confirmed: no test references
`data-unifier`, `signal-orchestrate`, or `overdex`). No `*-dsp.js/*-cross.js/*-app.js` node module
edited, no bundle re-built — both gates untriggered.

> **Ratification (2026-06-24)** — §9 reviewed against the shipped code; no code change needed, all
> four sub-items confirmed in their intended state:
> - **9a — consolidated (not removed).** The PulseDex reach-in (`_pdSeriesStats` + the `hrv_drop`-only
>   windowing) lives in exactly ONE place, `signal-orchestrate.js`; both `data-unifier-app.js` and
>   `overdex-app.js` route through `SignalOrchestrate.emitRRNodeExport` (verified — neither re-implements
>   it). The `// TODO: call PulseDex.compute once migrated` chokepoint marker is present at the module
>   head. Closure rides PulseDex's Phase-9 `compute()` (item 1), one edit here when it lands.
> - **9b — confirmed deferred.** No sealed-bundle iframe driver exists; OverDex's `classify()` routes raw
>   files only via adapters (RR) else JSON passthrough else *set aside* — raw-file coverage == adapter
>   coverage, by design. Building the driver is the alternative for un-migrated nodes; not done, per brief.
> - **9c — confirmed unbundled.** No `OverDex` bundle / provenance fixture exists or should; GATE A/B
>   untouched.
> - **9d — shipped.** `OverDex.html:87` `#fusion{…display:none}` is revealed via the explicit
>   `fusionEl.style.display = 'block'` in `renderFusion` (never `''`). Verified live.
>
> `Dex-Test-Suite.html` re-run all-green (783/51); no `*-dsp.js/*-app.js/*-cross.js` touched and no bundle
> re-built, so both gates stay untriggered (zero gate cost, as the section predicted). No new residue
> surfaced → no `-FOLLOWUPS-II` spawned. Items §§1·2·3·4·5·6·8 remain open.
