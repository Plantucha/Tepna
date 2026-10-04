<!--
  VERDICT-CONTRIBUTIONS-2026-10-04-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-10-04 ·

# Attribution — every fused number says which input moved it (the `contributions` block; the "derivator", reading one)

**SIZED, NOT BUILT.** Owner ruling 2026-10-04 ("we have unit integrator, should we build derivator?" → "both").
This brief is the first reading: the inverse of fusion. The Integrator combines node exports into one
conclusion; a conclusion that cannot say which input moved it has to be re-derived by hand every time it
surprises someone. It was, three times in the week of 2026-09-29 → 10-04, each time by a bird reading code:

| fused figure | the question asked | who derived it, how long |
|---|---|---|
| PAT three-cornered hat, Verity corner **UNDERPOWERED** (−2540 ms², 47 windows) on 2026-10-04 | which leg's variance drives the subtraction | Kestrel + the page's RAW card, two screenshots and a reading of `analysis-stats.js` — the finger leg's 400 ms-wide uniform axis spread |
| SOLID-NIGHT **UNKNOWN** for the ring on 2026-10-02 and 10-04 | which band, and whether the band or the data | Wren, box-local: the timebase band read the polled `SPO2.csv`; one band from PASS |
| trio fold §11 re-derivation (#3255): H10 +2.1 %, O2 +0.9 %, Verity −44.7 % | which night, which seam | Heron: the 2026-09-21 night's 7.37 h replay seam inside one host axis, +4170 ppm published for a crystal |

In all three the answer existed in the inputs and nothing published it. The verdict object (`tepna.verdict/1`,
`VERDICT-CONTRACT-2026-09-21-BRIEF.md`) already carries `reason` for a non-PASS; it does not carry *how much of
the figure each input is*.

## 1 · The property

Every **fused** figure — one computed from more than one node's export, or from more than one device's leg —
publishes a `contributions` block beside it:

```json
"contributions": {
  "of": "sigma.ankle",
  "unit": "ms^2",
  "method": "leave-one-out",
  "inputs": [
    { "key": "leg.chest-finger", "share": 0.71, "delta": -1810.4 },
    { "key": "leg.chest-ankle",  "share": 0.09, "delta":   221.0 },
    { "key": "leg.finger-ankle", "share": 0.20, "delta":  -509.6 }
  ],
  "dominant": "leg.chest-finger"
}
```

- `method` is one of a closed set, pre-stated per figure: **`leave-one-out`** (recompute without the input;
  `delta` = figure with − figure without), **`analytic`** (a closed-form partial derivative where one exists —
  the hat's σ² = ½(V_ab + V_ac − V_bc) has one), **`decomposition`** (the figure is a sum or a count, and each
  input's term is its contribution — the loss bar's worn-minutes, the completeness denominator).
- `share` is `|delta| / Σ|delta|`, so shares sum to 1 over the inputs listed; `delta` keeps the sign and the
  figure's unit, never a percentage of a percentage.
- `dominant` is the largest `|delta|`; it is what a render names first and what a reader quotes.
- **∅ rule:** an input that was absent or refused is listed with `delta: null` and the refusal's reason, never
  omitted and never 0 — a missing leg is a contribution of *unknown*, and the hat's UNDERPOWERED verdict is
  the case where that matters.
- A figure with ONE input has no block (nothing to attribute); a figure over a single device's own streams is
  not fused unless it crosses streams with independent axes (ring SpO₂ vs ring PPG is two streams, one device,
  and IS fused for this purpose because their axes differ).

## 2 · Adoption set (named, gated — PARTIAL-ADOPTION rule)

| figure | file | method | why first |
|---|---|---|---|
| hat per-site σ (classic and drift-removed) | `analysis-stats.js tchSigmasPairwiseFromVars` | `analytic` | the UNDERPOWERED corner is the open question of the solid-night programme |
| SOLID-NIGHT night verdict | `capture-host/solid_night.py` compose | `decomposition` over bands × devices | "which band" is asked every morning |
| LOSS verdict `worn_not_recorded_fraction` | `capture-host/loss_audit.py night_verdict` | `decomposition` over devices and causes (`by_device` already exists — this names it as the block) | cheapest; mostly a rename |
| trio pooled hat §11 (`tch-pooled-hat-*.json`) | `tools/trio-batch.mjs` | `leave-one-out` over nights | the re-fold question: which night moved the pooled σ |
| Integrator fused sleep summary | `integrator-dsp.js` | `leave-one-out` over nodes | the Integrator is the namesake; last because its consumers are render-only today |

Everything else is out until it is added here; `verify:verdict-adoption` gains a `contributions` leg that reds
a figure in this table without the block and a block whose shares do not sum to 1 ± 1e-9.

## 3 · Cost, measured where it can be

- `decomposition` cases are bookkeeping over values already computed: LOSS and SOLID are ≤ 1 unit each.
- `analytic` for the hat: three partials of a closed form, one unit including the page card ("dominant leg").
- `leave-one-out` over 90 nights for the pooled hat: 90 re-solves of a 3×3 — seconds; one unit in `trio-batch`.
- Integrator: one unit, after the four above prove the shape.
- Render: one `.ev` card per adopted figure naming `dominant` and its `share`; the badge is the parent figure's.
- Fixtures: SOLID/LOSS are capture-host (no bundle hash moves); the hat and Integrator are JS → `computeHash`
  moves, goldens regenerate per node (`regen-integrator-goldens.mjs` exists; the analysis tools re-verify under
  `verify:analysis`).

## 4 · What this is not

- Not a new app or layer. A field on existing verdicts and exports, and a render card.
- Not causation. A share says how much of the figure an input *is*, under the stated method; the hat's finger
  share says the finger's variance dominates the subtraction, not that the ring is at fault — on 2026-10-04 it
  was the ring's **axis**, a capture-side fact (E11), and the block would have pointed there in one line.
- Not a replacement for `reason`: `reason` says why a verdict is not PASS; `contributions` says what a figure
  is made of, PASS or not.

## 5 · Done when

- [ ] `tepna.verdict/1` spec gains the optional `contributions` block with the three methods and the ∅ rule
  (`docs/VERDICT-CONTRACT.md`, MINOR changeset — a new optional field).
- [ ] The five figures in §2 publish it; `verify:verdict-adoption` reds a §2 figure without it.
- [ ] The hat page names the dominant leg on the UNDERPOWERED card; the SOLID morning verdict names the
  deciding band and device in its first line.
- [ ] One recorded night where the block answered "which input" without a bird reading code — cited here.

Companion: `NIGHTLY-CHANGE-DETECTION-2026-10-04-BRIEF.md` — **Differentiator**, reading two of the same ruling (the time derivative).

**Names (owner, 2026-10-04):** this reading is **Attribution** — a contract block, not a component, so it carries no proper
name beyond the field. The pair with the fusion layer is Integrator ↔ **Differentiator**; "derivator" is the owner's word for
the pair and stays in both briefs so a search for it lands here.
