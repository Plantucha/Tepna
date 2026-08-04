<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PpgDex]
brief: PPGDEX-JITTER-AND-REFERENCE-FOLLOWUPS-2026-08-03-BRIEF.md
---
Withdraw the unreproducible accuracy figure from PpgDex's shipped `sdnnNote` — "~+3.5% vs ECG truth" came from one paired night and re-derives to +10.8%/+18.7% on the multi-night corpus, so the note now states the observed ordering and the guidance without quoting a magnitude.
