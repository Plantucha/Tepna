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

⚠️ **The wire format of the start op is NOT established.** The SDK sources carry it
(`sources/Android/.../PolarOfflineRecordingApi.kt`, `PolarH10OfflineExerciseApi.kt`, and their impls);
read it there rather than guessing a query id and its protobuf params. A wrong id on this path does
something far worse than set a clock, which is precisely why the allowlist exists.

---

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
