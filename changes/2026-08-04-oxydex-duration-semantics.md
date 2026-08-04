---
bump: patch
type: added
nodes: [OxyDex]
brief: NODE-EXPORT-DURATION-SEMANTICS-2026-07-27-BRIEF.md
---

Pins OxyDex's duration contract: `durationMin` is the recording ENVELOPE and
`recording.coverage.recordedSec` is the DATA. Re-auditing the brief's `pending` status against the
42-night O2Ring corpus shows OxyDex already satisfies the ratified option (c) in its own vocabulary —
`durationMin × 60` tracks `coverage.spanSec` to within a second and not `recordedSec` — so the
remaining work there is naming uniformity, not missing information, and renaming would change a
published field's meaning to buy nothing a consumer cannot already read. What the remaining item could
break is that `durationMin` keeps meaning the envelope; that is now gated and mutation-verified, so a
silent denominator change is impossible. Also pinned: a contiguous night emits no coverage block rather
than a fabricated 100%, enforced in the shared `dex-export.js coverageFromSegments` rather than in the
node. Test-only; no DSP behaviour changed.
