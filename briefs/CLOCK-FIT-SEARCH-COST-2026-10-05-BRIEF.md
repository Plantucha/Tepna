<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** DONE — 2026-10-05 · **Created:** 2026-10-05

**Supersedes:** none · **Residue:** none

# The clock fit's cost was its loop SHAPE, not its search — 56× with the answer unchanged

`IntegratorDSP.fitClockDrift` is the pairwise clock fit the Integrator runs on every real night, and
through `fitClockClosure` it is also the single most expensive thing in the JS suite: **243 s of a
627 s run, 39 % in one indivisible test group**, which made CI's slowest shard 8m33s while the other
five finished in 2–4 min. A bin-pack cannot help — a makespan is bounded below by its largest item —
so the only lever was the algorithm.

## 1 · What it was NOT, and why that matters for the next optimiser

**The obvious fix is wrong here.** The search sweeps ±3000 ms at a 20 ms step, 301 offsets per block, so
coarse-to-fine looks free. It is not admissible:

> **The search takes the SUPPORT CENTROID over the plateau, not the argmax.** Correspondence is flat
> over a window ~`tolMs` wide — every offset inside it keeps the same beats matched — so the argmax
> lands arbitrarily within it. Measured as a **~330 ms offset bias** and replaced by the centroid;
> two of four planted cases went from biased to exact (`WEARABLE-DRIFT-FIT-2026-08-01` §3, the same
> fix `POOLED-CLOCK-FIT` applied after its own control caught a 37 s argmax bias).

The centroid averages **every grid offset that shares the peak**, so the answer is a function of the
whole grid and not of the optimum alone. A coarse pass can step over a plateau narrower than its step,
and even when it finds the peak it averages a different offset set. **A search that provably visits the
same optimum still returns a different number.** That is why byte-identical and coarse-to-fine are
incompatible, and it is the first thing to re-read before touching this function again.

## 2 · 🔴 THE MECHANISM, so nobody reaches for the search again

An op count said the binary search and the per-offset sort were the cost, and predicted 5.66×.
**Implemented, they gave 1.11×.** `--cpu-prof` then put **93.7 % of the fit in `corrAt`'s OWN body** —
not in its callees. The cost was two shapes that defeat the optimiser, and neither is arithmetic:

1. **ALLOCATION.** `dl` was a plain array grown by `push`, 314 times per offset — roughly **25,000
   array allocations per block sweep**, 2.1 M over the fit. Now one `Float64Array` allocated per sweep
   and reused, with a filled-prefix count.
2. **A POLYMORPHIC `null`.** `bd` held `null | number`, so every `bd == null` and `Math.abs(bd)` in the
   inner loop was megamorphic. Now a number with a separate `found` flag and the absolute value
   inlined as a sign test.

**Those two are the whole speed-up.** An op count is not a measurement: it models arithmetic, and the
arithmetic was never the problem.

Two exact changes stay in because they are free, not because they were needed:

3. **Neighbour pointer.** `off` only increases within a sweep and `B` is sorted, so the first index with
   `B[lo] >= x` is monotone; the ~15-step binary search per (beat, offset) becomes a pointer advance.
   Seeded lazily per beat, re-allocated per block so an index measured against one block's beats can
   never be inherited by another's.
4. **Order statistics, not a sort.** Only the median and the two quartiles are ever read, so three
   selections replace a full sort. `_selectNth` returns `sorted[k]` by definition, with a deterministic
   midpoint pivot — a fit that reads a different number on a re-run is not a fit.

## 3 · Result

| | before | after |
|---|---|---|
| one `fitClockDrift` (7 h jittered pair) | 11.68 s | **0.33 s** |
| the `fitClockClosure` suite group | 243.0 s | **4.33 s — 56.2×** |

## 4 · Acceptance (pre-stated)

- [x] **Byte-identical** on every committed clock fixture and known answer. Seven cases compared as full
      `JSON.stringify` of `fitClockDrift`'s result, main's module against this one in side-by-side vm
      contexts: both suite pairs, a **uniform cadence with exact ties** in the delta list, a
      **sub-step offset whose plateau is narrower than a coarse grid step**, heavy decimation,
      too-few-beats, empty. All identical.
- [x] **The matched SET per offset**, not just the final centroid — committed as a suite group, which
      encodes BOTH inner loops and asserts the same neighbour index for **96,320 (beat, offset) pairs**.
      Two different matched sets can average to the same centroid by luck; this forecloses that.
- [x] `selectNth` returns `sorted[k]` under heavy ties (311 values, 7 distinct), asserted **fail-closed**:
      an earlier draft `break`-ed out when the export was absent and left the assertion true — a pass
      that examined nothing, which is the shape this suite exists to refuse.
- [x] **≥ 5× faster** on the `fitClockClosure` group — 56.2×.
- [x] `computeHash` moves ⇒ re-verification owed and DONE: `Integrator.html` `2b106b29625a →
      4d6e606383e9`, and `tools/verify-fixtures.mjs` re-ran the app on the real corpus
      (`DEX_UPLOADS=…/Tepna/uploads`, a worktree has none — `docs/CORPUS-LOCATIONS.md`) and reproduced
      the bytes: 5 fixtures stamped `verifiedUnder → e4f5e2c19223`, 14 already current, suite green.

## 5 · Deliberately out of scope

- The search WINDOW (±3000 ms) and step (20 ms) are unchanged, so `maxDriftPpm` and every published
  limit are unchanged. This unit made the same search cheaper; it did not make it different.
- `fitClockClosure`'s three pairwise calls are unchanged in number and order.
