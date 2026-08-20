<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-08-11 · **Created:** 2026-08-11

# The PAT blocker is a per-connection BLE offset — record the arrival that makes it measurable

`PAT-WINDOW-CENSORING` left PAT blocked by capture rather than analysis. This brief names the blocker
exactly, records the four mitigations that were tested and eliminated, and ships the one that remains.

## 1 · The blocker

Every wearable pair in this corpus is separated by a **per-connection BLE buffering delay**. Measured
Verity-minus-H10 from the two devices' shared Polar epoch, across nights:

```
-867  -392  -261  -38  -1  +83  +94  +160  +270  +455  +645  +1030  +1044  +1148  +1321   ms
```

**2.2 seconds of spread** between recordings of the same two devices on the same host. PAT needs ~10 ms.

The offset is **constant per connection and arbitrary between connections** — confirmed structurally:
each PPG file spans exactly **one `link_epoch`**, so there is no second connection within a night to
difference against. The consequence is that **7 of 10 nights are anatomically impossible**: the ankle,
which is the longer path, reports arriving *before* the finger. That is what caps the usable corpus at
**2 site-nights of 10**, and why every new night is a coin flip.

## 2 · Four mitigations, tested and eliminated

| approach | verdict | evidence |
|---|---|---|
| **A better BT adapter** | No | Changes the MAGNITUDE, not the uncertainty. An unknown 200 ms is as fatal as an unknown 800 ms, and the dominant term is device-side batching, not host radio quality. |
| **PPS / stratum-1 host clock** | No | **The host clock cancels.** Every lag is `t_foot − t_R` and both stamps come from the same host, so any clock error is common and subtracts out. Measured host root dispersion is **2.3–2.6 ms** against a 400 ms problem — already 100× better than the term that matters. |
| **Respiration as a shared reference** | No | Right idea — a ~4–5 s period exceeds the whole ±1.3 s offset range, so it could resolve unambiguously where beats (mod one RR) cannot. But the hardware does not carry it: the **O2Ring is AC-coupled** (DC level 100, per-minute DC swing **6**, pulse amplitude 39) so RIIV cannot exist in it, and the **Verity's baseline swings 47× its pulse amplitude**, burying a ~1 % respiratory modulation. |
| **Heartbeat on the ankle ACC** | No | Chest ACC carries it strongly (**5.6–23.1×** a phase-scrambled control); the **ankle gives 1.37–1.45×** with no consistent arrival. The ballistocardiogram is a torso phenomenon, and a limb on a mattress is damped. |

A deliberate **sync tap** survives as a physical option but needs wakefulness, so it works only at
lights-out and wake. ⚠️ And a tap on one site is **not** a shared event: transient coincidence between
chest and ankle measures **1.1–1.3× chance**, and ankle–finger is *below* chance — independently
reproducing `ENVELOPE-ANCHOR-EXPORT`'s 3-shared-of-75. The workable form is to bundle all three sensors
and tap them together before donning, so one impulse genuinely reaches all three.

## 3 · Why the offset cannot be recovered from the signal files

The natural estimator is `min(host arrival − device timestamp)`: BLE buffering is **one-sided** — a
packet can only ever be late — so the minimum converges on the offset. This is NTP's minimum filter, it
needs no hardware, and both columns are already in every row.

**It fails, and the reason is in our own writer.** `StreamWriter` records each sample's `phone` stamp
**back-timed across the packet** from a single arrival, so every per-sample host stamp is a *derived*
quantity and the distribution's lower edge is smeared by the packet span rather than being an edge.
Measured across the corpus, the minimum sits **27–115 ms below the 1st percentile** — an outlier, not a
floor. Correcting by it moves 3/16 nights to 4/16, which is noise.

## 4 · The fix

`on_pmd` already computes the true `arrival` and then discards it after decoding. `PmdArrivalLogWriter`
records it, in a per-session `*_PMDARRIVAL.csv`:

```
Phone timestamp;device;meas;first_sensor_ns;last_sensor_ns;n_samples
```

- **The arrival is raw**, not derived and not back-timed, so `min(arrival − first_sensor_ns)` has a real
  floor and the per-connection offset becomes measurable.
- **`n_samples` is kept** because the packet span is exactly the width of the smear this replaces.
- **Written BEFORE the `writers.get(meas)` gate** — a stream with no writer still carries a usable
  arrival↔device pair, and the offset is a property of the **link**, not of whichever streams are on.
- **A sidecar, never a column**, for the reason `LinkLogWriter` states: the vendor `*_ECG.txt` /
  `*_PPG.txt` layouts are a POSITIONAL contract that ECGDex/PPGDex/MotionDex parse by index, and adding
  a field to them silently corrupted consumers once already (2026-07-18).
- **Telemetry, not physiology** — it must never enter a `ganglior.node-export` as a metric.

Volume is one line per packet, order 10–20 MB a night.

## 5 · What this does NOT do

- **It does not recover the existing corpus.** The offset is unmeasurable in nights already captured;
  those 2 usable site-nights stay 2. This makes *future* nights measurable.
- **It does not itself correct anything.** It records a measurement. Applying it — and proving the
  correction repairs the anatomical sign — is the next step and is deliberately not bundled here.
- **It assumes the offset is constant within a connection.** That is consistent with everything
  measured (within-night σ 29–36 ms against 2.2 s between nights) but has not been directly tested,
  and this sidecar is what would finally allow it to be.

## 6 · Hardening — what shipping the first cut exposed

The first version covered only the Polar path, which made it **half a fix**: the finger leg — half of
the anatomical check that fails on 7 of 10 nights — had no arrival↔device pairing at all.

- **The ring.** It exposes no device clock on any streaming opcode, but `live["duration"]` (seconds
  into its session) measures **1–55 ppm** against the host once segmented on its resets. Now paired
  with true frame arrival. ⚠️ **1 s quantised, so the ring's offset must be FITTED, not min-filtered** —
  ~~a minimum over a quantised counter returns the quantum~~. **THAT REASON IS RETRACTED (2026-08-11).**
  The quantum does not contaminate a minimum: worst error 31.5 ms over 270 zero-skew configurations,
  3.2 % of the quantum. The conclusion survives, but the reason was wrong in a way that mattered —
  fitting is owed on **every** device, not just the ring, because a minimum has no TIME MODEL and is
  wrong by roughly half the span's drift (242 ms measured on a real 8 h H10 capture). See
  [`PAT-OFFSET-ESTIMATOR-2026-08-11-BRIEF.md`](PAT-OFFSET-ESTIMATOR-2026-08-11-BRIEF.md) §5, which
  ships that fit. The `meas` column names which estimator applies, and the QC check refuses to
  floor-judge the ring rather than manufacturing a nightly failure.
- **A silent failure the first cut introduced.** The write is wrapped in a bare `except: pass` —
  correct, telemetry must never disturb the data callback — which makes a *persistent* failure
  invisible. `arrival_rows` now rides in the device status on both paths.
- **A QC floor check.** `nightqc.arrival_quality()` measures `min − p01` per device per night and
  reports `floor_ok`. Deliberately **not** folded into `ok`: a smeared floor is a defect of the offset
  *measurement*, not of the night's physiology, and conflating them would make a good recording read as
  a capture failure.
- **A robust floor.** `floor_ms()` returns `(estimate, spread)` — a low quantile rather than the bare
  minimum, so one anomalously early arrival cannot become the answer — and **refuses** below 100 points.
  Returning only the estimate is how the earlier attempt produced confidence from noise.
- **A canary.** `alerts.arrival_canary()` fires on both silent deaths: **SMEARED** (`floor_ok: False`)
  and **DEAD** (connected, writing samples, sidecar rows stuck at zero — the only thing that can notice
  the swallowed exception). It never fires on `floor_ok: None`, the quantised ring: an alert that fires
  every night is one nobody reads.

**Two further checks are now MEASURABLE rather than needing code**, and are deliberately left as
analyses to run on real data: whether the offset really is constant within a connection (within-night
σ 29–36 ms against 2.2 s between nights is consistent with it but has never been tested), and the
ECG-vs-ACC within-device control, since both come from one H10 and share its clock.

> **The second one has since been RUN** (`PAT-OFFSET-ESTIMATOR` §4) and it passes: across all four
> `_ECG`/`_ACC` pairs in the box corpus the two streams of one H10 agree to **0.17 ppm worst / 0.10
> mean** under the lower-envelope estimator, against 5.78 / 2.20 under `hostAxis`. The first still
> awaits a night with the sidecar written.

### 6.1 · CI caught what three local runs could not

#1164 failed twice on **coverage, never on correctness**. capture-host enforces 100 % statement *and*
branch coverage via `pytest -q --cov --cov-branch --cov-report=term-missing --cov-fail-under=100`. I ran
bare `pytest`, then `--cov` without `--cov-branch` or `--cov-fail-under` — both reported green below the
gate. Third instance of one pattern in a single session, after `biome lint` (CI runs `biome ci`) and
bare `pytest`: **a locally weaker command than CI's, read as green.** The durable fix is to copy the
command out of the workflow rather than approximate it; see `CONTRIBUTING.md`.

The one real gap it surfaced was an `if arr_wr is not None:` guard whose false arm is **unreachable** —
`arr_wr` is assigned before the callback is defined, and the callback cannot fire until `start_notify`
later still. Removed rather than tested: a test for it could only have faked a state the code cannot be
in. The `try/except` is the guard that matters and it stays.

## Done when

- [x] `PmdArrivalLogWriter` in `capture-host/writers.py`
- [x] wired into `on_pmd`, before the writer gate, with the callback protected
- [x] closed in the session teardown even when no packet ever lands
- [x] tests pin exact integer ns, distinguishable 8 ms arrivals, blank-never-zero, and an end-to-end
      min-filter that recovers a planted 400 ms offset within 5 ms of the 1st percentile
- [x] mutants killed: blank→0 (1 failure), arrival rounded to the second (2), ns as float (5)
- [x] capture-host suite **3283 passed at 100.00 % under CI's exact command** (statements AND branches)
- [x] §6 hardening: ring path · `arrival_rows` in status · `arrival_quality` QC · `floor_ms` · `arrival_canary`
- [x] mutants killed — floor: bare minimum (3), answering below 100 points (1); QC: floor-judging the
      quantised ring (1); canary: never fires (2), falsy test instead of `is False` (1), dead arm dropped (1)

Related: [`PAT-WINDOW-CENSORING-2026-08-11-BRIEF.md`](PAT-WINDOW-CENSORING-2026-08-11-BRIEF.md) ·
[`PAT-WANDER-ELIMINATION-2026-08-10-BRIEF.md`](PAT-WANDER-ELIMINATION-2026-08-10-BRIEF.md) ·
[`ENVELOPE-ANCHOR-EXPORT-2026-08-01-BRIEF.md`](ENVELOPE-ANCHOR-EXPORT-2026-08-01-BRIEF.md)
