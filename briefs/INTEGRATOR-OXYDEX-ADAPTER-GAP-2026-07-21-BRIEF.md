<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-07-21

Surfaced while executing `OXYDEX-PULSE-RESOURCING-2026-07-18-BRIEF.md` (§Phase 2 debugging). Wiring
`pulseHr1Hz` onto the OxyDex fusion leg forced a trace of *which* Integrator adapter path a real OxyDex
export takes — and it takes the wrong one. This is a suspected **live correctness bug** in the Integrator's
OxyDex ingestion, unrelated to the pulse-resourcing validation debt (which is tracked separately in
`OXYDEX-PULSE-RESOURCING-FOLLOWUPS-2026-07-20-BRIEF.md`).

## 1 · The finding

OxyDex exports the **`ganglior.node-export` envelope** schema (`oxydex-dsp.js:397`, `:5571` —
`json.schema.name === 'ganglior.node-export'`, a single-night `{date, stats, …}` object or a
`{nights:[…]}` wrapper). When that envelope reaches the Integrator, `adaptEnvelopeNode` handles it in the
**generic normalizer** (`integrator-dsp.js:239–907`) and `return recs` at **line 907** — *before* the
legacy `try{}` at line 976 that routes to `adaptOxyDex`. So for the current export format, **`adaptOxyDex`
never runs.**

The two paths extract **different, non-overlapping** OxyDex summaries:

| Field | `adaptOxyDex` (rich, line ~852) | generic normalizer OxyDex branch (line 525) |
|---|---|---|
| `odi4` | ✅ | ❌ |
| `minSpo2` / `meanSpo2` | ✅ | ❌ |
| `hypoxicBurden` | ✅ | ❌ |
| `desatCount` | ✅ | ❌ |
| `durationMin` | ✅ | ❌ |
| synthesized `desat_event` / `autonomic_arousal` events | ✅ | ❌ |
| `pulseHr1Hz` | ✅ | ✅ (added OXYDEX-PULSE-RESOURCING §Phase 2) |
| `rmssd1Hz` / `hrVarSd1Hz` | ❌ | ✅ (added §Phase 3) |

**Evidence (reproducible):** adapt the committed synthetic golden through the real
`adaptEnvelopeNode(oxydexGolden, 'OxyDex', …)` and the resulting rec's `summary` has **exactly 3 keys** —
`pulseHr1Hz, rmssd1Hz, hrVarSd1Hz` — and `nEvents: 0`. No `odi4`, no `meanSpo2`, no `hypoxicBurden`, no
desat events. `grep 'summary\.(odi4|meanSpo2|hypoxicBurden|desatCount) =' integrator-dsp.js` → **zero
matches** (only `adaptOxyDex`'s object-literal sets them, and it is unreachable for the envelope).

## 2 · Why it matters (severity — to be quantified in §4)

OxyDex is the fleet's **oximetry** node. If its ODI / SpO₂ / hypoxic-burden / desaturation events don't
reach the summary, then every cross-node consumer that reads them is running with a **crippled OxyDex
leg** for the canonical export — e.g. the periodic-breathing observer (`_pbObserver`, OxyDex "SpO₂
oscillation" channel), desat-event apnea corroboration, any ODI/AHI cross-check, staging/HRV consensus
that unions OxyDex. The suite's fusion tests use this same synthetic golden, so **they may be green
precisely because OxyDex contributes nothing** — a test-integrity concern, not just a runtime one.

Secondary: this brief's own parent left an **inconsistency** between the two paths — `rmssd1Hz`/`hrVarSd1Hz`
were added only to the generic branch, `pulseHr1Hz` to both — so a legacy-array OxyDex export would fire
`fusePulseCrossCheck` but not `fuseHrvResource`. Reconciling the paths fixes that for free.

## 3 · Root-cause hypothesis

The SIGNAL-ADAPTER / node-export-envelope migration (see `OXYDEX-NODE-EXPORT-ENVELOPE-FOLLOWUPS-V`) moved
OxyDex onto the envelope schema and added the generic normalizer, but **never ported `adaptOxyDex`'s rich
OxyDex extraction into it** (or never routed envelope OxyDex back to `adaptOxyDex`). `adaptOxyDex` was left
as legacy-shape handling and silently stopped running.

## 4 · What to do (owner decision needed on the fix shape)

1. **Verify on a REAL OxyDex export**, not only the synthetic golden: adapt a real `.node-export.json` and
   confirm the summary is missing ODI/SpO₂/hypoxic-burden/desat events. Quantify which fusion outputs
   actually change once OxyDex carries them (diff the fusion export before/after on a real multi-node night).
2. **Fix (pick one):**
   - **(a) Port** `adaptOxyDex`'s summary + desat/arousal event synthesis into the generic normalizer's
     `node === 'OxyDex'` branch (read `stats`/`desatProfile`/`hr_spikes` from the envelope). Keeps one
     entry path; the richest.
   - **(b) Route** a schema'd OxyDex envelope to `adaptOxyDex` (which already handles a single `{date,
     stats}` object via `nights=[json]`) instead of the generic branch. Smallest diff; reuses audited code.
   - Reconcile so **both** paths emit an identical OxyDex summary (fixes the §2 `rmssd1Hz` inconsistency).
3. **Regression gate:** assert the adapted OxyDex summary carries `odi4` + `meanSpo2` + `hypoxicBurden`
   (and ≥1 desat event when `desatProfile` has one). This would have caught the gap and pins the fix.
4. **Fixtures:** any real change to what OxyDex contributes will move the Integrator **fusion** fixtures
   (currently gitignored-input, GATE-B-skipped) — regenerate + record; note `computeHash` movement.

## 5 · Related test-coverage gap (same class — decide whether to fold in)

The Integrator consumes the PpgDex **RICH** export (`hrv.time.*`, `apnea.cvhrIndex`, `recording.site`),
but the equiv/GATE-C surface pins only the **LIGHT** export (`compute({text})` — recording +
ganglior_events). So the exact fields the Integrator reads from PpgDex (and the §Phase 2–4 wiring on them)
have **no committed-golden coverage** — they are exercised only by in-test recompute. A drift in the rich
export would be caught by no fixture. Consider a committed rich-export golden + equiv leg for the
Integrator-facing surface.

## Cross-references
- Parent: `OXYDEX-PULSE-RESOURCING-2026-07-18-BRIEF.md` (DONE 2026-07-20) — where the trace surfaced.
- Suspected origin: `OXYDEX-NODE-EXPORT-ENVELOPE-FOLLOWUPS-V-2026-06-30-BRIEF.md` (the envelope migration).
- Code: `integrator-dsp.js` generic normalizer (`node === 'OxyDex'` @525, `return recs` @907) vs
  `adaptOxyDex` (@976, rich summary @~852); `oxydex-dsp.js:397/5571` (OxyDex emits the envelope schema).
