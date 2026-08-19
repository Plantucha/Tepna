---
bump: patch
type: fixed
brief: REFERENCE-GUIDE-AUDIT-BRIEF.md
---

REFERENCE-GUIDE-AUDIT dimension 5, mechanised and swept fleet-wide: `tools/guide-anchor-audit.mjs`.
**768 internal links · 269 ids · 246 abbreviations across 7 guides — 2 defects, both OxyDex, both fixed;
every other guide clean.**

`BP` / `SBP` / `DBP` JUMPED TO A SECTION DELETED TWO MONTHS EARLIER. All three mapped to `profile`, an id
that does not exist. It used to: an HTML comment in the guide records "BP PROJECTION section REMOVED
2026-06-23 (DEX-METRIC-REMOVAL-AUDIT) … bpProj is hard-null in dsp since 2026-06-21; cuffless BP from
signals is indefensible." The section went; the three jump-links pointing INTO it did not, so a reader
clicking BP in the abbreviation index has gone nowhere since June.

THE SHAPE IS WORTH NAMING: a removal is not finished when the thing is gone. Every reference INTO it is
then dangling, and the references live in a different structure from the thing itself — here a JS map at
the foot of the document, which no metric-registry check and no badge gate can see. Repointed to
`refs-formulas`, where cuff BP actually lives (SBP, DBP, and `MAP = DBP + 1/3(SBP - DBP)`), consistent
with the removal note's own instruction that `prof_sbp`/`prof_dbp` survive as user-entered cuff inputs
"documented elsewhere".

`MODL` was mapped, jumpable and used as a quick-jump chip, but absent from `abbrs[]` — so the
abbreviation index had no entry for it. Added from the guide's own card heading: Mean Oxygen
Desaturation Level.

TWO INSTRUMENT ERRORS, BOTH MINE, BOTH OVER-REPORTING, both now self-tested against:
  · seven phantom dead links — one per guide, all identical `href="#'+target+'"`, a runtime-built href
    inside a <script>. Reading JavaScript as markup. The tool strips <script> first and plants exactly
    that string in its self-test.
  · six phantom undefined abbreviations where one was real — `SpO₂` compared un-decoded. The tool
    now decodes `\uXXXX` and `&#xNN;` on BOTH sides before comparing.
In both cases the first number was larger and more alarming than the truth.

The tool exits non-zero on defects, so it can gate rather than only inform. Self-test 7/7, counted.
