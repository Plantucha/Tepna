<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: major
type: changed
nodes: [EEGDex]
brief: EEGDEX-STAGE-DEFAULT-2026-11-26-BRIEF.md
---
The fitted stage formula is EEGDex's only stager, and the page carries the one-pass model as inlined
data. The band-power rule set, its five-arm tuning rig and the hypnogram smoother are gone. The four
classes are the formula's own — `wake`, `light`, `deep` and `REM` — so `n1Pct`, `n2Pct` and `n3Pct`
leave the node-export and `lightPct` and `deepPct` take their place. That removes a metric identity,
which is the `major`. Every epoch now carries the posterior of the class it names, the surface names
the model id and the 16-character hash of the file that scored the night, and the strip fits its card
at every page width. The signal's own absence overrules a class, so an epoch holding a seam refuses
and names the hole.
