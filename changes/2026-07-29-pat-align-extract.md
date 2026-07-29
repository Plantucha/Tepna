<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: []
brief: CROSS-DEVICE-CLOCK-SKEW-2026-07-29-BRIEF.md
---
Extracts the anchor-based inter-device aligner out of `pat-feasibility-worker.js` into **`pat-align.js`** — pure maths that was previously reachable only by loading a web worker, so no gate could execute it. `TEST-COVERAGE-FOLLOWUPS` §3 flags exactly this class: *"4 analysis kernels appear only in `.html` static lists, their math never executed"*.

**Behaviour-preserving, and proved so rather than asserted.** Both implementations were run over the same real H10 + Verity accelerometer pair from the reference corpus: on a 7.1 h overlap they agree **byte-identically** — 11 anchors, `offRange` 2752.53 ms — and on a degenerate 0.0 h overlap both refuse with the same reason.

Getting there caught a real semantic detail worth recording. A first version separated candidate-finding from correlation into two clean loops, and **changed the answer** (anchor count differed by one on that same night). In the original, the ≥3 s spacing counter advances only when an anchor's correlation *passes*, so a rejected candidate does not block the next one 3 s later. That coupling looks accidental but is the behaviour the PAT feasibility numbers were validated against, so it is reproduced exactly and documented. Improving it is a separate, deliberate change.

## Why this algorithm, and why it matters beyond PAT

Two devices on one body see the same movement at the same true instant — mechanically, with no pulse delay. But correlating their *whole* signals does not recover the offset, because most of a night is each sensor's own local noise. The original says it best: *"fixed windows drown a shared whole-body turn in decorrelated background."* So the correlation is spent only where there is information — strong isolated movements (> mean + 4σ, local maximum, ≥3 s apart), each cross-correlated in a tight window with **parabolic sub-bin refinement**.

That refinement is what makes it precise: on the synthetic gate it recovers planted offsets of −800 / −175 / 250 / 725 ms as **−799.67 / −175.14 / 250.18 / 724.63** — sub-millisecond, on a **50 ms** grid.

This is stage 2 of `CROSS-DEVICE-CLOCK-SKEW`. The event-coincidence detector shipped as stage 1 resolves 6 of 38 nights; it exists to hand this estimator a bounded prior instead of an unbounded ±90 min hunt. `lagAtAnchor` takes `lagBiasMs` precisely so that prior can centre the search.

## Coverage

New `pat-align` group, 16 assertions on a synthetic night of quiet background plus planted whole-body lurches, each device given its *own* independent background so only the shared movements can align: envelope gridding, one anchor per movement (not one per threshold crossing), zero offset on an aligned pair (−0.03 ms), four planted offsets recovered within 25 ms, a **sub-bin** case that is not a multiple of the grid, explicit refusals (too few anchors, missing envelope, too-short input) that never degrade to a silent 0, and a planted 100→700 ms **drift** surfacing as anchor spread rather than being flattened into a median.

Includes a **mutation control**: two devices sharing no movements must not align — without it the group would pass for an aligner that always returns something.

No bundle impact — `build --check` clean (11 owned), `verify-manifest` GATE A 9/9 + GATE B 13, `tsc` clean, `run-tests.mjs` **4315 green, 0 skipped** against the real corpus. The worker loads `pat-align.js` alongside the `pat-gate.js` it already loaded, so its dependency handling is unchanged.
