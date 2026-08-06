<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [integrator]
brief: DEEP-AUDIT-V-2026-08-04-BRIEF.md
---
The longitudinal store is keyed `node|date` where the date comes from the recording's START, so a 00:01 bedtime keys to the FOLLOWING date and overwrites that night — unconditionally and silently. Measured on 25 real nights per node: 50 rows supplied, 49 stored, OxyDex 24 series against ECGDex 25, and 2026-06-27 absent from OxyDex entirely — one real night destroyed and the same-night cross-node pairing lost, while the UI reported "absorbed 25 (persisted)" because it counted rows SUPPLIED rather than rows STORED. The count now reflects what the store actually holds, `supplied` keeps the old number alongside it, and every overwritten night is returned in `collisions` (with the lost `t0Ms` and source file) and warned to the console. The date convention itself — a SCOPED post-midnight shift, since a blanket noon anchor would re-date ambulatory sessions — plus the IndexedDB re-key and store-version bump are deliberately NOT in this change and remain open in the brief; this is the half that makes the loss visible instead of silent, which the brief calls out as worth landing on its own.
