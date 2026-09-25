<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Pre-verification of 17 briefs for Kestrel — 2026-09-25

**Evidence only.** No brief, status header or `briefs/RESIDUE.md` row was edited. Stamping is Kestrel's, under the stale-brief hook. Every recommendation and draft stamp below is a proposal.

- **Base:** `origin/main` at `60755013` (2026-09-25).
- **Rule 0 not run (cloud session).** `tools/doc-search.mjs` does not exist here, so searches were `git grep`/`git log -S`/`-G`/`--grep` plus reading the cited code.
- **Gates.** Not run: `npm run check` and `capture-host/check.sh`. Run here: capture-host's mypy leg, with `check.sh`'s own invocation, `Found 37 errors in 22 files (checked 468 source files)` against `MYPY_BASELINE=37`. A DONE recommendation below is conditional on the gate named in its section being green on the stamping commit.
- **Verdict vocabulary.** BUILT = the code, test or recorded result exists on main, with a file:line cited. NOT BUILT = what is absent is named. UNDECIDABLE = the evidence that would decide it is named. **PARTLY BUILT is counted as NOT BUILT in the summary table**, because the remainder is absent.
- **vendor-src.** Neither `CPAP-SPOOL-ACQUISITION` nor `ZEPHYR-INSTRUMENT` contains a vendor-src path. Both are recorded repo-side only, and no vendor-src material was opened or quoted.
- **Line numbers** are as read on `60755013`. Several briefs cite `capture.py` lines that have drifted two or three times, so **cite the symbol when stamping**.

## Summary

| # | brief | BUILT | NOT BUILT | UNDECIDABLE | recommendation |
|---|---|---|---|---|---|
| 1 | AS11-AUTO-SESSION-DETECTION-2026-08-24 | 4 | 2 | 1 | **PROPOSED — restamp** (core BUILT, remainder `Leak` poll code + SubscribeEvent box result) |
| 2 | AS11-SESSION-DETECTOR-IMPLEMENTATION-2026-08-24 | 5 | 0 | 1 | **DONE** (all three Done-when met; gate `check.sh` first) |
| 3 | CPAP-ACQUISITION-HARDENING-AUDIT-2026-08-23 | 11 | 2 | 0 | **PROPOSED — restamp** (INV11 unwired; no P5/P7/P8 briefs; §8 rows stale) |
| 4 | CPAP-SPOOL-ACQUISITION-2026-08-25 | 2 | 4 | 1 | **NO CHANGE** (box-blocked; optional header refresh) |
| 5 | CROSS-DOMAIN-METHODS-FOLLOWUPS-2026-08-14 | 7 | 2 | 0 | **NO CHANGE** |
| 6 | DEEP-AUDIT-V-FOLLOWUPS-2026-08-05 | 9 | 0 | 0 | **DONE** (status survives only on a clause its own §1 box contradicts) |
| 7 | FINISHED-WORK-IMPROVEMENTS-2026-08-20 | 8 | 6 | 1 | **NO CHANGE** (tick box A; fix the stale B6 row) |
| 8 | GATT-HANDLE-MAP-2026-09-17 | 4 | 3 | 1 | **PROPOSED — restamp** (oracle BUILT, no refusing consumer) |
| 9 | MULTI-SENSOR-DERIVATIONS-FOLLOWUPS-2026-07-18 | 4 | 1 | 0 | **NO CHANGE** (§2 is 3-of-3 since #2115; header stale) |
| 10 | OPERATIONAL-MATURITY-ROADMAP-2026-08-27 | 13 † | 5 | 2 | **NO CHANGE** (owner-ruled open; box-bound) |
| 11 | PINNED-SPAN-POPULATIONS-2026-09-18 | 6 | 2 | 0 | **NO CHANGE** |
| 12 | PPG-FOOT-PLACEMENT-FOLLOWUPS-2026-09-01 | 3 | 1 | 0 | **NO CHANGE** (awaits the owner's sdb1 ruling) |
| 13 | PYTHON-TYPES-AND-FORMAT-2026-08-27 | 2 | 2 | 1 | **PROPOSED — restamp** (the live count is 37, not 41) |
| 14 | REM-STAGING-FOLLOWUPS-2026-08-02 | 4 | 1 | 0 | **PROPOSED — restamp** (one owner decision, §2c) |
| 15 | SAMPLE-VALIDITY-ENVELOPE-2026-09-17 | 2 | 3 | 0 | **PROPOSED — restamp** (two of five met; consumers not enumerated) |
| 16 | TCH-FUSED-ROBUST-HAT-2026-07-14 | 4 | 1 | 0 | **NO CHANGE** (owner-gated remainder) |
| 17 | ZEPHYR-INSTRUMENT-2026-08-23 | 2 | 2 | 0 | **NO CHANGE** (probe run + RADIO-CLOCK-SIDECAR, box-bound) |

† The 13 boxes ticked on 2026-09-15 were taken as recorded, not re-derived one by one. Only the five open boxes and §13/§14 were checked.

**Totals:** DONE ×2 · PROPOSED-restamp ×6 · NO CHANGE ×9 · REFERENCE ×0.

### Residue candidates (for Kestrel to file or discard — NOT written to `RESIDUE.md`)

| suggested key | source | defect, one line |
|---|---|---|
| `2026-09-25-inv11-owner-registry-has-no-caller` | `capture-host/cpap_acq.py` | `AcquisitionOwners` (#2633) is tested but has no production caller. INV11 is guarded in tests only, while `CPAP-ACQ-P3-GAP-ACCOUNTING` reads DONE "no open items" (§3) |
| `2026-09-25-gattmap-oracle-has-no-refusing-consumer` | `capture-host/gattmap.py` | The completeness oracle detects a partial tree, but the capture path only uses it as a wait hint. GATT-HANDLE-MAP's "load-bearing" done-when (refusal) is unmet (§8) |
| `2026-09-25-runs-sidecars-written-with-no-reader` | `capture-host/writers.py` | `*RUNS.txt` sidecars are written for ACC/ACCRAW/PPG2W/ECG, but only PpgDex reads `_PPGRUNS`. Absence travels out-of-band and is consulted by no metric (§15) |
| `2026-09-25-cpap-detect-comments-predate-the-hook` | `capture-host/cpap_detect.py` | `:8` and `:101` say the daemon hook and acting mode are "a later increment". Both exist or are closed (§2) |
| `2026-09-25-ecgdex-gensynthetic-constraint-deferral-missed` | `REM-STAGING-FOLLOWUPS-2026-08-02-BRIEF.md` | The named deferral "write the §1 constraint into `ecgdex-dsp.js` on the next behavioral ECGDex re-bundle" missed several triggers (#2984, #3002, #3043) (§14) |
| `2026-09-25-as11-low-pressure-flowing-sessions-unnamed` | `AS11-AUTO-SESSION-DETECTION-2026-08-24-BRIEF.md` | 5–6 sessions with pressure < 3 cmH2O for 18–100 min while flow ran. Auto-stop cannot see them, and no row names them (§1) |

A source that is a brief needs the `**Residue:**` back-reference added to that brief when the row is filed (`docs-ledger` check 8).

### Stale header facts found in passing (stamping fixes, not defects)

- `CPAP-ACQUISITION-HARDENING-AUDIT` §8: INV1/3/5/9 read "pending P1". `cpap_record.RawRecordSink` is wired (`capture.py:9996-10003`).
- `CPAP-SPOOL-ACQUISITION`: the "Not yet wired — deliberately" section is stale. The inventory adapter is called from `capture.py:8864` (#1941).
- `MULTI-SENSOR-DERIVATIONS-FOLLOWUPS`: "§2 at 2 of 3 legs" is stale. PpgDex reaches the fusion via #2115.
- `FINISHED-WORK-IMPROVEMENTS`: box A should be `[x]` (the parent is DONE 2026-09-02). The 09-13 B6 row contradicts `DEEP-AUDIT-IV:346` (retired).
- `PYTHON-TYPES-AND-FORMAT`: "Live count: 41" should read 37 (baseline re-set 2026-09-22).
- `DEEP-AUDIT-V-FOLLOWUPS`: "§1.1 remains the open item" contradicts its own §1 box ("§1 IS SPENT").
- `SAMPLE-VALIDITY-ENVELOPE`: box 5 is met (parent `BLE-TRANSPORT-REDESIGN:64`) but unticked.
- `CROSS-DOMAIN-METHODS-FOLLOWUPS` / `MULTI-SENSOR-DERIVATIONS-FOLLOWUPS`: line references have drifted again (cite the identifier).

---

## 1 · `AS11-AUTO-SESSION-DETECTION-2026-08-24-BRIEF.md`

**Status (verbatim, first clause):** `**Status:** PROPOSED (parked 2026-09-02 — three open items ALL need an attended box session and one needs code first: …` (the header is roughly 9 kB long. It carries a withdrawal of 2026-09-03, a re-verification of 2026-09-19 and a same-day correction). `**Created:** 2026-08-24 · **Follows:** AS11-SESSION-DETECTOR-IMPLEMENTATION-2026-08-24`
**Last verified:** in the header, "RE-VERIFIED 2026-09-19 (Wren, box + tree)". Last commit to the file: 2026-09-19.

The brief is a research report. Its work items are the four entries under **Open items**, plus the three **Design notes** that fed the implementation.

| # | item | verdict | evidence on `origin/main` (`60755013`) |
|---|---|---|---|
| O1 | Debounce **n** over natural mask-offs | **BUILT (closed on production evidence)** | The brief's Open items section marks it ✅ CLOSED 2026-09-19. It is carried by the acting auto-stop: `capture-host/capture.py:10066-10092` (`cpap.ble_stream.auto_stop`, `hold = float(ac.get("hold_sec", 120.0))`). This is a measurement closure, not code this brief owes |
| O2 | `Leak`-validity timing (promote from corroborator to primary?) | **NOT BUILT** | `Leak` is still not polled: `capture-host/cpap_shadow_runner.py:37` `POLL_ITEMS = ["FGState", "MaskPressure", "MachineMetrics"]`. No commit since 09-19 touches the runner. The measurement cannot start until `Leak` is in the poll set |
| O3 | `SubscribeEvent` (0x3a) yes/no | **code BUILT · result UNDECIDABLE** | The RPC and recorder landed in #2688 (`capture-host/as11_link.py:262` `subscribe_event`, `cpap_events.py`, `as11_pull.stream(subscribe=…)`) and **ship default-OFF** (`capture-host/config.example.yaml:375-377` `events: enabled: false`). The PR says "Nothing was armed on the box". **What decides it:** one armed night on vigil, whose `cpap_events` JSONL either holds `EventNotification` rows or does not |
| O4 | Clock investigation | **BUILT** | `capture-host/as11_clock.py` and `probe_as11_clock.py` (#1749, #1956 "the measured AS11 clock offset reaches the acquisition envelope"). The header already records it as ANSWERED and closed |
| D1 | Poll only while inactive | **BUILT** | The header's 09-19 note: `cpap_shadow_runner` defers while the controller streams and writes 0 rows during therapy (11/11). Supervisor: `capture-host/cpap_supervisor.py:155` `CPAPSessionSupervisor` |
| D2 | `Leak` is a corroborator until proven | **NOT BUILT** | Same absence as O2 |
| D3 | Declared stamp source plus device-vs-box offset | **BUILT** | #1749 (timeshift sidecar), #1956 |

**Merged PRs since 2026-08-24 on the named paths** (`cpap_shadow_runner.py`, `cpap_supervisor.py`, `cpap_detect.py`, `as11_clock.py`, `probe_as11_clock.py`, `tests/test_as11_detector_read_only.py`): #1746 · #1749 · #1765 · #1770 · #1791 · #1797 · #1948 · #1956 · #1970 · #1984 · #2022 · #2151. Also relevant: #2688 (`as11_link.py`, SubscribeEvent). **Pending changesets naming this brief:** none.

**Recommendation: PROPOSED — restamp.** Draft stamp text:
> `**Status:** PROPOSED (core BUILT, remainder code + box-blocked — verified 2026-09-25: debounce CLOSED on production auto_stop evidence (09-19); clock ANSWERED (#1956); SubscribeEvent recorder BUILT and shipped default-OFF (#2688), its yes/no owed from one armed night; Leak still absent from cpap_shadow_runner.py:37 POLL_ITEMS — code first, then the timing measurement) · **Created:** 2026-08-24 · **Follows:** AS11-SESSION-DETECTOR-IMPLEMENTATION-2026-08-24`

The current header is about 9 kB and contradicts itself: its own 09-19 note says so. A restamp should **replace** that header, not append to it, and move the history into the body.

**Residue candidates:**
- The 5–6 sessions with pressure < 3 cmH2O for 18–100 min while |flow| was 0.28–0.65 L/s (Open items O1). Auto-stop cannot see them by construction, and no row names them. Suggested key: `2026-09-25-as11-low-pressure-flowing-sessions-unnamed`.
- The 09-03 clause "reads Standby/0.1 throughout nights when therapy provably ran". The header itself says it must be re-derived in host time before it is cited again. That re-derivation has not been done.

---

## 2 · `AS11-SESSION-DETECTOR-IMPLEMENTATION-2026-08-24-BRIEF.md`

**Status (verbatim, first clause):** `**Status:** PROPOSED (parked 2026-09-02 — increments 1–2 BUILT and running in production (83befab4 #1746; …) … **Next step:** none — increment 3 CLOSED AS SATISFIED 2026-09-19 with a stated reopening criterion …) · **Created:** 2026-08-24`
**Last verified:** in the header, "RE-VERIFIED 2026-09-19 (Wren, box + tree)". Last commit to the file: 2026-09-19.

| # | item | verdict | evidence |
|---|---|---|---|
| DW1 | `cpap_supervisor.py` + `cpap_detect.py` + `as11_pull.get_items` land green; the daemon constructs the supervisor behind `as11_detector.enabled` (default False) | **BUILT** | `capture-host/cpap_supervisor.py:155` `CPAPSessionSupervisor`. `capture-host/as11_pull.py:93` `get_items`. The daemon hook is at `capture-host/capture.py:10319-10362` (`if not (cfg.get("as11_detector") …).get("enabled")` → `cpap_shadow_runner.run_shadow_loop(… supervisor=cpap_supervisor.CPAPSessionSupervisor())`). Default off: `config.example.yaml:458-460`. PRs #1746 and #1765 |
| DW2 | (rewritten 08-26) one night's BOUNDARY events captured and reviewed, debounce tuned, acting-mode follow-up spawned | **BUILT (by measurement + ruling)** | Boundaries were reviewed in the 09-19 T1 measurement in the header (11/11 sessions, sighting 3–17 s before stream start). Debounce was closed in the parent brief (O1). The acting follow-up became Rollout item 4, "CLOSED AS SATISFIED 2026-09-19", with a verbatim reopening criterion |
| DW3 | READ-ONLY confirmed by source scan | **BUILT** | `capture-host/tests/test_as11_detector_read_only.py` (#2151). It scans all three detector modules with comments stripped and strings kept |
| R1 | Increment 1 — core + `probe_as11_shadow.py` | **BUILT** | `capture-host/probe_as11_shadow.py` (#1746) |
| R3 | Increment 2 — `settings_schema` rows + `config.example.yaml` + default-OFF hook | **PARTLY BUILT** | The hook and `config.example.yaml:458` exist. **No `as11_detector.*` row exists in `capture-host/settings_schema.py`**: the key is absent from the UI allowlist, and `git log -S'as11_detector' -- settings_schema.py` is empty. The schema file's own header treats absence as deliberate for dangerous keys only. Whether this key was left out on purpose is UNDECIDABLE from code |
| R4 | Increment 3 — acting mode | **CLOSED (ruling)** | Lead ruling 2026-09-19: `auto_start` already acts on this detector's `Therapy` sighting |

**Merged PRs since 2026-08-24 on the named paths:** #1746 · #2151 (supervisor/detect/probe/test). Daemon integration landed through `capture.py` in #1765 · #1770 · #1797. **Pending changesets naming this brief:** none.

**Recommendation: DONE.** Every "Done when" bullet is met. The one partial item (R3's schema row) is a rollout detail, not a done-when. Draft stamp:
> `**Status:** DONE — <date> (verified 2026-09-25: DW1 capture.py:10319-10362 behind as11_detector.enabled default False; DW2 boundary review + debounce closed 2026-09-19, increment 3 closed as satisfied with a reopening criterion; DW3 tests/test_as11_detector_read_only.py #2151) · **Residue:** <key> · **Created:** 2026-08-24`

⚠ Stamp DONE only after `capture-host/check.sh` is green on the stamping commit. This cloud session did not run it (see the header).

**Residue candidates:**
- `capture-host/cpap_detect.py:8` says "the daemon hook is a later increment" and `:101` says "acting mode is a later increment". Both are stale now that the hook exists (capture.py:10319) and increment 3 is closed. Suggested key: `2026-09-25-cpap-detect-comments-predate-the-hook`.
- `as11_detector.enabled` / `poll_interval_sec` are absent from `settings_schema.SETTINGS`, so they are not toggleable from the monitor, and the default-equals-fallback scan (#3007) does not cover them. This needs an owner decision on whether the omission is deliberate.

---

## 3 · `CPAP-ACQUISITION-HARDENING-AUDIT-2026-08-23-BRIEF.md`

**Status (verbatim, first clause):** `**Status:** PROPOSED (parked 2026-09-02 — the living CHARTER for the P1–P5 programme; it outlives its phases and cannot be closed by them. … **Next step:** execute CPAP-ACQ-P3-GAP-ACCOUNTING-2026-09-18-BRIEF.md W1–W4 …) · **Created:** 2026-08-23`
**Last verified:** in the header, "Re-verified 2026-09-21 (Heron)". Last commit to the file: 2026-09-21.

**Done when.** 9 of 11 boxes are already ticked in the brief. The two open ones:

| # | item | verdict | evidence |
|---|---|---|---|
| DW-a | "Each build phase spawns its own executable brief + PR" | **PARTLY BUILT** | P1–P4 each have a brief and all four are DONE: `CPAP-ACQ-P1-RAW-RECORD` (DONE 2026-08-24), `-P2-LIFECYCLE` (DONE 2026-08-25), `-P3-GAP-ACCOUNTING` (DONE 2026-09-20), `-P4-SPOOL-TRANSACTION` (DONE 2026-09-21). **No brief exists for P5 (reconnect/restart state), P6 (clock-offset sidecar), P7 (replay + chaos) or P8 (overnight hardware validation).** P6's substance landed without a brief (`as11_clock.py`, #1749/#1956). Some P7 material exists (`capture-host/tests/test_chaos_ordering.py`, 21 CPAP mentions), but there is no phase brief to measure it against |
| DW-b | MASTER CHECKLIST: all 12 invariants satisfied and test-backed | **NOT BUILT (one invariant unwired)** | Per-invariant table below |

**§8 invariants as they read in the brief vs. the tree.** The §8 table is stale for five rows:

| INV | §8 says | tree says | verdict |
|---|---|---|---|
| INV1 one session per sample | pending P1 | `capture-host/cpap_record.py:68` `RawRecordSink`, one file per `session_id` (`new_session_id` :56). Wired at `capture.py:9996-10003`. Tests in `tests/test_cpap_record.py` | **BUILT** |
| INV2 explicit lifecycle | SHIPPED #1679 | `cpap_acq.py` state machine | BUILT |
| INV3 raw never silently derived | pending P1 | `cpap_record.py` docstring: raw samples stored verbatim. Tests in `tests/test_cpap_record.py` | **BUILT** (sink contract; not re-audited line by line) |
| INV4 device time kept | core honors | `as11_pull.stream` yields device time. `cpap_record` stores it verbatim | BUILT |
| INV5 observed interval preferred | pending P1 | `cpap_record.py` records the device's own `interval_ms` (docstring :9-10) | **BUILT** (as above) |
| INV6 partial round can't advance cursor | SHIPPED | #1711 · #1838 · #2738 | BUILT |
| INV7 transport gap explicit | PARTLY LIVE (09-18) | P3 is DONE 2026-09-20. `classify_frame` is now the live classifier (`as11_pull.py:34`, `:181`). The `overflow` writer is at `cpap_ingest.py:229`. `stalls`/`post_drop_tail` are published as **`None` — UNMEASURED** (`cpap_ingest.py:106-107`), which is §∅-correct | **BUILT (as honest nulls for two counters)** |
| INV8 recovery ≠ continuity | SHIPPED 2026-09-18 | `capture-host/cpap_continuity.py`, `tests/test_cpap_continuity.py` (#2634) | BUILT |
| INV9 bus not the sole copy | pending P1 | `RawRecordSink` is wired via `extra_sinks` **before** the bus push (`cpap_record.py` docstring, `capture.py:10003`) | **BUILT** |
| INV10 unknown stays unknown | SHIPPED #1679 | — | BUILT |
| **INV11 one acquisition owner** | SPAWNED → P3 W4 | `capture-host/cpap_acq.py:157` `AcquisitionOwners` (#2633) is tested (`tests/test_cpap_acq.py:223-275`) but **has no production caller**. `grep -rn AcquisitionOwners --include=*.py capture-host/` outside `tests/` returns only its definition, and nothing in `cpap_stream.py` or `capture.py` constructs or acquires it. P3's W4 "done means" requires that *"an acquisition acquires an explicit owner token for a device before it may stream"*. #2633's own body scopes itself to the registry and names the cross-process durable lock as a separate unit | **NOT BUILT (built, unwired)** |
| INV12 clean vs abrupt shutdown | SHIPPED #1679 | — | BUILT |

**Merged PRs since 2026-08-23** on `cpap_record.py · cpap_acq.py · cpap_ingest.py · cpap_continuity.py`: #1679 · #1688 · #1702 · #1708 · #1784 · #1804 · #2606 · #2627 · #2633 · #2634 · #2641 · #2688 · #2691. There are 33 commits across the wider path set (these plus `cpap_stream.py`, `as11_pull.py`, `as11_link.py`, `cpap_harvest.py`). **Pending changesets naming this brief:** none.

**Recommendation: PROPOSED — restamp.** The brief is a living charter by its own definition. The header's claim that INV1/3/5/9 are "pending P1" is false against the tree, and the INV7/INV8 rows have moved on. Draft stamp:
> `**Status:** PROPOSED (core BUILT, remainder INV11 wiring + P5/P7/P8 phase briefs — verified 2026-09-25: P1–P4 briefs all DONE; INV1/3/5/9 BUILT via cpap_record.RawRecordSink wired at capture.py:9996-10003 (§8 rows stale); INV7 BUILT with stalls/post_drop_tail as explicit UNMEASURED nulls; INV8 BUILT cpap_continuity.py; INV11 AcquisitionOwners (cpap_acq.py:157, #2633) tested but has NO production caller — the one open invariant; no briefs exist for P5/P6/P7/P8, P6's substance shipped as as11_clock.py) · **Created:** 2026-08-23`

**Residue candidates:**
- **`AcquisitionOwners` has no caller.** INV11's guard exists only in tests, while `CPAP-ACQ-P3-GAP-ACCOUNTING` is stamped DONE with "no open items", and its W4 done-means ("acquires … before it may stream") is not met. This is §4b's shape: a check that exists and examines nothing. Suggested key: `2026-09-25-inv11-owner-registry-has-no-caller`, source `capture-host/cpap_acq.py`.
- The §8 table's INV1/3/5/9 rows read `pending P1` a month after P1 shipped. The header already flags this; it needs a four-row reconciliation.

---

## 4 · `CPAP-SPOOL-ACQUISITION-2026-08-25-BRIEF.md`

*Repo-side items only, per the task scope. The brief itself contains no vendor-src path, and none was opened.*

**Status (verbatim, first clause):** `**Status:** PROPOSED (parked 2026-09-02 — re-verified today and the blocker still holds, but narrower than the header claimed. … **Owner:** owner (box, attended; remote at present) · **Next step:** the witnessed pull — items 2 and 4 are downstream of it) · **Created:** 2026-08-25`
**Last verified:** in the header, "RE-VERIFIED 2026-09-19 (Heron)". Last commit to the file: 2026-09-19.

| # | item (Do / Done when) | verdict | evidence |
|---|---|---|---|
| Do-1 / DW1 | One real spool pulled end-to-end, **fragment log committed** as evidence (attended, dated) | **NOT BUILT (repo side)** | `git ls-files \| grep -iE 'spool\|fragment'` returns only briefs and the three `tests/test_cpap_spool*.py`. No fragment log is committed. The header records an **unattended** 2026-09-19 retrieval on the box (ledger 2 → 4 rows), which is box evidence and not a committed artifact |
| Do-2 / DW2 | Assembler fed the real fragments; envelope emitted; deviations from fixtures listed | **NOT BUILT** | Depends on DW1's committed log. No commit since 09-19 touches `cpap_spool.py` |
| Do-3 / DW3 | Caller behind a default-OFF flag | **BUILT** (already ticked) | `capture-host/capture.py` `_maybe_start_cpap_spool_pull` (currently `:10776`, called at `:11754`, the **third** line drift the header warned about; cite the symbol), plus `cpap_spool_caller.py` (#1838) |
| Do-4 / DW4 | §11 three-way convergence on ≥1 night, bands pre-stated | **NOT BUILT** | The bands are pre-stated in the brief (§11 Set A/B). No convergence measurement is committed |
| Do-5 | Evidence contract: an acquisition-evidence envelope + the raw fragment log as primary artifact | **UNDECIDABLE** | `capture-host/acq_evidence_cpap.py` exists. Whether the **spool** pull emits an envelope through it could only be shown by the DW2 run |
| — | Inventory oracle (built 2026-08-28) | **BUILT and now WIRED** | `capture-host/cpap_inventory.py` (#1924), `cpap_inventory_adapter.py` (#1941), called from `capture.py:8864-8871` via `on_harvest_complete`. The brief's section "Not yet wired — deliberately" is **stale** |
| DW5 | Follow-up brief spawned or "nothing surfaced" noted | **NOT BUILT** | Downstream of DW1 by the header's own statement |

**Merged PRs since 2026-08-25** on `cpap_spool.py · cpap_spool_caller.py · cpap_inventory.py`: #1838 · #1924 · #1941 · #2612 · #2647. **Pending changesets naming this brief:** none.

**Recommendation: NO CHANGE to the status.** It is correctly PROPOSED and box-blocked. A header refresh is warranted, though. Optional draft stamp if Kestrel restamps:
> `**Status:** PROPOSED (caller + inventory oracle BUILT, remainder box-blocked — verified 2026-09-25: DW3 BUILT (_maybe_start_cpap_spool_pull, cite the symbol — third line drift); inventory oracle WIRED via capture.py on_harvest_complete (#1941), so §"Not yet wired" is stale; DW1/DW2/DW4/DW5 need a committed fragment log from a witnessed pull, which ~17 days of retrieved spool data on the box (2026-09-19) now makes possible) · **Created:** 2026-08-25`

**Residue candidates:**
- The brief's "Not yet wired — deliberately" section contradicts #1941 (the adapter is called from `capture.py:8864`).

---

## 5 · `CROSS-DOMAIN-METHODS-FOLLOWUPS-2026-08-14-BRIEF.md`

**Status (verbatim, first clause):** `**Status:** IN-PROGRESS — 2026-08-26 (⚠️ **the 2026-08-20 audit fixed the BOXES and left the STATUS contradicting them.** …) · **Created:** 2026-08-14 · **DRAIN 2026-09-02 (Osprey)** … · **DRAIN 2026-09-06 (Magpie)** … · **DRAIN 2026-09-19 (Osprey): both remainders STILL BLOCKED — header unchanged.** …`
**Last verified:** in the header, "DRAIN 2026-09-19 (Osprey)". Last commit to the file: 2026-09-19.

The brief has nine Done-when boxes: 7 `[x]`, 1 `[~]`, 1 `[⛔]`.

| # | item | verdict | evidence |
|---|---|---|---|
| 1 | §1 cross-referenced at both ρ call sites | **BUILT** | `integrator-tch.js:42` ("WITHDREW the recommendation to 'measure it directly'"). `tools/tch-per-epoch-rho.mjs:120` ("carries ZERO information beyond the variances"). #1538. ⚠ The header cites `:105` for the second site; it has **drifted a third time**, to `:120` |
| 2 | §4 built, measured, REJECTED | **BUILT** | `tools/hostaxis-estimator-bakeoff.mjs` (#1236) |
| 3 | §7 blinded protocol exercised on a **real detector change** `[~]` | **NOT BUILT** | `git log --since=2026-08-20 -i -E --grep='blind(ed)? (analysis\|protocol)\|hidden offset\|unblind'` finds nothing. Outside this brief, no file in `tools/ briefs/ docs/` mentions unblinding or a blinded protocol. The 09-19 drain named #2540 and #2609 as candidates. Neither applies a hidden offset and unblinds, so neither exercises §7 as written |
| 4 | §3 power-analysed before running | **BUILT** | Recorded in §3.1 (#1236) |
| 5 | §3 corpus scoped correctly (28 nights) | **BUILT** | §3.1 |
| 6 | §3 E-QC attempted and correctly refused | **BUILT** | `tools/eqc-run.mjs` (#1238) |
| 7 | Hardware fourth stream `[⛔]` | **NOT BUILT (hardware does not exist)** | Owner-confirmed; see `R5-HR-TRIPLET-REFERENCE-2026-07-12` |
| 8 | §5.1 HAC re-derivation + bandwidth table | **BUILT** | Carried in §5.1 (L = 0/2/4/8) |
| 9 | §6.1 EDF weighting measured, refusal accepted | **BUILT** | §6.1 (0 of 10 reclassified). GMWM is explicitly left untested |

The later §7 (epidemiology capture–recapture, §7.1–§7.3, marked "BUILT AND RUN") sits after the Done-when block and adds no boxes.

**Merged PRs since 2026-08-14** on `integrator-tch.js · tools/tch-per-epoch-rho.mjs · tools/hostaxis-estimator-bakeoff.mjs · tools/eqc-run.mjs`: #1236 · #1238 · #1538 · #2705 · #2817. **Pending changesets naming this brief:** none.

**Recommendation: NO CHANGE.** IN-PROGRESS is right. Seven boxes are verified, one waits on an occasion and one on hardware that does not exist; neither remainder can be scheduled. The only edit worth making is the drifted line reference (`tools/tch-per-epoch-rho.mjs:105` → cite the `carries ZERO information` identifier, as the 09-06 drain already advised).

**Residue candidates:** none new. The line drift is the third occurrence of a pattern the header already names.

---

## 6 · `DEEP-AUDIT-V-FOLLOWUPS-2026-08-05-BRIEF.md`

**Status (verbatim, first clause):** `**Status:** IN-PROGRESS — 2026-09-20 (ALL THREE OWNER CALLS RULED 2026-09-20, nothing here is owner-blocked any more. …) · **Created:** 2026-08-05 · **Follows:** … · 🔴 RE-MEASURED 2026-09-03 … · RE-VERIFIED 2026-09-05 … · Owner ruling 2026-09-07 … · 🔴 RE-OPENED 2026-09-13 (Osprey) … · **Residue:** 2026-09-13-f5-corner-rekey-half-unbuilt`
**Last verified:** in the header, 2026-09-20 (Osprey). Last commit to the file: 2026-09-20.

The brief has no Done-when checklist. Its work items are §1 (three owner decisions on the 94-label badge debt), §2 (two defects found while fixing), and the §4 table of items still open from `DEEP-AUDIT-V`.

| # | item | verdict | evidence |
|---|---|---|---|
| §1.1 | 68 `metric()` tiles tiered by review | **BUILT** | The box in §1 says "§1 IS SPENT — verified against the TREE 2026-09-20 … executed on 2026-08-16 in `bb957d37`", owner-ruled (a) nothing owed. Gate: `tests/dex-tests.js:55742` `var KNOWN_UNREGISTERED = 0; // … 65 tiers owner-ratified. NEVER raise this.` ⚠ **The status line still says "§1.1 remains the open item", which contradicts that box** |
| §1.2 | Chart captions | **BUILT (decided)** | Option (c), 2026-08-16. Recorded in CLAUDE.md §🎫 ("A CHART CAPTION IS NOT A BADGE SITE") |
| §1.3 | 2 emoji heads → `_META_DENY` | **BUILT** | `bb957d37` (the same commit, per the §1 box) |
| §2.1 | `computeSleepStabilityScore` ordering bug | **BUILT** | Shipped #949 (as stated in §2) |
| §2.2 | `idForLabel` two resolution gaps | **BUILT** | Shipped #957, #958 |
| §4 F17 · F16 · F4 · F7 · F13 · F20+F21 · F18 | — | **BUILT** | Each row cites file:line; re-measured 2026-08-15 |
| §4 F12 | gyro unit oracle | **REFUTED** (do not ship) | §F12 |
| §4 F5 | Corner labels + consumer re-key | **BUILT (both halves)** | Consumer half: `5ef44486` (#2462), "a corner's weight was keyed by node name". The residue row `2026-09-13-f5-corner-rekey-half-unbuilt` is `fixed #2462` |
| §4 F8 | Coupling bout-clustering | **BUILT (measured, diagnostic not shipped by its own bar)** | `tools/nsrr-coupling-bout-fpr.mjs` (#2731) |

**Merged PRs since 2026-09-13** on `integrator-dsp.js · integrator-tch.js · tools/nsrr-coupling-bout-fpr.mjs`: #2462 · #2476 · #2479 · #2610 · #2731 · #2773 · #2801 · #2850 · #2853 (32 commits on those paths since 2026-08-05). **Pending changesets naming this brief:** none.

**Recommendation: DONE.** Every item is built, refuted by measurement, or owner-ruled "nothing owed", and the single residue row is closed. The IN-PROGRESS status survives only on the "§1.1 remains the open item" clause, which the brief's own §1 box (same date, same author) contradicts. Draft stamp:
> `**Status:** DONE — <date> (verified 2026-09-25: §1 spent in bb957d37, KNOWN_UNREGISTERED = 0 at tests/dex-tests.js:55742, owner-ruled nothing owed 2026-09-20; §2.1/§2.2 shipped #949/#957/#958; §4 all closed — F5 both halves (#2462, residue fixed), F8 measured (#2731), F12 refuted) · **Residue:** 2026-09-13-f5-corner-rekey-half-unbuilt · **Created:** 2026-08-05 · **Follows:** DEEP-AUDIT-V-2026-08-04-BRIEF.md · DEEP-AUDIT-IV-2026-08-04-BRIEF.md`

⚠ `docs-ledger` check 8 requires the `**Residue:**` back-reference to survive the restamp. Stamp DONE only with the `no-fabricated-tier` group (tests/dex-tests.js:55609) and the full suite green on the stamping commit.

**Residue candidates:** none. The header's self-contradiction is a stamping fix, not a defect.

---

## 7 · `FINISHED-WORK-IMPROVEMENTS-2026-08-20-BRIEF.md`

**Status (verbatim, first clause):** `**Status:** IN-PROGRESS — 2026-09-21 (re-verified: the only open box is §C, and it is FIELD-GATED — C3 and C4 recorded (CAPTURE-FILESET-RESUME DONE 09-03; DEVICE-RATE-TRUTH DONE 09-21), C1/C2 need a supervised box evening and cannot be executed from rig. …) · **Created:** 2026-08-20 · **Follows:** …`
**Last verified:** 2026-09-21 in the header. Last commit to the file: 2026-09-21.

| # | item (Done when) | verdict | evidence |
|---|---|---|---|
| A `[~]` | The wiring brief's four boxes (2a, 2b, 2c, §4 → B3) | **BUILT** | `O2RING-TIME-CAPABILITY-WIRING-2026-08-19` is **DONE — 2026-09-02** ("all three wirings shipped"; 2a/2b #1643, 2c #1635). The consumer is `integrator-dsp.js` reading `json.timingSource`. §4 is decided (B3). **The box should read `[x]`** |
| B1 `[x]` | Vacuous green fixed + sibling scan | **BUILT** | #1626 |
| B2 | Retention prune gated on archive | **BUILT** | `nightarchive.unarchived_nights`, wired into `plan_prune`. Test: `test_nightarchive.py` ("no second copy ⇒ nothing is deleted") |
| B3 | TCH fiducial-network decision + first closure residual | **HALF** | Decision taken (`O2RING-TIME-CAPABILITY-WIRING` §4a). The residual is structurally uncomputable from existing captures (one of three pairwise offsets exists), as the brief itself records |
| B4 | `o2ring-dat-timefit` run routinely | **BUILT** | `tools/trio-batch.mjs` `datTimefit` block (#1659, `49a774a6`). Box side: nightqc digest (#1663) |
| B5 | Blind KNOWN-CLOCK scoring run | **NOT BUILT (procedural)** | Needs two operators by design, and one session cannot discharge it |
| B6 | rMSSD-alternation punch-list | **BUILT (retired by owner)** | `briefs/DEEP-AUDIT-IV-2026-08-04-BRIEF.md:346` records the question put to the owner and "answered **retire**". The 08-23 sweep is right. The brief's own 09-13 re-triage table ("open — needs the three absent nights located") is **stale** |
| C1 | Wedge drill | **NOT BUILT (field)** | `CONNECT-LOCK-DUTY-CYCLE` records no real BlueZ wedge cleared |
| C2 | Buzz prescription verdict | **NOT BUILT (field)** | `tools/pat-buzz-stability.mjs:244` still has an UNRESOLVED path. No CLEAN/MARGINAL/SWAMPED verdict is recorded |
| C3 | Fileset-resume night | **BUILT** | `CAPTURE-FILESET-RESUME` DONE 2026-09-03 |
| C4 | ppg2w battery night | **BUILT** | `DEVICE-RATE-TRUTH` DONE 2026-09-21 (`13f073e1`) |
| D `[~]` · `nightqc.ok` | — | **BUILT** | #1664 |
| D · auto-fiducial at capture start (`fiducial.enabled`) | — | **NOT BUILT** | No `fiducial.enabled` key in `capture-host/config.example.yaml` or `settings_schema.py`. The only buzz path is operator-commanded (`capture.py:5583-5596`, `_OXYII_BUZZ_PENDING` from `queue_ring_buzz`) |
| D · per-epoch adapter identity in LINK | — | **NOT BUILT** | The adapter travels as a per-file `# adapter=` header comment (`writers.py:1660`, `:2180`). No per-epoch column was found |
| D · pair-specific skew re-fit · PAT anatomical-sign repair · Allan multi-night families | — | **UNDECIDABLE** | Their home briefs are DONE (`INTEGRATOR-POOLED-CLOCK-APPLY` 08-01, `PAT-OFFSET-ESTIMATOR-FOLLOWUPS` 09-21, `ALLAN-DEVIATION` 08-12), but a DONE parent does not show that *this* D item was built. **What decides it:** reading each home brief's final section for the named item. Not done in this pass |

**Merged PRs since 2026-08-20** on `tools/trio-batch.mjs · capture-host/nightarchive.py · tools/o2ring-dat-timefit.mjs` (the paths this brief names): #1635 · #1647 · #1657 · #1658 · #1659 · #2039 · #2059 · #2144 · #2221 · #2350 · #2439 · #2749 · #2810 · #2846 · #2860 · #2867 · #2882. **Pending changesets naming this brief:** none.

**Recommendation: NO CHANGE.** IN-PROGRESS is correct: C1 and C2 are field-gated, B5 is procedural, and D is open by design ("this brief only orders them"). The A box can be ticked `[x]` now, and the 09-13 table's B6 row corrected to retired.

**Residue candidates:**
- The 09-13 re-triage table marks B6 open after the owner retired it (DEEP-AUDIT-IV:346). This is a stamping defect in the brief, not a code defect.

---

## 8 · `GATT-HANDLE-MAP-2026-09-17-BRIEF.md`

**Status (verbatim):** `**Status:** PROPOSED · **Created:** 2026-09-17 · **Executes:** BLE-TRANSPORT-REDESIGN-2026-09-10-BRIEF.md §1.1, **ruled BUILD by the owner 2026-09-17** … · **Residue:** 2026-09-18-as11-implements-robust-caching · **Owner:** unassigned — needs a **box session**; deploys to vigil are owner-authorized only · **Relates:** …`
**Last verified:** no re-verification date in the header. Last commit to the file: 2026-09-18.

| # | item (§4 Done when) | verdict | evidence |
|---|---|---|---|
| 1 `[x]` | Handle map survives a disconnect | **BUILT** | `capture-host/gattmap.py` (#2603) persists `captures/gattmap.json` (`capture.py:11598` `gattmap.configure`). Test: `tests/test_gattmap.py:132` `test_the_map_survives_a_restart`. Box evidence in §3b |
| 2 | Forced Database-Hash change re-discovers, **planted** | **BUILT (module level)** | `tests/test_gattmap.py:101` `test_PLANT_a_changed_database_hash_RE_DISCOVERS`: `expected(ADDR, "deadbeef") is None` routes back to discovery |
| 3 | Planted mid-publish tree cannot produce a wrong handle; **it produces a refusal** | **PARTLY BUILT** | Detection exists: `gattmap.missing` plus `tests/test_gattmap.py:64` `…2026_09_09_tree_is_caught_as_partial` and `:71`. But **the capture path does not refuse.** `capture.py:11492-11501` uses the map only as `wait_hint`, and its own comment says it "is never allowed to decide anything on its own". The table recorder at `:11515` is "RECORD-ONLY … Nothing consumes this yet". No call site turns a partial tree into a refusal |
| 4 | A device with **no** Database Hash falls back **visibly** (counter or status field) | **NOT BUILT** | `tests/test_gattmap.py:115` shows a no-hash device keys on `None`. No counter or status field reporting "fell back, no hash" was found in `capture.py` or `gattmap.py` |
| 5 | `_settle_gatt_chars` still present and firing | **BUILT (present)** | `capture.py:11342`. Now widened by the hint (#2604). "Firing" is a box-log fact (the ~98 lines/night the comment predicts) and was not checked here |
| 6 | `check.sh` green | **UNDECIDABLE here** | Not run in this cloud session. It is decided by `capture-host/check.sh` EXIT=0 on the stamping commit |
| 7 `[x]` | Mutation fleet (corrected) | **BUILT (not applicable)** | `mutate_diff.py` is diff-scoped |
| 8 | Box session validates on the real four devices | **NOT BUILT** | §3b covered the AS11 only. The H10/Verity/O2Ring rails were found to be **unwired**, not silent, and wiring followed in #2630 (`capture.py:11268` `_gatt_record_rail`). No four-device validation is recorded |

**Merged PRs since 2026-09-17** on `capture-host/gattmap.py · tests/test_gattmap.py`: #2603 · #2604 · #2611 · #2630 · #2650 · #2662 · #2671. **Pending changesets naming this brief:** none. The header's `**Residue:**` row (`2026-09-18-as11-implements-robust-caching`) is **withdrawn** (by `2026-09-18-robust-caching-is-not-a-reachable-ceiling`).

**Recommendation: PROPOSED — restamp** (it currently reads as unstarted). Draft stamp:
> `**Status:** PROPOSED (core BUILT, remainder refusal-wiring + box — verified 2026-09-25: gattmap.py recorder + persistence + hash-keyed completeness oracle BUILT and wired for CPAP and the three wearables (#2603/#2604/#2611/#2630); items 1–2 BUILT and planted in tests/test_gattmap.py; item 3 detection BUILT but the capture path only HINTS (capture.py wait_hint) and never refuses a partial tree; item 4 no visible no-hash fallback counter; item 8 four-device box validation not recorded) · **Created:** 2026-09-17 · **Executes:** … · **Residue:** 2026-09-18-as11-implements-robust-caching · …`

**Residue candidates:**
- Done-when 3 is the brief's own "load-bearing one" (*"a wrong handle is silent, and silence is the failure mode"*). The oracle can see a partial tree, but no consumer acts on it, so the recorded table is observed and never used to decide anything (`capture.py:11515` "Nothing consumes this yet"). Suggested key: `2026-09-25-gattmap-oracle-has-no-refusing-consumer`.

---

## 9 · `MULTI-SENSOR-DERIVATIONS-FOLLOWUPS-2026-07-18-BRIEF.md`

**Status (verbatim, first clause):** `**Status:** IN-PROGRESS (parked 2026-09-05 — drain stamp, Magpie. Re-verified on origin/main fc0cf634: §1 closed and gated, §2 at 2 of 3 legs by design, §3 propagated, §5 opportunistic by owner decision. **The ONE remainder is §6's wrist leg** … ⚠️ **DRAIN R2 2026-09-19 — 24 landings, surface 11 files** … **Landings recorded, NOT assessed.** · **Created:** 2026-07-18 · … · **Residue:** 2026-09-02-respiration-fusion-no-fixture · **DRAIN 2026-09-11 (Brief runner) — RE-VERIFIED IN THE TREE, UNCHANGED.** …`
**Last verified:** 2026-09-19 (drain R2, landings not assessed). Last commit to the file: 2026-09-19.

The Done-when reads "each item is executed or carries an explicit park reason."

| § | item | verdict | evidence |
|---|---|---|---|
| §1 | Fabricated absence in per-epoch series: audit passes (ppgdex, cpapdex) | **BUILT** | §1 records both passes (2026-08-03). The header says "closed and gated" |
| §2 | PpgDex RIIV, the third respiration leg | **BUILT — the header's "2 of 3 legs" is stale** | Producer: `ppgdex-dsp.js:2925` `respRate: hfPeakF != null ? r2(hfPeakF * 60) : null` (#650, 2026-08-01) and whole-record `:6118`. Consumer: `integrator-dsp.js:483-484` (`if (summary.respRateBrpm == null) summary.respRateBrpm = _frq.respRate …`), added in **#2115 (2026-09-02)**, "PpgDex's respiration rate reaches the fusion". `fuseRespirationRate` (`integrator-dsp.js`) takes any node with `summary.respRateBrpm`, one observer per node. The linked residue `2026-09-02-respiration-fusion-no-fixture` is `fixed #2175` |
| §3 | A fusion gate must drive the real ingest seam | **BUILT (rule propagated)** | The header says "§3 propagated". It is a testing rule, not code |
| §4 | Residual derivations → §6 | see §6 | — |
| §5 | `_norm` single-pass strip in 7 registries | **PARKED (owner decision)** | "fix opportunistically" (owner, 2026-07-18). That is an explicit park reason, which satisfies the Done-when |
| §6 | Wrist leg of sleep staging | **NOT BUILT** | `grep -c stageSleep ppgdex-dsp.js` → **0**. `ecgdex-dsp.js:2445` `function stageSleep(epochs, motionByTMin)`, with the absolute veto `m >= 60` at `:2477` (the header's `:2124`/`:2156` references have drifted). This is a full work-unit: threshold argument, PpgDex stager call (moves six fixtures), and the chest-vs-wrist validation |

**Merged PRs since the 09-19 drain** on `ecgdex-dsp.js · ppgdex-dsp.js`: #2658 · #2689 · #2752 · #2762 · #2785 · #2801 · #2816 · #2853 · #2897 · #2921 · #2962 · #2984 · #3002 · #3017 · #3023 · #3043. None of them adds `stageSleep` to PpgDex. **Pending changesets naming this brief:** none.

**Recommendation: NO CHANGE** to the status word (IN-PROGRESS, with §6 as the only remainder). Two header corrections are owed on the next stamp: §2 is **3 of 3 legs since #2115**, not "2 of 3 by design", and the `stageSleep` line references have drifted (`:2124` → `:2445`, `:2156` → `:2477`; cite the symbol).

**Residue candidates:** none new. The §2 clause is a stale-stamp correction.

---

## 10 · `OPERATIONAL-MATURITY-ROADMAP-2026-08-27-BRIEF.md`

**Status (verbatim, first clause):** `**Status:** PROPOSED (parked 2026-09-05 — 🟢 **OWNER RULING 2026-09-06 — the §15 NULL RESULT DOES NOT CLOSE THE CHARTER; it stays OPEN for §13/§14.** … **Next step:** none a rig session can schedule; the §17 checkboxes are ticked only from box evidence) · **Residue:** 2026-09-15-capture-rss-step-plateau · **§17 ticked 2026-09-15 (Kestrel, owner-directed): 13 of 18 …** · **Created:** 2026-08-27 · **Owner-issued directive** …`
**Last verified:** 2026-09-15 (§17 ticking). Last commit to the file: 2026-09-16.

This is an owner charter. The work items are the §17 acceptance skeleton (18 boxes, 13 ticked on 2026-09-15 with inline evidence) plus §13 (resource budget) and §14 (long-run behaviour). Only the open items are re-checked here. The 13 ticked boxes carry grep-count evidence inline and were not re-derived one by one.

| # | item | verdict | evidence |
|---|---|---|---|
| §17.7 | Device identity survives renumbering/reboots | **HALF: renumbering BUILT, reboot UNDECIDABLE** | Renumbering is tested: `capture-host/tests/test_as11_shadow_wire.py:144` `test_resolve_cpap_adapter_maps_a_MAC_to_the_CURRENT_hci`. "Survives reboots" needs a box reboot with the identities logged before and after. Unchanged since 09-15 |
| §17.8 | O2Ring autonomous harvest integrates with the resource model | **NOT BUILT (by the charter's own test)** | `O2RING-AUTONOMOUS-HARVEST-2026-08-26-BRIEF.md` is still `PROPOSED (parked 2026-09-02 …)` |
| §17.9 | CPAP acquisition recovers without manual intervention where safe | **NOT BUILT (by the charter's own test)** | Keyed on `CPAP-ACQUISITION-HARDENING-AUDIT`, which stays PROPOSED (see §3 of this report: P1–P4 DONE, but INV11 is unwired and there is no P5 reconnect/restart brief) |
| §17.16 | Long-run/restart/race behaviour tested | **PARTIAL** | The software half exists (`test_resource_orchestration.py`, `test_cpap_acq.py`, `test_link_distress_wire.py`; #2764 added the open-writer leak counter). No multi-day physical run is recorded |
| §17.17 | Physical hardware validates the autonomous paths | **NOT BUILT** | No box evidence is committed. This is the charter's gate |
| §13 | Resource-budget audit | **UNDECIDABLE / partly measured elsewhere** | Measurements live in residue rows (`2026-09-15-capture-rss-*`, `2026-09-23-daemon-rss-climbs-…`, all OPEN) and #2863 (QC digest 1116 → 245 MB). No §13 budget document exists that the charter could tick against |
| §14 | Long-run behaviour | **NOT BUILT** | Same as §17.16/§17.17 |

**Merged PRs since 2026-09-15:** 157 commits touch `capture-host/`, the path this charter names, which is too broad to list usefully. On the two test files cited by the open boxes: #2764. **Pending changesets naming this brief:** none. The header's residue row `2026-09-15-capture-rss-step-plateau` is still **OPEN**.

**Recommendation: NO CHANGE.** PROPOSED is correct, and the owner ruled on 2026-09-06 that the charter stays open for §13/§14. All five open boxes are box-bound or keyed on child briefs that are still PROPOSED.

**Residue candidates:** none new.

---

## 11 · `PINNED-SPAN-POPULATIONS-2026-09-18-BRIEF.md`

**Status (verbatim):** `**Status:** IN-PROGRESS (§5.2 REFUTED 2026-09-18 — corrected in place; the cause and the rule it produced are in §5.2a) · **Created:** 2026-09-18 · **Residue:** 2026-09-20-census-file-list-not-retained, 2026-09-18-ecg-saturation-unflagged`
**Last verified:** no re-verification date in the header. Last commit to the file: 2026-09-21 (the §7 saturation box ticked).

| # | item (§7 Done when) | verdict | evidence |
|---|---|---|---|
| 1 `[x]` | Denominators deduplicated by bytes | **BUILT** | §0/§1 of the brief (#2640) |
| 2 `[x]` | Invariant vs non-invariant statistics partitioned | **BUILT** | §1 |
| 3 `[x]` | Controls run as a census | **BUILT** | §4. The file-list residue `2026-09-20-census-file-list-not-retained` is `fixed #2862` |
| 4 `[x]` | Pre-registered ECG branch tested, refutation recorded | **BUILT** | §5 and §5.2/§5.2a |
| 5 `[x]` | Rig/box overlap quantified (45 of 3013) | **BUILT** | §7 |
| 6 `[ ]` | Box-side PPG run over the remaining 2,968 captures | **NOT BUILT** | No commit since 2026-09-18 records it (`git log --since=2026-09-18 -i -E --grep='pinned.span\|2,?968\|PINNED-SPAN'` returns only #2620 · #2636 · #2640 · #2645 · #2783 · #2785 · #2968, none a box census). It is commissioned to the box lane |
| 7 `[x]` | Saturation-vs-absence semantics | **BUILT** | Owner ruled 2026-09-21. Matcher by magnitude in **#2785** (`quality.ecgRail`). The residue `2026-09-18-ecg-saturation-unflagged` was promoted to `ECG-SATURATION-ABSENCE-2026-09-18-BRIEF.md` |
| 8 `[ ]` | The threshold itself (unusable below ~50, viable 79–200) | **NOT BUILT** | `ppgdex-dsp.js:369` is still `const PIN_MIN_RUN = 5`. `:5947` says so itself: "NO THRESHOLD IS CHOSEN either". No commit since 09-18 has moved `PIN_MIN_RUN` (`git log -G'PIN_MIN_RUN *='` → #2636, #2645, both only re-labelling) |

**Merged PRs since 2026-09-18** touching this subject: #2620 · #2636 · #2640 · #2645 · #2785 · #2862. **Pending changesets naming this brief:** none.

**Recommendation: NO CHANGE.** IN-PROGRESS is accurate: 6 of 8 boxes are done, one is box-commissioned and one is an unchosen threshold. A header note would help: the threshold box is a compute-path decision (`computeHash` mover), and the box census should precede it.

**Residue candidates:** none new.

---

## 12 · `PPG-FOOT-PLACEMENT-FOLLOWUPS-2026-09-01-BRIEF.md`

**Status (verbatim, first clause):** `**Status:** IN-PROGRESS (re-verified 2026-09-21: the only open box is §4, an OWNER ruling on sdb1 — no ruling found, and the volume was seen mounting and unmounting on its own within eight hours overnight, which is the §4 finding continuing. …) ⚠️ **DRAIN R2 2026-09-19 — 13 landings, surface 2 files** …`
**Last verified:** 2026-09-21 in the header. Last commit to the file: 2026-09-21 (#2741).

| # | item (Done when) | verdict | evidence |
|---|---|---|---|
| §1 `[x]` | Wander pre-registration exists and was executed | **BUILT** | §1 FROZEN PRE-REGISTRATION and §1 RESULTS (2026-09-01): H_axis fails confirmation |
| §2 `[x]` | `channelSNR` export-or-delete | **BUILT (by delegation)** | `tools/pat-per-led.mjs:171-176` computes the same quantity from exported `bandpass`/`std`. `ppgdex-dsp.js:1468` `channelSNR` is still internal, and its export "rides the next real re-bundle", which is not owed by this box |
| §3 `[x]` | Recorded as a design constraint | **BUILT** | §3 is the record |
| §4 `[ ]` | Owner ruling on sdb1 and the stale mirror | **NOT BUILT (owner)** | `git log --since=2026-09-21 -S'sdb1'` returns nothing new. `docs/CORPUS-LOCATIONS.md:193` still carries "THE data VOLUME (sdb1) IS FAILING — DO NOT REMOUNT IT". The session-level half (keep the mirror and state its coverage) was closed 2026-09-06 |

**Merged PRs since 2026-09-01** on `tools/pat-per-led.mjs`: #2043 · #2501. On `ppgdex-dsp.js`, see the list in §9 of this report. **Pending changesets naming this brief:** none.

**Recommendation: NO CHANGE.** The header already says it "flips to DONE in the PR that records the ruling", and no ruling exists on main.

**Residue candidates:** none new.

---

## 13 · `PYTHON-TYPES-AND-FORMAT-2026-08-27-BRIEF.md`

**Status (verbatim, first clause):** `**Status:** PROPOSED (parked 2026-09-02 — ✅ **mypy drift FIXED 2026-09-03 — the done-when now carries the live number and its measurement date. Live count: 41** ⚠️ (… re-measured 2026-09-19 (Heron) — check.sh carries MYPY_BASELINE=41 …) … **§P3's countdown starts from 103, not 102.** · **Owner:** Vigil box · **Next step:** none — §P3 is a cou…`
**Last verified:** 2026-09-19 (Heron) in the header. Last commit to the file: 2026-09-19.

| # | item (§2 Done when) | verdict | evidence |
|---|---|---|---|
| P1 `[x]` | Advisory gates in `check.sh`, mypy pinned, baseline recorded | **BUILT** | `capture-host/check.sh:159-160` `MYPY_BASELINE=37` / `MYPY_BASELINE_DATE="2026-09-22"`. RISEN/at/BELOW is mechanised |
| P2-qwen `[x]` | Qwen lane triages its full queue (min 10) | **BUILT** | 12/12 triaged, 7 landed in #1949 (§P2c) |
| P2-session `[ ]` | Session lane triages argument/assignment classes; real-bug findings ledgered | **UNDECIDABLE** | The triage note at line 8 says "§P1 and §P2 are discharged", yet the box is unticked. Re-running `check.sh`'s own mypy invocation on `60755013` gives **37 errors**, of which **19 `[arg-type]` and 5 `[assignment]`** remain. "Triaged" does not require "fixed", and no ledger of session-lane real-bug findings was located. **What decides it:** a named ledger or audit file for the session lane, or its absence stated by the lane's owner |
| P3 `[ ]` | mypy blocking at 0; changed-files format blocking after fleet notice | **NOT BUILT** | mypy is at **37** (measured here: `Found 37 errors in 22 files (checked 468 source files)`), not 0. The format leg is still advisory (`check.sh:214` "flips blocking after fleet notice"). The residue row `2026-09-23-format-debt-sized-at-406-of-458` is still OPEN |
| — `[ ]` | Follow-up brief if the qwen lane earns expansion | **NOT BUILT (moot?)** | `QWEN-ENGINEERING-PROGRAM-2026-08-27-BRIEF.md` is `DONE — 2026-09-20 (SHELVED — owner ruling …: the program is not ratified and not now …)`. So expansion was declined at program level, and this box arguably closes as "not owed". That is the owner's call to record |

**Merged PRs since 2026-09-19** on `capture-host/check.sh`: #2672 · #2720 · #2730 · #2776 · #2815 · #2830 · #2838 · #3047. **Pending changesets naming this brief:** none.

**Recommendation: PROPOSED — restamp.** The header's "Live count: 41" is stale: the count is 37, baselined 2026-09-22 after #3044. Draft stamp:
> `**Status:** PROPOSED (core BUILT, remainder §P3 countdown — verified 2026-09-25: §P1 + qwen lane BUILT; mypy 37 errors on 60755013 with check.sh's invocation = MYPY_BASELINE=37 (2026-09-22), 19 arg-type + 5 assignment still in the session lane's classes; §P3 blocking flips at 0; format leg advisory, debt 406/458 (residue 2026-09-23-format-debt-sized-at-406-of-458); the qwen-expansion box is moot since QWEN-ENGINEERING-PROGRAM was shelved 2026-09-20) · **Owner:** Vigil box · **Created:** 2026-08-27`

Keep the existing header history in the body; do not delete it.

**Residue candidates:**
- The header states a live count (41) that main no longer has (37). This is the exact "count in a done-when with no expiry date" the header itself warns about. Not a new defect class, so no new row.

---

## 14 · `REM-STAGING-FOLLOWUPS-2026-08-02-BRIEF.md`

**Status (verbatim, first clause):** `**Status:** PROPOSED (re-verified 2026-09-21: §2b is EXECUTED — #2423, 99/99 records, REM recall 32 % median / precision 26 % — and was unstamped for nine days. The ONLY remainder is §2c, which is a DECISION the brief itself calls publishable …) · …`
**Last verified:** 2026-09-21 in the header. Last commit to the file: 2026-09-21 (#2741).

| # | item (§5 Done when) | verdict | evidence |
|---|---|---|---|
| 2a `[x]` | Labels-or-gap established | **BUILT** | DONE 2026-08-03 per the box |
| 2b `[x]` | Shipped conjunction scored against real PSG labels | **BUILT** | `tools/nsrr-stage-validate.mjs` (#856, #2423, #2469, #2813). 99/99 SHHS1 records, REM recall 32 % median, precision 26 % |
| 2c `[ ]` | A detector change proposed, or REM declared not recoverable from single-lead ECG + chest ACC | **NOT BUILT (owner decision)** | Since 2026-09-21, no commit proposes a REM detector change or records a not-recoverable declaration. `briefs/OWNER-DECISION-QUEUE-2026-09-03-BRIEF.md` has no REM-STAGING entry, so the decision is not queued where the owner reads |
| §1 `[x]` | The `genSynthetic` staging-validation constraint recorded | **BUILT (in the parent brief)** | The in-code copy in `ecgdex-dsp.js` is a named deferral that "rides the next behavioral ECGDex re-bundle". Several ECGDex compute re-bundles have landed since (e.g. #2984, #3002, #3043), but no staging-validation warning was added near `genSynthetic` (`ecgdex-dsp.js:224`). The deferral's trigger fired and was not taken. Minor |
| §4 | `respCv` standing don't-wire | **BUILT (holds)** | `ecgdex-dsp.js:1735-1738`: "Not yet consumed by the stager" |

**Merged PRs since 2026-08-02** on `tools/nsrr-stage-validate.mjs`: #856 · #2423 · #2469 · #2813. **Pending changesets naming this brief:** none.

**Recommendation: PROPOSED — restamp** (the brief is executed work waiting on one owner decision, not unstarted). Draft stamp:
> `**Status:** PROPOSED (core BUILT, remainder owner decision §2c — verified 2026-09-25: 2a DONE 2026-08-03; 2b EXECUTED #2423 (99/99 SHHS1, REM recall 32 % / precision 26 %); 2c — propose a detector change or declare REM not recoverable from single-lead ECG + chest ACC — is not in OWNER-DECISION-QUEUE and has no commit; §4 respCv don't-wire holds) · **Created:** 2026-08-02`

Kestrel may prefer to add §2c to `OWNER-DECISION-QUEUE` as the actual next step.

**Residue candidates:**
- §5's named deferral ("write the §1 constraint into `ecgdex-dsp.js` on the next behavioral ECGDex re-bundle") has had its trigger fire several times without being taken. Suggested key: `2026-09-25-ecgdex-gensynthetic-constraint-deferral-missed`.

---

## 15 · `SAMPLE-VALIDITY-ENVELOPE-2026-09-17-BRIEF.md`

**Status (verbatim):** `**Status:** PROPOSED · **Created:** 2026-09-17 · **Promoted-from:** BLE-TRANSPORT-REDESIGN-2026-09-10-BRIEF.md §1.2 (…) · **Owner:** unassigned · **Relates:** CLAUDE.md §∅ ABSENCE IS NULL …, signal-frame.js, the sidecar shipped in #2317`
**Last verified:** no re-verification date in the header. Last commit to the file: 2026-09-23 (#2950, the format-as-shipped section).

| # | item (Done when) | verdict | evidence |
|---|---|---|---|
| 1 `[x]` | §3.1 granularity reconciliation | **BUILT** | Answered 2026-09-18, k = 4 spans on a real night. §1b documents the format as shipped (#2950) |
| 2 `[ ]` | Consumer set **enumerated**, not asserted | **NOT BUILT** | No enumeration artifact exists (no table of every reader of a `*RUNS.txt` sidecar). One reader exists: `ppgdex-dsp.js:380` (`_PPGRUNS.txt`, "READ … AND CROSS-CHECK IT") and `:1078`. No reader exists for the H10/Verity `_ACC`, O2Ring `ACCRAW` or `PPG2W` sidecars. `ecgdex-dsp.js`'s "RUNS" hit is the unrelated SECTION-SCOPED-RUNS filter. That is one consumer found by search, not an enumeration |
| 3 `[ ]` | A **planted** blanking run reaches a `null` or coverage-annotated metric, and nothing else | **PARTLY BUILT (PpgDex only)** | PpgDex has planted-span tests: `tests/dex-tests.js:17998` "a pinned span is an ABSENCE, excluded like a gap", and `:18075` (the `_PPGRUNS` sidecar as a second population). No equivalent exists for the other streams whose sidecars are written |
| 4 `[ ]` | No consumer can reach a sample value without its validity, shown by a test that fails when the old read is reintroduced | **NOT BUILT** | No guard makes the unsafe read impossible (§3.3). `signal-frame.js` carries no validity field that consumers are forced through. No such regression test was found |
| 5 `[ ]` | Parent's §5 re-read and its §1.2 line updated to record the promotion | **BUILT (box not ticked)** | `briefs/BLE-TRANSPORT-REDESIGN-2026-09-10-BRIEF.md:64`: "⏩ **PROMOTED 2026-09-17 → SAMPLE-VALIDITY-ENVELOPE-2026-09-17-BRIEF.md**". The parent is DONE 2026-09-17 |

**Merged PRs since 2026-09-17** on this subject: #2950 (the brief's format section). Related writer-side work: #3006 (an H10 ECG run-length rule), #3004/#3037 (SOLID-NIGHT, which consumes absence at night level). **Pending changesets naming this brief:** `changes/2026-09-23-psftp-ok-over-answered-reads.md` (`brief: SAMPLE-VALIDITY-ENVELOPE-2026-09-17-BRIEF.md`) for **#2955**, "the offline pull's `ok` is published only over reads that ANSWERED". That is a §∅ aggregate-over-absence fix (ABSENCE-SURVEY row `polar_psftp.py:736`) filed against this brief, but it discharges none of the Done-when boxes above.

**Recommendation: PROPOSED — restamp** (it reads as unstarted, but two of five boxes are met). Draft stamp:
> `**Status:** PROPOSED (core BUILT, remainder consumer enumeration + enforcement — verified 2026-09-25: §3.1 reconciliation answered 2026-09-18 and the sidecar format documented as shipped (#2950); parent §1.2 carries the promotion marker (box 5 met, untick is stale); ONE node-side reader exists — ppgdex-dsp.js _PPGRUNS — with planted-span tests; no enumeration of consumers, no reader for the ACC/ACCRAW/PPG2W sidecars, no enforcement test) · **Created:** 2026-09-17 · **Promoted-from:** … · **Owner:** unassigned · …`

**Residue candidates:**
- Four of the six sidecar streams §3.1 measured (`H10 _ACC`, `Verity _ACC`, `O2Ring ACCRAW`, `O2Ring PPG2W`) have a writer and no reader. A seventh, the H10 `ecg` stream, gained a writer in #3006 (`capture-host/writers.py:110-117` `RUN_MIN_BY_STREAM`), and no `ecgdex-dsp.js` reader was found for it either. The sidecar records absence that no metric consults. This is §∅'s "validity must travel out-of-band" with the band delivered and unread. Suggested key: `2026-09-25-runs-sidecars-written-with-no-reader`, source `capture-host/writers.py`.

---

## 16 · `TCH-FUSED-ROBUST-HAT-2026-07-14-BRIEF.md`

**Status (verbatim, first clause):** `**Status:** IN-PROGRESS — 2026-08-27 (⚠️ **date corrected: …** …) · **Created:** 2026-07-14 · **DRAIN 2026-09-06 (Magpie) — blocker verified a THIRD time …; status UNCHANGED at IN-PROGRESS.** … · **DRAIN 2026-09-02 (Osprey) — BLOCKER RE-VERIFIED, still holds; status unchanged.** … **Owner: the OWNER** — … a planted-sigma decision …`
**Last verified:** DRAIN 2026-09-06 in the header (plus a 2026-09-19 commit to the file). Last commit to the file: 2026-09-19.

| # | item (Done when) | verdict | evidence |
|---|---|---|---|
| 1 `[x]` | `beatConfidence` in ECGDSP + PPGDSP, unit-tested | **BUILT** | `ecgdex-dsp.js:1291` and `ppgdex-dsp.js:2382` `function beatConfidence(peaks, sqi, fs, t0Ms, winSec)`. The two are held code-identical by the `beatConfidence mirror` group (#2609) |
| 2 `[~]` | Worker carries `cH`/`cV`; `tchSigmasFused` wired into both sigma tools **and the power real-overlay** | **PARTLY BUILT** | `analysis-stats.js:594` `function tchSigmasFused(hh, vv, oo, cH, cV, cO)` (single-sourced 2026-07-15), plus the Worker-local mirror at `sensor-trio-worker.js:264`. `sigma-no-reference` delegates (PR #114). **The power tool's real overlay still uses classic `tchSigmas`**: `sensor-trio-power-analysis.js:490` `loadReal` → `derivedMap(...)` → `tchSigmas(hh, vv, oo)` (`:515`). The corpus half was discharged 2026-08-09 (#1014, `timeseries.rr.conf` / `ppi.conf`). The remainder waits on the owner's planted-sigma ruling |
| 3 `[x]` | 06-12 σ_H10 CI collapses; clean nights stable | **BUILT** | PR #114 |
| 4 `[x]` | AF-safety unit test | **BUILT** | Done 2026-07-15 at both tiers |
| 5 `[x]` | Re-bundle + regen + corpus re-derived + papers restated | **BUILT** | PR #114 |

**Merged PRs since the 09-06 drain** on `analysis-stats.js · sensor-trio-worker.js · sigma-no-reference-analysis.js · sensor-trio-power-analysis.js · tools/trio-batch.mjs`: #2333 · #2350 · #2439 · #2736 · #2749 · #2810 · #2846 · #2860 · #2867 · #2882 · #2900. Only #2736 touched `sensor-trio-power-analysis.js`, and it did not reroute `loadReal`. **Pending changesets naming this brief:** none.

**Recommendation: NO CHANGE.** IN-PROGRESS is correct: 4 `[x]` and 1 `[~]`, whose remainder (`loadReal` → `tchSigmasFused`) is owner-gated on the planted-sigma decision. Two open residue rows are adjacent and bear on that decision: `2026-09-16-tch-degeneracy-is-estimator-not-data` and `2026-09-22-corpus-consumers-have-no-staleness-stamp`, both still OPEN.

**Residue candidates:** none new.

---

## 17 · `ZEPHYR-INSTRUMENT-2026-08-23-BRIEF.md`

*Repo-side items only, per the task scope. The brief contains no vendor-src path, and none was opened. The firmware-side content (image builds, flashing) is recorded in `NRF52840-DONGLE-FLASHING-2026-09-07` and was not inspected.*

**Status (verbatim, first clause):** `**Status:** IN-PROGRESS (2026-09-13, Wren: Task 2 TRIAGED ON THE BOX — its tooling is ALREADY BUILT (capture-host/jitterfloor.py + tools/ble-jitter-probe.py), the header's btmon/CAP_NET_RAW blocker is STALE …, and Zephyr vs Realtek is UNRUNNABLE here — …; Probe NOT yet run — held off the radios during the first overnight Zephyr soak. …) · **Created:** 2026-08-23`
**Last verified:** 2026-09-13 in the header. Last commit to the file: 2026-09-13.

The brief has no Done-when checklist. Its work items are Task 1 (flash with controller-side timestamping) and Task 2 (jitter probe).

| # | item | verdict | evidence |
|---|---|---|---|
| T1-flash | Zephyr image flashed and deployed | **BUILT (box/rig fact, recorded)** | The header and `NRF52840-DONGLE-FLASHING-2026-09-07-BRIEF.md` (REFERENCE, last-verified 2026-09-12). Doc PRs: #2425 · #2428 · #2430 |
| T1-timestamp | **Controller-side** ACL timestamping as an arrival-time source | **NOT BUILT (repo side)** | Routed to `RADIO-CLOCK-SIDECAR-2026-09-07-BRIEF.md`, which is `PROPOSED` ("firmware image with the anchor reports is BUILT and FLASHED …"). No node or capture-host consumer of a controller timestamp was checked into main within this brief's scope |
| T2-tool | Jitter probe tool | **BUILT** | `capture-host/jitterfloor.py` (production layer, drawn-axis fix #2450, DST fix #2774) and `tools/ble-jitter-probe.py` (HCI layer). The residue `2026-09-13-folded-base-prefers-the-largest-candidate` is `fixed #2450` |
| T2-run | Probe run: Zephyr#1 vs Zephyr#2 on one beacon (the Realtek arm is unrunnable on vigil) | **NOT BUILT** | Since 2026-09-13, no commit records a probe result (`git log --since=2026-09-13 -i -E --grep='jitter probe\|ble-jitter\|zephyr'` → only #2445 · #2450 · #2611 · #2643 and a drain doc, none a probe run). The header says "Probe NOT yet run" |

**Merged PRs since 2026-09-13** on `capture-host/jitterfloor.py · tools/ble-jitter-probe.py`: #2450 · #2774. **Pending changesets naming this brief:** none.

**Recommendation: NO CHANGE.** IN-PROGRESS is correct. The remaining work is one box probe run and the RADIO-CLOCK-SIDECAR arm, both box/owner-bound.

**Residue candidates:** none new.

---

Fleet-Session: Cloud (owner-launched, relay: none)
