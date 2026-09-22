---
bump: patch
type: changed
brief: PPGDEX-JITTER-AND-REFERENCE-FOLLOWUPS-2026-08-03-BRIEF.md
---

The Verity PPI-jitter difference between the box corpus and the PSL tree is **not established**: re-run with the same flags on both, bands written first, box n=14 median 5.10 ms vs PSL n=19 median 6.28 ms, Δ −1.18 ms with a 95 % bootstrap CI of [−2.46, +0.44] ms. The CI contains zero, so §6.7's "corpus-dependent" is withdrawn as unsupported; record in `audits/VERITY-JITTER-CORPUS-2026-09-22.json` with the per-night values.
