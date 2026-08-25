---
bump: patch
type: added
brief: OXYII-DAT-AUTO-HARVEST-REFINEMENT-2026-08-24-BRIEF.md
---

Emit the VERIFYING ledger row (§23's T3, last byte received) after the .part write, only when the
transfer is complete. Previously T3 and T4 shared the classify row's single `at`, so T4 - T3 —
whether verification costs anything — was not merely unknown but uncomputable.
