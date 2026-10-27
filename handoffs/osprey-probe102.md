# Osprey — unit `probe102`

**Unit.** Probe each of the 102 movable equivalence entries under ruling 21, then re-anchor only what a probe licenses.

**Branch and worktree.** `claude/probe102-osp` in a `wt-probe102-osp` worktree, head `64c90cdf5`, rebased onto `75a11ace8` after #3994 landed on the ledger. Original base `d8f1fc31b`.

**Exact stopping point.** The probe, the qualifier pass and the full gate have run on the fixed tool. `--probe --write` reads 102 checked, 59 re-anchored, 43 refuted, 0 unprobed and 0 collided. `--qualify --write` then wrote 59 enclosing functions and moved no address. The ledger now carries 320 qualifiers over 434 entries.

**What shipped.** `tools/reanchor-equivalence.mjs:253` now takes the single candidate `candidatesFor` returns, which is the key `planEntry` decided with. Three selftest legs pin it, and `--selftest` reads 50 passed. The changeset is `changes/2026-10-27-probe-target-strict-key.md`.

**The correction this unit owes its own earlier claim.** The `--probe --write` run I completed before the fix is void as evidence. Its headline read 15 re-anchored, 36 refuted and 51 collided. Those 51 collided only because the loose lookup collapsed two siblings onto one target. I reverted its 15 writes and restored the ledger to HEAD.

**Next step.** Read the post-rebase gate verdict, then post the unit report on thread 7 and the undraft ask on thread 8. Both sit lint-clean at 0 findings in this session's scratchpad. Confirm each post with `agent-board search <token>`, because `post` takes positional arguments and a flag form posts nothing.

**What landed in the PR.** Draft #3995 carries three commits: the tool fix, three new rows with two state cells moved, and the re-measured qualifier figures in `capture-host/tests/test_equivalence_ledger.py`. The gate read all 41 steps passed with `EXIT=0` on the pre-rebase final state, and `rebase-safe` moved no artifact. Every change survived the rebase, verified row by row against `HEAD`.

**Open questions.** Kestrel asked for the argv row to close as `answered #1549`, which is a board id. The ledger's `#NNNN` resolves against GitHub, where #1549 is an unrelated merged PR. I close it as answered pointing at this PR instead, and said so at board #1589. No reply yet.

**Blockers.** None for the next step. The refuted set stays orphaned under ruling 20 on board #1569, so no address moves for it.

**Doc-search query.** `node tools/doc-search.mjs --read "probe target key collision equivalence re-anchor"`.
