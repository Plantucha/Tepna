<!--
  SHHS-COHORT-REFERENCE.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** REFERENCE (living — cohort facts, re-measure if the corpus changes) · **last-verified:** 2026-09-20

# What the SHHS1 cohort actually contains

Measured over **all 5136 scored annotation files**, not the 99 that carry signals. Every figure
here needs only the XML, which is already local — no EDF, no download.

> ⚠️ **This file exists because a cohort property was measured on the signal-carrying subset and was
> ~4 points off** (residue `2026-09-13-convention-measured-on-the-signal-subset`). A scoring convention
> or an event-rate distribution is a property of the COHORT and its scorers; the 99 records that happen
> to have EDFs inherit whatever selected them for distribution. Quote from here, with the n.

## Respiratory events — and why an ODI cannot track this AHI

| | median | IQR |
|---|---|---|
| AHI | **35.0** /h | 21.5 – 54.9 |
| apnea index | **2.0** /h | 0.4 – 6.9 |
| hypopnea index | **30.5** /h | 19.3 – 45.9 |

**Hypopneas are 85.3 % of all respiratory events**
(1,038,249 against 179,054 apneas).

🔴 **This is the quantified form of the confound that invalidated the first OxyDex comparison.** SHHS
scored hypopneas without requiring a 4 % desaturation, and hypopneas are ~6 of every 7 events in the
AHI. An ODI-derived AHI estimate is therefore being asked to count events that mostly produce no
qualifying desaturation at all — it *structurally* cannot track SHHS AHI, and the shortfall is
definitional before any detector behaviour is involved. Do not pair them; see
`tools/nsrr-oxydex-odi.mjs`.

## Desaturation, arousal, sleep

| | median | IQR |
|---|---|---|
| expert desaturation index | **21.5** /h | 14.0 – 32.4 |
| arousal index | **19.6** /h | 13.9 – 27.2 |
| REM fraction of TST | **19.7 %** | 15.3 – 23.7 % |
| total sleep time | **6.11** h | 5.33 – 6.75 |

⚠️ **The arousal index is entirely unconsumed.** Nothing in Tepna scores arousal, and arousal is the
criterion driving the hypopnea rule above. It is the largest annotated signal in this corpus that no
node reads.

## ⚠️ REM fraction: two denominators, both correct

`tools/nsrr-stage-validate.mjs` reports an `expertRemFrac` of ~12.5 %; this file says
19.7 %. They are not in conflict and neither is wrong — they divide by
different things:

    this file       REM / TST                 (sleep only)          19.7 %
    the stage tool  REM / all graded epochs   (wake included)       ~12.5 %

    19.7 % × (TST 6.11 h / recording ~9 h) = 13.4 %   ✓ reconciles

Check the denominator before treating a difference as a defect — and state it when quoting either.

## Oximeter status channel — `OX stat` (applied by the adapter since 2026-09-20)

SHHS1 carries a **1 Hz `OX stat` channel, sample-aligned with `SaO2`**, documented by NSRR as
"Oximetry Status" from the Nonin XPOD 3011 / 8000 sensor (SHHS1 montage; the same row appears in the
CFS, HAASSA and ABC montages as `Ox Status` / `Ox stat`). It is the oximeter's own validity verdict on
its samples. **NSRR does not define its values** — the montage, equipment page, Manual of Procedures and
the sibling datasets were read 2026-09-20 and none maps 0–3 to a condition; the equipment page records
that Compumedics did not share its proprietary algorithms.

What is established, measured over 12 records / 367,680 samples: **0 is indistinguishable from a normal
overnight trace** (100 % in-range, mean SpO₂ 95.0, p5 92.2); every non-zero value is shifted or out of
range (1: mean 87.95, p5 74.2; 2: 50 % in-range; 3: 0.1 % in-range). Stat 3 and half of stat 2 were
already excluded by the adapter's range guard; what survived it was **in-range, flagged, accepted** —
a median 742 samples (5.4 %) per night.

`nsrr-adapter.js` now applies the §∅-conservative rule and nothing finer: **a sample the device marks
as anything but its normal state is absent for computation**, and the rows carry the count
(`oxStat.flaggedSec`, `inRangeFlaggedSec`). Effect on the shipped detector, paired over 278 records
(`tools/nsrr-oxstat-validate.mjs`, 2026-09-20): **ODI-4 median −0.700 events/h** (95 % half-width
±0.23), as-shipped median 3.05 → 2.2, lower on 261/278, ≥1.0/h on 111, worst `shhs1-204801` 30.8 → 16.2.
**22 of 300 records carry no status channel**; those rows pass through untouched and the result reads
`oxStat.present: false` — not flagged, not clean by fiat.

⚠️ Two things this does NOT establish. It does not say what stat 1 *means*: if Nonin/Compumedics
documentation later shows a non-zero state under which the reading is still true, the exclusion is
over-conservative by a known, reported amount and restates from `inRangeFlaggedSec`. And it does not
rescue the ODI-4 surrogate — `papers/odi4-ahi-bias.html` finds ODI-4 under-reads scored AHI, and
masking pushes ODI-4 lower still, so the corrected detector sits **further** below the reference.
SHHS-derived figures published before 2026-09-20 were produced without this channel; whether to
regenerate them is recorded as residue.

## Method

Pure annotation parsing: stage identity from the authoritative `|<code>` suffix (0 Wake · 1 N1 ·
2 N2 · 3 N3 · 4 N3 · 5 REM · 6 Movement · 9 Unscored), TST summed over N1/N2/N3/REM block durations,
event classes matched on `EventConcept` text. Records with no staged sleep are excluded rather than
scored zero. No signal file is read, so this is reproducible on any machine holding the annotations.
