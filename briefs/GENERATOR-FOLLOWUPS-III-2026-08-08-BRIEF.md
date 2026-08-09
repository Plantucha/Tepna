<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** IN-PROGRESS (§1 method proven + first hit fixed · **§2 ANSWERED — no, and for two different reasons** · §3 open) · **Created:** 2026-08-08 · **Follows:** `GENERATOR-FOLLOWUPS-II-BRIEF.md` (§3 executed 2026-08-08)

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

## 2. ✅ ANSWERED 2026-08-08 — **no**, and the two candidates fail differently

Measured: MotionDex and CPAPDex are indeed the only two of the eight without a shared-axis
`.synth-line` (the other six all include `synth-gen.js` + `dex-patient-gen.js`). Neither is the ECGDex
accident, and the distinction matters because the remedies are opposite.

| | app size | multi-recording? | a SYNTH renderer to reach? | verdict |
|---|---|---|---|---|
| ECGDex (the accident) | 168 KB | **yes** | **yes** — but in an unloadable worker file | capability existed, unreachable |
| **MotionDex** | **6 KB** | **no** — no `allRecordings`, no queue, no switcher | yes (`renderXYZ`, `renderWalkACC`) | **not yet built**, not accidental |
| **CPAPDex** | 36 KB | yes | **no CPAP/EDF renderer exists in SYNTH** | **genuine gap in the shared engine** |

- **MotionDex is simply immature.** `motiondex-app.js` is 6 KB against `ecgdex-app.js`'s 168 KB, its
  `.src.html` is 8 KB, and it carries **no multi-recording machinery at all**. Its `genSyntheticACC`
  lives in the DSP but is **not on the public surface** — only `tools/regen-motiondex-goldens.mjs` and
  `tests/dex-tests.js` reach it. Wiring a shared axis here would have nothing to accumulate into; the
  multi-recording spine has to come first. **Do not treat this as the same bug.**
- **CPAPDex is the opposite shape.** It is a mature node *with* multi-recording, but the shared engine
  has **no CPAP renderer to reach** — its `_synthEdfSet` / `_synthRaw` are node-local and already
  wired into `cohort-gen.js` and `adapters/resmed-edf.js`. Closing this means *writing* a renderer
  into `synth-gen.js`, not relocating one. Bigger than §3 was, and it should be its own brief.

**So ECGDex was unique:** the only mature, multi-recording node whose renderer already existed and sat
where the app could not load it. That is why §3 was cheap and why these two are not.

> ### 🔁 RECONCILED 2026-08-08 — two answers landed, and MINE was the one that overreached
>
> §2 was answered twice, independently, within ninety minutes: the table above, and the block below.
> They agree on every measured fact and **disagreed on the verdict for MotionDex** — below called it
> **ACCIDENTAL**, the table calls it **not yet built**. The table is right, and this note retracts the
> other rather than leaving a reader to pick.
>
> **What the block below actually established is REACHABILITY**: the generator already emits bytes
> MotionDex's own parser accepts (31 200 rows). That is a real and useful fact, and it is *not* the
> ECGDex shape. ECGDex was a **mature, multi-recording** node whose renderer existed and sat where the
> app could not load it — remove the obstacle and the feature works. MotionDex has no multi-recording
> machinery to switch on: no `allRecordings`, no queue, no switcher, a 6 KB app. Reachability is not
> readiness, and calling it "accidental" implies a remedy (add the script tag) that would wire a shared
> axis to something with nothing to accumulate into.
>
> The irony is exact: **§4 below already named this gap** — *"§2 established reachability, not
> multi-recording readiness"* — and the verdict was written anyway. Flagging a limitation and then
> reasoning past it is the same failure §1 of this brief exists to catch, committed inside §1's own
> brief.
>
> **Standing verdict: the table above.** MotionDex — *not yet built*; CPAPDex — *a genuine gap in the
> shared engine*. The evidence below stands; only its MotionDex verdict is withdrawn.
>
> ---
>
> **No renderer is worker-only any more.** All eleven `render*` functions live in `synth-gen.js` and
> every one is on the `global.SYNTH` export, `renderECGInt16` included (`synth-gen.js:1092`).
> `cohort-full.js`'s same-named function is now a **thin delegate** — it forwards to `SYNTH` and keeps
> a `SYNTHREF()` fallback — not a second copy. The reverse of the §3 problem does not exist.
>
> **MotionDex — reachability PROVEN by execution rather than by comparing headers.**
> *(This paragraph's "ACCIDENTAL" verdict is WITHDRAWN — see the reconciliation note above. The
> measurement stands; the conclusion drawn from it did not.)*
> `MotionDex.src.html` loads twelve scripts and **neither `synth-gen.js` nor `dex-patient-gen.js` is
> among them**; `motiondex-app.js` contains **zero** `SYNTH`/`DexPatientGen` references (every other
> node's app carries 3–6); and there is no `.synth-line`. Yet the capability is already there and
> already fits: `renderXYZ(tl, win, 'ACC'|'GYRO')` emits
> `Phone timestamp;sensor timestamp [ns];X [mg];Y [mg];Z [mg]`, which is the exact header
> `motiondex-dsp.js:81` documents as its ACC input. Driven end-to-end in a co-loaded realm, the
> generator's bytes parse in the node's OWN parser: **`MOTIONDSP.parseSensorXYZ` returns 31 200 rows**
> from a 600 s ACC render (31 202 lines, 1.69 MB). So this is the ECGDex shape exactly — *the
> capability exists; the app cannot reach it* — and nothing was ever decided. ⚠️ **That conclusion is
> the withdrawn part.** The generator is reachable in principle; MotionDex is still not the ECGDex
> shape, because it has no multi-recording spine for a shared axis to feed.
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
- [x] **§2 answered 2026-08-08, then RECONCILED the same day** — it was answered twice independently.
      Standing verdict: MotionDex **not yet built** (reachability proven — 31 200 rows through the
      node's own parser — but no multi-recording spine, so not the ECGDex accident); CPAPDex **a
      genuine gap in the shared engine** (no CPAP/EDF renderer exists to reach). The earlier
      "accidental" verdict is withdrawn and §4's remedy order inverted with it.
- [ ] §3 cap either measured or labelled as a guess in the UI.

## 4. Spawned by §2 — MotionDex needs a multi-recording spine BEFORE a generator

> **⚠️ REWRITTEN 2026-08-08.** This section previously read *"give MotionDex the generator it already
> fits"* and led with adding the script tags. That order came from the withdrawn "accidental" verdict
> and is **wrong**: it would wire a shared axis to a node with nothing to accumulate into. The
> reconciliation in §2 inverts it.

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

**CPAPDex is a different brief.** §2's table calls it a genuine gap in the shared engine: a mature
multi-recording node with **no CPAP/EDF renderer to reach**, whose `_synthEdfSet`/`_synthRaw` are
node-local and already wired into `cohort-gen.js` and `adapters/resmed-edf.js`. Closing it means
*writing* an EDF renderer into `synth-gen.js`, not relocating one — bigger than §3 was.
