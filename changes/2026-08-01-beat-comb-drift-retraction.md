<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: []
brief: IBI-ALIGNMENT-LIMIT-2026-08-01-BRIEF.md
---
**`IBI-ALIGNMENT-LIMIT`'s title claim is retracted. RR↔PPI *can* align these devices.**

Every measurement in that brief — and in `tools/beat-comb-analysis.mjs` — swept **one constant offset across a whole night**. The two optical devices drift relative to each other by up to **123 ppm**, which accumulates **more than one RR interval** per night, so a scan that is correct at bedtime is comparing against the wrong beat by morning. What was reported as poor beat correspondence was mostly a measure of how far the clocks had separated.

Refitting per 5-minute block, same corpus, same tool:

| night | one offset | per block | best block | drift |
|---|---|---|---|---|
| 2026-07-27 | 39.9 % | **98.8 %** | 100 % | −29 ppm |
| 2026-07-28 | 23.6 % | **90.0 %** | 100 % | **+123 ppm** |
| 2026-07-29 | 34.0 % | **92.5 %** | 100 % | +10 ppm |

Chance control with identical degrees of freedom (partner shifted +1 h, same per-block ±3 s search): **22.4–27.1 %** on every night. Real beats control on all six, by ~4× on three.

Reached independently from the other end by `ENVELOPE-ANCHOR-EXPORT` §3.7, which retracted itself twice getting there; verified here on this brief's own corpus and tool.

`--local` and `--control` are added to the tool, and the selftest now plants a pair that **shares every beat but drifts**, asserting the whole-night sweep understates it, the local refit recovers it, the gain survives the control, and the drift is recovered to within 15 ppm. Removing the planted drift makes that assertion fail, so it is testing what it claims.

**Survives:** the comb itself (under a *constant* offset two periodic trains give teeth one RR apart — still why searching harder cannot work); the `autonomic_surge` fiducial finding (event channels matched over ±60 s, where 2–3 s of drift cannot manufacture a 34 s bimodality); and the CPAP clock work (different pairing, intra-night drift far below its 15 s support).

**The lesson:** a chance control tells you whether you beat chance, not whether your model is too simple. The original circular-shift null was honest and passed — while the whole measurement fitted one number to a system that needs two.
