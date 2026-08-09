<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [MotionDex]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
A motiondex battery — 32 classifications recorded, 23 real gaps named, and three families held back because their controls did not separate.

Fourth file in `tools/mutate-equivalence.json` (clock 3 · ppgdex 41 · hrvdex 69 · motiondex 32 = 145).
Its sweep was already on disk (`.mutation-crawl/motiondex-dsp.js.sweep.json`, 466 tested / 171 killed
/ 8 invalid / 287 survivors), so no sweep was run.

⚠️ That sweep is `canary: NONE` — UNGUARDED — so the 37.3 % it implies stays a hypothesis. The
survivor LIST is still sound to probe: a mutant either survived or it did not, and the canary question
is whether the harness could see kills at all.

Sound families, controls all separating:

  respiratoryEffort  11/11 controls   31 survivors → 16 distinguishable, 15 recorded
  actigraphy          8/8  controls   12 survivors →  5 distinguishable,  7 recorded
  motionSQI           7/7  controls   12 survivors →  2 distinguishable, 10 recorded

Held back, with their survivors left UNCLASSIFIED rather than cleared:

  parseSensorXYZ    6/12 — the battery uses one `X [mg]` header, so the header-KIND arms (L184/L186)
                    and the G→mg conversion loop (L237–L239) never run. Needs `[g]` headers, MAGN/GYRO
                    kinds, and a headerless file.
  respiratoryRate  11/12 — `opts.biasBrpm` is never supplied as a non-number.
  genSyntheticACC   9/12 — the `pauseAt` arm and two gravity-axis coefficients are unexercised.

Four of the file's biggest survivor clusters are NOT exported — `inferAccUnit` (31),
`respWindowSpectrum` (17), `xyzPlausible` (15), `respResample` (14) — and are reachable only through
their callers. Families are declared on the CALLER so controls still come from the caller's own line
range; where a callee's lines fall outside it, those survivors stay unclassified rather than being
cleared by a battery that reaches them incidentally.

Survivors here are a LONG TAIL — 287 across 35 functions, largest cluster 11 % — which is ppgdex's
shape, not hrvdex's 50 %-in-one-function. No single battery moves it far, and this one does not
pretend to.

SECOND PASS — two of the three blind families were blind for a NAMEABLE reason, and naming it was
most of the fix:

  parseSensorXYZ    6/12 → 11/12   the stream KIND and unit come from the header, and one `X [mg]`
                                   header cannot exercise them. Twelve headers now: `[g]`, Gauss
                                   `[G]`, `µT`/`uT`, `dps`/`deg/s`, a MAGN name, no unit token,
                                   REORDERED columns, lower case, headerless, a second header
                                   mid-file, and a five-column line with no timestamp token.
  respiratoryRate  11/12 → 12/12   L880 guards `typeof opts.biasBrpm === 'number' && isFinite(…)`.
                                   Separating that needs biasBrpm as a NON-number ('2', null, {}) and
                                   as a non-finite number (NaN, Infinity) — a battery of sensible
                                   options never can. UNBLINDED: 14 survivors → 4 distinguishable,
                                   10 recorded.

Still blind, and both now diagnosed rather than merely reported:

  parseSensorXYZ   L239 `out[gi].x *= 100` — the Gauss→µT conversion. Supplying a `[G]` header is not
                   enough: measured, such a file parses to ZERO rows and `_unit` normalises to 'µT'
                   before `_unit === 'G'` is tested, so the loop never runs. Whether that is the
                   battery or the parser is the next question, and it is a real one.
  genSyntheticACC  3 controls — `pauseAt` cases were added and did not separate them; the two gravity
                   coefficients need an assertion on the generated VALUES, not on the CSV text.

motiondex total 42 recorded (32 + 10). Ledger: clock 3 · ppgdex 41 · hrvdex 69 · motiondex 42 = 155.
