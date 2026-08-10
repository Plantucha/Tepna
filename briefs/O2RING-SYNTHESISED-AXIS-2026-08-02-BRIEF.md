<!--
  O2RING-SYNTHESISED-AXIS-2026-08-02-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-03 (all five boxes; three were already met under `WEARABLE-HOST-AXIS-FOLLOWUPS` §F1 and never propagated back — see 5-RESULT. The one genuinely open item was voiding the two briefs that published O2Ring-cornered results.) · **Created:** 2026-08-02 · **Follows:** `WEARABLE-DRIFT-DIRECT-2026-08-02-BRIEF.md` · **Affects:** `DexClock.hostAxis`, `CLOCK-CLOSURE-THREE-SOURCE`, `CROSS-DEVICE-DRIFT-AND-CLOSURE` §2.6, `capture-host/` O2Ring PPG timebase

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

### ⛔ Do NOT extend this finding to the H10 — its axis is a REAL clock, and it was checked

The natural next thought after this brief is *"if the ring's stamps are drawn, whose else are?"*. That
question has been asked and answered for the H10, and the answer is **no** — recorded here so the
drawn-axis conclusion is not spread by association to a device that passes the test.

`H10-ECG-RATE-CORPUS-CHECK-2026-08-04` §3 ran **this brief's own discriminator** over 50 ECG files of
the vendor's PSL decode (H10 `02849638`, 5.6 M rows; re-measured 2026-08-09):

| | O2Ring (drawn) | H10 ECG (real) |
|---|---|---|
| distinct inter-sample deltas | **46** over 60 000 samples — 1 per fragment, all exact reciprocals of an assumed rate | **660 median per file**, 8 029 pooled |
| modal delta share | **100 %** within a fragment | **26.7 % median**, 55.4 % worst-case — nowhere near the ≥ 99 % bar |
| nominal share (`1e9/130` exactly) | n/a | **0.000 %** — so it is the device's clock, not our fallback |

So the H10's ppm figure **means something** and the ring's does not: −47 ppm of real crystal error
against a drawing error that changes with whichever constant the writer chose. The two must not be
pooled, averaged, or quoted in the same breath as "device clock error".

⚠️ The two cautions this brief earned still apply to the H10 *as method*, just not as verdict: the
2026-08-05 retraction above (a **writer** can erase the fingerprint a reader depends on) and
`DEVICE-RATE-TRUTH` §4.1 (a rate landing **exactly** on nominal is a fallback signature). Both are
reasons to re-run the discriminator rather than to trust this table forever — which is why the
nominal-share row is in it.

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

> ## ⚠ RETRACTED IN PART — 2026-08-05 (`DEEP-AUDIT-V` §2.7 F17)
>
> **The `quantizedShare ≥ 99 %` discriminator was correct when measured and is no longer sufficient.**
> On 2026-07-27 `capture-host/capture.py` gained a rate-SLEW estimator (`_O2PPG_EST_SLEW`): `step_s`
> now moves as the measured rate drifts, so the accumulated `sensor_ns` column stopped being a
> singleton delta set. Measured on a real 2026-08-03 night: **`quantizedShare` 0.00083**, i.e. the
> fingerprint is gone — while the axis became *more* synthetic, not less. `capture.py` accumulates
> `self.ns += step_ns` from a step estimated against HOST arrival times; the ring contributes sample
> ORDER and nothing else.
>
> Consequence: from 2026-07-27 until the fix, **every O2Ring night certified itself
> `timingSource:'device+host'` — the top provenance tier, the one that asserts a real second clock
> disciplined the recording.** The reasoning in this section is sound; what it did not anticipate is
> that the WRITER can erase the evidence the reader depends on.
>
> The verdict is now keyed on the **layout** (`site === 'finger'` — one channel, or several carrying
> byte-identical samples), which is the provenance fact itself rather than a statistical proxy for it.
> `quantizedShare` is still published raw, so a reader can see the fingerprint is absent while the
> verdict is drawn. **A detector that infers provenance from a signature is only as durable as the
> writer's habits** — prefer a fact the file states over one it happens to imply.


- [x] **`DexClock.hostAxis` flags a capture-constructed axis — provenance, not span** (executed under
      `WEARABLE-HOST-AXIS-FOLLOWUPS` §F1, and extended by #746). ⚠ **The test proposed in §4 does NOT
      work and was replaced**: `first sensor timestamp == 0` is true of *every* O2Ring fragment,
      including the post-2026-07-28 **measured** ones, so it separates relative-epoch from
      absolute-epoch — a vendor convention — not drawn from measured, and shipping it would have
      condemned exactly the good sessions. What separates them is the **delta distribution**:
      `quantizedShare ≥ 99 %` (100.0 % on the 16 pre-2026-07-28 files vs 0.1 %/0.0 % after; Verity
      0.1 %). Surfaced as `quality.timingSource` (`device+host` · `host` · `none`), and #746 added
      `hostAxis.independent` / `spreadMs` for the sibling question — whether the HOST column is a second
      clock at all (box captures 101.89–5124 ms residual spread, phone captures 0.13–1.00 ms).
- [x] **`CLOCK-CLOSURE-THREE-SOURCE` and `CROSS-DEVICE-DRIFT-AND-CLOSURE` §2.3/§2.6 record that their
      O2Ring legs are void** (2026-08-03). Banners added at the head of the closure brief and at both
      cross-device sections, stating what is void (the residuals, the normalised per-device rates, the
      −2.2 ppm "closure" on 07-27) and what survives (**Polar↔Polar / ECG↔Verity — neither end is the
      ring**). The TCH degeneracy (ρ = 0.45–0.79, negative variances) is noted as needing no
      correlated-physiology explanation: a drawn corner produces exactly that.
- [x] **`dual-clock-rate.mjs` reports *why* a device is unusable** — it names the drawn axis rather than
      only a wide spread. The old "← not a disciplined clock" flag was true but blamed a crystal that is
      innocent; there is none in the file.
- [x] **The capture-side question is separated and ROUTED, not answered** (the box asks for exactly
      that). It lives at `capture-host/capture.py:279` (`O2PPG_FS_DEFAULT = 125.738`, validated on ONE
      unit, S8-AW 2100) and `settings_schema.py:33` (`o2ring.ppg_fs`, range 100–200). The open question
      is which write path emits ~125.738 and which emits ~128.024 on the same night, and it is a
      `capture-host/` matter — deliberately NOT touched here (that file is in flight on another branch).
      `O2RING-PROTOCOL-2026-07-17-BRIEF.md` already carries the header note that the calibration is a
      real fit and **not a timebase**, with §6's guardrail attached.
- [x] **A gate that a synthesised axis is detected from the bytes** — `ppgdex · axis-provenance`,
      including a lock-out assertion so the rejected `first ns == 0` test cannot be reintroduced without
      the suite failing, and a sawtooth control (a near-constant first difference scored 0.979, nearly
      passing as drawn for the opposite of the real reason).

### 5-RESULT — reconciled against the tree, 2026-08-03

This brief sat `PROPOSED` with five empty boxes while **three of them had already been executed** under
`WEARABLE-HOST-AXIS-FOLLOWUPS` §F1 — its own §F1 says so in prose ("of its §5 acceptance items, three
are now met") and nothing propagated back here. Verified in the code, not off that line:
`clock.js` carries `independent`/`spreadMs`, `ppgdex-dsp.js` carries `quantizedShare`/`drawn`,
`tools/dual-clock-rate.mjs` names the drawn cause, and `tests/dex-tests.js` carries the gate.

**Only box 2 was genuinely outstanding, and it was the one that mattered**: two briefs were publishing
closure and three-cornered-hat numbers whose corners were a drawing, with nothing on the page saying so.
That is the failure this brief exists to prevent, sitting one link away from the brief itself.

## 6 · Guardrail

**Do not "fix" the ring by re-calibrating the constant.** A better constant makes the drawn axis more
plausible without making it a measurement — the file would still contain no device clock, and closure
would still be comparing two real crystals against one drawing. The honest options are to carry the
host column as the ring's only timebase and say so, or to obtain a per-sample device timestamp from the
protocol if one exists. Recalibration improves the number and destroys the evidence that it is drawn.
