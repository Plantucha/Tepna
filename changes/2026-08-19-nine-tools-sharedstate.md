<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: MUTATION-SUITE-FOLLOWUPS-2026-08-17-BRIEF.md
---
§1 executed: the mutation-lane tools now resolve their state shared-first through the git COMMON
directory (`mutation-map.mjs` helpers), with the in-tree `.mutation-sweeps/` kept as legacy read
fallback — so ONE queue/cache serves the main checkout and every linked worktree.

Migrated: `mutation-worklist` (per-FILE sweep resolution) · `survivor-witness` + `witness-baseline`
(union directory scan, shared wins ties) · `assertion-strength` · `per-group-coverage` (its default
`--out` is now exactly the first candidate `resolveMapPath` reads) · `stmt-delete` · `extreme-mutate`
· `doc-search`. `mutation-reach` had no implicit state path — nothing to migrate, recorded as such.
Flags and `DEX_SWEEP_DIR` still outrank both candidates.

Two wrong first drafts are documented in the code where they died: first-existing-DIRECTORY
resolution made eight present sweeps read as a lost queue (the shared dir existed for other reasons
— a directory's existence says nothing about its files), and the worklist's old "default dir is
inside the repo" assertion correctly red on the new contract and was rewritten to the surviving
invariant (a declared candidate, never an invented third place).

Measured payoff: `mutation-worklist` from a linked worktree prints the real queue — 4487/9938
distinguishable, 5451 unresolved — where before it printed `NO SWEEP DATA` from every worktree.
267 selftests green across the eleven lane tools.
