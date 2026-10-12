---
bump: minor
type: added
brief: none
---

tools/null-fuzz.mjs — the null-injection fuzzer for the DSP absence contract (§∅): P1 an all-null night yields null metrics, P2 nulls are ignored, never zeroed; targets oxydex, pulsedex, glucodex and the shared machinery; tepna.verdict/1 per target; adopted in tools/verdict-adoption.json via --verdict-sample. Built 2026-10-06, its findings landed through #3321 and siblings while the tool stayed in a worktree; landed now on the owner's order to adopt or delete unlanded work.
