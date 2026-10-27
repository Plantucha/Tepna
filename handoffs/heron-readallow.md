# Heron — unit `readallow`, the stale-brief guard's interpreter arm fails closed

**1. Unit.** Owner ruling 1 on fleet board #1549 asks me to invert a write-verb enumeration into a read allowlist. The arm now denies whenever a guarded path stands in interpreter program text and no recognised read form stands beside it. Residue row `2026-10-26-four-write-forms-reach-a-guarded-doc-under-both-stale-guards` is the claim, board #1551, and the design is #1552.

**2. Branch and worktree.** `claude/readallow-hrn` @ `50516c84c` in `~/wt-readallow-hrn`, base `a401799ac`, committed, tree clean. Three files move: `.claude/hooks/guard-stale-brief.sh`, its self-test, and `changes/2026-10-26-stale-brief-read-allowlist.md`.

**3. Exact stopping point.** The self-test reads `PASS` with 111 ok and 0 FAIL, against a 92-leg baseline. `shellcheck` exits 1 on both files, and the diagnostic SET is byte-identical to `origin/main` — 7 findings, same four codes, none on a line of mine. The changeset lints PASS, and `--group=release-ledger` passes 9 assertions.

**4. Next step.** Wait for #3992's checks to go terminal, then ask Kestrel on thread 8 for the undraft.

**PR #3992 is open as DRAFT**, `claude/readallow-hrn` @ `3e94c0f4c`, rebased onto `b6b7c33ed` after #3986 landed in the same two files. The self-test reads the same 111 ok, 0 FAIL, PASS after the rebase as before it, and `npm run check` reads `✓ check — all 41 steps passed` with EXIT=0. `pr-compliance` evaluated 9 checks and passed before `gh pr create`. The row closes inside the PR as `fixed #3992`, the number read back from `gh pr view`, and `residue-ids.mjs` post-commit reads `ok — 0 row(s) added, none colliding, none mutated` with `--group=docs-ledger` green over 102 assertions.

**5. Open questions.** None on the mechanism. The row closes inside this unit's PR, and the other ruling rows ride a separate RESIDUE-only PR.

**6. Blockers.** One open PR per bird, and #3988 holds that slot. This unit cannot open a PR until #3988 merges.

**7. The doc-search query.** `node tools/doc-search.mjs --read "stale brief guard write verb interpreter allowlist"` finds the guard, the #1549 ruling thread and the four measured write forms.

## What the inversion is, and the one axis it must not touch

**The inversion applies to PROGRAM TEXT only, never command text.** `node tools/ste-lint.mjs briefs/X-BRIEF.md` names a guarded path as an ARGUMENT, and it does its work inside a file the hook cannot open. Failing closed over command text would deny every brief-reading tool in the repo on first use. That is the "allowlist keyed on the wrong axis" defect `capture-host/nights_index.py:97` already records.

So the arm needs the program text ALONE, which means a tokenizer.

## The defect my own first draft carried, measured before it shipped

**A `;` inside a quoted payload is not a clause boundary.** My first draft split the command with `tr ';|&'`, which cut `python3 -c "import pathlib; pathlib.Path(L).write_text(V)"` in two. The flag landed in one half and the path in the other, so five legs read ALLOW where the leg asks for DENY.

The `node -e` legs carry no `;` and passed throughout. That is what made a SPLITTER defect look like a gap in the verb list. An awk quote-aware tokenizer replaced the splitter, and a comment above the block records the measurement.

One more trap sat in the same block. An inline-flag pattern of `-[A-Za-z]*(c|e|E)` also matches `-force`, which would drag unrelated clauses into the program text. The cluster test is now short, and it avoids `{0,3}` for mawk portability.

## The pre-inversion control, and why it had to run inside a checkout

The self-test pins `H` at line 25, so no environment override can point it at another hook. I ran a scratch copy of the whole test file against `origin/main`'s hook instead.

A copy under `/tmp` REFUSES on the writer-fate payload-size probe, because the hook derives the repo root from its own location. A control that refuses measures nothing. Run from inside the worktree, it reads `FAIL — 9 problem(s)` with 102 ok.

Those nine are the discriminating legs: four write forms, two unknown-form legs, two post-`;` legs and the in-place perl. The other new legs pass under both hooks by design, because they assert the guard does NOT fire. The control's numbers sit in a comment above the `§3b` block.
