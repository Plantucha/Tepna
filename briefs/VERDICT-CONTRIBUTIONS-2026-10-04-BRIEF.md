<!--
  VERDICT-CONTRIBUTIONS-2026-10-04-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** IN-PROGRESS — 2026-10-12 · ⚠️ **API-LANE TRIAGE 2026-11-04 — RE-VERIFIED BY MAGPIE, NOT TAKEN ON ITS WORD.** §5.1's box ticks: the contributions group re-ran green here, the validator ships in `verdict.js`, and the contract section is in place. The rest stay open, since two figures of the five publish the block and the recorded night still waits on a reader. · ⚠️ **HAT PAGE HALF BUILT 2026-11-04 (Magpie)** — the UNDERPOWERED card now names the dominant leg; §5's second box stays open for its SOLID morning-verdict half. · **Created:** 2026-10-04 · **Residue:** 2026-10-12-hat-contribution-row-names-a-solve-with-no-closed-form

# Attribution — every fused number says which input moved it (the `contributions` block; the "derivator", reading one)

**ACCEPTANCE ITEM 1 BUILT 2026-10-12** — `tepna.verdict/1` carries the optional `contributions`
block, `verdict.js` validates every rule in §1, and `docs/VERDICT-CONTRACT.md` documents it.

**THE §2 GATE LEG IS BUILT 2026-10-12** — `verify:verdict-adoption` carries a `contributions` leg
whose population is the §2 table below. It parses that table at every run and compares it with the
rows in `tools/verdict-adoption.json` both ways, so a figure added here with no row reds by name and
a row matching no figure reds by name.

All five figures sit at `status: pending` with a `since` date. An `adopted` row must name `emits`,
the gate reads that object, and `validate()` must report `contributions` among the fields it
EXAMINED — a valid object whose validator never looked at the block is a pass over something never
read.

The five figures themselves are not built. The two capture-host ones go to the box session, and the
three JS ones follow the accepted order: the hat, then the trio pooled hat after the re-fold lands,
then the Integrator. The final acceptance item needs a recorded night.

Two rules reach further than §1 spells out, both written down in the contract doc: a `share` holds
the computed ratio rather than a display rounding, and one unknown `delta` nulls every share and
`dominant` rather than normalise over the legs that did run (§∅).

**SIZED, NOT BUILT (§2 onward).** Owner ruling 2026-10-04 ("we have unit integrator, should we build derivator?" → "both").
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
| hat per-site σ (classic and drift-removed) | `analysis-stats.js threeCorneredHat` | `analytic` | the UNDERPOWERED corner is the open question of the solid-night programme |
| SOLID-NIGHT night verdict | `capture-host/solid_night.py` compose | `decomposition` over bands × devices | "which band" is asked every morning |
| LOSS verdict `worn_not_recorded_fraction` | `capture-host/loss_audit.py night_verdict` | `decomposition` over devices and causes (`by_device` already exists — this names it as the block) | cheapest; mostly a rename |
| trio pooled hat §11 (`tch-pooled-hat-*.json`) | `tools/tch-pooled-hat.mjs` | `leave-one-out` over nights | the re-fold question: which night moved the pooled σ |
| Integrator fused sleep summary | `integrator-dsp.js` | `leave-one-out` over nodes | the Integrator is the namesake; last because its consumers are render-only today |

The hat row names the closed form, `threeCorneredHat`. The correlated solve `tchSigmasPairwiseFromVars` is out:
it is a damped-Newton iteration, so it has no closed-form partials (residue `2026-10-12-hat-contribution-row-names-a-solve-with-no-closed-form`).
No reader-facing surface shows a σ from it. The trio card shows its pass count only, and the independence panel shows a ρ-collapse point.
Add it here only when a surface starts to show its σ.

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

- [x] `tepna.verdict/1` spec gains the optional `contributions` block with the three methods and the ∅ rule
  (`docs/VERDICT-CONTRACT.md`, MINOR changeset — a new optional field).
      ✅ **met 2026-11-04 (Magpie)** — `node tests/run-tests.mjs --group=contributions` reads
      `✓ all 48 assertions passed  (2 groups)` in my worktree. I re-read the citations: `_contributions` at
      `verdict.js:67`, the `checked[]` push and call at `verdict.js:241`, and the contract section at
      `docs/VERDICT-CONTRACT.md:72` onward. #3504 shipped it as a MINOR changeset, released in the
      `CHANGELOG.md` entry for that version.
- [ ] The five figures in §2 publish it; `verify:verdict-adoption` reds a §2 figure without it.
      ⚠️ **TWO OF THE FIVE 2026-11-04 (Magpie).** The trio pooled hat publishes the block by
      leave-one-out over nights, and its row is `adopted` with `emits`, so the gate RUNS
      `node tools/tch-pooled-hat.mjs --verdict-sample` and reads the block rather than taking the
      row's word. `node tools/tch-pooled-hat.mjs --selftest` reads `✓ selftest — 12 passed, 0 failed`.
      🔴 **THE ROW NAMED A FILE THAT COMPUTES NO HAT, and the gate could not see it.** It read
      `tools/trio-batch.mjs`, where the three hat identifiers match zero times, while all five
      published figures stamp `producer: tools/tch-pooled-hat.mjs`. The pairing comes from §1's own
      example, which puts gate `tch-pooled-hat` beside `producedBy.tool: tools/trio-batch.mjs`. The
      file is corrected above; the mechanism is row
      `2026-11-04-the-adoption-gate-cross-checks-two-copies-of-one-claim`, because the leg compares a
      row only against this table and two copies of one wrong claim agree forever.
      ⚠️ **What this block does NOT claim:** the deltas do not sum to the figure. Each is measured
      against a different pool of n−1 and the removals overlap, so a leave-one-out set is not a
      decomposition, and the selftest asserts the gap rather than leaving a reader to assume the
      analytic row's identity holds here.
- [ ] The hat page names the dominant leg on the UNDERPOWERED card; the SOLID morning verdict names the
  deciding band and device in its first line.
      ⚠️ **HALF MET 2026-11-04 (Magpie) — the box stays open for the SOLID half, which is capture-host.**
      The hat half is built: `pat-feasibility-worker.js threeHat` publishes a `contributions` block per
      corner, and `pat-feasibility.js domClause` appends the dominant leg to the UNDERPOWERED card. On the
      recorded 2026-09-26 night the chest card now reads
      `· finger-ankle carries it, 52 % of the movement` — the pair that corner subtracts.
      The worker calls `patHatContributionsFromVars`, never `patHatContributions`, because its dispersion
      is IQR/1.349 of the window medians; `analysis-stats.js:753` states that hazard beside the kernel.
      §∅ — an unreadable leg nulls `dominant`, and the card then says
      `dominant leg not attributed — <reason>` and names no leg.
      ⚠️ **What the new tests do NOT pin, measured not assumed:** the delta-sum invariant does not
      discriminate the entry point. `_patRobustVar` IS (IQR/1.349)², and the suite's `leg()` repeats each
      window's value on every beat, so all three call forms summed to the same corner with a delta of
      exactly zero. A source assertion is the only thing pinning the entry point.
- [ ] One recorded night where the block answered "which input" without a bird reading code — cited here.

Companion: `NIGHTLY-CHANGE-DETECTION-2026-10-04-BRIEF.md` — **Differentiator**, reading two of the same ruling (the time derivative).

**Names (owner, 2026-10-04):** this reading is **Attribution** — a contract block, not a component, so it carries no proper
name beyond the field. The pair with the fusion layer is Integrator ↔ **Differentiator**; "derivator" is the owner's word for
the pair and stays in both briefs so a search for it lands here.
