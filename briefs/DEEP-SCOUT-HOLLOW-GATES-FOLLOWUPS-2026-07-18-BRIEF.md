<!--
  DEEP-SCOUT-HOLLOW-GATES-FOLLOWUPS-2026-07-18-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-07-31 · **Created:** 2026-07-18 · **Closed:** all three classes closed — §RN 7/7, §EP-rest 9/9, §AD 7/7 (21/21 gates), every one both-direction mutation-verified

# Deep-scout hollow gates — follow-ups (the residue that needs a HARNESS, not an assertion)

Follow-up to `DEEP-SCOUT-HOLLOW-GATES-2026-07-18-BRIEF.md` (house `-FOLLOWUPS` pattern). That wave +
its re-scout found **54** hollow gates and closed **33** with both-direction-verified assertions. The
remaining **21** are NOT one-line pins — each needs a piece of test infrastructure the node/corpus lane
does not yet have. This brief carries the three surviving classes.

## §RN — the render layer is never EXECUTED in the node lane (7 hollow gates) — **HARNESS BUILT; 3/7 DONE (PR #187)**

> **UPDATE 2026-07-18 — path (b) BUILT, the 3 HIGH gates CLOSED (PR #187).** The node-lane render-execution
> harness now loads every `*-render.js` into the existing DOM-stubbed `vm` realm (IIFE-isolated so their
> top-level `const {fmtDate,…} = window.X._bare` destructures don't collide with the shared realm; the
> `window/global` attaches still escape), plus `dex-escape.js` for `escapeHTML`, and maps `env.GluDisp` +
> `env.CpapRender` (`OxyDex`/`PulseDex.reviewView` were already exposed). The new group **'Render execution —
> surfaced-value known-answer (§RN harness)'** closes the **3 HIGH** findings by calling / driving the REAL
> render code (zero render source change), both-direction verified: `GluDisp.val(250)` mmol = **13.9**
> (÷→× → 4504.5); `reviewView` Mean-SpO₂ KPI 88→**bad**/93→**warn**/96→**ok** (a ≥85 cut paints hypoxic
> green); `renderReviewView` residual-AHI 40 → **"severe residual events"** (a <5→<50 → "well controlled").
> Node-lane only (browser runs render in iframe rigs → SKIPs). Suite 2967.
>
> **§RN WAVE 2 — 3 more closed (PR #191), §RN now 6/7.** The extraction path (ii) was taken for the three
> inline classifiers: hoisted to pure exposed functions used at their original call sites (behavior-identical
> → **compute-inert, PROVEN by the green equiv/GATE-C legs**), pinned both-direction: `PulseDex.tanakaHRmax`
> (208−0.7·age, the duplicated HRmax copy → 40:180 / 50:173; `0.7→0.9` reds), `hrvRmssdClass` (ok>35/warn>20/
> bad → 45:ok/28:warn/15:bad; `>35→>65` reds), `oxySpo2NightCV` (SD/mean·100 → (4.5,95):4.74; `·100→·10`
> reds). Re-bundled PulseDex/HRVDex/OxyDex (manifestHash moves, outputs unchanged — GATE A/B green; changeset
> `2026-07-18-render-harness-hoisted-classifiers`; **build-docs.mjs refresh of `docs/{HRVDex,OxyDex,PulseDex}
> .html` required** — the deploy drift guard reds otherwise). Suite 2983.
>
> **§RN COMPLETE 7/7 — 2026-07-31.** The last finding (ecgdex canvas minute-tick, `t/60` axis label, LOW)
> was deferred above as "pure `getContext('2d')` canvas draw with no value seam; not worth a canvas shim".
> **It never needed a shim.** The arithmetic was pure all along — only its LOCATION, between a
> `getContext('2d')` and a `fillText`, was untestable. `scopeAxisTick`/`scopeAxisLabel` are hoisted out of
> `ECGScope.draw()` and exposed, which is the **same extraction path (ii) this section already used three
> times** in wave 2 (`tanakaHRmax` · `hrvRmssdClass` · `oxySpo2NightCV`). Behaviour-identical, so
> compute-inert. 20 legs in `ecgdex-render · render-harness · known-answer`: all three label regimes
> (tenths / whole seconds / minutes), both label boundaries pinned on BOTH sides, the full tick ladder
> including its narrow 0.5 s middle rung, and a consistency leg asserting a 1 h view produces no duplicate
> labels — which is *why* the minute tick rounds up (600/8 = 75 s would print a repeated integer).
> Six mutations verified: the planted `t/60 → t/30`, both `> 120 → >= 120` boundaries, `> 12 → >= 12`,
> the `0.5 → 0.25` rung, and `ceil → round` on the minute tick.
>
> **A hole in the gate itself, found by mutating it.** The first draft's `> 120 → >= 120` mutation red
> NOTHING — because `scopeAxisTick` and `scopeAxisLabel` each carry their own `> 120` boundary, and every
> tick leg sat far from 120 while only the *label* boundary had a pair. A boundary is pinned only by legs
> on either side of it, per function. Fixed with a tick pair at 120/121; both mutations now red.

**[original analysis, retained]** `tests/run-tests.mjs` loads every `*-render.js` **only as raw text into `env.sources`** (verified in the
`wanted[]` block, ~lines 216–286): the render modules are parsed as strings for source-grep gates, but
**never evaluated as modules**. Consequence: **no value assertion can pin any surfaced render output** in
the node/corpus gate. The only render defects that lane catches are ones that alter a literal some
source-text grep happens to check (mmol edge labels, the `_GLU_MMOL` constant, badge-CSS parity,
null-safety regexes). The re-scout planted 7 defects across all 6 render modules — **all shipped green**,
including three severe surfaced-value breaks (a ~325× mmol glucose error, a hypoxic 88 % SpO₂ painted
green, "well controlled" text on a severe AHI 40). Full table in the parent brief §RN.

**This is a coverage-architecture gap, not 7 bugs.** Two ways to close it — pick one:

- **(a) Wire the browser render-coverage lane into the merge/CI gate.** `Dex-Test-Suite.html?full` already
  boots real app bundles in iframes and drives the renderers (CLAUDE.md §🧪); today it is **on-demand /
  lazy** and NOT part of the headless CI floor. The gap is that render assertions there must actually pin
  **surfaced values** (a wrong-unit glucose, a mis-colored KPI), not just "the rig booted". Requires a
  headless browser in CI (the lane currently SKIPs the directory-listing gates in Node).
- **(b) A node-lane render-execution harness.** Instantiate each render builder against a stub DOM
  (a minimal `document`/element shim) and pin the values it writes — e.g. `GluDisp.val(250)` in mmol mode
  == 13.9, the mean-SpO₂ KPI class at 88 % == `'bad'`, the residual-AHI band at 40 == `'severe'`. This
  keeps everything in the fast Node lane but is real shim work (the render modules touch `document`,
  canvas, and app globals). **Recommended** for the pure-value functions (unit conversions, threshold
  classifiers, hero-number math); leave genuine canvas/SVG drawing to lane (a).

Either way, once render output is executable-and-asserted, the 7 findings become ordinary both-direction
pins. Until then they are **real, shipped, and uncaught** — the highest-severity residue in the whole
wave (patient-facing wrong numbers), so this §RN is the priority.

## §EP-rest — ecg-ppg call-site tolerances + narrow-band — **6/9 DONE; 3 fixture-blocked**

From the parent §EP. **CLOSED:** PR #177 (ECG LF/HF 0.15 + ECG DFA 4..16), PR #193 (PPG DFA 4..16), PR #197
(**PRSA DC/AC + SampEn** — driven through the FULL `ECGDSP.analyze` on a deterministic `genSynthetic` ECG;
DC 7.35 / AC −7.16 seed 20260601, SampEn 0.562 seed 42 chosen because `0.2·SD` is tolerance-sensitive on
that segment — **values RE-PINNED 2026-07-28 to DC 9.62 / AC −10.26 / SampEn 1.03**, see the note
below), PR #198 (**PPG VLF/LF 0.04** — a clean 0.045 Hz tone over 800 beats resolves the band with no
leakage; the "narrow-band" deferral was wrong).

> **⚠ THE §EP-rest PINS MOVED 2026-07-28 — the FIXTURE was corrected, not the maths.**
> `REM-STAGING-REDESIGN` found that `genSynthetic`'s Mayer wave was an AR(1) low-pass stepped once per
> beat — a ~73 s time constant, i.e. **~0.014 Hz (VLF)** — while the comment above it claimed 0.1 Hz.
> The LF band was starved by construction and every stage measured LF/HF ≈ 0.1, ~20× below physiological.
> It is now a real 0.1 Hz oscillation, so the deterministic ECG these pins are driven through has changed:
>
> | | PR #197 | now |
> |---|---|---|
> | PRSA DC (seed 20260601) | 7.35 | **9.62** |
> | PRSA AC | −7.16 | **−10.26** |
> | SampEn (seed 42) | 0.562 | **1.03** |
>
> The pins keep their discriminative purpose, verified by mutation: a `/4 → /2` normalisation slip still
> fails DC and AC, and reverting the Mayer wave to 0.014 Hz fails all three — so they now guard the LF
> correction as well as the original slip. Recorded here because a brief stating a known-answer that no
> longer holds is the same failure class this wave exists to close: something that reads authoritative
> and is not.

**REMAINING (0) — §EP-rest is CLOSED 9/9 as of 2026-07-31.** What follows is the last bullet's history,
kept because the reason it was deferred turned out to be the interesting part:
- ~~**EDR respiration autocorr window `[2.5,10] s`**~~ — **CLOSED 2026-07-31.** The prescription in this
  bullet was right: patch `respHz0`. `genSynthetic` gained an **additive, optional `opts.respHz`** (default
  unchanged at 0.235 Hz, so every golden is byte-identical — gated by a leg asserting omit ≡ default), and
  both bounds are now pinned with independent mutation proof: **20/min** (3.00 s period) → 20.0, a
  `2.5→3.5` slip re-reads it **10.4**; **6/min** (10.0 s period, the upper edge) → 6.9, a `10→7` slip
  re-reads it **12**. Three seeds give identical values at both rates. Group `ecgdex-dsp · crc ·
  known-answer`.

  > **And the fixture found a defect in what it was measuring.** Sweeping the carrier 6→24 /min shows
  > `crc.respFromEDR` — an **exported** field — is trustworthy only over roughly **14–22 /min**: biased
  > high below it (8/min reads **11.4**, +43 %) and **period-doubled at 24/min**, where it reports
  > **12** — exactly half. Deterministic across seeds. Cause: `_bandResp` is a difference of moving
  > averages whose gentle roll-off attenuates a fundamental sitting at the 0.4 Hz edge until the second
  > harmonic wins, plus 0.25 s lag quantisation on the 4 Hz EDR grid. **The 2.5/10 s bounds are not the
  > defect.** Two legs now pin 24/min → 12 as an explicit **characterization, not endorsement**, so a fix
  > reds them deliberately. Routed to `ECGDEX-EDR-RESP-ACCURACY-2026-07-31-BRIEF.md`, which also flags the
  > untested consequence: `f0 = respFromEDR/60` centres `_narrowPhase`, so **CPC/PLV at 24/min is suspect
  > too**.
- ~~**composite per-beat SQI weights (`0.30·kSQI + …`)**~~ — **CLOSED 2026-07-31, and the prescription in
  this bullet was the wrong shape.** It asked for a *borderline-SQI waveform generator* — many beats
  coaxed to sit at ~0.3 — on the premise that "the weight only matters for beats near the SQI threshold".
  That premise is false. A weight is recoverable from ANY beat by **differencing**: hand `computeSQI` two
  beats identical except in one term, and the change in the composite IS that term's weight, wherever the
  beat sits. Differencing also cancels the kurtosis term, which is the only one awkward to set exactly —
  so nothing has to approach the threshold at all.

  `computeSQI` is now exposed additively (export-only, no call site change ⇒ compute-inert, and the
  ECGDex equiv leg proves it). All four weights are pinned **exactly**, each mutation-verified
  independently — every one of `0.30→0.50`, `0.28→0.40`, `0.24→0.10`, `0.18→0.30` reds the group:

  | term | how it is isolated | measured Δ |
  |---|---|---|
  | bSQI 0.28 | detector B confirms every beat vs none | **0.2800** |
  | rrPlaus 0.24 | a 2500 ms RR, outside the plausible [300, 2000] band | **0.2400** |
  | ampOK 0.18 | amplitude below 180 counts (dead lead) | **0.1800** |
  | ampOK's middle rung | amplitude above 6000 ⇒ 0.4, not 0 | **0.1080** = 0.18 × 0.6 |
  | kSQI 0.30 | by closure — a saturated beat scores exactly **1.000**, so the four sum to 1 | — |

  Group `ecgdex-dsp · sqi · known-answer`. It also pins the CONSEQUENCE, since the score gates
  `buildNN`'s `sqiThr` 0.3 and thus `analyzablePct`/`correctionRate`: losing bSQI + ampOK leaves
  **0.325** — analysable by 0.025 — and losing rrPlaus too drops it to **0.085**, excluded. That margin
  is exactly what was invisible while every synthetic beat sat at 1.0.
- ~~**PPG SampEn default tol `r = 0.2·SD`** (LOW)~~ — **CLOSED 2026-07-31. §EP-rest is now 9/9.** The
  bullet's blocker — "without a tolerance-sensitive synthetic found" — was looking for the wrong thing.
  A **default** is pinned by EQUALITY against the explicit argument, not by hunting a series whose score
  wobbles enough to surface: `sampEn(nn) ≡ sampEn(nn, 2, 0.2)` fixes BOTH defaults at once (the RHS names
  both), and `≠ sampEn(nn, 2, 0.15)` keeps the identity from passing vacuously. `sampEn` is exposed
  additively for it. Also pinned: the Richman–Moorman DIRECTION (0.15 → 1.78 > 0.2 → 1.49 > 0.25 → 1.26 —
  a tighter tolerance matches fewer templates, so entropy rises), that `m` is honoured, and the `N < 60`
  floor returning **null** rather than a fabricated score. Three mutations verified independently:
  `r 0.2→0.15`, `m 2→3`, and the floor `60→80` each red the group.
  Group `ppgdex-dsp · sampen · known-answer`.

Each is a bespoke synthetic-signal generator for a single MED/LOW gate — real diminishing returns versus
a slow-resp/borderline-SQI ECG fixture that would also serve other future coverage.

## §AD — adapters (7 hollow gates) — **5/7 DONE (PR #195 + the resmed Flow-fs default); no rig needed after all**

From the parent §AD. **The premise that this needed an off-suite rig was wrong for 4 of the 7** — they are
reachable through functions already co-loaded in the suite realm: `NSRR.edfToOxyRows({signals})` drives the
internal `to1Hz`, and `resmed-edf.groupSessionSets([names])` is a pure name-list function
(`env.SignalAdapters.byId('resmed-edf')`). **CLOSED (PR #195), both-direction verified:** to1Hz valid
window INCLUSIVE at the top (SpO₂ 100 % kept; `<=→<` → 95) and bottom (40 % kept; `>=→>` → 55) — the
existing legs used interior 95/96/98; the 1 Hz length FLOORs a partial trailing second (n=5/fs=2 → 2 rows;
`floor→ceil` → 3) — the existing legs used even n/fs; and the ResMed session window is INCLUSIVE at ±60 s
(two EVE/CSL streams 60 s apart → 1 set; `<=60→<60` → 2). Suite 2991.

**CLOSED (the resmed Flow-fs default), both-direction verified:** the adapter's frame `fs: (fl && fl.fs) || 25`
(`adapters/resmed-edf.js:241`) — its `|| 25` fallback was hollow because the existing frame leg drives a
`CD._synthEdfSet` Flow that CARRIES `fs=25`, so `|| 25 → || 50` stayed green. Reached with NO EDF buffer after
all: pass the pre-decoded set via `A.parse('', {edfSets:[set]})`, strip `fs` off the decoded Flow
(`env.CpapDsp.chan(set.BRP,'Flow').fs = undefined`, mirroring how the adapter resolves `chan` at
`resmed-edf.js:164`), and the surfaced `frame.fs` can come ONLY from the default → the `|| 50` mutation reds
exactly the new leg while the fs-present leg stays green (`adapters · resmed-edf · cpap`, group now 26).

**REMAINING §AD (0) — BOTH items CLOSED 2026-07-31; the ODI-4 × 1.1 one found three things this brief
did not know:**

- ~~`nsrr-adapter` ODI-4 × **1.1** AHI surrogate~~ — **CLOSED, see §AD-1 below.**
- ~~the seeded-fallback-baseline branch~~ — **CLOSED 2026-07-31. §AD is now 7/7.** "Partly covered" was
  the right diagnosis and it named the wrong half as sufficient: `firstValid = validLo === 40 ? 97 : 60`
  has TWO arms, and finding #97 pins only the SpO₂ one. The **HR arm** (60 bpm, reached with `validLo`
  20) had no leg, so a `97 : 60 → 97 : 0` slip — or the two arms being swapped — would seed an impossible
  pulse on a junk HR channel unseen, and the SpO₂ leg could never catch it because it never takes that
  arm. Now pinned with two controls proving the arms are independent rather than coincident (a junk pulse
  must seed 60 and NOT 97, and a good SpO₂ beside it is untouched). Mutation-verified: `60 → 0` reds.

### §AD-1 · the ODI-4 × 1.1 surrogate — CLOSED 2026-07-31, and what it uncovered

**The fixture was cheap, not "genuinely fixture-heavy".** EDF is a 256-byte header + field-major signal
headers + int16 LE data records; a ~50-line writer builds a two-channel (SpO₂ + Pulse) buffer in memory
and the SHIPPED `CpapEdf.readEDF` accepts it. Test-only, so no bundle and no `manifestHash` moves. The
deferral cost more than the work would have.

Three corrections to this brief's own account, in ascending order of seriousness:

**1. The gated constant was in the wrong file, and the one named was dead.** `nsrr-adapter.js` carried
`+(out.odi4 * 1.1).toFixed(1)` as a *fallback*, under the comment *"raw processNight doesn't attach
ahiEst (summary/JSONL paths do)"*. That comment was **false** — `computeAHIestimates` runs inside
`processNight` and attaches `ahiEst` whenever an ODI-4 exists — so the first branch always won and the
mirrored constant was unreachable. Proven by mutation: changing that local `1.1` to `1.5` moved **no**
surfaced value. It has been **deleted**, not gated; gating a dead constant would have been a hollow gate
about a hollow gate. The live constant is `oxydex-dsp.js` `computeAHIestimates`
(`ahiODI4 = +(odi4Rate * 1.1).toFixed(1)`), which had **no known-answer test anywhere in the suite**, and
now has one — verified by mutation (`1.1 → 1.5` reds three legs and flips the surfaced severity band
mild → mod).

**2. The function under test could never have run — `NSRR.analyzeRecord` was DEAD IN PRODUCTION.**
`ESM-MIGRATION-FOLLOWUPS-II` removed `oxydex-dsp`'s `Object.assign(root, BARE)` back-compat spray, so all
**132** `OxyDex._bare` helpers stopped resolving as bare identifiers in every realm. `cohort-worker.js`
was migrated at the time; `nsrr-adapter.js` was not, so its `typeof processNight !== 'function'` guard
had been TRUE ever since and `analyzeRecord` returned `err:'OxyDex not loaded'` **before reading a byte
of the EDF**. `odi-bias-analysis.js` had the same defect at four call sites (`parseCSV` ×2,
`processNight` ×2), where it was worse: both sit inside `try { … } catch { /* skip */ }`, so a
ReferenceError read as *"that night had no usable data"* and the page silently analysed nothing.
Verified not by reading but by **reconstructing the page's realm** (same files, same order, no
`__DEX_NAMESPACED__`) and executing it. Both files now resolve off the namespace, and
`odi-bias-analysis.js` **throws** rather than swallowing an absent helper.

**3. So the residue needed a CLASS gate, not two pins.** A known-answer leg on one call site would not
have protected the other, and neither file's *text* was in `env.sources` in either lane, so no source
scan could see them either. Both are now loaded in both runners, and a new group asserts the real
invariant: *every bare call to a distinctive `OxyDex._bare` helper must have a local namespace binding in
the same file*. Mutation-verified (deleting one binding reds it). The name list is deliberately the
distinctive entry points only — `avg`/`pad`/`fmtDate` are also in `_bare` but are ordinary identifiers
repo-wide, and a scan that cries wolf is a scan that gets deleted.

**Gated by:** `nsrr-adapter · ingest · known-answer` (17 legs — EDF round-trip through the shipped reader,
ODI-4 **predicted** at 12.0/h from 12 engineered −7 % ramps in exactly 1 h, the ×1.1 surrogate, the
severity band, plus two controls) and `nsrr-adapter · oxydex-dsp · source-scan` (5 legs, incl. a
non-vacuity check that the source text actually arrived — the exact failure this group punishes).

> **A note on the fixture, because it is the whole method.** The first draft used 12 SQUARE-edged 7 %
> drops and got ODI-4 **0**, with `odi4.artifactExcluded: 12`. The detector was right and the fixture was
> wrong: a real systemic desaturation falls over tens of seconds (`SELFGATE.FALL_RATE_MAX` 1.5 %/s), so a
> 7 %/s step is a probe squeeze. The second draft ramped the edges but still read 0 — because an
> SpO₂-only EDF yields `hr = 0` on every row and `SELFGATE`'s perfusion check correctly rejects a
> desaturation with no pulse. Only a physiological shape **and** a pulse channel gives 12.0. Both wrong
> drafts are now **committed as controls**: the square-edged night (ODI-4 0 off the same 12 events —
> shape is the only difference) proves the leg is not counting wiggles.

### §AD-1a · SPAWNED — the paper's Table 1 no longer reproduces

Restoring `odi-bias-analysis.js` means its SubjectA path RUNS again — and it does not reproduce the
numbers in `papers/odi4-ahi-bias.html` Table 1, whose stated recipe is *"open `odi-bias-analysis.html` →
Run SubjectA corpus"*:

| night | ODI-4 today | published "after" | reference AHI |
|---|---|---|---|
| 1 | 5.6 | 12.0 | 22 |
| 2 | **1.4** | **14.9** | 38 |
| 3 | 1.5 | 1.9 | 7 |
| 4 | 0.5 | 0.8 | 4 |
| 5 | 0.8 | 0.8 | 3 |

The harness is **controlled**: the same realm reproduces the committed, GATE-B-verified
`OxyDex_2026-06-13_1056_summary.json` at `odi4.rate` **1.9** exactly. So the discrepancy is real and not
an artifact of running outside the page.

**What is NOT established:** the cause. Night 2 moving 14.9 → 1.4 is an order of magnitude, which no
baseline change plausibly explains, so the likelier candidate is that the **gitignored**
`uploads/synthetic/` corpus was regenerated by a changed `synth-gen` and is no longer the input the paper
used — but that is an inference, not a finding, and detector drift is not excluded. Resolving it needs
the corpus provenance pinned, which is its own work-unit:
`PAPER-ODI4-REPRODUCIBILITY-2026-07-31-BRIEF.md`. **The published numbers are not asserted to be wrong
here** — they were computed when the path worked. What is certain is that the paper's reproduction recipe
silently produced an empty table for as long as the bare-global defect stood.

## Done when

§RN is closed by whichever lane (a)/(b) is chosen AND its 7 findings become asserted pins; §EP-rest and
§AD each have their harness + both-direction pins (or are explicitly dispositioned). Each lands as its own
gated PR. When all three classes are closed, flip the parent brief to `DONE`.

### Status 2026-07-31 — 21 of 21 gates closed; brief CLOSED

| class | state |
|---|---|
| **§RN** | **7/7 — CLOSED** |
| **§EP-rest** | **9/9 — CLOSED** |
| **§AD** | **7/7 — CLOSED** |

The Done-when is met on its own strict terms: §RN's seven findings are **asserted pins**, not
dispositions. An earlier revision of this section held the brief at `PROPOSED` precisely because the
seventh was still a disposition, and named option **(b) — hoist the axis arithmetic and pin that** — as
the cheap close. That is what shipped, so the header now flips honestly rather than by waiver.

**A note on the FIVE deferrals this brief made, since every one was re-opened and none held:**

| deferred as | actually was |
|---|---|
| §AD ODI-4 × 1.1 — *"genuinely fixture-heavy"* | a ~50-line in-memory EDF writer the shipped reader accepts — and the constant it named was **dead code**, while the live one had no test at all |
| §EP-rest EDR window — *"needs a slow-respiration ECG synthesizer"* | one additive optional parameter, on the route **this brief itself named** |
| §EP-rest SQI weights — *"needs a borderline-SQI waveform generator"* | unnecessary: **differencing** recovers a weight from any beat, so nothing had to sit near the threshold |
| §EP-rest SampEn tolerance — *"without a tolerance-sensitive synthetic found"* | unnecessary: a **default** is pinned by equality against the explicit argument |
| §RN canvas minute-tick — *"no value seam; not worth a canvas shim"* | no shim needed — the arithmetic was pure, only its LOCATION was untestable; the extraction path this very section used three times |

Four of the five were blocked on a fixture that did not need building; the fifth on one the brief had
already described. The pattern is worth carrying forward: **a recorded deferral is a hypothesis about
cost, not a finding** — re-derive it before inheriting it. Two of these re-derivations also turned up
defects (`NSRR.analyzeRecord` dead in production; `crc.respFromEDR` halving at 24/min) that only appeared
because something finally executed the path.
