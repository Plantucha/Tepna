<!--
  H10-ECG-RATE-CORPUS-CHECK-2026-08-04-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-08-09 (all three §6 items met — `polar_pmd.py`'s back-timing comment and
`PMD-DECODE-SCALE-AND-RATE` §77/§140 now carry the measured figure with its ppm *and* the reason the
old one was circular; §3 is cross-referenced from `O2RING-SYNTHESISED-AXIS` §3 so the drawn-axis
finding is not extended to the H10; **no constant changed**. ⚠️ **This brief's own ppm SIGN was wrong
and is corrected in §2** — the step is +364 ns *long*, which is a rate of **−47 ppm**, not +47. §3's
two figures were a single uncapped file, not the corpus; the corpus numbers are now in §3.) ·
**Created:** 2026-08-04

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
                                  ->  step +364 ns LONG  =  rate -47 ppm
```

**Verdict: "exactly 130.0000" is wrong, and 129.94 is wrong in the other direction.** The modal step is
130 Hz to within **47 ppm**; the per-file mean rate spans **129.887–130.088**, a ~1 550 ppm total
spread that no single figure describes.

> ⚠️ **SIGN CORRECTION (2026-08-09, re-measured before this brief was executed).** The block above
> originally read `+364 ns = +47 ppm`, and the `+` was carried into §4 as *"ECG is +0.005 %"*. **Both
> are backwards as a RATE.** A step 364 ns **longer** than nominal is a rate **below** 130 Hz:
> `1e9 / 7 692 672 = 129.9938 Hz`, i.e. **−47 ppm**. The step-ppm is +47; the rate-ppm is −47, and
> every consumer of this brief means the rate. Both of the brief's other figures were already sub-130
> (mean-rate median 129.9888 = −86 ppm), so the `+` was internally inconsistent from the start.
>
> **The measurements themselves reproduce exactly** — re-run 2026-08-09 over the same 50 files at the
> same 120 k-row cap: modal step median **7 692 672 ns**, mean rate median **129.9888**, range
> **129.8869–130.0883**, spread **1 549 ppm**, and §5's outlier file re-measures at **7 697 280 ns =
> 129.9160 Hz (−646 ppm)** uncapped. Nothing here needed re-deriving; only the sign was mislabelled.
>
> This is why `DEVICE-RATE-TRUTH-2026-08-05` reads **−105 ppm** and this brief read **+47** — they were
> never in conflict about direction, only about which quantity (mean vs modal) and which sign
> convention. Both say the H10 runs slightly **slow**.

## 3 · It is a REAL clock, not a drawn one

The obvious hypothesis — that the H10 stamp is synthesised like the O2Ring's — is **false**, and the
test is the one already shipped in `parsePPG`:

```
                          this brief (1 file)   corpus, 50 files (re-measured 2026-08-09)
distinct inter-sample deltas :   1759           660 median per file   ·  8029 pooled
modal delta share            :  12.85 %         26.70 % median  ·  55.38 % worst-case
                                                (drawn => >= 99 %)
nominal share (1e9/130 exact):     --            0.000 % median  ·   0.007 % max
```

⚠️ **The left column is ONE file measured uncapped, not the corpus** — it is the same
`20260606_220643` file §5 names as the outlier, and it does not reproduce under the 120 k-row cap §2
uses (that file caps to 1262 distinct / 12.46 %, and reads 2331 / 21.18 % uncapped). The right column
is the honest corpus figure. **The verdict is unchanged and is robust by a wide margin either way** —
the worst single file in the corpus sits at 55.38 %, still 44 points below the drawn threshold.

The **nominal-share** row is the check `DEVICE-RATE-TRUTH` §4.1 says to always report beside a rate: at
0.000 % this is the device's own clock, not `polar_pmd.py`'s nominal fallback read back — which is
precisely the trap that produced the "130.0000" this brief corrects.

Compare `o2ring-timestamp-is-drawn`: the O2Ring's column has exactly ONE delta value at 100.0 %,
`sample_index × 7 953 045 ns`. The H10's is a measured clock with real jitter, so its ppm figure means
something — the O2Ring's does not. **Do not extend the drawn-axis finding to the H10.**

## 4 · What to change, and what NOT to

* **`polar_pmd.py:492`** — the comment justifying `prev_last_ns` back-timing says ECG is "exactly
  130.0000" as the CONTRAST case against Verity's free-running dies. The contrast still holds (Verity
  MAG measured 20.516 vs nominal 20, +2.6 %; ECG is **−0.005 %**), but the wording should say **"130 Hz
  to within tens of ppm"** rather than an exact integer. The mechanism it argues for is unaffected.
  *(Executed 2026-08-09. The line had moved to **`:535`** — the brief's `:492` was stale by four
  commits, so grep the string rather than the line number.)*
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

* [x] `polar_pmd.py:492` **(→ `:535`)** and `PMD-DECODE-SCALE-AND-RATE` §140 state the measured figure
      with its ppm. **DONE 2026-08-09.** §77's "ECG is perfect" bullet was corrected too — it carried
      the same claim and the brief's §1 table names it, so fixing only §140 would have left the
      contradiction in place one section above.
* [x] This brief's §3 is cross-referenced from `o2ring-timestamp-is-drawn`'s neighbourhood so the
      drawn-axis finding is not extended to the H10. **DONE 2026-08-09** — `O2RING-SYNTHESISED-AXIS`
      §3 gains a ⛔ subsection with the side-by-side discriminator table.
* [x] No constant is changed. **Verified:** the diff touches one comment block, three briefs and one
      `DOCS-INDEX` row. `git diff -U0 -- capture-host/` contains no line outside a `#` comment.

## 7 · What executing this changed about the brief itself

Two of this brief's own numbers did not survive the re-measurement it demanded of others:

1. **The ppm sign was backwards** (§2's banner). A step measured *long* is a rate measured *slow*, and
   the brief propagated `+` into §4's "+0.005 %". Nobody had spent the number yet, which is the only
   reason it cost nothing.
2. **§3's discriminator pair was one uncapped file presented as the corpus.** The conclusion held with
   44 points of margin, so this changed no verdict — but §5 of this very brief is a warning about
   exactly that (*"volume within one file is not a sample size"*), written about a different number in
   the same document.

That a brief warning against single-file inference contains a single-file inference two sections
earlier is the finding worth keeping. **The method note did not generalise to its own author.**
