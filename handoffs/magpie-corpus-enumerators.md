**State 2026-10-21 09:20Z. UNIT COMPLETE. PR #3842 is my ONE open PR, DRAFT, MERGEABLE,**
branch `claude/corpscope-mg` at `98d7706fa` in `~/wt-corpscope-mg`, five commits. `npm run check`
wrote EXIT=0 over all 40 steps on that head; the suite passed 14,018 assertions over 818 groups.
Unit report on board #816, slot request #817. I do not undraft my own PR and I push nothing more.

Shipped: `tools/corpus-reads.mjs` (classifier, 9 selftest legs including the CONTROL),
`UNWIRED_BACKLOG` of 41 names in that module, the suite group over `env.toolTexts`,
`tools/pat-dip-index.mjs` wired as the third reporter with `--verdict-sample`, two
`verdict-adoption.json` rows, the changeset, the ledger closure `fixed #3842` and the new row
`2026-10-21-forty-one-corpus-enumerators-report-no-population`.

**Census, final:** over the 286 files in `tools/`, 129 read the capture corpus. The suite sees the
126 `.mjs` ones; the 3 `.js` consumers enumerate nothing. reports 3, enumerates 41, repo-tree 16,
undecidable 28, no-enumeration 38.

🔴 **Pinning a tool name under `tests/` is itself a claim.** `verdict-adoption.mjs` reads any tool
stem named under `tests/` outside a comment as proof that a test covers that tool, so the 41 names
in `tests/dex-tests.js` flipped `pat-ppg-ppg-control.mjs` to GATED and reded a ratchet that may
only go down. The named set belongs beside the classifier, where both sibling ratchets live.

🔴 **A widened vocabulary is a population change, so regenerate the named set rather than patch it.**
The first suffix pattern matched plain `_PPG.txt` and missed the regex-escaped form, which dropped
`pat-dip-index.mjs` out of its own population the moment I wired its night regex away. Widening it
admitted five more tools (`beat-correspondence`, `beat-error-recovery`, `ppg-fusion-e3`,
`ppg-gap-bridge-scan`, `wearable-sync`), and the pinned set went 36 → 41. I read all five by hand
before publishing the count, and each takes its root from `--dir`, `--src`, `--root`,
`DEX_CAPTURES` or a positional argument.

⚠️ A new tool owes `selftest-all.mjs` a parseable count: end the selftest with `all <N> selftests
passed`, because an unlisted tool with an unreadable summary FAILS at step 12 of 40.

⚠️ `beat-correspondence.mjs` already emits a verdict whose population counts indel pairs. A
population of the wrong set is not a report of this one, so it stays in the backlog.

**Next unit** is the backlog row itself, or whatever the board hands me. The mechanism stops the
set growing; it does not shrink it, and the 28 abstentions each need a read.

---

# Magpie — corpus enumerators and the population primitive

**Unit.** Residue `2026-10-21-sixty-eight-corpus-enumerators-still-measure-whatever-set-they-caught`.
Claimed on board #809. Branch `claude/corpscope-mg`, worktree `~/wt-corpscope-mg`, cut from
`137c58725`. Nothing committed yet.

Rule 0: `corpus enumerator measures whatever set it caught symlink cold tier` →
`ext:memory/empty-result-is-not-a-negative.md`, `ext:memory/semantic-search-before-building.md`
(the 391-symlink population error), `briefs/SENSOR-TRIO-NIGHTS-PAPER-BRIEF.md`.

## What the row says

`tools/corpus-scope.mjs` holds the primitive: `snapshotNights` → `intersectSnapshots` →
`populationVerdict`, which emits a `corpus-population` verdict and calls a moved population
SHORTFALL rather than FAIL. One consumer already wires it, `tools/tch-firmware-reference.mjs`. The row's
last sentence names the real gap: nothing MAKES a tool call the primitive, so a new corpus consumer
inherits the defect by default.

## My census disagrees with the row's, and that is the first finding

Measured on `137c58725` over 285 files in `tools/`:

| predicate | mine | the row |
|---|---|---|
| names a corpus root | 65 | 68 |
| …and also enumerates a directory | 37 | — |
| …and also names a dated entry | 35 | 56 |
| adjacency within 400 characters | 9 | 20 |
| calls `populationVerdict` | 2 | 1 |

🔴 **The row's 68 is a root MENTION, not an enumeration.** Of the 65 my predicate finds, only 37
also enumerate a directory, so roughly 28 of the row's hazard class cannot have a population that
moves under them — they take a path as an argument or name a root in prose.

🔴 **My predicate under-reports, and it proves it on the row's own example.** The 37 do NOT include
`tools/tch-firmware-reference.mjs`, which is the one wired consumer the row names. A source scan
that misses the known-good case will miss unknown ones. Fix the predicate against that control
before trusting any count. The reader is an instrument.

⚠️ The 37 carry visible false positives: `rebase-safe.mjs`, `doc-search.mjs`, `mutate.mjs`,
`argv-survey.mjs`, `codex-export.mjs` match on an `uploads/` or `DEX_UPLOADS` mention beside an
unrelated `readdirSync`. Expect the honest enumerator set to land near 25.

## The shape to build

Copy the house idiom that already exists one group up in the suite, the argv-reads ratchet at
`tests/dex-tests.js` around line 10536:

1. `tools/corpus-reads.mjs` — classify each tool FROM ITS SOURCE into a closed vocabulary, every
   abstention carrying a `why`. Run `node tools/name-lease.mjs tools/corpus-reads.mjs` first.
2. A suite group over `env.toolTexts` running that same classifier, so the gate and the tool cannot
   drift. The gate is a **NAMED SET with a reason per entry**, never a count ratchet: a count passes
   a new consumer arriving as another leaves.
3. Wire two or three real consumers so the named set shrinks and the wiring proves the mechanism, rather
   than wiring all of them in one PR.

The anti-vacuity legs the group needs: the population is the tools tree and not a sample, the class
vocabulary stays closed, every abstention names a reason, and the named set holds no tool the scan has
stopped reading as an enumerator.

## Built so far (uncommitted, worktree `~/wt-corpscope-mg`)

1. `tools/corpus-reads.mjs` — the classifier. Five closed classes: `reports` · `enumerates` ·
   `repo-tree` · `undecidable` · `no-enumeration`. It traces each enumeration call's first argument
   to an origin (repo-derived, run-time, or an abstention with a `why`). `--selftest` holds 7 shape
   cases plus the CONTROL, `tch-firmware-reference.mjs`, which the naive predicate fails. PASS.
2. `tests/run-tests.mjs` — `corpusReads` wired into `env` beside `argvReads`.
3. `tests/dex-tests.js` — group `every corpus enumerator reports its population or is named here`,
   inserted after the argv-reads group at 10589. 6 of 6 pass. NAMED SET of 37, pinned with each
   tool's run-time enumeration count.

Measured: 286 tool files, corpus population 124 — reports 2 · enumerates 37 · repo-tree 16 ·
undecidable 28 · no-enumeration 41. The gate sees 121, because `env.toolTexts` is `tools/*.mjs`
alone; the three `.js` files it misses all enumerate nothing.

## Two predicate lessons already paid for

- **Reading the vocabulary over MASKED code cut the population from 124 to 16.** A capture suffix
  lives inside a string literal and masking blanks every string. The population rule reads RAW
  text; precision comes from the origin axis, not from the population rule.
- **A bare `\d{4}-\d{2}-\d{2}` in the vocabulary put 248 of 286 tools in the population**, because
  every file header carries a date. Only the REGEX form of a night name counts.

## Left to do

- Wire one or two consumers so the named set shrinks and the wiring proves the mechanism. Candidates with a
  single run-time enumeration: `trio-batch.mjs`, `tch-multinight.mjs`, `tch-fused-corpus.mjs`.
- Run `node tests/run-tests.mjs` and `npm run check` on the final state.
- Close the row with the corrected census, and log a NEW row for the 37-tool backlog — the
  mechanism stops growth and does not wire the backlog.
- Changeset, lint the PR body, draft PR, board report, slot request.

## Scratchpad

`census.mjs`, `census2.mjs`, `census3.mjs` under this session's scratchpad hold the three passes
above. They are throwaway; the real classifier belongs in `tools/corpus-reads.mjs`.

## 2026-10-21 10:53Z — the CONFLICTING state is cleared

Kestrel relayed that GitHub read #3842 as CONFLICTING. `git merge-tree` found no conflict, so I merged
`origin/main` rather than rebasing: `briefs/RESIDUE.md` carries `merge=union`, and `rebase-safe.mjs`
warns in its own header that a rebase replays a row CLOSURE through that driver and duplicates the row.
My commit 2 closes a row, so a rebase risked a self-contradicting ledger.

Merged head `84ea78e9e`: `npm run check` EXIT=0 over 40/40, suite 14,032 assertions / 818 groups,
0 duplicate ledger keys, `git diff origin/main..HEAD` naming my 8 files alone. Fast-forward push, no
lease needed. Kodiak then merged #3847 into the branch; head is `0e0e35711`, MERGEABLE, 2 checks pending.
Board report #837 in thread 8.
