<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-08-11 · **Created:** 2026-08-11

# `PHYS = [200,650]` is a censoring cut, not a plausibility filter — refuse the nights it eats

`PAT-WANDER-ELIMINATION` §1.2 established that the physiological pairing window discards most of the
data on **16 of 19 box site-nights**, and that a night at **97.4 % censored with a median lag of 831 ms**
still emerged from the gate with a confident-looking PAT number. Nothing in the gate could see it.

This brief ships the measurement and the refusal. **No existing bar moves.**

## 1 · The defect

`coupledPAT` pairs each R-peak to the first foot inside `[PHYS_LO, PHYS_HI] = [200, 650]`. That is
applied as if it were a plausibility filter. It is a **censoring cut**: where the inter-device offset
puts the true R→foot lag outside the window, the window silently keeps whatever fraction happens to
fall inside — and the survivors are **edge-biased**, because as the true lag approaches `PHYS_HI` only
the beats landing under the ceiling can pair at all. Every statistic downstream is then computed on
that remnant, with no signal that it is one.

Measured by pairing again with **no window**, bounded only by `0.9 × the local RR` — the constraint
that actually prevents beat slip (a bound above one RR admits the next beat's foot, the defect
`pat-align` fixed):

| night · site | uncensored median lag | below 200 | above 650 | **discarded** |
|---|---|---|---|---|
| **2026-08-02 ankle** | 336 | 0.0 % | 0.0 % | **0.0 %** |
| **2026-08-02 finger** | 366 | 0.1 % | 0.1 % | **0.1 %** |
| **2026-07-28 finger** | 401 | 0.1 % | 0.1 % | **0.2 %** |
| 2026-07-27 finger | — | — | — | 4.9 % |
| 2026-07-31 ankle | 279 | 7.9 % | 0.0 % | 7.9 % |
| 2026-07-28 ankle | 224 | 28.4 % | 0.0 % | 28.4 % |
| 2026-08-03 finger | 386 | 9.1 % | 25.4 % | 34.5 % |
| 2026-08-01 ankle | 218 | 46.7 % | 2.3 % | 49.0 % |
| 2026-08-06 ankle | 585 | 9.3 % | 40.0 % | 49.3 % |
| 2026-08-05 ankle | 567 | 13.8 % | 41.1 % | 54.9 % |
| 2026-08-07 finger | 478 | 26.5 % | 28.8 % | 55.3 % |
| 2026-08-04 finger | 603 | 14.5 % | 45.2 % | 59.8 % |
| 2026-07-30 finger | 831 | 1.5 % | **95.9 %** | 97.4 % |

**The two populations are 0.0–0.2 % and 4.9–97.4 %.** Nothing lands between.

## 2 · The change

- **`coupledPAT` reports `censoredPct`** — the share of beats whose foot falls outside `[PHYS_LO,
  PHYS_HI]` under the RR-bounded pairing — plus `censoredN`, the beats it was computed from. Requires
  ≥ 200 such beats, else `NaN`.
- **`PATGate.verdict` refuses with `WINDOW-CENSORED`** above `CENSORED_MAX_PCT = 2`.

**A refusal, not a downgrade** — the same class as `NO SHARED CLOCK`. The quantity is not identifiable
on those nights, so any tier would be a guess dressed as a measurement.

**`CENSORED_MAX_PCT = 2` is not tuned.** The corpus separates by a factor of 25 with nothing in the
gap; 2 % sits 10× above the clean group and 2.5× below the nearest censored one. Any bound in
`(0.2, 4.9)` gives the identical partition, which is the test of a threshold that is read off data
rather than chosen.

**Scoped to the analysed beats, not the file.** This is deliberate and it is what makes the criterion
usable. 2026-08-02's O2Ring axis carries a **22.4-second** single step (`hostAxis.maxStepMs`) — the
worst in the corpus — yet the night is 0.1 % censored and is the cleanest recording we have, because
that step falls outside the analysed overlap. A file-level refusal would discard the best data in the
corpus to catch nights a window-scoped one catches anyway.

**Back-compat is explicit.** Absent or `NaN` `censoredPct` ⇒ behaviour unchanged. A caller that cannot
compute it is not refused; "not measurable" is not "bad". Gate-asserted both ways.

## 3 · Why this is worth a refusal — what it protects

The O2Ring's host axis is not comparable to the Polar devices', and nothing in the PAT path looks at it:

| device | `spreadMs` | `maxStepMs` | `totalMs` applied |
|---|---|---|---|
| Polar H10 | 715 – 1054 | 16 – 40 | −179 … −727 |
| Polar Verity | 1146 – 1415 | 42 – 95 | −855 … −1078 |
| **Wellue O2Ring** | **4361 – 37030** | **3796 – 22416** | **−9833 … +30956** |

One to two orders of magnitude worse, with a 40× gap and nothing between — and `hostAxis` accepts all
of it (`ok: true`, `independent: true`), because `CK_AXIS_INERT_MS` is a *floor* on spread and
`CK_AXIS_MAX_PPM` bounds the *rate*; **no bound exists on residual spread from above**. The O2Ring's
device timestamp is synthesized (`o2ring-timestamp-is-drawn`), so an axis fitted to it is fitting noise
and then applying up to 31 seconds of correction.

`TCH-PAT-DRAWN-AXIS-GUARD` recorded this exposure in August and deferred it: *"`pat-feasibility-worker.js`
is vulnerable (reads no `timingSource`) but its functions are in NO test lane, so a guard there would be
untested."* That condition has lapsed — `sharedClock` and `driftStats` moved into `pat-gate.js` on
2026-08-10 and the lane executes them. **`censoredPct` is the data-side symptom of that exposure and is
gated here; the axis-side guard is still owed** (§5).

## 4 · Effect

Phase 0 refuses the nights whose numbers were never identifiable, and keeps the ones that were. The
usable corpus does not shrink — it becomes *stated*. Every night this refuses was already producing a
number computed on an edge-biased remnant; the change is that the gate now says so instead of scoring it.

## 5 · Still owed

- **An upper bound on `hostAxis.spreadMs`, or a `timingSource` guard in the PAT path.** `censoredPct`
  catches the symptom where it reaches the beats; it will not catch an axis that is wrong by seconds in
  a way that happens to leave the lag inside the window.
- **Recovering the censored nights** — they are 13 of 19 site-nights, and resolving them is worth more
  than any further analysis on the 3 that survive. Owned by `PAT-SAWTOOTH-ANSWERS-THE-130MS`.
- **Re-running `PAT-WANDER-ELIMINATION` §3's covariate tests** on uncensored nights only; as that brief
  records, they were computed on a mixture and are uninformative.

## Done when

- [x] `coupledPAT` computes and reports `censoredPct` / `censoredN`
- [x] `PATGate.verdict` refuses `WINDOW-CENSORED` above `CENSORED_MAX_PCT`, back-compat when absent
- [x] `tests/dex-tests.js` covers the boundary (inclusive), the real 59.8 % and 97.4 % nights, the
      refusal tier, `why{}`, absent and `NaN`, and a night refused on censoring alone while passing
      every other published leg
- [x] mutants killed: refusal removed (10), bar raised to 100 (10), `>` → `>=` (2), `NaN` treated as
      censored (4)
- [x] `npm run check` green

Related: [`PAT-WANDER-ELIMINATION-2026-08-10-BRIEF.md`](PAT-WANDER-ELIMINATION-2026-08-10-BRIEF.md) ·
[`PAT-DRIFT-STATISTIC-2026-08-10-BRIEF.md`](PAT-DRIFT-STATISTIC-2026-08-10-BRIEF.md) ·
[`TCH-PAT-DRAWN-AXIS-GUARD-2026-08-08-BRIEF.md`](TCH-PAT-DRAWN-AXIS-GUARD-2026-08-08-BRIEF.md)
