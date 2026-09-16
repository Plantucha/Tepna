---
bump: patch
type: changed
brief: COHORT-GEN-2.0-PAPER-RERUN-2026-09-15-BRIEF.md
---

The re-cut brief now **requires** the 1.9 A/B before any delta may be attributed to the generator, and
its per-paper table records measured state instead of my original predictions.

## The rule

A re-cut reporting a change "under cohort-gen 2.0" credits the generator with everything the *tool* has
changed since publication. That has now happened twice, once in this brief's own output:

| tool | published | @1.9 | @2.0 | generator's share |
|---|---|---|---|---|
| `qrs-yield` precision | 88.8 % | 98.79 % | 98.80 % | **0.01 pp of a 10 pp move** |
| `qrs-yield` rMSSD bias | +83.0 % | −10.4 % | −10.4 % | **none — the sign flip is pre-generator** |
| `nights-icc` ODI-4 ICC₁ | 0.75 | 0.9228 | 0.9238 | **0.0010 of a 0.17 move** |

`nights-icc` was re-cut attributing its reversal to the AHI ceiling (#2557) and that was **wrong**
(#2578). The reasoning had a mechanism, a citation in the paper's own revision note, and passing
controls — rMSSD and CGM-CV did not move, exactly as predicted. **Confirming evidence that is real
does not make the inference sound.** Only running the old generator separates the causes, and it costs
one run.

A positive control comes free and must be read: at 1.9 the structural counts should reproduce the
paper's, and they do — `qrs-yield` trueBeats **189,179** exactly, `nights-icc` subjects **5,394**
exactly. If they don't, the swap or configuration is wrong and nothing downstream is interpretable.

Done-when gains step 0, scoped so it isn't busywork: only papers whose numbers **moved** owe the A/B.
A paper reporting unchanged values carries no causal claim to be wrong about.

## The `expect` column is deleted, not updated

It predicted *"no change — cohort-wide"* for `nights-icc` and was refuted on its first test. The split
it encoded — cohort-wide vs severity-dependent — is not the one that governs. What governs is the
**kind of statistic**: a variance ratio moves with the severe tail; full-cohort slopes, correlations
and rates do not. And even that predicts only the **generator's** share; tool drift is a separate term
and is frequently the larger one.

Replacing a wrong prediction with a better prediction would have repeated the error in a subtler form.
The table now carries what was **measured**, per paper, with the PR that measured it — including the
two that are blocked and why.
