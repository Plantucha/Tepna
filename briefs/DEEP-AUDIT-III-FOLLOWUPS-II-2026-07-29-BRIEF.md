<!--
  DEEP-AUDIT-III-FOLLOWUPS-II-2026-07-29-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-07-29 · **Follows:** `DEEP-AUDIT-III-2026-07-26-BRIEF.md` (DONE 2026-07-29) · **Sibling:** `DEEP-AUDIT-III-FOLLOWUPS-2026-07-27-BRIEF.md` (DONE, §1/§2/§3 scope)

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
| **4.2** rate across a strap-off gap | real | partial | 0 assertions red (see §2) |
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
| 4.2 | rate across a strap-off gap | **partial** (see §2) | 0 |
| 4.3 | IMU plausibility bound | **teeth** | 4 |
| 6.1 | abstention ≠ agreement | **teeth** | 6 |
| 6.3 | `parseDeviceHR` headerless column | **blind** → added | 0 → 2 |
| 5.2 | PulseDex LF/HF median-of-ratios | **INCONCLUSIVE** | 0 |

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

## 2 · Open: §4.2's gate covers the reporting, not the tracking

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

- [ ] §2 a `genSyntheticACC` that can emit a rate CHANGE across a real clock hole, and a §4.2 tracking
      falsifier built on it, verified RED against a flat-likelihood revert
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

### 5.2 Three ways this method LIES, all hit during this sweep

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

Running total: **33 sections resolved, 5 blind (~15 %)**.

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
