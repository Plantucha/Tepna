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
import logging
import calendar
import os
import re

import cpap_edf

_log = logging.getLogger("tepna.cpap")

# §2 — a BRP.edf is a 25 Hz (40 ms) format. The EdfSink builds at that rate, so if the device's OBSERVED
# interval differs, the EDF timing would be silently wrong — the sink records the mismatch instead.
_EXPECTED_INTERVAL_MS = 40

# The device start_time, per the Clock Contract: an explicit regex, NEVER a locale parse. The device
# labels its stream clock with a trailing Z, but these machines carry no real zone — the stamp is local
# civil time wearing a Z, so the components are taken VERBATIM as floating wall-clock (§1), which is also
# exactly the zone-free civil convention the SD-card BRP.edf filenames use. Any real ±HH:MM offset is
# tolerated in the match and likewise ignored for the civil start; the box applies its host-axis
# correction downstream, never here at the capture edge (§7/§12).
_ISO_RE = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$"
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
    PENDING subtree of it. `flow_to_lps` converts a device PatientFlow sample to L/s (identity — the pin
    confirmed L/s, 2026-08-23). The EDF start is the DEVICE's own start_time — nothing here reads a wall
    clock for the recording INSTANT — but a zoned (UTC) stamp is rendered in the box's LOCAL civil time so
    the file matches the SD-card/OSCAR convention (see `_start_components`); only the timezone comes from
    the host, never the instant."""

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
        self._interval_checked = False   # §2 — observed-interval validated once, on the first batch
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
        if not self._interval_checked:
            iv = batch.get("interval_ms")           # §2 — consume the device's OWN interval, don't assume
            if isinstance(iv, (int, float)) and iv > 0:
                self._interval_checked = True
                if iv != _EXPECTED_INTERVAL_MS:
                    _log.warning(
                        "CPAP EDF sink: observed interval %s ms != the BRP 25 Hz rate (%s ms) — the EDF is "
                        "built at 25 Hz, so its timing will not match the stream",
                        iv, _EXPECTED_INTERVAL_MS,
                    )
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
        # Provenance: record the resolution (the raw device stamp → the local-civil components written), so
        # a UTC-vs-local question later has the conversion on the record rather than needing re-derivation.
        _log.info(
            "CPAP EDF start: device stamp %s resolved to local civil %04d-%02d-%02d %02d:%02d:%02d "
            "(SD-card/OSCAR convention)",
            start_iso, y, mo, d, hh, mm, ss,
        )
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


def _fixed_zone(zone):
    """A `±HH:MM` suffix → a datetime.timezone."""
    sign = 1 if zone[0] == "+" else -1
    return datetime.timezone(sign * datetime.timedelta(hours=int(zone[1:3]), minutes=int(zone[4:6])))


def device_stamp_to_tms(iso):
    """A raw device ISO stamp → Clock-Contract FLOATING tMs (ms), or None when it cannot be dated.

    PUBLIC because the acquisition envelope needs the same answer the EDF writer needs, and the
    Clock Contract allows exactly ONE parser per node (§2): duplicating the regex here would be the
    second implementation it forbids, so this delegates to `_start_components` rather than re-deriving.

    The components come back already resolved to LOCAL CIVIL time (see below), which IS the floating
    basis §1 defines — so `calendar.timegm` over them yields floating tMs directly, with no second
    timezone step. An unparseable or calendar-invalid stamp returns None; it is never dated to now
    (§2.6), matching the EDF writer's own refusal to date a file it cannot place."""
    parts = _start_components(iso)
    if parts is None:
        return None
    y, mo, d, hh, mm, ss = parts
    return calendar.timegm((y, mo, d, hh, mm, ss, 0, 0, 0)) * 1000.0


def _start_components(iso):
    """An ISO-8601 device stamp → the (y, mo, d, hh, mm, ss) to write as the EDF start, or None when
    unparseable/out-of-range.

    ⚠️ RESOLVED TO LOCAL CIVIL TIME, matching the SD-card BRP.edf, OSCAR, and the house Clock Contract (a
    floating LOCAL-civil wall clock — §1). The device's live StreamData stamp is UTC ('…Z'), but its own
    SD recording and OSCAR use local civil, so writing the UTC components verbatim mis-dates the EDF by the
    UTC offset — measured 2026-08-23, a clean 4 h (EDT), which the pin comparator's 698 s alignment surfaced.
    So a ZONED stamp (Z or ±HH:MM) is converted to the box's local civil time; an UNZONED stamp is already
    floating local civil and is taken verbatim. Explicit regex, not a locale parse (§2.4); components are
    validated by round-trip so a calendar-invalid stamp is None, not a silently rolled instant (§2.7); the
    one legal overflow is 24:00:00 → next-day 00:00:00."""
    if not iso:
        return None
    m = _ISO_RE.match(iso.strip())
    if not m:
        return None
    y, mo, d, hh, mm, ss, zone = m.groups()
    y, mo, d, hh, mm, ss = int(y), int(mo), int(d), int(hh), int(mm), int(ss)
    roll = False
    if (hh, mm, ss) == (24, 0, 0):        # ISO end-of-day → 00:00:00 the next calendar day
        hh, roll = 0, True
    try:
        dt = datetime.datetime(y, mo, d, hh, mm, ss)
    except ValueError:
        return None
    if roll:
        dt += datetime.timedelta(days=1)
    if zone:                              # a real instant → resolve to the box's LOCAL civil wall time
        tz = datetime.timezone.utc if zone == "Z" else _fixed_zone(zone)
        dt = dt.replace(tzinfo=tz).astimezone().replace(tzinfo=None)
    return (dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second)
