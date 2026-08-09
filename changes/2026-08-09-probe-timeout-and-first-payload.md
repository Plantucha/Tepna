<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
The prober hung for 43 minutes on a known non-terminating mutant it should never have selected — fix the control filter, add a real per-mutant timeout, and land the first classifications it produced.

THE HANG. `probe-equivalence.mjs` chose controls as "every in-range mutant that is not a survivor".
A sweep has THREE outcomes, not two: killed, survived, and INVALID — non-terminating or producing no
output. So the invalids landed in the control pool, and `ppgdex-dsp.js:1889 [num → 0] df = 0` — inside
`lombScargle`, one of the sweep's 15 invalids — was picked as a control on the first real run. It spun
43 minutes of CPU at 99.9 % with its log untouched, which is indistinguishable from a slow battery.

Two fixes, because the first is necessary and not sufficient:

  · Controls and survivors now both exclude the sweep's `invalids`. The sweep already knows which
    mutants these are; nothing had to be inferred.
  · Every mutant now runs in a CHILD PROCESS under a timeout (`--probe-timeout`, default 60 s), and a
    hang is its own verdict — never a kill, and above all never an equivalence. A non-terminating
    mutant produces no output, so "byte-identical" would be vacuously TRUE and would emit a
    classification excusing a mutant nobody measured. `vm`'s own timeout bounds only the module load;
    the battery call after it is ordinary synchronous JS and cannot be interrupted in-process. Verified
    by running it: the real L1889 mutant is SIGTERMed at the bound instead of spinning.

This is the rule the brief's own §8 table already carried — "a per-mutant timeout, and a hang is its
own verdict" — from the run_polar pass, where the same class of mutant had burned 79 minutes unnoticed.
It was written down and not implemented.

REFUSAL IS NOW PER-FAMILY, not per-run. A blind, degenerate or uncontrolled family already `continue`s
before its survivor loop, so its verdicts never enter the emit list — the guard is structural.
Refusing the whole run on top of that only withheld verdicts from families whose controls all
separated. The skipped families are named, and their survivors stay UNCLASSIFIED.

FIRST PAYLOAD — `tools/mutate-equivalence.json` now carries a second file:

  lombScargle        12/12 controls separated   15 survivors →  5 distinguishable, 10 recorded
  ppgLoadOwnExport   12/12 controls separated    4 survivors →  4 distinguishable,  0 recorded
  parsePPG           10/11 controls  → BLIND     verdicts withheld, battery needs widening

All 10 entries match a sweep survivor on the documented `(line, op, before)` key, each carries the
battery that produced it, and no DISTINGUISHABLE survivor was emitted — those are debt and stay in
the denominator.

Also measured: `ppgdex-dsp.js` is 451/1187 = 38.0 % (full 1202-mutant sweep, canary NONE), which
replaces the ≈36.5 % the brief carried from adding three commit messages together.
