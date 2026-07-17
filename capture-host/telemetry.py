# tepna-capture — telemetry.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# In-memory live-sample bus for the monitor page. The capture callbacks push each decoded frame's
# samples here; SSE subscribers (the browser canvas) get compact per-frame batches. This is a live
# view ONLY — the durable record is still the vendor-layout files on disk (Clock Contract / §8).
# A dropped subscriber or a slow browser never blocks capture: the per-subscriber queue drops oldest.

from __future__ import annotations
import asyncio, collections, datetime as _dt
from dataclasses import dataclass


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

    def meta(self) -> list[dict]:
        return [{"key": m.key, "label": m.label, "unit": m.unit, "fs": m.fs,
                 "chans": m.chans, "labels": list(m.labels),
                 "active": m.key in self._active} for m in self._meta.values()]

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
