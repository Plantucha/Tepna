<!-- SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED (**the AS11 TRANSPORT is BUILT; this brief wires DECODE and consumers on top of it — verified 2026-09-11 (Osprey) in the tree, not from the prose.** Present: `as11_pull.py`, `as11_link.py`, `as11_cipher.py`, `as11_pair.py`, `as11_clock.py`, `cpap_spool.py`, `cpap_edf_dict.py`. Absent and therefore genuinely WU1 work: `cpap_spool_decode.py`. So no unit here should be sized as "bring up AS11 over BLE" — pairing, cipher, link, clock and the spool round-transaction all already exist and ship green; what is owed is decoding the committed Summary rounds rig-side and the consumers above it (WU2 CPAPDex-loadable, WU10 the monitor stream-rate selector, WU7 the one bundle/provenance touch). Owner: Kestrel (coordination); units go to the rig coders.) · **Created:** 2026-09-07 · **Owner:** Kestrel (coordination) — units go to the rig coders · **Scope:** out-of-suite `capture-host/` + one CPAPDex vocabulary unit; no bundle/provenance impact except WU7

# CPAP AS11 over BLE — WIRE NOW (stock firmware · BLE only · read-only RPCs)

**What the stock AirSense 11 already serves over BLE that Tepna does not yet consume — and the one thing
that changes the product: the four RC03 archived signals (`RespiratoryFlow6p25Hz` · `MaskPressure6p25Hz`
· `Leak0p5Hz` · `InspiratoryPressure0p5Hz`) are a full-night waveform history pulled through the SAME
`StartSpool`/`PullSpoolFragments` path the Summary pull already uses. That is the night's flow and
pressure with NO SD card and NO Wi-Fi harvest.** Everything in this brief runs against the firmware the
device shipped with, over the BLE session `as11_pull.establish` already opens, using only RPCs that read.
Nothing here writes to the machine — no `Set*`, no `SetDateTime`, no `EraseData`, no `ResetDevice`, no
therapy control, no upgrade path, no CAN/NCP lane, no patched firmware. Those stay out of scope by owner
rule, not by omission.

Protocol source throughout: `m-kozlowski/airbreak-plus docs/as11` (`rpc_protocol.md`, `rpc_spools.md`,
`rpc_streams.md`, `rpc_events.md`) — already the cited reference in `README.md`, `THIRD-PARTY.md` and
`RESMED-AS11-PROTOCOL-REFERENCE`. Tepna reimplements from the documentation and vendors nothing.

## 0 · Ground truth (measured 2026-09-07, read-only, on the box)

| fact | value | consequence |
|---|---|---|
| device / firmware | AirSense 11 AutoSet, application `17.8.6.0` (= the reference docs' `8.6.0`) | every RPC below is documented for this firmware line |
| BLE session | `as11_pull.establish` (RequestSession → key exchange → encrypted JSON-RPC) works nightly; `GetDateTime`, `GetItems`, `StartSpool`, `PullSpoolFragments`, `StartStream` are the builders `as11_link.py` carries | the transport is DONE; this brief adds selectors and consumers, not a link |
| stock SD schema | STR ns=78 (= `cpap_edf_dict.py`'s 78-signal contract, complete for stock), BRP 3 (`Flow.40ms`, `Press.40ms`, `Crc16`), PLD 10 (`MaskPress.2s`, `Press.2s`, `EprPress.2s`, `Leak.2s`, `RespRate.2s`, `TidVol.2s`, `MinVent.2s`, `Snore.2s`, `FlowLim.2s`, `Crc16`), SA2 3 (no oximeter — `−1` on 193/194 nights), EVE/CSL 2, **no `TCV.edf`** | the SD card is the comparator for §8; SA2 is not a lane |
| Summary spool ledger | `cpap_spool_ledger.jsonl`: **2 rounds, both 2026-09-01 10:00** — 3431 B `MORE_DATA_PENDING` + 3477 B `NO_MORE_DATA`, ~1.0 s apart; nothing since. `/api/state.cpap_spool` = `null` at 06:12 UTC 09-07 (daemon 46 min old, outside the window — expected) | ~3.4 KB per round at ~1 round/s is the only spool throughput figure Tepna has. **Why six days produced no further round is WU1's first check, not a fact this brief supplies** |
| daily pull arming | `cpap.spool_pull.enabled` · `at_hour: 10` · `window_h: 2` · `spool_type: Summary` (a scalar) · `epoch_start 2026-08-01` | `window_h` is a *scheduling* window (when the pull may run), not a device limit |
| spool sizing | `as11_link.start_spool(max_spool_size=4096)` · `pull_spool_fragments(max_fragment_size=3000)` (firmware clamps >3576) · `as11_pull.pull_spool(max_rounds=64)` | the current defaults cap one pull at **256 KB** — a Tepna parameter, not a device one; `maxSpoolSize` is a positive int32 |
| detector | `as11_detector` SHADOW; `POLL_ITEMS = FGState · MaskPressure · MachineMetrics` (`cpap_shadow_runner.py:37`) | polling, not events — WU4 |
| **prior art (doc-search, 2026-09-07)** | (a) the reference tree ships an MIT `as11_spool.py` with `rc03_decode_block` and a CLI that already pulls `RespiratoryFlow6p25Hz` to CSV; (b) the SomnoTrace firmware (public, already cited in `CPAP-BLE-CAPTURE`) runs **ONE** `StartStream` at 40 ms carrying 16 short tags — BRP `_RFL _MKP` + all 12 PLD tags + SA2 — and `SubscribeEvent` on three selectors, in production; (c) SomnoTrace measured that **Summary spool timestamps are in synced UTC, NOT the device's internal clock** (verified against its own event log) | three of this brief's original "unknowns" were already answered before it was written (§9 marks which); the RC03 decoder has an oracle; and the archive's clock domain is a hypothesis to test, not the device RTC by assumption (§8.3) |

⚠️ `config.example.yaml` says `Summary` is "the ONLY type the device is known to serve" and that a guessed
name returns `-32602`. That refutes the *guessed string*, nothing more. The names in this brief are the
documented selectors, spelled exactly; a `-32602` on one of them is a finding about that selector on this
firmware and is recorded as such, never generalised.

## 1 · Scope and non-goals

**In:** read-only RPCs over the existing encrypted BLE session; new spool selectors; the therapy-end
retrieval chain; one widened live stream carrying the PLD cadence, with a rate selector on the monitor;
event subscription in shadow; a version read; CPAPDex vocabulary; the RC03 decoder and
its validation against the SD record. **Out (forbidden, owner rule):** any write to the machine, firmware
modification, the CAN/NCP lane, SA2 oximetry (no oximeter present), SWD. **Out (not this brief):** acting
mode for the session detector (parked, `AS11-SESSION-DETECTOR-IMPLEMENTATION`); any change to WHAT the
SD/Wi-Fi harvest copies — it keeps copying the whole card and is the comparator for §8 until §8's bands
pass. Its *trigger* does change (WU9, owner ruling 2026-09-07): it runs after the spool, not before it.

## 2 · Units

Every unit below is one PR, one changeset (`capture-host` behavioural), `./check.sh` green, and a
pre-stated done-when. File anchors were verified 2026-09-07 against `origin/main` `9a362c63`.

### WU1 — decode the committed Summary rounds rig-side; explain the six-day silence
The two `.bin` rounds under `captures/cpap-spool/committed/` are pulled and hashed and READ BY NOTHING.
Add `cpap_spool_decode.py`: protobuf-wrapper walk → the documented Summary record fields (per-session
usage, AHI components, leak percentiles, pressure percentiles) → one JSON per record, `null` for any field
absent from the record (§∅). First check, before any decode: why the ledger stopped on 09-01 — read the
daemon journal for `CPAP spool pull` lines and `pull_blocked` reasons (wearables streaming through the
10:00–12:00 window is the obvious candidate; `_cpap_spool_loop` deliberately does not consume the day
when blocked). **Done when:** both rounds decode with zero unknown-field bytes left over, the decoded
usage hours match the SD `STR.edf` for the same dates to the minute, and the silence has a named cause
with a journal line quoted.

### WU9 — the therapy-end CHAIN: spool first, card second; 10:00 / 13:00 become the backup (owner ruling 2026-09-07)
Today the two retrievals are triggered differently. The Wi-Fi harvest is already **edge-triggered on
therapy end** (`_cpap_loop`: `cpap_live.observe` → `harvest_due` with `therapy_end_debounce_sec` 600 s,
seeded across restarts by `_cpap_boot_watch`), with the 13:00 window demoted to a reconciliation/retry
path (`cpap_job.should_reconcile`). The spool pull is **window-only** (`_cpap_spool_loop`: `due_now` on
`at_hour 10`/`window_h 2`, nothing else). The owner's ruling inverts the shape into ONE chain:

1. **Therapy end → spool pull, immediately** (same EndWatch edge and debounce the harvest uses — the
   detector is the single therapy-end source; do not add a second). All configured types (WU2 list, WU8
   selectors) in one BLE session, subject to the existing `pull_blocked` radio interlock: if wearables
   are still streaming, the chain WAITS (does not consume the night) and retries each minute.
2. **Spool committed → Wi-Fi harvest**, in that order, never concurrently — both are 2.4 GHz on one box
   (the measured 5–7 dB / 17-reconnect contention is why the two windows were 3 h apart). The harvest
   job's provenance records `after_spool` with the spool ledger row it followed. If the spool has not
   completed within a pre-stated bound (**30 min** from the edge — the Summary pull is seconds; WU8's
   fit band is ≤ 30 min), the harvest proceeds anyway and logs `spool_incomplete_at_harvest` — the card
   must not wait on a stalled pull, and the spool then falls to its backup window.
3. **10:00 spool window and 13:00 harvest window stay, as BACKUP** — the reconciliation shape the harvest
   already has (`should_reconcile`: a job completed for THIS night ⇒ window skipped, else the window
   runs): a night whose edge was missed (reboot across the edge, interlock never cleared, BLE session
   failure) is still collected by the clock. Neither window is removed and neither hour moves.

**Done when:** on a live night the journal shows `TherapyStop edge → spool rounds committed → harvest
started`, with the three timestamps in the night report; the 10:00 and 13:00 windows both log
`RECONCILE … skipped` for that night; and a night with the edge deliberately hidden (detector disabled
for one night — per-night config flip, Wren's grant) is collected by the windows with `daily_window`
provenance. Config: `spool_pull.on_therapy_end: true` + `cpap.harvest_after_spool: true`, both
default-off in `config.example.yaml` per the arming convention, flipped on the box by the owner's go.

### WU2 — `spool_pull.spool_type` becomes a LIST; one cursor per type
`capture.py:8828/8834` reads a scalar; `cpap_spool.make_row` already keys rows by `spool_type`, so the
ledger needs no schema change — the committed cursor becomes per-type (`committed_cursor` read back by
type, not by last row). Pull types in list order in one BLE session. Add `TherapyOneMinutePeriodic`
(family `periodic`, field 5) and `TherapyEvents-RespiratoryEvents` (family `event`, field 4) to the
configured list; §8 adds the four RC03 types. **Done when:** a config with three types produces three
independent cursors in the ledger, a failure in type 2 leaves type 1 committed and type 3 attempted, and
the daily pull still runs once per window.

### WU3 — ONE live stream carrying BRP + PLD (the SomnoTrace shape)
`cpap_stream.BRP_CHANNELS` (`cpap_stream.py:29-32`) streams `PatientFlow` + `MaskPressure` at 40 ms.
Widen that ONE `StartStream` to the 16 short tags SomnoTrace runs in production — `_RFL _MKP` (BRP),
`_MKF _MKI _MKE _LKF _RR2 _TD2 _MV2 _TGT _IE2 _SNI _FFL _INT` (PLD), `_HRT _SAO` (SA2 — parse the
columns, expect `valid:false` or constants without an oximeter attached) — at `sampleIntervalMs: 40`,
`reportIntervalMs: 200`. A slow source repeats its value at 40 ms (documented): **decimate the 2-s
channels on write**, never store 25 copies. Honour `valid:false` per dataId (unsupported ids are refused
per id, not per request) and record the refused set in the sidecar. ⚠️ **Ordering is a contract:**
`GetDateTime`, `GetVersion` (WU6) and `SubscribeEvent` (WU4) go BEFORE `StartStream` — streaming
congests the BLE ACL buffers and later request/reply RPCs fail (SomnoTrace, `as11_ble.c`); Tepna's
`pull_blocked` already keeps spool pulls off a streaming session for the same reason. Do NOT open a
second concurrent stream to get PLD — there is no `StopStream`, and the one-stream shape is proven.
**Done when:** a live night writes a PLD-shaped EDF whose 2-s channels match the SD `PLD.edf` at ≥ 99 %
of samples within 1 LSB, and the BRP channels match `BRP.edf` as they do today.

### WU4 — `SubscribeEvent` (0x3a) in SHADOW beside the poller
Builder in `as11_link.py`; selectors `UsageEvents-TherapyStatusEvents` (MaskOn/MaskOff/TherapyStart/
TherapyStop/PowerOff/…) and `TherapyEvents-RespiratoryEvents` (completion events with `reportTime`;
apnoeas carry `durationSeconds`, CSR `backdateSeconds`). Journal every notification as a row beside the
poller's verdicts; drive nothing. This is the mechanism that answers the detector's known
Standby-during-therapy defect, because it is edge-triggered where `FGState` polling is level-sampled.
**Done when:** over ≥ 3 nights every TherapyStart/Stop event has a poller transition within one poll
interval, or the discrepancy is listed per night; acting-mode promotion remains a separate owner decision.

### WU5 — widen the detector's `Get` poll
`cpap_shadow_runner.POLL_ITEMS` += `Leak`, `FlowLimitation`, `SnoreIndex` (all `GetItems`-readable on
stock). Journal only. **Done when:** the per-poll cost (ms) before/after is in the PR body and the shadow
verdicts are byte-identical to the pre-change run on the same night.

### WU6 — `GetVersion` (0x06) once per session, into the session sidecar
Firmware line is an INPUT to every decoder above (record shapes are documented per firmware). Record the
reply verbatim in the per-session sidecar; refuse nothing on mismatch, flag it. **Done when:** every BLE
session row carries the version string and a changed string reds nothing but is visible in the night
report.

### WU7 — CPAPDex EVE vocabulary + `CurrentSettings`
`cpapdex-dsp.js:863-883` maps the EVE annotations the SD writes; the RPC event vocabulary (RERA end, CSR
start/end, MaskFitStart/Stop, LearnTargets) has no row. Add the mapping (registry-tiered, badged per
§🎫), and read the settings snapshot the Summary spool carries into the night header. This unit touches
a DSP: re-bundle, `npm run check`, regen CPAPDex goldens only if an output moves (report `computeHash`).

### WU10 — a stream-rate selector on the monitor's CPAP card (owner ask, 2026-09-07)
Today `monitor.html`'s CPAP card has only **▶ Start / ■ Stop**; `POST /api/cpap/stream` accepts
`{action}` alone (`webmon.py:599`), and `cpap_stream.run_live_stream(sample_interval_ms=40)` is never
called with anything but the default — the rate is fixed at 25 Hz by omission, not by decision. The
device allows one `sampleIntervalMs` per stream, 10–65 000 ms, and `run_live_stream` already derives
`fs` from the interval (observed-over-requested, `cpap_stream.py:151-182`), so the selector is a
plumb-through: a `<select>` beside the button — **25 Hz (40 ms) · 6.25 Hz (160 ms) · 0.5 Hz (2 s)**, the
three cadences the archive and the SD record use, so a live pick can be compared 1:1 with §8's signals —
carried as `sample_interval_ms` in the POST body, validated server-side against that range (reject, never
clamp), threaded through `cpap_stream(action, …)` into `run_live_stream`, and echoed in the response and
the session sidecar. **It is the STREAM's rate, not a per-channel one:** with WU3's 16-tag stream a 2 s
pick turns `_RFL` into a 0.5 Hz pick of the flow — the card says so next to the control. Default stays
40 ms; the selection is per start, never persisted to config. Read-only, no changeset impact beyond
`capture-host` behavioural. **Done when:** a 160 ms start writes an EDF whose header rate is 6.25 Hz and
whose `observed_interval_ms` evidence is 160, and an out-of-range value returns 400 with the range named.

### Probe P — `_BYV` / `TCV`
Documented "present from firmware 8.6.0" at 40 ms; the SD card writes no `TCV.edf`. One `StartStream`
with `_BYV` in a live session; record accept/reject and, if accepted, whether values vary. Not a unit
until it answers.

## 8 · WU8 — RC03 archived signals: the full-night history without the card

### 8.1 What the device holds
Four `StartSpool` selectors of family `rc03` (`rpc_spools.md` registry rows 84–87):

| selector | field | rate | SD counterpart (comparator) |
|---|---|---|---|
| `RespiratoryFlow6p25Hz` | 18 | 6.25 Hz | BRP `Flow.40ms` (25 Hz) |
| `MaskPressure6p25Hz` | 19 | 6.25 Hz | BRP `Press.40ms` (25 Hz) |
| `Leak0p5Hz` | 20 | 0.5 Hz | PLD `Leak.2s` (0.5 Hz — **1:1**) |
| `InspiratoryPressure0p5Hz` | 21 | 0.5 Hz | PLD `Press.2s` (0.5 Hz — **1:1**) |

Record shape (documented): protobuf wrapper; inner fields `1` sample interval ms · `2` start UTC ms ·
`3` end UTC ms · `4` the RC03 block. Field 4 = one header-length byte, ASCII `RC03`, six zigzag-varint
format parameters, then the body: one or two signed LE int16 seeds, then Rice-coded zigzag **second**
differences — `sample[n] = 2·sample[n−1] − sample[n−2] + delta2[n]`; parameter 4 is the Rice modulus,
parameter 1 the scale exponent, `value = raw · 2·10^param1`. Rice detail, from the MIT reference decoder
(`airbreak-plus python/lib/as11_spool.py`, `rc03_decode_block(block, sample_count)`): parameters are
0-indexed; the modulus `m = params[4]` is a power of two; each code is a **unary run of 1-bits terminated
by a 0** (the quotient) followed by `log2(m)` remainder bits, **MSB-first**; the decoded value is
zigzag-undone before the second-difference recurrence; `sample_count` is derived from
`(end − start) / interval`, not read from the block. Retention depth is NOT documented (the reference
CLI defaults `--from-dt=-7d`, which is a client choice, not the device's) — measured in 8.4.

### 8.2 Pull path — nothing new on the wire
The four selectors go into WU2's list. `pull_spool` already loops `StartSpool(fromDateTime)` →
`PullSpoolFragments` → `nextSpoolAddress` per round, verifies `spoolHash`, commits each round's bytes
under `committed/` with a ledger row. What changes is SIZING: 8 h × 6.25 Hz = 180 000 samples per
waveform per night; the Rice body's bits/sample are unknown until measured. The first pull runs with
`maxSpoolSize` raised from 4096 to a measured value and `max_rounds` unbounded-with-a-byte-budget, and the
PR body reports **bytes per night per selector, rounds, and wall seconds** — after that the defaults are
set from the measurement, not before. (At the Summary figure of ~3.4 KB/s a 200 KB waveform is ~1 min;
if the device serves larger rounds it is faster. Either way it fits inside WU9's 30-min chain bound, and the 2 h backup window.)

### 8.3 Decoder + on-disk form
`cpap_rc03.py`: pure, injectable, 100 % branch-covered against (a) synthetic blocks encoded by a
reference encoder written from the same spec, with the MIT `rc03_decode_block` run OUT-OF-REPO as the
oracle on the same bytes (reimplemented from the spec, not vendored — the repo's own decoder must not
merely be a copy that agrees with itself), and (b) the first real block, committed as a fixture with its
hash. Outputs per night: **the committed `.bin` rounds stay as the immutable evidence**; the derived
artefact is one EDF beside the live-path files — 4-s data records (25 samples for the 6.25 Hz signals,
2 for the 0.5 Hz ones), physical scaling from `param1`, one signal per selector, session boundaries as
EDF+ annotations.

**Timestamps — the clock DOMAIN of fields 2/3 is unknown and is measured, not assumed.** Two hypotheses,
pre-stated: **(A)** device RTC — the same clock that stamps the SD EDF headers (−21.30 min vs box UTC on
this machine, `AS11-CLOCK-DISCIPLINE`); **(B)** synced UTC — SomnoTrace found the *Summary* spool's
timestamps are NTP-synced epoch ms, NOT the internal clock, and `GetDateTime.clock_drift_ms` does not
apply to them; the archive family may share that domain. The discriminator is the SD comparator's lag
(8.4 "alignment"): ≈ 0 ⇒ A; ≈ the AS11CLOCK offset ⇒ B; anything else is a finding. Either way the
stamps become floating `tMs` per the Clock Contract, the hypothesis that held and the measured lag ride
in the sidecar (`clockDomain: 'device' | 'synced-utc'`, `offsetVsSdMs`), and **no sample time is
"corrected"** — the correction is a consumer's, at the boundary.

**§∅ applies with force here.** Between blocks (mask off, power off) there are no samples: the EDF
carries the gap as the EDF physical-minimum sentinel declared in the header AND a span list in the
sidecar; a consumer reads the span list, never the sentinel. From the FIRST night, the run-length
signature (`§∅`, keyed on run length, never on value) runs over every decoded signal and its verdict is
in the PR body — the RC03 body's own "not measured" representation, if it has one, is found by that
test, not assumed.

### 8.4 Validation — bands stated BEFORE the first pull
Comparator night: any night with both the SD record (harvest unchanged) and a BLE archive pull. Pairing
is by the raw timestamps on both sides with NO offset applied — the alignment row below is what measures
the offset, so applying one first would erase the measurement (8.3's two hypotheses).

| check | band | fail means |
|---|---|---|
| block self-consistency | `n_samples == (end−start)/interval` ± 1 for every block; Σ block spans == STR therapy duration ± 1 min | wrapper or seed parse wrong |
| `Leak0p5Hz` vs PLD `Leak.2s` | ≥ 99 % of paired samples within 1 LSB of the PLD scale; r ≥ 0.99 | scale exponent or Rice decode wrong |
| `InspiratoryPressure0p5Hz` vs PLD `Press.2s` | same band | same |
| `MaskPressure6p25Hz` vs BRP `Press.40ms` 4:1 | r ≥ 0.98 under BOTH 4:1 mean and 4:1 pick (the device's own reduction is undocumented — the better one is reported and NAMED); RMS residual ≤ 0.2 cmH₂O | the firmware archives something other than a reduction of the BRP stream |
| `RespiratoryFlow6p25Hz` vs BRP `Flow.40ms` 4:1 | r ≥ 0.95 (flow has energy above 3.1 Hz Nyquist); minute ventilation from the archived flow vs PLD `MinVent.2s` within 10 % per 2-s bin median | as above |
| alignment (clock domain) | cross-correlation peak, both 6.25 Hz signals, on the same night: **A** lag = 0 ± 1 archived sample (160 ms) ⇒ fields 2/3 are device-clock; **B** lag = the night's AS11CLOCK offset (−21.30 min class, read from the sidecar, not this number) ± 1 s ⇒ synced UTC. The two bands are ~20 min apart, so one night decides; the verdict is written to the sidecar as `clockDomain` | neither band: field 2 is not the first sample's time, or a third clock — a finding, recorded, not fitted |
| retention | pull from `fromDateTime = epoch_start` (2026-08-01): the earliest block returned dates the archive's depth; report it | — (a measurement, not a pass/fail) |
| fit | full pull of all four ≤ 30 min wall, inside the window, Summary untouched | sizing defaults wrong — re-measure, do not guess |

A band that fails is a finding to record, not a threshold to move. A band that passes on one night is a
result for one night; the unit is DONE at **three** consecutive comparator nights green.

### 8.5 The deliverable, and what it does NOT change
When 8.4 holds, a night with no SD card in the machine and no Wi-Fi harvest still yields flow, mask
pressure, leak and inspiratory pressure for the whole night from the therapy-end pull (WU9; 10:00 is the
backup), plus the 1-minute
periodic and respiratory events from WU2 — CPAPDex-loadable. **The SD harvest is not retired by this
brief.** Retiring it is an owner decision after the retention depth and a month of comparator nights are
on the table; until then the card stays in and the two records are diffed nightly by the night report.

## 9 · Unknowns (each is a probe with a recorded answer, not an assumption)
1. ~~Second concurrent `StartStream` accepted?~~ — **moot**: one stream carries everything (SomnoTrace,
   in production). Not probed.
2. ~~Short `_XXX` tags accepted in `dataIds`?~~ — **answered before this brief existed**: yes, all 16
   (doc-search, 2026-09-07). Tepna still records the `valid` flags per id on its own firmware line.
3. RC03 selectors on firmware `17.8.6.0`: accepted, or `-32602` per selector? (WU8, first pull)
4. RC03 retention depth (8.4). 5. RC03 bytes/night (8.2). 6. `_BYV` presence (P).
7. Whether the device's 6.25 Hz is a mean or a pick of the 25 Hz stream (8.4).
8. **Clock domain of RC03 fields 2/3** — device RTC or synced UTC (8.3/8.4; SomnoTrace's Summary finding
   makes B live, it does not decide it for the archive family).
9. Whether the interlock clears soon enough after therapy end for the chain to run before the wearables'
   own morning (WU9 — the first three nights' `pull_blocked` durations answer it).

## 10 · Order
WU1 → WU2 (+ **WU8 pull-only**: get the bytes on disk the first night the list lands — the decoder can
follow, the archive cannot be re-captured if retention is short) → **WU9** (the chain — it is the owner's
ruling and it changes when every pull above runs) → WU8 decoder + validation → WU5 + WU6 → WU4 → WU3 →
WU10 → P → WU7. WU8's pull moves ahead of everything except the list it rides on because retention depth
is unknown and every night not pulled may be a night lost. WU10 waits for WU3 because the selector's
"stream rate, not channel rate" caveat only exists once the stream carries the PLD tags.

## 11 · Owner decisions carried in this brief
- **DECIDED 2026-09-07 (owner, in-session):** spool transfers immediately after therapy ends; the Wi-Fi
  card is pulled after the spool is recorded; 10:00 (spool) and 13:00 (card) stay as backup. That is WU9
  verbatim — do not re-ask. **Also asked:** a frequency selector on the monitor's CPAP card — WU10.
- WU2/WU8 change the nightly BLE session's shape (more selectors, more bytes, a longer session at therapy
  end) — per-night config flips are Wren's scoped grant; the arming of the new list and of
  `on_therapy_end` / `harvest_after_spool` is an owner "go" on the first morning.
- Retiring the SD/Wi-Fi harvest (8.5) — owner, after the evidence, not proposed here.
- Acting-mode promotion of the event-driven detector (WU4) — parked, separate decision.

**Residue:** none yet — this brief has not been executed.
