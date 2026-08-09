<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [PpgDex]
brief: PPGDEX-TESTABLE-SURFACE-2026-08-08-BRIEF.md
---
`lombScargle` is now **exhausted**: all **6 of 6** distinguishable mutants killed, the other 15 classified as having no distinguishing input under a 960-input battery. The function is closed rather than merely improved — every mutant a test can reach is dead, and the remainder are documented as unreachable instead of left as an open list.

Getting there took three passes, and the arc is the point:

| pass | approach | killed |
|---|---|---:|
| 1 | 19 assertions validating against physics | 2/21 |
| 2 | + boundary battery (n=7/8, band edges, VLF drift) | 3/21 |
| 3 | + assertions aimed at *probed* distinguishing inputs | **6/21** |

Passes 1 and 2 were written from understanding the function. Pass 3 was written from **measuring which inputs actually separate each survivor from its mutant** — loading original and mutant in separate realms and diffing. Doubling the kill count came from the measurement, not from more insight.

The distinguishing inputs were mostly **degenerate, not physiological**: a flat 8-sample series with no oscillation at all separates three of them, because it is the one input where *"there is no peak"* and *"there is no power"* become observable — every plausible signal hides both. It pins that a flat series reports `totalPower: 0` (not `null`), `respRate: null`, and `lfhf/lfnu/hfnu: null`, because a ratio of nothing is undefined rather than zero.

The last mutant taught the sharpest lesson. My first attempt at the VLF lower bound used a 0.0401 Hz signal, where `f >= 0.003` → `f >` costs **one unit out of 3910** — an assertion that reaches the mutant and cannot possibly notice it. At exactly 0.003 Hz the same mutant costs **245 → 179**, a 27 % gap. **A mutant is killed by an input that magnifies it, not merely by one that reaches it.** That is now a comment on the line.

26 assertions; `ppgdex` tag green. Tests only — no shipped source, no `manifestHash` movement, no fixture re-recorded.
