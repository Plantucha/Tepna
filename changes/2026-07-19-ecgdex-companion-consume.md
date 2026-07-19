<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [ecgdex]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
A dropped `_RR / _HR / _ACC` may arrive **before** its ECG, so ECGDex parks it and grafts it onto the next recording that lacks its own. Those parking slots were module-scope globals cleared **only** by `resetAll()`, and the multi-file queue drain never cleared them between recordings — so once night A's companions were parked, **night B inherited them** whenever B's own were absent.

Not a display-only slip: the ACC leg runs `stampEpochPositions` and rewrites `ev.meta.position`, so the **wrong night's accelerometer reaches the export**.

`deviceKey` cannot discriminate here — it is `POLAR_<model>_<id>`, per **device**, so two nights from the same H10 share it exactly. Identity matching would have looked like a fix and changed nothing. The missing rule is **consumption**: a parked companion belongs to one recording, and after it grafts it must not be pending for anything else.

The graft decision is hoisted out of the DOM-mutating handler into a pure `ECGDSP.planCompanionGraft(pending, rec) → { graft, remaining }`, following the same pattern the §RN render-harness work used. That is not cosmetic: in the app it was unreachable by any test, which is how a cross-night leak that reaches the export shipped unnoticed. The handler keeps only the DOM work and the stampless-ACC re-base, then releases whatever was taken.

12 new assertions, mutation-verified: leaving the companions pending reproduces the leak exactly — night B takes night A's RR *and* ACC. Consumption is asserted **per companion** (taking the ACC must not silently drop an untaken RR), a recording with its own companion is asserted not to be overwritten, the parked item is asserted to stay parked for a recording that genuinely lacks one — the out-of-order drop this mechanism exists for — and the function is asserted not to mutate its arguments.

Export-inert — proven: the ECGDex real-corpus equiv fixture re-ran and reproduced byte-identical (`verifiedUnder → 4db27ff2b542`).
