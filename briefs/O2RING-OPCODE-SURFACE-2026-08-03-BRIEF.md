<!--
  O2RING-OPCODE-SURFACE-2026-08-03-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** REFERENCE (living — protocol reverse-engineering, validated on hardware) · **Created:** 2026-08-03

# The O2Ring command space, swept end to end

`O2RING-PROTOCOL-2026-07-17-BRIEF.md` documents **8** OxyII opcodes: `0xFF` AUTH · `0x10` SETUP ·
`0x04` LIVE · `0xC0` SET_UTC_TIME · `0xF1`–`0xF4` file ops. On 2026-08-03 all **256** addresses were
swept with `capture-host/probe_oxyii_opcodes.py` against device `S8AW2100` (`D1:98:62:7C:92:B3`).
Coverage of the **request/response** surface is complete: every opcode was sent at least once,
none remain unprobed. It is **not** complete over the ring's *pushed* streams, which no sent
opcode can elicit — see §10.

**Backups first.** Both un-synced sessions (`20260802203208`, `20260803063220`) were pulled and verified
by VALUE before anything was sent — 36 000 records (median SpO₂ 97 / HR 52) and 4 294 records (99 / 59).
Reading durations would not have been enough; see [[presence-of-file-is-not-presence-of-data]].

## 1 · 25 undocumented responders

`0x00 0x01 0x02 0x03 0x05 0x06 0x07 0x08 0x09 0x15` · `0x80 0x81 0x82 0x83 0x84 0x85 0x86` ·
`0xE0 0xE1 0xE3 0xE4 0xEA 0xEC 0xEE 0xFA`

Three clusters, every one adjacent to a documented command — which is why the sweep orders its plan
**nearest-known-first** rather than `0x00` upward. That ordering found 4 responders in the first 11
probes and the whole `0x80`–`0x86` cluster in a region a linear crawl reaches last.

| opcode | payload | reading |
|---|---|---|
| `0x03` | count-prefixed sample buffer | **PPG waveform tap — see §3** |
| `0x83` | empty ack | **VIBRATION MOTOR — see §2** |
| `0xE1` | 60 B, ASCII `2D010002`, `2592302100` | fw / serial — **and the RTC, bytes [24:31] — see §9** |
| `0x06` | ASCII `20260527040055`, later just `00` | see §5 — conditional, do not quote as a constant |
| `0x84` `0x86` `0xE4` | 4 B, **differ between reads** | live counters, not identity |
| `0x05` | 922 B fixed | **two-channel structured stream — identified 2026-08-05** (`O2RING-RAW-DUAL-WAVELENGTH`). ⚠ That it is a *plethysmogram*, and which channel is which wavelength, are NOT established |
| `0x02` | 20 B | unidentified |

**Reply byte 3 (the "flag") is not always `0x01`** — `0xFC` for `0x01`/`0xEA`/`0xEC`, `0xE1` for
`0x07`/`0x08`, consistent across sessions and both on empty payloads. That is the shape of an ACK/NACK
status field, i.e. the discriminator `probe_oxyii_opcodes.py`'s header says this protocol lacks. **Not
decoded, not asserted** — three values over 25 samples is a pattern, and reading structure into bytes
early is what produced §6.

## 2 · `0x83` = VIBRATE (confirmed)

Fired 5 times, felt 5 times, **with contact held throughout** (HR 58→60, zero invalid samples, so the
ring had no cause to self-alert). `0x80`–`0x82` and `0x7C`–`0x7F` fired individually under the same
conditions: nothing.

⚠️ **The ring buzzes BY ITSELF on lost contact.** That confound is why an earlier "fired twice, buzzed
twice" was downgraded to *likely* and only the counted trial with a contact precondition settled it.

**Why it matters beyond protocol:** the suite has no way to reach the wearer during the night — OxyDex
scores desaturations after the fact. `0x83` is a silent alert channel to the finger that ViHealth does
not expose: a cue on a sustained desat, or a position prompt for supine apnoea. Untested before use:
whether buzzing mid-recording contaminates the ring's own motion column (already fragile — see
[[o2ring-motion-column-fault]]), and the battery cost.

## 3 · `0x03` = drain the PPG buffer, and it truncates silently

Payload is `[4 B][count u16 LE][samples…]`; `count` matched sample length on every read. Measured by
varying the interval between drains:

| gap | payload | count | samples | samples ÷ gap |
|---|---|---|---|---|
| 0.5 s | 68 | 62 | 62 | 124 |
| 1.0 s | 137 | 131 | 131 | 131 |
| 2.0 s | 256 | **250** | 250 | 125 |
| 4.0 s | 256 | **250** | 250 | 62 ⚠ |
| 8.0 s | 256 | **250** | 250 | 31 ⚠ |

**The buffer caps at 250 samples ≈ 2 s and DISCARDS the overflow with no error and no gap marker.** At a
4 s poll you receive a full-looking 250-sample payload covering 4 s of time — half the signal gone, and
nothing in the reply says so. Any consumer must poll at **≤2 s** and treat `count == 250` as a
saturation warning, exactly as `-1` fill and the truncating pipe had to be treated
([[presence-of-file-is-not-presence-of-data]], [[child-stdout-pipe-truncates]]).

It does **not** disturb measurement: A/B over 12 samples each, LIVE-only vs LIVE+`0x03`, 0/12 invalid HR
in both arms.

**Open:** whether these samples are the ones the `0x04` LIVE body already carries (the daemon's current
source, `O2RING-LIVE-PPG-WAVEFORM-2026-07-17-BRIEF`) or a second channel. Read both in one session and
look for a shared run; the test is written (`compare.py`) and was blocked by link availability.

## 4 · What this says about the timebase — and about PAT

`O2RING-PROTOCOL` §"125.738 Hz" and `O2RING-SYNTHESISED-AXIS-2026-08-02` already establish that the
delivered rate is a **fit, not a clock**: per-session spread 125.59–125.88 Hz, no per-sample timestamp,
and any constant used to synthesise one yields a drawn axis whose apparent ppm is the error in the
constant. **`0x03` does not change that** — it is the same crystal, so a second stream cannot be a second
clock. Comparing two streams from one device measures their ratio, never an absolute rate.

What `0x03` **does** change is the reference. A drain gives an exact sample **count** between two
**host-timestamped** reads, so the host clock — disciplined to 0.008 ppm on the capture box — becomes the
axis, and the ring supplies only counts. That is `DexClock.hostAxis`'s discipline applied to a device
that previously offered nothing to anchor: it converts "no timestamps at all" into "host-stamped batches
of known size", and the residual is bounded by one batch rather than accumulating across a night.

**For PAT the limiting term then becomes BLE delivery jitter, not rate error.** CLAUDE.md §7 records
~0.1 s typical and 470 ms observed; `pat-gate.js` demands residIQR ≤ 60 ms. So the decisive question is
whether batch-arrival jitter, median-filtered as `hostAxis` does, lands under that bound — not whether
the nominal rate is 125.0 or 125.738. **Do not re-calibrate the constant** (the existing brief is
explicit); measure counts against the host instead.

## 5 · Negative and retracted results

Recorded because they cost the most and would otherwise be re-derived:

- **`0x06`'s `20260527040055`** reproduced byte-for-byte across sessions, power states and reconnects
  early in the day — matching the date the hourly-HR firmware artifact ended
  ([[o2ring-hourly-hr-artifact]]) — and later returned a single `00`. Conditional; not a fixed constant.
- **The white screen is UNATTRIBUTED.** It appeared during a sweep and did not reproduce when the same
  three opcodes were re-fired in the same order and spacing. Possibly state-dependent (worn, measuring).
- **The download icon is probably not a command effect.** It appeared when a run connected, authenticated
  and died mid-read, self-cleared in ~15 s and resumed measuring. That is a sync indicator, not DFU — an
  alarm raised in-session and withdrawn on the evidence.
- **`0x80`–`0x82`, `0x84`–`0x86`, `0x7C`–`0x7F`** individually: no buzz, no display state beyond the
  ordinary command wake.

## 6 · The method, which is the real result

**The sweep's own detector reads the live DATA FRAME. It sees what the ring REPORTS, never what the ring
DOES.** `0x83` drives a motor and is invisible to it; a human felt it. Actuators — motor, display, LEDs —
are a whole class of effect no data-frame comparison can reach, and any sweep of an unknown command space
needs a human observer for them.

Five "findings" were retracted in one day, each an artifact of the instrument:

1. **A churning frame.** On a worn ring 4 of 4 consecutive live frames differ with nothing sent
   (plethysmogram, sequence counter, checksum). Fixed by measuring a passive null.
2. **Byte 17 — a command scratch field.** It sat at `0xC7` across every passive sample (34 of 34 bytes
   "stable" on a docked ring) and moved for `0x00`, `0x03`, `0x06`. Then `0xF1` — DOCUMENTED, read-only,
   and on a worn ring it does not even reply — moved it too. **A passive null cannot see what commanding
   costs.** The null now fires a documented harmless command.
3. **SpO₂ drift.** The null spans ~10 s, a sweep spans minutes; byte 13 went 98→95 and was read as an
   effect. Now adjudicated against the control command.
4. **Motion as a buzz proxy.** The motor shakes the accelerometer, so motion "should" spike. It read `0`
   across the opcode that buzzed. A plausible inference; the hardware disagreed.
5. **The display as a signal.** `0x50` "woke the display" — until `0xF1` did the same. **Every** command
   wakes it.

**The rule that survived: the null must be a documented harmless command, never silence.** Every
retraction came from comparing against *nothing sent* instead of against *something harmless sent*, and
every one was caught by running a control rather than by reasoning about the data.

## 7 · Tooling changes this forced

- `out["opcodes"]` bound **before** anything that can throw, and the report written **after every
  opcode** — two runs were killed the instant an actuator fired and took their whole record with them.
- Per-opcode **wall-clock stamps**, so "it buzzed at 18:00:20" resolves to one command instead of an
  estimate from elapsed time. That is what narrowed the buzzer from 59 candidates to 6.
- **Nearest-known-first** planning, `--skip`, `--max-ops`: a short window is a prefix and resumes.
- Scan wrapped in the guard with adapter recovery — `BleakScanner.find_device_by_address` was the last
  call outside it and killed a resumed sweep before a single opcode was sent.

## 8 · Preconditions that cost windows

- **The capture daemon holds the ring's single link**, and a connected device does not advertise — so the
  symptom is "not reachable" while the ring's own display shows a Bluetooth icon. Several "the ring is
  asleep" conclusions were this. `link_guard.require_free_link()` exists for it; the one-off scripts
  written during the session did not call it, and that gap was hand-made.
- **The BlueZ adapter wedges after disconnects**, reporting `org.bluez.Error.InProgress` while
  `bluetoothctl show` says `Discovering: no`. The tell is a scan returning in 2–3 s when a real one takes
  45. `bluetoothctl power off/on` sometimes clears it; **`tepna-restart.sh radio` reliably does**.
- **Reachability**: worn = continuously discoverable; docked = a brief burst around the plug event only.
  See [[o2ring-ble-reachability]].

## 9 · 2026-08-19 — the read surface byte-mapped; THE RTC IS READABLE (0xE1 [24:31])

A 13-read × 10 s classifier over the three read-only queries (device `2592302100`, fw `2D010002`,
worn, battery 100 %), each byte classified CONST · CLOCK · COUNTER · NOISY. Tool: the differential
method §6 argued for, systematised (`probe_rtc_read.py` found it; a one-shot dump then mapped the
absolute layout against the freshly-synced host clock).

**`GET_INFO` (0xE1, 60 B) — the headline: bytes [24:31] are the RTC**, in exactly `set_time_frame`'s
write layout: year u16 LE · month · day · hour · minute · second, local civil time, stored verbatim.
Proven twice independently: byte[30] advanced by the gap mod 60 with byte[29] carrying (differential),
and an absolute read 4 min after a 0xC0 push matched the host to the second (2026-08-19 19:48:26 ==
host). A later `--clock` read measured **ring +1 s vs host 19 min after sync** — the pull-side drift
check now exists (`probe_rtc_read.py --clock`; `oxyii.parse_get_info` decodes `rtc`). This settles
"push-only" as FALSE: time can be pulled from the ring, so every 0xC0 push is now verifiable and
free-run drift is measurable per-interval without touching the onboard .dat.

### `GET_INFO` (0xE1) — 60 bytes, fully classified

| bytes | class | value observed | reading |
|---|---|---|---|
| `[0:9]` | CONST | `42 00 05 00 01 02 00 00 00` | header/device constants — semantics unknown |
| `[9:17]` | CONST | ASCII `2D010002` | **firmware version** (parsed) |
| `[17:24]` | CONST | `01 40 08 52 16 01 00` | unknown constants |
| `[24:26]` | CONST* | u16 LE `07EA` = 2026 | **RTC year** (*const within the window; a clock field) |
| `[26]` | CONST* | `08` | **RTC month** |
| `[27]` | CONST* | `13` = 19 | **RTC day** |
| `[28]` | CONST* | `13` = 19 | **RTC hour** |
| `[29]` | CLOCK | carried on sec-wrap | **RTC minute** |
| `[30]` | CLOCK | advanced ≡ gap mod 60 | **RTC second** |
| `[31:33]` | CONST | u16 LE `07E0` = **2016** | frozen date-year (manufacture/epoch?) — **semantics unverified, do not decode** |
| `[33:37]` | CONST | `00 00 00 00` | zeros |
| `[37]` | CONST | `0A` = 10 | **serial length** (parsed) |
| `[38:48]` | CONST | ASCII `2592302100` | **wire serial** — NOT the BLE-name-derived `S8AW2100` the capture filenames use |
| `[48:60]` | CONST | zeros | padding |

### `GET_CONFIG` (0x00) — 40 bytes, all CONST (a settings struct at rest)

| bytes | field | live value | note |
|---|---|---|---|
| `[0]` | alarm_flags | `01` | |
| `[1]` | spo2_low | 88 | alarm threshold |
| `[2]` | hr_low | 50 | |
| `[3]` | hr_high | 120 | |
| `[4]` | motor | **60** (`0x3C`) | the vibration intensity §2's buzz runs at |
| `[5:8]` | buzzer · display_mode · brightness | 0 · 0 · 0 | |
| `[8]` | storage_interval | 1 s | onboard .dat cadence |
| `[9]` | tz_byte | `0xCE` | matches set_time_frame's tail byte |
| `[10:20]` | auto_switch … func_switch | all 0 | per the existing `_CONFIG_FIELDS` map |
| `[20:40]` | — | all 0 | firmware-variant region, empty on this fw |

### `GET_BATTERY` (0xE4) — 4 bytes

| byte | class | value observed | reading |
|---|---|---|---|
| `[0]` | CONST | `00` | state (0 = discharging) |
| `[1]` | CONST | `64` = 100 | **level %** (parsed) |
| `[2]` | **NOISY** | bidirectional `E2–F7` (226–247) | **analog voltage/ADC-like channel** — not a counter; §1's "live counters" reading for 0xE4 was only this byte |
| `[3]` | CONST | `10` | unknown |

**`0x01 SET_CONFIG` is now GATED-IMPLEMENTED (owner-ordered 2026-08-19), and live-verified.**
Payload per upstream: 8 bytes LE, `[field_index, 0, 0, 0, value, 0, 0, 0]`. ⚠️ The write-side field
indices are a DIFFERENT enumeration from GET_CONFIG's byte offsets — MOTOR is write-field **6** but
read-byte 4; BRIGHTNESS write-field **9** but read-byte 7 (0=Low · 1=Medium · 2=High, the one
documented range). `oxyii.set_config_frame` whitelists the 9 documented fields (nothing off-list can
produce a frame — the gate that keeps the 0xE3/0xEE neighbourhood unreachable); `ring_config.py`
brackets every write with a full-struct GET_CONFIG diff and reports applied ONLY if exactly the
expected byte moved to the expected value. Live on fw `2D010002`: brightness 0→1 verified
(`byte[7] 0 → 1`, nothing else moved), restored 0→0 — so the plaintext write path works on this
firmware, and the vendor app's brightness + vibration-intensity knobs are now settable from the box.
MOTOR intensity (currently 60) is the buzz-fiducial tuning knob.

**And `0x83`'s artifact is characterised (the buzz-fiducial brief's step 1, DONE).** Two commanded
buzzes while streaming the raw 0x05 dual-wavelength+motion: empty-payload 0x83 drives a **~1.1 s**
vibration; the **motion channel** carries it unambiguously (0 → peak 22 over ~81 samples against a
perfectly-still baseline of 0) while the optical σ is direction-inconsistent across the two fires —
motion is the detector, optical is not. Onset-after-command measured ~419 ms but is **buffer-limited
(±~0.5 s)** — the raw stream is back-timed from ~1 s arrivals, so a per-fire latency distribution
(step 2) needs either many fires averaged or the 125 Hz pleth path.

## 10 · 2026-09-03 — the PUSH surface, which no sweep of this shape can reach

§6's rule was that the detector "sees what the ring REPORTS, never what the ring DOES", and named
actuators as the class a data-frame comparison cannot reach. **There is a second class, and it is the
reason this brief has no accelerometer in it: streams the ring sends only when it has been told to.**
A push opcode is not a request. Sending `0x14` and getting silence is not evidence the capability is
absent — it is exactly what a disabled push stream looks like from a sweep.

### `AUTO_RT_SWITCH` (`0x10`) — the byte that was "purpose unknown"

**[SDK]** `0x10` was recorded as *"setup, payload 00, purpose unknown"* by this project **and** by the
public reverse-engineering reference (`nglessner/o2ring-s-protocol`) until 2026-09-02. The vendor
exposes it as `oxyAutoSwitch(model, autoParam, autoWave, autoPpg, autoAcc)` and builds the payload by
OR-ing four booleans into a single byte:

| bit | constant | stream it enables |
|---|---|---|
| `0x01` | `RT_PUSH_PARAM` | live parameters |
| `0x02` | `RT_PUSH_WAVE` | waveform |
| `0x04` | `RT_PUSH_PPG` | PPG |
| `0x08` | `RT_PUSH_ACC` | 3-axis accelerometer (arrives as `0x14`) |

**So the `0x00` this project has always sent does not mean "default" — it DISABLES all four.** Every
sample this project holds was obtained by polling because of that byte.

### [HW] The corroboration was already in this brief, unremarked

§9's `GET_CONFIG` byte map records `[10:20] auto_switch … func_switch | all 0`. The ring's own settings
struct read `auto_switch = 0` on fw `2D010002` — measured, not inferred. That is direct hardware
evidence that all four push streams were off at the moment this sweep concluded the ring had none.

Two independent readings agree, and neither was noticed at the time: `0x14` was sent during the
256-opcode sweep and is absent from §1's responder list, and the config struct says why.

### `0x14` = `AUTO_RT_ACC` — decoded, never observed

**[SDK]** Layout: `[0:2]` u16 LE record count, then 6 bytes per sample — three **i16 LE** axes.
Implemented as `oxyii.parse_rt_acc`.

🔴 **Read SIGNED.** The sibling `parse_rt_ppg` shipped its first revision reading unsigned and its
statistics were wrong by an order of magnitude, because small negatives wrap to ~2\*\*32. An
accelerometer at rest sits near zero on two axes and at ±1 g on the third, so an unsigned read turns
every downward tilt into a large positive that still looks like data.

⚠️ **Units are NOT known.** The vendor publishes raw counts with no scale factor and there is nothing
here to calibrate against. Counts are returned as counts; do not synthesise g — a plausible-looking
acceleration is worse than an obviously raw one.

### [HW] First frames — 2026-09-03 ~19:30

**This stream had never been exercised until the evening this section was written**, and the history
matters because it is easy to overwrite with a tidier and falser one. The `0x08` path shipped in
`bf68b959` (2026-09-03 01:32). `setup_frame` has exactly one caller:

    _push = oxyii.RT_PUSH_ACC if "acc" in (dev.get("streams") or []) else 0x00

Until a device config carried `acc`, that ternary never took its left branch. The capability existed
for ~18 hours before anything used it. **So "this project always sent `0x00`" is a true statement
about every capture in the archive**, and §9's `auto_switch = 0` remains a correct reading of the
ring at sweep time rather than an artefact.

`acc` was then ticked in the Devices UI and the capture restarted — a stream change takes effect only
at connect — and `acc_o2` registered for the first time. Verified here from two monitor screenshots
five minutes apart: **14 streams carrying two ACC channels at 19:24; 15 streams carrying three at
19:29**, the new one being the ring's.

    ACC (O2Ring)   LIVE    x -2968   y 4616   z -6080    3ch · event

The signed read is supported: two axes are negative, and an unsigned decode would have shown values
near 2\*\*32 for them.

⚠️ **A units hypothesis, held deliberately BELOW the evidence.** That triplet has magnitude 8190 —
within 0.03 % of 2\*\*13 — which would suggest **8192 counts/g, i16 at ±4 g**. Two sessions computed it
independently off different triplets (8190, 8191). **It is not established, and the obvious
supporting argument is unsound.** The `Motion` channel read `0` in the same frame, but §6's
retraction list records motion reading `0` *across the opcode that buzzed*: a motor shaking the
accelerometer produced no motion reading. `motion == 0` may mean "still", or may mean "this channel
does not respond", and a single frame cannot separate them. Harder evidence against stillness: across
a run of SSE samples the magnitude ranged **8024 – 8785**, so the ring was demonstrably moving and
8190 is the low end of a spread, not a resting value.

**The test that would settle it:** six orientations (±x, ±y, ±z up), ring still in each, checking that
|a| holds near constant and each axis approaches it at 1 g. The stillness criterion must be the
magnitude's own variance over a held interval — **never** the motion byte, for the reason above.
Until then counts stay counts.

⚠️ **Open — the effective rate is not the sample rate.** Each distinct triplet repeats ~6–7× in the
buffer at an effective 10.16 Hz, so the true update rate may be nearer **~1.5 Hz**: either the sensor
updates slower than the frame carries it, or the stride re-reads records. Nobody should treat 10 Hz
as a sampling rate before this is pinned. If it is ~1.5 Hz the ring's ACC is far too coarse to time a
buzz, and the H10/Verity remain the fiducial receivers.

**Provenance of this subsection.** The stream-count change is **[HW]**, verified here from the
monitor. The commit id, the `/api/state` before-state (`acc_vs` and `acc_h10` present, `acc_o2`
absent), the single-caller claim and the 8024–8785 spread are **reported by the Heron session and are
not independently verified here.**

### Before anyone enables it

`setup_frame(RT_PUSH_ACC)` changes what arrives on the notify characteristic **for the whole
session** — unsolicited frames carrying opcodes the dispatcher has never seen. It is config-gated at
the caller rather than switched on in the library. Enable `0x08` alone rather than OR-ing in
wave/PPG, so that a dispatcher failure is attributable to one stream.

⚠️ This is a live-capture behaviour change on a device that cannot be re-run. The first such run happened
on 2026-09-03; treat any further one the same way — an experiment with a night at stake, not a setting. Back up un-synced sessions and verify them BY VALUE
first, exactly as the top of this brief did.

### The USB path, for contrast

**[HW]** The USB/Format-A `.dat` record is `[spo2 u8][pulse u8][motion u8]` — one scalar motion byte
at 1 Hz, no axes — and `0x14` is not in the USB `OP_NAMES` table. Accelerometer access on this
hardware, if it is reachable at all, is BLE-only. See `O2RING-USB-FIELD-NOTES-2026-09-03`.

### What this closes elsewhere

`DEVICE-RATE-TRUTH-2026-08-05` carries **"Whether the ring exposes an accelerometer"** as an open
question. **It is answered: the ring does expose one.** Declared by the vendor surface, decoded
here, gated off by `AUTO_RT_SWITCH` for the life of the archive, and first observed on
2026-09-03 ~19:30 — so every capture predating that carries no ACC and no amount of reprocessing
will recover it. The
§5 decision to leave GYRO and MAG off is unaffected; there is no gyro or magnetometer opcode in this
command space at all.

