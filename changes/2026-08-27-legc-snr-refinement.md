---
bump: patch
type: changed
brief: CLOCK-LEG-SIGN-CONTRADICTION-2026-08-27-BRIEF.md
---

The §7 sawtooth mechanism is **refuted in source**, and the conclusion survives in a stronger form.

`h10Beats` derives `f` from the **`sensor timestamp [ns]` column unrounded** and returns real device
stamps at peak indices, never `t0 + i/fs`; `verityBeats` reads the device column with an explicit comment
that it must not use the host-disciplined `rec.relSec`. So the #1121 `fs`-rounded-to-130 Hz artifact is
absent and both legs are genuinely host-independent — my proposed mechanism was wrong.

**What replaces it needs no named mechanism: the signal is smaller than the noise.** On 2026-08-13 the
clock difference to be measured is ≈102 ms (6.3 ppm × 270 min), while the observable **wanders ≈450 ms**
across the night with 93 ms block-to-block scatter. Leg C fits a slope through wander ~4× the quantity
it is measuring, so the slope reports the wander. That is why 2026-07-20 (7 ms scatter) agrees to 0.27σ
with identical code, and why two fragments of 08-13 disagree by 40 ppm. It also dissolves the earlier
paradox: wander is **not** AR(1), so no fixed-order correction recovers the true error bar, and a
"3.94σ contradiction" can coexist with a 40 ppm within-night swing.

⚠️ The cause of the wander is **not established**. PAT is the leading candidate (leg C's observable
literally contains the R-peak→pulse-foot delay, and evening-vs-asleep fragments differing by 40 ppm fits
a posture/BP change) — but a −320 ms excursion would exceed typical whole-PAT magnitude, so beat-pairing
and foot-detection jitter remain live. Recorded as open rather than asserted.

**Actionable:** never quote a leg-C ppm without the night's offset scatter beside it, and the §PAT gate
cannot be repaired by widening bands — it compares host legs that reproduce to 0.3 ppm against a quantity
whose per-night error is tens of ppm and unreported. The honest fix is for leg C to publish an
uncertainty and refuse where the offset wander exceeds the clock signal, i.e. the `hostAxis` refusal
discipline applied to itself.
