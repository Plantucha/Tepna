<!--
  CPAP-SA2-OXIMETRY-SOURCE-2026-08-01-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-01 (executed; **premise REFUTED — there is no second SpO₂ source**) · **Created:** 2026-08-01 · **Routed-from:** `CPAP-AUTOHARVEST-FOLLOWUPS-2026-07-28-BRIEF.md` §2.1 (route-or-decline → **ROUTED**)

# The CPAP has been recording a second, wired SpO₂ channel on 194 nights, and nothing reads it

> **EXECUTED 2026-08-01 — the title is wrong, and this brief is the record of why.**
> `SA2.edf` is written on every therapy night whether or not the optional oximeter accessory is
> attached. When it is not, both channels are filled with the physical value **−1** for the entire
> session. **193 of the 194 nights are entirely that fill.** The accessory was attached exactly once —
> 2026-06-13, for 2.50 h. Total real SpO₂ in the corpus: **2.50 h**, not 194 nights × 6.83 h.
> Reproduce with `node tools/cpap-sa2-agreement.mjs --cpap <tree> --ring <exports>`.
> **Everything in §1 below is accurate and still misleading — see §7.**

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

## 7 · What was actually found (2026-08-01)

### The premise measured the wrong thing

§1 is not wrong about anything it states. The files exist, the channels are as described, the
durations are real, the dedup and session-summing warnings are correct. **It measured the presence of
a FILE and reported it as the presence of DATA.**

```
── SA2 coverage ──                          ── the same files, as DATA ──
distinct files (deduped) : 250              entirely the -1 "no sensor" fill : 193 of 194
distinct nights          : 194              carrying ANY real saturation     : 1
median hours/night       : 6.83             total REAL SpO2 in the corpus    : 2.50 h
nights under 4 h         : 7 of 194         the night with data              : 2026-06-13
```

A full-length, well-formed, perfectly readable 7.2 h session containing no measurement at all still
reads as 7.2 h of coverage. The overstatement is a factor of ~194.

### One correction to §1's channel table, too

`SA2.edf` carries **three** signals, not two: `Crc16` at 1/60 Hz sits alongside `SpO2.1s` and
`Pulse.1s` in **249 of the 250** files. A gate written from §1's text would have redded on 249 of them.

### The irony, which is the useful part

§1's "one caution, recorded because it nearly misled this brief" names
`20260613_231433_SA2.edf` — 2.50 h against a 7.35 h ring night — and warns that generalising from it
would **understate** the source ~3×, so always sum a night's sessions.

That file is the only one in the corpus with data. Generalising from it would have **overstated**
nothing; generalising from the other 249 is what produced this brief. The one file singled out as
unrepresentative was the only representative one.

### CPAPDex already knew — nothing is broken

The suite has read SA2 all along (`CpapDsp.oximetryLane`, `oximetrySource: 'CPAPDex-SA2 (peer of
O2Ring)'`), and it handles this correctly. `_spo2Valid` admits only 50–100 %, so −1 never enters a
computation, and the lane returns a named reason:

```
2026-07-27 (sentinel) → { available:false, reason:'oximeter-not-connected', coverage:0 }
2026-06-13 (real)     → { available:true,  coverage:1, odi:1.6, events:4 }
```

**No node ever consumed a sentinel, no published number is affected, and no fix is required.** The
information that refutes this brief was already in the codebase, in a branch someone had named
`oximeter-not-connected` before the brief was written.

### Decision on §5's open question

**Nothing consumes SA2 as a cross-validation source, because there is nothing to consume.** This is
not "the agreement is not good enough" — no agreement can be computed. 2026-06-13 is the sole
candidate night and it has no concurrent ring export, so the sample size for a comparison is **zero**.

Reopening this requires a hardware change, not analysis: **attach the ResMed's oximeter accessory.**
If that happens, `tools/cpap-sa2-agreement.mjs` performs the whole comparison as specified —
alignment by lag sweep, then Bland–Altman + ODI-4 + nadir/T90, never Pearson — and its `--selftest`
already pins that machinery against planted answers.

### A note on the statistic, sharper than §2 put it

§2 says Pearson r "will look poor even for two sensors that agree perfectly". That is half true, and
the half matters. What r tracks is how much variance the two traces **share**, which depends on the
night rather than on the sensors: shared *physiological* wander keeps r high (0.88 on flat windows of
the selftest pair), while independent *sensor noise* collapses it (−0.01) — **with the planted bias
identical in both cases**. So r is not pessimistic, it is **uninformative about agreement**, because
it moves with something that is not agreement. Bland–Altman returns 1.80 % in every case. That is the
assertion the tool gates, and it is stronger than the one the brief asked for.

## 5 · Done when

- [x] ~~A committed `SA2.edf` fixture~~ — **superseded.** A fixture would freeze a container, and a
      container is exactly what misled this brief. The gate that matters is the one in
      `tools/cpap-sa2-agreement.mjs --selftest`: a full-length all-sentinel session must read as
      **zero** coverage and must not be rescued by being long. Committing one of the user's real
      SA2 EDFs was also declined on privacy grounds — synthetic known-answers do the job.
- [x] A coverage report over all 194 nights — delivered, in **two** forms: hours-of-file (which is what
      §1 measured) and hours-of-data (which is what matters). The clock-fit overlap was not reached
      because no night has both real SA2 saturations and a ring export.
- [x] Agreement instruments implemented and gated against planted answers (Bland–Altman bias + LoA,
      ODI-4 under one shared rule, nadir/T90; alignment by lag sweep). **Not run on real data — n = 0.**
- [x] Explicit decision recorded (§7): **nothing consumes SA2.** Not "the agreement is too poor" —
      no agreement is computable.
- [x] Gates green; changeset dropped.

## 6 · Guardrail

Do not tune the ring's detector to match the CPAP, or vice versa. Neither is ground truth: the CPAP's
oximeter is a consumer sensor too, and `CPAPDEX-VALIDATED-AGAINST-STR-EDF` established only that CPAPDex
reproduces the *device's own* scoring, which is a different claim. Disagreement is a finding to report,
not an error to correct.
