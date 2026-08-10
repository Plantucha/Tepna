<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [PpgDex]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
Bootstrap cvhrFromNN — the largest zero-kill function in the fleet, and the one the brief filed as a
project rather than a battery.

57 surviving mutants and not one kill, so the equivalence prober could return no verdict on any of
them: with no killed mutant in the same function there is no positive control, and "0 % killed" and
"100 % equivalent" are the same picture.

It is not exported — it is called once from deep inside analyze() — so reaching it needs a synthetic
PPG that survives channel ranking, beat detection, SQI and RR correction while carrying a controlled
apnea-band oscillation. That sounded expensive and is about twenty lines: an actual pulse with the
instantaneous rate modulated by a slow sine. The previous fixtures were linear ramps, which is why
nothing downstream of beat detection had ever been exercised.

11 assertions, 1.2 s. Measured by re-applying all 57 survivors: 9 killed. The conversion is modest
and the unlock is not — cvhrFromNN now HAS controls, so the prober can reach a verdict on the other
48 where before it could say nothing about any of them.

The sharpest catch is the short-record refusal: a mutant made a 90-second recording report
cvhrIndex 80.8 with 2 events, fabricating apnea from a record too short to resolve any. Clock Contract
§2.6 in a different register — a value you do not have is null, never invented.

The negation is load-bearing: an index that is always zero and one that is never zero are the same
measurement, so the flat-HR case is what makes the modulated ones mean anything.
