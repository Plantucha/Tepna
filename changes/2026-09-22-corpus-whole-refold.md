---
bump: patch
type: changed
brief: none
---

The trio corpus is re-folded whole, under one code generation. 116 nights -> 140 (24 new,
2026-08-28..09-21), 431 exports rewritten, 0 deleted. Every stamped night now carries a single
codeDigest (7b44db6fbd394099) where the committed corpus carried five.

⚠️ The population of every statistic computed over uploads/trio changes deliberately. 291 of the
295 previously-committed exports moved substance — that is accumulated drift (five pipeline
generations, plus de-duplicated inputs and t0-from-content), not a defect introduced here. The
control isolating the heap-retry change alone moved 380 of 387 exports volatile-only, with 3
substantive files, all three being 2026-07-19 — the night it was built to rescue.

2026-08-15 is NOT re-folded: its Verity PPG/ACC/MAG each exist twice at different sizes, so which
bytes are the recording is ambiguous and the fold refuses it by name. It keeps its committed
exports and stays unstamped.
