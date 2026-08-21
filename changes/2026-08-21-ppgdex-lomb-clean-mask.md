---
bump: minor
type: fixed
brief: PPGDEX-ALGORITHM-DEEP-DIVE-2026-07-21-BRIEF.md
---

**The PpgDex frequency domain was computed over `correctRR`'s substituted intervals.** A rejected
interval is replaced by the local-median reference and pushed into `nn`; `timeDomain` and `poincare`
already refuse those via `cleanMask`, `lombScargle` did not. Substituted constants sit among real
values and create artificial step transitions, which add broadband power — measured on the finger
golden, `totalPower` **172 → 139**, `hf` 110 → 87, `lf` 45 → 37, `lfhf` 0.41 → 0.43.

Treatment (1) of the brief's re-scoped #2, and the only one where dropping is unambiguous:
Lomb-Scargle consumes `(time, value)` pairs and has no notion of adjacency. `dfaAlpha1` and `sampEn`
are deliberately **left alone** — the same removal there would splice non-adjacent beats and fabricate
an *adjacency*. Sparse-clean records degrade honestly: `lombScargle` already refuses under 8 samples.
