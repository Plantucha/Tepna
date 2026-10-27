# Magpie — unit `citeres`

**Row:** `2026-10-26-eighteen-residue-citations-outside-the-ledger-resolve-to-no-row` (OPEN at the ref)
**Branch:** `claude/citeres-mg` · **Worktree:** `wt-citeres-mg` (sibling of the primary checkout) · **Base:** `747adae76`
**Rule 0:** `node tools/doc-search.mjs --read "eighteen residue citations outside the ledger resolve to no row"` →
`briefs/RESIDUE.md:893`, `tools/residue-citations.mjs:1-48`, `briefs/RESIDUE.md:373`.

## The subtraction the order asked for

All eighteen keys the row names resolve today, and no PR in this unit repaired one of them.

| discharged by | keys | how |
|---|---|---|
| #3971 | 14 | sibling row `2026-10-25-thirteen-cited-pull-once-survivor-keys-have-no-row`, state `fixed #3971` |
| #4005 | 3 | the dollar-interpretation key, the twenty-five-survivors key, the laundered-count key |
| #3943 | 1 | `2026-09-06-ring-never-resumes`, a near miss repointed at the fileset row |

`git merge-base --is-ancestor` puts #3943's repair after the row's own measurement commit
`0d8483222`, so the row already read stale for that key on the day it landed. The row closes
`answered #PRNUM`, not `fixed #PRNUM`: three other PRs did the work, and a fix cell here would
credit this one with none of it.

## What the row left behind, and it is not the eighteen

🔴 **THE THIRD READER OF THE KEY SHAPE SHIPPED WITHOUT THE CHANGESET RULE.** A row key and a
`changes/<key>.md` filename share the date-slug shape by construction. `docs-ledger` check8h learned
that in #2963 and `tools/residue-ids.mjs` in #3939, each of them from its own residue row. The new
`tools/residue-citations.mjs` carried neither, so four audits quoting a changeset by path read as
four dangling citations.

🔴 **AND THE DECLARED BASELINE EXCUSED ALL FOUR UNDER A REASON THAT WAS WRONG ABOUT EVERY ONE.** Each
of the four `cross-lane` lines read "an audit artifact numbering its own items in this key shape".
One of the four sits in `audits/DEFECT-BENCHMARK.json`, which does number its items that way — and
the token at that site is `"changes/2026-09-21-monitor-chips-derived.md"`, a path. The other three
sit in two further audits, one of them inside a `patch_text` diff. So a declared debt turned an
absent predicate into prose, and the prose named the wrong cause.

🔴 **A BASELINE LINE IS A DEBT, AND A DEBT NEEDS A LIVING OWNER.** All four reasons named row
`2026-10-26-eighteen-…-resolve-to-no-row` as the owner of their remedy, and that row closes in this
diff. Nothing read a reason string, so the pointer could rot where it stood: the next reader follows
it to a closed row and reads the debt as discharged.

## The mechanism

- `scanText` drops a key behind `changes/` or in front of `.md`. Structural, not a heuristic.
- `rowStates(ledgerText)` reads each row's state cell from the end of the row, through
  `splitRowCells` — the one ledger scanner that consumes a backslash pair as a unit.
- `ownerReasons(baseline)` lists every reason-named row other than the entry's own key, and
  `ownerDebt` reds on one that the ledger closed or never held.
- §∅ · with no line naming an owner the verdict carries `ownerReasonsExamined: 0` and the CLI says
  the check examined nothing, rather than reporting a pass over a population of nothing.

## Measured, both directions

The exclusion drops **exactly 4** citations and adds none: `exact` 1264, `joined` 228, `prefix` 43,
`near` 0, `ambiguous` 1 all hold, and `dangling` reads 17 → 13. The baseline shrinks 18 → 14 and
every surviving line is a synthetic key inside the residue tooling's own selftests.

## Plants

Six against `--selftest`, each one redding by NAME rather than crashing: the closed-owner arm
disabled, the state cell read as field six, the self-naming exclusion removed, the orphan count cut
out of `bad`, the changeset rule removed, and the changeset rule widened to the bare word `changes`.
A seventh plant against the suite group reds three legs, the real-tree leg among them.

## 🔴 A NEW LEDGER READER OWES THE SHARED CELL SCANNER

The first draft of `rowStates` split each row on a bare pipe. The suite holds every ledger reader to
`splitRowCells`, enumerates the population by path, and redded by name at step 15 of 41 with
`no ledger reader splits on a bare pipe — got "tools/residue-citations.mjs"`. My own
escaped-pipe leg passed throughout, because reading the cell from the END happens to survive one
escaped pipe in the state cell and nowhere else. **A leg that passes on the case I thought of is not
the rule; the population gate is.** Fixed by importing the scanner.

## Gates

- `node tools/residue-citations.mjs --selftest` ✓ 37 (was 16)
- `node tools/residue-citations.mjs` ✓ PASS, 1549 citations over 565 files against 907 rows
- `node tests/run-tests.mjs --group='a residue key cited in code resolves to a row, by one pre-stated ladder'` ✓ 40
- `npx --no-install biome check` ✓ on both changed JS files
- `npm run check` — one run on the final state, appended below

---

## FINISHED 2026-10-27 13:30Z — head `b0cdcf1d9`, all 41 steps pass, PR #4016 still DRAFT

`✓ check — all 41 steps passed`, suite **14,538 assertions over 833 groups**. The citation gate reads
1554 citations over 567 files against 912 rows, `dangling` 13 against 14 declared, and
`ownerReasonsExamined: 0` with the CLI saying so.

**Three runs, and only the first two cost anything.** Run 1 redded at step 15 of 41 on my own bare
pipe split, which is the §🔴 lesson above. Run 2 redded at step 12 of 41 on
`.claude/hooks/guard-stale-brief.test.sh`, `a payload path is reported as named by the payload`,
`got ABSENT want PRESENT`. **Three controls cleared that one: `origin/main` at `44774865e`, my own
base `ddc5c0961`, and an immediate re-run of the identical tree in this worktree.** So it is neither
the ref nor the diff, so `flake-sightings.md` carries it as a third row. ⚠️ **A second red lands while the first
one is still fresh, and that is when a transient reads as a finding** — run the control before
touching the diff.

## RUN 4 — 2026-10-27, over Kodiak's base merge `cec21dc44`, head `9cd4229c8`

Kestrel undrafted the PR, so Kodiak merged main in and brought Heron's `rejexp` across
`tests/dex-tests.js` and `tests/run-tests.mjs`. Benign §2d case, my commit contained. I merged it
back, grepped all three of my changes to prove each one survived, pushed, and re-gated the merged
state.

The run reads `CR4_EXIT=1` at step 37 of 41, `verify:pr-compliance`, and it names the paragraph
above this one: one `passive` finding from `tools/ste-lint.mjs` on my own new handoff prose.

⚠️ **A PROSE LINTER READS THE HANDOFF I WRITE ABOUT THE GATE, SO THE LAST PARAGRAPH OF A UNIT STILL
COSTS A GATE STEP.** Run `node tools/ste-lint.mjs <file>` on a handoff before launching the gate, and
capture the exit code with no pipe in front of it.

Everything below that step stayed green: the suite reads **14,571 assertions over 834 groups**, and
the citation gate reads 1559 citations over 568 files against 912 rows. The run also skipped four
steps it never reached — `verify:verdict-adoption`, `verify:manifest`, `verify:fixture-currency` and
`test:hooks` — so this run says nothing about them, and run 5 covers them.
