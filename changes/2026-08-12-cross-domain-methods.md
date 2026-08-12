<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [suite]
brief: CROSS-DOMAIN-METHODS-2026-08-12-BRIEF.md
---
The cross-domain literature sweep, with citations and with the rejections' measurements.

`tools/pulse-template-toa.mjs` — Fourier-domain template time-of-arrival (Taylor 1992 FFTFIT), BUILT
AND NOT ADOPTED. The estimator is provably correct: planted sub-sample shifts of 0.25/-0.4/1.7/-2.3
samples return within 0.0016 samples. But on the external test — inter-LED scatter across three
co-located LEDs, which share a clock and a pulse so a self-consistent estimator cannot move it — it
gives -9.1 % at 55 Hz and LOSES to intersecting tangents at 176 Hz (1.70 vs 1.86 ms at best). The
compounding prediction was wrong: at 176 Hz the tangent foot has enough samples and whole-pulse
integration stops paying. Kept as a scout for under-sampled data; recommended against as a default.

Also recorded: Kriegeskorte et al. 2009 as the citation for "double dipping", a rule this repo states
in three places without one and violated again on 2026-08-12; and three rejections with the
measurement that rejected each — geometric hashing (the beat-coincidence comb is already proven),
Tobit (bias deteriorates near 60 % censoring, our nights run 46-68 %), 3-LED fusion (measured 2.3 %).
