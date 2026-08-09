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
- [x] **DONE 2026-08-09 — the vocabulary is WITHDRAWN.** Four surfaces moved together (§2-RESULT):
      both label ladders → `N/3 indicators`, both lead strings → a bare count, the findings-card
      displayVal follows the ladder, and the guide's *"Cheyne-Stokes Probability (0–3)"* is restated as
      an indicator count that is explicitly not a probability. `cohesion-badges` green (267/267).
      ⚠️ Worth recording: `csScore` is **not in `oxydex-registry.js` at all**, so `cohesion-badges`
      never mapped that guide row — the parity this item worried about could not have fired. The same
      blind spot as the stale-citation class: a guide row for an unregistered metric is checked by
      nothing.
- [x] **DONE — mutation-verified.** The exact revert (ladder + lead) reds **5** assertions across both
      legs. The source scan is rewording-proof by construction now: its first version keyed on the
      literal `"CS pattern"` and went blind the moment the strings changed, caught only because the
      anti-vacuity count is an assertion rather than a comment. It now keys on the lead's SHAPE.
- [ ] If option 3 is chosen, it is spawned as its OWN brief with its own validation — not patched in here.


---

## §2-RESULT · EXECUTED 2026-08-09

**What was wrong.** `csLabels`/`uarsLabels` were `['Unlikely','Possible','Probable','Likely']` indexed
by a 0-3 indicator count, and `leads.cs` wrapped the result in `'CS pattern probable (…)'` — so a night
read **"CS pattern probable (Likely)"**, a likelihood asserted twice from a score that cannot support
it once.

**What moved** — four surfaces, together:

| surface | before | after |
|---|---|---|
| `csLabels` / `uarsLabels` | `Unlikely · Possible · Probable · Likely` | `0/3 … 3/3 indicators` |
| `leads.cs` / `leads.uars` | `CS pattern probable (Likely)` | `CS indicators 3/3` |
| findings-card `displayVal` | `Likely` | `3/3 indicators` |
| guide row | *Cheyne-Stokes **Probability** (0–3)* | *indicator count (0–3) — a screening tally, not a probability; no periodicity test* |

**The guardrail held.** `csScore`, its ladder and every gate on it are untouched. This is a wording
fix; §5.2 found no defensible threshold on this corpus, so retuning would be guessing.

**Two things only the real corpus and the gate could catch.**

1. **The first wording made the impression say the same sentence twice.** Lead and context qualifier
   became verbatim identical — *"… CS pattern indicators 3/3 — screening signal, no periodicity test;
   CS pattern indicators 3/3 — screening signal, no periodicity test."* Invisible until
   `regen-oxydex-goldens` ran the real night, because before the fix the two strings differed. The lead
   is now a bare value in its siblings' shape (`AHI est. 14`); the caveat lives once.
2. **My own source scan went blind.** It keyed on the literal `"CS pattern"`; rewording the strings
   dropped it to `0 found`. Only the ANTI-VACUITY count caught it — the argument for making
   anti-vacuity an assertion rather than a comment. Now structural (`return n.patScore ?` + a score
   reference), so it survives any future rewording.

**The parity worry in this item was unfounded, and the reason is worth knowing.** §2 warned that a
partial edit would red `cohesion-badges`. It could not have: **`csScore` is not in `oxydex-registry.js`
at all**, so the resolver never mapped that guide row and no gate was watching it. That is the same
blind spot as the stale-citation class found the same day in `REFERENCE-GUIDE-AUDIT` — a guide row for
an unregistered metric is checked by nothing.

**Re-bundle reach, recorded because `--app OxyDex` is not enough.** `oxydex-dsp.js` is inlined into the
OxyDex app, **five analysis tools**, **both orchestrators** (`Data Unifier`, `OverDex` — which
`--app OxyDex` does not touch and which drift-checked RED), and the served `docs/` copies. Only
`build.mjs --all` covers the orchestrators. Each miss presented as `EXIT=1` with every assertion
passing.
