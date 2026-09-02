<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [oxydex]
brief: DEEP-AUDIT-VI-2026-09-01-BRIEF.md
---
`oxydex-profile.js` is inside the `computeHash` closure again (DEEP-AUDIT-VI F14).

The `manifest-gate.js` DISPLAY_ONLY denylist excluded every per-node `*dex-profile.js` on the claim
that none reaches `compute()` (DEEP-AUDIT-II §12.1). That was verified on the PpgDex side and
generalised; `oxydex-dsp.js` reads `UP.age` / `UP.hrRestOverride` and calls `upVO2category` inside
`compute()` (vo2est + karv), so editing the OxyDex profile's defaults moved the export (age 49→35:
vo2est 50.9→53.9) while `computeHash` held at `f61b09629fa7` — an "export-inert, PROVEN" verdict that
was false, for the one node whose profile feeds a metric.

Fix: `oxydex-profile.js` is removed from the denylist. The five remaining entries are each pinned to a
source scan of their DSP in the `Fixture verification` group (`UP.*` / `*Profile.*` / `up*()`
reach-ins → red), so a future reach-in reds the gate rather than blinding it — pair-verified: the
OxyDex assertion is red on `origin/main`'s `manifest-gate.js`, and a planted `upVO2category(` in
`ppgdex-dsp.js` is caught. `manifest-gate.js` is inlined in no bundle: zero re-bundles, `manifestHash`
unmoved everywhere; OxyDex's fixtures re-derive their `verifiedUnder` under the widened closure via
`tools/verify-fixtures.mjs`. DEEP-AUDIT-II §12.1 amended in place.
