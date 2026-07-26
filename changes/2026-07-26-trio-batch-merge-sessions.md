<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [integrator]
brief: none
---
trio-batch folded one session file per stream per night, so a corpus captured with reconnects lost most of itself: three of ten nights were rejected outright despite ~3 h of genuine tri-device overlap, and 07-18 folded 1.47 h of the 11.38 h it had. Worse, the rule always kept the LONGEST CONTINUOUS session — the calmest stretch — so every downstream statistic was computed on a subsample selected for being artifact-free. Sessions are now gated and merged on the union of a night's recordings, at the parsed level (text unions reach 775 MB, past V8's string cap) and without fabricating time. Corpus effect: 7 nights → 9, n per night 13–41 → 31–117, and the arm-PPG error estimate rises 7× (0.89 → 6.21 bpm median σ) because full nights include the motion the old slice excluded.
