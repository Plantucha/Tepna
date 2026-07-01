<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Build Brief — System Cohesion: Metric Registry · Disclosure Tiers · Epistemic Hierarchy · Lexicon

> **For a fresh AI coder (Claude Code preferred for the rollout).** Read `CLAUDE.md` first, then
> this brief, then ONE node to clone the pattern (`oxydex-render.js` + `oxydex-cross.js`). Everything
> is decided below — do not re-litigate. This brief exists so you spend tokens building, not
> re-deriving. The work is **strictly additive** (Preservation Rule, below) — nothing visible today
> is removed; it is re-tiered and badged.

---

## START HERE (bootstrap — skip re-exploration)

**The problem (from project review):** the suite has hit feature saturation. Three concrete defects:
1. **Cognitive load** — every metric competes for attention; normal users are overwhelmed, experts fine.
2. **No clinical/epistemic hierarchy** — validated metrics (ODI-4, hypoxic burden) look visually equal
   to experimental composites (NSI, sleep-stability score). Trust suffers.
3. **Naming feels disjoint** — Ganglior / -Dex / Integrator / "Tepna" read as separate
   inventions rather than one system.

**The root cause (single):** metric metadata is *implicit and scattered* inside render functions.
Each metric's label, unit, good-direction, complexity, and trustworthiness live ad hoc in markup.

**The fix (single backbone):** a declarative **metric registry** per node. One map, suite convention
(duplicated-local like `parseTimestamp`). It already started: the `ganglior.crossnight` envelope made
metrics self-describing (`label`/`unit`/`goodDirection`). We extend that with two new fields —
`depth` and `evidence` — and drive everything off them:

- `depth` → disclosure tiering (concern #1)
- `evidence` → epistemic visual hierarchy (concern #2)
- canonical `label` + a lexicon doc → naming consistency (concern #3)

It also propagates **for free** into the Integrator's longitudinal view, which already reads envelope
metric defs (`integrator-longitudinal.js`).

**Locked decisions:**
1. **Two INDEPENDENT axes, never collapsed into one "mode":** `depth` (how *much* — Basic/Advanced/
   Research) and `evidence` (how *trustworthy* — validated/emerging/experimental/heuristic). A Basic
   metric can be Validated; a Research metric is usually Experimental. Keep them as two fields.
2. **`evidence` is encoded in a NON-HUE visual channel** (fill/shape/opacity/glyph), because color is
   already saturated by status (ok/warn/bad = green/amber/red). Adding a second hue axis would collide.
3. **One shared helper `metric-registry.js`** (the SHAPE + visual constants + tier filter + badge
   renderer), mirroring how `crossnight-envelope.js` is the one shared shape file. Each node declares
   its OWN registry DATA locally (node-specific). Shared logic, local data — same split as the envelope.
4. **Depth tier persists in localStorage under ONE shared key** (`dex_depth_tier`) so setting it in any
   node carries across the suite. Default **Basic**.
5. **OxyDex is the reference implementation** (worst saturation, clearest validated-vs-experimental
   split). Prove the model there, then propagate. Same playbook as the crossnight-envelope rollout.

> ### 🔒 PRESERVATION RULE (non-negotiable, every file touched)
> Additive only. **No metric, card, number, or control is removed.** Research tier = the "everything"
> tier — today's full dashboards become the top tier, not the default. With the depth selector on
> Research, every screen is byte-identical to today. Basic/Advanced are strict SUBSETS (progressive
> disclosure). Re-verify: switch to Research → the current UI is reproduced exactly.

---

## 1. The metric registry (the backbone)

A per-node declarative map. Suite convention: **duplicate locally** in each node (mirror, don't import
the data). Schema:

```js
// e.g. in oxydex-registry.js (new small file per node) OR inline in *-render.js
const OXY_REGISTRY = {
  odi4: { label:'ODI-4', unit:'/hr', goodDirection:'down',
          depth:'basic', evidence:'validated', cite:'AASM 4% desaturation index' },
  hypoxicBurden: { label:'Hypoxic burden', unit:'%min/h', goodDirection:'down',
          depth:'advanced', evidence:'validated', cite:'Azarbarzin 2019' },
  nsi: { label:'NSI', unit:'', goodDirection:'down',
          depth:'research', evidence:'experimental', cite:'OxyDex composite — internal' },
  ansAge: { label:'ANS age', unit:'yr', goodDirection:'down',
          depth:'advanced', evidence:'heuristic', cite:'3-marker HRV→population-norm projection' },
  // …one entry per surfaced metric
};
```

Fields:
- `label`, `unit`, `goodDirection` — already in the crossnight defs; keep identical so the registry is
  the single source feeding both screen + envelope.
- `depth` ∈ `'basic' | 'advanced' | 'research'`.
- `evidence` ∈ `'measured' | 'validated' | 'emerging' | 'experimental' | 'heuristic'`.
- `cite` — short provenance string (literature ref OR "internal composite"). Surfaced on hover/legend.

**Render functions read the registry** instead of hardcoding labels. A metric with no registry entry
defaults to `depth:'advanced', evidence:'experimental'` and logs a dev warning (forces coverage).

---

## 2. Disclosure tiering (concern #1)

> **⚠ This mechanism ALREADY EXISTS in `ans-design.css` — reuse it, do not reinvent.** The
> segmented control is `.mode-bar` / `.mode-btn`; it sets `body[data-mode="core|advanced|research"]`;
> visibility is gated by `[data-tier="secondary"]` / `[data-tier="research"]` attributes (see the
> "Data-tier visibility" block in ans-design.css, and OxyDex which already uses it). The registry's
> `depth` field just EMITS these attributes. The tiers are named **Core · Advanced · Research** in the
> existing code — keep that wording (the `depth:'basic'` value maps to the Core/no-tier bucket).

- **Mapping:** `depth:'basic'` → no `data-tier` (always visible / Core). `depth:'advanced'` →
  `data-tier="secondary"`. `depth:'research'` → `data-tier="research"`. The CSS already does the rest.
- Persist the selected mode in localStorage key **`dex_depth_tier`** (shared across nodes); default
  **Core**. On load, set `body[data-mode]` from it. A tiny shared helper
  `MetricRegistry.mountDepthSelector(el)` can wrap the existing `.mode-bar` markup + persistence so
  every node wires it identically — but the CSS/visibility is the existing system.
- **Card-level gating:** a whole card hides only if ALL its metrics are above the current tier. Cards
  that contain a mix show at the lowest tier any of their metrics require, and gate individual rows.
- **Tier assignment rule of thumb:**
  - *Core* (`depth:'basic'`) — the readiness hero, 4–5 headline KPIs, one plain-language line.
  - *Advanced* (`depth:'advanced'`) — full metric tables, charts, morphology, CVHR, validation lanes.
  - *Research* (`depth:'research'`) — experimental composites, DFA/SampEn, the OxyDex `research:{}` dump
    (`tIdx/ct94/pbMet/ssi/hypLoad/circHR/...` — tier-gate this block, do NOT delete it).
- Default Basic. Expert opts *up*. Normal user never meets the firehose.

---

## 3. Epistemic visual hierarchy (concern #2)

**Encode evidence in shape/fill — never hue.** A small consistent badge per metric + one legend.
The visual language is SETTLED — see `Visual-Language-Spec.html` (rendered reference) and use the
copy-paste CSS below verbatim. Do NOT redesign it; just propagate it.

| class | meaning | fill |
|---|---|---|
| `measured` | direct sensor reading / raw signal statistic (mean·min·max·nadir·duration·coverage) — the strongest evidence, not computed | ◉ bullseye |
| `validated` | established, externally validated, clinically meaningful **derived** metric | ● solid |
| `emerging` | published, less standardized / device-dependent | ◐ half |
| `experimental` | plausible, node-computed composite, not externally validated | ○ hollow ring |
| `heuristic` | convenience estimate / population proxy | ◌ dashed ring |

**Settled encoding rules (verbatim into every node):**
1. Evidence uses fill/shape on ONE neutral META ink (`--ev-ink:#aab8cc`) — never green/amber/red
   (status) or teal/blue (brand). This is what prevents collision with the status colors.
2. Fill ladder = confidence ladder: bullseye ◉ (measured) → solid ● → half ◐ → hollow ○ → dashed ◌.
3. Status hue stays on the value + KPI top-bar; the evidence badge sits quietly in the card's bottom-right CORNER (inline + leading in dense tables; after the value on chips). They
   never share a channel. (A green/Validated ODI-4 and a green/Experimental composite must be visibly
   distinguishable — that's the whole point.)
4. Legend: one strip per view; `cite` string on the badge's `title` (hover).

**Copy-paste CSS (shared — lives in `metric-registry.js` injected styles or ans-design.css):**
```css
:root{ --ev-ink:#aab8cc; }
.ev{ display:inline-block;width:11px;height:11px;border-radius:50%;flex:none;vertical-align:baseline; }
.ev-measured   { background:var(--ev-ink); border:2px solid var(--bg); box-shadow:0 0 0 1px var(--ev-ink); }
.ev-validated   { background:var(--ev-ink); box-shadow:0 0 0 1px var(--ev-ink) inset; }
.ev-emerging    { background:linear-gradient(90deg,var(--ev-ink) 0 50%,transparent 50% 100%); box-shadow:0 0 0 1.5px var(--ev-ink) inset; }
.ev-experimental{ background:transparent; box-shadow:0 0 0 1.5px var(--ev-ink) inset; }
.ev-heuristic   { background:transparent; border:1.5px dashed var(--ev-ink); width:12px;height:12px; }
```

- `MetricRegistry.badge(evidenceClass, cite) → '<span class="ev ev-«class»" title="«Class» — «cite»"></span>'`
  (shared, so a Validated dot is identical in every node + the Integrator longitudinal view).
- Badge placement: the evidence badge sits in the **card's bottom-right corner** (a quiet meta-marker that
  never competes with the value or its status hue); **inline + leading** in dense metric tables (a fixed
  left gutter so rows align); **after the value** on chips. The shared placement CSS in `metric-registry.js`
  positions each by context — every node only emits the `<span>`.
- One **evidence legend** strip per view (the `.ev-legend` component in the spec file). Collapsible OK.
- The honesty is ALREADY in the copy ("screen not diagnosis", "provisional, ACC-derived", "directional,
  small n"). This makes that latent knowledge glanceable + machine-readable. Keep the prose notes too.

**Evidence assignments (starting taxonomy — refine with citations, but ship these defaults):**

- **OxyDex** — measured (raw oximeter/pulse stats): `meanSpo2, minSpo2, spo2Nadir, meanHr, minHr, maxHr,
  duration, motion`. validated: `odi4, odi3, t90, t95, t88, hypoxicBurden, desatProfile`.
  emerging: `cvhrIndex/ahiEst, sleepEfficiency(motion), spo2Drift`. experimental: `nsi, sleepStability,
  sbii, most of research:{}`. heuristic: `ansAgeProxy, vo2est, bpProj`.
- **ECGDex** — measured (raw beat stats): `meanHR, steps, % analyzable, coverage, correction, meanSQI,
  ectopy`. validated: `rmssd, sdnn, pnn50, lf, hf, lfhf, qtc, sd1, sd2`. emerging: `dfaAlpha1, sampEn,
  cvhrIndex, decelCapacity(DC/AC), QTc(+PPG caveat)`. experimental: in-app composites/instability slopes.
  heuristic: `ansAge, vo2max`.
- **PpgDex** — measured (direct optical/QC): `pulseHR, perfusionIndex, riseTime, motionRejectedPct,
  % analyzable, correction, meanSQI`. validated (PPI HRV): `rmssd, sdnn, lnRMSSD, pnn50`. emerging
  (optical → caveat vs ECG-RR): `dicroticNotch, augmentationIndex, cvhrIndex, dfaAlpha1`. experimental:
  HRV-score composite. heuristic: `ansAge, vo2est`.
- **PulseDex** — measured (raw RR stats): `meanHR, meanRR, medianRR, coverage, artifacts`. validated
  (math): `rmssd, sdnn, pnn50, lfhf, sd1sd2, triIndex`. emerging: `dfaAlpha1, sampEn`. validated index:
  `baevskySI`. heuristic/vendor-style: `hrvScore, stress`.
- **GlucoDex** — measured (raw glucose stats/coverage): `meanGlucose, SD, pctActive, MAG`. validated:
  `TIR, TITR, TBR, TAR, GMI, CV, MAGE, MODD, CONGA, GRADE, LBGI, HBGI`. emerging: `dawnSurge, GVP`.
  experimental: fusion composites.

---

## 4. Naming lexicon (concern #3) — a guide, NOT a rename

**Constraint:** `Ganglior` is FROZEN (CLAUDE.md). A `Ganglior→Fascia` rename is already parked behind a
single constant. **Do not rename anything.** Fix cohesion with role-language + a one-page lexicon.

The metaphor is already latent and strong — this is a **nervous system**. Codify it:
- **-Dex nodes** = afferent receptors (each senses one signal).
- **Ganglior** = the relay bus (ganglia = nerve junctions) — fits already; untouched.
- **Integrator** = central integration (afferent signals converge into perception).
- **"Tepna"** = the tagline (the *what*), not a fourth sibling brand.

The arc afferent → relay → integration → efferent insight is a literal reflex arc. Deliverable: a
`LEXICON.md` style guide — metaphor, role of each tier, capitalization/typographic rules, and the
recipe for naming a new node (so CPAPDex / EEGDex slot in without debate). Branding becomes systematic
through documentation, not risky renames.

---

## 5. File layout (suite convention)

Edit `.js` + `.src.html`, **never** the bundled `.html`; re-bundle after. Per the suite split:
- **`metric-registry.js`** — NEW shared file (like `crossnight-envelope.js`). Exposes
  `window.MetricRegistry = { EVIDENCE, visibleAtTier, badge, legend, mountDepthSelector, getTier,
  setTier }`. Pure + DOM-badge helpers. No node-specific data.
- **`<node>-registry.js`** (or inline in `<node>-render.js`) — the per-node DATA map (§1). Local.
- Wire the registry into each `<node>-render.js` (read labels/badges/tier from it) and add the depth
  selector to each `<node>.src.html` topbar. Load `metric-registry.js` before the node's render script.
- Re-bundle every touched `*.src.html` → `*.html` via the inliner.
- **Integrator:** add `evidence` to the crossnight envelope metric defs (one field) so
  `integrator-longitudinal.js` can badge longitudinal metrics with the same `MetricRegistry.badge`.

---

## 6. Verification (clone each node's existing checks + add)

1. **Preservation:** depth selector → Research reproduces today's UI exactly (screenshot-compare; diff
   exports). No metric/card/number removed.
2. **Tiering:** Basic shows only `basic` metrics; Advanced adds `advanced`; Research adds all. Cards
   with all-metrics-above-tier hide; mixed cards show + gate rows. Tier persists across reload AND
   across nodes (shared localStorage key).
3. **Badges:** every surfaced metric carries an evidence badge; unregistered metric → default +
   dev-warn. Legend present once per view. `cite` on hover.
4. **Non-collision:** evidence badges use no status hue (green/amber/red stay status-only).
5. **Envelope:** crossnight defs gain `evidence`; Integrator longitudinal badges match the node's.
6. **Clock contract** untouched; re-bundle; 100% local; no console errors.

---

## 7. Build order

1. **`metric-registry.js`** — shared helper: `EVIDENCE` constants, `visibleAtTier`, `badge`, `legend`,
   `mountDepthSelector`, `getTier`/`setTier` (localStorage `dex_depth_tier`). No data.
2. **OxyDex reference** — author `OXY_REGISTRY` (§1 + §3 assignments); wire `oxydex-render.js` to read
   labels/badges/tier from it; add the depth selector to `OxyDex.src.html` topbar; tier-gate the
   `research:{}` block. Re-bundle. Verify §6. **This is the proof — stop and confirm the two-axis model
   feels right before propagating.**
3. **Propagate** to ECGDex, PpgDex, PulseDex, GlucoDex, HRVDex (registry data + render wiring + selector
   + re-bundle), one node per commit.
4. **Envelope + Integrator** — add `evidence` to crossnight metric defs across nodes; badge the
   longitudinal view.
5. **`LEXICON.md`** — the naming style guide (§4). Cheap; anytime.

---

## 8. Done criteria

- Every node has a 3-tier depth selector (Basic default), shared across the suite via one localStorage
  key; Research reproduces today's UI byte-for-byte.
- Every surfaced metric carries a non-hue evidence badge driven by a declarative registry; one legend
  per view; `cite` provenance on hover.
- The two axes (depth, evidence) are independent and both legible at a glance.
- Crossnight envelopes carry `evidence`; the Integrator longitudinal view badges metrics identically.
- `LEXICON.md` codifies the nervous-system naming system; nothing renamed.
- All `*.src.html` re-bundled; 100% local; no console errors; Clock Contract intact.

---

## Rollout status (2026-06-14 — COMPLETE)

The 5-level evidence ladder (incl. `measured`), depth tiers, and evidence badges ship in **every** node
plus the Integrator longitudinal view:

| Node | registry | evBadge wiring | shared depth selector |
|---|---|---|---|
| OxyDex (reference) | ✅ | ✅ | ✅ |
| ECGDex | ✅ | ✅ | ✅ |
| PpgDex | ✅ | ✅ | ✅ |
| PulseDex | ✅ | ✅ | ✅ |
| GlucoDex | ✅ | ✅ | ✅ |
| HRVDex | ✅ | ✅ | ✅ (migrated off `hrvdex_dashMode`) |
| Integrator longitudinal | n/a (consumes envelope `evidence`) | ✅ | — |

Gates green at completion: `Dex-Test-Suite.html` 272/24, `verify-provenance.html` zero red.
