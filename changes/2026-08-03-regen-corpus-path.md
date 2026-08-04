---
bump: patch
type: fixed
nodes: [ECGDex]
brief: REGEN-CORPUS-PATH-FOLLOWUPS-2026-08-03-BRIEF.md
---

The regen family and `tools/verify-fixtures.mjs` now resolve the corpus through one exported
`resolveCorpus(repo)` helper, so the write half and the verify half of the fixture workflow cannot
look in different places again. Previously only verify-fixtures honored `DEX_UPLOADS`, so a
sanctioned regen run from a worktree reported `INPUT ABSENT` for 11 corpus-backed fixtures across 7
nodes that were sitting in the main checkout — exiting 0, with the summary reading like a known
exemption. An absent input now names the path it searched, and a hole is counted as `NOT REACHED`
rather than `skipped`. The write side is deliberately NOT redirected: `uploads/` also holds 133
git-tracked artifacts including the fixtures a regen writes, so `fixturesDir` stays pinned to the
running checkout. Also deletes `ecgdex-dsp.js`'s dead `modeV`/`amo50`, which binned at 5 ms / ±25 ms
against `baevskyGeom`'s 50 ms and would have emitted different numbers under the same export key.
