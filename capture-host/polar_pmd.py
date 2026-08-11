# tepna-capture — polar_pmd.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Polar Measurement Data (PMD) service: control-point start commands + data-frame decoders for
# ECG / ACC / PPG. This decodes the COMMON, uncompressed frame types fully (ECG type-0 especially —
# the mandatory stream).
#
# WIRE FORMAT, not vendor code. Original interoperability implementation written against the PMD
# specification Polar publishes with its BLE SDK (`NOASSERTION` / `Polar_SDK_License.txt` —
# proprietary, and NOT a dependency of this repo: nothing here links to, vendors, or redistributes
# it). UUIDs, opcodes and frame layouts are protocol facts. See `THIRD-PARTY.md` § Device protocols.
#
# ── STATUS: both caveats this header used to carry are now CLOSED (corrected 2026-08-04) ──────────
# The text here read "UNVERIFIED ON HARDWARE" and named the missing delta decoder as "the one open gap,
# and the only thing that would reopen the SDK question". Both statements outlived their truth by weeks
# and were still being read as current, which is exactly how a settled question gets reopened:
#
#   • COMPRESSED (delta) FRAMES ARE DECODED. `_decode_delta` / `_decode_delta_ex` (below) implement the
#     LSB-first bit-packed reference+deltas layout, `decode_frame` dispatches on the PMD high bit
#     (`frame_type & 0x80`), and `tests/test_polar_pmd.py` pins both with known-answer vectors. Landed
#     in `487407bf` (Verity PPG delta decoder) and hardened in `01b99a3c` (a truncated frame is a GAP,
#     never a guessed sample). So the condition this header set for reopening the Polar-SDK question
#     was met and passed — see `POLAR-SDK-CAPTURE-2026-07-07-BRIEF.md`, closed on that basis.
#   • IT IS VERIFIED ON HARDWARE. The daemon captures nightly on the Vigil box; measured rates match
#     the negotiated ones (ECG 129.94 Hz vs 130, H10 ACC 50.72 vs 50, Verity PPG 55.11 vs 55) and the
#     largest inter-sample gap on every stream equals exactly one sample period
#     (VIGIL-OBSERVED-ERRORS-2026-07-20 §"What was confirmed HEALTHY").
#
# ⚠️ STILL TRUE, and the reason this block is not simply deleted: the start-command TLVs (sample rate /
#    resolution / range) must match what the device's `requestStreamSettings` (control op 0x01) reports
#    for YOUR firmware — query first if a START is rejected. On new firmware or a new device, capture a
#    few frames raw and diff against PSL output before relying on a night.

from __future__ import annotations
import struct, datetime as _dt
from dataclasses import dataclass

PMD_SERVICE = "fb005c80-02e7-f387-1cad-8acd2d8df0c8"
PMD_CONTROL = "fb005c81-02e7-f387-1cad-8acd2d8df0c8"   # write + indicate
PMD_DATA    = "fb005c82-02e7-f387-1cad-8acd2d8df0c8"   # notify

# Measurement types (Polar PMD spec). ECG/PPG on H10/Verity; ACC/GYRO/MAG/PPI on Verity (IMU + onboard
# peak-interval). GYRO=5, MAG=6 per the SDK enum (4 is reserved). PPI (3) is an EVENT stream (per-beat),
# not an evenly-sampled waveform.
ECG, PPG, ACC, PPI, GYRO, MAG = 0x00, 0x01, 0x02, 0x03, 0x05, 0x06

# Control-point ops + a human name per measurement type (for logs / stream labels).
_OP_GET_SETTINGS, _OP_START, _OP_STOP = 0x01, 0x02, 0x03
MEAS_NAME = {ECG: "ecg", PPG: "ppg", ACC: "acc", PPI: "ppi", GYRO: "gyro", MAG: "mag"}

# PMD control-point response status codes (for readable logs / diagnosing a rejected START).
CTRL_STATUS = {0x00: "ok", 0x01: "invalid_op", 0x02: "invalid_meas", 0x03: "not_supported",
               0x04: "invalid_length", 0x05: "invalid_parameter", 0x06: "already_streaming",
               0x07: "invalid_resolution", 0x08: "invalid_sample_rate", 0x09: "invalid_range",
               0x0A: "invalid_mtu", 0x0B: "invalid_channels", 0x0C: "invalid_state", 0x0D: "in_charger",
               -1: "no_response"}

# ── NOT EVERY CONTROL-POINT NOTIFICATION IS A RESPONSE ───────────────────────────────────────────────
# A response begins 0xF0 and echoes [op, meas, status, more]. The device ALSO pushes unsolicited frames
# on the same characteristic, and they do not: `ONLINE_MEASUREMENT_STOPPED` starts with 0x01 and carries
# the measurement types the device just stopped by itself (charger, battery, mode change, button). It is
# the ONLY signal that a stream died at the device rather than on the link — there is no other.
#
# Reading one as a response desynchronises the whole request/response pairing: the caller returns the
# stop notification as the answer to whatever it just asked, and the real answer is then thrown away by
# the next call's queue drain. So the discriminator has to exist before anything reads the queue.
CTRL_RESPONSE_MARKER = 0xF0
SVC_ONLINE_MEASUREMENT_STOPPED = 0x01


def is_control_response(data: bytes) -> bool:
    """True when `data` is a control-point RESPONSE (0xF0 …) rather than a device-pushed notification.

    Deliberately not `not is_stop_notification(...)`: an unknown future service-to-client opcode is
    neither, and must be treated as "not a response" so it can never be handed back as one."""
    return len(data) >= 2 and data[0] == CTRL_RESPONSE_MARKER


def stopped_measurements(data: bytes) -> list[int] | None:
    """The measurement types in an `ONLINE_MEASUREMENT_STOPPED` push, or None if this is not one.

    An empty list is a real reading — the device said "something stopped" and named nothing — and is
    NOT None, which means "this frame is not a stop notification at all"."""
    if len(data) < 1 or data[0] != SVC_ONLINE_MEASUREMENT_STOPPED:
        return None
    return [b & 0x3F for b in data[1:]]


ALREADY_STREAMING = 0x06
# NO ANSWER IS NOT A REJECTION. A control-point indication can be lost (BlueZ drops notifications that
# share a connection interval — bleak#1343), or the control channel may never have subscribed at all. The
# caller gets no verdict — which must NOT be filed as "bad settings", because that answer tears the stream
# down permanently while the truthful answer is "ask again".
NO_ACK = -1

# A PMD control ACK splits three ways, and the difference is behavioural, not cosmetic:
#   STARTED   — streaming (or already was). Register the stream at the negotiated rate.
#   TRANSIENT — the request was VALID; the device just can't serve it right now. `in_charger` is the one
#               that bites: a Polar on its dock refuses every START, and the caller must NOT interpret
#               that as bad settings. Doing so used to delete the stream's file and unregister its card
#               — and because the BLE link survives charging, nothing re-ran the negotiation, so the
#               streams stayed dead after the sensor came off the dock. Retry instead; never tear down.
#   otherwise — genuinely rejected settings (bad rate/range/channels). Dropping the stream is correct.
STARTED_STATUS = frozenset({0x00, 0x06})            # ok, already_streaming
TRANSIENT_STATUS = frozenset({0x0C, 0x0D})          # invalid_state, in_charger

# ⚠️ THE TWO TRANSIENTS ARE NOT INTERCHANGEABLE, and a caller that treats them as one will be wrong in a
# way that costs recordings. `in_charger` is a DEVICE state — it is true of the whole sensor and every
# stream on it. `invalid_state` is a MEASUREMENT state — this one stream cannot start right now, and it
# says nothing at all about the device. Measured 2026-08-02: a Verity answers `invalid_state` to PPI
# permanently, and because capture.py read any transient as "charging", that per-stream refusal set a
# device-level charging flag, ended the session, and re-negotiated the whole device every ~60 s all
# night. Retry-don't-drop is right for both; "the device is charging" is right for exactly one.
IN_CHARGER = 0x0D
INVALID_STATE = 0x0C


def is_started(status: int) -> bool:
    """True when a START ACK means the stream is live (or was already)."""
    return status in STARTED_STATUS


def is_transient(status: int) -> bool:
    """True when a START ACK reflects a temporary DEVICE STATE, not a bad request — retry, don't drop."""
    return status in TRANSIENT_STATUS


def parse_features(value: bytes) -> set[int]:
    """PMD Control-point READ → the set of measurement types the device supports. Response is a
    control-feature flag (0x0F) then a little-endian bitmask; bit i set ⇒ measurement type i supported."""
    if not value:
        return set()
    bits = value[1:] if value[0] == 0x0F else value
    return {byte_i * 8 + bit for byte_i, b in enumerate(bits) for bit in range(8) if (b >> bit) & 1}


# PMD setting ids — the same axes Polar Sensor Logger exposes in its per-stream dialog.
SETTING_NAME = {0x00: "rate_hz", 0x01: "resolution_bits", 0x02: "range", 0x04: "channels"}


def get_settings_cmd(meas: int) -> bytes:
    """Control-point write asking the device to report the stream settings it supports for `meas`."""
    return bytes([_OP_GET_SETTINGS, meas])


def stop_cmd(meas: int) -> bytes:
    """Control-point STOP — clears any stale stream left running from a prior session (BLE PMD state
    persists across BleakClient reconnects, so a fresh START returns 'already_streaming' as a no-op).

    ⚠️ STOP IS NOT SYMMETRIC WITH START, and the device is emphatic about it. START carries the
    recording-type bit (`as_offline`); STOP does NOT — there is exactly one STOP per measurement type
    and it takes the BARE type. Measured 2026-08-02: sending `03 82` (stop, ACC | 0x80) to a real
    Verity is rejected at the GATT layer with `Unlikely Error (0x0E)` — not a control-point ACK with an
    error status, an outright protocol refusal. The SDK agrees (BlePMDClient.kt:475,
    `stopMeasurement(type) -> byteArrayOf(type.numVal)`); the symmetry was an inference, and the
    hardware disproved it before any of this shipped."""
    return bytes([_OP_STOP, meas])


# ── OFFLINE RECORDING (record to the device's own flash) ────────────────────────────────────────────
#
# The Verity's onboard recording is NOT PS-FTP — it is the ordinary control-point START/STOP with ONE
# BIT set on the measurement-type byte. From the SDK (BDBleApiImpl.kt:2011 →
# `client.startMeasurement(type, settings, PmdRecordingType.OFFLINE, secret)`), and PmdRecordingType.kt
# is the entire encoding:
#     enum class PmdRecordingType(val numVal: UByte) { ONLINE(0u), OFFLINE(1u);
#         fun asBitField(): UByte = (this.numVal.toUInt() shl 7).toUByte() }   // OFFLINE => 0x80
# So the same negotiated START command that drives a live stream records to flash instead, and the
# settings payload is unchanged. See POLAR-ONBOARD-BACKUP-2026-08-01-BRIEF §4a.
#
# ⚠️ ONE DATA TYPE CANNOT BE BOTH (brief §2). Starting an offline recording of PPG means there is no
# live PPG — `ERROR_ALREADY_IN_STATE`. HR is the documented exception, and it rides the Heart Rate
# Service rather than PMD, so it is not expressible here at all.
OFFLINE_BIT = 0x80


def as_offline(cmd: bytes) -> bytes:
    """Retarget a control-point START/STOP at the device's flash instead of the live link.

    Pure and total: it sets bit 7 of the measurement-type byte (cmd[1]) and touches nothing else, so a
    command built by `build_start`/`START`/`stop_cmd` keeps its negotiated settings verbatim."""
    if len(cmd) < 2:
        raise ValueError("not a control-point measurement command")
    return bytes([cmd[0], cmd[1] | OFFLINE_BIT]) + cmd[2:]


def is_offline_cmd(cmd: bytes) -> bool:
    """True when a control-point command targets onboard recording rather than the live stream."""
    return len(cmd) >= 2 and bool(cmd[1] & OFFLINE_BIT)


def meas_of(cmd: bytes) -> int:
    """The measurement type a control-point command targets, with the recording-type bit stripped."""
    if len(cmd) < 2:
        raise ValueError("not a control-point measurement command")
    return cmd[1] & ~OFFLINE_BIT


# ── measurement status (command 5) — what is the device ACTUALLY doing right now? ───────────────────
#
# The only honest way to confirm a recording started: ask the device, rather than trusting the ACK.
# Response layout mirrors the other control-point replies ([0xF0, op, ...]); each measurement byte
# carries the type in its low bits and the ACTIVE STATE in its top two (PmdActiveMeasurement.kt:
# `MEASUREMENT_BIT_MASK = 0xC0`, value `shr 6`).
_OP_STATUS = 0x05
NO_MEASUREMENT, ONLINE_ACTIVE, OFFLINE_ACTIVE, ONLINE_AND_OFFLINE = 0, 1, 2, 3
ACTIVE_NAME = {NO_MEASUREMENT: "none", ONLINE_ACTIVE: "online",
               OFFLINE_ACTIVE: "offline", ONLINE_AND_OFFLINE: "online+offline"}


def status_cmd() -> bytes:
    """Control-point write asking which measurements are active, online and/or offline."""
    return bytes([_OP_STATUS])


def parse_status_response(value: bytes) -> dict[int, int]:
    """Parse a control-point status reply → {measurement type: active state}.

    Tolerates the two framings the control point uses — a bare payload, and the `0xF0` envelope —
    because reading the envelope wrong would report every stream as inactive, which is exactly the
    false "it did not start" this command exists to rule out.

    ⚠️ THE ENVELOPE IS 5 BYTES AND THE STATUS IS BYTE 3. This read `body[3:]`, i.e. it began parsing AT
    the status byte, and it never looked at the status at all. Two consequences, both measured on an
    H10 2026-08-10:

      · An ERROR reply became DATA. The H10 does not implement op 5 and answers `f0 05 00 01` —
        `ERROR_INVALID_OP_CODE`. The old code returned `body = b"\\x01"`, read `0x01 & 0x3F = 1 = PPG`,
        and reported `{ppg: "none"}` — a measurement state, for a stream this device does not have, out
        of an error code. `is_recording()` consumes exactly this dict.
      · A SUCCESS reply gained a phantom. Parsing from index 3 reads the status byte `0x00` as
        `meas 0 = ECG, state = none`, so every enveloped reply carried an ECG entry it never contained.

    The layout is from the SDK, not inferred: `PmdControlPointResponse.kt` —
    `responseCode=data[0]  opCode=data[1]  measurementType=data[2]  status=data[3]`, and
    `parameters = data.copyOfRange(5, size)` **only when status == SUCCESS**; on any error the SDK
    leaves parameters EMPTY. Same header `parse_settings_response` was already verified against on
    hardware ([0xF0, op, meas, status, moreFlag, …]).

    An error therefore yields `{}` — "the device did not tell us", which `is_recording` already reads
    as not-recording. That is the honest direction: the alternative invents activity from an error."""
    if not value:
        return {}
    body = value
    if body[0] == 0xF0:
        if len(body) < 4 or body[3] != 0x00:      # not SUCCESS ⇒ the reply carries no parameters
            return {}
        body = body[5:]                            # [0xF0, op, meas, status, moreFlag, <payload>]
    out: dict[int, int] = {}
    for b in body:
        meas, state = b & 0x3F, (b & 0xC0) >> 6
        if meas in MEAS_NAME:
            out[meas] = state
    return out


def is_recording(status: dict[int, int], meas: int) -> bool:
    """True when `meas` is recording to flash (whether or not it is also streaming live)."""
    return status.get(meas, NO_MEASUREMENT) in (OFFLINE_ACTIVE, ONLINE_AND_OFFLINE)


# ── SDK MODE — the same hardware, with a much larger settings menu ──────────────────────────────────
#
# SDK mode is not a measurement; it is a DEVICE MODE, started and stopped with the ordinary START/STOP
# opcodes against the reserved type `0x09`. Measured on a Verity Sense (`POLAR-VERITY-DEVICE-SURFACE`
# §4, `POLAR-PMD-COMMAND-SURFACE` §2.2a) — what changes is what `get_settings_cmd` then ANSWERS:
#
#     stream   normal            in SDK mode
#     PPG      55                28 / 44 / 55 / 135 / 176
#     ACC      52                26 / 52 / 104 / 208 / 416, ±2/4/8/16 G
#     GYRO     52                26 / 52 / 104 / 208 / 416, ±250…2000 dps
#
# ⚠️ FOUR PROPERTIES, EACH WITH ITS OWN WAY OF WASTING A NIGHT:
#
# 1. **It does not survive a power cycle, and the device is the only authority on whether it is on.**
#    So it must be re-entered on EVERY connect and confirmed with `sdk_mode_status_cmd()` — never
#    assumed from the fact that the command was sent. Same discipline the clock needed: the Verity
#    accepts `SET_LOCAL_TIME`, echoes it back, and stamps samples from a different clock entirely
#    (`POLAR-PMD-COMMAND-SURFACE` §2.1). An ACK is not a state.
# 2. **Every stream must be STOPPED first**, or the device answers `ERROR_INVALID_STATE` (0x0C) and
#    stays in normal mode. ⚠️ 0x0C is in `TRANSIENT_STATUS`, so a caller that only asks `is_transient`
#    reads that refusal as "try again later" and records the whole night at 55 Hz believing it asked
#    for 176.
# 3. **Entering it INVALIDATES a settings menu already read.** `capture.py` queries settings and starts
#    from them; SDK mode entered between those two steps leaves the menu stale. Enter FIRST, then query.
#    The mirror-image bug is documented: an OFFLINE start built from the ONLINE menu is answered
#    `invalid_sample_rate` (`POLAR-VERITY-DEVICE-SURFACE` §4).
# 4. **Offline recording stays capped at 13/26/52 Hz regardless**, so SDK mode buys nothing on flash.
#
# `0x09` is deliberately absent from `MEAS_NAME` — it is a mode, and `webmon` decides what is capturable
# with `not str(x).startswith("0x")`, so naming it there would offer it to the user as a stream
# (gate-locked by `test_capability_flags_are_not_offered_as_streams`).
SDK_MODE = 0x09
_OP_SDK_STATUS = 0x06


def sdk_mode_cmd(on: bool) -> bytes:
    """START (`02 09`) or STOP (`03 09`) SDK mode. Measured; `POLAR-VERITY-DEVICE-SURFACE` §4."""
    return bytes([_OP_START if on else _OP_STOP, SDK_MODE])


def sdk_mode_status_cmd() -> bytes:
    """Control-point write asking whether SDK mode is currently on."""
    return bytes([_OP_SDK_STATUS])


def parse_sdk_mode_status(value: bytes) -> bool | None:
    """Is SDK mode on? `True`/`False`, or **`None` when the reply does not say**.

    ⚠️ `None` IS NOT `False`, and collapsing the two is how this fails silently. A device that never
    answered, answered an error, or answered a shape we do not recognise has told us nothing — calling
    that "off" makes a caller re-send the enter command every cycle to a device already in SDK mode, and
    publishes `sdk_mode: false` in status while the negotiated rates say otherwise. The reply does not
    fit the usual envelope (`POLAR-PMD-COMMAND-SURFACE` §3.2): a real one is `f0 06 09 00 00 <flag>`,
    and the flag is the LAST byte."""
    if len(value) < 4 or value[0] != 0xF0 or value[1] != _OP_SDK_STATUS:
        return None
    if value[3] != 0x00:                       # a non-zero status is an error, not an answer
        return None
    return bool(value[-1])


def parse_settings_response(value: bytes) -> dict[int, list[int]]:
    """Parse a control-point response to get_settings → {setting_id: [offered values]}. Layout (verified
    on a Verity Sense 2026-07-16): [0xF0, op, meas, status, moreFlag, <setting_id, count(u8),
    value×count> ...]. Values are u16 EXCEPT CHANNELS (0x04) which is u8. Empty on error/short."""
    if len(value) < 5 or value[0] != 0xF0 or value[3] != 0x00:
        return {}
    out: dict[int, list[int]] = {}
    i = 5                                   # skip [0xF0, op, meas, status, moreFlag]
    while i + 2 <= len(value):
        sid, count = value[i], value[i + 1]
        i += 2
        width = 1 if sid == 0x04 else 2     # CHANNELS is a single byte; sample-rate/resolution/range are u16
        vals = []
        for _ in range(count):
            if i + width > len(value):
                break
            vals.append(value[i] if width == 1 else value[i] | (value[i + 1] << 8))
            i += width
        out[sid] = vals
    return out

# Default stream settings as control-point START commands (op 0x02). TLV = [setting_id, count, value...].
# setting_id: 0x00=SAMPLE_RATE, 0x01=RESOLUTION, 0x02=RANGE, 0x04=CHANNELS.
# Value width matters: SAMPLE_RATE/RESOLUTION/RANGE are u16; CHANNELS is u8 (a trailing u16 byte makes
# the Verity reject START with 0x05 ERROR_INVALID_PARAMETER — verified on hardware 2026-07-16). Pass a
# 3-tuple (setting_id, value, width_bytes) to override the default u16.
def _start_cmd(meas: int, *tlvs) -> bytes:
    body = bytearray([0x02, meas])
    for tlv in tlvs:
        setting_id, value = tlv[0], tlv[1]
        width = tlv[2] if len(tlv) > 2 else 2
        body += bytes([setting_id, 0x01])
        body += struct.pack("<B", value) if width == 1 else struct.pack("<H", value)
    return bytes(body)

START = {
    # H10 ECG: 130 Hz, 14-bit.
    ECG: _start_cmd(ECG, (0x00, 130), (0x01, 14)),
    # Verity PPG: 55 Hz / 22-bit / 4 channels (3 LEDs + ambient). CHANNELS (0x04) is MANDATORY and its
    # value is a SINGLE byte — omit it → 0x0B ERROR_INVALID_NUMBER_OF_CHANNELS; send it as u16 → 0x05
    # ERROR_INVALID_PARAMETER. `04 01 04` (u8) is what the Verity accepts (verified on hardware; data flows).
    PPG: _start_cmd(PPG, (0x00, 55), (0x01, 22), (0x04, 4, 1)),
    # ACC: 200 Hz, 16-bit, ±8G, 3 channels (channels u8, same rule as PPG).
    ACC: _start_cmd(ACC, (0x00, 200), (0x01, 16), (0x02, 8), (0x04, 3, 1)),
    # GYRO (Verity): 52 Hz, 16-bit, ±2000 dps, 3 channels. MAG: 50 Hz, 16-bit, 3 channels (range is
    # negotiated). PPI: an event stream — no settings, START is just [op, meas]. These are FALLBACKS;
    # capture.py first asks the device (get_settings) and calls build_start() so real firmware values win.
    GYRO: _start_cmd(GYRO, (0x00, 52), (0x01, 16), (0x02, 2000), (0x04, 3, 1)),
    MAG:  _start_cmd(MAG, (0x00, 50), (0x01, 16), (0x04, 3, 1)),
    PPI:  _start_cmd(PPI),
}
SAMPLE_HZ = {ECG: 130, PPG: 55, ACC: 200, GYRO: 52, MAG: 50, PPI: 0}  # PPI irregular (0 → per-beat, not back-timed)

# PROJECT-CHOSEN sample rates, used when the device offers them (else max). Picked for what the suite
# actually computes, not for the highest number the hardware can do — every extra Hz is disk, BLE airtime
# and battery for a night that is already ~1.2 GB.
#   ACC 50  — actigraphy convention, and ample for everything MotionDex plans: body position (gravity, a
#             sub-Hz signal), activity counts, and thoraco-abdominal respiratory effort (0.1-0.5 Hz).
#             Leaves headroom for gait/step harmonics (~10 Hz). NOTE the old value here was 52, which the
#             H10 does not offer (it lists 25/50/100/200) — so it fell through to max() and ran at 200 Hz,
#             369 MB/night, 30 % of everything the box wrote. 50 Hz costs 90 MB.
#   MAG 20  — heading changes slowly in bed and body POSITION comes from the ACC gravity vector, not the
#             magnetometer; 20 Hz is still well above what any of it needs. 96 MB -> 38 MB.
#   ECG 130 / PPG 55 / GYRO 52 — the only rate those devices offer; listed for completeness.
_PREF_RATE = {ECG: 130, PPG: 55, ACC: 50, GYRO: 52, MAG: 20}


def chosen_rate(meas: int, settings: dict[int, list[int]], prefer: int | None = None) -> int:
    """The sample rate build_start() will select for this meas (for back-timing + ring sizing).

    `prefer` is a user choice (config `devices[].rates`). It is HONOURED ONLY IF THE DEVICE OFFERS IT —
    an unsupported rate would be rejected at START and leave a permanently idle stream, so an
    unofferable choice degrades to the NEAREST rate the device does offer rather than breaking capture.

    ⚠️ NEAREST, NOT MAX. This fell back to `max(rates)`, i.e. the most EXPENSIVE entry on the menu, for
    any target the device does not list. A project preference is not a device capability: `_PREF_RATE`
    asks ACC for 50 and a Verity Sense offers [26, 52, 104, 208, 416], so the nearest sane answer is 52
    and the old code chose 416 — eight times the rate, ~20 MB/h instead of ~2.5, for a stream whose
    consumer is a 4 Hz motion grid that cannot use anything above ~52. Measured on the box 2026-08-10:
    the Verity streamed ACC at 416 Hz for ten hours purely because its menu has no 50 in it.

    Ties go to the LOWER rate: cheaper in battery, radio and disk, and nothing in this suite needs the
    headroom. "The device does not offer what we asked for" means "pick the closest thing it does",
    never "pick the biggest".

    An EMPTY menu is a different case and deliberately keeps the vendor default: `build_start` only
    emits a rate TLV when the device reported a menu, so with none the device runs at its own default
    and `SAMPLE_HZ` is what actually happens. Returning the configured value there would be a claim
    about the wire that is not true — capture.py warns about that mismatch separately."""
    rates = settings.get(0x00) or []
    if not rates:
        return SAMPLE_HZ.get(meas, 0)
    target = prefer if prefer is not None else _PREF_RATE.get(meas)
    if target is None:
        return max(rates)                       # no preference expressed for this measurement at all
    if target in rates:
        return target
    return min(rates, key=lambda r: (abs(r - target), r))


def build_start(meas: int, settings: dict[int, list[int]], prefer: int | None = None) -> bytes | None:
    """Build a START from the device's OWN reported settings (get_settings): preferred-or-max sample rate,
    first offered resolution/range, and the device-reported channel count. Only settings the device
    actually reports are included — so ECG (no channels/range) gets none. Falls back to the fixed table."""
    if not settings:
        return START.get(meas)
    tlvs: list[tuple] = []
    if settings.get(0x00):
        tlvs.append((0x00, chosen_rate(meas, settings, prefer)))
    if settings.get(0x01):
        tlvs.append((0x01, settings[0x01][0]))
    if settings.get(0x02):
        tlvs.append((0x02, settings[0x02][0]))
    if settings.get(0x04):
        tlvs.append((0x04, settings[0x04][0], 1))     # device-reported channel count (u8)
    return _start_cmd(meas, *tlvs)


@dataclass
class Sample:
    phone: _dt.datetime   # host arrival time for THIS sample (local civil), back-timed within the frame
    sensor_ns: int        # Polar ns (since 2000-01-01) for this sample
    t_ms: float           # PSL "timestamp [ms]" = sensor_ns / 1e6
    values: tuple         # ecg:(uv,) | acc/gyro/mag:(x,y,z) | ppg:(c0,c1,c2,ambient) | ppi:(hr,pp_ms,err_ms,flags)


# PMD payloads carry RAW signed integers for GYRO/MAG. The device tells us its full-scale RANGE
# (setting 0x02) and RESOLUTION (0x01) during negotiation, and one raw LSB is range / 2^(bits-1) of the
# physical unit. Applying it is NOT optional: with range=2000 the Verity's raw gyro reaches 6000, i.e.
# OUTSIDE its own ±2000 dps configuration, and a resting arm reads a impossible 47 dps instead of the
# real ~2.9 dps zero-bias (measured over a full night, 2026-07-19).
#
# ⚠️ ACC IS THE EXCEPTION AND MUST NOT BE SCALED — Polar delivers it already in mg. Verified: per-sample
# gravity magnitude is 1000.9 mg on a resting H10 (it must read 1 g). Scaling it "for consistency" with
# GYRO/MAG breaks the one IMU stream that was always correct. ECG (µV) and PPG (raw counts) likewise
# pass through untouched.
DEFAULT_RANGE = {GYRO: 2000, MAG: 50}      # dps / gauss — the Verity's own offer; used when settings are absent
DEFAULT_RESOLUTION_BITS = 16


def axis_scale(meas: int, settings: dict[int, list[int]] | None = None) -> float:
    """Factor converting one raw PMD integer to the stream's physical unit — dps for GYRO, gauss for MAG,
    1.0 for every stream Polar already delivers in physical units. `settings` is a
    parse_settings_response() dict; falls back to DEFAULT_RANGE when the device reported none."""
    if meas not in DEFAULT_RANGE:
        return 1.0
    s = settings or {}
    rng = (s.get(0x02) or [DEFAULT_RANGE[meas]])[0] or DEFAULT_RANGE[meas]
    bits = (s.get(0x01) or [DEFAULT_RESOLUTION_BITS])[0] or DEFAULT_RESOLUTION_BITS
    return rng / float(1 << (bits - 1))


def _i24(b: bytes, o: int) -> int:
    v = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)
    return v - (1 << 24) if v & 0x800000 else v


def _decode_delta(payload: bytes, channels: int, ref_bits: int) -> list[tuple]:
    """Polar PMD compressed/delta frame — see _decode_delta_ex. Returns only the samples, so every
    existing caller and known-answer test is unaffected."""
    return _decode_delta_ex(payload, channels, ref_bits)[0]


def _decode_delta_ex(payload: bytes, channels: int, ref_bits: int) -> tuple[list[tuple], bool]:
    """Polar PMD compressed/delta frame (frame_type high bit 0x80). Layout: one full reference sample
    (`channels` × `ref_bits` signed, LSB-first) then repeated blocks — [deltaSize:u8][sampleCount:u8]
    followed by sampleCount×channels deltas of `deltaSize` bits (signed), each accumulated onto the
    running sample. Bit-packed LSB-first (Polar convention). Verified against real Verity PPG frames.

    Returns `(samples, truncated)`. **`truncated` is a Clock-Contract obligation, not diagnostics.**
    Every `break`/early-`return` below abandons a frame PART-WAY, and `decode_frame` back-times from
    `last_ns` — the stamp of the frame's LAST sample, which in that case was never decoded. The
    survivors would therefore be stamped as if they were the frame's tail: measured on a synthetic
    10-sample ACC frame truncated to 5, every survivor lands **96.2 ms late** at 52 Hz, and the error
    grows with how much of the frame was lost. Real samples at fabricated times is exactly what the
    Clock Contract forbids, so decode_frame drops such a frame instead of placing it wrongly.

    True ONLY when samples were decoded AND the frame ended early — a frame that yields nothing is
    already a gap and needs no special handling."""
    pos = 0
    nbits_total = len(payload) * 8
    if channels * ref_bits > nbits_total:   # truncated frame: not even one full reference sample
        return [], False                     # (VIGIL-DEEP-ANALYSIS §2C) — never IndexError into the callback

    def read(nbits: int, signed: bool) -> int:
        nonlocal pos
        v = 0
        for i in range(nbits):
            v |= ((payload[pos >> 3] >> (pos & 7)) & 1) << i
            pos += 1
        if signed and nbits and (v >> (nbits - 1)) & 1:
            v -= (1 << nbits)
        return v

    limit = 1 << (ref_bits - 1)   # a decoded sample can never exceed its own ADC resolution (see below)
    cur = [read(ref_bits, True) for _ in range(channels)]
    out: list[tuple] = [tuple(cur)]
    while pos + 16 <= nbits_total:
        # Each block HEADER is byte-aligned; a block's deltas (count × channels × deltaSize bits) need
        # not end on a byte boundary, so skip the padding before reading the next header. Without this we
        # read the next deltaSize/count from a mid-byte offset, get garbage (usually 0 → break) and
        # silently discard the rest of the frame. It only bites when channels × deltaSize isn't a
        # multiple of 8: 4-channel PPG happened to stay aligned and decoded correctly, while every
        # 3-channel stream lost most of each frame — measured 2026-07-18 on real Verity frames as
        # ACC 67%, GYRO 38%, MAG 32% of nominal, all restored to ~100% by this alignment (PPG unchanged).
        if pos % 8:
            pos += 8 - (pos % 8)
        if pos + 16 > nbits_total:  # pragma: no cover — unreachable: the `while pos+16<=nbits_total`
            return out, True        # guard plus a realign that only rounds pos UP toward N-16 means
                                    # pos+16 can never exceed N here. Kept as a defensive belt.
        delta_size = read(8, False)
        count = read(8, False)
        # deltaSize > ref_bits is IMPOSSIBLE for valid data — Polar delta-compresses toward SMALL steps,
        # so a delta is never wider than the reference sample it refines. A larger value means the header
        # was misread (a corrupt/misaligned Verity frame), and reading e.g. a 200-bit "delta" is exactly
        # what produced the sparse 1e38 float-garbage rows downstream (0.41% of MAG, measured 2026-07-18).
        if delta_size == 0 or count == 0 or delta_size > ref_bits:
            return out, True
        if pos + count * channels * delta_size > nbits_total:
            return out, True                        # truncated block — stop, don't fabricate
        for _ in range(count):
            for ch in range(channels):
                cur[ch] += read(delta_size, True)
            # A running sample outside its own ref_bits range is physically impossible (the device's ADC
            # cannot output it), so it is corruption, not signal. Stop here rather than emit a garbage row
            # — a downstream node with no outlier clamp otherwise blows up (MotionDex movement index 1.5e34).
            if any(c < -limit or c >= limit for c in cur):
                return out, True
            out.append(tuple(cur))
    return out, False          # loop ended because the frame was fully consumed


def decode_frame(data: bytes, arrival: _dt.datetime, fs: float | None = None,
                 prev_last_ns: int | None = None, scale: float | None = None):
    """Parse one PMD data notification → (meas_type, [Sample,...]). arrival = host time the notification
    fired. `fs` = the ACTUAL negotiated sample rate (falls back to SAMPLE_HZ); needed because ACC differs
    per device (Verity 52 Hz vs H10 200 Hz) and back-timing must match reality.

    `prev_last_ns` = the PREVIOUS frame's device timestamp for THIS measurement type (None on the first
    frame after a connect). When supplied, the back-timing step is derived from the device's own clock
    instead of `fs` — see the comment at the step calculation for why that matters.
    `scale` = physical-units factor (see axis_scale); defaults to the device-class default for `meas`."""
    if len(data) < 10:
        return None, []
    # Mask to the type field. Bit 7 is the recording-type flag (0 online, 1 offline) and bit 6 is
    # unassigned, so a raw compare fails to match a type the moment either is set — we would raise on a
    # frame the vendor decodes fine. Polar's own SDK masks with 0x3F before matching; nothing in our
    # captures has set the high bits yet, which is exactly why this has never been noticed.
    meas = data[0] & 0x3F
    last_ns = struct.unpack_from("<Q", data, 1)[0]   # ns since 2000-01-01 of the LAST sample in the frame
    frame_type = data[9]
    payload = data[10:]
    fs = fs or SAMPLE_HZ.get(meas, 0) or 1

    raw: list[tuple] = []
    truncated = False
    delta = bool(frame_type & 0x80)     # PMD high bit = compressed/delta frame
    base = frame_type & 0x7F
    if meas == ECG and delta:
        raw, truncated = _decode_delta_ex(payload, channels=1, ref_bits=24)
    elif meas == ECG and base == 0:
        for o in range(0, len(payload) - 2, 3):
            raw.append((_i24(payload, o),))
    elif meas == PPG and delta:                          # Verity streams delta PPG (3 LEDs + ambient)
        raw, truncated = _decode_delta_ex(payload, channels=4, ref_bits=24)
    elif meas == PPG and base == 0:
        for o in range(0, len(payload) - 11, 12):       # uncompressed: 3 channels + ambient, int24 each
            raw.append((_i24(payload, o), _i24(payload, o + 3), _i24(payload, o + 6), _i24(payload, o + 9)))
    elif meas == ACC and delta:
        raw, truncated = _decode_delta_ex(payload, channels=3, ref_bits=16)
    elif meas == ACC and base == 1:
        for o in range(0, len(payload) - 5, 6):          # int16 x,y,z (mg)
            raw.append(struct.unpack_from("<hhh", payload, o))
    # FRAME TYPE 0 ONLY, and the `base == 0` is the whole point. Both of these types have a defined
    # type-1 compressed frame with a DIFFERENT shape — GYRO type 1 is 3 channels x 32-bit IEEE-754
    # float, MAG type 1 is FOUR channels x 16-bit (x, y, z in milligauss plus a calibration-status
    # word). Decoding either as 3 x 16-bit signed does not fail; it returns plausible, wrong numbers.
    # This Verity only emits type 0 today, so the branch below is unreachable in practice and its
    # absence would be invisible until a firmware update — which is precisely the kind of silent
    # mis-decode this file has already been bitten by (the ACC/GYRO/MAG byte-alignment bug, fixed
    # 2026-07-18, was the same shape: right-looking output from a wrong reader).
    elif meas in (GYRO, MAG) and delta and base == 0:    # Verity IMU streams delta frames (like PPG/ACC)
        raw, truncated = _decode_delta_ex(payload, channels=3, ref_bits=16)
    elif meas in (GYRO, MAG) and base == 0:
        for o in range(0, len(payload) - 5, 6):          # int16 x,y,z (gyro dps / mag gauss, raw)
            raw.append(struct.unpack_from("<hhh", payload, o))
    elif meas == PPI and base == 0:
        # PPI event frame — one entry per detected beat: HR(u8), ppInMs(u16 LE), ppErrMs(u16 LE),
        # flags(u8: bit0 blocker, bit1 skinContact, bit2 skinContactSupported). NOT back-timed.
        for o in range(0, len(payload) - 5, 6):
            raw.append((payload[o], payload[o + 1] | (payload[o + 2] << 8),
                        payload[o + 3] | (payload[o + 4] << 8), payload[o + 5]))
    else:
        raise ValueError(f"PMD meas={meas} frame_type={frame_type:#04x} not decoded (see SDK).")

    # A PART-DECODED DELTA FRAME IS A GAP, NEVER A GUESS (VIGIL-HARDENING-III §1). Back-timing below
    # anchors on `last_ns`, the stamp of the frame's LAST sample — which a truncated frame never
    # decoded. Emitting the survivors would stamp them as if they were the frame's tail: measured on a
    # 10-sample ACC frame truncated to 5, every survivor lands 96.2 ms late at 52 Hz, and the error
    # scales with how much was lost. Their VALUES are right and their TIMES would be fabricated, which
    # the Clock Contract forbids outright ("a dropped packet is a GAP, never fabricated rows"), and
    # unplaceable is exactly what they are: the frame's true sample count is not recoverable once a
    # block header is corrupt. Raise so on_pmd records it in `last_error` and drops the frame — the
    # established visible channel — rather than letting a silent partial frame skew the timeline.
    if truncated:
        raise ValueError(f"PMD meas={meas} delta frame truncated after {len(raw)} sample(s) — dropped "
                         f"(its true length is unknowable, so the survivors cannot be placed in time)")
    n = len(raw)
    out: list[Sample] = []
    ppi = (meas == PPI)                                  # PPI entries are per-beat events, not evenly spaced

    # BACK-TIMING STEP. The negotiated rate is a LABEL, not the hardware's real rate: each Verity sensor
    # die free-runs on its own oscillator. Measured over a full night (2026-07-19): MAG 20.516 Hz against
    # a nominal 20 (+2.6 %), GYRO 51.684 vs 52, ACC 51.672 vs 52, PPG 55.132 vs 55 — while the H10's ECG
    # holds 130 Hz to within tens of ppm (modal step 7 692 672 ns = 129.9938 Hz, -47 ppm; per-file mean
    # rate 129.887-130.088 across 50 files of the vendor's own PSL decode — H10-ECG-RATE-CORPUS-CHECK
    # 2026-08-04 §2). The CONTRAST is what this argument needs and it is intact either way: -0.005 % for
    # ECG against +2.6 % for MAG, three orders apart. Do NOT read "130.0000" here as an exact integer —
    # that figure was our own nominal read back (DEVICE-RATE-TRUTH §4.1), and no constant below changes
    # on account of the correction. Stepping back by the NOMINAL interval therefore mis-places every
    # sample in the frame, worst at its start, and the SIGN of the error decides whether anyone
    # notices: where the true rate is FASTER the frame over-reaches into its predecessor (MAG: 678
    # backwards timestamps in one night, down to -112 ms), where it is SLOWER it leaves a silent gap
    # (GYRO/ACC: 22 ms, no backwards stamp, looks perfectly clean). So derive the step from the
    # device's OWN clock — the previous frame's
    # last sample and this frame's are exactly `n` intervals apart — and fall back to nominal only when
    # that is unavailable or implausible.
    step_ns = 1e9 / fs
    if prev_last_ns is not None and n > 0:
        est = (last_ns - prev_last_ns) / n
        if 0.9 * step_ns <= est <= 1.1 * step_ns:   # a dropped frame / restart inflates est — keep nominal
            step_ns = est
        elif 0 < est < step_ns:
            # Frames arrived CLOSER together than nominal (a burst or a BLE retransmit), so the estimate
            # was rejected as implausible — but stepping back by the larger nominal interval would reach
            # past the previous frame's last sample and emit a backwards stamp. Clamp instead: a frame may
            # never start before its predecessor ended. This fabricates nothing — it only refuses to
            # over-reach. (It cannot rescue a frame whose own last_ns regressed: an out-of-order
            # notification carries an earlier device stamp, and we report the device faithfully rather
            # than invent a monotonic one. Observed once in ~80 k real MAG samples, 2026-07-19.)
            step_ns = est

    if scale is None:
        scale = axis_scale(meas)
    for i, vals in enumerate(raw):
        back = 0 if ppi else (n - 1 - i)
        # Subtract an INTEGER offset — never pull last_ns through float arithmetic. Polar ns-since-2000
        # is ~8.4e17, far past float64's 2^53 exact-integer limit, so `last_ns - back*step_ns` in floats
        # silently rounds the frame stamp to the nearest 128 ns (caught by the last-sample identity test).
        # 128, not 64: ns-since-2000 crossed 2^59 on 2018-04-07, so the double ULP has been 128 ns since
        # then and stays there until 2054. MEASURED in Polar's own output — 98.7 % of Polar Sensor
        # Logger's per-sample stamps are ≡ 0 mod 128 (its SDK does this arithmetic in float64), and the
        # 1.3 % that are not are exactly 1/73, the frame-last sample the SDK passes through unrounded.
        sns = last_ns - int(round(back * step_ns))
        if scale != 1.0 and not ppi:                     # never scale PPI — its tuple is hr/ms/ms/flags
            vals = tuple(v * scale for v in vals)
        out.append(Sample(
            phone=arrival - _dt.timedelta(seconds=back * step_ns / 1e9),
            sensor_ns=sns,
            t_ms=sns / 1e6,
            values=vals,
        ))
    return meas, out
