<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [Integrator]
brief: DEEP-AUDIT-2026-07-14-BRIEF.md
---
Integrator: stop silently dropping a multi-night CPAP export's entire per-night payload (DEEP-AUDIT-2026-07-14 §2). A CPAPDex ≥3-night Export is a wrapper `{ schema.multiNight:true, nights:[ per-night node-export ] }` with no top-level `recording`/`ganglior_events`/`metrics`. `normalizeFile` unwrapped a `nights[]` wrapper ONLY for `node==='OxyDex'`, so a CPAPDex wrapper fell through to the flat envelope adapter, which read an empty envelope → one date-unknown record, no events, null device-scored AHI (the strongest apnea truth on the bus), `ahiSource` still `'device-scored'`, and NO warning. Fix: unwrap any `schema.multiNight` wrapper generically, per night, so every multi-night emitter is handled like OxyDex — placed AFTER the OxyDex branch so OxyDex keeps its own `nights[]`-aware adapter (OxyDex also sets `schema.multiNight`, so a generic-first unwrap would have regressed it). Gated by a contract assertion driven through `normalizeFile` (a 3-night wrapper → 3 dated records, each with events + non-null device-scored `estAHI`, on three distinct dates), verified RED on the old code first. Re-bundled Integrator + OverDex (which inline integrator-dsp.js); EXPORT-INERT — the Integrator TCH golden reproduces byte-identical (ingest-only change, not in the compute path), `verifiedUnder` re-stamped to the new compute closure.
