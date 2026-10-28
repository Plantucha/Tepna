# Magpie — unit `adoptwiden`

**Row:** `2026-10-22-the-adoption-population-is-keyed-on-a-literal-word-anywhere-in-the-file` (OPEN at the ref)
**PR:** #3927 (DRAFT) · **Branch:** `claude/adoptwiden-mg` @ `9bce30c12` · **Worktree:** `wt-adoptwiden-mg` (sibling of the primary checkout) · **Base:** `28bfedc63`
**Rule 0:** `verdict adoption gate enumerator publication rule over comment-blanked source` →
`ext:memory/a-text-census-counts-the-text-explaining-it.md:28-41`,
`briefs/VERDICT-CONTRACT-2026-09-21-BRIEF.md:89-104`, `ext:memory/guards-read-prose-as-code.md:32-47`.
Sized in `handoffs/magpie-adoptpop.md` (board #1207); this unit is its remedy.

## What changed

`enumerate()` read decision words over raw text. It now reads PUBLICATION over comment-blanked source:
a verdict word, a quoted `tepna.verdict/1` literal, an import of `verdict.js` or of the box-side
`verdict` module, or a call to a verdict builder imported from a file that does one of those.

| | rows |
|---|---|
| before | 308 |
| after | 267 |
| dropped | 50 — 22 `word-only/exempt`, 28 `test/exempt` |
| joined | 9 — 7 `builder:populationVerdict`, 1 `contract`, 1 `schema` |

Four of the nine print the object already and land `adopted` with a corpus-free `emits.cmd`
(`--verdict-sample`). Two print it only behind the corpus and stay `pending`. Two print prose derived
from the object, so they bin `decides` — no source grep could ever see them, because their decision
word exists at run time alone.

## Why the narrowing is safe, measured not argued

Zero of the 50 dropped files keep a verdict word after comment blanking, and every one was an exempt
row. The gate agrees: 148 adopted at the merge base, 148 kept, 0 de-adopted.

## The three traps, each now a selftest

🔴 **A `def test_*verdict*` NAME IS NOT A BUILDER.** Prototype v1 harvested Python test names and
admitted 11 files that publish nothing. A builder must be IMPORTED, and `test_*` names stay out.

🔴 **A PYTHON DOCSTRING SURVIVES COMMENT BLANKING, BY DESIGN.** `blankPyComments` blanks `#` lines, so
`capture-host/devfloors.py` entered on a backticked schema mention inside module prose — prose that
says the file emits NOTHING. The schema arm now demands a QUOTED literal.

🔴 **MY v3 DROPPED A LIVE `decides/adopted` ROW, AND THAT IS THE SHAPE TO FEAR.**
`capture-host/tools/mutate.py` fell out because my import reader saw only single-line
`from X import …`, never `from mutation_sweep import (\n …)` or `import verdict as VD`. A widening
can NARROW somewhere else, so diff the enumerated set BOTH ways and read every DROPPED name against
its bin before believing the rule.

## The suite leg

It no longer names the eight publishers. It reads `WORDS`, `SCHEMA_LITERAL` and `CONTRACT_JS` out of
the gate's own source, blanks comments with `env.jsLex`, and asserts the invisible set is EMPTY. An
anti-vacuity floor holds the builder population above 20, and a planted comment-only mention must stay
invisible. The real-tree selftest assertions DERIVE the builder-admitted set from `treePublications`
rather than freezing a list of names, because a frozen cell ages.

**Plant:** reverting `bareSource` to raw text reds 5 of the 113 selftests, including both real-tree
legs. Restoring gives 113/113.

## Docs

`docs/VERDICT-CONTRACT.md` §Producers and the brief's adoption-gate paragraph state the rule the gate
runs. Both correct the old "non-recursive" wording: the three globs are git pathspecs, so
`capture-host/*.py` reaches `capture-host/tests/` (85 files), while the gate filters `tools/` and
`tests/` itself.

## Gates

- `node tools/verdict-adoption.mjs --check` ✓ · `--selftest` ✓ 113
- `npx --no-install biome check` ✓ on both changed JS files
- `node tests/run-tests.mjs --group=corpus-reads` ✓ 39 assertions
- `npm run check` — result appended below and posted as a PR comment

## Not in this PR

The row's closure. A code PR does not touch the ledger here, so `fixed #3927` rides the RESIDUE-only
PR Kestrel sequences. Also owed from the sizing: `tools/verdict-adoption.json`'s two `pending` `tch-`
rows need a corpus-free `emits.cmd` before they can adopt.

---

## FINISHED 2026-10-25 23:20Z — head `f495f575f`, all 40 steps pass, PR #3927 still DRAFT

`npm run check` ✓ all 40 steps, suite 14,250 assertions over 826 groups. Gate reads 267 rows, 135
`decides` producers with 131 gated, 148 adopted kept and 0 de-adopted, byte form canonical.

🔴 **THE FIRST RUN RED AT STEP 12, AND IT WAS MY DIFF.** Widening the population bins
`tools/tch-bootstrap-ci.mjs` as `decides`, and `UNGATED_RATCHET` reds a `decides` producer with no
test. The gate states the remedy itself: add its selftest in the same PR that bins it. **A widening
therefore costs a selftest per newly-binned `decides` producer** — size that into the next one.

The selftest is corpus-free and seeded: 12 assertions over the generator, the moving-block resampler,
the percentile and the TCH split, three of them controls. The ordering case injects a pre-stated
0.3 / 0.6 / 1.2 bpm and recovers 0.30 / 0.58 / 1.11.

⚠️ **I GUESSED THE KNOWN ANSWER AND THE CODE KNEW BETTER.** My control asserted the negative-split
alarm on three identical series. The classic split returns exactly 0 for each node — correct, since
identical copies carry no independent noise. Measure the known answer before pinning it.

---

## REBASED 2026-10-26 02:00Z — head `da9d31805`, Kodiak's base merge `6ac949b1d`, all 40 steps pass

Order from Kestrel: #3927 read DIRTY against main. `node tools/rebase-safe.mjs` stopped on the one
source conflict it stops on by design, `tests/dex-tests.js`, and aborted cleanly.

Resolution per §2c, scripted: write main's copy whole, replace the one leg block by exact string
match, `git add`, `git rebase --continue`. Proof it kept both sides — `git diff origin/main HEAD --
tests/dex-tests.js` is **one hunk**, mine.

🔴 **A REBASE OF AN ENUMERATOR WIDENING IS NOT A TEXT MERGE — IT CHANGES THE DIFF.** #3926 and #3931
wired `populationVerdict` into three more runs while the branch was out (`motion-rho-vs-minrho`,
`tch-minrho-corpus`, `pat-literature-spec`). None carries a literal decision word, so main's gate
still cannot see them and mine read **UNBINNED** for all three the moment the rebase landed. The
manifest is 308 rows → **270**, joined **12**, of which ten are `populationVerdict` call sites. The
doc paragraph and the PR table carried 267/9 and had to be re-measured, not re-typed.

⚠️ **AND THE LEG I RE-APPLIED CARRIED A FROZEN NUMBER MAIN HAD ALREADY RE-MEASURED.** My comment said
eight invisible builders; main's same-day edit of the same leg read eleven. I measured at this ref
instead of taking either side: **eleven of 43 builders**. A count inside a comment ages exactly like a
residue cell.

Gate after the rebase: `✓ check — all 40 steps passed`, suite **14,260 assertions over 826 groups**,
`verdict-adoption: 270 enumerated · 270 binned · adopted 155 · 148 kept · 0 DE-ADOPTED · byte form
canonical`. Pushed with `--force-with-lease`; Kodiak then merged main in (benign §2d case, my commit
contained). PR body re-measured and ste-lint clean. Board note #1338 on thread 8.

Still owed, not in this PR: the row closure `fixed #3927` on Kestrel's RESIDUE-only PR, and an
`emits.cmd` for the two `pending` `tch-` rows.
