<!--
  CITATION-INTEGRATION-2026-08-23-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-23 · **Created:** 2026-08-23 · **Follows:** `LITERATURE-USE-POLICY-2026-07-11-BRIEF.md` (the rules this pass obeys), `DEX-CITATION-FORMULA-AUDIT-BRIEF.md` · **Affects:** the four reference guides, `papers/dead-ends.html`, `docs/INTEGRATOR-TCH-REALDATA-VALIDATION-2026-07-06.md`, `audits/CITATION-VERIFICATION-2026-08-05.json` (+7 records), two briefs' anchor indexes — **no code, no formulas, no tier changes**

# Citation integration — 14 owner-supplied candidates, verified and routed

The owner supplied 14 pre-verified candidate papers for integration. Every one was **re-verified
independently against PubMed and Crossref** (metadata identity, not DOI resolution — §6 of the task),
deduplicated against the whole tree, and added ONLY where an existing Tepna claim is directly
supported. No evidence tier moved; no formula changed; no new citation convention invented. Every DOI
added to a gated surface (reference guides, `papers/**`, `docs/**.md`) has a matching
`CITATION-VERIFICATION` record (`_count` 96 → 103) and passes the `citation-ledger` group.

## Audit trail (task §15)

| # | Paper (verified) | Verified | In Tepna? | Action | Location & supported claim |
|---|---|---|---|---|---|
| CPAP-01 | Ni & Thomas 2022, JCSM 18(4):1121–34, `10.5664/jcsm.9814`, PMID 34886948 | ✅ PubMed+Crossref | absent | **ADD** | CPAPDex Reference — warning box ("machine-reported events… may differ from manual scoring") + refs table. Supports: substantial, sustained (~10/h, 12 mo) machine-vs-manual gap. |
| CPAP-02 | Reiter 2016, JCSM 12(8):1153–8, `10.5664/jcsm.6056`, PMID 27166303 | ✅ | absent | **ADD** | CPAPDex Reference — same box + table. Supports the guide's "tend to undercount": automated AHIflow 4.4/h vs manually rescored 7.3/h. |
| CPAP-03 | Richter 2024 (review), Curr Opin Pulm Med 30(6):589–92, `10.1097/MCP.0000000000001113`, PMID 39115392 | ✅ | absent | **ADD** | CPAPDex Reference — review support for AHI_FLOW framing + device-vs-PSG variability. Review, so background only (task §12). |
| CPAP-04 | Richter 2023, Sleep Breath 27(4):1639–50, `10.1007/s11325-022-02740-w` (Crossref issued 2022) | ✅ | absent | **ADD, scope-limited** | CPAPDex Reference — single device (Löwenstein prismaLine, manufacturer co-author): obstructive residual AHI r=0.968, central hypopneas r=0.153. Cited WITH the scope note (task §13); Tepna's corpus is ResMed — this does not validate it. |
| PPG/PRV-01 | Kantrowitz 2025, Front Physiol 16:1630032, `10.3389/fphys.2025.1630032`, PMID 40809286 | ✅ | **present as a MIS-ATTRIBUTION** — "Kass 2025 (N=931)" in `docs/INTEGRATOR-TCH-REALDATA-VALIDATION` §9 + policy anchor index; the author list has no Kass | **CORRECT + ADD** | Name fixed in both places (documented in the policy brief, not silently — task §5). Added: PpgDex Reference PRV≠HRV box + table; `papers/dead-ends.html` §2.1 (with the design-difference caveat — their chest/bicep rest protocol ≠ our overnight wrist corpus, magnitudes not transferable). Industry authorship (5/9 at device maker) noted here. |
| PPG/PRV-02 | Peláez-Coca 2022, IEEE JBHI 26(2):539–49, `10.1109/JBHI.2021.3099208` | ✅ | **present** — `PPGDEX-ALGORITHM-DEEP-DIVE` §fiducials + ledger `:272` | **KEEP EXISTING** | Already cited exactly where the repo makes sampling-rate/fiducial claims; sufficient attribution. |
| PPG-03 | Charlton 2023 roadmap, Physiol Meas 44(11):111001, `10.1088/1361-6579/acead2` | ✅ | absent (4 OTHER Charlton papers present — easy to confuse) | **ANCHOR-INDEX ONLY** | Policy brief §4 anchor line, marked "field background, not claim-level support." Every wearable-PPG quality claim in the repo is internally measured (dead-ends §2.2, SQI formulas); decorating them with a roadmap is exactly the task's §3-BAD pattern. No gated-surface add. |
| HRV-01 | Quigley 2024, Psychophysiology 61(9):e14604, `10.1111/psyp.14604`, PMID 38873876 | ✅ (authors resolved: Quigley KS et al.) | absent | **ADD** | HRVDex Reference refs table, labeled "2024 update to Task Force 1996." Task Force 1996 remains the tier anchor for rMSSD/SDNN/LF:HF — no retiering (task §8). |
| PAT-01 | Liang 2019, J Clin Med 8(3):337, `10.3390/jcm8030337`, PMID 30862031 | ✅ | absent (only Liang & Elgendi **2018**, a different paper) | **ADD** | `papers/dead-ends.html` §2.7 (sync-prerequisite wall) + `PAT-VERDICT-CONSOLIDATED` §5b. NOT added to `pat-align.js` — that file's comment deliberately keeps DOIs in the brief (its own recorded policy), and a comment edit to an inlined module moves `manifestHash` for zero behavioural value. |
| BP-01 | Cohen JB et al. / AHA statement, Hypertension 83(3):e00254 (online 2025-12-11), `10.1161/HYP.0000000000000254`, PMID 41376592 | ✅ **with correction** — task metadata said "83:876-886"; PubMed/Crossref say e-locator e00254. e00254 recorded. | absent | **ADD (briefs only)** | `PAT-VERDICT-CONSOLIDATED` §5b + policy anchor index, as external authority for the WP-A cuffless-BP removals. No reader-facing surface makes a cuffless-BP claim (all refusals are code-side), so no gated-surface add — a citation with no claim to support is decoration. |
| OXY-01 | Azarbarzin 2019, Eur Heart J 40(14):1149–57, `10.1093/eurheartj/ehy624`, PMID 30376054 | ✅ | **present** — OxyDex Reference `:2143` + ledger (year "2018" = Crossref issued, within ±1) | **KEEP EXISTING** | Already the anchor for the Hypoxic Load card and the naming-caution that keeps the internal fixed-94% `hypoxicBurden` at `experimental` (FINDING 8). Sufficient. |
| OXY-02 | Azarbarzin 2019, Eur Heart J 40(35):2989–90, `10.1093/eurheartj/ehz274`, PMID 31071210 | ✅ — **but it is a 2-page COMMENT** (correspondence, no abstract), not a research paper | absent | **REJECT** | The task presented it as a paper; PubMed's article type is `Comment`. The concept it defends (HB vs generic T90) is already carried by OXY-01, the primary source (task §12: prefer primary). Marginal value does not justify a gated-surface citation whose reader would expect a study. |
| GLUCOSE-01 | Battelino 2019, Diabetes Care 42(8):1593–603, `10.2337/dci19-0028`, PMID 31177185 | ✅ | **present** — GlucoDex Reference `:685` + ledger `:438` | **KEEP + one wiring fix** | The `REFERENCE-GUIDE-AUDIT-FINDINGS:555` residue: the TIR ">70%" and %Active "≥70%/14d" cards claimed "consensus" with no in-card attribution — "(Battelino 2019)" author-year added in both cards (existing citation wired in, no new DOI). |
| GLUCOSE-02 | Bergenstal 2018, Diabetes Care 41(11):2275–80, `10.2337/dc18-1581`, PMID 30224348 | ✅ | **present** — guide `:687`, registry `glucodex-registry.js:56`, ledger `:433` | **KEEP EXISTING** | GMI formula + lab-A1c distinction already cited and already tier-correct (`gmiVsLab` is separately `experimental`). |

## What was deliberately NOT done

- **No `*.js` edits at all** — every candidate code-comment site (`pat-align.js`, cpapdex-fusion,
  profile refusals) either already routes DOIs to a brief by its own recorded policy, or a comment
  edit would move an inlined module's `manifestHash` and trigger the full rebuild/fixture chain for
  zero behavioural change.
- **No tier changes** (task §8): `hypoxicBurden`/`hypoxicLoad` stay `experimental`; nothing was
  promoted for having a neighbour in the literature.
- **No formula changes** (task §9).
- **OXY-02 rejected**, with the reason recorded above rather than silently dropped.

## Verification

- All 14 re-verified against PubMed (metadata identity: title/author/journal/year/PMID) and the 7 new
  ledger records against Crossref `issued` (the ledger's own `_resolver` convention).
- `citation-ledger` + `docs-ledger` groups green locally on this tree; `tools/build-docs.mjs` re-run
  for the served copies of the four guides + `dead-ends.html`.
- Cross-node note for future work: the ECGDex CPC/CVHR validations correlate against **device-scored**
  residual AHI (`ecgdex-registry.js:200-243`), so CPAP-01/02's accuracy bounds qualify those
  validation claims — recorded here, not acted on (it is an evidence-notes change owned by that node).
