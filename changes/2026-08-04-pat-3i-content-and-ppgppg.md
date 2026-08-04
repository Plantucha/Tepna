<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: PAT-UNDER-PERBLOCK-ALIGNMENT-2026-08-02-BRIEF.md
---
Land §3i's brief content (which #881 shipped the code for but not the prose) and add `--ref ppg-ppg`.

**#881 landed a split change.** It shipped `scatterIQRms` into `tools/pat-host-offset.mjs` — including a comment referencing "§3i" — while §3i itself never reached the brief, because the brief edit was made in the shared main checkout and the commit was taken from a worktree. Main therefore carried a field whose explaining section did not exist. This lands §3i and the §3g.3 retraction that goes with it.

**`--ref ppg-ppg`** — PAT = PEP + PTT. The pre-ejection period varies beat-to-beat with contractility and preload, so an ECG→foot interval carries it and a foot→foot interval does not: two peripheral sites **cancel PEP by construction**. §3i locates the blocker as ~84–96 ms of beat-to-beat scatter but cannot say whether it is cardiac or vascular/detector. An arm→finger measurement decides it: if the scatter is PEP it collapses; if it does not move, the looseness is downstream of the heart and dual-site PTT will not rescue PAT either.

`INTEGRATOR-PAT-VASCULAR` §4 proposes the **differenced** form (one R-peak → two feet) as Phase 2; it was parked behind a NO-GO Phase 0 and never measured. This is the **direct** form, which needs no ECG and takes the H10 out of the timing chain entirely. Corpus: **40.6 h across 8 nights** of simultaneous Verity-arm + O2Ring-finger PPG.

⚠ Arm→finger transit is tens of ms, far below `PHYS_LO = 200`, so the un-scanned δ=0 score is meaningless for this pairing — it must be run with `--scan`, which is free to carry the lag into the window. The scatter statistic is an IQR about the modal lag and is unaffected by that shift. Recorded at the constant.
