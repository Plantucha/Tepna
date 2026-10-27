# Osprey · unit `mapsel` — the state three mutation workers share beyond file bytes

**Unit.** Kestrel's order on claim #1638: test the last candidate in residue row
`2026-10-20-the-js-gate-survivor-set-does-not-reproduce-across-runs`, and close the row if the
candidate dies. The candidate did not die. It moved: a worker shares the caller tree's inodes.

**Branch and worktree.** `claude/mapsel-osp` in `wt-mapsel-osp`, base `ddc5c0961`.

**Stopping point.** `tools/mutate.mjs` carries `driftWatchList`, `sampleTree`, `treeDrift` and
`driftWarning`, wired at the pool build and at report time, plus `treeDrift` in the record. The
selftest runs 238 legs green, 24 of them new. The changeset is `changes/2026-10-27-sweep-input-drift.md`.

**Next step.** Run `npm run check` on the final state. One draft PR follows, carrying the three
rows drafted in the scratchpad, with the number read back from `gh pr view`.

**Open questions.** Should a sweep whose input moved VOID its numbers, as a failed canary voids
`killed`? Row `2026-10-27-a-sweep-whose-input-moved-annotates-rather-than-refusing` asks the owner.
The parent row stays OPEN, because nothing here proves what moved the three legs of 2026-10-20.

**Blockers.** None. The probes need no corpus and no box.

**Doc-search query.** `mutation worker trees shared state across runs canary journal`.

## What the probes measured

- A worker is `cp -al`, so an in-place root write reaches it with no worker write, same inode and
  same mtime. A replacement write detaches the root and leaves the worker on the old bytes.
- `ppgdex-dsp.js:3787` `[cmp < → <=]` survived 12 of 12 repeats, 3 solo and 9 under three
  concurrent workers.
- An anchored, comment-stripped census finds 0 nondeterminism sites in the 105 selected groups.
  The raw count read 20, then 74: comments and a `getUTCDate()` substring.
- The map stays opt-in, worker directories carry the process id, and a cold run truncates the
  journal. CI runs `--diff`, so no leg of the row read a journal.
