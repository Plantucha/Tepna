---
bump: minor
type: changed
nodes: [PpgDex]
brief: PPGDEX-ALGORITHM-DEEP-DIVE-2026-07-21-BRIEF.md
---

`correctRR` EXCLUDES a rejected interval instead of replacing it with the running median of the
last 7 accepted. The fill put a fabricated value into `nn`, and it flowed into SDNN, LF/HF,
DFA-α1, SampEn, CVHR, the epochs and `contentId` — roughly 29 % of the exported series at the
correction rate measured on a real degraded night.

`nn`/`tt` are now the kept subset and are SHORTER than the input; `flags` stays input-aligned
(`beat-error-recovery` scores it against per-input labels) and `nDropped` is added. The
`corrected` mask on the PPI export is consequently invariantly zero for PpgDex — the fabrication
it existed to expose no longer occurs.

Punch-list item #2, owner-approved 2026-09-06.
