<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [motiondex]
brief: none
---
MotionDex no longer publishes an unmeasured value as zero. A signal quality over too few rows or an unknown unit is now null, because zero is the measured worst case. An untimed stream now refuses body position, actigraphy and respiratory effort with `duration-unknown`, instead of one fabricated 30 s epoch. A coverage over no recorded window is now null with a named reason.
