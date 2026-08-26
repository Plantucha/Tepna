# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""acq_evidence_o2ring — the O2Ring device ADAPTER for the Acquisition Evidence Contract.

Spec §9: the generic contract (`acq_evidence`) holds no protocol logic; device-specific code produces
the observations. This is that device code for the O2Ring STORED `.dat` path (Phase A). It is a PURE
NORMALIZER: the caller (`pull_session`) passes the facts it already computed — the inventory row, the
parsed trailer, the `verify()` result, the live-observed close duration — and this maps them into the
canonical envelope. It re-decodes nothing and re-hashes nothing (spec §12: one hashing system).

The §6 SEPARATION is the whole point here: `oxy_inventory`'s `VERIFIED` conflates "finalised" (a
COMPLETENESS fact, from the trailer) with "hash recorded" (a VALIDATION fact, from `verify`). This
adapter splits them back apart into the envelope's two independent axes.
"""

from __future__ import annotations

import acq_evidence as ae

_HEADER_LEN = 10
_TRAILER_LEN = 48
_RECORD_LEN = 3
# The O2Ring stored recording is one 3-byte record per second (SpO2, HR, motion) between a 10-byte
# header and a 48-byte trailer — the signal this envelope describes.
_SIGNAL = "spo2_hr_motion@1Hz"


def assemble_dat(
    inventory_row: dict,
    *,
    trailer: dict | None = None,
    verify_result=None,
    observed_duration_s: int | None = None,
    device_state: str | None = None,
    clock_status: str = ae.UNKNOWN,
    start_time_ms: float | None = None,
) -> ae.AcquisitionEvidence:
    """Normalize the O2Ring `.dat` acquisition facts into an `AcquisitionEvidence`.

    `inventory_row` is an `oxy_inventory.make_row` dict (device_id/session/state/size/sha256/path).
    `trailer` is `oxyii.parse_oxy_trailer(data)` or None. `verify_result` is an
    `oxy_transfer.VerifyResult` or None. `observed_duration_s` is the live path's close duration, if it
    saw the close (else None — UNKNOWN, never fabricated)."""
    size = inventory_row.get("size")
    path = inventory_row.get("path")

    # ── sample accounting (§8) — actual from the bytes on disk, expected from the trailer DECLARATION.
    # expected is UNKNOWN, never 0, when there is no trailer to declare it.
    sample_count = None
    if size is not None and size > _HEADER_LEN + _TRAILER_LEN:
        body = size - _HEADER_LEN - _TRAILER_LEN
        sample_count = body // _RECORD_LEN if body % _RECORD_LEN == 0 else None
    stored_s = trailer.get("total_seconds") if trailer else None
    expected_sample_count = stored_s if stored_s is not None else ae.UNKNOWN

    duration_check = ae.DurationCheck.build(stored_s=stored_s, observed_s=observed_duration_s)

    # ── validation axis (§6): independent of completeness. Prefer an oxy_transfer.verify() result (the
    # D-w1 record-boundary walk, richest depth); fall back to the landed pull's oxy_inventory state
    # (§19 — adapt at the boundary, do not rewire the classifier). VERIFIED/COMMITTED were classified
    # clean at the coarser "size+finalised" depth; FAILED is INVALID; anything else is UNKNOWN. ──
    if verify_result is not None:
        validation = ae.VALID if verify_result.ok else ae.INVALID
        validation_depth = verify_result.depth
    else:
        st = inventory_row.get("state")
        if st in ("VERIFIED", "COMMITTED"):
            validation, validation_depth = ae.VALID, "size+finalised"
        elif st == "FAILED":
            validation, validation_depth = ae.INVALID, "size+finalised"
        else:
            validation, validation_depth = ae.UNKNOWN, None

    # ── completeness axis (§6): INDEPENDENT of validation. The finalisation trailer is the primary
    # completeness fact (the recording ended cleanly), but a finalised artifact whose stored duration
    # is SHORTER than the live-observed session is still a PARTIAL acquisition — the §6 VALID+PARTIAL
    # case: intact, hash-valid bytes that captured only part of what was observed. And a .dat can be
    # COMPLETE + INVALID (finalised but hash-mismatched). The two axes never collapse. ──
    if not (trailer and trailer.get("finalized")):
        completeness = ae.PARTIAL if size else ae.UNKNOWN
    elif duration_check.agrees is False:
        completeness = ae.PARTIAL  # finalised artifact, but shorter than the observed session
    else:
        completeness = ae.COMPLETE

    # ── decode gaps (§8): the record-boundary walk proved the grid whole ⇒ 0; otherwise UNKNOWN, never
    # a fabricated count. Transport gaps are a LIVE-stream concept; for a stored file pull they are
    # UNKNOWN here (the .dat does not carry the original recording's BLE gap accounting). ──
    decode_gaps: int | str = (
        0 if (validation == ae.VALID and validation_depth and "records" in validation_depth) else ae.UNKNOWN
    )
    transport_gaps: int | str = ae.UNKNOWN

    sha = None
    if verify_result is not None and verify_result.sha256:
        sha = verify_result.sha256
    elif inventory_row.get("sha256"):
        sha = inventory_row.get("sha256")

    end_time_ms = None
    if start_time_ms is not None and stored_s is not None:
        end_time_ms = start_time_ms + stored_s * 1000

    return ae.AcquisitionEvidence(
        session_id=inventory_row.get("session"),
        device_id=inventory_row.get("device_id"),
        source=ae.SOURCE_STORED_DAT,
        signal=_SIGNAL,
        start_time_ms=start_time_ms,
        end_time_ms=end_time_ms,
        clock_status=clock_status,
        sample_count=sample_count,
        expected_sample_count=expected_sample_count,
        duration_check=duration_check,
        transport_gaps=transport_gaps,
        decode_gaps=decode_gaps,
        device_state=device_state if device_state is not None else ae.UNKNOWN,
        artifact_path=path,
        artifact_size=size,
        artifact_sha256=sha,
        validation=validation,
        validation_depth=validation_depth,
        completeness=completeness,
        provenance={
            "inventory_state": inventory_row.get("state"),
            "attempt": inventory_row.get("attempt"),
        },
    )

def assemble_live(
    *,
    device_id: str | None,
    session_id: str | None,
    artifact_path: str | None,
    artifact_rows: int | None,
    start_time_ms: float | None = None,
    clock_status: str = ae.UNKNOWN,
    clock_offset=None,
    device_state: str | None = None,
    stopped_cleanly: bool | None = None,
    ppg_grid: dict | None = None,
    ppg_ledger: dict | None = None,
) -> ae.AcquisitionEvidence:
    """Normalize a LIVE O2Ring session (the OXYFRAME/BLE path) into an `AcquisitionEvidence`.

    Spec §10 requires BOTH O2Ring paths and forbids merging them into one indistinguishable source —
    this is the live half, `assemble_dat` is the stored half, and they differ in `source` so a reader
    can always tell which one produced a night.

    ⚠️ THE GAP FIELDS ARE DELIBERATELY UNKNOWN, and that is a correctness decision rather than a gap in
    this function. The live path DOES carry rich gap accounting — but it belongs to the **PPG stream**
    (`O2PpgGrid`/`O2PpgFrameLedger`), while the artifact this envelope describes is the **1 Hz SpO2
    CSV**, a DIFFERENT stream from the same device. Reporting PPG grid gaps as this artifact's
    `transport_gaps` would attribute one stream's losses to another's file — a fabricated measurement
    wearing the shape of a real one, which is precisely what §8 forbids. The PPG figures are carried in
    `provenance` under their own name so nothing is lost and nothing is misattributed.

    `artifact_rows` is the row count the writer actually wrote — the honest sample count for THIS file.
    A live session that streamed nothing leaves a header-only file (the caller discards those), so a
    zero row count here is a real measurement, not an absence."""
    # ── validation (§6): the live path verifies no bytes — it writes them. There is no hash, no
    # re-read, no trailer. Claiming VALID would assert a check nobody ran, so validation is UNKNOWN
    # unless a caller supplies a verdict from an actual check. This is the honest asymmetry with the
    # stored path, where `verify()` really does re-read the file. ──
    validation, validation_depth = ae.UNKNOWN, None

    # ── completeness (§6), INDEPENDENT of validation. A live capture is COMPLETE when the session
    # ended on its own terms and rows were written; an interrupted one is PARTIAL. Without a
    # clean-stop signal we say UNKNOWN rather than guessing from row count alone — a long session and
    # a truncated one both have many rows. ──
    if stopped_cleanly is False:
        completeness = ae.PARTIAL
    elif stopped_cleanly is True and artifact_rows:
        completeness = ae.COMPLETE
    else:
        completeness = ae.UNKNOWN

    end_time_ms = None
    if start_time_ms is not None and artifact_rows:
        end_time_ms = start_time_ms + artifact_rows * 1000  # the CSV is 1 Hz, one row per second

    return ae.AcquisitionEvidence(
        session_id=session_id,
        device_id=device_id,
        source=ae.SOURCE_LIVE,
        signal=_SIGNAL,
        start_time_ms=start_time_ms,
        end_time_ms=end_time_ms,
        clock_status=clock_status,
        clock_offset=clock_offset if clock_offset is not None else ae.ClockOffset.unknown(),
        sample_count=artifact_rows,
        # no independent expectation exists for a live stream of unknown duration (§8: UNKNOWN, not 0)
        expected_sample_count=ae.UNKNOWN,
        # nothing declares a duration for a live session the way a .dat trailer does
        duration_check=ae.DurationCheck.build(stored_s=None, observed_s=None),
        transport_gaps=ae.UNKNOWN,  # see the docstring — the PPG grid's gaps are NOT this file's
        decode_gaps=ae.UNKNOWN,
        device_state=device_state if device_state is not None else ae.UNKNOWN,
        artifact_path=artifact_path,
        artifact_size=None,  # the caller has not stat'ed it; None, never 0 (§5)
        artifact_sha256=None,  # the live path computes no hash (§12 — never invent a second one)
        validation=validation,
        validation_depth=validation_depth,
        completeness=completeness,
        provenance={
            # PPG-stream accounting, named as such so it can never be read as this artifact's gaps
            "ppg_grid": ppg_grid,
            "ppg_ledger": ppg_ledger,
            "stopped_cleanly": stopped_cleanly,
        },
    )
