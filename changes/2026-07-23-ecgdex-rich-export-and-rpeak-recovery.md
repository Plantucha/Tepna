<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [ECGDex]
brief: none
---
ECGDex orchestrate rich node-export now carries the apnea + hrvStability blocks the Integrator reads (json.apnea.{cvhrIndex,estimatedAHI}, json.hrvStability.mean_lnRMSSD_slope), mirroring ecgdex-app.js buildV2 field-for-field — so a nocturnal ECG no longer fuses differently by ingest route (⬇JSON button vs raw-file→OverDex); and R-peak detection recovers from a SHARP opening transient that is the first threshold crossing (the stall-recovery bleed no longer requires an established cadence, so a transient-as-beat-#1 that parked SPKI can no longer kill detection for the whole record). Export-inert for the committed LIGHT equiv fixtures (both changes touch only the rich branch / clean-record-identical detection); the ECGDex synthetic golden is byte-identical.
