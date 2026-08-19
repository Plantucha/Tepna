---
bump: patch
type: fixed
brief: STALE-BRIEF-GUARD-MEASURES-THE-WRONG-TREE-2026-08-18-BRIEF.md
---

**A brief-status sweep, and the guard defect it surfaced.**

**Status corrected.** `INTERDISCIPLINARY-LITERATURE-2026-08-16` was `PROPOSED` while its own §0 says
*"a reading queue, not a set of adopted methods"* whose entries are *"surfaced by search"* rather than
read end to end. Nothing in it is executable, so **there is no state in which it becomes DONE** — a
reading queue is never finished, only current. `PROPOSED` was wrong in the opposite direction: it read
as *work not yet started* on a document already in daily use through `tools/doc-search.mjs`. §📌 reserves
`REFERENCE (living — last-verified …)` for exactly this shape, and its same-day sibling
`-DIAGNOSIS` was already REFERENCE. All four tracked items closed 2026-08-17.

This matters because the repo has just paid for a stale status line: `FABRICATED-DEFAULTS-FLEET` read
`PROPOSED` for two days after every fix in it had shipped, and a session was three tool calls from
reimplementing 11 guard sites before `rev-list --count origin/main..X` returned 0.

**Sweep denominator, printed before any conclusion:** 418 briefs — **332 DONE · 34 IN-PROGRESS · 29
PROPOSED · 22 REFERENCE · 1 CHECKPOINT**. Ranking the 29 by checked-box fraction is a *weak* signal
(76 unchecked boxes sit inside DONE briefs), so the two at 100 % were read rather than trusted:
`SENSOR-TRIO-NIGHTS-PAPER` is genuinely PROPOSED — its header carries a live finding, a re-fit that
does **not** reproduce the paper's Verity/H10 σ — and only the other was miscategorised.

**The guard defect.** `.claude/hooks/guard-stale-brief.sh:113` runs `git merge-base HEAD origin/main`
with **no `-C` and no `cd`**, so a `PreToolUse` hook resolves `HEAD` in `$CLAUDE_PROJECT_DIR` — the
**shared root** — not the worktree being edited. It answers *"has this brief moved since the ROOT's
HEAD?"* when the question is *"since MY branch's base?"*. §👥.1 **mandates** worktrees and §👥.2b-bis
measures the root at 92 → 248 → 255 commits behind, so the guard reads from precisely the tree the rest
of `CLAUDE.md` says not to trust.

**False positive measured:** it blocked on `084db04e` (#1504), a commit that **was my own HEAD** —
`merge-base --is-ancestor` true, `rev-list --count HEAD..origin/main` 0. `rebase-safe` replying
*"already up to date — nothing to rebase"* is the tell.

⚠️ **The false-negative direction — current root, stale worktree, hook passes silently — is INFERRED
FROM THE SOURCE AND NOT DEMONSTRATED.** The `--detach HEAD~60` demonstration exceeded the command
timeout on this volume and was abandoned rather than reported as done. The brief says so explicitly.
The asymmetry is why it is still recorded: the false positive announces itself; the false negative
cannot, and §📌 already notes this failure raises **no merge conflict**.

No code change here — the one-line fix (`git -C "$(dirname "$file")"`) needs a two-directional hook
test to accompany it, since a one-directional test passes today.
