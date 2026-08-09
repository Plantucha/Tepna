<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [PpgDex]
brief: PPGDEX-TESTABLE-SURFACE-2026-08-08-BRIEF.md
---
`ppgdex-dsp.js` runs the **second-broadest test tag in the fleet — 49 groups, more than `ecgdex`** — and kills barely a third of its mutants, where `ecgdex` kills 62 %. It is the one row in the fleet map the usual explanation (*"the tag is too narrow"*) cannot cover. This brief reports what it actually is.

Full sweep, all 1176 mutants: **395/1162 = 34.0 %**, 767 survivors, 14 invalid. The 60-mutant sample predicted 33 %, which also confirms the sampling the rest of the fleet map rests on.

**The survivors are a long tail, not a cluster** — 767 across **84 functions**, largest holding 8 %, 19 functions holding one or two. HRVDex, by contrast, had 197 of 346 (57 %) in a single function, which is why one golden test there killed 47 mutants (#1030). That technique would address 8 % here, so it was **not** written: it would have been the method fitting the previous problem rather than this one.

**The cause is that the top clusters are unreachable.** All six — `magInterfAtSec`, `ma`, `evt`, `perfWindow`, `c`, `ppgLoadOwnExport` — are internal closures. `ma` is an arrow function nested inside `cvhrFromNN`, which is itself unexported. The file is 4099 lines with 78 internal functions, and its public surface is `compute` · `parsePPG` · `analyze` · `lombScargle` · `loadOwnExport` · `scrubExport`; the suite calls `.compute` eight times and two others once each.

So all 49 groups drive `compute()` end to end, where flipping one interior comparison rarely perturbs the final export enough to fail an assertion. **34 % under a broad tag is the signature of that surface, not of the tests' diligence.** The contrast with HRVDex — nine functions on `_bare`, including the one a targeted golden moved 29.4 % → 39.1 % — is the evidence rather than the theory.

Proposes exposing the pure helpers additively on `_bare` (HRVDex's existing in-repo pattern), in value order: `cvhrFromNN` (apnea-band detector, pure `(nn,tt)`), `perfWindow` (a shipped metric), `evt` (the `ganglior_events` emitter, highest consequence), `magInterfAtSec`. The cost is stated rather than glossed: a DSP change moves `manifestHash` **and** `computeHash`, so it owes a re-bundle and corpus fixture re-verification, and §🔏 requires export-inertness be **computed, not claimed**.

Docs only — no shipped source, no `manifestHash` movement, no fixture re-recorded.
