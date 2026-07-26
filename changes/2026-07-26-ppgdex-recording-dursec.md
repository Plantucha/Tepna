<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [ppgdex]
brief: none
---
PpgDex now stamps `recording.durSec`. It was the one node of three carrying no duration key at all — ECGDex stamps durSec, OxyDex stamps durationMin, PpgDex neither — so without events to bound it the Integrator's adaptEnvelopeNode collapsed its window to zero length at t0Ms and dropped the leg from the fold's overlap intersection. The identical key and the identical reasoning already sit in ecgdex-dsp.js; the fix was applied to ECG and never to PPG. Additive and back-compat, exactly as it was for ECGDex.
