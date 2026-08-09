<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [PpgDex]
brief: PPGDEX-TESTABLE-SURFACE-2026-08-08-BRIEF.md
---
`loadOwnExport` — the self-ingest reload path — had **22 surviving mutants**. 37 assertions kill **18 of them (82 %)**, by far the best conversion of any function attacked so far.

**That number corrects a generalisation I made two commits ago.** Probing `lombScargle` (29 % distinguishable) and `parsePPG` (26 %) suggested "~27 % across ppgdex" and a ceiling near 52 %. `loadOwnExport` probes at **77 %**. The equivalent-mutant share is a property of *what a function does*, not a constant of the file: this one is validation and dispatch, almost entirely branching on input shape, so nearly every boolean mutation is observable. Numeric and parsing code is where mutations get absorbed.

**The first probe run reported 0 of 22 — a complete artefact.** It read `PPGDSP.loadOwnExport`, which is `undefined` (the function hangs off `PpgDex`), so every case threw the identical *"not a function"* and original matched mutant **by construction**. A probe that never runs its subject is indistinguishable from one that finds everything equivalent. Caught by checking that the battery produced varied output, and recorded in the test.

Getting from 6 kills to 18 came from two things the first pass never read:

- **the user-facing message.** `(node || 'non-PpgDex')` mutated to `&&` still refuses the file — `ok` and `reason` unchanged — but the message stops naming the node and says *"open it in its own node"*. The refusal survives; its usefulness does not.
- **the field fallback chain.** `recording`/`hrv`/`quality`/`personalization` are each read as `(carrier[0] && carrier[0].X) || json.X || null`. Three distinct outcomes, and only an export carrying the field in **both** places can tell the precedence from its mutants.

Also pinned: `foreign-node` is distinct from `not-node-export` (the actionable half of a refusal), a padded node name is trimmed rather than rejected, a non-array `sessions` falls back to one element, and elements are deep-copied so a reload cannot mutate the caller's object.

Tests only — no shipped source, no `manifestHash` movement, no fixture re-recorded.
