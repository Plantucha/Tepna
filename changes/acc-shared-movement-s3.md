---
bump: minor
type: added
brief: EXTERNAL-METHODS-SURVEY-2026-08-20-BRIEF.md
---

`tools/acc-shared-movement.mjs` — EXTERNAL-METHODS-SURVEY §3's measurement. Reports, per night, the
chest movements `alignByAnchors` finds against the ones the arm corroborates, which is the
discriminator §3 asks for: many candidates with few anchors means the wear-site pair is signal-poor
and no alignment algorithm closes that, while few candidates would mean a coverage limit instead.

Measured over 36 nights: median 247 candidates against 10.5 anchors (corroboration 0.064), and the
refusing nights carry MORE chest movement than the aligning ones. §3 answered NO — Brønd's method
does not transfer to a chest/arm pair.

Analysis tool only; reads recordings, writes nothing, and no shipped bundle changes.
