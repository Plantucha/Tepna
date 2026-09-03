<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [tooling]
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---
§6 told the next reader to build a thing that exists and was rejected for fabricating findings.

`MUTATION-PROGRAM-FOLLOWUPS` §6 is titled "THE ONE OPTIMISATION WORTH BUILDING BEFORE MORE TESTS" and
describes per-test coverage selection as pending. It is not pending. `tools/per-group-coverage.mjs`
builds the map, `pgmapFor()` in `tools/mutate.mjs` applies it, and the flag is `--use-coverage-map`.

**§6's estimate was right and was never the problem.** Measured 2026-08-14: median groups per mutant
6 / 9 / 30 for `integrator-dsp` / `hrvdex` / `ppgdex` — **78x / 52x / 16x**, against §6's estimated
10–100x.

**It is quarantined because per-line selection is UNSOUND.** Paired hrvdex sweeps: **7 of 38 tag-kills
became survivors under selection**, re-confirmed 2026-08-19 against the interval-coverage collector.
That re-confirmation is the load-bearing result, because the obvious response to a bad map is a better
map — and a better map did not make it sound. Three mechanisms, each proven separately: lines whose
execution depends on state built by earlier groups; LOAD-executed lines that are in no group interval
by design; and integrity/audit interactions whose fabricated 22/22 "kills" are why every number was
re-measured.

The failure direction is what makes this urgent rather than tidy: a selection that narrows too far does
not run slowly, it **reports SURVIVED for mutants that die** — the worst failure this programme has,
wearing the shape of a 78x speedup. So a reader following §6 today rebuilds a proven trap.

Recorded as **§6-bis**, marked rather than rewritten, per the same convention as §2a-bis. §6 keeps its
text and gains a pointer.

**What is genuinely still unbuilt is a different design**, and §6's title is right about the wrong
thing: **UNION-WITH-TAG** — a superset of the tag set can never lose a tag kill — plus the vetted
zeros. Specified in `pgmapFor`'s comment, not yet built. Until then the map is a diagnostic, not a
filter.
