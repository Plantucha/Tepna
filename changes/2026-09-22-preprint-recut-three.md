---
bump: patch
type: fixed
brief: none
---

Preprint re-cut, owner ruling D9.1 (2026-09-21), one run: `odi4-ahi-bias` Tables 3–4 and coverage re-scored on all 5136 SHHS1 records under the corrected adapter (OX-stat masking + computeStats over measured seconds) — every number moved by the pre-stated rule, the "not undercounting desaturations" sentence corrected (median ratio 0.897 → 0.657) — plus the NSRR T90 / mean SpO₂ shift measured on the cohort, and `acc-respiratory-rate`'s cohort description (26 nights/172 h → 14 scored of 49 paired, 71.5 h) re-cut under dated correction blocks with 39 sourced CLAIMs against two committed `analysis/published-numbers/` records; the sourced-CLAIM scanner now reads `papers/*.html`; `tools/odi4-shhs-recut.mjs` new, `resp-acc-headless.mjs` writes the record; the ODI scorer and adapter carry t90/meanSpo2/t95 per record.
