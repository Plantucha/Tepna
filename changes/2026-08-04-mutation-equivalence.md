---
bump: patch
type: added
brief: MUTATION-EQUIVALENCE-2026-08-04-BRIEF.md
---

Three `hostAxis`/`correctionAt` guards pinned by assertions that each fail on their own mutant, plus
`MUTATION-EQUIVALENCE-2026-08-04-BRIEF.md`: of 15 survivors in those two functions only **3** can be
killed by any input — the other 12 are ties and clamps. Reachable ceiling on `clock.js` is ≈76 %, not
90 %, so the brief proposes reporting `killed / distinguishable` rather than `killed / tested`.
