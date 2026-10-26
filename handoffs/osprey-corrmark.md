# Unit `corrmark` — a residue citation says which KIND it is

**Unit.** Row `2026-10-26-a-correcting-row-leaves-no-mark-on-the-row-it-corrects`. A correction points backward only, so a reader of the corrected row never learns of it. Board claim #1459.

**Branch + worktree.** `claude/corrmark-osp` in `wt-corrmark-osp`, base `f6b485eea`. One commit at the tip once the gate reads green; a note cannot carry the sha of the commit that carries it.

**What the measurement changed.** The row asked for a MARK, and `citedBy` already gives one. The pickup read offers both OPEN instances the row names, each beside the correcting row, that row's state and its fan-out. What was absent is the KIND. So the remedy labels each citation rather than adding a second listing.

**Why attribution is per-pair and not per-row.** The row's own figures are row-level: 30 of 258 citing rows carry a correction verb. Re-measured at the ref over 854 rows: 260 name another existing row, 37 carry a verb, and 40 one-sided pairs fall over 34 targets. 16 of those 40 come from 7 citers that name several rows each. 

Over the OPEN targets it inverts: 1 attributable and 4 not. Three of those 4 come from the asking row itself, which names four rows as INSTANCES. A row-level verb test would publish that row as the corrector of three rows it only cites.

**Stopping point.** `tools/residue-ids.mjs` carries `CORRECTION_VERBS`, the `kind` field on every `citedBy` entry, `keysWithKind`, two informational verdict fields and the report line. The selftest reads `all 92 selftests passed`. Biome and typecheck are clean against the 93-diagnostic control. The full `npm run check` runs detached to the scratchpad `corrmark-check.log`.

**Two things the gate taught this unit.** The citation gate reds on a synthetic key the selftest
invents, because `row(` in the fixture source is itself a citation word and a key above the ledger
floor names no row. Dating the four fixtures before the floor costs the baseline no declared debt;
it stays at 36 entries, and the scanner's own selftest documents the floor as the fixture mechanism.
The second: `tools/residue-citations-baseline.json` arrived in #3943 today. An earlier note of mine
withdrew a bullet about that file for naming something absent, and that read checked a worktree base
rather than the ref. Measure a file's absence at `origin/main`, never at your base.

**Next step.** Read the `EXIT=` line out of that log. The slot queue is #3964, then `harnesstext`, then this. When its turn comes: rebase, verify survival with `git show HEAD:tools/residue-ids.mjs | grep -c CORRECTION_VERBS`, close the row inside that same push, and open the PR.

**Open questions.** The verb set is a convention the ledger states nowhere, so the count is a floor and never a census. Whether to state it in `CLAUDE.md` §📌 or leave it in the tool is the owner's call; the tool says which it is.

**Blockers.** The one-PR cap alone. The two counts overlap by construction, so a reader must not sum them; the report and the verdict comment both say so.

**Doc-search query.** `a residue pickup reader annotates a row that a later correcting row names`

Fleet-Session: Osprey
