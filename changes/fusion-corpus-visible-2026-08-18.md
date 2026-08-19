---
bump: patch
type: changed
brief: PPGDEX-MULTICHANNEL-FUSION-2026-07-18-BRIEF.md
---

**§2's "the corpus cannot yet decide" rested on a corpus the tool could not fully see.**

`ppg-fusion-e3` matched the Verity by `/VeritySense.*_PPG\.txt$/` only, while Polar Sensor Logger writes
the same armband as `Polar_Sense_<serial>` — and it parsed timestamps with `\d{14}` while PSL splits
them. **Two independent blindnesses**, so that tool returned **0 nights** on the PSL tree. Both fixed
(#1503, #1506).

Re-run there, 6 nights:

    consensus (SHIPPED)   jitter median 9.42 ms   PPV 99.64
    mean-of-3 fusion      jitter median 9.08 ms   PPV 99.82
    PCA-1 fusion          jitter median 9.08 ms

**5 of 6 physiologically plausible** (PPV ≥ 99.5 %) against the original **6 of 12** — and this tree was
excluded by construction, not by data quality, when the verdict was written.

⚠️ **Not an overturn.** Capped at 6 of ~20 available nights; the beat-alternation defect is real and
unchanged; the fusion deltas are small and in the same direction as the original finding. What changed
is that the sentence's **premise** is no longer true — "cannot yet decide" was a statement about the
tool as much as the data. The item is re-openable on evidence rather than blocked; the honest next step
is the full tree with the alternation detector applied per night.
