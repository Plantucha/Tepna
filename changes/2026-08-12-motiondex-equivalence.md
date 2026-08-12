<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---
58 more motiondex survivors classified — and hrvdex's payload is already complete, which changes what
the next step is.

`tools/probe-equivalence.mjs --file motiondex-dsp.js --emit` records 58 previously-unclassified
survivors, taking motiondex from 42 to 100 and the fleet payload from 359 to 417. DISTINGUISHABLE
survivors are deliberately NOT emitted: they are real gaps, they are debt, and they stay in the
denominator.

HRVDEX NEEDED NO EMIT, and the reason is the useful part. Its 298 survivors break down as: 69 already
classified, ~11 withheld because the sweep killed nothing in their function so the battery's reach is
unproven, and the remainder DISTINGUISHABLE — the probe found inputs that separate mutant from
original. `computeDerived` alone holds 149 of the 298 and its battery separated all 12 controls, so
those are not equivalence candidates at all. They need TESTS.

So §7.1's classification work for hrvdex is done, and what remains there is assertion-writing in
`tests/dex-tests.js`. That file is held by a parallel session tonight, so it is a coordination
boundary rather than a capability one, and it is recorded here rather than worked around.

15 motiondex families still contribute nothing (blind, degenerate or uncontrolled) and their
survivors stay unclassified by design. Widening a battery is the fix; lowering the bar is not.
