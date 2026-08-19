<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [docs]
brief: REFERENCE-GUIDE-AUDIT-BRIEF.md
---
`REFERENCE-GUIDE-AUDIT`'s header contradicted its own body for ten days: it listed nav-highlight
scroll-spy as "the one part still unproven" and as remaining work, while the body's own `[x]` box
records the PROOF dated 2026-08-09 — 111/111 testable sections across all 7 guides, with the probe
shown to fail first (neutering `window.scrollTo` puts every guide at `followed=0`).

Header now points at the proof and names the single genuinely-open item: dimension 3's per-metric
honesty reading of the `emerging`/`experimental`/`heuristic` disclaimers. The brief stays
IN-PROGRESS for that.

Found during the 2026-08-18/19 status sweep, whose repeated lesson this is: the status header is the
only part most readers see, and it can lag its own body — two sessions nearly re-executed shipped
work off exactly this class of stale line tonight.
