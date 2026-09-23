---
bump: patch
type: fixed
brief: none
---
A night whose motion channel was condemned as stuck rendered **"null%" badged good**. `oxydex-dsp.js:2796` has long set `stats.motionPct = null` deliberately — with a comment explaining that a reader must be able to tell "the sensor lied" from "this build predates the field" — and records WHICH fault in `stats.motionColumnAbsent`. The render never migrated: it string-concatenated that null into `null%`, then graded it, and `null < 0.5` is TRUE, so the fault reported itself as the absence of a fault. The card now shows `—` with no severity class and a sub-label NAMING the fault ("no motion column in this file" vs "motion column condemned as stuck"), which also gives `motionColumnAbsent` its first consumer — the DSP has been distinguishing the two causes and nothing ever read it. The two CSV sites write an empty cell instead of the text `null`. `oxydex-fusion.js:877` was checked and left alone: `_oxyFmt`/`_oxySev` already return `—` and no severity for null, so it was correct already.
