<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Brief — Audit follow-ups, Round III (handoff, 2026-06-23)

**Status:** DONE — 2026-06-23 · **Created:** 2026-06-23
<!-- Executed 2026-06-23: §1 (suite-wide blank-on-print fix) DONE. Discovered the fix was already
     source-complete — entrance-guard.js (the Route-2 external-JS injector this brief recommended:
     pins .main-content/.chart-card/.kpi/.readiness-*/.metric to opacity:1!important so a frozen
     timeline never renders blank) existed and was wired into all 7 node shells — but it was absent
     from 5 committed bundles (a stale-bundle situation; the earlier 2026-06-23 re-bundles predated
     the wiring). Re-bundled OxyDex/ECGDex/PpgDex/GlucoDex/HRVDex to ship it (PulseDex+CPAPDex already
     got it via the AUDIT-FOLLOWUPS-II §6 re-bundle; Integrator already had its own scoped guard).
     manifestHash moved on all 5 (external-JS-only → buildHash unchanged → buildHash-legacy fixtures
     safe); BUILD-MANIFEST.json synced. OxyDex code-gated fixture re-verified by RE-RUNNING OxyDex on
     its committed inputs — all 15 computed stats reproduce byte-identical (entrance-guard.js is
     metric-inert) — and FIXTURE-PROVENANCE.json manifestHash re-recorded. GATES: verify-provenance.html
     GATE A PASS 8/8 + GATE B all fixtures reproducible (OxyDex back to code-gated ✓); Dex-Test-Suite.html
     all green (817 passed, 52 groups) with every app's render-coverage group booting the re-bundled
     bundle cleanly. §2 items (FINDING_EVIDENCE ratification, hcard() research-page badging, Integrator
     triple-nav cleanup, external-agreement data, composite renames, data-quality stamp, Core-set
     curation) are owner/governance/data-gated standing backlog — NOT executable deliverables of this
     brief, left open by design. No new follow-up brief needed; nothing new surfaced beyond that backlog. -->

> **For the next thread / an AI coder.** Read `CLAUDE.md` first (THE CLOCK CONTRACT, the two gates,
> the build-then-bundle rule, the evidence-badge single-source rule, the FROZEN `ganglior.*`
> identifiers + `fascia` alias). This continues `AUDIT-FOLLOWUPS-II-BRIEF.md`, whose **correctness
> re-bundle sweep is now fully DONE** (all 8 bundles match `BUILD-MANIFEST.json`; GATE A 8/8, GATE B
> all reproducible; `Dex-Test-Suite.html` all green — 817 passed / 52 groups, 2026-06-23). What
> follows is the carry-over: one real (fixture-gated) deliverable plus governance/data calls. **None
> are correctness blockers** — schedule the §1 print-fix deliberately; the rest move only on an owner
> decision.

---

## 1. 🔴 Suite-wide blank-on-print / PDF / export (the AUDIT-FOLLOWUPS-II §4.1 carry-over)

`ans-design.css` animates `.main-content` / `.chart-card` / `.kpi` **from `opacity:0` with
`fill:both`**, so any frozen-timeline context (print, PDF, screenshot capture, throttled background
tab) renders **blank**. Only the Integrator was patched (scoped CSS in `integrator-render.js`); the
other 7 surfaces still go blank on print.

**Root fix:** make the visible end-state the BASE in `ans-design.css` and animate *from* hidden only
while playing — gate the from-hidden keyframes on a "playing" flag **and**
`@media (prefers-reduced-motion: no-preference)`, exactly the pattern CLAUDE.md prescribes for slide
entrance animations.

**⚠️ Why it's its own pass (the blocker that kept it open):** `ans-design.css` is inlined into every
bundle's `__bundler/template`, so editing it moves **every app's `buildHash`** → flips every
buildHash-legacy fixture (`uploads/PulseDex_*.json` ×3, `uploads/ppgdex_20260610.json` ×1, the
Integrator `integrator_fusion_*.json` ×2). Several of those inputs are **not committed** → the
fixtures can't be regenerated → GATE B goes red and stays red. **Do not fold this into any other
change.** Two clean ways forward, pick one before touching the CSS:
  1. **Solve the fixture-regeneration problem first** — commit the missing PulseDex/fusion inputs (or
     re-derive equivalents), so every buildHash-legacy fixture can be re-recorded after the CSS edit.
  2. **Move the fix out of the template** — inject the corrected base/print CSS from an external
     `*.js` (the `injectSynthCSS()` IIFE pattern proven in AUDIT-FOLLOWUPS-II §1, which kept the
     Integrator fusion fixtures green by appending a `<style>` from JS instead of editing the inline
     shell). External-JS injection moves `manifestHash` (fine — re-bundle + sync `BUILD-MANIFEST.json`)
     but **not** `buildHash`, so the legacy fixtures stay green. This is almost certainly the right
     route: it ships the fix on all 7 nodes without needing the un-committed inputs.

**Done when:** print/PDF of every app renders populated content (not blank); reduced-motion and
frozen-timeline contexts show the end-state; GATE A re-synced + PASS; GATE B no reds;
`Dex-Test-Suite.html` all green.

---

## 2. Governance / owner-decision items (carried from AUDIT-FOLLOWUPS-II §4.4 / §5 — NOT bugs)

Do these only on an explicit decision; each needs an owner, not just a coder.

- **§4.4 — ratify fusion-finding evidence tiers.** `FINDING_EVIDENCE` in `integrator-render.js` is
  author-assigned, not test-backed. Science-governance should ratify, then consider a small
  node-style registry so the `cohesion-badges` gate anchors them. Also resolves the open
  `_cmpTile`-fallback question: the PulseDex beat-agreement / PRV↔HRV tiles and the ECGDex ectopy
  `q-stat` labels currently resolve the **`experimental` fallback** (they're not registry ids). If
  governance judges the method-comparison stats to be `measured`, add registry entries/aliases.
- **§4.2 (residual) — research-harness `hcard()` pages.** `qrs-equiv-analysis.js`,
  `qrs-yield-analysis.js`, `cgm-hrv-coupling-analysis.js`, `treatment-response-analysis.js` show
  stats (r, bias, n) unbadged. They're exploratory validation surfaces; per-metric badging is a
  policy call. GlucoDex `renderVariability`/`renderCorrelations` cells are unbadged but already
  badged in the KPI grid + main table (low severity).
- **§4.3 — `Integrator.src.html` triple `<nav class="mobile-nav">`.** Deduped at runtime by
  `bindNav`. Cleaning the markup moves `buildHash` → flips the un-regenerable fusion fixtures. Keep
  the runtime workaround until §1's fixture problem is solved (then clean both together).
- **§5.1 / §5.2 — external-agreement numbers.** Paired-PSG Bland–Altman (ODI-4 vs PSG) and
  Kubios/NeuroKit2 RR cross-check. **Data-gated** — no PSG/reference dataset committed.
- **§5.4 — rename wellness-coded composites** (Coherence/Welfare/Energy) to neutral autonomic terms,
  or keep strictly research-depth. Cosmetic.
- **§5.5 — surface the data-quality stamp** (`correctionRate`/`analyzablePct`/`motionRejectedPct`)
  more prominently so high-artifact nights are visibly caveated. Feature/UX work.
- **§5.6 — tune each node's Core set** to ~8–12 validated metrics. Curation.
- **Deferred by design (CLAUDE.md / prior briefs):** GENERATOR-FOLLOWUPS-II #1 (make `buildHash`
  fingerprint executed code — needs inliner surgery + regen all fixtures), and ECGDex raw-µV
  multi-night coherence. Do NOT pick up without a real need.

---

## 3. Conventions that bite (unchanged — see CLAUDE.md for the full text)

- Edit the `.js` + `.src.html`, re-bundle `Foo.html` via the inliner; **never edit the bundled `.html`.**
- External-JS / shared-module changes move **`manifestHash`** (GATE A) but **not `buildHash`** — only
  inline `<script>`/`<style>` in a `.src.html` shell moves `buildHash`. Prefer external JS (and
  JS-injected CSS) for any change near a node with buildHash-legacy fixtures.
- After any `*-dsp.js`/`*-app.js`/`*-render.js`/`*-cross.js` change run `Dex-Test-Suite.html` (all
  green). After any re-bundle update `BUILD-MANIFEST.json` and open `verify-provenance.html` (GATE A
  PASS, no red verdicts).
- Do NOT rename `ganglior.*` identifiers / schemas / the `fascia` alias. Brand strings are `Tepna`;
  the bus codename `Ganglior` is FROZEN. Every authored file carries the SPDX header.
