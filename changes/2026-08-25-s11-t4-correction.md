---
bump: patch
type: fixed
brief: OXYII-DAT-AUTO-HARVEST-REFINEMENT-2026-08-24-BRIEF.md
---

Correct §11's T0-T7 table: T4 IS emitted. pull_session.pull() writes the post-download row with the
state oxy_inventory.classify() returns, which is VERIFIED when the trailer parses; the original claim
came from grepping for the literal constant, which never appears in that file. Only VERIFYING is
genuinely unwritten, and T3/T4 currently share one timestamp, so the gap is one emit rather than two.
