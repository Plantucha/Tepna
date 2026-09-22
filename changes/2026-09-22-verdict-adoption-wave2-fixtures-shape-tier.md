---
bump: minor
type: added
brief: VERDICT-CONTRACT-2026-09-21-BRIEF.md
---

Three wave-2 adopters emit tepna.verdict/1 under --json and their manifest rows flip to adopted in the same PR: verify-fixtures (--check reads the ledgers against the built bundles — PASS/FAIL naming the unverified fixtures; stamp mode adds NOT_RUN when the corpus is absent), commit-shape (PASS/FAIL naming flagged shas, NOT_RUN on a shallow clone; the old --json fields ride in result), and corpus-tier (PASS/FAIL naming refusals, NOT_RUN when the NAS is not mounted; --selftest runs the refusal plant on a scratch pair and is what the manifest reads — no NAS, no corpus). Every emits.cmd is corpus-free and runs in CI.
