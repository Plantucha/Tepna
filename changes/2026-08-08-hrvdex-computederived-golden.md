<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [HRVDex]
brief: JS-DSP-MUTATION-FLEET-2026-08-08-BRIEF.md
---
`hrvdex-dsp.js` was the fleet's worst-covered file at **29 %**. A full 490-mutant sweep and triage put **197 of its 346 survivors — 57 % — inside one function**: `computeDerived`, which produces 62 derived HRV columns. Nothing asserted any of them, so almost any arithmetic in it could be changed without a test noticing.

One golden group over that function, from a single fully-populated row, pins all 52 columns it emits.

**Measured, not claimed: 144 → 191 killed, 29.4 % → 39.1 %, 47 mutants newly dead** — verified by re-sweeping all 490 after the test landed, and that re-sweep was **canary-guarded** (`PASSED`), which the previous one could not be.

It is a **characterisation** test, and the wording is deliberate. It pins what the code *currently* produces so any change becomes visible; it does **not** validate the formulas. Two were checked by hand against their published definitions — `d_cv_calc = (SDNN/meanRR)·100` and `d_hfnu = HF/(HF+LF)·100` — and both agree; the other 50 are pinned, not endorsed. Anything wrong in there is now pinned wrong and needs a separate correctness pass. What this buys is that it can no longer change silently.

Two details worth keeping. Every seed field is populated on purpose — a null seed short-circuits whole branches, and a branch that never runs cannot be pinned, which is part of how 197 mutants survived. And the group asserts the *shape* (52 columns) independently of the values, so it cannot pass vacuously if `computeDerived` ever stops populating the row.

Caught while writing it: two fields are **NaN**, and `JSON.stringify` renders both `NaN` and `null` as `"null"`, so they were first mis-pinned as `null` and then reported as the uninterpretable *"got null want null"*. The comparison now tests NaN by predicate and prints it by name.

Tests only — no shipped source, no `manifestHash` movement, no fixture re-recorded.
