---
bump: patch
type: fixed
brief: ABSENCE-SURVEY-2026-09-22-BRIEF.md
---

The mutation gate now refuses a module it could not read or parse, and a mutant count it could not read back, instead of treating either as zero. A live CPAP recording is now marked complete only when every kind of data loss was actually measured; two kinds (stalls and post-drop tails) are not yet counted, so live CPAP nights read unknown completeness until they are. The Codex source export's self-test also reports why an export was refused instead of crashing in its cleanup. Open ABSENCE-SURVEY findings: 263 of 290.
