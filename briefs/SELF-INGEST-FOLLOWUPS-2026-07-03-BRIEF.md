<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-07-04 (all 6 nodes — OxyDex pilot + Pulse/Gluco/ECG/HRV/Ppg — each re-ingest their OWN export as a review-mode clinical view: `loadOwnExport` + shared scrub + review UI + a §7 group, both runners; D1 folded, D2 decided+executed; every gate green) · **Follow-up:** `SELF-INGEST-FOLLOWUPS-II-2026-07-04-BRIEF.md` (F1 multi-carrier scrub gap · F2 review-render coverage · F3 export-shape audit) — was IN-PROGRESS — **CPAPDex pass DONE 2026-07-04** · **PulseDex pass DONE 2026-07-04** (`pulseLoadOwnExport` + shared scrub + namespace + 23-assert §7 group, re-bundled `267bc6ba85d9`, gates green; engine + review-mode UI shipped (`pulseReviewView` + `loadRawFiles` envelope route), re-bundled `3ecc15845d1b`) · **GlucoDex pass DONE 2026-07-04** (enrich-engine + review UI; `1e76009222ae`→`861bcf0923eb`, gates green) · **ECGDex pass DONE 2026-07-04** (engine + review UI; `9d3beb7575a6`→`1711e0b08098`, gates green) · **HRVDex pass DONE 2026-07-04** (enrich-engine + review UI; `1721a312d952`→`8c3150307a24`, gates green) · **PpgDex pass DONE 2026-07-04** (engine + review UI; `ec1a1753cd07`→`59ba60fc079b`, gates green) — **ALL 5 NODES COMPLETE (engine + review UI)** · **Decisions:** D1 = **shared helper** (`dexScrubExport` in `dex-export.js`; OxyDex's node-local `oxyScrubExport` **folded in — DONE 2026-07-04**: now a thin delegate to `DexExport.scrubExport`, duplicate body removed. The shared version is a strict superset — it also strips device/serial/model from each per-night `recording` block in a multi-night series, a gap the old local copy missed. Export-inert [scrub is OFF by default, not in the compute/fixture path]: OxyDex re-bundled `692a7b110ef9→313731f49b34`, GATE A + both fixtures re-recorded [manifestHash only], `docs/OxyDex.html` synced, both gates green [`?full` 1773 passed incl. `env.equiv.oxydex` + OxyDex self-ingest §7 scrub; `verify-provenance` A/B clean]) · D2 = **enrich both (path b) — DECIDED 2026-07-04**: path (a) lean is rejected for BOTH (a lean view carries almost no clinical content for these two — see §0.1/§2). PpgDex → reuse the EXISTING `opts.rich` branch (no new builder); HRVDex → add a per-measurement `measurements[]` carrier (rows already at build time). Decision-only this pass (no code / no gate churn); each enrichment is fixture-moving and runs in its own node pass (§5 enrich-first branch), which the [D2 gate] in §3 now unblocks · **Created:** 2026-07-03 · **Executed-residue-of:** `SELF-INGEST-2026-06-27-BRIEF.md` (DONE 2026-07-02, pilot OxyDex) · **Prerequisite:** the OxyDex pilot pattern (`oxyLoadOwnExport` / `oxyScrubExport` + review-mode render/clinical-print/scrub, `oxydex-dsp.js` / `oxydex-render.js` / `oxydex-app.js`)

# Self-ingest roll-out — `loadOwnExport` clinical summary for the other six nodes

> **One-line:** The OxyDex pilot proved the pattern (drop a node's OWN `ganglior.node-export` back in →
> faithful, print/PDF **clinical summary** in review mode; no recompute, no re-stamp; raw panels greyed;
> foreign-node guard; scrub-for-sharing). Roll it to the remaining six — **one node per pass, each
> re-bundle + gate-gated** — but NOT as a blind copy: execution of the pilot surfaced that **two nodes'
> exports don't carry a per-element derived layer at all**, so they need a decision, not a mechanical port.

> **✅ CPAPDex pass — DONE checkpoint (2026-07-04) · next node: PulseDex (Tier 1).**
> Code (2026-07-03, unchanged since): `dex-export.js` shared `scrubExport` (D1) · `cpapdex-fusion.js` `cpapLoadOwnExport` · `cpapdex-render.js` review view · `cpapdex-app.js` routing/scrub-checkbox. Bundle settled + reconciled: CPAPDex `manifestHash 7136e9cd5642` in ledger + both gates green (GATE A/B clean; fixtures export-inert as predicted — no regenerate).
> Tests (2026-07-04): `Self-ingest (CPAPDex)` group added to `tests/dex-tests.js` after the OxyDex §7 group (22 asserts: round-trip · faithful-view byte-equality · nights[] carrier + event gather/sort · provenance-verbatim + source no-restamp · `_fromExport`/`_reviewMode` · foreign-node guard + not-node-export · shared-scrub incl. purity + reload-after-scrub); `cpapdex-fusion.js` added to BOTH runners' `sources` lists (`tests/run-tests.mjs` + `Dex-Test-Suite.html`). All 22 verified green headless; full `?full` gate re-run same day.
>
> ~~**⏳ CPAPDex pass — IN-PROGRESS checkpoint (2026-07-03) · RESUME HERE.**~~ (superseded by the DONE checkpoint above; original todo list kept below for the PulseDex-pass pattern)
> **Code landed (external JS only — `CPAPDex.src.html` NOT touched, so `buildHash` stays; `manifestHash` moves):**
> - `dex-export.js` — shared `scrubExport` (D1), exposed as `DexExport.scrubExport` + bare `dexScrubExport`.
> - `cpapdex-fusion.js` — `cpapLoadOwnExport(json)` (detect · guard `schema.node==='CPAPDex'` · unwrap `nights[]` \| single-obj · gather+sort events · mark `_fromExport`/`_reviewMode`; NEVER `.stamp()`), on `CpapFusion`.
> - `cpapdex-render.js` — `renderReviewView` + `cpapReviewBanner`/`cpapClinicalSummary`/`cpapEventTimeline`/`cpapGreyedPanel`/`injectSelfIngestCSS`, on `CpapRender`. Clinical card reads the export element's stored fields DIRECTLY (no night reconstruction — CPAPDex has no summary→night path unlike OxyDex's `parseJSONL`); greys raw flow/pressure/leak; `@media print` isolates `.cpap-clinical`.
> - `cpapdex-app.js` — `handleFileList` routes a CPAPDex own-export → `cpapLoadOwnExport` → `window._cpapReview` → `renderReview()`; OxyDex/ECGDex still → `CpapCoimport`. `exportNight()` review branch stamps `schema.derivedFrom` (+ optional scrub); normal path also honors scrub. Reset + `renderResults` clear review. Scrub checkbox injected into `#exportBar` (`window._cpapScrub`).
>
> **Remaining (todos 8–11):**
> 1. **Tests** — add a `Self-ingest (CPAPDex)` group to `tests/dex-tests.js` (BOTH runners), placed after the OxyDex §7 group. Source: `env.CPAPDex.compute({edfSets:[env.CpapDsp._synthEdfSet({oxi:true,cs:true})]})` → `env.CpapFusion.cpapLoadOwnExport`. Reach scrub via **`env.DexExport.scrubExport`** (env exposes `DexExport`/`CPAPDex`/`CpapFusion`/`CpapDsp` in both runners; there is **no** `env.dexScrubExport`). Source-text for the no-restamp assert: `env.sources['cpapdex-fusion.js']`. Mirror OxyDex §7: round-trip · faithful-view (element==export) · provenance-no-restamp (strip comments, assert no `.stamp(`/`GangliorProvenance`) · review-not-faked (`_fromExport`) · foreign-node guard (ECGDex → message names source + Integrator) · scrub.
> 2. **Re-bundle** `CPAPDex.html` from `CPAPDex.src.html`; let it settle; **re-read** the new `manifestHash`.
> 3. **GATE A** — set CPAPDex's `BUILD-MANIFEST.json` entry to the new `manifestHash`.
> 4. **GATE B** — CPAPDex fixtures are **EXPORT-INERT** (scrub opt-in; goldens built without scrub; reload doesn't change emit) → re-record `manifestHash` ONLY for CPAPDex fixtures in `FIXTURE-PROVENANCE.json`; do NOT regenerate.
> 5. **⚠ shared-file blast radius** — `dex-export.js` is bundled into all 8 apps; editing it MAY auto-rebuild others → their `manifestHash` may drift. After the build settles, re-read `verify-provenance.html`; if other nodes moved, re-record them too (still export-inert — `scrubExport` is behavior-inert for non-callers). Per CLAUDE.md: if GATE A/B already reconcile, do NOT hand-edit (concurrent-writer rule).
> 6. **Gates** — `Dex-Test-Suite.html?full` all-green (new group + `env.equiv.cpapdex_golden` + multinight golden must stay green — they SHOULD, emit unchanged) + `verify-provenance.html` GATE A/B clean.
> 7. **Sync** `DOCS-INDEX.md` + flip this brief to `Status: DONE — <date>` for the CPAPDex pass, then start the next node (order: PulseDex next).
>
> **Gotchas:** carrier = `nights[]` (multi) or the object itself (single; detect `recording && (metrics||oximetry)`); event impulses = `apnea/hypopnea/rera/periodic_breathing/desat_event/large_leak`; the review view renders the export element directly (never rebuilt into a night).

---

## 0. What the pilot proved — and the carrier reality it exposed (verify, don't trust)

The pilot brief §1/§6 *assumed* every node-export carries a per-element summary array
(`recordings[]` for ECGDex/PulseDex, `sessions[]` for PpgDex). **That is only partly true — confirmed by
reading the builders 2026-07-03.** The self-ingest clinical view is only as rich as what the export
actually stores, so the roll-out splits into three feasibility tiers:

| Node | Export carrier (the array/obj to unwrap) | Builder | Derived layer in the export | Feasibility |
|---|---|---|---|---|
| **OxyDex** ✅ | `nights[]` (single = obj) | `oxyBuildNightElement` | **rich** per-night summary | **DONE (pilot)** |
| **PulseDex** | `recordings[]` (`pulsedex-app.js:642`) | `pdBuildNodeExport` | **rich** per-recording (`lastResult` shape) | **Tier 1 — mechanical** |
| **CPAPDex** | `nights[]` (`cpapdex-fusion.js:257`) | `cpapBuildExport` | **rich** per-night | **Tier 1 — mechanical** |
| **GlucoDex** | single recording obj | `glucodex-app.js` (~794; confirm a shared `glucoBuildNodeExport` was extracted) | **rich** (glucose stats · patterns · `timeseries.cells`+`agpHourly`+`perDay`) | **Tier 2 — single-record** |
| **ECGDex** | single obj / `recordings[]` (multi) | `ecgBuildNodeExport` (`ecgdex-dsp.js:1867`) | rich **only under `opts.rich`** (`hrv.time` · `frequency` · `timeseries.epochs` · `morphology` · `sleepStages`) — the light stream is events-heavy | **Tier 2 — confirm rich-mode** |
| **PpgDex** | **single obj — NO carrier** (`ppgdex-dsp.js:1015`: `{ schema, recording, ganglior_events, reserved }`) | `ppgBuildNodeExport` | **event-only + `recording` meta** — no per-session summary | **Tier 3 — needs a decision** |
| **HRVDex** | **single obj — NO carrier** (`hrvdex-dsp.js:~795`: `recording.measurements:N` + events, no per-measurement rows) | `hrvBuildNodeExport` | **event-only + aggregate** — the per-day SDNN/rMSSD table is NOT in the export | **Tier 3 — needs a decision** |

**Why Tier 3 is not a port.** OxyDex self-ingest works because `nights[]` carries the full per-night
summary — the review renderer shows stored values verbatim. **PpgDex and HRVDex exports carry only
`ganglior_events[]` + aggregate `recording` metadata**, so a "faithful clinical summary" for them can
show the event timeline + span/coverage aggregates and *nothing else* — no per-metric KPI cards, no
findings table — unless their export shape is first enriched to carry a per-element summary. That
enrichment **MOVES fixture bytes** (it changes the emit shape), so unlike the pilot (which was
export-inert re-ingest only) it triggers the FULL per-node fixture regenerate + re-record ritual.

### 0.1 Decisions to make BEFORE touching code (record the answer in this header when settled)
- **D1 — scrub: shared helper vs per-node duplicate.** `oxyScrubExport` is already near node-agnostic
  (it operates on `schema.provenance.inputs[]` + `recording.{device,serial,model}`, keeps a coarse
  build stamp + `contentId`). Either lift it to ONE shared `dexScrubExport(envelope)` (each node's app
  calls it) **or** duplicate per node in the `parseTimestamp` house tradition (CLAUDE.md leans
  duplicate for parser-class utils — but scrub is not a parser and is genuinely identical across nodes).
  Recommendation: **one shared helper** in a small existing shared module; decide and note it.
- **D2 — Tier 3 (PpgDex/HRVDex): accept-lean vs enrich-first.** Either **(a)** ship a lean review view
  (event timeline + aggregates + the honest "this export carries no per-metric summary" note) —
  **export-inert, cheap**; or **(b)** enrich `ppgBuildNodeExport` / `hrvBuildNodeExport` to carry a
  per-element summary array FIRST (fixture-moving — full regenerate + re-record + re-bundle), then the
  clinical view is as rich as the others. Pick per node; (a) is a fine v1 that (b) can supersede later.
  - **✅ DECIDED 2026-07-04 — (b) enrich-first for BOTH.** Path (a) is rejected for these two because a
    lean view would carry almost no clinical content (unlike the Tier-1/2 nodes whose exports are already
    rich): HRVDex's per-measurement table IS its whole value, and PpgDex (a) is "raw-only nearly
    everything" → an event timeline and nothing else. Both enrichments are **fixture-moving** (regen +
    re-record + re-bundle; the node's `env.equiv` leg reds until regenerated — GATE C working), so each
    runs in its OWN node pass via §5's enrich-first branch; this D2 execution is **decision-only** (no code).
    - **PpgDex → reuse the EXISTING `opts.rich` branch (no new builder).** `ppgBuildNodeExport` already
      emits, under `opts.rich`, `hrv.time.{rmssd,sdnn}` + `hrv.frequency` + `quality` + `timeseries`
      (built, tested, ECGDex-shape-aligned; today only `signal-orchestrate.emitPpgNodeExport` opts in).
      Enrichment = have the app's `exportGanglior` emit rich. **Integrator-safe** — `adaptEnvelopeNode('PpgDex')`
      already consumes that rich slice, so a rich app export is a SUPERSET, not a break.
    - **HRVDex → add a per-measurement carrier.** The rows are already present at build time (`contentId`
      folds `dated.map(r=>{t,rmssd,sdnn,hr})`) but only `recording.measurements:N` (a count) is carried.
      Add a `measurements[]` array of per-row `{tMs, hr/meanRR, rmssd, sdnn, pnn50, sd1/sd2, coverage}` +
      the vendor black-box composites tagged `meta.derived`/heuristic — **no tier upgrade on reload**, honor
      the Baevsky ms-vs-s guard. Reload extends the existing foreign-JSON ingest at `hrvdex-dsp.js:318`.
    - **Fleet-consistency note (for the ECGDex pass, not expanded here):** ECGDex has the same light/rich
      split (rich only under `opts.rich`); the PpgDex decision (app emits rich) implies ECGDex should align
      for a rich clinical view — recorded as a consideration, decided in the ECGDex pass.
- **D3 — reconstruction reuse.** The pilot reused OxyDex's existing `parseJSONL` (summary-element →
  renderable night). Each node needs a summary→renderable path. **Confirm per node** whether one
  already exists (PulseDex/HRVDex have foreign-JSON ingest paths to extend; HRVDex's ECGDex-JSON ingest
  is at `hrvdex-dsp.js:318`); if none, the review renderer reads the export element's stored fields
  directly (no recompute).

---

## 1. The generic contract (node-agnostic — recap of the pilot, do NOT re-derive)

Every node's `loadOwnExport(json)` is the SAME shape the pilot shipped; only the carrier key + the
per-element reconstruction + which panels are raw-only + the clinical KPI set are node-specific.

1. **Detect** — `json && json.schema && json.schema.name === 'ganglior.node-export'`.
2. **Guard own kind** — `json.schema.node === <ThisNode>`; a foreign export is **rejected with a
   redirect message** (`"This is an <X> export — open it in <X>, or drop it into the Integrator to
   fuse."`), never coerced. (Mirror `oxyLoadOwnExport`'s message.)
3. **Unwrap** — read the node's carrier (table §0); a single-record export is the object itself.
4. **Reconstruct** the derived layer via the node's existing summary→render path (D3) — **no recompute
   beyond a deterministic stored-scalar re-derive that reproduces the stored value**; prefer the stored
   value, treat divergence as a review-mode bug (never silently shown).
5. **Mark `reviewMode`** (`_fromExport`/`_reviewMode` per element) + return `provenance`/`generated`/
   `derivedFrom`/`kernel`/`crossNight`/`events`/`scrubbed` **verbatim**.
6. **Never** call `GangliorProvenance.stamp()` on this path (that stamps the current build over the
   original). A review-mode **re-export writes `schema.derivedFrom`** (original buildHash + `via`).
7. **Expose on the namespace** (`<Node>.loadOwnExport`, `<Node>.scrubExport`) AND in the shared
   `Object.assign(global, {...})` export list so **both runners** reach the same functions.

The render side is likewise a recap: inject the self-ingest CSS from the external JS (not the shell),
gate on `window._<node>Review` **and** every loaded element `_fromExport`, lead with the review banner +
clinical summary (findings → badged KPIs → event timeline → provenance → intended-use disclaimer +
`dxl-` stamp), grey (never fake) any panel that needs raw samples, and `@media print` isolate the
clinical card. Reuse OxyDex's `oxyClinicalSummary`/`oxyReviewBanner`/`oxyEventTimeline`/`oxyGreyedPanel`
as the reference implementations — port their structure, swap the node's KPI/raw-panel specifics.

---

## 2. Per-node execution notes (the node-specific labor)

**PulseDex (Tier 1).** Carrier `recordings[]` (each a `lastResult`-shaped rich summary). Raw-only →
grey the **RR tachogram** + **Poincaré scatter** (per-beat). Extend PulseDex's file-drop/compare import
to detect the envelope; reconstruct via the summary→render path (confirm D3). Clinical KPIs: rMSSD,
SDNN, mean RR/HR, SD1/SD2, coverage. Export-inert → re-record only.
> **✅ PulseDex ENGINE — DONE checkpoint (2026-07-04).** Correction to the note above: the PulseDex export is
> **single-record + RICH** (`recording` + `hrv.{time,frequency,poincare}` + `summary`), NOT a `recordings[]`
> carrier — so reconstruction reads the stored derived layer directly (no re-derive). Landed: `pulseLoadOwnExport`
> (`pulsedex-dsp.js`, detect → own-node guard → unwrap [single-record, optional `recordings[]` wrapper] → review
> flags → provenance/kernel/events VERBATIM, no `.stamp(`) + `PulseDex.loadOwnExport` + `PulseDex.scrubExport`
> (lazy delegate to the shared `dexScrubExport`, D1) on the namespace + Object.assign list. Tests: `Self-ingest
> (PulseDex)` group in `tests/dex-tests.js` (both runners, 23 asserts: round-trip · faithful-view byte-equality ·
> `recordings[]` carrier + event gather · provenance no-restamp · review flags · foreign-node guard · shared scrub).
> Export-inert: re-bundled `d2e360b193eb→267bc6ba85d9`, GATE A + both PulseDex fixtures re-recorded (manifestHash
> only), `docs/PulseDex.html` synced; gates green (`?full` 1796 passed / 119 groups / 0 boot-skips incl. the new
> group + `env.equiv.pulsedex`; `verify-provenance` A/B clean). **✅ PulseDex review-mode UI — DONE 2026-07-04**: shipped
> (`pulsedex-render.js` banner + clinical summary from the stored hrv/summary, grey the RR tachogram + Poincaré
> scatter; `pulsedex-app.js` file-drop envelope-detect → `_pulseReview` + review gate + `exportGanglior` no-restamp)
> — the engine is reachable via the namespace + tests today; the UI lights it up for the user. Then next node: GlucoDex.
> **UI injection point (confirmed 2026-07-04, turnkey):** `loadRawFiles(fileList)` (`pulsedex-app.js` ~L78) reads each
> file's text → `document.getElementById('rawPaste').value = it.text` → `calculate()`. Detect a `ganglior.node-export`
> JSON THERE (try/parse; `schema.name==='ganglior.node-export'`) and route to `pulseLoadOwnExport` + a new
> self-contained `pulseReviewView(review)` in `pulsedex-render.js` (banner + KPI grid from `review.hrv`/`summary`/
> `recording` + event timeline + greyed RR-tachogram/Poincaré panels + disclaimer), skipping `calculate()` for that
> file; a foreign envelope shows `res.message`. Review mode is display+print only (no `lastResult`), so `exportGanglior`
> (guards `if(!lastResult) return`) needs NO change. External-JS-only → re-bundle + GATE-A + export-inert re-record.

**CPAPDex (Tier 1).** Carrier `nights[]` (`cpapBuildExport`). Raw-only → grey per-session **pressure /
leak / flow** curves. KPIs: residual AHI, therapy hours, central/obstructive/hypopnea index, median
leak, periodic-breathing %. The `env.equiv`/CPAPDex synthetic goldens already pin
`compute() ≡ cpapBuildExport`, so keep the reload path off the emit builder. Export-inert → re-record.

**GlucoDex (Tier 2).** Single recording obj; **rich** — `glucose` stats + `patterns` + decimated
`timeseries.cells` + `agpHourly` + `perDay` all travel, so most of the dashboard renders from the
export. Raw-only → grey only the full-resolution per-reading trace (the AGP renders from the carried
decimation — label it "from export decimation", don't fake full-res). Confirm the node-export builder
was extracted to a DSP `glucoBuildNodeExport` (SIGNAL-ADAPTER-PHASE9) before wiring; if still in
`glucodex-app.js`, the reload path must not re-enter DOM. KPIs: mean glucose/GMI, CV, TIR, MODD/ADRR,
dawn Δ. Export-inert → re-record.
> **⚠️ CORRECTION (verified 2026-07-04) — this note's "rich" premise is WRONG; GlucoDex is a Tier-3-style
> light export, so it needs D2's enrich-vs-lean decision, NOT a mechanical export-inert pass.** The actual
> `glucoBuildNodeExport` (`glucodex-dsp.js`) carries ONLY `recording:{source, contentId, startEpochMs,
> events, clamp}` + `ganglior_events[]` + `reserved` — **NONE** of `glucose` stats / TIR / GMI / CV / MODD /
> ADRR / `patterns` / `agpHourly` / `perDay` / `timeseries` travel (they exist on the `analyze()` result `r`
> at build time but are dropped by the builder, exactly like PpgDex/HRVDex). So a faithful clinical view can
> **not** render the glycemic dashboard from the export today.
> **✅ D2-style decision (2026-07-04): (b) enrich-first** — GlucoDex's whole clinical value is TIR/GMI/CV/
> variability, so a lean view is near-worthless (same logic as HRVDex). Enrich `glucoBuildNodeExport` to carry
> a `glucose` summary block (mean/GMI/CV/TIR bands/MODD/ADRR/`daypart`/`dawn`) + the decimated `agpHourly` (for
> the AGP), reading the fields already on `r`. **Fixture-moving** (regenerate + re-record + re-bundle; the
> `env.equiv.glucodex` leg reds until regenerated — GATE C). Builder is DSP-extracted + DOM-free (confirmed),
> so the reload path is safe. Grey only the full-resolution per-reading trace. This is now the same shape of
> pass as HRVDex/PpgDex, not the export-inert twin the note assumed.
> **✅ GlucoDex enrich-ENGINE DONE 2026-07-04.** Enriched `glucoBuildNodeExport` with the `glucose` summary
> block (mean/GMI/ea1c/sd/cv/`tir`/titr/mage/modd/adrr/gvp/lbgi/hbgi/stabilityScore/pctActive/tier/dawn/
> daypart — all read off the `analyze()` result `r`). Added `glucoLoadOwnExport` + `GlucoDex.loadOwnExport`
> + `GlucoDex.scrubExport` (shared `dexScrubExport`, D1) + the `Self-ingest (GlucoDex)` §7 group (both
> runners). **Fixture-moving, verified purely additive** — regen diff showed new-export-minus-`glucose` ==
> old fixture byte-for-byte (contentId + events unchanged); regenerated `GlucoDex_2026-06-27_equiv.node-export.json`
> (outputHash `1489fce3588bffc2→96d02169511cca21`, inputHash unchanged), re-bundled `037f54e14ec5→1e76009222ae`,
> GATE A + fixture re-recorded, `docs/GlucoDex.html` synced. Gates green (`?full` 1814 passed / 120 groups /
> 0 boot-skips incl. `env.equiv.glucodex` regreened + the new group; `verify-provenance` A/B clean).
> **✅ GlucoDex review-mode UI — DONE 2026-07-04**: `glucoReviewView`/`glucoRenderReview` (co-located in `glucodex-app.js`, intra-IIFE) render the glycemic dashboard from the stored `glucose`
> block + event timeline; `loadCSV` detects a dropped envelope → `glucoLoadOwnExport` → review; full-resolution
> trace greyed. External-JS-only re-bundle `1e76009222ae`→`861bcf0923eb`, export-inert (fixture manifestHash-only),
> docs synced, gates green (`?full` 1814 passed, `verify-provenance` A/B clean). **GlucoDex pass COMPLETE.**

**ECGDex (Tier 2).** Single obj / `recordings[]` (multi). Rich derived layer exists **only under
`opts.rich`** — first confirm what `ecgdex-app.js` emits by default; if the shipped export is the light
(events-heavy) stream, the clinical view is timeline-led (like Tier 3) unless rich is the default or
opt-in. Raw-only → grey the **ECG waveform** + **per-beat morphology**. KPIs: mean/min/max HR, SDNN/
rMSSD (if rich), AF burden / ectopy counts, sleep-stage minutes (if rich). Note: `ecgBuildNodeExport`
strips the internal `_sec` — the reload must not expect it.
> **✅ ECGDex engine DONE 2026-07-04 (EXPORT-INERT).** Verified: `buildV2`/`exportSummary` (single) + the
> multi wrapper ARE rich `ganglior.node-export`s (recording + quality + hrv + epochs); `exportGanglior` is the
> light one. `ecgLoadOwnExport` (`ecgdex-dsp.js`) reads EITHER — single or `recordings[]`, rich-or-light —
> provenance/kernel/events verbatim, never re-stamps. + `ECGDex.loadOwnExport`/`scrubExport` (shared `dexScrubExport`,
> D1) + the `Self-ingest (ECGDex)` §7 group (representative buildV2-shaped export + a guarded genSynthetic→compute
> leg, both runners). No enrichment needed. Re-bundled `1c05720e361c→9d3beb7575a6`, GATE A + fixture manifestHash
> only (export-inert), docs synced, gates green (`?full` 1833 passed / 121 groups; `verify-provenance` A/B clean).
> **✅ ECGDex review-mode UI DONE 2026-07-04**: `ecgReviewView`/`ecgRenderReview` (co-located in `ecgdex-app.js`) render the HR/HRV/quality dashboard from stored `hrv`/`quality` + event timeline; `loadFiles` detects a dropped envelope → `ecgLoadOwnExport` → review; ECG waveform + per-beat morphology greyed. External-JS re-bundle `9d3beb7575a6`→`1711e0b08098`, export-inert, docs synced, gates green (`?full` 1833 passed). **ECGDex pass COMPLETE.**

**PpgDex (Tier 3 — D2).** Export is `{ schema, recording, ganglior_events, reserved }` — **no per-
session summary**. Path (a): lean review = event timeline + `recording` aggregates + an honest "no
per-metric summary in this export" panel. Path (b): enrich `ppgBuildNodeExport` with a `sessions[]` (or
single-summary) carrier FIRST → fixture-moving, full regenerate + re-record + re-bundle. Raw-only under
(a): nearly everything (optical waveform, LED-agreement ribbon, Poincaré).
> **✅ D2 → (b) enrich — DECIDED 2026-07-04.** Do NOT write a new `sessions[]` builder — **reuse the
> EXISTING `opts.rich` branch** already in `ppgBuildNodeExport` (`hrv.time.{rmssd,sdnn}` + `hrv.frequency`
> + `quality` + `timeseries`, ECGDex-shape-aligned, tested). The pass = make the app's `exportGanglior`
> emit rich (fixture-moving: PpgDex equiv fixture + committed export move light→rich; expect the equiv leg
> red until regenerated). Integrator-safe (`adaptEnvelopeNode('PpgDex')` already reads the rich slice). The
> clinical view then renders whole-record HRV + quality; grey only the true raw panels (optical waveform,
> LED-agreement ribbon, per-beat Poincaré).
> **⚠️ CORRECTION (verified 2026-07-04) — PpgDex is EXPORT-INERT, not fixture-moving (same as ECGDex).** The
> D2 "flip the app to opts.rich" enrich above is UNNECESSARY: `ppgdex-app.js` already has a RICH export path —
> `buildV2` (~L504, the `exportSummary`/"full AI-readable JSON") emits `schema.node:'PpgDex'` + `hrv:{time,
> frequency,nonlinear}` + `personalization` + `apnea`, and the multi-session `exportSummary` wraps
> `{schema…multiSession, crossNight, …}`. So `ppgLoadOwnExport` just READS whatever the dropped export carries
> (rich `buildV2` OR the light `exportGanglior` stream), like `ecgLoadOwnExport` — **no builder change, no
> fixture regen, re-bundle is export-inert (manifestHash-only)**. Pass = `ppgLoadOwnExport` (single obj +
> optional `sessions[]`/`recordings[]` multi wrapper, rich-or-light) + `PpgDex.scrubExport` (shared D1) + §7
> group + review UI (`loadFiles` at ppgdex-app.js:48 — prepend a `.json` envelope check → review; grey optical
> waveform + LED-agreement + Poincaré) + re-bundle + gates. The `opts.rich` app-flip is moot.
> **✅ PpgDex engine DONE 2026-07-04 (EXPORT-INERT).** `ppgLoadOwnExport` (`ppgdex-dsp.js`) reads a PpgDex
> node-export (single obj OR `sessions[]` multi wrapper), rich-or-light, provenance/kernel/events verbatim,
> never re-stamps. + `PpgDex.loadOwnExport`/`scrubExport` (shared D1) + the `Self-ingest (PpgDex)` §7 group
> (representative buildV2-shaped export, both runners). No enrichment. Re-bundled `cd9d429ac92d`→`ec1a1753cd07`,
> GATE A + fixture manifestHash only, docs synced, gates green (`?full` 1869 passed / 123 groups; `verify-provenance`
> A/B clean). **✅ PpgDex review-mode UI DONE 2026-07-04** — `ppgReviewView`/`ppgRenderReview` (co-located in `ppgdex-app.js`) render the PPG-HRV dashboard from stored hrv/quality + event timeline; `loadFiles` intercepts a dropped PpgDex-own envelope → `ppgLoadOwnExport` → review; optical waveform + LED-agreement ribbon + Poincaré greyed. Re-bundled `ec1a1753cd07`→`59ba60fc079b`, export-inert, gates green. **PpgDex pass COMPLETE — 5-node roll-out DONE.** Original plan: **⏳ UI remaining**
> prepend a `.json` envelope check → review; grey optical waveform + LED-agreement ribbon + Poincaré).

**HRVDex (Tier 3 — D2).** Export carries `recording.measurements:N` + `ganglior_events[]` but **NOT the
per-measurement SDNN/rMSSD/MeanRR/pNN50 table** — that is the whole clinical value, so path (a) is very
lean here. Strongly consider path (b): enrich `hrvBuildNodeExport` to carry the per-measurement rows
(fixture-moving). HRVDex already has a foreign ECGDex-JSON ingest at `hrvdex-dsp.js:318` — extend the
same drop path to detect + route its OWN `node:"HRVDex"` envelope. Watch the Baevsky ms-vs-s guard and
the `meta.derived`/heuristic tier on the vendor black-box composites — **no tier upgrade on reload**.
> **✅ D2 → (b) enrich — DECIDED 2026-07-04.** (a) is near-worthless here (the per-measurement table IS
> the clinical value). The pass = add a `measurements[]` carrier to `hrvBuildNodeExport` — per-row
> `{tMs, hr/meanRR, rmssd, sdnn, pnn50, sd1/sd2, coverage}` (+ the vendor composites tagged
> `meta.derived`/heuristic). The rows are ALREADY at build time (the `contentId` folds
> `dated.map(r=>{t,rmssd,sdnn,hr})`), so this is a carry, not a recompute. Fixture-moving (regenerate +
> re-record + re-bundle; equiv leg reds until regen). Honor the Baevsky ms-vs-s guard; **no tier upgrade**.
> **Turnkey plan (fields gathered 2026-07-04, ready to execute):** in `hrvBuildNodeExport` (`hrvdex-dsp.js`),
> add `measurements: dated.map(r => …)` right beside the existing `recording`. Per-row fields (all off the
> `_`-prefixed row, transparent ones stay **null when absent** — `numOrNull` already did that): `tMs:r._tMs,
> offsetMin:r._offsetMin, hr:r._hr, meanRR:r._meanRR, sdnn:r._sdnn, rmssd:r._rmssd, pnn50:r._pnn50, mxdmn:r._mxdmn`
> + derived Poincaré `sd1 = _rmssd/√2`, `sd2 = √(max(0, 2·_sdnn² − sd1²))` (same formula as `computeDerived`
> d_sd1/d_sd2 — deterministic from rmssd/sdnn, so no render dependency). Vendor black-box composites
> (`_stress/_energy/_focus/_sns/_psns/_coherence/_hrv`) go under `meta:{derived:true, tier:'heuristic'}` — carry
> only if PRESENT (>0), never a fabricated 0 (SIGNAL-ADAPTER §8 #2); **no tier upgrade on reload**. Then
> `hrvLoadOwnExport` reads `json.measurements` for the review KPIs. **Fixtures to regenerate (BOTH, bundle
> HRVDex.html, current manifestHash `6c5043354d5a`):** `HRVDex_2026-06-25_equiv.node-export.json` (input
> `WELLTORY_HRV_DATA_EXPORT_20_May_2026…csv`) + `HRVDex_2026-06-25_events.node-export.json` (input
> `HRVDex_2026-06-25_events.csv`) — re-run `HRVDex.compute({text})` on each committed input, write output,
> re-hash (`ManifestGate.sha16`), re-record `{manifestHash, outputHash}`. Reload path extends the existing
> foreign-JSON ingest at `hrvdex-dsp.js:318`-area; `env.HRVDex` + `HRVDex.compute({text})` are both-runner-wired.
> **✅ HRVDex enrich-ENGINE DONE 2026-07-04.** Executed the plan: `hrvBuildNodeExport` now emits
> `measurements: dated.map(…)` (tMs/offsetMin/hr/meanRR/sdnn/rmssd/pnn50/mxdmn + derived sd1/sd2 + vendor
> composites under `composites.meta{derived,tier:'heuristic'}` only when present — no tier upgrade). +
> `hrvLoadOwnExport` + `HRVDex.loadOwnExport`/`scrubExport` (shared D1) + the `Self-ingest (HRVDex)` §7 group
> (both runners). **Fixture-moving, verified purely additive** — regen diff showed new-minus-`measurements` ==
> old for BOTH fixtures; regenerated `HRVDex_2026-06-25_equiv` (30 measurements, outputHash `dba179ece4844adf`→
> `3b61a2f41dc65b6a`) + `_events` (4 measurements/4 events, `7bb560824c56115f`→`fd18ff65233464c9`), re-bundled
> `6c5043354d5a→1721a312d952`, GATE A + both fixtures re-recorded, `docs/HRVDex.html` synced. Gates green
> (`?full` 1852 passed / 122 groups; `verify-provenance` A/B clean). **✅ HRVDex review-mode UI DONE 2026-07-04** (`hrvReviewView`/`hrvRenderReview` co-located in `hrvdex-app.js`; `_hrvMaybeReview` intercepts HRVDex-own exports in `processFile`/`loadPasted` → review, while foreign JSON + Welltory CSV keep the append/ledger path; re-bundled `1721a312d952`→`8c3150307a24`, export-inert, gates green — **HRVDex pass COMPLETE**). Original plan was: **⏳ UI remaining** (render card from the
> stored `measurements[]` table + event timeline; app drop-detect → review; the reload extends the foreign-JSON
> ingest at `hrvdex-dsp.js:318`-area).
> **UI wiring point (confirmed 2026-07-04, turnkey):** `processFile` (`hrvdex-app.js` reader.onload, ~L49–52) and
> `loadPasted` (~L24) already branch `looksJSON ? ingestGangliorJSON(text,{}) : parseCSV(...)`. Add a check BEFORE
> `ingestGangliorJSON`: JSON.parse the text; if `j.schema.name==='ganglior.node-export' && j.schema.node==='HRVDex'`
> → `HRVDex.loadOwnExport(j)` + a new co-located `hrvReviewView`/`hrvRenderReview` (KPI grid from the last
> `measurements[]` row + a per-measurement mini-table + event timeline; NO raw-signal panel — HRVDex has no
> waveform, it IS summary rows). Leave foreign JSON (ECGDex) + Welltory CSV on the existing APPEND path (the
> ledger feature). External-JS-only → re-bundle + GATE-A + export-inert re-record.

---

## 3. Ordering (one node per pass — never batch re-bundles; §🔏)

Recommended sequence, easiest structural twin of the pilot first:
**CPAPDex → PulseDex → GlucoDex → ECGDex → [D2 gate] → HRVDex → PpgDex.**
Land each fully (code → §7 tests → re-bundle → both gates) before starting the next. The first two are
`nights[]`/`recordings[]` twins of OxyDex and should be near-mechanical; they de-risk the shared render
port. Do the two Tier-3 nodes last, after D2 is decided.

## 4. Tests (mirror the pilot's §7 group per node, both runners)

Clone the OxyDex `Self-ingest — loadOwnExport clinical reload` group (`tests/dex-tests.js`) per node,
driven off that node's `compute()` + `loadOwnExport()` on the node's deterministic synthetic input:
round-trip · faithful-view (reconstructed == stored, no drift) · provenance preserved (no `.stamp(`,
no `GangliorProvenance` in the reload CODE — strip comments before asserting) · tier preserved (no
upgrade) · review-mode not faked (`_fromExport` set, no fabricated series) · foreign-node guard · scrub.
For Tier-3 nodes under path (a), the faithful-view leg asserts events+aggregates only (and that the "no
per-metric summary" note is emitted, not a fabricated table). Wire the node's `<NODE>_REGISTRY` +
resolver + reference-guide text into `env` in BOTH runners if the clinical view badges new surfaces.

## 5. Gates + re-bundle ritual (per node)

- **Reload-only (Tier 1/2, path (a)):** touches external JS only → re-bundle that node, `manifestHash`
  moves, hand-update its `BUILD-MANIFEST.json` entry (GATE A). **Export shape unchanged ⇒ EXPORT-INERT**
  → re-record that node's fixtures' `manifestHash` in `FIXTURE-PROVENANCE.json`, do **NOT** regenerate.
- **Enrich-first (Tier 3, path (b)):** the emit shape changes ⇒ **fixtures move** → re-run the app on
  its committed inputs, re-export, re-record `{ manifestHash, inputHashes, outputHash }`, and expect the
  node's `env.equiv` leg to red until regenerated (that's GATE C doing its job).
- Every pass: `Dex-Test-Suite.html?full` all-green (incl. the new §7 group + the node's equiv leg);
  `verify-provenance.html` GATE A/B clean. **Record `manifestHash` only AFTER the build settles, then
  re-read before trusting** (PROVENANCE-NONDETERMINISM §2/§4 — the platform may auto-rebuild). Keep
  `DOCS-INDEX.md` in sync as each node flips.

## 6. Done when
- [ ] Each of the six nodes re-ingests its OWN v2.0 envelope into a **review-mode** clinical view (raw
      panels greyed, never faked); a foreign export is rejected with a redirect message.
- [ ] **No recompute / no badge upgrade / no `buildHash` re-stamp** on any node's reload; review-mode
      re-export stamps `schema.derivedFrom`.
- [ ] **D1** (scrub shared vs duplicate) and **D2** (Tier-3 lean vs enrich, per node) are decided and
      recorded in this header; scrub strips serials/filenames/sha256 while keeping `contentId` + coarse
      stamp + summary on every node that gains it.
- [ ] `Dex-Test-Suite.html?full` green (a §7 group per node) + `verify-provenance.html` GATE A/B clean
      after each node's re-bundle; ledgers re-recorded (or regenerated for any Tier-3 path (b)).
- [ ] One node per pass; `DOCS-INDEX.md` status kept in sync.

## 7. Follow-ups / linked work
- **`EXPORT-IDENTITY` alignment** — the scrub toggle pivots on `recording.contentId`; a node only keeps
  it through scrub if it emits it. Coordinate with `EXPORT-IDENTITY-FOLLOWUPS` so the scrubbed clinical
  copy stays matchable without a device serial.
- **`EVENT-LEXICON`** — the clinical event timeline renders `ganglior_events[].impulse`; keep each
  node's timeline labels + evidence-badge mapping consistent with the canonical vocabulary.
- **Integrator review-mode** — "load my fused export as a read-only clinical summary" is the multi-node
  analog (the Integrator already ingests exports for fusion). Out of scope here; note as a future idea.
- **Tier-3 enrichment as its own brief** — if D2 picks path (b) for PpgDex/HRVDex, that export-shape
  change is meaty enough to spin into a dedicated `-ENRICH` brief per node rather than riding this one.
