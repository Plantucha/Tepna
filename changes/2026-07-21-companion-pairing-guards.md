<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [ECGDex, PpgDex]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
Guard companion pairing against wrong-night sidecars (DEEP-AUDIT-II §10.2/§10.3): `DexIngest.pickNearestByStamp` (the app-side ECG/PPG pick) and the orchestrator `pairCompanions` no longer score a null/unparseable filename stamp as epoch 0, and reject a candidate more than a day from the primary — so a 5-day-old ACC can't render a green "98.3% Agreement" or silently change which beats reach the HRV numbers. With §10.5 (fnameStampMs anchor) already landed, #18 is complete; the locked "single-candidate/epoch-0" test is updated to the corrected contract.
