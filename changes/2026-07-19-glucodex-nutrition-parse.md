<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [glucodex]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
`parseNutrition` carried two independent defects. There is **no nutrition fixture in `uploads/`**, so this parser shipped with zero coverage — which is why both survived.

**Date-only exports dropped every row, silently.** All five `_ckParse` branches require a time component, so a bare date returned `null` → `NaN` → `continue`. Cronometer's daily-summary export has a Date column and **no Time column**, so `hasTime` was false for the whole file: every row skipped, an empty nutrition panel, and never an error.

Fixed with a nutrition-**local** date-only parse anchored at midnight UTC. Deliberately *not* a `_ckParse` branch: for a CGM reading, a stamp with no time is a **missing instant**, and resolving it to midnight would fabricate one — the Clock Contract's *"a missing stamp must be visible (null), never fabricated"*. A nutrition daily row genuinely **is** a day, so midnight is its honest anchor rather than an invention. Keeping the two apart means a future CGM parser cannot inherit this by accident.

**No DMY lock.** It called the bare per-row `parseTimestamp`, hardcoded `preferDMY:false` with no lock, so a European export resolved **per row** — rows with day ≤ 12 silently became MDY, rows with day > 12 became DMY, and one file mixed both orders. Meals landed on the wrong day, which is exactly what the CGM correlation reads against. Now resolved once per file, like the CGM path already did (Clock Contract §3: prove the order once, lock it, never switch mid-file).

`_ckResolveDMY` gained a bare-date pattern so it can see the evidence at all — previously a date-only file gave it nothing and it returned unlocked. Adding a pattern can only *add* evidence, never unlock a file the timed patterns already locked, and CGM stamps always carry a time.

6 new assertions, mutation-verified independently. Removing the date-only path reds the row-count leg; removing the file lock turns `05/07/2026` in a European file into **2026-05-07** — two months off — while `13/07` in the same file still resolves correctly, which is the per-row inconsistency itself. Both DMY and MDY files are asserted, since a per-row guess cannot get both right.

Export-inert for the committed fixture — proven: the GlucoDex real-corpus equiv fixture re-ran and reproduced byte-identical (`verifiedUnder → e0c95add5b42`); the CGM path is untouched.
