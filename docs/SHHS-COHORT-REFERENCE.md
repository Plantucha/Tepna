<!--
  SHHS-COHORT-REFERENCE.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** REFERENCE (living — cohort facts, re-measure if the corpus changes) · **last-verified:** 2026-09-13

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

## Method

Pure annotation parsing: stage identity from the authoritative `|<code>` suffix (0 Wake · 1 N1 ·
2 N2 · 3 N3 · 4 N3 · 5 REM · 6 Movement · 9 Unscored), TST summed over N1/N2/N3/REM block durations,
event classes matched on `EventConcept` text. Records with no staged sleep are excluded rather than
scored zero. No signal file is read, so this is reproducible on any machine holding the annotations.
