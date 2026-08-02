<!--
  O2RING-SYNTHESISED-AXIS-2026-08-02-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-02 · **Follows:** `WEARABLE-DRIFT-DIRECT-2026-08-02-BRIEF.md` · **Affects:** `DexClock.hostAxis`, `CLOCK-CLOSURE-THREE-SOURCE`, `CROSS-DEVICE-DRIFT-AND-CLOSURE` §2.6, `capture-host/` O2Ring PPG timebase

# The O2Ring has no clock in its files — its timestamps are drawn, and the ppm you measure is the drawing error

## 1 · The observation that needed explaining

`WEARABLE-DRIFT-DIRECT` measured device rate directly against the host clock and found the two Polars
stable — H10 ≈ −20 ppm, Verity ≈ −27 ppm, each holding a few ppm across fragments and across nights —
while the O2Ring swung **−2282 … +141 ppm**, sometimes landing near-perfect (−3.4). It called that
"not a clock" and left the mechanism open. The span gate added afterwards sharpened the Polars but did
not settle the ring: its **long** fragments scatter just as widely as its short ones.

Erratic-but-sometimes-perfect is not what a bad crystal looks like. A bad crystal is *consistently*
bad.

## 2 · The mechanism, from the raw bytes

The first data row of each file, same night, same host:

```
H10     sensor timestamp = 838520212230646410      (≈ 8.385e17 ns — a device epoch)
Verity  sensor timestamp = 838520042652546973      (same epoch family)
O2Ring  sensor timestamp =                  0      ← starts at zero
```

Both Polars report a free-running crystal counter. **The O2Ring reports an axis that begins at zero
because it is constructed at capture time**, not read from the device. `O2RING-LIVE-PPG-WAVEFORM` §Phase 2
says so plainly — the ring's live BLE frames carry no per-sample timestamp, so capture writes the PSL
layout "with host-arrival back-timing" — and `capture-host` holds the constant that does it:

```
O2PPG_FS_DEFAULT = 125.738          # calibrated 2026-07-18
O2PPG_NS_STEP    = int(1e9 / O2PPG_FS)
```

The increments confirm it. Across 60,000 consecutive samples the ring uses only **46 distinct
increments**, all of them exact reciprocals of a chosen rate — 7,953,045 ns (125.738 Hz),
7,811,030 ns (128.024 Hz), 7,842,368 ns (127.513 Hz), 7,826,684 ns (127.768 Hz). A crystal does not
emit four discrete periods; a generator with a switchable rate constant does.

**So the ring's "ppm vs host" is the error in the assumed rate, not a property of any oscillator.**
Two long fragments from one night make that arithmetic visible:

| fragment | span | assumed rate | share | measured vs host |
|---|---|---|---|---|
| `…221106_PPG` | 379 min | **128.024 Hz** | 98.1 % | **+91.8 ppm** |
| `…001339_PPG` | 291 min | **125.738 Hz** | 100 % | **+783.4 ppm** |

The fragment pinned to the hard-coded default is off by 783 ppm; the fragment that used ~128 Hz is off
by 92. Inverting, the ring's true delivery rate on this night is ≈ **125.836 Hz** against the assumed
125.738 — and `CAPTURE-HOST-DEEP-AUDIT` §145 had already reached the same place from a different
direction (*"maximum `rows/wall` … exceeds 125.738 on every day"*), without connecting it to the ppm.

### Everything the ring did now has one cause

- **Erratic across fragments** — different fragments carry different assumed rates.
- **"Sometimes near-perfect"** — when the assumption happened to match delivery.
- **Night-dependent** — which is which depends on BLE conditions and which code path wrote the file.
- **Unfixable by span** — a longer fragment measures the same wrong constant more precisely.

## 3 · What this retracts

**Every closure and TCH result involving the O2Ring leg is void, not merely weak.**
`CROSS-DEVICE-DRIFT-AND-CLOSURE` §2.3/§2.6 ran three-source closure and a three-cornered hat across
ECG / Verity / O2Ring. Two of the three pairs contain the ring, so two of three pairwise "rates" were
comparisons against a drawn axis. That the closure residual nonetheless came out at −2.2 ppm on
2026-07-27 is now best read as coincidence, and the TCH degeneracy (ρ = 0.45–0.79, negative variances)
has an obvious cause that nobody needed to invoke correlated physiology for.

The Polar↔Polar result is untouched: neither leg involves the ring.

## 4 · Why `DexClock.hostAxis` must NOT copy the span gate

`dual-clock-rate.mjs` gained a ≥60 min span gate, for a good reason with a number behind it: host
timestamps are **non-monotonic** (measured here: 2,948 backward steps, max 287 ms, in one H10 file;
`VIGIL-OBSERVED-ERRORS` E8 reports up to 470 ms). A slope taken between endpoints inherits that jitter
divided by the span:

| span | ppm error from one 470 ms endpoint slip |
|---|---|
| 11 min | **712 ppm** |
| 60 min | 131 ppm |
| 373 min | **21 ppm** |

Which is exactly the observed pattern — the 10.9 min H10 fragment read −65.8 where the 373 min one
read −20.3. **`hostAxis` should not inherit that rule, for four separate reasons:**

1. **Different estimator, different error law.** The gate protects a slope dominated by two endpoints.
   `hostAxis` fits many anchors spread across a fragment, so endpoint jitter averages down rather than
   dominating. The same jitter that makes an 11-minute *slope* worthless leaves a many-anchor *fit*
   usable.
2. **Different cost of exclusion.** Dropping a short fragment from a rate estimate costs nothing — the
   long fragments still answer the question. Dropping it from `hostAxis` costs **the whole fragment's
   data**, because without an axis it cannot be placed on the host timeline at all.
3. **The residual error is self-limiting.** A short fragment fitted with a poor rate is wrong by at
   most span × rate-error — which at 712 ppm over 11 minutes is 470 ms, i.e. *the jitter that caused
   it*. Applying the correction cannot do worse than not applying it, so there is nothing to protect
   against.
4. **And for the O2Ring, no span makes the axis valid.** The span gate is about **leverage**; the ring's
   problem is **provenance**. A six-hour O2Ring fragment is exactly as unusable as a six-minute one.

**So `hostAxis` should gate on provenance, not duration** — and the test is cheap and exact:

> If a file's first `sensor timestamp` is **0**, the axis was constructed at capture time from an
> assumed rate. It carries no independent clock information, and no fit against the host recovers one.
> Both Polars start from a device epoch ≈ 8.385 × 10¹⁷ ns; the ring starts from zero.

A device that fails that test can still be placed on the host timeline — by trusting the host column
outright — but it must never be treated as a *second* clock, which is what closure and TCH require.

## 5 · Done when

- [ ] `DexClock.hostAxis` refuses, or flags, a device whose `sensor timestamp` axis is
      capture-constructed — provenance, not span — and says which in its return value.
- [ ] `CLOCK-CLOSURE-THREE-SOURCE` and `CROSS-DEVICE-DRIFT-AND-CLOSURE` §2.3/§2.6 record that their
      O2Ring legs are void, and that Polar↔Polar is unaffected.
- [ ] `dual-clock-rate.mjs` reports *why* a device is unusable (drawn axis) rather than only that its
      spread is large — the current "← not a disciplined clock" flag is true but names the wrong cause.
- [ ] The capture-side question is separated from the analysis one and routed: `O2PPG_FS_DEFAULT`
      is ~780 ppm below the observed delivery rate on at least one long fragment, and some fragments
      already use ~128 Hz instead. **Which path writes which, and is the constant still right, is a
      `capture-host/` question** — recorded here, not answered.
- [ ] A gate that a synthesised axis is detected from the bytes, so this cannot be rediscovered a
      third time.

## 6 · Guardrail

**Do not "fix" the ring by re-calibrating the constant.** A better constant makes the drawn axis more
plausible without making it a measurement — the file would still contain no device clock, and closure
would still be comparing two real crystals against one drawing. The honest options are to carry the
host column as the ring's only timebase and say so, or to obtain a per-sample device timestamp from the
protocol if one exists. Recalibration improves the number and destroys the evidence that it is drawn.
