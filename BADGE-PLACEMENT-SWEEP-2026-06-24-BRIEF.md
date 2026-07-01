<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# BADGE-PLACEMENT-SWEEP — propagate the OxyDex badge fixes to every other node

**Status:** DONE — 2026-06-24 · **Created:** 2026-06-24 · **Owner brand:** Tepna
**Followups:** `BADGE-PLACEMENT-SWEEP-FOLLOWUPS-2026-06-24-BRIEF.md`
**Reference implementation:** **OxyDex** (done 2026-06-24 — `oxydex-render.js`, `oxydex-fusion.js`,
`oxydex-registry.js`, `OxyDex.src.html`). Mirror its patterns exactly.
**Related:** `BADGE-COVERAGE-AUDIT-BRIEF.md` (that sweep proved every metric *has* a badge; THIS one
fixes *where the badge sits* and catches surfaces the coverage sweep missed).

> **For a fresh AI coder.** Read `CLAUDE.md` first (esp. **🎫 Evidence badges**, the **🔴 COVERAGE
> MANDATE**, and **the two gates**), then open **OxyDex** + its reference guide as the template. The
> badge **system** is frozen and centrally governed — do NOT touch `metric-registry.js`
> `BADGE_CSS`, `dex-badges.css`, the tiers, the disc shapes, or the grades. This is a **placement +
> missing-surface + spacing** sweep across the OTHER nodes, node by node, gated.

---

## §0 — What "governed centrally" already means (don't re-litigate)
Placement is governed in ONE place — `metric-registry.js` `BADGE_CSS`:
- **Cards / KPI tiles / hero numbers** (`.metric`, `.ss-kpi`, `.nr-kpi`, `.kpi`,
  `.readiness-subscore`) → the disc is **auto-anchored to the tile's bottom-right corner**
  (`position:absolute; right:9px; bottom:8px`). You get this FREE by putting an `.ev` anywhere in the
  tile's label; the central rule pulls it to the corner. **Do not** hand-position these.
- **Everything else (dense/inline text)** → the disc sits **inline, immediately BEFORE the label**
  (`.ev` then label text), per the CLAUDE.md mandate.

The bug this brief fixes is NOT the central rule — it's **call sites** that (a) concatenated the disc
*after* the label, (b) never called the badge helper at all on some surfaces, or (c) left the inline
disc touching the label text with no gap.

## §1 — The three defects to find & fix (exactly what OxyDex had)

**Defect A — disc placed AFTER the label (should be BEFORE).**
Every inline call site read `label + evBadge(label)`. Flip to `evBadge(label) + label`.
OxyDex sites fixed (find the per-node equivalents): smart-summary KPIs (`ssKPI`), the ranked
"Top issues" rows (`ssRow`/`.ss-label`), near-realtime KPIs + chips (`nrKpi`, `nrChip`), generic
metric cards (`metric()` `.m-label`), and readiness sub-score labels (`.rs-label`).
- Each node's render exposes a local `evBadge(label)` → `<Node>Registry.badgeForLabel(label)`
  (the zero-touch resolver: label → registry id → evidence → `MetricRegistry.badge`). The disc string
  is identical regardless of side; only the concatenation ORDER is wrong. Flip it.
- Update the doc comment on `badgeForLabel` from "append after" → "place IMMEDIATELY BEFORE the label"
  (OxyDex's `oxydex-registry.js` already says this — copy the wording).

**Defect B — surfaces with NO badge at all (missing).** OxyDex was missing badges on:
1. **Flagged-metric cards** (the "ranked by severity" grid) — `.m-label` emitted the bare label.
   Add `evBadge(m.label)` before it.
2. **Chart cards** — every `<div class="chart-title">…` had no badge. The title text is NOT a
   registry label (it would mis-resolve to `experimental`), so badge by the chart's **primary series
   metric**. OxyDex added a central helper:
   ```js
   function chartTitle(title, metricLabel){
     var b = (typeof evBadge==='function') ? evBadge(metricLabel||title) : '';
     return '<div class="chart-title">'+b+title+'</div>';
   }
   ```
   then replaced every `'<div class="chart-title">TITLE</div>'` with
   `chartTitle('TITLE','<primary metric label/id>')` (e.g. the trend's first series — `Mean SpO₂`,
   `ODI-4`, `vo2est`, …). Use the registry **id** when the human label won't resolve.
3. **Hero / headline numbers** — the big single number on summary/projection cards (OxyDex: the Apnea
   Bench headline, the VO₂max/Recovery/Training-Zones/T-Index/Sleep-Stability projection cards). These
   had a *status pill* (severity, e.g. "Good (25–50th)", "Z1 Recovery ★", "validated") but **no
   evidence disc**. A status pill is NOT an evidence badge — add the disc (inline before the card's
   title or the headline metric's descriptor label), keyed to the headline metric's id.
4. **Bench / fusion KPI rows & tiles** (node fusion/overview files) — OxyDex's `oxydex-fusion.js`
   bench rows + KPI tiles emitted bare labels; added a leading disc per row/tile.

**Defect C — inline disc touches the label (no breathing room).** Add a small trailing gap on the
inline disc for every inline label container. OxyDex added ONE rule in `OxyDex.src.html`'s `<style>`:
```css
.m-label .ev, .ss-label .ev, .ss-kpi-label .ev, .nr-kpi-label .ev, .rs-label .ev,
.opc-row .ev, .opc-kpi-l .ev, .opc-unit .ev, .nr-chip .ev, .readiness-zone-chip .ev,
.chart-title .ev, .proj-title .ev { margin-right: 5px; }
```
Adapt the selector list to each node's label-container class names. (Corner-badged tiles are
unaffected — the central rule sets their `margin:0` and absolute position.)

## §2 — Status pill vs evidence disc (the naming/cohesion call to make consistent)
Each node mixes two badge vocabularies: the **evidence disc** (`.ev`, trust/grade — central) and
**text pills** (severity/status — "validated", "Good (25–50th)", "Z1 Recovery ★", the `RDY`/`ZON`/`VO₂`
cat-tags). They are different axes and BOTH may appear, but they must not be confused: the disc is
required (coverage mandate); the pill is decorative status. **Rule:** every surfaced metric gets the
**disc**; the pill is optional. Do not let a status pill stand in for a missing disc (that was the
VO₂max/Apnea-Bench bug). If a node styles its pills ad hoc per card, give them one shared `.dex-pill`
class while you're in there (optional polish; flag if you do it).

## §3 — Per-node scope (audit each; not all will have every surface)
For each: grep the render/app/fusion/overview files for badge call sites and bare label emits.
- **HRVDex** — `hrvdex-render.js` (+ `hrvdex-chart.js`, `hrvdex-chartbadges.js`, `hrvdex-profile.js`).
  Charts already have a chart-badge map (`hrvdex-chartbadges.js` / `CHART_EV`) — confirm KPI/row/table
  placement is BEFORE-label and hero numbers carry the disc.
- **PulseDex** — `pulsedex-app.js` (renders inline; has `slKPI`/`slANS`/`heroTop`/`renderANS`/
  `renderTable`). Check KPI grid, the ANS section, table rows, chips, hero number.
- **ECGDex** — `ecgdex-render.js` (has the `EcgRegistry` evidence hook). Morphology/RR/EDR cards,
  chart titles, hero numbers, tables.
- **PpgDex** — `ppgdex-render.js` (+ morph). Same surfaces.
- **GlucoDex** — `glucodex-render.js`. KPI tiles (TIR/GMI/CV…), daypart/variability cards, charts,
  fusion composites, hero number.
- **CPAPDex** — `cpapdex-render.js`. Therapy KPIs, charts, event tiles, hero number.
- **Integrator** — `integrator-render.js`. Fusion finding cards/chips, the consensus surfaces. The
  Integrator badges via its grade mirror (`IntegratorDSP` grade resolver ≡ node registries) — keep
  using that; just fix placement + missing + spacing.

## §4 — Gates (per node, every PR)
- Edited a `*-render.js` / `*-app.js` / `*-fusion.js` / `*-overview.js` / `*-registry.js` /
  `.src.html` → **re-bundle that node**, hand-update its `manifestHash` (and `buildHash` if a `.src.html`
  inline `<style>`/`<script>` changed) in **`BUILD-MANIFEST.json`** (read it off
  `verify-provenance.html`), and update any of that node's `FIXTURE-PROVENANCE.json` entries
  (export CONTENT is unchanged by display-only badge edits → re-record the manifestHash, do NOT
  regenerate the fixture). Confirm **verify-provenance GATE A PASS 8/8**.
- Run **`Dex-Test-Suite.html`** → all green. The `cohesion-badges` group already gates grade-equivalence;
  it does NOT check placement, so **eyeball each node live** (load demo data, confirm discs render
  BEFORE labels inline, in the corner on tiles, present on charts + hero numbers, with the 5px gap).
  ⚠️ Hard-reload the suite to bust any stale cached `tests/dex-tests.js` (a known gotcha — a stale
  cache showed phantom per-guide failures this thread).

## Acceptance (each node)
- [ ] No inline disc sits AFTER its label (all flipped to before).
- [ ] No surfaced metric is unbadged: KPI tiles, ranked/flagged cards, chart cards, hero/headline
      numbers, fusion rows/chips, table rows all carry a disc (corner on tiles, inline-before elsewhere).
- [ ] Inline discs have the trailing gap (no disc touching label text).
- [ ] A status pill never substitutes for a missing evidence disc.
- [ ] Grades resolve correctly (measured/validated where they should — NOT everything `experimental`
      from fallback); fix the resolver alias if a real metric falls back.
- [ ] Node re-bundled; BUILD-MANIFEST + FIXTURE-PROVENANCE updated; verify-provenance GATE A PASS 8/8;
      Dex-Test-Suite all green; live spot-check done.
- [ ] No edits to `metric-registry.js` `BADGE_CSS`, `dex-badges.css`, the tiers, disc CSS, or grades.

## Spawn a follow-up
After the sweep, record anything that surfaced (e.g. nodes where pills got unified, resolver alias
gaps found) in `BADGE-PLACEMENT-SWEEP-FOLLOWUPS-<date>-BRIEF.md`, or note "nothing surfaced" in this
brief's header.
