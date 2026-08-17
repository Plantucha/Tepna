<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [ECGDex]
brief: none
---

CPC computed the HFC/LFC/VLFC shares as **night-level means and threw the per-window structure
away** — which is the part CPC exists for. Thomas et al.'s method produces a *profile* across the
night; a single mean cannot say **when** sleep was stable.

`_cpc` now returns `series` (one entry per window: `tSec` and the three shares), `stepSec`,
`bandBins` and `lfcWindowSd`. Existing fields are untouched, so every consumer of
`hfcPct`/`lfcPct`/`vlfcPct` is unaffected. `lfcVals` was **dead** — pushed every window, never
read — and now backs `lfcWindowSd`.

## ⚠️ NO STATE LABEL IS EMITTED, and that is the finding rather than a caution

Two per-window classifiers were built. **Both are biased, in opposite directions, and the second
only failed on real data.**

**1 · argmax over raw share.** The bands span 0.30 / 0.09 / 0.006 Hz, so the widest wins on noise —
measured **11 of 11 windows HFC**. This is the same low-frequency/high-frequency bias the
*integrated-share* estimator was introduced to remove.

**2 · share ÷ bin count (density).** Unbiased on a **flat** spectrum — measured 3/3/5 on white
noise, near-uniform. Then folded against **five real Polar H10 nights** (39–225 MB captures, 32–94
windows each):

```
                shares  hfc / lfc / vlfc     classified      stableMin
2026-07-31       30.6 / 59.3 / 10.1          0 / 8  / 24         0
2026-08-11       35.5 / 50.9 / 13.6          0 / 16 / 78         0
2026-08-13       35.8 / 51.9 / 12.3          0 / 11 / 27         0
2026-08-14       36.1 / 54.7 /  9.2          0 / 18 / 39         0
2026-08-15       28.1 / 58.2 / 13.7          0 / 10 / 35         0
```

**`stableMin = 0` on every night, and 71–83 % of each night classified REM/wake.** Physiologically
impossible. The arithmetic: shares 35.8/51.9/12.3 over bins 153/47/3 give densities
0.23/1.10/**4.10** — VLFC wins by 18× on bin count alone.

**Physiological coupling spectra are RED, and density-against-a-flat-null over-picks narrow
low-frequency bands exactly as raw share over-picks wide ones.** A defensible label needs the band's
own *observed* background — the same fix as fitting a red background before reading a periodogram
peak. Until that exists, the shares are reported and **the labelling is left undone**.

⚠️ **The white-noise gate passed the whole time.** It validated against a flat null the real data
does not have, which is why this surfaced only when the corpus was folded. Recorded because it is
this repo's recurring shape, and because the same defect was found in `computeSpO2FFT` earlier the
same day — by me, eight hours before I committed it here.

## Verification

New `ecgdex · cpc` group, **12 assertions**. It pins the shares, the band geometry that makes naive
labelling wrong, **and the absence of a label** — `state` must not appear on a series entry and no
state durations may be emitted — so re-adding a flat-null classifier breaks the gate rather than
passing it.

`ecgdex` group **1109/1109 against the real corpus** (`DEX_UPLOADS` set), so the equivalence legs
**ran rather than skipping** and the node export is confirmed unmoved — that is the leg §🔏 warns
goes silently absent when `uploads/` is not present. `lint` and `typecheck` clean.

Nothing is registered or surfaced. These are CPC's bands, **not** the AASM stages: CPC partitions by
coupling *stability*, which cuts across N1/N2/N3, and none of it is comparable with
`deepMin`/`remMin`.
