<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [Integrator]
brief: OXYDEX-PULSE-RESOURCING-2026-07-18-BRIEF.md
---
The Integrator re-sources the O2Ring's HRV (§Phase 3, read-only). OxyDex's own `rmssd`/`hrVarSd` are
derived from its **smoothed 1 Hz pulse RATE** — the registry confesses it (*"1 Hz pulse-rate RMSSD proxy
— not RR-interval HRV"*). When a `site:'finger'` PpgDex capture (the ring's own single-channel pleth) is
on the bus, `fuseHrvResource` publishes that node's **whole-record waveform HRV** (real RR-interval
RMSSD + `sdnnRobust`, in **ms**) as the honest, resourced value that **supersedes** the 1 Hz proxy, and
carries the proxy alongside (in **bpm**) for continuity. The two are **different units** (ms vs bpm), so
they are never averaged — a first-order bridge (`δinterval ≈ 60000/HR²·δrate`) flags only gross
order-of-magnitude disagreement, with the waveform always the reference. Tier is **`emerging`, not
`validated`**: the brief grants `validated` only once the finger path is shown to reproduce the audited
PulseDex HRV path on the real corpus (release-time work). READ-ONLY — OxyDex keeps its 1 Hz proxies as
the single-signal fallback for nights with no finger capture; nothing existing moves. The block attaches
to the fusion export only when both legs are present, so every night without the pair stays
byte-identical (Integrator fixtures unchanged). The Integrator now reads `hrv.time.rmssd`/`sdnnRobust`
(PpgDex) and `hrv.rmssd`/`hrSdnn` (OxyDex) into its per-node summaries. 33-assertion gate.
