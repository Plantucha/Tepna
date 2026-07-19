<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [cpapdex]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
CPAPDex rated ODI over the whole therapy span rather than the time the oximeter could actually see. `valid` and `coverage` were computed six lines above and then not used for the rate, so every finger-off / probe-off / dropout sample still bought denominator. With `COVERAGE_FLOOR` at 0.5 a night is admitted with half its samples unusable, so the understatement reaches **exactly 2×**.

The field was literally named `analyzedHours` while carrying the **unanalyzed** total. The same returned object was internally inconsistent: `t90Pct` already divided by `vArr.length` — valid samples only — so T90 and ODI on one lane sat on different denominators.

Scaling the span by the valid fraction (`valid × span/n` is the analyzable time under a uniform sample period) is the correction OxyDex §5 already ratified for the ODI family. It carries correctly into the pooled indices, which sum `analyzedHours` as the pooled denominator — you pool a numerator and a denominator, never rates.

**Why no gate could see this:** every committed golden carries `coverage: 1`, and when `valid === n` the corrected form is an exact identity. Only a partial-coverage night separates the two, so the gate builds one — 2 h at 1 Hz, first hour analyzable with three physiologic desaturations, second hour probe-off:

| | `analyzedHours` | ODI |
|---|---|---|
| pre-fix (span) | 2.0 | **1.5** |
| corrected | 1.0 | **3.0** |

The desaturations ramp rather than step, because a step is correctly self-gated as an occlusion artifact — that behaviour is right and is not what this gate is about.

7 new assertions, mutation-verified: restoring the span denominator reproduces exactly 2.0 h and ODI 1.5. A fully-covered night is asserted **unchanged** (2 h, ODI 1.5), which is both the not-over-broad check and the reason the goldens hold — confirmed empirically: all 4 CPAPDex fixtures re-ran through the suite and reproduced byte-identical.
