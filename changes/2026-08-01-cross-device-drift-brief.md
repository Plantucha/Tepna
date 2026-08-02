<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: []
brief: CROSS-DEVICE-DRIFT-AND-CLOSURE-2026-08-01-BRIEF.md
---
Records a finding reached three times independently tonight — twice by sessions that retracted their own earlier conclusions getting there — and generalises it beyond the analysis that produced it.

**Body-worn devices drift relative to each other by tens to hundreds of ppm**, enough to walk past a whole heartbeat inside one night. Every cross-node measurement fitting a *single* offset per night therefore reports that movement as noise, poor coupling, or a physiological limit.

Three things the brief establishes with measurements rather than argument: beat correspondence goes **5–26 % → 43–98.8 %** once the offset is refit per 5 min (chance control at identical degrees of freedom: 22–27 %); the per-block offset is a **phase** and must be **unwrapped** by whole RRs, or a slope fit measures a sawtooth; and **three-corner closure** — free, falsifiable, `d(A↔B) ≡ d(A↔C) − d(B↔C)` — is what caught the missing unwrap and now bounds which drift figures are credible.

Its project-wide section is the point: `fitClockOffsetPooled` fits one offset per night, which is safe for CPAP and **not** for wearable↔wearable, with nothing marking the difference; **PAT becomes reachable**, having been closed on a measurement artifact; the capture host is the right place to measure offset continuously; and `integrator-tch.js`'s reference-free decomposition — used today for amplitude σ — applies to *timing* once closure holds, giving per-device jitter instead of pairwise differences.

Also records that the three-source corpus is **exactly six nights** and hard-bounded (O2Ring live PPG began 2026-07-25; 07-31 has all three raw streams but a zero-row SpO₂ anchor — another file-present-but-empty case).
