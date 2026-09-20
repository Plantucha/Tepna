---
bump: patch
type: changed
brief: none
---

Log a residue row: a guard denial cancels the **whole Bash invocation**, and nothing says which clauses
did not run.

## The defect, and why the silence is the reportable half

`guard-shared-tree.sh:34` reads `.tool_input.command` and matches its rules against the whole string, so
its verdict is necessarily all-or-nothing over the invocation. A correct objection to one clause
therefore cancels every unrelated clause beside it.

**A denial that announces itself costs one retry. This one costs a false belief about state** — the
operator is told a rule was violated and told nothing about the work cancelled to enforce it. Same shape
as a push returning `rc=0` while carrying nothing.

That framing is load-bearing: a row read as *"the guard is over-broad"* sends the next reader to fix the
wrong property. **The rule that fired was right.**

## One row per root cause, not one per guard

Two guard false-positive classes surfaced in the same night and they are **not** the same defect:

| class | example | wants |
|---|---|---|
| a guard matching **prose that describes** a forbidden form | a heredoc quoting one, a commit message naming a glob | a parser fix |
| a **correct** denial taking down an innocent clause | this row | clause-level evaluation, or a message enumerating what did not run |

Folding them would produce a row that is right about neither. The first belongs to whoever measured it.

## The existing exemption does not reach it

`guard-shared-tree.sh:118-131` already exempts the temp-index rescue recipe — because that pattern is
**genuinely safe**, and denying it made CLAUDE.md's own rescue procedure unexecutable. Every exemption of
that kind answers *"this command should not have been denied."* **Here the command should have been
denied**, and the loss is the clause beside it. No exemption fixes that shape.

## Bound

**n=1, mine, and caught within one command.** A single call chained `gh pr create --body-file …` and
`git worktree remove … --force`; the guard denied on `--force`, correctly, and the PR was never created.
I learned it only because a later command failed on the missing temp file the same cancelled invocation
had been going to write — had that file already existed, the next signal would have been a peer asking
where the PR was.

**No rate and no realised cost is claimed** — only the mechanism and the absent signal.
