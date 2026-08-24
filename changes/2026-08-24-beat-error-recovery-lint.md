<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [tools]
brief: none
---
Clear the two biome-ci lint errors in `tools/beat-error-recovery.mjs` that made `npm run lint` (biome ci) red on `main` for every JS-lane PR: the `noAssignInExpressions` at the LCG PRNG (split the `s = …` assignment out of the arrow-return, behaviorally identical) and a dead `const tt` (`noUnusedVariables` — the correctRR call recomputes the index array inline). `--self-test` reaches both lines and stays all-green.
