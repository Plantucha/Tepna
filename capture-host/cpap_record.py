# tepna-capture — cpap_record.py
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""CPAP hardening P1 — the durable raw record (INV9: the live bus is not the sole authoritative copy).

A stream SINK (`open`/`on_batch`/`close`, the same duck-typed seam `EdfSink` and the bus sink use) that
writes an append-only JSONL raw record on disk BESIDE the bus. Wired via `stream_to_bus(..., extra_sinks=)`
and ordered BEFORE the bus push, so a crash after the durable append still has the batch. One file per
`session_id` (INV1). Device time and raw samples are stored VERBATIM — never converted, never host-
substituted (INV3/INV4); the device's OWN `interval_ms` is recorded, never the requested rate (INV5).

The canonical CPAP observation (findings spec §11): one decoded batch of raw device samples + provenance.
The P4 committed store and the CPAPDex comparator's live side are projections of THIS record.
"""
import json
import os
import time

_CLOSED, _OPEN = 0, 1


def _truncate_torn_tail(path):
    """A partial final line (the append a crash interrupted) is truncated back to the last complete
    record before we reopen — appending after a torn row would fuse two records. StreamWriter's idiom."""
    try:
        with open(path, "rb") as f:
            data = f.read()
    except FileNotFoundError:
        return
    if not data or data.endswith(b"\n"):
        return
    cut = data.rfind(b"\n")
    with open(path, "r+b") as f:
        f.truncate(cut + 1 if cut >= 0 else 0)


def _channel_meta(channels):
    """`channels` is the open-time metadata map {device_id: (key, label, unit)} (NOT the per-batch
    samples). Record key+label+unit so a reader knows what each sample column is, in device units."""
    out = {}
    for did, spec in (channels or {}).items():
        key, label, unit = spec
        out[str(did)] = {"key": key, "label": label, "unit": unit}
    return out


def _iso_utc(epoch_s):
    """Host wall clock as a UTC ISO stamp — the capture box's stratum-1 time, recorded BESIDE the device
    stamp (never replacing it, INV4). Millisecond precision, explicit Z."""
    t = time.gmtime(epoch_s)
    ms = int((epoch_s - int(epoch_s)) * 1000)
    return "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ" % (
        t.tm_year, t.tm_mon, t.tm_mday, t.tm_hour, t.tm_min, t.tm_sec, ms)


class RawRecordSink:
    """Durable append-only JSONL raw record for one CPAP acquisition session."""

    def __init__(self, path, *, device_id, session_id, provenance,
                 mono=time.monotonic, wall=None):
        self._path = path
        self._device_id = device_id
        self._session_id = session_id
        self._provenance = provenance
        self._mono = mono
        # host_wall is injectable for tests; default is the real host wall clock as UTC ISO.
        self._wall = wall if wall is not None else (lambda: _iso_utc(time.time()))
        self._fh = None
        self._seq = 0
        self._state = _CLOSED

    def open(self, channels, fs):
        """Open the record file (torn-tail-safe) and write the session header once."""
        if self._state == _OPEN:
            raise RuntimeError("RawRecordSink.open called twice")
        _truncate_torn_tail(self._path)
        self._fh = open(self._path, "a", encoding="utf-8")
        self._state = _OPEN
        self._write({
            "record": "cpap-raw",
            "v": 1,
            "session_id": self._session_id,
            "device_id": self._device_id,
            "provenance": self._provenance,
            "channels": _channel_meta(channels),
            "fs": fs,
        })

    def on_batch(self, batch):
        """Append one canonical observation. Device stamp + samples verbatim; observed interval, not
        requested; two host clocks recorded beside the device clock, never in place of it."""
        if self._state != _OPEN:
            raise RuntimeError("RawRecordSink.on_batch called before open")
        self._seq += 1
        self._write({
            "seq": self._seq,
            "stream_id": batch.get("streamId"),
            "device_start": batch.get("startTime"),        # raw device ISO, VERBATIM (INV3/INV4)
            "device_interval_ms": batch.get("interval_ms"),  # OBSERVED; None if the device omitted it (INV5)
            "host_mono": self._mono(),
            "host_wall": self._wall(),
            "samples": batch.get("channels") or {},        # raw decoded samples per device_id, VERBATIM (INV3)
        })

    def close(self):
        """Idempotent close — flush + fsync so a clean shutdown is durable and re-close is a no-op."""
        if self._state != _OPEN:
            return
        self._fh.flush()
        os.fsync(self._fh.fileno())
        self._fh.close()
        self._fh = None
        self._state = _CLOSED

    def _write(self, obj):
        # fsync every record: at ~1 batch/s the cost is negligible and INV9 wants the batch on disk the
        # instant it is recorded, not at the next periodic flush.
        self._fh.write(json.dumps(obj, separators=(",", ":")) + "\n")
        self._fh.flush()
        os.fsync(self._fh.fileno())
