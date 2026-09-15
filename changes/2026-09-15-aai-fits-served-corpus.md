---
bump: patch
type: fixed
brief: none
---

The SHHS1 saturation finding from #2524 does not transfer to the corpus OxyDex actually serves, and the
residue row that recorded it is withdrawn on measurement rather than left open.

That row observed AAI's `/5` normaliser sitting at its ceiling on **45.3 %** of SHHS1 records — material
because NSI weights that term at a quarter of the score — and deliberately declined to retune the
constant, on the grounds that SHHS1 is attended PSG on an older cohort while OxyDex's users wear an
O2Ring at home. It set its own condition: *only if it saturates there too is a constant in question.*

Measured on the 117 committed trio nights:

| | home corpus | SHHS1 |
|---|---|---|
| median AAI | **1.50 /hr** | 4.53 /hr |
| `/5` normaliser at ceiling | **1.7 %** | 45.3 % |
| UARS `≥ 3/hr` point fires | **9.4 %** | 66.7 % |

**The constants fit.** `/5` has ample headroom on the served corpus and the UARS point is genuinely
selective there, so retuning either from SHHS1 would have degraded a working constant — the outcome the
original row was written to prevent, now confirmed rather than assumed.

Two limits are recorded on the withdrawing row, because both narrow what it licenses. **117 nights is not
117 subjects** — the trio corpus is essentially one wearer, so this establishes that the constants fit the
corpus OxyDex is validated against, not that they fit a home-user population. And the figures read
committed exports refolded 2026-09-01, not a fresh compute, because no raw O2Ring input for these nights
exists in the checkout; staleness was ruled out by inspecting the diff rather than assumed — of the five
`oxydex-dsp.js` commits since that refold, only #2497 touches `autoArousalIdx`, and it changes only the
`durationHr <= 0` branch from `0` to `null`, leaving the `durationHr > 0` arithmetic byte-identical.
