---
bump: patch
type: fixed
brief: INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-III-2026-07-06-BRIEF.md
---

`tools/tch-multinight.mjs --dir` threw `ReferenceError: prov is not defined` on its first real night:
`prov` and `pseudo` were written inside `readNightDir` and returned from it without ever being
declared (#1418). The tool's entire real-data path had been dead since. `--selftest` never calls
`readNightDir` and `--dir` needs the gitignored corpus, so no gate could see it.
