# Heron — unit `veritysdk`, landed as #3988 DRAFT

**1. Unit.** The owner approves the Verity Sense one-night SDK-mode trial, and I prepare the runbook and the operator script. The owner deploys, and I deploy nothing.

**2. Branch and worktree.** `claude/veritysdk-hrn` @ `5a6166b62` in `~/wt-veritysdk-hrn`, two commits, tree clean, rebased onto `origin/main` and 0 behind.

Seven paths carry the unit. The runbook moves to `docs/VERITY-SDK-TRIAL.md` and the CLI to `capture-host/tools/verity_sdk_trial.py`. Three files are new: `capture-host/verity_sdk_config.py`, `capture-host/tests/test_verity_sdk_config.py` and the changeset. The pin lands in `capture-host/coverage_scope.py`, and `DOCS-INDEX.md` gains a row.

**3. Exact stopping point.** `capture-host/check.sh` passed with `EXIT=0`, 11494 tests, coverage 100.00 %, covscope PASS over 18 declared and 7 pinned, unwired PASS. `npm run check` reads `✓ check — all 41 steps passed` with EXIT=0, and `pr-compliance.mjs` passed 9 checks before the create.

**4. Next step.** Nothing on this unit. #3988 is open as DRAFT at `5a6166b62`, and board #1564 carries the undraft ask. Watch its checks, then `node tools/wt-done.mjs ~/wt-veritysdk-hrn` when it merges.

**5. Open questions.** The runbook placement is now `docs/`, which the layout rule wants, and the owner may still prefer a dated brief. The trial itself waits on the owner, who deploys to vigil.

**6. Blockers.** One slot per bird. #3982 merged, so the slot is open.

🔴 **THE TWO HALVES OF A SPLIT TOOL MUST NOT SHARE A BASENAME.** I gave both `verity_sdk_trial`, and three lanes reded at once for three different reasons. The CLI shadowed the module on `sys.path` under the full suite, so all 40 tests failed on `AttributeError` although every one passed alone.

Coverage then measured the CLI, so covscope called its pin spent. And `find_unwired.importers` skips a file named `<module>.py` as the module itself. So it discarded the one importer, and the module read as imported by nothing. Every sibling split in this tree differs by name for this reason.

🔴 A new `capture-host/tools/*.py` sits outside the coverage scan, because coverage does not descend into a directory with no `__init__.py`. `capture-host/tools/covscope.py --check` then demands a pin with a reason for every absent file.

⚠️ `check.sh` from a worktree needs `PYTHON=~/Tepna/capture-host/.venv/bin/python`, and it refuses with `NOT_RUN` and exit 2 without it rather than running on a toolless interpreter. A detached `setsid` shell drops the variable unless the inner `bash -c` exports it.

⚠️ covscope reads the coverage report the last run left. Running it after a single-file pytest judges the wrong population. It then prints eleven unpinned files that are not findings.

**7. The doc-search query.** `node tools/doc-search.mjs --read "a new capture-host tools script and the coverage floor pin"` → `capture-host/coverage_scope.py:1-15`, `memory/tools-coverage-on-first-import.md`, `capture-host/tests/test_coverage_scope.py:1-34`.

## 2026-10-26 evening — the two reds Kestrel relayed, and what each one was

**Branch now.** `claude/veritysdk-hrn` @ `c88990751`, ONE commit over base `a401799ac`, force-pushed with lease. The two-commit history is gone on purpose, and the reason is below.

**Red 1 was `secret-scan`, and it is not a credential.** The gitleaks rule `home-path` reads a user name out of a path, and `secretGroup = 1` means the NAME is the secret, not the path. The runbook's first draft quoted an absolute path under my home directory. I removed the line, squashed the branch to one commit, and checked each commit's added lines rather than the net diff.

That last part is the lesson. The second commit had already moved the file, so `git diff origin/main...HEAD` was clean while the history still carried the line. A net diff cannot see a finding that an intermediate commit introduced and a later one removed.

`node tools/secret-scan.mjs` could not reproduce it here. `gitleaks` is absent on this box, so the tool refuses with `NOT_RUN` and exit 2 rather than reporting clean. An absent scanner is not a clean scan, so the CI log was the only local truth. Reported to Kestrel by CLASS only as board #1567, and the rule was never allowlisted.

**Red 2 was the diff-scoped mutation gate, and it was real.** `mutate_diff` keeps FULL scope for a new file, because there is no base version to narrow against. So the gate mutated every function in `verity_sdk_config.py`, and 25 mutants survived at 100 % line and branch coverage. That gap is the distance between running a line and asserting what it returns.

I killed 19 with real assertions, which took the module from 40 to 58 tests. The remaining 6 are falsy-default substitutions read only for truth, such as `in_devices = False` becoming `None`. Each one is now an entry in `capture-host/tools/mutate-equivalence.json`, with a `function` field so a key cannot excuse the same text in another function.

**Every entry's probe is a RUN, never an argument.** `capture-host/tools/probe_verity_equivalence.py` rebuilds each mutant from the module source by line number and compares it with the shipped function over a generated corpus. It counts every disagreement, a raise included. The corpora are 41,111 line-sets, 320 lines and 37 documents, and all six mutants show ZERO differing inputs.

**The probe ships as a tool and not as a test, and the pin says why.** Under the mutation gate the module source on disk is already rewritten, so rebuilding by line number would read the wrong lines. The same code run as a test would kill mutants for the wrong reason and hide real survivors across the module. Its `coverage_scope.py` pin states that hazard, and the pin is deliberately weak.

**Gate lines.** `capture-host/check.sh` reads `EXIT=0` with ruff, shellcheck, pytest, unwired, covscope, mypy-ratchet and format all ok, 11512 passed and 3 skipped, coverage TOTAL 100 %. `mutate_diff --base origin/main` reads `status PASS`, 489 generated, 489 decided, 455 killed, 6 survived, 5 excused, 0 refuted, 0 undecided.

**Next step.** A chained job re-runs both cleanly, because the first mutation run overlapped my edits to the ratchet and the probe. Then commit four paths by explicit path, push with lease, and give Kestrel the gate line on thread 8. The four are the test file, the equivalence ledger, the probe and `coverage_scope.py`.

**Blocker.** Kestrel holds the undraft until both reds read green on GitHub. I never undraft my own PR.

## 2026-10-26, later — CI's mutation red was UNKNOWN, not FAIL

**The pushed state is `573640ba8`**, which carries the 18 assertions, the five entries, the probe, the `coverage_scope.py` pin and the ledger ratchet entry. `npm run check` reads all 41 steps passed, `check.sh` exits 0, and `mutate_diff` reads PASS locally with 0 refuted.

**GitHub then read 26 pass, 1 skipping and 1 failure, and the failure says something different from a survivor.** The job's own verdict is `status UNKNOWN`, `undecided 1`, `timeoutRetried 1`, `excused 0`, with 489 generated and 488 decided. The reason reads that one mutant never came under a test, so the run cannot claim a kill.

🔴 **An UNDECIDED mutant is UNMEASURED, and no bound turns one into a kill.** The gate says so in the refusal and forbids raising `timeout_multiplier` to clear it. The mutant is `verity_sdk_config.x_rates_span__mutmut_24`, and this box decided all 489 — so the symptom is the slower runner meeting a mutant that can run long.

**`rates_span` held the module's one hand-advanced `while` index.** `CLAUDE.md` §🧪 records that shape as timing out under this gate rather than failing. It is now a bounded `for j in range(i + 1, hi)` scan with an explicit `end = hi` default, which is semantically identical and carries its own ceiling. The 58 tests pass unchanged, and the two boundary assertions I had already added pin both ends of the span.

**Next step.** `check.sh` then `mutate_diff` are running on that state. On green, commit `capture-host/verity_sdk_config.py` alone, push, and ask Kestrel on thread 8 once GitHub reads terminal.

**One correction I owe thread 8.** My #1567 estimated "two look genuinely equivalent". The measured outcome is six survivors covered by five entries, each with a probe that ran.

## The bounded scan, committed and pushed (2026-10-26 21:21Z)

**Commit `3cd6ac3eb`**, one path, `capture-host/verity_sdk_config.py`, 12 insertions and 4 deletions.
The branch head on `origin` now reads `3cd6ac3eb`, and `git show HEAD:<path>` confirms the
`for j in range(i + 1, hi)` line survived the push.

Gate chain on that state, both terminal:

- `capture-host/check.sh` EXIT=0 — 11512 passed, 3 skipped, `TOTAL … 100%`, zero FAILED or ERROR lines.
- `mutate_diff.py --base origin/main` `status PASS` — 472 generated, 472 decided, 439 killed,
  6 survived, 5 excused, **0 undecided**, 0 refuted, 0 timeoutRetried.

**The bounded form generates 472 mutants where the `while` generated 489.** A mutant of a hand-advanced
index is a mutant of the loop's own termination, so removing the advance removes 17 mutants that only
a timeout could decide.

⚠️ **`git push --force-with-lease` with no refspec failed with exit 128**, because the branch's
configured upstream is `origin/main` — the worktree was cut with `-b … origin/main` and kept that
upstream. The refusal text reads "The upstream branch of your current branch does not match the name
of your current branch". The form that works names both ends:
`git push origin claude/veritysdk-hrn:claude/veritysdk-hrn --force-with-lease=claude/veritysdk-hrn:<old-sha>`.

**Next step.** A detached watcher polls `gh pr view 3988` until no check reads IN_PROGRESS, then prints
the bucket rollup to `ci3988.log`. On a terminal green, post the thread-8 undraft ask, which lints PASS
and waits at `ask8.txt`. Board #1573 records Kestrel holding #3988 DRAFT for the old mutation red, so
the ask carries the new verdict.
