---
bump: patch
type: fixed
brief: REFERENCE-GUIDE-AUDIT-BRIEF.md
---

Correction-history meta-commentary removed from reader-facing text in `OxyDex Reference.html`, moved into
HTML comments where the brief says it belongs. Dimension 6: *"No correction-history meta-commentary in
reader-facing text ('corrected this revision', 'previously mis-stated', 'vXX fix'). State the clean final
fact only. (Invisible HTML comments are fine.)"*

THREE OF THE FOUR WERE MINE, ADDED HOURS EARLIER WHILE EXECUTING THIS SAME BRIEF. The dimension-2 and
dimension-3 fixes each carried their own provenance in visible `<em>` — "Corrected 2026-08-18: this read
<s>HR_rest + HRR × 0.87</s>…", "the adjustment was undocumented here until 2026-08-18", "Reviewed
2026-08-18". Every other guide in the fleet had ZERO such text; I put OxyDex's count to three closing
findings under a brief whose dimension 6 forbids exactly that, and only found it by reading dimensions
5-7 to pick the next work item.

The instinct was defensible and still wrong: a struck-through withdrawal genuinely serves a reader who
remembers the old value, which is why it went in. But the brief has already decided that trade — a
reference guide is a statement of what is true now, and a reader who never saw the error is owed the fact,
not its history. The history is owed to the next EDITOR, and an HTML comment reaches exactly that
audience. Nothing is lost: all four corrections keep their full reasoning, code line references and
divergence figures, one layer down.

The fourth was PRE-EXISTING and the same defect: DesSev's "This guide previously described *ODI-3 ×
mean_depth × mean_duration / k* — a formula the code has never implemented; corrected 2026-07-19". Same
treatment, so the guide is now consistent rather than half-fixed.

Verified by measurement rather than inspection: visible text (comments stripped) matches
`corrected 20xx-|previously read/printed/described|undocumented here until|Reviewed 20xx-|fixed in v|
mis-stated` **0 times across all 7 guides**, with 3 histories preserved in comments in OxyDex.
