<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [Integrator]
brief: POOLED-CLOCK-FIT-FOLLOWUPS-2026-07-31-BRIEF.md
---
`fitClockOffsetPooled`'s ±45 s match window and 5 s grid were **inherited, never chosen**. §5 asked for a sweep so they could be. Swept 6 windows × 5 grids against a planted control (truth known) and all 36 reproducible corpus nights.

**The planted leg confirms the prediction and cannot decide the question.** Accuracy is flat — median |error| ≈ 0 s everywhere — so the centroid does remove the window's bias. What the window buys is resolution: support ≈ 1.5 × `matchSec`. On planted data alone the answer is "use 10".

**The corpus says that's wrong.** Real responder jitter exceeds a 10 s window and it loses **seven** nights (15 confident vs 22).

| matchSec | confident | support | cross-night MAD |
|---|---|---|---|
| 10 | **15** | 4 s | 17 s |
| **30** | **22** | 15 s | 17 s |
| 45 *(inherited)* | 22 | 20 s | 22 s |
| 90 | 23 | 46 s | 33 s |

**`matchSec` 45 → 30** — same 22 confident nights, 25 % narrower support, 23 % better MAD across nights, nothing worse. MAD is the meaningful check: the CPAP's offset is physically near-constant, so agreement *between* nights is the only accuracy proxy available without a reference clock. `stepSec` stays 5.

**Calibrated on 36 nights from one deployment** — stated because §3 of the same brief warns against fitting the estimator to its own corpus. The defence is that `matchSec` is a physical parameter (how far a responder may lag its anchor), so setting it from measured responder behaviour is calibration, not curve-fitting. The gate pins the *relationship* (accuracy flat, support ∝ window) rather than the number, so re-running it elsewhere is cheap.

One existing assertion moved with it: *"a junk channel moves the answer by less than its own resolution"* hardcoded 5 s, which only held while the window was 45. Its own comment said it meant "inside the plateau it publishes", so it now compares against the published `spreadSec`.
