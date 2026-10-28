<!-- SPDX-License-Identifier: Apache-2.0 -->
# Handoff — the share cap on board hits in Rule 0 (Magpie)

**Unit:** residue row `2026-10-18-board-hits-have-no-share-cap-in-rule-0`, the cap clause only.
**Doc-search query that found the prior work:** `board posts crowd the top five hits of a Rule 0 search` → `tools/board-corpus.mjs` · `tools/xerj-query.mjs` · `tools/doc-search.mjs`.
**Branch / worktree:** `claude/boardcap-mg` in a worktree named for the unit. Board entry #1934.

## What shipped

`capSourceShare` in `tools/xerj-query.mjs` holds board posts to a share of the result list, two of five
in the hybrid lane and three of eight in the fallback lane. `tools/doc-search.mjs` wires both lanes and
adds `--board-all`, which ranks the board with everything else.

The cap re-orders, it never invents. A held post returns to the list when nothing else can fill the
slot, so an all-board ruling still answers an all-board question. The search prints how many posts it
held back, because a withheld hit a reader cannot see is an absence reported as a number.

## How the size was chosen

I harvested the fleet's own Rule 0 queries from the board and replayed 84 of them through the hybrid
lane, capped and uncapped in one process against one index state. Uncapped, board posts take 186 of 420
top-five slots. Ten queries return five posts and no repo document. Capped, they take 120 of 420, no
query exceeds the cap, and every list stays five long.

A share and not a count, because the two lanes print different list lengths and one count would read as
two rules. `Math.max(1, …)` keeps one slot for the board at any list length.

## The finding worth carrying

**The producer was right and nothing governed the ORDER.** The row names the tool that writes the corpus,
and that tool is correct, because a board post is a document and the index should hold it. The remedy
belongs with the fusion that orders the hits.

**A retrieval cap owes a recall measurement, not an argument.** Over the committed 52-query benchmark
the hybrid lane scores 16 hits at five with the cap and 16 without, median rank 2 either way, and no
query flips. None of the 289 ground-truth paths is a board post, so the cap can only move what the
benchmark does not score. I ran an anti-vacuity control too: widening the share to 1.0 reds 7 of the 14
new legs while the controls stay green.

## Next step

This branch owes nothing further. Two clauses of the row ship as their own rows, both OPEN:

- the hourly whole-board re-read, measured at 2.53 MB today, which no part of this unit touches
- a superseded post ranking like a current one, which the cap does not address
