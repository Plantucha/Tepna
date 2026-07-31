<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [Integrator]
brief: CROSS-DEVICE-CLOCK-SKEW-2026-07-29-BRIEF.md
---
`fitClockOffset` broke an exact tie by picking the numerically smaller offset and reported it as *the* answer. A tie is now reported as ambiguous, with the rival named.

## The bug

Clusters are ranked on (distinct nodes → channels → tightness) with a **strict-improvement** comparison, so when nothing separates two clusters the incumbent keeps the win. The incumbent is `scored[0]` — the cluster with the **smallest offset**, because clusters are built from an ascending sort. Deterministic, and completely arbitrary. Worse than obviously random, because it looks like a rule.

**2026-07-30 was exactly this.** Two single-channel clusters, identical on every criterion (1 node, 1 channel, 0 s width):

```
· ECGDex/movement_onset      -21.82 min   [-1323 – -1199 s, n=17]
· ECGDex/autonomic_surge     +74.92 min   [ 4313 –  4585 s, n=13]
```

The fit reported **−21.82** with nothing to indicate a rival **96 minutes away** was equally supported. It won only by sorting first — had the surge landed at −80, that would have "won" instead.

That night was the first clean tri-device night after the ResMed timezone correction, being used to test `CROSS-DEVICE-CLOCK-SKEW` §2b's prediction of *≈ +21 min ahead*. So the arbitrary pick landed almost exactly on the number we were hoping to see. **An arbitrary tie-break is most dangerous precisely when it agrees with you.**

## The fix

A tie is **reported, not broken**:

```
⏱ CPAP clock offset: -21.82 min (-1309 s)  — ⚠ ambiguous — 2 equally-supported
   offsets (-21.82 / 74.92 min); the evidence does not choose between them
```

New fields `ambiguous` and `alternativesSec` (additive — existing readers are unaffected), and **`confident` is forced false on a tie even when the winner carries two corroborating nodes**. That last part is the load-bearing half: "two clusters, each corroborated by two devices" is an ambiguous night, not a measured one, and that is the exact case where the old code returned an arbitrary pick wearing a confidence flag.

Both surfaces lead with it rather than burying it inside "NOT corroborated", since a tie is the stronger claim.

## Tests — 7 assertions, including the controls

The tie shape is planted from the real 2026-07-30 numbers: flagged ambiguous · the rival offset reported rather than hidden · the reason names both · **`confident === false`**. Plus two controls, without which the above would pass on a function that flagged *every* night ambiguous: a lone cluster is not ambiguous and keeps its existing corroboration reason, and the corroborated two-node fit from earlier in the group is still `confident`.

## Provenance

`integrator-dsp.js` is in the compute closure, so its `computeHash` moved and re-verification was **owed and performed** — `DEX_UPLOADS=… tools/verify-fixtures.mjs` re-ran `integrator_tch_golden` off a green suite (`verifiedUnder → 862aee54326d`); the output reproduced, no regeneration needed. The follow-up wording edit touched only `integrator-app.js`, which is outside the closure — `manifestHash` moved, `computeHash` did not, so no second verification was owed and none was claimed.

Gates: suite **4489 passed** / 0 skipped (`DEX_UPLOADS` set, so the equiv legs ran) · GATE A 9/9 · GATE B 13 reproducible · `build --check` clean (11 owned) · biome clean. Re-bundled `Integrator` (`b9c84b59b8fd → b8d899a6645e`) and `OverDex`, plus `docs/Integrator.html`.
