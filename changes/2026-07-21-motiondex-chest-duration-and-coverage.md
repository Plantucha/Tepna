<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [MotionDex]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
MotionDex respiratory rate and body-position dwell fractions no longer distort when a wrist stream
runs longer than the chest strap. §7.3: `respiratoryEffort` divided chest breaths (and its hz
fallback) by the GLOBAL max-stream `durSec`, halving the reported rate whenever the wrist ACC file
outlasted the chest — it now divides by the chest stream's own span. §7.4: `bodyPosition` counted
non-recording epochs as `dwell.unknown` then divided every posture by the full epoch count, diluting
a real supineFrac (2 supine / 6 total = 0.33 instead of 1.0); it now mirrors `actigraphy`'s
seen/covered denominator so gap epochs leave the fraction entirely. Export-inert on the committed
synthetic golden (GATE B reproducible); both fixes carry a wall-clock/coverage gate.
