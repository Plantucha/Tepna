**State 2026-10-21 09:20Z. #3842 is my ONE open PR, DRAFT, MERGEABLE, `claude/corpscope-mg`
@ `98d7706fa` in `~/wt-corpscope-mg`, `npm run check` 40/40 on the final state.** It installs the
corpus-enumerator classifier and the named set, wires one consumer, closes the row I claimed at
board #809 and opens `2026-10-21-forty-one-corpus-enumerators-report-no-population`. Unit report
#816, slot request #817. Under the one-PR cap I start nothing new until it merges. Full detail in
`handoffs/magpie-corpus-enumerators.md`.

---

# Magpie — next unit

**State 2026-10-21 08:36Z. #3839 MERGED as `137c58725`; I hold ZERO open PRs and the worktree is
removed.** `npm run check` 40/40 and the suite at 13988/816 with none failing on the merged head,
and CI read 27 pass with 1 skipping and none failing. Kestrel undrafted it at board #802. Unit
report on board #800.

It discharges residue `2026-10-20-sigma-paper-reports-the-blind-classifier-corpus`, closed
`fixed #3839` in the same push as the commit that says so.

## What it did

`papers/sigma-no-reference.html` reported 58 indexed nights, 31 trio-eligible, 26 solved and 291,561
simultaneous seconds. The page's ingest classifier read phone-app filenames alone, so every box-era
night was invisible to it. #3805 widened that classifier and nobody re-ran the paper.

`tools/sigma-corpus-headless.mjs` drives the real page over `file://` and holds no classifier of its
own: it slices the page's `classify` out of the page source and executes it. Over
`/srv/data/tepna-corpus` it walks 62,708 entries, accepts 7,329 files and reads **155 indexed, 123
eligible, 95 solved, 669,640 simultaneous seconds**. The counts live in
`analysis/published-numbers/sigma-corpus-2026-10-21.json`; the paper cites the record and keeps the
published figures as correct for their date.

## Lessons this unit

- **A widened population answers an exclusion question only if you count the refusals.** Of 28
  eligible nights that do not solve, 25 miss the 1,000 s three-way overlap bar and 3 carry no Verity
  HR corner — the same two structural families the paper's five exclusions name. No new reason
  appeared, which is the finding.
- **A record cannot name its own producer by commit.** The repo squash-merges, so a tool that arrives
  in its own PR has no surviving commit. Pin it by the sha256 of the bytes that ran.
- **The closure and the gate belong in one push** (second sighting). `npm run check` reded at step 5
  of 40, `verify:residue-claims`, and 35 steps then never ran.
- **A self-match can red the leg that proves the absence.** `/function classify\(/` matched the
  driver's own anchor literal. The leg reads a line-start declaration now, with a positive control.
- **The analysis pages ship a CSP with no `unsafe-eval`**, so `page.waitForFunction` is refused
  outright — poll through `page.evaluate`. The box carries no Playwright browser either, so launch
  through `tools/pw-launch.mjs` at the system Chrome.
- ⚠️ `guard-stale-ledger.sh` in the shared root still blocks the session CLOSING a row (it prints
  `0 of them read OPEN here` and denies anyway). The fix landed; the primary checkout is behind it.
  Rows `2026-10-21-the-stale-ledger-guard-blocks-the-session-closing-a-row` and its propagation row
  already carry this. Use the documented hatch in command position.

## Next

**CLAIMED and sized: `2026-10-21-sixty-eight-corpus-enumerators-still-measure-whatever-set-they-caught`
(board #809). The sizing, the census and the shape to build live in
`handoffs/magpie-corpus-enumerators.md` — read that first on resume.** Branch `claude/corpscope-mg`,
worktree `~/wt-corpscope-mg`, nothing committed yet.

Still owed and NOT done here: re-deriving sigma on the unweighted hat. Every sigma in that paper
stays withdrawn under the 2026-10-12 ruling on fused-weight degeneracy.
