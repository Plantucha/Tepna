---
bump: minor
type: added
brief: REM-STAGING-FOLLOWUPS-2026-08-02-BRIEF.md
---

`nsrr-adapter.js` now emits the **per-epoch expert stage labels** it was already reading and discarding.
`parseNsrrXml` gains `stages[]`, `epochs[]` (30 s grid from recording start), `stageCounts`,
`nSleepEpochs`, `remFrac`, `hasStageLabels`; every pre-existing field is unchanged. Stage recognition is
now code-first (`"<text>|<code>"`, the authoritative NSRR marker) with a narrow text fallback, which also
fixes a latent TST bug: a cohort writing a bare `REM|5` matched neither `STAGE_RE` nor `WAKE_RE`, so REM
fell out of total sleep time and inflated every AHI derived from it.
