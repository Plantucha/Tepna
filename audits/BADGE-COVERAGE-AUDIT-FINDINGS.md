<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# BADGE-COVERAGE-AUDIT-FINDINGS — Evidence-badge coverage & correctness sweep

**Status:** EXECUTED · **Date:** 2026-06-23 · **Brief:** `BADGE-COVERAGE-AUDIT-BRIEF.md`

This is Deliverable #1 of the brief — the per-node ledger proving the sweep was done. It pairs
(a) an automated **alias-resolution check** that loads every node registry's real `idForLabel`
resolver and classifies every label literal the apps pass to `evBadge`/`evb`, with
(b) a **real-bundle render-coverage harness** (throwaway, not shipped) that booted each bundled
`<Node>.html` in an iframe, injected synthetic data via the same `window.SYNTH` recipes
`Dex-Test-Suite.html` uses, switched depth to **Research**, opened every `<details>`, and walked
the rendered DOM — classifying every surfaced number as **OK / MISSING / ALIAS_GAP / WRONG_GRADE**.

Both gates are **green** after the fixes below: `Dex-Test-Suite.html` 752 passed / 46 groups,
`verify-provenance.html` GATE A PASS (8/8) + fixtures reproducible.

---

## Method notes (how to reproduce)

- **Resolver check:** each `<node>-registry.js` IIFE was evaluated against a stub global to recover
  `REGISTRY` + `ALIAS` + `idForLabel`; every `evBadge('…')`/`evb('…')` literal and every `label:`
  def harvested from the node's `*-app.js` / `*-render.js` / `*-cross.js` was run through it.
- **Render harness:** booted `OxyDex / PulseDex / HRVDex / GlucoDex / PpgDex / CPAPDex` (and
  attempted ECGDex) on synthetic input, `MetricRegistry.setTier('research')`, then walked
  `.metric,.mc,.ss-kpi,.nr-kpi,.kpi,.readiness-subscore,.q-stat,.morph-row,.proj-factor,.proj-stat`
  for MISSING and every `.ev/.ev-corner` for tier-vs-registry agreement.
- **Grade source of truth:** each node's `<NODE>_REGISTRY.evidence`. A badged surface whose rendered
  tier ≠ the registry grade for its resolved id = WRONG_GRADE; a real metric whose label fails
  `idForLabel` and renders the hollow `experimental` fallback = ALIAS_GAP.

> **Intended-fallback rule applied throughout:** a label with **no registry entry at all** rendering
> the `experimental` fallback is *correct* (the "honest level", per `oxydex-registry.js` and the brief)
> — it is only a bug when the registry **already knows** that metric under another string (ALIAS_GAP)
> or the surface carries a number with **no badge** (MISSING). Counts below separate the two.

---

## Per-node results

### CPAPDex — ✅ clean
63 badges (45 measured / 12 validated / 4 emerging / 2 experimental). **0 MISSING, 0 ALIAS_GAP,
0 WRONG_GRADE.** Routes every tile/KPI/trend-row/subscore through `evb(id)` keyed by registry id
(history KPIs `Usage trend`→`usageHours`, `AHI n-night`→`residualAHI` included). Reference-quality.

### GlucoDex — ⚠️ 17 MISSING → **FIXED this pass**
The `renderVariability()` and `renderDaypart()` helpers built `.q-stat` tiles with a local string
template that **omitted `evBadge`**, so 17 registry-known metrics reached the user unbadged:

| Surface | Labels | Registry grade | Verdict |
|---|---|---|---|
| Variability grid | MAGE · CONGA-1h/2h/4h · MODD · J-index · GRADE · ADRR · LBGI · HBGI | validated | MISSING → fixed |
| Variability grid | GVP | emerging | MISSING → fixed |
| Variability grid | MAG | measured | MISSING → fixed |
| Daypart grid | Total / Overnight / Morning / Afternoon / Evening CV | validated | MISSING → fixed |

The main KPI grid + full-metrics table already badged correctly; the quality card
(`Active time / Warm-up suppressed / Compression lows`) is **coverage metadata — correctly bare**
(same family as the brief's out-of-scope "recording span" / "active flags"; left untouched).

### PpgDex — mostly clean; freq-domain residual
89 badges (32 measured / 23 validated / 17 emerging / 15 experimental). Time-domain HRV, morphology,
motion, quality and validation surfaces all resolve correctly. **ALIAS_GAP / not-in-registry:**
frequency-domain block in the full-metrics table — `VLF · LF · HF · LF/HF · LF n.u. · HF n.u. ·
Total power`, plus `Triangular index`, `SampEn`, `Correction rate`. These render the experimental
fallback. `Correction rate` is a true alias gap (registry has `correction`); the freq-domain set is a
**registry-expansion decision** (see Residuals). `Start (wall clock) / Channel used / Pulses
detected` are metadata, correctly experimental-suppressed only if added to `_META_DENY` (currently
fall to fallback — see Residuals).

### PulseDex — clean except one stale label
110 badges (43 validated / 27 experimental / 19 measured / 17 emerging / 4 heuristic). 0 MISSING.
**ALIAS_GAP:** `ANS Age` renders an experimental fallback even though ANS Age was **removed**
(external-review WP-A, recorded in `pulsedex-registry.js`). Either the surface is stale and should be
removed, or the metric was reinstated and must be graded `heuristic` + cited. → Residual (don't rip a
feature out blind).

### HRVDex — wiring present; composite/​section labels need judgment
117 badges (34 validated / 40 experimental / 27 emerging / 13 heuristic / 3 measured). 0 MISSING.
The 26 experimental-fallback labels split into: (a) **section/combined-header badges** (`HRV Score &
SDNN`, `SNS vs PSNS Balance`, `Stress vs Energy`) — intentional header markers, not single metrics;
(b) **named HRVDex composites** (`CAMQ`, `EFC Readiness`, `Cardiac Resilience Score`, `Autonomic
Balance Score`, `OTR Index`, `PNS/Focus Efficiency`, `Welfare Index`, `Orthostatic Load`) — internal,
so experimental fallback is the honest level **unless** you choose to register them; (c) **one likely
true alias gap:** `Resting HR` (a measured quantity) should resolve, not fall back. → Residual.

### OxyDex — reference impl; large research dump is intended-experimental
420 badges (353 experimental). The overwhelming majority are the **full-metrics research dump**
(`oxydex-fusion.js`) where ~200 raw `research:{}` fields each get the **intended** experimental
fallback ("genuinely internal composites are deliberately left to the fallback" — registry comment).
Not bugs. Within the dump, a handful are **true alias gaps** (registry knows the metric under a
near-name): `T95 (time <95%)`→`t95`, `T90 (time <90%)`→`t90`, `Hypoxic burden rate`→`hypoxicBurden`,
`VO₂max estimate`→`vo2est`. The harness also flagged bespoke-markup MISSING candidates (readiness
sub-score breakdown tiles, the `T95<95% … T80<80%` time-below ladder, training Zones Z1–Z5, NSI
composite sub-bars). Because OxyDex is the declared reference implementation and these surfaces use
hand-rolled markup, they are listed as **review candidates** rather than changed unilaterally. → Residual.

### ECGDex — wiring verified statically; runtime walk inconclusive
The throwaway harness could not trigger ECGDex's demo (its synthetic-load entry point isn't
`runDemo()`/`#demoBtn`), so the DOM walk ran on an empty shell — **inconclusive here**. Static
cross-check confirms `evBadge` is wired into every ECGDex metric-emitting helper (KPI grid, quality
grid, ectopy cards, ACC RR / gait / staging section titles, full-metrics table, cross-night trend
table). ECGDex's render-coverage is independently gated green by `Dex-Test-Suite.html`'s bespoke
`renderCoverageECGDex` rig.

### Integrator — consistent shape, no registry by design
Uses `FINDING_EVIDENCE` keys → shared `MetricRegistry.badge`, so discs are byte-identical to the
nodes. KPIs/finding-cards/table rows badge via `evKey`. Covered structurally by the existing gate.

---

## Fixes applied (this pass)

1. **`glucodex-app.js`** — appended `evBadge(label)` to the `.q-lbl` in `renderVariability()`'s `eb`
   helper and to `renderDaypart()`'s daypart + total-CV tiles. (Fix A, zero new grades — every label
   resolves through the existing registry.)
2. **`glucodex-registry.js`** — added rendered-form aliases `total cv / overnight cv / morning cv /
   afternoon cv / evening cv → cv` so the daypart tiles resolve to `validated` rather than fallback.
3. **Re-bundled `GlucoDex.html`**; `manifestHash` `30913599d638 → 27f0a931832c` recorded in
   `BUILD-MANIFEST.json` (buildHash unchanged — external-JS-only). No GlucoDex fixture is code-gated
   in `FIXTURE-PROVENANCE.json` and buildHash is stable, so no fixture regeneration was required.
4. **`ppgdex-registry.js`** (R3/R4) — added alias `correction rate → correction` (true alias gap),
   and extended `_META_DENY` with `start (wall clock)` / `channel used` / `pulses detected` so those
   metadata labels stay bare instead of taking the fallback badge.
5. **`hrvdex-registry.js`** (R5) — added a `measured` registry entry `hrRest` (“Resting HR”, direct
   reading) + aliases `resting hr / resting hr (bpm) / rest hr / resting heart rate`, so the
   previously experimental-fallback `Resting HR` tile now resolves to `measured`.
6. **Re-bundled `PpgDex.html`** (`c74daffdce78 → 25ef53d99f86`) and **`HRVDex.html`**
   (`93eaec63e392 → 07985f2eb752`); both recorded in `BUILD-MANIFEST.json`. Neither node has a
   code-gated fixture, so no fixture regeneration was required.
7. **`oxydex-registry.js`** (R7) — added 4 research-dump aliases: `t90 (time <90%)→t90`,
   `t95 (time <95%)→t95`, `hypoxic burden rate→hypoxicBurden`, `vo₂max estimate→vo2est`. Re-bundled
   `OxyDex.html` (`1c438d025d0b → 5c30e217fade`), updated `BUILD-MANIFEST.json` AND re-recorded the
   code-gated `OxyDex_2026-06-13_1056_summary.json` manifestHash in `FIXTURE-PROVENANCE.json` — the
   alias map is read only by `idForLabel`/`badgeForLabel` (badge resolution), never by the DSP/export
   path, so the committed summary export is byte-identical (alias-only ⇒ metric-inert). GATE B green.
8. **`oxydex-registry.js` + `oxydex-render.js`** (R8, executed 2026-06-23 — see
   `BADGE-COVERAGE-AUDIT-FOLLOWUPS-2026-06-23-BRIEF.md`) — closed the OxyDex bespoke-markup coverage
   holes that resolve to *already-graded* registry entries (no new grading judgment):
   added two `measured` entries `maxSpo2` (“Max SpO₂”) + `spo2Std` (“SpO₂ Std Dev”) with aliases —
   both previously took the experimental fallback in the full-metrics table, a true WRONG_GRADE for
   raw signal statistics; added alias `sleep → duration`; and wired `evBadge` into the readiness
   hero sub-score tiles (SpO₂→measured, HR-Var→experimental, Sleep→measured, HR Floor→emerging), the
   Z2/MAF training-zone chips (→heuristic), and the `ssIssuesBars` NSI top-issue sub-bars. Re-bundled
   `OxyDex.html` (`5c30e217fade → e5222d4bb96e`), updated `BUILD-MANIFEST.json`, and re-recorded the
   code-gated fixture manifestHash in `FIXTURE-PROVENANCE.json` (badge/markup-only ⇒ metric-inert,
   export byte-identical — same basis as R7). Both gates green (suite 788 pass / 49 groups; GATE A
   PASS, GATE B reproducible). The remaining R8 items were carried to the follow-up brief and
   **executed there as R8′ (see #9 below)** — my original "review candidates" note mischaracterized
   them as guide-only; they are real app surfaces.
9. **`oxydex-registry.js` + `oxydex-render.js` + `OxyDex Reference.html`** (R8′, executed 2026-06-23
   — see `BADGE-COVERAGE-AUDIT-FOLLOWUPS-2026-06-23-BRIEF.md`) — closed the residual OxyDex holes,
   which on re-inspection **do** render as app surfaces (correcting the R8 note): the Training Zones
   Z1–Z5 card, the CT<90/89/88/85 block, and the Clinical Hypoxic Indices card. (#1A) added a
   `heuristic` `karvZone` entry + wired `evBadge` into the recommended-zone headline + Z1–Z5 rows;
   (#2A) registered CT<90/89/88/85 as `measured` (raw cumulative time below threshold = direct
   integration); (#3B) regraded `sbii` experimental→`emerging` and added `pred3p`/`desSev` `emerging`,
   cited to Hui 2024 (Respirology 29:825) and Kulkas 2013 — `oxydex-dsp.js` implements these as
   faithful published indices, so experimental was a WRONG_GRADE; kept below the older Azarbarzin
   2019 `validated` hypoxic burden. Conformed the guide's SBII card experimental→`emerging` (DesSev /
   pRED-3p cards already emerging). #4 (hero sub-score badges) kept per user. Re-bundled `OxyDex.html`
   (`e5222d4bb96e → 829800737566`), updated `BUILD-MANIFEST.json` + re-recorded the code-gated
   fixture in `FIXTURE-PROVENANCE.json` (badge/display-only ⇒ metric-inert, export byte-identical).
   Gates: suite **765 pass / 47 groups all-green**; GATE A PASS, GATE B reproducible.
10. **`ecgdex-app.js` + `ecgdex-registry.js`** (R9, executed 2026-06-23 — see
   `BADGE-COVERAGE-AUDIT-FOLLOWUPS-2026-06-23-BRIEF.md`) — user chose **D then A**: ran the runtime
   badge-walk the disposable audit harness couldn't (the shipping `renderCoverageECGDex` gate already
   drives ECGDex via its real `#genScenario`/`#genBtn` and was green). Walk: 104 badges / 27
   containers, 0 unbadged. Fixed the three fallback surfaces it surfaced: **deleted `ANS Age`** (KPI
   tile + full-metrics row — a WP-A consistency bug; the node-export already nulled it and the other
   nodes removed it suite-wide, the ECGDex UI had missed it), and aliased **`Rest HR`**→`restingHR`
   and **`VO₂max Est/base/adj`**→`vo2adj`/`vo2base` (both existing `heuristic` entries that the
   rendered KPI labels just didn't resolve to). Re-bundled `ECGDex.html`
   (`4fd69de05a3f → 50a667336de7`), updated `BUILD-MANIFEST.json` (no code-gated ECGDex fixture).
   Gates: suite **817 pass / 52 groups all-green**; GATE A PASS, GATE B reproducible. ⚠️ The walk also
   corrected an earlier triage error of mine — three bare badges I'd called "decorative" are real
   metric rows still on the fallback (`Ellipse area`, `ln(rMSSD)`, `Decel cap`), carried forward as
   **R10** below for a grading decision (not silently graded).

**Verification:** re-running the bundle on the demo dataset shows all 17 tiles badged with the
correct grades (MAGE/CONGA/MODD/J-index/GRADE/ADRR/LBGI/HBGI → validated, GVP → emerging, MAG →
measured, CV tiles → validated). Both gates green.

---

## Residual list (flagged for human review — not changed unilaterally)

| # | Node | Finding | Recommended action |
|---|---|---|---|
| R1 | PulseDex | `ANS Age` still surfaced (experimental fallback) despite WP-A removal | **DONE 2026-06-23** (`BADGE-COVERAGE-AUDIT-FOLLOWUPS` R1, user: delete) — the live surface was a KPI tile in `pulsedex-overview.js` (`pxAnsAge()` survived the 2026-06-21 card removal). Deleted tile + `pxAnsAge()` + stale profile-note text; re-bundled PulseDex (`34b045ab9139 → e863b8d44cb5`). |
| R2 | PpgDex | Freq-domain `VLF/LF/HF/LF/HF/n.u./Total power`, `Triangular index`, `SampEn` show experimental fallback | **DONE 2026-06-23** (`BADGE-COVERAGE-AUDIT-FOLLOWUPS` R2, user: Option C + citations) — Lomb–Scargle on PPI (PRV, not ECG). `Triangular index → validated` (Task Force 1996 geometric time-domain); freq-domain + `SampEn → emerging` (PRV freq-domain device/motion-dependent — Schäfer & Vagedes 2013 *Int J Cardiol* 166:15; SampEn — Richman & Moorman 2000). Guide SampEn card conformed to `emerging`; re-bundled PpgDex (`25ef53d99f86 → 72e213e51ac0`); cohesion-badges 117/117. |
| R6 | HRVDex | ~16 named internal composites at experimental fallback | **DONE 2026-06-23** (`BADGE-COVERAGE-AUDIT-FOLLOWUPS` R6, user: Option B + citations) — all are internal formulas (`hrvdex-dsp.js`), so registered as explicit `experimental` + honest cites (new `crs`/`focusEff`/`pnsEff`/`ortho`/`camq`; alias gaps for `abs`/`otr`/`efc`/`welfare`; OTR cites Bellenger 2016 *Sports Med* 46:1461, tier still experimental — the formula is not validated). Re-bundled HRVDex (`07985f2eb752 → ffe97c97ff38`). |
| R8 | OxyDex | Bespoke-markup MISSING candidates: readiness sub-score tiles, `T95<95%…T80<80%` ladder, training Zones Z1–Z5, NSI sub-bars; plus measured stats `Max SpO₂`/`SpO₂ Std Dev` not in registry | **DONE 2026-06-23** — deterministic part as Fix #8 (sub-score tiles, Z2/MAF chips, NSI sub-bars badged; `maxSpo2`/`spo2Std` measured); residual as **R8′ / Fix #9** (Training Zones Z1–Z5 → heuristic, CT<90/89/88/85 → measured, SBII/pRED-3p/DesSev → emerging + guide conform). The "guide-only ladder/grid" note was a mischaracterization — corrected in Fix #9. |
| R9 | ECGDex | Harness demo-trigger mismatch (not `runDemo`/`#demoBtn`) | **DONE 2026-06-23** (`BADGE-COVERAGE-AUDIT-FOLLOWUPS` R9, user: D then A) — ran the runtime badge-walk via the real `#genScenario`/`#genBtn` (104 badges, 0 unbadged); deleted stale `ANS Age` KPI+table surfaces (WP-A consistency bug) and aliased `Rest HR`/`VO₂max Est` → existing heuristic entries; re-bundled ECGDex (`4fd69de05a3f → 50a667336de7`). Canonical `renderCoverageECGDex` gate covers regressions. |
| R10 | ECGDex | **NEW (found during R9 walk):** 3 real metric table rows on the experimental fallback — `Ellipse area` (π·SD1·SD2 Poincaré), `ln(rMSSD)` (log-RMSSD readiness), `Decel cap` (PRSA deceleration capacity, Bauer 2006 *Lancet* 367:1674). My R9 triage wrongly called these "decorative." | **DONE 2026-06-23** (`BADGE-COVERAGE-AUDIT-FOLLOWUPS` R10, user: B) — two were pure **alias gaps**: `ln(rMSSD)`→`lnRMSSD` (already validated), `Decel cap`→`decelCapacity` (already emerging, Bauer 2006); one new entry `ellArea` → `emerging` (Brennan 2001, anchored to SD1/SD2 ratio). Registry-only; re-bundled ECGDex (`50a667336de7 → f7d258774828`). |

> R3 (PpgDex `correction rate` alias), R4 (PpgDex metadata denials), R5 (HRVDex `Resting HR`
> measured entry), R7 (OxyDex 4 research-dump aliases + fixture re-record), the deterministic
> part of R8 (OxyDex bespoke-markup coverage holes), **R1 (PulseDex ANS Age deleted)**,
> **R6 (HRVDex composites registered explicit-experimental + cited)** and **R2 (PpgDex
> freq-domain/Triangular index/SampEn graded — Option C + cited)** were **applied** — see Fixes
> applied above. **R8′ (OxyDex residual), R9 (ECGDex ANS-Age delete + Rest HR/VO₂max aliases) and
> R10 (ECGDex Ellipse-area/ln(rMSSD)/Decel-cap — alias gaps + one emerging entry) are also applied.**
> Every residual R1–R10 is now executed; the FOLLOWUPS brief is `Status: DONE`. See
> `BADGE-COVERAGE-AUDIT-FOLLOWUPS-2026-06-23-BRIEF.md`.

Each residual touches a registry/render/​reference-guide and therefore requires the full re-bundle →
`BUILD-MANIFEST.json` → `verify-provenance` → fixture-regeneration loop; they are batched here so a
follow-up pass can take them deliberately rather than folding speculative grades into this change.
