<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: []
brief: TOOL-INVOCABILITY-SWEEP-2026-08-02-BRIEF.md
---
`tools/mutate.mjs` — break the code on purpose and find out which gates do not notice.

This repo's central anxiety is the hollow gate. `TEST-AUDIT-FINDINGS` found **42** of them — by applying 40 mutations **by hand**, one at a time, re-running the suite for each. Heroic, and unrepeatable: it is why the Python side was never audited and why nothing has re-checked the JS side since.

**A surviving mutant is the finding.** If a line can be changed and the suite stays green, nothing tests that line — whatever coverage says. Coverage asks *"was this executed?"*; mutation asks *"would anyone notice if it were wrong?"*, which is the question this repo actually cares about.

**Fast enough to use.** Every group in `tests/dex-tests.js` carries a tag naming its module, and `--group=` filters on tag — so a mutant of `integrator-tch.js` runs only the 6 groups tagged `integrator-tch`. **12 mutants in 3.9 s** across 8 workers. `--full` runs the whole suite per mutant when certainty beats speed.

**Parallel by default** (`min(8, cores−2)`). Mutants are independent but all rewrite the same file, so each worker gets its own `git worktree` — the isolation `CLAUDE.md` §👥 already prescribes, applied to the harness. Measured: 7.15 s serial → 3.86 s at 8 jobs, identical verdict.

**Safety, got wrong first and now spelled out.** With `--jobs > 1` the caller's tree is never written. On `--jobs 1` the file is edited in place, and **signal handlers are not a guarantee**: the serial path blocks in `execFileSync`, so the event loop cannot service a handler mid-suite, and SIGKILL is uncatchable. Verified, not assumed — a `pkill` mid-run left `clock.js` **mutated in the working tree** with all four handlers registered. The guarantee is an on-disk `<file>.mutate-backup` plus `recoverStale()` at startup, which restores any leftover before doing anything and says so. Both directions verified: killed mid-run → file mutated → next invocation recovers it automatically.

**An audit tool, not a gate — deliberately.** Survivors need triage; some are legitimately untestable, and a gate that reds on those is a gate someone turns off. That is §4a's objection to cry-wolf checkers, with more force here. The one bounded form that *would* belong in CI is **diff-scoped** mutation — mutate only the lines a PR changed and require them killed — which is the recommended follow-up, not the default, because it needs the PR's diff rather than the file.

**Scope: JavaScript only.** `capture-host/` is Python under pytest and is not covered — different runner, different mutation grammar. `TEST-AUDIT-FINDINGS` §34 already recorded that gap and pointed at `mutmut`/`cosmic-ray`; this does not close it.

First real run, on `integrator-tch.js` (6 tagged groups, 151 mutants generated, 12 sampled): **42 % killed**, and the survivors are specific — the `minN` default can be set to `0`, and the negative-variance detector's `||` can become `&&`, both unnoticed. Not triaged here; recorded so they are not invisible.

`--selftest` pins mutant generation and thinning determinism (a survivor must be reproducible), and runs without touching the repo.
