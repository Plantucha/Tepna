---
bump: patch
type: changed
brief: TCH-FUSED-ROBUST-HAT-2026-07-14-BRIEF.md
---

`TCH-FUSED-ROBUST-HAT`'s one open item had been routed to two briefs that do not own it — orphaned for
16 days. Re-stated against measured code: `sensor-trio-power-analysis.js:225` carries its own copy of the
classic `tchSigmas` rather than delegating, numerically identical today (max |Δ| = 0 over 300 triplets)
but **ungated**, unlike the sigma page's delegation-parity leg. The item splits: delegate + parity-gate
the classic hat (corpus-free, next step) vs wire the fused hat into the real overlay (genuinely blocked on
a confidence-carrying corpus re-derivation).
