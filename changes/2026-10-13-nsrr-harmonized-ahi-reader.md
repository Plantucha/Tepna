---
bump: patch
type: fixed
brief: AHI-SURROGATE-REFIT-SIZING-2026-10-12-BRIEF.md
---

Read the four harmonized `nsrr_ahi_*` columns, each named from the NSRR data dictionary. Key every row by its visit, so a pooled file cannot hand one night's AHI to another. Honour quoted fields, which a free-text column ahead of the AHI columns makes load-bearing. Stamp each scored row with its exact column name.
