<!--
  POLAR-ONBOARD-BACKUP-2026-08-01-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-01 · **Related:** `POLAR-OFFLINE-DOWNLOAD-2026-07-17-BRIEF.md` (the pull path this builds on — and one finding it corrects), `VIGIL-O2RING-AUTOPULL-2026-07-21-BRIEF.md` (the O2Ring precedent), `CAPTURE-HOST-2026-06-29-BRIEF.md` (the daemon), `POLAR-SDK-CAPTURE-2026-07-07-BRIEF.md` (SDK capability survey)

# Polar onboard backup — record on the device, survive the link

> **What this is.** Make the H10 and the Verity Sense record to their own flash while the box captures
> live, and pull it in the morning — the Polar equivalent of the O2Ring `.dat` backup that already
> exists. **Why:** the live BLE link is the single point of failure for every Polar signal, and today
> a dropout is unrecoverable. On 2026-07-17/18 armband motion + link loss put ECG↔arm-PPG rMSSD
> **70–76 % apart**; those nights have no second copy of anything.
>
> **Status is PROPOSED and three facts are unmeasured.** Run `probe_polar_onboard.py` first (§6); the
> design below is written so the probe's answers slot into it rather than invalidate it.

---

## 0 · Invariants (inherit, do not re-derive)

1. **Clock Contract (§🔒).** The offline file carries **device** time. `SET_LOCAL_TIME` at session
   start pins it; §3's live channel measures its drift against the chrony-disciplined host across the
   night; the correction is applied at decode. Never fabricate a stamp for a gap.
2. **A missing backup is `null`, never an empty success.** Every failure mode below (auto-stop at the
   memory limit, a stale session blocking the H10's single slot, a short pull) presents as "the file
   is fine, it is just shorter than the night" — the fabricated-absence class the audit charter puts
   at top severity.
3. **Nothing here may cost a live night.** The live stream is the primary; the backup is the belt.
   If starting a recording risks the stream, the recording loses.
4. **Erase only after a verified second copy** — the rule `nightarchive` already enforces for nights.

---

## 1 · What each device can actually do (measured against the SDK, 2026-08-01)

| | H10 | Verity Sense |
|---|---|---|
| Feature | `FEATURE_POLAR_H10_EXERCISE_RECORDING` | `FEATURE_POLAR_OFFLINE_RECORDING` |
| Records | **HR, or RR** — `SampleType {HR, RR}`, `RecordingInterval {1S, 5S}` | **PPG · ACC · PPI · HR · skin temp** |
| Raw waveform? | **Never.** No onboard path to ECG at any setting | **Yes** — raw PPG to flash |
| Firmware floor | — | **2.1.0** (this unit `0C301E3F` reads **3.0.16**) |
| Slots | **"only one recording at the time"** | memory-limited, multiple |

⚠️ **This corrects `POLAR-OFFLINE-DOWNLOAD-2026-07-17` §Engineering findings.** That brief concluded
*"No raw-PPG `.REC` offline recordings exist — the button-in-exercise-mode only saves HR. Raw
multi-channel PPG is only available via live PMD streaming, never as a stored file on this
unit/firmware."* It had enumerated the filesystem after using **exercise mode**, which is a different
feature from offline recording. The capability exists; nobody had ever started one, so there was
nothing to find. The conclusion was sound about what was on the flash and wrong about what could be.

⚠️ **And a tension this brief does not get to resolve by reading.** The SDK enum offers
`SampleType.RR`; the H10 product doc says only *"Recording supports HR with one second sampletime."*
That gap decides whether the H10 leg is worth building — see §5.

---

## 2 · The constraint that shapes everything

> *"The online streaming and offline recording do not work same time for the same data type."*
> → `ERROR_ALREADY_IN_STATE`.
> *"Heart rate … is the only data type that can be both streamed online and recorded in an offline file
> at the same time."* — `SdkOfflineRecordingExplained.md`

Per **data type**, not per device. So the split is forced, and it is the design:

| stream | mode | why |
|---|---|---|
| **PPG** | offline (Verity) | the signal the backup is for; cannot also be live |
| **HR** | live | the documented exception — rides the BLE Heart Rate Service, not PMD |
| **GYRO** | live | not an offline-recordable type, so it cannot collide |
| **ACC** | *decide* | offline-recordable, so recording it costs the live wrist-ACC stream |

**ACC is a real fork, not a detail.** MotionDex consumes wrist ACC. Recording it offline protects it
and blinds the live actigraphy; leaving it live does the reverse. Default: **leave ACC live**, because
posture/actigraphy is a whole-night statistic that degrades gracefully with a gap, while PPG-derived
HRV does not.

---

## 3 · Why the live channel is not just presence

The obvious reading — "keep something live so we know the device is there" — undersells it, and the
useful half is easy to get wrong:

- **HR over the BLE Heart Rate Service carries no sensor timestamp.** It is host-arrival-stamped only.
  HR gives **presence and worn-state**, and nothing about the clock.
- **GYRO over PMD carries `sensor timestamp [ns]`.** Paired with the host arrival stamp the daemon
  already writes, it is a continuous **(device clock, host clock)** map across the night.

That map is the point. Both the offline file and the live stream use the *same* device clock, so
comparing them to each other measures nothing. Comparing either against the **host** measures the
drift the offline stamps need corrected by. So: **HR = presence, GYRO = clock reference.** Keep both,
for different reasons.

**Cost.** Gyro at the configured 52 Hz all night is the same order of bytes as the ACC stream that
was cut 416→52 Hz for being 71 % of the box's output (`config.yaml` §E4). A clock reference needs
timestamps, not motion — negotiate the **lowest rate the device offers** and say so in the config
comment, or this quietly doubles the night's size for a signal nobody reads.

---

## 4 · The hard part: starting without dropping the stream

`polar_psftp.PolarPsFtp` **opens its own `BleakClient`**. A Polar holds one BLE link, which is why
every offline op today pauses live capture (`POLAR-OFFLINE-DOWNLOAD` §Known caveat). Starting a
recording that way would drop the very stream the recording exists to protect.

PMD notifications ride `FB005C82`; PS-FTP requests ride `FB005C51` — **the same GATT link, different
characteristics**. So the start op must go out over **`capture.py`'s existing client**, not a new
connection. That is the one genuine refactor here:

- expose a "send a framed PS-FTP query on the live client" path (the framing already exists in
  `polar_psftp._build_request_packets` / `_read_response`; only the transport is bound to the wrong
  client);
- widen `_ALLOWED_QUERIES` **narrowly** — the recording verbs only. The allowlist refusing
  `REQUEST_START_RECORDING (14)` beside `PREPARE_FIRMWARE_UPDATE` is correct and stays correct for
  everything else.

⚠️ **CORRECTED 2026-08-02 — the two legs do not share a mechanism, and the Verity's is not PS-FTP at
all.** The paragraph above is right for the H10 and wrong for the Verity. Established from the SDK
sources (see §4a): the Verity's offline recording is started over the **PMD control point**, which
`capture.py` ALREADY owns and already writes to for every live stream. So for the Verity leg there is
**no `_ALLOWED_QUERIES` widening, and no PS-FTP-on-the-live-client refactor** — the "one genuine
refactor" above applies only to the H10. That deletes the hardest-looking piece of this brief for the
leg that matters most.

---

## 4a · The wire format, established 2026-08-02 (protocol facts, read not guessed)

Read out of `polarofficial/polar-ble-sdk` (proprietary, `NOASSERTION` — **not** a dependency; what is
recorded here are protocol facts: enum numbers, field numbers, a bit position. Same standing as the
`pftp_request.proto` field numbering `polar_psftp.py` already documents, see `THIRD-PARTY.md`).

**Verity — PMD control point, one bit.** `BDBleApiImpl.kt:2011`:

```kotlin
client.startMeasurement(mapPolarFeatureToPmdClientMeasurementType(feature),
                        mapPolarSettingsToPmdSettings(settings), PmdRecordingType.OFFLINE, pmdSecret)
```

and `PmdRecordingType.kt` is the whole encoding:

```kotlin
enum class PmdRecordingType(val numVal: UByte) { ONLINE(0u), OFFLINE(1u);
    fun asBitField(): UByte = (this.numVal.toUInt() shl 7).toUByte() }   // OFFLINE => 0x80
```

So an offline start is the **ordinary `START_MEASUREMENT` capture.py already sends, with the
measurement-type byte OR'd with `0x80`** — same settings payload, same characteristic, same client.
`STOP_MEASUREMENT` mirrors it. This is a flag on an existing call, not a new subsystem.

**H10 — PS-FTP, and RR is real.** `REQUEST_START_RECORDING = 14`, `REQUEST_STOP_RECORDING = 15`,
`REQUEST_RECORDING_STATUS = 16` (`pftp_request.proto`), with:

```proto
message PbPFtpRequestStartRecordingParams {
  required PbSampleType sample_type        = 1;
  required PbDuration   recording_interval = 2;
  optional string       sample_data_identifier = 3;
}
```

`types.proto` carries `SAMPLE_TYPE_HEART_RATE = 1` and **`SAMPLE_TYPE_RR_INTERVAL = 16`**, and
`PbDuration { hours=1, minutes=2, seconds=3, millis=4 }`. **This settles §1's tension**: RR is
expressible on the wire even though the H10 product page says only *"Recording supports HR with one
second sampletime."* Whether the device ACCEPTS it is still a hardware question — but the leg is worth
attempting rather than scoping as HR-only on the strength of a doc sentence.

### The constraint that changes the design: you cannot read the device while it records

> *"Any file transfer is **prohibited** when Polar Verity Sense is in internal recording or swimming
> mode. Attempting to list, fetch or delete any offline recording will return `SYSTEM_BUSY` error."*
> — `documentation/products/PolarVeritySense.md`

Device-specific, and it **conflicts with** the generic `SdkOfflineRecordingExplained.md`, which says
read/delete *"can be called while the offline recording is recording, but that is not recommended."*
Take the device page for the Verity. Consequences, both load-bearing:

1. **The morning pull must STOP the recording first** — a pull attempted against a still-recording
   device does not merely block, it errors. §7 must sequence stop → list → pull → (re)start.
2. **§5's stronger form gets more expensive than it looks.** "Record PPG offline as the primary" means
   the device is *unlistable and unpullable for the whole night* — no mid-night verification, and any
   monitoring must come from the live HR/GYRO channel §3 already argues for.

It is also a standing trap for diagnosis: once recording is in use, a `SYSTEM_BUSY` refusal will look
exactly like the hang §6b describes. (It was **not** the cause of the 2026-08-02 hang — that was the
unpruned walk, fixed in #710, and the device held no sessions at all.)

### Triggers — a start path that needs no BLE call at all

`setOfflineRecordingTrigger` supports **`TRIGGER_SYSTEM_START`** ("started every time the Polar device
is switched on") and **`TRIGGER_EXERCISE_START`**, disabled with `TRIGGER_DISABLED`. A trigger set once
makes the device record on power-up **by itself** — which sidesteps §4's entire "start it without
dropping the stream" problem for the always-record case. Known limitation: `TRIGGER_EXERCISE_START`
with PPI returns `ERROR_NOT_SUPPORTED`. Worth evaluating BEFORE building the runtime start path, since
it may make it unnecessary.

### Two more facts that answer §6's open questions

* **Memory (§6 Q2).** Two limits, both device-side: **Limit 1** (~2 MB) — a new recording or trigger
  returns `ERROR_DISK_FULL`; **Limit 2** (300 KB–2 MB) — **all active offline recordings are stopped
  automatically and triggered recordings are disabled**. The auto-stop is the §0.2 fabricated-absence
  case: the night ends early and the file still looks fine.
* **Encryption.** Offline records may be AES-128 encrypted by passing a key to `startOfflineRecording`;
  the same key is needed to read them back. It is **optional**, and the SDK notes that without it
  "it might be possible by others to read out recordings". Default for Tepna: **unencrypted**, because
  the decoder has to read it and the threat model is physical possession of the armband — but say so
  deliberately rather than by omission.

### Prior art: there is none to borrow

No third-party implementation of Polar offline recording exists to copy or check against.
**BleakHeart** (`fsmeraldi/bleakheart`, the closest Python work) explicitly does not support it, and
its author opened `polar-ble-sdk#600` asking Polar for the packet format; `#556` asks the same for
Python offline access. `rsc-dev/loophole` (MIT) is read-only file access over USB for the older
watches. So this leg is written from the protocol facts above, first — which raises the bar on
gating it, not the ambition.

## 5 · What each leg actually buys

**Verity — the strong leg.** Raw PPG on flash, and *"the recording continues even though the BLE
connection is lost while recording."* That is strictly better than a live link. It is worth
considering the stronger form: **stop streaming Verity PPG live and record it offline as the primary**,
which deletes the entire BLE-dropout class for the armband rather than insuring against it. Cost: no
live PPG view, no live stall detection, and total dependence on the morning pull.

**H10 — the thin leg.** Its ceiling is RR, and possibly only HR:

- **RR** → rMSSD/SDNN survive a dropout. A true redundant copy of the `_RR.txt` already captured live.
- **HR at 1 Hz** → backs up the channel this project already distrusts. The H10's device HR is
  **smoothed and under-states σ**, which is exactly why ECGDex derives H10 HR from raw ECG rather than
  `_HR.txt`. As a backup it degrades to "was I alive, roughly what rate".

Either way: **a night whose live ECG dropped never gets its waveform back.** If waveform continuity is
the goal, that is a link-reliability problem (placement, the deaf-dongle watchdog), not a backup one.
Try `SampleType.RR`; fall back to HR only on rejection; let the answer set expectations.

---

## 6 · Phase 0 — the probe (do this first)

`capture-host/probe_polar_onboard.py`, read-only, deliberately **does not start a recording** (§4: the
format is unestablished). It reports firmware vs the 2.1.0 floor, every session already on flash with
byte sizes, and the device↔host clock offset — each as `null` rather than a plausible default when it
cannot be read.

```sh
# a Polar holds ONE BLE link — stop the daemon first
python probe_polar_onboard.py --address 24:AC:AC:0C:30:1E --adapter hci0    # Verity
python probe_polar_onboard.py --address 24:AC:AC:02:84:96                  # H10
sudo -n /usr/local/lib/tepna/tepna-restart.sh restart
```

**Three questions only hardware answers**, and each changes the design:

1. **Does `SampleType.RR` work on the H10?** RR ⇒ build the leg; HR-only ⇒ it is a consolation prize
   and should be scoped as such (§5).
2. **How many hours of 55 Hz 4-channel PPG fit before the memory limit?** Below Limit 1 new recordings
   return `ERROR_DISK_FULL`; at Limit 2 **active recordings auto-stop** and the device never erases.
   A night that exceeds it silently becomes a partial backup.
3. **What container comes back?** The exercise-session pull returned `.BPB` protobuf, not anything
   PpgDex can read. If offline PPG lands in a proprietary container there is a **decoder to write**
   before any of this is useful downstream — potentially the largest piece of work in the brief, and
   currently unestimated.

### MEASURED 2026-08-10/11 — the H10 half is settled, and one design assumption is dead

The probe ran (`probe_pmd_surface.py`, plus PS-FTP queries by hand). Everything below is off the
hardware or off the SDK source, not off this brief:

| question | answer | evidence |
|---|---|---|
| Does the H10 do PMD offline recording? | **No.** | `0180`/`0182` (settings, offline bit) → `0x02 INVALID_MEASUREMENT_TYPE`. The `0x80` bit is not a recording flag to it, it is an invalid type. |
| Does it advertise SDK mode? | **No.** | feature bitmask `0f05` = bits 0,2 = ECG + ACC only. No `0x9`, no PPG, no PPI, no offline-recording feature. |
| Can we ask it what it is recording? | **No, not over PMD.** | `05` MEASUREMENT_STATUS → `0x01 INVALID_OP_CODE`. Recording state must come from PS-FTP `REQUEST_RECORDING_STATUS (16)`. |
| How much memory (§6 Q2, H10 side)? | **The device will not say.** | PS-FTP `GET_DISK_SPACE (5)` → `201 NOT_IMPLEMENTED`. Polar's published figure is the only source: **"+30 hours" of HR at 1 Hz, ONE session at a time.** |
| Is PS-FTP reachable at all? | **Yes.** | query 5 returned a structured protobuf error — the transport works end to end, so query 16 is reachable when wanted. |

Firmware 5.0.0, hardware `00760690.03`. ECG fixed 130 Hz / 14-bit; ACC 25/50/100/200 Hz, 16-bit,
±2/4/8 g.

**The wire format in this brief is CORRECT — re-read from the SDK source, not trusted.**
`pftp_request.proto` and `types.proto` confirm `REQUEST_START_RECORDING = 14`, `STOP = 15`,
`STATUS = 16`, `PbPFtpRequestStartRecordingParams`, `SAMPLE_TYPE_HEART_RATE = 1` and
**`SAMPLE_TYPE_RR_INTERVAL = 16`** verbatim. Two corrections: `PbDuration`'s fields are
`optional … default 0`, not required; and the enum has **six queries this brief omits** —
`GET_DISK_SPACE = 5`, `REQUEST_SYNCHRONIZATION = 13`, and `START/STOP/PAUSE/RESUME/
GET_EXERCISE_STATUS/START_DM_EXERCISE = 21–26`.

⚠️ **§6 Q1 IS STILL OPEN.** Whether the H10 ACCEPTS `SampleType.RR` was not tested — no start command
was ever sent, because that needs the `_ALLOWED_QUERIES` widening this brief rightly gates. Everything
above narrows the design around that question; it does not answer it.

### ⚠️ THE VERITY MODE SELECTOR AS DESIGNED WOULD DELETE TWO STREAMS

`documentation/products/PolarVeritySense.md`, which this brief did not consult:

```
| PPI | PPI online stream or offline recording is not supported in SDK MODE |
| HR  | HR  online stream or offline recording is not supported in SDK MODE |
```

SDK mode is what unlocks PPG above 55 Hz — so **"SDK mode on" and "PPI/HR available" are mutually
exclusive on this hardware**, and the monitor offered both as independent switches. Measured
2026-08-10: SDK mode was enabled for 176 Hz PPG at ~11:30 and PPI answered `invalid_state` for the
rest of the day and the whole night; the night's QC recorded `Polar Verity Sense:hr` missing and 0 PPI
rows. Worse, SDK mode is DEVICE state that survives the config — turning the switch off only stopped
us re-entering it, so a manual power cycle was the only cure (fixed since: the switch now sends
`03 09`).

⚠️ **And the skin-contact bit is not a foundation to build on.** Same doc: *"Skin contact detection is
very unreliable in Polar Verity Sense. Skin contact of PPI packets should not be trusted."* Our own
corpus separates perfectly (desk 0/31,877 rows, worn 1/20,957), so it is usable — but its documented
failure direction is a FALSE `worn`, which for a drop-the-link decision is the safe direction and for
a "the data is good" decision is not.

---

## 6a · The monitor control — a MODE, and it ships in Phase 2, not before

The Verity's choice is a genuine either/or (§2: PPG cannot be online and offline at once), so the
Devices card gets a **mode selector**, not a checkbox bolted onto existing behaviour. It sits beside
the existing per-device controls (`monitor.html` ≈ L1006-1008, next to **📥 Recordings**), and persists
through `/api/settings` like every other device setting.

```yaml
devices:
- name: Polar Verity Sense
  recording: live          # live | offline   — offline needs fw >= 2.1.0; PPG cannot be both (§2)
- name: Polar H10
  onboard: rr              # off | rr | hr    — NOT a mode: additive to the live ECG stream
```

**The H10 is deliberately not a mode.** Its exercise recording is a different subsystem from PMD and
does not contend with the live ECG stream, so there is nothing for the operator to trade off — it is
just on. The only real choice is `rr` vs `hr`, and that is decided by what the device accepts, not by
preference: **try RR, fall back to HR on rejection** (§5 — RR keeps HRV recoverable, HR backs up the
channel this project already distrusts). Surface which one is actually running; do not let the config
assert `rr` while the device gave you `hr`.

**Three rules for the switch, all of them the same rule:**

1. **It does not ship before the start op works.** A toggle whose "offline" position stops the live
   stream and starts nothing configures a night into NO PPG, and the card would read normal. That is
   `tepna-clock.sh`'s cardinal sin — a control that claims success and changes nothing — in the very
   UI that learned it. Phase 2 or later, never earlier.
2. **Availability is DERIVED, never assumed.** `offline` is offerable only when the daemon has
   confirmed this unit reports the feature and a firmware ≥ 2.1.0 — the probe's own tri-state, not a
   static config flag. Unknown firmware ⇒ the option is disabled with the reason in the tooltip, not
   silently absent and not optimistically enabled.
3. **The card shows what is RUNNING, not what was chosen.** `recording: offline` in config plus no
   active recording on the device is the exact silent-partial-backup state §8 exists to catch, so the
   card reads the device's recording status, and a mismatch is an alert rather than a green pill.

Switching mode mid-night is out of scope: the mode is read when a session opens. A change while
recording applies to the next session, and the card says so.

---

## 6b · Measured 2026-08-02 — the BLE pull path has never once worked, and USB does

Hardware findings from the real Verity (`0C301E3F`) on vigil. These change the build order in §7, so
read them before starting: this brief was written assuming the BLE pull works and USB is at best an
optimisation. **Both halves of that assumption are wrong.**

**The BLE leg has a 0% success rate.** Across 7 days of `/api/polar/recordings` on the Verity: 27 ×
`409 busy`, 2 × `502`, **zero successes** — and `ls /srv/tepna/captures/stored/*offline*` is **empty**,
so no offline pull has ever landed on disk for *either* Polar. Today's attempt acquired the offline
lock at 14:17:12 and was killed by the 300 s watchdog at 14:22:12 (`offline op exceeded 300s and was
abandoned`). Caveat, stated honestly: most of those 29 attempts are from this session, and the device
was **docked and charging** throughout, which is already known to disable PMD streams — so "BLE
listing is broken" is not yet separable from "BLE listing is broken *while charging*". Re-run it with
the sensor off the dock before treating the 0% as unconditional. What is not in doubt is the negative:
**nothing has ever been retrieved by the shipped path.**

**PS-FTP rides the USB HID pipe, and listed the same directory in under a second.** The dock
(`0da4:0008`, two 64-byte interrupt endpoints) serves the real filesystem — `DBDC.DAT`, `USERID.BPB`,
`S/`, and a date-named session dir `20260621/`. `polar_psftp`'s protobuf layer parses the payload
unchanged; only the framing differs (v800_downloader's, **not** BLE RFC76 — see
`probe_polar_usb.py`'s header for the two off-by-one details that make a working pipe look dead).

**The catch, and the open question that decides everything.** The USB server only answers in a window
that opens on **USB re-enumeration**, proven by replug: unplug 14:08:52 → replug 14:09:07 → first GET
returned the listing → the next request one second later was back to 1-byte filler. Ruled out first by
measurement: ACK-counter desync (all 256 values swept), stale handles (incl. the 500 ms double-open
ritual), wrong paths, and transience (171 attempts at 1 Hz → 0 replies).

So the question is **whether a multi-packet FILE read fits inside that window**, and it is the whole
ballgame:

* **If yes** — a pull is one GET, and re-enumeration is **software-triggerable without touching the
  hardware** (`echo 0 > /sys/bus/usb/devices/1-1/authorized; sleep 2; echo 1 > …`, as root). A
  "re-enumerate → one GET" loop then pulls a whole session over a channel that is **independent of the
  radio**, which is the constraint §2 calls the one that shapes everything: the pull would run **while
  live capture continues**, at 64-byte reports instead of 20. USB stops being an optimisation and
  becomes the **primary** path.
* **If no** (the window fits only one small reply) — USB is a fast directory lister and nothing more,
  and the BLE leg has to be made to work regardless.

**ANSWERED 2026-08-02 16:16 — it is NO, and it is not close.** A watcher armed on vigil burst requests
the instant the dock re-enumerated:

```
16:16:52 REPLUG
  +0.09s OK /U/0/           -> DBDC.DAT(1) · USERID.BPB(70) · S/ · 20260621/
  +0.30s -- /U/0/USERID.BPB       the 70-byte FILE: nothing
  +0.51s -- /U/0/20260621/        a DIRECTORY: nothing
  … 38 further requests, all nothing        => 1 successful request in this window
```

The window is **exactly ONE request**, not a short time slice — it closed within 210 ms of the first
reply, and request #2 fails whether it asks for a file or a directory, so it is not a file-vs-directory
distinction. And because a multi-packet reply obliges the host to ACK each packet — and every ACK is
itself a write — **nothing larger than a single 64-byte report can ever complete over this transport.**

So the "re-enumerate → one GET" pull loop is dead: it would need one physical re-enumeration per
*packet*, not per file. **USB is a fast lister for one small directory and nothing more.** It keeps a
narrow diagnostic value (it reads the device tree in 90 ms without touching the BLE link, and it is how
the unpruned-walk bug in §6b was found), and no further USB work is warranted. The BLE leg is the only
pull path — which is why it was fixed on its own merits in #710 rather than waiting on this answer.

Two consequences regardless of the answer: the daemon needs a **root-capable re-enumeration hook**
(the daemon runs as `vigil`; toggling `authorized` needs root, so a sudoers entry or a tiny unit), and
`probe_polar_onboard.py`'s four known defects (§ its header) are now blocking rather than cosmetic.

⚠️ **Do not sweep opcodes on the USB pipe.** An exploratory sweep of byte1 across `0x00..0xFF`
re-enumerated the device mid-run. `polar_psftp._ALLOWED_QUERIES` exists because a wrong query id
"would do something far worse than set a clock"; that hazard is identical on this transport, on
hardware that may be nowhere near anyone who could recover it.

---

## 7 · Build order (after the probe)

1. **Phase 1 — lifecycle, no recording.** `status → stop → remove` over the live link, plus the
   allowlist widening and the shared-client transport (§4). Provably safe: it only ever *clears*.
2. **Phase 2 — start on session open, and the monitor mode switch (§6a).** `SET_LOCAL_TIME` → `start` →
   confirm via `status`. Live HR + GYRO continue; assert the stream did not drop (this is the
   acceptance test, not a smoke check). The switch lands HERE, with the start op it controls — its
   `offline` option enabled only where the capability is confirmed, and the card reporting the
   device's actual recording status rather than the configured intent.
3. **Phase 3 — morning pull + verify.** Reuse `pull_recording` (now `.part`-guarded and skip-idempotent
   after the 2026-08-01 audit fixes). Erase on-device **only** after the pull is byte-verified and the
   night is mirrored (§0.4).
4. **Phase 4 — decode.** `.BPB` → PSL layouts, so the backup routes into PpgDex/PulseDex with no new
   parser branch. Scope unknown until the probe answers Q3.
5. **Phase 5 — gap repair.** The reason any of this exists: when `nightqc` reports a hole, splice the
   onboard recording over it. **Today the Polar pulls have no consumer at all** — `trio-batch.mjs`
   reads the O2Ring `_STORED.dat` and nothing reads `Polar_Offline_*`. Without this phase the backup is
   collected and never cashed in.

---

## 8 · Failure modes this INTRODUCES (gate them, or do not ship it)

- **Auto-stop at Memory Limit 2** — recording ends mid-night, file looks valid. ⇒ poll `status`, alert
  on "expected a recording, found none".
- **Stale session blocks the H10's single slot** — night 2 silently records nothing. ⇒ the Phase-1
  lifecycle is mandatory, not an optimisation.
- **The start op drops the live link** — the backup costs the primary. ⇒ Phase 2's acceptance is
  stream continuity, not "the recording started".
- **A partial pull read as complete** — already fixed (`.part` + short-read refusal, audit F3), and
  this brief is the reason that fix matters.

⚠️ **None of these are visible without push alerting, which is currently unconfigured** (no `alerts`
block in the live `config.yaml`). Every failure above presents as a green box with a short file. Wiring
`alerts.enabled` + `webhook_url` is a **precondition** of this brief, not a nice-to-have.

---

## 9 · Done-when

Flips to **IN-PROGRESS** when the probe has run and §6's three questions are answered in this file.

> **Re-checked 2026-08-26 — still correctly PROPOSED, and the trap is that HALF the condition is met.**
> The probe HAS run (§6 *MEASURED 2026-08-10/11*) and Q2 and Q3 are answered in this file, so a reader
> checking "has the probe run?" flips this to IN-PROGRESS and is wrong. **§6 Q1 — does the H10 accept
> `SampleType.RR` — is still open**, stated as such in §6: no start command was ever sent, because that
> needs the `_ALLOWED_QUERIES` widening this brief gates. The blocker is named here so the rule and the
> thing blocking it are read together.

**DONE** when a real night produces: a live-stamped HR+GYRO stream, an onboard PPG recording covering
the same window, a verified morning pull, a decoded PSL-shaped file that PpgDex reads, and a measured
device-clock drift applied to its stamps — with the stream demonstrably uninterrupted throughout.
Follow-ups → `POLAR-ONBOARD-BACKUP-FOLLOWUPS-YYYY-MM-DD-BRIEF.md`.

---

## References

- `documentation/SdkOfflineRecordingExplained.md` (Polar BLE SDK) — the device list, the data types, the
  same-type exclusion, the HR exception, the memory limits, and "recording continues … while recording".
- `documentation/products/PolarH10.md` — "Recording supports HR with one second sampletime";
  "sensor supports only one recording at the time".
- `sources/…/PolarH10OfflineExerciseApi.kt` — `SampleType {HR, RR}`, `RecordingInterval {1S, 5S}`.
- ⚠️ The SDK is **proprietary** (`NOASSERTION` / `Polar_SDK_License.txt`) and **not a dependency** —
  read it for the wire format, do not vendor it. See `THIRD-PARTY.md` § Device protocols.
- `POLAR-OFFLINE-DOWNLOAD-2026-07-17-BRIEF.md` — the pull path, the bonding requirement, the one-BLE-link
  rule, and the finding §1 corrects.
- `capture-host/probe_polar_onboard.py` + `tests/test_probe_polar_onboard.py` — Phase 0.
