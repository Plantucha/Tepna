---
bump: patch
type: added
brief: none
---

A new consumer that decides on `hostAxis.independent` instead of `deviceDrawn` now reds the suite.

`independent` compares the host column against the device column, so a device counter synthesised as
`index × an assumed rate` reads MORE independent the coarser the fabrication. `clock.js` publishes
`deviceDrawn` additively and deliberately does not gate `independent` with it, because a synthetic
fixture's uniform axis is indistinguishable from a fabricated one and a fixture is not a recording.
That leaves the hole a consumer's problem, and an unmigrated consumer is invisible from the outside:
it returns a number, never a refusal.

The gate is a source scan, not an audit. It classifies every root `*.js` and `tools/*.{js,mjs}` by
identifier presence over comment-stripped, whitespace-collapsed text, and pins the set that GATES on
an `.independent` field while carrying no `deviceDrawn` site. That set is four files today, each
pinned with the discriminator it uses instead — and that discriminator is asserted present, so a file
that loses its local guard reds here rather than being grandfathered.

It reds in three directions, each shown by a plant: a new bare consumer (planted in
`tools/pat-matchrate-strict.mjs`, named in the failure), a pinned file that migrates (`deviceDrawn`
planted in `pat-gate.js` — "lower the allowlist in the same PR"), and a pinned file that loses its own
guard (`analyzeArrival` renamed — the pin is no longer justified).

A GATE is a comparison against a boolean literal, a negated read or a ternary test. A pass-through, a
null-normalisation (`=== undefined ? null :`) and a printed label are not, and the classifier is put
through all of those before any verdict off it counts. Nothing is read by line window, so a reflow
cannot red it.

`tests/dex-tests.js` is inlined into no bundle, so no `manifestHash` and no `computeHash` move.
