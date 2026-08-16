<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-08-15 (**executed as #1227**, 2026-08-13; the header simply never moved. Verified item-by-item against `main` — see §8. §5's inherited defect and the parent's §7 questions carry to `HOSTAXIS-STABILITY-FOLLOWUPS-2026-08-15-BRIEF.md`) · **Created:** 2026-08-13

# `hostAxis` publishes a bare ppm; the curve behind it is already computed in the other lane

`ALLAN-DEVIATION-2026-08-12-BRIEF.md` (DONE) brought overlapping Allan deviation to **capture-host**:
`allan.py`, reported per stream in `nightqc`, gated by nothing. This brief is the same instrument in the
**node** lane, where `DexClock.hostAxis` reconciles a device counter against the capture host and
publishes `ppm` + `maxStepMs` + `spreadMs` with no statement of how much either can be trusted.

The two lanes are separate by necessity — Python cannot be called from a bundle — so this is not a
port. It is the same question asked of a different consumer.

---

## 0 · READ THIS BEFORE COSTING THE WORK — it is not an accuracy fix

`ALLAN-DEVIATION` §Done-when already measured the answer on real sidecars: **all four Polar streams are
white/flicker phase, slope −0.99 to −1.00, ADEV 0.023–0.094 ms — the clock sits ~100× INSIDE PAT's
10 ms budget and is NOT the bottleneck.**

So the expected accuracy improvement from this work is **approximately zero**, and that is a measured
statement rather than a hedge. Independent confirmation from the node side, 2026-08-13: the correction
`hostAxis` governs is worth **48 ms of accumulated timebase error over a 2400 s recording and 0.58 s
over an 8-hour night at −20 ppm**. Anyone proposing this as a precision improvement should stop and
read this section again.

What it buys instead is **an honest uncertainty on a number the suite already publishes and already
warns about**. Clock Contract §7 says: *"Never quote `ppm` without the span beside it"* — a rule that
exists because a ppm from a short span is mostly noise. Today that rule is enforced by prose and by one
hand-picked threshold. The curve replaces both with a computed bound.

---

## 1 · What is wrong today

`clock.js` `hostAxis` returns `ppm` as a scalar with no uncertainty. Consumers then differ:

- **PpgDex** consumes `correctionAt()` — the interpolation — and needs no rate at all. Correct, and
  §7 says so explicitly.
- **ECGDex** consumes `.ppm` to correct `fs`, and therefore *is* quoting a rate. It guards this with a
  **2400 s span gate** — a threshold chosen by hand.

§7 itself flags that gate as provisional: *"That span rule is a hand-derived special case of a standard
curve, and the curve is now computed."* This brief closes that loop.

**ECGDex also computes a host axis and never surfaces it.** `ecgdex-dsp.js` builds one (the axis behind
`tMsAt`, `tMsCorrected`), but no node export carries it, so a downstream reader cannot tell a
disciplined ECG axis from a device-clock one without re-deriving the condition. That reporting gap is
in scope here because it is the same field.

---

## 2 · Measurements already taken — do not redo these

Node lane, 2026-08-13, on box captures. Phase series = host stamp − device counter, per anchor.

| node | file | slope | ADEV at τ₀ | at longest τ |
|---|---|---|---|---|
| ECGDex (H10) | `boxcaps/2026-08-10/…_ECG.txt` | **−0.918** | 194 ms/s @ 0.15 s | 0.252 ms/s @ 315 s |
| PpgDex (Verity) | `boxcaps/2026-08-07/…_PPG.txt` | **−0.996** | 448 ms/s @ 0.36 s | 0.244 ms/s @ 743 s |

Both are clean τ⁻¹ (white/flicker phase), consistent with `ALLAN-DEVIATION`'s capture-host result on the
same hardware. **Neither reaches a minimum**: `optimal_tau` equals the longest τ the recording supports,
so averaging is still paying at the end of a night. For these devices the limit on a rate estimate is
**recording length, not a stability floor** — and saying so is more useful than a threshold, because it
tells a caller the answer improves with every extra minute rather than plateauing at some chosen span.

### 2.1 · The precondition is hard, and it is already published

| capture | `independent` | `spreadMs` | `ppm` |
|---|---|---|---|
| H10, box | **true** | 857.5 | −21.9 |
| Verity, box | **true** | 1346.9 | −32.9 |
| H10, phone | **false** | **1.00** | −0.0 |

1.00 ms is exactly one stamp quantum. Per §7 a phone-captured recording **has no second clock** — its
host column is the device stamp rounded. Any implementation MUST refuse when `independent === false`,
or it computes a stability curve for a clock that does not exist and reports the rounding as physics.
This is not a nicety: the raw corpus is entirely phone-captured, so the refusal path is the common one.

---

## 3 · A CLAIM THAT WAS MADE AND WITHDRAWN — do not re-derive it

On first measurement (one file) it appeared that **the 2400 s span gate is too permissive**: extrapolating
τ⁻¹ suggested ~76 ppm of noise against a ~33 ppm signal at that span. **This did not survive more files
and is withdrawn.**

Across six box captures the ppm uncertainty at 2400 s ranges **6.8–32.7 ppm** against crystal errors of
~20–90 ppm — marginal, not wrong. Worse, the short-span files produced ppm values of **−322 and +588**
that phase noise alone cannot explain: steps or startup transients, which `hostAxis`'s running median
exists to resist and which the naive endpoint estimator used for that extrapolation does not.

Two lessons, both recorded so the next person inherits them:

1. **A single file plus a crude estimator is not a finding.** This is the third time in one session that
   a one-file measurement nearly became a fleet claim.
2. **ADEV and endpoint-estimator uncertainty are different quantities.** ADEV(τ) is the RMS fractional
   deviation between adjacent τ-averages; the uncertainty of a mean rate over span T from endpoint phase
   is ≈ √2·σ_x/T. They coincide only for white phase noise and even then differ by a constant. If the
   gate is ever revisited, derive the bound for the estimator ECGDex actually uses.

**Consequence for scope: this brief does NOT propose changing the 2400 s gate.** It proposes publishing
what would be needed to change it responsibly.

---

## 4 · Scope, and the cost that decides the sequencing

### 4.1 · This is a SHARED-SPINE change

`hostAxis` lives in **`clock.js`, which is inlined into all 8 bundles**. Per CLAUDE.md §👥.3 a spine
change re-stamps every `provenance/<App>.json` fragment and **serialises against every bundle-touching
PR**. It must be announced before starting, and it should land when no other bundle work is in flight.

This is the single largest cost in the brief and it is entirely sequencing, not difficulty.

**Alternative considered and rejected:** compute the curve in each node instead of the spine, to avoid
the re-stamp. Rejected because `hostAxis` does not expose its anchors — each node would have to re-derive
the anchor set from raw columns, which is (a) duplicated logic in two nodes, (b) a second place for the
anchor definition to drift from the spine's, and (c) exactly the "two implementations of one contract"
problem the ADEV parity gate already exists to police. Pay the re-stamp once.

### 4.2 · In scope

- `clock.js` — `hostAxis` additionally returns `stability`: the σ_y(τ) curve, its slope, the noise-type
  name, and **`ppmUncertainty` at the recording's own span**. Null when `independent === false` or when
  fewer than the minimum anchors support a τ ladder.
- The existing `ppm` field is **unchanged**. This is additive; no consumer breaks and no export moves.
- **ECGDex surfaces its host axis in the node export**, closing the reporting gap in §1.
- Node-lane tests, including parity against `capture-host/allan.py` by cross-language known answer — the
  pattern `ppgdex-dsp.js` already uses (see `detector-stability` group).

### 4.3 · Explicitly OUT of scope

- **Changing the 2400 s gate.** See §3.
- **Any pass/fail gate on stability.** `ALLAN-DEVIATION` §4 already made this call for the Python lane
  and the reasoning transfers verbatim: the last two arrival diagnostics that shipped with thresholds
  both fired on every stream of the first real night. A bar comes after a τ-curve from several nights.
- **A fourth Allan implementation.** Reuse `allanFromPhase` from `ppgdex-dsp.js` or promote it — do not
  write another. There are already three (`allan.py`, `integrator-tch.js`, `ppgdex-dsp.js`), pinned to
  each other by the `detector-stability` parity group. A fourth without that pin is how they diverge.

---

## 5 · A KNOWN DEFECT THAT MUST BE FIXED FIRST OR INHERITED KNOWINGLY

`classifyAllan` / `allan.py classify` name a noise type by strict `<` against a **point estimate**, and
round the slope in the returned record. So −0.7501 and −0.7500 both print `−0.75` with **opposite noise
types and opposite `meaning` strings**, and the deciding digit is not in the output.

A joint fix across both lanes is already agreed (refuse when a boundary lies within 1.96 SE; publish
`slopeSE` unconditionally; stop rounding the slope in the data, round at display). Note the SE is a
**lower bound** — overlapping ADEV points are correlated while OLS assumes independent residuals — and
that a full Riley EDF treatment is circular here, because EDF depends on the noise type being determined.

**Relevance to this brief:** both node curves in §2 land at −0.918 and −0.996, comfortably clear of the
−0.75 boundary, so the defect does not affect the measurements above. But a *future* recording could land
on it, and this work would be the surface that publishes the wrong label. Land the joint fix first, or
record in the implementation that it is inherited.

---

## 6 · Done when

- [ ] `hostAxis` returns `stability` (curve · slope · noise name · `ppmUncertainty` at the file's span),
      **null** when `independent === false` or anchors are insufficient — refusing, never guessing
- [ ] `ppm` unchanged; verified additive by the equivalence gate passing against the **real corpus**
      (`DEX_UPLOADS=<corpus> node tests/run-tests.mjs --group=equiv`), not just the committed fixtures
- [ ] a phone-captured file is asserted to yield `stability: null` — the common path, and the one whose
      absence would silently report stamp rounding as clock physics
- [ ] cross-language known answer pinned against `capture-host/allan.py`, using MINSTD (**not** the glibc
      LCG — it overflows 2⁵³ in JS but not in Python's bignums, so the two lanes build different series
      and the "cross-language" pin silently is not one)
- [ ] ECGDex's host axis surfaced in its node export
- [ ] all 8 bundles re-built and all three generated trees checked (`npm run check`, not a subset — a
      DSP/spine change touches bundles, `docs/`, and the analysis tools)
- [ ] a follow-up brief spawned per CLAUDE.md, or the header states that nothing surfaced

## 7 · Open questions for whoever takes it

1. **Should `ppmUncertainty` be reported at the file's span, or at a fixed reference span?** The former
   answers "how much do I trust THIS file's ppm"; the latter makes files comparable. Possibly both.
2. **Does the ECGDex `fs` correction want the uncertainty at all**, or only the span gate it already has?
   Answering this needs the estimator-specific derivation §3 says is missing, not the ADEV curve directly.
3. **Is `independent` the right precondition, or should it also require a minimum span?** §7 argues
   `hostAxis` deliberately has no span gate because it interpolates rather than quotes a rate — but
   `stability` *is* a quoted quantity, so the argument may not transfer to it.

## 8 · CLOSED 2026-08-15 — verified item-by-item, not from the header

This brief shipped as **#1227** (`feat(clock): hostAxis publishes how far to trust its own ppm — and the
Allan core moves to the spine`) and then read `PROPOSED` for two days. Every Done-when item checked
against `main`:

| item | evidence |
|---|---|
| `hostAxis` returns `stability` (curve · slope · noise name · `ppmUncertainty`) | `clock.js` — `stability:`, `ppmUncertainty`, `allanFromPhase` on the spine |
| `ppm` unchanged, additive | `ppm` untouched; the equivalence legs pass |
| a phone-captured file yields `stability: null` | asserted in `tests/dex-tests.js` |
| cross-language known answer vs `allan.py`, **MINSTD not glibc** | `tests/dex-tests.js:888` — and it carries the reason verbatim: the glibc LCG overflows 2⁵³ in JS but not in Python's bignums, so the two lanes would build different series and the pin silently would not be one |
| ECGDex's host axis surfaced in its node export | `ecgdex-dsp.js:4371` — `hostAxis: ecgHostAx.ok` |
| 8 bundles + all three generated trees | landed with #1227 |
| follow-up brief spawned | `HOSTAXIS-STABILITY-FOLLOWUPS-2026-08-15-BRIEF.md` |

⚠️ **The stale header nearly caused the work to be done twice.** A session read `PROPOSED`, checked the
one precondition §4.1 names (no bundle work in flight — true), **announced a fleet-wide spine change to
another session**, and only then opened the tree. Retracted; nothing was blocked. Two rules came out of
it, both worth more than the correction:

> **An announcement is a request for other people to stop, so it comes AFTER the tree check, not before.**

> **A stale `DONE` makes someone re-check finished work; a stale `PROPOSED` invites them to BUILD WHAT
> EXISTS.** They are not symmetric and a status sweep should not weight them equally.

§5's inherited `classifyAllan` defect turned out to have a **third** implementation — the joint fix
reached `clock.js` and `allan.py` and missed `ppgdex-dsp.js`. A three-way parity gate now holds the
tables equal and pins the gap; the fix itself, the literature that removes the boundary problem at its
root, and §7's open questions all carry to the follow-up.

