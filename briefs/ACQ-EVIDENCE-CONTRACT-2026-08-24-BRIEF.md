<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS · **Created:** 2026-08-24

# The Acquisition Evidence Contract

Owner-issued program (spec pasted VERBATIM in §Spec below, delivered via the lead session
2026-08-24 evening). A small canonical envelope formalizing what capture knows about the
**integrity · completeness · timing · provenance** of acquired data BEFORE a Dex interprets it. It is
an ACQUISITION layer, not a new evidence/session/provenance/test system (spec Objective). The whole
thesis, confirmed by §1's map below: **it is a pure ASSEMBLER over facts Tepna already stores** — the
envelope normalizes and references them; it duplicates nothing.

> **HEADLINE — the map PROVES spec §22 by inventory, not assertion.** §22 asserts the contract
> "formalizes facts Tepna already knows." The §1 table demonstrates it: of the 16 conceptual fields,
> **exactly ONE row is genuinely new** — the envelope struct and its emission. Every other field is an
> existing store the assembler reads. The deliverable is a normalizing READ plus a versioned emit, not a
> new subsystem — which is precisely why the spec insists "keep it small" and "do not duplicate."

## §0 · Binding execution rulings (lead, 2026-08-24)
1. **PHASE IT.** Pure assembler over existing stores (spool ledger · `.dat` meta · OXYLIFE · gap
   counters · host-clock sidecar · `VALIDATION_DEPTH` · `timingSource`); nothing new persisted except
   the envelope itself, emitted **beside the artifact** (`meta.json` generalized).
   **Phase A** = contract + O2Ring `.dat` path (most settled). **Phase B** = CPAP, after the box's
   supervisor settles. **Phase C** = smallest Dex adapter reads.
2. **§16 anti-golden-centerpiece is RATIFIED** — real acquisition first; Synthetic Goldens are a test
   CONSUMER only, never the definition. Production must not depend on fixtures.
3. **Schema event:** a versioned name in the `ganglior` family, **MINOR** bump, node-export edge
   back-compat per Clock Contract §6 conventions.
4. **§18 execution-witness tests are the point, not decoration.** Two motivating specimens to cite:
   today's **never-armed auto-harvest trigger** (#1742 — the event path has never armed) and the
   **unwired G1 cluster** (transactional-sync functions standalone until the daemon wiring). A test
   that exercises helpers is not proof the production path executes.
5. **UNKNOWN ≠ ABSENT** and **VALID ≠ COMPLETE** get PLANTED-CONTROL tests (pre-state-the-threshold
   discipline): a control that MUST fire if the envelope ever collapses UNKNOWN→ABSENT or VALID→COMPLETE.
6. **Do NOT chase the two in-flight programs** (#1742 runner: auto-harvest journal states + T0–T7; the
   CPAP supervisor on the box). They PRODUCE fields this envelope will reference — consume their LANDED
   shapes only; coordinate seams through the lead.

## §1 · WHERE EVERY ACQUISITION FACT ALREADY LIVES (the map — half the deliverable)
Each conceptual field of the contract (spec §2) mapped to its CURRENT home. Nearly all exist; the
envelope references them. "NEW" marks the only genuinely-absent glue.

| Contract field | Current home (module · field/store) | Notes |
|---|---|---|
| `session_id` | `oxy_lifecycle.py` `session_id` · `cpap_record.new_session_id` · spool ledger | distinct from device; §5b run identity |
| `device_id` | `oxy_lifecycle.py` `device_id` · EDF `recording_id` (serial/mid/vid) in `cpap_edf`/`oxyii` · oxyii GET_INFO serial | ring vs machine identity |
| `source` | the capture PATH: O2Ring **live OXYFRAME** vs **stored `.dat`**; CPAP **live-BLE (EdfSink)** vs **SD-card EDF** | §10 keep live/stored distinct |
| `signal` | `cpap_ingest` stream / EDF channel label (`Flow.40ms`…) / O2Ring 3-byte record channels (SpO₂·HR·motion) | |
| `start_time`/`end_time` | Clock Contract `clock.t0Ms` (`DexClock`) · EDF startdate/starttime · `.dat` filename/RTC | floating `tMs`; §7 reuse, no 2nd clock |
| `clock_status` | `DexClock.hostAxis` (`independent`·`spreadMs`·`ppm`·refusal) · `quality.timingSource` (`device+host`/`host`/`none`) · **ring RTC:** `ring_rtc_offset_s`·`ring_rtc_read`·reset-suspect alarm·RTC-history (O2RING-TIME-CAPABILITY-WIRING, ring-clock sidecar) | THE clock authority — reference, never duplicate. An RTC **reset** is a clock_status fact AND a §9 episode boundary. CPAP Phase B carries the symmetric **device-vs-box offset** (GetDateTime / LastTherapyUseDateTime delta, ~21 min measured today). |
| `sample_count` | decoded records: `readEDF` numRecords×spr · `.dat` `(size−58)/3` · live frame count | |
| `expected_sample_count` | O2Ring `.dat` trailer `total_seconds` (oxyii `parse_oxy_trailer`) = **in-artifact DECLARATION** · **independent** expectation = live-observed `duration_s` at close · EDF numDataRecords · else **UNKNOWN** | §8 UNKNOWN never 0. ⚠ DEPENDENCE: the trailer lives INSIDE the artifact, so trailer-as-expected is co-derived with `actual` (same bytes). Prefer the **independently-observed** `duration_s` when the live path saw the close (18311≡18311 cross-check, n=1 exact); trailer is the declaration; their **disagreement is a first-class discrepancy field, never silently reconciled**. **LOCKED field (lead-ratified 2026-08-24, lead relaying to the #1742 runner so §16 uses identical names — the auto-harvest owner spec §16 already names these):** `duration_check: { stored_s, observed_s, source, agrees, delta_s }` where `stored_s` = trailer `total_seconds` (in-artifact declaration), `observed_s` = live-observed `duration_s` at close (independent), `source` = which won the expected slot (`observed` when the live path saw the close, else `stored`), `delta_s = stored_s − observed_s` (sign convention pinned in the schema comment), `agrees = |delta_s| ≤ 1` — the ±1 s tolerance CITED to the ring's duration-counter quantization ([[o2ring-duration-is-quantized]]: the counter is ±1 s quantized, NOT a frame index), never bare exact-equality. Today's 18311≡18311 (delta 0) passes. |
| gap information | `cpap_ingest.GapCounters` + **`FrameKind`** (`FOREIGN`/`MALFORMED` = transport/decode) · BLE dropout gaps | §8's categories ARE FrameKind |
| device_state evidence | `oxy_lifecycle` (OXYLIFE states) · O2Ring `duration_s` advancing/stopped·`contact`·`.dat` trailer · CPAP FGState/therapy/flow/pressure | §9; device code produces, contract stores normalized |
| raw artifact | the `.dat`/`.edf` file · `oxy_inventory` row (`path`,`size`) · `cpap_spool` cursor ledger | |
| artifact hash | `oxy_inventory.sha256_bytes` · `oxy_transfer.verify()` `sha256` | §12 reuse, one hashing system |
| validation status | `oxy_transfer.VALIDATION_DEPTH` (`size+finalised+records`) · `oxy_inventory` `VERIFIED`/`PARTIAL`/`FAILED` | §6 explicit |
| completeness status | `oxy_inventory` `PARTIAL` vs `VERIFIED`/`COMMITTED` · gap accounting · trailer finalised | §6 INDEPENDENT of validation |
| provenance | `oxy_inventory` append-only JSONL · `cpap_spool` cursor ledger · `oxy_lifecycle` journal · `DAT_DISCOVERED→VERIFIED→COMMITTED→DECODED` | §13 immutable transitions |
| **the envelope itself** | **NEW** — a normalized struct assembled from all the above, emitted beside the artifact | the ONLY new persisted thing |

**Reading of the map:** exactly one row is NEW (the envelope struct + its emission). Everything else is
an existing field the assembler reads. This is why the spec insists "keep it small" and "do not
duplicate": the work is a normalizing READ + a versioned emit, not a new subsystem.

## §2 · Architecture map (the boundary)
```
   REAL CAPTURE            ACQUISITION EVIDENCE          DEX            EVENT EVIDENCE     INTEGRATOR
   (device-specific)  →    (this envelope — a       →  (reads the   →  (existing badge → (unchanged)
   oxyii/AS11/cpap_edf     pure assembler over §1,     envelope,       /evidence system,
   produce observations)   emitted = meta.json         not re-        unchanged)
                           generalized, versioned      derives §1)
                           in the ganglior family)
```
- The **assembler** is generic: it contains NO O2Ring/AS11/EDF protocol logic (spec §9). Device capture
  code produces the observations; the assembler normalizes and references them.
- **Emission** = generalize the existing `.meta.json` sidecar (`pull_session` already writes
  `device_summary` from the trailer) into the versioned envelope, beside the artifact.
- **Dex adapter** (Phase C) = the smallest read: a Dex consumes the envelope's already-known facts
  (hash-verified? transport gaps? session id?) instead of reconstructing them (spec §14).

## §3 · Phased plan
- **Phase A — contract + O2Ring `.dat`** (most settled path): define the envelope struct/schema; assemble
  it for a stored `.dat` acquisition from `oxy_inventory` + `parse_oxy_trailer` + `oxy_transfer.verify` +
  `oxy_lifecycle`; emit beside the `.dat`. Execution-witness the harvest path.
- **Phase B — CPAP** (after the box supervisor settles): assemble for the CPAP pipeline (EDF + GapCounters
  + FGState + cpap_spool), consuming the supervisor's landed fields.
- **Phase C — Dex adapters** (smallest reads): one Dex reads the envelope rather than reconstructing.

### Phase B — EXECUTED 2026-08-25 (`acq_evidence_cpap`)

Greened by the lead once the supervisor's persisted shapes landed and stabilised (#1746/#1765/#1770).
Built as a pure ASSEMBLER over stores that already existed, touching none of them:

| envelope fact | consumed from | note |
|---|---|---|
| session / device identity | `cpap_record.RawRecordSink` (host-authored acquisition-run id) | §14 — no second session identity invented |
| artifact | the durable JSONL raw record | **INV9**: the authoritative copy IS the artifact; the `EdfSink` file is DERIVED and rides in `provenance` |
| sample + gap accounting | `cpap_ingest.GapCounters` | kept as forensic CATEGORIES (§8); the untruncated summary rides in `provenance` because `transport_gaps`/`decode_gaps` are a lossy view |
| device state | supervisor `Decision` / FGState | read if present, **UNKNOWN if absent** — an unread supervisor is never "Standby" |
| `duration_check` | `LastTherapyUseDateTime` vs the streamed duration | the CPAP analog of the `.dat` trailer, same vocabulary and sign convention |
| stored path | `cpap_spool` committed ledger | `SOURCE_STORED_SPOOL`, never merged with live (§10) |

**Two sources, never merged** — `assemble_live` and `assemble_spool`, mirroring §10's live-vs-stored rule.

**Wired on the production path**: `cpap_stream.stream_to_bus` emits the envelope AFTER the sinks close
(the raw record's clean close is the validation input) and does so in the `finally`, so an interrupted
night gets one too — that is when acquisition evidence matters most. `capture.py` lands it as a
`<raw-record>.meta.json` sidecar, the same shape and placement the O2Ring `.dat` path uses, so ONE
reader handles both devices.

**Three defects caught during the build, all of the examined-nothing family:**
1. `stopped_cleanly` was initially passed as a literal `True`. The `finally` also runs on a dropped
   link, so it would have FABRICATED a clean stop on exactly the interrupted nights the envelope
   exists to describe. Now observed via a `clean` flag the batch loop only reaches by ending normally.
2. The EDF path was read via `final_path`, which `EdfSink` does not have — so the provenance field
   would have been silently `None` forever. The public accessor is `path`.
3. `RawRecordSink._CLOSED` is ALSO the never-opened state, so `acq_facts` reported a clean close for a
   record that was never written — which the envelope reads as VALID. Fixed with an explicit
   `_ever_opened` flag.

**`assemble_spool` has no production caller yet** — the spool DRIVER (`cpap_spool.sync_spool`) is itself
still standalone pending its daemon wiring (P4 brief §7). It is a tested assembler over a real committed
store, not an execution-witnessed path, and is recorded as such rather than counted as wired.

## §4 · Execution-witness specimens (§18) + UNKNOWN/VALID controls (§0.5)
- **#1742 never-armed trigger** and the **unwired G1 cluster** are the two live proofs that "a helper ran"
  ≠ "the production path executed." Phase A's harvest witness must assert ARMED→TRIGGERED→SIDE EFFECT→
  ARTIFACT→ACQUISITION EVIDENCE end to end, not just that the assembler function returns a struct.
- **Discrepancy field — RESOLVED (lead-ratified 2026-08-24):** `duration_check: { stored_s, observed_s,
  source, agrees, delta_s }`, `delta_s = stored_s − observed_s`, `agrees = |delta_s| ≤ 1` (±1 s cited to
  the ring-counter quantization). The vocabulary is the auto-harvest owner spec §16's verbatim
  (`stored`/`observed`), and the lead is relaying the locked shape to the #1742 runner so both briefs use
  ONE word for the one comparison.
- **Planted controls:** one test that reds if the envelope ever maps a missing `expected_sample_count`
  to 0 (UNKNOWN→ABSENT), and one that reds if a `PARTIAL` acquisition ever reports `COMPLETE`
  (VALID→COMPLETE). Held to the control per pre-state-the-threshold.

## Done when
- [ ] The §1 map is ratified by the lead as the authoritative acquisition-fact inventory.
- [ ] One canonical envelope struct exists (assembler over §1), versioned in the `ganglior` family, MINOR bump.
- [x] O2Ring `.dat` (Phase A) produces it; **CPAP (Phase B) produces it (2026-08-25)**; a Dex adapter
      (Phase C, OxyDex read-only panel) landed #1752. Phase B's live path is execution-witnessed through
      the real pump; its spool assembler is tested but not yet wired (see the Phase B note above).
- [ ] All spec §21 acceptance boxes met; execution-witness + UNKNOWN/VALID planted controls green; existing tests stay green.

---

## Spec (owner-issued, VERBATIM)

    TEPNA — IMPLEMENT ACQUISITION EVIDENCE CONTRACT
    ================================================
    (owner-issued spec, pasted verbatim into the lead session 2026-08-24 evening)
    
    OBJECTIVE
    ---------
    
    Implement a small, canonical Acquisition Evidence Contract for Tepna.
    
    The purpose is to formalize what Tepna knows about the INTEGRITY,
    COMPLETENESS, TIMING, and PROVENANCE of acquired data before that data
    is interpreted by a Dex.
    
    This is an ACQUISITION layer.
    
    It is NOT:
    
    - a new scientific evidence system;
    - a replacement for existing Dex logic;
    - a replacement for the Integrator;
    - a new session-management system;
    - a new provenance system;
    - a new test framework;
    - a redesign of Synthetic Goldens.
    
    Keep the implementation small and reuse existing Tepna architecture.
    
    ================================================
    1. READ CURRENT TEPNA CODE FIRST
    ================================================
    
    Inspect the current HEAD in detail.
    
    Find and understand the existing implementations for:
    
    - capture sessions
    - device identity
    - session identity
    - timestamps
    - Clock Contract
    - sample counting
    - gap detection
    - BLE transport gaps
    - decode gaps
    - raw artifacts
    - `.dat` files
    - SHA-256/hash verification
    - atomic artifact commit
    - lifecycle/provenance journal
    - O2Ring capture
    - O2Ring `.dat` acquisition
    - CPAP capture
    - existing evidence classifications
    - Dex input contracts.
    
    Do not create duplicate representations where Tepna already has a
    correct implementation.
    
    The first task is to map existing information into one coherent
    acquisition contract.
    
    ================================================
    2. CORE CONTRACT
    ================================================
    
    Create a canonical AcquisitionEvidence representation.
    
    Conceptually it should contain:
    
        session_id
        device_id
        source
        signal
    
        start_time
        end_time
    
        clock_status
    
        sample_count
        expected_sample_count
    
        gap information
    
        device_state evidence
    
        raw artifact information
    
        artifact hash
    
        validation status
        completeness status
    
        provenance
    
    The exact field names and types MUST follow existing Tepna conventions
    where those already exist.
    
    Do not blindly implement this conceptual list as new fields if Tepna
    already represents the information elsewhere.
    
    ================================================
    3. WHAT THIS CONTRACT MEANS
    ================================================
    
    The contract answers:
    
        "What do we know about the acquisition itself?"
    
    Examples:
    
    - Was the data actually received?
    - How many samples were received?
    - Were gaps observed?
    - Are those gaps transport or decode gaps?
    - Is timing trustworthy?
    - Is the raw artifact intact?
    - Was the artifact cryptographically verified?
    - Is the acquisition complete or partial?
    - What device/session produced it?
    - What evidence establishes the device state?
    
    It does NOT answer:
    
        "Is this physiological event real?"
    
    That remains the responsibility of the existing Dex/evidence system.
    
    ================================================
    4. KEEP ACQUISITION AND SCIENCE SEPARATE
    ================================================
    
    Do not change Tepna's existing scientific evidence rules.
    
    If the project already distinguishes:
    
        MEASURED
        ESTABLISHED
        HEURISTIC
    
    preserve those semantics exactly.
    
    Acquisition integrity and physiological evidence are independent
    dimensions.
    
    For example:
    
        Acquisition:
            VALID
            PARTIAL
            CLOCK_UNCERTAIN
    
        Event:
            MEASURED
    
    is perfectly valid.
    
    Do not make acquisition quality automatically modify event confidence
    unless an existing Tepna rule explicitly requires it.
    
    ================================================
    5. UNKNOWN MUST REMAIN UNKNOWN
    ================================================
    
    This is a fundamental requirement.
    
    Do NOT convert missing information into a negative conclusion.
    
    Examples:
    
        clock unavailable ≠ clock invalid
        device state not observed ≠ device not recording
        expected sample count unavailable ≠ zero expected samples
        artifact unavailable ≠ artifact does not exist
    
    Represent uncertainty explicitly using existing Tepna terminology.
    
    ================================================
    6. VALIDATION ≠ COMPLETENESS
    ================================================
    
    These must remain independent.
    
    Examples:
    
        VALID + COMPLETE
        VALID + PARTIAL
        INVALID + PARTIAL
        UNKNOWN + UNKNOWN
    
    A `.dat` can be perfectly valid while representing only a partial
    acquisition.
    
    A complete-looking acquisition can still fail artifact validation.
    
    Do not collapse everything into a single quality score.
    
    ================================================
    7. TIME PROVENANCE
    ================================================
    
    Reuse the existing Tepna Clock Contract.
    
    Do NOT create a second clock model.
    
    Preserve the distinction between:
    
    - device time
    - host observation time
    - synchronized time
    - analysis time
    - uncertain/unavailable time.
    
    Do not silently replace device/sample timestamps with host wall-clock
    timestamps.
    
    The Acquisition Evidence Contract should reference the existing clock
    authority/status.
    
    ================================================
    8. SAMPLE AND GAP ACCOUNTING
    ================================================
    
    Where the source supports it, preserve:
    
        actual sample count
        expected sample count
        missing samples
        transport gaps
        decode gaps.
    
    Do not reduce all of this to a percentage.
    
    The purpose is forensic reproducibility.
    
    A downstream component should be able to determine WHY acquisition is
    incomplete.
    
    If expected sample count cannot legitimately be determined:
    
        UNKNOWN
    
    not:
    
        0.
    
    ================================================
    9. DEVICE-STATE EVIDENCE
    ================================================
    
    Allow acquisition evidence to record observations that establish device
    state.
    
    Examples:
    
    O2Ring:
    
        duration_s advancing
        duration_s stopped/reset
        not-worn observation
        recording-end observation
        `.dat` trailer confirmation
    
    CPAP:
    
        FGState
        therapy event
        flow evidence
        pressure evidence
    
    The generic contract must NOT contain O2Ring or AS11 protocol logic.
    
    Device-specific capture code produces the observations.
    
    The contract stores them in a normalized way.
    
    ================================================
    10. O2RING
    ================================================
    
    Integrate the contract with BOTH existing O2Ring acquisition paths:
    
        live OXYFRAME capture
    
    and:
    
        stored `.dat` acquisition.
    
    Do not merge these into one indistinguishable source.
    
    Preserve provenance such as:
    
        live BLE
        stored device recording
        `.dat` artifact
        decoded records.
    
    Recording state and artifact availability must remain separate.
    
    For example:
    
        RECORDING_ENDED + DAT_NOT_YET_AVAILABLE is a valid state.
        DAT_AVAILABLE + RECORDING_END_NOT_OBSERVED is valid.
    
    ================================================
    11. CPAP
    ================================================
    
    Integrate the contract with the existing CPAP acquisition pipeline.
    
    Preserve:
    
    - device identity
    - session identity
    - stream/source identity
    - timestamps
    - sample counts
    - gaps
    - clock status
    - raw artifact provenance
    - validation
    - completeness.
    
    Do NOT change CPAP scientific/event definitions.
    
    Do NOT redesign the existing FGState work.
    
    ================================================
    12. RAW ARTIFACT PROVENANCE
    ================================================
    
    A durable raw artifact must be traceable through:
    
        device → session → acquisition source → raw artifact →
        content hash → validation → analysis
    
    Reuse existing Tepna artifact and hashing mechanisms.
    
    Do NOT implement another hashing system.
    
    The contract should reference the canonical artifact identity rather than
    creating a competing one.
    
    ================================================
    13. IMMUTABILITY / HISTORY
    ================================================
    
    Do not silently rewrite historical acquisition facts.
    
    Important transitions should remain observable through existing Tepna
    lifecycle/provenance mechanisms.
    
    For example:
    
        DAT_DISCOVERED → DAT_VERIFIED → DAT_COMMITTED → DAT_DECODED
    
    If new information becomes available, represent the new state/provenance
    according to existing Tepna conventions.
    
    ================================================
    14. DEX BOUNDARY
    ================================================
    
    The intended architectural boundary is:
    
        CAPTURE → ACQUISITION EVIDENCE → DEX → EVENT EVIDENCE → INTEGRATOR
    
    Dexes should not independently reconstruct acquisition facts that are
    already known by the capture layer.
    
    Examples:
    
    A Dex should not independently determine whether a raw artifact's hash
    was verified.
    
    A Dex should not independently reconstruct transport-gap accounting.
    
    A Dex should not invent a second session identity.
    
    However:
    
    DO NOT rewrite existing Dex algorithms merely to adopt the contract.
    
    Make the smallest integration necessary.
    
    ================================================
    15. INTEGRATOR
    ================================================
    
    Do not change current Integrator scientific rules.
    
    The contract should simply make acquisition integrity available so that
    future logic can distinguish:
    
        "two sensors disagree"
    
    from:
    
        "one sensor has incomplete/uncertain acquisition."
    
    Do not automatically alter Integrator confidence calculations.
    
    ================================================
    16. SYNTHETIC GOLDENS
    ================================================
    
    DO NOT make Synthetic Goldens a centerpiece of this implementation.
    
    Do NOT redesign the golden system.
    
    Do NOT make production architecture depend on synthetic fixtures.
    
    First implement the contract against REAL Tepna acquisition.
    
    After the contract is stable, inspect whether the existing Synthetic
    Golden infrastructure can naturally exercise it.
    
    If useful, add only minimal test coverage.
    
    The golden system is a TEST CONSUMER of the contract, not the definition
    of the contract.
    
    ================================================
    17. TESTING
    ================================================
    
    Add focused tests for:
    
    1. complete valid acquisition
    2. partial acquisition
    3. transport gap
    4. decode gap
    5. unavailable clock
    6. valid artifact
    7. invalid artifact
    8. hash mismatch
    9. missing artifact
    10. duplicate session
    11. interrupted acquisition
    12. interrupted transfer
    13. O2Ring live capture
    14. O2Ring `.dat`
    15. CPAP capture
    16. restart/recovery where applicable.
    
    Tests must explicitly verify:
    
        UNKNOWN ≠ ABSENT
        VALID ≠ COMPLETE
        acquisition integrity ≠ physiological evidence.
    
    ================================================
    18. EXECUTION-WITNESS TESTING
    ================================================
    
    Do not rely only on unit coverage.
    
    For important acquisition paths, verify actual execution:
    
        ARMED → TRIGGERED → SIDE EFFECT → ARTIFACT → ACQUISITION EVIDENCE
    
    This is particularly important for:
    
    - O2Ring automatic `.dat` harvesting
    - transactional pulls
    - CPAP capture
    - recovery paths.
    
    A test that merely exercises helper functions is not proof that the
    production path executes.
    
    ================================================
    19. BACKWARD COMPATIBILITY
    ================================================
    
    Do not break existing captures.
    
    Do not force a wholesale migration if existing representations can be
    adapted.
    
    Prefer adapters at existing boundaries.
    
    Existing O2Ring, CPAP, ECG, PPG, and Integrator functionality must
    continue to operate.
    
    ================================================
    20. NO SCIENTIFIC CHANGES
    ================================================
    
    This task MUST NOT change:
    
    - ODI thresholds
    - desaturation definitions
    - PPG beat detection
    - HR algorithms
    - CPAP event definitions
    - ECG interpretation
    - existing evidence classifications
    - clinical interpretation.
    
    If the new contract exposes an existing scientific problem, document it
    separately.
    
    Do not silently fix unrelated science during this implementation.
    
    ================================================
    21. ACCEPTANCE CRITERIA
    ================================================
    
    [ ] One canonical Acquisition Evidence representation exists.
    [ ] Existing Tepna contracts are reused where appropriate.
    [ ] O2Ring live acquisition can produce it.
    [ ] O2Ring `.dat` acquisition can produce it.
    [ ] CPAP acquisition can produce it.
    [ ] Session identity is preserved.
    [ ] Device identity is preserved.
    [ ] Time provenance is preserved.
    [ ] Sample accounting is preserved.
    [ ] Gap categories are preserved.
    [ ] Artifact identity is preserved.
    [ ] Hash identity is preserved.
    [ ] Validation is explicit.
    [ ] Completeness is explicit.
    [ ] UNKNOWN is not converted into ABSENT.
    [ ] VALID is not treated as COMPLETE.
    [ ] Acquisition integrity remains separate from scientific evidence.
    [ ] Existing Dex scientific logic remains unchanged.
    [ ] Existing Integrator logic remains unchanged.
    [ ] Existing production capture continues to work.
    [ ] Important acquisition paths have execution-witness tests.
    [ ] Existing tests remain green.
    [ ] Synthetic Goldens remain independent and continue to work.
    
    ================================================
    22. FINAL DESIGN PRINCIPLE
    ================================================
    
    Keep this SMALL.
    
    The Acquisition Evidence Contract should feel like a standardized
    metadata/provenance envelope around existing Tepna acquisition data:
    
        REAL CAPTURE → ACQUISITION EVIDENCE → DEX → EVENT EVIDENCE → INTEGRATOR
    
    The contract formalizes facts Tepna already knows.
    
    It should NOT become another abstraction layer that duplicates existing
    logic.
    
    Most importantly:
    
    BUILD THIS FOR REAL TEPNA ACQUISITION FIRST.
    
    If Synthetic Goldens can naturally test it afterward, use them.
    
    Do not build production architecture around the test fixtures.
