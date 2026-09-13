---
bump: patch
type: fixed
nodes: [ecgdex]
brief: SHHS-EXTERNAL-VALIDATION-2026-09-04-BRIEF.md
---

`nsrr-stage-validate` compared a stage OBJECT against a stage STRING, so every number it ever
produced was structurally zero.

`ECGDSP.stageSleep` returns `{ tMin, stage, y }`, and `scoreRecord` chose between `res.stages` and a
direct `stageSleep` call — both that shape, so there was no string branch to fall back to. Used as a
label the object stringifies to `[object Object]`, which never equals `'REM'`: REM recall was 0 by
construction and the confusion table keyed every expert stage to one `[object Object]` column.

Measured on real SHHS records before the fix: shhs1-200001/2/3 reported REM recall 0.0 % against
expert REM fractions of 11 / 5 / 10 % — indistinguishable from a stager that never fires. After:
20 / 20 / 40 % recall, 14 / 8 / 15 % precision.

No gate could see it, and the reason is kept in the source: `--selftest` deliberately refuses to
compute recall/precision from synthetic input, because a synthetic record scored by the detector's own
assumptions is the circular oracle `REM-STAGING-FOLLOWUPS` §1 bans. That refusal is correct and
stays — but it meant the one computation that would have exposed this was never exercised in the only
mode that ever ran. A guard against a false POSITIVE created a blind spot for a false NEGATIVE.

The new assertions close it without weakening the refusal: they score the JOIN against PLANTED
labels, which is arithmetic, never the detector. Plant-verified — restoring the raw object reds three
of them and exits 1.
