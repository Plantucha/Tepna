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

## Re-run it

```sh
node tools/o2ring-finger-roundtrip.mjs <ring_PPG.txt> <H10_ECG.txt> <ring_SPO2.csv>
```
