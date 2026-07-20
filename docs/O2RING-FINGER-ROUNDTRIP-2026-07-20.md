<!--
  docs/O2RING-FINGER-ROUNDTRIP-2026-07-20.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

# O2Ring finger-site PPG — round-trip acceptance on real hardware (2026-07-20)

**Status:** REFERENCE (evidence record) · **last-verified:** 2026-07-20

The `PPGDEX-O2RING-FINGER-SITE-2026-07-18-BRIEF.md` §6 acceptance, and the two remaining Done-when
items of `O2RING-LIVE-PPG-WAVEFORM-2026-07-17-BRIEF.md`, executed against a **real capture session**
rather than the committed synthetic twin. The synthetic twin is the CI gate; this is the on-hardware
confirmation the briefs asked for.

## The capture

A single real Health-Box session, 2026-07-19 ~20:58, worn on the finger, with a chest-strap ECG
recording simultaneously — so all three legs the acceptance names exist at once:

| leg | file | role |
|---|---|---|
| O2Ring finger PPG | `Wellue_O2Ring_627C92B3_20260719205422_PPG.txt` | the signal under test |
| ring's own 1 Hz HR | `Wellue_O2Ring_627C92B3_20260719205422_SPO2.csv` (`Pulse Rate`) | reference (a) |
| paired Polar H10 ECG | `Polar_H10_02849638_20260719205716_ECG.txt` | reference (b) — gold standard |

(Real recordings are gitignored — personal biosignal data. The tool takes paths as arguments.)

## Method

`tools/o2ring-finger-roundtrip.mjs` runs the **real** modules in a co-loaded realm:

- O2Ring PPG → `PPGDSP.parsePPG` + `analyze` → foot-to-foot per-beat HR series.
- H10 ECG → `ECGDSP.parseECG` + `analyze` (Pan–Tompkins) → per-beat HR series (the honest H10 leg
  is the raw-ECG HR, per `CLAUDE.md` §🎙️ — never the smoothed device `_HR.txt`).
- SPO2 CSV → the ring's own 1 Hz `Pulse Rate`.

Each series is stamped in absolute floating `tMs`; medians are compared over the window where all
three overlap (a chest-strap ECG clip covers the last ~96 s of the ring session).

## Result — PASS

Overlap window 20:58:20 → 20:59:57 (96 s):

| source | median HR | IQR | n |
|---|---|---|---|
| **O2Ring → PpgDex** | **56.3 bpm** | 7.1 | 87 |
| ring 1 Hz field | 57.0 bpm | 2.0 | 97 |
| **H10 ECG (gold)** | **56.1 bpm** | 3.3 | 92 |

| acceptance check | result |
|---|---|
| O2Ring PPI-HR vs ring 1 Hz HR | **PASS** — Δ 0.7 bpm |
| O2Ring PPI-HR vs paired H10 ECG | **PASS** — Δ 0.2 bpm |
| feet detected (313) + PPI foot-to-foot | **PASS** |

Detection was honest: `ledSingleChannel = true`, `ledAgreementPct = null` — no fabricated 3-LED
agreement. Morphology fiducials present.

## The one caveat, recorded honestly

This session was captured **before PR #276**, so the file carries the O2Ring value **replicated
across `channel 0/1/2`** — a 3-column layout, which `parsePPG` tags `site: 'wrist'`. The
degenerate-channel guard (`distinctChannelIdx`) collapses the identical columns to ONE before the
consensus vote, which is exactly why `ledSingleChannel` is `true` and the agreement is `null`: the
run took the honest single-channel path #275 built. The HR numbers above are therefore what that
path produces on real optical data.

A **post-#276 capture writes a genuine 1-column file** (`ppg1` stream) that `parsePPG` tags
`site: 'finger'` directly, without relying on the guard. That path is proven byte-for-byte on the
committed synthetic twin (`synthetic_ppgdex_o2ring_finger.txt`, 48 gated assertions). Re-running this
same round-trip on a fresh post-#276 session — to see `site: 'finger'` end-to-end on real data — is
the one belt-and-suspenders step left; it needs a fresh worn capture, and changes none of the DSP
math (the guard makes the two file shapes numerically identical).

## Validation sweep — not one session, ninety-two

The single-session result above is one data point. `tools/o2ring-finger-validate-batch.mjs`
discovers **every** capture session on disk with an O2Ring PPG + a paired H10 ECG + the ring's
SPO2, matches each substantial PPG segment to its best-overlapping ECG, and runs the same three-way
comparison. Across **four days** of real captures (2026-07-18 → 20):

- **88 / 92 pairs PASS** (both `|PPG − ring|` and `|PPG − ECG|` ≤ 3 bpm, feet detected).
- **median `|PPG − ring|` = 0.4 bpm**; 77 of 93 segments agree with the ring's own field to within
  1.0 bpm.
- **Every** segment reported `ledSingleChannel = true` and `ledAgreementPct = null` — the
  degenerate-channel guard collapsed the replicated columns on every real file, so nothing ever
  fabricated 3-LED agreement.

The four non-passes are **all reference-side, none a finger-path defect**:

1. One segment where the **ring's own 1 Hz field** read 70 bpm while PpgDex (54.6) tracked the
   paired ECG (51.0) — here the derived HR is *more* accurate than the ring's onboard number, which
   is exactly why `CLAUDE.md` §🎙️ says to derive HR from the raw waveform, not the smoothed device
   summary.
2. & 3. Two short/noisy ECG clips reading 3.0–3.4 bpm high while PPG matched the ring to 0.1 bpm.
4. One flat/disconnected ECG segment that `ECGDSP.parseECG` refused (too few R-peaks) — the PPG was
   fine; the reference was absent.

So the finger-site PPI-HR agrees with a chest-ECG gold standard across ~92 real segments spanning
HRs from ~50 to ~62 bpm, and matches the ring's own field even more tightly.

## `site='finger'` end-to-end on a real 1-column capture (added 2026-07-20)

The capture daemon was restarted on the post-#276 code, and a fresh finger session was recorded —
this time a **genuine single-column file** (`Phone timestamp;sensor timestamp [ns];channel 0`), not
the replicated shape. So the site tag now comes straight from the parser, with no reliance on the
degenerate-channel guard:

| | value |
|---|---|
| header | `…;channel 0` (one optical column) |
| `parsePPG` | **`site='finger'`**, `channels=1`, fs 125.7 Hz |
| `analyze` | `site='finger'`, `ledSingleChannel=true`, `ledAgreementPct=null` |
| feet / morphology | PPI foot-to-foot, morphology present |

And with the H10 chest strap streaming a **live raw ECG** in the same session, the full three-way
ran over a **366 s** overlap:

| source | median HR | vs finger PPG |
|---|---|---|
| **O2Ring → PpgDex** (site=finger) | **59.7 bpm** | — |
| ring's own 1 Hz field | 60.0 bpm | Δ 0.3 |
| **H10 ECG (gold standard)** | 60.9 bpm | Δ 1.2 |

So the genuine 1-column finger capture is validated against both the ring's own field and a live
chest-ECG gold standard, all within ~1 bpm. This closes the one thing the earlier
replicated-capture round-trip couldn't show: a real 1-column file tagging `site='finger'`
**directly**, without the guard collapsing anything.

It also exercised the **§2.4 sentinel path on real data for the first time**: `sentinelRejected=59`
(~0.6 % of samples — matching the ~0.66/frame the brief measured on the 90 s probe),
`sentinelKept=0`, and `nGapBeats=3` (three beats dropped because their span touched a rejected `156`,
rather than being median-filled). The in-band-sentinel rejection works on hardware, not just on the
committed twin.

## Re-run it

```sh
# one session, verbose
node tools/o2ring-finger-roundtrip.mjs <ring_PPG.txt> <H10_ECG.txt> <ring_SPO2.csv>
# every session under one or more capture dirs, one row per pair
node tools/o2ring-finger-validate-batch.mjs <captures/2026-07-19> [<dir> ...]
```
