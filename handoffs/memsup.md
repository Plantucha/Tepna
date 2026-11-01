# Unit `memsup` — a replaced ruling leads the memory corpus

**Session:** Magpie · **Branch:** `claude/memsup-mg` · **Worktree:** `wt-memsup-mg` · **Row:**
`2026-10-28-a-replaced-owner-ruling-ranks-first-from-the-memory-corpus` · **Rule 0:** `node
tools/doc-search.mjs --read "memory corpus superseded ruling ranks first de-rank mark"`.

## What the row said and what I measured

The board lane marks a replaced post (`board-corpus.mjs`, #4064) and de-ranks it (`xerj-query.mjs`,
#4068). The row says the memory corpus carries the same hazard with no mark. I reproduced the
ranking: doc-search put `ext:memory/two-open-prs-per-bird.md` at 0.033 above
`ext:agent-board/1/605.md` at 0.032, so the replaced 2-PR cap outranked the one-PR ruling.

The row calls the remedy non-obvious, and the mechanism is sharper than the row states. A session
EDITS a memory file in place. So the file carries no successor to date against and no claim line to
read, and that file already corrected itself four paragraphs down. doc-search returns a CHUNK, so
the pre-correction LEAD is what ranks.

One signal does transfer. A memory lesson names the board post it came from, and the board already
knows which of its posts it replaced.

## What landed (decision #2679, three parts, one PR)

1. `tools/memory-supersession.mjs` reports every memory file whose lead cites a post the board
   corpus marked replaced. It writes nothing, and a selftest leg pins that its source names no
   filesystem write API.
2. `tools/xerj-query.mjs` honours a frontmatter `superseded-by:` declaration for the memory corpus,
   through the same `supersededMarks` and `deferSuperseded` the board side uses. Both lanes take it.
3. I put the current one-PR cap in the lead of `two-open-prs-per-bird.md` and kept the 2-PR ruling
   below as history.

## The numbers

- 760 memory files against 171 marked posts: lead 1 · body 45 · abstained 10 · declared 0.
- The one lead finding was the file the row measured: `two-open-prs-per-bird.md` `#560` to `#605`.
  After part 3 the tool reads PASS over 760 checked files.
- A bare `#NNNN` decides nothing, because most of them are PR numbers. A citation counts only with a
  board word within 24 characters. An earlier hand count read 18 lead citations; the cue rule reads
  1, and the other 17 were PR numbers.
- `xerj-query --selftest`: 99 legs green, 17 of them new. Controls red it as follows — raw-text mark
  2, board-only corpora 4, a skipped unresolvable root 1, the board reader on memory 3, an empty
  declaration as a mark 1.
- `memory-supersession --selftest`: 20 legs green.

## What a later session must know

- The mark counts ONLY inside the frontmatter. My own state file writes prose about this mechanism,
  so a raw-text reader would retire that lesson on its own documentation — the defect unit
  `boarddoc` fixed one corpus over.
- A memory successor is a display string (`one-pr-per-bird`, `#605`), never a number.
- Nothing writes a memory mark, and no tool may. Every session shares that directory, git does not hold it, and it has no
  conflict surface, so a write races a peer with no symptom.
- An empty `superseded-by:` names no successor, so it defers nothing.

## Next

The row closes inside the PR as `fixed #<PR>`. Nothing else is open on this unit.

Fleet-Session: Magpie
