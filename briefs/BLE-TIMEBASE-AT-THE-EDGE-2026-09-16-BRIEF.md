<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-09-16

# Establish the timebase at the transport edge, once

> **Promoted from `BLE-TRANSPORT-REDESIGN-2026-09-10-BRIEF.md` §1.4**, whose §4 marks it *"pickup,
> brief of its own"* and whose §5 closes when 1.2–1.7 are each executed **or promoted**. This is the
> promotion. Its siblings §1.5/§1.6 (#2548), §1.7 (#2556) and §1.3 (#2549, #2561) are executed.

## 1 · The one sentence

Each node reconstructs time from whatever survived to it, so a discontinuity every node is separately
expected to notice is one that most of them are not looking for — and the Clock Contract already says
a node that detects no steps *"has not shown its stream has none, only that it has not looked."*

## 2 · Evidence, all measured

**A refusal about one quantity was read as protection of another.** Measured 2026-09-02 with the true
F1 magnitude planted into a `_PPG.txt`: `hostAxis` refuses at ±50,000 ppm exactly as designed, **and
`relSec` still spans 2.416e8 s** — a 7.66-year night through every duration, epoch grid and export
window downstream, while the rate guard reads green. Clock Contract §7 states the rule this violates:
a refusal guards the RATE, not the AXIS.

**A step is visible or invisible depending on which anchor set you ask.** Measured 2026-09-16 on the
tri-device night: the same `clock.js hostAxis` function reports `maxStepMs` = **1796.7 ms** over
172,532 packet-level anchors and **31.5 ms** over 6,050, for the same device on the same night — 57×
apart, with no field distinguishing them (residue `2026-09-16-maxstepms-names-two-populations`). A
consumer comparing those two numbers is comparing different populations and cannot tell.

**The seam is real and has been re-timed before.** On the 2026-08-27 resync file the host−device
residual walks +1508 ms across the first 9.5 s (≈160,000 ppm) and then holds flat at 38 ppm; with
anchor 0 inside the pre-seam segment `hostAxis` read that step as a RATE, quoted 484.7 ppm, and the
span gate let it into `fs`. ECGDex implements the split (`_clockResyncs`); PpgDex does not, and the
same night's `_ACC.txt` carries the F1 step.

## 3 · Done when (verbatim from the parent)

A planted counter step produces a **seam event**, not a silently spanned `relSec`; a node consuming
the stream cannot construct a duration across a seam without seeing it.

## 4 · ⚠️ What this brief deliberately does NOT decide

Written as a problem statement, not a design. Each of these changes the blast radius and none is
this brief's to settle alone:

- **Where the stamp lives.** "Earliest possible point" is `capture.py`'s notification handler for BLE,
  but CPAP/AS11 and file-import paths have no such point. A partial edge is a second seam.
- **What a seam event IS on the wire.** A row in the stream, a sidecar (the `_PPGRUNS.txt` precedent,
  §∅), or a field on every packet. The first changes every reader's parse; the second cannot be
  missed by a consumer that ignores sidecars; the third is the most expensive per sample.
- **Whether consumers are FORCED to see it, and how.** "Cannot construct a duration across a seam
  without seeing it" implies refusal somewhere, and a refusal that stops a night is a data-loss trade
  of exactly the kind §1.7 declined to make.
- **Migration.** Every committed fixture and golden was produced by the current path. A stamp that
  moves `computeHash` re-verifies the whole corpus.

## 5 · Sequencing

**Clock Contract adjacent, therefore SERIALISED** (parent §4). It must not run concurrently with
other clock work, and the `_clockResyncs` split already in ECGDex is the reference implementation to
generalise from rather than replace.
