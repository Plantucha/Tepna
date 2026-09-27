<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# The 63 DONE dates #3084 synced — do the headers hold up? — 2026-09-25

**What this is:** a report. #3084 (Unit B) made 63 DOCS-INDEX status cells match their briefs' header DONE dates, taking the header as the truth. This checks that assumption. For each brief, `git log -S'<the header's own DONE token>' --format='%h %cs' origin/main -- briefs/<file> | tail -1` gives the commit that first **wrote** the header date. The oldest match is the right end here, because we want the writer. That commit's date is compared with the date it wrote. A header date earlier than its writing commit by **more than a day** would be a date typed from memory. In that case the fix would be the commit's date, in both the header and the index. For each old index date, the commit that wrote it is shown the same way, for context.

**Totals:** 63 checked · **63 headers written within a day of the date they state** (53 on the same day, 10 one day later) · **0 typed from memory** · **0 edits owed**. A +1 d lag is consistent with a commit made after midnight UTC, or a squash-merge's committer date, on work done the day before. #3084's index cells therefore stand as they are.

**The known case, `BADGE-COVERAGE-AUDIT-2026-08-04`:** the header `DONE — 2026-08-04` was written by `612f03ed` **on 2026-08-04**, the same day it states. The index's `DONE 2026-09-20` came later, from `b40b5e56` on 2026-09-20, which is when the index cell was rewritten. So the header was right and #3084's correction back to 2026-08-04 stands. Whatever happened on 2026-09-20 was recorded in the index cell only, not as a new DONE date in the brief. If that re-verification was meant to move the date, the brief's header is the place to record it.

| brief | header date | commit that wrote it | lag | index date (before #3084) | action |
|---|---|---|---|---|---|
| `CAPTURE-HOST-2026-06-29` | 2026-08-04 | 2026-08-04 `69e7279a` | +0 d | 2026-06-29 — written 2026-07-01 `176ea8c3` | header right — leave |
| `O2RING-USB-HID-NEGATIVE-2026-08-08` | 2026-08-09 | 2026-08-09 `ede9d900` | +0 d | 2026-08-08 — written 2026-08-08 `7766b16a` | header right — leave |
| `CPAP-BLE-CAPTURE-2026-08-21` | 2026-08-25 | 2026-08-25 `83b836e0` | +0 d | 2026-08-21 — written 2026-08-25 `83b836e0` | header right — leave |
| `CPAP-EDF-WRITER-FOLLOWUPS-2026-08-23` | 2026-08-25 | 2026-08-25 `83b836e0` | +0 d | 2026-08-23 — written 2026-08-23 `8a34abee` | header right — leave |
| `ACQ-EVIDENCE-CONTRACT-2026-08-24` | 2026-08-26 | 2026-08-26 `7359618e` | +0 d | 2026-08-24 — written 2026-08-24 `1a1e6caa` | header right — leave |
| `CORPUS-TIER-30-NIGHTS-2026-09-20` | 2026-09-21 | 2026-09-21 `c56c19cd` | +0 d | 2026-09-20 — written 2026-09-20 `b40b5e56` | header right — leave |
| `CPAP-EAGER-START-2026-09-01` | 2026-09-02 | 2026-09-02 `0c8eb10a` | +0 d | 2026-09-01 — written 2026-09-01 `b78037a4` | header right — leave |
| `CPAP-ACQ-P4-SPOOL-TRANSACTION-2026-08-23` | 2026-09-21 | 2026-09-21 `858513f9` | +0 d | 2026-08-23 — written 2026-08-23 `8a34abee` | header right — leave |
| `CPAP-ACQ-P2-LIFECYCLE-2026-08-23` | 2026-08-25 | 2026-08-25 `83b836e0` | +0 d | 2026-08-23 — written 2026-08-23 `8a34abee` | header right — leave |
| `CPAPDEX-LIVE-SD-COMPARATOR-2026-08-23` | 2026-08-24 | 2026-08-24 `ac7874df` | +0 d | 2026-08-23 — written 2026-08-23 `8a34abee` | header right — leave |
| `CPAPDEX-LIVE-SD-COMPARATOR-FOLLOWUPS-2026-08-24` | 2026-08-25 | 2026-08-25 `4975a44e` | +0 d | 2026-08-24 — written 2026-08-24 `1a1e6caa` | header right — leave |
| `CAPTURE-FILESET-RESUME-2026-08-19` | 2026-09-03 | 2026-09-03 `9cf0965f` | +0 d | 2026-08-26 — written 2026-08-26 `bc9d5c10` | header right — leave |
| `DEEP-AUDIT-IV-2026-08-04` | 2026-09-02 | 2026-09-02 `7016a54c` | +0 d | 2026-08-15 — written 2026-08-15 `3679c094` | header right — leave |
| `MUTATION-FLEET-EXPANSION-2026-08-25` | 2026-08-31 | 2026-08-31 `2dcb8c23` | +0 d | (none) | header right — leave |
| `CPAP-CLOCK-LONGITUDINAL-SEGMENT-2026-08-21` | 2026-08-25 | 2026-08-25 `83b836e0` | +0 d | 2026-08-21 — written 2026-08-25 `83b836e0` | header right — leave |
| `FABRICATED-DEFAULTS-FLEET-2026-08-16` | 2026-08-18 | 2026-08-19 `084db04e` | +1 d | (none) | header right — leave |
| `HOSTAXIS-STABILITY-FOLLOWUPS-2026-08-15` | 2026-08-16 | 2026-08-16 `5f566e41` | +0 d | 2026-08-15 — written 2026-08-15 `3679c094` | header right — leave |
| `EXTERNAL-METHODS-SURVEY-2026-08-20` | 2026-08-23 | 2026-08-23 `8a34abee` | +0 d | (none) | header right — leave |
| `EXTERNAL-METHODS-SURVEY-FOLLOWUPS-2026-08-23` | 2026-08-23 | 2026-08-23 `3dbe679a` | +0 d | (none) | header right — leave |
| `PAT-FORENSICS-WINDOW-REGIMES-2026-08-28` | 2026-09-14 | 2026-09-14 `69b6f1d3` | +0 d | (none) | header right — leave |
| `PUBLISHED-NUMBER-PROVENANCE-2026-09-15` | 2026-09-21 | 2026-09-21 `4993ab3b` | +0 d | 2026-09-15 — written 2026-09-21 `4993ab3b` | header right — leave |
| `PAT-PROXIMAL-DISTAL-PAIR-2026-08-04` | 2026-08-27 | 2026-08-27 `d9e53c77` | +0 d | 2026-08-04 — written 2026-08-04 `612f03ed` | header right — leave |
| `WEARABLE-DRIFT-DIRECT-2026-08-02` | 2026-08-17 | 2026-08-17 `d0551555` | +0 d | 2026-08-02 — written 2026-08-02 `045b304f` | header right — leave |
| `WEARABLE-HOST-AXIS-FOLLOWUPS-2026-08-02` | 2026-08-27 | 2026-08-27 `e438d44e` | +0 d | (none) | header right — leave |
| `JOINT-UNWRAP-ATTEMPT-FOLLOWUPS-2026-08-08` | 2026-08-20 | 2026-08-21 `27645e7f` | +1 d | 2026-08-08 — written 2026-08-08 `7766b16a` | header right — leave |
| `OXYDEX-PB-OVERCALL-2026-07-31` | 2026-08-04 | 2026-08-04 `31c4f785` | +0 d | 2026-08-02 — written 2026-08-02 `045b304f` | header right — leave |
| `VIGIL-COEXISTENCE-AND-RANGE-2026-07-26` | 2026-08-16 | 2026-08-16 `a3fc5d9d` | +0 d | (none) | header right — leave |
| `OXYII-PRESENCE-MODEL-2026-08-23` | 2026-09-05 | 2026-09-05 `a47af6ce` | +0 d | (none) | header right — leave |
| `DOCS-LEDGER-HEADER-REFS-2026-08-27` | 2026-08-27 | 2026-08-27 `6b697956` | +0 d | (none) | header right — leave |
| `OXYII-G1-TRANSACTIONAL-SYNC-2026-08-23` | 2026-08-23 | 2026-08-24 `f4f9be0e` | +1 d | (none) | header right — leave |
| `O2RING-TIME-CAPABILITY-WIRING-2026-08-19` | 2026-09-02 | 2026-09-02 `c4062531` | +0 d | 2026-08-19 — written 2026-08-19 `1016fb38` | header right — leave |
| `LOST-APPARATUS-INVENTORY-2026-08-26` | 2026-08-27 | 2026-08-27 `744d2ba9` | +0 d | (none) | header right — leave |
| `UNWIRED-ORPHAN-TRIAGE-2026-08-27` | 2026-08-27 | 2026-08-27 `4e78e09e` | +0 d | (none) | header right — leave |
| `OPERATIONAL-MATURITY-AUDIT-2026-08-27` | 2026-09-15 | 2026-09-15 `dd677af7` | +0 d | (none) | header right — leave |
| `PPG-ABSENCE-AS-VALUE-2026-09-06` | 2026-09-21 | 2026-09-21 `711b3b3f` | +0 d | 2026-09-20 — written 2026-09-20 `b40b5e56` | header right — leave |
| `CLAUDE-MD-REDUNDANCY-AUDIT-2026-08-27` | 2026-08-28 | 2026-08-28 `2914bc9a` | +0 d | (none) | header right — leave |
| `O2RING-WAVEFORM-SPO2-SHIP-2026-08-20` | 2026-08-26 | 2026-08-26 `cbdfbf16` | +0 d | 2026-08-20 — written 2026-08-20 `e706e3c2` | header right — leave |
| `O2RING-FRAME-SAMPLE-LOCK-FOLLOWUPS-2026-08-03` | 2026-09-21 | 2026-09-21 `ba1875e5` | +0 d | (none) | header right — leave |
| `CAPTURE-HOST-SUBPROCESS-SURFACE-FOLLOWUPS-2026-08-04` | 2026-08-26 | 2026-08-27 `b2eb1aa3` | +1 d | (none) | header right — leave |
| `MUTATION-COVERAGE-SELECTION-2026-08-14` | 2026-09-07 | 2026-09-07 `12b3bc60` | +0 d | (none) | header right — leave |
| `ECGDEX-EDR-RESP-ACCURACY-2026-07-31` | 2026-08-04 | 2026-08-04 `b274ccee` | +0 d | 2026-08-01 — written 2026-08-01 `6815178f` | header right — leave |
| `EDR-THRESHOLD-MARGIN-FOLLOWUPS-2026-08-04` | 2026-08-04 | 2026-08-04 `ae277692` | +0 d | (none) | header right — leave |
| `PAPER-ODI4-REPRODUCIBILITY-2026-07-31` | 2026-08-04 | 2026-08-04 `6844135f` | +0 d | 2026-08-01 — written 2026-08-01 `6815178f` | header right — leave |
| `PPGDEX-JITTER-AND-REFERENCE-FOLLOWUPS-2026-08-03` | 2026-09-03 | 2026-09-03 `0132a66e` | +0 d | 2026-08-03 — written 2026-08-03 `2501af3a` | header right — leave |
| `TCH-REFERENCE-VALIDATION-2026-07-12` | 2026-08-04 | 2026-08-04 `4076478a` | +0 d | 2026-07-12 — written 2026-07-13 `dde6dfce` | header right — leave |
| `TCH-CORRELATED-SOLVE-KNIFE-EDGE-FOLLOWUPS-2026-08-04` | 2026-08-09 | 2026-08-10 `ee1aff2d` | +1 d | (none) | header right — leave |
| `DEEP-AUDIT-FOLLOWUPS-2026-07-12` | 2026-08-04 | 2026-08-04 `f893500f` | +0 d | 2026-07-12 — written 2026-07-13 `dde6dfce` | header right — leave |
| `REPO-DISCOVERABILITY-2026-07-03` | 2026-08-04 | 2026-08-04 `31c4f785` | +0 d | 2026-07-04 — written 2026-07-04 `6778beab` | header right — leave |
| `REPO-DISCOVERABILITY-FOLLOWUPS-2026-07-04` | 2026-08-04 | 2026-08-04 `31c4f785` | +0 d | 2026-07-04 — written 2026-07-04 `6778beab` | header right — leave |
| `DOCS-LEDGER-GATE-FOLLOWUPS-2026-07-04` | 2026-07-05 | 2026-07-05 `d020e8f3` | +0 d | 2026-07-04 — written 2026-07-04 `6778beab` | header right — leave |
| `OWN-THE-BUILD-FOLLOWUPS-2026-07-03` | 2026-08-04 | 2026-08-04 `88f8d895` | +0 d | 2026-07-05 — written 2026-07-05 `d020e8f3` | header right — leave |
| `AGENT-NEUTRAL-GUARDS-2026-08-15` | 2026-08-16 | 2026-08-16 `1b883ba7` | +0 d | (none) | header right — leave |
| `DEAD-FIELD-HINTS-FLEET-FOLLOWUPS-2026-08-19` | 2026-08-20 | 2026-08-20 `c8ff8597` | +0 d | (none) | header right — leave |
| `AUDIT-FOLLOWUPS` | 2026-09-20 | 2026-09-20 `b40b5e56` | +0 d | (none) | header right — leave |
| `BADGE-COVERAGE-AUDIT-2026-08-04` | 2026-08-04 | 2026-08-04 `612f03ed` | +0 d | 2026-09-20 — written 2026-09-20 `b40b5e56` | header right — leave |
| `DEX-CITATION-FORMULA-AUDIT` | 2026-08-05 | 2026-08-05 `be3d2c1b` | +0 d | 2026-08-03 — written 2026-08-03 `2501af3a` | header right — leave |
| `CITATION-ATTRIBUTION-FOLLOWUPS-2026-08-05` | 2026-08-08 | 2026-08-09 `7d85d137` | +1 d | (none) | header right — leave |
| `EXPORT-HARDENING-FOLLOWUP` | 2026-08-04 | 2026-08-04 `217dd4cb` | +0 d | 2026-08-03 — written 2026-08-03 `2501af3a` | header right — leave |
| `STALE-BRIEF-GUARD-MEASURES-THE-WRONG-TREE-2026-08-18` | 2026-08-18 | 2026-08-19 `ddb6345e` | +1 d | (none) | header right — leave |
| `SHHS-EXTERNAL-VALIDATION-2026-09-04` | 2026-09-12 | 2026-09-13 `7cfd75c4` | +1 d | (none) | header right — leave |
| `MOTIONDEX-RESPIRATORY-RATE-2026-07-21` | 2026-09-20 | 2026-09-21 `65515558` | +1 d | 2026-07-21 — written 2026-07-21 `7fcc1ddc` | header right — leave |
| `TCH-FUSED-ROBUST-HAT-FOLLOWUPS-II-2026-08-20` | 2026-08-22 | 2026-08-23 `70e48937` | +1 d | 2026-08-20 — written 2026-08-20 `e706e3c2` | header right — leave |
| `R5-HR-TRIPLET-REFERENCE-2026-07-12` | 2026-09-20 | 2026-09-20 `b40b5e56` | +0 d | (none) | header right — leave |

Rule 0 not run (cloud session).
