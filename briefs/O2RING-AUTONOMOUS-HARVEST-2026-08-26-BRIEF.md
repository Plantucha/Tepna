<!--
  O2RING-AUTONOMOUS-HARVEST-2026-08-26-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-26 · **Owner-issued directive** (verbatim charter, relayed via the coordinator session) · **Interlocks:** `O2RING-WAVEFORM-SPO2-SHIP-2026-08-20-BRIEF.md`, `O2RING-TIME-CAPABILITY-WIRING-2026-08-19-BRIEF.md`, `CAPTURE-FILESET-RESUME-2026-08-19-BRIEF.md` (DONE), the AS11 session-detection line (shared BLE budget) · **Affects:** `capture-host/` O2Ring path, BLE adapter policy, acquisition evidence

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
- The charter's §0 clean-room rule is absolute and matches house policy (§📚 no fabricated
  authority, no external code imports into capture paths).

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

Preserve the current safe default: automatic close-tr

**⚠️ CHARTER TRUNCATED HERE (second delivery) — §21 ends mid-word at "automatic close-tr". The
owner owes §21's remainder and any sections beyond it. Do not invent them.**
