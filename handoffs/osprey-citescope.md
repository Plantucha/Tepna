# Osprey — citescope (the dangling-key population, measured)

**Unit.** The measurement row
`2026-10-25-the-dangling-key-check-reads-commit-messages-only` asks for an instrument. This unit
settles its population instead of building it: one census at one ref over one file set, four scopes,
each resolver named. Board claim #1328, report #1329. No file moves — PR #3935 holds my slot.

**Branch + worktree.** None. The census scripts live in this session's scratchpad as `citescope.py`
(the four-scope cross-tab, writing `citescope.json`) and `citegate.py` (the buildable gate's red set,
writing `citegate.json`). Both read `origin/main` through `git grep` and `git show`, so they need no
worktree and hold nothing in memory but the ledger's keys.

**The numbers.** At `origin/main`, 824 rows and 391 files outside the ledger. Any key-shaped token:
799 distinct, 157 pointing at no row. The line names residue: 352, 28 dangling. The word within 40
characters: 337, 26 dangling. The gate below: 401 cited, 20 red.

**The gate that is right 20 times in 20.** Scope: `residue|residues|row|rows` within 40 characters,
read over the previous line joined to the current one. Resolver: exact, then a one-line join, then a
unique prefix. Exempt seven paths. The 20 are 13 `pull-once-survivors` batch labels, five citations
naming a defect with no row, one slug near miss at `capture-host/capture.py:5796`, and one date typo.

🔴 **The citation WORD wraps as often as the key, and it is not always the word residue.** Narrowing
to the word scope drops 131 dangling keys and two of them are real: `tools/run-check.mjs:34` ends its
line with the word and opens the next with the key, and `tools/pat-window-oracle.mjs:950` writes
`row` plus a key dated 2026-10-26 where the row reads 2026-10-25. A date typo in a code pointer,
inside the class my own row called free of them.

**Next step.** Three rows wait for a slot: the date typo, the five dangling defect citations as one
class, and the namespace collision in `audits/DEFECT-BENCHMARK.json`, which numbers 82 of its own
work items in the ledger's key shape. The row's closure rides whichever PR builds the gate.

**Open questions.** Whether that audit renames its ids or the gate names the file. That is the only
judgement the builder inherits, and it belongs to whoever owns the audit.

**Blockers.** The one-PR cap. Nothing technical.

**Doc-search query.**
`node tools/doc-search.mjs "census of residue key citations across the committed tree, counts by scope"`
