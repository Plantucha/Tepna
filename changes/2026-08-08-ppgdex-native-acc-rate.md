<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [ppgdex]
brief: DEEP-AUDIT-V-2026-08-04-BRIEF.md
---
`accFs` (and `gyroFs`/`magFs`) were computed as sample count ÷ PPG duration — the AVERAGE over a span the stream may not cover, so a dropout stretches the denominator without adding samples and the rate reads low exactly when the data is worst. On one real file MotionDex read 52.00 Hz and PpgDex read 19 Hz for the same accelerometer; a corpus scan found 103 of 386 pairs below 0.9 of native, 68 below 0.7, worst ~12 Hz. This is the defect DEEP-AUDIT-III §4.1 already fixed in MotionDex and ECGDex, re-found in the third sibling. A near-identical claim was previously refuted because `PpgDex Reference.html` documents the metric as an "effective" rate, so this was filed only after checking the two places a user actually meets the number: the KPI is labelled plainly "ACC Hz" and the node-export field is plain `accFs` — neither says "effective". The rate also SIZES the ~1 s gravity-baseline window that the de-gravitated magnitude (and every motion metric built on it) depends on, so an under-stated rate made that window too short in real time. Now derived from the median inter-sample interval, matching MotionDex's `sampleHz`. Export-inertness is COMPUTED, not asserted: `DEX_UPLOADS=… verify-fixtures` re-ran the real corpus green and re-stamped `verifiedUnder` on the two affected fixtures.
