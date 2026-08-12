# tepna-capture — telemetry.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# In-memory live-sample bus for the monitor page. The capture callbacks push each decoded frame's
# samples here; SSE subscribers (the browser canvas) get compact per-frame batches. This is a live
# view ONLY — the durable record is still the vendor-layout files on disk (Clock Contract / §8).
# A dropped subscriber or a slow browser never blocks capture: the per-subscriber queue drops oldest.

from __future__ import annotations
import asyncio, collections, datetime as _dt, logging, statistics, time
from dataclasses import dataclass

log = logging.getLogger("tepna.telemetry")

# ── Link-health thresholds (stream-rate side of the weak-signal warning; the RSSI side is link_rssi.py).
# A weak/failing BLE link shows up as fewer packets than the stream's nominal rate BEFORE it fully drops —
# the daemon sees every frame, so this needs no root (unlike connection RSSI). Waveform streams are judged
# by effective-vs-nominal Hz; slow/event streams (spo2/pr/ppi/rr ~1 Hz) can only be judged by silence.
_RATE_WIN_S = 5.0          # trailing window the effective rate is measured over
_WEAK_FRAC = 0.7           # < 70 % of nominal Hz ⇒ WEAK (amber)
_STALL_S = 6.0             # no sample for this long ⇒ STALL (red)
_WARMUP_S = 1.5            # < this much history ⇒ too early to call WEAK (a just-opened stream)


# ── OPTICAL WEAR, FROM THE SIGNAL ITSELF ────────────────────────────────────────────────────────────
#
# WHY THIS EXISTS. `worn` normally comes from a strap's skin-contact bit. The Polar Verity Sense
# declares `contact_supported: false` and emits 1 Hz of `0000` forever, so that path yields None for it
# — honestly, but permanently. The consequence is not cosmetic: `power.drop_not_worn_sec` can never
# fire for the armband, and `cpap_harvest.blocking_devices` treats `worn is not False` as "streaming",
# so an armband on a desk both drains itself and blocks the CPAP harvest.
#
# Measured 2026-08-10: the Verity streamed 3 hours and 42.5 MB into a desk at a flawless 55.0 Hz, zero
# gaps, RSSI −37 — and every health check read green, because every health check asks about the
# TRANSPORT (rate, age) and none about the CONTENT. Battery went 100 % → 74 %.
#
# THE DEVICE DOES SAY, on a channel nobody read. The ambient photodiode sees ROOM LIGHT off the body
# and DARKNESS under skin, and the separation is not subtle. Scanned across 5730 windows of 30 s from
# 45 real Verity PPG files (2026-08-01 → 08-10):
#
#     |ambient| median per window   worn ~140–190        unworn ~3.2e5–6.5e5
#     log10 histogram              1–3: 3795 windows     5: 1931 windows     4: FOUR windows
#
# Three orders of magnitude apart with four windows in the gap. The threshold below is the geometric
# midpoint of the widest empty interval in the middle 98 % (1993 → 13160, a factor of 7), NOT a number
# anyone picked: 5121, rounded to 5000. Validated on files whose state was known independently — the
# desk file scored 0.0 % worn windows, the overnight file 100.0 %.
#
# ⚠️ AMBIENT, NOT PULSE AMPLITUDE. Per-channel SD also separates (14–28×) but its histogram is
# continuous, so any threshold on it is a judgement call; ambient's is bimodal with an empty gap. And
# amplitude conflates "not worn" with "worn badly" — a poorly perfused but genuinely worn sensor must
# not be dropped for power.
_WORN_AMBIENT_MAX = 5000.0   # |ambient| below this ⇒ under skin. See the gap above.
_WORN_MIN_SAMPLES = 128      # ~2.3 s at 55 Hz; fewer is not a measurement

# ── THE CALIBRATION'S DOMAIN, DECLARED BESIDE THE NUMBER IT QUALIFIES ───────────────────────────────
#
# Every threshold above came from 45 real Verity PPG files captured at 55 Hz. NONE of it was measured
# anywhere else, and the ambient channel does not scale the way one might assume: at 176 Hz the same
# worn armband reads ~650,800 with a spread of 208 counts — a PEGGED value, not a light level — which
# lands squarely in the 55 Hz "unworn" cluster (3.2e5–6.5e5). So the detector reports NOT WORN for a
# device on a wrist, confidently, using a number that is simply not about that rate.
#
# Measured 2026-08-10, and it shipped: PPG default moved to 176 Hz in the morning and this detector
# landed in the evening, each defensible alone and neither checked against the other. A worn armband
# showing a textbook pulse at 57 bpm was dropped every 90 s to "save battery".
#
# ⚠️ THE AFTERNOON CHECK THAT "VALIDATED" IT WAS RUN ON AN UNWORN DEVICE, so it agreed for the wrong
# reason. A passing check on a case that cannot fail is not evidence — see AUDIT-PROMPT's standing
# complaint about gates that pass without exercising anything.
#
# So the constant carries its domain and the function REFUSES outside it. Adding a rate here is not a
# config change: it means someone captured a worn night at that rate and re-derived the numbers.
_WORN_CALIBRATED_PPG_HZ = (55.0,)
_WORN_FS_TOL_HZ = 1.0        # the box logs 55.0 but a device may report 54.9; this is not a rate menu


# PPI flag byte (polar_pmd: bit0 blocker, bit1 skinContact, bit2 skinContactSupported).
_PPI_CONTACT = 0x02
_PPI_CONTACT_SUPPORTED = 0x04


def ppi_contact(flags) -> bool | None:
    """Skin contact as the DEVICE reports it in its PPI stream. `True`/`False`/**`None` = not offered**.

    ⚠️ THE VERITY ANSWERS THIS QUESTION TWICE, DIFFERENTLY, AND THE CODE ONLY EVER ASKED THE CHANNEL
    THAT SAYS NO. Its HR characteristic reports `contact_supported: false` and streams 1 Hz of `0000`
    forever, which is why `worn` was `None` for it forever. Its PPI stream sets
    `skinContactSupported = 1` and reports real contact. Measured 2026-08-10 on the same unit:

        armband on a desk    contact = 0 on 31 877 of 31 877 rows
        armband worn (night) contact = 1 on 20 957 of 20 957 rows

    Perfect separation, no threshold, and it is the device's own measurement rather than an inference —
    so this OUTRANKS `optical_worn` wherever PPI is a configured stream. `optical_worn` remains the
    fallback for a configuration that does not enable PPI.

    `None` when the device does not claim support, because an unsupported bit reads 0 and 0 is
    indistinguishable from a genuine "not touching skin"."""
    if flags is None:
        return None
    f = int(flags)
    if not f & _PPI_CONTACT_SUPPORTED:
        return None
    return bool(f & _PPI_CONTACT)


def calibrated_for(fs, *, rates=_WORN_CALIBRATED_PPG_HZ, tol: float = _WORN_FS_TOL_HZ) -> bool:
    """Is the optical worn calibration valid at this PPG rate?

    PURE and separate from `optical_worn` so the daemon can say WHY it has no verdict, and so the
    domain is assertable without feeding samples through the detector.

    ⚠️ AN UNKNOWN RATE (`None`) IS TREATED AS IN-DOMAIN. That is deliberate and is the one concession:
    every caller that cannot report a rate predates this parameter, and refusing there would silently
    disable worn detection for all of them. A caller that KNOWS its rate and reports one we never
    measured is the case this exists to catch."""
    if fs is None:
        return True
    return any(abs(float(fs) - r) <= tol for r in rates)


def optical_worn(ambient, *, threshold: float = _WORN_AMBIENT_MAX,
                 min_samples: int = _WORN_MIN_SAMPLES, fs: float | None = None) -> bool | None:
    """Is an optical sensor against skin? `True` / `False` / **`None` when it cannot be said**.

    PURE, so it is unit-testable without a device. Takes raw ambient values (sign is irrelevant — the
    Verity reports them negative), uses the MEDIAN so a handful of saturated samples cannot swing it,
    and refuses on too little data rather than guessing.

    ⚠️ `None` IS NOT `False`, and the callers make that distinction load-bearing: `worn=False` drops the
    link for power and unblocks the CPAP harvest, while `None` means "no verdict" and changes nothing.
    Returning False on a short or empty buffer would drop a sensor that had merely just connected."""
    if not calibrated_for(fs):
        # REFUSE, don't guess. `None` already means "no verdict" everywhere downstream — the power drop
        # and the CPAP interlock both read `worn is False`, not `worn is not True` — so refusing costs
        # a feature and guessing costs a night's capture.
        return None
    vals = [abs(v) for v in ambient if v is not None and v == v]   # drop None/NaN, keep magnitude
    if len(vals) < max(1, min_samples):
        return None
    # `statistics.median`, not a hand-rolled index. The hand-rolled version carried TEN index/operator
    # mutants that the whole suite could not see (mutate-diff, #1134) — every test fed it a flat buffer,
    # so `// 2` vs `// 3` and `- 1` vs `+ 1` all returned the same number. The even-length branch is the
    # part no fixture reached. Deleting the arithmetic is a better answer than fixturing around it.
    return statistics.median(vals) < threshold


def stream_health(nominal_fs, eff_fs, age_s, warmup: bool = False,
                  *, weak_frac: float = _WEAK_FRAC, stall_s: float = _STALL_S) -> str:
    """Classify one stream's link health from its nominal rate, measured effective rate, and the age of
    its last sample. PURE (no bus state) so it is unit-testable. Returns 'good'|'weak'|'stall'|'idle'.
      • idle  — declared but never produced a sample (age_s is None)
      • waveform stream (nominal > 5 Hz): stall on silence > stall_s, else weak when eff < weak_frac·nominal
      • slow/event stream (spo2/pr/ppi/rr): rate-judging is meaningless → only stall on prolonged silence.

    `eff_fs` may be None — "not enough history to state a rate" (see TelemetryBus._stream_rate). That is
    NOT the same as 0.0, and it must never paint WEAK: silence is already caught by `age_s` above, so an
    unmeasurable rate carries no bad news. Reporting 0.0 there is the fabrication this distinction
    exists to prevent — a measurement of silence for a stream nobody measured."""
    if age_s is None:
        return "idle"
    if (nominal_fs or 0) > 5:                       # continuous waveform
        if age_s > stall_s:
            return "stall"
        if warmup or eff_fs is None:
            return "good"                           # not enough history to call it weak yet
        return "weak" if eff_fs < weak_frac * nominal_fs else "good"
    quiet = max(stall_s, 4.0 / (nominal_fs or 1))   # event stream: expect a sample every ~1/fs s
    return "stall" if age_s > quiet else "good"


@dataclass
class StreamMeta:
    key: str            # 'ecg' | 'ppg' | 'acc_h10' | ...  (device-qualified where a stream isn't unique)
    label: str          # human label for the UI
    unit: str
    fs: float           # nominal sample rate (Hz); 0 for irregular / per-event (ppi, rr, spo2)
    chans: int = 1      # channels per sample (ppg=4, acc/gyro/mag=3) — UI draws one trace per channel
    labels: tuple = ()  # per-channel labels, e.g. ("LED1","LED2","LED3","ambient") | ("X","Y","Z")


# Device-unique base streams. Anything that can come from >1 device (ACC/GYRO/MAG/PPI/PPG) is registered
# per-device at capture time via bus.register() with a device-qualified key, so two sensors' ACC never
# collide on one ring.
#
# `ppg` was listed here and has been REMOVED (issue #410). It stopped being device-unique when the
# O2Ring began streaming its finger pleth: two devices then declared `ppg`, the bare key went to
# whichever the UI matched first, and the Verity's card showed the ring's battery/RSSI. Its live entry
# is now registered as `ppg_vs` from capture.py; leaving a placeholder here would paint a permanently
# idle "PPG" card that no device ever fills.
DEFAULT_META = {
    "ecg":  StreamMeta("ecg",  "ECG (Polar H10)",        "µV",    130),
    "spo2": StreamMeta("spo2", "SpO₂ (Wellue O2Ring)",   "%",       1),
    "pr":   StreamMeta("pr",   "Pulse rate (O2Ring)",    "bpm",     1),
}


class TelemetryBus:
    def __init__(self, ring_seconds: float = 12.0):
        self._ring_seconds = ring_seconds
        self._rings: dict[str, collections.deque] = {}
        self._meta: dict[str, StreamMeta] = dict(DEFAULT_META)
        self._subs: set[asyncio.Queue] = set()
        self._active: set[str] = set()   # streams that have produced data this session
        self._win: dict[str, collections.deque] = {}   # stream -> deque[(mono_ts, n_samples)] for rate calc
        self._last_mono: dict[str, float] = {}         # stream -> monotonic time of last push (stall calc)
        self._shape_err: dict[str, str] = {}           # stream -> "declared N, got M" (channel-count breach)

    def _stream_rate(self, stream: str, now: float) -> tuple[float | None, float | None, bool]:
        """(effective_fs | None, age_of_last_sample_s | None, warmup) for one stream.

        MEASURED ON THE DEVICE CLOCK where the frames carry one (DEVICE-RATE-TRUTH §6.3). Two defects
        were fixed together here, because they have the same cure:

        · OFF-BY-ONE. This used to run `span` from the OLDEST frame's ARRIVAL while `total` counted that
          frame's samples as well — but those samples arrived AT the start of the interval, they were not
          produced during it. For k frames of n samples at spacing T that is `k·n / ((k−1)·T)`: a k/(k−1)
          overstatement that is always positive and never averages out. The 5 s window holds ~9 ECG
          frames, so 130 Hz read 130 × 9/8 = 146.25 predicted, 146.6 observed on the box. Counting
          exactly the frames that closed inside the interval (`frames[1:]`) makes it an identity.

        · HOST CLOCK. BLE hands over several frames in one connection event, so their arrival times
          collapse together and an arrival-time denominator measures the RADIO's batching rather than
          the sensor. The device's own `sensor_ns` is immune by construction.

        Falls back to arrival times — with the off-by-one still fixed — for streams that push no device
        stamp (the O2Ring paths), and for a device clock that did not advance: the H10 resets to a 2019
        epoch whenever it leaves the strap (DEVICE-RATE-TRUTH §3), so a non-monotonic pair is a real
        event, not a theoretical one, and 'refuse this reading' beats a negative rate.

        Returns None — never 0.0 — when there is no interval to measure over. `0.0` is a *measurement*
        of silence and reads downstream as a dead stream; "one frame so far" is not that.
        """
        last = self._last_mono.get(stream)
        age = (now - last) if last is not None else None
        w = self._win.get(stream)
        if not w:
            return None, age, True
        cutoff = now - _RATE_WIN_S
        while w and w[0][0] < cutoff:
            w.popleft()
        # < 2 frames spans no interval. Note this also covers the everything-aged-out case, which used
        # to return 0.0 and is the same fabrication: an empty window has not measured a rate of zero.
        if len(w) < 2:
            return None, age, True
        dev0, devN = w[0][2], w[-1][2]
        span = (devN - dev0) / 1e9 if (dev0 is not None and devN is not None and devN > dev0) else (w[-1][0] - w[0][0])
        if span <= 0:
            return None, age, True        # simultaneous arrivals and no usable device stamp
        # frames[1:] — exactly the samples that closed inside (first, last]. The oldest frame's samples
        # mark the interval's START; counting them is the k/(k−1) bias.
        total = sum(n for _, n, _ in list(w)[1:])
        return total / span, age, span < _WARMUP_S

    def meta(self) -> list[dict]:
        now = time.monotonic()
        out = []
        for m in self._meta.values():
            eff, age, warmup = self._stream_rate(m.key, now)
            row = {"key": m.key, "label": m.label, "unit": m.unit, "fs": m.fs,
                   "chans": m.chans, "labels": list(m.labels),
                   "active": m.key in self._active,
                   # null, not 0, when the window holds no interval — the JSON contract mirrors
                   # `_stream_rate`'s refusal rather than flattening it into a measured zero.
                   "effFs": None if eff is None else round(eff, 3),
                   "health": stream_health(m.fs, eff, age, warmup)}
            # Present ONLY when breached, so a reader can treat the key's existence as the alarm and no
            # existing consumer sees a new field on a healthy stream.
            if m.key in self._shape_err:
                row["shapeError"] = self._shape_err[m.key]
            out.append(row)
        return out

    def shape_errors(self) -> dict[str, str]:
        """{stream: description} for every stream that has EVER delivered a frame whose channel count
        contradicted its declared shape. Sticky for the life of the bus — a breach is a data-integrity
        event, so it must not be cleared by the next well-formed frame. Empty dict == clean."""
        return dict(self._shape_err)

    def register(self, key: str, label: str, unit: str, fs: float,
                 chans: int = 1, labels=()) -> None:
        """Declare a stream so the UI shows it (with per-channel labels) even before the first frame.
        Idempotent; call once per device stream when its capture opens."""
        self._meta[key] = StreamMeta(key, label, unit, fs, chans, tuple(labels))

    def unregister(self, key: str) -> None:
        """Drop a stream (e.g. its START was rejected) so it stops showing as an idle card."""
        self._meta.pop(key, None)
        self._rings.pop(key, None)
        self._active.discard(key)
        self._win.pop(key, None)
        self._last_mono.pop(key, None)
        # `_shape_err` is deliberately NOT cleared: a breach recorded against this key is evidence about
        # the night, and an unregister/re-register cycle (which every reconnect performs) must not be
        # able to launder it away.

    def push(self, stream: str, values, fs: float | None = None, dev_ns: int | None = None):
        """Append a frame's worth of samples and broadcast to subscribers. `values` is either a flat
        iterable of numbers (scalar stream) OR an iterable of per-sample channel sequences (multi-channel,
        e.g. PPG [c0,c1,c2,amb] or ACC [x,y,z]). The `v` field mirrors that shape so the UI knows.

        `dev_ns` is this frame's LAST sample on the DEVICE's own counter (PMD `sensor_ns`). Optional and
        additive: streams that have no device clock (the O2Ring paths) simply omit it and keep the
        arrival-time rate. Passing it is what makes `effFs` immune to BLE batching — see `_stream_rate`."""
        values = list(values)
        if not values:
            return
        multi = isinstance(values[0], (list, tuple))
        rows = [tuple(float(x) for x in row) for row in values] if multi else [float(v) for v in values]
        nch = len(rows[0]) if multi else 1
        m = self._meta.get(stream)
        rate = fs or (m.fs if m else 0) or 1
        # STREAM SHAPE IS AN INVARIANT, NOT A FIELD TO REFRESH (2026-07-25). This used to do
        # `m.chans = nch` — silently conforming the DECLARED shape to whatever arrived. A stream's
        # channel count is fixed by the hardware (`_LIVE_META` in capture.py declares it at START:
        # ECG 1, PPG 4, ACC/GYRO/MAG 3, PPI 2), so a frame of a different width is decoder corruption,
        # and rewriting the metadata is precisely the "quietly normalise bad input" move this suite
        # forbids — it makes the UI believe the sensor genuinely changed shape.
        #
        # Recorded and logged rather than RAISED, deliberately. `push()` is called from bleak's
        # notification callback AFTER the durable write, and outside `on_pmd`'s try/except — a raise
        # there escapes into the D-Bus dispatch, where it is logged and swallowed. That is quieter, not
        # louder, and it would abort the status update while changing nothing on disk. `shape_errors()`
        # rides `meta()` to the monitor, which is the surface a human actually watches.
        if m and m.chans != nch:
            prev = self._shape_err.get(stream)
            self._shape_err[stream] = f"declared {m.chans} channel(s), frame carried {nch}"
            if prev is None:       # once per stream — this path can run at 130 Hz
                log.error("STREAM SHAPE BREACH on %r: %s — decoder corruption, not a shape change; "
                          "dropping the frame from the live view and flagging the stream",
                          stream, self._shape_err[stream])
            # DROP the malformed frame rather than ring it. Mixing widths in one ring would hand
            # `snapshot()` ragged rows under a single declared `chans`, so the UI would mis-plot them as
            # if they were real. This is a live view — a corrupt frame has no value worth rendering, and
            # the flag says so out loud. The durable file is unaffected: it was written before this call.
            return
        # Min 64 keeps slow/event streams (spo2/pr/ppi/rr @ ~1 Hz) to a usable window, not ~12 samples.
        cap = max(64, int(self._ring_seconds * rate))
        ring = self._rings.get(stream)
        if ring is None or ring.maxlen != cap:
            ring = collections.deque(ring or (), maxlen=cap)
            self._rings[stream] = ring
        ring.extend(rows)
        self._active.add(stream)
        now = time.monotonic()                       # link-health: track packets/sec vs nominal (no root)
        self._last_mono[stream] = now
        w = self._win.get(stream)
        if w is None:
            w = self._win[stream] = collections.deque()
        w.append((now, len(rows), dev_ns))
        cutoff = now - _RATE_WIN_S
        while w and w[0][0] < cutoff:
            w.popleft()
        msg = {"stream": stream, "fs": rate, "v": rows, "chans": nch,
               "t": _dt.datetime.now().strftime("%H:%M:%S")}
        for q in list(self._subs):
            if q.full():
                try: q.get_nowait()
                except asyncio.QueueEmpty: pass
            try: q.put_nowait(msg)
            except asyncio.QueueFull: pass

    def snapshot(self, stream: str) -> dict:
        ring = self._rings.get(stream)
        m = self._meta.get(stream)
        return {"stream": stream, "fs": m.fs if m else 0,
                "chans": m.chans if m else 1, "labels": list(m.labels) if m else [],
                "v": list(ring) if ring else []}

    def subscribe(self, maxsize: int = 64) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=maxsize)
        self._subs.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue):
        self._subs.discard(q)
