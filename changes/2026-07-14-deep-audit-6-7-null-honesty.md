<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [Integrator, CPAPDex]
brief: DEEP-AUDIT-2026-07-14-BRIEF.md
---
Two batched null-honesty fixes from DEEP-AUDIT-2026-07-14. **§6 (Integrator):** `adaptEnvelopeNode` set `summary.mode = json.recording.sessions[0].mode` — the first session's per-session CPAP label, which CPAPDex deliberately retired (it flipped 7× across 182 real nights; the node forces `metrics.mode=null`). Latent today (no consumer reads it) but a contract landmine that resurrects a value the node chose to null. Fix: honor `json.metrics.mode`. **§7 (CPAPDex):** `periodicBreathingPct` used `durSec>0 ? … : 0` on both sites while its sibling apnea indices (`residualAHI` etc.) return `null` on absence — so a zero-duration session exported a measured-looking `0` beside honestly-null indices (fabricated absence). Fix: `: 0` → `: null` on both. Each gated by an assertion verified RED on the old code first (`§6` returned `'APAP'`; `§7` returned `0`), with controls proving the fix doesn't blank real data. Re-bundled Integrator + OverDex + CPAPDex + the 4 CGM analysis tools that inline the two DSPs. EXPORT-INERT — verified, not asserted: both branches are unreachable by the committed goldens (§6 is ingest-only; §7 needs `durSec===0`), so the Integrator TCH golden + all CPAP goldens reproduce byte-identical and `verifiedUnder` was re-stamped after a green corpus run.
