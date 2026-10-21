# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""acq_evidence_polar — the Polar device ADAPTER for the Acquisition Evidence Contract.

Spec §9: the generic contract (`acq_evidence`) holds no protocol logic; device-specific code produces
the observations. This is that device code for the LIVE Polar path — the PMD streams and the SIG Heart
Rate characteristic that `capture.run_polar` writes. It is a PURE NORMALIZER: the caller passes the
facts it already holds at teardown (the writer's row count, its resumed flag, the clean-stop signal,
the flush-health counters) and this maps them into the canonical envelope. It opens nothing, re-decodes
nothing and re-hashes nothing (§12: one hashing system).

WHY THIS EXISTS. Measured 2026-10-21 over this tree, the only adapters were `acq_evidence_o2ring` and
`acq_evidence_cpap`, so no Polar artifact carried the contract's three axes at all — not the H10's ECG,
not the Verity's optical streams. The gap was logged as the residue row
`2026-09-26-polar-streams-carry-no-acquisition-evidence`.

ONE ARTIFACT, ONE STREAM. A Polar session writes a SEPARATE file per stream, so an envelope here
describes exactly one of them and `signal` names it. This is the opposite shape from the ring, where one
live envelope describes the 1 Hz CSV while other streams of the same device travel in `provenance`.

THE CLOCK WORD IS DERIVED FROM THE ARTIFACT'S OWN HEADER, NOT FROM ITS TRANSPORT. `clock_status` was
declared on the envelope from the start and documented as "device+host / host / none", and until this
module no production caller ever passed one of those words — `pull_session` names the field and passes
UNKNOWN, so every envelope the box has written reads UNKNOWN there. This adapter is the first producer,
and it derives the word from `writers.StreamWriter.HEADERS[stream]`: a `sensor timestamp [ns]` column
means the device's own clock reached the file beside the host's, and no such column means the host
stamped it alone. Deriving it from the TRANSPORT would be wrong and `ppi` is the proof — `ppi` arrives
over PMD exactly as `ecg` does, yet its header carries no ns column, so a PMD-keyed rule would claim a
device clock that is not in the file. The header is what a reader actually meets.

Reading the table rather than restating it is deliberate: a hand-copied stream list would drift from the
writer silently, and the suite pins the parity in both directions (`tests/test_acq_evidence_polar.py`).
"""

from __future__ import annotations

import acq_evidence as ae
import writers

# The streams the live Polar path opens: the PMD set plus the two SIG-standard files. Declared here
# rather than imported from `capture`, which imports THIS module — the suite asserts the parity against
# `capture._PMD_STREAMS | {"hr", "rr"}` so the two cannot drift apart unnoticed.
POLAR_STREAMS = frozenset({"ecg", "acc", "ppg", "gyro", "mag", "ppi", "hr", "rr"})

# The column whose PRESENCE in a Polar artifact's header means the device's clock reached that file.
_DEVICE_CLOCK_COLUMN = "sensor timestamp [ns]"


def clock_status_for(stream: str) -> str:
    """The `clock_status` word for one Polar stream, read off the writer's own header table.

    ⚠️ THE DOMAIN IS THE POLAR STREAMS AND THE REFUSAL IS LOAD-BEARING. The header table is shared with
    the O2Ring, and four ring opcodes (`accraw`, `ppg2w`, `pletha`, `ppg1`) carry an ns column that
    `writers` fills with a literal 0 because those opcodes expose no device clock. For those streams the
    presence of the column is the opposite of evidence, so answering for them would turn a deliberate
    zero into a claimed second clock. This adapter is the POLAR adapter (§9); a stream it does not own
    gets a refusal, never a guess."""
    if stream not in POLAR_STREAMS:
        raise ValueError(f"{stream!r} is not a live Polar stream — acq_evidence_polar does not describe it")
    header = writers.StreamWriter.HEADERS.get(stream)
    if header is None:  # pragma: no cover — the parity test makes this unreachable
        return ae.UNKNOWN
    return ae.CLOCK_DEVICE_AND_HOST if _DEVICE_CLOCK_COLUMN in header else ae.CLOCK_HOST_ONLY


def assemble_live(
    *,
    device_id: str | None,
    session_id: str | None,
    stream: str,
    artifact_path: str | None,
    artifact_rows: int | None,
    resumed: bool = False,
    start_time_ms: float | None = None,
    end_time_ms: float | None = None,
    negotiated_hz: float | None = None,
    stopped_cleanly: bool | None = None,
    device_state: str | None = None,
    clock_offset=None,
    seam_count: int | None = None,
    rows_lost: int | None = None,
    flush_failures: int | None = None,
) -> ae.AcquisitionEvidence:
    """Normalize ONE live Polar stream artifact into an `AcquisitionEvidence`.

    `artifact_rows` is `StreamWriter.rows` — the rows THIS writer instance wrote. `resumed` is
    `StreamWriter.resumed`, and it changes what that count means (see below). `seam_count`, `rows_lost`
    and `flush_failures` are the writer's own flush-health counters.

    ⚠️ A RESUMED ARTIFACT HAS NO KNOWN SAMPLE COUNT. The writer reopens the same path in append mode at
    `rows=0`, so on a resume `rows` counts only this instance while the FILE also holds the earlier
    session's data. Reporting it as `sample_count` would state a number smaller than the artifact — so a
    resumed artifact reports `None` (§5: absent, never a convenient number) and the instance's own count
    travels in `provenance` as `rows_this_instance`, which is what it actually measures. `start_time_ms`
    is dropped for the same reason and is not a second decision: the caller's start is when THIS
    instance opened the file, while the artifact's first sample is in the earlier session nobody here
    saw, so reporting it would date the file to a time after it began. It travels as
    `instance_start_time_ms`.

    ⚠️ THE GAP FIELDS STAY UNKNOWN BECAUSE THE COUNTERS THIS PATH HAS ARE NOT THOSE GAPS. A flush seam
    is a WRITE-side discontinuity in the file and `rows_lost` is a row the writer could not persist;
    neither is a packet that never arrived (`transport_gaps`) nor a packet that arrived and would not
    decode (`decode_gaps`). Filing either under a gap category would be a fabricated measurement wearing
    the shape of a real one, which §8 forbids. They travel in `provenance` under their own names, so
    nothing is lost and nothing is misattributed."""
    clock_status = clock_status_for(stream)  # refuses a non-Polar stream before anything else is built

    # ── validation (§6): the live path verifies no bytes, it writes them. No hash, no re-read, no
    # trailer. Claiming VALID would assert a check nobody ran. The DEPTH goes below as a literal
    # rather than as a second local: a name that is always `None` is an indirection no test can tell
    # from the literal, and the mutation gate reads such a line as unobservable rather than as code.
    validation = ae.UNKNOWN

    # ── completeness (§6), INDEPENDENT of validation. Three facts can each deny COMPLETE and they are
    # checked in order of how certain they are: a row the writer LOST is a hole in this artifact
    # whatever else went right; a session that did not stop cleanly was cut short; and a resumed file
    # cannot be called complete by this instance, which did not see its beginning. ──
    if rows_lost:
        completeness = ae.PARTIAL
    elif stopped_cleanly is False:
        completeness = ae.PARTIAL
    elif stopped_cleanly is True and artifact_rows and not resumed:
        completeness = ae.COMPLETE
    else:
        completeness = ae.UNKNOWN

    # `signal` names the stream, and the negotiated rate only when the caller measured one. A PMD rate
    # is negotiated per session, so it is a session FACT rather than a property of the stream key —
    # which is exactly why it is not hardcoded the way the ring's `@1Hz` is.
    signal = f"{stream}@{negotiated_hz:g}Hz" if negotiated_hz else stream

    return ae.AcquisitionEvidence(
        session_id=session_id,
        device_id=device_id,
        source=ae.SOURCE_LIVE,
        signal=signal,
        start_time_ms=None if resumed else start_time_ms,  # see the docstring: not THIS file's start
        # NOT derived from rows: `rr`/`ppi` rows are beats, `hr` is paced by the strap, and a PMD rate
        # over a stream that dropped packets gives the COVERED span rather than the wall span. The
        # caller passes one when it has one; otherwise it stays absent (§∅).
        end_time_ms=end_time_ms,
        clock_status=clock_status,
        clock_offset=clock_offset if clock_offset is not None else ae.ClockOffset.unknown(),
        sample_count=None if resumed else artifact_rows,
        # nothing independent declares how many samples a live stream of unknown duration should hold
        expected_sample_count=ae.UNKNOWN,
        # no in-artifact duration DECLARATION exists for a live Polar stream the way a .dat trailer has
        duration_check=ae.DurationCheck.build(stored_s=None, observed_s=None),
        transport_gaps=ae.UNKNOWN,  # see the docstring — a seam is not a transport gap
        decode_gaps=ae.UNKNOWN,  # — and a lost row is not a decode failure
        device_state=device_state if device_state is not None else ae.UNKNOWN,
        artifact_path=artifact_path,
        artifact_size=None,  # the caller has not stat'ed it; None, never 0 (§5)
        artifact_sha256=None,  # the live path computes no hash (§12 — never invent a second one)
        validation=validation,
        validation_depth=None,  # a depth describes a check that RAN, and none ran (§6)
        completeness=completeness,
        provenance={
            "stream": stream,
            "resumed": resumed,
            # what `artifact_rows` actually measures, named so it can never be read as the file's size
            "rows_this_instance": artifact_rows,
            "instance_start_time_ms": start_time_ms,
            # write-side accounting, named as such so none of it can be read as a link-side gap
            "flush_seams": seam_count,
            "rows_lost": rows_lost,
            "flush_failures": flush_failures,
            "stopped_cleanly": stopped_cleanly,
            "negotiated_hz": negotiated_hz,
        },
    )
