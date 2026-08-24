<!--
  OXYII-PRESENCE-MODEL-2026-08-23-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-23 · **Follows:** `OXYII-ACQUISITION-CHARTER-2026-08-23-BRIEF.md` (G6, spec §2–§6) · **Evidence:** `O2RING-PROTOCOL-2026-07-17-BRIEF.md`, `OXYII-PROTOCOL-HARVEST-2026-08-08-BRIEF.md`, `O2RING-OPCODE-SURFACE-2026-08-03-BRIEF.md`, `VIGIL-O2RING-AUTOPULL-2026-07-21-BRIEF.md`, `O2RING-TIME-CAPABILITY-WIRING-2026-08-19-BRIEF.md` · **Affects (brief only — no code):** `capture-host/oxyii.py`, `capture-host/capture.py` (run_oxyii), a new presence module

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
- **Does `run_status` (`payload[4]`) carry anything §2 needs?** It is parsed and surfaced and nothing
  reads it. It may already answer RECORDING more directly than `contact` does.
- **What does `contact` read during the post-recording flush?** `parse_oxy_trailer`'s docstring
  records that the ring reports a file's full size BEFORE the trailer flushes — so there is a window
  where the file is closed but not finalised. If `contact` returns `0x01` in that window, then
  `READY_FOR_DOWNLOAD` computed from contact alone would be wrong, and the finalisation predicate
  (`48 12 5a da`) is the only correct gate.

## 5b · PRODUCTION EVIDENCE — 2026-08-24, verified first-hand on the box

Reported by the capture-host arm and **independently confirmed against `vigil`'s journal**, because a
cross-session claim passes no gate. Timestamps are the box's **local (EDT)**; the verification note at
the end of this section explains why that matters.

| local time | event |
|---|---|
| 04:38:10 | Wellue O2Ring-S PPG stream ends — 7922 frames over 7877 device-seconds, 0 anomalous. The doff. |
| 04:45:42 | `tepna-restart.sh restart` (consolidation) — drops every BLE link, including the ring's |
| 04:45:44 | `auto-pull: enabled — checking … every 3600s (only while it is off the finger)` — **the timer restarts here** |
| 05:07:29 | `BleakDeviceNotFoundError('O2Ring not advertising')` — the ring is gone, ~22 min after the restart |
| 05:18–05:20 | 21 × `org.bluez.Error.InProgress` on the reconnect loop |

🔴 **The night's recording is stranded on flash, and the poller cannot retrieve it.** The ONLY
`auto-pull:` line in the entire day is the 04:45:44 enable — no tick, no transfer, no `.dat`. The next
tick falls at ~05:45, and by 05:07 the ring had already stopped advertising. **Latency is now
wake-dependent, not schedule-dependent**, which is precisely the argument §3 makes for evidence-driven
scheduling — here as a measured production event rather than a hypothesis. (Safe, not lossy: the ring
is FIFO with headroom.)

**A held link IS presence maintenance — and a restart in the doff window costs the window.** The
04:45:42 restart dropped the still-awake ring's link, and **an unworn ring never re-advertises**, so
the restart converted *awake-and-linked* into *unreachable*. G6's model must treat link-holding as an
action that maintains presence rather than merely observes it. Operationally: **pull first, restart
after.**

⚠️ **A detail the first report did not carry:** the failure changes character at 05:18:45, from
`not advertising` to `org.bluez.Error.InProgress` repeating every 60 s. That is an adapter/stack
state, not a sleeping device, and the two must not be collapsed into one "ring unreachable" cause —
they have different remedies, and only one of them is about the ring.

⚠️ **VERIFICATION NOTE — I almost filed a false alarm from this data.** The journal prints **local
time**; `date -u` prints UTC. Reading "newest line 05:21" against "now 09:21Z" looks exactly like a
daemon that has been silent for four hours, and I was one step from reporting a wedged capture host.
`ps -o etimes=` said **2204 s** for a process whose `lstart` I had read as four hours old, and that
contradiction is what caught it: 05:21 EDT *is* 09:21 UTC. **Two clocks, one instant.** Every
timestamp above is therefore stated with its zone — the same discipline §7 of the Clock Contract
applies to device stamps, applied to our own logs.

## 6 · Done when

- [ ] §1's contact-vs-presence split is settled with a measurement, not a decision.
- [ ] The three §5 open questions are answered in the files/devices that can answer them.
- [ ] The state model is written with each transition naming the evidence that triggers it, and no
      transition triggered by elapsed time alone.
- [ ] The probe's opcode set is confined to `O2RING-OPCODE-SURFACE`'s read-only list, cited per opcode.
- [x] A production event where the hourly poller demonstrably missed (§5b, 2026-08-24) — the
      motivating measurement now exists.
- [ ] Recorded whether presence-aware scheduling actually beats the hourly poller, measured against
      the 2026-08-23 cadence baseline rather than assumed to.
