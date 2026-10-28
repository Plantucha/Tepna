# Magpie — adoption-population measurement (no PR)

**State 2026-10-25 15:50Z.** Measurement only. Row
`2026-10-22-the-adoption-population-is-keyed-on-a-literal-word-anywhere-in-the-file`, OPEN at the ref.
Board finding **#1207**. I hold #3914 under the one-PR cap, so this unit opened none. Worktree
removed, branch deleted, no commits anywhere.

Measured at `origin/main` = `bdc34c97d` in a fresh worktree.

## The verdict

The row holds. Its named set does not.

- The gate enumerates **308 of 861** tracked files in the three globs.
- **7 real publishers are invisible to it**, every one a `tools/*.mjs` calling `populationVerdict`
  at a live call site: `pat-finger-coupler`, `pat-hrv-windows`, `pat-window-scaling`,
  `tch-bootstrap-ci`, `tch-fused-corpus`, `tch-reference-validation`, `tch-window-sensitivity`.
  None is in `tools/verdict-adoption.json`.
- Of the row's six: **4 still hold**; `pat-dip-validate.mjs` now carries a literal word and is in
  the population; `pat-host-offset.mjs` builds no verdict by any route at this ref.
- **58** files enter the population with their only verdict word inside a comment. Lower bound.
- `check()` at `tools/verdict-adoption.mjs:153` reds `STALE row` for a manifest row the grep misses,
  so the enumerator must widen BEFORE anything can be binned. One PR, not two.

## What cost me the most

🔴 **My first instrument reproduced the defect it measured.** I keyed the publisher set on the
string `tepna.verdict/1` anywhere in a file — the gate's own rule with a different word. It read
**149**. Comment-blanking took it to **94**. Reading the nine remaining candidates line by line took
it to **7**. Two survivors were prose saying the file emits NOTHING (`tools/repo-map.mjs:21`,
`capture-host/devfloors.py:22`).

⚠️ **A Python docstring is not a comment.** `blankPyComments` blanks `#` lines only, so module prose
survives it and still answers a text census.

⚠️ **The glob reaches further than the contract says.** `docs/VERDICT-CONTRACT.md:144-153` calls the
three globs non-recursive. A git pathspec `capture-host/*.py` matches a slash, so **85** files under
`capture-host/tests/` sit in the population. The doc and the gate disagree; the gate wins.

## Next step

Whoever takes it: widen `enumerate()` to a call-site test over comment-blanked source, bin the 7 in
the same diff. Start from the seven names and the call sites in #1207.
