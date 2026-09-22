---
bump: minor
type: fixed
brief: none
---

`tools/trio-batch.mjs` anchors a session file on the instant its DATA starts, not on its filename stamp (residue `2026-09-22-capture-filename-stamp-disagrees-with-content`): the name is the capture SESSION's start and a Polar connection can stream HR from the morning while its PMD streams begin that night, so 10 files across 4 sessions were keyed to the wrong night — one of them the whole 6.1 h wrist leg of 2026-08-24, whose committed fold carried no PpgDex at all. The rule lives in `tools/trio-anchor.mjs` (`startOf` mirrors `endOf`'s tail read at the head; a `.dat` keeps the name because it has no per-row stamps; an unreadable head or an unparsable row keeps the name, never a fabricated instant) with `tests/trio-anchor-tests.mjs` wired into `npm run check`. Also fixes a crash the tool shipped with: a night rejected as non-trio emitted `NOT_APPLICABLE` carrying a `result`, which `verdict.js` refuses — every non-trio night threw, while the selftest passed on a shape the call site never used. 2026-08-24 re-folded (PpgDex leg recovered) and 2026-08-28 folded for the first time.
