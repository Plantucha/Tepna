# Osprey · unit `driftseam` — a sweep refuses per mutant, not per run

**Unit.** Residue row `2026-10-27-a-sweep-whose-input-moved-annotates-rather-than-refusing`
(`tools/mutate.mjs`, follows #4009). The drift detector that unit shipped ANNOTATES: it prints a
warning and records `treeDrift`, and the kill rate stays readable. §∅ rules that a discontinuity
refuses. This unit reconciles the two at the grain where they meet.

**Branch + worktree.** `claude/driftseam-osp` in the worktree `wt-driftseam-osp`, cut from
`origin/main` at `9d346e5c5`.

**What it builds.** The run-grained question ("did the input move at any point") is the wrong grain:
read that way, §∅ reds every sweep in a shared checkout and never fires in CI, whose tree does not
move. The finer question is where the write landed. A mutant that began and finished inside one
continuous stretch of the tree faced one input; a mutant a write landed inside faced two, and that
one is the discontinuity. So the sweep keeps a monotonic epoch, bumped at each seam, and each mutant
records the epoch it started in.

- Four pure exports: `seamAt`, `straddlesSeam`, `inputVoidWarning`, `canarySeamNote`.
- `measuredDenominator` subtracts `inputVoid` the way it already subtracts INVALID and QUARANTINED.
- The window opens in `beginMutant` (the one site that puts a mutant on disk) and closes in
  `classify` (the one funnel all three run loops share).
- `classify` drops a straddler BEFORE the KILLED branch, because a kill observed over two trees is
  not evidence, and journals nothing for it, so a resumed sweep re-runs it rather than inheriting
  that verdict.
- `diffVerdict` counts void mutants among the unrun, so the gate reads UNKNOWN naming the seam, and
  the gate's own prose reads the same union.

**Exact stopping point.** `tools/mutate.mjs` edited, Biome clean, typecheck clean, `--selftest` all
green at 275 legs, five planted defects each caught by name. Two real `--jobs 2` sweeps of `clock.js`
were still running at the time of this note: arm A with a root file touched every 15 s, arm B
untouched as the control.

**Next step.** Read the two arms. Then one full `npm run check` on the final state, one draft PR, and
the undraft ask on board thread 8.

**Open questions.** The row's call is the owner's and this PR does not close it: the branch ships the
refusal at the mutant grain and measures what it costs. A seam-rate probe over the shared root
watched 191 paths every 5 s for 25 minutes and saw no seam, which bounds the cost in an idle window
only — a build-heavy evening is a different population.

**Blockers.** None. The gate is long; detach it with a sentinel per §4c.

**Doc-search query.** `node tools/doc-search.mjs --read "a sweep whose input moved should void its
numbers or annotate them"`.
