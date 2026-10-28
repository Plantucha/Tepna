# Unit `datapath` — the brief guard reads its verdict off the write target

**Bird:** Magpie · **Branch:** `claude/datapath-mg` · **Worktree:** `wt-datapath-mg` · **Base:** `0ad1f42a5`

Rule 0: `the brief guard denies a command whose guarded path appears only inside the data it writes` → board #1420, #1406, #1437, `ext:memory/guards-read-prose-as-code.md`. Best 0.925.

## The row and what it deferred

Row `2026-10-26-a-guarded-path-written-as-data-reads-as-a-write-of-that-path` says the remedy is the
owner's, because an adjacency test clears the data case and loses the variable case. That premise is
false, and the measurement is why. Adjacency is not the only narrowing available. A scan that
resolves the TARGET SLOT of each write form, one level through a literal assignment, clears the data
case and keeps the variable case denying.

## What the measurement said

A 20-case battery runs the hook against a throwaway repo with a real divergence: 10 true positives,
5 false positives of the row's class, 5 controls. The shipped hook disagrees with the want column on
**6 of 20** and the patched hook on **2 of 20**. The four false positives clear. Every true positive
and every control is unchanged. The two residual disagreements are gaps nobody had logged, and both
read ALLOW before my change as well.

## What is in the diff

- `.claude/hooks/guard-stale-brief.sh` — `WT_SCAN`, an inline awk target scan, and the interpreter
  arm rewritten to consult it first. The scan can only SUBTRACT denials: an empty answer falls
  through to the rule that shipped.
- `.claude/hooks/guard-stale-brief.test.sh` — 22 new legs. 133 ok, 0 fail.
- `briefs/RESIDUE.md` — two gap rows appended, both pinned by a KNOWN GAP leg.

## Open question for the owner

The row defers the narrowing to the owner, so the owner decides whether to accept it. My
measurement falsifies the premise of the deferral. It does not make the decision.

## Next step

The two board-corpus rows from PR #4058, which Kestrel ordered after this one.

Fleet-Session: Magpie
