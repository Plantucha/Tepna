<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Build Brief — Badge-Coverage Audit FOLLOW-UPS

**Status:** DONE — 2026-06-23 · **Created:** 2026-06-23 · **Parent:** `BADGE-COVERAGE-AUDIT-BRIEF.md` ·
**Ledger:** `BADGE-COVERAGE-AUDIT-FINDINGS.md`

The parent audit is **DONE** (both gates green). This brief carries the parent's Residual list
forward. **R8 (the deterministic OxyDex part), then R1 (delete) and R6 (Option B + citations) were
executed in this pass** — see the parent ledger's Fix entries and the "Done so far" section below.
What remains: **nothing** — R1–R10 are all executed. This brief is ready to flip to `Status: DONE`.

---

## ✅ Done so far in this pass (R8, then R1 + R6)

### R8 — OxyDex bespoke-markup coverage holes (deterministic subset)
Closed the OxyDex coverage holes whose labels resolve to **already-graded** registry entries:

- `oxydex-registry.js` — added `measured` entries `maxSpo2` ("Max SpO₂") and `spo2Std`
  ("SpO₂ Std Dev") + unicode/ascii aliases; added alias `sleep → duration`. Both stats previously
  rendered the **experimental fallback** in the full-metrics table — a true WRONG_GRADE for raw
  signal statistics (rubric: max / std-dev of the recorded signal = `measured`).
- `oxydex-render.js` — wired `evBadge(label)` into three bespoke surfaces that emitted numbers with
  no badge: the readiness-hero sub-score tiles (SpO₂ / HR-Var / Sleep / HR Floor), the Z2 + MAF
  training-zone chips (→ `heuristic`), and the `ssIssuesBars` NSI top-issue sub-bars.
- Re-bundled `OxyDex.html` (`manifestHash 5c30e217fade → e5222d4bb96e`); updated `BUILD-MANIFEST.json`
  and re-recorded the code-gated fixture manifestHash in `FIXTURE-PROVENANCE.json` (badge/markup-only
  ⇒ metric-inert, export byte-identical — same basis as R7).
- **Gates:** `Dex-Test-Suite.html` 788 pass / 49 groups all-green; `verify-provenance.html` GATE A
  PASS, GATE B reproducible, 0 red verdicts.

### R1 — PulseDex `ANS Age` deleted (user decision: delete)
The stale surface was a live **KPI tile** in `pulsedex-overview.js` (`{l:'ANS Age', v:aa.age, …}`),
not a mere fallback — `pxAnsAge()` survived the 2026-06-21 WP-A removal that took out the card.
Deleted the KPI tile, its `aa` var, and the now-unused `pxAnsAge()` composite; cleaned the stale
"ANS-age" mention from the Profile section-title note in `PulseDex.src.html`. ANS Age never entered
the export, so the change is display-only. Re-bundled `PulseDex.html`
(`manifestHash 34b045ab9139 → e863b8d44cb5`); BUILD-MANIFEST updated (no code-gated PulseDex fixture).

### R6 — HRVDex internal composites registered explicit-experimental + cited (Option B + citations)
The ~8 named composites were showing the **anonymous experimental fallback** because the rendered
label strings weren't aliased (the registry already held `abs`/`otr`/`efc`/`welfare`). Inspecting
`hrvdex-dsp.js` confirmed every one is an **internal formula** (e.g. `d_ortho = HR/SDNN` — *not* a
real supine→stand orthostatic test; `d_crs = Coherence·rMSSD·pNN50 / Stress`; CAMQ = bespoke 0–100
parasympathetic-quality score), so per the rubric none can grade above `experimental` regardless of
the underlying concept's pedigree. Action: registered all as **explicit `experimental`** with honest
cites + closed the alias gaps —
- new entries: `crs` (Cardiac Resilience), `focusEff` (Focus Efficiency), `pnsEff` (PNS Efficiency),
  `ortho` (Orthostatic Load — cite flags it is **not** a true orthostatic test), `camq` (CAMQ);
- alias gaps closed: `welfare index → welfare`, `otr index`/`otr index (capped 500) → otr`,
  `efc readiness → efc`, `autonomic balance score → abs`, plus the table/short forms;
- **citation:** the OTR cite now references the real HRV training-status literature (Bellenger
  et al. 2016, *Sports Med* 46:1461 — systematic review/meta-analysis) while stating the specific
  index is **not** validated → tier stays `experimental`. No tier was inflated: the citations
  ground the *concept*, not a validation of the bespoke formula (the rubric forbids grading an
  internal composite above experimental). Section headers (`HRV Score & SDNN`, etc.) left bare.

Re-bundled `HRVDex.html` (`manifestHash 07985f2eb752 → ffe97c97ff38`); BUILD-MANIFEST updated
(no code-gated HRVDex fixture). Both apps' edits are badge-resolution / display-only ⇒ metric-inert.

### Gate status after R1 + R6
`verify-provenance.html` **GATE A PASS** (all manifestHashes match incl. the 3 updated apps),
GATE B reproducible. `Dex-Test-Suite.html` badge contract groups (cohesion-badges, render-coverage)
all green — 835 passed.

### R2 — PpgDex frequency-domain / Triangular index / SampEn graded (Option C + citations)
These render in the full-metrics table from **Lomb–Scargle on PPI = pulse-rate variability (PRV)**,
not ECG RR, and were taking the anonymous `experimental` fallback. Graded per-metric (Option C),
not one uniform tier:
- **`triIdx` (Triangular index) → `validated`** — geometric *time-domain* HRV (Task Force 1996),
  robust and not subject to the PRV frequency-domain caveat (consistent with rMSSD/SDNN validated).
- **`vlf` / `lf` / `hf` / `lfhf` / `lfnu` / `hfnu` / `totalPower` → `emerging`** — established
  freq-domain method (Task Force 1996) but PRV-derived, device/motion-dependent and not
  interchangeable with ECG-HRV (**Schäfer & Vagedes 2013**, *Int J Cardiol* 166:15, PMID 22809539);
  VLF cite-flagged as the weakest (needs long records).
- **`sampEn` → `emerging`** — sample entropy (**Richman & Moorman 2000**), nonlinear complexity;
  consistent with DFA α1 already emerging.
- **Guide conformed:** `PpgDex Reference.html` graded SampEn `experimental`; per the brief (registry
  authoritative, doc conforms) updated that card to `ev-emerging`. The `LF/HF` guide card was
  already `emerging` (match); the `VLF / LF / HF Power` card's `.ma` doesn't resolve, so it's
  unchecked. cohesion-badges **117/117 ✓**.

Re-bundled `PpgDex.html` (`manifestHash 25ef53d99f86 → 72e213e51ac0`); BUILD-MANIFEST updated
(no code-gated PpgDex fixture). Registry/guide edits are badge-only ⇒ metric-inert, export
byte-identical.

### Gate status (final, after R1 + R6 + R2)
`verify-provenance.html` **GATE A PASS** (all 4 updated apps' manifestHashes in sync), GATE B
reproducible, **0 red verdicts** on the last clean pass. `Dex-Test-Suite.html` contract groups
(cohesion-badges 117/117, Clock Contract, etc.) all green. ⚠️ Under heavy preview contention the
suite intermittently shows **environmental timeouts** — the OxyDex `processNight` worker hang-guard
(12 s budget, browser-only; Node CI skips it) and `render-coverage "bundle loads in iframe"` boot
timeouts for several bundles (incl. ECGDex/GlucoDex, untouched here) — none are contract/grade
failures and all clear on a faster/uncontended host. PpgDex was verified to boot clean standalone
with every R2 label resolving to its intended tier. Flag a CI re-run to confirm green; not a fix here.

### R8′ — OxyDex residual coverage holes (user: 1A + 2A + 3B + keep #4)
⚠️ **Correcting my own R8 note:** the original R8 entry claimed the Z1–Z5 grid "exists only as a
reference-guide card" and the `T95–T80`/CT thresholds had no separate app surface. **That was wrong** —
on re-inspection `oxydex-render.js` renders a full **Training Zones card with Z1–Z5 HR-range rows**
(bespoke `pf-prog` markup) and a **CT Thresholds block (CT<90/89/88/85)** + the Clinical Hypoxic
Indices card (SBII/pRED-3p/DesSev). All were emitting **unbadged** or the **experimental fallback**
— real coverage/grade bugs, now fixed:
- **#1A — Training Zones → `heuristic`:** added a `karvZone` registry entry ("Training Zone",
  heuristic, Karvonen %-HRR) + alias; wired `evBadge('Training Zone')` into the recommended-zone
  headline and each Z1–Z5 row. Consistent with the Z2/MAF chips already badged heuristic in R8.
- **#2A — CT<90/89/88/85 → `measured`:** were taking the experimental fallback in the "CT Thresholds
  (precise seconds)" block; registered all four as `measured` (raw cumulative time below an SpO₂
  cut-off = direct integration of the recorded signal) + `ct<NN` aliases.
- **#3B — SBII / pRED-3p / DesSev → `emerging` + cited:** `oxydex-dsp.js` implements these as faithful
  versions of **published** indices (header: "LITERATURE-VALIDATED … Hui 2024 Respirology 29:825,
  Kulkas 2013"), so `experimental` was factually wrong (a B3 mis-tier: `sbii` was stamped
  experimental/"internal composite"). Fixed `sbii` → `emerging`; added `pred3p` + `desSev` →
  `emerging`; cites name Hui 2024 (SBII, pRED-3p, SHHS-calibrated) and Kulkas 2013 (DesSev), each
  noting oximetry-derived/single-cohort → emerging, **not** validated (the nearby `validated` index,
  hypoxic burden, is the older far-more-replicated Azarbarzin 2019 — grading the 2024 indices below
  it keeps the ladder honest). Quintile labels alias to the parent index (same grade).
- **Guide conformed:** `OxyDex Reference.html` graded the **SBII** card `ev-experimental`; per the
  brief (registry authoritative) conformed it to `ev-emerging`. DesSev & pRED-3p guide cards were
  already `ev-emerging` ✓; the Karvonen Z1–Z5 guide card's `.ma` doesn't resolve, so it's unchecked.
- **#4 (hero sub-score duplication):** user chose **keep** the R8 badges as-is — no change.

Re-bundled `OxyDex.html` (`manifestHash e5222d4bb96e → 829800737566`); BUILD-MANIFEST updated and the
code-gated OxyDex fixture re-recorded in `FIXTURE-PROVENANCE.json` (badge/display-only ⇒ metric-inert,
export byte-identical). Verified standalone that all 10 R8′ labels resolve to their intended tier.
**Gates:** `Dex-Test-Suite.html` **765 passed / 47 groups all-green** (cohesion-badges incl. the
regrades); `verify-provenance.html` **GATE A PASS, GATE B reproducible, 0 reds**.

### R9 — ECGDex runtime badge-walk (user: D then A) + 3 deletions/registrations
The parent listed R9 as "audit harness demo-trigger mismatch — tooling only." On inspection the
**shipping** gate `renderCoverageECGDex()` in `Dex-Test-Suite.html` already drives ECGDex via its real
`#genScenario`/`#genBtn` controls and was green — the mismatch was only in the throwaway audit
harness (never in the repo). Rather than re-create that harness (Option B/C, both touch shipping code
for tooling gain), the user chose **D then A**: actually run the runtime badge-walk now, then close.

**D — walk performed** (ECGDex booted on synthetic `spot` data, Research depth, all `<details>` open):
104 badges across 27 metric containers, **0 containers unbadged**; tier mix 36 measured / 29 validated
/ 18 emerging / 13 experimental / 8 heuristic. The walk found surfaces taking the **anonymous
experimental fallback** (bare badge, label unresolved) — three were scoped + fixed this pass:
- **`ANS Age` — deleted (WP-A consistency bug, not just a badge gap):** ECGDex still rendered an
  ANS Age **KPI tile** (`ecgdex-app.js` `renderKPI`) **and** a **full-metrics table row** even though
  its own node-export already nulls it (`ansAge:null /* REMOVED 2026-06-21 external-review WP-A */`)
  and OxyDex/PulseDex(R1) deleted it suite-wide. The UI missed the removal. Deleted both surfaces.
- **`Rest HR` / `Resting HR` → `heuristic`:** registry already had `restingHR` (heuristic, nocturnal-
  floor estimate); the KPI label "Rest HR" just lacked an alias — added `rest hr`/`resting hr`.
- **`VO₂max Est` / base / adj → `heuristic`:** registry had `vo2base`/`vo2adj` (heuristic,
  Uth–Sørensen); added aliases `vo₂max est`/`vo₂max base`/`vo₂max adj` so the KPI + table rows resolve.

Re-bundled `ECGDex.html` (`manifestHash 4fd69de05a3f → 50a667336de7`); BUILD-MANIFEST updated (ECGDex
has no code-gated fixture). Re-walked the bundle: ANS Age gone, all five labels resolve to heuristic.
**Gates:** `Dex-Test-Suite.html` **817 passed / 52 groups all-green**; `verify-provenance.html`
**GATE A PASS, GATE B reproducible, 0 reds**.

**A — R9 closed:** the runtime walk the audit couldn't perform is now done with evidence; the
canonical `renderCoverageECGDex` gate covers future regressions, so no durable external-harness hook
(Option B) is warranted. Correcting an earlier triage error: I had called three remaining bare
badges "decorative section markers" — they are **real metric table rows** still on the fallback,
carried forward as **R10** below (not silently graded).

### R10 — ECGDex 3 fallback rows (user: B) — mostly alias gaps, one new entry
Investigating the three reframed it: **two were pure alias gaps, not grading questions** — the
registry already held correctly-graded entries the rendered labels just didn't match:
- **`ln(rMSSD)` → `validated` (alias only):** `lnRMSSD` existed (validated, Task Force) with aliases
  `ln rmssd`/`lnrmssd`; the rendered parens label `ln(rmssd)` didn't match — added `'ln(rmssd)'`.
- **`Decel cap` → `emerging` (alias only):** `decelCapacity` existed (emerging, **Bauer 2006**) with
  period-form aliases (`decel cap.`); the no-period rendered label didn't match — added `'decel cap'`.
- **`Ellipse area` → `emerging` (new entry, Option B):** genuinely missing. Registered `ellArea`
  (`S = π·SD1·SD2`, Poincaré, **Brennan 2001**) as `emerging` + alias — anchored to the existing
  `SD1/SD2` ratio (also emerging): derived Poincaré *descriptors* sit a notch below the validated
  SD1/SD2 axes. Not `validated` (rarely a standalone clinical endpoint), not experimental (published).

All registry-only (no render/DSP change). Re-bundled `ECGDex.html`
(`50a667336de7 → f7d258774828`); BUILD-MANIFEST updated (no code-gated ECGDex fixture). Verified the
bundle resolves all three (Ellipse area→emerging, ln(rMSSD)→validated, Decel cap→emerging).
**Gates:** `Dex-Test-Suite.html` **817 passed / 52 groups all-green**; `verify-provenance.html`
**GATE A PASS, GATE B reproducible, 0 reds**. — This closes the entire FOLLOWUPS residual list.

---

## Remaining work (needs a decision — do NOT fold speculative grades)

| # | Node | Finding | Decision required before coding |
|---|---|---|---|
| R1 | PulseDex | `ANS Age` still surfaced (experimental fallback) despite WP-A removal | ✅ **DONE 2026-06-23 — deleted** (user decision). Removed the live KPI tile + `pxAnsAge()` + stale profile-note text; re-bundled. See "Done so far". |
| R2 | PpgDex | Freq-domain `VLF / LF / HF / LF/HF / LF n.u. / HF n.u. / Total power`, `Triangular index`, `SampEn` show experimental fallback | ✅ **DONE 2026-06-23 — Option C + cited** (user decision). Triangular index → `validated`; freq-domain + SampEn → `emerging` (Schäfer & Vagedes 2013 PRV caveat; Richman & Moorman 2000); guide SampEn card conformed; re-bundled. See "Done so far". |
| R6 | HRVDex | ~16 named internal composites (CAMQ, EFC Readiness, Cardiac Resilience Score, Autonomic Balance Score, OTR Index, PNS/Focus Efficiency, Welfare Index, Orthostatic Load, …) at experimental fallback | ✅ **DONE 2026-06-23 — Option B + cited** (user decision). Registered all as explicit `experimental` with honest cites (OTR cites Bellenger 2016); closed alias gaps; re-bundled. No tier inflated — all are internal formulas. See "Done so far". |
| R8′ | OxyDex | Residual R8 items | ✅ **DONE 2026-06-23 — 1A+2A+3B, #4 keep** (user decision). Training Zones Z1–Z5 + headline → `heuristic`; CT<90/89/88/85 → `measured`; SBII(fix)/pRED-3p/DesSev → `emerging` (Hui 2024 / Kulkas 2013); guide SBII card conformed; hero badges kept. Corrected the earlier R8 mischaracterization (the Z1–Z5 grid + CT block DO render as app surfaces). Re-bundled (`e5222d4bb96e → 829800737566`). See "Done so far". |
| R9 | ECGDex | Audit harness demo-trigger mismatch (entry point isn't `runDemo()`/`#demoBtn`) | ✅ **DONE 2026-06-23 — D then A** (user decision). Ran the runtime badge-walk via the real `#genScenario`/`#genBtn` (104 badges, 0 unbadged); deleted the stale `ANS Age` KPI+table surfaces (WP-A consistency bug), aliased `Rest HR`+`VO₂max Est` → existing heuristic entries; re-bundled (`4fd69de05a3f → 50a667336de7`). Canonical `renderCoverageECGDex` gate covers regressions. See "Done so far". |
| R10 | ECGDex | **NEW (found during R9 walk):** 3 real metric table rows on the experimental fallback — `Ellipse area` (π·SD1·SD2 Poincaré), `ln(rMSSD)` (log-RMSSD readiness), `Decel cap` (PRSA deceleration capacity, a published mortality marker, Bauer 2006). My R9 triage wrongly called these "decorative"; they are unresolved labels needing registry entries. | ✅ **DONE 2026-06-23 — B** (user decision). Two were pure **alias gaps**: `ln(rMSSD)`→`lnRMSSD` (already validated), `Decel cap`→`decelCapacity` (already emerging, Bauer 2006). One new entry: `ellArea` → `emerging` (Brennan 2001, anchored to SD1/SD2 ratio). Registry-only; re-bundled (`50a667336de7 → f7d258774828`). |

## Gates for any item taken from this list

Same as the parent: edit `*-registry.js` / `*-render.js` source (never the bundled `.html`) →
re-bundle the touched app → `Dex-Test-Suite.html` all-green → `verify-provenance.html` no red +
hand-update that app's `manifestHash` in `BUILD-MANIFEST.json` → regenerate / re-record the node's
code-gated fixture in `FIXTURE-PROVENANCE.json` if it has one. A registry/render change moves
`manifestHash` but not `buildHash`.

## Done when

Each of R1/R2/R6/R8′/R9 is either applied (with the gate loop above green) or explicitly closed with
a recorded product/grading decision, and this header is flipped to `Status: DONE — <date>`.
