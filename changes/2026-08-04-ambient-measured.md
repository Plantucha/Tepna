---
bump: patch
type: changed
brief: PPGDEX-MULTICHANNEL-FUSION-2026-07-18-BRIEF.md
---

`PPGDEX-MULTICHANNEL-FUSION` §8's "measure and record" answered for Phase 1. The ambient column is read,
carried through both adapters and gated as the right column — but never subtracted. Measured on 12 Verity
nights: subtraction is **not** inert (median |Δ| 3.2 ms, but +101 % on 2026-07-19). The corpus cannot yet
decide, because only 6 of 12 nights give a physiologically plausible rMSSD at all — the rest read
164–2332 ms, matching the known beat-alternation defect. No DSP changed.
