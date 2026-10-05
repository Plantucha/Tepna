---
bump: patch
type: added
brief: NIGHT-0928-ERRORS-2026-09-29-BRIEF.md
---

E12's timer half: a `tepna-fold-nightly` unit pair that folds the box nights the corpus does not hold yet,
daily after the corpus pulls. Measured 2026-09-29, nothing folded a box night automatically — the newest
folded night was 2026-09-21 and the backlog was seven nights, because `tepna-nightly-triage` runs only the
mutation crawl.

**No new tool, deliberately.** `tools/trio-batch.mjs --skip-existing` already decides what is due: its
`redoReason` is a pure function returning why a night must be recomputed (no stamp, inputs changed, code
changed) or null when skipping is provably safe, and the tool already emits one `tepna.verdict/1` and
persists it as `trio-batch-verdicts.json` beside the fold. A second decider would be a second definition
of "due", free to drift from the one the fold uses. So this changeset adds a schedule, not a mechanism.

**Nothing is pushed and nothing is committed, structurally rather than by promise:** every path the fold
writes is under its `--out` root and the repo ignores `uploads/*`, so a fold produces no file git can see.
There is no local branch to make and no push to withhold.

**Not installed, and not a ruling.** The brief records E12 as an OWNER DECISION between a timer and a
manual step the owner keeps; this adds the artefacts for the timer arm and installs nothing. The units
ship uninstalled with their install steps in the service file's header, and the decision stays open.
