<!--
  DEEP-AUDIT-IV-2026-08-04-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS — 2026-08-15 (**§1 EXECUTED elsewhere** as #956, verified in the tree; **§2 EXECUTED 2026-08-15**. Punch-list item 2 — the alternation cross-check — **RUN 2026-08-16: 2 of 5 nights measured, both FULL ACC (negative); 3 blocked on raw data absent from all four corpus trees. Also corrects the count: FIVE alternation nights, not six** (§7.2-RUN). ⚠️ **That absence was WRONG — re-checked 2026-08-20 (§7.2-RUN-II): two of the three are on the box, fragmented across link reconnects AND across the date directory. 4 of 5 now measured, ALL NEGATIVE including the highest-ratio night; only 2026-08-08 is genuinely absent. ✅ **Item 2 RETIRED on that evidence — owner decision 2026-08-21**; the unmeasured 2026-08-08 (ratio 1.17) is named, not swept.** §3 remain leads — both surviving ones MEASURED 2026-08-20 (§3-RESULT): unreachable on the corpus (0 of 3,155 fusable events lack `conf`; 54 of 54 hrv blocks non-zero), and the `|| 0` shape is a **3-site fleet pattern** including a user-facing OxyDex card) · **Created:** 2026-08-04 · **Charter:** `AUDIT-PROMPT.md` · **Follows:** `DEEP-AUDIT-III-2026-07-26-BRIEF.md` (DONE 2026-07-29) · `DEEP-AUDIT-III-FOLLOWUPS-II-2026-07-29-BRIEF.md` (DONE 2026-07-31)

# Deep audit IV — the fifth instance of 3a, in the file the 3a fix shipped in yesterday

A single-auditor `AUDIT-PROMPT.md` pass, headless (`node:vm`) only. **Two findings, both reproduced by
execution**; one mis-states a headline KPI, one is a gate that cannot see. The headline finding is the
**unfixed sibling of a fix that landed 2026-08-03** — same file, twenty-five lines apart, one gate
carrying an explicit `§3a` comment and its neighbour carrying the defect that comment describes.

**Baseline established before touching anything:** `npm run test:par` — **5782 assertions passed, 12
skipped, 385 groups, exit 0**. The 12 skips are the corpus-backed equivalence legs (`uploads/` raw
recordings are gitignored; this is a worktree). Neither gate was red, so there is no finding #1.

---

## 1 · PpgDex publishes a "low-motion" robust HRV built from epochs where the accelerometer was off

**Severity: TOP — mis-states a surfaced number, by fabricating absence (charter class 3a + class 14).**

### 1.1 Symptom

`ppgdex-dsp.js:2873` selects the epochs that feed every *robust* HRV metric:

```js
const gatedEp = epochs.filter((e) =>
  e.sdnn != null && isFinite(e.sdnn) &&
  (e.motionIndex == null || e.motionIndex <= 0.5) &&          // ← admits "not measured" as "still"
  (e.ledAgreementPct == null || e.ledAgreementPct >= 67));
```

Its own comment one line above says *"keep epochs that are low-motion AND (single-channel OR ≥2/3 LED
agreement)"*. The LED half's `== null` exemption is deliberate and documented (a single-channel session
has no agreement to report). **The motion half's is not.** `motionIndex` is `null` for exactly one
reason — `ppgdex-dsp.js:2536-2539` sets it only from beats the inertial stream actually **covered**, so
`null` means *the accelerometer was not recording during this epoch*. Those epochs enter the pool as if
they had been verified still.

### 1.2 Reproduction (executed — `node:vm`, real modules, deterministic)

A 40-minute synthetic Verity capture at 176 Hz, RR SD 20 ms for the first 25 min and 80 ms after, with a
companion ACC stream that **covers only the first 25 minutes** (low motion 0–15 min, saturated motion
15–25 min, nothing after). This is the same shape as the fixture the shipped §3a gate already uses —
*"a 60-min session whose ACC stops at 30 min"* — and it is an ordinary Verity night: the inertial stream
routinely ends before the optical one.

```
epochs: 8
  tMin=  0  motionIndex=0.01   sdnn=15.8
  tMin=  5  motionIndex=0.01   sdnn=16.8
  tMin= 10  motionIndex=0.01   sdnn=15.8
  tMin= 15  motionIndex=1      sdnn=16.8      ← verified moving, correctly excluded
  tMin= 20  motionIndex=1      sdnn=14.7      ← verified moving, correctly excluded
  tMin= 25  motionIndex=null   sdnn=61.1      ← ACC OFF — admitted as "low motion"
  tMin= 30  motionIndex=null   sdnn=66.3      ← ACC OFF — admitted as "low motion"
  tMin= 35  motionIndex=null   sdnn=69        ← ACC OFF — admitted as "low motion"

sdnnRobust        = 39      sdnnRobustNEpochs = 6
hfRobust          = 932     hfRobustLowMotion = 115

SHIPPED gate keeps 6 epochs → median sdnn 39.0
HONEST  gate keeps 3 epochs → median sdnn 15.8
```

**`sdnnRobust` reads 39 ms where the verified-still epochs say 15.8 ms — 2.5× — and the entire excess
comes from epochs no motion sensor ever observed.** The `hfRobust` / `hfRobustLowMotion` pair in the
same run is the finding stated twice: **932 vs 115**, an 8× split between the gate that was fixed and
the gate that was not, on identical input.

The script is in **§8 (appendix)** — deliberately inlined rather than left in `/tmp`, so the finding
stays reproducible after this session. It loads `kernel-constants.js` · `clock.js` · `dex-export.js` ·
`ppgdex-dsp.js` through `DexBuild.classicify` into one realm and calls the real `parsePPG` → `analyze`;
no fixture, no corpus, no network. Fold it into `tests/dex-tests.js` as the gate — see §1.5.

### 1.3 Root cause, and why five audits and a same-file fix all missed it

`MULTI-SENSOR-DERIVATIONS-FOLLOWUPS-2026-07-18-BRIEF.md` §1 enumerated **four** instances of class 3a in
`ppgdex-dsp.js` and fixed all four (`motionAtSec`'s coverage grid, `qLowMotion`, `qPosture`,
`magInterference`), shipping 2026-08-03 as `changes/2026-08-03-ppgdex-inertial-gap-not-stillness.md`.
All four live in the **confidence block**. `gatedEp` — which feeds the *published metrics* rather than
their confidence grades — is a fifth instance and was not enumerated.

The reason it survived is precise and worth recording, because it will recur:

> That brief measured on the **committed twins, neither of which carries ACC**. In the
> **no-ACC-at-all** case this defect is invisible *by construction*: every epoch is `null`, the shipped
> gate keeps all of them, the honest gate keeps none, `< 3` trips the fallback to the ungated median —
> **and both paths return the identical number.** The defect exists only under **partial** coverage,
> which no committed fixture can express.

This is the charter's own warning about the equiv fixtures being short clips, reached from a new
direction: not "the clip is too short to trip the branch" but "the fixture is too *degenerate* to
distinguish the branch from its fix."

### 1.4 Blast radius

Every metric drawn from `usable` at `ppgdex-dsp.js:2874-2891`:

| metric | surfaced where |
|---|---|
| `sdnnRobust` | **the PpgDex SDNN headline KPI** — `ppgdex-app.js:405-407` and `:715-718`, labelled *"robust · per-5-min median"* |
| `sd2Robust`, `lfRobust`, `hfRobust`, `vlfRobust`, `tpRobust`, `lfhfRobust` | node export + HRV surfaces (`ppgdex-app.js:984-986`) |
| `sdnnRobustNEpochs` | the count that makes the above auditable |

It does not stop at the node. `integrator-dsp.js:519` lifts `hrv.time.sdnnRobust` into
`summary.sdnnRobustMs`, and `:2832-2837` **prefers it over `sdnn`** as *"the cross-node-comparable
SDNN"* for the fused HRV wave — so a PpgDex night with a truncated ACC stream carries the error into the
Integrator's cross-node consensus, where it presents as a real between-device divergence. (Note the
irony: `DEEP-AUDIT-2026-07-22` fixed the Integrator to stop comparing PpgDex on the wander-inflated
whole-record `sdnn` *and to use `sdnnRobust` instead*. This finding is a defect in the axis that fix
routed everything onto.)

**Directional consequence — hypothesis, now PARTLY TESTED (see §7.2-RUN, 2026-08-16):**
`Dv.hrvShapeViolates(rmssd, sdnnRobust)` (`tests/dex-tests.js:8233`) is the shipped detector for the PPG
beat-alternation artifact, and it fires on `rmssd > sdnnRobust`. Inflating `sdnnRobust` moves that
comparison toward *not* firing, so on a partial-ACC night this defect can **suppress a known quality
flag**.

Run against the corpus 2026-08-16. **There are FIVE such nights, not six** — the shipped
`shapeViolation` flag and an independent recomputation agree exactly on the same five. Two of them have
raw data that pairs to the export second-for-second, and **both have FULL ACC coverage**, including
2026-08-07, the strongest alternation in the corpus (ratio 1.27). The remaining three cannot be
answered: their source recordings are absent from all four trees in `docs/CORPUS-LOCATIONS.md`, leaving
only same-named fragments (one is 2 seconds long). **Evidence against the hypothesis on the nights that
can be asked; not a refutation.**

### 1.5 Fix sketch

1. **`ppgdex-dsp.js:2873`** — `(e.motionIndex != null && e.motionIndex <= 0.5)`. One operator; it makes
   the gate match the comment it already carries and match its fixed sibling at `:2902`.
2. **Do not stop there — the fallback needs a name.** With the null epochs excluded, a partial-ACC night
   will more often land under the `< 3` threshold and silently fall back to the **ungated** median,
   which is a different number wearing the same field name. Publish the basis alongside it
   (`sdnnRobustBasis: 'gated' | 'ungated-fallback'`), exactly as `apnea.overlapCoverage.basis`
   (`'recorded'`/`'envelope'`) already does for `overlapHours` — the in-repo precedent for "publish the
   coverage you used." Without this, the fix trades a wrong number for an unattributable one.
3. **Gate it** with the §1.2 fixture — a *partial*-coverage twin, since neither committed twin can
   distinguish the branches. Assert by **value** (`sdnnRobust` 39 → 15.8), not by API shape; verify RED
   against the pre-fix DSP.

**Gate cost.** `*-dsp.js` edit → re-bundle PpgDex (`node tools/build.mjs --app PpgDex`) → GATE A
`manifestHash` moves and **`computeHash` moves** (the DSP is inside the compute closure), so
export-inertness may **not** be asserted — it must be computed. The committed twins carry no ACC, so by
§1.3's own argument their exports are unchanged; the **corpus-backed `ppgdex` equiv fixture** may move if
that recording has a companion ACC that ends early — check it, and if it moved regenerate via
`tools/regen-ppgdex-goldens.mjs` (never hand-edit). Then `DEX_UPLOADS=<corpus> node
tools/verify-fixtures.mjs` to re-stamp `verifiedUnder`, then `npm run check`.

---

## 2 · The Clock-Contract lint's allow-list is keyed by FILENAME, so a whole DSP is exempt

**Severity: gate blindness — no wrong number today; the rule is unenforced across one of the largest DSPs.**

### 2.1 Symptom

`tests/dex-tests.js:13905-13917` — the A1 house lint that enforces Clock Contract §5 (*read a floating
`tMs` back only via `getUTC*`*):

```js
var GETTER_ALLOW = { 'glucodex-dsp.js': 'synthetic-gen date-anchor …' };
...
if (GETTER_RE.test(t) && !GETTER_ALLOW[f]) getterHits.push(f);
```

The allow-list entry is a **file** key, and the test is `!GETTER_ALLOW[f]` — so the presence of one
known-benign getter at `glucodex-dsp.js:1535` (a synthetic-generator date anchor) exempts **every line
of the file** from the rule, permanently. The assertion still reports *"clean across N files
(glucodex-dsp.js allow-listed w/ reason)"*, which reads as a scoped exemption and is a whole-file one.

`glucodex-dsp.js` is not an idle file: it computes `daypart`, `dawn`, `nocturnalHypo`, `hourly` and
`daily` — all of them wall-clock reasoning over floating `tMs`, and all of them exactly what §5 exists
to protect. A viewer-timezone-dependent CGM overnight-hypo window is the defect this lint is for.

### 2.2 Reproduction (executed)

Injected one line into `glucodex-dsp.js` — a fresh, unrelated, non-UTC civil getter:

```js
function _auditProbeCivilHour(ms) { return new Date(ms).getHours(); }
```

`node tests/run-tests.mjs --group=clock` → **`✓ all 666 assertions passed · 1 skipped (44 groups)`**.
The A1 lint — the only gate for this rule — stays green on a textbook violation. File restored; tree clean.

### 2.3 Fix sketch

Narrow the exemption from the file to the **occurrence**. Either (a) allow-list the specific line's text
(`'new Date(t0).getFullYear()'` etc.) and flag any *other* match in that file, or (b) count matches and
assert the count equals the allow-listed number, or (c) preferred — **retire the exemption**: convert
`glucodex-dsp.js:1534-1535` to `getUTC*`. The allow-list's own note already says to do this *"on the
next GlucoDex on-touch re-bundle"*, and the code is the synthetic generator, so the conversion is
behaviour-preserving for real input. (c) removes the blind spot instead of shrinking it.

**Gate cost.** (a)/(b) are test-layer only — no re-bundle, no fixture, no provenance movement. (c) edits
a `*-dsp.js` and therefore re-bundles GlucoDex with the full §🔏 cost; take it on the next GlucoDex
touch rather than alone, and take (a)/(b) now so the gate is not blind in the meantime.

---

## 1-RESULT · EXECUTED ELSEWHERE — #956, verified in the tree 2026-08-15

`ppgdex-dsp.js` now reads `e.motionIndex != null && e.motionIndex <= 0.5` — the `== null` exemption that
admitted "the accelerometer was not recording" as "verified still" is gone. **§1.5's second instruction
was followed too**, which is the part that could have been skipped: `sdnnRobustBasis` is published
(`'gated'` / `'ungated-fallback'`), with a comment making §1.5's own argument — excluding the null
epochs pushes a partial-ACC night under the `< 3` threshold more often, so the export has to name which
quantity produced the number rather than trade a wrong one for an unattributable one.

Landed as `8e958e28` — *fix(ppgdex): the robust-HRV gate counts only epochs the ACC actually observed*
(#956). Recorded here because a finding that is fixed by someone else is still a finding this brief must
close; leaving it open is how the same line gets audited a sixth time.

## 2-RESULT · EXECUTED 2026-08-15 — the exemption is now per OCCURRENCE

Punch-list item 3, and it was still live: `GETTER_ALLOW` was keyed by **filename** and tested as
`!GETTER_ALLOW[f]`, so one known-benign getter exempted **every line** of `glucodex-dsp.js` — a file that
computes `daypart`, `dawn`, `nocturnalHypo`, `hourly` and `daily`, which is exactly the wall-clock
reasoning Clock Contract §5 exists to protect. The assertion printed *"clean across N files
(glucodex-dsp.js allow-listed w/ reason)"*, which reads scoped and was total.

**Measured before changing anything:** the file has exactly **3** matches, all on `:1535`
(`Date.UTC(d0.getFullYear(), d0.getMonth(), d0.getDate())`) — the documented synthetic-generator anchor.
So the allow-list now names those three occurrences and the file's match multiset must equal them.

Two properties, and the second is the one that keeps it honest:

1. a **new** getter reds, because it is not in the list — this is the audit's own probe
   (`new Date(ms).getHours()`), which previously left the group **green**;
2. if the exempted line is ever converted to `getUTC*`, the multiset no longer matches and this **also**
   reds — so a stale exemption cannot outlive its reason, which is precisely how the whole-file blind
   spot arose in the first place.

Both verified by re-applying each case; the tree was confirmed restored afterwards. Test-layer only —
no re-bundle, no fixture, no provenance movement, exactly as §2.3 predicted. The `getUTC*` conversion
(option (c)) still rides the next GlucoDex on-touch re-bundle; narrowing the gate does not consume it.

## 7.2-RESULT · The alternation cross-check is still OPEN, and now says what it needs

Punch-list item 2 asks whether any of the six real `rmssd > sdnnRobust` alternation nights had partial
ACC coverage — which would raise §1 from "wrong number" to "suppressed quality warning". It **cannot be
answered from the committed exports**, and that is worth recording so the next reader does not try:

- `uploads/trio/*/PpgDex_*.node-export.json` predate #956 — they carry neither `sdnnRobustBasis` nor
  `sdnnRobustNEpochs`;
- `quality` carries `motionRejectedPct` but **no motion-COVERAGE field**, so "the ACC was off" and "the
  ACC saw movement" are not separable from the export alone.

So it needs a corpus re-run pairing each PpgDex night with its ACC stream, not a scan. It is a
retrospective question now that §1 is fixed — it changes the record, not the code — which is why it is
recorded rather than blocking this brief.

### 7.2-RUN · Executed 2026-08-16 — **2 of 5 answered, both NEGATIVE; 3 blocked on absent raw data**

**First correction: there are FIVE alternation nights, not six.** The "six" was asserted here and in
several other briefs without a list. Across all 51 committed `uploads/trio/*/PpgDex_*.node-export.json`,
the shipped detector's own `hrv.time.shapeViolation` flag is set on exactly **5**, and an independent
recomputation of `rmssd > sdnnRobust` from the same exports returns the **same 5** — the two agree
exactly, so this is not a threshold artefact:

| night | rmssd | sdnnRobust | ratio | `timingSource` |
|---|---|---|---|---|
| 2026-07-01 | 66.5 | 61.2 | 1.09 | `device` (phone) |
| 2026-08-04 | 82.2 | 75.6 | 1.09 | `device+host` (box) |
| 2026-08-06 | 74.1 | 68.1 | 1.09 | `device+host` |
| 2026-08-07 | 112.6 | 89.0 | 1.27 | `device+host` |
| 2026-08-08 | 100.2 | 85.7 | 1.17 | `device+host` |

**Two nights have raw data that pairs to the export exactly, and both have FULL ACC coverage:**

- **2026-07-01** — PSL tree, under `Polar_Sense_*` naming (not `Polar_VeritySense_*`, which is why an
  earlier glob found nothing). PPG `21:43:40 → 04:55:29`, ACC `21:43:48 → 04:55:28`; the export's span
  is `durSec 25909.5` = the same 7.20 h. ACC covers all but the first 8 s, at 25.8 Hz effective against
  a ~26 Hz phone nominal — no interior gap large enough to matter.
- **2026-08-07** — `vigil:/srv/tepna/captures`. PPG `21:50:54 → 06:51:42` (9.01 h, 1 788 881 rows,
  55.1 Hz), ACC `21:50:52 → 06:51:41` (1 677 101 rows, 51.7 Hz vs 52 Hz nominal). The ACC starts two
  seconds **before** the PPG. Export `durSec 32448.38` matches the PPG span to the second.

**So on both nights where the question can be asked, the answer is no: the ACC was on for the whole
recording, so §1's defect could not have suppressed the flag there.** That is evidence against the
hypothesis, not a refutation of it — see below.

**Three nights cannot be answered, and the reason is missing raw data rather than missing method:**

| night | export span | what the trees actually hold |
|---|---|---|
| 2026-08-04 | 8.17 h from 22:49:42 | vigil + smoketest both hold only a **0.49 h fragment** starting 04:48 |
| 2026-08-06 | 9.39 h from 20:54:30 | vigil holds **2 seconds** (129 PPG rows) |
| 2026-08-08 | 6.45 h from 00:33:34 | Verity PPG and ACC **absent** on vigil |

⚠️ **The fragments are the trap here.** Each of those directories exists and is named for the right
date, so a coverage check run without comparing spans would have read the 2-second capture as a night
and reported "full ACC coverage, 53.1 Hz" — a clean-looking answer about the wrong recording. The
pairing test (export `durSec` ≡ raw span) is what separates them, and it is the step to keep if anyone
re-runs this.

### 7.2-RUN-II · Re-checked 2026-08-20 — **the data was NOT absent. 4 of 5 now measured, all NEGATIVE.**

Two of the three "blocked" nights are on the box after all. The run above is sound in method and its
two measurements stand; the absence conclusion does not. **A night is not a file, and a night is not a
date.** Two independent indexing assumptions each truncated the search:

1. **The Verity link drops, and the capture host opens a NEW FILE per reconnect.** A night is the
   *union* of fragments. 7.2-RUN's pairing test (export `durSec` ≡ raw span) is the right test and is
   why it did not accept a fragment — but applied *per file* it rejects a real night as absent. The
   "2 seconds / 129 PPG rows" reported for 2026-08-06 is `…_20260806064732_PPG.txt`, a stub from the
   *previous morning's* session; that night's actual first fragment is `…_20260806205425_PPG.txt`.
2. **A night crosses the date directory.** Directories are named for session start, so the tail of the
   2026-08-04 night lives in `/srv/tepna/captures/**2026-08-05**/`. A per-date glob truncates it — which
   is why 08-04 still looked 14 min short even after the fragments were unioned.

**2026-08-06 — pairs EXACTLY.** Export `startEpochMs` 20:54:30, `durSec` 33787.637 (9.385 h) → ends
06:17:38. Fragments tile `20:54:30 → 22:03:30 · 22:04:13 → 22:05:06 · 22:05:37 → 22:47:36 ·
22:48:16 → 23:26:06 · 23:26:42 → 06:17:38`. Union = **20:54:30 → 06:17:38**, to the second.

**2026-08-04 — pairs EXACTLY once the day boundary is crossed.** Export 22:49:42, `durSec` 29409.248
(8.169 h) → ends **06:59:51**. Fragments `22:49:42 → 22:50:46 · 22:51:23 → 22:54:45 · 22:55:40 →
22:58:25 · 22:59:18 → 23:00:02 · 23:00:41 → 06:46:00` (all in `2026-08-04/`) then
`…20260805064633…` at **06:46:37 → 06:59:52** in `2026-08-05/`. Last raw row 06:59:52 vs predicted
06:59:51.

**Both answer the question NEGATIVE — the ACC was on throughout.** Every PPG fragment on both nights
has an ACC twin opening 1–2 s earlier and closing within a second, with no PPG fragment lacking one.
Effective rates confirm no interior gaps: the dominant fragments give **51.7 Hz** ACC against 52 Hz
nominal on both (08-04: 1 443 000 rows / 27 919 s; 08-06: 1 274 461 / 24 654), matching the 51.7 Hz
7.2-RUN measured on 2026-08-07. The inter-fragment gaps (31–43 s) are link dropouts where **neither**
stream exists, so they are not the "ACC off while PPG on" condition §1's defect requires.

**2026-08-08 remains genuinely absent** — no `Polar_VeritySense_*` PPG or ACC anywhere on the box for
that date, checked without a name or size filter. That one was reported correctly.

| night | ratio | ACC coverage | basis |
|---|---|---|---|
| 2026-07-01 | 1.09 | FULL | 7.2-RUN, PSL tree |
| 2026-08-04 | 1.09 | **FULL** | this run — 6 fragments across two date dirs |
| 2026-08-06 | 1.09 | **FULL** | this run — 5 fragments |
| 2026-08-07 | **1.27** | FULL | 7.2-RUN, single file |
| 2026-08-08 | 1.17 | unknown | raw absent |

**Status of item 2: ✅ RETIRED — owner decision 2026-08-21, on 4 of 5 measured all negative.** The
call §7.2-RUN itself framed (*"an explicit decision that … clean negatives on the … highest-ratio
available nights is enough to retire the concern"*) was put to the owner and answered **retire**.

On the evidence §1's defect suppressed no flag on any measurable alternation night — four of five,
including **2026-08-07 at ratio 1.27, the strongest alternation in the corpus**. The item is closed;
it is not "closed because nobody chased it".

⚠️ **The one unmeasured night is named, not swept under the close.** **2026-08-08, ratio 1.17** — no
`Polar_VeritySense_*` PPG or ACC exists for that date anywhere on the box, checked without a name or
size filter (§7.2-RUN-II). If that recording ever surfaces, the join is a re-run of the same method,
not new work. Retiring on 4 of 5 is a judgement about sufficiency, not a claim that the fifth agrees.

⚠️ **The general lesson, since this is the fifth false absence on this corpus:** the previous entry's
own warning was that *"each of those directories exists and is named for the right date, so a coverage
check run without comparing spans would have read the 2-second capture as a night."* That was right,
and it still under-reached — because the fix (compare spans) was applied to the same wrong unit. The
trap is not only "a fragment is not a night"; it is that **the index you enumerate over — file, date —
is itself an assumption.** See [`docs/CORPUS-LOCATIONS.md`](../docs/CORPUS-LOCATIONS.md).

**Superseded framing of item 2 below is kept verbatim; its two measurements remain valid.**

**Status of item 2: advanced, not closed.** 2/5 measured negative, 3/5 blocked on raw data that is not
in any of the four locations `docs/CORPUS-LOCATIONS.md` lists. Closing it needs those three recordings
to surface, or an explicit decision that two clean negatives on the two highest-ratio *available*
nights — including 2026-08-07, the strongest alternation in the corpus at 1.27 — is enough to retire
the concern.

## 3 · Lower-severity observations — leads, not findings

Filed as leads because each is real code but none is demonstrated to move a user-visible number.

- **`oxydex-dsp.js:6213 stdDev` is the fleet's lone population (÷N) variance.** Nine siblings
  (`analysis-stats.js`, `hrvdex-dsp.js`, `ppgdex-dsp.js`, and the five `*-cross.js`) all use the sample
  (÷N−1) form. Feeds `spo2Std`, `hrSdnn`, `spo2CoV`, the ApEn radius and `rsaProxy`. On night-length
  arrays the gap is <0.05 % and immaterial; the one small-N caller is `rsaProxy` (30-sample windows,
  ≈1.7 % low). Both surfaced numbers are explicitly documented as *proxies* (*"NOT RR-interval SDNN"*),
  so this is a consistency lead, not a wrong number. **Do not "unify" without checking §5's warning
  about deliberate per-signal differences.**
- **`hrvdex-render.js:238`** — ~~**HYPOTHESIS** — not executed.~~ **EXECUTED 2026-08-20 — REAL, and the
  absence it trusts is DELIBERATE.** The branch rendered *"Strong parasympathetic recovery — a green
  light for higher-intensity training"* whenever the Recovery subscore was **absent**, because a null
  index satisfied the test.

  **The chain, read to the line:** `hrvdex-dsp.js:869` sets `d_ari = … : NaN` when the row's own rMSSD
  is absent **or** `window7.length < 4`, and its own comment says why — DEEP-AUDIT §**Finding 5** added
  that guard to stop a fabricated `d_ari = 0` firing a false **RED** *"recovery collapse"* alert.
  `hrvdex-render.js:211`'s `num()` maps that NaN to `null`. The branch then read the null as passing.
  **Finding 5's careful red became an equally fabricated GREEN — on a recommendation to train harder.**

  **Not a rare edge case, and this is what upgrades it from a lead:** `window7.length < 4` holds for the
  **first three days of ANY series**, and `r._rmssd > 0` fails on **every day with no rMSSD reading**.
  The subscore grid directly beneath the note renders Recovery as *absent* at the same moment the note
  asserts it is *strong* — visible to a reader, invisible to every gate.

  **Fixed** by requiring the measurement positively (`ari != null && ari >= 1`); an absent index now
  falls through to the measured `score >= 45` note (*"Balanced autonomic state — proceed with your
  planned training load"*), which rests only on `score` and claims nothing about recovery. Gated by
  `HRVDex render — an ABSENT Recovery index does not grant the training green light` (5 assertions,
  source-scan — the established pattern for this file), which also pins **Finding 5's DSP guard**,
  since the two halves are only correct together.

  **Render-only ⇒ export-inert, and computed rather than claimed:** `computeHash` is `7fe268e6b141`
  before and after; only `manifestHash` moved (`44d68225a833 → 1f9e6a0c60b4`).
- **`integrator-dsp.js:1823-1824`** — `effConf: +(effConf(d) || 0).toFixed(3)` writes `0` into a
  finding's `sources[]` provenance trail when `conf` was absent (`effConf` correctly returns `null`).
  The fused posterior is unaffected — `combineConf` skips nulls properly — so this is an audit-trail
  honesty nit, and "no evidence" arguably *is* 0 here. Noted, not filed.

### 3-RESULT · Both surviving leads MEASURED 2026-08-20 — unreachable on the corpus, and the shape is a FLEET pattern

The two open leads were dispositions rather than measurements (*"noted, not filed"*, *"a consistency
lead"*). Both are now measured. **Both hold — and the reason to record it is that the dismissal
reasoning for the `effConf` one (*"'no evidence' arguably is 0 here"*) is the same reasoning that
failed one bullet above it,** where an absent Recovery index satisfying a test produced a fabricated
GREEN. A disposition that reads identical to a known failure is worth converting into a number.

**`integrator-dsp.js:1837-1838` — unreachable.** `gather()` filters on event type and union membership
only, never on `conf`, so an event with absent `conf` *would* reach the line and render
`conf: null` beside `effConf: 0` — contradicting the tool's own published formula
(`effConf = conf × (sqi ?? 1)`, surfaced at `:6557`, which also tells the reader those fields are
retained in `sources[]`). It does not happen: across **220 committed exports**, of **3,155** fusable
events (`autonomic_surge` 2,493 · `desat_event` 662; the `spo2_desaturation` and `autonomic_arousal`
aliases appear **0** times), **zero** lack a finite `conf`. The posterior claim also verifies —
`:1826` passes `effConf(d)` *unrounded* to `combineConf`, so the `|| 0` never reaches the fusion.

**`oxydex-dsp.js` `stdDev` — still the lone population form, still undocumented.** ⚠️ **The audit's
line 6213 has drifted to `:6723`**; it is `Math.sqrt(avg(squared deviations))`, ÷N, with no comment
recording the choice. Magnitude is analytic, not empirical: `√(N/(N−1))` ⇒ **1.71 % low at N = 30**
(`rsaProxy`'s window), <0.05 % on night-length arrays. Unchanged disposition — §5's warning about
deliberate per-signal differences still stands, and documenting it in code would move `computeHash`
and owe a full fixture re-verification **for a comment**, which is the chain CLAUDE.md §🔏 warns about.

**NEW — the `|| 0` fabricated-zero shape is a 3-site fleet pattern, not an integrator one-off.**
`git grep '|| 0)\.toFixed'` over the root `*.js` returns exactly three production sites (the other
seven hits are assertion-message formatting in `tests/dex-tests.js`):

| site | what an absent value renders as | surfaced? |
|---|---|---|
| `integrator-dsp.js:1837-1838` | `effConf: 0` in `sources[]` | audit trail, reader-visible per `:6557` |
| **`oxydex-render.js:3055`** | **`HR-Var SD  0.00 bpm`** | **a metric CARD** |
| `oxydex-dsp.js:6453` | `hrSdnn: 0` | node export |

**The render site is the notable one, because the correct idiom sits five lines below it in the same
grid:** `metric('RSA proxy', h.rsaProxy != null ? h.rsaProxy : '—', …)`. Same object, same `<div class="grid">`,
one honest and one fabricating.

**Also unreachable today, and measured the same way.** `computeHRV` returns `null` below 120 clean
samples and the card is guarded by `if (n.hrv)`, so `hrs.length ≥ 120` whenever it draws; NaN would
need a non-finite `r.hr` surviving a filter that tests `motion`/`hrArtifact` but not HR validity. A
true `hrSdnn` of exactly `0.00` over ≥120 real samples requires perfectly constant HR, so a zero in
an export *is* the fabricated one — and across the corpus **54 of 54** hrv blocks are non-zero and
present.

#### 3-RESULT-II · Sharpened the same day — the two classes are NOT alike, and one sentence above was misleading

§3-RESULT called all three sites "unreachable" on an empirical basis, and wrote that a NaN "would
need a non-finite `r.hr` surviving a filter that tests `motion`/`hrArtifact` but not HR validity."
**That points at an open path, and the path is closed.** Read to the line:

- `oxydex-dsp.js:671-672` — the CSV row parser rejects the value outright: `if (isNaN(spo2) ||
  isNaN(hr)) continue;` then `if (spo2 < 50 || spo2 > 100 || hr < 20 || hr > 250) continue;`. **Every
  pushed row carries a finite HR in [20, 250].**
- The one place a row's `hr` is later *reassigned* — the artifact repair at `:835`, `rows[k].hr =
  baseline` — sets `rows[k].hrArtifact = true` on the same rows, and `computeHRV`'s filter excludes
  exactly those. So even a bad baseline cannot reach `hrs`.

⇒ **`oxydex-render.js:3055` and `oxydex-dsp.js:6453` are unreachable BY CONSTRUCTION, not by corpus.**
They can only fire if the parser's range check is removed. That is a proof, where §3-RESULT had a
sample of 54.

**The integrator site is a different class, and it is the one that stays live.** All four in-fleet
emitters of the fusable types set a `conf` that is finite by construction —
`cpapdex-fusion.js:117` (`Math.min(0.95, 0.5 + (d.depth || 0)/20)`), `ecgdex-dsp.js:2192`
(`surgeConf`, clamped 0.45–0.95 off `ampBpm || 0`), `ppgdex-dsp.js:4203` (same shape, 0.45–0.9),
`oxydex-dsp.js:6974` (`oxyDesatConf`, null-defaulted and clamped 0–1). Adapters emit **no** events at
all (`grep -c impulse adapters/*.js` ⇒ 0 across all ten; they are input-side normalizers).

**So the trigger has a name: a FOREIGN or LEGACY `ganglior.node-export`.** That is not hypothetical —
the Clock Contract §6 requires consumers to *"still tolerate `t`-only legacy exports"*, so third-party
and older exports are an expected input class, and `gather()` filters on type and union membership
only. The integrator site is latent-with-a-named-trigger; the two OxyDex sites are dead code paths.

⚠️ **Process note, since it is the lesson this repo keeps paying for:** §3-RESULT shipped (#1589)
before this analysis was done, so it published an empirical "unreachable today" and an open-sounding
path in the same breath. CLAUDE.md §👥.5 — *"Diagnose fully, then ship"* — and the cost here was a
second PR to correct a sentence rather than a wrong number.

**Disposition: leads remain leads — no code changed.** All three are currently unreachable, two of the
three fixes would move `computeHash` and owe a fixture cycle, and §3's own framing (*"none is
demonstrated to move a user-visible number"*) survives the measurement. What changes is that the
landing spot is now named: if any node ever emits an event without `conf`, or an HR series that
poisons `stdDev`, these are the three places absence becomes a zero — and `oxydex-render.js:3055` is
the one a user would read.

---

## 4 · What NOT to chase — investigated and REFUTED

Each was executed or read to the line; each is a live-looking lead that is already dead. *A refuted
claim is not a cleared area.*

| claim | verdict | evidence that killed it |
|---|---|---|
| **Class 11 canonical** — the O2Ring's replicated 3-column pleth votes with itself and reports `ledAgreementPct: 100` at `measured` | **FIXED** | `ppgdex-dsp.js:2630-2634` — `distinctChannelIdx()` collapses bit-identical duplicates *before* the vote, so a replicated stream takes `consensusBeats`' honest `nCh < 2` path (`:1058`) and agreement reports `null`. `pickSite` (`:572-584`) keys the site on replication, not on `nCh`. |
| **Class 12 canonical** — `signal-orchestrate.js fnameStampMs` is unanchored and eats an 8-digit device serial as a date (year 0292) | **FIXED** | `:418` now leads with a **POLAR-anchored** alternative; the unanchored `(20\d{2})…` fallback only runs when that fails, and it parses the real O2Ring corpus names (`O2Ring S 2100_20260511231000.csv`) correctly — the `2100_` serial cannot match, `_` is not a digit. |
| **Class 14 canonical** — `bodyPosition` never got `actigraphy`'s coverage fix | **FIXED** | `motiondex-dsp.js:388-407` — `covered` counts only epochs that received samples and *is* the `dwellFrac` denominator; an uncovered epoch keeps `'unknown'` in the track and leaves the denominator entirely. |
| Fleet carries a `Date.parse` / `new Date(str)` on a vendor string | **NO** | Fleet-wide grep clean; `integrator-longitudinal.js:344-349` documents its own ban explicitly. The only non-UTC civil getter is `glucodex-dsp.js:1535` — which is §2, a *gate* finding, not a clock defect. |
| **HRVDex has no equiv/GATE-C leg** (enumerated as an empty cell) | **NO** | `tests/run-tests.mjs:537` — `pair('hrvdex', 'WELLTORY_…csv', 'HRVDex_2026-06-25_equiv.node-export.json')`. It is keyed dynamically, which is why a `grep 'equiv\.'` over `tests/dex-tests.js` misses it. Its input is corpus-gated, so it is one of the 12 CI skips — present, not absent. |
| `clock.js hostAxis` mis-states its rate | **NO** (read, not disproved by execution) | The `ppm` end-bias, the median-vs-fit choice, the refusal bound and the `independent`/`spreadMs` discriminator are all implemented as `CLAUDE.md` §7 specifies, each with its measurement in-comment. Nothing found. |
| `_poissonSf` / `combineConf` / `effConf` arithmetic | **NO** | `_poissonSf` (`integrator-dsp.js:2036`) is a correct stable survival sum; `combineConf` (`:78`) is a proper noisy-OR that skips nulls rather than defaulting them; `effConf` (`:124`) returns `null` on absent `conf` and treats `sqi == null` as quality-neutral ×1, as documented. |

---

## 5 · Scope — what this pass did NOT cover

The charter requires this section because two consecutive 2026-07-18 passes skipped the same three
things while reporting confidently on everything else. **A green area nobody looked at is not a verified
one.**

- **(a) The browser lane — NOT COVERED.** No `Dex-Test-Suite.html?full`, no `verify-provenance.html`, no
  render-coverage rigs. This was a headless `node:vm` pass end to end. GATE A/B were not run in the
  browser; `npm run verify:manifest` was likewise not run (only `test:par`).
- **(b) `capture-host/` — NOT COVERED.** No Python was read or run. Its pytest lane, its mutation
  surface (`audits/MUTATION-AUDIT-FINDINGS-2026-08-02.md`) and the producer-side seam of charter class 11
  are untouched by this pass.
- **(c) The Integrator's fusion arithmetic — PARTIALLY covered.** Read and cleared: `effConf`,
  `combineConf` (noisy-OR), `_poissonSf`, the R5 surge-rate null model, and the `coupling.real`
  permutation verdict. **Not covered:** `integrator-tch.js` (three-cornered-hat estimator),
  `integrator-longitudinal.js`, and `event-coupling.js`'s surrogate machinery beyond its header contract.
- Also not covered: the mutation harness (`tools/mutate.mjs`) was not run in this pass; the full
  `npm run check` (typecheck · lint · build/docs/analysis drift · manifest) was not run — only
  `npm run test:par`. The 12 corpus-backed equivalence legs did not execute here.

---

## 6 · Cross-check against concurrent passes

`briefs/` and `audits/` grepped for work dated within a week of 2026-08-04.

- `changes/2026-08-03-ppgdex-inertial-gap-not-stillness.md` + `MULTI-SENSOR-DERIVATIONS-FOLLOWUPS-2026-07-18-BRIEF.md`
  §1 — **the direct parent of §1.** They found four instances; this is the fifth. No contradiction: §1.3
  explains why their measurement (committed twins, zero ACC) could not have distinguished it. **The two
  should be read together — a partial fix already shipped.**
- `briefs/PPGDEX-JITTER-AND-REFERENCE-FOLLOWUPS-2026-08-03-BRIEF.md`, `PPG-SAMPLE-RATE-AND-PAT-2026-08-03`,
  `MULTINIGHT-CORPUS-FINDINGS-2026-07-29` — all touch `sdnnRobust` as a *consumer* (pairing, the
  alternation detector, the ECG comparison axis). None examines the gate that produces it; none
  contradicts §1. `MULTINIGHT-CORPUS-FINDINGS` §2's alternation detector is the one that §1.4's
  hypothesis says this defect can suppress — **that is the intersection to check first.**
- Nothing found in any pass' REFUTED list that conflicts with either finding.

---

## 7 · Prioritized punch-list

1. **§1 · `ppgdex-dsp.js:2873`** — exclude `motionIndex == null` from the robust-HRV quality gate, and
   publish the fallback basis. Correctness, headline KPI, propagates to Integrator fusion. *One gated
   change; re-bundles PpgDex; `computeHash` moves ⇒ corpus re-verification owed.*
2. **§1.4 · run the alternation check** — do any of the six real `rmssd > sdnnRobust` nights have partial
   ACC coverage? If so, §1 was masking a flag, and that raises §1's severity from "wrong number" to
   "suppressed quality warning."
3. **§2 · narrow `GETTER_ALLOW` from file-key to occurrence** — test-layer only, no re-bundle. Do it now;
   take the `getUTC*` conversion on the next GlucoDex touch.
4. **§3 leads** — `oxydex-dsp.js stdDev` divisor consistency and `hrvdex-render.js:238`. Neither is
   demonstrated to move a number; treat as on-touch cleanups, not as work.
5. **Scope debt (§5)** — the browser lane, `capture-host/`, and `integrator-tch.js` remain unaudited by
   this pass, as they were by the last two. Whoever runs deep audit V should start there rather than
   re-sweeping the DSPs.

---

## 8 · Appendix — the §1 reproduction, in full

Run from the repo root: `node repro-ppg-gated.mjs`. Deterministic (seeded LCG), no fixture, no corpus,
no network. Prints the epoch table and both gates' selections, as quoted in §1.2.

```js
// SPDX-License-Identifier: Apache-2.0
// Repro: ppgdex-dsp.js gatedEp admits motionIndex==null (ACC not recording) as "low motion".
import fs from 'node:fs';
import vm from 'node:vm';
import DexBuild from './tools/build-core.js';

const root = process.cwd();
const ctx = { console, Math, Date, JSON, isFinite, parseFloat, parseInt, Number, String, Array,
  Object, Float32Array, Float64Array, Int16Array, Uint8Array, BigInt, TextDecoder };
ctx.globalThis = ctx; ctx.window = ctx; ctx.self = ctx;
vm.createContext(ctx);
for (const f of ['kernel-constants.js', 'clock.js', 'dex-export.js', 'ppgdex-dsp.js'])
  vm.runInContext(DexBuild.classicify(fs.readFileSync(root + '/' + f, 'utf8')), ctx, { filename: f });
const P = ctx.PpgDex;

let _s = 12345;
const rnd = () => { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; };
const gauss = () => { let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// 40 min @176 Hz. RR SD 20 ms before t=1500 s, 80 ms after — so the two halves are distinguishable.
const FS = 176, DUR = 2400, beats = [];
{ let t = 0.5; while (t < DUR) { beats.push(t); t += 1.0 + (t < 1500 ? 0.020 : 0.080) * gauss(); } }
const ns0 = 835351534233872000n, t0 = Date.UTC(2026, 5, 21, 6, 5, 23, 891);
const rows = ['Phone timestamp;sensor timestamp [ns];channel 0;channel 1;channel 2;ambient'];
let bi = 0;
for (let i = 0; i < FS * DUR; i++) {
  const t = i / FS;
  while (bi + 1 < beats.length && beats[bi + 1] <= t) bi++;
  const rr = (beats[bi + 1] != null ? beats[bi + 1] : beats[bi] + 1) - beats[bi];
  const ph = Math.max(0, Math.min(1, (t - beats[bi]) / rr));
  const pulse = 900 * Math.exp(-Math.pow((ph - 0.22) / 0.10, 2))
              + 380 * Math.exp(-Math.pow((ph - 0.50) / 0.14, 2));
  rows.push(new Date(t0 + t * 1000).toISOString().replace('Z', '') + ';'
    + (ns0 + BigInt(Math.round(t * 1e9))) + ';'
    + Math.round(-500275 + pulse + 6 * gauss()) + ';'
    + Math.round(-509615 + pulse * 0.86 + 6 * gauss()) + ';'
    + Math.round(-517415 + pulse * 1.13 + 6 * gauss()) + ';-650690;');
}
const rec = P.parsePPG(rows.join('\n'));

// THE FIXTURE'S POINT: ACC covers [0,1500) ONLY. Low motion 0-900 s, saturated motion 900-1500 s,
// nothing after — i.e. PARTIAL coverage, which neither committed twin can express.
const acc = [];
for (let i = 0; i < 52 * 1500; i++) {
  const s = i / 52, hi = s >= 900;
  acc.push({ x: hi ? 500 * Math.sin(s * 7) : 0.7 * gauss(),
             y: hi ? 500 * Math.cos(s * 5) : 0.7 * gauss(),
             z: 1000 + (hi ? 400 * Math.sin(s * 11) : 0.7 * gauss()), relNs: s * 1e9 });
}
rec.acc = acc;
const res = P.analyze(rec), eps = res.epochs || [];
for (const e of eps) console.log('  tMin=' + String(e.tMin).padStart(3)
  + '  motionIndex=' + (e.motionIndex === null ? 'null ' : String(e.motionIndex).padEnd(5))
  + '  sdnn=' + e.sdnn);
console.log('\nsdnnRobust=' + res.sdnnRobust + '  nEpochs=' + res.sdnnRobustNEpochs
  + '\nhfRobust=' + res.hfRobust + '  hfRobustLowMotion=' + res.hfRobustLowMotion);

const led = (e) => e.ledAgreementPct == null || e.ledAgreementPct >= 67;
const fin = (e) => e.sdnn != null && isFinite(e.sdnn);
const cur    = eps.filter((e) => fin(e) && (e.motionIndex == null || e.motionIndex <= 0.5) && led(e));
const honest = eps.filter((e) => fin(e) && e.motionIndex != null && e.motionIndex <= 0.5 && led(e));
const med = (a) => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
console.log('\nSHIPPED gate keeps ' + cur.length + ' → median sdnn ' + med(cur.map((e) => e.sdnn)).toFixed(1));
console.log('HONEST  gate keeps ' + honest.length + ' → median sdnn '
  + (honest.length >= 3 ? med(honest.map((e) => e.sdnn)).toFixed(1)
     : '<3 → falls back to ungated ' + med(eps.map((e) => e.sdnn)).toFixed(1)));
```
