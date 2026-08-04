<!--
  H10-ECG-RATE-CORPUS-CHECK-2026-08-04-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-08-04

# The H10's ECG rate is not "exactly 130.0000" — but it is not 129.94 either

Checked against the **Polar Sensor Logger corpus** (`Ecg nightly/`, 19 GB, 50 ECG files, H10
`02849638`, 2026-06-06 → 07-13). PSL is the **vendor's own decode**, independent of
`capture-host/polar_pmd.py`, so it can arbitrate a claim the repo currently makes four different ways.

## 1 · The repo disagrees with itself

| source | claim |
|---|---|
| `PMD-DECODE-SCALE-AND-RATE-2026-07-19` §77 / §140 | **"ECG is perfect: 130.0000 Hz true rate, sensor steps exactly 7.6923 ms"**, 0.00 % error |
| `polar_pmd.py:492` (the back-timing comment) | "the H10's ECG is **exactly 130.0000**" |
| `POLAR-SDK-CAPTURE-2026-07-07` and `polar_pmd.py:25` | ECG **129.94** Hz vs 130 |
| `CAPTURE-HOST-FOLLOWUPS-2026-07-16` | exported `fs` **129.99** Hz |
| `WEARABLE-HOST-AXIS-FOLLOWUPS-2026-08-02` | fleet `fs` spread starts at **129.9072** |

Those cannot all be right, and the two that matter most — the back-timing comment and the §140 table —
are the ones asserting a perfect integer.

## 2 · Measured, over 50 files

Rate computed from the **device's own `sensor timestamp [ns]` column**, up to 120 k rows per file:

```
mean rate   median 129.9888 Hz    min 129.8869    max 130.0883
modal step  median 7 692 672 ns = 129.9938 Hz     nominal 130 Hz = 7 692 308 ns
                                  ->  +364 ns  =  +47 ppm
```

**Verdict: "exactly 130.0000" is wrong, and 129.94 is wrong in the other direction.** The modal step is
130 Hz to within **+47 ppm**; the per-file mean rate spans **129.887–130.088**, a ~1 540 ppm total
spread that no single figure describes.

## 3 · It is a REAL clock, not a drawn one

The obvious hypothesis — that the H10 stamp is synthesised like the O2Ring's — is **false**, and the
test is the one already shipped in `parsePPG`:

```
distinct inter-sample deltas : 1759
modal delta share            : 12.85 %      (drawn ⇒ >= 99 %)
```

Compare `o2ring-timestamp-is-drawn`: the O2Ring's column has exactly ONE delta value at 100.0 %,
`sample_index × 7 953 045 ns`. The H10's is a measured clock with real jitter, so its ppm figure means
something — the O2Ring's does not. **Do not extend the drawn-axis finding to the H10.**

## 4 · What to change, and what NOT to

* **`polar_pmd.py:492`** — the comment justifying `prev_last_ns` back-timing says ECG is "exactly
  130.0000" as the CONTRAST case against Verity's free-running dies. The contrast still holds (Verity
  MAG measured 20.516 vs nominal 20, +2.6 %; ECG is +0.005 %), but the wording should say **"130 Hz to
  within tens of ppm"** rather than an exact integer. The mechanism it argues for is unaffected.
* **`PMD-DECODE-SCALE-AND-RATE` §140's "0.00 %"** — quote the modal step and its ppm instead.
* **Do NOT re-calibrate anything.** +47 ppm is far below the `CK_AXIS_MAX_PPM` refusal bound (50 000)
  and below what any downstream consumer resolves. This is a documentation correction, not a code one —
  and `O2RING-PROTOCOL` / `O2RING-SYNTHESISED-AXIS` already record what re-calibrating a constant on a
  fresh measurement costs.

## 5 · Method note — my first number was wrong, from a sample of one

The first file measured gave a modal step of **7 697 280 ns = 129.916 Hz (−646 ppm)**, and on that
basis I was about to file a brief contradicting the repo. Across all 50 files that file is an
**outlier**: the median is 7 692 672 ns and the true disagreement is 47 ppm, not 646.

One file looked entirely convincing — 300 002 rows, a clean modal delta, an unambiguous number. Volume
within one file is not a sample size when the quantity varies BETWEEN files, which is exactly what §2's
129.887–130.088 spread shows it does. Same shape as
[`presence-of-file-is-not-presence-of-data`]: the reading was real and the inference from it was not.

## 6 · Done when

* `polar_pmd.py:492` and `PMD-DECODE-SCALE-AND-RATE` §140 state the measured figure with its ppm.
* This brief's §3 is cross-referenced from `o2ring-timestamp-is-drawn`'s neighbourhood so the drawn-axis
  finding is not extended to the H10.
* No constant is changed.
