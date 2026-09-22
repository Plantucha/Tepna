---
bump: patch
type: fixed
brief: VERDICT-CONTRACT-2026-09-21-BRIEF.md
---

mutation.yml's job summary rendered the diff gate's exit code (`0 → PASS`), so 273 of the last 300 commits read PASS on a gate that decided nothing about them; `tools/mutation-summary.mjs` — the first CI consumer of tepna.verdict/1 — now renders the object's status and population, with NOT_APPLICABLE/NOT_RUN as themselves and a missing, invalid or exit-disagreeing object as UNKNOWN, never PASS.
