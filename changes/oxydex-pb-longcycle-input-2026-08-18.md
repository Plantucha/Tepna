---
bump: patch
type: added
brief: OXYDEX-PB-DETECTOR-FOLLOWUPS-2026-08-17-BRIEF.md
---

**A committed input that reaches the PB detector's 90–130 s upper band — it had only ever been
exercised by arrays the test file builds.**

`OXYDEX-PB-DETECTOR-FOLLOWUPS` §5. Every committed OxyDex input runs outside the band — 20 s and 50 s
(`_longnight`), ~420 s drift (the clean file) — so `PB_CYCLE_MAX_SEC` (130) was reachable only from
synthesised arrays. A regression in parsing, in the rolling baseline, or in the ceiling itself could
not red from committed bytes.

- `uploads/synthetic_oxydex_o2ring_longcycle.csv` — 2 h @1 Hz, **8 cycles at 110 s**, flat flanks,
  amplitude 2 %SpO2 about the baseline. Built by `tools/make-synthetic-inputs.mjs` §10 — the generator
  **on the compute path**, not the demo `synth-gen.js` the section originally named.
- Six assertions in `oxydex · pb-detector`, the first there to run through the real `parseCSV`:
  `periodic true · cycleLen 110 · cycleCV 0 · longestRun 7`, and explicitly **above 90**.
- Wired into **both** runners (`tests/run-tests.mjs` + `Dex-Test-Suite.html`), as `pairCommitted` —
  an input-only twin like `_dmy`/`_mdy`/`_lossy`/`_longnight`/`_gap`.

**Mutation-verified:** `PB_CYCLE_MAX_SEC` 130 → 90 kills five of the six; the parse-length assertion
correctly survives. Before this input, that mutant passed every committed leg.

**No existing hash moves.** Added as a new file rather than widening an existing one — the others carry
recorded `inputHashes`, so an edit would move a fixture input and drag regeneration behind it.
`git status` after generation showed one untracked file and no modified tracked input.

An input-only twin carries no `provenance/` fixture entry (none of its five siblings does), so this is
a deliberate narrowing of §5's "ledger entry and equivalence leg" wording: the claim is an invariant,
not a byte-pin, and a golden would drag `outputHash` regeneration behind every unrelated OxyDex change.

§4 stays open — κ rests on 4 device-positive nights and is blocked on corpus, not effort.
