<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
The PPI card drew two lines and named neither.

Asked of the live monitor: "the PPI card shows 2 lines — what are they, and shouldn't they show HR?"
It *was* showing HR. Nothing on the card said so.

PPI is the only multi-channel stream whose readout labels nothing. `multi` (ACC/GYRO/MAG) builds an
`.ov-axes` legend from `s.labels`, so each value is named and colour-matched to its trace. The `ppi`
branch rendered `a[0]` as a bare number with a bare `ms`, and `a[1]` as a bare `♥ NN` — two coloured
lines in the mini-chart, no legend, and no way to tell which was which except by guessing from scale.

The labels were never missing. `capture.py._LIVE_META` declares `"ppi": ("PPI","ms",2,("PP-int","HR"))`,
`telemetry.py` serialises them, and the browser already had them in `s.labels`. Nothing read them. The
card now does, colour-matched to the traces and text-labelled as well — never hue alone, the same
reasoning as the evidence-badge rule.

The order is the part worth guarding, because getting it wrong produces a *believed* wrong label rather
than a visibly missing one, and it is counter-intuitive: the PMD decoder's tuple is
`(hr, pp_ms, err_ms, flags)` — HR FIRST — and `capture.py` deliberately reverses it on the way to the
bus, so the wire shape is `[PP-int ms, HR]`. Reading either half alone would label the card backwards.
The new tests therefore pin the whole chain — decoder order, the reversing push, the declared labels,
the render, and the fallbacks (which must degrade to the same order, not to a guess). Verified by
re-applying four mutants: labels declared reversed, push no longer reversing, label hardcoded instead
of read, and a silently swapped fallback — each killed.

No behaviour change to capture or storage; this is the live-view readout only.
