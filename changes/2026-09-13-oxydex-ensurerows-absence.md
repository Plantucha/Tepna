<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [OxyDex]
brief: none
---
Stop `_oxyEnsureRows` re-fabricating the absent-motion zero `parseCSV` deliberately writes as null — `motion: r.motion || 0` reintroduced "the body never moved" (motionPct 1.8→0, sleepEff 98.2→100, stability 22→35) for every row reaching OxyDex as a SignalFrame, a rows array or a self-ingested export, and the same line silently dropped `pi` so `meanPi` could never see a perfusion reading on that path.
