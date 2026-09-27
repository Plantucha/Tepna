<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [analysis]
brief: none
---
Two gates, two closed residue rows, one new finding.

**The worker-boundary gate can now ask whether a payload key is read on the path that carries it**, not
merely whether its name occurs somewhere in the consumer file — the weakness that let `qrs-equiv`'s `error`
count as consumed while its `done`-path handler dropped it. The classification is **three-valued**, because
the stated property ("read inside the handler for the carrying type") is not implementable as lexical
scoping: consumers pass the payload onward, and scoping-and-failing flags 54 of 65 keys that are
demonstrably read. So: *consumed*; *dead on the carrying path* (read only under other types — fails, the
qrs-equiv shape); *undecidable* (read in a helper — published per producer as four two-sided equalities,
never claimed consumed, never red). Decidability is published as a number rather than gated: 11 of 71 keys.
The file-wide matcher remains, with its soundness stated as one-directional — a key it calls DEAD is dead, a
key it calls READ may be read where that message never arrives.

**`tools/trio-batch.mjs`'s `CODE_DIGEST` now covers exactly the fold's compute closure.** It was wrong in
both directions: it hashed `__filename`, so any orchestrator edit re-staled all 82 stamped nights (authorised
by the row's own frequency test — 48 commits, ~19/month), **and** it hashed 7 of the 8 modules the realm
loads, omitting `integrator-dsp.js`, which the fold calls and whose output it writes. One `COMPUTE_MODULES`
array now feeds the realm loader and the digest, so an added module lands inside the closure structurally —
`computeHash`'s denylist reasoning carried across. Verified by running the digest: a comment-only edit to the
orchestrator leaves it byte-identical; a one-token edit to an inlined DSP moves it.

The omission's past damage is not repaired by the fix and is logged as residue
`2026-09-27-fold-digest-omitted-integrator-dsp` — a re-fold under the corrected digest is the owner's call.
