---
bump: patch
type: changed
brief: none
---

`tools/stuck-run-lengths.mjs` publishes the full percentile ladder (p50/p90/p99/p99.9/p99.99) beside the p99.99 the constant is defined against, because residue `2026-09-06-t-stuck-validated-on-ring-only` closes on *"the same query as the ring's, per stream"* — and the ring's figures are a ladder, not one quantile. Reporting p99.99 alone left that condition literally unmet. The like-for-like comparison is the sharper finding: the ring's legitimate plateaus run **3.5–14× longer at p99** than any other stream's (p99 = 14 against 1–4), which is the 8-bit quantisation, and is why a constant derived from the coarsest stream sits far above the plateau scale of every finer one.
