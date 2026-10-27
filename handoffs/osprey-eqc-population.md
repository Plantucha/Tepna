# Osprey — the collocation run reports its night population

**Unit.** Wire `tools/eqc-run.mjs` to the corpus-population primitives, against residue row
`2026-10-21-forty-one-corpus-enumerators-report-no-population` (board claim #1024).

**Branch + worktree.** `claude/enum-osp` at `f6ddd6cbc`, worktree `wt-enum-osp`, cut from
`origin/main` at `4811bc9e9`.

**Exact stopping point.** The commit holds the whole unit. Four paths moved: `tools/eqc-run.mjs`,
`tools/corpus-reads.mjs` (the hazard entry removed), `tools/verdict-adoption.json` (a `decides`
row with a `--verdict-sample` command) and the changeset. The full gate ran detached on that head.

**State.** #3894 is open as DRAFT, 0 behind `4811bc9e9` and MERGEABLE. `npm run check` reached
EXIT=0 over all 41 steps, with 14,186 suite assertions in 825 groups. Board report #1072.

**Next step.** Wait for Kodiak to merge #3894, then run `node tools/wt-done.mjs` on the worktree.
The next enumerator of the same row is the following unit, one per PR.

**Open questions.** The row names 41 enumerators and the scan now reads 98. The count moved with
the binding-hop and ladder work, so the row's figure is a date, not a target. One enumerator per
PR keeps the gate honest, so the row stays OPEN after this one.

**Blockers.** None. The CPAP leg lives on a removable volume no gate mounts, so the sample object
is synthetic and the real four-stream run stays unmeasurable here.

**Doc-search query.** `extended quadruple collocation reports its night population` → the tool's
own header, `CROSS-DOMAIN-METHODS-FOLLOWUPS` §3, `changes/2026-10-21-corpus-population-stability.md`.

## What the unit measured, beyond the wiring

The selftest is new. The tool reports a correlated-error CLASS and refuses to name the pair, and
nothing tested that refusal. A clean model recovers all four source variances exactly. One
correlated edge then fits exactly as well as its disjoint complement, while the other four
hypotheses carry a residual. The two class members disagree about the per-source variances.

Two ordering facts are load-bearing in the file:

- `--selftest` and `--verdict-sample` must sit ABOVE the input-path refusal. Both callers run
  where the captures are absent, so a refusal above them refuses the gate itself.
- The population verdict prints above every insufficiency exit. Those exits leave with status 0,
  so a verdict printed after them would reach only the longest runs.
