# tepna-capture — polar_pmd.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Polar Measurement Data (PMD) service: control-point start commands + data-frame decoders for
# ECG / ACC / PPG. Reference: the official Polar BLE SDK (PMD spec). This decodes the COMMON,
# uncompressed frame types fully (ECG type-0 especially — the mandatory stream).
#
# ⚠️ UNVERIFIED ON HARDWARE in this environment (no BLE / no Python runtime here). Before trusting
#    it: (1) some firmware emits COMPRESSED (delta) frames (frame_type >= 1 for ACC/PPG) that need
#    the SDK's delta decoder — handle_* below warns on an unexpected frame_type instead of guessing;
#    (2) the start-command TLVs (sample rate / resolution / range) must match what the device's
#    requestStreamSettings (control op 0x01) reports for YOUR firmware. Query first if start fails.
#    Capture a few frames raw and diff against PSL output before relying on a night.

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
               0x0A: "invalid_mtu", 0x0B: "invalid_channels", 0x0C: "invalid_state", 0x0D: "in_charger"}

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
    persists across BleakClient reconnects, so a fresh START returns 'already_streaming' as a no-op)."""
    return bytes([_OP_STOP, meas])


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
    an unsupported rate would be rejected at START and leave a permanently idle stream, so an invalid
    choice silently falls back to the built-in preference rather than breaking capture."""
    rates = settings.get(0x00) or []
    if prefer is not None and prefer in rates:
        return prefer
    pref = _PREF_RATE.get(meas)
    return pref if pref in rates else (max(rates) if rates else SAMPLE_HZ.get(meas, 0))


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
    """Polar PMD compressed/delta frame (frame_type high bit 0x80). Layout: one full reference sample
    (`channels` × `ref_bits` signed, LSB-first) then repeated blocks — [deltaSize:u8][sampleCount:u8]
    followed by sampleCount×channels deltas of `deltaSize` bits (signed), each accumulated onto the
    running sample. Bit-packed LSB-first (Polar convention). Verified against real Verity PPG frames."""
    pos = 0
    nbits_total = len(payload) * 8

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
            break                   # guard plus a realign that only rounds pos UP toward N-16 means
                                    # pos+16 can never exceed N here. Kept as a defensive belt.
        delta_size = read(8, False)
        count = read(8, False)
        # deltaSize > ref_bits is IMPOSSIBLE for valid data — Polar delta-compresses toward SMALL steps,
        # so a delta is never wider than the reference sample it refines. A larger value means the header
        # was misread (a corrupt/misaligned Verity frame), and reading e.g. a 200-bit "delta" is exactly
        # what produced the sparse 1e38 float-garbage rows downstream (0.41% of MAG, measured 2026-07-18).
        if delta_size == 0 or count == 0 or delta_size > ref_bits:
            break
        if pos + count * channels * delta_size > nbits_total:
            break                                   # truncated block — stop, don't fabricate
        for _ in range(count):
            for ch in range(channels):
                cur[ch] += read(delta_size, True)
            # A running sample outside its own ref_bits range is physically impossible (the device's ADC
            # cannot output it), so it is corruption, not signal. Stop here rather than emit a garbage row
            # — a downstream node with no outlier clamp otherwise blows up (MotionDex movement index 1.5e34).
            if any(c < -limit or c >= limit for c in cur):
                return out
            out.append(tuple(cur))
    return out


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
    meas = data[0]
    last_ns = struct.unpack_from("<Q", data, 1)[0]   # ns since 2000-01-01 of the LAST sample in the frame
    frame_type = data[9]
    payload = data[10:]
    fs = fs or SAMPLE_HZ.get(meas, 0) or 1

    raw: list[tuple] = []
    delta = bool(frame_type & 0x80)     # PMD high bit = compressed/delta frame
    base = frame_type & 0x7F
    if meas == ECG and delta:
        raw = _decode_delta(payload, channels=1, ref_bits=24)
    elif meas == ECG and base == 0:
        for o in range(0, len(payload) - 2, 3):
            raw.append((_i24(payload, o),))
    elif meas == PPG and delta:                          # Verity streams delta PPG (3 LEDs + ambient)
        raw = _decode_delta(payload, channels=4, ref_bits=24)
    elif meas == PPG and base == 0:
        for o in range(0, len(payload) - 11, 12):       # uncompressed: 3 channels + ambient, int24 each
            raw.append((_i24(payload, o), _i24(payload, o + 3), _i24(payload, o + 6), _i24(payload, o + 9)))
    elif meas == ACC and delta:
        raw = _decode_delta(payload, channels=3, ref_bits=16)
    elif meas == ACC and base == 1:
        for o in range(0, len(payload) - 5, 6):          # int16 x,y,z (mg)
            raw.append(struct.unpack_from("<hhh", payload, o))
    elif meas in (GYRO, MAG) and delta:                  # Verity IMU streams delta frames (like PPG/ACC)
        raw = _decode_delta(payload, channels=3, ref_bits=16)
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

    n = len(raw)
    out: list[Sample] = []
    ppi = (meas == PPI)                                  # PPI entries are per-beat events, not evenly spaced

    # BACK-TIMING STEP. The negotiated rate is a LABEL, not the hardware's real rate: each Verity sensor
    # die free-runs on its own oscillator. Measured over a full night (2026-07-19): MAG 20.516 Hz against
    # a nominal 20 (+2.6 %), GYRO 51.684 vs 52, ACC 51.672 vs 52, PPG 55.132 vs 55 — while the H10's ECG
    # is exactly 130.0000. Stepping back by the NOMINAL interval therefore mis-places every sample in the
    # frame, worst at its start, and the SIGN of the error decides whether anyone notices: where the true
    # rate is FASTER the frame over-reaches into its predecessor (MAG: 678 backwards timestamps in one
    # night, down to -112 ms), where it is SLOWER it leaves a silent gap (GYRO/ACC: 22 ms, no backwards
    # stamp, looks perfectly clean). So derive the step from the device's OWN clock — the previous frame's
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
        # silently rounds the frame stamp to the nearest ~64 ns (caught by the last-sample identity test).
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
