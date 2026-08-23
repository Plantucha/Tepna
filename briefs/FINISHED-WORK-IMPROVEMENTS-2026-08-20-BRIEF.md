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

1. **The vacuous green in OxyDex's Smart Summary — VERIFIED live this survey.**
   `oxydex-render.js:2524` skips every `score === 0` metric before flagging; `:2556` then renders
   "✓ All scored metrics within normal range this night." whenever `_flagged` is empty — including a
   night where NOTHING scored (the corpus's −1-fill nights). Same class as #1571's fabricated green
   (an absence satisfying a reassurance branch). Fix: distinguish `scored === 0` ("no metrics scored
   this night") from all-normal; plant the regression the #1571 way. THEN the sibling scan across the
   other 6 render layers — the scan is the deliverable; a clean negative is a result, recorded here.
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
- **`nightqc.ok` made informative** (its own comments: "false on 20 of the last 20 nights… an alarm
  that is always on carries no information"): classify gap entries (in-night hole vs post-night
  daytime) by wall-clock placement vs the judged session; land as a LABELLED class, never a silent
  green; the 2026-07-24 box-wide outage must still red. Plant both as tests.
- **E2E fold known-answer gate** (DEEP-AUDIT-V-FOLLOWUPS Tier-4): one committed-input fold reproducing
  a pinned summary in CI; a `cohort-worker.js` KIND executed in a reconstructed realm.

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

      - **B3 · TCH fiducial-network decision** and **B5 · a genuinely blind KNOWN-CLOCK scoring run**
        remain genuinely open. B5 is **procedural and cannot be discharged by one session** — its
        whole point is that one operator ran both legs — so it needs two, and a single session ticking
        it would reproduce the defect it exists to fix.
- [ ] C: all four field results recorded in their home briefs after one box session.
- [ ] D items: opened as their own executable units when picked up; this brief only orders them.
