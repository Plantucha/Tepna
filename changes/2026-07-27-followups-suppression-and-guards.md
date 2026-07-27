<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [Integrator, OxyDex]
brief: DEEP-AUDIT-III-FOLLOWUPS-2026-07-27-BRIEF.md
---
Three residue items. The surge-side twin of the desat double-count: `gather()`'s 1-second key never collapses two observers' clocks, so a second cardiac observer doubled the pooled surge count, and that count feeds surgeRate to lambda where a doubled lambda pushes `belowChance` true — this one SUPPRESSES real findings rather than inflating a count. The desat remedy was deliberately not copied, because R2 makes either cardiac node a first-class corroborator; what is per-person is the RATE, so the null model now takes its rate from one observer via the existing HR_AUTHORITY ladder while every observer stays eligible to confirm, and it names that observer plus who else saw surges. Measured pre-fix: 5/hr became 10/hr and expected-by-chance 4.17 became 8.33 purely by adding a device. `_o2DateAnchorMs` fed an unvalidated 14-digit filename run to Date.UTC, which silently rolls out-of-range components: month 13 day 32 produced a night dated 2027-02-01 and all-nines produced 10007-06-07, a fabricated instant from a filename with no flag; components now round-trip like clock.js `_ckMk` and the capture is anchored. And OxyDex's `_durBad` caught a negative span while letting an inflated one pass as a real number — the reason a 120-minute night could report 1560 with clockNonMonotonic still false — so it is now bounded by row count times observed cadence, with `durationInflated` distinguishing the two failures.
