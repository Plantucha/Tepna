<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-09-01 (verified: the charter's required output — the §19 17-part report + ONE named architecture — exists as the superseding REPORT brief, which also says honestly that it was written AFTER the implementation it was meant to gate; the architecture it names is built and running in shadow on the box. The living content is the REPORT's; nothing here remains executable) · **Created:** 2026-08-24 · **Superseded-by:** `AS11-SESSION-DETECTION-REPORT-2026-08-26-BRIEF.md` · **Follows:** `AS11-AUTO-SESSION-DETECTION-2026-08-24-BRIEF.md`

# AS11 automatic session detection — FINAL protocol investigation before implementation (owner charter)

The owner's charter for the last deep AS11 BLE-protocol investigation to run **before** the
`CPAPSessionSupervisor` is built. It deepens the #1736 matrix: not "what is the easiest way to automate
the button", but **"what is the strongest state information the AirSense 11 itself exposes, and what is
the minimum BLE interaction required to observe it reliably?"** The full charter is captured verbatim in
the appendix; this brief holds the objective, the standing evidence, the investigation agenda, the
execution plan, and — as it is executed — the findings and the single recommended architecture.

## Hard principles (non-negotiable, from the charter)
- **Clean-room.** External AS11 projects (e.g. AirCANnect) are used ONLY to discover what the *device*
  exposes — as a source of questions to verify against the real protocol. **Never copy source code.**
  Re-implement all behavior independently inside Tepna.
- **Do not infer behavior from names.** A DataItem named "state" is not evidence it represents therapy
  state — test it.
- **Do not modify the Clock Contract** as part of this work; the ~21-min time discrepancy is a SEPARATE
  finding (see `AS11-AUTO-SESSION-DETECTION` §clock + task #18).
- **Do not change unrelated CPAPDex science.** The live stream stays the authoritative high-res path.
- **Read the CURRENT code first** — determine exactly what #1736 implemented vs. what is research-only;
  do not assume prior state or duplicate work.
- Every signal classified **MEASURED / ESTABLISHED / HEURISTIC**. Report precedes implementation.

## Standing evidence (established, #1736 — the starting point, not the conclusion)
Advertisements do NOT distinguish idle from active (state-invariant beacon, MEASURED). A short read-only
connect + `Get(MaskPressure)` separates idle (0.6) from active (7.4) strongly (MEASURED); `PatientFlow`
corroborates; `Leak` is readable while treating and `InvalidObject` idle. **No explicit therapy-state
boolean is known** — `TherapyOn`/`Ventilation`/`SessionState`/`Mode` all return `InvalidObject`. A
mask-off self-ramps pressure to ~1 for ~40 s — instantaneously indistinguishable from a stop — so stop
detection needs sustained evidence, not a level (MEASURED, n=1). The connection outlives therapy-stop.
**The charter's job is to test whether MaskPressure polling is actually OPTIMAL, or whether a more direct
AS11 state/event mechanism exists** — SubscribeEvent is the highest-priority unanswered question.

## PHASE A FINDINGS (2026-08-24) — the explicit therapy-state surface #1736 missed
Two parallel passes (current-code read + clean-room public-protocol study) plus a live read-only idle
read on the machine. **Headline: the AS11 exposes an EXPLICIT therapy-state read; #1736's "no explicit
state" was WRONG DataItem NAMES (TherapyOn/Ventilation/SessionState/Mode — all InvalidObject), not a real
absence. The real data model uses `FGState`.**

**Live confirmation (read-only, idle):** `Get(["FGState"]) → "Standby"` — the flow-generator
operating-state enum EXISTS (expect "Therapy" active). `GetVersion` RPC map advertises 20 methods incl.
**`SubscribeEvent 1.0`**, `Get`, `StartStream`, `StartSpool`/`PullSpoolFragments` (fw SW04600.17.8.6.0,
DataModel v2.17.1, serial 23221590541, AirSense 11 AutoSet). Also idle-confirmed: `DeviceControl`
(test-drive subtree), **`MachineMetrics.LastTherapyUseDateTime`** (a session-END marker) +
TherapyRunMeter/MotorRunMeter, `ActiveTherapyProfile` "AutoSet", `ActiveProfiles`
(SmartStartStop/MaskSense enabled), `ConfigurationProfiles.DataDeliveryControlV2`
(UsageEvents/TherapyEvents/Summary/TherapyOneMinutePeriodic all On). `MaskPressure` 0.1, `Leak`
InvalidObject idle (both #1736-consistent). Write methods (`EnterTherapy`/`EnterStandby`/`Set`) are
advertised but **NEVER called** (read-only rule).

**§1 current code:** #1736 is DOCS-ONLY; all AS11 transport/session/StartStream/spool/GetDateTime + the
manual `LiveStreamController.op()` lifecycle pre-exist. SubscribeEvent, any Get-based therapy polling,
device-vs-box clock reconciliation, and the supervisor are GREENFIELD. `get_items` (Get, 0x43) exists
but has no `as11_pull` wrapper/caller — an FGState poller needs only a thin wrapper. The stream loop
discards non-`StreamData` notifications — no event dispatch exists yet.

**§2/§4 SubscribeEvent + explicit state (clean-room, verify-don't-infer):** docs (airbreak-plus lineage;
SomnoTrace GPL = credit only, NEVER code) document `SubscribeEvent` (0x3a) → `EventNotification` with 15
selector families; therapy-relevant: **`UsageEvents-TherapyStatusEvents`** (mask on/off, therapy
start/stop, power transitions — the direct signal) and **`SystemActivityEvents-FrequentActivityEvents`**
(PowerUp/TherapyStarted/StandbyStarted/Warmup/Cooldown/RampDown/blower — independent lifecycle). Subs
belong to the connection; unknown selectors → valid:false; firmware self-throttles (FloodingMitigated).
The historical **event SPOOL** holds the same events — a missed live transition across a reconnect is
likely recoverable.

**§3b/§5/§6/§7 (condensed):** `FGState` (CONFIRMED) is the primary explicit-state read;
`DeviceControl`/`MachineMetrics`/`ActiveProfiles` corroborate. Spools include RespiratoryFlow6p25Hz /
MaskPressure6p25Hz (6.25 Hz — 4× coarser than 25 Hz live), TherapyOneMinutePeriodic, Summary (period
start/end + session count), event spools — so a BLE-interrupted night is BACKFILLABLE to 6.25 Hz + 1-min
+ events (retention depth, during-therapy pull, RC03/Rice decoders, replay-ID = open `[HW]`). EDF: BRP
25 Hz flow/pressure, PLD 0.5 Hz (MaskPressure-TwoSecond authoritative + Leak-as-flow), SA2 1 Hz SpO₂/HR,
STR daily-summary (session MaskOn/Off markers + AHI). Time: GetDateTime readable/**UNSETTABLE** over BLE
(confirmed — SetDateTime is service-access, no BLE VCID); the ~21-min offset is a SEPARATE finding (#18)
— classify by GROWS (RTC drift, likely) vs FIXED (convention). Clock Contract untouched.

**Architecture shift + Phase B:** RATIFIED (Phase B #1 DONE) = primary `Get(["FGState"])` explicit-state
polling ± `SubscribeEvent(UsageEvents-TherapyStatusEvents)` push; MaskPressure/PatientFlow =
corroborators/fallback. The supervisor **FOLLOWS device session semantics** rather than re-deriving them.
- **Phase B #1 (attended 3-min run, 2026-08-24) — CONFIRMED:** `FGState` reads "Therapy" during real
  therapy and the poller tracks start (clean SmartStart) and the mask-off/on/stop transitions live.
  **`MachineMetrics.LastTherapyUseDateTime` is the device's own session-END verdict** — it advanced
  `21:48:55Z → 23:34:36Z` = the attended wall-clock stop **− 21 min** (the device-clock offset), so the
  supervisor closes a session on the device's marker, not on a debounce heuristic. This **eliminates the
  mask-off debounce** for the STOP edge; a short sustained-Standby hysteresis stays only as the fallback
  when the device-verdict read is unavailable, and `MaskPressure` remains the physical corroborator.
- **Phase B #2 (SubscribeEvent latency/labels) — STILL OPEN:** the attended poller used the proven
  `establish → P._send_enc → L.rpc` path; the SubscribeEvent probe crashed on a frame-framing bug (sealed
  raw JSON instead of an FIG-framed RPC — §20). Retest next session: subscribe
  `UsageEvents-TherapyStatusEvents`, measure push latency vs the ~2 s poll, confirm labels, and check
  event/`FGState` stream-independence (§12). Shadow-mode ships on the poll alone; the event rider is an
  additive latency upgrade, not a dependency.

## Feature roadmap beyond session detection (owner-requested 2026-08-24 — "upgrade, not just harden")
The protocol study surfaced capability the detector does not use. Everything below is **read-only,
clean-room, and evidence-tiered** — `[LIVE]` = confirmed on this machine this session; `[DOC]` = read
from public-protocol study, needs a read-only hardware confirm before it ships. **Sequencing: the
detector ships FIRST** (it is the gate that makes the rest event-driven); then Group 1 (reliability),
then Group 2 (novel signals). None of this touches the Clock Contract or CPAPDex science; each capability
is its own gated work-unit.

### Group 1 — Reliability (close the capture gaps the current live-stream leaves)
- **Spool backfill for a BLE-interrupted night `[DOC]`.** The historical spools —
  `RespiratoryFlow6p25Hz` / `MaskPressure6p25Hz` (6.25 Hz), `TherapyOneMinutePeriodic`, `Summary`, and the
  event spools — mean a dropped-link night is **recoverable to 6.25 Hz waveforms + 1-min periodic + events
  + summary** instead of lost. Work-unit: the `RC03`/Rice fragment decoders + `StartSpool`/
  `PullSpoolFragments` replay, plus a retention-depth probe (how far back the device keeps them). This is
  the single biggest reliability win — it converts every capture dropout from data-loss into a gap-fill.
- **Device-clock discipline at ingest `[LIVE]` (answers the RTC question directly).** We do **NOT** set the
  AS11 RTC — `SetDateTime` is service-access with no BLE VCID (unsettable over BLE, confirmed) AND the
  owner confirmed the machine UI won't set it either. "Discipline" = **measure and reconcile**, the same
  philosophy as `DexClock.hostAxis`: read `GetDateTime` at pull, `offset = host − device`, and stamp that
  offset into provenance so CPAPDex re-anchors the EDF `startdate/starttime` (and BLE spool stamps) onto
  the capture-host's disciplined timebase (the box is stratum-1, 0.008 ppm). The offset is **real and
  ~constant at −21 min**: `LastTherapyUseDateTime` = wall-stop − 21 min matched the `GetDateTime` skew
  this session (one clock, one offset) — so a **single** read suffices for the OFFSET, which is all a
  never-set RTC needs (a wrong zero, not a bad crystal). Whether it also **drifts** across a night is the
  open RATE question (#18): needs ≥2 `GetDateTime` reads spanning the session and the ≥3-anchor `hostAxis`
  logic to classify GROWS vs FIXED. The Clock Contract stays untouched — this reconciles at the adapter
  boundary, never by editing `tMs`.

### Group 2 — New live signals (data CPAPDex/the Integrator cannot get from the SD EDF today)
- **Live respiratory events → Ganglior/Integrator fusion `[DOC]`.** `SubscribeEvent
  (UsageEvents-TherapyEvents)` streams apnea/hypopnea/flow-limitation/snore events **as they occur**,
  which — fused on the host timebase with O2Ring desat and Polar HR — is a genuinely novel cross-node
  signal (apnea→desat→arousal chains in real time, not a morning STR summary). Depends on the Phase B #2
  SubscribeEvent rider landing first.
- **Full PLD ventilation metrics `[DOC]`.** The `PLD.edf` / `TherapyOneMinutePeriodic` surface carries
  respiratory rate, tidal volume, minute ventilation, snore index, flow limitation, I:E ratio, and
  inspiratory duration — most not surfaced by CPAPDex today. A CPAPDex parser + registry work-unit (each
  metric evidence-tiered against the device's own values).
- **Per-breath trigger/cycle `[DOC]`.** The `TCV` channel gives breath-by-breath trigger/cycle timing —
  ventilator-synchrony detail below the 1-min periodic. Lower priority; needs a hardware confirm the
  channel is populated on the AutoSet (not just bilevel).

### Group 3 — Authoritative summary & provenance (the device's own verdicts, read cheaply)
- **Machine-scored AHI/indices `[DOC]`.** `STR.edf` / the `Summary` spool carry the device's own AHI and
  per-session indices — an authoritative cross-check for CPAPDex's derived numbers (badge as the device's
  claim, never as ground truth).
- **Device provenance `[LIVE]`.** `GetVersion` + `ActiveTherapyProfile`/`ActiveProfiles` already give
  firmware `SW04600.17.8.6.0`, DataModel v2.17.1, serial, mode (AutoSet), and enabled features
  (SmartStartStop/MaskSense) — stamp into every capture's provenance for free.
- **Usage/compliance `[LIVE]`.** `TherapyRunMeter`/`MotorRunMeter` are monotonic, drift-immune counters —
  a compliance/usage signal that needs no clock at all.

## Investigation agenda (charter §1–§15, condensed — full text in appendix)
1. **Current Tepna** — read as11_pull, cpap_stream, LiveStreamController, the capture supervisor, BLE
   discovery, the AS11 RPC layer, telemetry bus, raw recorder, EDF writer, Clock Contract, CPAPDex, and
   #1736's code/tests. Separate implemented from research-only.
2. **Public AS11 protocol** — RPC/Get/DataItems/SubscribeEvent/streams/spools/status/therapy+session
   values/pressure/flow/leak/device-time/session-identity/EDF signal defs.
3. **SubscribeEvent FIRST (top priority)** — can it subscribe to a DataItem that changes predictably with
   therapy start/stop/standby/blower/session/mask/pressure? For each candidate: identifier, value, type,
   update mechanism + latency, behavior idle/therapy/mask-off/after-stop, persistence across reconnects,
   stream-dependency, resource cost. Test on hardware; do not infer from names.
3b. **Get() systematically** — a candidate table (field · idle · active · mask-off · after-stop · latency
   · reliability · evidence class · recommended use) over MaskPressure, PatientFlow, Leak, and any
   therapy/device/blower/motor/session/mode DataItems discovered from descriptors/schema. Don't stop at
   MaskPressure.
4. **AirCANnect (clean-room, questions only)** — how it gets live status, distinguishes active therapy,
   determines sessions, captures EDF, handles night boundaries / time / reconnects, uses stored data,
   explicit-vs-inferred state. Independently verify each capability against the real protocol.
5. **AS11 EDF signal defs** — compare live-BLE signals vs the machine's EDF; authoritative pressure/flow,
   leak, timestamps, event flags, session boundaries, rates, validity markers. Cross-validation only.
6. **Stored-data / spool** — what's retrievable, whether therapy flow/pressure is included, resolution,
   timestamps, session ids, historical depth, retrieval latency, during-vs-after therapy, fragment
   ordering, duplicate/replay identification. **Backfill of BLE-interrupted periods may be worth more
   than further heuristic refinement** — produce a concrete recommendation (implement only on strong
   evidence). (Ties to task #20 harvest + the existing spool pull.)
7. **Time model** — device clock / BLE / stream / EDF / session / host timestamps; whether AS11 exposes a
   reliable current-time DataItem readable without state change; classify the ~21-min discrepancy (device
   clock vs EDF convention vs timezone vs mapping). Separate finding; Clock Contract untouched.
8. **Connection management (measure)** — frequent short connects, repeated Gets, subscribe-then-disconnect,
   reconnect after start/after stop; connection success rate, avg connect time, query latency, disconnect
   behavior, BLE failures, effect of repeated polling. **The detector must not make BLE less reliable.**
9. **Start architecture** — score A adv-only / B short-connect+Get(MaskPressure) / C +multi-Get / D
   +SubscribeEvent / E persistent low-bw subscription / F full-stream+detection / G combination on
   correctness · FP · FN · latency · BLE cost · CPU · complexity · robustness · evidence · recoverability.
   A is ruled out; B is NOT automatically the winner.
10. **Stop architecture** — explicit event/state vs MaskPressure/Flow/Leak/combinations/sustained-inactivity
   /connection-loss. MUST distinguish THERAPY STOPPED from DEVICE TEMPORARILY UNAVAILABLE; hysteresis;
   derive the minimum safe debounce from real data (the ~40 s is an input, not the final value).
11. **Detector as evidence fusion** — THERAPY_ACTIVE = MaskPressure active + PatientFlow corroboration +
   valid BLE data; THERAPY_STOP_CANDIDATE = sustained low MaskPressure + near-zero flow + valid stream +
   duration. Not a bare pressure threshold unless proven sufficient.
12–15. Connection lifecycle (don't hold the high-rate stream open just to detect start); recovery
   (UNKNOWN device state ≠ therapy stopped, across BLE/host/adapter/Tepna restarts); session model (keep
   DEVICE PRESENCE · BLE CONNECTION · THERAPY STATE · ACQUISITION SESSION · THERAPY SEGMENT · RECORDING
   FILE distinct — a mask-off ≠ new session, a reconnect ≠ new session).

## Required output (charter §16/§19) — ONE recommended architecture + a 17-part report
Report: current architecture · #1736 findings · AS11 capabilities · SubscribeEvent findings · Get/DataItem
findings · AirCANnect behavioral findings · AS11 EDF findings · stored-data findings · time findings ·
connection-cost measurements · candidate-architecture comparison · MEASURED/ESTABLISHED/HEURISTIC
classification · selected architecture · exact state machine · implementation plan · 20-case test plan ·
remaining unknowns. The final decision names ONE architecture with exact mechanism, DataItems/events,
connection lifecycle, start/stop criteria, debounce, mask-off + BLE-loss + shutdown handling, evidence
class, latency, cost, and limitations. Then §17 implementation: `CPAPSessionSupervisor` ABOVE
`LiveStreamController` (supervisor owns discovery/connect/observe/start/stop/reconnect/disconnect; the
controller keeps live-stream/drain/raw/EDF/finalize) — no competing lifecycle owners.

## Execution plan (phasing — this is a multi-phase effort, not one pass)
- **Phase A — desk (no hardware), start now:** §1 read current code (what #1736 shipped vs research-only);
  §2/§5/§6 public AS11 protocol + EDF-signal + spool study; §4 AirCANnect behavioral study (clean-room,
  verify each capability against the protocol). Produces the capability map + the candidate-DataItem list
  + the questions the hardware phase must answer.
- **Phase B — hardware (needs a machine session):** §3 SubscribeEvent test (subscribe to candidate
  DataItems, log every event verbatim + latency across idle/therapy/mask-off/stop — the staged rider,
  task #17); §3b the Get candidate table over a real session; §8 connection-management measurements; §7
  spool retrieval test; §10 the minimum-safe debounce from several natural mask-offs. Runs on the owner's
  natural sessions or an attended window.
- **Phase C — synthesis:** the §19 report + the single §16 architecture decision → owner/Mutator ratify →
  §17/§18 implementation (supervisor + the 20-case test plan), shadow-mode-first per the ratified rollout.

Standing hardware fact: the box is dual-homed (eno1 LAN always up, wlp1s0 Wi-Fi on-demand for the SD
harvest) with three BLE adapters (hci0 daemon, hci1 free for probes, hci2 dead UB500); the AS11 answers
read-only Get on a ~1 s connect via as11_pull's establish→encrypted-Get path.

---

## APPENDIX — owner charter (verbatim intent, §1–§20 + the §19 report structure)

*(Captured from the owner's 2026-08-24 message; the numbered agenda above is the faithful condensation,
and the hard principles + §16 single-decision + §17 supervisor boundary + §18 20-case test list +
§19 17-part report + §20 final principle are reproduced in the agenda and Required-output sections above.
The load-bearing directives — clean-room / verify-don't-infer / SubscribeEvent-first / stop≠disconnect /
UNKNOWN≠stopped / one architecture / report-before-implementation / Clock-Contract-untouched — are
carried into the agenda verbatim in meaning.)*
