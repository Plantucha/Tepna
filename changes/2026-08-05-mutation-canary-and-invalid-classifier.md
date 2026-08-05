<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: []
brief: MUTATION-EQUIVALENCE-2026-08-04-BRIEF.md
---
Three defects in the mutation harness, **all in the flattering direction**, all invisible because a sweep reports a number nobody can check by eye.

**The classifier scored every non-zero suite exit as `KILLED`.** A mutant producing unparseable code exits 2 without running a single assertion — and was counted as coverage. Verified end-to-end rather than argued: `{1,3}` → `{1,0}` inside a `clock.js` regex gives `SETUP ERROR: Invalid regular expression`, exit 2, **zero** assertion marks, scored as a kill. The discriminator is that a mutant caught by a *test* leaves assertion output while one that never loaded leaves none. Both code paths now share one pure `verdictFromOutput()` — which makes the rule testable at all, and it previously was not. Deliberately conservative: only a run with *zero* assertions is reclassified, so a mutant that merely makes a group throw still counts as killed.

**The generator emitted mutants that cannot parse.** `([^-=<>!])>(?!=)` matched the first `>` of a **shift**: `win >> 1` became `win >=> 1`. Four such on `clock.js`, each costing a full suite run (~30 min of a 108-min sweep) to manufacture a fake kill. Generation drops 127 → 123, and a static `node --check` over all 123 now finds exactly **one** unparseable mutant — an invalid regex quantifier, a genuine invalid mutant, now correctly scored `INVALID`.

**Nothing proved the harness could still detect a kill.** If it silently stopped, the run would report a *lower* rate — indistinguishable from "the suite got worse", and it would send you writing tests against a lie. Each sweep now carries a mutant known to die, excluded from both numerator and denominator so it can never move the rate it guards, matched on `(line, op, before)` rather than a positional index so a refactor yields `STALE` instead of a silently wrong guess. If the canary survives, `killed` is nulled and no rate is reported. Self-maintaining: a green sweep donates its first attributed kill as the next canary, and only a run whose own canary passed may donate — otherwise the doubt launders forward.

**Corrected number.** `clock.js` was reported at 104/127 = 81.9 %. All five unparseable mutants necessarily scored `KILLED`, so the honest figure is **99 real kills / 122 valid mutants = 81.1 %**. The rate barely moves because numerator and denominator fall together; what changes is that it is now true, and that four of the five were a *generator bug* rather than an equivalent mutant.

Selftest extended by 13 known-answer cases: the classifier in both directions, the canary matcher including the stale case, and that no shift or arrow operator is mutated while real comparisons still are.

Tooling only — no shipped source, no `manifestHash` movement, no fixture re-recorded.
