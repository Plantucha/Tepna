<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-08-04 · **Follows:** `OXYDEX-PB-OVERCALL-2026-07-31-BRIEF.md` (DONE — 2026-08-04; all five Done-when items met) · **Relates:** `ECGDEX-CARDIOPULMONARY-COUPLING-2026-07-30-BRIEF.md` §10 (same family) · **Affects:** `oxydex-dsp.js`, `integrator-dsp.js`, the OxyDex reference guide, `tests/dex-tests.js`

# Two owner decisions the parent measured but deliberately did not make

The parent closed with every acceptance item met: the threshold has **no citation**, the operating-point
sweep says **no threshold on this corpus is defensible**, the imperative string was tempered and gated,
and the fusion leg was **measured** rather than reasoned about. What it did not do is *choose*, because
both remaining moves change what a user is told about their therapy — and that is the owner's call, not
a sweep's.

This brief carries those two decisions forward so they are not lost in a closed brief's prose.

## 1 · The fusion remedy (parent §6.4) — three options, all surface decisions

Measured: **0 of 3 corroborated nights survive removing the OxyDex leg.** The leg supplies no
discrimination, but removing it silences the fused finding entirely — the only other live observer is the
CPAP, and one observer never surfaces.

| # | remedy | measured cost |
|---|---|---|
| 1 | **Withdraw the OxyDex leg** from PB corroboration | **0/24 would corroborate.** A real loss of a surfaced finding with no measured compensating gain |
| 2 | **Keep the leg, stop calling it corroboration** — report the CPAP's device-scored PB, note the oximetry channel as concurrent-but-uninformative | wording only; this is the same question as item 3 below |
| 3 | **Fix the detector so the leg earns its place** — baseline-relative crossings, 40–90 s cycle length, ≥ 3 consecutive cycles | a new detector; needs its own brief and its own validation |

**Recommendation, stated so the decision has a default:** option 2. It is the only one that neither
destroys a surfaced finding nor ships an unvalidated detector, and it is reversible once option 3 exists.

## 2 · The `csLabels` likelihood vocabulary — the same overclaim, one layer down

`oxydex-dsp.js:1526` returns `csLabel: csLabels[cs]` over the ladder **`Unlikely · Possible · Probable ·
Likely`**, indexed by the same `csScore` the parent showed is a hypoxemia proxy with no periodicity test.
`:2242` then renders **`'CS pattern probable (' + csLabel + ')'`** — so a night reads *"CS pattern
probable (Likely)"*, asserting a likelihood twice, from a score that cannot support it once.

This is the parent's objection exactly, and the parent tempered the *sibling* string while leaving this
one. It was left because the blast radius is wider and genuinely three-part:

- `oxydex-dsp.js` — the vocabulary and the render string
- the **OxyDex reference guide** — carries the same grades, and `cohesion-badges` asserts guide ≡ registry
- the **findings card** — `push('cs', 'Cheyne-Stokes', …)` at `:2137`

so it cannot be a one-line edit, and a partial edit would red `cohesion-badges` parity.

**Guardrail, restated because the sweep makes it tempting:** do not tune `csScore`'s constants to improve
agreement with the CPAP's PB scoring. The device is **not** ground truth, n = 1, and the night-level
agreement was **κ = −0.039** — worse than chance.

## 3 · Done when

- [ ] The §1 fusion remedy is **chosen by the owner** and executed, with the choice and its reason
      recorded here — not inferred from a code change.
- [ ] The `csLabels` vocabulary either states an observation (as the parent's string now does) or is
      withdrawn; all three surfaces move together and `cohesion-badges` stays green.
- [ ] Whatever lands is **mutation-verified against its own revert**, as the parent's string was (the
      exact revert reds 7 assertions including a rewording-proof source scan).
- [ ] If option 3 is chosen, it is spawned as its OWN brief with its own validation — not patched in here.
