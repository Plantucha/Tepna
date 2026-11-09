<!-- SPDX-License-Identifier: Apache-2.0 · Copyright 2026 Michal Planicka -->
**Status:** PROPOSED — 2026-11-08 · **Created:** 2026-11-08 · **Interlocks:** `briefs/RESIDUE.md` (the verified rows) · `AUDIT-PROMPT.md`

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

| state | meaning |
|---|---|
| row `<key>` | verified on main 2026-11-08; the residue row carries it |
| fixed on main | the defect does not reproduce on main; the evidence names the site |
| holds on main | I re-read the site on main and the shape is present; no row yet |
| unverified | Muse's lane result only; nobody re-read it on main |
| hypothesis | Muse states no reproduction on real data |
| design call | Muse routed it to the owner or to a design decision |

## 2 · Acceptance

- [ ] Each `unverified` and `holds on main` item below has a re-read on origin/main.
- [ ] Each item that holds has a fix PR, or it has a residue row in a RESIDUE-only PR.
- [ ] Each item that does not hold has a one-line note here with the evidence.
- [ ] Each `design call` item has an owner ruling or a `--kind decision` board post.
- [ ] The status line moves to DONE when the four items above are true.

## 3 · Lane R — render (`#4272`)

| id | site | finding | state |
|---|---|---|---|
| R-1 | `ecgdex-app.js` tile and morph table | CVHR graded on AHI cut-points in two of four copies | row `2026-11-08-ecgdex-cvhr-keeps-ahi-cut-points-in-two-render-copies` |
| R-2 | `cpapdex-render.js` `pressureCard`, `ventCard` | night cards draw session 1 metrics | row `2026-11-08-cpapdex-night-cards-draw-session-one-metrics` |
| R-3 | HRVDex derived-metric colours | a NaN value prints a dash, but the colour ladder grades it red or green | unverified |
| R-4 | HRVDex Overtrain Risk | the table and the KPI strip use two contradictory ladders | unverified; Muse calls the intended ladder undecidable |
| R-5a | `pulsedex-overview.js` Baevsky SI tile | null SI graded good | fixed on main: the tile uses `_kd(r.si, 150, 250)` |
| R-5b | `pulsedex-overview.js` KPI grid | HF n.u. and ABS null graded bad; LF/HF and resp rate null graded warn; coverage prints the string "null" | unverified |
| R-6 | `ppgdex-app.js` Poincare line | absent area printed as 0 ms² | row `2026-11-08-ppgdex-poincare-line-prints-null-and-an-absent-area-as-zero` |
| R-7 | `ppgdex-render.js` `lineChart` | no null hardening; a null y drags the axis to 0, a NaN voids the path | unverified; Muse found no caller that passes a null |
| R-8 | CPAPDex Therapy Hours tile | carries badge id `usageHours`, which resolves to the mask-on definition | unverified |
| R-9 | `hrvdex-render.js` alerts | `_energy < 30` fires on null | row `2026-11-08-hrvdex-low-energy-alert-fires-on-a-null-energy`; the delta half (a null previous row) is unverified |
| R-10 | `motiondex-render.js` supine row | states track length as the population | row `2026-11-08-motiondex-supine-row-states-the-wrong-denominator` |
| R-11 | OxyDex night rows | `odi4` with null rate prints "null/h" graded green; HRV chips print raw nulls; the ODI-4 tile class is ok on a dash | unverified |
| R-12 | `hrvdex-render.js` recovery-debt chart | absent value drawn as a green 0 bar | row `2026-11-08-hrvdex-recovery-debt-chart-draws-an-absent-value-as-a-green-zero` |
| R-note | `cpapdex-render.js` | the usage row's shape has two more sites: the hero Usage subscore and the "at least 4 h compliant" chip | scope note for row `2026-11-07-the-cpap-usage-kpi-draws-the-recording-envelope-under-the-mask-on-label`; its fix must cover all three sites |

## 4 · Lane S — DSP cores (`#4271`)

Muse reports 47 lane-probe findings, 7 source-only and 11 design calls. Muse re-ran A-2, A-5 and
M-1, and re-read B-F1, B-F7 and A-4.

| id | site | finding | state |
|---|---|---|---|
| B-F7 | `ecgdex-dsp.js` `stageSleep` | an absent RMSSD stages REM | fixed on main: `rmOk` requires `e.rmssd != null` |
| B-F1 | `ecgdex-dsp.js` `_malikCorrect` | fills an unmeasurable device RR with 1000 ms | fixed on main: the fallback comment sits at the twin site |
| A-5 | `oxydex-dsp.js` `computeDesSev` | an absent second inside an event adds the full baseline | unverified; main now refuses a record under 60 s, and the area loop was not re-read |
| A-2 | `oxydex-dsp.js` `computeHRFlatlines` | `null === null` counts as a flatline | fixed on main: the run test carries a §∅ comment |
| A-4 | `oxydex-dsp.js` `computeSleepStabilityScore` | s5 scores a null burden rate as 100 | fixed on main: s5 is null when `hb.rate` is null |
| A-13 | `oxydex-dsp.js` `computeSpO2Autocorr` | nulls coerced in means and lag sums | unverified |
| A-1 | `computeOxyCrash` | a sensor dropout after flat 98 publishes a crash | unverified |
| A-3 | `computeSpO2Percentiles` | nulls sort as 0; no n | unverified |
| A-6 | `detectODI` | no measured-sample floor; all-null gives ODI 0 | unverified |
| A-7 | `computePatternScores` | null `odi4.rate` passes `< 3` | unverified |
| A-8 | `computeHypoxicLoad` | discards the supplied ODI-3 when no event derives | unverified |
| A-9 | `computeHRProfile` | null HR summed as 0 | unverified |
| A-10 | `computeSpikeDecay` | a null after the peak reads as fast recovery | unverified |
| A-11 | `oxydex-util.js` `computeCeilingBaselineArr` | an empty window gets baseline 95 | unverified |
| A-12 | `computeRollingMetrics` | window means divide by length with nulls as 0 | unverified |
| A-14 | `computePBmetrics` | a null makes the window min 0 | unverified |
| A-15 | `computeNightExtras` | split-night means count nulls as 0 | unverified |
| A-16 | `computeHRNadirTime` | the nadir lands in a dropout | unverified |
| A-17 | `computeO2HREfficiency` | an all-null pre-window inflates the ratio | unverified |
| A-18 | `computeHRQuartileTrend` | an all-null first quartile gives hrQ1 0 | unverified |
| A-19 | `computeKarvonenZones` | age defaults to 49 with no assumed marker | holds on main: `age = age` falling back to 49, no marker near it |
| A-21 | `glucodex-dsp.js` `coreMetrics` | n reports 1 over zero readings; a phantom panel | holds on main: `vals.length` falls back to 1 |
| A-22 | GlucoDex `detectSessions`, `tierOf` | a null cadence is unhandled | unverified |
| A-23 | GlucoDex `postprandial` | the +2 h value has no distance bound | unverified |
| A-24 | GlucoDex `mage` | publishes the SD as MAGE with no excursion | unverified (source-only) |
| A-25 | GlucoDex `bgRisk` | publishes 0, 0 on no valid values | unverified (source-only) |
| A-26 | GlucoDex `excursions` | an interpolated cell can be a peak | unverified (source-only) |
| A-27 | 14 OxyDex functions | the A-12 null-coercion shape | unverified (source-only) |
| B-F2 | `ppgdex-dsp.js` `timeDomain` | two fallbacks re-admit excluded intervals | unverified |
| B-F3 | `ppgdex-dsp.js` `poincare` | all-pairs fallback; ratio on a 0 denominator | unverified |
| B-F4 | `ecgdex-dsp.js` `pnn50` | 0 over zero eligible pairs | unverified |
| B-F5 | ECG and PPG `beatConfidence` | under 20 beats, every second trusts 1 | unverified |
| B-F6 | `ecgdex-dsp.js` `hrvStability` | a null epoch counts as log 0 | unverified |
| B-F8 | ECG `lombScargle` | respRate 0 on a flat series | unverified |
| B-F9 | `cardiorespCoupling` | plv 0 when no window fits | unverified |
| B-F10 | `buildNN` | coveragePct 100 over a zero span | unverified (low) |
| B-F11 | ECG `gangliorEvents` `sqiAt` | a measured SQI of 0 becomes 0.5 | unverified (source-only) |
| M-1 | `oxydex-dsp.js` `linReg` | a fit on empty or single-point input | unverified; in-DSP callers guard |
| M-2 | `analysis-stats.js` `_wvar`, `sensor-trio-worker.js` | a distrusted corner reads as perfect agreement | unverified; reachability on a real night is open |
| C-F1 | Integrator `labelPositionalApnea` | "unknown" posture counts as non-supine | unverified |
| C-F2 | CPAP `buildLongitudinal` | compliancePct 0 over zero measured nights | unverified |
| C-F3 | CPAP `buildSessionFromEdf` | maxLeak 0 from zero mask-on samples | unverified |
| C-F4 | CPAP `computeMetrics`, `nightMetrics` | NaN where siblings use null | unverified |
| C-F5 | PulseDex `pdComputeResult` | artifact count discarded under `artifactClean` | unverified |
| C-F6 | PulseDex `lombScargle` | respRate 0 over zero power | unverified |
| C-F7 | PulseDex `_bare` helpers | fabricate on zero denominators | unverified; the in-file caller gates |
| C-F8 | HRVDex rolling windows | row-count windows with no span bound | unverified |
| C-F9 | MotionDex `bodyPosition` | a zero distribution over zero covered epochs | unverified |
| C-F10 | EEGDex `analyze` | every epoch stamped conf 0.5 | unverified |
| C-F11 | Integrator | a fixed conf 0.6; a correlation from one pair | unverified (source-only) |
| C-F12 | MotionDex `respiratoryRate` | conf 0 on uncovered windows | unverified |
| C-F13 | Integrator `activityEnvelope` | a NaN sample becomes 0 activity | unverified |

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
| U-3 | `dex-ingest.js` `planIngest` | PPI items filtered out and not listed in `skipped` | holds on main; by design (firmware RR first), but uncounted |
| U-4 | OxyDex `parseCSV` | drops rows uncounted; positional column guess with no marker | unverified |
| U-5 | GlucoDex `parseCSV` | drops rows uncounted | unverified |
| U-6 | HRVDex summary parser | unparseable stamps dropped uncounted | unverified |
| U-7 | ECG companion parsers | band drops uncounted | unverified |
| U-8 | `parseDeviceACC` | 4 Hz default with no defaulted marker | unverified |
| U-9 | three Polar adapters | a zero-row companion reads as no companion | unverified |
| U-10 | `resmed-edf`, `cpapdex-edf` | fs 25 fallback unmarked; session names dropped uncounted | unverified |
| U-11 | `readEDF` | a duplicate label overwrites | unverified (edge) |
| U-12 | OxyDex `parsePPG2W` | non-finite motion becomes 0; thin bins skipped uncounted | unverified |

## 6 · Lane W — monitor, bridge and board (`#4267`)

| id | site | finding | state |
|---|---|---|---|
| M-1 | `webmon.py` | `heartbeat_ms` not forwarded | fixed on main |
| M-2 | `webmon.py` | `seal` not forwarded | fixed on main |
| M-3 | `monitor.html` | the power block is read by nothing | row `2026-11-08-the-monitor-reads-no-o2ring-power-block` |
| M-4 | `monitor.html` `loadState` | no failure path after boot; a stale state renders as live | unverified |
| M-5 | Batteries card | a days-old level shows as current with no age stamp | unverified |
| M-6 | nights fetch | a failure leaves "no nights on disk" after the toast fades | unverified |
| M-7 | CPAP daemon card | an unknown state renders idle with a fabricated next run | unverified |
| B-1 | `tools/ntfy-board-bridge.mjs` `classify` | disk recoveries cannot close | fixed on main |
| B-2 | the bridge | close matches content | row `2026-11-07-bridge-close-matches-content-and-a-crit-episode-cannot-close` (closed) |
| B-3 | `ackSweep` | empty acks output retires every tracked urgent | fixed on main: `planRetire` refuses and logs |
| B-4 | the bridge | escalation clock runs from arrival | fixed on main |
| B-5 | the bridge | a reopen under 2 h merges with no post | unverified |
| B-6 | the bridge | dedup keys truncate titles to 40 characters | unverified |
| N-1 | `board-nudge.sh` | a parse failure sums to 0 unread | unverified (bounded) |
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
