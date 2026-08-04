<!--
  O2RING-FRAME-SAMPLE-LOCK-FOLLOWUPS-2026-08-03-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-03 · **Follows:** `O2RING-FRAME-SAMPLE-LOCK-2026-08-03-BRIEF.md` §7

# What executing the 126:1 lock left open

Residue from building `O2RING-FRAME-SAMPLE-LOCK` §4(a) (executed 2026-08-03, recorded in that brief's
§7). Each item is a question the execution raised and could not close, with the reason.

## 1 · Confirm §7.2 forward, from `ppg_n` rather than by reconstruction

The per-frame sample counts in §7.2 were recovered **indirectly** — by matching `OXYFRAME` arrival
stamps against the `PPG` phone-timestamp column, exploiting that each frame's last sample is stamped at
its arrival. The match is sound (2 ms median residual, 33 513 frames) but it is an inference about where
frame boundaries lie, and the whole point of §7 is that inferences about this device keep turning out to
be the third reading of the same data.

`ppg_n` now records the declared count directly. **One night reads it off the file**: group `ppg_n` by
`ppg_dur_step` and confirm `+2` steps carry ~127 rather than ~252. Costs a night and no code.

## 2 · Model the step quantization, then predict the ratio

§7.2 explains the 159/180 split as a beat between the ring's 1.00346 s second and the 1.0028 s poll
interval, but only *qualitatively* — it does not predict that particular ratio. If the model is right,
the imbalance `steps_ahead − steps_flat` should track the poll interval, which is testable against
sessions captured at different cadences (the corpus has them). A model that predicts the ratio would
turn §7.2 from an explanation into a measurement.

Until then, treat `step_imbalance` as descriptive.

## 3 · Retire `counted_loss`, or give it a measured nominal

It is the only counter of the three carrying a constant, it also rides `device_seconds`, and it reports
a **surplus** on clean nights (−5 120 on the reference night, §7.1). It ships signed and documented, but
"documented as unreliable" is a weaker resting place than either removing it or replacing 126 with a
per-session measured mean. Decide which.

## 4 · The status frame's PHASE relative to its 126 samples

Carried forward from the parent brief's §4 unchanged — **PAT needs it and this work did not touch it.**
Knowing the ratio is 126:1 and that the host column re-anchors every frame does not say *where in the
126* the status frame sits, nor whether the re-anchor is applied at the boundary or distributed across
the frame. §4(b)'s +11 ms residual bounds the error; the phase determines the offset.

## 5 · `Σ N` as a `hostAxis` anchor — measure the BLE-latency residual

§7.4 argues cumulative `Σ N` gives `DexClock.hostAxis` a genuine `{devMs, hostMs}` pair at ~1 Hz. What
is unmeasured is the residual each anchor carries: a frame's samples were produced *before* it arrived,
and the connect-time 250-sample flush shows the ring does hold a buffer. Quantify that before treating
the ring as a timing leg — and note it is a *smaller* worry than §7.2's first draft implied, because
whole seconds are demonstrably never absorbed mid-stream.

## 6 · A second ring

Every number in the parent brief and in §7 comes from **one unit** (`S8AW2100`): the 126:1 lock, the
126.037 per device-second, the −3446 ppm, the ±1 s quantization behaviour, and the +11 ms re-anchor
residual. `O2RING-PROTOCOL` §3b already flags the rate as unit-specific; the same caveat now applies to
the lock and the counter quantization.

## Done when
- [ ] §1 confirmed from a real night's `ppg_n` column, or the reconstruction shown to be wrong.
- [ ] §3 decided (retired, or given a measured nominal).
- [ ] §2 / §4 / §5 either measured or explicitly parked with a reason.
