<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
brief: DEEP-AUDIT-III-2026-07-26-BRIEF.md
---
The house-invariant Clock-Contract lint printed "no Date.parse on ANY source — clean across 70 files" while scanning 70 of the 124 shipped .js files: its scope was a hand-curated list in run-tests.mjs that nothing kept in sync with what the bundler inlines, so it failed OPEN by omission. The scope is now derived from every `data-inline-src` in the owned bundles (70 → 108 files scanned, 89 of them shipped modules) and the scan set is itself gated, so it cannot silently shrink back. Widening it immediately caught two blind spots: a live `Date.parse(r.date)` in integrator-longitudinal.js — benign in practice because `date` is always a fmtDate 'YYYY-MM-DD' string, which the spec parses as UTC, but "benign today" is how a footgun waits — now an explicit regex + Date.UTC per Clock Contract §2.4; and a second gate, the badge-by-construction classifier, which could not see ecgdex-render.js or ppgdex-render.js at all and therefore never complained about them. Both are now named as unmigrated, which is the honest state.
