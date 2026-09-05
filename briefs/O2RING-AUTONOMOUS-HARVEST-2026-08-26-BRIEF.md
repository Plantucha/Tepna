<!--
  O2RING-AUTONOMOUS-HARVEST-2026-08-26-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED (parked 2026-09-02 — an owner-issued CHARTER whose executable arm is O2RING-PRESENCE-TRIGGER-IMPL-2026-08-26; not superseded by it, any more than the CPAP audit is by its phases. Most of §34's 32 acceptance items are already code-backed and cited in the impl brief — presence observability, presence≠connection, connection≠recording, the transactional downloader and `.part`→verify→commit, hash/provenance, idempotent duplicates, restart recovery, the hard abort deadline, adapter identity across renumbering, and the §19 execution witness (90fea439). NOT closable from the repo: **the coexistence matrix** proving CPAP/H10/Verity/PPS are undisturbed, **§25's A–O physical harvest demonstration**, and **§26's negative hardware cases** — all three need the box and a real ring, and all three are one session. **Owner:** owner (box session) · **Next step:** the coexistence matrix) · **Created:** 2026-08-26

# O2Ring autonomous harvesting — match and exceed the best possible operational behavior

## Coordinator preamble (not part of the charter)

- The charter below is the owner's text, VERBATIM, received 2026-08-26 ~23:30 EDT. It arrived
  truncated mid-§13; the last received line is *"A missed automatic harvest is preferable to"* —
  the owner owes the remainder of §13 and any sections beyond it. Do not invent the missing text;
  the truncation point is marked below.
- **Phasing forced by reality:** the capture box is OFFLINE (traveling, recording locally, no
  connectivity) until ~2026-08-28. §1 (code inventory) and all design/deviceless implementation can
  start immediately; §2 (hardware scan-coexistence testing) and every physical-hardware evidence
  item WAIT for the box's return. Nothing in §2 may be assumed — it is measured on the box or it is
  not claimed.
- **Lane:** Vigil box session (primary — O2Ring BLE + capture-host is their lane), sequenced AFTER
  their in-flight spool-caller PR and the SCAN-5 follow-up. The coordinator holds the charter's
  §-numbering as the acceptance skeleton.
- **RELATIONSHIP TO THE 2026-08-24 TWIN (deputy ruling, 2026-08-27, reversible):** doc-search
  surfaced `OXYII-DAT-AUTO-HARVEST-REFINEMENT-2026-08-24-BRIEF.md` — a 1437-line owner-issued spec
  on this same subject, IN-PROGRESS, carrying its own architecture map and RULINGS (§14a: end
  detection WAITS for the `3 → 1` transition; §14b: the close-triggered pull is `which=latest`).
  This charter is read as EXTENDING that brief, not superseding it, because the charter's own text
  says so: §8/§10 defer to "the existing Tepna mechanism where it is already correct", §36 demands
  the smallest change set, and §1 lists the existing machinery as material to understand. Standing
  consequences until the owner says otherwise: (a) the 08-24 brief's rulings STAND; (b) §36's
  implementation map is built as a DELTA against that brief's §1 architecture map, not a fresh
  re-derivation; (c) if the owner intended supersession, flipping this header line and the map's
  baseline is the entire cost of having guessed wrong. Owner: one line settles it —
  "extends" (default, in force) or "supersedes".
- The charter's §0 clean-room rule is absolute and matches house policy (§📚 no fabricated
  authority, no external code imports into capture paths).
- **THE ADVERTISEMENT MEASUREMENT — tool built 2026-09-05 (Kestrel), run owed to the box.** The
  2026-09-05 automatic-harvest gap analysis found that **no advertisement byte from the ring has ever
  been captured**: every worn/recording fact comes from a connected 0x04 reply, `AdvertisementData` /
  `detection_callback` appear nowhere in capture-host, and `O2RING-PROTOCOL` §6's two advertising
  modes (`0x036F` recording / `0xF34E` sync-after-button) are quoted from a public reference and marked
  untested there. A state machine that decides WHEN to connect from advertisements (§4–§6 of this
  charter) cannot be built on that, and a bit mask must not be invented to fill it. So the first
  small task is a measurement, and the instrument is **`capture-host/probe_ring_adv.py`** (gate-backed,
  `tests/test_probe_ring_adv.py`): one JSONL row per sighting — host stamps, mode actually used,
  address, name (display only), RSSI, manufacturer/service data hex, whatever raw BlueZ exposes, the
  operator's LABEL of the ring's physical state, and a `hypothesis` tag when a payload carries one of
  the two brief-quoted ids (a tag for the analyst, never a decision). Only the configured address and
  hypothesis-tagged rows are written; other addresses are counted, never stored. `--summarize` prints
  the per-address × label table (n, span, advert interval median/p90/max — a LOWER bound on the ring's
  rate, scanner drops included — RSSI range, distinct payloads, names).
  **Runbook (box, daemon's O2Ring runner off the link — `link_guard`; one label per phase, or one run
  with `--label-file` flipped from a second shell at each transition):**
  1. `worn-recording` ≥ 10 min · 2. `removed-idle` from the moment the finger leaves, ≥ 10 min
  (does it advertise at all? for how long? — the 49/53 "not advertising within 6 min of drop" result
  of `OXYII-DAT-AUTO-HARVEST-REFINEMENT` is the number to confirm or refute) · 3. `button-pressed`
  with `--label-file` flipped at the press (the `0xF34E` test named in `O2RING-PROTOCOL` §6, never run)
  · 4. `post-harvest` right after a pull disconnects · 5. `charger` · 6. `auto-power-off-wait` until
  the ring goes silent · 7. `connecting-while-worn` and `after-failed-connect-N` alongside a
  deliberate connect attempt. `--mode passive` is a declared second run, not the default: BlueZ passive
  needs `or_patterns`, and a pattern can only see what its hypothesis predicts. Results land here as a
  §-note citing the summary table; until then every "sync-ready window" claim in the harvest work is
  marked UNMEASURED and the state machine consumes only the connected-link axes.

---

## THE CHARTER (owner's text, verbatim)

MISSION

Upgrade Tepna's O2Ring automatic `.dat` harvesting so that it provides the same class of
autonomous behavior as a mature unattended recorder, while preserving Tepna's existing
acquisition, transaction, provenance, clock, evidence, and safety architecture.

The goal is NOT to copy another implementation.

The goal is to independently implement the following capabilities:

1. Detect O2Ring presence without requiring a permanently held GATT connection, IF the existing
   Tepna hardware/BLE architecture can safely support this.
2. Determine whether the ring is actually recording before attempting a harvest.
3. Automatically recognize the end of a recording.
4. Wait for the device's internal recording/file finalization before downloading.
5. Harvest the correct recording automatically.
6. Avoid unnecessary BLE connections.
7. Never keep the ring awake unnecessarily.
8. Never interfere with simultaneous CPAP/H10/Verity acquisition.
9. Preserve Tepna's transactional `.dat` acquisition and verification.
10. Recover cleanly from BLE failures, host restarts, partial files, duplicate observations, and
    interrupted downloads.
11. Produce execution evidence proving that the automatic path really executed on physical hardware.
12. Remain completely safe when automatic harvesting is disabled.

The resulting system should be BETTER than a simple automatic downloader. It should be an
autonomous, evidence-producing acquisition subsystem.

### 0. CRITICAL CLEAN-ROOM / IMPLEMENTATION RULE

Do NOT copy implementation, source code, structure, names, constants, or proprietary details from
any external project. Do not import external code. Do not make the implementation dependent on
another project's source. Implement the behavior independently from Tepna's existing architecture,
existing device knowledge, and independently established measurements. The requirements below
describe DESIRED BEHAVIOR and engineering properties, not an implementation to copy.

### 1. READ CURRENT TEPNA CODE BEFORE CHANGING ANYTHING

Inspect the current HEAD in detail. Specifically understand: O2Ring BLE implementation · GATT
discovery · OXYFRAME reception · current connection lifecycle · current O2Ring state machine ·
duration_s · run_status · worn/contact state · END_CANDIDATE · END_CONFIRMED · current `.dat`
discovery · `.dat` selection · `.dat` transfer · `.dat` verification · `.dat` commit · `.part`
files · retry/restart policy · hourly reconciliation poller · close-triggered harvest ·
`which=latest` · flush gate · abort deadline · lifecycle journal · acquisition evidence ·
configuration/arming · existing execution-witness telemetry · tests and physical-box evidence.

Do not rewrite working machinery merely to make it look cleaner. First identify what already
exists and what is actually missing.

### 2. START WITH THE REAL HARDWARE CONSTRAINT

Determine whether the existing Tepna capture host can perform BLE advertisement scanning for the
O2Ring WITHOUT disrupting existing connections. The system may simultaneously be acquiring:
O2Ring, CPAP, H10, Verity, PPS/host timing, depending on the deployed configuration.

Do NOT assume that a second BLE operation is harmless. Explicitly test: passive scan + active CPAP
connection · passive scan + O2Ring connection · passive scan + H10/Verity operation · connection
establishment while scan is active · scan termination/restart · adapter reset/recovery.

If passive scanning is safe: use it as an inexpensive O2Ring PRESENCE signal. If passive scanning
is NOT safe: retain the current connected-state observation mechanism. Do not sacrifice an
existing acquisition channel merely to make O2Ring harvesting more elegant.

### 3. SEPARATE THREE CONCEPTS

The implementation MUST distinguish: PRESENCE · CONNECTION · RECORDING STATE. They are not
equivalent. BLE advertisement observed ≠ GATT connection established. GATT connection established
≠ ring is recording. A ring can be present but not recording. A ring can be connected but not
recording. A ring can disappear while recording. Represent these independently.

### 4. DESIRED AUTONOMOUS STATE MACHINE

Implement a clear state machine conceptually equivalent to:

IDLE → PRESENCE_DETECTED → PROBE → RECORDING → (DISCONNECT / WAIT) → END_ELIGIBLE →
FINALIZATION_WAIT → HARVEST → VERIFY → COMMIT → DISCONNECT → RECONCILE / IDLE

The exact existing Tepna state names MUST be reused where appropriate. Do not introduce redundant
parallel state machines. Every state transition must have a reason.

### 5. PRESENCE DETECTION

If hardware testing proves passive advertisement observation is safe, implement low-cost presence
detection. The passive observer should: identify the configured/paired O2Ring · avoid unnecessary
GATT connections · avoid treating arbitrary BLE devices as the ring · debounce repeated
advertisements · tolerate advertisement loss · tolerate RF gaps · avoid creating a harvest every
time one advertisement is received. Presence should be an OBSERVATION. It is not proof that a
recording exists.

### 6. SHORT PROBE

When a presence event justifies inspection, establish a short GATT connection. The probe should
answer only the questions needed to decide whether further work is justified: Is this the expected
ring? Is it recording? Has a recording ended? Is a file available/finalized? Is harvesting
appropriate now? Do not keep the connection open merely because it is convenient. If the ring is
still recording: disconnect. Then return to observation. Do NOT repeatedly download while
recording.

### 7. RECORDING STATE MUST BE AUTHORITATIVE

Use the strongest O2Ring state evidence already established by Tepna. Prefer actual device state
over inference from elapsed time. Do not infer "not recording" merely because "no packets
arrived." Do not infer "recording ended" merely because "duration stopped increasing." Use
existing `run_status`, duration, contact/worn state, and other validated observations according to
current Tepna rules. If the device cannot establish state: UNKNOWN, not FALSE.

### 8. END-OF-RECORDING DETECTION

The automatic harvest must be triggered by a genuine recording-end condition. Use the existing
Tepna end-detection mechanism where it is already correct. The trigger: recording was active → end
condition observed → END_CANDIDATE → confirmation → harvest eligible. Do not trigger harvesting
merely because the ring is present. Do not trigger harvesting repeatedly for the same session.

### 9. FINALIZATION / FLUSH GATE

Critical requirement. The recording ending does NOT necessarily mean the `.dat` file is ready. The
device may continue writing/finalizing after the recording state changes. Therefore: END →
FINALIZATION WAIT → FILE READY → HARVEST. Use the existing `run_status`/flush machinery and
measured behavior already established by Tepna. Do not replace this with an arbitrary sleep. A
fixed sleep may be a fallback, but it must NOT be the primary correctness mechanism when the
device exposes a stronger state signal.

### 10. DO NOT HARVEST THE WRONG SESSION

The dangerous race: recording A ends → waiting for finalization → user starts recording B →
harvest asks for "latest" → recording B is returned. Prevent this. The automatic harvest must
verify that the recording being harvested is the recording associated with the close event. If the
device cannot uniquely identify the historical recording: abort/defer rather than silently
harvesting the wrong one. `which=latest` may remain the close-triggered scope only if existing
Tepna evidence proves it safe under the current state machine. Preserve the rule that broad
`which=all` is a reconciliation operation, not the close-triggered operation.

### 11. CONNECTION BUDGET

Connection acquisition is expensive. Optimize NUMBER OF BLE CONNECTIONS rather than NUMBER OF
BYTES. Do not reconnect unnecessarily. If a short probe determines STILL RECORDING: disconnect. If
the ring is not ready: disconnect and wait. If the file is ready: perform the harvest during the
same justified connection when possible. Do not connect → disconnect → reconnect → immediately
perform the same operation. The connection lifecycle should be deliberate and observable.

### 12. POWER-OFF SAFETY

The implementation must never accidentally keep the O2Ring awake. Treat connection lifetime as a
resource with a deadline. Preserve Tepna's existing GUARD_BAND_S, pull_deadline(), abort behavior.
The invariant: automatic harvesting MUST release the link before the ring's not-worn power-drop
window is endangered. Do not rely solely on historical timing distributions. Measured timing tells
us how often the operation succeeds. The deadline is what makes it safe by construction.

### 13. ABORT MUST BE SAFE

If the deadline is reached: STOP HARVESTING. Do not continue because the download is "almost
finished." Do not block shutdown. Do not wait indefinitely for GATT. Do not leave a dangling BLE
connection. The reconciliation poller must be able to retry later. A missed automatic harvest is
preferable to preventing the device from powering down or damaging acquisition of another device.

### 14. REUSE TEPNA'S TRANSACTIONAL `.DAT` HARVEST

Do NOT create a second `.dat` downloader. The autonomous trigger should feed the existing
transaction: DISCOVER → SELECT → DOWNLOAD → VERIFY → COMMIT. Preserve: `.part` handling ·
expected-size verification · finalization/trailer validation · semantic validation where
available · hash · atomic commit · retry bounds · restart/resume policy · acquisition evidence ·
lifecycle journal. Automatic harvesting is a NEW TRIGGER. It is not a new transfer implementation.

### 15. VERIFY BEFORE COMMIT

Never treat "bytes downloaded" as equivalent to "recording successfully harvested." Preserve
existing validation depth. At minimum distinguish: transfer completed · size valid · recording
finalized · artifact valid · artifact committed. Do not widen `VERIFIED` semantics without
changing the actual validator.

### 16. DUPLICATE PROTECTION

Automatic observation will naturally generate duplicate signals: many advertisements · repeated
probes · repeated END observations · reconnects · hourly poller · restart recovery. The system
must therefore be idempotent. The same recording must not produce multiple committed copies,
duplicate session records, or duplicate analysis jobs. Use the existing Tepna identity/ledger
mechanisms. Do not create another duplicate-detection system.

### 17. AUTOMATIC + HOURLY POLLER

Do NOT remove the reconciliation poller. The architecture: EVENT-DRIVEN HARVEST + PERIODIC
RECONCILIATION. The event-driven path gives fast harvesting; the periodic poller provides recovery
if the event-driven path missed something. These are complementary. The system should converge on
the same final state regardless of which path discovers the recording first.

### 18. FAILURE RECOVERY

Explicitly handle: BLE connection failure · BLE disconnect during probe · BLE disconnect during
transfer · advertisement disappears · device disappears after end · run_status becomes
unavailable · new recording starts during flush · deadline expires · partial `.dat` · corrupt
`.dat` · wrong-size `.dat` · hash mismatch · host restart · process restart · duplicate
discovery · stale `.part` · automatic harvest disabled. Every failure must leave the system in a
recoverable state.

### 19. EXECUTION WITNESS

This is mandatory. Do not claim that automatic harvesting works because code exists, tests pass,
or configuration says enabled. Record enough operational telemetry to prove: automatic mode
enabled → observer armed → presence detected → probe attempted → recording state observed → end
detected → flush gate entered → flush completed → pull started → artifact committed. The existing
Tepna investigation already demonstrated why this matters: a code path can exist while its arming
condition prevents it from ever executing. The implementation MUST make that impossible to miss.

### 20. CONFIGURATION MUST BE OBSERVABLE

When automatic harvesting is enabled, expose: enabled · armed · current state · last presence ·
last probe · last recording-state observation · last end candidate · last confirmed end · last
harvest · last failure · reason for waiting · reason for abandoning. Do not expose only
"enabled = true". "Enabled" and "actually armed" are different facts.

### 21. SAFE DEFAULT

Preserve the current safe default: automatic close-triggered harvesting remains OFF unless
existing project configuration explicitly enables it. Do not silently change deployed behavior.
If enabled, log/record exactly why the system believes it is armed.

### 22. MULTI-DEVICE SAFETY

Automatic O2Ring harvesting must not interfere with: CPAP acquisition · H10 acquisition · Verity
acquisition · PPS timing · other BLE devices. Test adapter selection explicitly. Never assume
`hci1` means the same physical adapter after reboot. Use the existing robust adapter identity
mechanism. Do not silently steal an adapter from another acquisition.

### 23. DO NOT USE WALL CLOCK FOR DEADLINES

Harvest deadlines are durations. Use monotonic time for: connection deadlines · flush waiting ·
abort deadlines · retry timing. Use the existing Clock Contract for: physiological/sample
timestamps · synchronization · recording time. Do not mix those concepts.

### 24. TESTING STRATEGY

Add deterministic unit tests for the pure decision functions. At minimum test: not armed · no
close · close but deadline expired · flush active · flush complete · run_status unknown · new
recording begins during flush · explicit not-worn · worn state · ambiguous contact state · correct
scope · duplicate close · retry. Then add integration tests proving trigger → transaction, rather
than testing only the trigger helper. Then add hardware execution-witness testing.

### 25. PHYSICAL-BOX ACCEPTANCE TEST

A successful implementation MUST eventually be demonstrated on real hardware. Perform at least:
A. Start O2Ring recording. B. Confirm automatic system is actually ARMED. C. Confirm
recording-state observations occur. D. End/remove ring. E. Confirm END_CANDIDATE. F. Confirm end
condition. G. Confirm flush/finalization wait. H. Confirm automatic `.dat` pull starts. I. Confirm
correct recording selected. J. Confirm verification. K. Confirm atomic commit. L. Confirm
Acquisition Evidence. M. Confirm BLE disconnect. N. Confirm ring is allowed to power down.
O. Confirm hourly reconciliation does not duplicate the result. The test report must contain
observed timestamps/state transitions, not just "PASS."

### 26. IMPORTANT NEGATIVE TESTS

Test cases where automatic harvesting MUST NOT occur: ring merely advertises · ring is present but
recording · unknown recording state · no confirmed end · flush still active · new recording
opened · deadline expired · wrong device · artifact not finalized · transfer incomplete ·
validation failed. These are as important as successful harvests.

### 27. AUTOMATIC HARVEST MUST BE IDEMPOTENT

These sequences must converge to the same final state: event → harvest · poller → harvest ·
event → partial transfer → retry · event → host restart → recovery · event → poller races event ·
repeated event → same recording. There must be one committed recording, not multiple copies.

### 28. PERFORMANCE OBJECTIVE

Optimize for: minimum connection count · minimum connection duration · minimum interference with
other acquisition · maximum probability of complete `.dat` acquisition · safe power-down. Do NOT
optimize prematurely for raw transfer throughput. The file is small compared with the cost of
establishing and maintaining the BLE connection.

### 29. DO NOT REPLACE STRONG DEVICE EVIDENCE WITH TIMERS

If the O2Ring exposes a reliable state transition: use it. If it exposes a reliable finalization
indication: use it. If only timing is available: use a bounded timing fallback and label the
evidence appropriately. Never turn a heuristic timeout into an "established" fact.

### 30. ACQUISITION EVIDENCE

Every automatic harvest must produce the same Acquisition Evidence as a manual/reconciliation
harvest. At minimum preserve: session identity · device identity · acquisition source · recording
start/end evidence · clock status · sample counts · gap information · artifact identity · artifact
hash · validation status · completeness · provenance · trigger source. The trigger source should
distinguish, where useful: MANUAL · POLLER · AUTO_CLOSE · RECOVERY — without creating a separate
provenance system.

### 31. SYNTHETIC GOLDENS

Do NOT redesign or center the architecture around Synthetic Goldens. After the production
implementation is complete, determine whether the existing golden infrastructure can test
important decision logic. Useful future golden cases may include: recording ends · flush delayed ·
transport gap · interrupted transfer · duplicate trigger · restart. But production behavior must
NOT depend on what the golden system can represent. Goldens are a validation tool.

### 32. DOCUMENTATION

Update the relevant Tepna brief/documentation to explain: presence detection · connection
lifecycle · recording-state detection · end detection · finalization/flush · harvest ·
verification · commit · power-off safety · reconciliation · recovery. Document which facts are:
measured · established · heuristic · unknown — using the EXISTING Tepna evidence rules. Do not
invent new scientific classifications.

### 33. NO SCIENTIFIC CHANGES

This task must NOT change: PPG algorithms · SpO2 algorithms · ODI definitions · event thresholds ·
HR calculations · HRV calculations · CPAP event definitions · Integrator scientific rules ·
existing evidence semantics. This is an acquisition/automation improvement.

### 34. ACCEPTANCE CRITERIA (verbatim checkbox skeleton)

The implementation is complete only when:

- [ ] O2Ring presence can be observed cheaply if hardware permits.
- [ ] Presence is distinct from connection.
- [ ] Connection is distinct from recording state.
- [ ] Recording state is based on authoritative/validated device evidence.
- [ ] End-of-recording detection is automatic.
- [ ] `.dat` finalization is explicitly awaited.
- [ ] Arbitrary sleeps are not the primary correctness mechanism.
- [ ] The correct recording cannot silently be replaced by a newer one.
- [ ] Automatic harvesting reuses the existing transactional downloader.
- [ ] Existing `.part`/verify/commit machinery remains authoritative.
- [ ] Hash/provenance remains authoritative.
- [ ] Validation remains separate from completeness.
- [ ] UNKNOWN remains UNKNOWN.
- [ ] Automatic harvesting has a hard abort deadline.
- [ ] The ring cannot be kept awake indefinitely by a stuck pull.
- [ ] BLE connections are minimized.
- [ ] CPAP/H10/Verity/PPS acquisition is not disrupted.
- [ ] Adapter identity survives reboot/renumbering.
- [ ] Event-driven harvesting and periodic reconciliation coexist.
- [ ] Duplicate harvests are idempotent.
- [ ] Host/process restart is recoverable.
- [ ] Automatic harvesting can be disabled safely.
- [ ] "enabled" and "armed" are separately observable.
- [ ] Execution-witness telemetry proves the automatic path actually ran.
- [ ] Physical hardware demonstrates at least one complete autonomous harvest.
- [ ] Negative hardware cases demonstrate that false harvests do not occur.
- [ ] Existing tests remain green.
- [ ] Existing scientific algorithms remain unchanged.

### 35. TARGET ARCHITECTURE

```
                     O2RING
                       │
              ┌────────┴────────┐
              │                 │
         ADVERTISEMENT       GATT
              │                 │
              ▼                 ▼
           PRESENCE          PROBE
              │                 │
              └────────┬────────┘
                       ▼
                RECORDING STATE
                       │
            ┌──────────┴──────────┐
            │                     │
         RECORDING              END
            │                     │
         disconnect          FINALIZATION
            │                     │
         observe                  ▼
                              HARVEST → VERIFY → COMMIT → EVIDENCE → DEX

And independently:   PERIODIC RECONCILIATION ──► same transaction
```

The key architectural principle: EVENT DETECTION IS NOT FILE TRANSFER. FILE TRANSFER IS NOT FILE
VALIDATION. FILE VALIDATION IS NOT SCIENTIFIC INTERPRETATION. Keep those boundaries explicit.

### 36. FINAL ENGINEERING REQUIREMENT

Before coding, produce a short implementation map showing: EXISTING TEPNA COMPONENT → reused
unchanged · EXISTING COMPONENT → adapted · NEW COMPONENT → why it is necessary · EXISTING TEST →
reused · NEW TEST → what failure it catches. Then implement the smallest change set capable of
satisfying the requirements. Do NOT rewrite working Tepna code for stylistic reasons.

The final result should make O2Ring acquisition feel autonomous: put ring on → record → remove
ring → Tepna notices → Tepna waits until the recording is actually finalized → Tepna retrieves the
correct `.dat` → Tepna verifies it → Tepna commits it → Tepna records exactly what happened → ring
is allowed to sleep — with no manual switch and no permanent BLE connection required unless the
physical hardware proves that such a connection is necessary.

The standard for success is NOT "the code path exists." The standard is: "a real recording
completed, the autonomous path actually armed, detected the end, harvested the correct finalized
artifact, verified and committed it, released the device, and left an auditable execution trail."

**CHARTER COMPLETE — received in three deliveries 2026-08-26/27; nothing invented, nothing
omitted.**
