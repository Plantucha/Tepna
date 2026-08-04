---
bump: patch
type: fixed
nodes: []
brief: WEARABLE-DRIFT-DIRECT-2026-08-02-BRIEF.md
---

`tools/dual-clock-rate.mjs` now asks whether there is a second clock at all before reporting a rate.
On a phone capture the host column is the device stamp rounded to the millisecond, so the fit is
perfect and the tool reported `0.0 ppm` on six ~7.5 h fragments — all long enough to be quoted in its
summary, all reading as a flawless crystal. The discriminator is the residual spread about the fit
(measured: exactly 1.00 ms on phone captures against 283–552 ms on box captures), and a fragment that
fails it now has its rate refused rather than printed. Adds a cross-fragment spread refusal too: the
O2Ring's axis stopped being drawn after 2026-07-27 (99.4% → 2.2% identical deltas) without becoming a
clock, and its fragments disagree by 2282 ppm within one night. The pure `classifyRate` predicate is
exported and gated on values in `tests/dex-tests.js` (Node lane; the browser lane SKIPs).
