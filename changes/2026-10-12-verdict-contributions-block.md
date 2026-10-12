---
bump: minor
type: added
brief: VERDICT-CONTRIBUTIONS-2026-10-04-BRIEF.md
---

Add one optional `contributions` block to `tepna.verdict/1`, so a fused figure can say which
input moved it.

A block names the figure and its unit. It names the attribution method from a closed set of
three, lists at least two inputs with a signed `delta`, and names the `dominant` key.

Each `share` must equal `|delta| / sum|delta|` within `1e-9`, and the shares must sum to 1. A
renderer rounds a share for its reader; the object carries the computed ratio.

An input that did not run carries `delta: null` and a `reason` that says why. One unknown
delta leaves `sum|delta|` unknown, so every share and `dominant` go null with it rather than
normalise over the legs that did run. A sum of zero does the same.

A verdict with no block runs the same eight legs as before, and `make()` writes the key only
when a producer hands it one.
