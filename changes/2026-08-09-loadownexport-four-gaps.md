<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PpgDex]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
Close loadOwnExport's four real gaps — three of the four fallback fields being covered read as coverage, and the fourth was the hole.

Each killed and verified by re-applying its own mutant against the `PpgDex loadOwnExport` group:

  L4139  (a && a.tMs) && 0                       RED (1 failing)
  L4148  json.schema.generated) && null          RED (3 failing)
  L4148  (json.schema || json.schema.generated)  RED (3 failing)
  L4151  json.recording && null                  RED (1 failing)
  source restored                                44/44 GREEN, tree clean

WHY THEY SURVIVED, which is more interesting than the fix:

  · L4151 — the fallback-chain case carried `hrv`, `quality` and `personalization` at the top level
    but NOT `recording`, so that field's SECOND arm was never exercised. Four fields read through
    the identical `(carrier[0] && carrier[0].X) || json.X || null` chain; three were covered. Partial
    coverage of a repeated pattern reads exactly like coverage of it.
  · L4148 carries TWO mutants that fail in OPPOSITE directions — `&&`→`||` returns the whole schema
    object whenever a schema exists, `||`→`&&` drops a real stamp and always yields null. Asserting
    only the absent case catches the first and misses the second; only the present case does the
    reverse. Both assertions are needed and both are now there.
  · L4139 is the event sort comparator. Mutated, its first term is 0 regardless of `a`, so it stops
    depending on its left operand and is no longer an ordering — invisible to any already-sorted
    fixture. The test supplies events OUT of order, plus a null element to pin that `(a && a.tMs) || 0`
    treats it as 0 rather than throwing.

7 of ppgdex-dsp.js's 15 known real gaps are now closed (3 in lombScargle, 4 here).
