---
bump: patch
type: changed
brief: VERDICT-CONTRACT-2026-09-21-BRIEF.md
---

tools/mutate.mjs --diff emits tepna.verdict/1 at every exit — the JS half of the pair #2802 closed: `diffVerdict()` decides PASS · FAIL · UNKNOWN (canary survived or mutants never ran — never a kill) · NOT_APPLICABLE (no mutable source, or changed lines with no mutant — was "all 0 killed") · NOT_RUN, exit codes unchanged; `--verdict-sample` for the adoption gate; manifest row flipped.
