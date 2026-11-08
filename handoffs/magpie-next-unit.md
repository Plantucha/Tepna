# Magpie — handoff, 2026-11-08 09:30Z

## State

- **One open draft with a `-mg` head: #4593** `claude/citeptr-mg`, worktree `~/wt-citeptr-mg` — the
  cite-drift line-count fix. `npm run check` green over 53 of 53 steps. I never undraft my own.
- **Merged on 2026-11-08, both trees retired with `node tools/wt-done.mjs <path>`:**
  - **#4585** `claude/aliasnorm-mg`, worktree `~/wt-aliasnorm-mg`.
    The V-4 fix: `cpapdex-registry.js:358`'s alias key `'epr Δ'` carried U+0394, and `idForLabel`
    normalises before it reads the table, so no spelling reached the row and `badgeForLabel`
    fabricated an `experimental` tier over a `measured` metric. Plus suite group 902, which asserts
    that each of 773 alias keys over 9 tables resolves to the id its own table declares.
    CI 28 pass / 1 skipping / 0 fail. BEHIND, which is serialising, not stalling.
  - **#4577** `claude/resrows-mg` @ `9c721375b`, worktree `~/wt-resrows-mg`. The ledger
    batch, three rows, none closed. CI 27 pass / 2 skipping / 0 fail.

## Next, in order

1. **V-3, the depth substitution.** `oxydex-registry.js` declares `depth: 'secondary'` on 20 of its
   173 entries; `DEPTHS` holds `basic`/`advanced`/`research`, so `metric-registry.js:101` publishes
   `'advanced'` for all 20 and says nothing. `entry()` warns on the ABSENT branch at `:86-93`,
   naming the very default it applies, and stays silent on the present-but-invalid one.
   Two shapes, and they cost differently:
   - correcting the 20 declarations to `'advanced'` changes no published value and re-bundles
     OxyDex alone — but a registry edit is a COMPUTE-CLOSURE edit, so budget ~7 min for bare
     `node tools/verify-fixtures.mjs` to re-stamp the OxyDex fixtures;
   - adding the absent warn to `metric-registry.js` is SPINE work (8 of 8 bundles, §👥.3) —
     say so on the board first, and land it before any node-local work.
   The row is `2026-11-08-twenty-oxydex-depths-declare-a-value-the-engine-replaces-in-silence`.
2. **The closure finding** — `manifest-gate.js`'s `DISPLAY_ONLY` has no `*-overview.js` pattern, so
   `isComputeAsset('pulsedex-overview.js')` fail-closes true. The fail-closed default is RIGHT; the
   absent pattern is the defect, and #4547 paid it (`verifiedUnder` `df1a859f7009 → f0234bec980d`
   in `cb5ebb97d`). Row `2026-11-08-the-compute-closure-denylist-has-no-overview-pattern`.
   Treat a change here as a deliberate computeHash move, with the re-verification owed.
3. **Lane R remainder.**
4. **Noted, not claimed:** board #4460 reports that the ledger dropped a row about a yield pin that
   does not read the re-run cohort size, so that defect is free for another bird. This note gives the
   defect and not the key, because `residue-citations` reads a handoff too, and it reds a key that
   holds no row. Measured 2026-11-08 against this very line: it reds `npm run check` at step 6 of 53.

## Open questions

- None for the owner.

## The doc-search query that found the prior work

`node tools/doc-search.mjs "registry label alias key normalisation lowercase lookup unreachable"`
→ the nine `*-registry.js` `idForLabel` bodies; no prior work on the defect itself.

## 🔴 Read THIS file before trusting a lane label in my state file

My state file's queue line read "V-3, V-4 and the shorthand-census closure" and defined none of the
three. The definitions were here all along, in the previous revision of this handoff, and I rebuilt
the batch from scratch because I read the state file and not the handoff. The index is the memory;
the note is what the index finds. Write the defect into the queue line AND read this file first.
