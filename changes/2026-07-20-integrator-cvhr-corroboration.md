<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [PpgDex, Integrator]
brief: OXYDEX-PULSE-RESOURCING-2026-07-18-BRIEF.md
---
CVHR from the finger waveform, corroborated and source-named (§Phase 4, the brief's final phase).
**PpgDex** now computes a whole-record **CVHR** (cyclic variation of heart rate, Hayano — the autonomic
cardiac correlate of apnea) from its corrected finger-PPI NN series via `cvhrFromNN`, a faithful port of
the audited ECGDex `detectCVHR` (same apnea-band 20–45 s moving-average band-pass, envelope gate, and
dip→rebound events/hour index). It exports it under `apnea.cvhrIndex` (rich export only — the light
export and its committed golden stay byte-identical). The **Integrator** `fuseCvhrCorroboration` publishes
that finger-PPI CVHR — named, tier **`emerging`** — when a `site:'finger'` PpgDex and an OxyDex (the
O2Ring night) are both present, and corroborates it against any other node's cardiac CVHR (ECGDex
`summary.cvhrIndex`), reporting the per-hour gap and agree/diverge, **never averaging**. Per the §3.1(b)
owner decision it publishes **no AHI** (`ahiPublished:false`, `ahiOwner:'OxyDex.ahiEst'`) — the O2Ring's
own `ahiEst` stays the single published AHI. `cvhrIndex` 0 (none detected) is a real reading, accepted not
nulled. READ-ONLY: attach-only-when-present keeps Integrator fixtures byte-identical, and the PB-consensus
`_pbObserver` is untouched (a distinct `cvhrIndexWave` summary field). Tier is `emerging` pending a
real-corpus PSG/PulseDex comparison. 32-assertion gate.
