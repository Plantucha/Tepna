<!--
  ECG-PHYSIONET-DIFFERENTIAL-README.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** REFERENCE (living — how to run the QRS differential and how to read what it prints) · **last-verified:** 2026-09-12

# Scoring ECGDex's Pan–Tompkins against independently annotated beats

`tools/ecg-physionet-differential.mjs` joins MIT-BIH expert beat annotations to the shipped QRS
detector's output and reports sensitivity, PPV and RR agreement.

## Why it exists

The suite has never had independent ground truth for Pan–Tompkins. `papers/qrs-yield.html` reports
ECGDex QRS recall **100.0 %** / precision **100.0 %** over ~187 768 beats — and states plainly what
that is: *"This is synthetic ground truth … not measured human rates"*, and *"a real validation needs
simultaneous reference ECG … which this harness motivates rather than replaces."* A generator plants
QRS complexes from a model and the detector finds them; the agreement is close to a tautology, and the
paper does not claim otherwise.

Expert annotations on real recordings are the other thing — real PVCs, bundle-branch blocks, paced
beats, baseline wander, electrode artifact, none of which a generator produces unless someone modelled
it. That is the gap this instrument fills.

## What it is NOT

⚠️ **It is not the A/B that would justify changing the detector.** `VIGIL-DEEP-ANALYSIS` settled that
question three separate times and settled it the other way: *"gate any ECGDex switch on a real
tri-device-corpus (20 nights, H10-01) A/B, not MIT-BIH — a corpus win, not a paper win."* That ruling
stands; this tool does not reopen it.

The two questions are different, and each corpus can answer only one:

| question | instrument | why the other corpus can't |
|---|---|---|
| does our Pan–Tompkins find the beats that are really there? | **annotated records** | the tri-device corpus has no annotated truth at all |
| should ECGDex switch detectors for *our* hardware? | **tri-device A/B** | 360 Hz two-lead clinical tape is not a 130 Hz single-lead strap worn overnight |

The first is exactly what `BEAT-CAPTURE-RECAPTURE` found it could not answer without labels: a
single-source cell mixes a real beat the other detectors missed with a spike this one invented, and no
count of cell sizes separates them — which is how the closed-form estimator reached *"48.5 % of beats
missed by everything"* on a clean night.

## P5 gates the numbers, not the tool

`STRATEGIC-PRIORITIES` **§P5 — PUBLIC-BENCHMARK VALIDATION — GATED** names MIT-BIH (QRS) as
credibility currency behind an owner-set gate: *"~2 weeks of error-free operation; possibly PAT
producing credible output."* **Nothing this tool prints may be published as external validation until
the owner opens that gate.**

Building the instrument while the gate is shut is the precedent `tools/nsrr-stage-validate.mjs` set for
NSRR/MESA, which sits in the same gated list: the work is *"blocked on RECORDS, not on code, and the
way to keep that true is to build the path and PROVE it, so the day a record arrives the only new
variable is the record."*

## Getting the records (a one-time, manual step)

**This tool never downloads anything**, and neither does anything else in the suite — no bundle, no
gate, no CI job may reach the network. The MIT-BIH Arrhythmia Database is openly available from
PhysioNet; fetching it is a deliberate act by whoever holds the machine, done outside the repo, using
whatever they normally use.

Place the `.hea` / `.dat` / `.atr` triples in any one of:

1. `--dir <path>` (explicit, wins)
2. `$DEX_PHYSIONET`
3. `uploads/physionet/mitdb/` — **already gitignored** by `uploads/*`, so records cannot be committed
   by accident
4. `../physionet/mitdb/`

With no records the tool prints an explicit `⊘ SKIP`, lists every path it searched, and produces **no
metrics**. A skip is not a pass.

## Running it

```sh
node tools/ecg-physionet-differential.mjs --selftest        # proves the path; needs no records
node tools/ecg-physionet-differential.mjs --dir <mitdb>     # score real records
node tools/ecg-physionet-differential.mjs --dir <mitdb> --json
node tools/ecg-physionet-differential.mjs --dir <mitdb> --pin   # record sha256s into the manifest
```

`--selftest` is discovered automatically by `tools/selftest-all.mjs`, so it runs inside
`npm run check` — the instrument stays gated even while the corpus is absent.

## The pre-stated bands

Registered **before** the first run. Do not tune them after seeing a number.

Pan & Tompkins (1985) reported 99.3 % sensitivity / 0.675 % total error over this database;
independent reimplementations land ≈99.3–99.8 % Se and PPV on the same 48 records.

| pooled result | verdict |
|---|---|
| Se ≥ 99.0 % **and** PPV ≥ 99.0 % | **CONSISTENT** — no defect |
| 95.0 % ≤ min(Se, PPV) < 99.0 % | **SHORTFALL** — materially below the published envelope; a real finding, and a **separate PR** |
| min(Se, PPV) < 95.0 % | **DEFECT** |

RR agreement on matched beats: `|bias| ≤ 5 ms` and 95 % LoA half-width `≤ 25 ms`. At 360 Hz one sample
is 2.78 ms and expert annotation placement is itself several samples wide, so this band is about
fiducial agreement, not detector jitter alone.

**If the result exposes a real DSP defect, that is a separate PR.** This tool ships no DSP change.

## Reading the output honestly

- **Never quote a pooled rate without the record count and beat count beside it.** The summary carries
  `recordsExpected` and `partialCorpus` for exactly this reason: a rate over 3 of 48 records is a
  different claim from one over 48, and without the denominator the two read alike.
- **Per-record rates are not the headline.** Records **207**, **108** and **203** are the database's
  known-hard cases (ventricular flutter, severe artifact); a low rate there is expected, not
  diagnostic.
- **`pin: unpinned`** means the manifest carries `sha256: null` for that record — *not measured*, per
  `CLAUDE.md §∅`. It is scored and labelled. A **mismatch** against a non-null hash is refused outright.

## Implementation notes

- **Runs natively at the record's own 360 Hz.** Resampling to the H10's 130 Hz was considered and
  rejected: a resampler injects its own fiducial error, so a shortfall would stop being attributable to
  the detector. Running native also exercises the detector's fs-generality, which the shipped code
  claims by taking `fs` as a parameter.
- **The beat set is an explicit set of WFDB codes**, not a range test. A range would silently admit the
  next code added to a file, and the beat set is the whole denominator. Rhythm markers (`+`), noise
  (`~`) and artifact (`|`) are not beats.
- **Matching is one-to-one** inside ±150 ms (the EC57 window). Without that, one noisy burst of
  detections can match the same reference beat repeatedly and inflate sensitivity.
- **RR intervals that span a missed reference beat are excluded.** Splicing across a miss manufactures
  a double-length interval and charges fiducial placement for a detection failure that `fn` already
  counts.
- **`ECGDSP.analyze().times` is in SECONDS.** The reference train is built in milliseconds, so the
  conversion is load-bearing. The first draft of this tool got it wrong, and the end-to-end self-test
  passed anyway because it asserted only that both trains were *non-empty*. The self-test now asserts
  that the detected train **spans the record** and that the join **actually matches** — the two
  assertions that would have caught it. Both are unit/alignment checks, not detector rates.
