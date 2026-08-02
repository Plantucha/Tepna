<!--
  WEARABLE-HOST-AXIS-FOLLOWUPS-2026-08-02-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS · **Created:** 2026-08-02 · **F1 DONE 2026-08-02** · **Follows:** `WEARABLE-HOST-AXIS-2026-08-02-BRIEF.md` · **Affects:** `ppgdex-dsp.js`, `integrator-dsp.js`, `tools/trio-batch.mjs`, `papers/`, several briefs

# The O2Ring's axis was drawn on every night before 2026-07-28. Everything that used it as a clock has to be re-asked.

`WEARABLE-HOST-AXIS` fixed the axis. It did not re-derive the conclusions that were computed on the old
one. Those conclusions are not merely imprecise — one of the three sources in every three-body clock
measurement this repo has published was **`sample_index × 125.738 Hz`**, a drawn axis whose apparent ppm
is the error in an assumption.

## F1 · Detect drawn provenance, and declare it — **DONE 2026-08-02**

> **Converged independently with `O2RING-SYNTHESISED-AXIS-2026-08-02-BRIEF` (a parallel session).**
> That brief reaches the same mechanism from the raw bytes and states the same guardrail; this F1 is its
> execution. Of its §5 acceptance items, **three are now met**: `hostAxis` flags a capture-constructed
> axis by *provenance, not span* and says so in its return value; `dual-clock-rate.mjs` names the drawn
> cause instead of only reporting a wide spread (its "not a disciplined clock" note was true but blamed
> a crystal that is innocent — there is none in the file); and a gate detects a synthesised axis from the
> bytes so this cannot be rediscovered a third time. Its remaining items — voiding the O2Ring legs in
> `CLOCK-CLOSURE-THREE-SOURCE` / `CROSS-DEVICE-DRIFT-AND-CLOSURE`, and the `O2PPG_FS_DEFAULT`
> capture-side question — stay open here as F3 and in `capture-host/` respectively.

> ### ⛔ The proposed test does not work. Measured, not assumed.
> `first sensor timestamp == 0` was the candidate, and it is **true for every O2Ring fragment** —
> including the post-2026-07-28 *measured* ones carrying 1574–1861 distinct deltas. It separates
> **relative-epoch from absolute-epoch** (O2Ring vs Polar), not drawn from measured, so shipping it
> would have condemned exactly the good sessions. Checking it before building on it cost one query.

What does separate them is how much of the inter-sample delta distribution sits on **one value**:

| | modal delta share | verdict |
|---|---|---|
| O2Ring ≤ 2026-07-27 (16 files) | **100.0 %** | drawn |
| O2Ring 2026-07-28 → | **0.1 % / 0.0 %** | measured (−163 / −160 ppm, a real stable crystal) |
| Verity | 0.1 % | measured |

**Shipped.** `parsePPG` computes `quantizedShare` from the delta array it already builds (free — one
pass over an existing array), asserts `drawn` only at **≥99 %**, and always reports the share as a
NUMBER so a reader can judge the borderline instead of inheriting a verdict. The middle of the range is
genuinely ambiguous on short fragments, and a binary that pretends otherwise would be the same
over-claim this brief family exists to remove.

The field consumers must branch on is **`quality.timingSource`** (additive, contract-safe):

- `'device+host'` — device reported real timestamps, host-disciplined. **Usable as a clock.**
- `'host'` — the device column was drawn; all real timing came from the capture host, and the device
  contributed sample **order** only.
- `'none'` — drawn **and** no host anchors: the recording carries **no timing information at all** and
  must never be spent as a clock leg.

Gated, including a lock-out assertion so `first ns == 0` cannot be re-proposed without the test failing.
Building the gate exposed a second trap worth keeping: a **sawtooth** jitter has a near-constant first
difference, so the original "measured" synthetic scored **0.979** — itself a drawn-looking axis, nearly
passing for the opposite of the real reason. The jitter must be independent per sample (now 0.0015).

## F2 · Re-run the whole corpus under the disciplined axis

Every trio/fold artefact predates the fix. `tools/trio-batch.mjs` is the sanctioned entry point (a
hand-rolled harness gets four signatures wrong). Expect the O2Ring legs to change the most and the Polar
pair barely at all — **and treat that asymmetry as the check**: if the H10↔Verity leg moves materially,
something else is wrong.

## F3 · Re-ask three-cornered hat, closure, and PAT — they shared one broken assumption

- **`CLOCK-CLOSURE-THREE-SOURCE-2026-08-01`** — all six nights use the O2Ring as leg C. Its §1 table
  reports closure "never zero" and calls it unexplained. **It is now explained**: leg C rode a drawn
  axis, so both of its pairs measured a fiction faithfully and the linear fits were bad *fits*, not just
  a bad clock. Re-run; expect the Polar-only legs to survive and the O2Ring legs to move.
- **Three-cornered hat** (`integrator-tch.js`, `INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-II`,
  `TCH-REFERENCE-VALIDATION`) — TCH assumes three *independent* sources. A drawn axis is not an
  independent clock; it is a constant. Check whether any published TCH result used the finger PPI leg.
- **PAT** (`PAT-UNDER-PERBLOCK-ALIGNMENT`, `pat-feasibility.js`, `pat-gate.js`) — a pulse-arrival delay
  measured against a drawn axis inherits its error. Re-run per-block PAT on the disciplined axis; the
  post-2026-07-28 nights are the clean ones to trust.
- **`CROSS-DEVICE-CLOCK-SKEW-2026-07-29`**, **`MULTINIGHT-CORPUS-FINDINGS-2026-07-29`** — audit for
  O2Ring-timing dependence.

## F4 · `papers/` audit

- **`papers/wearable-clock-drift.html`** — already carries two correction banners. It needs a third pass
  folding in the direct measurement (H10 ≈ −20, Verity ≈ −27, inter-device ≈ 7 ppm) and the drawn-axis
  finding, and it should stop presenting any O2Ring-derived ppm as a crystal property.
- **`papers/timestamp-pathology.html`** — its subject *is* consumer-export timestamp pathology. A drawn
  axis with a calibrated-but-wrong constant is the strongest specimen this corpus has produced, and the
  paper predates knowing it. Strong candidate for a new §Results case rather than a correction.
- **`briefs/O2RING-PROTOCOL-2026-07-17-BRIEF.md`** §109–111 — the source of the 125.738 Hz calibration.
  Do **not** retract the measurement (it is a real fit over 2.6 M samples); add a header note that the
  constant cannot hold because the delivered rate varies per session, pointing at the host-axis fix.

## F5 · `trio-batch` prints an unclosed ppm, and none of it is gated

Deliberately left alone by owner decision during `WEARABLE-HOST-AXIS`, recorded here so it is not lost:
`printDriftFit` prints `${r.driftPpm} ppm` and converts it to a seconds-per-night claim with **no
knowledge of the closure verdict computed 20 lines below**, contradicting both drift briefs' §6
guardrail. `printDriftFit`/`printClockFit` have **zero test coverage** — every clock assertion in
`tests/dex-tests.js` targets `fitClockClosure`'s own unit group, none the trio wiring.

## F6 · Carry a slim beat array onto the fusion rec

Inherited from `WEARABLE-DRIFT-FIT` §5 and still open: `runFusion` drops `timeseries`, so beat times are
unreachable there and the drift/closure work cannot run inside the Integrator. Unchanged by this work.

## Done when

- [x] **F1 — Drawn-axis provenance computed and declared, not inferred** (2026-08-02). The proposed
      `first ns == 0` test was measured to NOT discriminate and was replaced by the modal-delta share;
      `quality.timingSource` now tells a clock consumer whether this recording may be used as a leg.
- [ ] Corpus re-run under the disciplined axis, with the Polar-pair-barely-moves check applied.
- [ ] Closure, TCH and PAT re-asked; each either re-confirmed on new numbers or retracted in place.
- [ ] `papers/` audited; `O2RING-PROTOCOL` annotated rather than retracted.
- [ ] No ppm quoted anywhere without a span and a closure beside it.
