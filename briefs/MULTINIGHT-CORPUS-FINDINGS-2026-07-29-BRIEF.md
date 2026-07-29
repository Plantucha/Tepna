<!--
  MULTINIGHT-CORPUS-FINDINGS-2026-07-29-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-07-29 · **Created:** 2026-07-29 · **Executed:** all four sections shipped and merged — §1 PR #527, §2 PR #528, §3 PR #529, §4 PR #530 (§4's ladder owner-ratified before implementation). §3's own prescription was WRONG and is corrected in place, not rewritten. **Follow-ups:** `MULTINIGHT-CORPUS-FINDINGS-FOLLOWUPS-2026-07-29-BRIEF.md` · **Source:** the 2026-07-28 full-corpus re-fold (37 trio nights + 197 CPAP nights) · **Related:** `TRIO-BATCH-O2RING-DAT-2026-07-13-BRIEF.md`, `CPAP-AUTOHARVEST-FOLLOWUPS-2026-07-28-BRIEF.md`, `REM-STAGING-REDESIGN-2026-07-28-BRIEF.md`

# Four defects a 37-night fold found that no single night could

Every finding below was invisible to the gates and invisible to a one-night spot-check. Three of them
are **silent** — no throw, no red, no `lowConfidence`, a plausible number in the export — and the
fourth is a string that has been identical on every night ever folded. They surfaced only because 37
nights were folded under one code version and then cross-checked against a second, independent device.

**What was run** (2026-07-28, all exit 0, nothing staged):

```sh
rsync vigil:/srv/tepna/captures/ → local            # 1.45 GB; 2026-07-27 was 302 MB of 942 MB locally
node tools/trio-batch.mjs --src "…/Ecg nightly"        --out uploads/trio   # 25 nights, 117 s
node tools/trio-batch.mjs --src …/tepna-smoketest/captures --out uploads/trio # 12 nights,  60 s
node tools/tch-multinight.mjs --dir uploads/trio                             # 37 nights
node tools/cpap-corpus.mjs --root …/cpap/DATALOG --stats                     # 197 nights, 0 problems
```

**37 eligible trio nights**, 2026-06-10 → 07-27 — not the 24 previously on disk; `2026-07-13` and all of
`2026-07-16..27` had never been folded. The whole fold is **~3 minutes of wall clock at 8 jobs on a
24-core host**, which is the first thing worth writing down: this was treated as expensive and is not.

---

## 0 · The one result that is not a defect — CPAPDex is externally validated

Before the defects, the finding that gives the rest of this brief its authority. The ResMed card
carries the device's **own** per-night scoring in `STR.edf`. Over the 37 nights that have both, CPAPDex's
independently-computed indices reproduce it:

| index | bias | median \|Δ\| | max \|Δ\| |
|---|---|---|---|
| `residualAHI` | +0.055 /h | 0.06 | 0.19 |
| `centralIndex` | +0.053 /h | 0.05 | 0.19 |

The uniform positive bias is consistent with STR storing one decimal. **The EDF parse and the event
indexing are right** — cite this before ever re-deriving CPAPDex's AHI. It also establishes STR.edf as a
usable oracle, which is how §1 was found and how §1 must be verified.

---

## 1 · P0 — CPAPDex has never once measured periodic breathing (`cpapdex-dsp.js:834`)

```js
// CSL spans (Cheyne-Stokes / PeriodicBreathing) → total seconds in periodic breathing
function periodicBreathingSec(annotations) {
  …
  if (c === 'Cheyne-Stokes' || c === 'PeriodicBreathing') sum += annotations[i].durSec || 0;
```

The AirSense 11 does not write that. It writes PB into `*_CSL.edf` as a **paired marker with no duration**:

```
CSR Start … CSR End          ← two TALs, durSec 0
```

So **both** halves are wrong for this device — the label test never matches, and even if it did, `durSec`
is 0 on these annotations, so the accumulator would still return zero. `periodicBreathingPct` has
exported a measured-looking **`0.00` on all 197 nights**. The `durSec > 0 ? … : null` guard on the caller
does not rescue it: that guards *recording length*, not source presence, so the `DEEP-AUDIT-2026-07-14
§7` intent ("null on absence, not a measured-looking 0") never fires.

### 1.1 The fix is verifiable against the device's own number

Pairing the markers and taking the time difference reproduces STR.edf exactly:

| night | CSL `CSR Start`→`CSR End` | % of therapy time | STR.edf `CSR` |
|---|---|---|---|
| 2026-06-11 | 1296 s | 4.9 % | 21 min |
| 2026-06-25 | 1869 s | 7.5 % | 31 min |
| 2026-06-27 | 924 s | 3.8 % | 15 min |
| 2026-07-08 | 598 s | 2.8 % | 9 min |

1296 s = 21.6 min, 1869 s = 31.1 min, 924 s = 15.4 min, 598 s = 10.0 min. **`STR.edf`'s `CSR` channel is
in MINUTES, not percent** — worth stating because reading it as a percentage makes the two sources look
4× apart instead of identical. Across all 379 STR records, 17 nights are non-zero (max 61 min).

### 1.2 Why every gate stayed green — the fixture was authored against the parser, not the device

This is the part to keep. `uploads/20260613_231433_CSL.edf`, the committed synthetic twin, encodes:

```
+3000  [dur 180]  "Cheyne-Stokes"        ← one TAL, with a duration
```

— i.e. **exactly the shape the code already expects**, and `cpapdex_synthetic_golden.node-export.json`
duly asserts `periodicBreathingPct: 20`, `reraIndex: 6`. The gate is not lying; it is faithfully proving
that the code implements *its own assumption*. Meanwhile the two committed **real** nights
(`cpapdex-2026-06-12`, `cpapdex-2026-06-16`) both pin `periodicBreathingPct: 0` — and, checked for this
brief, both genuinely have no CSR span in their CSL, so that 0 is *correct*. The fixture set therefore
contains one input that can only confirm the bug and two that cannot see it.

CLAUDE.md's rule is "an adversarial **committed** twin beats a real one". The amendment this finding
earns: **the twin must be adversarial against the device's real encoding, not a restatement of the
parser's.** A synthetic input written from the code is a mirror, not a test.

### 1.3 What to do

1. Extend `periodicBreathingSec` to pair `CSR Start` / `CSR End` (and the `Cheyne-Stokes` /
   `PeriodicBreathing` single-TAL form — **keep it**, back-compat, and it is what the existing golden
   pins). Unpaired `Start` at end-of-file closes at session end; unpaired `End` is discarded, not
   back-dated to zero. Both counts surfaced, never silently dropped (`sentinelRejected` precedent).
2. Add a **new committed synthetic CSL** in the real encoding (`CSR Start`/`CSR End`, `durSec` 0) plus a
   golden that pins a non-zero `periodicBreathingPct` from it. Without this the fix is unprovable in CI
   — see §1.2.
3. `reraIndex` is a **separate, lesser** question, deliberately not bundled: this device emits no RERA
   label at all (its `_EVE.edf` vocabulary is exactly `Central Apnea · Hypopnea · Obstructive Apnea ·
   Arousal · Recording starts`), so there is no better source and `0` is not a mis-parse. It is still
   *presented* as measured; if it moves, it moves to `null`, in its own change.
4. **Not in scope, recorded so it is not lost:** `Arousal` annotations are parsed past — the data for an
   arousal index is on the card and unclaimed. Its natural home is a CPAPDex brief of its own, alongside
   the unclaimed `SA2.edf` `SpO2.1s`/`Pulse.1s` already logged in `CPAP-AUTOHARVEST-FOLLOWUPS §2`.

### 1.4 Provenance consequence

The two gate-pinned real nights have no CSR spans, and the synthetic path is preserved by keeping the
old label branch — so this fix is expected to be **output-inert on every currently committed fixture**
while moving `manifestHash` *and* `computeHash` (a DSP edit inside the compute closure). Per CLAUDE.md
that is a re-verification owed, not an inertness claim: run
`DEX_UPLOADS=<corpus> node tools/verify-fixtures.mjs`, and **do not write "export-inert" as prose** —
either quote the unchanged `computeHash`, or name the fixtures re-verified.

---

## 2 · P1 — PpgDex publishes impossible HRV and flags it as confident (`ppgdex-dsp.js:2518`)

On 6 of 37 nights the whole-record `hrv.time.rmssd` is not physiologically attainable:

| night | rMSSD PPG | rMSSD ECG | pnn50 PPG / ECG | `sdnnRobust` | `lowConfidence` |
|---|---|---|---|---|---|
| 2026-06-29 | 188.4 ms | 32.3 | 57.2 / 10.2 | 136.2 | `false` |
| 2026-07-05 | 162.5 | 25.8 | 57.5 / 3.8 | 109.2 | `false` |
| 2026-07-25 | 108.8 | 30.8 | 47.3 / 8.8 | 85.5 | `false` |
| 2026-07-18 | 96.0 | 36.6 | 41.9 / 14.3 | 78.0 | `false` |
| 2026-07-26 | 93.4 | 36.7 | 42.1 / 14.8 | 76.0 | `false` |
| 2026-07-17 | 91.5 | 41.7 | 42.6 / 17.6 | 87.6 | `false` |

Same subject, same night, same window, a chest ECG two feet away reading 26–42 ms.

**It is none of the usual causes.** Mean HR agrees with ECG to ≤ 0.5 bpm, so it is not wholesale beat
doubling (which is the class `PPGDEX-OPTICAL-DETECTOR` closed — this is a different animal).
`correctionRatePct` 2.5–13.1, `ledAgreementPct` 96–100, `ppiAgreementPct` 99–100, `motionRejectedPct`
≤ 1.7 — every quality field is normal. It is **not** a session-concatenation artifact either: the
per-epoch `timeseries.epochs[].rmssd` is elevated in *every* epoch (2026-06-29: min 44.4, median 193.3,
max 283.9), and epoch `lfhf` collapses to **0.1–0.6** against 0.4–5.4 on a clean night — spectral energy
piled at the RR-series Nyquist, the signature of an **alternating short/long interval sequence**, most
likely intermittent dicrotic-notch locking in the foot detector.

### 2.1 The gate cannot see it, by construction

```js
const hrvLowConfidence = analyzablePct < 60 || correctionRate > 20;
```

A pure **coverage** gate. All six nights sit at analyzable 96–100 % and correction 2.5–13 %, so no
coverage threshold — at any setting that does not also reject good nights — can reach them. What is
missing is a **shape** term.

### 2.2 The detector is free and already computed

`rmssd > sdnnRobust` is impossible over a whole night: successive-difference dispersion cannot exceed
overall dispersion. It holds on **all six** and on **none** of the other 31. Both values already exist
at `ppgdex-dsp.js:2601-2602`; the flag-don't-drop pattern with a reason string already exists at
`:2518-2521` and is already threaded to `hrv.time` / `poincare` / `frequency` at `:3095`. The change is
an added disjunct plus its reason.

The threshold is not arbitrarily placed: the two next-most-divergent nights, **2026-07-01** (61.7 vs
64.1) and **2026-07-02** (52.0 vs 57.9), sit just *under* the line — the ordering is real, not a
coincidence of six.

**Why this is P1 and not cosmetic:** PpgDex feeds the Integrator's HRV consensus axis, and the same six
nights are why PpgDex is the TCH-named culprit on 22 of 37 nights (median σ: ECGDex 0.91, OxyDex 1.09,
**PpgDex 2.71 bpm**). A consumer currently has no way to know which nights to down-weight.

---

## 3 · P2 — OxyDex integrates a stuck motion column instead of rejecting it

On **2026-07-16 and 2026-07-17** the O2Ring `Motion` column is never zero — every sample sits at ~19–27:

| night | samples with `motion == 0` |
|---|---|
| 2026-07-16 | **0.0 %** |
| 2026-07-17 | **0.0 %** |
| 2026-07-18 | 18.7 % |
| 07-19 … 07-28 | 98.1 – 99.8 % |

OxyDex treats `motion > 0` as motion, so those two nights export `motionPct 100`, `sleepEff 0`,
`arousalIndex 100`, `wasoPct 100` — **and every motion-*gated* metric (HRV, SampEn, the desat baseline)
is computed over an empty sample set**, with no flag anywhere in the export. A downstream reader sees a
night of total thrashing with zero sleep, which is not what happened.

The `.dat` binary path is fine (97–99 % zero bytes on the same dates), so this is the capture-host CSV
writer, not the decoder — see §5.

**Fix:** `motionPct == 100` is a sensor fault, not physiology. Null the motion-derived family
(`sleepQuality.*`, `motionProfile.*`, the motion-gated HRV/SampEn) and stamp a reason, rather than
publishing zeros. The precedent for the shape is `_durBad` / `durationInflated` in the same file
(`oxydex-dsp.js:2547-2551`) — a guard that surfaces absence instead of a plausible wrong number. Note
`DEEP-AUDIT-III-FOLLOWUPS` already carries "`_durBad` is still one-sided"; this is the same discipline
applied to the motion column, and the two are worth doing together.

> ### ⚠ §3 CORRECTED ON EXECUTION (2026-07-29) — the threshold paragraph below is wrong
>
> Both the mechanism and the proposed detector were mis-stated, and only measuring found it. Kept
> rather than rewritten, per `DEEP-AUDIT-III-FOLLOWUPS` §2: **a brief's fix sketch is a lead to
> re-derive, not an instruction.** What is actually true:
>
> **The fault is per-SOURCE, not per-night.** On 2026-07-16/17/18 the capture host's live BLE stream
> wrote a motion field that never returned to zero — but the O2Ring's **own onboard `.dat` backup for
> the same nights is 94–98 % zero**. The device reports motion correctly; the host's live decode of
> that byte does not. A folded night merges both sources, so its overall zero-fraction lands at a
> healthy-looking **50–63 %**, and *any* whole-night fraction test — including the `motionPct == 100`
> one proposed below — is blind to it. The first implementation used exactly that test and **missed
> 2026-07-17**, one of the two nights the fix exists for.
>
> **The detector that works is the longest contiguous run of non-zero samples**, which asks the
> question locally and needs no source provenance. Measured over 13 consecutive capture nights:
>
> | | longest unbroken all-moving run |
> |---|---|
> | 2026-07-16 / 07-17 / 07-18 (faulted) | **110 min · 366 min · 302 min** |
> | 2026-07-19 … 07-28 (every healthy night) | **3 s – 13 s** |
>
> ~500× apart with nothing in between, so the 10-minute threshold is **read off a gap rather than
> chosen** — 46× above the worst healthy observation, 11× below the smallest fault.
>
> **2026-07-18 is therefore decidable after all**, and the "middle band" the next paragraph warns
> about does not exist: 18.7 % zero looks like a restless night *by fraction* and is five hours of
> impossible continuity *by run*. The caution was right in spirit — do not invent a threshold — and
> wrong in fact: the data had a clean one, just not on the axis this brief assumed.

**Threshold care:** 100 % is the unambiguous case. 2026-07-18 at 81 % nonzero is contaminated but not
saturated, and no defensible line separates "restless night" from "partially stuck column" without a
second opinion. Do **not** invent one — flag at 100 %, and treat the middle band as a question for §6.

---

## 4 · P3 — OxyDex's severity opener has two unreachable branches (`oxydex-dsp.js:2144-2147`)

```js
if (avgScore < 2 && worstScore < 4) severity = 'Clean night';
else if (avgScore < 4 && worstScore < 6) severity = 'Mild disruption';
else if (avgScore < 6)                   severity = 'Moderate burden';
else                                     severity = 'Significant burden';
```

All **37 of 37** nights read `Moderate burden`. The driver actually spans **`avgScore` 1.19 → 5.21** —
a 4.4× range that includes the corpus's cleanest night (2026-07-21: ODI3 0.8/h, ODI4 0.0, T90 0.2 %,
nadir 90 %) and its worst (2026-06-15: ODI3 8.7, ODI4 5.2, nadir 84 %, T90 1.0 %) — and they print the
same word. With 28 ranked metrics, `worstScore` is 8–10 on every night, so the first two branches can
never be entered and `Significant burden` needs an `avgScore` no night reaches. The opener carries zero
information across the corpus.

The guardrail comment above it is right in intent ("never label a night clean when its worst finding is
severe"), and `isolatedSevere` — `avgScore < 4 && worstScore >= 6`, **true on 30 of 37 nights** — was
written for exactly this case, but only appends a trailing clause at `:2218` after the severity is
already floored.

**Fix (a decision, not a patch):** grade on `avgScore` and demote the worst-finding to the qualifier the
`isolatedSevere` clause already provides — or re-scale so the ladder's bands match the observed
distribution. Either way the acceptance test is distributional, not per-night: **a 37-night corpus must
not produce one label.** Pick the option with the owner; do not tune a threshold silently.

---

## 5 · Out of suite — two capture-host items (`capture-host/`, no bundle impact)

1. **The stuck `Motion` column** behind §3. It affects 2026-07-16/17 fully and 07-18 partially, then
   heals by itself from 07-19 — so something *changed*, and finding what is cheaper than guessing.
   Sibling of the `VIGIL-*` findings series.
2. **The reconnect storm.** capture.py opens a new file per BLE reconnect: 2026-07-16/17/23 produced
   **42 / 73 / 99** separate O2Ring `_SPO2.csv` fragments. That is what pushed 07-17 and 07-23 past
   OxyDex's `durationInflated` guard (07-17: 23,228 samples across an 11.5 h span; 07-23: 7,350 across
   6.9 h) and what dragged ECG analyzable to 57 % / 72 %. `VIGIL-RECONNECT-BACKOFF-AND-LINK-COUNT` is
   the existing owner; this corpus gives it three dated, quantified cases.

---

## 6 · Explicitly NOT defects — do not re-investigate

- **`stats.durationMin: null` on 2026-07-17 / 07-23** — the `durationInflated` guard working exactly as
  designed on a genuinely gappy night. §5.2 is the cause; the guard is the correct response.
- **`mode: null` in a single-night CPAP export** — correct abstention. It requires `MODE_MIN_NIGHTS` /
  `MODE_MIN_WINDOWS` evidence, and one night genuinely cannot decide CPAP vs APAP.
- **7 nights excluded by `tch-multinight`** for negative classic variance — the estimator refusing to
  report a boundary fit as a measurement.
- **Nights that never qualify** (06-13, 06-17, 06-18, 06-26, 07-03, 07-10, 07-28): three-way overlap
  0.0–0.8 h, under the 1 h floor. 2026-05-03 → 06-05 is SpO₂-only, pre-H10/Verity.

## 6.1 · Open questions this fold raised that are NOT fixes

Recorded so they are not mistaken for either defects or settled results.

- **OxyDex's PB detector and the device's CSR do not agree.** Once §1 lands there is a real comparison to
  make. Today: `r(device CSR, OxyDex PB episodes) = −0.21`; mean OxyDex PB episodes is **5.0** on the four
  nights the device scored CSR and **12.7** on the 33 it did not. SpO₂-derived oscillation and
  flow-derived CSR are not the same construct, so this may be correct behaviour by both — but it is
  currently unexamined, and §1 is the precondition for examining it.
- **Device AHI does not predict oximetric burden on this corpus.** `r(AHI, ODI3) = 0.06`,
  `r(AHI, hypoxic burden) = −0.05`, `r(AHI, nadir) = −0.02` over 37 paired nights. 2026-06-14 scored
  AHI 1.11 with ODI3 8.4 / burden 16.8 / nadir 85 %; 2026-07-23 scored AHI 8.00 with ODI3 2.9 / burden
  0.9 / nadir 87 %. This is a **fusion** question (`briefs/INTEGRATOR-BUILD-BRIEF.md`), and one paired
  corpus of this size is exactly what `PAPERS-ROADMAP` wants for it — but it is an observation about one
  subject, not a validated finding, and must not be graded above its tier.

---

## 7 · Sequencing, gates and provenance

`§1`, `§2` and `§3` are DSP edits in three different nodes and **do not serialize against each other** —
per-app `provenance/<App>.json` fragments since P3. None touches the shared spine. Work each in its own
worktree (`git worktree add ../wt-<task> -b claude/<task> origin/main`); the tree is shared.

For each:

1. Edit the `*-dsp.js`; never the bundled `.html`.
2. `node tools/build.mjs --app <CPAPDex|PpgDex|OxyDex>` — writes `manifestHash`, re-stamps fixtures.
3. Re-bundle the **analysis + docs** surfaces too, not just `build.mjs` — a DSP change rides in worker
   blobs and served docs (`build-analysis.mjs`, `build-docs.mjs`). This has been missed twice before.
4. `Dex-Test-Suite.html?full` all-green (wait for the group count to settle; check `bootSkips`), then
   `verify-provenance.html` (`__gateA_ok` / `__gateB_ok`).
5. `DEX_UPLOADS=<corpus> node tools/verify-fixtures.mjs`. §1 and §3 are *expected* inert on committed
   outputs but both move `computeHash`, so the claim must be **computed**: quote the hash or name the
   re-verified fixtures. Never assert inertness in prose.
6. If an output genuinely moved: `tools/regen-cpap-goldens.mjs` / `tools/regen-oxydex-goldens.mjs` first,
   then re-record — never re-stamp around a moved output. PpgDex has `tools/regen-ppgdex-goldens.mjs`.
7. Drop a changeset in `changes/` (`bump: patch` for §1/§2/§3 — no contract shape changes; §4 is a
   `patch` too unless the label vocabulary is treated as an export contract, which is worth one minute
   of thought before assuming).

`uploads/trio/*` is **git-tracked** despite `uploads/*` in `.gitignore` (it predates the rule), so a
re-fold shows ~72 modified files. Stage by explicit path; do not blanket-add and do not revert them.

## 8 · Done when

- [x] `periodicBreathingSec` pairs `CSR Start`/`CSR End`; a synthetic CSL in the device's **real
      encoding** pins a non-zero `periodicBreathingPct` — met DIFFERENTLY from the wording and worth
      the note: rather than committing a new `.edf` binary, `_buildSyntheticEDF({csrMarkers:true})`
      emits the `CSR Start`/`CSR End` TAL pair **as bytes** in-code, so the assertion runs the whole
      path (TAL parse → `classifyAnnotation` → `annotationBoundary`) and, being generated
      deterministically rather than stored, is present in every clone by construction. The intent —
      *CI exercises the device's real encoding on every push* — is met and verified: the group
      `Leaf-module coverage — CPAPDex DSP/EDF self-tests` runs it (20 assertions, up from 14); the four dated nights in §1.1 reproduce
      4.9 / 7.5 / 3.8 / 2.8 % against STR's 21 / 31 / 15 / 9 min; the existing `Cheyne-Stokes` golden
      (`periodicBreathingPct: 20`) still passes unchanged.
- [x] `hrvLowConfidence` fires on all six §2 nights and on none of the other 31; a regression fixture
      with an alternating RR series pins it; `lowConfidenceReason` names the shape violation, not
      coverage.
- [x] A 100 %-motion OxyDex night nulls its motion-derived family with a stamped reason instead of
      exporting `sleepEff 0` / `arousalIndex 100`; a fixture built from the 2026-07-16 shape pins it.
- [x] A 37-night fold produces **more than one** severity label; the chosen ladder is owner-ratified.
- [x] Both gates green per §7 for each node; fixtures re-verified with the hash or the fixture names
      quoted; one changeset per work-unit.
- [x] A follow-up brief spawned per CLAUDE.md, or this header records that nothing surfaced.

## 9 · What this run taught (the part worth keeping even if the fixes change)

- **A silent defect needs a second opinion, not a better gate.** §1 was found only because a *different
  device* scored the same nights. Every internal check was green and always would have been.
- **A synthetic fixture written from the code proves the code.** §1.2 — the twin encoded PB the way the
  parser reads it, so the golden asserted a working metric while the real device's encoding had never
  once been parsed. Write the twin from a **real file's** bytes, or from the vendor's format, never from
  the function under test.
- **Cross-corpus scale is cheap and was assumed expensive.** 37 nights folded in ~3 minutes; 197 CPAP
  nights in one pass. Three of these four findings are invisible at n=1 and obvious at n=37 — the
  distribution *is* the detector.
- **A constant is a finding.** `periodicBreathingPct` 0.00 × 197, `Moderate burden` × 37, `mode` null ×
  197 all looked like data until they were counted. Two were defects, one was correct abstention — the
  point is that none of them was noticed until someone tabulated the column.
