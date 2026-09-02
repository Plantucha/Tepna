<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
brief: MULTI-SENSOR-DERIVATIONS-FOLLOWUPS-2026-07-18-BRIEF.md
---
PpgDex's RSA respiration rate now reaches the fusion. It was computed, exported since 2026-08-01,
and read by nothing for a month — one `if` away from its consumer.

`summary.respRateBrpm` was assigned at exactly two sites, both node-gated: `integrator-dsp.js:365`
inside `if (node === 'ECGDex')` and `:617` inside `if (node === 'MotionDex')`. The
`PulseDex|HRVDex|PpgDex` branch PpgDex actually flows through read `hrv.frequency.lfhf` and never
the sibling `respRate` beside it. The assignment now lives in that shared branch, guarded on
`== null` so ECGDex and MotionDex are untouched, with ECGDex's exact normalisation (`> 0`, so a
spectral non-estimate is null rather than a published 0 bpm).

TWO SURFACES ASSERTED THIS WAS ALREADY WIRED AND BOTH WERE WRONG. The brief's original finding —
"the PulseDex|HRVDex|PpgDex branch never assigns summary.respRateBrpm" — was CORRECT, and its
later retraction ("Link (iii) was NOT missing") was false. The retraction's own words are why it
survived: *"Verified in the tree before building on it, not read off this line."* Someone checked,
found the assignment, and never asked which BRANCH it was in. `ppgdex-dsp.js`'s export comment
carried the same claim. A producer cannot attest its own consumer: the claim is about a file it
does not read. Both corrected in place, struck through rather than deleted.

Also logs R11 — the respiration-fusion path has no committed fixture, so this defect was not merely
unreflected but INEXPRESSIBLE by the corpus.
