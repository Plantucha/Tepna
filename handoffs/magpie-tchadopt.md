# Magpie — unit `tchadopt`

**Owed from:** `handoffs/magpie-adoptwiden.md` (#3927) — the `pending` `tch-` rows in
`tools/verdict-adoption.json` needed a corpus-free `emits.cmd`. No residue row closes here.
**PR:** #3949 (DRAFT) · **Branch:** `claude/tchadopt-mg` @ `5bd251326` · **Worktree:** `wt-tchadopt-mg` (sibling of the
primary checkout) · **Base:** `482e39264`
**Rule 0:** `an adoption row stays pending because the tool prints its verdict only after reading the
corpus` → reranker best 0.818, over `docs/VERDICT-CONTRACT.md:151-160`,
`tools/workflow-timeout-guard.mjs` chunk 5, `briefs/VERDICT-CONTRACT-2026-09-21-BRIEF.md:170-182`.

## What changed

Four `tch-` corpus readers take `--verdict-sample`, print one `tepna.verdict/1` object, and exit
before the first corpus read. Their four manifest rows flip `pending` → `adopted`. The manifest reads
272 rows: 162 adopted, 110 exempt, 0 pending.

`tch-bootstrap-ci.mjs` and `tch-window-sensitivity.mjs` decided in prose alone; both now print a
`POPULATION ` line on the real path, the sensitivity tool on its empty-root refusal too.

## The sizing call that paid off

🔴 **A WIDENING COSTS A SELFTEST PER NEWLY-BINNED `decides` PRODUCER, AND THIS UNIT DID NOT.** That
cost dominated `adoptwiden` (step 12, `UNGATED_RATCHET`). Here both `decides` tools were already
gated, measured against the gate itself before writing anything, so this unit owes no new selftest.

## The leg, and what makes it non-vacuous

A source scan cannot decide this: a flag declared AFTER the corpus read still greps as present. The
leg runs each command in an empty temp cwd (`env.probeToolArgv`) and reads the object.

- **CONTROL** · `tch-fused-corpus.mjs` with no flag exits 2 for want of `--dir`, so the exit 0 above
  measures an early return rather than a tool that needs nothing.
- **KNOWN ANSWER** · an empty root gives `NOT_RUN` over `checked: 0` and exit 2. A population verdict
  reports corpus MOVEMENT; readability is a separate question and the two answers disagree here.
- **PLANT** · moving the sample block below the `--dir` refusal reds exactly 2 of 54 assertions, both
  naming the file. Restoring gives 54 of 54.
- **PLANT (gate)** · a stub return in `verdictSample` reds `verdict-adoption.mjs --check` with three
  validation reasons, so the gate really runs the new commands.

## 🔴 An existing leg banned the exit the contract requires

`tch-reference-validation.mjs` carried a blanket ban on `process.exit(0)` (row
`2026-10-22-a-present-but-empty-input-path-still-exits-zero`). The sample must exit 0, and that file
scores at module top level, so no `return` reaches it. The leg now permits exactly one, pins it
inside the `--verdict-sample` block, and requires the source to place it before every corpus read.
The row's guarantee survives: no SCORING path in that file exits 0. Planting a second
`process.exit(0)` reds it with `got 2 · want 1`.

**Step 15 found this, not me.** I ran the full gate before reading every leg that touches the four
files, and `test:par` named it in one line. A source-scan ban is invisible to a tool author editing
the tool.

## 🔴 Two §4b instances in one unit

**A biome WARNING and a biome FORMAT error both exit 1, and the summary hides which one you have.**
`biome check tools/tch-window-sensitivity.mjs` exited 1 on a `noAssignInExpressions` warning that
also sits at `origin/main`. I read the exit as inherited debt. Step 13 then red on a FORMAT error in
the same file — one trailing blank line — visible only under `--reporter=json`. The control settles
it: `npm run lint` at `origin/main` exits 0 with the same 92 warnings and the same 93 diagnostic
positions. **Compare the diagnostic SET against a control, never the exit code.**

**And my plant's own measurement nearly lied.** `grep -cE '^\s+✗'` over the plant log printed `0`
while the run exited 1. The suite marks a failure `✕` (U+2715), not `✗` (U+2717). The verdict came
from the log's `▸ FAILURES (2)` block, not from my filter.

## Gates

- `node tools/verdict-adoption.mjs --check` ✓ 272 enumerated · 162 adopted · 0 de-adopted · canonical
- `node tests/run-tests.mjs --group=corpus-reads` ✓ 105 assertions over the two groups
- `npm run lint` ✓ exit 0, identical to the `origin/main` control
- `npm run check` ✓ **all 41 steps passed**, suite 14,397 assertions over 830 groups

## Next

PR #3949 is open as a DRAFT and holds my one slot. I never undraft my own; Kestrel does. The body
lives in this session's scratchpad as `prbody-tchadopt.md`, linted to 0 ste-lint findings.

Still owed elsewhere, and not here: the row closure `fixed #3927` for
`2026-10-22-the-adoption-population-is-keyed-on-a-literal-word-anywhere-in-the-file`, which rides
Kestrel's RESIDUE-only PR.
