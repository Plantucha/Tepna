<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Retired fixtures

**Status:** REFERENCE (living) · **last-verified:** 2026-06-28

Data fixtures deliberately removed from `uploads/` (so `verify-provenance.html` no longer
audits them) but preserved here as relics rather than hard-deleted. A fixture lands here when
it can no longer be faithfully regenerated and no live gate needs it.

## `OxyDex_2026-06-17_2042_summary.json`
Retired **2026-06-24** per `SYNTH-TEXTURE-FOLLOWUPS-IV-2026-06-24-BRIEF.md` §2.

- **Why retired (not regenerated):** an unreproducible multi-generation relic. It carried
  pre-`SYNTH-TEXTURE-FOLLOWUPS-III` **head-slice** entropy (`research.hrEnt.sampEn` 0.1369 /
  `Low (regular)`; `research.spo2Ent.spo2SampEn` 0.0738 / `Low(periodic)`) that disagreed with
  the shipped whole-night-**decimation** DSP, **and** a full `ansAge` block that the code dropped
  on 2026-06-21 (external-review WP-A — current exports stamp `ansAge: null`). It was never in
  `FIXTURE-PROVENANCE.json` (legacy buildHash-only audit), so no gate flagged the drift.
- **Why a faithful re-run + re-export was not achievable here:** the fixture's original user
  profile — including `elevation` and `cpap`, which materially shift SpO₂ normal thresholds and
  apnea framing — was never recorded, and `provenance.inputs` fingerprints only the signal CSV
  (`O2Ring S 2100_20260616221235.csv`), not the profile. The live OxyDex bundle runs on the
  operator's **real** `localStorage` profile, so a re-export could neither reproduce the committed
  non-entropy fields (without guessing the lost profile) nor proceed without risking the operator's
  stored health data. The `OxyDex_2026-06-13_1056` fixture already provides current,
  sidecar-gated OxyDex provenance coverage, so no coverage is lost by retiring this one.
- **Reference left intact:** `uploads/integrator_fusion_2026-06-16.json` `inputs[]` still names
  this fixture with its historical `bytes`/`sha256`. That is an **immutable historical fusion
  snapshot** (per `CLAUDE.md` and FOLLOWUPS-IV §3, integrator input fingerprints are historical
  records, not a live gate), so it is deliberately **not** rewritten — it remains an accurate
  record of what was fused on 2026-06-16. The named OxyDex artifact now lives in this folder.

## `cpapdex-multi17-2026-06-16.json`
Retired **2026-06-28** per `CPAPDEX-PHASE9-FOLLOWUPS-2026-06-28-BRIEF.md` §1.

- **Why retired (not regenerated):** a 17-night multi-night CPAPDex export whose source recordings
  were never committed. Its `schema.provenance.inputs` lists ~17 nights of AirSense EDF sets
  (`20260531_204645_*.edf` onward), but `uploads/` holds only the **06-12 / 06-13 / 06-16** sets
  (2 nights). A faithful re-run + re-export is therefore impossible: `exportNight`'s multi-night
  wrapper needs **≥3 nights** and the committed inputs yield only 2, so they cannot reproduce a
  17-night export. Like `OxyDex_2026-06-17_2042`, it was never in `FIXTURE-PROVENANCE.json` (legacy
  buildHash-only audit) and stamped a stale `buildHash` (`c22f274d8cea`).
- **Why not code-gate it in place:** recording it as `code-gated` in `FIXTURE-PROVENANCE.json` would
  assert a reproducibility that isn't true — the very thing the sidecar's “do NOT hand-edit the hash”
  rule forbids. The two genuinely reproducible single-night fixtures it was grouped with
  (`cpapdex-2026-06-12.node-export.json`, `cpapdex-2026-06-16.json`) re-ran **byte-identical** on the
  committed EDF sets and **are** now code-gated.
- **No reference to break:** unlike `cpapdex-2026-06-16.json` (named in `integrator_fusion_2026-06-16.json`
  `inputs[]`), nothing references this file, so moving it dangles nothing.
- **Residual coverage gap:** retiring this removes the only fixture exercising the multi-night
  crossnight export wrapper — tracked in `CPAPDEX-PHASE9-FOLLOWUPS-III-2026-06-28-BRIEF.md` (a future
  deterministic synthetic multi-night golden would restore it).
