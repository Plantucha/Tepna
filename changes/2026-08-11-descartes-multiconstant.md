<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---
Implement the real Descartes verdict rule, and fix a brace-matching defect. Both from a parallel
coder's review.

THE VERDICT RULE. The first version used ONE extreme mutant (empty body) and called survival
pseudo-tested. Descartes' MethodClassification requires EVERY applicable operator to survive, and
classifies a mixed outcome as partially-tested. Eight operators now run per function — empty,
return null / 0 / 1 / '' / true / false / [] — matching DEFAULT_MUTATION_OPERATORS. JS has no static
types so every operator is applicable and the tests decide.

Short-circuited on the first kill unless --classify: one killed operator already proves a function is
not pseudo-tested, and most are killed by the first, so the cost stays near 1 mutant rather than 8 —
hrvdex ran 163 mutants for 37 functions. The price is that a function killed by the FIRST operator is
reported as noticed without checking whether a later operator would have survived; --classify runs
the full set.

THE PREDICTION IT WAS MEANT TO TEST DID NOT HOLD. The reviewer expected the stricter rule to pull down
two files sitting far outside the published 9-14% yield. It did not: hrvdex 18 -> 18 (48.6%), pulsedex
21 -> 20 plus 1 partial (40.0%), glucodex 8 -> 8. Those functions survive ALL EIGHT extreme mutants.
c8 independently reports those same two files as the fleet's least-executed (40.0% and 59.7% function
coverage), so the outliers are a property of the files, not of the single-operator rule.

THE BRACE DEFECT. functionBodies counted braces over RAW source, so a `}` inside a string, comment or
regex ended a body early and emitted source that does not parse. Quiet in the worst way: a
non-parsing file fails the suite, which the tool reads as "the tests noticed" — a mis-bounded function
was silently recorded as TESTED. It under-reported, never over-reported. Fixed by counting on
stripNonCode's masked copy (offsets preserved) and splicing the original — reusing probe-equivalence's
already-selftested helper rather than owning a third copy. Re-measured after the fix: the numbers did
not move, so the bug was real but not load-bearing on these files.

Baselines regenerated under the new rule: glucodex 8, cpapdex 6, motiondex 3 (was 4).

NOT ADOPTED, deliberately: folding this into mutate.mjs as --extreme. The reviewer's own findings argue
against it — a new op family orphans all 359 mutate-equivalence.json entries and makes every canary
read STALE, and m.line as the --diff selector breaks for whole-body mutants. A separate tool has its
own canary and key space and cannot destabilise the operator sweeps.
