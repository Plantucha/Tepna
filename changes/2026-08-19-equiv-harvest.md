<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: MUTATION-COVERAGE-SELECTION-2026-08-14-BRIEF.md
---
§4.4 executed: the five comment-declared equivalent mutants are harvested into
`tools/mutate-equivalence.json` — knowledge that existed only in assertion-site comments, invisible
to every tool, re-reported as open work forever.

Reconciled against current sweeps rather than transcribed: two added with proofs (the
pulsedex/ecgdex `f[k] > maxC` tie twins), two found already present at DRIFTED line numbers under
the weaker `no-distinguishing-input` class — the text-anchored key matched them despite the drift
(#1486's re-anchor working as designed) — and upgraded to `equivalent` with their proofs. The
oxydex cross-cap pair has no surviving mutants anymore (killed since its 2026-08-12 note); and the
glucodex `meals`-guard declaration turned out NOT to cover the mutant that survives — the survivor
nulls every with-meals `analyze()` call and lives only because nothing asserts that path: a real
kill lead recorded in the brief instead of a mis-ledgered equivalence.

Also marks the "re-sweep WITH selection" box OVERTAKEN by `MUTATION-SUITE-FOLLOWUPS` §3d's
quarantine. Fleet arithmetic moved: 5451 → 5450 unresolved.
