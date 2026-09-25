<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Parked-item blockers, re-verified on `origin/main` — 2026-09-25

**What this is:** a report, and nothing else was edited. I read every brief whose Status is not DONE, REFERENCE or CHECKPOINT and collected its lines marked `[~]`, `[⛔]`, "BLOCKED", "parked", "waits on" or "owner-gated": **77 lines in 31 briefs**. Most of those lines are prose that uses the word, not a parked item. **24 are parked items that name a blocker**, and the table below covers each of those. Where a blocker names a PR, commit, file, brief or owner ruling, I checked it on `origin/main`. When a blocker is provably gone, lifting the park is the rig's triage decision, so this report changes no brief.

**Totals:** 24 items · **8 met** (the named blocker has landed, exists or was ruled) · **5 unmet** · **11 undecidable** (the blocker is hardware, a box measurement or data this checkout cannot see, or an owner action).

| brief | item | blocker as named | state on main | evidence |
|---|---|---|---|---|
| `CPAP-AS11-BLE-WIRE-NOW-2026-09-07` | §1: the session detector's mode is out of scope | parked in `AS11-SESSION-DETECTOR-IMPLEMENTATION` | **met** | that brief reads `**Status:** DONE — 2026-09-25 … increments 1–2 BUILT and in production` |
| `CPAP-AS11-BLE-WIRE-NOW-2026-09-07` | the ≥ 3-night done-when | "OWNER-blocked (arming)" (`cpap.ble_stream.events.enabled: false`) | undecidable | an owner action on the box; not visible in the tree |
| `CPAP-AS11-BLE-WIRE-NOW-2026-09-07` | acting-mode promotion of the event-driven detector (WU4) | "parked, separate decision" | undecidable | names no decision ID |
| `CAPTURE-HOST-RESOURCE-ORCHESTRATION-AUDIT-2026-09-05` §7 | `connected=False` during `_retry_sleep` | "design decision — residue row" | **met** | residue row `2026-09-05-retry-sleep-stale-connected` is closed `fixed #2274` (`briefs/RESIDUE.md`) |
| `CAPTURE-HOST-RESOURCE-ORCHESTRATION-AUDIT-2026-09-05` §7 | wire `adapter_pool.py` (hotplug, quarantine, flap cap) | "a second adapter in the deployed config" | undecidable | deployed config is not in the tree |
| `CAPTURE-HOST-RESOURCE-ORCHESTRATION-AUDIT-2026-09-05` §7 | degradation levels 0–5 | "`loop.stalls` on a real night" | undecidable | a box measurement |
| `CAPTURE-HOST-RESOURCE-ORCHESTRATION-AUDIT-2026-09-05` §7 | admission enum / generations / quiesce coordinator | "never, unless a shared queue appears" | unmet | no shared queue introduced; the brief's own §9 is the latest word |
| `CPAP-SPOOL-ACQUISITION-2026-08-25` | the measurement box | "waits on the attended pull" | undecidable | needs an attended night |
| `CROSS-DOMAIN-METHODS-FOLLOWUPS-2026-08-14` §3 | E-QC | "BLOCKED ON CAPTURE — a hardware change" | unmet | no fourth independent oximetry stream exists in the tree |
| `CROSS-DOMAIN-METHODS-FOLLOWUPS-2026-08-14` | `[⛔]` fourth-stream box | "the hardware does not exist", per `R5-HR-TRIPLET-REFERENCE-2026-07-12` | **met — as a ruling, not a landing** | R5 reads `**Status:** DONE — 2026-09-20 (CLOSED, UNRUNNABLE — owner ruling 2026-09-20: the ResMed oximeter module … does not exist and is not being sought`. The blocker is now permanent, so this box can be closed as unrunnable rather than left parked |
| `CROSS-DOMAIN-METHODS-FOLLOWUPS-2026-08-14` | `[~]` power analysis on a real detector change | "awaiting an occasion, not work" | undecidable | needs the next detector change |
| `KNOWN-CLOCK-ADVERSARIAL-CAPTURE-2026-08-14` §B | targets 1 · 4 | "Blocked on code — the injector" | **met** | `capture-host/adversarial_capture.py` landed in `435610be` (#2834), *"the KNOWN-CLOCK injector … refuses production"*. Target 6 is deliberately not built (§B.2) |
| `MOTIONDEX-RESPIRATORY-RATE-FOLLOWUPS-2026-07-22` §9 | parked | "a second consumer needing *clock* offset between two devices" | undecidable | the trigger is a future consumer |
| `MUTATION-SUITE-FOLLOWUPS-2026-08-17` §6 | per-group selection optimisation | "blocked on a coverage-capture bug" | undecidable | names no file or PR |
| `OXYDEX-PB-DETECTOR-FOLLOWUPS-2026-08-17` §4 | third-observer PB attribution | "blocked on data … a date gap" (CPAP corpus ends 2026-07-21, ECGDex nights start 2026-07-16) | undecidable | corpus data is not in the tree |
| `OXYII-ACQUISITION-CHARTER-2026-08-23` | `[~]` G2's mutation gate drained | the diff gate crashed on #1681 (`KeyError: 'key'`) | undecidable | needs a gate re-run on `oxy_restart` |
| `OXYII-DAT-AUTO-HARVEST-REFINEMENT-2026-08-24` | unit 2 | "waits on `OxyRecState.END_CANDIDATE`" | **met** | `capture-host/oxy_lifecycle.py:221` `END_CANDIDATE = "end_candidate"`, with transitions at :230–231 |
| `OXYII-DAT-AUTO-HARVEST-REFINEMENT-2026-08-24` §failure table rows 2 · 7 | host restart / BLE drop **during recording** | "needs the recording axis" | **met (the symbol)** | `OxyRecState` with `RECORDING`/`UNKNOWN` exists in `capture-host/oxy_lifecycle.py`. Whether the rows are now *testable* is the rig's call |
| `OXYII-DAT-AUTO-HARVEST-REFINEMENT-2026-08-24` §failure table row 3 | restart right after recording ends | "`END_CANDIDATE` must survive a restart" | undecidable | persistence across a restart is not shown by the symbol existing |
| `POLAR-OFFLINE-DOWNLOAD-2026-07-17` | `[ ]` web-triggered pull demonstrated green | "blocked only by the BLE trusted-auto-reconnect race" | **met (the mitigation)** | `capture-host/bonding.py:279` pairs with `… (0.5, f"untrust {address}") …` in `bond()`; the demonstration itself is still owed |
| `REM-STAGING-FOLLOWUPS-2026-08-02` | "still blocked on records only" | records (NSRR DUA) | **met** | `73ec6779` (#2423) *"validate ECGDex and OxyDex against 99 expert-scored SHHS records"*; the brief's own 2b box is `[x]` citing #2423. The 2026-08-28 DUA-cancellation note and the "blocked on records" line now contradict that box |
| `TCH-FUSED-ROBUST-HAT-2026-07-14` | wire the FUSED hat into the real overlay | "`derivedMap` reads 2-col `ms;hr` … needs a `ms;hr;c` re-derivation" | unmet | `sensor-trio-power-analysis.js` `derivedMap` still reads `ms = +cc[0]`, `hr = +cc[1]`, with no third column |
| `TRIO-POWER-N15-FINDINGS-2026-07-12` | `[⛔]` re-fit σ to the 15-night hat | `SENSOR-TRIO-NIGHTS-PAPER`'s standing instruction not to swap re-derived σ | unmet | the instruction is a standing rule, not a landing; that paper brief is `DONE — 2026-08-27` and its instruction stands |
| `PPG-FOOT-PLACEMENT-FOLLOWUPS-2026-09-01` | the PAT-physiology / common-mode branch | "no instrument in this suite observes either independently" | unmet | no BP or vascular reference in the tree |

**Not examined in depth:** the other 53 matched lines (a heading, a table header, or a sentence using "blocked"/"parked" about something already resolved or narrated, e.g. `PAT-NO-VALID-ANCHOR` §9a, *"the blocker is not the one this brief states"*). They were read once and excluded as not parked items.

Rule 0 not run (cloud session).
