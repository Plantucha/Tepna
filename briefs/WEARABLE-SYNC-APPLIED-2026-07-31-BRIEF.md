<!--
  WEARABLE-SYNC-APPLIED-2026-07-31-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-07-31 · **Created:** 2026-07-31 · **Executes:** `WEARABLE-SYNC-2026-07-31-BRIEF.md` §6 (the open item) · **Affects:** `CROSS-DEVICE-CLOCK-SKEW` §2d's latency ladder, `POOLED-CLOCK-FIT-FOLLOWUPS` §1

# The offsets are applied. One finding survives, one does not, and one cannot be checked.

`WEARABLE-SYNC` measured what nothing had measured — the H10 and the Verity are **1.8–5.0 s apart on
every phone-captured night** — and left an obligation: every cross-device figure in this repo was
computed assuming they agreed. This brief discharges it.

Offsets from `tools/wearable-sync.mjs --src allcaps --fs 4`: **33 of 37 nights measured**, range
0.25–5.00 s, median 3.25 s, **27 of 33 exceed 1 s**. Nights the tool could not measure are **excluded,
not assumed to be zero** — assuming zero is the exact bug being removed.

The Verity is mapped onto the H10 timeline by SUBTRACTING its offset, applied to the event times
*before* the pair fit, so the correction sits inside the measurement rather than being applied to its
output.

> **Drift is deliberately not applied.** Median 0.0 ppm across the corpus — correct, since the box
> re-syncs both Polars on every connect — but the column carries junk on low-window nights (1666 ppm on
> 4 usable windows, −83 ppm on 20 with MAD 0.5 s). **Drift needs far more usable windows than offset
> does.** Applying a per-night slope fitted through four points would inject noise, not remove it.

---

## 1 · SURVIVES — the `autonomic_surge ↔ movement_onset` bimodality

29 nights where both the offset and the pair fit are confident:

| | positive mode | negative mode |
|---|---|---|
| raw | 23 nights, median **+17 s** | 6 nights, median **−22 s** |
| corrected | 23 nights, median **+14 s** | 6 nights, median **−24 s** |

**Zero nights changed sign.** Both modes shift by roughly the median offset, as they must — and the
quantity that was actually the finding, the **separation between them, is invariant: 39 s → 38 s**.

This was previously checked on 7 nights using the sparse event channel; it now holds on 29 with a
measurement two orders of magnitude better resourced. The bimodality is not a device-sync artifact,
and `POOLED-CLOCK-FIT-FOLLOWUPS` §1 stands — including its refusal to call it physiology until the
modes are conditioned on arousal intensity and both fiducials document which instant they stamp.

## 2 · DOES NOT SURVIVE — the latency ladder

`CROSS-DEVICE-CLOCK-SKEW` §2d orders four rungs across 2 minutes: movement 37.5, autonomic/optical
38.0, `_RR` tachycardia 38.12, desaturation 39.5 min. Re-measured per channel against each night's
pooled CPAP offset, Verity-corrected, keeping only channels with ≥5 confident nights:

| channel | n | median | IQR |
|---|---|---|---|
| PpgDex `motion_artifact_segment` | 10 | −9.0 s | −19 … 19 |
| PpgDex `movement_onset` | 15 | −1.0 s | −20 … 22 |
| ECGDex `autonomic_surge` | 14 | +7.0 s | −5 … 20 |

**The rungs are not separated.** Medians span 16 s; the interquartile ranges are ±20 s and overlap
completely. `OxyDex/desat_event` — the rung the ladder's whole story rested on — **never reaches 5
confident nights**, so it does not appear at all.

The ladder is not *wrong* here; it is **unresolved**. It was built from per-channel point estimates
with no uncertainty attached, and once each rung carries an error bar the ordering it asserted cannot
be read out of this corpus. That is the same failure as the retracted `7/7` and `21/21` claims: a
pattern in point estimates, published as structure, that does not survive its own error bars.

**Consequence:** the ordered latency ladder should not be cited as established. What survives is the
weaker, still-useful statement that desaturation trails the mechanical responders — supported by §1's
sign structure and by the physiology, not by these four numbers.

## 3 · CANNOT BE CHECKED — anything involving the O2Ring

**No impulse type bridges the O2Ring to a Polar**, so its clock offset is unmeasured and unmeasurable
by this method. Every OxyDex rung above, the `desat ≈ +105 s` transit figure, and the whole
apnea→desaturation transit measurement carry that unknown.

This is a *structural* gap, not a data-quality one: the O2Ring emits `desat_event` and
`periodic_breathing`, neither of which any other device produces. Closing it needs either a shared
impulse (both devices emitting movement, say) or a shared continuous carrier (its 125 Hz pleth against
a Polar PPG). The pleth exists on the 7 box nights only.

## 4 · What this leaves standing

- **Wearable offsets are now measured, not assumed** — and 27 of 33 nights carry more than 1 s.
- **The bimodality is real and survives correction**, on 29 nights.
- **The latency ladder is withdrawn as an ordered claim.**
- **The O2Ring is unbridged** and every figure through it is provisional.

## 5 · Done when

- [x] Offsets measured corpus-wide and applied to the event times before fitting, with unmeasured
      nights excluded rather than defaulted to zero.
- [x] Bimodality re-checked under correction (29 nights, 0 sign flips, separation invariant).
- [x] Latency ladder re-measured with per-rung uncertainty, and withdrawn as an ordered claim.
- [x] The O2Ring gap stated as structural rather than left implicit.
- [ ] `CROSS-DEVICE-CLOCK-SKEW` §2d amended in place to point at §2 here. *(Deliberately deferred: that
      brief has been amended twice today already and a third edit in the same session risks
      contradicting a reader mid-file. Do it as a single pass over all three amendments.)*
- [ ] A bridge for the O2Ring — shared impulse or shared carrier — so §3 stops being a permanent asterisk.
