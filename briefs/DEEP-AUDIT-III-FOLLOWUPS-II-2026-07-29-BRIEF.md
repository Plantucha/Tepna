<!--
  DEEP-AUDIT-III-FOLLOWUPS-II-2026-07-29-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-07-31 · **Created:** 2026-07-29 · **Follows:** `DEEP-AUDIT-III-2026-07-26-BRIEF.md` (DONE 2026-07-29) · **Sibling:** `DEEP-AUDIT-III-FOLLOWUPS-2026-07-27-BRIEF.md` (DONE, §1/§2/§3 scope)

# Closing the punch list found three fixes guarding nothing

`CPAP-AUTOHARVEST-FOLLOWUPS` §4 carried four `DEEP-AUDIT-III` items as unowned, on the reasonable
assumption that no fix stamp meant no fix. **All four were already fixed** — on 2026-07-27, with the
parent never re-stamped. What was not already true is that they were gated.

---

## 1 · The finding: fixes ship; gates do not always follow

Verified the only way this suite accepts — **by mutation**, reverting each fix and watching what reds:

| item | fix | gate before 2026-07-29 | mutation result |
|---|---|---|---|
| **3.6** autonomic⟷glycemic ECG-only | real | **none** | 0 assertions red |
| **4.1** `sampleHz` count÷span | real | **blind** | 0 assertions red |
| **4.2** rate across a strap-off gap | real | partial → **closed 2026-07-30** (§2.1) | 0 → 3 assertions red ✓ |
| **4.3** IMU plausibility bound | real | full | 4 assertions red ✓ |

### 1.1 §4.1's gate was pointed one function away from the defect

The assertion reading `§4.1 · a clock hole does not move the measured rate` drives
`respiratoryRate` — **and `respiratoryRate` does not call `sampleHz`**. It measures its own rate in
`respResample`. `sampleHz`'s only consumers are `actigraphy` (`motiondex-dsp.js:418`) and
`respiratoryEffort` (`:974`).

So the label was right, the assertion was real, and the two had nothing to do with each other. Measured
cost of the blindness: reverting `sampleHz` to count÷span drops the derived native rate **26.00 → 20.80 Hz**
on a stream with a 20 % hole, and moves `respiratoryEffort`'s **published `amplitudeG` 0.0106 → 0.0133
(+25 %)** — while the entire suite stays green. A quarter-off "Effort amplitude" would have shipped in
silence.

Closed by a new group asserting the property **at the seam that owns it**: the same samples, contiguous
and gapped, must yield the same native rate — because a hole removes samples, it does not slow the
sensor down. Verified RED.

### 1.2 §3.6 had no gate at all, only a namesake

The single test mentioning §3.6 asserts that GlucoDex's export now carries a sliceable cell trace
(`DEEP-AUDIT-III-FOLLOWUPS §F1.1`) — true, necessary, and **upstream** of the defect rather than at it.
Nothing pinned the arithmetic, so a revert would have re-shipped a coupling computed from the ECG side
alone under a note claiming both signals were read. Closed by a group that pins the null, the null
`directional`, the honest `n`, **and the note's wording** — the defect was as much the note as the
number. Verified RED (the mutation republishes a confident coupling with no glucose in it).

### 1.3 §6.3's gate tests the header path; the defect lived in the headerless one

Not a punch-list item — found by starting §4's sweep early, on the five FIXED sections with the fewest
test references. `parseDeviceHR`'s existing assertion (*"HR comes from the labelled column, not the
last one"*) feeds a file **with a header**, so `cols` resolves from it and the by-shape branch — the one
§6.3 actually rewrote — never executes. Reverting that branch to the old last-column rule reds
**nothing**, while on a headerless PSL row (`stamp;HR;HRV-ms`) it takes the parse from 3 rows to
**ZERO**: the last column is HRV in ms, every value falls outside the plausible-HR band, and the whole
file is rejected. That is the defect's own signature — *"it went silent, on every capture-host night"* —
reproduced under a green suite. Gated, verified RED.

**The generalisable point.** A section marked FIXED and a green suite are two facts that feel like one.
`AUDIT-PROMPT.md` already says a gate can be blind rather than green; this is that, on the audit brief
that coined the phrase. **The mutation is the evidence — the label is not.**

### 1.4 The sweep log so far

Recorded so the next pass does not repeat it. "Teeth" = reverting the fix reds assertions.

| § | fix site | verdict | reds |
|---|---|---|---|
| 3.2 | `apneaCoupling.real` permutation p | **teeth** | 2 |
| 3.3 | desat attribution carries the observer | **teeth** | 2 |
| 3.6 | autonomic⟷glycemic needs both signals | **no gate** → added | 0 → 5 |
| 4.1 | `sampleHz` native rate | **blind** → added | 0 → 6 |
| 4.2 | rate across a strap-off gap | **partial** → closed 2026-07-30 (§2.1) | 0 → 3 |
| 4.3 | IMU plausibility bound | **teeth** | 4 |
| 6.1 | abstention ≠ agreement | **teeth** | 6 |
| 6.3 | `parseDeviceHR` headerless column | **blind** → added | 0 → 2 |
| 5.2 | PulseDex LF/HF median-of-ratios | **INCONCLUSIVE** | 0 |

> **SUPERSEDED — §5.2 was resolved later the same day; see §5.2 item 4.** The "0 reds" below was an
> artefact of a `// MUTATION` marker landing mid-literal, so the module never parsed. With a `/* … */`
> marker the same edit reds 2 assertions in CI and 4 with the corpus: **§5.2 is properly gated in both
> lanes.** The paragraph is kept as written because it is the evidence trail for harness rule §5.4.

**§5.2 is explicitly not claimed either way.** The mutation (revert to ratio-of-medians) reddened
nothing, but its semantic validity was never confirmed — a probe of the same edit threw at runtime, so
the suite's 0 may mean "inert edit" rather than "blind gate". What *is* established is that the
committed PulseDex synthetic cannot express this defect regardless: its whole-record spectrum is
**LF 1 / HF 1006 / lfhf 0.001**, a degenerate ratio, and §5.2 is a *Jensen gap* that only appears when
the per-segment ratio distribution is skewed. A fixture that cannot express the failure proves nothing
— the same lesson as `INTEGRATOR-GAP-AWARE-OVERLAP` §5. Re-run this one with a deliberately skewed twin.

**Base rate so far: 3 blind or absent gates in 9 sections mutation-checked** (§3.6, §4.1, §6.3), plus
one partial (§4.2). §3.2 and §6.1 came back with real teeth (2 and 6 assertions red). The sweep in §4
is therefore not hypothetical — it is projecting from a measured ~⅓ rate.

---

## 2 · ~~Open~~ CLOSED 2026-07-30: §4.2's gate covered the reporting, not the tracking

> **Closed — see §2.1 below for the measurement, which corrects the prediction made in this section.**
> The falsifier this section asked for now exists: a stream whose true rate CHANGES across the hole
> (12 brpm → 120 s clock hole → 18 brpm), spliced test-side. Reverting the flat likelihood reds **3**.

`respiratoryRate` does two separate things about an uncovered window, and only one is gated:

1. **Reporting** — mark it `covered:false`, report `brpm:null`, leave it out of the coverage
   denominator. Gated, and correct.
2. **Tracking** — substitute a **uniform** likelihood rather than the spectrum of the interpolated
   line. `respViterbi` is a GLOBAL ridge track, so a fabricated ridge inside a hole does not merely
   mis-measure its own window, it **steers the track through clean ones too**. Replacing that flat
   likelihood with the real spectrum reds **nothing**.

The second is the subtler and more damaging half: it corrupts windows that ARE recording. It needs a
fixture whose true rate **changes across the hole** (e.g. 12 brpm before, 18 after), so a track steered
by the gap lands on the wrong side and is visible in the clean windows' rates. Two attempts at building
that stream by concatenating two `genSyntheticACC` outputs failed to produce a clock hole at all (their
stamps restart), so it wants a generator that emits one directly — `genSyntheticACC({sec, hz, brpm})`
gaining an optional `segments:[{sec,brpm},…]` is the obvious shape.

**Not gated is not the same as not fixed** — the fix is real and §4.2's reporting half is pinned. What
is missing is a falsifier for the tracking half.

### 2.1 The falsifier, built — and the symptom was not what §2 predicted

Two things in §2 above were right and one was wrong, so it is worth separating them.

**Right:** the tracking half was ungated, and the existing gap fixture *could not* see it — because its
two sides share ONE true rate, so a steered track lands on the correct answer regardless. The falsifier
needs the rate to CHANGE across the hole. Also right: the global-track mechanism.

**Right about the shape, wrong about the cost.** §2 predicted a track "steered through clean windows"
would *mis-measure* them. Measured, it does something else: the path sits off the true post-hole ridge,
so the spectral mass around it collapses and every clean post-hole window falls under `confMin` and
publishes **`null`**. The harm is a **lost** reading, not a wrong one.

| post-hole windows · true rate 18 brpm · 5 seed pairs | brpm | conf |
|---|---|---|
| flat likelihood (the fix) | **17.5 – 18.0** | 0.51 – 0.66 |
| interpolated-line spectrum (the defect) | **null** | 0.06 – 0.14 |

So a real breathing rate measured *after* a strap-off gap was silently dropped — on every seed pair
tried. That is a worse failure than a mis-measurement in one respect: a wrong number is at least
visible, whereas this one leaves the series looking merely sparse.

**On the generator.** §2 proposed teaching `genSyntheticACC` an optional `segments:[{sec,brpm},…]`. Not
taken: `motiondex-dsp.js` is inside the compute closure, so extending it moves MotionDex's `computeHash`
and **owes fixture re-verification** (§🔒) — a real cost for a fixture only the tests need. The two-rate
stream is spliced test-side instead by re-stamping a second segment onto the first, which needs no
bundle change at all. The earlier failed attempts stalled because concatenating two generator outputs
leaves both starting at the same anchor; re-stamping column 0 and the sensor-ns column fixes exactly
that.

The pre-hole side is asserted as an explicit **control**: it is upstream of the hole, so a steered track
cannot reach it and both variants read 12. If that control ever moves, the fixture has stopped isolating
the thing it was built to isolate.

---

## 3 · Deliberately not done

- **A MotionDex brief of their own.** `CPAP-AUTOHARVEST-FOLLOWUPS` §4 suggested splitting the four into
  one. With three of them already fixed *and* now gated, a new brief would be an empty container; the
  one genuinely open item (§2 above) is recorded here instead.
- **The full sweep of every remaining FIXED section.** This pass mutation-checked the four punch-list
  items (because those were the ones being closed) plus the five FIXED sections with the fewest test
  references — which is how §6.3 surfaced. The same question — *does a gate exist that can fail?* — has
  not been asked of the rest. §4 keeps it as its own work-unit rather than letting this PR sprawl.

---

## 4 · Done when

- [x] **§2's tracking falsifier — BUILT and verified RED (see §2.1); re-verified on `main` 2026-07-31.**
      Reverting the flat likelihood reds exactly **3** assertions, with post-hole confidences
      0.089 / 0.091 / 0.137 — inside the 0.06–0.14 band §2.1 measured for the defect, and well under
      the 0.39–0.66 the fix produces. The `genSyntheticACC({segments})` half of this item was
      **deliberately not taken**: `motiondex-dsp.js` is inside the compute closure, so extending the
      generator would move MotionDex's `computeHash` and owe fixture re-verification (§🔒) for a
      fixture only the tests need. The two-rate stream is spliced test-side instead, which needs no
      bundle change — see §2.1 *"On the generator"*.
- [x] **SWEEP RUN 2026-07-29 — see §5. 19 sections mutation-checked, 4 blind, base rate ~21 %.**
- [ ] ~~The same mutation sweep run across `DEEP-AUDIT-III`'s remaining FIXED sections.~~ Nine are done
      (§3.6, §4.1, §4.2, §4.3, §3.2, §6.1, §6.3, and the two screens that came back clean); **three of
      the nine were blind or absent**. A static screen on test-reference COUNT is not a substitute —
      §4.1 had 15 references and was blind, §6.3 had 5 and was blind. Only the mutation decides.

---

## 5 · The sweep, run (2026-07-29)

Every remaining FIXED section mutation-checked: revert the fix, run the suite, count what reds.

| § | verdict | reds | note |
|---|---|---|---|
| 1.1 `resolveDMY` contradictory | teeth | 10 | |
| 1.2 midnight-roll slack | teeth | 8 | |
| 1.3 PpgDex `.9995` truncate | teeth | 8 | |
| 2.1 HRVDex `_meanRR` guard | teeth | 2 | |
| **2.2 MotionDex unknown ACC unit** | **BLIND** → gated | 0 → 2 | see §5.1 |
| 2.3 `SignalSpec.cgm.unit` | teeth | 2 | |
| 3.2 `apneaCoupling.real` | teeth | 2 | |
| 3.3 desat attribution | teeth | 2 | |
| 3.4 respiration self-consensus | teeth | 2 | **only with BOTH guards reverted** — §5.2 |
| 3.5 pulse cross-check | teeth | 2 | flag-only mutation was inert — §5.2 |
| **3.6 autonomic⟷glycemic** | **no gate** → gated | 0 → 5 | |
| **4.1 `sampleHz` native rate** | **BLIND** → gated | 0 → 6 | |
| 4.2 rate across a strap-off gap | partial | 0 | reporting gated, tracking not (§2) |
| 4.3 IMU plausibility bound | teeth | 4 | |
| 5.1 PulseDex surfaced Total Power | teeth | 2 | |
| 5.2 PulseDex LF/HF | **teeth** | 2 CI · 4 corpus | earlier "inconclusive" was a BROKEN MUTATION — §5.4 |
| 6.1 abstention ≠ agreement | teeth | 6 | |
| 6.2 HRVDex duration key | teeth | 2 | |
| **6.3 `parseDeviceHR` headerless** | **BLIND** → gated | 0 → 2 | |

**Base rate: 4 blind or absent in 21 checked (~19 %)** — lower than the ~⅓ the first nine suggested,
which is the value of finishing a sweep rather than extrapolating from its opening.

### 5.1 §2.2 — the fixture agreed with the defect

`parseSensorXYZ`'s unknown-unit test feeds a `[blorp]` header whose data is **genuinely mg**, so the
honest `unit:null`-then-infer and the silent `unit:'mg'` default agree on it — and the assertion reads
`_unitInferred`, which runs identically either way. Same header with data in **m/s²**: the fix reports
`_unit:'m/s2'`, the default reports `'mg'` — a **9.8× error on every downstream magnitude**, with the
whole suite green. Gated, verified RED.

### 5.2 Five ways this method LIES, all hit during this sweep

Recorded because a mutation result is only as good as the mutation, and a false *blind* is as costly
as a false *green*:

1. **A redundant fix under-detects.** §3.4 ships TWO independent guards — fuse only within a
   temporally-overlapping group, AND collapse to one observer per node. Reverting either alone reds
   nothing, because the other still holds; reverting BOTH reds the assertion and reproduces the exact
   published defect (`"2 independent estimates (ECGDex + ECGDex)"`). Single-point mutation called this
   blind, and it is not. **Defence in depth reads as a blind gate under single-point mutation.**
2. **Mutating a published FLAG is not mutating the fix.** §3.5's first mutation flipped
   `overlapVerified` — a reported boolean — and reddened nothing. Re-aimed at the actual guard
   (`_mayOverlap` before pairing) it reds immediately. The mutation must sit where the FIX sits.
3. **An inert edit is indistinguishable from a blind gate.** §5.2 stays inconclusive on exactly this:
   the mutation reddened nothing, but its semantic validity was never established, and the committed
   PulseDex synthetic has a degenerate spectrum (LF 1 / HF 1006) that cannot express a Jensen gap.

4. **A mutation that does not PARSE reports zero reds.** The worst of the four, because the output is
   indistinguishable from a blind gate. §5.2's mutation inserted a `// MUTATION` marker **mid-line**
   inside an object literal, commenting out the rest of it (`respRate: … };`) — the module stopped
   parsing, the suite tolerated the load failure, and it reported **0 reds** three times running. With
   a `/* … */` marker instead, the SAME edit reds **2 assertions in CI and 4 with the corpus**,
   including the exact expected `hrv.frequency.lfhf: 0 != 0.207`. **§5.2 was never inconclusive — it is
   properly gated in both lanes**, and the earlier verdict was an artefact of my own broken edit.

5. **A broken red COUNTER reports a false nonzero — and that reads as confirmation.** The worst of the
   five for a different reason than item 4: items 1–4 all produce a false *blind*, which prompts more
   work. This one produces false *teeth*, which stops the investigation. Counting `grep -cE '✗|FAIL'`
   over the whole run log matches **passing assertion TEXT** — this suite has assertions named
   *"MotionDex badges fail CLOSED"* and *"GATE B banner → FAIL when FIXPROV_ERR is set"* — so a green
   run scores a **constant 6**. Four clones each reported "6 reds, gated ✓" for §9.2 while every one of
   them was blind; the giveaway was that the number was *identical* across four different files, which
   is not how real reds behave. The runner already prints a `▸ FAILURES (n)` recap and exits non-zero:
   **read the recap header, never the log body**, and treat a suspiciously uniform count as a broken
   instrument rather than a finding.

**So the rule that makes the method honest: before reporting a gate blind, prove the DEFECT is
reachable** — construct the input that separates fix from defect and show the two disagree. That is
what §5.1 does for §2.2, and what §3.4 failed and was therefore not reported. **And prove the mutated
file still PARSES**, which §5.4 below now makes mechanical.

### 5.3 §6.4 — ingest routing, checked

Three sub-fixes, two mutated: removing the rival-chest-strap vendor set-aside reds **4**; removing the
non-signal-name set-aside reds **16** (it is the guard that kept 40 of 67 "ECG recordings" on a real
capture-host night from being telemetry, `QC-SUMMARY.json` and `.archived`). Both have teeth.

### 5.4 The harness rule this sweep earned

Every mutation must be **parse-checked before the suite is run**, and the marker must never land inside
an expression:

```js
new Function(DexBuild.classicify(fs.readFileSync(file,'utf8')));   // throws ⇒ the mutation is invalid
```

Use `/* MUTATION */`, never `// MUTATION`, for any edit inside a literal or argument list. Without this,
an invalid edit and a blind gate produce identical evidence — and this sweep produced three false
"0 reds" before the rule was found. A second harness rule earned the hard way: **never edit the mutation
script while a batch is running** — doing so left a mutated `ppgdex-dsp.js` in the tree and silently
ran the next mutation on top of it, invalidating both results.

The harness that survives all five failure modes is small enough to state completely. Every clause below
exists because its absence produced a wrong answer in this sweep:

```sh
reds()   { sed -n 's/^.*▸ FAILURES (\([0-9]*\)).*$/\1/p' "$1" | head -1; }   # the RECAP, not the body
thrown() { sed -n '/▸ FAILURES/,$p' "$1" | grep -c 'group threw'; }          # >0 ⇒ MY edit is invalid
clean()  { [ -z "$(git status --porcelain)" ]; }                             # assert BEFORE mutating
mutate() { perl -0pi -e "$2" "$1" || return 1
           node --check "$1" || return 1                                     # parses?
           ! git diff --quiet -- "$1"; }                                     # actually changed?
```

`group threw` deserves its own counter rather than folding into the red count: a mutation that parses but
throws at runtime (§9.4's first attempt: `byDay is not defined`) produces plenty of reds that say nothing
about the gate. And `clean()` must run *before* each mutation, not only after — a killed or timed-out
batch leaves the tree modified (§6.1), and the next mutation then stacks on top of it.

---

## 6 · The sweep extended to `DEEP-AUDIT-II` §1 (2026-07-29)

`DEEP-AUDIT-II` §1 is an 11-defect cluster in `hrvdex-dsp.js` with **one root pattern** — a presence
gate that validates some operands and not others, so JS coerces the ungated `null` to `0` and an absent
column becomes a confident measurement. Same shape ⇒ mechanical mutations, so it is the natural place
to take the method next.

| item | fix | reds |
|---|---|---|
| 1.1 `d_sd1` ungated `_rmssd` | teeth | 4 |
| 1.2 `d_otr` gate is `_pnn50 >= 0` | teeth | 4 |
| 1.5 `d_nn50` fabricated 0 | teeth | 2 |
| 1.6 `d_hfnu` gates only the denominator | teeth | 2 |
| 1.7 `d_abs` saturates on partial absence | teeth | 2 |

| 1.3 `computeCAMQ` absent parasympathetic | teeth | 2 |
| 1.4 `d_crs` gates the wrong operands | teeth | 2 |
| 1.4b `d_pti` ungated `_rmssd` | teeth | 4 |
| 1.9 `d_welfare` denominator omitted | teeth | 4 |

**9 of 9 have teeth.** A cluster fixed as one pattern was evidently gated as one pattern — the
encouraging direction, and the opposite of what `DEEP-AUDIT-III`'s scattered one-off fixes showed.

### 6.2 Breadth — does that hold outside the cluster?

| item | verdict | reds |
|---|---|---|
| 8.3 Integrator counts long-gap interpolation as glucose | teeth | 8 |
| 7.9 `toG` case-sensitive `mg` | **defence in depth** — see below | 0 |
| 2.1 SBII counts artifact desaturations | **UNPROVEN** — see below | 0 |

**§7.9 is NOT blind.** `toG`'s case-insensitive `/^mg$/i` cannot be reached through the normal path:
`streamKindFromHeader` already normalises a `[mG]` header to `unit:'mg'` at the PARSE boundary, so by
the time `toG` runs the case has been settled. Proven by probe — a `[mG]` file yields `_unit=mg` and
identical actigraphy under both the fix and the case-sensitive revert. Same shape as §3.4: a second
guard behind a first one that already holds.

**§2.1 RESOLVED 2026-07-29 — BLIND, and the twin that proves it was already committed.** The probe was
unbuildable until the realm from `tools/regen-oxydex-goldens.mjs` was reused verbatim instead of
hand-rolling a DOM stub — that realm is the sanctioned way to drive an app-layer DSP headlessly and
should be the first tool reached for, not the last.

With it, the defect is reachable on **`synthetic_oxydex_o2ring_gap.csv`, a COMMITTED adversarial twin**:

| metric | artifact-gated (the fix) | ungated (the defect) | |
|---|---|---|---|
| SBII | 64.3 | **418.2** | **6.5×** |
| desSev | 7.8 | **18.9** | 2.4× |

…and the suite reddened **zero**. The fixture expressed the defect all along; nothing asserted on the
affected metrics — the twin is registered input-only (`pairCommitted(..., null)`), so its "invariants
are the gate", and SBII/desSev were not among them. Gated with wide ceilings (SBII < 150, desSev < 12)
rather than pinned values, so drift does not red it but a lost gating does. Verified RED.

**The lesson generalises past this item:** an adversarial twin only gates what someone asserts about
it. Committing the input is half the work, and the half that gets remembered.

### 6.3 Batch 3 — spectral, units and absence, across four nodes

| item | verdict | reds |
|---|---|---|
| 2.3 `dataGaps.gapPct` divides seconds by a sample count | teeth | 2 |
| 3.1 PulseDex Lomb–Scargle Parseval over full support | teeth | 4 |
| 3.1e ECGDex — the same `tpFull` calibration, sibling site | teeth | 2 |
| 7.4 `supineFrac` denominator counts uncovered epochs | teeth | 4 |
| 1.8 `d_sdi` gates one operand, reads the absent other as 0 | teeth | 2 |
| 1.11 `persistHRVRows` warning appended, not overwritten | teeth | 2 |

Six for six. Notably §3.1's ECGDex sibling — the SAME defect in a second file — is independently gated,
which is the pattern §1 showed at cluster scale holding at pair scale.

**Definition, since the word carries the whole result. "Teeth" = revert the fix, and at least one
assertion reds.** It says the gate is CONNECTED to the fix, not that the assertion is a good one. Its
opposite is not "a bad test" but "a green suite that would stay green without the fix at all" — and the
two are indistinguishable until you try.

### 6.4 Batch 4 — crossnight weighting and ingest pairing

| item | verdict | reds |
|---|---|---|
| 9.1 CV% divides an unweighted sd by a weighted mean | teeth | **12** |
| 10.2 `pickNearestByStamp` max-distance guard | teeth | 2 |
| 10.3 an unparseable stamp scored as epoch 0 | **defence in depth** | 0 |

**§10.3 is NOT blind.** Its null-skip is subsumed by §10.2's guard: with the fix reverted an absent
stamp scores 0, and `|0 − refMs|` is ~58 YEARS, which the 24 h distance test rejects anyway. Probed
both ways — an unstamped candidate loses to a real one, and alone returns null, identically under fix
and defect. **Fourth defence-in-depth of the sweep** (§3.4, §7.9, §10.3, and §3.5's flag).

That is now the single most common explanation for a zero: **4 of the 9 zeros this sweep produced were
redundancy, not blindness.** Which reframes the headline — the codebase is not merely gated, it is
gated with overlapping guards often enough that single-point mutation systematically UNDER-reports its
own safety.

### 6.5 Batch 5 — isolated one-off fixes, where the risk was predicted to concentrate

§6.4 chose deliberately: every blind gate so far had been an *isolated* fix, so this batch targeted
isolated fixes specifically. The prediction did not hold — four for four.

| item | verdict | reds |
|---|---|---|
| 6.4 `_hmsToMs` anchors to the recording start | teeth | 2 |
| 6.2 ODI rated over analyzable, not therapy, span | teeth | 4 |
| 6.5 badge fallback mints a fabricated `experimental` | teeth | 2 |
| 9.4 an index slope shipped under the per-day name | teeth | 2 |

**§6.5 WAS NEVER A BROWSER ITEM.** It was recorded as needing the render-coverage rigs because the
defect is FILED against `oxydex-render.js`. That is where the *symptom* renders; the **fix** was adding
registry entries to `oxydex-registry.js`, and the gate lives in the shared suite. It reds **2 assertions
in the node lane** — `got "experimental" · want "heuristic"`, the fabricated-fallback signature exactly.
Third time this sweep a fix was looked for at the brief's filed line instead of in the code that
actually changed (cf. §4.1, §3.5). **Find the fix, not the filing.**

**§9.4's first mutation was mis-targeted** — it flipped `slopeBasis`, a published *label*, and reddened
nothing. Re-aimed at the computation (`slopePerDay = byIdx.slope` instead of null) it reds immediately.
Same error as §3.5's first attempt, and the second time a *published field* was mistaken for the fix.

### 6.6 Batch 6 — and the largest blind spot of the sweep

| item | verdict | reds |
|---|---|---|
| 9.5 `bootstrapDeltaCI` LCG `Math.imul` | teeth | 4 (source-scan gate) |
| **9.3 trend direction from tau, not OLS** | **BLIND in 4 of 5 clones** → gated | 0 → 4 per clone |

**§9.3 is the sweep's biggest gap by breadth.** §9 is explicitly about *"the five `*-cross.js` clones"*,
and the tau-direction fix landed in **all five** — `grep -c 'mk.tau || 0) > 0'` returns 1 in
oxydex/ecgdex/pulsedex/ppgdex/cpapdex. The existing §9.3 group drives **`OXYCross` only**. Four fixes
carried no gate at all.

The consequence is not cosmetic. On a monotone decline with one high terminal outlier —
**tau −0.67, p 0.003** (a significant decline) against an OLS slope of **+8.65** — the published
`trendLabel` flips:

| | label |
|---|---|
| direction from tau (the fix) | `declining` |
| direction from OLS (the defect) | **`improving`** |

A **clinically inverted verdict on a significant decline**, in four nodes, with the suite fully green.
That is precisely the defect §9.3 was filed for, still live in four of five places it was "fixed".

Closed with a table-driven assertion over all five clones, driven through `crossNight(series, opts)` —
the uniform seam holding the fix — rather than each node's own `crossNightBlock`, whose input shape
differs per node and would have turned one assertion into a five-way fixture problem. Each clone gets
an anti-vacuity check that the series really does split tau from OLS. **Verified RED: 4 reds in each of
the four previously-unprotected clones.**

**The lesson, and it is the sweep's most transferable one:** §3.1's ECGDex sibling WAS independently
gated, so "same fix in two files" looked safe. At five files it was not. **A fix applied to N clones
needs a gate that iterates the clones** — one hand-picked node passes forever while the other four rot.
The suite already knows this pattern (`registry-defs-parity` iterates every node); §9.3 simply predates
it.

### 6.7 The clone survey §6.6 called for — and §9.1 is worse than §9.3

All four remaining §9 fixes are present in **all five** `*-cross.js` clones. Testing the most
peripheral one (`cpapdex-cross.js`), which no §9 assertion had ever driven:

| item | cpapdex | verdict |
|---|---|---|
| 9.3 direction from τ | 2 reds | gated per clone ✓ (closed earlier in this sweep) |
| 9.4 `slopeBasis` | 3 reds | gated per clone ✓ |
| 9.5 `Math.imul` LCG | 2 reds | gated per clone ✓ — a per-file source scan, so teeth by construction |
| **9.1 `wsd` coverage-weighted spread** | **0 reds** | **BLIND in 4 of 5** |
| **9.2 personal-baseline weights** | **0 reds** | **BLIND in 4 of 5** — see §6.8 |

So §9.3/§9.4/§9.5 are genuinely gated everywhere — the §6.6 worry does not generalise to all of §9.

> **These red counts were re-measured after the counter itself proved wrong** (§5.2 item 5). The first
> pass reported 9.4 as 2 and 9.5 as 4; the *verdicts* held, the numbers did not. §9.4's mutation also had
> to be re-aimed — the first attempt parsed but threw at runtime (`byDay is not defined`), which surfaces
> as `group threw`, not as a gate red.

**But §9.1 is worse than §9.3, and for a sharper reason.** `wsd`'s own comment states it reduces to
`sd()` **bit for bit under uniform weights** — and OxyDex's crossnight fixtures feed a uniform weight
vector. So the gate was placed in a node where **the fix is a provable no-op**, while the defect was
FOUND on *"routine CPAP partial-use"* (§9.1: 74.6 % where the consistent figure is 49.8 %).

Measured on `cpapdex-cross.js` with realistic partial-use weights — six well-covered nights plus two
6 %-coverage nights carrying wild values:

| | CV% | sd |
|---|---|---|
| weighted spread (the fix) | **36.5** | 1.9 |
| unweighted spread (the defect) | **123.6** | 6.4 |

**A 3.4× inflation of a published CV%, in four nodes, suite fully green.**

Closed with the same table-driven shape as §9.3, over all five clones, with **deliberately non-uniform
weights** — under uniform weights the assertion could not fail in ANY clone, which is exactly how the
original gate came to be vacuous. Each clone carries an anti-vacuity check that the low-coverage nights
really are down-weighted. **Verified RED: 4 reds in each of cpapdex/ecgdex/pulsedex/ppgdex** (the
oxydex re-check timed out and was not re-run — it was already gated at 12 reds).

**The sharpest lesson of the whole sweep:** a gate can be *connected to the fix* and still vacuous, if
its fixture makes the fix a no-op. "Teeth" measured on one node says nothing about a fixture that
cannot express the defect on another. **Check that the gate's own data can distinguish fix from
defect** — the anti-vacuity assertions now do that inline.

### 6.8 §9.2 — the same family, the cheaper variant

§9.2 is the third member of the family §9.1 and §9.3 belong to: the fix lives in all five clones and
the gate drove `OXYCross` only. Mutation on `cpapdex-cross.js` — reverting `priorW` to uniform weights,
which the fix's own comment notes is bit-for-bit the unweighted path — reds **nothing**.

The audit's own figures, reproduced identically through `crossNight` in all five clones (prior
`[95,95,95,60]` at `w=[1,1,1,0.06]`, newest night 80 at full coverage):

| baseline | mean | sd | zLatest | flagged (\|z\| ≥ 1) |
|---|---|---|---|---|
| weighted (the fix) | 94.31 | 5.9 | **−2.43** | **yes** |
| unweighted (the defect) | 86.25 | 17.5 | **−0.36** | **no** |

The defect is not an understatement, it is a **suppression**: −2.43σ is flagged, −0.36σ is not, so on
four of five nodes a genuine event was **never raised at all**.

**But this one is the cheaper failure, and worth distinguishing from §9.1.** §9.2's OxyDex fixture was
never *vacuous* — its 6 %-coverage night really is down-weighted, so the gate could always have failed
where it stood. It simply **was not replicated**. That is a strictly easier defect to fix than §9.1's
(no new fixture design needed, just a table) and a harder one to notice, because nothing about the
existing gate looks wrong. So the family splits into two distinct failure modes, and only mutation
separates them:

- **§9.1 · vacuous where it stands** — the fixture cannot express the defect. Needs new data.
- **§9.2 · sound where it stands, absent everywhere else** — the fixture is fine. Needs breadth.

Closed table-driven through the shared `crossNight` primitive, so one table covers every clone
regardless of each node's own stats shape, with the flag-threshold check retained as the anti-vacuity
assertion — pinning the number without pinning the decision it drives would reopen the hole one
refactor later. **Verified RED: 4 reds in each of cpapdex/ecgdex/pulsedex/ppgdex, 8 in oxydex.**
Suite green at 4348 assertions / 291 groups.

Running total: **52 sections resolved, 8 blind (~15 %)**. Every one of the last three blind gates has
been a clone family, which makes "is this fix duplicated, and is the gate?" the highest-yield question
left in the sweep.

### 6.9 Acting on that: a mechanical duplication survey

Rather than continue section-by-section, the remaining sweep now screens for the *shape* that produced
the last three findings. Every `§N.M` tag that appears in **2+ source files** is a candidate; 36 of them
do. Two were checked immediately, and they landed on opposite sides — which is the useful result, because
it says the clone risk is **not** uniform and identifies what separates the two cases.

**§12.3 — exemplary, no work needed.** The Clock Contract's out-of-range-component fix spans five files
(`clock.js` plus four deliberate node-local parsers). The gate covers **all five**, each with a
valid-input control beside each rejection — `GlucoDex · ISO 24:00:00 → next-day 00:00 (kept)` next to
`GlucoDex · hour 25 → null`, and the same for PpgDex, CPAPDex and the EDF header clock. This is exactly
the shape §9.1/§9.2 should have had.

**Why did this family get gated and the crossnight one not?** Because *the codebase's own documentation
names the duplication.* `CLAUDE.md` §✅ explicitly lists the node-local clock parsers as deliberate
variants that must not be forced onto `DexClock`, so a fixer reading it cannot miss that there are five.
**Nothing anywhere names the five `*-cross.js` clones.** The corrective is therefore documentation-shaped
as much as test-shaped: a clone family that is written down gets gated, and one that is not, does not.

**§10.1 — blind in both consumers.** The fix replaced a hardcoded pulse/oxy/hrv trio with a list derived
from the orchestrator. The gate drives `SignalOrchestrate` — **the file that got the derived list right.**
The defect lived in the two host-booting apps. Reverting either to a literal trio reds nothing.

This is a *third* distinct failure mode, and the most transferable one yet: not a clone family at all, but
**one derived source with several consumers, where the gate tests the source.** Testing the definition of
a shared invariant proves nothing about whether the callers still honour it.

Reachability, proven before reporting blind:

| | value |
|---|---|
| `emittableTypes()` | `rr · spo2 · hrv · cgm · ppg · ecg · cpap` (7) |
| hardcoded legacy trio | `rr · oxy · hrv` |
| **left with no booted host** | **`spo2 · cgm · ppg · ecg · cpap` — 5 of 7** |
| `canEmit()` on each of those five | `true` |

So the orchestrator advertises five signals it has not booted — precisely the invariant the fix
established ("a signal the orchestrator advertises via `canEmit()` is a signal it has really booted"),
and the published symptom follows: `emitNodeExport()` throws, the throw is caught into a per-file
`'run error'` blaming a co-load that **is** present, and the file silently vanishes from `exports[]`.

A detail worth keeping: the legacy trio's `'oxy'` **is not an emittable type at all** — the real one is
`'spo2'`. The pre-fix code booted a host for a signal that does not exist and skipped the one that does.

**And the scan that closes it was itself nearly hollow.** `data-unifier-app.js` was absent from
`env.sources` in **both** lanes while `overdex-app.js` was present — so a source scan over "every
host-booting surface" would have read one of the two and reported itself clean. Same omission, same
consequence, as the `motiondex-dsp.js` hole the duration-class gate found. Both lanes now list it, and
the **anti-vacuity assertion fires if either surface stops being visible**, because that hollowness is
the failure the gate exists to prevent.

Closed with a three-way source scan over files calling `.bootHosts()` (the house pattern from §7.8 —
cross-file consistency is what source inspection is legitimately for): no literal list at the call site,
no signal-type array **anywhere** in the surface (a candidate filter is just as hardcoded one line up),
and the list must derive via `emittableTypes()`/`canEmit()`. Scoped by behaviour rather than by filename,
so a third orchestrator added later is covered by construction. **Verified RED: 2 reds on
data-unifier-app.js, 1 on overdex-app.js.** Suite green at 4352 assertions.

### 6.10 The duplication survey, run to completion — and duplication is the dominant predictor

The survey was first keyed on a bare `§N.M` and reported 36 families. **That was wrong: a bare section
number is not a unique identifier** — four different briefs have a §2.4, so the count conflated
unrelated fixes. Keyed on *(brief, section)* there are **20** genuine multi-file families. All 20 are
now mutation-checked, one file each at minimum:

| family | files | verdict |
|---|---|---|
| EXPORT-IDENTITY §2.1 | 9 | gated (equiv, all 5 nodes tested) |
| DEEP-AUDIT-II §12.3 | 5 | gated — exemplary, all 4 parsers |
| DEEP-AUDIT-II §9.1 | 5 | **blind** → closed |
| DEEP-AUDIT-II §9.2 | 5 | **blind** → closed |
| DEEP-AUDIT-II §9.3 | 5 | **blind** → closed |
| DEEP-AUDIT-II §9.4 | 5 | gated |
| DEEP-AUDIT-III §6.2 | 4 | gated (equiv) |
| DEEP-AUDIT-II §10.1 | 3 | **blind** → closed |
| DEEP-AUDIT-II §3.1 | 3 | gated |
| DEEP-AUDIT-II §7.6 | 3 | gated (equiv) |
| DEEP-AUDIT-II §1.10 | 3 | **blind** → closed |
| CROSS-DEVICE-CLOCK-SKEW §3.1 | 2 | **blind** → closed |
| DEEP-AUDIT-II §10.2 | 2 | gated |
| DEEP-AUDIT-II §10.4 | 2 | **blind** → closed |
| DEEP-AUDIT-II §2.2 | 2 | **blind** → closed |
| DEEP-AUDIT-II §4.3 | 2 | **blind** → closed |
| DEEP-AUDIT-II §5.3 | 2 | gated |
| DEEP-AUDIT-II §8.1 | 2 | gated |
| DEEP-AUDIT-III §3.2 | 2 | **blind** → closed |
| DEEP-AUDIT-III-FOLLOWUPS §1.3 | 2 | **blind** → closed |

**11 of 20 were blind — 55 %, against ~20 % across the sweep as a whole.** Whether a fix is duplicated
is the strongest single predictor of whether its gate is real. That is the sweep's most actionable
finding, and it is now measured rather than suspected.

### 6.11 The rule that made the second half directed rather than exhaustive

**Any fix that changes export CONTENT is gated automatically by the equiv/golden legs.** Verified, not
assumed: dropping `recording.contentId` in **each of five nodes** reds that node's equiv leg, so
EXPORT-IDENTITY §2.1 — the largest family in the codebase — is covered by construction. §7.6 and §6.2
came back gated by the same mechanism, and neither had a bespoke assertion.

The corollary is what matters: **blind gates concentrate where the fix does NOT touch export content.**

| layer | in the export? | blind rate found |
|---|---|---|
| `*-dsp.js` export builders | yes | 0 of 5 |
| `*-cross.js` crossnight | no (not per-recording) | 3 of 5 |
| `*-render.js` | no | 3 of 4 |
| `*-app.js` / orchestration | no | 4 of 5 |

This is not a coincidence about who wrote what. The equiv legs are a **content-addressed** gate over the
whole export, so they cover every field a DSP writes without anyone having to think of it. Nothing plays
that role for a chart colour, a cross-night aggregate, or a host-boot list — so each of those needs a
gate written on purpose, and that is exactly where "the fix landed, the suite is green" stopped being
evidence.

### 6.12 Two of my OWN new gates were defective, and mutation caught both

Worth recording because it is the strongest argument for the method:

1. **A vacuous assertion.** For §1.3 I wrote `_ansPct(null) === 0`. But `Math.min(100, null)` **is** 0 —
   the assertion asserted the defect's own output and could never fail. The guard's null branch is
   documentation of intent, not behaviour; the discriminator is `undefined` (unguarded → `NaN` →
   `width:NaN%`). Kept the null case as a **labelled control**.
2. **A source scan that read a comment.** For §10.4 the scan matched `_cg.remaining.deviceRR` — in the
   line I had just commented out. Commenting a line out is exactly how such a regression arrives, so
   every scan now strips comments first. A scan over raw text measures the *file*; stripping comments is
   what makes it measure the *code*.

Both would have read as "closed" under inspection. Neither survived its own mutation.

Running total: **65 sections resolved, 15 blind (~23 %)** — and among the 20 MULTI-FILE families alone,
11 of 20 (55 %). The three failure modes now separated:

| mode | the gate… | example | cost to fix |
|---|---|---|---|
| **vacuous where it stands** | drives the right file with data that cannot express the defect | §9.1 | new fixture |
| **sound but unreplicated** | drives one clone of N | §9.2, §9.3 | a table |
| **tests the definition, not the callers** | drives the shared source, not its consumers | §10.1 | a scoped scan |

---

## 7 · The "open red" was my harness — but it uncovered a real fragility (RESOLVED 2026-07-29)

> ⚠️ **CORRECTION to what §7 first claimed.** The red was **not** a gate failure. My headless invocation
> passed **`--virtual-time-budget`**, which fast-forwards `setTimeout` relative to real CPU work — so a
> 12 s watchdog fires essentially instantly while the Worker is still computing. Proven by the fix's own
> instrumentation: the replacement stall-timer reported *"STALLED after **0** night(s)"* — zero
> heartbeats had arrived before it fired. Under that flag ANY timing assertion in this suite is void,
> and the original watchdog would fire the same way. **`--virtual-time-budget` must never be used to
> drive `Dex-Test-Suite.html`** — it silently invalidates every timing-based gate in it. That belongs in
> whatever automates the browser lane next.
>
> **What survived the correction is a genuine fragility, measured independently in Node with real
> timers**, and it is what the fix addresses.

### 7.1 The measurement

The hang guard allowed ONE fixed 12 000 ms budget for the whole 15-night pool. Running that exact
workload in Node:

| | |
|---|---|
| total workload | **9 550 – 11 363 ms** across runs |
| old budget | 12 000 ms |
| **margin** | **1.05 – 1.26×** |
| worst SINGLE night | 712 – 717 ms (its own assertion allows 1 500) |

So the gate was a **stopwatch**, not a hang guard: no night was pathological, the aggregate simply sat
on the budget. Any machine a shade slower — or the Worker + `importScripts` overhead of a real browser —
reds the one gate CLAUDE.md §🧪 requires all-green. **A flaky gate is worse than a missing one: it
teaches readers to discount reds.**

### 7.2 The fix — a hang is the ABSENCE OF PROGRESS, not slowness

The worker now emits a `{type:'progress'}` heartbeat per night and the harness **re-arms its timer on
each one**, so the guard is machine-speed independent while still catching true non-termination (no
heartbeat ⇒ stall). `STALL_MS` is sized off the worst *night*, never the total.

| | old | new |
|---|---|---|
| what it measures | total runtime | longest gap without progress |
| budget | 12 000 ms | 15 000 ms per gap |
| **headroom** | **1.26×** | **21.1×** |

Detection power is not reduced: pathological slowdown keeps its own separate assertion (the per-night
1.5 s ceiling), and a genuine hang produces no heartbeat at all. The stall message now also reports how
far it got, so *"hung immediately"* and *"hung on night 12"* are distinguishable — the old message could
tell neither apart, nor either from *"merely slow"*.

### 7.3 What is verified, and what is not

- **Verified in Node, real timers:** 15 heartbeats emitted (one per night); worst inter-beat gap 712 ms
  against a 15 000 ms stall budget — 21× headroom. Node lane green (4287).
- **NOT verified in a real browser.** Headless Chrome cannot be driven honestly here without virtual
  time (which voids the measurement), and CDP would not start in this environment. The harness half of
  the change is a twelve-line timer re-arm; it should be eyeballed on a real
  `Dex-Test-Suite.html?full` open before this is trusted as green.
- A **second** headless failure appeared under the same flag (`dashboard still populated after profile
  edit — 17 numeric tokens (was 51)`). It is very likely the same virtual-time artefact, was not present
  on the first run, and is **not** claimed as a real defect.

## 7-OLD · An open red in the canonical gate (found 2026-07-29, superseded by §7 above)

The browser lane was driven headlessly for the first time in this work —
`google-chrome --headless=new` against a local server, `Dex-Test-Suite.html?full`. It runs:
**4293 passed · 25 skipped · 303 groups.** But it is **not all-green on clean `main`**:

```
✕ processNight terminates on heavy-dropout pool (watchdog 12s)
  WATCHDOG TIMEOUT — possible processNight hang
```

A 12-second watchdog, so the likeliest reading is headless-performance sensitivity rather than a hang —
**but that has not been established, and the difference matters.** CLAUDE.md §🧪 makes
`Dex-Test-Suite.html?full` all-green the release gate, and a red nobody has adjudicated is precisely the
state this suite's culture exists to prevent. Either the watchdog needs a headless-aware budget (the way
the cold-boot iframe timeout became a ⊘ SKIP under DEX-TEST-DETERMINISM) or there is a real hang on
heavy-dropout input. **Whoever picks this up: reproduce it in a headed browser first** — if it passes
there, it is the budget; if it hangs there too, it is `processNight`.

Recorded here rather than fixed because guessing which of the two it is, and patching accordingly, is
how a watchdog gets widened around a real defect.

### 6.1 A THIRD harness rule — a killed batch leaves the tree mutated

The first attempt at this batch hit a 10-minute timeout mid-run and was killed **between mutating and
restoring**. The leftover `d_nn50` mutation then sat in the tree while the next two items ran on top of
it, so their reds were the sum of two mutations. Measured: §1.6 read **4** contaminated and **2** clean.

So, added to the harness — and this one subsumes the "don't edit the script mid-run" rule:

```sh
[ -n "$(git status --porcelain "$f")" ] && { echo "ABORT — $f is dirty before mutating"; return 1; }
```

**Assert the tree is clean BEFORE mutating, and restore with `git checkout --` rather than a temp-file
copy.** A backup taken from an already-mutated file restores the mutation. All three harness rules this
sweep produced have the same shape: *the measurement apparatus failed silently and looked exactly like
a result.* That is the same failure class the sweep itself hunts, which is either reassuring or
unsettling depending on the hour.

---

## 8 · CLOSED 2026-07-31 — both Done-when items re-verified against `main`

This brief's two open items were both already satisfied in substance; what was missing was a check
that the claims still hold, which is exactly the failure mode the brief itself is about (§1: *"fixes
ship; gates do not always follow"*). So they were re-run rather than read.

**§2's tracking falsifier still bites.** Reverting the flat likelihood in `motiondex-dsp.js` — the
one-line defect the falsifier exists to catch — reds **3** assertions on current `main`:

```
✕ §4.2 · the post-hole windows recover their true 18 brpm across the hole   — got null · want ≈18
✕ §4.2 · …and EVERY clean post-hole window reports a rate                    — [null,null,null]
✕ §4.2 · …with real confidence, not the ~0.1 a steered track leaves behind   — confs=[0.089,0.091,0.137]
```

The confidences land inside the **0.06–0.14** band §2.1 measured for the defect, against **0.39–0.66**
for the fix — so the gate is discriminating on the mechanism, not tripping on noise. The pre-hole
control held at 12 brpm in both variants, which is what proves the fixture still isolates the thing it
was built to isolate.

**The second item was struck through with nine sections already swept** (§5/§6), and its own note
records the finding that matters more than the count: **three of the nine were blind or absent**, and
a static screen on test-reference count does not predict which — §4.1 had 15 references and was blind,
§6.3 had 5 and was blind. Only the mutation decides. That conclusion is unchanged and needs no re-run.

**Nothing spawned a follow-up.** The one deliberate non-action (§2.1's `genSyntheticACC({segments})`)
is recorded with its reason — it would move MotionDex's `computeHash` and owe fixture re-verification
for a fixture only the tests need — and the test-side splice supersedes it rather than deferring it.
