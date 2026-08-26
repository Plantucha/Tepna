<!-- SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living — last-verified 2026-08-26) · **Created:** 2026-08-26

# Sena UD100-G03 vs UB500 — BLE delivery-timing comparison

**One-line result: the two pre-stated band sets DISAGREE, and the disagreement is the finding —
the difference lives in the BODY of the delivery distribution (+~30 % IQR) and NOT in the tail
(p99 +11 %, nowhere near the 1.5× band). The burst-delivery hypothesis fails its own test.**

This is a **flag for a controlled comparison, not a radio measurement.** n=1 Sena night, three
confounds, one of them landing directly on the flagged streams. Nothing here justifies a hardware
decision on its own.

---

## 1 · Why this exists

The Sena UD100-G03 (CSR8510 A10, `0a12:0001`) replaced the UB500 on the three wearables on
2026-08-25; the UB500 moved to the CPAP. The Sena advertises ACL MTU **310:10** against the UB500's
**1021**, and has no DLE / 2M PHY. The hypothesis was therefore about **burst shape**: smaller ACL
buffers should force fragmentation and widen the **tail** of inter-arrival times.

The bands below were written **before any Sena data existed** precisely so that hypothesis could
lose. It did.

## 2 · Method — windowed BY CONSTRUCTION, never trimmed

The naive run is `jitterfloor.py <night-dir>`, which consumes a whole night. That would have
silently swallowed two contaminated regions of 2026-08-25: a 04:42→05:37 disruption block, and the
owner's morning pre-test. **A silent trim is how a confound becomes a finding**, so instead the
tool's own API (`parse_pmdarrival` + `stream_jitter`) was driven with a hard time filter.

- **Window: 23:11 → 04:42 (5 h 31 m), applied IDENTICALLY to every arm** — the Sena night and all
  three UB500 baselines. Same clock window on every arm also controls for time-of-night effects
  (body position, sleep stage), which a whole-night-vs-window comparison would have confounded.
- **Frame counts matched** — H10 ecg: Sena 35,293 vs UB500 34,359 / 28,395 / 16,271. The result is
  not a sample-size artifact.
- **Baseline = 2026-08-22 / -23 / -24**, the last three UB500 nights before the swap.

Reusing `jitterfloor` rather than hand-rolling matters: it already refuses a drawn device axis, and
its half-IQR (not MAD) choice is deliberate — delivery jitter's alternating ±J residuals are
bimodal, where MAD lands *on* a cluster and under-reads.

## 3 · Results

### 3.1 Supplementary band — half-IQR delivery jitter (ms) — **FLAGGED**

| stream | 08-22 | 08-23 | 08-24 | **SENA** | band | verdict |
|---|---|---|---|---|---|---|
| H10 ecg | 22.545 | 22.556 | 23.028 | **29.497** | > 27 | **FLAG** (+30.8 %) |
| H10 acc | 22.722 | 22.820 | 22.478 | **28.951** | > 27 | **FLAG** (+27.4 %) |
| Verity ppg | 51.170 | — | 44.117 | 55.829 | > 65 | no |
| Verity acc | 208.794 | — | 210.886 | 213.463 | report-only | — |
| Verity ppi | 119.250 | — | 120.000 | 131.000 | report-only | — |
| O2Ring dur | 15.000 | 12.000 | 10.500 | 28.500 | report-only | — |

### 3.2 Original band — inter-arrival p99 > 1.5× UB500 median p99 — **NOT flagged, 0 of 6**

| stream | UB500 median p99 | 1.5× threshold | SENA p99 | verdict |
|---|---|---|---|---|
| H10 ecg | 717 | 1075 | 799 (+11 %) | no |
| H10 acc | 854 | 1281 | 950 (+11 %) | no |
| Verity ppg | 1103 | 1654 | 1103 | no |
| Verity acc | 2818 | 4228 | 2818 | no |
| Verity ppi | 5260 | 7890 | 5555 | no |
| O2Ring dur | 1105 | 1657 | 1411 | no |

### 3.3 Why the split is the product

Body up ~30 %, tail up ~11 %. **ACL 310:10 vs 1021 predicts the opposite shape** — fragmentation
widens the tail. So the primary hypothesis is unsupported *by the test written for it*, while a real
difference exists somewhere the hypothesis did not predict.

Had only the supplementary band been run, this would have been reported as a burst finding and been
wrong. That is the entire argument for carrying two independent band sets.

Direction consistency: **6/6 streams up.** No p-value is quoted — the streams share one adapter and
one host, so they are not independent draws and any sign test would be optimistic.

## 4 · ⚠️ UNPRESTATED observation — stall behaviour (NOT a result)

Max in-window inter-arrival gap (ms):

| stream | UB500 (3 nights) | **SENA** |
|---|---|---|
| H10 ecg | 76,107 / 86,948 / 27,996 | **6,079** |
| H10 acc | 76,109 / 86,453 / 27,836 | **6,174** |
| Verity ppg | 35,897 / 37,000 | **5,677** |
| Verity acc | 43,455 / 40,541 | **6,327** |
| Verity ppi | 57,074 / 54,936 | **6,840** |
| O2Ring dur | 16,703 / 4,060 / 28,897 | **6,385** |

**UB500 stalls for 27–87 seconds in-window; the Sena's worst is ~6 s, on every stream.** The Sena
maxima cluster at 6.1–6.8 s across four *independent devices* — one shared ~6 s adapter event, not
per-device. Likewise UB500's 76,107 / 76,109 pair on 08-22 is one shared event. This is consistent
with the separately-recorded "**the UB500 goes deaf**" behaviour.

**No stall band was pre-stated, so this is NOT scored and must not be cited as a result.** It is
recorded here, before any threshold could be tuned to it, so that a future test is honest.

## 5 · Pre-registration for future nights — **DECLARED-KNOWLEDGE, NOT BLIND**

The label matters and is deliberate. A blind pre-registration was no longer available once §4's
numbers existed; deriving a threshold from the Sena's observed ~6 s cluster would be threshold-
fitting one step removed. So:

> **Declared:** chosen 2026-08-26 with knowledge of 1 Sena + 3 UB500 nights.
> **Metric:** max in-window inter-arrival gap, per stream, identical 5 h 31 m window.
> **Band:** an arm is *stall-prone* if the **median across ≥ 3 nights** of its per-night max exceeds
> **15,000 ms** on either H10 leg.
> **Derivation:** 15 s sits between the UB500's *minimum* observed in-window max (27,836 ms) and the
> Sena's cluster — taken from the **reference** arm's distribution, never from the arm under test.
> **Hard requirement: ≥ 3 Sena nights before any verdict.** n=1 is the real limiter, not the number.

It still binds future data, which is most of the value. Calling it blind would have been a worse
error than the weakness it names.

## 6 · Confounds — three, and one lands on the flagged streams

1. **n = 1 Sena night.** The single largest weakness.
2. **Fresh H10 bond** — the H10 was re-bonded to the Sena on 2026-08-25, and the H10 is exactly what
   flagged. *Partial counter-evidence:* the O2Ring, which is **never bonded** (it rejects Just-Works
   pairing and streams unbonded), moved proportionally more. So the effect is not confined to the
   re-bonded device — but the O2Ring's estimator rests on the suspect axis in §7, so it corroborates
   **directionally only** and carries no weight.
3. **Zephyr absent from the bus** — unplugged before this night, changing USB contention.

## 7 · Defect found while doing this: `_device_axis_is_drawn` misses a quantized counter

`jitterfloor`'s headline "DELIVERY-JITTER FLOOR" was, on all three UB500 nights, the
`Wellue O2Ring-S|OXYLIVE_DURATION_S` stream via the **vs-device** estimator with a base of *exactly*
1000.00 ms. But the ring's axis is synthesized and its duration counter is ±1 s quantized — so
differencing host deltas against it is the "launder host jitter into agreement" failure the module's
own docstring warns about.

Measured modal-delta distribution (2026-08-24):

| stream | modal share | **top-3 share** | detector fires? |
|---|---|---|---|
| H10 ecg | 0.702 | **0.999** | no |
| O2Ring dur | 0.624 | **1.000** | no (threshold 0.99 on the *single* mode) |
| Verity ppi | 1.000 | 1.000 | **yes** |

**The obvious remedy is FALSIFIED by the same table.** Widening to a top-N concentration test would
flag `H10 ecg` at 0.999 — a genuine device clock, and the very stream this comparison relies on as
its precision instrument. Concentration does not separate the two populations.

**What separates them is base ROUNDNESS:** the O2Ring's base is 1000.0; every real stream's is
561.5, 671.2, 707.4, 709.8, 2185.6 — none near an integer second. A base that round is a property of
the counter, not the link. Remaining weakness: roundness alone would false-positive on a genuinely
1 Hz device, so a third leg is needed (evidence the axis is quantized to that same unit). No
threshold is proposed for it, because none has been measured.

## 8 · Reproduction

```sh
# on the capture box, per arm
python3 - <<'PY'
import sys, datetime as dt; sys.path.insert(0,'/opt/tepna/capture-host')
from pathlib import Path; import jitterfloor as J
a = dt.datetime.strptime('2026-08-25 23:11:00', '%Y-%m-%d %H:%M:%S')
A, B = a.timestamp()*1000, (a + dt.timedelta(hours=5, minutes=31)).timestamp()*1000
st = {}
for p in Path('/srv/tepna/captures/2026-08-25').glob('*PMDARRIVAL*'):
    for k, v in J.parse_pmdarrival(p).items(): st.setdefault(k, []).extend(v)
for k, rows in sorted(st.items()):
    r = sorted(x for x in rows if A <= x[0] <= B)
    if len(r) >= J.MIN_FRAMES:
        j = J.stream_jitter(r)
        if j: print(k, j['n_frames'], round(j['base_ms'],2), round(j['jitter_ms'],3), j['method'])
PY
```

## Done when

- [ ] ≥ 3 Sena nights scored on the §5 band before any stall verdict is stated.
- [ ] The fresh-H10-bond confound retired by re-scoring a Sena night ≥ 2 weeks after the bond.
- [ ] §7's detector third leg measured, then `_device_axis_is_drawn` fixed (do **not** relax
      `DRAWN_CONCENTRATION`; that re-admits a false positive on H10 ecg).
- [ ] Verity baseline widened — 08-23 has no Verity rows in-window, so those baselines rest on
      2 nights, not 3.
