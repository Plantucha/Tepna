<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: VIGIL-DEEP-ANALYSIS-2026-07-22-BRIEF.md
---
Robust live ECG R-peak detector in the Vigil monitor (out-of-suite capture-host/monitor.html,
VIGIL-DEEP-ANALYSIS §2B). The old detectRs keyed its threshold on the WINDOW MAXIMUM (0.55*max|s-mean|),
so one motion/electrode spike inflated the max and pushed the threshold above every real R — live HR read
"—" for the whole 5-7 s window until the artifact scrolled out. Replaced with a median-centre + MAD
(median-absolute-deviation) scale at 5*MAD: a spike is a single outlier that moves neither the median nor
the MAD. Validated LIVE on a worn H10 ECG — clean/1-spike/5-spike all track ~54 bpm where the old detector
went null on a single spike; a pathological baseline wander returns no beats (an honest dash, not the old
detector's fabricated ~205 bpm). Pure array math, no deps, no network. (detectPulses/PPG gets the same
treatment when a PPG device is worn to validate.)
