<!--
  OPERATIONAL-MATURITY-ROADMAP-2026-08-27-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-27 · **Owner-issued directive** (verbatim charter, relayed via the coordinator session; received complete, no truncation) · **Children/interlocks:** `O2RING-AUTONOMOUS-HARVEST-2026-08-26-BRIEF.md` (§10 preserves it), `OXYII-DAT-AUTO-HARVEST-REFINEMENT-2026-08-24-BRIEF.md`, `CPAP-ACQUISITION-HARDENING-AUDIT-2026-08-23-BRIEF.md` (§11's ground), the AS11 session-detection line, `CAPTURE-HOST-UNWIRED-MACHINERY-FOLLOWUPS-2026-08-15-BRIEF.md` · **Distinct from:** `STRATEGIC-PRIORITIES-2026-08-26-BRIEF.md` (competitive agenda) and `MEASUREMENT-PROVENANCE-ROADMAP-2026-08-26-BRIEF.md` (measurement layer) — this one is the OPERATIONAL/RELIABILITY umbrella · **Affects:** `capture-host/` orchestration, resource ownership, recovery, health telemetry

# Operational maturity roadmap — an unattended, self-recovering, multi-device instrument

## Coordinator preamble (not part of the charter)

- Charter received COMPLETE 2026-08-27 ~00:30 EDT, verbatim below. Twin-check performed before
  filing (doc-search, the 08-24-brief lesson): no supersession — the named siblings answer
  different questions.
- **This is the umbrella; the audit (§1) is the first deliverable and much of it already EXISTS in
  the children** — the OXYII architecture map, the CPAP hardening audit, the delta map on the
  O2Ring charter, the unwired-machinery followups. §1's five-way classification is a CONSOLIDATION
  over those, not a fresh read.
- **Sequencing:** the O2Ring charter's overnight build completes first (in flight now). §13's
  measurements and §14's long-run physical tests need the box (returns ~2026-08-28). §15's ranking
  gate (P0–P4, implement P0/P1 only) is the anti-overbuild control and binds every implementer.
- Lane: Vigil box leads (capture-host); coordinator holds the §17 acceptance skeleton.

---

## THE CHARTER (owner's text, verbatim)

OBJECTIVE

Perform a focused architecture audit of current Tepna and implement the highest-value operational
improvements needed to make Tepna an unattended, self-recovering, multi-device acquisition system.
This is NOT a request to redesign Tepna or add features for the sake of feature count. The
objective is: REAL DEVICES → AUTONOMOUS ACQUISITION → RESOURCE-AWARE ORCHESTRATION → RECOVERY →
VERIFIED ARTIFACTS → ACQUISITION EVIDENCE → DEX / INTEGRATOR. The system should increasingly
behave like a reliable scientific instrument rather than a collection of scripts that happen to
work.

### 1. AUDIT CURRENT TEPNA BEFORE CODING

Read the current HEAD in detail. Map the existing implementations for: O2Ring · CPAP/AS11 · H10 ·
Verity · PPS/clock · BLE adapters · capture sessions · acquisition evidence · artifact storage ·
`.dat` harvesting · reconciliation · retry/recovery · lifecycle/provenance · configuration ·
execution-witness telemetry · resource ownership. For every proposed improvement determine:
ALREADY IMPLEMENTED · PARTIALLY IMPLEMENTED · IMPLEMENTED BUT NOT WIRED · MISSING · NOT NEEDED.
Do not duplicate existing functionality.

### 2. PRIORITY #1 — AUTONOMOUS RECOVERY

Make recovery a normal operating mode. Identify every important failure boundary: BLE disconnect ·
adapter failure · device disappearance · host reboot · process restart · partial transfer ·
corrupt artifact · stale temporary artifact · timeout · competing acquisition · device state
transition during an operation. For each one define: detection · safe state · retry policy ·
backoff · maximum attempts · recovery path · evidence. The system should converge toward the
correct state rather than require manual intervention. Do not create infinite retry loops.

### 3. PRIORITY #2 — ACQUISITION RESOURCE MANAGER

Audit all shared resources: BLE adapters · BLE connections · CPU · RAM · disk I/O · network ·
timing/PPS resources. Determine which operations can safely execute concurrently and which require
exclusive ownership. Implement the smallest useful resource-management layer. Examples: O2Ring
harvest must not disrupt CPAP capture · a BLE reconnect should not steal an adapter from another
active acquisition · a large artifact operation should not starve real-time acquisition · critical
timing acquisition must have priority over housekeeping. Use explicit ownership/priority rather
than accidental ordering. Do not build a heavyweight scheduler unless the existing architecture
actually requires one.

### 4. PRIORITY #3 — OPPORTUNISTIC ACQUISITION

Make expensive operations conditional. Before initiating a connection or harvest ask: Is the
device present? Is the operation actually needed? Is the device in the required state? Is the
artifact likely finalized? Is another acquisition currently critical? Is enough deadline budget
remaining? Has this recording already been harvested? If the answer is uncertain: defer rather
than blindly connect. Use existing device evidence rather than arbitrary timers whenever possible.

### 5. PRIORITY #4 — UNIFIED DEVICE ORCHESTRATION

Evaluate whether Tepna needs a lightweight acquisition orchestrator above individual device
drivers. The orchestrator should coordinate. It should NOT absorb device-specific protocol logic.
Each device driver remains responsible for its own protocol and device-state interpretation. The
orchestrator is responsible for: scheduling · resource ownership · lifecycle · recovery ·
prioritization · coordination.

```
             ACQUISITION ORCHESTRATOR
                /    /    \    \
             O2Ring CPAP  H10  Verity
                \    \    /    /
                 SHARED RESOURCES
                        │
                   CLOCK CONTRACT
                        │
               ACQUISITION EVIDENCE
```

### 6. PRIORITY #5 — DEVICE DISCOVERY AND STABLE IDENTITY

Audit whether device identity survives: reboot · BLE adapter renumbering · reconnect · temporary
disappearance · multiple similar devices. Never depend solely on dynamic identifiers such as
hci0/hci1 when a stable physical identity is available. The system should automatically rebind a
known device to its current transport representation. Unknown devices must not silently replace
known devices.

### 7. PRIORITY #6 — LONG-RUN HEALTH MONITORING

Add lightweight operational health telemetry. Track: acquisition uptime · last successful
capture · last successful harvest · BLE reconnect count · failed operations · deferred
operations · queue depth · stale sessions · artifact failures · clock health · resource
contention. The purpose is detecting silent degradation. A system that has technically been
running for 72 hours but has not actually acquired anything must be visibly unhealthy. Do not
create a generic monitoring platform. Keep this specific to Tepna acquisition.

### 8. PRIORITY #7 — SELF-HEALING WITH BOUNDS

Where safe, allow Tepna to recover automatically: reconnect BLE · restart a failed acquisition ·
retry a failed artifact · reconcile missed recordings · clean stale temporary state · rebind
adapters. But every recovery action must have: bounded retries · cooldown · observable reason ·
final failure state. Never let self-healing hide a persistent hardware failure.

### 9. PRIORITY #8 — ACQUISITION/ANALYSIS BOUNDARY

Audit every Dex input path. Ensure Dexes receive raw data + acquisition metadata + acquisition
evidence without having to reconstruct transport facts independently. Do not move scientific
algorithms into the orchestrator. Do not allow acquisition failures to silently become
physiological findings. Keep acquisition evidence separate from event evidence.

### 10. PRESERVE O2RING AUTONOMOUS HARVESTING

The O2Ring autonomous harvesting work should remain integrated with the roadmap. Ensure presence ·
connection · recording state · end detection · finalization · harvest · verification · commit ·
disconnect are separate observable stages. The periodic reconciliation poller remains the safety
net. Do not replace it with event-driven harvesting.

### 11. CPAP OPERATIONAL MATURITY

Audit CPAP acquisition for unattended operation. Verify: automatic startup · device discovery ·
adapter stability · therapy-state detection · stream ownership · disconnect recovery · session
termination · artifact persistence · restart recovery. Do not redesign CPAP scientific
interpretation. Focus on reliable acquisition.

### 12. EXECUTION-WITNESS REQUIREMENT

Every important autonomous path must distinguish: CODE EXISTS · CONFIGURATION ENABLED · SYSTEM
ARMED · EVENT OBSERVED · ACTION EXECUTED · SIDE EFFECT OCCURRED · ARTIFACT CREATED · ARTIFACT
VERIFIED · STATE COMMITTED. Tests must not be allowed to pass merely because a helper function
ran. Where possible, prove: trigger → production path → actual side effect.

### 13. RESOURCE-BUDGET AUDIT

Measure rather than guess. Determine actual: BLE connection count · connection duration · scan
duty cycle · CPU usage · RAM usage · disk throughput · network activity. Identify operations that
can interfere with real-time capture. Establish practical budgets only where measurements
demonstrate that budgets are necessary. Do not optimize hypothetical bottlenecks.

### 14. TEST LONG-RUN BEHAVIOR

Add tests for repeated operation, not only single success: 100 reconnects · repeated device
disappearance · repeated partial downloads · host restart during acquisition · poller/event
races · adapter renumbering · multiple simultaneous devices · long idle periods · repeated
recordings. Where feasible, perform long-running physical-box tests. The objective is to expose
failures that occur only after hours or days.

### 15. DO NOT OVERBUILD

Do NOT automatically implement all roadmap items. After the audit, rank each proposed improvement:
P0 — correctness/safety problem · P1 — major unattended-operation gap · P2 — meaningful
reliability improvement · P3 — convenience · P4 — unnecessary complexity. Implement P0/P1 first.
If an existing mechanism already solves a problem adequately: KEEP IT.

### 16. SYNTHETIC GOLDENS

Do not make Synthetic Goldens the center of this roadmap. Use them where they naturally provide
regression coverage for: recovery · state transitions · resource conflicts · malformed
acquisitions · duplicate events. Production architecture must remain independent of the golden
system.

### 17. ACCEPTANCE CRITERIA (verbatim checkbox skeleton)

- [ ] Current architecture is audited before modification.
- [ ] Existing functionality is reused rather than duplicated.
- [ ] Important failure modes have explicit recovery behavior.
- [ ] BLE/resource ownership is explicit where necessary.
- [ ] Critical acquisition has priority over housekeeping.
- [ ] Expensive operations are initiated opportunistically.
- [ ] Device identity survives adapter renumbering/reboots.
- [ ] Autonomous O2Ring harvesting integrates with the resource model.
- [ ] CPAP acquisition can recover without manual intervention where safe.
- [ ] Event-driven and reconciliation mechanisms converge safely.
- [ ] Acquisition evidence remains authoritative.
- [ ] Dex scientific logic remains unchanged.
- [ ] Operational health is observable.
- [ ] ENABLED / ARMED / EXECUTED / COMMITTED remain distinguishable.
- [ ] Recovery is bounded and cannot loop forever.
- [ ] Long-run/restart/race behavior is tested.
- [ ] Physical hardware validates the most important autonomous paths.
- [ ] No unnecessary framework or abstraction is introduced.

### FINAL DESIGN PRINCIPLE

Do not make Tepna "bigger." Make it harder to break. The ideal result is a capture box that can be
left running unattended and will: discover devices → acquire simultaneously → coordinate shared
resources → recognize state changes → harvest when appropriate → recover from transient failures →
verify artifacts → preserve provenance → reconcile anything missed → report when something
genuinely requires attention. The system should fail SAFE, recover AUTOMATICALLY when safe, and
make every important autonomous action auditable. Implement only the smallest changes necessary to
move current Tepna toward that behavior.

**CHARTER COMPLETE — received in one delivery 2026-08-27; nothing invented, nothing omitted.**
