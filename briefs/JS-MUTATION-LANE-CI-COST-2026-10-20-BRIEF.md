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
| CI history, widened | the last 400 runs of the same workflow, 2026-10-18 02:21Z → 2026-10-20 07:32Z (§4b) |
| the capped run | run `39162011567`, PR #3638, job 2568 s, conclusion `failure` (§7) |
| the calibration-bound run | run `39132925025`, PR #3629, 1662 s, 38 files calibrated, 2 mutants (§3) |
| rig leg 3 | the capped run's own bytes, `--diff 599fd7ba`, `--limit 25 --jobs 3`, wall 797 s (§7) |
| rig legs 4–5 | one 26-mutant population at 3 then 12 jobs, 856 s and 377 s (§7b) |

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

**A second CI run makes the FILE the whole bill.** Run `39132925025` on `claude/unused-vars-k9u`,
2026-10-18, spent 1659 s to test **two** mutants. It calibrated **38 files for 895 s** — 54 % of the
job — at a mean of 23.6 s and a worst of 397 s, while 17 further files refused before calibrating,
because the suite tags no group for them. Both mutants survived, so the gate published `FAIL` over
`checked: 2` having spent more than half its budget on clean runs. By mutant count a lint sweep over
134 changed lines is the cheapest diff this gate can see, and by file count it is among the dearest.

## 4 · The margin, measured

62 of the 63 runs finish at or under 83 s, median 42 s, because most PRs change no mutable JS and the
gate exits early. The 63rd is the run above: 1506 s, which is 60 % of the 42-minute step cap and 56 %
of the owner's 45-minute job cap. Headroom 1014 s.

⚠️ NOT claimed: that the cap is safe. `ecgdex-dsp.js` alone bills 407 CI seconds before a mutant
runs, so a diff touching four comparable DSP files spends its calibration budget and meets the cap
with the loops still ahead of it. The 2.3x factor prices that diff; nobody has run one.

### 4b · The window was too short, and the cap has already been exceeded

§4 reads 63 runs. The last 400, from 2026-10-18 02:21Z to 2026-10-20 07:32Z, carry a heavier tail:
399 reached a conclusion, median 53 s and p90 232 s, five of them at or above 1750 s. **Exactly one of
the 399 ends `failure`, and it is the cap** — run `39162011567` on `claude/oxycharts-k9c`, PR #3638,
2026-10-18, whose job ran 2568 s and whose `Diff-scoped mutation` step is the one that failed. The
Actions log names it: `The action 'Diff-scoped mutation' has timed out after 42 minutes.`

So §4's "NOT claimed: that the cap is safe" has its answer, and the answer is no. The cap stopped a
real diff two days before this brief existed. §7 measures what that diff asked for.

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

**A bound on this finding, measured since** (§7b's two legs). On `oxydex-dsp.js` the 3-job and
12-job legs over one 26-mutant population named the **same 15 survivors**, line for line and operator
for operator, and killed the same 11. So the set does not move with parallelism, and it did not move
on this file at all. The §6 legs differ in two ways at once — the file and the CI/rig boundary — and
this pair holds one of them still. Whatever moves that set, four times the workers is not it.
## 7 · THE THIRD FINDING — the gate cannot finish a large-DSP diff at CI's parallelism

Residue `2026-10-12-the-js-mutation-timeout-is-wider-than-the-self-speeding-pr` asks whether an
ordinary DSP diff fits the budget. Run `39162011567` answers it on real bytes.

| what | reading |
|---|---|
| the population, from `--diff <base> --dry-run` at `0413e99e0` | **205 mutants** — 82 in `oxydex-dsp.js`, 123 in `oxydex-render.js` |
| tested when the step cap fired | **25 of 205**, 12 % |
| `oxydex-dsp.js` calibration on CI | 192 s |
| per mutant, from the run's own elapsed readings | **83.2 s** at 3 jobs |
| the first file alone, at that rate | 7011 s = **1.95 h**, so the 2520 s step cap is 36 % of it |
| the verdict object | **none** — `mutation-diff.ndjson` in the artifact is empty |
| the report | TIMED OUT by name, from the `if: always()` step #3540 added |

Three things follow.

**The #3540 design works.** A step that exceeds its own cap fails, the job survives, the report runs,
and the artifact states TIMED OUT. No reader has to infer a timeout from a duration.

**The raised cap bought this class nothing.** 45 minutes against a first file that needs 1.95 h is not
a margin. The population is mutants times the covering-suite cost per mutant, and a diff inside a
large DSP sets both high. PR #3638 merged on the required contexts with this gate never terminal,
which is the third such merge the row's own history records.

**The sizing rule holds, and it would have refused this diff.** §2 prices CI at 2.4x the rig. A third
rig leg re-ran the capped run's own bytes — the same tool, the same commit range, the same 3 jobs, the
same 25-mutant budget — and needs **26.4 s** per mutant on this file, so 82 mutants plus the 81 s
calibration read **2246 rig seconds**, **2.1 times** the 1050-second break-even. Adding
`oxydex-render.js` at its measured 1.6 s per mutant brings the whole diff to about 2450 rig seconds,
**2.3 times** the break-even. A pickup that priced this diff before pushing it would have known.

**One bound on that comparison: the two 25-mutant sets are not the same 25.** CI ran with no `--limit`
and reached 25 of 82 only because the cap killed it, so its 25 are the **first** 25. The rig leg passed
`--limit 25`, and `tools/mutate.mjs:334` `thin` samples evenly across the population
(`list[Math.floor(i * step)]`), so its 25 are **spread over** the 82. Both legs ran the same file at the
same parallelism, and their kill mix is close — CI 9 killed of 25, the rig 10 of 25 — so the per-mutant
rates are comparable. They are not two readings of one subset, and the **3.2x** between 83.2 s and
26.4 s is a factor over two different samples of one file.

### 7b · A wall-clock factor is only valid at matched parallelism

The row calls the gap "the runner rather than the work", from a local run that finished in under five
minutes at 16 jobs. CI runs at **3**: every NDJSON record of run `39375213486` carries `"jobs":3`, and
both CI logs print `building worker pool: 3 hard-linked tree(s)`. The rig legs of §2 also ran at 3,
which is why that 2.4x is a factor rather than a parallelism artefact.

Measured on one population — 26 mutants of `oxydex-dsp.js` plus one of `oxydex-render.js`, on the rig:

| rig jobs | wall | `oxydex-dsp.js` calibration | per mutant |
|---|---|---|---|
| 3, CI's own | 856 s | 97 s | **28.5 s** |
| 12 | 377 s | 94 s | **10.1 s** |

Four times the workers bought 2.27x the wall and 2.82x the per-mutant rate, so two readings of ONE
population at two job counts differ by more than the whole CI:rig factor this brief measures. A 16-job
local reading therefore predicts no CI wall, and nothing in it says the runner is slow.

**The factor is not one constant, and the loop's is the higher one.** Against CI's 83.2 s per mutant on
the same file at the same 3 jobs, the rig's 28.5 s is a **2.92x** per-mutant factor, while the
calibration factor is **1.98x** (192 s against 97 s). §2's whole-gate 2.32x–2.45x is a blend of the two
over a diff that was calibration-heavy. So 2.4x stays the rule for a mixed diff, and a diff whose cost
is mostly LOOP is under-priced by it: size that one at 2.9x.

### 7c · What this leaves open

The measurement does not choose a remedy, and three shapes are available: scope the gate below the
whole diff, raise its parallelism to match the work, or accept that a large-DSP diff carries a
hand-asserted equivalence instead. That choice belongs to the owner, as does the gate's requiredness.
Logged as residue `2026-10-20-the-js-gate-cannot-finish-a-large-dsp-diff-at-ci-parallelism`.

## 8 · Not claimed

- One population, one CI run, two rig legs. A factor measured once is not a constant of the lane.
- The rig ran near-idle at load 0.9–1.7. The runner's own contention is invisible from here.
- The 63-run window is 3 h 29 min, which is what the API returns for this repo's traffic. It says
  nothing about last week.
- The CI leg carries no coverage map and the rig leg carries one, unapplied. Selection is opt-in
  (`--use-coverage-map`), so neither leg used it.

## 9 · How to re-measure

```sh
gh run download <run-id> -D /tmp/ci-leg               # mutation-diff.ndjson carries calibrationMs per file
git worktree add --detach ../wt-meas <that run's head sha>
node tools/mutate.mjs --diff origin/main --jobs 3 --json > rig.ndjson 2> rig.log
```

Read `calibrationMs` from both ndjson files, the per-file `elapsed` lines from both logs, and the job
duration from `/repos/{owner}/{repo}/actions/runs/{id}/jobs`. Pin `--jobs 3`: the rig's `defaultJobs`
returns 16 on 24 cores, and the runner's returns 3.
