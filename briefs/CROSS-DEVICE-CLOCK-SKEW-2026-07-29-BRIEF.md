<!--
  CROSS-DEVICE-CLOCK-SKEW-2026-07-29-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-07-29 · **Found while executing:** `MULTINIGHT-CORPUS-FINDINGS-FOLLOWUPS-2026-07-29-BRIEF.md` §1.1 · **Affects:** Integrator fusion, `tools/cpap-oxy-couple.mjs`, every CPAP↔other-node event comparison

# The CPAP's clock is ~39 minutes wrong, and nothing in the suite can tell

Every CPAP-to-other-node event comparison the Integrator has ever made was aligned against a clock
that is **about 39 minutes slow**. The fusion did not fail loudly — it found no overlap, which is
indistinguishable from *there was no overlap*.

This is a **device/configuration fault, not a Tepna bug**. What *is* a Tepna gap is that the suite
cannot detect it: `runFusion` takes a `toleranceSec` (default **120 s**) and silently reports nothing
when a node sits 2,370 s away.

---

## 1 · The measurement

Found while asking a different question. `MULTINIGHT-CORPUS-FINDINGS-FOLLOWUPS` §1.1 asked whether
OxyDex's periodic-breathing episodes land inside the device's CSR spans. Answer: **0 of 20**, on the
three nights that have both — but with a chance expectation of only ~1.1, that is *consistent with*
chance and proves nothing on its own. What did stand out was the offsets: on 2026-06-25 and
2026-07-08 the first PB episode landed **exactly +24 min** after the CSR span ended, on both nights.

That is either physiology or a clock, so it was tested against a pairing with a **known** lag.
Apnea → desaturation is one: circulation time makes it 10–40 **seconds**, never minutes. Cross-
correlating CPAP-scored apnea/hypopnea times (read straight from the `_EVE.edf` TALs — no DSP in the
path) against OxyDex desaturation events, scanned over ±60 min of lag:

| | coincidences (±60 s) |
|---|---|
| **best lag +2,370 s (39.5 min)** | **240** |
| lag 0 | 27 |
| mean over all lags (the random floor) | 38.7 |

**6.21× over floor at +39.5 min; lag 0 is *below* the floor.** 36 nights, 807 CPAP events, 536 desat
events.

### It is not a parse bug

Every `_EVE.edf` / `_CSL.edf` header start time was checked against the ResMed filename, which encodes
`YYYYMMDD_HHMMSS` independently. **They agree on every file.**

### It is not drift, and not an artifact of pooling

Estimated **per night**, independently — 27 of 32 nights land within ±5 min of the corpus peak, each
with its own 4.7×–23.5× peak-to-floor ratio:

```
median best lag  39.5 min      min −33.5      max 42.0      n = 32
within ±5 min of 39.5 : 27/32
```

Stable across seven weeks (2026-06-10 → 07-27). The five outliers are the low-count nights (2–11
coincidences at peak), where no lag dominates.

### It is the CPAP that is wrong, not the oximeter

Repeating the cross-correlation against a **second, independently captured** node — ECGDex's
`autonomic_surge` events, which reach the corpus through the capture host exactly as the O2Ring does:

| | coincidences |
|---|---|
| **best lag +2,280 s (38.0 min)** | **384** |
| lag 0 | 93 |
| floor | 89.8 |

**4.28× over floor at +38.0 min**, and again nothing at zero. Two separately host-captured devices
both place the CPAP ~38–40 min behind. The three host-captured signals agree with each other by
construction — `trio-batch` requires a three-way *overlap* to accept a night at all, and it accepts
37 of them. So the outlier is the one device with its own user-set clock.

39 minutes is not a timezone (no zone is offset by 39 min) and it does not grow over seven weeks, so
it reads as a clock that was **set approximately once and never corrected**.

---

## 2 · What it breaks

- **Integrator fusion.** `integrator-dsp.js:3320` — `dtMs = (opts.toleranceSec ?? 120) * 1000`. A node
  2,370 s away never falls inside a 120 s window, so **no CPAP event has ever co-occurred with any
  other node's event** in this corpus. Everything downstream of that — `alsoObservedBy`, the apnea
  confirmation path, the redundancy accounting `INTEGRATOR-FUSION-ISSUES` §3.1 exists to protect —
  has been operating on an empty intersection.
- **`tools/cpap-oxy-couple.mjs`** is a CPAP↔oximetry coupling analysis built directly on this
  alignment.
- **`MULTINIGHT-CORPUS-FINDINGS-FOLLOWUPS` §1.1 is void as measured** and must be re-run with the
  offset removed before anything is concluded about the two PB detectors. The 0/20 result was
  measuring the clock, not the detectors.
- **Not affected:** anything per-night and aggregate. The AHI-vs-hypoxic-burden decorrelation
  (§1.2, `r = 0.06`) compares night totals, not event times, and stands.

---

## 3 · What to do

The device fault and the blindness are separate problems and want separate fixes.

### 3.1 · Detect it — the part that is Tepna's job

A fusion that finds **zero** overlap between two nodes that each reported plenty of events has learned
something, and currently discards it. Proposed: estimate the cross-node lag that maximises
co-occurrence, and when the best lag is far outside the tolerance while the peak clearly beats the
floor, **say so** — `clockSkewSuspected: { nodes: ['CPAPDex','OxyDex'], lagSec: 2370, peakOverFloor: 6.2 }`
— rather than reporting a quiet nothing. The estimator is ~30 lines and already prototyped in this
brief's measurement.

This is the same discipline as `MULTINIGHT-CORPUS-FINDINGS` §3 (a stuck motion column is a fault, not
a still night) and §2 (a shape violation is not low coverage): **a silent zero is the thing to catch.**

### 3.2 · Do NOT auto-correct

Tempting and wrong. An inferred offset applied silently would make the fusion look right while
resting on an estimate, and it would mask the real fix (set the machine's clock). Detect, report,
refuse to fuse across a suspected skew — the same fail-closed shape `DEEP-AUDIT-FOLLOWUPS` §C2 just
took for mismatched REM denominators.

### 3.3 · Fix the device, then re-measure

Set the AirSense clock against a reference and record the correction. Every night already on the card
keeps its skew, so a corpus-wide `clockOffsetSec` per source may be worth carrying in
`CPAP-AUTOHARVEST`'s harvest metadata — but as a **recorded observation**, never as a silent
adjustment.

### 3.4 · Then re-run §1.1

With the offset applied explicitly, ask again whether OxyDex's PB episodes and the device's CSR spans
describe the same physiology. That question is still open and still matters: OxyDex tells the user
"CS pattern likely — review CPAP pressure" on 28 of 37 nights while the machine scores CSR on 4.

---

## 4 · Done when

- [ ] The Integrator reports a suspected cross-node clock skew instead of a silent empty
      intersection, with the lag and the peak-over-floor that justify the claim.
- [ ] A gate pins it: two synthetic nodes with a planted offset far outside `toleranceSec` must
      produce the skew report and **must not** produce a fused co-observation — plus a control at
      zero offset that fuses normally, so the check cannot pass vacuously.
- [ ] No auto-correction anywhere in the path (assert it: a skewed pair stays unfused).
- [ ] The device clock is corrected and the correction recorded.
- [ ] §1.1 re-run with the offset removed, and its verdict written into
      `MULTINIGHT-CORPUS-FINDINGS-FOLLOWUPS`.
