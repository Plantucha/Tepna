<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-07-11 · **Extends:** `integrator-tch.js` (`threeCorneredHat` v1.2.0) · **Motivated-by:** `docs/INTEGRATOR-TCH-REALDATA-VALIDATION-2026-07-06.md` §9 (method-literature sweep)

# Integrator TCH — a principled negative-variance estimator (ML-TCH / Groslambert covariance)

> **One-line.** The reference-free per-sensor hat (`integrator-tch.js`) handles the **negative-variance /
> quiet-order regime** heuristically: when the classic Gray–Allan split drives a quiet sensor's σ² negative,
> it searches for the **minimum ρ** that restores non-negativity (`correlated`) and flags `quietOrderUncertain`.
> The 2026-07-11 method-literature sweep found **published, principled replacements** for exactly this failure
> mode. This brief evaluates adopting one and, if it wins on our real+synthetic corpora, ships it additively.

---

## 0 · Problem (what's heuristic today)
`threeCorneredHat` classic form `σ²_A = ½(V_AB+V_AC−V_BC)` can go **negative** when two sensors are near-colinear
(small pairwise-difference variance dominated by sampling noise) — the quiet-order regime confirmed on real data
(validation-doc §2/§5/§6: H10↔OxyDex r≈0.90 → OxyDex σ² → ~0). Current handling (`correlated` → `_solveMulti` at
the minimum non-negative ρ, plus a `quietOrderUncertain` flag) is a **repair, not an estimator**: it returns
*a* consistent solution and warns, rather than the maximum-likelihood one, and it yields **no uncertainty**.

## 1 · The candidates (from docs §9)
- **A · Maximum-likelihood TCH** (Schatzman 2020, IFCS-ISAF). Reformulate the ensemble-relative AVAR estimation
  as a likelihood maximization (gamma-PDF pairwise AVARs) → **non-negative by construction**, and **per-estimate
  uncertainties via bootstrap**. Repairs the unphysical-negative weakness at its root and generalizes to N≥4.
- **B · Groslambert / two-sample covariance** (GCOV; Vernotte–Calosso–Rubiola; Calosso et al. 2018, IEEE TUFFC).
  Uses pairwise *covariance* of the time series rather than only pairwise AVAR magnitudes; the background
  "converges to zero out of the box" with **no equal-noise hypothesis**, and was shown to **outperform TCH** on
  the negative-variance case. Needs approximately time-coincident pairwise series (we already align on the
  absolute floating-ms epoch grid, §`_epKey`), so the input is available.
- Cross-domain precedent that the whole reference-free approach + these fixes are sound: Sjoberg et al. 2021
  (3CH on atmospheric datasets, same unknown-error-correlation limitation).

## 2 · Decision to make FIRST (before any code)
Pick A vs B vs "keep heuristic" on a **bake-off**, not a priori:
- Run both candidates alongside the current `correlated` path through **`tools/tch-multinight.mjs`** (the
  synthetic known-answer corpus — truth is planted, so we can measure which recovers the quiet corner's σ
  closest to planted on the quiet-order nights) **and** the §6 real 07-06 night.
- **Win condition:** on the quiet-order/negative-variance nights, the candidate recovers the quiet σ closer to
  the planted value than the min-ρ clamp does, **without** degrading the positive-variance nights or the culprit
  identification, and (bonus) returns a usable uncertainty. If neither beats the heuristic materially, **stop and
  keep the current path** — record the negative result in the validation doc. (Guards against a complexity add
  with no accuracy win — the estimator's magnitude recovery is already unit-gated by `5e`/`5f`.)

## 3 · If a candidate wins — implementation (additive, back-compat)
- Add the new solver as a **sibling** in `integrator-tch.js` (e.g. `groslambertHat` / `mlHat`), leaving the
  **classic N=3 closed form byte-identical** (the committed golden depends on it). Select by an **opt-in flag**
  first (`opts.estimator`), defaulting to current behavior, so nothing moves until we deliberately switch.
- Extend the return shape **additively** (new fields: `sigmaCI`/`method:'groslambert'|'ml'`); never change an
  existing field's meaning (contract per `CLAUDE.md` §🧪 — new params LAST + optional, new data via NEW fields).
- Wire a new **known-answer group** in `tests/dex-tests.js` (both runners) pinning the candidate's recovery on
  the negative-variance fixture, mirroring `5e`/`5f`/`5g`.

## 4 · Gates & provenance (the cost)
- `integrator-tch.js` is inlined into the Integrator bundle → **any behavioral change re-bundles the Integrator**
  (owned build `tools/build.mjs --app Integrator`), moves its `manifestHash`, and requires the §🔏 re-bundle
  dance: update `BUILD-MANIFEST.json`, **regenerate `uploads/integrator_tch_golden.node-export.json`** + its
  GATE-B triple in `FIXTURE-PROVENANCE.json`, and confirm `Dex-Test-Suite.html?full` (incl. the `env.equiv`/
  golden legs) + `verify-provenance.html` GATE A/B green. A **changeset** (`changes/*.md`, `bump: patch` — a
  contract-shape-preserving fix) per §📦.
- If the default estimator ever *changes* (not just opt-in), that is a **behavior change to a published contract
  surface** → re-evaluate the SemVer bump (likely MINOR: additive method + changed default output values).

## 5 · Done when
- The §2 bake-off is run and recorded in the validation doc (§10), **either** with a shipped winning estimator
  (additive, gated, golden regenerated, changeset dropped) **or** an explicit "heuristic retained — candidates
  did not beat the min-ρ clamp" negative result. Spawn `-FOLLOWUPS` only if the N≥4 ML generalization or a
  default-switch is left for later.

## Non-goals / scope guard
Integrator-local + additive. Must NOT touch the shared `parseTimestamp` (Clock Contract), the Ganglior event
schema / `fascia` alias, or re-ingest raw streams. Keep the N=3 classic closed form + the committed golden
byte-identical unless a default-switch is deliberately chosen (then regenerate the golden). This brief is the
literature→code route named by `LITERATURE-USE-POLICY-2026-07-11-BRIEF.md` §3.

## Cross-references
- `docs/INTEGRATOR-TCH-REALDATA-VALIDATION-2026-07-06.md` §9 (the method-literature sweep that motivates this) + §6 (the real negative-variance night).
- `briefs/INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-III-2026-07-06-BRIEF.md` §4 (N-cornered generalization — shares the ML-TCH N≥4 path) + the §4 literature note.
- `tools/tch-multinight.mjs` — the known-answer harness the §2 bake-off runs on.
- `integrator-tch.js` `threeCorneredHat`/`correlated`/`_solveMulti` — the code under revision.
- `LITERATURE-USE-POLICY-2026-07-11-BRIEF.md` §3 — the routing rule this brief instantiates.
