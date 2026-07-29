<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [CPAPDex]
brief: MULTINIGHT-CORPUS-FINDINGS-FOLLOWUPS-2026-07-29-BRIEF.md
---
`reraIndex` reported **`0.00` on all 197 nights** of the reference corpus — and not because the subject had no respiratory-effort-related arousals. **This device does not score them at all.**

Its `_EVE.edf` vocabulary is exactly `Central Apnea · Hypopnea · Obstructive Apnea · Arousal · Recording starts`. There is no RERA label for `aCount('RE')` to find, ever, on any night. Publishing `0.00` asserts a measurement that was never made — the same fabricated-absence class as the periodic-breathing defect that shipped two hours earlier (`MULTINIGHT-CORPUS-FINDINGS` §1), as `meanPi` before it, and as the sleep-stability subscores before that.

**Unlike §1 there is no better source to switch to**, so the honest report is absence: `reraIndex` is `null` unless at least one RERA annotation was actually seen.

**The trade-off is real and taken deliberately.** On a ResMed model that *does* score RERA, a genuine zero now also reads `null` — that loses a true negative. The alternative asserts a false positive *measurement* on every device that cannot score it at all. Absence of evidence is not a zero, and a consumer can distinguish "no RERAs" from "RERAs not scored" only if the second one says so. The multi-night sibling applies the same rule with more evidence to apply it to: a device that scored a RERA in **any** session of a night is demonstrably capable of it, so a zero across the others is a real measurement.

**Scoped, not blanket** — the committed synthetic golden keeps `reraIndex: 6` because its EVE genuinely contains a RERA, and every sibling apnea index still reports a number on a no-RERA night. The self-test pins both directions: a session *with* a RERA reports the rate, a session *without* reports `null`, and its sibling `residualAHI`/`centralIndex` stay non-null so the null cannot silently widen. `_synthEdfSet({ noRera: true })` models the real AirSense vocabulary — the shape 197 of 197 corpus nights actually have.

**Fixtures.** Three moved, regenerated with `tools/regen-cpap-goldens.mjs`, never hand-edited: `cpapdex-2026-06-12` (`46f7052e63f8fd9f → 27df5bb5385d2219`), `cpapdex-2026-06-16` (`db74bc08096e3798 → c8e6bbf36135a482`) and `cpapdex_synthetic_edf_golden` (`7d10675691463f96 → 60bf2f5e854bd53d`) — each a single field, `metrics.reraIndex: 0 → null`. The two goldens whose EVE carries a RERA are content-unchanged.

CPAPDex re-bundled (`manifestHash d113bfe92d34 → cac61c95ab35`) plus `docs/` and the 4 analysis pages inlining the CPAP modules. `computeHash` moved `5f261a22e140 → 12c574087623`, so this is a re-verification, not an inertness claim: `DEX_UPLOADS=<corpus> tools/verify-fixtures.mjs` re-ran the app and re-stamped all four CPAP fixtures → `verifiedUnder: 12c574087623`. `run-tests.mjs` **4272 green, 0 skipped** against the real corpus, `verify-manifest` GATE A 9/9 + GATE B 15 reproducible, `build --check` clean (11 owned), `tsc` clean.

Closes the third item on `MULTINIGHT-CORPUS-FINDINGS-FOLLOWUPS` §5.
