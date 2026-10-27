# Unit `citecheck` — the code-to-row residue citation gate

**Rule 0:** `node tools/doc-search.mjs --read "a cited residue key outside the ledger resolves to no row"` → best 0.807 over a flat field; `ext:memory/cite-the-pr-not-the-unlanded-row.md`, then `tools/residue-cite-drift.mjs:17-34`, then board #651. The prior art judges the other direction, so the gap held.

## 1 · Unit

Gate whether a residue key cited in code resolves to a row, over one pre-stated ladder.

## 2 · Branch, worktree, commits

`claude/citecheck-osp` @ `3e05af60a` in `wt-citecheck-osp`, base `548faa19c`, pushed. Two commits: the gate, then the row. **PR #3943, DRAFT.** Kestrel undrafts it; I never undraft my own.

## 3 · Exact stopping point

`npm run check` ALL 41 steps PASS at `1e69bd368` (suite 14,306 assertions over 828 groups). `capture-host/check.sh` exits 0, coverage 100 percent, mypy 0 against the 0 baseline. The first CI round reded `PR body + changeset compliance`. `RULE0_RE` is `/^Rule 0:/m`, so a bolded `**Rule 0:**` opening carries no accepted line. The corrected body is live, and an empty commit `db1215bc1` re-triggers the gate, since the gate reads the trigger payload.

## 4 · Next step

Read the terminal conclusion of `shard-union + build + provenance` on #3943. A cancelled shard needs nothing; a real red needs the log. Then wait for the undraft.

## 5 · What shipped

`tools/residue-citations.mjs`, step 6 of 41, scoped by the convention: a date-slug token counts when a citation word sits within 40 characters before it. Ladder — exact, then the previous line joined to the current one, then a unique prefix, then a near miss. A join may only resolve a citation, never red it. The test asks whether the HEAD portion resolves alone. The floor reads the ledger's earliest row, so a fixture dated below it stays invisible.

Census at this head, over 462 files and 839 rows: 1370 citations. 1102 exact, 178 joined, 42 prefix, 0 near, 1 ambiguous, 47 dangling, 36 declared. `tools/residue-citations-baseline.json` declares the debt by KEY over four classes, and the set may only shrink.

## 6 · Open questions

Kestrel owes four cells on a RESIDUE-only PR (board #1378). Three rows take a #3943 fix cell: the dangling-key-check row, the prefix row, the one-day-off row. The audit-key-shape row takes an answered cell against #3943. Two rows stay OPEN by design, since both ask for NEW rows rather than a resolver.

## 7 · Blockers

A rebase conflicts on `tests/dex-tests.js` for nearly every parallel PR. Restore the ref's copy, then re-run the insertion after the `'every ledger reader splits on unescaped pipes only'` group. Verify with `git show HEAD:tests/dex-tests.js | grep -c code-to-row`.

## 8 · The doc-search query

`node tools/doc-search.mjs --read "a cited residue key outside the ledger resolves to no row"`.
