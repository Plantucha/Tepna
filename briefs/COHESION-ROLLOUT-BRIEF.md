<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Build Brief — Cohesion Rollout (evidence badges + depth tiers → all nodes)

> **For a fresh AI coder.** Read `CLAUDE.md` first (esp. the build/bundle rule + the two gates), then
> `SYSTEM-COHESION-BRIEF.md` (the original design), then **the reference implementation — OxyDex** —
> which is DONE and is your exact template. This brief finishes the rollout the cohesion brief started:
> propagate the metric registry + disclosure tiers + evidence badges (now 5 levels) to the five nodes
> that still lack them, and sync the two spec docs. Everything is decided; clone, don't redesign.

---

## START HERE — what's already true (don't re-derive)

- **`metric-registry.js`** (shared, frozen-ish logic) already ships the full system: `EVIDENCE`
  taxonomy, `badge()`, `legend()`, depth tiers, `mountDepthSelector`, `getTier/setTier`
  (localStorage `dex_depth_tier`), and a one-time injected stylesheet that owns the badge VISUALS
  (corner placement, table-inline, chip-inline, the 5-level fill ladder). **You do not touch the
  placement CSS** — re-bundling any node inherits it.
- **The evidence ladder now has 5 levels** (top→bottom = most→least trustworthy):
  `measured` (bullseye ◉ — raw sensor reading / raw signal statistic) → `validated` (solid ●) →
  `emerging` (half ◐) → `experimental` (hollow ○) → `heuristic` (dashed ◌). `measured` was added
  2026-06 and is contract-locked in `tests/dex-tests.js`.
- **OxyDex is the reference.** Study these and replicate the pattern verbatim:
  - `oxydex-registry.js` — the per-node DATA file: `OXY_REGISTRY` (id → {label,unit,goodDirection,
    depth,evidence,cite}) + `OXY_LABEL_ALIAS` (normalized label → id) + `badgeForLabel(label,
    fallback)` + `_META_DENY` + `global.OxyRegistry`.
  - `oxydex-render.js` — the `evBadge(label)` hook (line ~1153) and how `metric()`, `ssKPI()`,
    `nrKpi()`, `nrChip()` call it. Chips badge only when they carry a value (flag chips stay bare).
  - `oxydex-fusion.js` — the full-metrics-table cell prepends `evBadge(row.m)` so the badge **leads**
    the metric name.
  - `OxyDex.src.html` — loads `metric-registry.js` then `oxydex-registry.js` BEFORE `oxydex-render.js`;
    the depth selector is mounted in the topbar.

## Per-node starting state (verified)

| Node | has `*-registry.js`? | has `evBadge` wiring? | render file |
|---|---|---|---|
| **OxyDex** | ✅ (reference) | ✅ | `oxydex-render.js` |
| ECGDex | ✅ | ✅ | `ecgdex-render.js` |
| PpgDex | ✅ | ✅ | `ppgdex-render.js` |
| PulseDex | ✅ | ✅ | `pulsedex-render.js` |
| GlucoDex | ✅ | ✅ | `glucodex-render.js` |
| HRVDex | ✅ | ✅ | `hrvdex-render.js` |

So each of the five is the SAME job: add a registry file, wire `evBadge` into its render helpers,
load it in its `.src.html`, re-bundle, gate.

---

## The job, per node (repeat 5×)

**1. Author `<node>-registry.js`** (clone `oxydex-registry.js` structure exactly):
   - One entry per metric the node renders. Keep `label`/`unit`/`goodDirection` **identical to the
     node's `*-cross.js` `*_DEFS`** (where one exists — ECGDex/PpgDex/PulseDex have `*-cross.js`;
     GlucoDex/HRVDex may not) so the registry and the self-describing envelope never diverge.
   - Assign `depth` (basic/advanced/research) + `evidence` + a short `cite` per metric.
   - **`evidence` assignment rule (the important judgment call):**
     - `measured` — a **direct sensor reading or a raw statistic of the recorded signal**
       (mean/min/max/nadir/SD/duration/coverage). Examples: ECG mean/min/max HR, raw RR count;
       Pulse/PPG mean HR; Gluco mean glucose, min/max glucose; any "% time recorded"/duration.
     - `validated` — a clinically-validated **derived** metric (SDNN/RMSSD/pNN50 for HRV; TIR/GMI/CV
       for glucose; ODI/AHI families). Derived but established.
     - `emerging` — published but device-dependent / less standardized (DFA-α1, CVHR-AHI surrogate,
       motion-sleep efficiency).
     - `experimental` — node-internal composites (stability indices, custom scores).
     - `heuristic` — population proxies / projections (ANS-age, VO₂ est, BP projection).
   - Include `OXY_LABEL_ALIAS`-equivalent: map every **short label as actually rendered** (chip
     labels, KPI labels, table labels — incl. unicode like `SpO₂`, `HR⌊`, `T<90%`) to its id. Mirror
     OxyDex's `_norm()` (lowercases + strips HTML + collapses spaces).
   - Copy `badgeForLabel(label, fallback)` verbatim: id→entry→`MetricRegistry.badge`; **no id +
     fallback ⇒ `MetricRegistry.badge('experimental','')`** (so nothing is silently unbadged), EXCEPT
     labels in `_META_DENY` (date/start/end/source/sample rate/recording/…). Extend `_META_DENY` with
     any node-specific metadata labels.
   - Export `global.<Node>Registry = { REGISTRY, ALIAS, idForLabel, badgeForLabel, depthForLabel }`.

**2. Wire `evBadge` into `<node>-render.js`** (clone the OxyDex hook):
   ```js
   function evBadge(label, fallback){
     try { return (window.<Node>Registry && window.<Node>Registry.badgeForLabel(label, fallback!==false)) || ''; }
     catch(e){ return ''; }
   }
   ```
   Then append `evBadge(label)` inside every metric-emitting helper: KPI label, card `.m-label`,
   table metric cell (**prepend** so the badge leads the name), and chips (**gate on non-empty value**
   so alert/flag chips stay bare). The injected CSS positions each correctly by context — you only
   emit the `<span>`.

**3. Depth selector** — mount `MetricRegistry.mountDepthSelector(el)` in the node's topbar (clone the
   OxyDex `.src.html` placement) so all nodes share the `dex_depth_tier` key. If the node already has
   a local mode bar, point it at the shared key instead of a local one (OxyDex shows the migration).

**4. Load order in `<Node>.src.html`:** `metric-registry.js` → `<node>-registry.js` → `<node>-render.js`.

**5. Re-bundle** `<Node>.src.html` → `<Node>.html` via the inliner (`super_inline_html`). Re-bundling
   also pulls in the current placement CSS, so the corner/measured badges appear automatically.

---

## Integrator (one extra touch)

`integrator-render.js` longitudinal view should badge longitudinal metrics with the same
`MetricRegistry.badge`. The crossnight envelope already carries `evidence` per metric def (see
`tests/dex-tests.js` group 7) — make the longitudinal renderer read it and emit a badge, identical
shape to the nodes. No new registry file needed; it consumes the envelope's `evidence` field.

## Spec docs to sync (so the spec stops lying)

- **`Visual-Language-Spec.html`** — update the evidence section: the ladder is now **5 levels**
  (add `measured` ◉ at the top, "direct sensor reading — the strongest evidence, not computed"), and
  the placement line should read **"badge sits in the card's bottom-right corner; inline+leading in
  dense tables; after the value on chips"** (currently says "by the label"). Lines ~342–344.
- **`SYSTEM-COHESION-BRIEF.md`** — §3: add `measured` to the taxonomy; update the placement note
  (corner, not "right after the label"). Mark the rollout status table: all nodes ✅ when done.

## Gates (run after EACH node's re-bundle — non-negotiable)

1. **`Dex-Test-Suite.html`** → `#summary` must say **all green** (baseline as of 2026-06-14:
   **272 passed / 24 groups** — this already includes the shipped self-gate work, group 22).
   The render-coverage group boots a real bundle in an iframe, so it catches a node that fails to
   load its new registry. If you add per-node registry assertions, add them to `tests/dex-tests.js`
   (shared with Node CI `node tests/run-tests.mjs`).
2. **`verify-provenance.html`** → no red buildHash **mismatches**. NOTE: a registry/CSS/JS-only change
   does NOT shift a node's `buildHash` (it hashes only the `__bundler/template` HTML) — so provenance
   should stay clean and committed exports keep tracing. Editing a node's `.src.html` (e.g. mounting
   the depth selector) WILL shift its hash; that's expected — confirm only that no committed fixture
   flips to mismatch unexpectedly.

## Handoff status (2026-06-14)

- Reference node **OxyDex is fully done and proven**: 5-level ladder incl. `measured`, corner badges
  on cards, inline-leading in the full-metrics table, badged chips (flag chips bare), the
  experimental fallback, and the contract-lock test in `tests/dex-tests.js`. Clone it verbatim.
- The shared `metric-registry.js` placement CSS is already live — re-bundling any node inherits the
  corner/measured visuals with zero CSS work.
- Baseline gates are green: test suite 272/24, `verify-provenance.html` zero red. Keep them there.
- This rollout touches the **five other nodes + Integrator longitudinal + two spec docs** only; it
  does NOT touch OxyDex, the self-gate, CPAPDex, or the fusion window.

## Suggested order

ECGDex → PulseDex → PpgDex (these three have `*-cross.js` `*_DEFS` to copy labels from) →
GlucoDex → HRVDex → Integrator longitudinal → spec docs. Gate after every re-bundle; stop on first
red and fix before continuing. ~6 small, mechanical passes — the design work is already done in
OxyDex.
