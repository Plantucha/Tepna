<!-- SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living — last-verified 2026-10-20) · **Created:** 2026-10-20

# The JS mutation lane pays 2.3x on CI, and one of its two bounds never learned that

The residue row `2026-10-19-js-lane-cap-margin-unmeasured` says the JS diff-mutation job's margin
rests on a factor from another lane. #3202 measured 1.53x, on capture-host CLEAN RUNS alone, and
`memory/mutation-gate-fixed-cost-per-glob.md` already records that the same lane's WHOLE gate costs
2.4–2.8x. Nobody had measured the JS lane. This brief measures it over one population that CI and the
rig both ran, and records the factor beside the capture-host one.

## 1 · What I measured

| leg | detail |
|---|---|
| CI | run `39375213486`, 2026-10-20T05:30:02Z, PR #3745 head `daf6cc2a2`, job 1506 s, `--jobs 3` |
| rig leg 1 | same head, same `--diff origin/main`, `--jobs 3`, box load 0.9–1.7, wall 648 s |
| rig leg 2 | the identical command 11 min later on the same box, wall 615 s |
| population | 26 mutants on 73 changed lines in 5 files — identical on both legs |
| CI history | 63 completed runs of `.github/workflows/mutation.yml`, 2026-10-20 02:35Z → 06:04Z |

The population reproduces because `--diff <base>` is three-dot, so it reads the MERGE BASE. Main
advancing after the run does not move it.

## 2 · The whole-gate factor is 2.3x

| phase | CI | rig leg 1 | rig leg 2 | factor |
|---|---|---|---|---|
| per-file calibration, 5 files | 552.9 s | 253.9 s | 252.5 s | **2.18x** |
| per-mutant loops, 3 files | 846 s | 361 s | — | **2.34x** |
| the job | **1506 s** | **648 s** | **615 s** | **2.32x – 2.45x** |

The borrowed 1.53x predicts 991 s for this population. CI spent 1506 s, 52 % over that prediction.
The JS lane lands where the capture-host whole-gate figure already sat, not where its clean-run ratio
sat.

The two rig legs price the same population within 5 %, and their calibration sums agree within 0.6 %.
**The cost reproduces. §6 shows that the verdict does not.**

**Sizing rule, the analogue of the capture-host one:** rig seconds x 2.4 against the 2520 s step cap.
Break-even is 1050 rig seconds.

## 3 · Where the money goes: the clean run, once per file

| file | mutants | CI calibration | CI loop | rig calibration | rig loop |
|---|---|---|---|---|---|
| `adapters/polar-sense-ppg.js` | 0 | 12.7 s | — | 5.3 s | — |
| `ecgdex-app.js` | 4 | 15.0 s | 33 s | 6.4 s | 12 s |
| `ecgdex-dsp.js` | 3 | **406.6 s** | 300 s | 184.7 s | 194 s |
| `ppgdex-app.js` | 0 | 14.9 s | — | 10.7 s | — |
| `ppgdex-dsp.js` | 19 of 20 | 103.7 s | 513 s | 46.8 s | 155 s |

Calibration is 37 % of the CI job. Two of the five files carry ZERO mutants and still pay 27.6 s,
because the calibration run precedes the scope check. One file, `ecgdex-dsp.js`, holds 3 mutants and
74 % of the calibration bill. The capture-host lane's lesson transfers intact: size a diff by the
FILES it touches, never by its mutant count.

## 4 · The margin, measured

62 of the 63 runs finish at or under 83 s, median 42 s, because most PRs change no mutable JS and the
gate exits early. The 63rd is the run above: 1506 s, which is 60 % of the 42-minute step cap and 56 %
of the owner's 45-minute job cap. Headroom 1014 s.

⚠️ NOT claimed: that the cap is safe. `ecgdex-dsp.js` alone bills 407 CI seconds before a mutant
runs, so a diff touching four comparable DSP files spends its calibration budget and meets the cap
with the loops still ahead of it. The 2.3x factor prices that diff; nobody has run one.

## 5 · THE FINDING — one bound scales with the file, the other does not

`tools/mutate.mjs` runs each mutant under two bounds:

- the elapsed timeout, `Math.max(30000, baseMs * 5)` at `tools/mutate.mjs:1363` — it scales with the
  file's own calibrated clean run;
- the no-progress quarantine, `QUARANTINE_MS` at `tools/mutate.mjs:167` — a FIXED 300 000 ms, and the
  workflow passes no `--quarantine-timeout`.

On `ecgdex-dsp.js` the CI calibration is 406.6 s. The fixed silence bound is 74 % of the file's own
clean run, so it binds first for every mutant the suite does not fail early. The elapsed timeout for
that file was 2033 s and never came into it.

**What that cost, measured on this population.** CI quarantined `ecgdex-dsp.js:6901`
`[bool && → ||]` and published `UNKNOWN` over `checked: 25, eligible: 26, excluded: 1`. BOTH rig legs
decided the same mutant on the same bytes: it **SURVIVED**, and each published `FAIL` over
`checked: 26, eligible: 26`. The quarantine turned a reproducible survivor into "unmeasured", and the
gate reported doubt about a mutant that had the same answer twice.

Logged as residue `2026-10-20-the-no-progress-bound-is-shorter-than-the-clean-run-it-guards`. The remedy shape,
untested: derive the quarantine bound from `baseMs`, as the elapsed timeout already does, so a
jammed mutant still reads as jammed on a file whose clean run is long.

**The quarantined mutant was equivalent, and the bound finding stands** (Wren, board #440,
2026-10-20). `input` is never null at that site. A string input hands ECG text to `parseEcgRuns`,
which yields no spans, so nothing reads `runsSidecar`; the site refuses an object input earlier.
Flipping `&&` to `||` therefore moves no output. Wren removed the dead `input &&` guard on
`claude/sidecar-wrn` at `28000c3e4`. The bound above does not move: CI reported doubt where two legs
agreed, and it would have reported the same doubt about a mutant that changed an answer.

## 6 · THE SECOND FINDING — three verdicts did not reproduce

All three legs decided the same 19 mutants on `ppgdex-dsp.js`, with an identical line-and-operator
composition. Each leg named a DIFFERENT survivor:

| leg | survivor on `ppgdex-dsp.js` | killed |
|---|---|---|
| CI, run `39375213486` | `:3560` `[bool || → &&]` AND `:3787` `[cmp < → <=]` | 17 |
| rig leg 1 | `:3560` `[cmp < → <=]` | 18 |
| rig leg 2, same box, 11 min later | `:3787` `[cmp < → <=]` | 18 |

Three mutants take turns, and no leg repeats another's set. Two legs ran on ONE machine minutes
apart, so this is not a slow-runner effect. Every leg reports the same headline — 6 survivors of 26 —
which is how a survivor SET moves while the rate holds still. **A kill rate is not a survivor list,
and one run is one sample of this gate's survivor set.**

⚠️ Mechanism unknown, and I did not chase it here. Candidates: a flaky assertion in the covering
group; state shared between the three hard-linked worker trees; and the timeout path at
`tools/mutate.mjs:869`, which scores a mutant KILLED when its run dies after emitting assertion
output. Logged as residue `2026-10-20-the-js-gate-survivor-set-does-not-reproduce-across-runs`.

## 7 · Not claimed

- One population, one CI run, two rig legs. A factor measured once is not a constant of the lane.
- The rig ran near-idle at load 0.9–1.7. The runner's own contention is invisible from here.
- The 63-run window is 3 h 29 min, which is what the API returns for this repo's traffic. It says
  nothing about last week.
- The CI leg carries no coverage map and the rig leg carries one, unapplied. Selection is opt-in
  (`--use-coverage-map`), so neither leg used it.

## 8 · How to re-measure

```sh
gh run download <run-id> -D /tmp/ci-leg               # mutation-diff.ndjson carries calibrationMs per file
git worktree add --detach ../wt-meas <that run's head sha>
node tools/mutate.mjs --diff origin/main --jobs 3 --json > rig.ndjson 2> rig.log
```

Read `calibrationMs` from both ndjson files, the per-file `elapsed` lines from both logs, and the job
duration from `/repos/{owner}/{repo}/actions/runs/{id}/jobs`. Pin `--jobs 3`: the rig's `defaultJobs`
returns 16 on 24 cores, and the runner's returns 3.
