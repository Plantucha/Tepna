<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** PROPOSED · **Created:** 2026-08-08 · **Follows:** `GENERATOR-FOLLOWUPS-II-BRIEF.md` (§3 executed 2026-08-08)

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

## 2. The other nodes' renderers may have the same reachability problem in reverse

The lift put `SYNTH.renderECGInt16` beside `renderPPG` / `renderOxy` / `renderXYZ`. Worth checking
whether any OTHER renderer is still only reachable from a worker file, and whether any node is
single-recording for the same accidental reason ECGDex was. `MotionDex` and `CPAPDex` are the
candidates — neither carries a shared-axis `.synth-line` today.

> ### ✅ ANSWERED 2026-08-08 — the two candidates are NOT the same case
>
> **No renderer is worker-only any more.** All eleven `render*` functions live in `synth-gen.js` and
> every one is on the `global.SYNTH` export, `renderECGInt16` included (`synth-gen.js:1092`).
> `cohort-full.js`'s same-named function is now a **thin delegate** — it forwards to `SYNTH` and keeps
> a `SYNTHREF()` fallback — not a second copy. The reverse of the §3 problem does not exist.
>
> **MotionDex — ACCIDENTAL, and proven by execution rather than by comparing headers.**
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

## 3. The 3-night cap is a guess, not a measurement

Capped at 3 because raw µV at 130 Hz is ~3.4 M Int16 samples/night against an O2Ring night's ~1 k
rows — a size *argument*, not a measured browser limit. Nobody has profiled 3 nights of real ingest in
the app. Either measure it and set the cap from the number, or say in the control's `title` that it is
a conservative guess. Do **not** raise it on intuition; §3's own note that "ECG at ~130 Hz over many
nights is large" is the only evidence behind it.

## Done when

- [x] **§1 sweep run 2026-08-08** — 6 checkable park claims re-checked; **2 stale**
      (`INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS`, `INTEGRATOR-PAT-VASCULAR`), 2 upheld, 1 left alone,
      1 owner-confirmed. Reported, not fixed — see §1's result block.
- [x] **§2 answered 2026-08-08** for MotionDex (**accidental** — capability present and proven to parse
      in the node's own DSP, app cannot reach it) and CPAPDex (**deliberate** — its own committed
      synthetic EDF path, because EDF is binary and the generator writes text). See §2's result block.
- [ ] §3 cap either measured or labelled as a guess in the UI.

## 4. Spawned by §2 — give MotionDex the generator it already fits

§2 proved `SYNTH.renderXYZ`'s ACC/GYRO output parses in `MOTIONDSP.parseSensorXYZ` (31 200 rows), and
that `MotionDex.src.html` simply never loads `synth-gen.js`. Closing that is a source + re-bundle +
provenance change, so it is its own work-unit rather than part of an answer:

- Add `synth-gen.js` + `dex-patient-gen.js` to `MotionDex.src.html`, wire a `.synth-line` matching the
  seven nodes that have one, re-bundle MotionDex, re-stamp its provenance fragment.
- **Check the reverse before building:** whether MotionDex's app has any state that assumes exactly one
  recording, the way ECGDex's did. §2 established reachability, not multi-recording readiness.
- Do **not** extend this to CPAPDex — §2 settled that its separate EDF path is deliberate, and a second
  synthetic source for one node is a way to have two answers that disagree.
