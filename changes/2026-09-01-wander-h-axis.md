<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
brief: PPG-FOOT-PLACEMENT-FOLLOWUPS-2026-09-01-BRIEF.md
---
The slow-wander seed, measured under a frozen, peer-reviewed pre-registration: H_axis fails
confirmation, one night is axis-explained, two carry real wander parked at the declared boundary —
and piecewise host-disciplining the ECG train is measured DEAD as a next step.

**The design:** Osprey-reviewed and committed before any number. Triage had found the oracle's two
trains ride different axis disciplines (PPG piecewise `relSec`; ECG single-rate `fs` — while
`geometry-scan`/`geometry-passthrough`/`pat-axis-leg-audit` already consume the DSP's piecewise
`tMsAt`, the third half-wired instance this campaign). H_axis: #2044's halves shifts
(−80/−120/+100/+150 ms) are that piecewise-minus-linear residual.

**P1** (anchors only, `pat-ecg-axis-residual.mjs`): predictions −84.2/−4.6/+0.1/−2.6 ms — 07-24
matches at 4.2 ms with the right sign, the rest miss by 100–153 ms: 1/4, fails ≥3/4. (The tool's
first commit had the frozen text's sign NEGATED; caught against the frozen wording, fixed, re-run,
reported.) **P2** (`pat-window-oracle --ecg-axis piecewise`): 0/3 collapse; strict refutation
(≥80 on ≥2) also unmet; whole-night modes deviate +40/+60 on two nights and narrowSD DEGRADES
(15.3→49.7, 18.0→24.2) — the frozen collapse-floor assumption (the two piecewise corrections agree
to ~30 ms) is FALSE on this corpus. 08-18 is an annotated exclusion: its 8.6 s mid-file step (the
H10 sync class) breaks the piecewise train's sortedness at beat 6015 — condition (c) landing
exactly where it said a step would (the first run swallowed the night silently; the oracle now
prints the exclusion).

**So:** 08-12/08-17's shifts are real non-axis wander (physiology / common-mode detector /
host-anchor structure — the pre-declared PARKED branch, reached and stamped); any reopening starts
from a new pre-registration with an instrument that sees one parked term independently.

**Tooling (additive):** `ecgRpeakTimes` grows `opts.axis='piecewise'` (tMsAt, sortedness asserted,
tMsCorrected/independent/maxStepMs forwarded; omitted = byte-identical), the oracle grows
`--ecg-axis linear|piecewise` with annotated refusals and per-row maxStep, and
`pat-ecg-axis-residual.mjs` carries P1 with analytic-plant selftests. No bundle code moves.
