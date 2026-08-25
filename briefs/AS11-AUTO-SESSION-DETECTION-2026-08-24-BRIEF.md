<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS — 2026-08-24 · **Created:** 2026-08-24 · **Follows:** `RESMED-AS11-PROTOCOL-REFERENCE-2026-08-21-BRIEF.md`, `CPAP-BLE-CAPTURE-2026-08-21-BRIEF.md`

# AS11 automatic therapy-session detection — research program + §23 hardware-matrix findings

**Objective (owner spec §16, priority clause quoted verbatim):** *"Do not settle for 'flow and pressure
can probably tell us.' First determine whether the AirSense 11 itself exposes a reliable, low-bandwidth
therapy-state signal through its BLE protocol."* The goal is to remove the manual start/stop switch from
the live BLE recording with **the most reliable, lowest-overhead, defensible detector the hardware
supports** — not to automate the button. Read-only observation only; a supervisor ABOVE
`LiveStreamController` (never a second controller); every signal classified under the evidence system;
**this research report precedes any implementation** (spec §24/§25 gate).

The owner's full 27-section program spec is preserved verbatim in the appendix below.

---

## §23 HARDWARE MATRIX — RESULTS (attended, 2026-08-24, box-host-stamped, read-only, hci1)

Attended session with the owner operating the AirSense 11 through its states while the box captured
passively (advertisements) and via short read-only connections (status Gets). Captures on the box in
`/srv/tepna/probe/as11_matrix/` (idle baseline, continuous adv scan, treating + idle status reads).
Device MAC `04:CD:15:3A:0B:BD`, name "ResMed 590541". Daemon owns hci0; capture used the free hci1.

### §3 Advertisements — NO therapy-state signal · **architecture A (advertisement-only, §13) RULED OUT**
The beacon is **state-invariant**. Across idle AND blower-running, 275+ adverts carried an **identical**
payload: `manufacturer_data {909: 0x00}` (a single byte), service-uuid `fd56`, `tx_power 3`, no
service-data — **zero content changes** the whole session. The only advertisement signal is *presence*:
the device stops advertising while it holds a BLE connection (our own stream), which is a **connection
artifact, not therapy state**. → *No-connection detection is impossible on this firmware.* **MEASURED.**

### §4 Short-connection status Get — WORKS · **architecture B is the recommendation**
On a ~1 s read-only connect (`establish` → `Get`, cmd 0x43), the AS11 answers instantaneous values:

| Object | Treating (17:22) | Idle/stopped (17:30) | Tier |
|---|---|---|---|
| `MaskPressure` | **7.4** | **0.6** | MEASURED |
| `PatientFlow` | live (0.41 / −0.49) | ~0 (−0.02) | MEASURED |
| `Leak` | readable (0.0) | **`InvalidObject` (-11201)** | MEASURED |
| `GetVersion` | full FlowGenerator SW/config/datamodel IDs (provenance) | same | MEASURED |
| `TherapyOn`/`Ventilation`/`SessionState`/`Mode` | `InvalidObject` | `InvalidObject` | ⚠️ **FALSIFIED 2026-08-24** — these were GUESSED names; the real explicit-state object is **`FGState`** (`Standby` idle / expect `Therapy` active, confirmed live). See `AS11-SESSION-DETECTION-PROTOCOL-INVESTIGATION-2026-08-24-BRIEF.md`. |

**There is NO explicit "therapy on" boolean** — every guessed state name is rejected. `MaskPressure` is
the primary proxy (huge clean margin, 7.4 vs 0.6); `Leak` **object-validity** is a candidate discrete
second signal (present treating, invalid idle) — see the caveat in §Design-notes before trusting it.

### §7/§10 Mask-off vs stop — DURATION, not level · **the load-bearing measurement**
From the recorded live-stream `BRP.edf` (Flow.40ms + Press.40ms, 25 Hz): **a mask-off is instantaneously
indistinguishable from a stop.** The machine **ramps ITSELF down** on a mask-off — pressure 7 → ~1 and
flow → ~0 for the ~40 s the mask was off (owner mask-off 17:26:27 → mask-on 17:27:04), then recovers to
7. A **real stop** (blower off, 17:27:59) drops and **STAYS at 0**. So the discriminator is **duration,
not level**: the **debounce floor = the measured ~40 s mask-off self-ramp**; a stop requires sustained-low
BEYOND that (recommend 60–90 s). This evidences — not assumes — the owner's "mask-off ≠ session-end" and
"stop needs stronger sustained evidence" rules. **MEASURED (n=1; refine tonight over several natural
mask-offs).**

### §11 Disconnection semantics — connection outlives therapy
Turning the blower OFF did **not** end the stream/connection — it persisted (beacon stayed absent) until
the monitor stream was explicitly stopped. **A dropped/held connection ≠ therapy state.** **MEASURED.**

---

## RECOMMENDED ARCHITECTURE (evidence-backed; owner spec §16 tier-2 "low-bandwidth status query")

A supervisor ABOVE `LiveStreamController` (spec §18 — never a second controller), state machine:

```
WAITING ──(poll: short-connect Get(MaskPressure) on a cadence; pressure ↑ = positive start evidence)──▶ ACTIVE
ACTIVE  ──(engage the live stream; stop-detection from the STREAM'S OWN flow/pressure, sustained-low
           beyond the mask-off window)──▶ STOPPING ──(disengage stream)──▶ WAITING
```

- **Start:** positive evidence — `MaskPressure` risen from ~0 to therapy level on the idle poll.
- **Stop:** sustained-low in-stream pressure/flow for > the ~40 s mask-off debounce (mask-off-safe).
- **No permanent high-bandwidth stream while inactive; no EZShare for state; auto-stop; deterministic
  recovery after BLE/process restart** (spec §26 success criteria).

### Design notes (Mutator review, 2026-08-24 — into implementation)
1. **POLL ONLY WHILE INACTIVE.** The status poll competes for the single AS11 link, so the cadence
   applies to the **WAITING** state ONLY; once the stream is engaged, stop-detection MUST come from the
   stream's own flow/pressure — **never a parallel status connection.** Poll cadence: **60 s idle**
   proposed — connect cost ~1 s (measured), start-latency requirement "before meaningful data is lost",
   and a therapy start is preceded by the owner being in the room; 60 s bounds worst-case lost data to
   ≤1 min against a manual start that has no tighter requirement. **HEURISTIC — state + refine.**
2. **`Leak`-validity is CORROBORATOR, not primary — until proven.** Discrete `InvalidObject` is
   attractive, but tonight must show `Leak` does NOT also invalidate in benign in-therapy states (ramp,
   warmup, the 40 s mask-off self-ramp). If it invalidates during the ramp-down, it is a *mask-off*
   detector, not a *therapy* detector. Until measured: **`MaskPressure` primary, `Leak` corroborator.**
3. **CLOCK — its own INVESTIGATION, not a rushed fix (UNKNOWN-tier, do not touch the sink yet).** Two
   facts conflict: Friday's night pull-EDF stamp matched the owner's box-time button-push (23:52), but
   **today's live-stream EDF stamped DEVICE time `17:45:42` — ~21 min fast** vs the box stream-start at
   17:24:25; and fleet memory records this device's clock wandering **42 min** historically. Before
   editing any sink: (a) determine which clock EACH path stamps (`#1696` pull vs the live-stream
   `EdfSink`); (b) whether the device clock JUMPED Fri→today (compare `GetDateTime` readings); (c) note
   the **live-vs-SD comparator (`#1735`) aligns on the DEVICE clock** — a stamp-source change would break
   the interpretation of its 158.7 s offset finding. **Honest end-state:** every file carries a
   **declared** stamp source + the device-vs-box offset recorded alongside (`GetDateTime` at stream start
   is nearly free), so any file is recoverable to either clock. **Fix follows understanding.**

## Open items — tonight's natural sleep run refines
- Debounce **n**: confirm the ~40 s mask-off self-ramp over several natural mask-offs.
- `Leak`-validity timing: does it flip fast/clean enough to promote from corroborator to primary?
- The `SubscribeEvent` (0x3a) rider (`CPAP-BLE-CAPTURE` follow-up) still rides for §5 completeness — its
  measured yes/no is owed even though §4 already answers the state question.
- The clock investigation above.

## Evidence classification (spec §20)
MEASURED: adv invariance (275), `MaskPressure`/`PatientFlow`/`Leak` treating-vs-idle, the mask-off
self-ramp + stop trajectory, connection-outlives-therapy. ~~ESTABLISHED: no explicit therapy-state
object (`InvalidObject` on all guesses).~~ ⚠️ **FALSIFIED 2026-08-24** — an explicit `FGState` enum
(`Standby`/`Therapy`) DOES exist and is read confirmed; this "ESTABLISHED" was a FALSE NEGATIVE from
guessing object names. **METHOD LESSON (empty-result-is-not-a-negative, at the protocol layer):** the
four guessed names returned `InvalidObject`, which is "these names don't exist", NOT "no such object
exists" — reading the device's own advertised RPC/DataItem map (`GetVersion` + enumerating `FGState`)
corrected it. **The next probe ENUMERATES what the device exposes before it guesses names.** So
`FGState` polling ± `SubscribeEvent(TherapyStatusEvents)` is now the PRIMARY candidate, with MaskPressure
kept as the independent physical corroborator (device state-word = verdict, pressure = physics
cross-check; on disagreement, log loudly and prefer NOT-stopping), and `MachineMetrics.LastTherapyUseDateTime`
as the restart-recovery anchor (one read after a process restart says whether therapy ended while away).
HEURISTIC: the poll cadence (evidence-based, not fixed 60 s). UNKNOWN: whether `FGState` holds `Therapy`
through a mask-off (Phase B), `SubscribeEvent` latency, `Leak`-validity across in-therapy states, the
clock stamp-source per path.

## Capture provenance
Box `/srv/tepna/probe/as11_matrix/`: `idle_*.jsonl` (idle baseline), `continuous_*.jsonl` + `cont.log`
(full-session adv scan with payload-change markers), `status_treating_*.jsonl`, `status_idle_*.jsonl`
(the two §4 Get reads). Probes: `as11_adv_cont.py` (passive scan), `as11_status.py` (read-only Get
sweep). Recorded live-stream: `/srv/tepna/captures/cpap-ble/DATALOG/20260824/20260824_174542_BRP.edf`.
All read-only — no `Set`, no `EnterTherapy`/`EnterStandby`, no state-changing RPC.

---

## APPENDIX — owner's full program spec (§1–27, verbatim)

The authoritative source, preserved here because its origin (a session scratchpad) is ephemeral:

```text
TEPNA — AIRSENSE 11 AUTOMATIC CPAP SESSION DETECTION
RESEARCH + IMPLEMENTATION INVESTIGATION
(owner-issued spec, pasted verbatim into the lead session 2026-08-24; §1–25 first message, §26–27 appended in a follow-up)

OBJECTIVE

Investigate and determine the best technically defensible way for Tepna
to automatically detect when an AirSense 11 CPAP therapy session starts
and ends, so that the existing Tepna live BLE CPAP recording can operate
without the current manual START/STOP switch.

DO NOT immediately implement the first plausible solution.

First investigate the existing Tepna code, the public AirSense 11
protocol implementation already available in the project, and actual
hardware behavior. Compare all technically available approaches,
measure what can actually be observed, and then recommend and implement
the best approach supported by evidence.

IMPORTANT:

Tepna already has working AirSense 11 BLE live acquisition.

DO NOT replace or rewrite the existing live acquisition architecture.

The current system can receive the AirSense 11 live stream containing
at least flow and mask-pressure data and can write the resulting data
through the existing Tepna acquisition pipeline.

The problem to solve is specifically:

AUTOMATIC SESSION START / STOP DETECTION.

============================================================
1. CLEAN INVESTIGATION RULES
============================================================

Use:

- existing Tepna source code;
- existing Tepna protocol implementation;
- existing Tepna tests and fixtures;
- public AirSense 11 protocol documentation/code that is already
  explicitly available for this research;
- actual AirSense 11 hardware experiments where available.

Do not assume that a signal exists merely because another implementation
uses it.

Every proposed detection signal must be classified as:

MEASURED
ESTABLISHED
HEURISTIC
UNKNOWN

Use Tepna's existing evidence classification system.

Do not change Tepna's established evidence rules.

Do not weaken provenance standards.

Do not introduce a magic boolean such as:

CPAP_RUNNING = true

without recording what evidence produced that conclusion.

============================================================
2. FIRST: UNDERSTAND CURRENT TEPNA
============================================================

Read the actual current code before modifying anything.

Specifically inspect:

- cpap_stream.py
- as11_pull.py
- current CPAP BLE connection/session code
- LiveStreamController
- current manual START/STOP mechanism
- telemetry bus
- raw recording writer
- EDF writer
- lifecycle/state machinery
- Clock Contract
- capture-host integration
- existing CPAPDex
- existing CPAP tests
- any AS11 protocol definitions
- any current BLE discovery/scanning code

Determine exactly:

A. How AirSense 11 BLE discovery currently works.
B. How the BLE connection is established.
C. What authentication/session establishment provides.
D. What GATT characteristics are currently used.
E. What notifications are currently received.
F. What data is available before the high-rate live stream starts.
G. What happens when the machine is idle.
H. What happens when therapy starts.
I. What happens when therapy stops.
J. What happens when the mask is removed temporarily.
K. What happens when the machine is turned off.
L. What happens when BLE disconnects.
M. What state is already available in Tepna but currently ignored.

DO NOT implement anything until this inventory is complete.

============================================================
3. INVESTIGATE AIRSENSE 11 BLE ADVERTISEMENTS
============================================================

Determine whether the AirSense 11 BLE advertisement packets contain
anything useful for automatic therapy detection.

Measure/inspect:

- device identity
- manufacturer data
- service UUIDs
- service data
- changing fields
- advertisement interval
- RSSI
- whether advertisement content changes between:
  - machine idle
  - therapy active
  - therapy stopped
  - mask removed
  - machine powered down

Do NOT assume RSSI indicates therapy state.

Determine whether any advertisement field has a demonstrated relationship
to therapy state.

Classify every useful field:

MEASURED
ESTABLISHED
HEURISTIC
UNKNOWN

If advertisements do NOT expose reliable therapy state, explicitly
document that result.

Do not manufacture a solution from RSSI or advertisement presence.

============================================================
4. INVESTIGATE GATT STATUS WITHOUT LIVE STREAM
============================================================

This is a high-priority investigation.

Determine whether Tepna can:

BLE discovery → short connection → authenticate/session setup →
query low-bandwidth status → determine therapy state → disconnect

without opening the high-rate flow/pressure stream.

Inspect all currently known AS11 GATT/RPC/DataItem mechanisms.

Specifically investigate:

- Get
- status DataItems
- device state
- therapy state
- blower state
- mode state
- session state
- any relevant state values

Determine:

1. What can be queried.
2. What values are returned.
3. Whether values differ between therapy ON/OFF.
4. How quickly they change.
5. Whether querying them is safe.
6. Whether querying them has side effects.
7. Whether the connection must remain open.
8. Whether this is sufficiently reliable for automatic session control.

Do not use control commands merely to test status.

Never send a command such as EnterTherapy or EnterStandby
to manipulate therapy during testing unless explicitly authorized
by an existing safe hardware test procedure.

The goal is OBSERVATION, not remote therapy control.

============================================================
5. INVESTIGATE EVENT SUBSCRIPTIONS
============================================================

Investigate whether the AirSense 11 event/DataItem subscription mechanism
can expose therapy-state transitions.

Specifically investigate:

SubscribeEvent

and related DataItem/event facilities.

Determine whether any observable event corresponds to:

THERAPY OFF → ON  or  THERAPY ON → OFF

or an equivalent state transition.

If possible, determine whether this can operate as:

connect → subscribe → wait → receive event → act → unsubscribe/disconnect

rather than maintaining the high-rate waveform stream.

This is the preferred architecture IF the signal is demonstrated to be
reliable.

Do not assume that an event named "state" means therapy state.

Trace the actual value and validate it on hardware.

============================================================
6. INVESTIGATE LOW-RATE STREAM OPTIONS
============================================================

Determine whether the AirSense 11 provides a lower-bandwidth stream
containing useful state/pressure information.

Compare:

FULL LIVE STREAM  vs  LOW-RATE STATUS STREAM  vs  EVENT SUBSCRIPTION  vs  GET/QUERY.

Determine:

- bandwidth
- connection duration
- power impact
- update frequency
- reliability
- latency
- information content
- whether it requires authentication
- whether it interferes with normal therapy
- whether it can coexist with normal Tepna recording

Do not use the high-rate waveform stream merely because it is already
available if a better low-bandwidth mechanism exists.

============================================================
7. INVESTIGATE FLOW + MASK PRESSURE
============================================================

If no explicit therapy state is available, investigate the signals
Tepna already receives:

- flow
- mask pressure

Determine whether these reliably distinguish:

A. CPAP connected but idle
B. therapy starting
C. therapy active
D. mask temporarily removed
E. therapy paused
F. therapy ended
G. machine shutting down
H. BLE stream interrupted

Perform actual measurements if hardware is available.

Do not rely on a single sample.

Determine:

- baseline pressure
- active pressure
- flow characteristics
- transition latency
- noise
- transient behavior
- mask-off behavior
- restart behavior
- false-start rate
- false-stop rate.

If waveform inference is necessary, design it with hysteresis and
explicit evidence.

============================================================
8. INVESTIGATE SESSION SEMANTICS
============================================================

Do not assume: therapy stopped = night ended.

A single overnight use may contain:

SESSION
    ├── therapy segment
    ├── mask-off gap
    ├── therapy segment
    ├── another gap
    └── final therapy segment

Determine how the AirSense 11 itself defines a session.

Determine how Tepna should represent:

ACQUISITION SESSION  versus  THERAPY SEGMENTS.

Do not destroy the distinction.

The acquisition layer should preserve the complete recording context.

CPAPDex should remain responsible for downstream physiological/session
analysis.

============================================================
9. INVESTIGATE START DETECTION
============================================================

Evaluate all candidates:

A. Advertisement state
B. GATT status query
C. Event subscription
D. low-rate stream
E. full live stream
F. flow activity
G. mask pressure activity
H. explicit AS11 protocol state
I. combination of signals

Rank each candidate by:

- reliability
- latency
- false positives
- false negatives
- bandwidth
- BLE connection time
- implementation complexity
- hardware impact
- scientific provenance
- recoverability
- compatibility with current Tepna architecture.

Do not choose a solution based on elegance alone.

============================================================
10. INVESTIGATE STOP DETECTION
============================================================

Evaluate all candidates for detecting the end of therapy.

The stop detector must tolerate:

- brief mask removal
- pressure transients
- ramp behavior
- temporary flow cessation
- Bluetooth packet loss
- short BLE interruptions
- CPAP internal pauses.

Use hysteresis.

A candidate STOP must not immediately terminate the recording.

Conceptually:

ACTIVE → possible inactivity → STOP_CANDIDATE →
activity returns? YES → ACTIVE / NO → STOPPED

Determine the actual timing from measurements.

Do not invent a fixed value such as 30 seconds or 5 minutes without
evidence.

If a timeout is required, classify it as HEURISTIC and document why it
is necessary.

============================================================
11. INVESTIGATE DISCONNECTION SEMANTICS
============================================================

Determine what should happen if:

A. BLE disconnects while therapy is active.
B. BLE disconnects while idle.
C. AirSense 11 temporarily disappears.
D. Tepna process restarts.
E. host computer restarts.
F. Bluetooth adapter resets.

NEVER interpret: BLE disconnect as automatically equivalent to: therapy ended.

The system must preserve the distinction:

DEVICE UNAVAILABLE  versus  THERAPY STOPPED.

============================================================
12. INVESTIGATE POWER AND CONNECTION COST
============================================================

Measure or estimate:

- BLE connection setup time
- authentication time
- status-query time
- high-rate stream startup time
- connection duration
- reconnect frequency
- host CPU impact
- AirSense 11 impact
- Bluetooth reliability.

Compare two major architectures:

ARCHITECTURE A: permanent connection + continuous low/high-rate observation

ARCHITECTURE B: advertisement detection + short status connection +
connect only when therapy is active + full stream during recording +
disconnect after stop.

Prefer B if it is sufficiently reliable.

Do not assume permanent connection is necessary.

============================================================
13. INVESTIGATE WHETHER ADVERTISEMENT-ONLY DETECTION IS POSSIBLE
============================================================

Explicitly answer:

Can Tepna determine THERAPY ACTIVE or THERAPY INACTIVE
without establishing a GATT connection?

If yes: identify the exact measured field and evidence.

If no: state: "Advertisement-only detection is insufficient."

Do not use advertising presence as a proxy for therapy state.

============================================================
14. INVESTIGATE STORED DATA / RECOVERY
============================================================

Investigate whether the AS11 protocol provides stored-data access
through mechanisms such as spools or historical data.

Determine whether Tepna could eventually use stored-data retrieval for:

- recovery after BLE interruption
- missed live data
- validation
- backfill
- synchronization.

Do NOT replace live capture with stored-data retrieval in this task.

This is a secondary recovery investigation.

Document what is available and what is not.

============================================================
15. COMPARE WITH EZSHARE
============================================================

Tepna's physical CPAP setup uses an EZShare Wi-Fi SD card.

Do NOT assume Tepna can observe the physical SD bus.

The EZShare provides: CPAP → SD card → EZShare Wi-Fi → network

Tepna does NOT have electrical visibility into SD-bus activity.

Therefore: DO NOT design a solution that requires SD-bus sensing.

The EZShare/SD path may remain useful for:

- archival data
- independent validation
- fallback acquisition
- CPAPDex historical EDF files

but it should not be required for BLE therapy start/stop detection unless
actual evidence demonstrates a useful network-visible signal.

============================================================
16. DEFINE THE BEST ARCHITECTURE
============================================================

After completing the investigation, rank the solutions.

Preferred ranking should consider:

1. explicit AS11 therapy-state/event signal
2. low-bandwidth status query
3. low-bandwidth event/stream mechanism
4. full stream + measured flow/pressure detection
5. time-based fallback

Do NOT force this ranking if hardware evidence contradicts it.

The winning solution must be evidence-based.

============================================================
17. TARGET ARCHITECTURE
============================================================

If a reliable low-bandwidth state mechanism exists, target:

BLE ADVERTISEMENT → AS11 DETECTED → SHORT BLE CONNECTION →
LOW-BANDWIDTH STATE OBSERVATION → THERAPY ACTIVE?
  ├── NO → DISCONNECT / WAIT
  └── YES → START LIVE STREAM → EXISTING TEPNA RECORDING →
      OBSERVE END-OF-THERAPY → STOP LIVE STREAM →
      FLUSH / FINALIZE → DISCONNECT

If no low-bandwidth state mechanism exists, use:

BLE CONNECTION → EXISTING LIVE STREAM → FLOW + MASK PRESSURE →
START/STOP STATE MACHINE → EXISTING RECORDING PIPELINE

============================================================
18. DO NOT DUPLICATE LIVE STREAM CONTROL
============================================================

The current LiveStreamController already owns:

- start
- stop
- lifecycle
- cancellation
- stream drain
- sink closure
- finalization.

Do not create a second competing stream controller.

Add a supervisor above it.

Conceptually:

CPAPPresenceSupervisor
        │
        ├── WAIT
        ├── CONNECT
        ├── OBSERVE
        ├── START
        └── STOP
                │
                ▼
        LiveStreamController

============================================================
19. REQUIRED STATE MACHINE
============================================================

Design an explicit state machine.

Minimum conceptual states:

DISCONNECTED
DEVICE_DETECTED
CONNECTING
OBSERVING
THERAPY_INACTIVE
START_CANDIDATE
THERAPY_ACTIVE
STOP_CANDIDATE
STOPPING
DISCONNECTING
ERROR

Use existing Tepna lifecycle conventions where possible.

Do not create contradictory state systems.

============================================================
20. EVIDENCE MODEL
============================================================

Every automatic transition must have provenance.

Example:

START:
reason: AS11 explicit therapy state
or: pressure activity + flow activity sustained
or: heuristic timeout

STOP:
reason: AS11 explicit therapy state
or: sustained pressure/flow inactivity

Every transition must preserve:

- timestamp
- evidence source
- observed values
- confidence/classification
- previous state
- new state.

============================================================
21. FAILURE SAFETY
============================================================

If state is uncertain:

DO NOT automatically stop a valuable recording merely because evidence
is ambiguous.

Prefer: UNKNOWN or CONTINUE according to existing Tepna safety conventions.

Automatic START must require positive evidence.

Automatic STOP must require stronger/sustained evidence.

============================================================
22. TESTING
============================================================

Create tests for:

START:
- idle machine
- therapy start
- startup transient
- pressure ramp
- flow transient
- false BLE advertisement
- connection without therapy
- delayed therapy start

STOP:
- normal therapy end
- mask removal
- short mask-off period
- long mask-off period
- pressure transient
- flow transient
- BLE packet loss
- BLE disconnect
- machine shutdown

RECOVERY:
- process restart
- Bluetooth restart
- reconnect
- incomplete session
- repeated start detection
- repeated stop detection.

Ensure: one therapy period does not generate duplicate recordings.

Ensure: a temporary interruption does not unnecessarily destroy the
acquisition session.

============================================================
23. HARDWARE TEST MATRIX
============================================================

If hardware access is available, perform controlled experiments:

TEST 1  AirSense powered on, therapy inactive.
TEST 2  Start therapy.
TEST 3  Stop therapy.
TEST 4  Remove mask briefly.
TEST 5  Remove mask for a long interval.
TEST 6  Resume therapy.
TEST 7  Turn machine off.
TEST 8  BLE disconnect while therapy continues.
TEST 9  Tepna restart while therapy continues.
TEST 10 Bluetooth adapter restart while therapy continues.

For every test record:

- BLE advertisements
- connection state
- GATT state
- status responses
- events
- stream packets
- flow
- mask pressure
- timestamps
- resulting supervisor state.

============================================================
24. REQUIRED RESEARCH REPORT BEFORE IMPLEMENTATION
============================================================

Before modifying production code, produce:

A. CURRENT TEPNA ARCHITECTURE
B. AS11 BLE CAPABILITIES AVAILABLE TO TEPNA
C. ADVERTISEMENT FINDINGS
D. STATUS/DataItem FINDINGS
E. SubscribeEvent FINDINGS
F. LOW-RATE STREAM FINDINGS
G. FLOW/PRESSURE FINDINGS
H. STORED-DATA/SPOOL FINDINGS
I. DISCONNECTION FINDINGS
J. EZSHARE LIMITATIONS
K. CANDIDATE ARCHITECTURES
L. MEASURED / ESTABLISHED / HEURISTIC CLASSIFICATION
M. FAILURE MODES
N. RECOMMENDED ARCHITECTURE
O. WHY IT IS BETTER THAN THE ALTERNATIVES

DO NOT IMPLEMENT UNTIL THIS REPORT IS COMPLETE.

============================================================
25. IMPLEMENTATION AFTER APPROVAL
============================================================

After the research identifies the best approach:

Implement only the minimum necessary changes.

Prefer:

new supervisor + existing LiveStreamController + existing BLE transport +
existing telemetry + existing clock + existing persistence.

Do not rewrite working protocol code.

Do not modify CPAPDex formulas or scientific interpretation.

Do not change unrelated Tepna functionality.

============================================================
26. SUCCESS CRITERIA
============================================================

The final system should ideally achieve:

1. No manual START button required.
2. No manual STOP button required.
3. No permanent high-bandwidth BLE stream when therapy is inactive.
4. No dependence on EZShare for therapy-state detection.
5. Automatic therapy-start detection.
6. Automatic therapy-stop detection.
7. Temporary mask-off periods handled safely.
8. BLE disconnect distinguished from therapy termination.
9. Existing raw flow/pressure acquisition preserved.
10. Existing Clock Contract preserved.
11. Existing telemetry preserved.
12. Existing durable recording preserved.
13. Automatic decisions are auditable.
14. No duplicate sessions.
15. No false "therapy ended" assertion caused solely by BLE loss.
16. Unknown state remains unknown where evidence is insufficient.
17. Recovery after process/BLE restart is deterministic.

============================================================
27. FINAL DELIVERABLE
============================================================

Return all of the following:

1. DETAILED FINDINGS
2. PROTOCOL CAPABILITY MATRIX
3. ADVERTISEMENT ANALYSIS
4. GATT STATUS ANALYSIS
5. EVENT SUBSCRIPTION ANALYSIS
6. LIVE STREAM ANALYSIS
7. FLOW/PRESSURE ANALYSIS
8. STORED DATA ANALYSIS
9. EZSHARE LIMITATIONS
10. CANDIDATE ARCHITECTURES
11. MEASURED/ESTABLISHED/HEURISTIC CLASSIFICATION
12. RECOMMENDED DESIGN
13. STATE MACHINE
14. FILES CHANGED
15. TESTS ADDED
16. HARDWARE TEST RESULTS
17. KNOWN LIMITATIONS
18. EXACT NEXT STEPS

MOST IMPORTANT:

Do not settle for "flow and pressure can probably tell us."

First determine whether the AirSense 11 itself exposes a reliable,
low-bandwidth therapy-state signal through its BLE protocol.

The ideal result is:

ADVERTISEMENT → short connection → explicit/low-bandwidth therapy-state
observation → full BLE stream only while therapy is active → automatic
stop → disconnect.

If the protocol cannot provide that reliably, prove it and then use the
best measured fallback based on flow + mask pressure.

The goal is NOT merely to automate the existing button.

The goal is to discover the most reliable, lowest-overhead, most
scientifically defensible automatic CPAP session detector that the
existing AirSense 11 hardware and Tepna architecture can actually
support.

```
