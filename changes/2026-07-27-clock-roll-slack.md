<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
brief: DEEP-AUDIT-III-2026-07-26-BRIEF.md
---
The Clock Contract's time-only midnight roll treated ANY backwards step as a wrap, so one duplicated row turned a 120-minute night into a claimed 1560 minutes and collapsed SBII 13x — while start/end still read correctly and clockNonMonotonic stayed false, because OxyDex's guard only catches a negative span. The audit's own fix sketch proposed the 1-second tolerance its two in-repo siblings use; executing that disproved it, since 2 s, 5 s, 60 s and 3600 s all still rolled a whole day. A genuine wrap is ~23 h backwards, so the threshold is now a fraction of a day (12 h) rather than a jitter allowance: the largest backwards step that cannot be a wrap and the smallest no disordered row can reach. Shared-spine change, so all 11 owned bundles were rebuilt and 6 moved their manifestHash; 8 fixtures re-verified against the real corpus.
