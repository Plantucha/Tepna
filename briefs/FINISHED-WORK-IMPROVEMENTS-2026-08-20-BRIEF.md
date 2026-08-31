<!--
  FINISHED-WORK-IMPROVEMENTS-2026-08-20-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-20 · **Follows:** `O2RING-TIME-CAPABILITY-WIRING-2026-08-19-BRIEF.md`, `O2RING-BUZZ-FIDUCIAL-2026-08-19-BRIEF.md`, `VIGIL-OVERNIGHT-FINDINGS-2026-07-24-BRIEF.md`, `CAPTURE-FILESET-RESUME-2026-08-19-BRIEF.md`, `KNOWN-CLOCK-ADVERSARIAL-CAPTURE-FOLLOWUPS-2026-08-14-BRIEF.md`, `DEEP-AUDIT-V-FOLLOWUPS-2026-08-05-BRIEF.md`

# Improvements to finished work — the consolidated program (owner-requested survey, 2026-08-20)

> **Scope:** a PROGRAM brief — it sequences work recorded elsewhere and adds a small number of newly
> verified items. Each item cites the record that motivates it; nothing here re-litigates an
> owner-ratified decision. Where an item is another brief's open box, THAT brief stays the executable
> unit and this one only orders it.
> **Method:** three parallel domain surveys (capture-host · O2Ring/clock stack · Dex suite/Integrator)
> over DONE/REFERENCE briefs, their FOLLOWUPS, and code-comment admissions, plus a whole-repo open-brief
> inventory (68 PROPOSED/IN-PROGRESS at survey time). Every non-citation claim below was re-verified
> against the code before inclusion; survey claims that failed verification were corrected (§7).

## 0 · The one-paragraph verdict

The finished surface is in strong shape: the surveys found few defects and mostly surfaced the repo's
OWN recorded next steps sitting unexecuted. The highest-value cluster is unanimous across all three
domains — the shipped ring-RTC capability has no downstream consumer (`O2RING-TIME-CAPABILITY-WIRING`,
group A). After that: six small software wins (group B), a four-experiment evening at the box that
discharges caveats no amount of code can (group C), and the larger sequenced builds (group D).

## A · The unanimous top item — execute the time-capability wiring (software, M)

All three domain surveys independently ranked `O2RING-TIME-CAPABILITY-WIRING-2026-08-19-BRIEF.md` §2
first. The capture half is complete (#1543 readback · #1544 settings · #1548 monitor · #1564 sidecar ·
#1578 digest); nothing downstream reads it. The wiring seams, mapped in preparation:

- **2a — OxyDex `.dat` verified timebase.** The binary import (`oxydex-dsp.js` `isO2RingBin` →
  `decodeO2RingBinToCSV`) anchors absolute time on the 14-digit filename stamp — i.e. the RING RTC,
  unverified. Wire: recognise a dropped `_rtclog.csv` sidecar (RingClockLogWriter format) in the batch;
  match a `.bin`/`.dat` night to the nearest `read` event within ±12 h of its start; attach
  `timingSource:'device+host-verified'` + `rtcOffsetS` + `rtcVerifiedAtMs`; a `reset-suspect` inside the
  night's span attaches `rtcResetSuspect:true` and blocks verification. No time is SHIFTED — declare,
  never silently correct (the house rule, cf. `oxydex-dsp.js:3235`). Export: additive fields set
  CONDITIONALLY after the `recording:{}` literal (the `coveragePct` pattern), so every committed
  fixture's export stays byte-identical — no fixture churn. §1570's constraint honoured: the CSV/live
  axis is measured DRAWN; the upgrade applies to the `.dat` path only.
- **2b — Integrator veto.** Ingestion (~`integrator-dsp.js:221–320`) reads the three fields off
  `json.recording`. In the skew layer (`detectClockSkew` + pooled fit, §6126+): a measured
  `|rtcOffsetS|` above tolerance becomes a DECLARED findings entry (source `rtc-readback`) handled by
  the existing applied/attributed pipeline; `rtcResetSuspect` becomes a declared VETO — the rec is
  excluded from anchor fits and its placement flagged, never auto-shifted (a reset's offset is
  unmeasured by definition). Gate: a `tests/dex-tests.js` case where a planted reset-suspect rec is
  vetoed and a planted large offset is declared.
- **2c — trio provenance.** `trio-batch.mjs writeArrival` (~1182) gains a `ringClock` block read from
  the night dir's `*_rtclog.csv`: reads/resets/pushes counts + first/last offsets + the rows.
- **Gate cost:** OxyDex + Integrator re-bundle → orchestrators → `npm run check` full; DSP edits move
  `computeHash`, so corpus-backed fixture re-verification (`tools/verify-fixtures.mjs`) is owed after.
  One PR — 2a's export feeds 2b's veto, and splitting would race the orchestrator bundles.
- **Done when:** the parent brief's four boxes (its §4 TCH box is B3 below).

## B · Quick wins (each S, software-only, independent PRs)

1. **~~The vacuous green in OxyDex's Smart Summary~~ — EXECUTED.** ✅ **Fix landed #1626**
   (`9b1ddec0`): `_normalCnt` counts positive evidence, the reassurance branch requires
   `_normalCnt > 0`, and an else-branch renders the honest *"— no metrics scored this night."*
   Regression planted in `tests/dex-tests.js`.

   ✅ **SIBLING SCAN DONE (2026-08-31) — CLEAN NEGATIVE, and the negative is the result.**
   Scanned all **8** sibling render layers (not 6 — `motiondex-render.js` postdates this brief) for
   the same class: *a reassurance rendered from an ABSENCE rather than from counted positive
   evidence.* **No live instance.**

   ⚠️ **Each scan shape was CONTROLLED against the known pre-fix defect before its result was
   trusted** — an empty scan whose pattern cannot match the case it models is not a negative, it is
   a blind spot. Run against `9b1ddec0~1:oxydex-render.js`, both text and structural shapes flag the
   original at `:2556`/`:2528`. Five shapes: reassurance-text · `if (X.length){}else{}` ·
   `if (!X.length){}` (all 16 enumerated, all 7 with blocks read) · `.length ?` ternaries ·
   `count === 0` guards.

   **Two candidates surfaced and BOTH survive as correct** — recorded because "we looked and found
   nothing" is worth less than "we looked, found two, and here is why each is sound":
   - `integrator-render.js:1048` renders *"The fusion rules ran across the overlap … a clean
     night"* from `!cards.length`. The measurement claim is TRUE: `renderFindings` returns early on
     `!fusion.anyOverlap`, so overlap is established before that branch is reachable. **The
     positive-evidence guard exists one level up** rather than as a count — a different shape from
     §B1's fix, equally sound.
   - `motiondex-render.js:151`/`:183` render the literal `'clean'` from
     `sqi.flags && sqi.flags.length ? … : 'clean'` — an absence (`flags` undefined) would reach the
     reassurance, and the same line treats an absent `conf` honestly as `'—'`, so the asymmetry
     looks like an oversight. It is not reachable: `motionSQI` returns a `flags` array on **every**
     path including its `< 10 rows` early return (`flags: ['no-data']`), and MotionDex has no
     `loadOwnExport`, so the projected `sqi: summary.sqi.conf` form (`motiondex-dsp.js:1381`, an
     Integrator input) never re-enters this render. ⚠️ **Its safety is a property of the producer,
     not of the render** — a future re-import path, or a producer that returns bare `{conf}`, makes
     it live. Left as-is; noted so a change there is understood to have this consequence.
2. **Retention prune gated on `.archived` (VIGIL-OVERNIGHT §P3.2).** `diskguard.plan_prune` is purely
   age-based; the bypass is latent only because retention is OFF (`keep_nights: 0` — memory
   `vigil-retention-deletes-without-a-copy`). Close it before anyone enables retention: skip any night
   lacking the marker; test that a stale unarchived night never enters the plan.
3. **TCH fiducial-network decision (wiring brief §4, Done-when box 4).** The RTC cannot be a corner
   (±1 s quantum, 2–3 orders above the noise); the recorded alternative is the buzz three-way leg as a
   FIDUCIAL NETWORK. Adopt or decline, and if adopted compute a first closure residual from the
   existing run-C / morning-calibration captures (H10↔Verity pooled +140 ± 35 ms already measured).
4. **Run `o2ring-dat-timefit` routinely.** Its header claims "AUTOMATIC… runs on every night on disk…
   VALIDATES the 0xC0 time-push, which nothing else measures" — yet nothing invokes it. Hook it where
   stored `.dat`s are visible; surface the fit beside #1578's RTC digest line and flag disagreement
   beyond ±1 s + drift. The two are independent measurements of the same clock error.
5. **A genuinely blind KNOWN-CLOCK scoring run.** The `--blind-prepare`/`--blind-score` harness is
   proven end-to-end (median |err| 0.000 ppm) but one operator ran both legs
   (KNOWN-CLOCK-ADVERSARIAL-CAPTURE-FOLLOWUPS §4 says so itself). Procedural: one session prepares,
   a different session scores before seeing `TRUTH.json`, result recorded in the brief.
6. **Close the rMSSD-alternation punch-list item.** 2 of 5 suspect nights measured (both negative);
   the other 3 are absent locally, but four corpora live on vigil (memory `corpora-live-on-the-box`).
   Check vigil; if truly absent, write the retirement decision DEEP-AUDIT-IV's own text offers.

## C · The box evening — four field experiments, one session (each discharges a caveat code cannot)

Schedule together; total ≈ one supervised evening plus one worn night.

1. **Wedge drill.** Deliberately wedge/unplug the UB500 mid-capture (non-sleep session) and watch:
   ladder → btreset rung → dual-radio failover → sensors recover on hci1. Both #1583 and the P1.2/P1.3
   rung carry the identical "never observed clearing a REAL wedge" caveat; one drill clears both.
   Record in VIGIL-OVERNIGHT's header + the failover commit's field-gated note.
2. **The §5d buzz prescription.** ~10 motor-60 fires spread over ~7–8 min of ONE connection (gaps
   aperiodic, each > 1.1 s; exclude any sweep/pre-test fires BY COMMAND LIST — §5d's measured trap).
   `pat-buzz-stability.mjs` then returns CLEAN/MARGINAL/SWAMPED instead of UNRESOLVED — settling
   `pat-align.js:335`'s constancy assumption, the ΔPAT dip index's load-bearing premise, either way.
3. **Fileset-resume field verification.** One Verity duty-cycle night post-#1532 → sets/night median
   ~15 → ~1 expected; flip `CAPTURE-FILESET-RESUME` with the measured number (its only code-undischargeable box).
4. **ppg2w battery night.** Enable the flagged stream (DEVICE-RATE-TRUTH §5's own ENABLE-behind-flag
   decision), measure the first night's battery cost, record it per its §9.4 (verify in the daemon
   log, not the config file).

## D · Larger builds (M, sequenced after A)

- **Auto-fiducial at capture start** (`fiducial.enabled`, opt-in, whitelisted to 0x83, never
  mid-night, gaps > the measured 1.1 s buzz width — the buzz brief's boxes 3+5). The same scheduler,
  given a spread schedule, serves C2's prescription on every opted-in night thereafter.
- **Per-epoch adapter identity in the LINK sidecar** (KNOWN-CLOCK FOLLOWUPS §2.2) — made acute by
  #1583: a mid-night failover repoints `ADAPTER`, so an open sidecar's one-shot header can misname the
  radio for its later rows. Field-design change + campaign; "should not be made blind".
- **Pair-specific skew re-fit** (INTEGRATOR-POOLED-CLOCK-APPLY's sole open box): couplings consume a
  pair-specific offset, not the pooled compromise (H10↔Verity differ ~3.3 s on phone nights).
- **PAT anatomical-sign repair** (PAT-OFFSET-ESTIMATOR-FOLLOWUPS §3): apply the per-connection offset
  to both legs on the 7/10 impossible nights; pre-stated success = the SIGN flips, not a prettier
  number. Sequenced after C2 (constancy feeds it).
- **Allan multi-night τ-curve families** (ALLAN-DEVIATION §4's own precondition): the arrival corpus
  on vigil (398 files, ~27 usable) → per-stream σ_y(τ) families → adopt or decline a bar WITH numbers.
  Compare only at a common τ, through uncertainties.
- ✅ **DONE 2026-08-23 (#1664) — `nightqc.ok` made informative.** Excluded sessions are now classified
  by placement against THE JUDGED NIGHT'S band; only in-night holes reach `ok`, via a new
  `gaps_in_night` subset, while `gaps` stays complete so nothing is hidden. Both cases this item names
  are planted: the benign sitting is green with `[outside-band]` visible, the 2026-07-24 box-wide
  outage still reds with `[in-night]`.
  ⚠️ **The class is `outside-band`, not `daytime`, and this item's own wording is why.** The
  discriminator is the judged night's band, and something can be outside it while being the middle of
  the night — the planted case is a 00:15 sitting belonging to the PREVIOUS night. Calling that
  "daytime" would state a fact not in evidence.
  Fails closed throughout: a straddling session counts as in-night, any overlapping member condemns
  the entry, and an uncomputable band keeps every gap — the rule may only turn a red into a LABELLED
  green on positive evidence, never on absence.
  🔴 **The mutation lane found eight real gaps, seven of them pre-existing in `summarize`** (the gate
  scopes by function, so touching it makes them yours). Killed with assertions rather than excused:
  the `_pool` window's bounds at exactly midnight and exactly `_SESSION_GAP_SEC`, the earlier-side
  `gaps_in_night` path, the `> 0` overlap boundary, and `night_band` taking the session MIDPOINT
  rather than its end — those two name different nights for any session straddling 20:00.
  ⚠️ **`mutate_diff.py` run locally reports STALE survivors.** Its reusable scratch refreshes `tests/`
  but carries mutmut's RESULTS DATABASE forward, so a mutant recorded as surviving before the killing
  test existed keeps reading as a survivor. Measured here: `mutmut run <mutant>` flips it to killed
  with no source change. The failure direction is the expensive one — a false RED immune to the fix,
  which cost two rounds of chasing already-dead mutants. CI uses a fresh checkout and is unaffected;
  trust it over a local run.
- **~~`nightqc.ok` made informative~~** (superseded by the row above; original text kept for the record) (its own comments: "false on 20 of the last 20 nights… an alarm
  that is always on carries no information"): classify gap entries (in-night hole vs post-night
  daytime) by wall-clock placement vs the judged session; land as a LABELLED class, never a silent
  green; the 2026-07-24 box-wide outage must still red. Plant both as tests.
- ✅ **HALF DONE, HALF STALE 2026-08-23 — E2E fold known-answer gate** (DEEP-AUDIT-V-FOLLOWUPS Tier-4).
  This item bundles two things and they have different fates, so it is split rather than ticked:
  - **`cohort-worker.js` KIND in a reconstructed realm — DONE (#1671).** `cohort · worker · realm`
    boots the lean `pulse` KIND under `node:vm` and returns 9 scored nights. It was Tier-4's ONLY
    surviving row, and the one a grep count wrongly cleared — the single hit in `tests/` was prose in
    a comment calling it a documented gap. **Tier 4 is now 4 of 4 resolved.**
  - **"one committed-input fold reproducing a pinned summary in CI" — STALE as written.** Tier-4's own
    re-measurement (2026-08-20) already marks the E2E fold row STALE: `tch-multinight --dir` ran over
    **55 nights**, and that run found its real-data path had been dead since #1418
    (`ReferenceError: prov is not defined`), fixed in #1595. The fold is exercised; what does not exist
    is a *pinned-summary CI gate* over committed inputs, which is a different and still-open ask.
    Anyone picking it up should write it as that, not as "the fold is untested".
  ⚠️ Closing the first half reproduced Tier-4's own near-miss one layer down — a `m.err` vs `m.error`
  difference between WORKER and IFRAME producers that reads as an inconsistency and is not. The trap is
  recorded at `tests/dex-tests.js`'s new group and in the Tier-4 section: **a message shape does not
  identify its producer; trace the channel.**

## 5 · Deliberately NOT recommended (each has a record; do not re-open without new evidence)

- `hostAxis.independent` gating on `deviceDrawn` — declined with measurements (WEARABLE-HOST-AXIS
  FOLLOWUPS §3); consumers migrated node-by-node instead.
- Decoding `GET_INFO [31:33]` (frozen 2016) — "semantics unverified, do not decode" (opcode brief §9).
- The RTC as a TCH corner — structurally impossible at ±1 s (wiring brief §4).
- Node-local clock variants, fonts, badge coverage, desatProfile — CLAUDE.md §✅.
- Automating system-file-drift repair — owner-signed surface-only (Option C, 2026-08-17).
- `oxydex-dsp.js:6213` ÷N stdDev unification — on-touch cleanup only, per the audit's own text.
- The battery raw2 byte — "the log IS its characterisation"; data still accumulating.

## 6 · Sequencing

A (in flight) → B1 folded into A's OxyDex bundle churn (one re-bundle, not two) → B2–B6 as
independent small PRs in any order → C at the owner's next box evening (C2's capture then unblocks
D's PAT items) → D as capacity allows, auto-fiducial first (it compounds: every subsequent night
self-measures).

## 7 · Survey corrections (recorded so they are not re-derived)

- One survey read PAT-RELATIVE-REFRAME §5's correction as "the halves-fit leg is just unrun". It WAS
  run (2026-08-20): `pat-connection-stability` over the whole local corpus yields **2** scorable
  connections (the both-links guard), disagreeing 2.7× — carrying LINK boundaries ≠ scorable. The gate
  is data-starved locally; C2 is the instrument that isn't.
- The §5d drift decomposition (von Neumann 2.18/1.21, noise-consistent, UNRESOLVED at burst spans) rides
  #1588; landing it is a prerequisite for C2's verdict wording.

## Done when

- [~] A: the wiring brief's four boxes closed (2a gated, 2b veto fixture, 2c in a real arrival JSON, §4 decided as B3).
      **2c landed 2026-08-22** (`trio-batch.mjs` ringClock block, PR #1635). **2a + 2b landed 2026-08-23** — OxyDex now DECLARES the ring's RTC offset against a dropped `_rtclog.csv` sidecar (`timingSource:'device+host-verified'` + `rtcOffsetS` + `rtcVerifiedAtMs`, or `rtcResetSuspect:true` blocking verification) additively on `recording:{}` (the coveragePct posture, existing fixtures byte-identical); Integrator ingestion carries the fields onto the rec, `detectClockSkew` emits a `source:'rtc-readback'` finding for `|rtcOffsetS| > tolerance` (rides the existing applied/attributed pipeline), and `rtcResetSuspect` becomes a `vetoes[]` entry beside `findings[]` with the rec EXCLUDED from event-pair estimation. 14 source-scan + 10 functional (OxyDex) + 14 functional (Integrator) — 38 assertions. Fixture bytes unchanged (verified against `verify-fixtures`). §4 belongs to B3 and is B3's row (below).
- [x] B1: the vacuous green fixed + gated; the 6-sibling scan recorded (hits fixed or a clean negative written here). **Landed 2026-08-22.** Reassurance now guarded by a positive `_normalCnt > 0`; zero count falls through to an honest "no metrics scored this night" (never a green by absence). Regression: 6-assertion source-scan group patterned on the #1571 gate — plants the fix and reds on the pre-fix code (verified 5/6 red on plant-check). **Sibling scan clean negative:** the other 6 render layers grepped for the same shape (`grep -rn "all-normal|within normal range|clean night|no findings|green light"` across `*-render.js`) turned up two peers, both already honest: `integrator-render.js:1049` names both possibilities in its empty state ("a clean night, or signals that don't corroborate"), and `hrvdex-render.js:253` is the #1571 fix itself (`ari != null && ari >= 1`). No third instance survives.
- [~] B2–B6: each closed in its home brief with this brief's row ticked. **Swept 2026-08-23 — two of
      the five were ALREADY CLOSED when this brief was written or the day after, and a third's state
      is mis-stated. Verified in the files, not inferred:**

      - **B2 · retention prune gated on `.archived` — ALREADY DONE, and more strongly than the item
        asks.** `nightarchive.unarchived_nights()` exists, names `VIGIL-OVERNIGHT-FINDINGS §P3.2` as
        its purpose, and is **wired** at `capture.py:4421` into `plan_prune`'s `protect` set. It is
        also better than the item's own suggestion: B2 proposes "skip any night lacking `.archived`",
        but that module's docstring records why a marker-only gate is unsafe — measured on the box
        2026-07-25, **6 of 10 nights carried the marker while the backup volume was absent**, so
        marker-only would have deleted both copies. The shipped gate confirms the mirror **per file
        at the destination**, and a missing dest protects every night. The regression the item asks
        for exists verbatim: `test_nightarchive.py:106` — *"no second copy ⇒ nothing is deleted"* —
        alongside the dest-absent, premature-archive and `retention is HELD` warning cases.
        ⚠️ One residual, already known and tested around, recorded so it is not mistaken for a hole:
        the gate is computed only when `archive_enabled`, so `archive.enabled:false` with
        `keep_nights > 0` prunes by age alone. `test_capture_runners.py:2289` names that arm
        explicitly. It is a declared operator choice ("no second copy is being made"), not an
        oversight — but if it is ever to become a refusal, that is a **new** item, not this one.

      - **B6 · rMSSD-alternation punch-list — ALREADY RETIRED, by owner decision 2026-08-21**, the day
        after this brief was written. `DEEP-AUDIT-IV`'s header carries it: the item says "check vigil;
        if truly absent, write the retirement decision", and §7.2-RUN-II did exactly that on
        2026-08-20 — two of the three "absent" nights were on the box after all, fragmented across
        link reconnects *and* across the date directory, taking the count to **4 of 5 measured, all
        negative including the highest-ratio night**. Only 2026-08-08 (ratio 1.17) is genuinely
        absent, and it is named rather than swept. Nothing is owed here.

      - **B4 · run `o2ring-dat-timefit` routinely — HALF DONE as of 2026-08-23, and the item's wording
        is now out of date.** "Nothing invokes it" is still true, but #1647 landed the enabler the same
        day: a pure `fitDatToSpo2Csv({dat, csv, maxLag})` helper and a `--json` mode, explicitly
        labelled `§B4 prep`. What remains is only the **hook** — invoke it where stored `.dat`s are
        visible and surface the fit beside #1578's RTC digest, flagging disagreement beyond ±1 s +
        drift. Left unclaimed here deliberately: the enabler landed minutes before this sweep, so a
        session is plausibly mid-work-unit on the consumer, and §👥.2d's collision is on the remote
        between two private trees where no hook can see it.

      - **B3 · TCH fiducial-network decision — DECIDED 2026-08-23**, recorded as
        `O2RING-TIME-CAPABILITY-WIRING` §4a and its Done-when box ticked. **Adopted** as the TCH
        direction; the RTC stays declined as a corner. But the "first closure residual" half of the
        item **cannot be computed from the existing captures, and the block is structural rather than
        a data gap**: a closure needs three independently observed pairwise offsets and only
        H10↔Verity exists (+140 ± 35 ms pooled), because the ring fails its own detection band at
        2/5 · 2/5 · 2–3/5 — the sole device to do so. Worse, §4's recorded workaround (derive the ring
        onset from the command stamp plus the measured H10-leg latency) makes the three-way sum
        **identically zero by construction** — a closure that cannot fail, which is worse than none.
        Raising the buzz is not available either: the 2026-08-20 sweep found motor 60 already IS the
        through-stack floor. The untested route is the ring's OPTICAL channels as an independent
        onset; anything else is group C field work.

      - **B4 · run `o2ring-dat-timefit` routinely — DONE 2026-08-23.** `trio-batch.mjs writeArrival`
        now invokes it, recording a `datTimefit` block beside `ringClock`. Verified on a real box
        night (2026-08-13): converged, lag −9 s, spo2 −10 / pulse −9, pulseErr 0.784. Branches on
        `converged` rather than `ok`, and the cross-check against the RTC readback is gated as a pure
        function because no local night carries a `_rtclog.csv` — that branch cannot execute on this
        machine at all.

      - **B5 · a genuinely blind KNOWN-CLOCK scoring run** remains open and is **procedural: it cannot
        be discharged by one session** — its whole point is that one operator ran both legs — so a
        single session ticking it would reproduce the defect it exists to fix.
- [ ] C: all four field results recorded in their home briefs after one box session.
- [~] D items: opened as their own executable units when picked up; this brief only orders them.
      **`nightqc.ok` DONE 2026-08-23 (#1664)** — see its row in §D for the result, the `outside-band`
      naming correction, and the eight mutation kills. **`o2ring-dat-timefit` routine invocation is
      also done, in two independent halves that landed the same day**: the box side folded into the
      nightqc digest (#1663, another session) and the analysis side as a `datTimefit` block in
      `trio-batch`'s arrival sidecar (#1659, this one). Neither coordinated the split in advance and
      they compose; recorded because a future reader will otherwise wonder which one §B4 meant.
      The remaining D items are untouched.
