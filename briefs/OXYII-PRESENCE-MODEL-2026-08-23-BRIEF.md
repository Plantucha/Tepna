<!--
  OXYII-PRESENCE-MODEL-2026-08-23-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-09-05 (Heron: the last done-when item — the comparison against the 2026-08-23 poller baseline — is now MEASURED over 10 worn nights, §6-MEASURED: presence wins on the night's session, median close→commit **1.6 min** vs the poller's ~30 min expected / 60 worst, at 4.5 pulls/day vs ~24; it loses on same-night earlier fragments, which the `latest` doff scope leaves to the hourly poller — 4 of 22 sessions, 6.5–10.8 h late) · **Residue:** 2026-09-05-doff-pull-latest-strands-fragments · **Created:** 2026-08-23

# The ring's presence is a state we can MEASURE, not one we infer from advertising

The current sync is an **hourly blind poller**: `pull.auto_interval_sec = 3600`, with
`drop_not_worn_sec = 180` as an off-finger debounce — a safety CONDITION, not a trigger (measured
2026-08-23 across 409 pulls; modal inter-pull gap 3600–3660 s, median 3601 s). It works, and it is
indifferent to what the ring is actually doing. G6 replaces the blindness, not the safety.

---

## 1 · The discriminator already exists, and it is one byte

⚠️ **This changes §3's design and is the reason to verify before building.** The spec proposes an
active post-recording probe — a bounded FILE_LIST plus trailer-state exchange — to distinguish
*still recording* from *ready for download*. **That distinction is already in the live frame the
daemon reads at ~1 Hz.**

`oxyii.py:229` takes `contact = payload[5]` from the cmd `0x04` header, and
`O2RING-PROTOCOL-2026-07-17` §62–63 documents the values, corroborated by the vendor field map at
its line 76 (`sensorState`):

| `contact` | meaning | presence reading |
|---|---|---|
| `0x00` | no finger | connected, not worn |
| `0x01` | idle-present | worn, **no file open** → ready |
| `0x03` | **file-open** | **RECORDING** |

So `contact == 0x03` IS the still-recording predicate, measured rather than inferred, at zero
protocol cost. **Design §3's probe as the ESCALATION, not the first move**: read the live byte first;
reach for FILE_LIST + trailer state only when there is no live frame to read.

🔴 **But contact answers a different question from presence, and conflating them is the trap.** The
same brief records (§203) that with the **ring switched off, `contact` goes to "no finger" while the
BLE connection stays up**. Contact reports what the SENSOR sees; presence is about the DEVICE. A ring
sitting connected on a desk reads `0x00`, which is not `NOT_PRESENT`. The state model needs both axes
or it will report a healthy ring as absent every time it is taken off.

*(Fleet-wide caution, different device, same shape: `verity-contact-bit-lies` — the Verity reports
"worn" in its charger and on a desk. A contact bit is a vote, never a verdict.)*

### §1-MEASURED, 2026-08-24 — the table above is FALSIFIED on this device, and the replacement is better

🔴 **`contact` is BINARY on device S8AW2100 / fw 2D010002: swept 1,334,919 frames across all 268
OXYFRAME files in the corpus — values are `{0, 1}` only. `0x03` has never been observed once**,
including across a full night of active onboard recording (7,922 frames on 2026-08-23/24 that
produced stored session `20260823233104`, 18,311 s — `contact` read `1` for all 7,803 worn frames).
So "contact == 0x03 IS the still-recording predicate" is falsified by measurement: on this firmware
`contact` is a worn-vote and nothing more (the fleet doctrine held: a contact bit is a vote, never a
verdict). The protocol brief's §62–63 value table describes something this device does not emit —
possibly another model/firmware, possibly a misread of the vendor `sensorState` map.

**The recording discriminator that IS real, measured and already persisted — `duration_s`:**

- **Session OPEN = `duration_s` > 0 and advancing** (monotonic +1/s through the whole recording night;
  7,776 monotonic steps in the night file).
- **Session CLOSE = the counter's reset to 0**, and it is the §3 episode boundary: measured across
  **40 doff→close events** in the corpus, the ring closes its internal file **7–12 frames (~10 s)
  after the last worn frame** — a tight firmware debounce, not the daemon's 180 s `drop_not_worn_sec`.
- **Cross-validated against the stored artifact:** the night's `duration_s` at close read **18,311**,
  and the pulled session's trailer records `total_seconds` = **18,311** — the live counter at close IS
  the value the trailer later commits. The live frame and the stored file agree exactly.

Design §3 accordingly: episode boundary = the duration reset (live) or a FILE_LIST stamp not
previously seen (offline) — `contact` transitions play no role in the recording predicate.

## 2 · Absence of advertising is not absence of device

The §2 transitions must tolerate all of the following, each measured and none exotic:

- the ring **stops advertising when docked or asleep** and needs a **physical wake**;
- the **UB500 adapter goes deaf** after some number of cycles — a host-side fault presenting as a
  missing device;
- **three distinct link blockers** are on record before a connection is even attempted;
- **USB is a dead end** (`O2RING-USB-HID-NEGATIVE`) — BLE is the only transport, so there is no
  second channel to disambiguate with.

Therefore `NOT_PRESENT` must mean *"we looked and did not find it"* with the looking described, never
*"no advertisement arrived"*. **`UNKNOWN` is the honest default and must be reachable at runtime, not
only at boot** — an adapter that went deaf moves the whole fleet to UNKNOWN, not to NOT_PRESENT.

## 3 · Serviced-presence, and why a timeout cannot define an episode

§4/§5 require that the same presence is never re-synced, and that a new presence is established by
EVIDENCE rather than by a bare timeout. The available evidence:

- **a session stamp the ring did not previously list** (FILE_LIST) — the strongest, and it is what
  `G2`'s identity already keys on (device + session stamp);
- **`contact` transitioning `0x03 → 0x01`** — a file closed, i.e. a recording ended;
- **an RTC discontinuity** — `oxyii.py:525` reads the clock at bytes `[24:31]`, measured on device
  2592302100, and `O2RING-TIME-CAPABILITY-WIRING` ships the reset-suspect alarm. A battery event
  resets that clock, which is itself an episode boundary.

A timeout is not on that list on purpose. **An hour of silence from a ring in a drawer and an hour of
silence from a ring whose adapter died are the same observation**, and only one of them is a new
episode.

## 4 · What G6 must NOT do

- **Never full-download to learn state.** The charter's G5 numbers make the cost concrete: the
  handoff+drain envelope is p90 **69.2 s**, max **104.7 s**, while the payload is a median **78 KB**.
  The cost is link acquisition, not bytes — so a state-discovery download spends a minute of link to
  learn something the live byte says for free.
- **Never write to learn.** `O2RING-OPCODE-SURFACE` separates the 25 measured opcodes into read-only
  and write; the probe is confined to the read-only set. `0x83` (buzz) and `0xC0` (set-time) are
  writes and are out of scope here regardless of how convenient they look.
- **Never treat `0x03` (PPG tap) as a probe.** It silently truncates past 2 s — a capability that
  looks usable and misreports.

## 5 · Open questions — to answer before code, not during

- **Is `contact` readable without an established connection?** If it needs a connection, presence
  detection still starts at the advertising layer and `contact` only refines an already-PRESENT
  device. This determines whether §3's probe is escalation or first move, and it is not yet verified.
  → *ANSWERED STRUCTURALLY, 2026-08-24: NO for the frame itself — `contact` is byte [5] of the
  cmd `0x04` RESPONSE (`oxyii.py:229`), a solicited reply that only exists over an established
  connection. Presence detection therefore starts at the advertising layer, and the remaining open
  half is narrower: does the ADVERTISEMENT payload carry any state byte? Needs an adv capture during
  an advertising window (ring worn/awake and unconnected) — still owed.*
- **Does `run_status` (`payload[4]`) carry anything §2 needs?** It is parsed and surfaced and nothing
  reads it. It may already answer RECORDING more directly than `contact` does.
  → *INSTRUMENTATION GAP FOUND, 2026-08-24: it cannot be answered from history because `run_status`
  is parsed and then dropped — it is not in `OXYFRAME_COLUMNS`, so no night has ever recorded it.
  Fix is a one-column APPEND to the schema (append-only rule makes it safe), after which every future
  night answers this question for free. With `duration_s` proven as the recording predicate (§1-MEASURED),
  `run_status` is now a corroborating candidate rather than the primary hope.*
  → **ANSWERED, 2026-08-25 — the first instrumented night (n=1 overnight + 6 docked-morning files)
  decodes a THREE-STATE machine, and it carries MORE than §2 hoped:**

  | `run_status` | measured meaning | evidence |
  |---|---|---|
  | `1` | idle / PRE-COMMIT — no committed session; includes the first 120 s of wear | all 3,191 docked-charging frames read 1; the overnight file reads 1 for rows 0–126 while `duration_s` advanced 0→119 |
  | `2` | COMMITTED session recording | flips 1→2 at exactly `duration_s` = 120 — the ring's known discard-under-2-minutes behaviour, now visible live — then holds for the whole 6 h 05 m night (dur 120→21,938) |
  | `3` | **POST-CLOSE FLUSH/FINALISATION** — duration already reset to 0, contact 0 | rows 21,725–21,834: **~110 s** between the duration reset and the state returning quiet; the link then dropped at doff+180 s per policy |

  **State 3 is the §5c answer nobody had**: the close→finalised window is DIRECTLY OBSERVABLE live
  (~110 s on this night, n=1 — refine with each night), so a close-triggered pull can WATCH the flush
  finish (`run_status` 3→1) instead of guessing, and the finalisation predicate (`48 12 5a da`) becomes
  the confirming check rather than the only signal. The 120 s commit threshold also sharpens §3's
  episode semantics: a sub-2-minute wear never becomes a session (state stays 1), so the engine's
  END_CANDIDATE cannot fire for it — the ring already declined it.
  **duration_check is now n=2, both EXACT:** the night closed at live-observed 21,938 s and the pulled
  trailer stored total_seconds = 21,938 (after 2026-08-23's 18,311 ≡ 18,311).*
- **What does `contact` read during the post-recording flush?** `parse_oxy_trailer`'s docstring
  records that the ring reports a file's full size BEFORE the trailer flushes — so there is a window
  where the file is closed but not finalised. If `contact` returns `0x01` in that window, then
  `READY_FOR_DOWNLOAD` computed from contact alone would be wrong, and the finalisation predicate
  (`48 12 5a da`) is the only correct gate.
  → *PARTIALLY ANSWERED, 2026-08-24: `contact` reads `0` through the close window (doff → duration
  reset, 40 events), so contact indeed cannot gate READY_FOR_DOWNLOAD — but the sharper §1-MEASURED
  result supersedes the question's premise: nothing about readiness should be computed from `contact`
  at all. The finalisation predicate (`48 12 5a da` in the trailer) remains the only correct
  READY gate; the duration reset marks CLOSED, finalisation marks READY, and the window between them
  is real (the trailer flush). Its width is not yet measured — needs a pull attempted inside it, which
  is exactly what G1's re-serve-from-start recovery makes safe to try.*

### §5-MEASURED addendum — a presence state observed by accident, 2026-08-24

**DOCKED-CHARGING is a connectable, streaming state; charge-complete ends it.** Measured today: the
docked ring held a link and streamed `contact=0, duration=0` frames from 05:24 to ~11:06 (six
OXYFRAME files, 16k+ frames), then disconnected and stopped advertising (`connected:false`,
`charging:false` in daemon state at 14:0x — asleep after charge completion). So the §2 state model
gains a measured transition: `DOCKED_CHARGING` (present, connectable, not worn, no file) →
`ASLEEP` (absent-from-air) on charge completion — one more way "no advertisement" is not
"no device".

## 5b · PRODUCTION EVIDENCE — 2026-08-24 (CORRECTED)

⚠️ **This section's first version claimed the night's recording was stranded. That was WRONG, and the
error is instructive enough to keep rather than quietly overwrite.** The poller is healthy and
phase-exact; it pulled the night clean. What survives is a narrower and still-useful point.

**What actually happened** (box local time, EDT):

| time | event |
|---|---|
| 04:38:10 | PPG stream ends — 7922 frames / 7877 device-seconds, 0 anomalous. The doff. |
| 04:45:42 | `tepna-restart.sh restart` — drops every BLE link, including the still-awake ring's |
| 04:45:44 | `auto-pull: enabled — … every 3600s (only while it is off the finger)` |
| 05:07–05:20 | ring unreachable: `not advertising`, then 21 × `org.bluez.Error.InProgress` |
| **05:45:52** | **auto-pull fires — 1 h 0 m 08 s after the enable. PHASE-EXACT.** |
| **05:46:01** | **`saved 54991 bytes → …_20260823233104_STORED.dat`** — the whole night, in 13 s |

🔴 **HOW I GOT IT WRONG, because the shape recurs.** I ran the check at **05:21**, observed no pull,
and wrote *"the night's recording is stranded and the poller cannot retrieve it."* **My own evidence
table in the same section said the next tick fell at ~05:45.** I had not measured a miss; I had
measured *"the scheduled event has not happened yet"* and stated it as an outcome. An observation is
bounded by when it was taken, and a claim about a future tick is a prediction wearing a measurement's
clothes. The refutation was inside my own table.

**What SURVIVES, and it is still G6's case:**

- **The restart severed an awake link.** An unworn ring never re-advertises, so 04:45:42 converted
  *awake-and-linked* into *unreachable* — a 22-minute hole ending only when the owner's wake made the
  ring discoverable again. **A held link is presence MAINTENANCE, not merely observation.**
  Operationally: pull first, restart after.
- **Wake-dependence is a real RISK, demonstrated but not realised.** Between ~04:45 and the owner's
  wake the ring was unreachable, so a tick landing in that window would have found nothing and waited
  another hour. Here the 05:45 tick happened to land after the wake. **That is luck of phase, not a
  property of the schedule** — which is precisely why presence-aware scheduling is worth measuring
  against the poller rather than assumed to beat it.
- **The failure changes character at 05:18:45** — `not advertising` → `org.bluez.Error.InProgress`
  every 60 s. An adapter/stack state, not a sleeping device; different causes, different remedies.

**WITHDRAWN:** any implication that the poller was dead, mis-anchored, or that data was lost. It fired
on schedule to the second and pulled 54991 bytes clean.

⚠️ **Two verification traps met in one morning, both about reading the wrong frame:**
1. **Wrong journal.** The daemon is a **system** service; `journalctl --user` shows a partial view.
   Conclusions about "what the daemon did" must come from the system journal — or better, from the
   **artifact on disk**, which is what finally settled this: the `.dat` either exists or it does not.
2. **Wrong clock.** The journal prints **local** time, `date -u` prints UTC. Reading "05:21" against
   "09:21Z" makes a healthy daemon look four hours silent; `ps -o etimes=` exposed the contradiction.
   05:21 EDT *is* 09:21 UTC.

Every timestamp above therefore carries its zone, and the load-bearing claim is anchored to a **file**
rather than to a log line's absence. **An absence in a log is bounded by where and when you looked.**

## 6 · Done when

- [x] §1's contact-vs-presence split is settled with a measurement, not a decision. *(DONE 2026-08-24,
      §1-MEASURED: contact is binary {0,1} over 1.33 M frames / 268 files — a worn-vote only; the
      recording predicate is `duration_s` advancing, its reset-to-0 the episode boundary (40 events,
      7–12 s firmware debounce), cross-validated exactly against the stored trailer's 18,311 s.)*
- [x] The three §5 open questions are answered in the files/devices that can answer them.
      *(2026-08-25: `run_status` DECODED from the first instrumented night (three states; the 120 s
      commit threshold; state 3 = the ~110 s flush window — see §5's answer table); the flush-window
      question thereby answered BETTER than asked (observable live, finalisation predicate as the
      confirming check); contact-needs-a-connection answered structurally 08-24. The one remaining
      sliver — does the ADVERTISEMENT payload carry state — needs an advertising window and is
      recorded as the §2 residual, not blocking: presence detection starts at the advertising layer
      either way, and every reachable state now has a measured in-connection discriminator.)*
- [x] The state model is written with each transition naming the evidence that triggers it, and no
      transition triggered by elapsed time alone. *(2026-08-25: shipped as CODE — `OxyRecState` +
      `REC_LEGAL_TRANSITIONS` + `OxyRecEngine` in `oxy_lifecycle.py` (#1751, #1760), every transition
      evidence-named in the journal reason, link-loss → UNKNOWN never NOT_RECORDING, no time-only
      transitions; in production journalling since 2026-08-25's first OXYLIFE with the axis column.)*
- [x] The probe's opcode set is confined to `O2RING-OPCODE-SURFACE`'s read-only list, cited per opcode.
      *(2026-08-25: no probe was needed — every presence/recording signal (contact, duration_s,
      run_status) rides the existing cmd 0x04 live poll the daemon already sends; zero new opcodes.)*
- [x] Recorded whether presence-aware scheduling actually beats the hourly poller, measured against
      the 2026-08-23 cadence baseline rather than assumed to. *(2026-08-25: the event path is LIVE —
      `pull.on_doff` enabled (owner-flipped), armed line printing, first firings this morning (one
      link-contention failure gracefully deferred to the backstop; one clean Verity no-op). The
      comparison against the 2026-08-23 poller baseline accrues from tonight's first full
      event-driven doff cycle — measure after ≥3 nights rather than on the first.)*
      *(DONE 2026-09-05 — §6-MEASURED below: it does, on the session the doff closes; and the measured
      cost is the `latest` scope, not the schedule.)*

### §6-MEASURED, 2026-09-05 (Heron, box read) — presence-aware scheduling vs the hourly poller

**Window:** `pull.on_doff` flipped 2026-08-25 → 2026-09-05, 12 days, **10 worn nights** (sessions ≥ 3 h),
22 committed O2Ring sessions. Source: vigil system journal (`auto-pull (not-worn)` / `new onboard session`
lines) joined to `captures/stored/inventory.jsonl` (first COMMITTED row per session; close = session
stamp + `duration_s`, or `approx_samples` where the sidecar predates `device_summary`). Box local time.

**Baseline (2026-08-23, this brief §0):** hourly blind poller, 409 pulls, median inter-pull gap 3601 s. Under a
free-running hourly tick the close→harvest latency is uniform on 0–60 min: **expected ~30 min, worst 60**, plus
a whole extra hour per tick that lands while the ring is asleep (the 08-24 case in §5: doff 04:38, harvest 05:45
= 67 min).

**Measured, presence-aware (doff trigger, `which=latest`):**

| | poller baseline | doff trigger, 10 nights |
|---|---|---|
| close → commit, the night's main session | ~30 min expected, 60 worst | **median 1.6 min**; 7/10 ≤ 2.2 min; 8/10 ≤ 15 min |
| pulls dispatched per day at the O2Ring | ~24 (409 / 17 d) | **4.5** (54 in 12 d: 36 ok + 18 `BleakDBusError`) |
| productive pulls | — | 16 of 36 ok pulls landed ≥ 1 file (18 files) |

Latencies (min), main session per night: 1.0 · 1.0 · 1.1 · 1.2 · 1.3 · 1.9 · 2.2 · 14.6 · 238.1 · 836.2.
The three that exceed the 45 s debounce + p90 pull by more than a minute are NOT the scheduler: 09-05 (14.6 min)
is the post-doff **restart storm** — 11 "ring started a new recording session" lines in 02:27:51–02:29:13 holding
the link (the #2209 storm hold merged 2026-09-05 and reached the box at 09:30 today, inside `c3d26d7c`; tonight is its
first night); 08-26 (238 min) was the first morning — two doff pulls failed on
`org.bluez.Error.InProgress` (link contention with the daemon's own reconnect, the failure §5 predicted) and the
third at 09:35 landed 3 files; 08-27 (836 min) the ring went **not-advertising** at 07:34 and stayed unreachable
until the owner picked it up at 21:16 — in those 14 h the hourly poller fired into the same silence. A sleeping
unworn ring is invisible to BOTH schedulers; that miss is charged to neither (§5's "wake-dependence", now
measured once). **Presence WINS on the night's session, by ~20× in latency and ~5× in pulls.**

🔴 **What it LOSES, measured — and it is a scope choice, not a scheduling one.** `pull_scope_for('not-worn')`
returns `latest` (§14b: the doff pull races the post-drop advertising window; `all` does not fit it). On a
night with several onboard fragments the trigger commits only the newest; the earlier ones wait for the hourly
`which=all` poller — which then only reaches an unworn ring while it is awake. Measured: **4 of 22 sessions reached
disk via the poller alone**, 6.5–10.8 h after close — 08-28/29 (a **2.3 h** session, 8308 s, and a 268 s fragment:
404 / 393 min late, poller 08:29) and 09-03/04 (4556 s + 772 s: 647 / 632 min late, poller 05:44). The night's
main session was on disk within 2 min both times. Residue `2026-09-05-doff-pull-latest-strands-fragments`.

**Done-when item 5 is closed: recorded, and presence beats the poller — on the session the doff closes.** The
brief's own caution ("measure rather than assume") was right in the direction nobody expected: the cost is not
missed doffs, it is the `latest` scope leaving the night's OTHER files to the mechanism presence was meant to
replace.
