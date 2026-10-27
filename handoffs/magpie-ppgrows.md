# Magpie — the PpgDex residue rows (RESIDUE-only)

**State 2026-10-25 19:55Z. #3922 is my ONE open PR, DRAFT, `claude/ppgrows-mg` @ `0ca9599ff` in
`wt-ppgrows-mg`, cut from `origin/main` at `32f1dd82a`. `npm run check` reads `✓ check — all 40 steps
passed` on the final state.** Claimed at board #1235, after Kestrel sequenced it in reply to my #1227.

Ledger only. `briefs/RESIDUE.md` is the whole diff, three lines, so no code moved and no changeset is
owed (`pr-compliance.mjs:53`).

## What it does

- `2026-09-22-ppgdex-fixture-spread-not-bundle-reproducible` → **`fixed #3914`**. All six PpgDex
  goldens read `spreadMs: null` at `32f1dd82a`, and `recording.hostAxis` is absent from all six.
  #3907 dropped `clock.js` from `PPG_REALM`; #3914 recorded the last one, the corpus-backed fixture.
- `2026-09-29-thirty-five-of-ninety-folded-ring-nights-publish-an-impossible-ppm` → **`answered
  #3914`**, not `fixed`. The row asks for a re-fold and no re-fold ran. #3914 refuted the premise
  under the question instead.
- NEW row `2026-10-25-the-committed-ring-folds-carry-no-drawn-axis-verdict`, measured at the merged
  head over 173 committed `uploads/trio` PpgDex exports: ring rail 74 exports, 38 publish a ppm, 35
  outside 50 ppm, `deviceDrawn` absent in 74 of 74; Verity rail 99 exports, 54 ppm, 0 impossible.

## Lessons

🔴 **A PRODUCER FIX AND ITS ARTIFACTS ARE TWO ROWS.** #3914 made the node publish `deviceDrawn`, and
every committed fold predates it, so the refusal reads a key no artifact carries. Closing the
producer row as `fixed` would have retired the defect while 35 impossible rates still sit in the
tree. Ask what the CONSUMER reads today, not what the producer now emits.

🔴 **`answered` IS THE HONEST CELL WHEN A ROW'S QUESTION DISSOLVES RATHER THAN RESOLVES.** Row 514's
own WHAT IS OPEN clause asks for a re-fold. No re-fold ran, so `fixed` claims work nobody did. What
landed refuted the premise — a drawn counter has no rate to re-derive — and `answered #3914` says
exactly that.

⚠️ **I DROPPED A ROW I HAD PROMISED BECAUSE I COULD NOT REPRODUCE ITS NUMBER.** At #1227 I owed a row
for "the 659 already-folded exports". The repo holds 450 committed node exports in all and 173 trio
PpgDex exports. The figure came from my own earlier PR body and I never measured it. A number I
cannot measure does not go in the ledger; the PR body says so in the open.

⚠️ **A STALE SCRATCHPAD `commitmsg.txt` COMMITTED THE WRONG STORY on the previous unit** — a leftover
from #3907 described realm-manifest work that the #3914 fixture commit does not contain, and
`git commit -F` accepted it. Read `git log -1` back before pushing.

## Next

Under the one-PR cap I start nothing new until #3922 merges. Kestrel undrafts; I never undraft my own.
