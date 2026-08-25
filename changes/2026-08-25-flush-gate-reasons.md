---
bump: patch
type: fixed
brief: OXYII-DAT-AUTO-HARVEST-REFINEMENT-2026-08-24-BRIEF.md
---

Close the three flush_gate mutants that nulled `reason` on the deadline, WAIT and PULL branches. The
assertion enumerates every branch rather than adding another per-case check, because this is the same
gap fixed in pull_deadline one function earlier — a per-branch assertion invites it, enumerating does
not.
