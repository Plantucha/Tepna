<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED (owner-ordered 2026-09-27 20:50 "open the PAT-hat brief"; scope RE-RULED by the owner the same evening after §Findings — "Revised remedy") · **Created:** 2026-09-27

# PAT-HAT-DRIFT-DIFFERENCED — the PAT three-cornered hat refused for the wrong reason; say which reason, and add the drift-free estimate

> **Owner, 2026-09-27 20:50 (relayed by Kestrel):** *"open the PAT-hat brief."* The observation: on the
> 2026-09-26 trio night both the classic and the fused PAT hats REFUSED with "a negative solved variance —
> the hat's independence assumption failed", while the legs close (499 = 407 + 97 − 5) and the HR hat on the
> same night solved. The ruling proposed three parts: (1) solve on first differences of the 5-min leg medians,
> because shared slow PAT drift breaks independence; (2) publish the per-window closure residual as the
> primary timing-consistency figure; (3) a refusal names its corner and the explaining correlation.
>
> **§Findings came first, as the ruling required. Two of the three parts did not hold as stated, and the
> owner re-ruled (§Ruling).**

## §Findings — measured before any remedy

**Method.** `pat-feasibility-worker.js` run UNCHANGED under Node (a read-only harness shims `self`,
`importScripts`, `postMessage` and hands it the three files the page hands it) on the 2026-09-26 trio night:
H10 `_ECG.txt`, Verity `_PPG.txt` (ankle), O2Ring `_PPG.txt` (finger), from the rig's corpus copy of the box
capture. It reproduces the page: chest→ankle 499, chest→finger 407, finger→ankle 97 ms; **98** windows with
all three legs coupled. Per-window analysis and simulations in a scratch script (Wren's session notes, not
committed — no box night enters the repository).

**F1 · The negative corner is CHEST, and which corner goes negative depends on the dispersion estimator.**

| estimator over the 98 window medians | chest σ² | finger σ² | ankle σ² |
|---|---|---|---|
| robust IQR/1.349 (what `threeHat` uses) | **−32.0** | 148.8 | 650.6 |
| plain variance | 148.3 | **−0.1** | 651.2 |

Leg robust SDs: chest→finger 10.8, chest→ankle 24.9, finger→ankle 28.3 ms. Chest is negative because
finger→ankle scatters more than both chest legs together.

**F2 · The small corners are UNRESOLVED on this night — the refusal is a precision limit.** Block bootstrap
over windows (30-min blocks, 2 000 resamples): chest σ² 95 % CI **[−216, +225] ms²**, P(<0) = 0.53; finger
**[−105, +401]**, P(<0) = 0.14; ankle [343, 892], never negative. Each small corner is half the difference of
two ~600–800 ms² variances, and 98 windows do not resolve that difference. **A null with perfectly INDEPENDENT
errors in this geometry** (σ chest 8 / finger 9 / ankle 25 ms, 98 windows, 2 000 simulated nights) gives a
negative corner on **34 %** of nights. So "the independence assumption failed" is the wrong reason for
09-26. The data are consistent with independence; they are too few to resolve the two small corners.
(Onset law for a genuine correlation, for reference: memory `tch-negative-variance-onset-law`,
PR #1824 — a paired-corner negative needs ρ > σ₀_A/σ₀_B.)

**F3 · Differencing alone does NOT fix 09-26.** On first differences of adjacent windows (97 pairs, variance/2),
chest turns positive (+111.6) and **finger goes negative (−49.1)**. Slow drift is real but is not the dominant
term. finger→ankle climbs 80.6 → 96.3 → 105.8 ms across the night's thirds; lag-1 autocorrelation is
0.60 / 0.27 / 0.34 (ab / ac / bc). Yet the ankle-leg SD is 24.9 ms undifferenced and 26.4 differenced: most of
its variance is window-to-window.

**F4 · The owner's mechanism is real, and differencing is the right answer to it — on the plant.** A synthetic
night: a 60 ms peak-to-peak drift over 2 h, SHARED by the finger and ankle sites (vascular tone), plus
independent jitter chest 8 / finger 9 / ankle 12 ms, on 98 windows. The classic hat misattributes the shared
drift to **chest (26.8 ms vs true 8)**, because a covariance shared by two corners inflates the third. The
differenced hat recovers **9.0 / 8.8 / 11.9** (medians over 2 000 nights). With no drift both agree
(8.0 / 8.8 / 11.8).

**F5 · The closure `ca − cf − fa` measures nothing in this worker.** Per beat, the chest→ankle and
chest→finger→ankle paths land on the same ankle beat, so the triangle closes by arithmetic. Measured:
**22 322 of 22 322** per-beat triangles close to exactly 0. The per-window closure (median −2.75, IQR 9.95 ms) is
the median of three slightly different beat SUBSETS, not a timing error. `tools/pat-three-corner.mjs` already
documents this ("⚠️ MEASURES NOTHING … a self-satisfying identity reported as evidence"). Publishing it as
"the primary timing-consistency figure" would present arithmetic as agreement.

## §Ruling — owner, 2026-09-27 (asked in Wren's session after §Findings; answer "Revised remedy")

1. **Every corner carries a block-bootstrap 95 % CI.** A negative whose CI spans 0 reads **UNDERPOWERED**,
   with its bound (e.g. "chest σ < 15 ms on 98 windows"). Only a CI wholly below 0 reads as an independence
   failure; that refusal names the corner and the pairwise ρ that would explain it. Never a bare REFUSED.
2. **The differenced hat is added as a SECOND, distinctly labelled estimate:** "drift-removed σ at
   τ = 5 min". It excludes variation slower than a window, so it is **not comparable** to the classic or fused
   σ by construction — removing shared drift generally LOWERS it (Magpie's caution, adopted). A reader must not
   read the drop as an instrument improvement. The 60-ms plant (F4) is its known-answer test.
3. **The closure is NOT published as a consistency figure.** The page states it is identically 0 by
   construction (F5). A real closure needs a leg measured independently of the other two. That is not
   available with three sites, and none is built.

## §Build — the worker half (Wren); the page half (Magpie) renders these fields

**Additive only. Every field `threeHat` returns today stays byte-identical** — `lagMed`, `pairSd`,
`variance`, `sigma`, `windows`, `n`, `winMin`. The classic and fused columns are the same solve they were.
`AnalysisStats.threeCorneredHat` is reused, never copied (`tch-parity`), and left byte-for-byte unchanged.

New pure functions in `analysis-stats.js` (executable by the suite; the worker only calls them):

- `hatBootstrapCI(win, opts)` — block bootstrap over the window list (`{ab, ac, bc}` medians). Block
  = 6 windows (30 min), 1 000 resamples, a **seeded** PRNG so the same night gives the same interval. The
  dispersion is the worker's own IQR/1.349. Returns `{chest:[lo,hi], finger:[lo,hi], ankle:[lo,hi]}` on
  VARIANCES (ms²).
- `hatCornerStatus(variance, ci, sigma)` — per corner, one of:
  - `solved` — variance ≥ 0; σ is its root, with a CI on σ from the clipped bounds.
  - `underpowered` — variance < 0 and hi ≥ 0; publishes `boundMs = √hi`.
  - `independence-failed` — hi < 0; publishes `explainRho`, the correlation between the OTHER two corners
    that would produce this variance with that corner's own error at 0:
    `ρ = v_A / √((v_B + v_A)(v_C + v_A))`. It is `null` when that has no real solution, and flagged
    `rhoOutOfRange` beyond ±1.
- `differencedHat(win, stepMs)` — adjacent windows only (`t` exactly one window apart). Variances of the
  first differences, halved: the Allan variance at τ = one window (Allan 1966, *Proc. IEEE*,
  doi:10.1109/PROC.1966.4634; the hat on it after Gray & Allan 1974, *28th Annual Symposium on Frequency
  Control*, doi:10.1109/FREQ.1974.200027). Solved through `threeCorneredHat`, with its own bootstrap CI and
  corner status. It refuses with a reason under `HAT_MIN_WINDOWS` adjacent pairs.

`threeHat` then adds `ci`, `corners` (status per corner) and `diff` (`{ok, n, tauMin, variance, sigma, ci,
corners, label:'drift-removed σ at τ = 5 min — not comparable to the classic σ'}`), both classic and fused.

**What differencing cannot remove, stated where the number is:** drift faster than one window (5 min) stays
in, and a step between two windows counts fully once.

## §Done when

Tolerances are pre-stated from a 40–200-seed measurement of the implementation, taken before the tests
were written. The first draft of this list said ±3 ms and ±0.15. The measurement refuted both, and they are
restated here rather than tuned to one lucky seed.

- [ ] **Plant (F4):** synthetic legs, 288 windows, with a 60 ms pk-pk shared finger+ankle drift and jitter
  8/9/12 ms, on 10 seeds.
  - Classic chest σ ≥ 2× its true 8 ms (anti-vacuity). Measured minimum over 40 seeds: 24.3 ms.
  - Differenced σ within **±5 ms** of 8/9/12. Measured worst over 40 seeds: 4.0 ms.
- [ ] **Null (F2):** independent errors in the 09-26 geometry (8/9/25 ms, 98 windows), 50 nights.
  - Anti-vacuity: at least 10 nights carry a negative corner. Measured: 74 of 200.
  - Every negative reads `underpowered`, and none reads `independence-failed`. Measured: 0 of 200.
- [ ] **Genuine failure:** finger/ankle errors anti-correlated at ρ = −0.8 (chest 2, finger 20, ankle 20 ms;
  200 windows), 10 seeds.
  - Every seed reads chest `independence-failed`, with pair [finger, ankle] and a negative `explainRho`.
  - `explainRho` is COARSE: over 40 seeds it spans −1.30 … −0.45. It names the pair and the sign, not a
    precise ρ. A value beyond ±1 is published with `rhoOutOfRange`, never clamped.
- [ ] **Controls:** `AnalysisStats.threeCorneredHat` byte-identical (`tch-parity` green); the classic and
  fused medians, IQRs and every pre-existing `threeHat` field byte-identical on the same input;
  `sensor-trio-night` output unchanged.
- [x] **The owner's night before/after** (measured 2026-09-27; every pre-existing field unchanged):

  | 09-26 | chest | finger | ankle |
  |---|---|---|---|
  | classic | `underpowered`, σ < 14.4 ms | 12.2 ms [0, 20.0] | 25.5 ms [18.3, 29.8] |
  | fused | `underpowered`, σ < 14.5 ms | 12.0 ms | 25.6 ms |
  | drift-removed (τ = 5 min, 97 pairs) | 10.6 ms [0, 15.4] | `underpowered`, σ < 8.3 ms | 24.2 ms |

  Chest and finger both sit under ~15 ms; the Verity ankle is the ~25 ms corner.
- [ ] Page half (Magpie): the three hat rows render the status, the bound or the explaining ρ, and a separate
  labelled differenced row. The closure line says "identically 0 by construction".

## §Not in scope

A correlated-error solve with ρ estimated from these same three series (circular —
`TCH-CORRELATED-SOLVE-KNIFE-EDGE-FOLLOWUPS` §5). The HR hat. Any deploy: the box gets the page on the owner's
updater.
