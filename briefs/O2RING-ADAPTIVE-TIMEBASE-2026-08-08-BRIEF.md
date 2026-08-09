<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-08

# O2Ring adaptive timebase — device crystal by default, host discipline when the host earns it

The O2Ring's raw PPG (`0x04` body, captured as `ppg1`/`o2ppg`) has an **exact 125.000 Hz ADC** (32 MHz
crystal ÷ 8 ÷ 32000; TI AFE4403; manufacturer says 125). Today the pipeline processes it on a
**host-disciplined row-rate axis** (~125.7 Hz, `O2PpgGrid` slew + `ppgdex` `hostAxis`). That is correct
*only while the capture host's clock is trustworthy*. This brief makes the timebase adaptive and records
which clock governed each capture.

## 1 · The problem, stated by the owner

> "Default 125, but if somebody has stratum-1 then that will be chosen path. Last week I was out of town
> so it was probably NTP stratum-3; today I'm back home and it will be stratum-1. We probably need to add
> some info about what clock precision is used for capture."

Two independent facts force this:

- **`125.738` is a fiction.** It matches no crystal, no divider, no datasheet — it is the *row* rate
  (`125 + HR/60`, from one inserted `156` marker per detected beat, `DEVICE-RATE-TRUTH` §2). Shipping a
  constant that contradicts the manufacturer is a maintenance landmine: the next coder cannot reconcile
  code (125.738) with documentation (125).
- **The host clock is not universally trustworthy.** `hostAxis` disciplines the device rate to the host.
  On a stratum-1 box that is right; on a free-running / high-stratum host it disciplines to a *worse*
  reference than the device's own ±40 ppm crystal. We cannot assume stratum-1 everywhere.

## 2 · The design

Per capture, choose the RATE reference:

| condition | timebase | rate |
|---|---|---|
| host clock **trusted** (source-stratum ≤ 1, tight chrony skew/RMS-offset) | `host-disciplined` (today's path) | slew + `hostAxis` |
| otherwise (**default**) | `device-crystal` | **125.000**, marker-aware, anchored to host `t0` for absolute time only |

- **Default is the crystal.** ±40 ppm, trustworthy anywhere; the safe floor.
- **Host discipline is opt-in**, gated on *earned* trust — not merely `absolute_ok` (a stratum-3 host is
  `absolute_ok` yet its rate stability may not beat the crystal). The bar is source-stratum ≤ 1 or a
  chrony frequency-skew / RMS-offset threshold (`host_clock` already parses these).
- **The crystal axis must be built correctly**: rate = 125.000, markers **not counted as samples**
  (advance only on real rows), absolute time still anchored to the host `t0`. A naive "pure 125.000
  ignoring the host anchor" is wrong — see §4.

### 2.1 · Provenance stamp (the owner's third requirement)

Every capture records, in the export/sidecar `quality` block:

```
clock: { timebase: 'device-crystal' | 'host-disciplined',
         trust: 'disciplined'|'holdover'|'unknown',   // host_clock.classify()
         source_stratum: <int|null>, chrony_skew_ppm: <float|null>,
         root_dispersion_ms: <float|null> }
```

So a night taken out-of-town (stratum-3 → crystal) is analysed by the clock that actually governed it,
and a reader can see *why*. `host_clock.read_state()` + `classify()` already produce all of this and
`host_clock_poller` keeps it in `STATUS["host_clock"]`; it just is not yet stamped per capture or wired
into the timebase choice.

## 3 · Validation — the crystal axis is sound (ECG-arbitrated)

An earlier confirm claimed the crystal axis destabilised HRV (−19 %/−48 % on one night). **That was
wrong** — it was a naive `cum/125.000` that discarded host anchoring, conflating two changes. Re-run
against the **H10 chest ECG as ground truth** (2026-08-08 00:00 hour, a stratum-1 night; 3394 ECG
R-peaks vs 3382 O2Ring beats, 99.6 % agreement):

| axis | HR err vs ECG | rMSSD err vs ECG |
|---|---|---|
| host `relSec` | +0.17 bpm | −0.6 ms |
| **crystal 125.000 marker-aware** | +0.17 bpm | **−0.4 ms** |

Both match the ECG to ≤0.2 bpm and ≤0.6 ms rMSSD; the crystal axis is marginally *better*. So on a
good-host night the two are equivalent — **defaulting to the crystal costs nothing when the host is good
and protects the night when it is not.** The crystal axis is validated, not risky, when built per §2.

**Owed before ship:** the same ECG comparison on a *bad-host* (travel/stratum-3) trio night, to
positively demonstrate the crystal beating the host. The design is safe by construction regardless (each
branch uses the trustworthy clock), but this is the acceptance evidence.

## 4 · Why not just change the constant (the tempting shortcut)

`O2PPG_FS_DEFAULT` is only the grid's *starting guess* + a label; `ppgdex` derives its working `fs` from
the `ns`-column data, not the constant. So `125.738 → 125.000` **alone** fixes the label/documentation
(worth doing, integrity) but does **not** make signal processing use 125.000 — the pipeline still
processes on the host-disciplined row rate. Making the signal actually use the crystal is the §2 axis
work. Do not conflate the two: the constant/label is a docs fix; the timebase is a computation change.

## 5 · Stages (each its own PR + gates)

1. **Provenance plumb + label honesty (capture-host).** Stamp the `clock{}` block per capture from
   `host_clock`; set `O2PPG_FS_DEFAULT = 125.000` with the row-vs-ADC duality documented; update the
   pin test (`test_o2ring_frame_lock.py:83`) value **and** its reasoning, and the other `125.738`
   references. No bundle, no golden shift (ppgdex derives fs from data).
2. **Crystal axis in ppgdex (bundle).** Add the marker-aware 125.000 axis (rate=crystal, markers not
   counted, host `t0` anchor); select it vs host-disciplined per the stamped `clock.timebase`. Regenerate
   the O2Ring PpgDex goldens (the crystal-path fixtures move; document the ECG-validated deltas),
   re-bundle, GATE A/B, `npm run check`.
3. **Timebase decision + threshold (capture-host).** Wire `host_clock.classify()` → `timebase` choice
   with the stratum/skew bar; add the bad-host ECG validation as the threshold's acceptance test.

## 6 · Acceptance

- Provenance `clock{}` present on every O2Ring export; `timebase` matches the host state at capture.
- Crystal axis reproduces H10 ECG HR/rMSSD within the §3 margins on ≥1 good-host and ≥1 bad-host night.
- `O2PPG_FS_DEFAULT = 125.000`, and no remaining code or comment claims the ADC runs at 125.738.
- Full node suite + capture-host 100 % floor + GATE A/B green.
