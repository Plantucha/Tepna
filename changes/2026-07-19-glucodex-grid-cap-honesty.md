<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [glucodex]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
Two coupled defects, landed together because fixing either alone makes things worse.

**§5.1 — a truncated record said nothing.** The uniform grid is capped at 200 000 cells, and the pointer walk then fills only `N`, so every reading past `tMs[0] + N·stepMs` was dropped — with no counter, no flag, no field and no throw. Downstream (AGP / MODD / CONGA / sessions / events) saw a shorter record and reported it as though complete.

The cap itself is a memory judgement and is **deliberately unchanged**; the *silence* was the defect. Exceeding it now reports on `series.truncated`, naming the dropped cell count and the wall-clock it represents. On the test record that is **88 001 cells — about 61 days of glucose data — previously discarded without a word**.

Note where it had to be plumbed: `analyze()` builds `series` as a **hand-picked subset**, so a field added to the grid is invisible to every consumer until it is named there. That is a fair part of how this stayed silent — the information existed nowhere, and the export shape never asked for it.

**§5.2 — the session span could overflow the stack.** `detectSessions` computed `Math.max(...xs) - Math.min(...xs)`, and `xs` grows one entry per analyzable cell, bounded only by that same cap. V8 blows the stack spreading ~64–125k arguments, and the function runs twice per analyze. It has never fired only because the 5-min corpus never approached the cap — which is exactly why these must land together: **raising or removing the cap without §5.2 converts a silent truncation into a hard crash.** `xs` is pushed in ascending grid order, so first/last is not an approximation of the extremes — it *is* them, allocation-free and O(1).

8 new assertions, mutation-verified independently: removing the truncation report reds §5.1; restoring the spread reds §5.2. Both the over-cap and under-cap cases are pinned, and a fitting record reports `truncated: null` **explicitly** rather than by omission — absence of a field is not evidence of completeness for a consumer written before this.

Export-inert — proven: the GlucoDex real-corpus equiv fixture re-ran and reproduced byte-identical (`verifiedUnder → 877c6c5dfdc9`).
