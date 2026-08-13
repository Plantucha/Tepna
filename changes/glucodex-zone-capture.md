---
bump: patch
type: changed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

Clock Contract §2: GlucoDex's zone parser (`_ckZoneMin`, reached through `_ckParse`) was
pseudo-tested — `offsetMin` is the only place a real zone survives into the record, and nothing
asserted it. Sign inversion, a zeroed hours term, and a one-char-short minutes field all survived
the whole GlucoDex suite. Now pinned, including the §2.2 identity that a zoned stamp and a bare
local stamp for the same wall instant yield the same floating tMs. Verified by re-applying the
mutants: 3/3 killed.
