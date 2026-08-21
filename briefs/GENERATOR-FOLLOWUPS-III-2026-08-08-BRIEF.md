<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** DONE — 2026-08-18 (every Done-when box was already [x]; this flip only records it. §1 swept — 2 stale parks reported · §2 ANSWERED with a standing verdict (MotionDex accidental, CPAPDex deliberate) · §3 MEASURED 2026-08-16, cap stays at 3, the binding constraint is the Float32 intermediate. **§4 DEFERRED** — it is successor content, not this brief's work: a MotionDex multi-recording SPINE is the prerequisite before any generator wiring, the payoff is bounded (§2 ADDENDUM), and no session should start it without deciding multi-night MotionDex is wanted at all. No new follow-up brief spawned: §4 already IS the captured follow-up, kept in place with its full reasoning) · **Created:** 2026-08-08 · **Follows:** `GENERATOR-FOLLOWUPS-II-BRIEF.md` (§3 executed 2026-08-08)

# Generator follow-ups, Round III — what §3's execution surfaced

Three items, none blocking. Round II is DONE; these are what turned up while building it.

## 1. A whole class of "intentional" decisions may be file-placement accidents

§3 was parked for months as a product-value question — *is raw-µV multi-night coherence a real need?* —
and §0 recorded it as **"DECIDED: deliberately single-recording."** Executing it showed the cause was
that `renderECGInt16` sat in **`cohort-full.js`, a FULL-lane-worker file `ECGDex.src.html` cannot
load**. The capability existed; the app could not reach it. Nobody decided anything.

Two of the brief's own statements about its subject were also wrong (the renderer was "not factored
out" — it was; the decision comment "on `ecgdex-app.js genSynthetic`" — never existed, over all
branches). **Worth a sweep:** grep the briefs for parked items justified by capability claims, and
check the claim before re-affirming the park. `AUDIT-PROMPT.md`'s bug-classes could carry this one —
*a limitation asserted in prose that no code enforces and no measurement supports.*

> ### ✅ SWEPT 2026-08-08 — 2 of 6 checkable park claims are STALE, and neither park was re-checked
>
> Method: extract the *park reason* from each PROPOSED brief's status header — not any capability
> phrase in the file, which over-matches (`BIOME-FORMATTER` hits on "not runnable" and is `DONE`) —
> then verify each claim against the tree. **Reported, not fixed:** re-affirming or refuting a park is
> cheap; executing what a refuted park was hiding is a separate work-unit each.
>
> | brief | the claim | verdict |
> |---|---|---|
> | `INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS` | §1/§2 *"blocked on upstream OxyDex per-epoch-HR export"* | **STALE** |
> | `INTEGRATOR-PAT-VASCULAR` | drift criterion *"unmeasurable with this instrument"* | **STALE** |
> | `PPGDEX-PI-AND-PARSE-FOLLOWUPS` | §1 blocked on the gitignored `n0614a` companions | upheld |
> | `EEGDEX-BUILD` | *"No EEG corpus exists to build against"* | upheld |
> | `VIGIL-COEXISTENCE-AND-RANGE` | *"NO CODE WORK REMAINS"* | re-measured 2026-08-04, left alone |
> | `R5-HR-TRIPLET-REFERENCE` | *"the hardware does not exist"* | owner-confirmed, not checkable here |
>
> **`INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS` — the blocker cleared the same day it was written.**
> `OXYDEX-PER-EPOCH-HR-EXPORT-2026-07-04-BRIEF.md` is **DONE — 2026-07-04**, and `oxydex-dsp.js:6618`
> ships the per-epoch cross-node series under a comment naming *this brief's §2* as its reason. The
> header is also **self-contradictory**: it says "§1/§2 remain PROPOSED — blocked on upstream OxyDex
> per-epoch-HR export" and, further along, "§1/§2 CODE LANDED — 2026-07-04". A reader working the
> header top-to-bottom hits the block first.
>
> **`INTEGRATOR-PAT-VASCULAR` — the park was true when written and is false now.** Parked 2026-07-29
> on two capability claims: the drift criterion is *"unmeasurable with this instrument"*, and
> *"single-host and phone-stamped capture are indistinguishable"*. Both instruments now exist and
> **postdate the park**:
> - `tools/dual-clock-rate.mjs` (landed **2026-08-03**, five days later) regresses host stamps against
>   device stamps inside each raw fragment — device rate in ppm, directly, no beat matching. It is what
>   `WEARABLE-DRIFT-DIRECT` used to put inter-device drift at ~7 ppm.
> - `clock.js:356` publishes `independent = spreadMs > CK_AXIS_INERT_MS` (2 ms) — *precisely* the
>   single-host-vs-phone-stamped discriminator the park calls impossible, and `CLAUDE.md` §7 records the
>   bimodal evidence behind it (box captures 101.89–5124 ms, phone captures 0.13–1.00 ms, nothing
>   between).
>
> ⚠️ **The park still stands, on its other leg.** §2's kill criterion was NO-GO on **coupling**, and
> that was measured twice (0 of 54 pairings clear the gate; re-measured offset-free, unchanged) —
> `PAT-UNDER-PERBLOCK-ALIGNMENT` independently concluded the obstacle is pulse-transit-time variability,
> not alignment. So this is a **stale justification inside a park that survives for a different reason**,
> which is exactly the shape that makes these expensive: the wrong sentence is the one a future reader
> would cite when deciding whether to re-open.
>
> **Two method notes, both paid for during the sweep.** A capability phrase anywhere in a header is not
> a park reason (`BIOME-FORMATTER`). And a date matched inside a filename is not a date — `*0614*`
> returns `…20260718180614_PPG.txt`, whose "0614" is the time field 18:06:14; the `n0614a` companions
> are genuinely absent (the capture corpus starts 2026-07-16, zero June directories).

> ### THIRD PASS 2026-08-20 — the sweep's SCOPE is the blind spot, and it hid the two live instances
>
> The 2026-08-08 method is stated above and is deliberate: *"extract the park reason from each
> **PROPOSED** brief's **status header**"*. That scoping is what gave it precision — and it is also why
> it saw neither instance that was live on 2026-08-20. **Both are `DONE` briefs carrying the stale
> claim in the BODY**, which the method cannot reach by construction:
>
> | brief | the claim | why the sweep missed it | verdict |
> |---|---|---|---|
> | `DEX-TEST-SUITE-LAZY-FOLLOWUPS` §1 | *"could not run Node/playwright in this environment"* | status is DONE; claim is in §1 body | **STALE** — the owed command ran clean 2026-08-20 (`✓ browser gates passed`, 7584 assertions), and `browser-gates.yml` has run exactly it as a REQUIRED check for months |
> | `INTEGRATOR-TCH-FOLLOWUPS-III` §1 | *"data-gated … needs more nights' three node-export JSONs committed"* (24 nights) | status is DONE; claim is in the header's tail prose, not a park reason | **STALE** — 54 nights now carry all three; the harness behind it was also broken (#1595) |
>
> **So the class has two sub-shapes, and only one of them was being swept.** Measured over every DONE
> brief:
>
> - **capability sub-shape** — a capability claim, a *named unblock condition* and a deferral verb
>   co-located within ±2 lines. Returns **exactly the two rows above, with zero false positives**. ⚠️ It
>   was written *after* seeing them, so its **precision is measured and its recall is not**; a bare
>   capability phrase over-matches badly (100 DONE briefs / 169 hits), which is the same over-match the
>   2026-08-08 method notes already warned about.
> - **brief-dependency sub-shape** — "deferred/blocked **behind** `<brief>`" where that brief is now
>   `DONE`. Fully mechanical, no NLP. Corpus-wide there is **exactly 1** such edge —
>   `PAPER-ODI4-REPRODUCIBILITY` §6.6 behind `SYNTH-GEN-DESAT-KINETICS` — and it is **already resolved**
>   (that brief's §7.1, *"the deferral's blocker had been gone for two days"*, and it counts itself the
>   **fourth** stale premise found that way). **Zero live edges today.**
>
> ⚠️ **That zero is only believable because a control fires, and two earlier zeros were FALSE.** The
> query returned 0 twice before it was right: once because the reference regex required a
> `-BRIEF.md` suffix the corpus does not always write (`§6.6 deferred the pin behind
> `SYNTH-GEN-DESAT-KINETICS`` — bare stem), and once because it accepted `Deferred → X` as a
> dependency when the arrow means *handed off to* X, the opposite relation — 16 of 16 edges were
> handoffs. Both zeros read exactly like a clean negative. Retaining the one known positive as a
> control is what separated them.
>
> **Not proposed as a gate.** The capability sub-shape needs judgement (a phrase is not a park reason)
> and the dependency sub-shape currently has nothing to find. What is worth carrying forward is the
> scope correction: **re-checking parks must read DONE briefs' bodies, not only PROPOSED headers** —
> a claim inside a closed brief is exactly where nobody looks again, and it is where both live ones were.

> ### SECOND PASS 2026-08-08 — the streak breaks, and how it breaks refines the method
>
> `MUTATION-EQUIVALENCE-2026-08-04` checked, since it carries the densest capability language in the
> `PROPOSED` set. **Its claims hold** — two verified structurally *and* by execution:
>
> - **"`L120` `ms > 999` — unreachable by construction."** ✅ `_ckMk` is **not exported** (`DexClock`
>   publishes `tzOffset · _ckP2 · _ckNumEpoch · _ckZoneMin · _ckDMY · resolveDMY · parseTimestamp ·
>   hostAxis · _ckMedian`), so it is reachable only via `parseTimestamp`; the two sites that pass `ms`
>   capture `(\d{1,3})\d*` then `+(m[7]+'00').slice(0,3)`, which cannot exceed three characters, and
>   every other caller passes no `ms`. Probed with `.9999999` / `.123456789` / `.99999`: **max
>   reachable ms component = exactly 999.**
> - **"`L45` ×2 / `L147`: `parseInt(s,10) → parseInt(s,0)` is equivalent for `/^\d+$/`."** ✅ No
>   digit-only string differs across the two radices (`0`, `00`, `007`, `08`, `09`, `0123`, 13-digit
>   epochs); `0x10` does differ, and the regex excludes it.
>
> **Tally across both passes: 8 claims, 4 stale, 4 upheld** — and the split is not random.
>
> | claim shape | examples | outcome |
> |---|---|---|
> | *"X exists / does not exist"* — about an **artifact** (a comment, a factored-out function, a hardware module, an upstream export) | GENERATOR-FOLLOWUPS-II ×2 · AUDIT-FOLLOWUPS · INTEGRATOR-TCH-FOLLOWUPS · INTEGRATOR-PAT-VASCULAR | **stale** |
> | *"X cannot happen **because** ‹stated mechanism›"* — about **semantics**, reasoning shown | MUTATION-EQUIVALENCE ×2 · EEGDEX-BUILD · PPGDEX-PI-AND-PARSE-FOLLOWUPS | **upheld** |
>
> **Refinement:** an artifact claim is *memory* — true when written, decaying silently as the tree
> moves, with nothing re-checking it. A mechanism claim is *derivation* — it carries its own falsifier,
> so the author had to be right at the time and a reader can re-run the argument in one step.
> **Prioritise claims that name an artifact; deprioritise claims that state a mechanism.** That
> inverts the intuition that a bare factual claim is the safer kind — and this pass proved the rule on
> itself: #1055's "no CPAP/EDF renderer exists" was an artifact claim, made from one export list, and
> it was wrong (§2 addendum).
>
> **Still unchecked:** `PAT-UNDER-PERBLOCK-ALIGNMENT-2026-08-02` ·
> `CAPTURE-HOST-DEEP-AUDIT-FOLLOWUPS-II-2026-08-05` (mostly about the remote box — needs `ssh vigil`) ·
> `O2RING-FRAME-SAMPLE-LOCK-FOLLOWUPS-2026-08-03` (which **already self-corrected** one such claim at
> §2.1 — *"before writing that something cannot be measured, look for the oblique measurement"* — this
> thesis, reached independently).

## 2. The other nodes' renderers may have the same reachability problem in reverse

The lift put `SYNTH.renderECGInt16` beside `renderPPG` / `renderOxy` / `renderXYZ`. Worth checking
whether any OTHER renderer is still only reachable from a worker file, and whether any node is
single-recording for the same accidental reason ECGDex was. `MotionDex` and `CPAPDex` are the
candidates — neither carries a shared-axis `.synth-line` today.

> ### ↩️ WITHDRAWN 2026-08-08 — this block reconciled the two §2 answers, and it was wrong
>
> It argued the "accidental" verdict should be retracted in favour of "not yet built". The
> ADDENDUM further down answers that directly and is correct: **the two are not competing
> verdicts.** "Accidental" describes WHY the wiring is absent — nobody decided, it never got
> wired — while the missing multi-recording spine bounds WHAT wiring it buys. Retracting the
> first to state the second was a category error, and it briefly left this brief contradicting
> itself. The standing §2 verdict is the header's: **MotionDex accidental, CPAPDex deliberate.**
>
> §4's remedy ORDER survives this withdrawal on the ADDENDUM's own reasoning — the payoff is
> bounded, so the spine is the prerequisite if multi-night is the goal — and is kept.
>
> **No renderer is worker-only any more.** All eleven `render*` functions live in `synth-gen.js` and
> every one is on the `global.SYNTH` export, `renderECGInt16` included (`synth-gen.js:1092`).
> `cohort-full.js`'s same-named function is now a **thin delegate** — it forwards to `SYNTH` and keeps
> a `SYNTHREF()` fallback — not a second copy. The reverse of the §3 problem does not exist.
>
> **MotionDex — reachability PROVEN by execution rather than by comparing headers.**
> `MotionDex.src.html` loads twelve scripts and **neither `synth-gen.js` nor `dex-patient-gen.js` is
> among them**; `motiondex-app.js` contains **zero** `SYNTH`/`DexPatientGen` references (every other
> node's app carries 3–6); and there is no `.synth-line`. Yet the capability is already there and
> already fits: `renderXYZ(tl, win, 'ACC'|'GYRO')` emits
> `Phone timestamp;sensor timestamp [ns];X [mg];Y [mg];Z [mg]`, which is the exact header
> `motiondex-dsp.js:81` documents as its ACC input. Driven end-to-end in a co-loaded realm, the
> generator's bytes parse in the node's OWN parser: **`MOTIONDSP.parseSensorXYZ` returns 31 200 rows**
> from a 600 s ACC render (31 202 lines, 1.69 MB). So this is the ECGDex shape exactly — *the
> capability exists; the app cannot reach it* — and nothing was ever decided.
>
> **CPAPDex — DELIBERATE, and a different mechanism, not a missing one.** The text-line generator has
> **no EDF renderer at all** (the `cpap:` fields in `synth-gen.js` are night-scenario metadata, not a
> file writer), because EDF is binary. CPAPDex instead ships its own **committed synthetic EDF set**
> from `tools/make-synthetic-edf.mjs` — closed-form waveforms calibrated to a real corpus's
> distributions, carrying no person and no device identifier, committed as `uploads/*_BRP|CSL|EVE|PLD.edf`.
> That path was built deliberately, and hardened: the demo used to fetch ten **real gitignored**
> AirSense files, so on any fresh clone all ten 404'd and *the shipped demo had never worked for anyone
> but the maintainer*. Absence of a `.synth-line` here is a consequence of that design, not an accident.
>
> **Recorded, not fixed.** Giving MotionDex the generator is a `MotionDex.src.html` + re-bundle +
> provenance change, which is outside this item's "answer it" scope — carried to §4 below rather than
> smuggled into a docs answer.
>
> **Reproduce:** load `clock.js` + `synth-gen.js` + `kernel-constants.js` + `signal-frame.js` +
> `motiondex-dsp.js` into one realm, then
> `MOTIONDSP.parseSensorXYZ(SYNTH.renderXYZ(tl, {startRel:0,lenSec:600}, 'ACC'))`.

> ### ⚠️ ADDENDUM 2026-08-08 — this section was OVERWRITTEN by a concurrent session and is restored
>
> Everything above is the original #1034 answer. A parallel session (#1055) replaced it wholesale with
> its own §2 whose base predated #1034, so the merge kept the newer text and silently dropped this one.
> Nothing was conflicted, nothing was flagged, and the brief was left contradicting its own §4 for two
> commits. Restored here because the execution proof above — `MOTIONDSP.parseSensorXYZ` returning
> **31 200 rows** from a `renderXYZ` render — is stronger evidence than the header-comparison that
> displaced it, and because **#1055 got CPAPDex wrong.**
>
> **RETRACTED from #1055: "no CPAP/EDF renderer exists in SYNTH — a genuine gap in the shared engine."**
> False. `tools/make-synthetic-edf.mjs` (9.6 KB) ships a committed synthetic EDF set —
> `uploads/20260613_231433_{BRP,CSL,EVE,PLD}.edf`, four tracked files. CPAPDex's synthetic path is
> **deliberate and built**, exactly as this section said; it simply is not in `synth-gen.js`, because
> EDF is binary. A "missing renderer" reading came from looking only at `synth-gen.js`'s export list —
> the same one-place-to-look error the sweep in §1 exists to catch, committed while executing §1.
>
> **KEPT from #1055, because it answers a question this section deferred and §4 explicitly asks.**
> §4 says *"check the reverse before building: whether MotionDex's app has any state that assumes
> exactly one recording, the way ECGDex's did."* Measured: **it has no such state, because it has no
> multi-recording state at all.** `motiondex-app.js` is **6 KB** against `ecgdex-app.js`'s 168 KB, its
> `.src.html` is 8 KB, and it carries no `allRecordings`, no load queue and no recording switcher;
> `genSyntheticACC` exists in the DSP but is **not on the public surface** (only
> `tools/regen-motiondex-goldens.mjs` and `tests/dex-tests.js` reach it).
>
> That does not overturn "accidental" — the renderer *is* reachable and the app *does* simply fail to
> load it, both proven above. It bounds the **payoff**: wiring the axis gives MotionDex a synthetic
> **single** recording, not the multi-night coherence §3 bought ECGDex, because there is no spine to
> accumulate into. §4 is still worth doing; it is a smaller win than the §3 precedent implies, and the
> multi-recording spine is the prerequisite if multi-night is the goal.

## 3. The 3-night cap is a guess, not a measurement — **MEASURED 2026-08-16, and the guess was RIGHT**

Capped at 3 because raw µV at 130 Hz is ~3.4 M Int16 samples/night against an O2Ring night's ~1 k
rows — a size *argument*, not a measured browser limit. Nobody has profiled 3 nights of real ingest in
the app. Either measure it and set the cap from the number, or say in the control's `title` that it is
a conservative guess. Do **not** raise it on intuition; §3's own note that "ECG at ~130 Hz over many
nights is large" is the only evidence behind it.

### 3-RESULT · The number, and why the cap stays at 3

Ran the real `SYNTH.renderECGInt16` + `ECGDSP.bandpass`/`detectPeaks` over three
`DexPatientGen.resolve('baseline', 3)` nights, in one realm, measuring wall-clock and RSS.

| | measured |
|---|---|
| samples per night | **3,439,410 / 3,547,050 / 3,634,410** |
| 3 nights, Int16 storage | 10,620,870 samples = **20.3 MB** |
| generation | 1,203 ms (≈ 395 ms/night) |
| bandpass + detectPeaks | 506 ms (≈ 170 ms/night) |
| **total for 3 nights** | **≈ 1.7 s** |
| peak RSS | **244 MB**, from a 48 MB baseline ⇒ **≈ 196 MB** for three nights held at once |

**The brief's premise was exactly right** — "~3.4 M Int16 samples per night" is 3.44 M measured. What
was missing was the consequence, and the consequence is not the Int16 storage.

**The binding constraint is the Float32 intermediate, not the raw samples.** 20.3 MB of Int16 becomes
≈ 196 MB resident, because the analysis path converts each night to `Float32Array` (4 bytes/sample =
13.8 MB/night on top of the 6.9 MB Int16) and the app **accumulates** into `allRecordings` rather than
releasing. Three nights is comfortable. Linear in nights, **14 — what every other node offers — projects
to ≈ 900 MB resident**, which is a real tab risk rather than a hypothetical one.

**So the cap stays at 3, now for a measured reason instead of a size intuition, and the `title` needs no
"it's a guess" hedge because it is no longer one.** This closes the §3 box by the *measure* branch, so
no UI change and no re-bundle is owed.

⚠️ **What this measurement does NOT establish**, stated so the number is not over-quoted:
- It is **Node, not a browser** — no DOM, no rendering, no tab memory ceiling. It bounds the compute and
  the allocation, which is what the cap's own rationale was about, not the full in-app ingest.
- It measures **cost, not correctness**: `detectPeaks` returned no beat count under my scaling, and I did
  not chase it, because the question was how expensive three nights are, not whether the synthetic beats
  are right. Do not cite this run as evidence the pipeline works.
- **The 14-night projection is linear extrapolation**, not a run. It is a reason not to raise the cap,
  not a measurement of 14 nights.

## Done when

- [x] **§1 sweep run 2026-08-08** — 6 checkable park claims re-checked; **2 stale**
      (`INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS`, `INTEGRATOR-PAT-VASCULAR`), 2 upheld, 1 left alone,
      1 owner-confirmed. Reported, not fixed — see §1's result block.
- [x] **§2 answered 2026-08-08** — three times, by two sessions, with one overwrite and one bad
      reconciliation on the way. Standing verdict: **MotionDex accidental** (the renderer is reachable,
      proven by execution — 31 200 rows through the node's own parser — and the app simply never loads
      it; nothing was decided) and **CPAPDex deliberate** (its committed synthetic EDF set from
      `tools/make-synthetic-edf.mjs` is a built path, not a gap). What the multi-recording evidence
      adds is not a competing verdict but a **bound on the payoff**, which is why §4 orders the spine
      first. See §2's ADDENDUM, and the withdrawal note above it.
- [x] **§3 MEASURED 2026-08-16 — the cap stays at 3, and the guess was right.** 3 nights = 10.6 M
      Int16 samples (20.3 MB) but **≈196 MB resident**, because the analysis path converts each night
      to `Float32Array` and the app accumulates rather than releasing. ≈1.7 s total. The binding
      constraint is the intermediate, not the raw samples; 14 nights projects to ≈900 MB. Closed by
      the *measure* branch, so no UI hedge and no re-bundle — see §3-RESULT for what the run does
      and does not establish (Node not browser; cost not correctness).

## 4. DEFERRED (successor content, see header) — MotionDex needs a multi-recording spine BEFORE a generator

> **⚠️ REWRITTEN 2026-08-08.** This section previously read *"give MotionDex the generator it already
> fits"* and led with adding the script tags. The ordering is wrong, but **not because "accidental"
> was wrong** — that verdict stands, and the note that tried to retract it is itself withdrawn in §2.
> The reason is the one §2's ADDENDUM gives: wiring the axis to a node with no multi-recording spine
> yields a synthetic **single** recording, not the multi-night coherence the §3 precedent implies. The
> payoff is bounded, so the spine is the prerequisite if multi-night is the goal.

§2 established two things that must not be conflated. **Reachability:** `SYNTH.renderXYZ`'s ACC/GYRO
output parses in `MOTIONDSP.parseSensorXYZ` (31 200 rows), so the engine already emits bytes this node
accepts. **Readiness:** it has none — `motiondex-app.js` is 6 KB with no `allRecordings`, no queue, no
switcher, and `genSyntheticACC` is not on the public surface (only `tools/regen-motiondex-goldens.mjs`
and `tests/dex-tests.js` reach it).

So the work is a node feature, not a wiring fix, and in this order:

1. **Give MotionDex a multi-recording spine** — the accumulate/queue/switch machinery the other seven
   nodes have. This is the actual work and it is not small.
2. **Only then** add `synth-gen.js` + `dex-patient-gen.js` to `MotionDex.src.html`, wire the
   `.synth-line`, re-bundle, re-stamp the provenance fragment. Cheap, once there is something to feed.
3. **Do not do step 2 alone.** A `.synth-line` on a single-recording app is a control that appears to
   work and accumulates nothing — worse than its absence, because it looks answered.

**Do not extend any of this to CPAPDex.** §2's table called it "a genuine gap in the shared engine",
and the ADDENDUM **retracted that**: `tools/make-synthetic-edf.mjs` ships a committed synthetic EDF
set (`uploads/20260613_231433_{BRP,CSL,EVE,PLD}.edf`, four tracked files), so CPAPDex's synthetic path
is deliberate and **built** — it simply does not live in `synth-gen.js`, because EDF is binary and that
generator writes text. There is nothing to spawn here. Adding a second synthetic source for a node that
already has a working one is how you end up with two answers that disagree.
