<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: []
brief: POOLED-CLOCK-FIT-FOLLOWUPS-2026-07-31-BRIEF.md
---
`POOLED-CLOCK-FIT-FOLLOWUPS` §7 recorded an open question: the partial nights that clear their null land at 39.3–42.0 min against a 38.28 min consensus — genuine CPAP clock drift, or single-channel bias?

Measured, now that §4's `--allow-partial` makes a May→July span reachable. All 31 confident offsets against date show a monotonic decline from ~41 min in early May to ~38 min in late July, and a negative slope is present **independently in both subsets** — so it is not an artifact of mixing them.

**But no rate is quotable.** Trio-only (the trusted fits, Jun 10 – Jul 27) gives −9.0 ppm; partial-only (single-channel, May 3 – Jun 23) gives −29.1 ppm. The subsets differ 3× over different spans, which cannot separate non-linear drift from the single-channel bias already flagged, and the trio slope is only ~2× its own residual scatter across 47 days.

**Nothing shipped is affected:** `38.28` appears nowhere as a computed constant — only in a console message and as a planted offset in synthetic tests. Every consumer uses the per-night fit.

Also records 2026-05-31, which fits confidently at 25.08 min, 13 min below its neighbours and unexplained — excluded from the slope fits and written down so it is not silently dropped twice.
