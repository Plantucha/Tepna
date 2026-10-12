---
name: handoff-at-a-unit-boundary
description: Use when a work unit ends, when a PR is opened or merges, when parking for the night, or when the context window is about to compact — writes a handoff to the session state file that a stranger could resume from. Use at every unit boundary and before any compaction, not only when stopping for the day.
---

# Handoff at a unit boundary

The index (bge + xerj) **is** the memory, so notes are the durable artefact, not a courtesy. Sessions
compact at 20 % of the window; whatever is not written down is gone at that moment.

Append a dated section to your own state file in the memory directory
(`<name>-state-YYYY-MM-DD-<part>.md`) containing all seven:

1. **Unit** — what was being done, in one line.
2. **Branch + worktree** — the exact paths, and the commit sha if one exists.
3. **Exact stopping point** — `file:line`, or the last command run and its result. Not "partway
   through".
4. **Next step** — the single next action, specific enough to execute without re-deriving it.
5. **Open questions** — including anything awaiting another session's or the owner's word.
6. **Blockers** — what would make the next step fail, and the cost if it does.
7. **The doc-search query** that finds the relevant prior work, so the resumer starts where you ended.

Then add the pointer line to the lane INDEX file; put it under READ ON RESUME in `MEMORY.md` only if
it genuinely must be read on every resume. See `memory-append` for the frontmatter and the
read-before-overwrite rule.

## Measured

A handoff written for a stranger survives three things a summary does not: compaction, a restart the
owner initiates, and a different session picking the work up. On 2026-10-11 a held commit
(`b21750ef`, unpushed under an OxyDex freeze) was recoverable only because the state file named the
worktree, the sha, the exact unblock condition, and the 25 minutes of rebuild the resume would cost.

Write it **at the boundary**, not when the window is nearly full — a handoff composed under pressure
is the one that omits the stopping point.

**Do not exit on your own.** The owner restarts sessions.
