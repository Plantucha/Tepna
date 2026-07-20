<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [HRVDex]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
A browser storage failure now survives to the user. `persistHRVRows` returns its outcome
(`ok` / `capped` / `failed`) instead of painting its own status line, which the caller then
overwrote two statements later with "✅ Added N measurements" — so a full or disabled localStorage
reported success while the history was capped or never written. The caller appends the outcome, so
the success line carries the warning rather than replacing it. Silence now means saved, and is the
only thing that means saved.
