<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-09-17 (**the Done-when is met for PpgDex, and the §4 questions are still NOT decided — read that distinction before reusing this brief.** What landed is the NODE-SIDE obligation Clock Contract §7 already required of every node — *"a node that detects no steps has not shown its stream has none, only that it has not looked"* — not the transport-edge stamp this brief's TITLE proposes. The edge stamp remains blocked on §4's four questions, two of which are the owner's (whether consumers are FORCED to refuse, and the corpus re-verification cost); a follow-up owns it. Executed: `ppgdex-dsp.js` re-anchors at a seam in **both** its parse sites — `parsePPG` and its own `parseSensorXYZ`, which was an unfixed twin of the function MotionDex had already split — and drops the pre-seam host-axis anchors per §7's ONE DEVICE CLOCK PER AXIS. Verified by planting: relSec span **2.4159e8 s → 249.0 s**, seam recorded, `anchorsDroppedPreResync: 5`, `fs` unmoved. A real 120 s DROPOUT is deliberately left alone. **Export-inert on the committed corpus** — PpgDex `manifestHash` dc05497316ad → ba3df6e74e06 with **zero `outputHash` changes** across all 6 fixtures.) · **Created:** 2026-09-16 · **Residue:** 2026-09-17-ble-timebase-edge-stamp-undecided

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

### ✅ MET for PpgDex — 2026-09-17, measured by planting

| plant | before | after | seam |
|---|---|---|---|
| clean, no step | 15.992 s | 15.992 s | none — **byte-unchanged** |
| device step, F1 magnitude | **2.4159e8 s** (7.66 y) | **249.0 s** | recorded, `phoneDeltaMs` 86008 |
| device step, +24 h | 86,415.992 s | 15.992 s | recorded |
| blind seam (stamp unparseable) | 2.4159e8 s | 248.9 s | recorded, `phoneDeltaMs: null` |
| **real 120 s dropout** | 135.992 s | 135.992 s | **none — counter is RIGHT, left alone** |

- **Both parse sites fixed.** `parsePPG`, and PpgDex's own `parseSensorXYZ` — which was an UNFIXED
  TWIN of the identically-named function MotionDex had already split. Same function name, two copies,
  one repaired: the duplication-drift shape this repo keeps finding.
- **§7's other half is included, and the existing suite is what caught its absence.** Re-anchoring the
  axis removes `hostAxis`'s refusal TRIGGER, so the first draft turned the pre-existing
  `THE GUARD THAT WORKS · hostAxis REFUSES a stepped counter` leg to `ok:true` — meaning a 484.7-ppm
  rate could then reach `fs`, the exact path ECGDex measured (fs 129.968 → 129.903). Pre-seam anchors
  are now dropped and COUNTED (`anchorsDroppedPreResync`, ECGDex's key name), `anchors: 40, dropped: 5`,
  `fs` unmoved.
- **The refusal was load-bearing in a way nobody had stated:** it was standing in for the anchor split.
  Fixing the axis without the split would have *removed a guard*, which is why that leg is re-aimed
  rather than deleted.
- **Cost:** the host stamp is parsed only when a candidate step fires (0–3 rows in a real file), so
  EFFICIENCY-AUDIT §P1's removal of the per-row `parseTimestamp` stands — `prevPhoneRaw` carries the
  previous row's stamp as an unparsed string reference.
- **Census preserved:** 0 of 3674 corpus `_PPG.txt` files carry a resync (84 real dropouts). This is a
  TRIPWIRE for a latent class, not the repair of an active bug, and the group says so in a leg so a
  reader cannot conclude PPG resyncs were happening.

### ⚠️ STILL NOT DONE — the transport-edge stamp this brief is TITLED after

§4's four questions are untouched and the two owner-level ones are unanswered. What landed is the
per-node obligation §7 already imposed; it does not foreclose the edge stamp, and when the edge lands
these detectors become the tripwire §7 asks for rather than dead code. Residue:
`2026-09-17-ble-timebase-edge-stamp-undecided`.

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
