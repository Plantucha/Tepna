<!--
  ECGDEX-EDR-RESP-ACCURACY-2026-07-31-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS — 2026-08-01 · **Created:** 2026-07-31 · §4 options 1+2 EXECUTED; the 8–12/min band remains (option 3, deliberately not taken) · **Spawned-by:** `DEEP-SCOUT-HOLLOW-GATES-FOLLOWUPS-2026-07-18-BRIEF.md` §EP-rest

# `crc.respFromEDR` reads exactly HALF at 24 breaths/min — the estimator degrades at both edges of its own declared window

## 1 · The measurement

`cardiorespCoupling` estimates respiration directly off the EDR band by autocorrelation —
`_autocorrPeriod(edrB, FS, 2.5, 10)`, i.e. periods 2.5–10 s = **6–24 breaths/min** — and surfaces it as
`crc.respFromEDR`, an **exported** field carrying `respFromEDRMethod: 'EDR (R-peak amplitude modulation)'`.

Driving `ECGDSP.analyze` on a deterministic `genSynthetic` ECG whose respiratory carrier is set to a
known rate (`opts.respHz`, added for this purpose) gives, identically across seeds 20260601 / 42 / 7:

| true /min | period | reported | error |
|---|---|---|---|
| 6 | 10.00 s | 6.9 | +15 % |
| 7 | 8.57 s | 6.9 · 6.9 · **11.4** | seed-dependent |
| 8 | 7.50 s | **11.4** | **+43 %** |
| 9 | 6.67 s | **11.4** | +27 % |
| 10 | 6.00 s | 12 | +20 % |
| 12 | 5.00 s | 13.3 | +11 % |
| 14 | 4.29 s | 15 | +6 % |
| 16 | 3.75 s | 16 | 0 % |
| 18 | 3.33 s | 18.5 | +3 % |
| 20 | 3.00 s | 20 | 0 % |
| 22 | 2.73 s | 21.8 | −1 % |
| **24** | **2.50 s** | **12** | **−50 % — exactly half** |

**Trustworthy over roughly 14–22 /min. Outside that it is biased high, and at the top edge it fails
completely.**

## 2 · Why — and it is not the autocorrelation's search bounds

Two independent effects, both at the edges:

- **Period-doubling at 24/min.** `_bandResp` is the DIFFERENCE OF TWO MOVING AVERAGES
  (`_maHalf(x, 0.3·fs) − _maHalf(x, 2.0·fs)`), nominally ~0.1–0.4 Hz. A moving-average difference has a
  **gentle** roll-off, so a fundamental sitting *at* 0.4 Hz is already substantially attenuated. The
  autocorrelation's first admissible lag is then a suppressed fundamental while the 5 s second harmonic
  survives, so it locks onto the harmonic → exactly half. The existing zero-crossing skip in
  `_autocorrPeriod` guards against half-period *sidelobes*, not against a genuinely stronger harmonic.
- **Coarse lag quantisation.** The EDR is resampled to a **4 Hz** grid and the search is over INTEGER
  lags, so period resolution is 0.25 s — about 1.5 % at a 3 s period but ~6 % at 4.3 s and larger still
  as the period grows. This is what makes 14/min read 15.0 (lag 16 = 4.00 s rather than lag 17 = 4.25 s).

**The 2.5 s / 10 s bounds are NOT the defect** and are now both-direction gated (`ecgdex-dsp · crc ·
known-answer`): 20/min → 20.0 with a `2.5→3.5` slip re-reading 10.4, and 6/min → 6.9 with a `10→7` slip
re-reading 12. The window admits what it says it admits; the estimator inside it is what degrades.

## 3 · What this does and does not affect

- `respFromEDR` is **exported** and read by the Integrator's respiration fusion as one of its sources.
  `MULTI-SENSOR-DERIVATIONS` §2.2 publishes every source **and the spread**, and reports disagreement
  rather than averaging it away — so a wrong EDR rate widens a declared spread rather than silently
  corrupting a consensus. That is the design working, and it caps the blast radius.
- `f0 = respFromEDR/60` also centres `_narrowPhase` for the **CPC/PLV** analysis. A half-rate `f0` centres
  the phase analysis on the wrong band, so `crcPLV` and the CPC band shares at 24/min are suspect too.
  **This is the more serious consequence and is untested.**
- Adult resting respiration is typically 12–20 /min, so the trustworthy range covers the common case.
  24/min is not exotic, though — it is ordinary in children, in fever, and in CSR.

## 4 · Options

1. **Parabolic interpolation on the autocorrelation peak** — removes the quantisation error at every rate
   for a few lines and no new assumption. Cheapest real improvement; does not fix period-doubling.
2. **Harmonic check** — after picking `bestLag`, test whether `bestLag/2` is admissible and carries
   comparable correlation; prefer the shorter period when it does. Directly targets the 24/min failure.
3. **Widen or steepen the band.** `_bandResp`'s edges are the root cause. A steeper filter costs more
   than (1)+(2) and would move every CRC metric, forcing a fixture re-record fleet-wide.
4. **Narrow the declared window to the trustworthy range and abstain outside it.** Honest and cheap, but
   it converts a wrong number into no number over a physiologically real range — likely worse than (2).

**Recommended: (1) + (2).** Both are local to `_autocorrPeriod`, neither touches the filter, and together
they address the two measured mechanisms.

## 5 · Done when

- [ ] A decision is recorded between §4's options (owner call — this brief does not presume it).
- [ ] The sweep in §1 is re-run and the table updated; the accurate range should widen.
- [ ] The two `KNOWN LIMITATION` legs in `ecgdex-dsp · crc · known-answer` — which pin 24/min → **12**
      deliberately, so the defect cannot change unnoticed — are **updated in the same commit as the fix**.
      They are characterization pins, not correctness claims; a fix is SUPPOSED to red them.
- [ ] The CPC/PLV consequence (§3) is measured, not assumed: does a corrected `f0` move `crcPLV` or the
      CPC band shares at 24/min?
- [ ] `ECGDEX-CARDIOPULMONARY-COUPLING`'s validated `cpc.hfcPct` result is re-checked against the fix —
      it is the one CRC metric with a real correlation (r = −0.408, p = 0.009) and must not regress.
- [ ] Gates green; ECGDex re-bundled; `computeHash` moves ⇒ `DEX_UPLOADS=<corpus> tools/verify-fixtures.mjs`.

## 6 · Guardrail

Do **not** tune the estimator against `genSynthetic` alone. The generator's respiratory carrier is a clean
sinusoid; real EDR is neither clean nor stationary, and `REM-STAGING-REDESIGN` §8's warning that the
synthetic oracle is circular applies directly here. Any fix should also be checked against the real
trio-corpus ECG, where the truth is unknown but the *stability* of the estimate across a night is
observable.


---

## 7 · Executed 2026-08-01 — options 1 + 2

### 7.1 · What shipped, and what it bought

Both changes are local to `_autocorrPeriod`; neither touches `_bandResp`, so no other CRC metric moves.

- **Harmonic check** — after picking `bestLag`, if HALF that lag is admissible and carries ≥ 0.8× the
  correlation, prefer the shorter period. The 0.8 is deliberately permissive: an *attenuated* fundamental
  will not match its harmonic's peak, which is precisely the failure mode, so requiring equality would
  leave the defect in place.
- **Parabolic interpolation** — fit a parabola through the peak and its two neighbours to recover the
  sub-sample maximum, removing the 0.25 s lag quantisation of the 4 Hz grid. Guarded on a real
  negative-curvature maximum, and clamped to the neighbouring bins.

Re-running §1's sweep (three seeds, identical values):

| true /min | 6 | 7 | 8 | 9 | 10 | 12 | 14 | 16 | 18 | 20 | 22 | **24** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **before** | 6.9 | 6.9 | 11.4 | 11.4 | 12 | 13.3 | 15.0 | 16.0 | 18.5 | 20 | 21.8 | **12** |
| **after** | 6.8 | 6.8 | 11.3 | 11.4 | 12 | 13.3 | **14.7** | 16.4 | **18.2** | 20 | 21.7 | **23.4** |

**The period-doubling is gone: 24/min goes from −50 % to −2.5 %.** Interpolation also fixes the 14/min
quantisation error (15.0 → 14.7) and improves 18/min. Mean absolute error over the sweep halves,
1.98 → 1.02 — but that is almost entirely the one catastrophic point, and saying so matters more than the
headline: **excluding 24/min the MAE is essentially unchanged (1.07 → 1.05).** 16/min is marginally worse
(16.0 → 16.4); it was exact before by coincidence of the grid.

### 7.2 · What did NOT improve, and why option 3 was not taken

**The 8–12/min over-read is untouched** (8/min still reads 11.3, +43 %). §2 named two mechanisms; this is
a **third** — the fundamental attenuated at the LOW band edge, where there is no harmonic to substitute
and no peak to interpolate, because the peak itself is not there. Fixing it needs **option 3**, a steeper
`_bandResp`, which moves every CRC metric and forces a fleet-wide fixture re-record. That is a separate,
larger work-unit and was deliberately left.

So the trustworthy range widens at the top (≈14–24/min) and is unchanged at the bottom. Two legs now pin
the 8–12/min error as explicit characterization, the same discipline the 24/min pin used before it was
fixed.

### 7.3 · The pins were updated in the same commit, as §5 required

The two `KNOWN LIMITATION` legs pinning 24/min → 12 red on this fix — which is what they were for. They
now assert 23.6 ± 0.5, and two new characterization legs pin the surviving 8–12/min error.

Both halves of the fix are **independently mutation-verified**: disabling the harmonic check sends 24/min
back to 12; disabling the interpolation sends 14/min back to 15.0. That second check initially passed
under mutation because the tolerance was ±0.4 and 15.0 sits inside it — the tolerance is now ±0.15. Found
by mutating the fix, not by reading the test.

### 7.4 · ⚠ The ECGDex equiv fixture does NOT evidence this change

`verify-fixtures` reproduced `ECGDex_2026-06-27_equiv.node-export.json` byte-for-byte and stamped it. That
is **not** evidence the change is safe: the fixture is the **LIGHT** export — `kernel schema recording
ganglior_events reserved` — and carries no `hrv` block, so it does not contain `respFromEDR` at all.

This is the same gap `INTEGRATOR-OXYDEX-ADAPTER-GAP-FOLLOWUPS` §1 closed for PpgDex on 2026-08-01 (a
committed **rich**-export golden).

**✅ CLOSED the same day.** `uploads/synthetic_ecgdex_rich_golden.node-export.json` is minted from the
**same committed input** as the clean twin (`synthetic_ecgdex_h10.txt`), so the two goldens differ by
`opts.rich` alone. Registered through `tools/regen-ecgdex-goldens.mjs`; no hash hand-written. Gated by
`ecgdex-dsp · equiv · integrator-facing`, 13 legs:

- byte-for-byte equivalence, volatile keys aside;
- **anti-vacuity** — `hrv.frequency.respFromEDR` asserted present and typed (it is **the** field §7.1
  changed), alongside `respFromEDRMethod`, `respRate`, `hrv.time.sdnn`, `quality`, `timeseries`;
- the **honest-null contract**: `sleep`/`apnea`/`hrvStability` are legitimately `null` on a 59 s record,
  and the leg uses `in` rather than truthiness so a *dropped key* cannot pass as a null;
- a **control** proving the LIGHT export on the same input carries none of it — which is precisely why
  the equiv fixture could not have caught §7.1.

**Mutation-verified, and the second one is the point:** suppressing the rich block reds 10 legs, and
nulling `respFromEDR` *alone* reds **6** — the exact change that slipped past the light-export fixture
now fails loudly. GATE B coverage 15 → 16.

**One measurement the fixture pins that is worth reading.** The synthetic's beat train carries a
deliberate RSA of one cycle per 4.5 beats — ~13.3 breaths/min at its ~1 s RR. `respRate` (the RSA
estimate) recovers it at **13.2**. `respFromEDR` reads **16.3, a +23 % over-read** — the low-band-edge
bias §7.2 explicitly left unfixed. So the golden now pins that bias against a **known truth** rather than
against itself, and the day option 3 steepens the band this leg moves and someone has to say why.

The evidence for this change is therefore the sweep in §7.1 plus the mutation-verified pins — not the
fixture.

### 7.5 · Still open

- §4 option 3 (steeper `_bandResp`) for the 8–12/min band — the larger unit.
- §5's CPC/PLV consequence: `f0 = respFromEDR/60` centres `_narrowPhase`, so a corrected `f0` at 24/min
  should move `crcPLV` and the CPC band shares. **Unmeasured.** It was the more serious half when the
  rate was wrong by 2×; now that 24/min is right, the question becomes whether the old values were
  distorted — which is a re-measurement, not a fix.
- `ECGDEX-CARDIOPULMONARY-COUPLING`'s validated `cpc.hfcPct` (r = −0.408, p = 0.009) must be re-checked
  against this change before the brief closes.