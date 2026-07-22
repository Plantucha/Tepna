<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-07-22 · Supersedes: none · Follows: INTEGRATOR-OXYDEX-ADAPTER-GAP-2026-07-21-BRIEF.md

What surfaced while executing `INTEGRATOR-OXYDEX-ADAPTER-GAP-2026-07-21-BRIEF.md` §4.1 that is still owed.
The parent's headline finding was disproven on the real corpus and its two *live* defects (the `n.hb` key
mismatch and the dead `rmssd1Hz` proxy leg) are fixed and gated; everything below is what that work did NOT
close.

## 1 · The parent's §5 is untouched — the Integrator-facing PpgDex **rich** export has no committed golden

Carried over verbatim, still true. The Integrator consumes PpgDex's RICH export (`hrv.time.*`,
`apnea.cvhrIndex`, `recording.site`), but the equiv/GATE-C surface pins only the **light** export
(`compute({text})` → recording + `ganglior_events`). The exact fields the Integrator reads — and the whole
OXYDEX-PULSE-RESOURCING §Phase 2–4 wiring built on them — are exercised only by in-test recompute, so a drift
in the rich export is caught by **no fixture**. Proposal unchanged: commit a rich-export golden + an equiv leg
for the Integrator-facing surface. This is the same class as the parent's own bug — a path nothing pins.

## 2 · `hrv.rmssd` is null on 2 of 7 corpus nights — an OxyDex-side question, not an Integrator one

With the reconcile in place the proxy leg fires on 5 of 7 nights and stays null on
`OxyDex_2026-07-02_2205` and `oxydex-2026-06-12`, because those exports carry `hrv.rmssd: null` at source.
That is honest (never fabricate), but **why** those two nights produce no 1 Hz RMSSD is unexamined — it may be
a legitimate quality gate in `oxydex-dsp.js` or a silent computation failure. Trace the OxyDex side and, if it
is a gate, record the reason in the export so a consumer can tell "gated" from "missing".

## 3 · `hypoxicBurden` was null for the entire life of the field — check for other renamed-on-export keys

The defect was structural: the Integrator read OxyDex's **internal** night key (`n.hb`) while the export
renames it (`oxydex-dsp.js:5712 hypoxicBurden: n.hb`). Nothing detected it because `null` is a plausible
value. That rename is unlikely to be the only one — `adaptOxyDex` also reads `n.odi4`, `n.hrv`, `n.stats`,
`n.desatProfile`, `n.hr_spikes`. **Audit every key `adaptOxyDex` reads against what the export builder
actually emits**, and add an anti-vacuity assertion (source-present ⇒ adapted-non-null) per field, the pattern
the §4.3 gate now uses. A field that is *always* null across the whole corpus should be a RED, not a shrug.

## 4 · The generic normalizer's `node === 'OxyDex'` branch is now unreachable-by-construction

`normalizeFile`'s predicate cannot miss any OxyDex shape, so that branch is dead for OxyDex today. It was left
in place, reconciled and commented, as the fallback for a future payload that fails the predicate. Decide
deliberately: either (a) keep it as the fallback and add a gate asserting the two paths emit an identical
summary for a *hand-built* OxyDex-shaped payload that deliberately lacks `nights`/`hr_spikes`, or (b) delete
it and route unconditionally. Leaving an untested fallback is the third option and the worst one.

## 5 · The `computeHash` re-verification was corpus-local

`DEX_UPLOADS=… node tools/verify-fixtures.mjs` re-stamped `integrator_tch_golden` `verifiedUnder` →
`289ab4da91fe` on the author's machine. The two `integrator_fusion_*` fixtures are `historical: true`
(byte-pinned, not code-gated) so they were correctly exempt — but that also means **no fixture anywhere
re-runs the Integrator's fusion against a real multi-node night**. Same gap as §1, one level up.

## Cross-references
- Parent: `INTEGRATOR-OXYDEX-ADAPTER-GAP-2026-07-21-BRIEF.md` (DONE 2026-07-22).
- Grandparent: `OXYDEX-PULSE-RESOURCING-2026-07-18-BRIEF.md` (DONE 2026-07-20) — §Phase 3 shipped the proxy
  leg this work found dead; its own follow-up (`OXYDEX-PULSE-RESOURCING-FOLLOWUPS-2026-07-20-BRIEF.md`) still
  tracks the corpus-gated `emerging → validated` re-tier.
- Code: `integrator-dsp.js` `adaptOxyDex` summary literal + the generic `node === 'OxyDex'` branch;
  `oxydex-dsp.js:5712` (the `hb` → `hypoxicBurden` export rename).
