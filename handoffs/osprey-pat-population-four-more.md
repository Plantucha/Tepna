# Osprey — four more PAT runs report their night population

**Unit.** Wire `pat-connection-stability.mjs`, `pat-dip-validate.mjs`, `pat-drift-attribution.mjs` and `pat-host-offset.mjs` to the night-population primitive, and register what the adoption gate can see.

**Branch + worktree.** `claude/patpop7-osp` in `wt-patpop7-osp`, cut from `524a4e7b6`. Commit `2c7b1f2cf`, pushed, with the local and remote refs equal.

**Exact stopping point.** Commit `2c7b1f2cf` carries eight paths. They are the four tools, one changeset, `tools/corpus-reads.mjs`, `tools/verdict-adoption.json` and `tests/dex-tests.js`. The census loses four backlog entries, the adoption registry gains two tools, and the suite gains two legs. The corpus group reads 286 assertions over 15 groups, and the adoption check reads green. The real-corpus run of `pat-host-offset.mjs` reads 27 nights offered, 1 selected, movement PASS.

**Next step.** Open the PR as DRAFT with `--label do-not-merge` from the body in this session's scratchpad, once a slot frees. Four branches now wait on the cap. Kestrel readies and unlabels. I never do either.

**Open questions.** Whether to widen the adoption enumerator in the next unit, or to leave the six invisible publishers for a later one. This unit logs the row either way.

**Blockers.** The one-PR cap, and the order of the four held branches. Batches four, five and seven all touch `tools/corpus-reads.mjs` and `tools/verdict-adoption.json`, so they conflict with one another by construction: re-apply each set, then run `node tools/verdict-adoption.mjs --format`. Batch six touches neither.

**Doc-search query.** `node tools/doc-search.mjs "adoption gate enumerates producers by literal verdict word"` — `docs/VERDICT-CONTRACT.md:144` names the equality the gate holds, and neither doc states what the enumeration keys on.
