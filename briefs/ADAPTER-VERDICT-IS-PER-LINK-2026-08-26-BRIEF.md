<!-- SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living — last-verified 2026-08-26) · **Created:** 2026-08-26

# An adapter verdict is per-LINK, not per-adapter — and "recovered" is not "did not lose data"

**One-line result: the UB500 lost 447 / 3,677 / 77 seconds of REAL DATA on three wearable nights and
ZERO on the CPAP link the same week. "The UB500 is bad" is false as stated** — it is bad for coin-cell
devices on a moving body under a duvet, and fine for a mains-powered machine sitting still.

Two of the three claims below were things this session first got **wrong, confidently**. The
corrections are the reusable part.

---

## 1 · 🔴 THE DISCRIMINATOR: lost vs delayed is decided by the DEVICE clock

**An arrival gap proves nothing on its own.** A long gap between host arrival stamps fits two opposite
situations:

- **delayed** — the device kept sampling; late frames still carry their original device timestamps, so
  the **device span across the gap is ≈ 0**. Nothing is lost.
- **lost** — the **device clock advances by the same amount as the wall-clock gap**, so **no samples
  exist for that window**.

Measured on the H10 ECG across the worst UB500 stall:

```
host arrival gap : 76,107 ms
DEVICE time span : 76,477 ms      ->  LOST (~9,900 ECG samples at 130 Hz)
```

**Always difference the device axis too.** Reporting an arrival gap as loss — or as harmless latency —
without that second difference is a guess wearing a measurement's clothes.

⚠️ **Streams without a real device clock must be EXCLUDED, not scored.** Verity `ppi` has an all-zero
sensor stamp and the O2Ring's `OXYLIVE_DURATION_S` axis is drawn; both give `device span = 0` for
*every* gap and so read as "delayed" unconditionally. An early version of this analysis included them
and produced a table of confident nonsense. Score `ecg`/`acc`/`ppg` only.

⚠️ **EDF CANNOT EXPRESS A GAP.** It is a contiguous record format with no discontinuity field, so a
continuous-looking EDF is equally consistent with "nothing lost" and "the writer silently filled the
hole." **A clean EDF is not evidence.** For the CPAP read `GapCounters` (`cpap_ingest`, logged as
`"CPAP stream gap accounting: {...}"` at stream end); for the wearables read `*_PMDARRIVAL.csv`.

## 2 · The measurement

Windowed **23:11 → 04:42** identically on every night (the same window as
`SENA-VS-UB500-JITTER-2026-08-26-BRIEF`, so the arms stay comparable), gaps > 5 s, real-device-clock
streams only, positive device deltas only:

| night | adapter | gaps > 5 s | **LOST** | **total lost** | worst gap |
|---|---|---|---|---|---|
| 2026-08-22 | UB500 | 11 | 8 | **447 s** | 76,109 ms |
| 2026-08-23 | UB500 | 30 | 30 | **3,677 s** (~18 % of the window) | 145,566 ms |
| 2026-08-24 | UB500 | 10 | 2 | **77 s** | 40,541 ms |
| 2026-08-25 | **Sena** | 5 | **0** | **0.0 s** | 6,327 ms |

**The same UB500, the same week, carrying the CPAP for 8.7 h:**

```
frames_ok: 156042   samples_ok: 1560420   stalls: 0   overflow: 0
post_drop_tail: 0   sink_errors: 0        malformed: 1040 (0.66 %)
```

**Zero stalls.** Whatever drops a coin-cell device on a moving body does not touch a mains-powered
machine two metres away that never moves.

## 3 · 🔴 THE RETRACTION: recovery restores the LINK, not the DATA

The first recommendation from this evidence was **"prefer the UB500"**, because its documented
intermittent deafness is **auto-recovered by the `tepna-btreset` ladder** while the Intel's missing
sensitivity is not recoverable by anything.

**That reasoning is wrong, and the way it is wrong generalises.** Recovery restores the *link*. An
adapter that reconnects cleanly after losing a minute of ECG **has still lost a minute of ECG.** The
check asked *"is this failure survivable?"* — a cheaper question than *"what does this failure cost?"*
— and the cheaper question was the one with an easy answer.

**Before accepting any auto-recovery as mitigation, measure what was lost between fault and recovery.**
A recovery ladder bounds a fault's *duration*; it says nothing about its *cost*.

## 4 · What this does NOT say

- **It does not rank the adapters.** The Sena's scan numbers are confounded (the daemon uses it as the
  live capture adapter, so a scan competes with its own operations); the UB500 hears ~6× what the Intel
  does with a deeper floor. Sensitivity and stall behaviour are different axes; this measures the second.
- **n = 1 for the Sena arm** — three UB500 nights against one Sena night.
- **No stall band was pre-registered**, so this is a strong OBSERVATION, not a scored result — same
  status as §4 of the jitter brief, and for the same reason.

## 5 · Consequence for allocation

Current allocation is **already correct and needs no change**: wearables on the Sena (0 s lost), CPAP on
the UB500 (0 stalls), Intel unused. This brief exists partly to stop a *future* reader "fixing" the CPAP
onto another radio — which this session came close to doing, on evidence from a different link on
different nights.

## Done when

- [ ] ≥ 3 Sena wearable nights before 0 s is quoted as characteristic.
- [ ] The 0.66 % malformed-frame rate on the CPAP link explained — **stable** across all three sessions
      that night (75/11,349 · 46/6,874 · 1,040/156,042), so it is a property of the link or the parser,
      not noise.
- [ ] A pre-registered stall band, so a future night SCORES this rather than observing it.
