<!--
  OPERATIONAL-MATURITY-AUDIT-2026-08-27-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS — 2026-08-27 · **Created:** 2026-08-27 · **Executes:** `OPERATIONAL-MATURITY-ROADMAP-2026-08-27-BRIEF.md` §1 (the audit) and §15 (the P0–P4 ranking that gates everything after it) · **Affects:** nothing yet — this brief is measurement only

# §1 audit — first pass: PRIORITIES 1–5 measured against HEAD

## 0 · Currency, stated before the first number

Measured at **`90fea439`**, `HEAD..origin/main` = **0 commits**, `git status --porcelain` = **0 files**.

🔴 **This line is not ceremony, and it is the audit's mandatory opening step.** The same inventory run
in the shared root — **18 commits behind, and missing `cpap_spool_caller.py` entirely** — returned
**16** not-wired entries against the current tree's **14**. An audit is *entirely* measurement, so a
stale tree does not yield a slightly-wrong audit; it yields a confident classification of a codebase
that no longer exists. Verify both numbers, in the tree you measure in, before the first result.

## 1 · What exists — the answer is "a great deal"

All nine subsystem families §1 names are present, **46 modules / 29,917 LOC**: O2Ring (6) · CPAP/AS11
(14) · H10+Verity (3) · clock (5) · adapters (4) · evidence (3) · storage (3) · health (4) ·
orchestration (4). **Nothing in §1's list is absent at module level.** This is why the charter's own
§1 warns against duplicating existing functionality, and why this audit is a CONSOLIDATION.

**Prior art that already carries whole columns** — do not re-derive:
- `CAPTURE-HOST-UNWIRED-MACHINERY-2026-08-14` + its `-FOLLOWUPS-2026-08-15` → the **IMPLEMENTED BUT
  NOT WIRED** column.
- `FINISHED-WORK-IMPROVEMENTS-2026-08-20` → carries a *"definitely NOT recommended; each has a record,
  do not re-open without new evidence"* list, which is the **NOT NEEDED** column already populated.
- `tools/find_unwired.py --check` → the live not-wired inventory, **14 entries**, each with a written
  justification. Machine-checked, so it cannot go stale silently.

## 2 · The classification (§1's five states)

| roadmap priority | verdict | evidence |
|---|---|---|
| **P#1 Autonomous recovery** | **ALREADY**, with gaps un-probed | `keep_running` supervises all 14 pollers · `_RECOVER` adapter watchdog + `_set_active_adapter` failover · `oxy_restart` process-restart recovery · `.part` partial-transfer handling in 5 modules · `oxy_inventory.classify` corrupt-artifact verdict · `_connect_timeout` bounding · `MAX_ATTEMPTS` |
| **P#2 Resource manager** | **ALREADY** — as broadcast guards, see §3 | `offline_lock.slot()` global exclusive pull slot · `_OXYII_PAUSE` · `blocking_devices` · `_RECOVER` · `is_capturing` |
| **P#3 Opportunistic acquisition** | **ALREADY — completed 2026-08-27** | `probe_justified` (presence · not-recording · rate limit) · `pull_deadline` budget · `flush_gate` finalisation · `oxy_inventory.reconcile` already-harvested |
| **P#4 Unified orchestration** | **NOT NEEDED on current evidence** — §3 | no `Manager`/`Orchestrator`/`Semaphore`/`acquire()` exists, and the measurement says one is not required |
| **P#5 Stable identity** | **ALREADY** | `resolve_hci` MAC→`hciN` resolved at every connect · `missing_identity` · `is_expected_ring` address-only |

**P#6–P#8 (long-run health · self-healing bounds · acquisition/analysis boundary) are NOT YET
MEASURED.** They are not "fine"; they are unexamined, and this brief says so rather than leaving a
reader to infer coverage from the table's shape.

## 3 · The headline: coordination is BROADCAST, not an orchestrator — and that is adequate

§5 asks Tepna to *evaluate whether* an orchestrator is needed. Measured: **14 background pollers, each
independently supervised by `keep_running`, and ZERO priority arbitration** — no manager class, no
semaphore, no `acquire()`.

⚠️ **An earlier draft of this section framed that as "6 mechanisms covering 28 possible pairs", which
is misleading and was cut.** The guards are not pairwise wiring. `_RECOVER` and `_OXYII_PAUSE` are
global `asyncio.Event`s that every actor checks; `offline_lock.slot(name)` is a single global exclusive
slot. That is **O(N) mechanisms, not O(N²)** — the design scales with device count, and the N²
framing would have manufactured an argument for a scheduler the evidence does not support.

**What is genuinely absent is priority arbitration**: nothing decides *which* acquisition wins when
two are simultaneously eligible. The guards make that largely moot by being **conservative** — they
defer rather than compete (a harvest waits for streaming; a pull waits for the slot; everything waits
for `_RECOVER`). Deferral is the correct default for an instrument: a missed harvest retries, a
corrupted acquisition does not.

**Ranking (§15): P#4 is P2/P3 — NOT P0/P1, therefore NOT to be implemented now.** §15 is explicit:
*"If an existing mechanism already solves a problem adequately: KEEP IT"* and *"Do not build a
heavyweight scheduler unless the existing architecture actually requires one."* It does not.

## 4 · What would change that verdict

Stated in advance so the answer is not retrofitted to whatever the box does next:
1. A measured case where two eligible acquisitions **both defer** and neither runs (mutual deference —
   the deadlock the broadcast design can produce and pairwise wiring cannot).
2. A case where deferral loses data that priority would have saved — i.e. the conservative default
   costing a night.
3. Device count rising past the point where a new actor must read every existing guard to be correct.

None is observed today. **(1) is the one to watch**, and it is cheap to detect: two actors reporting
`waiting` continuously across a whole window.

## Done when

- [x] Currency verified before measurement; the stale-root hazard recorded with its 16-vs-14 receipt.
- [x] P#1–P#5 classified against HEAD with per-item evidence.
- [x] P#4 answered with a measurement and a pre-stated falsification condition.
- [ ] P#6–P#8 measured (long-run health · self-healing bounds · acquisition/analysis boundary).
- [ ] §13's resource-budget measurements — **needs the box** (Thursday).
- [ ] §14's long-run behaviour tests — **needs the box** (Thursday).
- [ ] The consolidated P0–P4 ranking across all eight priorities, once P#6–P#8 are measured.
