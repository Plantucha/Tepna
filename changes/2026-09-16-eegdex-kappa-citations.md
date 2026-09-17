<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [EEGDex]
brief: LITERATURE-USE-POLICY-2026-07-11-BRIEF.md
---

`eegdex-dsp.js` justified its staging ceiling — and its leak heuristic, that scoring 0.8 would be
evidence of a leak rather than quality — on two uncited kappa ranges. The human ceiling those ranges
gesture at is now a cited, checkable measurement: Arnal et al. 2020 scored 25 subjects with a headband
and with PSG, and five human experts on the same records averaged 86.4 percent against the device's
83.5. The uncited kappa ranges are kept but marked as orientation rather than authority, and the note
states that Arnal reports accuracy and F1 rather than kappa so the two are not read on one scale.
