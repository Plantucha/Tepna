<!--
  O2RING-TIME-CAPABILITY-WIRING-2026-08-19-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED (parked 2026-09-02 — 2a and 2b SHIPPED in #1643; **2c is the only remaining task and it is the cheapest open item in this whole family: pure JS wiring, no box, no ring, no hardware.** Re-verified today: `grep -rn 'rtcOffsetS\|rtcVerified' tools/*.mjs` returns ZERO hits across all of `tools/`, and `git log -S'rtcOffsetS' -- tools/` is empty — the identifier has never appeared under `tools/`, so this has never been attempted rather than attempted and abandoned. It is the EXECUTE candidate of this drain and is parked only for want of a WIP slot, not for want of an unblocker. **Owner:** Heron · **Next step:** wire `rtcOffsetS`/`rtcVerified` through `tools/trio-batch.mjs`, under the full gate) · **Created:** 2026-08-19

# Wiring the ring's readable clock into the Dexes, the Integrator, and the trio fold

> **Scope:** Dex lane (bundles + fixtures + gates) + `tools/trio-batch.mjs`. The capture-host half
> already shipped (#1543 readback · #1544 settings · #1548 monitor).
> **Owner question this answers:** "wire new o2ring time capability to dexes and integrator, trio,
> re-assess 3 corner hat, try run PAT" — the PAT run and TCH verdict are §4/§5, measured 2026-08-19.

## 1 · What the new capability actually gives each consumer

The RTC readback (GET_INFO [24:31], ±1 s quantum) verifies the **1 Hz summary layer's** absolute
placement — the stored `.dat` and the live SPO2 rows. It gives NOTHING at waveform resolution: the
ring's 125 Hz pleth axis remains host-back-timed and its device stamp remains drawn
([[o2ring-timestamp-is-drawn]]). Every wiring item below must respect that boundary.

## 2 · The wiring items (Dex lane — each is a gated behavioral change)

- **2a · OxyDex `.dat` import carries a verified timebase.** `oxydex-dsp.js`'s stored-session path
  stamps `timingSource: 'device+host-verified'` + the measured `rtcOffsetS` into the night object and
  the `ganglior.node-export` (additive field, MINOR) when a capture-side RTC readback exists for the
  session; `'device'` (unverified) otherwise. Consumers stop treating all `.dat` nights as
  free-running-RTC nights.
- **2b · The Integrator's clock-skew veto consumes the readback.** The veto that caught the CPAP's
  42-min skew currently has no O2Ring leg; feed it `ring_rtc_offset_s` from the night's QC/arrival
  metadata so a ring whose RTC was reset by a battery event (known failure) is vetoed instead of
  silently mis-placed. Additive: a missing offset changes nothing.
- **2c · trio fold records the offset.** `tools/trio-batch.mjs` copies the capture's ring-RTC
  readings (offset, read time) into `arrival_<night>.json` so the fold's provenance names the clock
  state it folded under — same pattern as the existing arrival-quality fields.

## 3 · What is deliberately NOT wired

- No waveform-timing change anywhere: the readback cannot improve beat-level placement (±1 s vs the
  ~10 ms PAT needs). The buzz fiducial (2b/three-way leg) remains the only path there.
- No badge/tier upgrades: a verified 1 Hz timebase does not upgrade any metric's evidence tier.

## 4 · Three-cornered hat — REASSESSED (verdict: unchanged, and now provably so)

The RTC readback adds a ±1 s-quantized clock; TCH estimates σ_y(τ) from ms-scale phase series. A third
corner needs an independent clock at the NOISE level of the other two, and ±1 s quantization sits 2–3
orders above it — the readback is structurally unable to be a corner. The binding limits remain the
measured ones: ρ≈0.77 common-mode correlation between the "independent" pairs, and the corpus's
phone-captured nights carrying no second clock at all. **What COULD change TCH is the buzz fiducial's
three-way leg** (ring↔H10↔Verity, one mechanical event in three records, ~±8–20 ms): three genuinely
shared fiducials would over-determine the pairwise offsets — that is a fiducial network, not a hat,
and it is the better instrument for this corpus. Route TCH effort there.
### §4a · ADOPTED as the direction — but the first CLOSURE RESIDUAL cannot be computed, and the reason is structural (2026-08-23)

`FINISHED-WORK-IMPROVEMENTS` §B3 asks for the decision plus "a first closure residual from the
existing run-C / morning-calibration captures". The decision above stands and is recorded here as
**adopted**: the RTC is declined as a corner, the fiducial network is the TCH direction.

**The closure residual is a different matter, and asking for it exposes why.** A closure needs three
*independently observed* pairwise offsets — `ring↔H10`, `H10↔Verity`, `Verity↔ring` — whose sum must
be zero. Only the middle one exists as an observation. The ring's own leg does not, and this brief
already says so twice:

| leg | observed? | evidence |
|---|---|---|
| H10↔Verity | **yes** | +193.5 ± 64 (night) → +118.5 ± 41 (morning) → pooled **+140 ± 35 ms** |
| ring↔H10 · Verity↔ring | **no** | ring self-detection **2/5, 2/5, 2–3/5** — the only device failing the pre-stated ≥4/5 band |

🔴 **And the recorded workaround would make the closure VACUOUS.** §4 offers, for the ring-side onset,
*"simply from the command stamp + the measured H10-leg latency"*. Substitute that and the ring↔H10
offset is **defined** as the H10-leg latency, so the three-way sum is **identically zero by
construction** — a closure that cannot fail, measuring nothing. That is the same shape this repo keeps
finding, and it is worse here than no number at all, because a zero residual reads as the network
being consistent.

**So the residual is instrument-gated, not data-gated**, and no re-analysis of run C or the morning
calibration can produce it. Raising the buzz does not help: the 2026-08-20 sweep found **motor 60 IS
the through-stack detection floor** (40 → 1/3, 20 → ~0/3), and 60 is what those 2/5 runs already used.

**What would supply a real third corner**, in increasing cost:
1. **The ring's OPTICAL channels as an independent onset** — §4 names this beside the command-stamp
   shortcut, and it is the only untested option here. It needs no new hardware, but it does need a
   capture where the ring's PPG/motion streams are recorded across a buzz, plus a detector. Until
   measured its detection rate is unknown, not assumed.
2. **A different shared physical event** all three devices genuinely observe — that belongs to the box
   evening (`FINISHED-WORK` group C), not to re-analysis.

**Do not report a closure residual until one of those exists.** Until then this is a two-device pair
with a well-measured offset, which is a useful instrument and is not a network.

## 5 · PAT — first scored run under the shipped hostAxis offset (2026-08-19)

`node tools/pat-host-offset.mjs --dir uploads/captures --night 2026-08-14` (ECG ref, PPG foot,
120-min windows, 50 surrogates):

| win | beats | legacy match (chance) | p | strict ≤40 ms (chance) | p |
|---|---|---|---|---|---|
| 0 | 6191 | 48 % (20 %) | 0.020 | 7 % (7 %) | 0.510 |
| 120 | 6329 | 81 % (21 %) | 0.020 | 12 % (7 %) | 0.020 |

**Reading:** cross-device beat PAIRING is real and strong (legacy 65 % mean vs 20 % chance, both
windows p=0.02) — trend-level PAT exists on box nights today. **Beat-level PAT is not yet a
measurement**: the strict 40 ms bar beats its own null in one window of two, marginally — and the
literature (Mukkamala 2015, IEEE TBME, DOI 10.1109/TBME.2015.2441951) puts BP sensitivity at
~1 mmHg/ms, so even 40 ms is coarse for per-beat BP. The chain stays: buzz fiducial → ±20 ms clock →
beat-level PAT → per-user calibration (Finnegan 2021, Sci Rep, DOI 10.1038/s41598-021-01358-4;
foot fiducial per Block 2020, Sci Rep, DOI 10.1038/s41598-020-73143-8). 2026-08-15 scored no window
(the duty-cycle-fragmented night; input pairing failed before scoring — recorded as unscoreable, not
as absence of coupling). O2Ring-side PAT (finger) additionally waits on the buzz because the ring's
waveform axis is drawn and is refused as a clock by design.

## 6 · Stream routing (owner question, settled)

1 Hz oximetry (SPO2.csv / stored .dat) → **OxyDex**. Waveform streams (125 Hz pleth, ~100 Hz ppg2w)
→ **PpgDex machinery** (PPGDSP consensus → buildPPI → Malik correctRR — the Verity path). PAT consumes
the waveform side.

## Done when

- [x] **2a SHIPPED — #1643 (2026-08-23).** `oxydex-dsp.js:340` stamps the night; `:7396-7397` project
      `timingSource` + `rtcOffsetS` onto `_out.recording` (additive, as specified). Gated: 5 references
      in `tests/dex-tests.js`. Verified on `origin/main` 2026-08-26.
- [x] **2b SHIPPED — #1643 (2026-08-23).** `integrator-dsp.js:739-745` reads `rtcOffsetS` /
      `rtcVerifiedAtMs` off `json.recording` and `:6120` carries them through; the suite holds 14
      RTC-reset references. Verified on `origin/main` 2026-08-26.
- [ ] **2c — the ONLY remaining task.** `tools/trio-batch.mjs` contains zero `rtcOffsetS` /
      `rtcVerified` occurrences, and neither does any other `tools/*.mjs` (checked 2026-08-26).
      ⚠️ Verify that count directly rather than through a pipeline: `git grep ... | head` returns
      head's exit status, so an absence and a masked non-match read identically.
- [x] §4's fiducial-network alternative is either adopted into the TCH roadmap or explicitly declined.
      **ADOPTED as the direction 2026-08-23 (§4a); the RTC stays declined as a corner.** The first
      closure residual `FINISHED-WORK` §B3 asks for is NOT computable from the existing captures, and
      the block is structural rather than a data gap: only H10↔Verity is an observed offset
      (+140 ± 35 ms), the ring fails its own detection band at 2/5 on every run, and §4's recorded
      workaround — deriving the ring onset from the command stamp plus the H10-leg latency — makes the
      three-way sum identically zero by construction. A closure that cannot fail is worse than none.
