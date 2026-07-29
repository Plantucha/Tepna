<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [Integrator]
brief: DEEP-AUDIT-FOLLOWUPS-2026-07-12-BRIEF.md
---
Executes `DEEP-AUDIT-FOLLOWUPS` **§C2**. `fuseStagingConsensus` was subtracting two REM fractions that denominate on **different clocks** and calling the result a "REM gap": `integrator-dsp.js:351` divides REM by **total sleep** (ECGDex), `:955` divides by the **recording span** (OxyDex, via `oxydex-dsp computeSleepStageProxy`'s `remSec / n`), and `:3107` differenced them. That is a unit error — the gap it measured was arithmetic, not physiology.

**The section's instruction was "one denominator, named in the export". The corpus says that is unachievable**, and it is the corpus saying it rather than an opinion. Measured over **76 real O2Ring nights** with the shipped `processNight` (trio-batch's emitter ships a reduced export that omits `stageProxy`, so the fold's JSON cannot answer this):

- **Does the mismatched comparison even run?** The OxyDex proxy is suppressed by the §7 plausibility ceiling on **75 of 76** nights. C2 was *latent*, exactly as the section said — and it is worth fixing now precisely because §C3's estimator is being re-derived by a parallel session, and the day it starts producing plausible numbers is the day this starts firing.
- **Could the OxyDex leg be converted onto sleep time?** No. `remProxyPct` reads **66.6–87.6 % of the recording on every single night** — the estimator, not the denominator, is what is broken. Converting to ECGDex's TST is *arithmetically impossible*: 2026-07-02 → **112.1 %**, 06-29 → 106.4 %, 06-25 → 103.0 %, 06-10 → 101.5 %. More REM than there is sleep.
- **Does OxyDex own anything that could serve as a TST?** No. Its only sleep estimate is motion-derived and reads **99.1–99.9 % on every night**, so `sleepEff × recording` is indistinguishable from the raw span: median error vs ECGDex TST **58 min** either way (bias +47, worst 115) against a **335 min** median — a 17 % error, because it counts every still minute as sleep.

**So the fix is fail-closed rather than a chosen denominator.** Each leg declares `summary.remFractionBasis` (`'sleep'` | `'recording'`), and a staging group whose legs disagree about it is **not fused**: it reports `unfusable` naming both bases, with `remGapPct: null` and `disagreement: null`, because neither agreement nor disagreement is knowable across different clocks. Each leg still reports its own fraction, labelled. Legs predating the field are commensurate with each other but not with a declared-different one, so a legacy export cannot silently acquire a basis it never had. This survives whatever the re-derived estimator turns out to be — which "pick a denominator now" would not.

**A test was asserting the defect.** `Integrator staging consensus — REM disagreement threshold (#2)` paired the ECGDex and OxyDex legs and asserted their difference was a "25 pt REM gap". Its threshold coverage was genuine and is kept — moved onto a **same-basis** pair — while the mixed pair now asserts the refusal. Updated deliberately per CLAUDE.md rather than bent to keep it green: 5 assertions → 11.

Integrator re-bundled (`manifestHash b576dface66f → 4b4fb067f293`) plus `docs/` and `OverDex` (which inlines `integrator-dsp.js`). `computeHash` moved `82982029083f → ebd789226368`, so this is a re-verification, not an inertness claim: `DEX_UPLOADS=<corpus> tools/verify-fixtures.mjs` re-ran the app and re-stamped `integrator_tch_golden` → `verifiedUnder: ebd789226368`; **no fixture output moved** (the historical fusion fixtures are byte-pinned snapshots, and no committed fixture carries a mixed-basis staging group). `run-tests.mjs` **4278 green, 0 skipped** against the real corpus, `verify-manifest` GATE A 9/9 + GATE B 13 reproducible, `build --check` clean (11 owned), `tsc` clean.

With this, `DEEP-AUDIT-FOLLOWUPS` has only §C3 (routed to `REM-STAGING-REDESIGN`) and §E2 (version-into-bundle, deferred by policy) left open.
