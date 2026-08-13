---
bump: minor
type: changed
brief: PPG-FOOT-PLACEMENT-2026-08-12-BRIEF.md
---

Brings PpgDex's "Self-PPI vs Device-PPI" card up to the standard of ECGDex's `valCard`
("Device RR — HRV Validation"), and gives it a firmware series to compare against on hardware that
never supplied one.

THE DEFECT: the comparison corrected only ONE side. The `nn` reaching `validatePPI` has already been
through `correctRR`, while the device series was passed in raw. So the card measured our artifact
rejection rather than the two detectors — and it did not merely exaggerate the disagreement, it
INVERTED it. Measured through the real pipeline on 2026-08-08: self rMSSD 59.3 against a raw firmware
103.6 reads as the device being 75 % higher, i.e. as if PpgDex were over-smoothing. Correcting the
firmware side the same way costs 306 beats and brings it to 53.6 — a 10.7 % difference, with the
firmware series turning out to carry MORE artifact, not less. The means agreed to 8 ms (0.74 %)
throughout, which is why a mean-only "agreement %" could read 99.3 % while the variability rows were
10 % apart. rMSSD is a first-difference statistic; unequal artifact handling lands there and nowhere
else. ECGDex has always Malik-corrected both sides; PpgDex now does the same, with its own optical
threshold rather than ECGDex's 0.20 rule, because pulse-arrival jitter exceeds R-peak jitter.

Adds SDNN, per-metric deltas (`dMean`/`dRMSSD`/`dSDNN`), both correction counts, and `devRawRMSSD` so
a reader can see the correction instead of trusting it. The blended `deviceAgreementPct` is kept but
relabelled for what it actually measures — the means alone.

A SECOND FIRMWARE SOURCE, needing no companion file. An O2Ring finger night ships no `_PPI.txt`, so
this card rendered "no device PPI loaded" on every single one. Its `156` beat rows are a firmware
interval series carried in-band in the PPG file itself, so they now feed the same comparison path,
tagged `source: 'o2ring-marker'` — a reader must be able to tell a wrist device's interval estimate
from a finger ring's, since they are different sensors at different sites. An explicit `_PPI.txt`
still wins where one exists, so behaviour is unchanged wherever the old path had data.

CORRECTS A COMMITTED CLAIM. The source asserted "107 of 107 Verity `_PPI.txt` files are header-only —
on this firmware it is categorical". Re-measured over 132 files: 108 are header-only and 17 carry real
intervals, up to 29 329 unblocked in one night. The split is not firmware, it is CAPTURE MODE — every
header-only file is phone-captured, every file with data is a box capture from 2026-08-05 on. The
original measurement was correct for an all-phone corpus; the generalisation from it was not.

Export-inert: verified against the real corpus, where all 195 equivalence assertions pass including
the 12 real-recording legs that skip without it. No committed fixture reaches `usable`, so no export
gains or loses a `validation` block.
