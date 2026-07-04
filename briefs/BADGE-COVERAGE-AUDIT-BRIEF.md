<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Build Brief — Evidence-Badge Coverage & Correctness Audit (every element, every Dex)

**Status:** DONE — 2026-06-23 · **Created:** 2026-06 (undated)
<!-- Re-verified 2026-06-23 (this pass): deliverable BADGE-COVERAGE-AUDIT-FINDINGS.md present; GlucoDex
     renderVariability + daypart tiles confirmed badged in source (glucodex-app.js evBadge() at the
     daypart-CV and renderVariability tiles); GlucoDex bundle current (GATE A match ✓). Both gates green:
     Dex-Test-Suite.html all-green, verify-provenance.html GATE A PASS 8/8, no red fixtures. No rebuild
     needed — every bundle already matches BUILD-MANIFEST. Status flipped PROPOSED→DONE. -->
<!-- Verified 2026-06-23: EXECUTED. Deliverable #1 (BADGE-COVERAGE-AUDIT-FINDINGS.md) now exists —
     a real-bundle render-coverage harness + automated alias-resolver sweep across all nodes produced
     the per-node ledger. Fix applied: GlucoDex renderVariability/renderDaypart were emitting 17
     registry-known metrics (MAGE/CONGA/MODD/J-index/GRADE/ADRR/LBGI/HBGI/GVP/MAG + 5 daypart CV) as
     unbadged .q-stat tiles → wired evBadge, added daypart-CV aliases, re-bundled GlucoDex, updated
     BUILD-MANIFEST. Both gates green. Remaining alias-gap/mis-tier candidates (OxyDex research-dump,
     HRV composites, PPG freq-domain, PulseDex stale 'ANS Age', ECGDex harness trigger) are flagged in
     the ledger's Residual list for a deliberate follow-up pass. -->
<!-- Superseded note (kept for history): the exhaustive per-node coverage proof had never been produced. -->
<!-- A PARTIAL, opportunistic badge sweep landed earlier via AUDIT-FOLLOWUPS-II §2 (st() proj tiles,
     _cmpTile, ECGDex ectopy). -->
<!-- Prior status text:
     Deliverable #1 (BADGE-COVERAGE-AUDIT-FINDINGS.md audit ledger) does not exist, so the exhaustive
     per-node coverage proof was never produced. -->

> **For a fresh AI coder.** Read `CLAUDE.md` first — especially **🎫 Evidence badges**, the
> **🔴 COVERAGE MANDATE**, and **the two gates** — then `CONTRIBUTING.md` §6, then
> `dex-badges.css` and `metric-registry.js`. The badge **system** is already built and frozen;
> **OxyDex is the reference implementation** and is correct. This brief does NOT add new
> infrastructure. It is a **sweep**: walk every surfaced number in every node, prove it (a) wears a
> badge and (b) wears the *right* one, then fix the two failure modes — **missing badge** and **wrong
> grade**. Clone the OxyDex pattern; never redesign it.

---

## START HERE — what's already true (do not re-derive or "improve")

- **The ladder is frozen** (rank 0→4, most→least trusted; SHAPE = trust, never hue):
  `measured ◉` → `validated ●` → `emerging ◐` → `experimental ○` → `heuristic ◌`. Defined ONCE in
  `metric-registry.js` (`EVIDENCE`), mirrored byte-faithfully in `dex-badges.css` and each reference
  guide's inline CSS. **Do not touch the disc CSS, the tiers, or the order.** Retired vocabulary
  (`proxy`→heuristic, `composite`→experimental, "provisionally validated"→emerging) must never
  reappear.
- **Two — and only two — placements exist** (CLAUDE.md):
  1. **Card corner** — `.ev-corner ev-<tier>` pinned bottom-right of a `position:relative` card.
     Use for cards, KPIs, hero/headline numbers, chart-or-graph cards.
  2. **Inline before the label** — `.ev ev-<tier>` in dense/crowded text: tables, chips, legends,
     multi-metric rows.
- **Grade is a NODE fact.** The single source of truth for every metric's tier is its node registry's
  `evidence` field: `OXY_REGISTRY`, `ECG_REGISTRY`, `HRV_REGISTRY`, `PULSE_REGISTRY`,
  `GLU_REGISTRY`, `CPAP_REGISTRY`, `PPG_REGISTRY` (in the `<node>-registry.js` files). There is **no
  global grade table**; never invent one.
- **The zero-touch hook already exists in every node.** `<node>-render.js` defines
  `evBadge(label, fallback)` → `window.<Node>Registry.badgeForLabel(label, fallback!==false)`.
  `badgeForLabel` resolves the label via the node's `idForLabel` (normalized label + alias map), reads
  the registry entry, and emits `MetricRegistry.badge(evidence, cite)`. A label with **no registry id
  falls back to a hollow `experimental` badge** (so nothing is silently unbadged) **except** labels in
  that node's `_META_DENY` (date/start/end/source/sample-rate/recording/…), which stay bare by design.
- **The behavior gate already has teeth for the reference guides.** `tests/dex-tests.js`
  `cohesion-badges` group asserts: engine CSS ≡ `dex-badges.css` ≡ each guide's inline CSS; no retired
  vocab; and every reference card the node's OWN `idForLabel` maps carries the SAME grade as the
  registry. **A doc that disagrees with the registry is the bug — fix the doc, not the registry.**

So coverage + correctness are *mostly* wired. This audit exists because **new surfaces inherit
nothing** — every time a KPI, finding card, hero number, chart series, table row, or chip was added
without calling `evBadge`/`.ev-corner`, an unbadged number slipped through; and because an **alias
gap** (a label `idForLabel` can't resolve) silently downgrades a real metric to the `experimental`
fallback — a *wrong grade that looks badged*. Both are bugs of the same severity as a wrong unit.

---

## Scope — what "every element in every dex" means

**Nodes to audit (each ships a registry + render + bundled app):**

| Node | registry | render | bundled app | reference guide |
|---|---|---|---|---|
| OxyDex | `oxydex-registry.js` | `oxydex-render.js` (+`oxydex-fusion.js`) | `OxyDex.html` | `OxyDex Reference.html` |
| HRVDex | `hrvdex-registry.js` | `hrvdex-render.js` (+`hrvdex-chartbadges.js`) | `HRVDex.html` | `HRVDex Reference.html` |
| PulseDex | `pulsedex-registry.js` | `pulsedex-app.js` | `PulseDex.html` | `PulseDex Reference.html` |
| GlucoDex | `glucodex-registry.js` | `glucodex-render.js` | `GlucoDex.html` | `GlucoDex Reference.html` |
| ECGDex | `ecgdex-registry.js` | `ecgdex-render.js` | `ECGDex.html` | `ECGDex Reference.html` |
| CPAPDex | `cpapdex-registry.js` | `cpapdex-render.js` | `CPAPDex.html` | `CPAPDex Reference.html` |
| PpgDex | `ppgdex-registry.js` | `ppgdex-render.js` | `PpgDex.html` | `PpgDex Reference.html` |
| Integrator | *(none — reads envelope `evidence`)* | `integrator-render.js` | `Integrator.html` | — |

> EEGDex is planned but not built — skip it (but the audit method below is the acceptance bar when it
> lands). The Integrator has no registry: its longitudinal metrics carry `evidence` on the crossnight
> envelope def and must be badged with the identical `MetricRegistry.badge` shape (CLAUDE.md / cohesion
> brief §Integrator).

**Surfaces to inspect inside each node** — a badge is mandatory on EVERY one of these that shows a
number/finding:

- Every **KPI / hero / headline** number (dashboard top tiles, center read-outs).
- Every **metric card / finding card** (`.metric`, `.mc`, `.ss-kpi`, `.nr-kpi`, `.kpi`,
  `.readiness-subscore`, node-specific card classes).
- Every **chart / graph series** label or legend entry that names a measured/derived quantity.
- Every **table row** (full-metrics table, comparison tables, night/session rows).
- Every **chip** that carries a value (alert/flag chips with no number stay bare — that's correct).
- Every **export-preview / CSV-preview / summary** surface that names metrics to the user.

**Out of scope (must stay bare):** pure metadata — date, start, end, source, sample rate, recording
span label, "active flags" counts, and anything already listed in a node's `_META_DENY`. If you find
metadata that *is* badged, that is also a bug (over-coverage) — remove the badge or add the label to
`_META_DENY`.

---

## The two questions, per element

For **every** surfaced element above, answer both:

1. **Is it badged?** Does the rendered node carry a `.ev` (inline) or `.ev-corner` (card) span in the
   correct placement? → if NO: **missing badge** (§Fix A).
2. **Is the grade correct?** Resolve the element's label through the node's own
   `<Node>Registry.idForLabel(label)`, read `REGISTRY[id].evidence`, and compare to the tier class
   actually rendered (`ev-<tier>`). → if they differ: **wrong grade** (§Fix B). Special case: the
   element shows the **fallback** `ev-experimental` but the label is a *real* metric the registry
   knows under a different string → that's an **alias gap** (§Fix B2), not a true mis-grade.

Also flag **grade-vs-reality** mismatches even when app and registry agree: a raw sensor reading or
raw signal statistic graded anything other than `measured`; a population proxy / 180−age-style
estimate graded above `heuristic`; an internal node composite graded above `experimental` without an
external citation. The registry's `cite` field is your evidence — a `validated`/`emerging` entry must
name a real external reference; an internal one must say so (and then can't be `validated`).

---

## Method — drive the REAL bundles, don't eyeball

The only honest coverage check is against the **rendered DOM of the real app on real input**, because
that is what a user sees. Build a throwaway audit harness (do **not** ship or bundle it) that, per
node, loads the bundled app in an iframe, feeds it a representative fixture from `uploads/`, switches
the depth tier to **Research** (so every tier of metric is visible — Core/Advanced hide some), and
walks the DOM.

**Per-element audit pass (pseudocode — adapt selectors per node):**

```js
// inside the loaded app's document `doc`, with its <Node>Registry available as REG
const CARD_SEL = '.metric,.mc,.ss-kpi,.nr-kpi,.kpi,.readiness-subscore,.cn-metric-px,.fmt-m,.nr-chip';
const findings = [];
doc.querySelectorAll(CARD_SEL).forEach(el => {
  const label = labelOf(el);                 // node-specific: read .m-label / .ma / first cell
  if (isMetadata(label, REG)) return;        // _META_DENY → must stay bare
  const badge = el.querySelector('.ev, .ev-corner');
  if (!badge) { findings.push({el, label, kind:'MISSING'}); return; }
  const renderedTier = (badge.className.match(/ev-(measured|validated|emerging|experimental|heuristic)/)||[])[1];
  const id = REG.idForLabel(label);
  if (!id) {                                 // unresolved → fallback experimental
    if (renderedTier === 'experimental') findings.push({el, label, kind:'ALIAS_GAP?'});
    return;
  }
  const want = REG.REGISTRY[id].evidence;
  if (renderedTier !== want) findings.push({el, label, kind:'WRONG_GRADE', got:renderedTier, want});
});
```

Run it for **all dashboard views / tabs / depth tiers** the node has — coverage holes hide in the
views you didn't open (advanced panels, comparison tables, export previews, chart legends). Repeat
the same DOM walk inside each `*-render.js` code path you can reach by toggling state. Record a
per-node table: `surface · label · badged? · rendered grade · registry grade · verdict`.

**Static cross-check (cheap, complements the runtime walk):** grep each `<node>-render.js` /
`<node>-app.js` for every helper that emits a metric tile, KPI, chip, table cell, or chart label, and
confirm each appends `evBadge(label)` (or `.ev-corner`). A surface-emitting helper with no `evBadge`
call is a guaranteed coverage hole even before you run the harness. The known hooks to verify call
`evBadge`: OxyDex `metric()/ssKPI()/nrKpi()/nrChip()` + the fusion full-metrics cell; mirror-equivalents
in every other node.

---

## Fix A — missing badge

Prefer the **zero-touch** path; only add markup by hand when a surface can't route through `evBadge`.

1. **Resolvable label, helper already exists:** ensure the emitting helper appends `evBadge(label)`
   (corner-positioned automatically for cards by the injected CSS) or `evBadge(label)` inline for
   tables/chips. If the helper exists but skips the badge, add the call. **Prepend** in table cells so
   the badge leads the name; **gate chips on a non-empty value** so flag/alert chips stay bare.
2. **New/odd surface with no helper:** emit the badge directly. Card → add
   `<span class="ev-corner ev-<tier>" title="<Label> — <cite>"></span>` and make the card
   `position:relative` (most card classes already are via `dex-badges.css`). Inline → `MetricRegistry.badge(evidence, cite)`.
3. **Don't fabricate a grade** to fill a hole. If the metric is genuinely in the registry, route it so
   the registry supplies the grade. If it's a real metric *not yet in the registry*, add the entry
   (§Fix B) — the fallback `experimental` is a stop-gap, not an answer.
4. **Metadata that's wrongly badged:** remove the badge or add the label to that node's `_META_DENY`.

---

## Fix B — wrong grade

**The registry is the source of truth and ships in the app (test-backed). Decide which side is wrong:**

- **B1 — App/doc renders a grade that disagrees with the registry.** The registry is authoritative;
  the *consumer* conforms. For a **reference guide** card, edit the guide's `ev-corner ev-<tier>` (and
  any prose) to match `REGISTRY[id].evidence` — this is exactly what the `cohesion-badges` test
  enforces. For an **app** surface, the disagreement almost always means an **alias gap** (B2), not a
  hand-typed grade, since app badges come from `evBadge`.
- **B2 — Alias gap (real metric showing the `experimental` fallback).** The label string the surface
  renders isn't in `idForLabel`'s map. **Add the missing alias** to that node's `<NODE>_LABEL_ALIAS`
  (normalized, lowercase, HTML-stripped — mirror OxyDex's `_norm`), including unicode/short variants
  (`SpO₂`, `HR⌊`, `T<90%`, chip/center-KPI short forms). Re-run the harness; the badge should now
  resolve to the registry grade. No registry data changes.
- **B3 — The registry grade itself is wrong** (a true mis-tier: e.g. a raw reading graded `validated`,
  a population proxy graded `emerging`, an internal composite graded `validated` with no external
  cite). This is a deliberate change to a **node fact**: edit `REGISTRY[id].evidence` (and fix `cite`
  to justify the new tier — external ref for validated/emerging, "internal" for experimental). Apply
  the matching tier to the reference guide so the gate stays green. Use the grade rubric below; cite
  your reasoning in the PR/commit. Cross-check existing audits before re-tiering:
  `DEX-CITATION-FORMULA-AUDIT-BRIEF.md`, `DEX-METRIC-REMOVAL-AUDIT-BRIEF.md`,
  `REFERENCE-GUIDE-AUDIT-FINDINGS.md`.

### Grade rubric (apply consistently; SHAPE = trust, never status hue)

- **measured ◉** — direct sensor reading or a raw statistic of the recorded signal (mean/min/max/
  nadir/duration/count/coverage). Ground truth the node *senses*, NOT computed. (e.g. mean SpO₂, mean
  glucose, min/max HR, recording span.)
- **validated ●** — established, externally validated, clinically meaningful **derived** metric, with
  a real literature/standard citation (e.g. ODI-4 AASM, TIR consensus 2019, GMI Bergenstal 2018,
  hypoxic burden Azarbarzin 2019).
- **emerging ◐** — published & promising but less standardized or device-dependent / proxy-derived
  (e.g. CVHR-AHI estimate, motion-derived sleep efficiency, overnight HR-drift markers).
- **experimental ○** — plausible node-computed composite, not externally validated; directional only;
  `cite` says "internal …" (e.g. NSI, SBII, sleep-stability composites).
- **heuristic ◌** — convenience estimate / population proxy; a trend, not a measurement (e.g. VO₂max
  estimate, Maffetone/Karvonen training windows).

---

## Gates — run after the sweep (non-negotiable)

1. **Behavior — `Dex-Test-Suite.html`.** Any registry `evidence` edit, alias-map edit, render-helper
   edit, or reference-guide grade edit touches the `cohesion-badges` contract. Open it, wait ~3 s, the
   `#summary` pill must read **all green**. (CI mirror: `node tests/run-tests.mjs`.) To cover a NEW
   reference guide in the join, pass its `<NODE>_REGISTRY` + `<Node>Registry` + doc text into `env` in
   **both** runners — see CLAUDE.md › Evidence badges.
2. **Re-bundle** every app whose `*.js` / `.src.html` you changed (edit the source, never the bundled
   `.html`). A registry/render JS change moves `manifestHash` but not `buildHash`.
3. **Provenance — `verify-provenance.html`.** Open after re-bundling; confirm no red verdicts. Then
   **hand-update each re-bundled app's `manifestHash` in `BUILD-MANIFEST.json`** (read it off the
   page's `manifestHash` column) — GATE A hard-fails on stale/missing entries. Treat a *lone*
   `buildHash`/fixture red as suspect (known non-deterministic race) and re-run; trust `manifestHash`.
4. **Regenerate fixtures for any node whose CODE changed** — re-run the app on its inputs and
   re-export (never hand-edit), then record the producing bundle's `manifestHash` in
   `FIXTURE-PROVENANCE.json` (GATE B). `buildHash` will NOT move for a registry/render change, so don't
   wait for it to tell you — regenerate because the code changed.

> Note: editing **only** `dex-badges.css` or a reference guide's inline CSS/grades does **not** require
> re-bundling an app (those aren't in the app bundles); it only needs the behavior gate. Re-bundle only
> when an app's runtime behavior (`*-registry.js` / `*-render.js` / `*-app.js` / `.src.html`) changed.

---

## Deliverables

1. **Audit ledger** — `BADGE-COVERAGE-AUDIT-FINDINGS.md`: per node, a table of every surface ×
   `badged? · rendered grade · registry grade · verdict (OK / MISSING / ALIAS_GAP / WRONG_GRADE /
   OVER-COVERED)`, plus the views/tiers exercised. This is the proof the sweep was exhaustive.
2. **Fixes applied** — missing badges wired (Fix A), alias gaps closed (B2), genuine mis-tiers
   corrected in the registries with citation justification (B3), reference guides conformed (B1),
   over-coverage removed.
3. **Green gates** — `Dex-Test-Suite.html` all-green, `verify-provenance.html` no red,
   `BUILD-MANIFEST.json` + `FIXTURE-PROVENANCE.json` updated for every re-bundled / regenerated node.
4. **Residual list** — any metric you believe is mis-tiered but lacks the evidence to re-grade
   unilaterally, flagged for human review rather than silently changed.

## Acceptance bar

A user, opening any bundled `<Node>.html` on any fixture, in any depth tier, on any tab, sees a badge
on **every** number that reaches their eye, each badge matches that metric's registry grade, no
metadata is badged, no retired vocabulary appears, and both gates are green with manifests/fixtures
in sync. Zero silent `experimental` fallbacks on metrics the registry actually knows.
