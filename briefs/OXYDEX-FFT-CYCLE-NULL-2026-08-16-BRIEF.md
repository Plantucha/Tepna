<!-- SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-08-17 · **Created:** 2026-08-16

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

- [x] **SHIPPED in #1383** — `computeSpO2FFT` returns `null` for both fields when no peak clears the
      fitted background, and `oxydex-app.js:508` renders that as **empty**, with a comment naming this
      brief: *"EMPTY, not the string 'null': … a missing measurement must read as missing"*.
- [x] **SHIPPED in #1383** — the `oxydex · fft-null` group runs pure AR(1) with no oscillation planted
      and asserts a null verdict; #1383's body records the pre-fix failure (the argmax fabricated a
      cycle on 100 % of ρ=0 runs, 55 % at ρ=0.995), so the gate was seen to fail before being trusted.
      Post-hoc corroboration: ρ was later **measured** on 61 real nights at median **0.9804**
      (PB-FOLLOWUPS §2), so the ρ=0.98 null is at the corpus's real redness, not an assumed one.
- [x] **SHIPPED in #1383** — the group plants a known-period oscillation and asserts recovery
      (`a planted …s cycle is still recovered`, ≥60 % of runs), plus the too-short-night null and the
      auditability leg (`snr`/`threshold`/`rhoLag1` published).
- [x] **STATED in #1383 and pinned in the suite** — across 103 O2Ring nights, **19/103 (18 %)** report
      a band-edge cycle against a **42 % null** rate (p = 3.3e-7, i.e. the corpus signal is *real* and
      the fix is a significance gate, not a retraction). The figure is carried in the fft-null group's
      comment so it cannot silently drift from the test that depends on it.
- [x] **DONE 2026-08-17 (#1431)** — `peakCycSec` AND `peakFreqHz` get rows at **`experimental`**,
      matching the published guide card (`ev-experimental`), with the tier argued in the entry: the null
      work rules out `heuristic`, the absence of external validation rules out `emerging`. Aliases cover
      the CSV headers and the guide card title in both subscript spellings, each verified to resolve
      through `idForLabel` (the cohesion gate passing is consistent with an alias that binds nothing,
      so resolution was demonstrated directly).
- [x] **DONE — twice.** #1383 carried the DSP re-bundle and its re-verification; #1431's registry rows
      moved `computeHash` again (registry is in the compute closure) and the corpus verification was
      re-run, not asserted: suite green, both OxyDex summaries `verifiedUnder → 0f0b97dd2fcb`.

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

---

## Closing note — no follow-up brief spawned (per `CLAUDE.md` §📌)

Execution surfaced two residues, both routed to briefs that already own them rather than a new file:

1. **The stale-header pattern itself.** Five of this brief's six boxes described work that had already
   shipped (#1383), and the brief sat PROPOSED for a day after its own gate was green on main. This is
   the fourth brief today found in that state; the class is recorded in the memory layer, not here.
2. **A committed long-cycle synthetic input** would let the fft-null group's positive control run at a
   period in the 90–130 s band from committed bytes. That is exactly
   `OXYDEX-PB-DETECTOR-FOLLOWUPS-2026-08-17` §5's revised done-when, which owns it — one committed
   input can serve both consumers, and splitting the ask across two briefs is how it gets built twice.
