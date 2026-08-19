<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [PulseDex]
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---
24 of the 33 banked pulsedex draft assertions adopted — after a per-mutant re-triage against the
CURRENT suite showed the sweep ledger stale: 5 of the drafts' targets were already killed by the
classifyRecording group (#1475) and 1 draft's recorded value was simply wrong
(`altVO2Factor(null)` returns 1, not the drafted 0.55). The 24 genuinely-surviving targets are now
pinned with physiological inputs (not the probe's): the parseRRInput refusal reasons, the
never-throw guards read from both sides, artifact cleaning on a real 150 ms drop, the full VO₂
ladder (Uth-Sørensen base, ±8 % lnRMSSD clamps, the 1500 m knee and 0.55 floor), the geometric
HRV counters with their strict >50 ms and ±25 ms bands, ansBalance's honest nulls, and the Polar
Sensor Logger multipart merge. Kill-verified by re-applying every mutant: the 29 exact-text
targets all red, plus all 7 boundary/operator VARIANTS at the two lines where the first probe
input proved non-discriminating (a constant series nulls dfaAlpha1 either way; a 150 ms artifact
that also deviates cannot separate `||` from `&&` — the fixed inputs vary where variance is the
signal and agree where agreement is), plus the 2 long-line mutants applied by hand. One target
(the `rising` constant) is left to the next sweep — #1475 already pins rising from both sides.
