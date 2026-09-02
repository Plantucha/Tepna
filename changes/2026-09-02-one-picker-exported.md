<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [pat-tools]
brief: PAT-FORENSICS-WINDOW-ORACLE-2026-08-28-BRIEF.md
---
**Four tools were choosing their input files four different ways.** #2082 fixed the ECG/PPG fragment
pairing inside `pat-window-oracle.mjs`'s own `main()`; three other tools each carried a private copy
of the pre-fix version — two independent size-sorts, so on a fragmented night the largest ECG and the
largest PPG come from different hours and the pair never overlaps. That is the defect that made 15
nights read as "no overlap" and was originally filed, wrongly, as a capture-session fact.

`pat-residual-structure.mjs` and `pat-drift-attribution.mjs` were the two known copies. **A grep for
survivors after converting them found a fourth**, in `pat-ecg-axis-residual.mjs` — which is the whole
argument for the shape of this fix: fixing the copies in place would have been the third correct fix
of one defect while leaving the mechanism that produced copies 2, 3 and 4 fully intact.
**Three instances in one family is not three bugs, it is one absent abstraction.**

So `pickPair(dir, files)` is exported from the oracle and imported by all four sites. It returns
`{ eF, pF }`, or `{ missing }` naming the absent stream so the CALLER decides how to report it — the
four sites reported absence three different ways (a tallied refusal, a silent `continue`, a printed
`⊘ missing a stream`), which is exactly why a shared helper must return the reason and never print
it. The `readFileSync(b).length` comparator went with it: `statSync` gives the same number without
fully re-reading every candidate O(n log n) times (555 PPG fragments on 2026-07-18).

**Measured on the box corpus, paired by night:** 29 → **43** nights scored, 14 gained, **none lost**,
and among the 29 already scored only 2 beat counts moved with **zero verdicts changed**. The fix is
almost purely additive — it recovers nights without disturbing any conclusion already drawn. Full
journey across today's two fixes: 23 → 29 (the returned split, #2111) → 43.

Selftest 25 → 27, asserting the `missing` contract on both shapes; anti-vacuous by construction since
`origin/main` exports no `pickPair`.

§6's table is re-measured once under the shared picker and its eight rows are **byte-identical** to
what #2111 recorded — the two nights whose counts moved were not among them. A **manifest** now sits
beside it (commit, corpus root, exact invocation, and the selection rule stated as *the 8 nights §6
originally scored, carried forward verbatim, not re-selected*), so the table that was unreproducible
from committed code for weeks (**R10**) can now be settled in one command. Stability across two
independent fixes is better evidence for those numbers than the re-measure itself.
