<!--
  OXYII-DAT-AUTO-HARVEST-REFINEMENT-2026-08-24-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS — 2026-08-24 · **Created:** 2026-08-24 · **Owner-issued spec** (§1–27, verbatim in the appendix) · **Interlocks:** `OXYII-PRESENCE-MODEL-2026-08-23-BRIEF.md` (recording axis, `IDLE_UNWORN` emit) · **Affects:** `capture-host/capture.py`

# O2Ring `.dat` auto-harvest — and the event path that has never armed

The spec asks for event-driven harvest on recording-end, with the poller demoted to a reconciliation
safety net. **The §1 architecture map found that decision already made, already shipped, already
deployed — and never once executed.**

---

## 1 · §1 ARCHITECTURE MAP — what is actually there

`capture.py` carries two **pure, selftest-shaped** event triggers, with their own reasoning recorded:

```python
def charger_pull_due(charging, since, now, settle, already) -> bool
def notworn_pull_due(worn, since, now, settle, already) -> bool
```

> *"far faster than autopull_poller's hourly cadence (VIGIL-DEEP-ANALYSIS §2C: the old poller could
> delay the pull up to an hour)"*

So "demote the poller" is not a proposal. It is a shipped decision. Writing this brief as though the
trigger were missing would be the stale-capability error the house keeps re-finding — costing work as
unbuilt when it ships.

## 2 · 🔴 THE FINDING — the event path has NEVER ARMED

Measured on the capture box, whole journal:

| line | occurrences |
|---|---|
| `auto-pull: armed` (event triggers) | **0** |
| `auto-pull: enabled` (poller) | **312** |
| any not-worn / charger trigger firing | **0** |

The loop returns before arming:

```python
if not pcfg.get("auto") or not pcfg.get("on_charger", True):
    return
```

```yaml
# box config (gitignored — the repo cannot see this)
auto: True
on_charger: False        # ← returns here
auto_interval_sec: 3600
```

### 2a · The flag's name describes a third of what it does

`on_charger` reads as *"disable the on-charger trigger"*. It also silently disables the **not-worn**
trigger — which has nothing to do with charging, and which the code's own comment calls
**"the only reachable trigger for a coin-cell device such as the H10"**.

⚠️ **Cross-device blast radius, and it is the part that makes this more than a ring finding.** The
Polar H10 runs on a CR2025 cell, so `charging` is permanently False and the on-charger path is
structurally unreachable for it. `notworn_pull_due` exists *specifically* to give it a trigger. That
trigger has been dead for as long as the flag has been set. **A recording device whose only retrieval
trigger is disabled fills its single onboard slot once and then silently records nothing** — the
fabricated-absence class from `POLAR-ONBOARD-BACKUP-FOLLOWUPS` §4.

### 2b · The symptom is an ABSENT log line

This is the fleet's defect class in its purest form so far. Nothing failed. Nothing errored. No gate
could see it, because **a gate cannot observe a line that was never printed**. It was found by
*counting arming lines* rather than by reading the code — the code says the feature exists, and it
does.

## 3 · What this dissolves

Two live arguments were about a path that has never run:

- **The settle-vs-sleep-window question.** The doff settle is clamped to ≥210 s
  (`max(notworn_settle_sec, _DROP_NOT_WORN_SEC + 30)`), deliberately, so a pull cannot hold a link
  inside the power-drop grace. Whether 210 s beats the ring's post-drop awake tail is a real question —
  and **unanswerable until something arms**. It is sequenced after, not before.
- **This morning's night.** doff 04:38:10 → the doff trigger would have fired ~04:41:40 → it never
  armed → the recording waited for the 05:45:52 poller tick and was retrieved there, phase-exact.
  ⚠️ Which is why *"the poller is healthy"* and *"the system is slow"* were **both true**: the poller
  was the only mechanism running at all.

⚠️ **A conflation corrected in the making of this brief:** the ~10 s figure is the **file-close
debounce** (doff → `duration_s` reset), NOT a sleep window. Different constants, different clocks.
The ring stays awake while a link is HELD (6 h docked, measured today); after the link drops it stays
awake for an **unmeasured tail**, bounded today at ≤22 min. That tail is the missing constant, and §5
schedules it.

## 4 · UNIT 1 — split the flag, and make arming visible

**(a) `on_charger` governs ONLY the charger trigger.** The not-worn trigger gets its own flag.

⚠️ **The deployed box's behaviour must not flip on the next hourly auto-deploy.** Enabling a path that
has never executed is an *event* — it gets a deliberate config change and a visible arming line, not a
silent default flip. So the new flag defaults to the box's current effective behaviour, and turning it
on is somebody's decision.

**(b) The arming diagnostic prints in BOTH directions at daemon start:**

```
auto-pull: armed — not-worn (settle 210 s) + charger (settle 15 s), 2 device(s)
auto-pull: NOT armed — pull.on_charger=False disables the charger trigger; pull.on_doff absent → default off
```

An absence-shaped failure becomes present-shaped. **That is the whole fix**: the defect was never that
the flag was False, it was that nothing said so.

**(c) The H10 datum** is recorded in §2a so the blast radius is not re-derived as a ring-only issue.

## 5 · Sequenced after unit 1

- [ ] **Measure the post-drop awake tail.** Possibly recoverable from history: every past unworn
      link-drop followed by connect attempts brackets it. That number decides whether the current
      210 s settle is already sufficient, needs shortening (**owner decision** — the clamp is
      deliberate), or needs hold-through-pull.
- [ ] **§5's recording state machine** (`UNKNOWN → RECORDING → END_CANDIDATE → END_CONFIRMED`) on the
      `duration_s` axis. ⚠️ **The recording axis is `OXYII-PRESENCE-MODEL`'s model** — coordinate the
      seam before locking the enum, and do not collide with that brief's in-flight `IDLE_UNWORN` emit.
- [ ] **T0–T7 latency instrumentation**, key metric recording-end → durable-raw.
- [ ] **§22's 8-case restart matrix**, verbatim.
- [ ] **§24 real-ring tests** — build to be testable, hand the checklist to the box session; one ring
      window can serve this and their pending E2E item.
- [ ] **§11 multi-recording ordering** — the ring's FILE_LIST semantics are *measured* in
      `O2RING-PROTOCOL`; read them, do not assume.

## 6 · Open question for the owner

**Why is `on_charger: False`?** Deliberate, or a stale reaction to something since fixed? The config
is gitignored, so the repo cannot answer it and neither can I. Until it is answered, unit 1 makes the
state *visible* without changing it — which is the honest move either way.

## 7 · Done when

- [ ] The two triggers are independently flagged, and no deployed behaviour changes silently.
- [ ] `armed` / `NOT armed` prints at start with the governing flag and value named.
- [ ] A control proves the diagnostic fires in both directions — the absent-line failure cannot recur.
- [ ] Every item in §5 is built, or recorded as declined with a measured reason.

---

## APPENDIX — owner's full program spec (§1–27, verbatim)

    TEPNA — O2RING .DAT AUTO-HARVEST REFINEMENT
    ============================================
    (owner-issued spec, pasted verbatim into the lead session 2026-08-24 evening)
    
    OBJECTIVE
    ---------
    
    Improve the CURRENT Tepna O2Ring `.dat` harvesting implementation so that
    stored recordings are harvested at the safest and earliest possible time,
    while preserving the existing transactional, crash-safe, provenance-aware
    architecture.
    
    This is a REFINEMENT task, not a rewrite.
    
    The current implementation already has substantial infrastructure for:
    
    - O2Ring BLE communication
    - OXYFRAME parsing
    - recording-duration observation
    - `.dat` discovery
    - `.dat` download
    - `.part` files
    - recovery
    - identity/deduplication
    - SHA-256 verification
    - atomic promotion
    - pull lifecycle states
    - lifecycle journaling
    - crash-consistency testing.
    
    DO NOT replace these systems.
    
    The goal is to make the existing system behave more intelligently.
    
    ============================================================
    1. FIRST: READ THE CURRENT IMPLEMENTATION
    ============================================================
    
    Before changing anything, inspect the current HEAD completely.
    
    Specifically trace:
    
    - OxyII BLE connection lifecycle
    - OXYFRAME parser
    - `duration_s`
    - recording detection
    - O2Ring presence detection
    - `.dat` discovery
    - `pull_session`
    - `.part` handling
    - verification
    - atomic commit
    - pull lifecycle
    - OXYLIFE journal
    - session identity
    - existing scheduler/poller
    - OxyDex input path
    - current tests.
    
    Do not rely on old briefs if current code differs.
    
    Produce a short architecture map before modifying code.
    
    ============================================================
    2. CORE DESIGN PRINCIPLE
    ============================================================
    
    The `.dat` file is a TIME-LIMITED DEVICE-SIDE ASSET.
    
    The objective is therefore:
    
    DISCOVER RECORDING END
            ↓
    HARVEST `.DAT` IMMEDIATELY
            ↓
    MAKE RAW BYTES DURABLE
            ↓
    VERIFY
            ↓
    DECODE
            ↓
    PERSIST SESSION/EVENT INFORMATION
            ↓
    NORMAL ANALYSIS
    
    Do not wait for an arbitrary hourly poll when the system already has
    evidence that a recording episode has ended.
    
    ============================================================
    3. RECORDING STATE MUST BE SEPARATE FROM BLE STATE
    ============================================================
    
    Do NOT infer recording state directly from:
    
    - BLE connected/disconnected
    - advertising/not advertising
    - finger contact alone
    - SpO2 validity
    - notification arrival alone.
    
    These are transport/sensor observations.
    
    Maintain a distinct recording-state model.
    
    Conceptually:
    
    TRANSPORT:
    
    NOT_SEEN
    CONNECTING
    CONNECTED
    LIVE
    INTERRUPTED
    DISCONNECTED
    
    RECORDING:
    
    UNKNOWN
    NOT_RECORDING
    RECORDING
    END_CANDIDATE
    END_CONFIRMED
    
    Do not unnecessarily add more states.
    
    The two dimensions must remain independent.
    
    ============================================================
    4. USE duration_s AS THE PRIMARY MEASURED RECORDING SIGNAL
    ============================================================
    
    The current research and implementation indicate that `duration_s`
    advancing is the strongest measured indication that the O2Ring is
    actively recording.
    
    Use the existing implementation.
    
    Do NOT replace it with:
    
    - contact detection
    - BLE presence
    - advertising state
    - arbitrary timeout
    - SpO2 validity.
    
    When `duration_s` is observed advancing:
    
        RECORDING = RECORDING
    
    When `duration_s` resets or otherwise indicates episode termination:
    
        RECORDING = END_CANDIDATE
    
    Do not immediately assume the session is definitely closed if the
    current evidence is ambiguous.
    
    ============================================================
    5. END DETECTION
    ============================================================
    
    Design a small deterministic state machine.
    
    Example:
    
    UNKNOWN
      ↓ duration_s advances
    RECORDING
      ↓ duration_s continues advancing
    RECORDING
      ↓ duration_s resets / episode boundary observed
    END_CANDIDATE
      ↓ attempt immediate `.dat` harvest
      ↓ decode trailer
      ↓ compare stored duration with observed duration
    END_CONFIRMED
    
    If the `.dat` cannot yet be retrieved:
    
    END_CANDIDATE
      ↓ retry using existing retry/recovery mechanisms
      ↓ do NOT discard the session.
    
    The exact transition logic must use current Tepna contracts.
    
    ============================================================
    6. IMMEDIATE HARVEST
    ============================================================
    
    Once a recording end is sufficiently established, trigger the existing
    `pull_session` path immediately.
    
    Do NOT create a second `.dat` downloader.
    
    Do NOT duplicate the transaction logic.
    
    The trigger should simply call the existing safe pull mechanism.
    
    Preferred:
    
    recording episode ended
            ↓
    enqueue high-priority pull
            ↓
    existing pull_session()
            ↓
    existing transactional download
            ↓
    existing verification
            ↓
    existing atomic commit.
    
    The pull must be asynchronous and must not block normal BLE processing
    longer than necessary.
    
    ============================================================
    7. DO NOT BREAK LIVE CAPTURE
    ============================================================
    
    The ring may still need to provide:
    
    - live OXYFRAME data
    - recording-duration observations
    - status information.
    
    The pull operation must therefore cooperate with the existing BLE
    lifecycle.
    
    If the current device protocol requires a temporary pause:
    
    use the existing PAUSED_FOR_PULL / PULLING mechanism.
    
    Do not invent another connection manager.
    
    The invariant is:
    
    LIVE DATA MUST NOT BE SILENTLY LOST JUST BECAUSE A `.DAT` PULL STARTED.
    
    If some interruption is unavoidable, record it explicitly in the
    existing lifecycle/gap/provenance system.
    
    ============================================================
    8. DO NOT MAKE THE POLLER DISAPPEAR
    ============================================================
    
    Keep the periodic poller as a SAFETY NET.
    
    It must remain capable of finding a `.dat` if:
    
    - the recording-end event was missed
    - the host restarted
    - BLE disconnected at the wrong time
    - the ring became temporarily unavailable
    - the recording state was UNKNOWN
    - the host was asleep
    - an event notification was lost.
    
    Therefore:
    
    EVENT-DRIVEN HARVEST + PERIODIC RECONCILIATION
    
    is the desired architecture.
    
    The event path gives low latency.
    The periodic path provides recovery.
    Neither replaces the other.
    
    ============================================================
    9. RECONCILIATION
    ============================================================
    
    Every periodic poll should ask:
    
    "Does the device contain a stored recording that Tepna does not already
    have?"
    
    Do not rely exclusively on the recording-state machine.
    
    The system must converge to:
    
    DEVICE RECORDINGS = LOCAL DURABLE RECORDINGS
    
    subject to device availability and transfer failure.
    
    Known recordings must not be downloaded repeatedly.
    
    Use the existing identity mechanism.
    
    Do not use filename-only identity.
    
    ============================================================
    10. PRIORITY ORDER
    ============================================================
    
    When deciding what to do first:
    
    P0: Protect raw `.dat` from device-side overwrite.
    P1: Verify and atomically commit it.
    P2: Decode it.
    P3: Extract events.
    P4: Perform expensive analysis.
    
    Never reverse this priority.
    
    A successfully downloaded raw `.dat` must remain safe even if every
    downstream operation fails.
    
    ============================================================
    11. MULTIPLE RECORDINGS
    ============================================================
    
    If the ring contains multiple stored sessions:
    
    determine their actual device ordering semantics.
    
    Prioritize the session most at risk of being overwritten.
    
    Do not assume filename ordering is chronological unless the protocol
    guarantees it.
    
    The scheduler should prevent:
    
    new session arrives + processing takes too long + oldest session is lost.
    
    ============================================================
    12. SESSION IDENTITY
    ============================================================
    
    Use the current Tepna session identity mechanism.
    
    The same `.dat` discovered multiple times must resolve to the same
    logical session.
    
    Repeated discovery must be idempotent.
    
    A second pull attempt must not create a second session.
    
    A partial download followed by successful retry must result in ONE
    final artifact.
    
    ============================================================
    13. TRANSACTIONAL INVARIANT
    ============================================================
    
    The following invariant MUST always hold:
    
    A `.dat` is never considered DURABLE until:
    
    1. download is complete;
    2. file size is sane;
    3. protocol/content validation succeeds;
    4. SHA-256/content identity is recorded;
    5. atomic promotion succeeds.
    
    Use the current implementation.
    
    Do not weaken this for speed.
    
    Speed comes from starting earlier, not from reducing validation.
    
    ============================================================
    14. PARTIAL DOWNLOADS
    ============================================================
    
    Preserve current `.part` behavior.
    
    If the host dies: `.part` remains recoverable.
    If BLE disappears: `.part` remains recoverable.
    If the transfer fails: session remains recoverable.
    If verification fails: quarantine according to existing policy.
    
    Do not leave ambiguous files that appear to be complete.
    
    ============================================================
    15. RECORDING END VS FILE AVAILABILITY
    ============================================================
    
    These are two separate facts.
    
    Example:
    
    RECORDING_END_CONFIRMED but DAT_NOT_YET_AVAILABLE is a valid state.
    Likewise: DAT_AVAILABLE but RECORDING_END_NOT_OBSERVED is a valid state.
    
    Do not collapse them.
    
    The system should be able to say:
    
    RECORDING: ended at T1
    DAT: discovered at T2
    DAT: committed at T3
    
    This gives excellent provenance.
    
    ============================================================
    16. TRAILER CONFIRMATION
    ============================================================
    
    After successful `.dat` download and decode:
    
    read the stored recording trailer using the existing decoder.
    
    Compare the trailer's total duration with the independently observed
    `duration_s`.
    
    Use this as an independent session-boundary consistency check.
    
    Record:
    
    observed_duration_s
    stored_duration_s
    difference
    validation_status.
    
    Do NOT silently overwrite one with the other.
    
    If they disagree beyond the existing Tepna tolerance: mark the
    discrepancy. Do not fabricate a corrected value.
    
    ============================================================
    17. EVENT EXTRACTION
    ============================================================
    
    After raw `.dat` becomes durable, immediately make it available to the
    existing OxyDex analysis pipeline.
    
    Do NOT implement a second desaturation detector in the harvester.
    Do NOT implement a second pulse detector.
    Do NOT implement a second PPG detector.
    
    OxyDex remains responsible for oximetry interpretation.
    PpgDex remains responsible for live high-rate optical waveform
    interpretation.
    Integrator remains responsible for cross-sensor corroboration.
    
    The harvester's responsibility is:
    
    GET DATA SAFELY and MAKE DATA AVAILABLE QUICKLY.
    
    ============================================================
    18. PRESERVE HIGH-VALUE EVENT INFORMATION
    ============================================================
    
    If the existing OxyDex pipeline already produces event objects, ensure
    that those events can be persisted immediately after `.dat` analysis.
    
    An event should retain, where applicable:
    
    - session ID
    - event ID
    - event type
    - onset
    - nadir
    - recovery/end
    - duration
    - magnitude
    - signal quality
    - source
    - evidence classification
    - algorithm version.
    
    Do not create a competing event schema.
    
    Use the existing Tepna event contract.
    
    ============================================================
    19. CANDIDATES MUST NOT BE DESTROYED
    ============================================================
    
    Do not discard useful borderline candidates merely because they fail
    the final clinical/physiological threshold.
    
    Preserve the existing distinction between:
    
    MEASURED / ESTABLISHED / HEURISTIC
    
    and existing Tepna candidate/final semantics.
    
    Do not change Tepna's scientific rules.
    
    The objective is better preservation of evidence, not changing what
    counts as an event.
    
    ============================================================
    20. CLOCK / TIMESTAMP RULE
    ============================================================
    
    Use the existing Tepna Clock Contract.
    
    Do not introduce another timestamp authority.
    
    The harvester's job is to preserve:
    
    - device/session timing
    - host observation timing
    - download timing.
    
    These are different timestamps.
    
    Do not silently substitute host wall-clock time for device sample time.
    
    ============================================================
    21. JOURNALING
    ============================================================
    
    Use the existing OXYLIFE/session journal.
    
    Important transitions should be observable:
    
    RECORDING_DETECTED
    RECORDING_ACTIVE
    RECORDING_END_CANDIDATE
    DAT_DISCOVERED
    DAT_DOWNLOAD_STARTED
    DAT_DOWNLOAD_PARTIAL
    DAT_DOWNLOAD_VERIFIED
    DAT_COMMITTED
    DAT_DECODED
    DAT_ANALYSIS_COMPLETE
    
    Do not flood the journal with per-sample messages.
    
    Journal state transitions, not telemetry.
    
    ============================================================
    22. RESTART RECOVERY
    ============================================================
    
    Test:
    
    1. host restarts while not connected;
    2. host restarts during recording;
    3. host restarts immediately after recording ends;
    4. host restarts during `.dat` download;
    5. host restarts after `.dat` download but before atomic commit;
    6. host restarts after commit but before analysis;
    7. BLE disconnects during recording;
    8. BLE disconnects during `.dat` pull.
    
    After restart, the system must reconcile:
    
    device state + local durable state + unfinished `.part` state +
    session journal.
    
    No recording should be silently forgotten.
    
    ============================================================
    23. CRITICAL PERFORMANCE MEASUREMENT
    ============================================================
    
    Instrument these timestamps:
    
    T0 = recording end becomes observable
    T1 = harvest requested
    T2 = `.dat` download starts
    T3 = last byte received
    T4 = verification complete
    T5 = atomic commit complete
    T6 = decode complete
    T7 = event ledger/analysis durable.
    
    Report: T1-T0, T2-T0, T4-T0, T5-T0, T6-T0, T7-T0.
    
    The key metric is: RECORDING END → DURABLE RAW `.DAT`.
    The second metric is: DURABLE RAW `.DAT` → DURABLE EVENT DATA.
    
    Do not optimize based on subjective impressions.
    
    ============================================================
    24. TEST WITH REAL O2RING RECORDINGS
    ============================================================
    
    Use the existing real O2Ring corpus.
    
    Verify:
    
    - recording start detection
    - recording continuation
    - recording end detection
    - `.dat` discovery
    - immediate pull
    - trailer duration
    - session identity
    - duplicate prevention
    - interrupted pull
    - host restart
    - BLE disappearance
    - multiple stored sessions
    - periodic reconciliation.
    
    Do not consider synthetic tests sufficient.
    
    ============================================================
    25. DO NOT CHANGE SCIENTIFIC DEFINITIONS
    ============================================================
    
    This task is acquisition architecture.
    
    Do NOT alter:
    
    - ODI thresholds
    - desaturation definitions
    - event duration criteria
    - motion rules
    - PPG beat detection
    - HR algorithms
    - OxyDex evidence classifications
    - Integrator confidence rules.
    
    If an existing scientific rule appears wrong, report it separately.
    
    Do not mix scientific changes into this implementation.
    
    ============================================================
    26. ACCEPTANCE CRITERIA
    ============================================================
    
    The implementation is complete when:
    
    [ ] Recording state is independent of BLE transport state.
    [ ] `duration_s` is used according to the current Tepna evidence as the
        primary measured recording-state signal.
    [ ] Recording-end detection can trigger an immediate `.dat` pull.
    [ ] The existing transactional `pull_session` remains the ONLY pull path.
    [ ] The periodic poller remains as a recovery/reconciliation safety net.
    [ ] Raw `.dat` becomes durable before expensive analysis.
    [ ] Existing SHA-256 verification remains intact.
    [ ] Existing `.part` recovery remains intact.
    [ ] Existing atomic commit remains intact.
    [ ] Duplicate sessions cannot be created by repeated discovery.
    [ ] Recording end and DAT availability remain separate states.
    [ ] Trailer duration is compared against observed duration.
    [ ] All important transitions remain visible in the lifecycle journal.
    [ ] Host restart cannot silently lose an already-discovered recording.
    [ ] BLE loss cannot silently convert into "recording ended."
    [ ] Live capture is not silently corrupted by `.dat` harvesting.
    [ ] OxyDex remains the owner of stored oximetry analysis.
    [ ] PpgDex remains the owner of live high-rate PPG analysis.
    [ ] Integrator remains the owner of cross-sensor corroboration.
    [ ] Existing tests remain green.
    [ ] New tests demonstrate real recording-end → `.dat` harvest behavior.
    
    ============================================================
    27. FINAL ARCHITECTURAL GOAL
    ============================================================
    
    The final design should feel like this:
    
                             O2RING
                                │
                     live OXYFRAME stream
                                ▼
                      recording-state engine
                                │ duration_s advances
                                ▼
                           RECORDING
                                │ duration resets
                                ▼
                        END_CANDIDATE
                                ▼
                     HIGH-PRIORITY HARVEST
                                ▼
                         pull_session()
                     ┌──────────┴──────────┐
                  `.part`              BLE failure
                     ▼                     ▼
                 VERIFY                 RECOVER
                     ▼
                 ATOMIC COMMIT
                     ▼
                 DURABLE `.DAT`
                     ├──────────────► archive/evidence
                     ▼
                   OxyDex
                     ▼
                 event objects
                     ▼
                 GanglioR
                     ▼
                 Integrator
    
    Meanwhile:
    
    PERIODIC RECONCILIATION
            └────► catches anything the event-driven path missed.
    
    The design should be:
    
    EVENT-DRIVEN FOR SPEED
    + PERIODIC FOR RECOVERY
    + TRANSACTIONAL FOR SAFETY
    + MEASURED FOR STATE
    + DETERMINISTIC FOR REPRODUCIBILITY.
    
    Do not add complexity unless it directly improves one of those five
    properties.
