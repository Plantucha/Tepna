---
bump: patch
type: fixed
brief: none
---

Complete the mutant-key fix in probe-equivalence.mjs's equivalence-ledger dedup, which #1793 scoped
out. There a collision is worse than a mis-pairing: marking one mutant equivalent silently excused its
twin on the same line, suppressing a real killable mutant. The legacy fallback is asymmetric on
purpose — a false "already recorded" suppresses, a false "new" only duplicates.
