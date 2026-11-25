<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
brief: BADGE-COVERAGE-AUDIT-BRIEF.md
nodes: [HRVDex]
---

The HRVDex sidebar readiness chip now badges the number it mirrors. The readiness hero badges its
score with a corner disc, and the chip showed the same score with no disc, so one number read as
graded in one place and ungraded in the other. The grade comes from the node registry, which holds
`hrvScore` at `experimental`, the same tier the hero shows. The disc rides the same guard as the
number, so the em dash of an absent score carries none.
