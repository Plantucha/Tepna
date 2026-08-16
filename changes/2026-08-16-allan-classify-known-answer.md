---
bump: patch
type: added
brief: HOSTAXIS-STABILITY-FOLLOWUPS-2026-08-15-BRIEF.md
---

The noise-type rule is implemented three times; a gate asserted the three TABLES were equal text, and
its own brief named the limit: it does not execute either lane, so it cannot see two implementations
that share a table and diverge in the arithmetic around it. That arithmetic is written twice by hand —
edge scan, the 1.96·SE straddle test, the candidate walk, the drift arm.

Adds a cross-language known-answer for `classify`: 23 rows, each the literal return of
`capture-host/allan.py classify(sl, se)` run on that input, with `DexClock.classifyAllan` executed live
against it. Inputs sit where the lanes could differ — on an edge, either side of one, `se == 0` (which
must name a type rather than refuse), an interval whose upper end lands exactly on the top edge,
allan.py's own two exact-float fixtures, a band straddling every boundary including drift, and four
searched pairs putting the interval's lower end exactly on each edge.

The lanes agree on every decision — noise, candidates, refusal, unrounded slope — on all 23 rows. Six
mutants confirm the gate sees divergence.

Two findings table-equality could not have produced. `meaning` differs between the lanes (`√N` vs
`sqrt(N)`); it was never compared, so nothing saw it, and it is now pinned via one exact rewrite with
the count of affected rows pinned as well, so a fifth divergence cannot hide behind the normaliser.
And `clock.js` hardcodes the drift edge (`sl + half > 0.75`) where allan.py derives it from the table —
behaviour-identical today, so no re-bundle is owed, but a table edit would move one lane and not the
other while table-equality still passed. Pinned as a KNOWN DEFECT to ride the next spine re-bundle.

The gate needed the four searched fixtures because without them a `<` → `<=` mutant in the straddle
test survived: no input placed the interval's lower end exactly on an edge, so the comparison was
unobservable. Found by mutating the gate rather than the code.

Test-only; no source, bundle or provenance change.
