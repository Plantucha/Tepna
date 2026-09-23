---
bump: patch
type: fixed
brief: none
---

PpgDex refuses a ppg SignalFrame that carries no usable sample rate instead of inventing 1 Hz. Both arms of the frame branch read `fs || 1`, so a frame carrying neither input.fs nor samples.fs silently got a 1 Hz time axis: measured on the synthetic Verity frame, a 540-second recording became 95,039 seconds - 176x - and every beat time rode that axis through rec.relSec into footSec. An absent rate is not reduced coverage, it is the absence of the time axis itself, so this refuses rather than annotating (the 2026-09-17 ruling: a discontinuity refuses, reduced coverage annotates). The refusal is narrow by construction - fs is only needed to BUILD an axis, so a frame already carrying relSec and durSec never reaches the guard - and three legs pin that, alongside a positive control that the same frame WITH fs computes. The n <= 1 arm keeps its zero: a one-sample frame has a genuine zero span, which is section-absence's own do-not-flag case. Rows ppgdex-dsp.js:6193 and :6203 of ABSENCE-SURVEY-2026-09-22, both HIGH. Six PpgDex goldens regenerated; every changed line in them is a manifestHash or computeHash stamp, so no measured value moved.
