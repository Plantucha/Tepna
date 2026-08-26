---
bump: patch
type: fixed
brief: none
---

Make the mutant record key unique. `line + op + before` collapses two same-operator mutations on one
line into one entry — measured on pulsedex-dsp.js:197, where the `<= 1500` threshold and the
`Math.max(0.55, …)` floor share it — so a canary lookup returned the wrong mutant and a drafted
assertion fused one mutant's input with the other's output. `after` disambiguates without an index's
edit-instability, and a legacy record on a collided line now REFUSES rather than guessing.
