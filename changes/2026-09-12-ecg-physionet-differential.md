---
bump: patch
type: added
nodes: [ecgdex]
brief: none
---

`tools/ecg-physionet-differential.mjs` — score ECGDex's Pan–Tompkins against independently annotated
beats.

The suite has never had independent ground truth for QRS detection. `papers/qrs-yield.html` reports
100.0 % recall / 100.0 % precision over ~187 768 beats and says plainly that this is synthetic ground
truth and not measured human rates; a generator plants QRS complexes and the detector finds them.
Expert annotations on real recordings — with PVCs, bundle-branch blocks, paced beats and electrode
artifact — are the missing instrument, and the one `BEAT-CAPTURE-RECAPTURE` identified as necessary
when the recapture estimator could not separate a missed beat from an invented one.

Ships the instrument only. It reads WFDB `.hea`/`.dat`(212, 16)/`.atr` from a **local, gitignored**
corpus, runs the shipped detector **natively at 360 Hz** (resampling would inject its own fiducial
error and make a shortfall unattributable), matches one-to-one inside the ±150 ms EC57 window, and
reports Se / PPV plus RR agreement via `AnalysisStats.blandAltman`.

No numbers are produced here: no MIT-BIH records exist on this machine, and the tool never fetches.
Absent a corpus it prints an explicit SKIP listing every path searched. `STRATEGIC-PRIORITIES` §P5
gates PUBLICATION of any resulting numbers behind the owner's error-free-operation criterion; building
the path while that gate is shut is the precedent `nsrr-stage-validate.mjs` set for NSRR/MESA.

Bands are pre-stated in the source and the README: ≥99.0 % both = consistent with published
Pan–Tompkins, 95–99 % = shortfall, <95 % = defect. A real defect would be a separate PR.

`--selftest` (22 assertions) is auto-discovered by `selftest-all.mjs`, so the instrument is gated
inside `npm run check` even with no corpus. It proves the path and **refuses to print Se/PPV from
synthetic input** — a circular oracle in a log is indistinguishable from a result.
