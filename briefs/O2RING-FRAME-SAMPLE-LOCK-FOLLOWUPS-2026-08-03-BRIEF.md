<!--
  O2RING-FRAME-SAMPLE-LOCK-FOLLOWUPS-2026-08-03-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-03 · **Follows:** `O2RING-FRAME-SAMPLE-LOCK-2026-08-03-BRIEF.md` §7

# What executing the 126:1 lock left open

Residue from building `O2RING-FRAME-SAMPLE-LOCK` §4(a) (executed 2026-08-03, recorded in that brief's
§7). Each item is a question the execution raised and could not close, with the reason.

## 1 · Confirm §7.2 forward, from `ppg_n` rather than by reconstruction

The per-frame sample counts in §7.2 were recovered **indirectly** — by matching `OXYFRAME` arrival
stamps against the `PPG` phone-timestamp column, exploiting that each frame's last sample is stamped at
its arrival. The match is sound (2 ms median residual, 33 513 frames) but it is an inference about where
frame boundaries lie, and the whole point of §7 is that inferences about this device keep turning out to
be the third reading of the same data.

`ppg_n` now records the declared count directly. **One night reads it off the file**: group `ppg_n` by
`ppg_dur_step` and confirm `+2` steps carry ~127 rather than ~252. Costs a night and no code.

## 2 · Model the step quantization, then predict the ratio

§7.2 explains the 159/180 split as a beat between the ring's 1.00346 s second and the 1.0028 s poll
interval, but only *qualitatively* — it does not predict that particular ratio. If the model is right,
the imbalance `steps_ahead − steps_flat` should track the poll interval, which is testable against
sessions captured at different cadences (the corpus has them). A model that predicts the ratio would
turn §7.2 from an explanation into a measurement.

Until then, treat `step_imbalance` as descriptive.

## 3 · Retire `counted_loss`, or give it a measured nominal

It is the only counter of the three carrying a constant, it also rides `device_seconds`, and it reports
a **surplus** on clean nights (−5 120 on the reference night, §7.1). It ships signed and documented, but
"documented as unreliable" is a weaker resting place than either removing it or replacing 126 with a
per-session measured mean. Decide which.

## 4 · The status frame's PHASE relative to its 126 samples — the same unknown as §5.3's δ

Carried forward from the parent brief's §4: knowing the ratio is 126:1 and that the host column
re-anchors every frame does not say *where in the 126* the status frame sits, nor whether the re-anchor
is applied at the boundary or distributed across it.

**§5 showed this is not a separate open item.** An unknown constant phase within the frame and §5.3's
unknown constant δ (differential BLE latency) are the *same quantity* reached from two directions — both
are a fixed offset between the ring's sample times and true instants, and neither is separable from the
other without an external reference. That has two consequences:

- **For the coupling question, neither needs solving** — the strict statistic's leave-one-block-out
  centre absorbs any constant (§5.3).
- **For ABSOLUTE PAT, solving either solves both**, and nothing in the corpus can do it: the only
  non-circular reference would be shared mechanical motion, and the ring has no ACC (§5.3). Aligning on
  beats instead is precisely `CROSS-DEVICE-DRIFT-AND-CLOSURE` §3.6's trap.

So absolute PAT on the ring is **blocked on hardware, not on analysis** — it needs a motion channel the
ring does not expose. `O2RING-OPCODE-SURFACE` lists 25 undocumented opcodes; whether any exposes the
accelerometer behind the 1 Hz `motion` byte is the only cheap way this reopens. (The 1 Hz `motion` field
itself is ~5× too coarse: PAT needs tens of ms, one sample per second gives ~1 s.)

## 5 · `Σ N` as a `hostAxis` anchor — SCOPED 2026-08-04, and the blocker is not here

§7.4 argues cumulative `Σ N` gives `DexClock.hostAxis` a genuine `{devMs, hostMs}` pair at ~1 Hz. A
scoping pass answered three questions; the answers move the blocker somewhere else entirely.

### 5.1 · Corpus — not the constraint  `[CORPUS]`
**16 pairs / 38.1 h** of simultaneous **box-captured** O2Ring finger PPG + Polar H10 ECG, the largest a
**9.3 h** night (`…20260801224728` ↔ `…20260801224539`). Box-captured only, deliberately: phone nights
put two wearables ~3.3 s apart against ~0.2 s on box nights.

### 5.2 · The ring's timing is NOT the problem  `[CORPUS]`
Per-frame re-anchor corrections on that night: **median +3.1 ms, IQR 8.0 ms**, p5–p95 ±19 ms, and only
**0.0086 %** of samples carry a correction beyond 60 ms. Against `pat-gate.js`'s `residIQR ≤ 60 ms` that
is **7.5× inside the bound**, and it is robust to the baseline (8.0 ms either against the ms-rounded
8.000 or the true 7.948 step). The anchor spacing came out at a median of **126 samples**, confirming the
parent brief's 126:1 lock a third independent way.

**So "the ring is too jittery for PAT" is refuted, and §7.4's caveat is narrower than it was written.**

### 5.3 · The ring has NO accelerometer — its route is constant-δ, not ACC  `[CODE]` `[CORPUS]`
`tools/pat-matchrate-strict.mjs` aligns the two devices via **shared mechanical motion in both ACC
streams**. The ring emits `SPO2` / `PPG` / `OXYFRAME` and **no ACC at all**, so that path can never run
for an O2Ring↔H10 pair.

That is less fatal than it looks. The ACC anchors correct a **drifting** offset between two independent
device clocks; a box-captured pair shares **one** NTP-disciplined daemon and the ring has **no device
clock at all** (pure host-arrival back-timing). What remains is a **constant** δ — differential BLE
delivery latency — and the strict statistic's leave-one-block-out centre absorbs a constant by
construction. So the **coupling** question is answerable without knowing δ; **absolute** PAT is not.

⚠️ **The one unvalidated assumption:** that δ does not *drift* across a night. LOBO absorbs a constant,
not a ramp. Nothing here tested it, and it is the assumption §5.4's result rests on.

### 5.4 · The coupling run — negative, and the CONTROL is what matters  `[CORPUS]`
Ran with a zero constant offset over the 9.3 h night (scratch probe, not committed):

| | legacy | chance | ratio | p | **strict** | **chance** | **ratio** | **p** |
|---|---|---|---|---|---|---|---|---|
| O2Ring finger, 29 681 beats | 31 % | 19 % | 1.62 | 0.022 | **7 %** | **7 %** | **0.96** | **0.87** |

Indistinguishable from chance under the statistic that can fail — the legacy-says-yes / strict-says-no
pattern `PAT-UNDER-PERBLOCK-ALIGNMENT` §3a built its null to expose.

**The control was already published and it exonerates the ring.** §3a's six **Verity** nights, run *with*
the real ACC alignment, score strict **5–9 %**, **four of six below chance** (e.g. 0.93 at p = 0.83).
The ring's numbers are statistically identical. **Nothing here is ring-specific.**

### 5.5 · What actually blocks PAT — an open item in the parent PAT brief, not in this one
`PAT-UNDER-PERBLOCK-ALIGNMENT` §3a's own unresolved blocker:

> legacy `matchRate` reads **24–42 %** here against **90–96 %** there … **Until the gap is explained, the
> strict numbers above are a method result, not a verdict on PAT.**

The legacy numbers measured above (**31 %**, chance **19 %**) land squarely in the §3a harness's range,
so this pass **reproduced the ~3× discrepancy rather than resolving it**. Two harnesses disagreeing 3×
on the same statistic over the same nights means **neither a positive nor a negative PAT result
currently carries information** — including §5.4's.

**Recommendation: do not attempt PAT on the ring next.** Reconcile the two harnesses first (§3a names
the likely cause: pair selection among BLE-reconnect fragments). It is bounded, and it gates every PAT
result including this one. When it is settled, this pass has already established that the corpus (§5.1)
and the ring's timing (§5.2) are adequate, and that the ring's route is constant-δ + LOBO (§5.3) with
δ-drift as the one thing left to validate.

## 6 · A second ring

Every number in the parent brief and in §7 comes from **one unit** (`S8AW2100`): the 126:1 lock, the
126.037 per device-second, the −3446 ppm, the ±1 s quantization behaviour, and the +11 ms re-anchor
residual. `O2RING-PROTOCOL` §3b already flags the rate as unit-specific; the same caveat now applies to
the lock and the counter quantization.

## Done when
- [ ] §1 confirmed from a real night's `ppg_n` column, or the reconstruction shown to be wrong.
- [ ] §3 decided (retired, or given a measured nominal).
- [x] **§5 SCOPED 2026-08-04** — corpus adequate (38.1 h / 16 pairs), ring timing adequate (IQR 8.0 ms,
      7.5× inside the PAT bound), route identified (constant-δ + LOBO), coupling run **negative** and the
      published Verity control shows it is **not ring-specific**. The blocker is `PAT-UNDER-PERBLOCK-
      ALIGNMENT` §3a's unresolved 3× harness discrepancy, which this pass reproduced.
- [x] **§4 resolved as a duplicate of §5.3** — phase and δ are one unknown; irrelevant to coupling,
      and blocked on hardware (no ACC) for absolute PAT.
- [ ] §2 parked or measured.
- [ ] §6 — a second ring.
