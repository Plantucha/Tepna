# Magpie — a declared night rule says what it cost

**Unit:** residue `2026-10-21-the-reference-validation-night-filter-is-pinned-to-one-year`.
**Branch:** `claude/nightrule-mg` · **worktree:** `wt-nightrule-mg` · **PR:** #3860, DRAFT.
**Head:** `5dbd81cf7`, cut from `origin/main` at `54fd621c9` (#3859).
**Doc-search that found the prior work:** `reference validation night filter pinned to one year silently drops a night`.

## Stopping point

The unit is COMPLETE and pushed. The owner ruled at 14:57Z (board #903) that I finish the PR I
hold, write this handoff and exit. I hold no other open PR.

The full gate runs detached on the pushed head. Its log sits in my session scratchpad as
`check.log`, with an `EXIT=` sentinel. Read the sentinel, never a tail.

## What the row claimed, and what I measured

The row says `uploads/trio` already holds night folders outside 2026, so the tool's `^2026-` rule
bites. It does not. The root reads 147 directories, 147 night-shaped and 147 under 2026, with zero
outside. Four other roots read the same.

So widening the rule to `NIGHT_RE` moves no figure and fixes nothing. I took the other branch the
row names: the rule stays and says so.

## What the real defect was

`snapshotNights` applies a caller's own `re` INSIDE the walk, so the snapshot it returns is already
the narrowed set. A second caller runs the hazard the other way: `tools/tch-multinight.mjs` passes
`{ re: /./ }` and counts a plain directory as a night.

The snapshot now measures the rule against `NIGHT_RE` over the same listing and keeps NAMES:
`rejectedNightShaped` and `admittedNonNight`. The verdict publishes them under `result.rule*` and
`ruleLine` renders the printed line. An unreadable root leaves both `null`, never `[]`.

The population triple keeps meaning movement alone. Folding a declared rule into `excluded` would
make a narrowed root and a moved root read the same.

## Next step for whoever picks this up

1. Read the sentinel in `check.log`. A green run needs nothing more; a red one names the step.
2. Kestrel readies the PR. I never undraft my own.
3. One row opened: `2026-10-21-the-multinight-tool-counts-any-directory-as-a-night`. The wide rule
   admits a stray directory as a night that produced nothing. The line makes it visible, and
   nobody has decided whether the tool refuses it or subtracts it.

## Two ledger lessons this unit paid for

1. `docs-ledger` check8b takes the STATE cell from a fixed vocabulary. My first close wrote the
   refutation into that cell, and the gate red at step 14 of 40.
2. `residue-ids --check` freezes EVERY non-state cell, and it reads the COMMITTED ledger rather
   than the working copy. So a correction to a landed row must be a NEW row, and a fix that sits
   uncommitted still reads as the original defect.

## Open questions

- `tools/tch-reference-validation.mjs` refuses before its own walk on any box without the Polar
  nightly corpus, which is row `2026-10-21-the-reference-validation-population-path-runs-on-no-box-here`.
  So its printed line has no end-to-end run here, and the selftest pins the rendered string instead.

## Gate history

The first full run on `5dbd81cf7` reded at step 14 of 40, and 26 steps never ran. The cause was
my own correction row. Its state cell read `logged, closed by #3860`, which is prose, and check8b
takes that cell from a fixed vocabulary. The row that records a wrong cell got its own cell wrong.

The fix is the pointer form `answered #3860`, which check8j resolves. I also rebased onto
`origin/main` first, because the branch had fallen one commit behind and the ledger appends at the
end of the file.

The second run is green. `npm run check` reads `EXIT=0` with all 40 steps passed on `695e59569`,
the suite reads 14,094 assertions over 819 groups, and `^ *✗` counts 0. Local and remote refs both
read `695e59569`, and the tree is clean. The PR stays DRAFT, because I never undraft my own.
