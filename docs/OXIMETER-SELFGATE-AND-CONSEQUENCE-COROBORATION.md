<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Build Brief — Oximeter Self-Gate & Consequence-Corroboration

> **For an AI coder.** A small, self-contained reasoning upgrade shared by **OxyDex**, **CPAPDex-SA2**,
> and the **Integrator**. Born from a live failure-injection test (2026-06-13 night): the Polar H10
> chest strap died on schedule, and simultaneously the sleeper's head pinned the O2Ring against a hand,
> squeezing it. The ring reported a **67% SpO₂ cliff** — a near-emergency reading that **never
> happened systemically**. The wrist Polar Sense (still recording) showed steady HR with no surge.
> This brief encodes how the system rejects that false event **without counting devices**.

---

## The principle (why "3 silent + 1 firing = artifact" is the RIGHT verdict for the WRONG reason)

Do **not** implement a majority vote. Two reasons it is wrong:
1. **Capability:** only the oximeter can see SpO₂. ECG and green-LED PPG physically cannot — their
   "silence" is not a vote against the desat (category error). Polar Sense is single-wavelength green
   (~525 nm, HR-optimized); SpO₂ needs two wavelengths (red ~660 + IR ~940). It has **no SpO₂ value**
   to corroborate with — but it can still **refute the event** via consequences.
2. **Lone truths are real:** glucose only the CGM sees; a genuine isolated desat when only the oximeter
   is worn. "Alone ⇒ artifact" would discard every single-sensor truth.

So resolve by a **four-step gate**, not a headcount:

1. **Capability filter** — only sensors that can observe the event OR its obligate consequences vote.
2. **Internal plausibility (self-gate, one device alone)** — a desat coincident with the oximeter's own
   perfusion/pulse-signal collapse is an optical/mechanical artifact, not blood.
3. **Kinetics sanity** — a real systemic desat falls over **tens of seconds** (blood + lung O₂
   reserve). A near-instant cliff (>~1.5 %/s sustained) is a probe/squeeze signature.
4. **Consequence corroboration** — a real 67% desat forces a **compensatory tachycardia / sympathetic
   surge** (and usually an arousal). Look for it on ANY live HR node. Absent ⇒ artifact. Present but no
   SpO₂ sensor ⇒ "something happened, unconfirmed".

Verdict: the event is rejected because it **fails its own plausibility and leaves no physiological
footprint** — not because it was outvoted. This still works when only one HR sensor survives.

---

## Part A — Oximeter self-gate (in `oxydex-dsp.js` AND `cpapdex-dsp.js`)

Identical routine in both (mirror it — like `parseTimestamp`, do not extract a shared util; the two
nodes ship independently and must each stand alone).

```
selfGateDesat(desat, pulseSeries, spo2Series):
  win = samples within desat.onset ± 10 s
  pulseValid   = fraction of win where pulse is present & in [30,220] bpm
  pulseStable  = no >40 bpm step across the desat edge that mirrors the SpO2 edge
  fallRate     = max negative dSpO2/dt over the leading edge   // %/s
  if pulseValid < 0.5  OR  fallRate > 1.5  OR  (pulse flatlines/drops exactly at SpO2 edge):
      desat.artifact = true
      desat.reason   = 'perfusion-collapse'        // or 'nonphysiologic-kinetics'
      desat.sqi      = low (e.g. 0.2)
  // artifact desats are EXCLUDED from ODI and NOT emitted as ganglior_events
```

- A real desat: SpO₂ glides down over 10–40 s, **pulse stays valid** (often rises). Keep it.
- The squeeze: SpO₂ cliffs in 1–2 s, **pulse signal craters at the same instant** (the optical path is
  occluded so BOTH channels die together). Flag it. One device, no network, decided locally.
- Surface in UI: artifact desats shown struck-through / greyed with the reason, never counted in ODI.

## Part B — Consequence-corroboration (in `integrator-dsp.js`)

When fusing a `desat` finding from any oximetry node:

```
corroborateDesat(desat, hrNodesLive):
  if desat.artifact: drop (already self-gated)
  expectSurge = desat.depthPct >= 4          // meaningful desats demand an HR response
  hrNode = pick a live HR source by authority: ECG > pulse-ox > PPG   // capability filter
  if hrNode exists:
     surge = any HR rise within [onset, onset+30s] exceeding node-specific threshold
     if expectSurge and not surge:  desat.verdict = 'artifact-no-consequence'; drop
     else: desat.verdict = 'confirmed'
  else:
     desat.verdict = 'unconfirmed-desat'      // real-or-not unknowable; never publish nadir as truth
```

- Keep the existing apnea match window **`LEAD=15 / TRAIL=60`** untouched (R4 — identical in
  `oxydex-fusion.js` & `integrator-dsp.js`). This is an additional gate on `desat` findings, not a
  change to that window.
- Respect R7: corroboration affects the **verdict/publish** decision; it does not retro-edit `conf`.
  Down-weighting still flows through `effConf = conf × (sqi ?? 1)`.

## Part C — Graceful degradation (the H10-battery half of the test)

Separate but co-tested: when the authoritative HR source (chest ECG) drops out mid-record, the
Integrator must **fall back to the next authority** (pulse-ox → PPG) for HR/bpm per the §6 matrix —
**without** inheriting that backup's artifacts. In the live test the correct end state was: HR from
Polar Sense PPG (clean), desat from O2Ring **rejected** (self-gated + no consequence). The system
should degrade on one signal while quarantining a fault on another — never let a dropout on sensor A
open the gate to a false event on sensor B.

## Tests to add (`tests/dex-tests.js` — Node CI + browser suite share it)

1. **selfGate-kinetics:** synthetic 1.5 s 98→67% cliff w/ pulse flatline ⇒ `artifact:true`,
   excluded from ODI. Gentle 30 s 96→88% w/ valid pulse ⇒ kept.
2. **selfGate-perfusion:** pulseValid<0.5 in window ⇒ artifact regardless of rate.
3. **consequence:** desat depth 6% with NO HR surge on a live ECG node ⇒ dropped
   `artifact-no-consequence`; same desat WITH a 12 bpm surge ⇒ `confirmed`.
4. **capability:** only PPG (no SpO₂ node) present ⇒ a claimed desat ⇒ `unconfirmed-desat`, nadir not
   published.
5. **degradation:** ECG dropout + clean PPG + squeezed O2Ring ⇒ HR sourced from PPG, desat rejected.

These five map 1:1 to the synthetic fixture **"oximeter occlusion artifact during ECG dropout"**
(see `SYNTHETIC-CORPUS-BRIEF.md` / `CPAPDEX-BUILD-BRIEF.md` §8).
