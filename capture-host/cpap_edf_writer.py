# tepna-capture — cpap_edf_writer.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# CPAP live BLE waveform → a bit-accurate BRP.edf on disk. The disk PEER of the bus tap: the same
# StreamData batches that cpap_stream pushes to the telemetry bus are accumulated here and, on session
# close, written as a ResMed-compatible BRP.edf via cpap_edf.build_brp/write_edf (the byte-accurate
# builder proven in #1669). The bus, this writer, and a future raw sidecar are PEERS on one ingestion
# seam — none is the sole consumer.
#
# ── TWO INVARIANTS, both tested ──────────────────────────────────────────────────────────────────────
# 1. QUARANTINE-UNTIL-PINNED. The physical scale of the StreamData PatientFlow channel (L/s vs L/min) is
#    NOT YET verified — the device streams physical floats in an unconfirmed unit, and a 60x-off flow
#    that still parses cleanly is exactly the "valid-looking file, wrong data" class this repo keeps
#    paying for. So while `flow_scale_verified` is False (the DEFAULT), files land under a PENDING
#    subtree that is provably OUTSIDE the harvest ingest root — a possibly-wrong flow cannot enter the
#    trusted CPAPDex therapy set. The factor is pinned by regressing a night's StreamData against the
#    same night's SD-card BRP.edf (see CPAP-EDF-WRITER-FOLLOWUPS brief); then flow_scale_verified flips.
# 2. ATOMIC. A .part file is rewritten in place as data accumulates (crash-safe: a killed capture leaves
#    a readable .part with everything up to the last flush) and os.replace'd to its final name on close,
#    so the final path only ever appears complete.
#
# The flow→L/s conversion is a single injectable `flow_to_lps` at this tap: identity by default (the
# unit tests verify the pipeline, not the physical scale), the real factor pinned in the follow-up.
from __future__ import annotations

import datetime
import os
import re

import cpap_edf

# The device start_time, per the Clock Contract: an explicit regex, NEVER a locale parse. The device
# labels its stream clock with a trailing Z, but these machines carry no real zone — the stamp is local
# civil time wearing a Z, so the components are taken VERBATIM as floating wall-clock (§1), which is also
# exactly the zone-free civil convention the SD-card BRP.edf filenames use. Any real ±HH:MM offset is
# tolerated in the match and likewise ignored for the civil start; the box applies its host-axis
# correction downstream, never here at the capture edge (§7/§12).
_ISO_RE = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$"
)

# The BRP data ids this writer consumes, and which EDF channel each feeds. PatientFlow → flow (L/s in the
# EDF), MaskPressure → pressure (cmH2O, confirmed at the idle capture). Keyed by the StreamData dataId.
FLOW_ID = "PatientFlow"
PRESS_ID = "MaskPressure"


def _identity(x: float) -> float:
    """Default flow→L/s conversion: pass the device float through unchanged. Replaced by the pinned
    factor once a same-night SD-card BRP.edf confirms the StreamData PatientFlow unit."""
    return x


class EdfSink:
    """A stream sink that accumulates the live BRP channels and writes one BRP.edf on close.

    Peers with the bus sink on cpap_stream's ingestion seam. `serial` is the device serial (from the
    pairing identification), used verbatim in the EDF recording-id. `out_root` is this writer's OWN root
    (never the harvest ingest root); while `flow_scale_verified` is False the file is quarantined under a
    PENDING subtree of it. `flow_to_lps` converts a device PatientFlow sample to L/s (identity until
    pinned). `now_ms` is injectable only for tests that need a deterministic mtime; nothing here reads a
    wall clock for data — the EDF start comes from the DEVICE's start_time, never the host."""

    PENDING = "PENDING"

    def __init__(self, out_root, serial, *, flow_scale_verified=False, flow_to_lps=_identity,
                 record_seconds=60):
        self._out_root = out_root
        self._serial = serial
        self._verified = bool(flow_scale_verified)
        self._flow_to_lps = flow_to_lps
        self._record_seconds = record_seconds
        self._flow: list[float] = []
        self._press: list[float] = []
        self._start = None          # (y, mo, d, hh, mm, ss) from the device start_time, set on batch 1
        self._start_iso = None      # the verbatim device stamp, kept for provenance
        self._part = None           # the .part path once the start is known
        self._final = None          # the final path
        self._flushed_records = 0   # whole records already written to .part
        self._closed = False

    # ── the ingestion-seam interface (open/on_batch/close), shared with the bus sink ──────────────────
    def open(self, channels, fs):
        """Called once before the first batch. `channels`/`fs` are accepted for parity with the bus sink;
        the BRP layout and 25 Hz rate are fixed by the EDF spec, so nothing is stored from them here."""

    def on_batch(self, batch):
        """One StreamData batch: set the start from the DEVICE clock on the first, then accumulate the
        flow and pressure samples. A batch missing a channel contributes nothing for it (the builder
        zero-pads to whole records), so a partial batch never shifts the two channels out of lockstep —
        they are padded to equal length only at build time."""
        if self._start is None:
            self._set_start(batch.get("start_time"))
        chans = batch.get("channels") or {}
        self._flow.extend(self._flow_to_lps(v) for v in (chans.get(FLOW_ID) or []))
        self._press.extend(chans.get(PRESS_ID) or [])
        self._flush()

    def close(self):
        """Session ended (after the pump DRAINED any late batch). Write the final EDF and promote the
        .part to its final name. Idempotent — a double close is a no-op."""
        if self._closed:
            return
        self._closed = True
        if self._start is None or not (self._flow or self._press):
            return                                    # nothing ever streamed — no file
        self._write(self._part)
        os.replace(self._part, self._final)

    # ── paths + writing ──────────────────────────────────────────────────────────────────────────────
    def _set_start(self, start_iso):
        self._start = _start_components(start_iso)
        if self._start is None:
            # A stream with no parseable device stamp cannot be honestly dated (Clock Contract §2.6 — a
            # missing stamp is null, never fabricated as now()). Refuse to write rather than invent a date.
            raise ValueError(f"StreamData start_time {start_iso!r} is unparseable — refusing to date the EDF")
        self._start_iso = start_iso
        y, mo, d, hh, mm, ss = self._start
        stamp = f"{y:04d}{mo:02d}{d:02d}_{hh:02d}{mm:02d}{ss:02d}"
        night = f"{y:04d}{mo:02d}{d:02d}"
        base = self._out_root if self._verified else os.path.join(self._out_root, self.PENDING)
        night_dir = os.path.join(base, "DATALOG", night)
        os.makedirs(night_dir, exist_ok=True)
        self._final = os.path.join(night_dir, f"{stamp}_BRP.edf")
        self._part = self._final + ".part"

    def _write(self, path):
        edf = cpap_edf.build_brp(self._flow, self._press, self._start, self._serial,
                                 record_seconds=self._record_seconds)
        blob = cpap_edf.write_edf(edf)
        tmp = path + ".tmp"
        # CLEAR-TEXT EDF ON DISK IS BY DESIGN — and why CodeQL's py/clear-text-storage-sensitive-data on
        # the write below is a false positive. (1) An EDF is a plain-file format by necessity: OSCAR and
        # SleepHQ read it directly, so encrypting it at rest would defeat the entire purpose of writing it.
        # (2) The device's OWN SD card already stores byte-identical EDFs in clear text — this box merely
        # captures the same data over BLE. (3) There is NO credential in this data path: the pairing key
        # and session key live in the pump (as11_pull/cpap_stream); an EdfSink only ever sees batch dicts
        # (channels + start_time). The two sources CodeQL classifies "private" are the EDF's patient_id —
        # the DE-IDENTIFIED constant "X X X X" that build_brp writes, never a real identity — and the
        # device serial (SRN), a device not a person, on a private single-user box. Flagged by field name,
        # not by carrying any personal data.
        with open(tmp, "wb") as f:
            f.write(blob)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)

    def _flush(self):
        """Rewrite the .part atomically once at least one whole record has accumulated, so a killed
        overnight capture leaves everything up to the last whole minute on disk. Cheap relative to the
        BLE cadence (one rewrite per record, i.e. per `record_seconds`). Only ever called from on_batch
        after the start is set, so no None-start guard is needed here."""
        spr = self._record_seconds * 25
        whole = min(len(self._flow), len(self._press)) // spr
        if whole >= self._flushed_records + 1:
            self._flushed_records = whole
            self._write(self._part)

    @property
    def path(self):
        """The final path (None until the first dated batch). Quarantined under PENDING while unverified."""
        return self._final


def _start_components(iso):
    """An ISO-8601 device stamp → (y, mo, d, hh, mm, ss) VERBATIM, or None when unparseable/out-of-range.

    Explicit regex, not a locale parse (Clock Contract §2.4). Components are validated by round-tripping
    through datetime, so a digit-valid but calendar-invalid stamp (2026-02-30, 25:99) is None rather than
    a silently rolled wrong instant (§2.7). The lone legal overflow is 24:00:00 → next-day 00:00:00 (§2.7)."""
    if not iso:
        return None
    m = _ISO_RE.match(iso.strip())
    if not m:
        return None
    y, mo, d, hh, mm, ss = (int(x) for x in m.groups())
    roll = False
    if (hh, mm, ss) == (24, 0, 0):        # ISO end-of-day → 00:00:00 the next calendar day
        hh, roll = 0, True
    try:
        dt = datetime.datetime(y, mo, d, hh, mm, ss)
    except ValueError:
        return None
    if roll:
        dt += datetime.timedelta(days=1)
    return (dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second)
