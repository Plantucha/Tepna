<!-- SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-08-16

# OxyDex's FFT Cycle Length has no null — it cannot report "no cycle"

**Origin.** Vigil box applied a red-noise test to `METROLOGY-METHOD-ADOPTION` §4e's "~31-second cycle"
and retired it (PR #1366): in a red spectrum the periodogram argmax sits near the low-frequency end
*by construction*, so reporting its location reads a peak into a slope. This brief carries that test
across to **shipped code**, where it gives the **opposite verdict on the data and the same verdict on
the design** — a contrast that is the most useful thing here and should not be collapsed.

**Supersedes nothing. Does not modify #1366's finding**, which stands on its own evidence.

---

## 1 · The code

`oxydex-dsp.js computeSpO2FFT` surfaces **"FFT Cycle Length"** — the periodic-breathing /
Cheyne-Stokes cycle number — via `oxydex-app.js:507`. It:

- probes **11 unevenly-spaced frequencies**, `0.005 … 0.05 Hz` (200 s … 20 s);
- compares **raw power** `re² + im²` across them;
- returns `1 / argmax`.

There is **no background model, no significance test, and no null**. The function cannot return "no
cycle detected" — it always returns a number, and every caller treats that number as a measurement.

**Scope, stated honestly:** this is an **export-only** value (one CSV line), not a badged UI card, and
it has **no `oxydex-registry.js` entry at all** — so it carries no evidence tier. That bounds the
severity: it is not a hero KPI and the COVERAGE MANDATE's badge rule is not the violation here. It is
still a number a user reads and cannot check.

## 2 · What the null does — MEASURED, nothing planted

Vigil box's test applied to `computeSpO2FFT` **verbatim**. AR(1) input, 8 h at 1 Hz, 200 runs per row,
**no oscillation of any kind present**:

| AR(1) ρ | argmax pinned to the 0.005 Hz edge (= 200 s) |
|---|---|
| 0.000 (white) | 12 % |
| 0.900 | 25 % |
| 0.980 | 42 % |
| 0.995 | 55 % |

So on featureless input the function reports a confident cycle length, and the redder the signal the
harder it pins to the band edge. **This half is unambiguous and is the defect.**

## 3 · What the CORPUS does — and it refutes the obvious follow-on hypothesis

The tempting next claim is "therefore the reported cycles are just the spectral slope." **That claim is
false, decisively.** 103 real O2Ring nights:

```
nights analysed            103
median lag-1 rho           0.9813   (range 0.955-0.997 — so the rho=0.98 row above is the right null)
reporting the 200 s EDGE   19/103 = 18 %        red-noise null predicts 42 %
exact one-sided p          3.28e-7   (expected 43.3 of 103 under the null; 19 observed)
Wilson 95% CI              [0.121, 0.270] — EXCLUDES the 0.42 null
cycle distribution         33s:2  40s:4  50s:7  62s:16  77s:8  100s:21  125s:13  143s:13  200s:19
```

Real nights hit the band edge **less than half as often as pure red noise would**, and the cycles
spread across the band instead of piling at it. 62–125 s is the classic periodic-breathing / CSR range.
**`computeSpO2FFT` is responding to real physiology.**

### 3a · Corrections to this brief's own working, recorded because the shape recurs here

1. **An n=14 pilot gave 3/14 = 21 % and was reported as a "refutation." It was not.** Exact one-sided
   p = 0.096, Wilson 95 % CI [0.076, 0.476] — the 42 % null sits **inside** it. Power at n=14 was
   **41 %**. A directionally-right answer from an underpowered test is still not evidence.
2. The full run was only done *because* that power was computed. Power by n, for the same contrast:

   | n | power |
   |---|---|
   | 14 | 0.41 |
   | 30 | 0.72 |
   | 52 | 0.94 |
   | 103 | ≫0.99 |

   The corpus needed for a decisive answer already existed. **Compute the power before quoting the
   pilot**, not after.

3. ⚠️ **The 18 % is not a target to reproduce.** Wilson 95 % CI on 19/103 is **[0.121, 0.270]** — the
   pure-red-noise null is dead, but the data does not pin the true edge-rate tightly. A background fit
   (§5) changes what counts as an edge report at all, so a post-fix rate outside 18 % is not by itself
   a regression. *(Caveat owed to Vigil box.)*

## 4 · So what actually survives

| claim | status |
|---|---|
| The function has no null and cannot say "no cycle" | **CONFIRMED** — §1, by inspection |
| It fabricates a confident cycle on featureless input | **CONFIRMED** — §2, measured |
| Its reported cycles are merely the spectral slope | **REFUTED**, p = 3.3e-7 — §3 |
| It can distinguish a real cycle from no cycle | **NO** — that is the whole defect |

The defect is *not* that its output is meaningless. It is that **the function has no way to flag the
nights where there is nothing to report**, and on those nights it reports anyway. Both §2 and §3 are
consistent with that, and one fix addresses both.

## 5 · Proposed fix — peak height against a fitted background

Not a retraction: a significance test, which **keeps the real detections and drops the fabricated ones**.

- **Mann, Michael E. & Lees, J. M. (1996).** Robust estimation of background noise and signal detection
  in climatic time series. *Climatic Change* 33, 409–445.
  [`10.1007/BF00142586`](https://doi.org/10.1007/BF00142586) — verified against Crossref (author, year,
  venue).

Fit a smooth red background (robust AR(1) or median-smoothed spectrum) to the observed SpO₂ periodogram,
then test the candidate peak's **height against that background**, not its location. Report the cycle
only when the peak clears the threshold; otherwise return `null` and let the surface say so.

Two design constraints that follow from §1's specifics and should not be skipped:

- **Normalise across the grid.** The 11 probe frequencies are unevenly spaced and raw power is compared
  across them directly, which biases the comparison toward the low end independently of any background
  model. Fix the comparison as well as add the test.
- **`null` must be representable end-to-end.** §🔒 of CLAUDE.md's clock rules applies by analogy: a
  missing measurement must be visible as missing, never fabricated. The export line and any consumer
  must tolerate an absent cycle.

## 6 · Done when

- [ ] `computeSpO2FFT` returns `null` for `peakCycSec`/`peakFreqHz` when no peak clears a fitted
      background, and the CSV export renders that as empty rather than `0` or a spurious number.
- [ ] The §2 simulation is a **test**: pure AR(1) at ρ = 0.98, no oscillation planted ⇒ the function
      reports no cycle in the large majority of runs. This gate must be **seen to fail** against the
      current code before it is trusted.
- [ ] A planted-oscillation positive control at a known period inside the band is **recovered** — a
      threshold that rejects everything passes the negative test and is useless.
- [ ] The 103-night corpus is re-run; the count of nights reporting a cycle is stated **before and
      after**, and any night that loses its cycle is inspected rather than assumed correct.
- [ ] `peakCycSec` gets an `oxydex-registry.js` entry with an evidence tier, since it is surfaced and
      currently carries none.
- [ ] Re-bundle + `npm run check` + `verify-provenance`; a DSP change here moves `computeHash`, so the
      corpus-backed fixtures owe re-verification per §🔏 — this is **not** export-inert.

## 7 · What this does NOT claim

- It does not claim periodic breathing is absent, or that any specific night's cycle is wrong. §3 says
  the opposite.
- It does not transfer §4e's verdict. **Same test, opposite result**: §4e's argmax genuinely fails to
  discriminate; this one demonstrably does. Anyone citing #1366 for this, or this for #1366, is
  conflating them.
- AR(1) is **one** red-noise model, chosen because it reproduces the observed autocorrelation. A
  higher-order background would move the 42 %. The §3 refutation is robust to this (p < 0.0001 leaves
  wide margin — 43.3 expected against 19 observed); the §2 percentages are model-dependent and should be quoted with the model named.

## 8 · Related

- `briefs/METROLOGY-METHOD-ADOPTION-2026-08-14-BRIEF.md` §4e — the origin, retired by PR #1366.
- `briefs/INTERDISCIPLINARY-LITERATURE-2026-08-16-BRIEF.md` — Mann & Lees belongs in its
  reading queue as a method Tepna has a live use for, not merely a citation.
- DEEP-AUDIT-2026-07-11 §9 fixed this same function's undisclosed first-hour head-slice. That fix was
  correct and is untouched here; this is a different defect in the same 40 lines.
