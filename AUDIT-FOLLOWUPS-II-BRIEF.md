<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Brief — Audit follow-ups, Round II (handoff, 2026-06-22)

**Status:** DONE — 2026-06-23 · **Created:** 2026-06-22
<!-- Executed 2026-06-23: §1 (Integrator synthetic filter) DONE & bundled (prior thread). §6 re-bundle
     sweep COMPLETE — HRVDex (HRV→BP leak removed, the §0 top-priority ship), ECGDex, PpgDex, OxyDex
     (fixture regenerated, FIXTURE-PROVENANCE updated) and GlucoDex shipped earlier 2026-06-23; this
     thread closed the last two: PulseDex re-bundled (the §2 badge-sweep edits in pulsedex-app.js/
     pulsedex-overview.js were source-only/stale — re-bundle moved manifestHash 1e31e9f2d60c→34b045ab9139,
     buildHash badc412e024e unchanged) and CPAPDex re-bundled (pre-existing drift reconciled,
     manifestHash 028ee58f770d→1424a2c99c71; its committed buildHash 105d1b62dd39 was itself stale →
     corrected to runtime dcbfac63a491). BUILD-MANIFEST.json synced for both. GATES: verify-provenance.html
     GATE A PASS 8/8 + GATE B all fixtures reproducible; Dex-Test-Suite.html all green (817 passed, 52
     groups). §4.1 (blank-on-print ans-design.css) intentionally NOT folded in — it moves every app's
     buildHash and reddens un-regenerable fixtures, so it remains its own deliberate fixture-safe pass
     (see AUDIT-FOLLOWUPS-III-2026-06-23-BRIEF.md). §4.4/§5 items trail on owner/governance decisions. -->

> **For the next thread / an AI coder.** Read `CLAUDE.md` first (THE CLOCK CONTRACT, the two gates,
> the build-then-bundle rule, the evidence-badge single-source rule, the FROZEN `ganglior.*`
> identifiers + `fascia` alias). This continues `AUDIT-FOLLOWUPS-BRIEF.md`. The previous thread
> shipped §1 (Integrator synthetic filter) AND made a batch of **source-only** correctness/badge
> fixes that are **NOT yet in the shipped bundles** — a concurrent coder was active, so re-bundling
> was deferred. **The #1 job of this thread is the §6 re-bundle sweep: ship those edits and clear
> GATE A.** Honor the gates verbatim: after any `*-dsp.js`/`*-app.js`/`*-render.js`/`*-cross.js`
> change run `Dex-Test-Suite.html` (must read **all green**); after any re-bundle update
> `BUILD-MANIFEST.json` and open `verify-provenance.html` (GATE A must PASS, no red verdicts).

---

## 0. 🔴 THE BLOCKER — code fixes are in SOURCE but NOT in the bundles (ship them)

`Dex-Test-Suite.html` loads the external `*.js` directly, so it reads **all green (757)** — but the
**shipped `Foo.html` bundles are unchanged**. Two consequences that MUST be resolved:

1. **The HRVDex HRV→BP leak is still live in the shipped `HRVDex.html`.** The removal is committed in
   `hrvdex-profile.js` source only. Until HRVDex is re-bundled, a user still sees the discredited
   `"∼ HRV projection → N mmHg"` cuffless-BP-from-HRV — the exact class
   DEX-SUITE-EXTERNAL-REVIEW-v2 §🔴 condemned. **This is the highest-priority ship.**
2. **GATE A is currently RED.** Pre-existing drift on 5 bundles, now compounded by this thread's
   source edits on 4 more. The repo is in a failing-gate state by its own rules.

Both clear with the **§6 re-bundle sweep** below.

---

## 1. Already shipped this thread (context — do NOT redo)

- **§1 Integrator "Clear synthetic" / show-hide filter — DONE & BUNDLED.**
  - `integrator-longitudinal.js`: added pure `filterSynthetic(rows, includeSynthetic)` (Node-CI
    testable; `undefined` synthetic ⇒ real, always kept), `clearSynthetic()` (deletes only
    `rec.synthetic` rows, mirrors `clear()`), `hasSynthetic()`/`countSynthetic()`, and a **trailing
    optional** `includeSynthetic` arg threaded through `_allRows`/`nodes`/`datesSorted`/`metricKeys`/
    `seriesFor`/`crossCorrelations`/`state`/`_coverageGrid`. Exported on `global.IntegratorLong`.
  - Longitudinal view: persisted **show/hide synthetic** toggle (`localStorage`
    `ganglior_long_includeSynth`, default show) + **Clear synthetic** button in the store bar, plus
    visual tags (dashed coverage cells `.cg-synth`, a `synthetic` chip on mixed trends `.ltc-synth`).
  - **Bundle-safe trick (reuse this pattern):** the view CSS is **injected from
    `integrator-longitudinal.js`** (an `injectSynthCSS()` IIFE that appends a `<style id="long-synth-css">`),
    NOT added to the inline `<style>` in `Integrator.src.html`. This keeps the bundle's coarse
    `buildHash` stable (buildHash only moves on inline-script/style shell edits) → the legacy
    buildHash-stamped `uploads/integrator_fusion_*.json` fixtures stay green. I first tried inline CSS,
    saw buildHash move 78e04e861cce→93f2bafbc55a and the fusion fixtures flip red, reverted, and used
    the JS-injection route → buildHash back to **78e04e861cce**.
  - Test group `Integrator longitudinal — synthetic filter` added to `tests/dex-tests.js`; module
    wired into BOTH runners (`tests/run-tests.mjs` optional-load list + `IntegratorLong: ctx.IntegratorLong`;
    `Dex-Test-Suite.html` `<script src="integrator-longitudinal.js">` + `IntegratorLong: window.IntegratorLong`).
  - `Integrator.html` re-bundled; `BUILD-MANIFEST.json` Integrator synced to
    **`buildHash 78e04e861cce` / `manifestHash 6f52f9b18b17`**. GATE A: Integrator **match ✓**, both
    fusion fixtures `reproducible ✓`.

---

## 2. Source-only edits made this thread — PENDING re-bundle (the §6 payload)

All are in **external `*.js` files** (so re-bundling moves each app's `manifestHash` but **NOT its
`buildHash`** — important for fixtures, see §6). Suite is green with these in place.

| App | File(s) edited | What | Behavior change? |
|---|---|---|---|
| **HRVDex** | `hrvdex-profile.js` | **Removed HRV→BP**: dropped `medSBP`/`medDBP` derivation, `window._projSBP/_projDBP`, the `setIfEmpty('prof_sbp'/'prof_dbp', …, true)` auto-fill, and the `lbl_sbp`/`lbl_dbp` "HRV projection → N mmHg" sublabels. **Kept** user-entered cuff `prof_sbp`/`prof_dbp` (legit MAP/BAP inputs). | Yes — BP no longer inferred/shown. No HRVDex `uploads/*` fixture exists, so no fixture to regen. |
| **HRVDex** | `hrvdex-render.js` | Badge sweep: `st()` proj-extra tiles now `${eb(lbl)}` (Resting HR, Baevsky SI). | Render-only. |
| **PpgDex** | `ppgdex-profile.js` | Badge sweep: `st()` proj-extra tiles now `${eb(lbl)}`. | Render-only. |
| **ECGDex** | `ecgdex-profile.js` | Badge sweep: `st()` proj-extra tiles now `${eb(lbl)}`. | Render-only. |
| **ECGDex** | `ecgdex-app.js` | Badge sweep: ectopy/rhythm `q-stat` helper (`eb=(label,…)`) now badges `q-lbl` (PVC/PAC burden etc.). | Render-only. |
| **PulseDex** | `pulsedex-overview.js` | Badge sweep: `st()` proj-extra tiles now `${evBadge(lbl)}`. | Render-only. |
| **PulseDex** | `pulsedex-app.js` | Badge sweep: `_cmpTile` now badges all 8 beat-agreement + PRV↔HRV discrepancy tiles (`+label+(typeof evBadge==='function'?evBadge(label):'')`); **pttv caption** changed `'√(PRV²−HRV²) · vascular/BP surrogate'` → `'… · vascular tone surrogate'` (drops the soft BP claim). | Render/copy-only. |

Plus test/infra (already correct, no bundle): `tests/dex-tests.js` (+ group), `tests/run-tests.mjs`,
`Dex-Test-Suite.html`, `BUILD-MANIFEST.json` (Integrator entry only).

⚠️ **Badge-fallback note:** the `_cmpTile` labels (Bias, Limits of agreement, Mean abs diff, Within
25 ms, Correlation, Δ rMSSD, rMSSD ratio, Transit-time variability) and the ectopy `q-stat` labels are
not registry ids, so `badgeForLabel(label, true)` returns the **`experimental` fallback** badge (the
"nothing silently unbadged" rule). If science-governance wants a truer tier for the agreement stats
(they're method-comparison numbers, arguably `measured`), add registry entries/aliases — that's a §4.4
governance call, not required to ship.

---

## 3. 🔴 §6 — the re-bundle + manifest-regen sweep (DO THIS FIRST, as one pass)

GATE A (`verify-provenance.html`) compares each bundle's CURRENT `manifestHash` (computed statically
from the file's `__bundler/manifest`) against `BUILD-MANIFEST.json`. As of handoff it reads
**GATE A FAIL — 5 bundle(s) drifted** *(ECGDex, OxyDex, PulseDex, PpgDex, CPAPDex)* — and that count
predates this thread (a "consistent-but-stale" trap: committed source had moved ahead of committed
bundles without a re-bundle; OxyDex proved this in the prior pass). This thread's source edits add
**HRVDex, PpgDex, ECGDex, PulseDex** to the apps whose source is ahead of their bundle.

**Bundles needing a re-bundle:** **HRVDex, PpgDex, ECGDex, PulseDex** (this thread's edits) +
**OxyDex, CPAPDex** (pre-existing drift). **GlucoDex** read `match ✓` and was not edited — re-bundle
it too for completeness/§6 thoroughness, but if its `manifestHash` doesn't move, leave it. **Integrator**
is already done (§1).

**Per app, in order:**
1. Re-bundle `Foo.src.html → Foo.html` with the inliner (`super_inline_html`) — **no source edit**.
   (Edit the `.js`/`.src.html`, never the bundled `.html`.)
2. Open `verify-provenance.html`; read the fresh **`manifestHash`** (and `buildHash`) off the manifest
   table for that app.
3. Hand-update that app's entry in **`BUILD-MANIFEST.json`** to the fresh `buildHash` + `manifestHash`
   (this is what gives GATE A teeth — it HARD-FAILS on a missing/stale entry).
4. **Fixtures (GATE B):** confirm no red verdicts. Reasoning that should hold:
   - This thread's app edits are **external JS only → `buildHash` does NOT move**, so the
     **buildHash-legacy** fixtures (`uploads/PulseDex_*.json`, `uploads/ppgdex_20260610.json`) should
     stay green across the PulseDex/PpgDex re-bundle (same logic that kept the Integrator fusion
     fixtures green in §1). **Verify, don't assume.**
   - `OxyDex_2026-06-13_1056_summary.json` is the only **code-gated** fixture (`FIXTURE-PROVENANCE.json`,
     keyed on OxyDex's `manifestHash`). Re-bundling OxyDex **moves its `manifestHash`** → GATE B will
     turn that fixture red until you re-record provenance. Per the sidecar workflow: re-run OxyDex on
     its committed inputs (`O2Ring S 2100_20260612230016.csv` + `ECGDex_2026-06-13_1024_summary.json`),
     re-export, confirm oximetry metrics reproduce byte-identically, then write the new OxyDex
     `manifestHash` into `FIXTURE-PROVENANCE.json` (do NOT hand-edit — re-derive). The prior pass
     already proved these metrics reproduce on current code.
   - Fixtures with no provenance stamp (pre-R1) are fine as "no provenance".
5. Re-run `Dex-Test-Suite.html` (all green) at the very end.

**Fold into this same sweep (so the suite/bundles are touched once):**
- **§3 — `validateNodeExport` parity.** `crossnight-envelope.js` exports `validateNodeExport` (tested,
  consumed only by the Integrator at runtime). The other 6 node bundles embed the older module without
  it — an acceptable **inert** addition. Re-bundling them (which you're doing anyway) makes source ==
  bundles for free; just update all 6 `BUILD-MANIFEST.json` entries. No behavior change.
- **§4.1 — suite-wide blank-on-print/PDF/export** (the bigger one; decide whether to include now).
  `ans-design.css` animates `.main-content`/`.chart-card`/`.kpi` **from `opacity:0` with `fill:both`**,
  so frozen-timeline contexts (print, PDF, capture, throttled tab) render blank. Only the Integrator
  was patched (scoped CSS in `integrator-render.js`). Root fix = make the visible end-state the BASE in
  `ans-design.css` and animate from hidden only while playing (gate on a playing flag + `@media
  (prefers-reduced-motion: no-preference)`). ⚠️ `ans-design.css` is inlined into every bundle's
  `__bundler/template` → editing it moves **every app's `buildHash`** → flips every buildHash-legacy
  fixture (PulseDex ×3, PpgDex ×1, Integrator fusion ×2). If you do §4.1, you must regenerate those
  fixtures too (the fusion + several PulseDex inputs aren't committed → can't regenerate → this is the
  blocker that's kept §4.1 open). **Recommendation:** ship the §0/§2 correctness re-bundle FIRST as its
  own clean pass (external-JS-only, buildHash stable, fixtures safe), and treat §4.1 as a SEPARATE
  deliberate pass with the fixture-regeneration problem solved — do not fold §4.1 into the correctness
  ship or you'll redden fixtures you can't fix.

---

## 4. Found ALREADY DONE this thread (do NOT re-investigate)

- **§2 GlucoDex `HH:MM:SS` fusion events — DONE.** `glucodex-dsp.js hhmm()` (L545) already includes
  `getUTCSeconds()` (returns `HH:MM:SS`), and both `buildEvents` and the app `computeFusion` already
  emit `tMs` per event. The brief predated this. (UI event-stream uses `.slice(0,5)` for display only —
  that's cosmetic, not the export `t`.)
- **§7 PpgDex epoch precision — DONE.** `ppgdex-app.js` has `_round(v,d=2)` (L458) and `buildV2`
  routes every epoch field through it (`rmssd:_round(e.rmssd,2)` …). No raw-float HRV leaks.
- **§7 HRVDex persistence quota — DONE.** `hrvdex-dsp.js persistHRVRows()` (L173–189) caps to the
  most-recent-N (halving the tail until it fits) and `setStatus(...)`-warns when storage is full;
  `tests/dex-tests.js:1305` gates it.
- **§5.3 PulseDex VO₂ rows — COMPLIANT.** `VO₂ base`→`vo2base` and `VO₂ adj`→`vo2` resolve **heuristic**
  badges via the registry alias; `VO₂ GT` is intentionally in `_META_DENY` (user-entered lab ground
  truth). No action.

---

## 5. Remaining items — NOT correctness blockers (owner/governance/data calls)

None of these are bugs; do them only on an explicit decision.

- **§4.2 (residual)** — badge coverage is now closed on the clear unbadged surfaces (the `st()` sweep,
  `_cmpTile`, ECGDex ectopy). **Deliberately left:** the research-harness `hcard()` pages
  (`qrs-equiv-analysis.js`, `qrs-yield-analysis.js`, `cgm-hrv-coupling-analysis.js`,
  `treatment-response-analysis.js`) show stats (r, bias, n) unbadged — they're **exploratory validation
  surfaces** (like the Integrator's single-`experimental` correlation block); badging them per-metric is
  a policy call. GlucoDex `renderVariability`/`renderCorrelations` cells are unbadged but those metrics
  are **already badged in the KPI grid + main table** (low severity) and the correlation cells are
  exploratory.
- **§4.4** — fusion-finding evidence tiers (`FINDING_EVIDENCE` in `integrator-render.js`) are
  author-assigned, not test-backed. Ratify (science governance) and consider a small node-style registry
  so the `cohesion-badges` gate anchors them. (Also covers the `_cmpTile`-fallback question in §2.)
- **§4.3** — `Integrator.src.html` has 3 duplicate `<nav class="mobile-nav">` blocks (deduped at runtime
  by `bindNav`). Cleaning markup moves `buildHash` → flips the un-regenerable fusion fixtures. Keep the
  runtime workaround unless §4.1's fixture problem is solved.
- **§5.1 / §5.2** — external-agreement numbers (paired-PSG Bland–Altman ODI-4-vs-PSG; Kubios/NeuroKit2
  RR cross-check). **Data-gated** — no PSG/reference dataset committed.
- **§5.4** — rename wellness-coded composites (Coherence/Welfare/Energy) to neutral autonomic terms, or
  keep strictly research-depth. Cosmetic.
- **§5.5** — surface the data-quality stamp (`correctionRate`/`analyzablePct`/`motionRejectedPct`) more
  prominently so high-artifact nights are visibly caveated. Feature/UX work.
- **§5.6** — tune each node's Core set to ~8–12 validated metrics (curation).
- **Deferred by design (CLAUDE.md / prior briefs):** GENERATOR-FOLLOWUPS-II #1 (make `buildHash`
  fingerprint executed code — needs inliner surgery + regen all fixtures), and ECGDex raw-µV multi-night
  coherence. Do NOT pick up without a real need.

---

## 6. Conventions that bite (same as every prior round)

- Edit the `.js` + `.src.html`, re-bundle `Foo.html` via the inliner; **never edit the bundled `.html`.**
- External-JS / shared-module changes move **`manifestHash`** (GATE A) but **not `buildHash`** — only
  inline `<script>`/`<style>` in a `.src.html` shell moves `buildHash`. Use that: prefer external JS
  (and JS-injected CSS, per §1) for any change near a node with buildHash-legacy fixtures.
- New params/return fields go **LAST + optional**; expose new data via NEW fields/methods. The shared
  assertions in `tests/dex-tests.js` ARE the public contract.
- Clock Contract: floating `tMs` via `Date.UTC`, read back via `getUTC*` only.
- Evidence grade is a NODE fact from `<node>-registry.js`; never invent a global grade table. Every
  surfaced measurement carries a badge (`.ev-corner` bottom-right, or `.ev` inline-before-label).
- Do NOT rename `ganglior.*` identifiers, the `ganglior.node-export`/`ganglior.crossnight` schemas, or
  the `fascia` alias. Brand strings are `Tepna`; the bus codename `Ganglior` is FROZEN.
- Every authored file carries the SPDX header from `licensing/SPDX-HEADERS.txt`.

## Suggested order
**§3/§0 correctness re-bundle sweep FIRST** (HRVDex → PulseDex → ECGDex → PpgDex → OxyDex → CPAPDex,
folding in §3's `validateNodeExport`; external-JS-only so buildHash stays put and fixtures are safe —
just regen the OxyDex sidecar `manifestHash`), update `BUILD-MANIFEST.json` in lockstep, GATE A must go
PASS, suite green. THEN schedule **§4.1** as its own deliberate pass once the fusion/PulseDex fixture
regeneration is solved. §4.4/§5 items trail on owner decisions.
