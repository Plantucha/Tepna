---
bump: patch
type: fixed
---
Render probe-night verdicts in the Nights view.

The solid-night judge emits NOT_APPLICABLE for a declared probe night, but the
Nights table/matrix had no display entry for it: the table showed the raw
status string and the heatmap painted the black unknown square. Probe nights
now read "probe night" with a blue square and a sub-text explaining the skip.
