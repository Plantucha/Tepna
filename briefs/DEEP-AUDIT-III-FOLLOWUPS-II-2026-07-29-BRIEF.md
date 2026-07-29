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
- [ ] The same mutation sweep run across `DEEP-AUDIT-III`'s remaining FIXED sections. Nine are done
      (§3.6, §4.1, §4.2, §4.3, §3.2, §6.1, §6.3, and the two screens that came back clean); **three of
      the nine were blind or absent**. A static screen on test-reference COUNT is not a substitute —
      §4.1 had 15 references and was blind, §6.3 had 5 and was blind. Only the mutation decides.
