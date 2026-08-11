---
bump: minor
type: added
brief: PAT-GEOMETRY-PROBE-2026-08-11-BRIEF.md
---

`tools/geometry-probe.mjs` — detectors for the five geometric signatures every timeline defect in this
project has turned out to be (saturation · sawtooth · censoring · drawn axis · step), plus
`tools/geometry-scan.mjs`, which walks a recording's alignment chain stage by stage and attributes a
fired shape to a stage. Gate-backed by the `geometry-probe` group, which asserts the specificity matrix:
each planted shape fires its own probe and only its own, and a clean signal, a smooth trend and a random
walk fire nothing. Detectors only — nothing in the runtime gate reads them yet.
