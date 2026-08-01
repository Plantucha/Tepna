<!--
  CPAP-SA2-OXIMETRY-SOURCE-2026-08-01-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-01 · **Routed-from:** `CPAP-AUTOHARVEST-FOLLOWUPS-2026-07-28-BRIEF.md` §2.1 (route-or-decline → **ROUTED**)

# The CPAP has been recording a second, wired SpO₂ channel on 194 nights, and nothing reads it

## 1 · The premise, verified rather than inherited

`SA2.edf` carries exactly two signals, both at **1 Hz**:

```
SpO2.1s   fs=1  dim=%
Pulse.1s  fs=1  dim=bpm
```

Measured over every distinct `*_SA2.edf` on disk (deduplicated by filename — the same night appears in up
to four capture trees, which inflated a first count **4×** before dedup):

| | |
|---|---|
| distinct SA2 files | **250** |
| distinct nights | **194** |
| nights with 1 session | 148 · 2 sessions: 39 · ≥3: 7 |
| **median SA2 coverage** | **6.85 h/night** (p10 5.23 · p90 8.68 · min 1.88 · max 18.62) |
| nights under 4 h | **7 of 194** |

So §2.1's claim stands: this is a real second SpO₂ source over most of most nights, on a **wired** sensor
that cannot suffer the BLE dropouts `VIGIL-DEEP-ANALYSIS` measures on the ring (17 % of nights below
−85 dBm).

**One caution, recorded because it nearly misled this brief.** The first file sampled
(`20260613_231433_SA2.edf`) is 2.50 h against a 7.35 h ring night — 34 % coverage — and generalising from
it would have understated the source by ~3×. It is one session of a **two-session** night. Always sum a
night's sessions; never read a single `SA2.edf` as "the night".

## 2 · What is NOT established — and the trap in the obvious analysis

A naive alignment of that night's SA2 against the concurrent O2Ring gives **r = 0.296 at a −79 min lag**.
Do not read that as disagreement between the sensors. Two reasons, both fixable, neither addressed here:

- **The CPAP clock is wrong by a large, roughly constant offset.** `CROSS-DEVICE-CLOCK-SKEW-2026-07-29`
  measured the reference deployment's CPAP running **~39 min slow**, and shipped
  `IntegratorDSP.fitClockOffsetPooled` to fit it. Any SA2↔ring comparison must go through that fit, not
  through raw stamps. The −79 min best-lag above is an artifact of scanning raw stamps on one session.
- **Pearson r is the wrong statistic for overnight SpO₂.** The signal sits flat near 96 % for most of the
  night, so r is dominated by noise around a near-constant mean and will look poor even for two sensors
  that agree perfectly. The right instruments are Bland–Altman (bias + limits of agreement), ODI-4
  agreement, and nadir/T90 comparison — the same discipline `OXYDEX-PB-OVERCALL` applies to κ.

**So this brief claims an OPPORTUNITY, not a validated agreement.** Whether the two sensors actually agree
is the work, not the premise.

## 3 · Why it is worth doing

1. **Cross-validation of OxyDex's ODI-4 on a wired reference.** Every ODI/AHI-surrogate result in the
   suite rests on one consumer-grade ring. A second, independent, wired oximeter over the identical
   interval on 194 nights is the strongest internal check available without new hardware — and
   `PAPER-ODI4-REPRODUCIBILITY` has just shown what it costs to have a headline result resting on an
   unpinned single source.
2. **Gap-filling exactly where the ring fails.** The ring's dropouts are BLE-driven; the CPAP's sensor is
   wired. The failures are uncorrelated by construction, which is the useful property.
3. **`Pulse.1s` is a third HR source**, beside the ring's pulse and the chest ECG — relevant to
   `R5-HR-TRIPLET-REFERENCE`.

## 4 · Scope, and what to be careful about

- **Read-only first.** Land the parse + a coverage/agreement report before any node consumes SA2. Nothing
  should silently start blending two SpO₂ sources.
- **`CpapEdf.readEDF` already parses it** — the signals above were read with the shipped reader, unchanged.
  No new parser is needed, which makes the first step small.
- **Do NOT average the two sources.** `MULTI-SENSOR-DERIVATIONS` §2.2's rule stands: publish every source
  and the SPREAD, report disagreement rather than smoothing it. A fused SpO₂ that hides a 3 % bias would
  be worse than either sensor alone.
- **Sessions must be summed and gaps declared** (`recording.coverage`, per `NODE-EXPORT-DURATION-SEMANTICS`
  option (c)): mask-off time is a real hole, not a short recording, and it must not read as either.
- The CPAP's own `SA2` is **therapy-time** oximetry. On a night where the mask comes off, the ring is the
  only source — so this supplements the ring, it does not replace it.

## 5 · Done when

- [ ] A committed `SA2.edf` fixture + a gate pinning the two channels, their 1 Hz rate, and the
      session-summing rule (the 2.5 h-vs-6.85 h trap in §1 is exactly what a fixture should freeze).
- [ ] A coverage report over all 194 nights: SA2 hours vs ring hours, and the overlap after the
      `fitClockOffsetPooled` correction — not raw stamps.
- [ ] Agreement measured with the right instruments (Bland–Altman bias + LoA, ODI-4 agreement, nadir/T90),
      **not** Pearson r on the raw trace.
- [ ] An explicit decision, recorded here, on whether anything consumes SA2 — and "the agreement is not
      good enough to use it" is a legitimate outcome that must not be argued away.
- [ ] Gates green; changeset dropped.

## 6 · Guardrail

Do not tune the ring's detector to match the CPAP, or vice versa. Neither is ground truth: the CPAP's
oximeter is a consumer sensor too, and `CPAPDEX-VALIDATED-AGAINST-STR-EDF` established only that CPAPDex
reproduces the *device's own* scoring, which is a different claim. Disagreement is a finding to report,
not an error to correct.
