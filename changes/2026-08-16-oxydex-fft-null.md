---
bump: minor
type: fixed
---

**"FFT Cycle Length" could not report "no cycle". It always returned a number.**

The surfaced periodic-breathing / Cheyne-Stokes period was a raw-power argmax over 11 hand-picked
frequencies with **no background, no significance test and no null**. On pure AR(1) with nothing planted
it reported a confident cycle in 12 % of runs at rho=0 rising to **55 % at rho=0.995** — and real nights
sit at rho≈0.98. Executes `OXYDEX-FFT-CYCLE-NULL-2026-08-16-BRIEF`.

**This is a significance test, NOT a retraction, and the corpus is why.** Across 103 O2Ring nights only
**19/103 = 18 %** hit the band edge against a 42 % null (exact one-sided p = 3.3e-7, Wilson CI
[0.121, 0.270] excluding 0.42), with cycles spread across 62–125 s — the classic CSR range. The metric
responds to real physiology. The fix has to keep those and drop the fabrications.

Method: **Mann & Lees 1996** (*Climatic Change* 33, 409–445, `10.1007/BF00142586`) — test peak HEIGHT
against a fitted red background, never peak LOCATION. An AR(1) background is fitted from the series' own
lag-1 autocorrelation and scaled by the **median** observed/theoretical ratio, so a real peak cannot
inflate the background meant to expose it.

    negative control  pure AR(1) rho=0.98, nothing planted   0/8 detections   (was ~42 %)
    positive control  planted 80 s cycle                     8/8 recovered
    real fixtures     still detect, SNR 161 232 / 4 685 732  vs threshold ~19.6

## Two things the significance test EXPOSED, both pre-existing

**The 11 probes had blind spots between their teeth.** A cycle planted at 80 s — between the 100 s and
77 s probes — measured SNR p05 **1.6**, indistinguishable from noise, while the same amplitude at 100 s
measured p05 **37.0**. The old code hid this by always returning an argmax: a detector that cannot say
"none" makes a *missed* cycle look like an *absent* one.

Log-spacing 33 probes did **not** fix it — it moved the teeth, and the on-grid case collapsed to p05 3.2.
The cause is resolution, not density: an N-sample record resolves fs/N, and anything evaluated between
its Fourier bins loses power to scalloping. It now evaluates **on the bins**, which is also the basis in
which periodogram statistics are defined. `_FFT_MAX_BINS` strides on a long night and reports `strided`
rather than silently losing coverage.

**The textbook threshold is anti-conservative by ~2.2×.** Sidak assumes a KNOWN background; ours is
fitted from the same series, so the null tail is far heavier than exp(−x). Measured over 80 pure-AR(1)
runs: null **p50 6.1 · p95 10.3 · p99 14.6 · max 23.9** against a theoretical threshold of **6.98** —
which sits at the null MEDIAN and would fire on half of all featureless nights. The inflation factor is
measured and documented, and the group that measured it ships with the change.

## Does it actually work? Measured across the REAL rho range, not one point

The 2.2x inflation was measured at rho = 0.98. Real nights span 0.955-0.997 and the null gets heavier as
rho rises, so a factor fitted at one point could fail at another. Both halves, 40 runs per cell:

    rho              0.90   0.955   0.98   0.99   0.995   0.997
    false positives    3%     3%      3%     3%     3%      0%      (old code: 12 % -> 55 %)
    recovery of a real 80 s cycle
                     100%   100%    100%   100%    98%     98%

Flat FP across the range, and recovery does not collapse at high rho — which is the check that a
threshold tuned for the negative control has not simply been set high enough to reject everything.

## Fixture movement, inspected rather than assumed

- **synthetic: 100 s → 53 s.** The generator plants periodic breathing at **58, 64, 70 and 80 s** and
  nothing at 100 s. The old value was an artifact of 100 s being one of the 11 probes; the new one sits
  in the planted family. **The change is a correction.**
- **one real night: cycle → none** (`snr 11.32` vs `threshold 19.27`, rho 0.9719). That SNR is inside the
  measured null distribution, so it is a defensible non-detection rather than a lost signal.

`peakFreqHz` / `peakCycSec` are **null** when nothing clears, and the CSV export renders empty rather than
the string `"null"`. `snr`, `threshold`, `bins`, `strided` and `rhoLag1` are published so the verdict can
be audited against the ground it was computed from. `fftCycleSec` gains an `oxydex-registry.js` entry at
**emerging** — the physiology is published, this SpO2-derived device-dependent estimate is not
standardized.

⚠️ **NOT export-inert.** `computeHash` moves; OxyDex + both orchestrators re-bundled, goldens regenerated
through `tools/regen-oxydex-goldens.mjs`, ledger re-recorded.
