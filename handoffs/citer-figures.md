<!-- SPDX-License-Identifier: Apache-2.0 -->
# Handoff: four rows that state a figure their citer corrected

Unit: row `2026-10-26-four-open-rows-state-a-figure-their-own-citer-corrected`.
Branch `claude/citerfig-wrn`, worktree `~/wt-citerfig-wrn` on rig. Claim #1790 on thread 8.

## What each row got

| row | citer read on origin/main | state |
|---|---|---|
| `2026-09-27-type-ratchet-pays-a-functions-whole-mutant-backlog` | `2026-09-27-three-residue-rows-overstated-the-ratchet-block` (answered #3155), `2026-09-27-pull-recording-mutants-time-out-not-survive` (fixed #3505) | `fixed #3373` |
| `2026-10-19-string-mutants-that-reach-an-interface-are-unmeasured` | `2026-10-21-the-excused-string-mutant-rate-is-measured` (answered #3815) | `answered #3815` |
| `2026-10-21-forty-one-corpus-enumerators-report-no-population` | `2026-10-22-the-enumerator-backlog-stood-at-seventy-five-not-forty-one` (answered #3882) | OPEN, new refining row |
| `2026-09-22-cvhr-cross-node-comparability-unsupported` | `2026-09-22-cvhr-cross-node-correlation-is-corpus-dependent` (answered #2840) | OPEN |

## Why

1. The type-ratchet row said the mypy ratchet could not run as a typing unit. PR #3373 took `MYPY_BASELINE` to zero. PR #3505 removed the one real block. The citer shows that the other four blocks were not real.
2. The string-mutant row asked for the excused rate before the bar moves. #3815 measured that rate. It kept the bar where it is.
3. The enumerator backlog reads 38 at `2e03f9392`. The parent states 41, and its citer states 75. The new row records 38. It names `UNWIRED_BACKLOG` as the live source. The parent stays OPEN because 38 tools still report no population.
4. The cvhr row stays OPEN. Its figure is correct for the box corpus. The citer limits that figure to the box corpus. The comment at `ppgdex-dsp.js:5403` still claims that the two indices "stay comparable", so the defect is live. A fix there moves a bundle, so it is not a ledger unit.

## Next step

Kestrel undrafts the PR. After the merge, verify each state on main. Then run `wt-done` and release claim #1790.

Doc-search query: "open residue rows state a figure their citer corrected".
