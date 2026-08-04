---
bump: patch
type: added
nodes: []
brief: TRIO-POWER-N15-FINDINGS-2026-07-12-BRIEF.md
---

The trio σ gate declared the planted σ and the paper's published tables "ONE ATOMIC UNIT — change
both, or neither", but only ever compared three code copies to each other and to a literal in the test
file; nothing read the paper. Re-fitting the paper's Table 1 to a new hat — exactly what the brief's
remaining items propose — would have left every assertion green while the simulation stayed at the old
hat. Adds a leg that scrapes the paper's `Planted σ` column and compares it to the simulation's,
mutation-verified from both sides. It matches on the column rather than the values because the paper
carries three different σ triples on purpose (planted, classic broad-hat overlay, fused-weight
headline) and grepping digits would flag the healthy state as a break. Also records that the brief's
"720 vs 50,000 trials" contradiction was reconciled in `6001983`, two days after the brief was written.
