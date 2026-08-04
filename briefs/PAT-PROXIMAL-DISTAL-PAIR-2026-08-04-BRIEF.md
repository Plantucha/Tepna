<!--
  PAT-PROXIMAL-DISTAL-PAIR-2026-08-04-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** IN-PROGRESS · **Created:** 2026-08-04 · **Answers:** `PAT-VERDICT-CONSOLIDATED-2026-08-04-BRIEF.md` §4.2 / Done-when 2 · **Follows:** `PAT-UNDER-PERBLOCK-ALIGNMENT-2026-08-02-BRIEF.md` §3c–§3j, `O2RING-RAW-STREAMS-ABSENT-2026-08-04-BRIEF.md`

# The proximal→distal pair exists — finger↔ankle — and its coupling tracks the ring's TIMEBASE PROVENANCE, not anatomy

`PAT-VERDICT-CONSOLIDATED` §4.2 lists *"a proximal→distal site pair, if the hardware ever allows one"* as
one of only two things that could reopen PAT, and leaves it unchecked because everything measured so far
is *"arm/wrist and finger — peripheral, with a short transit and therefore a poor signal-to-scatter
ratio."*

**The corpus already contains one.** Confirmed with the wearer 2026-08-04: the O2Ring is on the **right
index finger** and the Verity on the **LEFT ANKLE** — upper limb vs lower limb, ~60–80 cm of arterial
path against ~100–120 cm. Every prior brief in this family assumed the Verity was on the arm.

This brief reports what that pair shows, and **why its headline result cannot yet be believed**.

## 1 · The measurement

`tools/pat-ppg-ppg-control.mjs` — PPG↔PPG, no ECG leg at all. Both sites see the same cardiac cycle, so
this is also the **positive control the PAT family never had**: a negative in an ECG→pulse design cannot
distinguish "physiology unrecoverable" from "machinery broken", and two PPG streams on one host can.

The search window had to change. `rawLags` accepts only `[PHYS_LO=200, PHYS_HI=650] ms`, tuned for
ECG→pulse; a finger↔ankle transit is tens of ms and would be rejected **by construction**. A symmetric
±400 ms window is used and the leave-one-block-out centre locates the offset.

| night | overlap | medLag (ankle − finger) | strict | chance | ratio |
|---|---|---|---|---|---|
| 07-19 | 202 m | **+53** | 76 % | 7 % | **10.82** |
| 07-20 | 26 m | **+23** | 63 % | 7 % | **9.40** |
| 07-21 | 141 m | **+35** | 49 % | 7 % | **7.11** |
| 07-22 | 41 m | **+81** | 61 % | 7 % | **9.10** |
| 07-24 | 34 m | **+72** | 62 % | 6 % | **10.08** |
| 07-25 | 35 m | **+43** | 48 % | 7 % | **7.16** |
| 07-27 | 376 m | **+73** | 61 % | 7 % | **9.13** |
| 07-28 | 49 m | **+77** | 64 % | 7 % | **8.96** |
| 07-18 | 88 m | −121 | 1 % | 6 % | 0.11 |
| 07-26 | 189 m | +3 | 2 % | 9 % | 0.20 |
| 07-29 | 37 m | −381 | 4 % | 6 % | 0.69 |
| 07-30 | 42 m | −360 | 3 % | 7 % | 0.44 |
| 08-01 | 558 m | −313 | 2 % | 7 % | 0.32 |
| 08-03 | 445 m | −269 | 2 % | 7 % | 0.31 |

Eight of fourteen couple at **7–11×** an unchanged ~7 % floor, every one with a **positive** lag of
23–81 ms — the only anatomically possible sign for finger→ankle, and the right magnitude for an
upper→lower limb transit. A negative lag would require the pulse to reach the ankle first.

## 2 · Why that table is NOT yet evidence — the confound

Grouping the nights by the ring's **axis provenance** rather than by date separates them perfectly:

| night | `quantizedShare` | `drawn` | outcome |
|---|---|---|---|
| 07-22 | **1.000** | true | couples, 9.10 |
| 07-27 | **0.981** | false | couples, 9.13 |
| 07-29 | 0.000 | false | fails, 0.69 |
| 08-01 | 0.000 | false | fails, 0.32 |
| 08-03 | 0.001 | false | fails, 0.31 |

**The nights that couple are the ones whose ring axis is a DRAWN or near-drawn uniform grid; the nights
that fail are the ones with a properly host-measured axis.** That is backwards for a physiological
result. `index × constant` produces evenly spaced feet by construction, and evenly spaced feet matched
against evenly spaced feet can agree without shared physiology driving it.

So **§1's 8/14 is withdrawn as a physiological claim** until §4 separates the two. The positive lags
remain encouraging and unexplained by the artifact — a grid should not know which sign is anatomical —
but coupling and provenance cannot be untangled from this table alone.

A second reading is worse and more useful if true: host re-anchoring is what *creates* the measured
axis, and on the ring it lands every 126 samples with a median +11 ms correction (range −249…+271;
`O2RING-FRAME-SAMPLE-LOCK`). If that jitter falls between consecutive beats it smears beat-level lag
past the ±40 ms acceptance — meaning **the correction that makes wall-clock right destroys beat-level
timing**. That would be a capture-path finding, not an analysis one.

## 3 · Corrections to my own reporting, per `PAT-VERDICT-CONSOLIDATED` §5

- **`residIQR` 20–43 ms was quoted against the 60 ms bar. Withdrawn.** §5 states it is an IQR over only
  the residuals its own ±40 ms window accepted, so it *"reads 31–44 ms regardless of signal and must
  never be compared to the 60 ms bar."* My values sit exactly in that no-signal range.
- **Best-of-pairs is reported where §5 requires enumeration.** The tool scores every pair but prints only
  the maximum, which is selection on the outcome one level up. §4 owes the distribution.
- **"The machinery is broken, so no PAT verdict is meaningful" was printed by the tool from ONE night.**
  A verdict line that renders a global conclusion from whatever subset ran. Fixed to refuse.
- **I re-derived §3c's category error (clock-anchor IQR vs beat-coupling `residIQR`) and reported it as
  new.** It was documented 2026-08-02. §5's *"read the sibling briefs first"* was written for exactly
  this, and I read them only after building the tool.

## 4 · Done when

- [ ] **Score the same nights on the raw device grid AND the host-disciplined axis.** Coupling only on
      the grid ⇒ artifact of regularity, and §1 dies. Coupling on both with more scatter on the
      disciplined axis ⇒ the re-anchor jitter is the term, and that is actionable in the capture path.
- [ ] **Report the full per-pair distribution**, not the maximum (§5, enumeration).
- [ ] **Scatter measured offset-free**, so it is comparable with the family's ~84–99 ms — the accepted-set
      `residIQR` cannot serve.
- [ ] Resolve `07-29`/`07-30`/`08-01`/`08-03`, whose lags (−381 −360 −313 −269) crowd the −400 ms window
      edge and may simply be truncated rather than uncoupled.

## 5 · What is already usable regardless

- **The proximal→distal pair exists and is recorded nightly.** §4.2 asked whether the hardware allows
  one; it does, and 14 nights of it are on disk. Sensor placement must be stated in any future PAT work —
  four briefs assumed arm/wrist and the assumption was never checked.
- **`tools/pat-ppg-ppg-control.mjs`** gives the family its missing PPG↔PPG control, with no ECG detector
  involved — which matters, because that detector fails plausibility on **half** the ring corpus
  (121–211 /min, `tools/pat-finger-coupler.mjs`'s rate gate).
- **The ECG leg is worse than the corpus suggests.** 8 of 16 ring nights fail a 30–120 /min detector
  sanity gate on one side or the other. `PAT-VERDICT-CONSOLIDATED` §2's blocker table does not include
  detector plausibility, and on this corpus it excludes half the data before any statistic runs.
