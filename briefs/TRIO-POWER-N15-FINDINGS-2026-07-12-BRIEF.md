<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-07-12 · **Blocks:** `SENSOR-TRIO-NIGHTS-PAPER-BRIEF.md` · **Follows:** `PPGDEX-OPTICAL-DETECTOR-AND-SIGMA-REDERIVE-2026-07-11-BRIEF.md` §181

# The N=10→15 power re-run: what it changes, and why it is NOT landed yet

Attempted §181 (*"with 5 more nights now surviving, re-run the power analysis: N = 10 → 15 changes the CI,
which is that paper's entire deliverable"*). **The re-fit is NOT landed.** What follows is the measured
result, the two blockers, and one bug the attempt exposed.

## The rule that governs this work

**The planted σ and the paper's Tables 1–3 are ONE ATOMIC UNIT.** Those tables *are* the Monte-Carlo
evaluated at that σ. Re-fitting the σ without regenerating the tables leaves the paper reporting a
simulation of a truth nobody chose — silently. **Change both, or neither.** That is why nothing shipped.

## What the re-fit WOULD be

| | O2Ring | H10 | Verity |
|---|---|---|---|
| published (10-night hat) | 2.72 | 1.86 | 1.94 |
| **15-night hat** (post detector-fix) | **2.60** | **1.58** | **1.85** |

Source: `PPGDEX-OPTICAL-DETECTOR-AND-SIGMA-REDERIVE` §2's like-for-like run of the real
`sensor-trio-worker.js` per-second path — **15/17 nights solved** (was 10/17), because the detector fix
recovered 5 nights the Verity gate had misdiagnosed as *"poor PPG contact"*.

## The measured effect on the deliverable (500 trials — INDICATIVE ONLY, see blocker 1)

Driving the real tool (GPU lane, fresh cache origin, only the planted σ varying):

| min N to reach CI half-width ≤ target | 10-night hat | 15-night hat |
|---|---|---|
| **H10 ±0.25** (dynamic *and* resting) | 1 | **2** |
| **Verity ±0.15** (dynamic) | 3 | **2** |
| O2Ring ±0.15 · H10 ±0.15 · Verity ±0.15 (resting) | 3 / 5 / 2 | unchanged |

H10's half-width at N=1 moves **0.2284 → 0.2590** against a 0.25 target — a genuine crossing, but a close
one. The direction is counter-intuitive and worth stating in the paper if it survives: **H10 gets quieter
(1.86 → 1.58) yet needs MORE windows**, because the TCH couples the corners and a quieter corner is
relatively harder to pin.

## ⛔ Blocker 1 — the numbers above are at the WRONG trial count, and the paper is self-inconsistent

The paper's **Table 1 caption says 50,000 MC trials/cell**; its **abstract says 720**. Those disagree, and
the tool's default is **500**. My deltas are at 500 — **not publication-grade**, and not comparable to
whatever produced the shipped tables.

**A 50k/100k re-run does not complete on this machine.** The WebGPU lane accelerates only the **N-sweep**;
the **ρ-sweep and duration-sweep that follow are CPU-bound**, and `stats.json` only exports once *all*
phases finish. At 100k the run reached 95% (the N-sweep) in ~10 min and then **stalled** — ETA advanced
**1 minute in 25 minutes** of wall clock. The heavy run also appears to have taken the GPU adapter down
(`requestAdapter()` subsequently returned null).

**Done when:** the tool's own stated trial count reproduces the *published* tables at the 10-night hat
(proving the harness), and then the 15-night hat is run at the same count, in one change with the σ re-fit.
Worth fixing the GPU lane to cover the ρ/duration sweeps first — otherwise every regeneration is an
overnight job.

## ⛔ Blocker 2 — the planted σ is TRIPLICATED, and a desync is silent

The planted truth lives in **three** files — `sensor-trio-power-analysis.js` (page),
`sensor-trio-worker.js` (CPU), `sensor-trio-gpu.js` (WebGPU) — the worker's own comment saying *"MUST match
sensor-trio-power-analysis.js DEV"*, with **nothing enforcing it**.

**This is not hypothetical: it bit during this very attempt.** A stale cached copy left the page on the old
hat and the worker on the new one, and the tool cheerfully **REPORTED planted σ = 2.72/1.86/1.94 while
SIMULATING at 2.60/1.58/1.85**, producing a plausible-looking, wrong min-N table. It also briefly convinced
me the GPU lane disagreed with the CPU lane — **it does not**: on a clean origin the two are **bit-for-bit
identical** on every half-width and the same min-N table. That false alarm was entirely the desync.

**SHIPPED in this change:** a `Trio planted σ is single-valued` gate — page ≡ CPU ≡ GPU, and pinned to the
value the published tables were computed at. Verified to red on a one-file drift.

## 🐞 Bug the attempt exposed (also shipped)

Wiring the analysis sources into the gate tripped `Storage hygiene`: *"striopwr_lock,
striopwr_secPer500 … no un-erasable data"*. **False positive** — those keys ARE erasable, they live in
`DexForget.ANALYSIS_KEYS` (the standalone-research-page tier), and `eraseAll()` wipes both tiers. The
assertion only tested `LOCAL_KEYS`, which was correct **only while `env.sources` held Dex apps
exclusively**. It now tests the **union** — which is what `eraseAll()` actually removes, and therefore what
"no un-erasable data" actually means.

## Done when (§181 closure)

- [ ] GPU lane covers the ρ/duration sweeps (or the tool can export the N-sweep alone), so a 50k run finishes.
- [ ] Reproduce the **published** tables at the 10-night hat at the paper's stated trial count — proves the harness.
- [ ] Re-fit all three σ copies to the 15-night hat **and** regenerate Tables 1–3 **in the same change** (the gate's expected triple moves with them).
- [~] **The "720 vs 50,000" half is STALE — already reconciled (verified 2026-08-04).** §44 records
      *"Table 1 caption says 50,000 MC trials/cell; abstract says 720"*. The paper has **no "50,000"
      anywhere**; it says **720 trials/cell in all 8 places**. `6001983` (2026-07-14, *"sigma papers to
      the 26-night folder hat"*) normalised it — **two days after this brief was written**. The
      10 → 15-night half is untouched and still open.

- [x] **The atomicity the σ gate CLAIMS is now enforced (2026-08-04).** The gate's own comment says the
      planted σ and the paper's tables are *"ONE ATOMIC UNIT … change both, or neither"* — but it only
      compared three CODE copies to each other and to a literal in the test file. **Nothing read the
      paper.** So item 3's own plan — re-fit the paper's tables to a new hat — would have left every
      assertion green while the simulation stayed at the old hat, which is the precise failure the
      comment warns about. Added a leg that scrapes the paper's `Planted σ` column and compares it to
      the simulation's. Mutation-verified **from both sides**: re-fitting the paper alone reds
      (`got ["2.41","1.86","1.94"] · want ["2.72",…]`), and re-planting the simulation alone reds the
      three pre-existing legs.

      ⚠ **Read the LABEL, not the digits.** The paper carries **three** different σ triples on purpose
      and they are not interchangeable: `Planted σ` (the simulation — **2.72 / 1.86 / 1.94**), the
      `classic raw-ECG broad-hat` overlay band (2.60 / 1.50 / 1.56), and the companion σ-paper's
      `fused-weight` headline (2.41 / 1.28 / …). I first read the 26-night 2.60/1.50/1.56 as evidence
      the atomic unit had already broken; it had not. The new leg scrapes the **column**, not the
      values, so it cannot repeat that mistake — and this note exists so the next reader does not make
      it either.
