<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS — 2026-08-01 · **Created:** 2026-07-22 · Supersedes: none · Follows: INTEGRATOR-OXYDEX-ADAPTER-GAP-2026-07-21-BRIEF.md · **§2 ANSWERED 2026-08-01** — it was neither of the two hypotheses

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

## 2 · `hrv.rmssd` is null on 2 of 7 corpus nights — **ANSWERED 2026-08-01: the exports are STALE**

> *Original text: "it may be a legitimate quality gate in `oxydex-dsp.js` or a silent computation failure.
> Trace the OxyDex side and, if it is a gate, record the reason in the export so a consumer can tell
> 'gated' from 'missing'."*

**It is neither hypothesis, and the third option is worse than both.** The two nights differ from each
other, and only one of them is about HRV at all:

**`OxyDex_2026-07-02_2205_summary.json` — a stale export.** It carries `hrv: null` with
`artifact.hrSamplesCleaned: 22083` on a 368-minute night, i.e. essentially **every** HR sample flagged as
artifact, which empties `computeHRV`'s `motion === 0 && !hrArtifact` filter and trips its `n < 120` floor.
So a gate did fire — but re-running **today's** code on the very file that export NAMES
(`nights[0].file` = `O2Ring S 2100_20260702220521.csv`) gives:

| field | in the export | recomputed today |
|---|---|---|
| `hrv.rmssd` | `null` | **0.5** |
| `hrv.n` | `null` | **22013** |
| `stats.minSpo2` | 84 | **87** |
| `stats.durationMin` | 368.4 | 368 |

The export was generated **2026-07-03** and never regenerated after the code that produced it changed.
`t0Ms` also moves by exactly **25 s**, consistent with a `trimSensorWarmup` difference — plausibly the same
change that stopped the artifact cleaner condemning the whole night, though **which commit fixed it is not
established here** and should not be asserted.

Note `minSpo2` 84 → 87: the staleness is not confined to a null. A consumer reading that export sees a
nadir **3 points lower** than the current code computes.

**`oxydex-2026-06-12.summary.json` — a different export SHAPE, not a null value.** Its keys are
`kernel date t0Ms stats odi4 hypoxicBurden comp ganglior_events` — there is no `hrv` field at all, and no
`file` naming its input. It is a reduced/legacy summary, so "`hrv.rmssd` is null" is really "this shape
never carried HRV". Lumping it with the first night hid two unrelated causes under one symptom.

### 2.1 · So the ask changes: not a reason field, a staleness check

Recording "gated" vs "missing" in the export would have been the right fix for the hypothesis, and the
wrong fix for the fact. A reason field cannot help here — the export's `hrv: null` was *correct when
written*; what a consumer cannot tell is that it was written by code that no longer exists.

**`tools/oxydex-export-staleness.mjs`** (committed with this) re-runs OxyDex on each export's own named
source and reports every field that no longer reproduces. It is possible only because each night records
`file` — the tool never guesses a pairing — and it exits 1, so a corpus run can gate on it.

**The class matters more than the two nights.** `GATE B` content-addresses the *committed* fixtures, so
those cannot rot unseen. These `uploads/` exports are **gitignored working artifacts** that corpus
analyses and the Integrator read directly — outside every gate. Any analysis consuming them inherits
whatever the code did on the day they were written, silently. That is the same shape as
`PAPER-ODI4-REPRODUCIBILITY`'s finding one floor down: an unpinned input behind a computed claim.

### 2.2 · What is still owed

- The stale export is a **gitignored working file belonging to whoever generated it** — regenerating it is
  a local action and was NOT done here (§👥.2: don't step on another session's artifacts). Whoever owns
  the corpus should re-run it; the tool says which.
- Wire the staleness check into the corpus-run path, so a stale input reds before an analysis reads it.
- 7 of 8 exports in `uploads/` were skipped because their named source is not on disk. The check is only
  as good as the raw files present, and it says so rather than reporting a clean sweep.

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
