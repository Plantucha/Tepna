---
bump: patch
type: fixed
brief: FINISHED-WORK-IMPROVEMENTS-2026-08-20-BRIEF.md
---

**§B1's sibling scan is done: a clean negative across all eight render layers, and the negative is
the deliverable.**

§B1 had two halves. The fix — OxyDex's Smart Summary rendering *"✓ All scored metrics within normal
range"* whenever `_flagged` was empty, including nights where nothing scored — landed in **#1626**.
The half nobody had run was the one the brief calls the deliverable: *"THEN the sibling scan across
the other 6 render layers — the scan is the deliverable; a clean negative is a result."*

Scanned all **8** siblings (not 6 — `motiondex-render.js` postdates the brief) for the class *a
reassurance rendered from an ABSENCE rather than from counted positive evidence*. **No live
instance.**

⚠️ **Every scan shape was controlled against the known pre-fix defect before its result was
believed.** An empty scan whose pattern cannot match the case it models is not a negative, it is a
blind spot — and the first structural pattern here WAS blind: it looked for `!x.length` and
`.length ?`, while the original defect is `if (_flagged.length){…}else{…}`, which it could not
match. Rebuilt and re-controlled until it flagged the original at `:2528`/`:2556`, then run.

**Two candidates surfaced and both survive as correct**, recorded because "we found nothing" is
worth less than "we found two and here is why each is sound":

- `integrator-render.js:1048` claims *"the fusion rules ran across the overlap … a clean night"*
  from `!cards.length`. The claim is true — `renderFindings` returns early on `!fusion.anyOverlap`,
  so overlap is established before that line is reachable. **The positive-evidence guard is one
  level up** rather than a count: a different shape from §B1's fix, equally sound.
- `motiondex-render.js:151`/`:183` render the literal `'clean'` from
  `sqi.flags && sqi.flags.length ? … : 'clean'`, so an absent `flags` would reach the reassurance —
  and the same line renders an absent `conf` honestly as `'—'`, an asymmetry that reads like an
  oversight. Not reachable: `motionSQI` returns a `flags` array on every path including its
  `< 10 rows` early return, and MotionDex has no `loadOwnExport`, so the projected `sqi.conf` export
  form never re-enters this render. ⚠️ **Its safety is a property of the PRODUCER, not of the
  render** — a future re-import path makes it live. Left as-is, noted so a change there is
  understood to carry this consequence.

Docs-only: the brief's §B1 is marked executed with the scan recorded. No source, no bundle, no
provenance.
