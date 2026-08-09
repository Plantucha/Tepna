<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
Fold the four mutation briefs into one programme brief, and record that the equivalence mechanism is fed by one file out of every file that has been probed.

`MUTATION-EQUIVALENCE`, `CAPTURE-HOST-MUTATION-FLEET`, `JS-DSP-MUTATION-FLEET` and
`PPGDEX-TESTABLE-SURFACE` were running the same programme from four directions and had begun to
contradict each other. All four are marked DONE with `Folded-into:` headers (not `Superseded-by:` —
that field is strictly 1:1 and `docs-ledger` check 5 would red three one-sided links on a 4→1 fold).

Two conclusions changed on the way in, and both were refuted by work the briefs themselves spawned:

  · `PPGDEX-TESTABLE-SURFACE` §4a generalised from two functions that agreed (29 %, 26 %) to
    "~27 % across the file, ceiling ≈ 52 %". #1052 then probed a third — `loadOwnExport`, validation
    and dispatch — at 77 % distinguishable, 82 % converted. The equivalent-mutant share is a property
    of what a function DOES, not of the file.
  · Both fleet maps therefore rank the wrong unit. A file's rate is a weighted average over functions
    of different character, so `JS-DSP-MUTATION-FLEET` §6's order of work follows the wrong axis.

And one finding is new. `tools/mutate-equivalence.json` carries `clock.js` and nothing else;
`capture-host/tools/mutate-equivalence.json` carries one entry. Against that, ~83 classifications
have been measured with a battery and written down in prose. The ratified target is
`killed / distinguishable`, so it is currently unmeasurable on every subject except `clock.js`.
The fix is not transcription — §8.4 forbids it, and the batteries were never committed, so the only
prober in the repo is `clock.js`-specific by construction.
