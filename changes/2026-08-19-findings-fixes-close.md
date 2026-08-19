<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: FINDINGS-AND-FIXES-BRIEF.md
---
`FINDINGS-AND-FIXES` (the June-era audit compilation) flipped IN-PROGRESS → DONE by verification.
Four of its open sections were finished by later work that never marked them here:

- **§4** worker-pool conversions — `bootPool` + `cohort-worker` now in `treatment-response-analysis.js`,
  `nights-icc-analysis.js`, and the qrs tools (the brief still listed them "to convert");
- **§5** the ETA/rate-persist pattern is in 6 analysis tools;
- **§8** checkpoint/resume is BUILT — IndexedDB checkpoint + auto-resume + single-instance lock in all
  four long tools, exactly the lift-from-cohort-runner it proposed;
- **§7** aged out — it reasons from the retired `buildHash`, and its action completed with the June pass.

§9's paper-state table is superseded by the later paper briefs. **§6 DEFERRED** (sanctioned form): the
one surviving generator artifact is measured, degenerate, bounded to 3 of 10 cohort-gen papers, and
deliberately unfixed because `cohort-gen.js` sits in 5 bundles — the edit moves 5 manifestHashes +
`computeHash` + re-verification. `cohort-gen.js` untouched since the 2026-08-04 measurement, so the
park still describes reality.
