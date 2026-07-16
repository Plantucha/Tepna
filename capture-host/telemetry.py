# tepna-capture — telemetry.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# In-memory live-sample bus for the monitor page. The capture callbacks push each decoded frame's
# samples here; SSE subscribers (the browser canvas) get compact per-frame batches. This is a live
# view ONLY — the durable record is still the vendor-layout files on disk (Clock Contract / §8).
# A dropped subscriber or a slow browser never blocks capture: the per-subscriber queue drops oldest.

from __future__ import annotations
import asyncio, collections, datetime as _dt
from dataclasses import dataclass, field


@dataclass
class StreamMeta:
    key: str            # 'ecg' | 'ppg' | 'spo2' | ...
    label: str          # human label for the UI
    unit: str
    fs: float           # nominal sample rate (Hz); 0 for irregular (e.g. spo2 @ 1/s or slower)


# One waveform at a time in the UI, but the bus carries all active streams so switching is instant.
DEFAULT_META = {
    "ecg":  StreamMeta("ecg",  "ECG (Polar H10)",        "µV",    130),
    "ppg":  StreamMeta("ppg",  "PPG (Verity Sense)",     "raw",    55),
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
                 "active": m.key in self._active} for m in self._meta.values()]

    def push(self, stream: str, values, fs: float | None = None):
        """Append a frame's worth of samples (an iterable of numbers) and broadcast to subscribers."""
        vals = [float(v) for v in values]
        if not vals:
            return
        m = self._meta.get(stream)
        rate = fs or (m.fs if m else 0) or 1
        cap = max(1, int(self._ring_seconds * rate))
        ring = self._rings.get(stream)
        if ring is None or ring.maxlen != cap:
            ring = collections.deque(ring or (), maxlen=cap)
            self._rings[stream] = ring
        ring.extend(vals)
        self._active.add(stream)
        msg = {"stream": stream, "fs": rate, "v": vals,
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
                "v": list(ring) if ring else []}

    def subscribe(self, maxsize: int = 64) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=maxsize)
        self._subs.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue):
        self._subs.discard(q)
