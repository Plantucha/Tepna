<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: fixed
nodes: [ecgdex, pulsedex, ppgdex]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
**Frequency-domain HRV band powers no longer absorb out-of-band variance.** All three spectral nodes calibrated with `sc = variance / tp` where `tp` was accumulated over the analysed band only — asserting that the *in-band* integral equals the *whole* signal variance. That holds only when no power sits outside the band; when power does, VLF/LF/HF absorb it, one-directionally, on a `validated`-tier metric graded against literature thresholds.

The calibration grid now runs to the beat series' mean-Nyquist, `1/(2·meanRR)`, while the **reported bands keep their Task-Force ranges**. `df` is held constant and `nf` grows instead, so spectral resolution is unchanged — only genuinely out-of-band power is removed, and a clean record's numbers do not move for reasons unrelated to the defect.

Two traps the extension itself creates, both guarded: ECGDex's and PulseDex's HF arms were unbounded `else` branches that would have swallowed the entire tail, and PulseDex's `gPeakF` — the global peak that surfaces sub-HF Cheyne-Stokes — would have been free to land above 0.4 Hz. Extending the grid without the `f < fHi` guard would have produced a much worse version of the same bug.

**Measured.** On synthetics: clean RR essentially unchanged (LF 449→448, HF 201→200); LF overstated **2.3×** on an ordinary LF-plus-beat-alternans record (1061→487); a pure 0.45 Hz respiration just above the band edge reported **HF 713 → 0**. On committed fixtures: a real overnight RR record moved **~2 %** (LF 614→601, HF 335→328, VLF 3432→3362, ratios essentially fixed), while the events fixture — whose variance genuinely sits near Nyquist (rMSSD 42.8 ms > SDNN 24.4 ms, zero outlier beats) — collapsed from HF 382 to 1. That fixture's old figure was above-band energy relabelled as HF; `psnsBal` becoming `null` is the honest outcome of a ratio whose denominator is truly ~0.

Only PulseDex's three fixtures moved. ECGDex's and PpgDex's reproduce byte-identical — their committed clips carry negligible out-of-band power — so the two per-node regenerators this was expected to need were not required.

**Companion finding, surfaced not silently corrected.** At slow heart rates the beat series' own Nyquist falls *below* the 0.4 Hz HF edge (40 bpm ⇒ 0.33 Hz), so part of HF is defined above what the series can represent. That is the Task-Force definition's problem and predates this fix, so the **value is left alone** and the condition is reported instead: `hfAboveNyquist` + `nyquistHz`. Common on bradycardic and deep-sleep records — exactly where HF is most read.

Also fixes PpgDex's Task-Force identity, which the change exposed: it rounded a separately-accumulated total, so `vlf+lf+hf` could differ from `totalPower` by 1. It now sums the rounded bands, as ECGDex and PulseDex already did.

**`audits/DEX-DSP-AUDIT-FREQ-HRV.md` was the propagation vector** and is corrected in place with a dated note recording what it got wrong: it prescribed the band-limited form for ECGDex/PulseDex and then recommended PpgDex adopt it, which is how one wrong prescription reached all three nodes. Registry cites for the nine band-power metrics keep `validated` and carry the correction.

10 new assertions, absolute rather than ratio-based — every pre-existing spectral leg is scale-invariant (`vlf+lf+hf == tp`, band placement, n-stability), so a wrong absolute calibration passed all of them. The suite said so itself: *"Parseval pins the TOTAL to the variance, which is why it looked fine."* Mutation-verified: restoring band-limited calibration republishes **HF 708** on a signal with no in-band content.
