<!--
  DEEP-AUDIT-IV-2026-08-04-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-04 · **Charter:** `AUDIT-PROMPT.md` · **Follows:** `DEEP-AUDIT-III-2026-07-26-BRIEF.md` (DONE 2026-07-29) · `DEEP-AUDIT-III-FOLLOWUPS-II-2026-07-29-BRIEF.md` (DONE 2026-07-31)

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

**Directional consequence — HYPOTHESIS (not executed against the corpus):** `Dv.hrvShapeViolates(rmssd,
sdnnRobust)` (`tests/dex-tests.js:8233`) is the shipped detector for the PPG beat-alternation artifact,
and it fires on `rmssd > sdnnRobust`. Inflating `sdnnRobust` moves that comparison toward *not* firing,
so on a partial-ACC night this defect can **suppress a known quality flag**. Worth running against the
six real alternation nights before the fix lands, to see whether any of them is partial-ACC.

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

## 3 · Lower-severity observations — leads, not findings

Filed as leads because each is real code but none is demonstrated to move a user-visible number.

- **`oxydex-dsp.js:6213 stdDev` is the fleet's lone population (÷N) variance.** Nine siblings
  (`analysis-stats.js`, `hrvdex-dsp.js`, `ppgdex-dsp.js`, and the five `*-cross.js`) all use the sample
  (÷N−1) form. Feeds `spo2Std`, `hrSdnn`, `spo2CoV`, the ApEn radius and `rsaProxy`. On night-length
  arrays the gap is <0.05 % and immaterial; the one small-N caller is `rsaProxy` (30-sample windows,
  ≈1.7 % low). Both surfaced numbers are explicitly documented as *proxies* (*"NOT RR-interval SDNN"*),
  so this is a consistency lead, not a wrong number. **Do not "unify" without checking §5's warning
  about deliberate per-signal differences.**
- **`hrvdex-render.js:238`** — `score >= 55 && (ari == null || ari >= 1)` renders *"Strong parasympathetic
  recovery — a green light for higher-intensity training"* when the Recovery subscore is **absent**. Same
  `== null` passes-the-gate shape as §1, in the presentation layer. The gating `score` is itself measured,
  so this is a recommendation resting on one fewer input than it implies rather than a fabricated number.
  **HYPOTHESIS** — not executed.
- **`integrator-dsp.js:1823-1824`** — `effConf: +(effConf(d) || 0).toFixed(3)` writes `0` into a
  finding's `sources[]` provenance trail when `conf` was absent (`effConf` correctly returns `null`).
  The fused posterior is unaffected — `combineConf` skips nulls properly — so this is an audit-trail
  honesty nit, and "no evidence" arguably *is* 0 here. Noted, not filed.

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
