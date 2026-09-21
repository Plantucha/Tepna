---
bump: patch
type: added
brief: none
---

**The "isolated 156 is a marker" heuristic is scored against the ring's own beat flag — and holds,
non-vacuously.** `pinnedSpans` steps over a lone `156` as the O2Ring's inserted beat-marker row and
keeps a run of 156s as signal; that rule decides whether a marker-split plateau is one span or two,
and residue `2026-09-06-marker-isolation-heuristic-unvalidated` recorded it had never been scored
against its failure mode, because the marker is in-band in `_PPG.txt`. The `0x03` pletha stream
carries `beat` out-of-band, and the box has written 16 `_PLETHA.txt` files since 09-06.

`tools/pletha-marker-oracle.mjs` builds the 2×2 over every such file (streamed, counts only) plus
the cell that would falsify the oracle itself. Corpus-wide, 66,007 rows: lone 156 → beat 486 / 0;
run 156 → beat 0 / 4; beat on a non-156 row 0. Every cell agrees with the heuristic, and unlike the
2026-09-06 attempt (11/11 on a file with no run of 156s at all) the discriminating case occurred —
two runs of length 2. The tool prints that count beside the verdict and labels a pass with an empty
run cell VACUOUS, because that is exactly how the first attempt licensed nothing while reading as a
pass. Thin (four rows) but not empty; the verdict says so.

Fleet-Session: Magpie
