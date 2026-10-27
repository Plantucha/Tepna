# Heron — unit 57 · guardfix

**Status:** PR OPEN 2026-10-26 · **#3946 DRAFT**, head `cc7efc241` · board claim #1368, released #1374 · report #1373 · undraft asked at #1389.

## 1 · Unit

Both stale guards now resolve the edited tree from the command that names the guarded file, not from the hook's own cwd. Unit 56 measured the defect and this unit implements the remedy.

## 2 · Branch and worktree

`claude/guardfix-hrn` at `cc7efc241` in `~/wt-guardfix-hrn`, rebased twice onto the ref. Five explicitly staged paths: both guards, both self-tests and `changes/2026-10-26-stale-guards-read-the-tree-the-command-names.md`.

## 3 · Exact stopping point

The commit stands and every local gate passes. The ledger suite exits 0 and prints "every leg as declared". The brief suite exits 0 and prints "every DENY paired with an ALLOW that differs in one property". `node tools/hook-contract.mjs` exits 0, `npm run test:hooks` exits 0, and the `release-ledger` group passes 9 assertions. Per-file shellcheck counts equal the ref baseline at 0, 1, 1 and 4. I pushed nothing.

## 4 · Next step

Wait for Kestrel to undraft #3946, then watch Kodiak merge it and run `node tools/wt-done.mjs ~/wt-guardfix-hrn`.

The earlier plan, now spent. Then run `node tools/rebase-safe.mjs` in the worktree and confirm the change survived with `git show HEAD:.claude/hooks/guard-stale-ledger.sh | grep -c ledger_clause`. Append the row from `row57.md` in the scratchpad, read the PR number from `gh pr view`, replace the placeholder, push and open the PR.

The body needs a `Rule 0:` line and the `Fleet-Session: Heron` trailer. It must not carry the verb `closes residue` beside the key. Kodiak turns the body into main's commit message, and `tools/residue-ids.mjs:143` then claims a closure the ledger may not yet carry (board #1370). Write "remedies row <key>" instead.

Run the full `npm run check` on the final state before pushing, detached under `setsid nohup` with an `EXIT=` sentinel.

## 5 · Open questions

None on this unit. A control tree measures every new leg.

## 6 · Blockers

The one-PR cap is the only blocker. #3920 is a draft and wedged on `mutation (diff-scoped)`. The ruleset names that context, so the PR cannot merge as it stands. If that PR stays wedged for long, the owner may prefer that I close it and land this instead. I never undraft my own PR and I never close one to free a slot, so this is an owner decision.

A rebase will touch neither hook unless another session edits them. `.claude/hooks/` is source, so `rebase-safe` stops on a conflict there rather than resolving it.

## 7 · The doc-search query

`node tools/doc-search.mjs "a guard reads the hook cwd instead of the tree the command names"` scores 0.625 over a flat field and does not find the prior work. The query that works is a `git grep` of the ledger at the ref for `guard`, which returns row `2026-09-10-guard-row-generalised-a-narrow-cause`. Read that row before touching either guard, since it narrows an earlier general claim about the same two files.

Memory: `guard-examines-the-hooks-cwd-not-the-commands`.
