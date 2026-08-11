<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [Integrator]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
Final unmeasured file swept: integrator-dsp.js. 1748 tested, 806 killed, 8 invalid, 934 survivors,
13.8 h wall — the most expensive sweep in the fleet at 310 s per run. 806/1740 = 46.3 %.

Every DSP in the fleet is now measured, and every one has a canary.

THE PREDICTION THIS BRIEF RECORDED WAS WRONG. It said integrator would measure ~34 %; it measured
46.3 %, the HIGHEST rate in the fleet, missing by 12.3 points. Two of the three claims it rested on
are refuted:

- "one homogeneous population near 34 %" — the band is 25.5-46.3 and integrator is a real outlier
  upward. The fleet is not uniform.
- "the error grows monotonically with the sampled value" — ecgdex (62 -> +31.6) vs integrator
  (68 -> +21.7).
- "r = -0.46, no positive signal" — with the eighth point r is +0.10. That correlation was noise in
  seven points.

What survives is narrower and more useful: above a sampled ~42 % the sample over-states, 5 of 5, by
+16.5 to +31.6, and not one high row came in at or above its estimate; at or below a sampled 40 % it
is close (-6.0, -0.3, -0.4). A high sampled figure means "unknown, probably lower", never "high".

This is the programme's own most-repeated error committed again by the person documenting it —
generalising from n files and being broken by the n+1th. The prediction was written down before the
sweep precisely so it could fail visibly.
