---
bump: minor
type: added
brief: COHORT-GEN-2.0-PAPER-RERUN-2026-09-15-BRIEF.md
---

`analysis-rerun --cohort-gen` runs a tool against an old generator, which settles what the generator
actually caused — and for `qrs-yield` the answer is **almost nothing**.

#2575 found `qrs-yield` diverging from its published values in ways no cohort-shape refit could
produce, and refused to re-cut it. This is the control that separates the two candidate causes:

```
old-vs-published = tool drift since publication
new-vs-old       = the generator, and only the generator
```

## Measured — PPG arm, `nSubj: 400`

| | published | **@1.9** | @2.0 |
|---|---|---|---|
| true beats | 189,179 | **189,179** | 189,213 |
| recall (all) | 96.4 % | 96.09 % | 96.09 % |
| **precision** | **88.8 %** | **98.79 %** | **98.80 %** |
| **SQI apnea** | **0.78** | **0.977** | **0.977** |
| **rMSSD bias** | **+83.0 %** | **−10.4 %** | **−10.4 %** |

**`trueBeats` at 1.9 reproduces the published 189,179 exactly** — a positive control that the swap
really does restore the published cohort, without which none of the rest would be interpretable.

**Every large movement is tool drift.** Precision moves **10 points** between publication and 1.9, and
**0.01** between 1.9 and 2.0. The rMSSD sign flip is entirely pre-generator. The generator's whole
contribution is +34 beats and −0.2 pp of apnea recall.

So #2575's refusal was right: re-cutting would have published a sign-flipped bias under a heading
blaming cohort-gen 2.0 for it.

## ⚠️ This control is now owed by `nights-icc` too

`nights-icc` was re-cut (#2557) attributing ODI-4's ICC 0.75 → 0.92 to the generator's AHI-ceiling
change. That attribution is **plausible and documented** — the paper's own revision note describes the
mechanism, and rMSSD/CGM-CV did not move — but it has **not** been separated from tool drift by this
control. It should be, and the run is 35 minutes.

## How the swap is made safe

The tools **inline** `cohort-gen.js`, into their blob workers as well as the page, so a runtime global
override cannot reach the code that generates the cohort. The swap has to be on-disk plus a rebuild —
so it **refuses on a dirty tree**, because a crash would otherwise leave a foreign generator in place
and `git status` is what makes that visible. Restore runs on the normal path and on `SIGINT`/`SIGTERM`,
and the tool is rebuilt back against the repo generator afterwards, with a warning if the tree does not
come back clean.

34 assertions, including both directions of the dirty-tree guard exercised against a scratch repo.
