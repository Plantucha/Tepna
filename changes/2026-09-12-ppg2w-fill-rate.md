---
bump: minor
type: added
nodes: [suite]
brief: residue 2026-09-06-ppg2w-fill-rate-unmeasured
---

The O2Ring raw dual-wavelength FILL rate, measured for the first time: median 200 Hz.

#1596 established that 282,402 of 284,420 buffers sat at the 102-record reply cap (99.3 %), so every
whole-night "~100 Hz" figure is `cap x poll rate` — a drain artifact, not the device. It then bought a
second mid-cycle drain on the ground that "every night's unsaturated counts measure the true fill rate
for free", and nobody ever took the measurement. `ppg2w-rate.mjs --fill` takes it.

Measured over `/srv/data/tepna-corpus/uploads`:

  2026-08-07  (pre-#1596, ~1.08 s drain)   33,438 replies   99.98 % at cap   no usable partial
  2026-09-05  (post, ~0.50 s drain)        24,422 replies   41.58 % at cap   median 200.0 Hz
  2026-09-10                               80,659 replies   59.99 % at cap   median 200.0 Hz
  2026-09-11                              115,469 replies   53.90 % at cap   median 200.4 Hz

So the double drain worked — saturation fell from 99.98 % to 42-60 % — and the unsaturated replies it
produced put the fill at ~200 Hz (p10 170, p90 237). That EXCLUDES both of the brief's pre-stated
bands, [95,105] → 100 Hz and [118,132] → 125 Hz, and tightens §2.1a's ">102 Hz" by about 2x.

⚠️ WHAT THIS DOES NOT SETTLE. It measures records per second, and whether a record is one ADC sample
per wavelength or something else is a separate question the brief's §7.1 still owns. No story is
fitted to the number here.

TWO TRAPS, both of which make the naive answer WRONG rather than imprecise, and both gate-pinned:

· The within-buffer spacing cannot be used. `capture.py` back-times a reply's rows across its own span,
  so dividing that out returns the WRITER'S interpolation — it reads ~99 Hz on every night including
  the 99.98 %-saturated one. That is CLOCK §7's drawn axis, one layer down. The fill is records per
  INTER-REPLY ARRIVAL GAP, which is real host time. The selftest plants a within-buffer step implying
  200 Hz over a truth of 100, so anyone re-deriving from the interpolation fails.
· A reply below the cap is not automatically a partial one. A spurious split shows as two neighbours
  summing to exactly 102, so `pairsToCap` counts them — and it earns its place immediately: on the
  pre-#1596 night ALL SIX sub-cap replies pair to the cap, so the tool correctly reports that night as
  having no usable partial, while the post-#1596 nights pair 6-11 of tens of thousands.

Reply recovery reuses `ppg2w-spo2-fit.mjs`'s existing rule (split at |delta - modal| >= 3 ms) rather
than inventing one. The 3 ms is load-bearing: stamps are ms-rounded so deltas alternate inside one
reply, and a 1 ms tolerance fragments ~102 records into runs of 2. Pinned by a fractional-step fixture.
