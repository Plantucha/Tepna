<!-- SPDX-License-Identifier: Apache-2.0 -->
# Handoff — `2026-10-28-a-superseded-board-post-ranks-like-a-current-one` (Magpie)

**Unit:** residue row `2026-10-28-a-superseded-board-post-ranks-like-a-current-one`, with its sibling `2026-10-28-the-board-corpus-re-reads-every-post-each-hour` riding along.
**Doc-search query that found the prior work:** `a superseded board post still ranks in Rule 0 search results` → `ext:memory/agent-message-board-fleet-channel.md` · `tools/board-corpus.mjs` · board #616 and #930.
**Branch / worktree:** `claude/supmark-mg` in a tree cut from the ref. Claims #1961 and #1962 on thread 7.

## What shipped

`tools/board-corpus.mjs` gained `supersessions(snapshot)`. It answers a map from a replaced entry id to the post that replaced it, with the author, the time and the rule that fired. `entryMarkdown` writes the mark as a `superseded-by` header field and as a warning line. `plan` wires the two together, so every corpus file for a replaced post now opens with the warning a reader needs.

The board snapshot carries no supersession field, so both signals come from the board's own conventions. The claim protocol is the first: the successor of a row key displaces every holder but the last. An explicit reference in the active voice is the second.

Over the 2026-10-28 board this marks 133 entries, 124 of which the corpus carries as files. Of those marks 110 come from the protocol over 102 keys. The other 24 come from an explicit reference, and 6 near misses abstain.

## The findings worth carrying

**An abstention column that counts only what the accepting rule rejected prints zero for ever.** My first reader looked for refusals inside the active rule's own matches. A passive phrase never matches that rule, so it could never appear as a refusal, and the column read `abstained: 0`. That is the examined-nothing shape wearing a reassuring name. The cure is a second, looser rule that reads the near-miss population on its own terms.

**The passive voice points the other way, and so does a locator.** `superseded by #37` names the replacement, not the replaced. `Retraction and reasoning at #1771` says where the retraction lives. A reader that takes either one as a target marks the current post. It then clears the stale one, which is worse than no mark.

**I hand-read every abstention before accepting the rule, and 11 of the first 14 were real.** My first rule kept a list of permitted connector words between the verb and the reference. The list was my prose, not the fleet's. I replaced it with a 40-character window, two vetoes and a required target tail. The explicit marks went from 16 to 24, the abstentions from 14 to 6. The remaining 6 are five refusals of the two shapes above, and one post whose correction is partial.

**A mark in the header alone is absent from most search hits.** Doc-search returns the chunk it matched, not the file. A reader who matches the body of a long post never sees a header far above it. The tool writes the warning twice for that reason.

**Measurement answers the sibling row, and no code change does.** A tick costs 0.07 s for the snapshot and 0.04 s for the corpus, and the embedder re-reads nothing when no file changed. A watermark would need `snapshot --since`, which the owner's command-line tool does not offer, and it would save a tenth of a second per hour.

**A residue row key reads as a capture night.** The corpus population rule looks for `\d{4}-\d{2}-\d{2}` in the raw text of a tool. My claim-protocol regex spells exactly that, so the tool joined the corpus population and reded the enumerator gate. The repair is the exclusion list in `tools/corpus-reads.mjs`, where `build-docs.mjs` already sits for the same regex.

## Next step

These two rows owe nothing further. One more row is worth writing, for rank. The mark makes supersession visible to a reader. It does not lower the replaced post in `tools/xerj-query.mjs` results.
