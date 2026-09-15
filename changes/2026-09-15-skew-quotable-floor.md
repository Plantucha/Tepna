<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: []
brief: RESIDUE.md
---

`clock_offset.SPAN_MIN_SEC` decided whether a ppm rate is publishable using a threshold borrowed from
a correction-application gate, so one lane called a 40-minute rate quotable while
`tools/dual-clock-rate.mjs` refused the same quantity under 60 minutes as "not a rate". The floor is
now the resolvability one, 3600 s, matching the answer KNOWN-CLOCK-ADVERSARIAL-CAPTURE §517 measured
for that question. `ecgdex-dsp.js`'s own 2400 s is unchanged and must stay — §517 measured it
net-beneficial for the different question it answers.
