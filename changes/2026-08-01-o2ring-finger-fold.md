<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [PpgDex]
brief: none
---
`trio-batch` now feeds the **O2Ring's own plethysmogram** to PpgDex, writing a fourth per-night export: **`PpgDexFinger_<date>.node-export.json`**.

`dex-ingest` has always called `Wellue_*_PPG.txt` "PpgDex's legitimate finger PRIMARY", and `ppgdex-registry` already grades finger morphology on its own tier — but the fold never fed it, so every corpus run was Verity-only and the finger site had never been computed at scale. Same node, same code: PpgDex derives the site from the waveform's column count (one reflectance path = finger, three LED columns = wrist), so nothing declares it and a mis-detected site is reported rather than published.

**Three independent interval sources now exist for one night**, and on 2026-07-26 they agree within 2 ms: ECGDex chest ECG **1189 ms** (22,460 beats) · Verity wrist **1188 ms** (22,145) · O2Ring finger **1190 ms** (22,246). The finger's internal fiducial agreement is **100%** against the wrist's 99%.

Wiring it exposed a latent hazard: trio completeness was `filter(f => f.endsWith('.json')).length === 3` — literally "exactly three JSON files exist" — so a fourth export would have made every night read incomplete, re-fold on every run and never write its stamp. Completeness now counts the trio nodes by name (`countTrioExports`). Verified across all 6 box nights: 4 exports each, all stamped, all counted complete.
