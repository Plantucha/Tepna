<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PulseDex]
brief: DEEP-AUDIT-III-2026-07-26-BRIEF.md
---
The Total Power a user actually reads is assembled in pulsedex-app.js, and it took a fourth independent median of per-window `tp` — which does not equal median(vlf)+median(lf)+median(hf), so the surfaced number contradicted the three bands printed beside it and the HF/LF fraction bars drawn from them, by +2.8% to +17.5% on real overnight RR. DEEP-AUDIT-2026-07-14 §3 fixed exactly this and its EXECUTED header claims the fix landed on "BOTH PulseDex spectral paths" — both paths it named are inside the DSP, and the app was never touched. The app now mirrors the DSP line. The identity gate was hollow in the same way (it only ever drove computeResult), so it gains a source scan over pulsedex-app.js: the app's windowing function is not exported and cannot be driven from the node lane, but the scan is enough to stop the two-copies trap from shipping a third time.
