# Heron — unit 59: the ruff guard fails open in 27 of 28 trees

**Status:** BUILT 2026-10-26, gate running · board claim #1392, finding #1397, control this unit · branch cut, no PR yet.

## 1 · Unit

I claimed row `2026-10-21-guard-ruff-selftest-certifies-nothing-without-ruff` and measured it. The row names the self-test. The hook behind it carried the same defect and nobody logged that. This unit fixes both halves and a third defect the work surfaced in the sibling self-test.

## 2 · Branch and worktree

`claude/ruffskip-hrn` in `~/wt-ruffskip-hrn`, cut from `origin/main` at `35e0f4b4e`. Nothing committed yet. A symlink points `node_modules` at the primary.

Four files carry the change:

- `.claude/hooks/guard-ruff.sh` — the resolver and the absence notice.
- `.claude/hooks/guard-ruff.test.sh` — the same four candidates, plus five new legs.
- `.claude/hooks/guard-format.test.sh` — one line: the sibling's absence leg could not fail.
- `changes/2026-10-26-guard-ruff-three-candidates.md` — patch, fixed, ste-lint PASS.

## 3 · Exact stopping point

`npm run check` runs detached, writing `/tmp/claude-1000/-home-michal-Tepna/4429f848-d75b-4221-a777-45a050d60b38/scratchpad/check62.log` with an `EXIT=` sentinel. It stood at step 13 of 41 when I wrote this.

Measured this unit, each arm in a log under the same directory:

- `ctl62.log` — the hook control. Take a worktree whose primary holds the venv. The new hook DENIES at exit 2. The shipped hook ALLOWS at exit 0. A tidy staged file still ALLOWS, so the rule does not fire on everything. With ruff reachable nowhere both hooks ALLOW. Only the new one prints the notice.
- `grt-run1.log` — the amended self-test: 31 legs, 0 FAIL, 0 SKIP. The shipped test scored 26 legs with the venv and 0 legs plus 1 SKIP without.
- `grt-antifix.log` — the anti-fix arm. Against the shipped hook, 3 of the 5 new legs FAIL. The other two are non-regression legs: an absent notice cannot repeat, and the shipped hook also exits 0.
- The sibling plant, two arms. A hook planted to DENY when Biome is absent: the fixed leg reads `FAIL absent Biome exited 2, want 0`, the shipped leg reads `ok`.

## 4 · Next step

Merge `origin/main` into the branch, which sits 1 behind since `7bf576aac`. Push, open the PR, and read its number back from `gh pr view`. Then append three rows closing `fixed #<that number>` and push again. Ask Kestrel for the undraft on the board. I never undraft my own PR.

The three rows:

- the claimed row above, whose self-test half this PR fixes;
- a new row for the hook half, which nobody logged;
- a new row for the sibling leg that cannot fail.

## 5 · Open questions

None for the owner. The row asks whether a vacuous self-test should report NOT_RUN. The runner answers it: a green run's object reads UNKNOWN by provenance and nothing consumes that object, so a NOT_RUN would reach no consumer. The PR body says that rather than building it.

## 6 · Blockers

None now. #3951 merged at 06:08:15Z, so the one-PR cap leaves a slot. Osprey holds #3952, which also appends to the ledger, so my ledger push may go DIRTY. The cure is `git merge origin/main` and a plain push, never a rebase.

## 7 · The doc-search query

`the ruff guard exits 0 on a staged python file that ruff would reject` scores 0.421 over a flat field and returns `.claude/hooks/guard-ruff.sh:17-37`, `.claude/hooks/guard-ruff.test.sh:27-53` and the ledger rows — the three files this unit touches. The precedent rows are `2026-09-22-fresh-worktree-silences-both-format-checks` (fixed #2883) and `2026-09-22-format-hook-bootstrap-was-necessary-not-sufficient` (fixed #2896); the second is the tree fix this file never received.
