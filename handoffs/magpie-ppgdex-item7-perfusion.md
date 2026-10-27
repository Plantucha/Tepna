# Magpie — PpgDex punch-list item 7, the ambient-referenced perfusion index

**Unit:** DONE and pushed. DRAFT **#3683**, branch `claude/ambpi-mg` @ `ca268450e`, worktree
`~/wt-ambpi-mg`. Board entry #210. Draft because the non-draft set sits at the cap of 4
(#3678, #3677, #3663, #3659).

**Doc-search that found the prior work:**
`node tools/doc-search.mjs "ambient-referenced perfusion index divides by the detector pedestal"` →
`briefs/PPGDEX-ALGORITHM-DEEP-DIVE-2026-07-21-BRIEF.md:102-122`, `PpgDex Reference.html:396-415`,
`briefs/PPGDEX-O2RING-FINGER-SITE-2026-07-18-BRIEF.md:61-75`.

## What shipped

- `ppgdex-dsp.js` — `perfWindow` takes the epoch span and references the DC term to the ambient phase.
- `ppgdex-morph.js` — `amb` as a trailing optional param on `analyze`, `perWindowMorph` and
  `perfusionIndex`; §∅ `null` when nothing finite remains.
- `ppgdex-app.js` — both colour bands move to the guide's published 2 and 0.5.
- `PpgDex Reference.html` — the formula line gains the ambient term.
- `tests/dex-tests.js` — one group, 8 assertions, which is the whole evidence.
- Brief write-back: `#7 EXECUTED` section, the stale `:2121-2123` anchor corrected, row 7 and the
  claims table ticked, landing order ticked.

## Gates, all on `ca268450e`

`npm run check` 39/39 · node lane 13167 assertions over 793 groups, new group 8/8 · browser lane green,
11532 passed, 808 groups · `verify-fixtures.mjs` stamped `verifiedUnder 88a1677f79c8`.

## Next step

Watch #3683's CI, then undraft when a slot opens. **#3678 (item 6) and #3683 conflict** on
`briefs/PPGDEX-ALGORITHM-DEEP-DIVE-2026-07-21-BRIEF.md` and on `tests/dex-tests.js`: whichever lands
second rebases with `node tools/rebase-safe.mjs`, restores main's `tests/dex-tests.js` and re-runs its
own insertion, then verifies survival by grep.

## Open residue, not in this PR

- The `raw`/`bp` channel mismatch: `raw = rec.ch[sel.idx]` while `bp = perChannel[refIdxUsed].bp`.
  Inert on every committed input; only the harmonic-remap path can part the two indices.
- No PpgDex fixture carries a morphology or perfusion value. `ppgdex-app.js` assembles them, no
  fixture-regen realm loads that file, and the rich export's epoch projection is a whitelist that omits
  `pi`.

Both wait on a RESIDUE-only slot; one such PR runs at a time and peers hold it.

## Carried forward

The measurement refutes item 1's warning that *"#6, #7 and #10 sit upstream like #1"*, for #7 at least. Size #6 and #10
against what actually leaves the node before costing a fixture regen.

Fleet-Session: Magpie
