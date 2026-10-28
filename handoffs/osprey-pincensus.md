# Unit `pincensus` — a multi-root file enumerator publishes its own population

**Row:** `2026-10-28-the-multi-root-enumerators-need-a-census-not-a-night-snapshot` (claim #1983,
Osprey), closed by this PR. Its parent `2026-10-21-forty-one-corpus-enumerators-report-no-population`
stays **OPEN** — this unit is a named slice of it.

**Branch:** `claude/pincensus-osp` · **Worktree:** `wt-pincensus-osp` beside the primary checkout.

## What landed

`tools/pin-coverage.mjs` scores pin-span coverage over O2Ring `_PPG.txt` files, walking one level of
each root given as a repeated `--dir`. Its population is therefore FILES over SEVERAL roots, which is
why the night wiring of `popwire` did not reach it. It now takes `snapshotEntries` through a named
lister per root, once before the read and once after, and publishes the comparison.

Four behaviours moved with the wiring:

- **A root nested by path is still read.** `dedupeRoots` marks it `nested-in` and skips it, which is
  sound only when the parent's walk reaches every member inside it. This walk is one level deep, so
  the run states its summation over the FILE SET instead (`dedupeMembers`). It keeps `dedupeRoots` for the
  REASON two roots overlap, and its header now carries that precondition.
- **An unreadable root refuses by name**, and the run exits 2 when no root is readable at all.
- **The run names a night directory it cannot list**, where the walk used to drop it silently.
- **A resume keeps the throw count.** `--resume` inherited rows without the throw flag, so a tree
  with 198 throws read `threw 0` on the second run. The checkpoint is now `v2`, a v1 checkpoint
  reports `throw-state UNKNOWN for N`, and the run sums the bins against the found count so a lost
  throw shows as `UNACCOUNTED`.

`UNWIRED_BACKLOG` in `tools/corpus-reads.mjs` goes 34 to 33, and the scan reads the tool as `reports`.
`oxy-hr-bias.mjs` is the one of the original six night walkers still open: it holds a CSV file set and
a night tree at once, where one snapshot would publish one count over the other.

## Measured

- Selftest `PASS (25/25)`, up from 13 assertions. New legs: the bin identity and its break, a throw
  row skipped by the rate, inherited-unknown, the cap, and `dedupeMembers` over alias, deep-nested,
  partial-overlap and unreadable roots.
- The alias double-count is real on this tree: a root and a symlink to it report the same files, and
  the summed total reads one rung out without the dedupe.
- `--dir t1 --dir alias --dir deep/nest --dir deep --dir nosuch` reads the deeply nested root in full,
  where the path rule would have skipped its one file, and names `nosuch` as not readable.
- `--verdict-sample` prints `corpus-population PASS` over a synthetic three-file snapshot, with
  criterion `O2Ring PPG files_added_or_removed`.
- Probe safety unchanged: `closureHazards` reads `["fs-write"]` before and after, against an in-tree
  baseline.
- `npm run typecheck` and `npm run lint` both exit 0. `node tools/verdict-adoption.mjs` exits 0 with
  the byte form canonical. `tools/selftest-all.mjs` exits 0 and reads the summary line as before.

## Next

The `dedupeRoots` precondition is a finding about a shared primitive, logged as its own row and closed
here: of the three callers, the two that sum by root walk recursively, so nothing else is unsound
today. A one-level caller that sums by root owes its own rule.

**Doc-search query that finds this work:** `a multi-root file enumerator publishing its population`.
