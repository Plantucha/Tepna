---
bump: patch
type: changed
---

**`TCH-FUSED-ROBUST-HAT` step 7 / Do 1 (ECGDex-own-HRV) is RE-SCOPED — its named target is not special and
the leverage is 0.19 % of epochs.** The step asks to feed `beatConfidence` into ECGDex's own pipeline *"so
the 06-12 burst no longer inflates ECGDex's RMSSD/SDNN/epoch exports"*, and prices it at *"re-bundle +
fixture regen"*. Measured over **55 trio nights / 4845 epochs** before paying that:

- **Whole-night:** 06-12's `hrv.rmssd` is **39.8** vs a corpus median of **35.8** — rank **9 of 55**,
  1.11× median, inside a 21.5–47.2 range. Undetectable as inflation.
- **Per-epoch:** the spike is real (2.4× its night's median, peak 96.4) but **rank 4 of 55**. Three nights
  exceed it relatively — 07-26 (2.7×), 08-14 (2.6×), 08-11 (2.6×) — and none has ever been called a burst.
- **Class size:** epochs above 2× their night's median are **9 of 4845 = 0.19 %**, on **7 of 55 nights**.
  At ≥1.5× it is 40 of 55 nights, i.e. mild spikes are ordinary HRV.

So the trade as written is a fleet re-bundle plus fixture regen to move **0.19 % of epochs**, aimed at a
night that ranks fourth. That is the number the decision needed and did not have.

**Re-scoped, not refuted.** If it proceeds, step 7 bundles two deliverables that cost differently and should
be split: **(a)** exporting per-epoch `c` adds a field and gives the promised visibility without changing
any existing metric's value; **(b)** down-weighting low-`c` seconds in `buildNN`/`epochEngine` changes
computed outputs and is what forces the regen. (a) is defensible at 0.19 %; (b) needs a reason those 9
epochs reach a decision, which nobody has shown.

No code change.
