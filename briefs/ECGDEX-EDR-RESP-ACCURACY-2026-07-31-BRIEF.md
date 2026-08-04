<!--
  ECGDEX-EDR-RESP-ACCURACY-2026-07-31-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-04 · **Created:** 2026-07-31 · options 1+2 shipped 2026-08-01; option 2 FINISHED 2026-08-04 (§6.4 — its threshold was 0.035 on the wrong side and 24/min still doubled at some record lengths); the 8–12/min band remains (option 3, deliberately not taken) · **Followed-by:** `EDR-THRESHOLD-MARGIN-FOLLOWUPS-2026-08-04-BRIEF.md` · **Spawned-by:** `DEEP-SCOUT-HOLLOW-GATES-FOLLOWUPS-2026-07-18-BRIEF.md` §EP-rest

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

## 6 · Executed 2026-08-04 — the sweep re-run, and what it changes

### 6.1 · §1's table, re-measured (median of 5 seeds: 20260601 · 42 · 7 · 1234 · 99)

| true /min | §1 (pre-fix) | now | | true /min | §1 | now |
|---|---|---|---|---|---|---|
| 6 | 6.9 (+15 %) | 6.8 (+13 %) | | 16 | 16 (0 %) | 16.0 (0 %) |
| 8 | **11.4 (+43 %)** | 11.1 (+39 %) | | 18 | 18.5 (+3 %) | 17.7 (−2 %) |
| 10 | 12 (+20 %) | 11.7 (+17 %) | | 20 | 20 (0 %) | 19.4 (−3 %) |
| 12 | 13.3 (+11 %) | 12.8 (+7 %) | | 22 | 21.8 (−1 %) | 21.2 (−4 %) |
| 14 | 15 (+6 %) | 14.3 (+2 %) | | **24** | **12 (−50 %)** | **23.2 (−3 %)** |

**The accurate range widened at the top, as §1 predicted: 14–22 → ~12–24.** The 8–10/min band is
untouched, exactly as the header says (option 3 not taken).

### 6.2 · Which half did the work — and the trap in finding out

**The harmonic check (option 2) is the entire fix.** Disabled, at the 900 s the gate legs use, a true
24/min carrier reads **12.0 on all five seeds**; enabled, 23.4–23.8. Nothing else in the estimator
prevents the octave error.

⚠ **A single-condition isolation of this estimator is not evidence.** At the shorter default duration
only **3 of 5** seeds double, and seed 20260601 — the seed every other leg here uses — is one of the two
that never does. Isolating the check on it shows *no change at all*, which reads exactly like dead code;
an earlier pass through this brief concluded precisely that and was wrong. Whether the doubling appears
depends on record length **and** seed, both of which move where the carrier's phase falls on the 4 Hz
EDR grid. Now pinned on five seeds (`ecgdex-dsp · crc · known-answer`); disabling the check reds 14 legs.

### 6.3 · §4 option 1 (parabolic interpolation) — MEASURED, and it is a real trade, not a free win

§4 predicted it would *"remove the quantisation error at every rate … no new assumption"*. Isolating it
(5 seeds × 10 rates) shows it **pulls every estimate toward the middle of the band (~16/min)** — up at
6–14, down at 18–24:

| true | 6 | 8 | 10 | 12 | 14 | 16 | 18 | 20 | 22 | 24 |
|---|---|---|---|---|---|---|---|---|---|---|
| with interp | 6.8 | 11.1 | 11.7 | 12.8 | 14.3 | 16.0 | 17.7 | 19.4 | 21.2 | 23.2 |
| **without** | 6.9 | 10.9 | 11.4 | 12.6 | 14.1 | 16.0 | **17.1** | **20.0** | **21.8** | **24.0** |

Mean |error| **9.0 % with, 7.7 % without**; without is exact at 16, 20 and 24. The mechanism is visible
in the split: those three periods land **exactly on an integer lag** of the 4 Hz grid (3.75 / 3.00 /
2.50 s), so interpolation can only move them *off* truth — and it does, systematically, because
`_bandResp`'s gain varies across the window and leaves the peak's two shoulders asymmetric. Where the
true period falls *between* lags (14/min = 4.286 s ≈ lag 17.1) it genuinely helps. "No new assumption"
was the error: local symmetry **is** an assumption, and this filter violates it.

**NOT REMOVED — this is the owner call §5 reserves, and the synthetic does not settle it.** Removing it
also moves the REAL-corpus golden (`ECGDex_2026-06-27_equiv`) `respFromEDR` **16.3 → 17.1**, i.e.
*further* from that night's RSA estimate of 13.2, which is the only cross-check the real night has.
Synthetic aggregate says remove; the one real night says keep. Options: (a) remove — best synthetic
accuracy, exact on-grid; (b) keep — closer on the single real night; (c) interpolate only when the peak
is off-grid. Each needs a fixture regeneration and (a)/(c) move an exported field.

### 6.4 · ⛔ 2026-08-04 — OPTION 2 SHIPPED BUT DID NOT FINISH THE JOB. Its threshold was on the wrong side by 0.035.

§6.2 concluded *"the harmonic check is the entire fix"* and pinned it at 900 s on five seeds. Both halves
of that are true and the legs are honest. What neither caught is that the check was passing **by a
margin of −0.035**, i.e. failing, at any record length where the carrier's phase lands differently on the
4 Hz EDR grid.

`ac[half] > 0.8 * best` was the test. Measured, the band-edge fundamental carries **0.745 · best**
(0.766 on a second seed) — so at 24/min the check RAN, evaluated the true answer, and **rejected it**.
§6.2's own sentence *"whether the doubling appears depends on record length and seed"* was the symptom;
read as a property of the defect rather than of the threshold, it stopped one step short.

**A true 24/min carrier, harmonic check ENABLED, shipped 0.8 vs the corrected 0.5:**

| durSec | 0.8 (as shipped) | 0.5 (now) |
|---|---|---|
| 180 | **12.5 · 12.5** | 24.4 · 24.4 |
| 300 | **12.4 · 12.5** | 24.1 · 24.4 |
| 600 | 23.0 · 23.3 | 23.0 · 23.3 |
| 900 | 23.4 · 23.8 | 23.4 · 23.8 ← the only length §6.2 pinned |
| 1800 | 23.6 · **11.9** | 23.6 · 23.7 ← seed 42 period-doubles at 30 min |
| 3600 | 23.4 · 23.5 | 23.4 · 23.5 |

**The threshold is a SIGN test, not a near-equality test — and that is why 0.8 was wrong in kind, not
merely in value.** Lowering 0.8 to 0.7 would fit the one observation. What actually separates the two
cases is the physics: if the found lag is the OCTAVE, the half-lag is a real period ⇒ `ac[half]` is
positive; if the found lag is already the FUNDAMENTAL, the half-lag is ANTI-PHASE ⇒ `ac[half]` is
strongly negative. Measured over 6–24/min × 2 seeds the populations do not overlap and the gap is wide:

```
half is WRONG (keep the lag):   ac[half]/best = −1.26 … −2.89     every rate 6–22
half is RIGHT (take the octave): ac[half]/best = +0.745, +0.766   24/min, both seeds
```

`0.5 · best` sits inside that gap with **0.245 of margin** instead of −0.035.

**Nothing else moves.** Across 6–22/min × 4 seeds every reported value is byte-identical; only 24/min
changes. On **10 real trio-corpus ECG nights** (`Ecg nightly/`, Polar H10) `respFromEDR` is unchanged on
all 10 — no real night in this corpus sits at the band edge — and `cpc.hfcPct` is likewise unchanged
(real values read: 36.0, 28.5, 24.0 — not a vacuous probe). This satisfies §6's guardrail: the fix was
checked against real ECG, not tuned on `genSynthetic` alone.

**Gated, verified RED by value.** Four new legs in `ecgdex-dsp · crc · known-answer` pin a SHORT record
(180 s, 300 s) and a LONG one (1800 s, both seeds). Restoring 0.8 reds exactly three of them, by value
(`got 12.4 · want ≈24`); the fourth — seed 20260601 at 1800 s — stays green under both, and is pinned
deliberately so the both-directions claim is not one-sided.

- [x] **A decision is recorded between §4's options** — options 1+2 shipped earlier; option 2 is now
      proven load-bearing and option 1 is measured above with the trade stated. The remaining choice
      (keep/remove/gate option 1) is **routed to the owner in §6.3**, not presumed.
- [x] **The sweep in §1 is re-run and the table updated** — §6.1. The accurate range widened as predicted.
- [x] **The characterization pins were updated with the fix, and now pin the LOW band only.** The
      24/min → 12 pins were replaced when options 1+2 shipped; the two surviving `KNOWN LIMITATION` legs
      pin 8/min ≈ 11.3 and 10/min ≈ 12 — the low band edge, which option 3 would be needed for and which
      is deliberately untouched. Both still hold after §6.4's correction (re-run green), as they must:
      the sign test only reaches the top edge.
- [x] **The CPC/PLV consequence (§3) is MEASURED — and §3's fear is largely unfounded.** On seed 42 at
      24/min, where `f0` was halved (12.0 vs 23.2, a **93 %** error), the downstream metrics barely move:
      `crcPLV` 0.496 → 0.491 (**1.0 %**), `plvDuringSurges` 1.3 %, `plvBaseline` 0.6 %, `couplingStrength`
      0.7 %. A wrong `f0` mis-centres `_narrowPhase`, but the band it opens is wide enough that the true
      carrier still falls inside it, so PLV degrades gently rather than collapsing. §3 called this "the
      more serious consequence"; measured, it is the *lesser* one — the exported `respFromEDR` itself was
      the real damage, and that is fixed.
- [x] **`cpc.hfcPct` is structurally independent of `f0` — nothing to re-check.** The CPC band shares
      integrate power in FIXED bands (`bandOf(k*df)`) and never read `f0`; measured bit-identical
      (67.5 / 28.0 / 4.6 %) with `f0` halved. The validated r = −0.408 vs device-scored residual AHI is
      unaffected by this brief in either direction.

- [x] **`cpc.hfcPct` re-checked against §6.4's fix — unchanged, and it cannot be otherwise.** `_cpc` takes
      the raw HR and EDR series and integrates FIXED bands; it never reads `f0` or `respFromEDR`, so the
      harmonic check cannot reach it. Confirmed empirically on 10 real nights with real values read
      (36.0 / 28.5 / 24.0), not merely asserted from the call graph. The validated r = −0.408 stands.
- [x] **Gates green; ECGDex re-bundled; fixtures re-verified.** `manifestHash` 5889ad23cb50 → c8a4977c79c4;
      all three build systems `--check` clean (the ECGDex change also re-bundles the two orchestrators,
      8 analysis tools and `docs/ECGDex.html`); GATE A 9/9, GATE B 16 reproducible; corpus-backed fixtures
      re-verified with `DEX_UPLOADS`.

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