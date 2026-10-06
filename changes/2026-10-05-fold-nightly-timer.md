---
bump: patch
type: added
brief: NIGHT-0928-ERRORS-2026-09-29-BRIEF.md
---

E12's timer half: a `tepna-trio-fold` unit pair that folds the box nights the corpus does not hold yet,
daily after the corpus pulls. Measured 2026-09-29, nothing folded a box night automatically — the newest
folded night was 2026-09-21 and the backlog was seven nights, because `tepna-nightly-triage` runs only the
mutation crawl.

**No new tool, deliberately.** `tools/trio-batch.mjs --skip-existing` already decides what is due: its
`redoReason` is a pure function returning why a night must be recomputed (no stamp, inputs changed, code
changed) or null when skipping is provably safe, and the tool already emits one `tepna.verdict/1` and
persists it as `trio-batch-verdicts.json` beside the fold. A second decider would be a second definition
of "due", free to drift from the one the fold uses. So this changeset adds a schedule, not a mechanism.

**Nothing is pushed, and that is the only part of the original claim that survives:** the unit holds no
credential and never contacts a remote.

**A fold IS git-visible, and this changeset was first written on the opposite premise.** `.gitignore` has
`uploads/*` at :16 but **`!uploads/trio/**` at :149** — trio folds are the one allowed addition under
`uploads/` (owner, 2026-09-24). Measured: `git check-ignore` matches nothing for a fold path and 658
`uploads/trio` files are tracked. So the fold's output is a commit someone owes, and the unit now ends by
committing it on a dated branch IN THE TIMER'S OWN worktree, staged by explicit path, with no push and no
credential — a session relays it the next morning after reading the run verdict.

**OWNER RULING 2026-10-05: install the timer.** 16:30, its own worktree, due-only via `--skip-existing`,
never `--jobs`, never a push, a local dated branch for a morning relay, `Persistent=true`. The install
itself stays the owner's hand after this merges; the commands are in the PR body and the service header.
