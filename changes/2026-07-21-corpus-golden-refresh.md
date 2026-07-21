<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PulseDex, PpgDex, suite]
brief: FIXTURE-VERIFICATION-GATE-2026-07-14-BRIEF.md
---
Refresh the corpus-backed goldens and re-verify the fixture ledger against the real corpus (DEEP-AUDIT-II shared-spine follow-through). Three committed real-recording goldens had gone stale on ADDITIVE export fields with no re-run behind them: PulseDex equiv+events picked up `hrv.time.units`/`windowNote` (§3.5 disclosure) and the PpgDex equiv golden picked up `recording.site` (the integrator finger-PPG resourcing, OXYDEX-PULSE-RESOURCING §2-4) — both invisible in CI because their raw inputs are gitignored, so the equivalence legs SKIP on a fresh clone. Regenerated both through the sanctioned seam (only the additive fields moved — every metric value byte-identical) and added `tools/regen-ppgdex-goldens.mjs`, the regenerator PpgDex lacked (mirroring what DEEP-AUDIT-II §2.1 did for OxyDex). Separately, the clock/LCG/profile spine changes (§12.3/§9.5/§13.2) moved every bundle's compute closure, staling all 14 `verifiedUnder` stamps; `verify-fixtures.mjs` re-ran every fixture against the present corpus and re-stamped them — the reproducibility claim is honest again. No bundle manifestHash moved (build `--check` clean); this is a fixture/provenance-ledger refresh only.
