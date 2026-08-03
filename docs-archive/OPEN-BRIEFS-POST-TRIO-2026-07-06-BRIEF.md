<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living open-brief snapshot) · **Created:** 2026-07-06 · **last-verified:** 2026-07-06

# Open briefs after the tri-device σ experiment (2026-07-06 snapshot)

> A point-in-time map of what is still open after this session (real tri-device σ validation + the two σ-tools'
> folder-ingestion upgrade). `DOCS-INDEX.md` is the authoritative at-a-glance table; this is the narrative
> "what's next" view. Re-derive from `grep "Status:.*\(PROPOSED\|IN-PROGRESS\)" briefs/` — do not trust this
> snapshot blindly once briefs move.

## Spawned by this experiment (new — PROPOSED)
- **`SIGMA-PAPER-REWRITE-2026-07-06-BRIEF.md`** — rewrite sigma-no-reference paper + index on the raw-ECG
  10-night corpus; reconcile the noisy-corner reordering (Verity↔O2Ring).
- **`TRIO-METHODS-REUSE-2026-07-06-BRIEF.md`** — apply the reusable patterns (worker-DSP shim, folder ingest,
  quality gate) + capture-provenance facts across the suite.

## Advanced this session
- **`INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-III-2026-07-06-BRIEF.md`** — IN-PROGRESS. §1 **premise validated**
  on real data (write-up `docs/INTEGRATOR-TCH-REALDATA-VALIDATION-2026-07-06.md`). Still open: §1 end-to-end
  ρ-vs-classic A/B through the Integrator's own `fuseHRVConsensus`; §4 N-cornered (blocked on EEGDex).
- **`CONTROLLED-RELEASES-FOLLOWUPS-2026-07-05-BRIEF.md`** — flipped DONE this session (F8 hard gate; F1 re-deferred).

## Standing open (environment/policy-blocked — not design-blocked)
- **`DEV-TOOLCHAIN-2026-06-30-BRIEF.md`** — IN-PROGRESS. Part A complete (A1–A4); Part B (Biome formatter, needs
  binary + on-touch re-bundle) and Part C (widen `tsconfig`, needs `node tsc`) blocked here.
- **`OWN-THE-BUILD-FOLLOWUPS-2026-07-03-BRIEF.md`** — IN-PROGRESS. §5 Part C remaining render/app/profile files
  (on-touch re-bundle); D.2 (needs `node tsc`); D.3 (Prettier, rides fleet churn).
- **`REPO-DISCOVERABILITY-2026-07-03-BRIEF.md`** + **`-FOLLOWUPS-2026-07-04`** — IN-PROGRESS; asset-gated / off-repo
  items deferred.

## Proposed / not started
- **`HEALTH-BOX-VISION-2026-07-01`**, **`CAPTURE-HOST-2026-06-29`** — product/hardware (Tepna Vigil bedside box).
- **`PAPERS-ROADMAP-2026-06-24`** — forward paper agenda.
- **`SYNTH-TEXTURE-PAPERS-RERUN-2026-06-24`** — PROPOSED, blocked-by its parent SYNTH-TEXTURE brief.
- **`DEX-PILL-UNIFY-2026-06-24`** — PROPOSED, consciously deferred (optional CSS polish, needs a re-bundle).

## How this experiment could seed more work
The real tri-device corpus + folder-ingestion tooling unblocks several `PAPERS-ROADMAP` real-validation items
(multi-vendor HRV agreement, longitudinal σ drift) and the Integrator decorrelation-gate robustness idea
(`TRIO-METHODS-REUSE` §Do 3). EEGDex remains the gate on the N-cornered hat + EEG-anchored validation.
