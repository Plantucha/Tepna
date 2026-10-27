# Heron — unit 21: the two Python filename-stamp converters

**1 · Unit.** Read the capture-host half of row `2026-09-22-filename-stamp-still-wrong-for-other-consumers`. Magpie's brief read ten JS converters and scoped out two Python ones.

**2 · Branch and worktree.** None. Measurement only, because #3918 (DRAFT) holds my one PR slot. I cut no worktree and changed no file in the repo.

**3 · Exact stopping point.** Board finding #1181 carries the whole result. The claim sits at #1180. My measurement scripts live at `/tmp/claude-1000/-home-michal-Tepna/4429f848-d75b-4221-a777-45a050d60b38/scratchpad/m21/`. They read both regexes out of ref copies of `loss_audit.py` and `writers.py`, so I retyped no pattern.

**4 · Next step.** Log a new residue row for the `loss_audit.py:1268` defect. Then pick remedy (a) or (b) from #1181 and build it. Remedy (a) touches `writers.file_stamp`, which five readers share, so it serializes against any other stamp work.

**5 · Open questions.**
- Which remedy does the owner want? (a) teaches `file_stamp` the PSL split stamp, and it moves five readers. (b) makes `_relink_gap` read the next file's first row, at one file open per candidate.
- The third remedy stands either way: `relink_gap_s` publishes a `null` with no reason, and §∅ requires one.
- Kestrel: the brief's §4 is empty in the code, and two thirds open on the page.
- PRs #3812 and #3791 discharged §4 items 1 and 3. Someone owes the brief that tick.
- Kestrel: the row cannot close. §5 closes it when §4 empties. §4 never covered the two Python converters.

**6 · Blockers.** No corpus census ran. Every `/mnt/nas` path raises EACCES, so the 14-digit device-id incidence stays unmeasured. I read it as latent from two docstrings and the corpus-shape pin at `tests/test_writers.py:590`. The PSL split stamp reads live from that same pin.

**7 · The doc-search query.** `node tools/doc-search.mjs --read "filename stamp consumers that convert the stamp to a time"`. Top hits: `briefs/FILENAME-STAMP-JS-CONSUMERS-2026-10-20-BRIEF.md`, board #373, census row `2026-10-12-filename-stamp-consumers-split-twelve-convert-four-identify`.

## What a resumer should know

**A SCOPED-OUT HALF IS NOT A READ HALF.** The census row enumerated 12 converters. The brief read ten and said so in its first line. Its acceptance then closes the residue row when §4 empties, and §4 only ever held JS items. So the criterion would have closed a row with two converters unread.

**THE OBVIOUS REMEDY WAS THE WRONG ONE, AGAIN.** Four sibling modules route through `writers.file_stamp`, so swapping `loss_audit.py` onto it looks like a one-liner. `file_stamp` returns `None` on a PSL split stamp by design, and a test pins that. The swap trades a wrong instant for the same dropped file.

**A COMMENT CAN FORBID A SHAPE AND THE FUNCTION STILL EMIT IT.** `_relink_gap` keeps membership filtering off, because a band filter would report "no next file" and hide a measured gap. An unanchored name regex produces the identical silent `null` through a different door.

**THE BOX'S OWN TEMPLATE PUTS THE DEVICE ID BEFORE THE STAMP.** `writers.py:669` builds `vendor_model_id_stamp_TAG`. Any reader that searches for the first 14-digit run reads the id when the id is 14 digits long.
