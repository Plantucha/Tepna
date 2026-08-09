<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PpgDex]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
A mutation-pinned assertion could never have failed, because JSON.stringify serialises NaN as null — three real gaps closed.

`PpgDex lombScargle` asserted the degenerate case through a serialised comparison:

    T.eq('…lfhf/lfnu/hfnu are null, not 0', JSON.stringify([z.lfhf, z.lfnu, z.hfnu]), '[null,null,null]')

`JSON.stringify` renders **NaN as `null`**, so `JSON.stringify([NaN, NaN, NaN])` is byte-identical to
the expected string. The three mutants this assertion was written to kill —
`hf > 0` → `>=` (L1969) and `lf + hf > 0` → `>=` (L1970, L1971) — make each guard admit zero and
compute `0 / 0`, so all three shipped HRV ratios come back NaN and the test passed anyway.

Not inferred. Measured by re-applying each mutant in turn:

  L1969 applied → 26/26 GREEN     (the assertion existed and saw nothing)
  fixed         → 2 failures, `lfhf=NaN lfnu=null hfnu=null`
  L1970 applied → 2 failures, `lfnu=NaN`
  L1971 applied → 2 failures, `hfnu=NaN`
  source restored → 27/27 GREEN

The replacement asserts each value is STRICTLY `null`, which NaN cannot satisfy, plus an explicit
`!Number.isNaN` leg naming the shape the serialiser hid.

This is the group's own §4a battery finding these as "distinguishable" — a distinguishing input
existed and the suite still could not see it, because the ASSERTION was lossy rather than the input
being absent. The lesson is on the line: never compare a null-vs-NaN distinction through
`JSON.stringify`, and it generalises to `Infinity` and `-0` for the same reason.

Three of `ppgdex-dsp.js`'s 15 known real gaps are now closed.
