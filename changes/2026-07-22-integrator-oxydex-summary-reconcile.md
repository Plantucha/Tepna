<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [Integrator, OxyDex]
brief: INTEGRATOR-OXYDEX-ADAPTER-GAP-2026-07-21-BRIEF.md
---
Reconcile the Integrator's OxyDex summary so the ring's hypoxic burden and its 1 Hz HRV proxies
actually reach fusion. `adaptOxyDex` read `n.hb`, but the exported night renames that key to
`hypoxicBurden` (`oxydex-dsp.js:5712`), so every exported night adapted to `hypoxicBurden: null` —
confirmed on all 7 corpus exports, now 0.9–18 %·min/h. Separately, `rmssd1Hz`/`hrVarSd1Hz` were set
only in the generic normalizer, which no real OxyDex export reaches (`normalizeFile` routes every
OxyDex shape to `adaptOxyDex` — the envelope always carries `nights`, a bare night always carries
`hr_spikes`), so `fuseHrvResource`'s `s.rmssd1Hz != null` guard could never pass and the OXYDEX-PULSE-
RESOURCING §Phase 3 proxy leg was dead on arrival; it now fires on 5 of 7 nights and stays null on the
2 whose source `hrv.rmssd` is genuinely absent — no fabricated value. Both paths now emit an identical
summary, so the shape a payload happens to take no longer decides what fusion sees. The brief's
headline finding — that the envelope bypasses `adaptOxyDex` and loses ODI/SpO₂ — did NOT reproduce
through the real entry point and is recorded as NOT-A-BUG; the live defects were its §2 secondary,
with the branches swapped. 9-assertion regression gate, each guarded by a source-presence check so the
fixture cannot go vacuous.
