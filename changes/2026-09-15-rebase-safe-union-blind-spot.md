---
bump: patch
type: fixed
brief: none
---

`rebase-safe`'s contract says *"conflict in a GENERATED path → auto-resolve; conflict in ANY other path
→ STOP"*, and a reader trusts that as absolute. It is not. The whole model is **conflict-driven** — it
enumerates `--diff-filter=U` and can only act on paths git reports unmerged — and a path carrying
`merge=union` in `.gitattributes` **never conflicts**, because the driver keeps both sides. So it cannot
enter that list, the STOP branch cannot fire, and the tool reports success over a corrupted ledger.

A union driver cannot represent an **edit**. Appends merge cleanly, which is what the attribute is for;
but editing a line — closing a `briefs/RESIDUE.md` row's state cell — leaves both the old line and the
new one, and the ledger then contradicts itself about whether the defect is live.

Measured 2026-09-15, and pinned so it stays reproducible after `main` moves: `git merge-tree` of **#2509**
(head `82a75c11`, a one-cell RESIDUE state-cell edit) against `main` at **`2c1c4055`** exits **0 with no
conflict markers** and yields **160 rows against 158 unique keys** — the two duplicated keys being
`2026-09-14-vigil-sh-tests-leak-stub-servers` and `2026-09-14-oracle-mode-search-bound-never-varied`.

⚠️ A rebase is **not** the safe alternative — it replays the diff through the same driver. That half is
**Kestrel's measurement, not mine**: `#2506`'s own rebase duplicated a row, reproduced independently by
Osprey at 160 rows / 159 unique. Attributed rather than absorbed, because a relayed figure that loses its
measurer is how a number becomes unreproducible. So the repo's prescribed remedy for a stale branch is,
for these paths, the instrument that causes the problem.

`.gitattributes` already records this at the `RESIDUE.md` rule, which is precisely where a reader of
`rebase-safe.mjs` will not look. The contract is corrected at the point of use, and `checkUnionPaths`
turns the footnote into a local failure: after a clean rebase it asks **`git check-attr`** which of the
rebased paths carry the attribute — never parsing `.gitattributes`, which has precedence rules and whose
other two union rules are vestigial (the `tests/*-list.txt` snapshots were retired in 2026-07) — and
reports any dated key that now appears twice. It reads the **committed HEAD**, never the working tree: an
untouched tree answers truthfully about itself and tells you nothing about what you are holding.

⚠️ **The negative control is what shaped the detector.** A looser "first table cell" key pattern also
matches RESIDUE.md's *own* row-contract table, whose `key`/`logged`/`state` labels recur legitimately —
so the first draft reported a duplicate on a **clean `origin/main`**. A check that fires on a healthy
tree blocks every rebase and gets switched off, which is worse than not having it. Keys are therefore
matched only in the documented dated shape. Both controls are gated in `tools · rebase-safe-union`:
the positive one is an edit surviving twice, the negative one is the contract table.

This does not replace the existing detection — `docs-ledger` check8c and `residue-ids` both catch the
outcome — it moves the signal from a CI lap later to the moment the rebase completes, and stops the
tool's own contract from reading as a guarantee it cannot make.
