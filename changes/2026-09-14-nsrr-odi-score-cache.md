<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: []
brief: RESIDUE.md
---

`nsrr-oxydex-odi.mjs` enumerated the corpus once at startup and rescored every record from scratch on
every run, so a run launched mid-download could never include later arrivals and picking them up meant
paying for everything again. Per-record scores are now cached and reused. The key carries a
fingerprint of the six sources the scoring realm loads, not just the record's size: this caches
SCORES rather than extracted signal, so a change to the detector must discard the cache instead of
silently serving pre-change numbers. Measured on three real records — 11.31 s cold, 0.02 s warm with
byte-identical output, and 11.08 s again after touching `oxydex-dsp.js`.
