<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PpgDex]
brief: none
---
`analyzeMotion` no longer trusts the caller to have re-based `relNs` — it detects a per-fragment counter and falls back to the absolute stamp.

**The class of bug, fixed at its source.** `relNs` is the DEVICE counter and it **restarts at 0 in every capture fragment**. `relSecOf` preferred it unconditionally, so handing `analyzeMotion` a night assembled from several sessions folded every fragment onto the first one's window — silently, with nothing erroring and every number still plausible.

That is not hypothetical. `trio-batch` did exactly this and discarded **99 %** of every night's inertial data (229 MB of Verity ACC, of which 2.2 MB was used), taking `motionIndex`, posture, all magnetometer features and the `movement_onset` impulse with it. That caller was fixed in the same day's work by clearing `relNs` before the call — but the **trap remained**, and the browser drop path can hit it today if a user drops several ACC files for one night.

**The guard.** If `relNs` ever steps **backwards** across the rows actually passed, it is per-fragment and unusable as a night-relative clock, so the absolute per-row `tMs` is used instead. Checked once per call, on the real input. A single continuous session never steps backwards, so it keeps the device counter's precision and pays nothing — the guard fires only on the case that was previously silently wrong.

Choosing detection over a documented caller contract is deliberate: the contract already existed implicitly and was already violated by the suite's own most important consumer, which is the definition of a contract that does not hold. A cheap check that cannot be forgotten beats a comment that can.

**Tests** — 3 assertions: a two-fragment night (counter restarting, absolute time continuing +2 h) spans the **whole** night rather than 40 s; the second fragment lands at its **true** +2 h, asserted on grid contents — the fixture carries real movement in fragment 2, because with a constant acceleration vector the de-gravitated magnitude is zero everywhere and the grid cannot show where anything landed (my first version of this test asserted against an all-zero grid and passed for the wrong reason); and a single continuous session is unaffected.

Re-bundled PpgDex, OverDex and Data Unifier plus the analysis pages and `docs/`, which inline the DSP. Gates: suite **4436 passed** / 12 skipped · `build --check` clean (11 owned) · GATE A 9/9 · GATE B 13 reproducible · biome format clean.
