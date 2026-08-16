---
bump: patch
type: changed
brief: DEEP-AUDIT-IV-2026-08-04-BRIEF.md
---

`DEEP-AUDIT-IV` punch-list item 2 asked whether any of the real `rmssd > sdnnRobust` alternation nights
had partial ACC coverage, which would raise §1's finding from "wrong number" to "suppressed quality
warning". Run against the corpus 2026-08-16.

Corrects the count first: there are **five** such nights, not six. The six was asserted in this brief
and echoed elsewhere without a list. The shipped detector's own `hrv.time.shapeViolation` flag is set on
exactly five of the 51 committed PpgDex exports, and an independent recomputation of `rmssd >
sdnnRobust` returns the same five, so it is not a threshold artefact.

Two nights have raw data pairing to their export second-for-second, and both have full ACC coverage.
2026-07-01 (PSL tree, under `Polar_Sense_*` rather than `Polar_VeritySense_*`, which is why an earlier
glob found nothing): ACC covers all but the first 8 s of a 7.20 h recording. 2026-08-07 (vigil): ACC
starts two seconds before the PPG and runs to within a second of its end, 51.7 Hz against a 52 Hz
nominal. That is the strongest alternation in the corpus at ratio 1.27, and its accelerometer was on
throughout — so §1's defect could not have suppressed the flag there.

Three nights cannot be answered, and the blocker is missing raw data rather than missing method: their
source recordings are absent from all four trees in `docs/CORPUS-LOCATIONS.md`, leaving only same-named
fragments — 0.49 h where the export spans 8.17 h, 2 seconds where it spans 9.39 h, and Verity streams
absent entirely.

Those fragments are the trap worth recording. Each directory exists and carries the right date, so a
coverage check that did not compare spans would have read a 2-second capture as a night and reported
"full ACC coverage, 53.1 Hz" — a clean-looking answer about the wrong recording. The pairing test
(export `durSec` against raw span) is what separates them.

Item 2 is advanced, not closed: evidence against the hypothesis on the nights that can be asked, and
the brief now says which three would close it. Docs only.
