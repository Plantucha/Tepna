# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""acq_evidence_cpap — the CPAP device ADAPTER for the Acquisition Evidence Contract (Phase B).

Spec §9: the generic contract (`acq_evidence`) holds no protocol logic; device-specific code produces
the observations. This is that device code for the AS11 CPAP, and — like `acq_evidence_o2ring` — it is
a PURE NORMALIZER. It re-decodes nothing, re-hashes nothing (§12: one hashing system), and TOUCHES
NOTHING it reads: every fact here is already stored by a landed module, and this maps those facts into
the canonical envelope.

WHAT IT CONSUMES (all pre-existing stores, none modified):
  cpap_record.RawRecordSink   the durable append-only JSONL raw record — INV9's authoritative copy, and
                              therefore THE artifact this envelope describes for a live session.
  cpap_ingest.GapCounters     forensic frame accounting (§8) — kept as CATEGORIES, never a percentage.
  cpap_edf_writer.EdfSink     the DERIVED BRP.edf. Recorded in `provenance`, never as the artifact:
                              conflating a derived file with the authoritative record would invert INV9.
  cpap_supervisor.Decision    FGState / LastTherapyUseDateTime observations, read from SESSIONDETECT.csv
                              if present and UNKNOWN if absent (§5 — an unread supervisor is not "Standby").
  cpap_spool                  the committed-round ledger + cursors, for the STORED path.

TWO SOURCES, NEVER MERGED (§10's rule, applied to CPAP): a LIVE BLE stream and a STORED spool pull are
different acquisitions with different evidence, so they get different assemblers and different `source`
values. `assemble_live` describes what streamed; `assemble_spool` describes what was pulled from the
device's own spool.

THE DURATION_CHECK ANALOG (lead-ratified): the O2Ring compares the `.dat` trailer's `total_seconds`
DECLARATION against the live-observed close duration. CPAP's parallel is the device's own
`MachineMetrics.LastTherapyUseDateTime` — a device-authored verdict on when therapy ended, independent
of anything the host observed. So the device-declared session length is `stored_s` and the streamed
duration is `observed_s`, and their disagreement is a first-class field rather than a silent
reconciliation. Same vocabulary, same sign convention (`delta_s = stored_s - observed_s`).
"""

from __future__ import annotations

import acq_evidence as ae

# The live BRP stream is flow + mask pressure at 25 Hz (40 ms), fixed by the AS11 BRP layout.
SIGNAL_BRP = "flow_pressure@25Hz"

# Validation depths — what the validation ACTUALLY checked, never a bare boolean (the §6 discipline).
DEPTH_JSONL_CLOSED = "jsonl+closed"      # the raw record was flushed, fsynced and closed cleanly
DEPTH_SPOOL_PROMOTE = "sha256+promote"   # every committed round was re-read and sha-verified by promote()


def _counter(summary: dict | None, *keys: str) -> int | str:
    """Sum the named gap categories, or UNKNOWN when there is no accounting at all (§5/§8: absent
    accounting is UNKNOWN, never a fabricated 0 — 0 means "counted, and none happened")."""
    if not summary:
        return ae.UNKNOWN
    return sum(int(summary.get(k) or 0) for k in keys)


def assemble_live(
    raw_facts: dict,
    *,
    counters: dict | None = None,
    edf_path: str | None = None,
    device_state: str | None = None,
    clock_status: str = ae.UNKNOWN,
    start_time_ms: float | None = None,
    observed_duration_s: int | None = None,
    device_declared_duration_s: int | None = None,
    observed_interval_ms: float | None = None,
    artifact_sha256: str | None = None,
    artifact_valid: bool | None = None,
    stopped_cleanly: bool | None = None,
) -> ae.AcquisitionEvidence:
    """Normalize one LIVE CPAP BLE streaming session into an `AcquisitionEvidence`.

    `raw_facts` is `cpap_record.RawRecordSink.acq_facts()` (session_id/device_id/path/records/closed).
    `counters` is `cpap_ingest.GapCounters.summary()`. `device_declared_duration_s` is the device's own
    LastTherapyUseDateTime-derived session length; `observed_duration_s` is what actually streamed —
    passing only one is fine and yields no comparison rather than a fabricated agreement."""
    facts = raw_facts or {}

    # ── sample accounting (§8). `samples_ok` is what the sinks actually received. The expectation is
    # derivable ONLY from an observed duration AND the device's own observed interval — never from the
    # REQUESTED nominal rate (cpap_stream §2: the observed interval is authoritative). Missing either
    # ⇒ UNKNOWN, never 0. ──
    sample_count = None
    if counters and counters.get("samples_ok") is not None:
        sample_count = int(counters["samples_ok"])
    expected_sample_count: int | str = ae.UNKNOWN
    if observed_duration_s is not None and observed_interval_ms:
        expected_sample_count = int(observed_duration_s * 1000 / observed_interval_ms)

    duration_check = ae.DurationCheck.build(
        stored_s=device_declared_duration_s, observed_s=observed_duration_s
    )

    # ── gap accounting (§8): forensic CATEGORIES, so a reader can tell WHY it is incomplete. Transport
    # loss is the queue overflow plus the post-drop tail; decode loss is the malformed frames. A FOREIGN
    # frame is deliberately NEITHER — it was never ours (GapCounters.total_lost draws the same line). The
    # untruncated summary rides in `provenance`, so nothing is lost to this projection. ──
    transport_gaps = _counter(counters, "overflow", "post_drop_tail")
    decode_gaps = _counter(counters, "malformed")

    # ── validation axis (§6), independent of completeness. An explicit caller verdict wins; otherwise a
    # cleanly-closed record is VALID at the depth that names what that actually proves. An UNCLOSED
    # record is UNKNOWN, never INVALID: a torn tail is repaired on the next open, so concluding
    # "invalid" from "not closed" would be exactly the §5 negative conclusion from missing information. ──
    if artifact_valid is not None:
        validation = ae.VALID if artifact_valid else ae.INVALID
        validation_depth = DEPTH_JSONL_CLOSED
    elif facts.get("closed") is True:
        validation, validation_depth = ae.VALID, DEPTH_JSONL_CLOSED
    else:
        validation, validation_depth = ae.UNKNOWN, None

    # ── completeness axis (§6), INDEPENDENT of validation. Any KNOWN loss makes the acquisition PARTIAL
    # however valid the bytes are (the VALID+PARTIAL case). `sink_errors` counts batches that reached the
    # bus but not the durable record — INV9 loss, so it is completeness evidence here even though
    # GapCounters keeps it out of `total_lost`. A device/host duration disagreement is the same finding
    # from the other direction. With no accounting and no clean-stop signal we say UNKNOWN. ──
    lost = 0
    if counters:
        lost = int(counters.get("total_lost") or 0) + int(counters.get("sink_errors") or 0)
    if lost or stopped_cleanly is False or duration_check.agrees is False:
        completeness = ae.PARTIAL
    elif stopped_cleanly is True and counters:
        completeness = ae.COMPLETE
    else:
        completeness = ae.UNKNOWN

    end_time_ms = None
    if start_time_ms is not None and observed_duration_s is not None:
        end_time_ms = start_time_ms + observed_duration_s * 1000

    return ae.AcquisitionEvidence(
        session_id=facts.get("session_id"),
        device_id=facts.get("device_id"),
        source=ae.SOURCE_LIVE,
        signal=SIGNAL_BRP,
        start_time_ms=start_time_ms,
        end_time_ms=end_time_ms,
        clock_status=clock_status,
        sample_count=sample_count,
        expected_sample_count=expected_sample_count,
        duration_check=duration_check,
        transport_gaps=transport_gaps,
        decode_gaps=decode_gaps,
        device_state=device_state if device_state is not None else ae.UNKNOWN,
        artifact_path=facts.get("path"),
        artifact_size=facts.get("size"),
        artifact_sha256=artifact_sha256,
        validation=validation,
        validation_depth=validation_depth,
        completeness=completeness,
        provenance={
            # the UNPROJECTED accounting — `transport_gaps`/`decode_gaps` are a lossy view of this
            "gap_counters": counters,
            # the DERIVED artifact, never confused with the authoritative record above (INV9)
            "edf_artifact": edf_path,
            "records": facts.get("records"),
            "observed_interval_ms": observed_interval_ms,
            "stopped_cleanly": stopped_cleanly,
        },
    )


def assemble_spool(
    rows: list,
    *,
    device_id: str | None = None,
    session_id: str | None = None,
    device_state: str | None = None,
    clock_status: str = ae.UNKNOWN,
    committed_dir: str | None = None,
) -> ae.AcquisitionEvidence:
    """Normalize a STORED spool acquisition — the device's own spooled data, pulled over BLE — from its
    committed ledger rows (`cpap_spool.committed_rows`). Never merged with the live source (§10).

    Each committed row is already sha-verified: `cpap_spool.promote` RE-READS the staged bytes and
    refuses on mismatch, so a row's presence IS the validation evidence. This reads the ledger and
    computes nothing over the artifact bytes."""
    rows = list(rows or [])

    # ── an empty ledger is UNKNOWN on every axis — not an empty, complete, valid acquisition (§5). ──
    if not rows:
        return ae.AcquisitionEvidence(
            session_id=session_id, device_id=device_id, source=ae.SOURCE_STORED_SPOOL,
            signal=None, start_time_ms=None, end_time_ms=None, clock_status=clock_status,
            sample_count=None, expected_sample_count=ae.UNKNOWN,
            duration_check=ae.DurationCheck.build(stored_s=None, observed_s=None),
            transport_gaps=ae.UNKNOWN, decode_gaps=ae.UNKNOWN,
            device_state=device_state if device_state is not None else ae.UNKNOWN,
            artifact_path=committed_dir, artifact_size=None, artifact_sha256=None,
            validation=ae.UNKNOWN, validation_depth=None, completeness=ae.UNKNOWN,
            provenance={"rounds": 0, "committed_cursor": None},
        )

    last = rows[-1]
    total_bytes = sum(int((r.get("round") or {}).get("bytes") or 0) for r in rows)

    # ── completeness comes from the DEVICE's own end-of-data verdict, which is exactly what the spool
    # status carries: NO_MORE_DATA is the device saying it has served everything from the cursor.
    # MORE_DATA_PENDING is an explicitly incomplete acquisition, and anything else is UNKNOWN. ──
    status = (last.get("round") or {}).get("status")
    if status == "NO_MORE_DATA":
        completeness = ae.COMPLETE
    elif status == "MORE_DATA_PENDING":
        completeness = ae.PARTIAL
    else:
        completeness = ae.UNKNOWN

    return ae.AcquisitionEvidence(
        session_id=session_id if session_id is not None else last.get("session"),
        device_id=device_id if device_id is not None else last.get("device"),
        source=ae.SOURCE_STORED_SPOOL,
        signal=last.get("spool_type"),
        start_time_ms=None,   # cursors are VERBATIM device stamps; localising them is the consumer's
        end_time_ms=None,     # step, not this assembler's (Clock Contract — no second clock model, §7)
        clock_status=clock_status,
        # a spool round is a BYTE transfer, not a frame stream: there is no sample count to report and
        # no gap accounting to project. UNKNOWN, never 0 (§8).
        sample_count=None,
        expected_sample_count=ae.UNKNOWN,
        duration_check=ae.DurationCheck.build(stored_s=None, observed_s=None),
        transport_gaps=ae.UNKNOWN,
        decode_gaps=ae.UNKNOWN,
        device_state=device_state if device_state is not None else ae.UNKNOWN,
        artifact_path=committed_dir,
        artifact_size=total_bytes,
        # NO combined hash: each round carries its own, and inventing one over the set would be the
        # second hashing system §12 forbids. The per-round shas are in `provenance` instead.
        artifact_sha256=None,
        validation=ae.VALID,
        validation_depth=DEPTH_SPOOL_PROMOTE,
        completeness=completeness,
        provenance={
            "rounds": len(rows),
            "committed_cursor": last.get("committed_cursor"),
            "round_seq_last": last.get("round_seq"),
            "round_sha256": [(r.get("round") or {}).get("sha256") for r in rows],
            "status": status,
        },
    )
