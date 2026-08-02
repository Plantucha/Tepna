<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [ecgdex]
brief: WEARABLE-HOST-AXIS-FOLLOWUPS-2026-08-02-BRIEF.md
---
ECGDex: a host-axis RATE now needs a BASELINE — the span gate the sibling tool already had.

`DexClock.hostAxis` deliberately carries no span gate, and that is correct for PpgDex, which consumes
`correctionAt()` — an interpolation whose residual is bounded by the jitter that produced it. ECGDex is
the one consumer that reads `.ppm`, a *rate*, and a rate divides by the span: on a short fragment the
denominator collapses and ordinary host-stamp wander (up to 287 ms measured on this corpus) is amplified
into a fabricated crystal. This is the same size-not-span defect fixed in `tools/dual-clock-rate.mjs`
(`MIN_SPAN_MIN`), reintroduced in WEARABLE-HOST-AXIS by applying the rate where that tool's reasoning
does not reach.

Measured over 260 ECG fragments of the 2026-07-16..29 capture corpus, |ppm| against fragment span:

| span | median \|ppm\| | max \|ppm\| | | span | median \|ppm\| | max \|ppm\| |
|---|---|---|---|---|---|---|
| <60 s | 1208 | 16512 | | 600–1200 s | 43 | 196 |
| 60–120 s | 714 | 24036 | | 1200–2400 s | 42 | 151 |
| 120–300 s | 177 | 23235 | | 2400–4800 s | 20 | 52 |
| 300–600 s | 74 | 464 | | >4800 s | 22 | 31 |

The H10's real crystal is ~−25 ppm; above 2400 s no fragment exceeds 100 ppm, below 120 s 86–89 % of them
do. Gate set at 2400 s (40 min), the knee. Fleet-wide `fs` spread falls from **129.9072–133.2017 Hz
(25341 ppm) to 52 ppm**; worst per-night spread is now 52 ppm against a merge tolerance of 385.

Not cosmetic: `fs` also builds the bandpass coefficients, drives `detectPeaks`/`refinePeaks` and sets
`computeSQI`'s rate, so the 133.2 Hz value (from a 62 s stub) mis-designed the filter and the sub-sample
refinement, not merely the timestamps. Refused ⇒ `fs` keeps the device crystal — wrong by ~25 ppm, where
the ungated correction was wrong by up to 24036. The refusal is reported on `rec.hostAxis`
(`applied`/`spanMs`/`reason`), and the implausible rate stays visible as evidence rather than being
hidden. **`ok` no longer implies the correction reached the axis — consumers must read `applied`.**

Also in `tools/trio-batch.mjs mergeEcg`: the fs-disagreement bound tightens from 0.5 Hz (3846 ppm, loose
enough to admit the bad fragment yet tight enough to throw on it, so good nights failed to fold for the
wrong reason) to 0.05 Hz (385 ppm); the imposed `fs` now comes from the **longest** fragment rather than
`recs[0]`, which is routinely a seconds-long reconnect stub carrying the raw crystal; and a negative
session boundary (`d < 0`) is counted and warned rather than silently dropped — 0 occurrences across the
corpus, so a tripwire, not a live correction.

Gated by `ecgdex-dsp · host-axis`, both directions (a refusal-only test would pass against a gate that
never applies). Verified to FAIL against the pre-fix parser: short fragment `fs` 19.9865 vs 20,
`applied` true vs false.
