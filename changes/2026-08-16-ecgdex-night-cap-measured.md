---
bump: patch
type: changed
brief: GENERATOR-FOLLOWUPS-III-2026-08-08-BRIEF.md
---

`GENERATOR-FOLLOWUPS-III` §3 recorded that ECGDex's 3-night synthetic-patient cap was a size argument
rather than a measured limit, and asked for either a measurement or an honest "this is a guess" label
in the control. Measured 2026-08-16 by running the real `SYNTH.renderECGInt16` plus
`ECGDSP.bandpass`/`detectPeaks` over three `DexPatientGen.resolve('baseline', 3)` nights in one realm.

The premise was exactly right: 3,439,410 / 3,547,050 / 3,634,410 samples per night against the brief's
"~3.4 M". Three nights is 10.6 M Int16 samples — 20.3 MB — generated in 1,203 ms with a further 506 ms
for filtering and peak detection, so about 1.7 s in total.

The consequence is what was missing, and it is not the Int16 storage. Peak RSS was 244 MB against a
48 MB baseline, so roughly 196 MB resident for three nights held at once. The binding constraint is the
`Float32Array` the analysis path builds — 4 bytes per sample, 13.8 MB per night on top of the 6.9 MB of
Int16 — combined with the app accumulating into `allRecordings` rather than releasing. Linear in
nights, 14 (what every other node offers) projects to roughly 900 MB resident.

So the cap stays at 3, now for a measured reason rather than a size intuition, and the control's title
needs no "conservative guess" hedge because it is no longer one. Closed by the measure branch, so no UI
change and no re-bundle is owed.

Recorded with its limits rather than as a clean number: this is Node, not a browser, so it bounds
compute and allocation but not full in-app ingest; it measures cost, not correctness (`detectPeaks`
returned no beat count under the scaling used, and that was not chased because the question was
expense); and the 14-night figure is linear extrapolation, which is a reason not to raise the cap
rather than a measurement of 14 nights.

Docs only.
