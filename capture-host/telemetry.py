# tepna-capture — telemetry.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# In-memory live-sample bus for the monitor page. The capture callbacks push each decoded frame's
# samples here; SSE subscribers (the browser canvas) get compact per-frame batches. This is a live
# view ONLY — the durable record is still the vendor-layout files on disk (Clock Contract / §8).
# A dropped subscriber or a slow browser never blocks capture: the per-subscriber queue drops oldest.

from __future__ import annotations
import asyncio, collections, datetime as _dt, time
from dataclasses import dataclass

# ── Link-health thresholds (stream-rate side of the weak-signal warning; the RSSI side is link_rssi.py).
# A weak/failing BLE link shows up as fewer packets than the stream's nominal rate BEFORE it fully drops —
# the daemon sees every frame, so this needs no root (unlike connection RSSI). Waveform streams are judged
# by effective-vs-nominal Hz; slow/event streams (spo2/pr/ppi/rr ~1 Hz) can only be judged by silence.
_RATE_WIN_S = 5.0          # trailing window the effective rate is measured over
_WEAK_FRAC = 0.7           # < 70 % of nominal Hz ⇒ WEAK (amber)
_STALL_S = 6.0             # no sample for this long ⇒ STALL (red)
_WARMUP_S = 1.5            # < this much history ⇒ too early to call WEAK (a just-opened stream)


def stream_health(nominal_fs, eff_fs, age_s, warmup: bool = False,
                  *, weak_frac: float = _WEAK_FRAC, stall_s: float = _STALL_S) -> str:
    """Classify one stream's link health from its nominal rate, measured effective rate, and the age of
    its last sample. PURE (no bus state) so it is unit-testable. Returns 'good'|'weak'|'stall'|'idle'.
      • idle  — declared but never produced a sample (age_s is None)
      • waveform stream (nominal > 5 Hz): stall on silence > stall_s, else weak when eff < weak_frac·nominal
      • slow/event stream (spo2/pr/ppi/rr): rate-judging is meaningless → only stall on prolonged silence."""
    if age_s is None:
        return "idle"
    if (nominal_fs or 0) > 5:                       # continuous waveform
        if age_s > stall_s:
            return "stall"
        if warmup:
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


# Device-unique base streams. Anything that can come from >1 device (ACC/GYRO/MAG/PPI) is registered
# per-device at capture time via bus.register() with a device-qualified key, so two sensors' ACC never
# collide on one ring.
DEFAULT_META = {
    "ecg":  StreamMeta("ecg",  "ECG (Polar H10)",        "µV",    130),
    "ppg":  StreamMeta("ppg",  "PPG (Verity Sense)",     "raw",    55, 4, ("LED1", "LED2", "LED3", "ambient")),
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

    def _stream_rate(self, stream: str, now: float) -> tuple[float, float | None, bool]:
        """(effective_fs, age_of_last_sample_s | None, warmup) for one stream, off the trailing window."""
        last = self._last_mono.get(stream)
        age = (now - last) if last is not None else None
        w = self._win.get(stream)
        if not w:
            return 0.0, age, True
        cutoff = now - _RATE_WIN_S
        while w and w[0][0] < cutoff:
            w.popleft()
        if not w:
            return 0.0, age, False        # everything aged out → genuinely quiet
        span = now - w[0][0]
        total = sum(n for _, n in w)
        eff = total / span if span > 0.05 else float(total)
        return eff, age, span < _WARMUP_S

    def meta(self) -> list[dict]:
        now = time.monotonic()
        out = []
        for m in self._meta.values():
            eff, age, warmup = self._stream_rate(m.key, now)
            out.append({"key": m.key, "label": m.label, "unit": m.unit, "fs": m.fs,
                        "chans": m.chans, "labels": list(m.labels),
                        "active": m.key in self._active,
                        "effFs": round(eff, 1),
                        "health": stream_health(m.fs, eff, age, warmup)})
        return out

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

    def push(self, stream: str, values, fs: float | None = None):
        """Append a frame's worth of samples and broadcast to subscribers. `values` is either a flat
        iterable of numbers (scalar stream) OR an iterable of per-sample channel sequences (multi-channel,
        e.g. PPG [c0,c1,c2,amb] or ACC [x,y,z]). The `v` field mirrors that shape so the UI knows."""
        values = list(values)
        if not values:
            return
        multi = isinstance(values[0], (list, tuple))
        rows = [tuple(float(x) for x in row) for row in values] if multi else [float(v) for v in values]
        nch = len(rows[0]) if multi else 1
        m = self._meta.get(stream)
        rate = fs or (m.fs if m else 0) or 1
        if m:
            m.chans = nch          # keep declared channel count in sync with reality
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
        w.append((now, len(rows)))
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
