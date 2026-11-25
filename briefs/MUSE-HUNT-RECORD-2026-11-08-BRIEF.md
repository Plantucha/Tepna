<!-- SPDX-License-Identifier: Apache-2.0 · Copyright 2026 Michal Planicka -->
**Status:** DONE — 2026-11-25 · **Created:** 2026-11-08 · **Interlocks:** `briefs/RESIDUE.md` (the verified rows) · `AUDIT-PROMPT.md`

# MUSE-HUNT-RECORD — every Muse hunt finding, and its state on main

## 0 · What this brief is for

Muse delivered six board posts of findings on 2026-11-07 and 2026-11-08:

| post | lane | surface |
|---|---|---|
| `#4266` | U | ingest and export |
| `#4267` | W | the vigil monitor, the bridge and the board tools |
| `#4269` | T | the test corpus |
| `#4271` | S | the DSP cores |
| `#4272` | R | the render layer |
| `#4522` | audit | the AUDIT-PROMPT audit |

The owner asked for every finding to sit in the residue ledger or in a brief. This brief is the
record for the findings that are not a residue row. A finding that I re-read on origin/main on
2026-11-08 and that still holds is a residue row; its row key is in the table. The ledger
rules permit a row only for a verified defect. So an unverified finding stays here until a session
verifies it.

Lanes U to S were read at HEAD `02676b9cb`. The audit was read at `8c5eb957e`. A line number in
the tables is Muse's number at that HEAD. Main has moved since then, so read the function name first.

## 1 · State vocabulary

I read each open item again on 2026-11-25, on main at 680cbf2f4. I read the function, and that is the
evidence for `fixed on main`. I did not run Muse's original input for each item. The exception is
A-27, which ran as a sweep over the live functions. On that day eleven items still held: U-3, U-4,
U-5, U-6, U-7, U-9, M-4, M-5, M-6, M-7 and B-6. Each table below names the fix of an item that has one.

| state | meaning |
|---|---|
| row `<key>` | verified on main 2026-11-08; the residue row carries it |
| fixed on main | the defect does not reproduce on main; the evidence names the site |
| holds on main | I re-read the site on main and the shape is present; no row yet |
| unverified | Muse's lane result only; nobody re-read it on main |
| fixed here | a PR in this diff repairs the site; the evidence names the repair |
| hypothesis | Muse states no reproduction on real data |
| design call | Muse routed it to the owner or to a design decision |

## 2 · Acceptance

- [x] Each `unverified` and `holds on main` item below has a re-read on origin/main (2026-11-25, at 680cbf2f4).
- [x] Each item that holds has a fix PR, or it has a residue row in a RESIDUE-only PR.
- [x] Each item that does not hold has a one-line note here with the evidence.
- [x] Each `design call` item has an owner ruling or a `--kind decision` board post (#8826, 2026-11-25).
- [x] The status line moves to DONE when the four items above are true.

## 3 · Lane R — render (`#4272`)

| id | site | finding | state |
|---|---|---|---|
| R-1 | `ecgdex-app.js` tile and morph table | CVHR graded on AHI cut-points in two of four copies | row `2026-11-08-ecgdex-cvhr-keeps-ahi-cut-points-in-two-render-copies` |
| R-2 | `cpapdex-render.js` `pressureCard`, `ventCard` | night cards draw session 1 metrics | row `2026-11-08-cpapdex-night-cards-draw-session-one-metrics` |
| R-3 | HRVDex derived-metric colours | a NaN value prints a dash, but the colour ladder grades it red or green | fixed here: the population held TWO sites. `kgrade` already covered the 28 KPI ladders. This unit gives `renderTable`'s one pill site `Number.isFinite`, over 25 graded columns of 54. Measured on a NaN: 20 columns took red, 3 green, 1 yellow |
| R-4 | HRVDex Overtrain Risk | the table and the KPI strip use two contradictory ladders | fixed here: the population held THREE sites, all in `hrvdex-render.js`. One `otrRank` helper carries the only ladder now, and each site maps the rank to its own palette. A measurement chose 5 and 15, not the vote of the two agreeing sites. Over the 30-measurement Welltory export the producer's median is 5.97 and its max is 145.05. So 50 and 150 graded 28 of the 30 rows good and reached their top band on no row. The 5 and 15 cuts split the same 30 rows 13 / 12 / 5 |
| R-5a | `pulsedex-overview.js` Baevsky SI tile | null SI graded good | fixed on main: the tile uses `_kd(r.si, 150, 250)` |
| R-5b | `pulsedex-overview.js` KPI grid | HF n.u. and ABS null graded bad; LF/HF and resp rate null graded warn; coverage prints the string "null" | fixed on main: `_kc`, `_kd` and `_kn` read the null first, and every named tile carries a null arm. The string concatenation is gone |
| R-6 | `ppgdex-app.js` Poincare line | absent area printed as 0 ms² | row `2026-11-08-ppgdex-poincare-line-prints-null-and-an-absent-area-as-zero` |
| R-7 | `ppgdex-render.js` `lineChart` | no null hardening; a null y drags the axis to 0, a NaN voids the path | fixed across two units. PR #5272 dropped the non-finite point, so the axis label stopped throwing. This unit breaks the path at the gap, because a dropped point left one straight line across unmeasured time. A lone measured epoch draws a dot |
| R-8 | CPAPDex Therapy Hours tile | carries badge id `usageHours`, which resolves to the mask-on definition | fixed here. The site name was wrong: no `Therapy Hours` tile exists. The population held TWO sites, both in `cpapdex-fusion.js` and both outside the nine readers the earlier unit fixed, and outside that unit's source scan too. The deep metrics table's `usageHours` row drew and graded `night.therapyHours` under a mask-on badge. The export's `lowUsage` flag thresholded the same envelope, and it answered `false` over an absence. Both now call the resolver the other three files use. Eight planted mutants red 16 legs between them, and the scanned file set is derived from the runner's own sources rather than named |
| R-9 | `hrvdex-render.js` alerts | `_energy < 30` fires on null | row `2026-11-08-hrvdex-low-energy-alert-fires-on-a-null-energy`. The delta half is fixed on main, because `kdelta` demands `Number.isFinite` on both members |
| R-10 | `motiondex-render.js` supine row | states track length as the population | row `2026-11-08-motiondex-supine-row-states-the-wrong-denominator` |
| R-11 | OxyDex night rows | `odi4` with null rate prints "null/h" graded green; HRV chips print raw nulls; the ODI-4 tile class is ok on a dash | fixed here. All three claims hold, and the population is larger than the row named: 17 guard points over five surfaces of `oxydex-render.js`. Every graded field comes from a producer that returns a PRESENT container with null members, so `null < 5` drew the reassuring band and `null >= 4` drew the alarm band. 12 planted mutants red 12 of the 14 new legs. |
| R-12 | `hrvdex-render.js` recovery-debt chart | absent value drawn as a green 0 bar | row `2026-11-08-hrvdex-recovery-debt-chart-draws-an-absent-value-as-a-green-zero` |
| R-note | `cpapdex-render.js` | the usage row's shape has two more sites: the hero Usage subscore and the "at least 4 h compliant" chip | scope note for row `2026-11-07-the-cpap-usage-kpi-draws-the-recording-envelope-under-the-mask-on-label`; its fix must cover all three sites |

**R-3 note (2026-11-17).** The repair adds one absence arm to 28 KPI ladders in `renderKPIs`.
It moves no threshold, so R-4 still holds. The `d_otr` KPI ladder now reads through `kgrade`.

## 4 · Lane S — DSP cores (`#4271`)

Muse reports 47 lane-probe findings, 7 source-only and 11 design calls. Muse re-ran A-2, A-5 and
M-1, and re-read B-F1, B-F7 and A-4.

| id | site | finding | state |
|---|---|---|---|
| B-F7 | `ecgdex-dsp.js` `stageSleep` | an absent RMSSD stages REM | fixed on main: `rmOk` requires `e.rmssd != null` |
| B-F1 | `ecgdex-dsp.js` `_malikCorrect` | fills an unmeasurable device RR with 1000 ms | fixed on main: the fallback comment sits at the twin site |
| A-5 | `oxydex-dsp.js` `computeDesSev` | an absent second inside an event adds the full baseline | fixed on main: an absent second leaves the area loop, `desSevAbsentSec` counts it, and an event with no baseline is skipped |
| A-2 | `oxydex-dsp.js` `computeHRFlatlines` | `null === null` counts as a flatline | fixed on main: the run test carries a §∅ comment |
| A-4 | `oxydex-dsp.js` `computeSleepStabilityScore` | s5 scores a null burden rate as 100 | fixed on main: s5 is null when `hb.rate` is null |
| A-13 | `oxydex-dsp.js` `computeSpO2Autocorr` | nulls coerced in means and lag sums | fixed on main: the mean and the lag sums read measured samples, and the 300 s floor counts them again after the filter |
| A-1 | `computeOxyCrash` | a sensor dropout after flat 98 publishes a crash | fixed on main: §∅ N1-01: a delta across a hole is not a delta, and a record under 60 s gives null |
| A-3 | `computeSpO2Percentiles` | nulls sort as 0; no n | fixed on main: §∅ N1-02: the sort takes measured samples and refuses under 60 |
| A-6 | `detectODI` | no measured-sample floor; all-null gives ODI 0 | fixed on main: §∅ N1-03: a floor on MEASURED hours; an unmeasured night gives null rate and count |
| A-7 | `computePatternScores` | null `odi4.rate` passes `< 3` | fixed on main: both probability scores test `_has(odi4.rate)` before they compare |
| A-8 | `computeHypoxicLoad` | discards the supplied ODI-3 when no event derives | fixed on main: `hlRefusal` names `rows-absent` and `detector-odi3-disagree` |
| A-9 | `computeHRProfile` | null HR summed as 0 | fixed on main: `_avgPresent` over each window, and no clean pulse refuses the profile |
| A-10 | `computeSpikeDecay` | a null after the peak reads as fast recovery | fixed on main: §∅ N1-04: the decay scan requires `_has(rows[j].hr)` |
| A-11 | `oxydex-util.js` `computeCeilingBaselineArr` | an empty window gets baseline 95 | fixed on main: an absence stays out of the ceiling histogram, and an empty window gives a null ceiling |
| A-12 | `computeRollingMetrics` | window means divide by length with nulls as 0 | fixed on main: §∅ N1-08: `_avgPresent` with a 60-sample support for each window |
| A-14 | `computePBmetrics` | a null makes the window min 0 | fixed on main: §∅ N1-09: the window minimum skips an absent sample |
| A-15 | `computeNightExtras` | split-night means count nulls as 0 | fixed on main: §∅ N1-10: each half filters to finite numbers, and the ranges give null |
| A-16 | `computeHRNadirTime` | the nadir lands in a dropout | fixed on main: the running window counts rows that carry a pulse |
| A-17 | `computeO2HREfficiency` | an all-null pre-window inflates the ratio | fixed on main: §∅ N1-11: both windows go through `_avgPresent` |
| A-18 | `computeHRQuartileTrend` | an all-null first quartile gives hrQ1 0 | fixed on main: a quarter with no measured pulse refuses the trend |
| A-19 | `computeKarvonenZones` | age defaults to 49 with no assumed marker | fixed on main: the producer marks an unentered age as an assumption |
| A-21 | `glucodex-dsp.js` `coreMetrics` | n reports 1 over zero readings; a phantom panel | fixed on main: the panel is computed over measured readings, and each member is null at n 0 |
| A-22 | GlucoDex `detectSessions`, `tierOf` | a null cadence is unhandled | fixed on main: `detectSessions` publishes a null mean under 10 readings, and `tierOf` answers `unknown` for an unmeasured span |
| A-23 | GlucoDex `postprandial` | the +2 h value has no distance bound | fixed on main: the +2 h value must sit within 15 min of +2 h |
| A-24 | GlucoDex `mage` | publishes the SD as MAGE with no excursion | fixed on main: no qualifying excursion gives null |
| A-25 | GlucoDex `bgRisk` | publishes 0, 0 on no valid values | fixed on main: zero scorable readings give null for both indices |
| A-26 | GlucoDex `excursions` | an interpolated cell can be a peak | fixed on main: a non-analysable cell ends the excursion scan |
| A-27 | 14 OxyDex functions | the A-12 null-coercion shape | fixed here in part, fixed on main for the rest. I called 76 OxyDex functions with a measured record, with absent holes, and with the same holes at 0. Three answered the same for absent and for 0: `computeSpO2Entropy`, the coupling index in `computeCrossSignal`, and `computeRMSSDarc`. This PR repairs the three |
| B-F2 | `ppgdex-dsp.js` `timeDomain` | two fallbacks re-admit excluded intervals | fixed on main: §∅ N1-21: `dispersionReason` and the pair arm each refuse under their own name |
| B-F3 | `ppgdex-dsp.js` `poincare` | all-pairs fallback; ratio on a 0 denominator | fixed on main: §∅ N1-22: `pairReason` is `no-clean-adjacent-pair`, and the ratio has a bound on its denominator |
| B-F4 | `ecgdex-dsp.js` `pnn50` | 0 over zero eligible pairs | fixed on main: no eligible pair gives null |
| B-F5 | ECG and PPG `beatConfidence` | under 20 beats, every second trusts 1 | fixed on main: both mirrors mark the population out of band: `nBeats`, `nSqi`, `sqiSource` and `calibrated` |
| B-F6 | `ecgdex-dsp.js` `hrvStability` | a null epoch counts as log 0 | fixed on main: a refused epoch leaves the log series |
| B-F8 | ECG `lombScargle` | respRate 0 on a flat series | fixed on main: the respiration rate is null with `respRateReason` when no bin beats the peak |
| B-F9 | `cardiorespCoupling` | plv 0 when no window fits | fixed on main: no dominant EDR period gives null with a reason |
| B-F10 | `buildNN` | coveragePct 100 over a zero span | fixed on main: `coveragePct` is null with `coveragePctReason` over a zero span |
| B-F11 | ECG `gangliorEvents` `sqiAt` | a measured SQI of 0 becomes 0.5 | fixed on main: a measured 0 stays 0, and a record with no beat gives null |
| M-1 | `oxydex-dsp.js` `linReg` | a fit on empty or single-point input | fixed on main: `linReg` gives null on an absent pair and on a zero denominator |
| M-2 | `analysis-stats.js` `_wvar`, `sensor-trio-worker.js` | a distrusted corner reads as perfect agreement | fixed on main: `_wvar` gives null when nothing carried weight, and `tchSigmasFused` refuses the hat on a null leg |
| C-F1 | Integrator `labelPositionalApnea` | "unknown" posture counts as non-supine | fixed on main: `unknown` joins neither `supine` nor `nonsupine`; the comment above `_POS_SUPINE_RE` gives the measured case |
| C-F2 | CPAP `buildLongitudinal` | compliancePct 0 over zero measured nights | fixed on main: `compliancePct` is null with `complianceReason: no-nights` |
| C-F3 | CPAP `buildSessionFromEdf` | maxLeak 0 from zero mask-on samples | fixed on main: `maxLeak` requires `leakMaskOn.length` |
| C-F4 | CPAP `computeMetrics`, `nightMetrics` | NaN where siblings use null | fixed on main: the leak members require `leakMaskOn.length`; row `2026-11-15-cpapdex-computemetrics-nan-panel-on-empty-lanes` |
| C-F5 | PulseDex `pdComputeResult` | artifact count discarded under `artifactClean` | fixed on main: `pdComputeResult` publishes `artifactPct` and `nArtifact` from one `cleanR`, and the export coalesces both to null |
| C-F6 | PulseDex `lombScargle` | respRate 0 over zero power | fixed on main: `respRate` carries null unless `peakP > 0`, `respRateReason` names the absence, and both window roads null their median the same way |
| C-F7 | PulseDex `_bare` helpers | fabricate on zero denominators | row `2026-11-15-pulsedex-bare-estimators-fabricate-on-nulls`, which reads `fixed #5116` |
| C-F8 | HRVDex rolling windows | row-count windows with no span bound | row `2026-11-15-hrvdex-seven-day-window-has-no-span-bound`, which reads `fixed #5132`, and `_dayWindow` bounds the window by calendar day |
| C-F9 | MotionDex `bodyPosition` | a zero distribution over zero covered epochs | fixed on main: `bodyPosition` answers `hasData: false` with `unit-unknown` or a duration reason |
| C-F10 | EEGDex `analyze` | every epoch stamped conf 0.5 | fixed on main: `conf` is null on each epoch, and the comment states the contract |
| C-F11 | Integrator | a fixed conf 0.6; a correlation from one pair | fixed on main: #5100 made the confidence and the pair bounds null |
| C-F12 | MotionDex `respiratoryRate` | conf 0 on uncovered windows | fixed here: an uncovered window publishes `conf: null` |
| C-F13 | Integrator `activityEnvelope` | a NaN sample becomes 0 activity | fixed on main: #5100: the envelope writes NaN at a sample that it cannot difference |

Design calls from lane S (owner or design decision): ECG hfnu and lfnu at both-zero · PPG
`dfaAlpha1` on a flat series · ECG `validateHR` r at constant input · PPG `pickChannel` all-unscored
· GlucoDex short-gap interpolation · OxyDex successive-difference splicing · GlucoDex null cadence
with empty event lists · CPAP `_olsSlope` ordinal x · Integrator `typeApneaByEffort` default 10 s ·
EEGDex sleep-efficiency denominator · PulseDex `pttv` floor · HRVDex CAMQ averaging with no count.

## 5 · Lane U — ingest and export (`#4266`)

| id | site | finding | state |
|---|---|---|---|
| U-1 | `ppgdex-dsp.js` `parseSensorXYZ` | y and z pushed with no finite check | row `2026-11-08-parsesensorxyz-pushes-y-and-z-without-a-finite-check` |
| U-2 | `signal-frame.js` `toSignalFrame` | RR quality counts dropped | row `2026-11-08-tosignalframe-drops-the-pulsedex-artifact-counts` |
| U-3 | `dex-ingest.js` `planIngest` | PPI items filtered out and not listed in `skipped` | row `2026-11-25-planingest-drops-ppi-without-a-skipped-entry` |
| U-4 | OxyDex `parseCSV` | drops rows uncounted; positional column guess with no marker | row `2026-11-25-three-parsers-drop-rows-without-a-count` |
| U-5 | GlucoDex `parseCSV` | drops rows uncounted | fixed here: `rowsDropped` counts each row that the parser cannot use, and a `Low` or `High` row is a censored reading |
| U-6 | HRVDex summary parser | unparseable stamps dropped uncounted | row `2026-11-25-three-parsers-drop-rows-without-a-count` |
| U-7 | ECG companion parsers | band drops uncounted | row `2026-11-25-three-parsers-drop-rows-without-a-count` |
| U-8 | `parseDeviceACC` | 4 Hz default with no defaulted marker | fixed on main: `accFsSource` says `assumed` or `ms-delta`, and each consumer that spends the rate as a timebase refuses `assumed` |
| U-9 | three Polar adapters | a zero-row companion reads as no companion | row `2026-11-25-zero-row-companion-reads-as-no-companion` |
| U-10 | `resmed-edf`, `cpapdex-edf` | fs 25 fallback unmarked; session names dropped uncounted | fixed here: an unreadable BRP Flow rate gives null and a named reason, and the adapter blocks the flow |
| U-11 | `readEDF` | a duplicate label overwrites | fixed here: a repeated label gets the key `<label> #2`, and `duplicateLabels` names it |
| U-12 | OxyDex `parsePPG2W` | non-finite motion becomes 0; thin bins skipped uncounted | fixed here for the motion cell: an empty or unreadable cell is null |

## 6 · Lane W — monitor, bridge and board (`#4267`)

| id | site | finding | state |
|---|---|---|---|
| M-1 | `webmon.py` | `heartbeat_ms` not forwarded | fixed on main |
| M-2 | `webmon.py` | `seal` not forwarded | fixed on main |
| M-3 | `monitor.html` | the power block is read by nothing | row `2026-11-08-the-monitor-reads-no-o2ring-power-block` |
| M-4 | `monitor.html` `loadState` | no failure path after boot; a stale state renders as live | fixed by the monitor PR of claim #8817: one poll owner with a 15 s limit, and a banner that says "No answer from the box" with the time of the last state |
| M-5 | Batteries card | a days-old level shows as current with no age stamp | fixed by the monitor PR of claim #8817: the card names the hour of a level from a device that is not connected |
| M-6 | nights fetch | a failure leaves "no nights on disk" after the toast fades | fixed by the monitor PR of claim #8817: the card says that the list did not load, and it tries again |
| M-7 | CPAP daemon card | an unknown state renders idle with a fabricated next run | fixed by the monitor PR of claim #8817: a warning names the state |
| B-1 | `tools/ntfy-board-bridge.mjs` `classify` | disk recoveries cannot close | fixed on main |
| B-2 | the bridge | close matches content | row `2026-11-07-bridge-close-matches-content-and-a-crit-episode-cannot-close` (closed) |
| B-3 | `ackSweep` | empty acks output retires every tracked urgent | fixed on main: `planRetire` refuses and logs |
| B-4 | the bridge | escalation clock runs from arrival | fixed on main |
| B-5 | the bridge | a reopen under 2 h merges with no post | fixed on main: the merge is deliberate and `reopenMerged` counts it; the episode keeps its event time |
| B-6 | the bridge | dedup keys truncate titles to 40 characters | row `2026-11-25-ntfy-bridge-device-key-cuts-at-40-characters` |
| N-1 | `board-nudge.sh` | a parse failure sums to 0 unread | fixed on main: a failed status or an absent count line says "unread unknown, no nudge" |
| N-2 | `board.mjs` | the open-PR count is capped at 40 with no marker | logged earlier (`#4501`) |

## 7 · Lane T — tests (`#4269`)

| id | site | finding | state |
|---|---|---|---|
| T-1 | `tests/dex-tests.js` PpgDex observed-or-assumed | literal true on an absent input | fixed on main |
| T-2 | `tests/dex-tests.js` RR and PPI reach the bus | the guard passes when the input is absent | fixed on main: guarded by `if (eqP)` |
| T-3 | `tests/dex-tests.js` trio-batch | literal true when the source is absent | fixed on main |
| T-4 | `flag-exit-scan`, `flag-exit-drive` selftests | 0 legs examined, exit 0 | fixed on main: `tests.yml` counts "0 leg(s) examined" against a budget of 2 |
| T-5 | `capture-host/tests/test_o2ring.py` | `test_main_auth` asserts nothing | row `2026-11-08-test-main-auth-asserts-nothing` |

## 8 · The AUDIT-PROMPT audit (`#4522`)

| id | site | finding | state |
|---|---|---|---|
| A2-1 | HRVDex, GlucoDex, MotionDex | no crossnight emitter | row `2026-11-08-three-nodes-emit-no-crossnight-export` |
| A2-2 | `dex-ingest.js` `ppgKind` | the MARKER test is unanchored, unlike `ecgKind` | hypothesis: every real name classifies right |
| A1-obs | `signal-frame.js` | a frame defaults to intervals when a realm omits `SignalSpec` | hypothesis: no production host omits it |
