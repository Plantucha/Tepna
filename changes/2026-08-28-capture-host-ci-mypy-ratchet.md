---
bump: patch
type: added
brief: PYTHON-TYPES-AND-FORMAT-2026-08-27-BRIEF.md
---

An **advisory mypy ratchet** in `.github/workflows/capture-host-ci.yml` (§P1 → §P3). It fails only
when the error count **exceeds** the recorded baseline, so the number can only go down; §P3 flips it to
**required** with a threshold of 0, in the same PR as `check.sh`'s flip.

⚠️ **CI's fresh checkout is the canonical population, and the job says so in its own output.** A
whole-tree count is a property of the tree it ran in: measured 2026-08-28, root reported **189** and a
clean worktree **188**, the single difference being one **untracked** file existing only in root. CI
carries no untracked strays, so it — not a working tree — is what §P3's flip count must be measured
against. A developer's root checkout is the convenience measurement.

**The baseline is read from `check.sh`, not copied into the workflow.** One number, one home; a second
hardcoded copy is a second thing to forget. If it cannot be parsed the job **refuses** — an unreadable
baseline is not a permissive one.

**Aggregated from mypy's own summary line, never a tail** (§4b), and the three outcomes are
distinguished rather than collapsed:

| output | reading |
|---|---|
| `Found N errors in …` | N |
| `Success: no issues found …` | **0** — a genuinely clean run |
| *neither line* | **REFUSE (exit 2)** — mypy did not finish, which is not zero |

mypy's own exit status is captured before any pipe; a `\| tail` would have reported tail's status and a
failing type-check would read as green.

Gated behind the same relevance filter as the other capture-host jobs, and guarded at the **step**
level rather than the job level — following the file's own hard-won note about skipped jobs and
required contexts, so that making it required in §P3 cannot deadlock the branch.

Dry-run locally against real output on all four paths: 189 vs baseline 189 → pass (delta 0); a
`Found 200` line → fail; a success line → 0; empty output → refuse.
