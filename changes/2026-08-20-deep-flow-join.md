---
bump: minor
type: added
brief: DEEP-STAGE-DESAT-CONFOUND-2026-07-29-BRIEF.md
---

`tools/deep-flow-join.mjs` — joins ECGDex 5-min `sleepStages` against ResMed `*_EVE.edf` flow events
with a **per-cohort** clock offset, replacing §11a's single global shift (which §11b showed cannot
contain the truth: the ResMed offset steps by an hour mid-corpus). Runs both offset signs and picks
the one under which the two cohorts converge, so the sign convention is measured rather than assumed;
`--sweep` bounds the result over the plausible offset space. Deep contamination lands at **8.6–14.5 %**
against §11a's 26.1 % global-shift worst case. Analysis tool + brief only.
