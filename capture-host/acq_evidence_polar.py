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

AND THE STORED HALF — `assemble_pull`. The same device also records to its OWN flash when nobody is
connected, and `polar_psftp.pull_recording` mirrors that directory off the device over PS-FTP. That
acquisition is a SET of files rather than one stream, it carries no host clock at all, and its one
independent check is the per-file size the device DECLARED in its own directory listing. It gets its own
assembler and its own `source` word; §10 forbids collapsing it into the live one.

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

import calendar
import datetime as _dt

import acq_evidence as ae
import oxy_inventory  # §12: the ONE content-hash helper this tree has — never a second one
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
    instance_start_time_ms: float | None = None,
    end_time_ms: float | None = None,
    negotiated_hz: float | None = None,
    stopped_cleanly: bool | None = None,
    device_state: str | None = None,
    clock_offset=None,
    seam_count: int | None = None,
    rows_lost: int | None = None,
    flush_failures: int | None = None,
    sibling_artifacts: "list[str] | None" = None,
) -> ae.AcquisitionEvidence:
    """Normalize ONE live Polar stream artifact into an `AcquisitionEvidence`.

    `artifact_rows` is `StreamWriter.rows` — the rows THIS writer instance wrote. `resumed` is
    `StreamWriter.resumed`, and it changes what that count means (see below). `seam_count`, `rows_lost`
    and `flush_failures` are the writer's own flush-health counters.

    ⚠️ TWO STARTS EXIST AND THEY ARE DIFFERENT QUANTITIES. `start_time_ms` dates the ARTIFACT and is
    `StreamWriter.first_row_ms` — when the first row landed in this file. `instance_start_time_ms` is
    when the session began, and it travels in `provenance` under that name only. Feeding the session
    start into `start_time_ms` was the defect residue
    `2026-10-26-the-acquisition-envelope-dates-an-artifact-by-the-session-start` names: a stream can
    open minutes or hours after its session does, measured up to 18.71 h over the host-written corpus,
    and the envelope beside the file is exactly what a reader turns to when it distrusts the filename
    stamp. A writer with no landed row reports `None` (§∅), never the session start.

    ⚠️ A RESUMED ARTIFACT HAS NO KNOWN SAMPLE COUNT. The writer reopens the same path in append mode at
    `rows=0`, so on a resume `rows` counts only this instance while the FILE also holds the earlier
    session's data. Reporting it as `sample_count` would state a number smaller than the artifact — so a
    resumed artifact reports `None` (§5: absent, never a convenient number) and the instance's own count
    travels in `provenance` as `rows_this_instance`, which is what it actually measures. `start_time_ms`
    is dropped for the same reason and is not a second decision: this instance's first row is not the
    FILE's first row, which lies in the earlier session nobody here saw, so reporting it would date the
    file to a time after it began.

    ⚠️ THE GAP FIELDS STAY UNKNOWN BECAUSE THE COUNTERS THIS PATH HAS ARE NOT THOSE GAPS. A flush seam
    is a WRITE-side discontinuity in the file and `rows_lost` is a row the writer could not persist;
    neither is a packet that never arrived (`transport_gaps`) nor a packet that arrived and would not
    decode (`decode_gaps`). Filing either under a gap category would be a fabricated measurement wearing
    the shape of a real one, which §8 forbids. They travel in `provenance` under their own names, so
    nothing is lost and nothing is misattributed.

    ⚠️ `sibling_artifacts` NAMES THE FILES THIS WRITER OWNS THAT CARRY NO ENVELOPE OF THEIR OWN, AND IT
    CLAIMS NO ACQUISITION FOR ANY OF THEM. One envelope describes one artifact, so the `hr` writer's
    `_RR` file and any stream's `RUNS`/`SEAMS` sidecar were invisible to a reader holding only the
    primary file's envelope. The caller passes `StreamWriter.paths`, which is every owned file; the
    primary is dropped here because this envelope already describes it. The word is OWNERSHIP and
    nothing more: the `hr` writer DERIVES its `_RR` rows from the HR rows it received, so an envelope
    asserting an acquisition for that file would claim a stream the link never carried. `None` means
    the caller passed no list (§5: unmeasured), and `[]` means a writer that owns no sibling."""
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
            "instance_start_time_ms": instance_start_time_ms,
            # write-side accounting, named as such so none of it can be read as a link-side gap
            "flush_seams": seam_count,
            "rows_lost": rows_lost,
            "flush_failures": flush_failures,
            "stopped_cleanly": stopped_cleanly,
            "negotiated_hz": negotiated_hz,
            # see the docstring: ownership, never an acquisition claim. The primary is dropped because
            # the envelope around this key already names it as `artifact_path`.
            "sibling_artifacts": (
                None if sibling_artifacts is None else [q for q in sibling_artifacts if q != artifact_path]
            ),
        },
    )


# ── the STORED path: an onboard recording pulled off the device's own filesystem (PS-FTP) ──────────

# What the pull actually verified about the bytes it holds. The device's directory listing DECLARES a
# size per file and `pull_recording` compares the transferred length against it, landing a mismatch in
# `.part` rather than under the real name. That is a real check, run per file, and naming its depth is
# what keeps the VALID word from implying a hash or a decode nobody ran (§6).
PULL_VALIDATION_DEPTH = "declared-size-per-file"

# WHERE the device clock was read, carried in `provenance` so `clock_status` cannot be over-read. The
# device named the session directory `/U/0/YYYYMMDD/{E|R}/HHMMSS/` from its own RTC while no host was
# connected, and that stamp is the whole of the device clock this path can see: nothing here decodes the
# recording's own container, so whether the SAMPLES carry their own stamps is unmeasured, not denied.
PULL_CLOCK_SOURCE = "session-path stamp (not per-sample)"

# HOW ONE DIGEST COVERS A DIRECTORY, carried in `provenance` so a reader can RE-DERIVE it from the files
# on disk instead of trusting the number. The composition is not new: `manifest-gate.js` identifies a
# bundle by sorted `logicalName \0 sha256(text)` lines, and `tools/sigma-corpus-headless.mjs` pins a
# corpus population the same way. Reusing that rule keeps §12's "one hashing system" true of a SET as
# well as of a file — every leaf is `oxy_inventory.sha256_bytes`, and only the ORDER and the separator
# are stated here.
SET_DIGEST_RULE = "sha256 over sorted '<name>\\0<sha256 of that file>' lines joined by '\\n'"


def _artifact_digest(files: list[dict]) -> tuple[str | None, dict]:
    """ONE digest over the pulled set, or `None` beside the reason it could not be computed.

    ⚠️ A DIGEST OVER A SUBSET WOULD DESCRIBE A DIFFERENT POPULATION THAN `artifact_size`. That field is
    the transferred total over EVERY file in the manifest, skipped ones included, so a digest that
    quietly dropped the unhashed members would read as the identity of the whole set while covering
    part of it. So one absent leaf makes the whole digest absent, and the count of absent leaves
    travels beside it (§∅: absent, with a named reason, never a partial answer under a whole name).

    A size-matched skip is the ordinary way a leaf is absent: the second pull of a session reads no
    bytes at all, so it can digest nothing. That is honest rather than unfortunate — a re-pull which
    opened no file has shown nothing about those bytes, and the ring pull is the same shape.

    🔴 THE ABSENT LEAVES ARE NAMED, NOT COUNTED. A count tells a reader how many files the digest is
    waiting on and nothing about WHICH, so the next question — is this the one 4 KB sidecar or the
    session's whole ACC stream — costs a second pull to answer. The names travel in manifest order,
    which is the order the device listed them in."""
    leaves, unhashed = [], []
    for f in files:
        sha = f.get("sha256")
        if not sha:
            unhashed.append(f.get("name"))
            continue
        leaves.append(f"{f.get('name')}\0{sha}")
    meta = {
        "rule": SET_DIGEST_RULE,
        "n_hashed": len(leaves),
        "n_unhashed": len(unhashed),
        "unhashed": unhashed,
        "absent": None,
    }
    if not files:
        meta["absent"] = "nothing was pulled, so there is no set to digest"
        return None, meta
    if unhashed:
        meta["absent"] = (
            f"{len(unhashed)} of {len(files)} file(s) carry no digest, so the set has none: a size-matched "
            "skip reads no bytes, and hashing the copy on disk would answer a different question"
        )
        return None, meta
    leaves.sort()
    return oxy_inventory.sha256_bytes("\n".join(leaves).encode()), meta


def _device_start_ms(date: str | None, hhmmss: str | None) -> float | None:
    """The device's own session start as a Clock-Contract floating wall-clock ms, or `None`.

    `date` is `YYYYMMDD` and `hhmmss` is `HHMMSS`, exactly as the device named the directories and as
    `polar_psftp._session_meta` already split them out. The stamp carries NO ZONE — it is the device's
    local civil time — so the result is floating (`tMs`), the same encoding `capture` uses for the live
    path, and no offset is claimed.

    ⚠️ THE COMPONENTS ARE RANGE-VALIDATED, and that is not belt-and-braces. The Clock Contract §7 records
    that `Date.UTC` silently rolls impossible components onto a wrong instant, and `timegm` over a
    hand-built tuple does the same: `20261332` would become January 1932's problem rather than a
    refusal. `_session_meta` checks only that the segment is eight digits, so a corrupted or
    foreign-shaped directory name reaches here intact. Building a `datetime` first is what refuses it —
    and the refusal is visible, because `clock_status_for_pull` reads this result and says UNKNOWN
    rather than naming a clock it could not read."""
    if not date or not hhmmss or len(date) != 8 or len(hhmmss) != 6:
        return None
    if not date.isdigit() or not hhmmss.isdigit():
        return None
    try:
        dt = _dt.datetime(
            int(date[:4]), int(date[4:6]), int(date[6:]), int(hhmmss[:2]), int(hhmmss[2:4]), int(hhmmss[4:])
        )
    except ValueError:
        return None  # an impossible calendar day or clock reading — absent, never rolled (§∅)
    return calendar.timegm(dt.timetuple()) * 1000.0


def clock_status_for_pull(start_ms: float | None) -> str:
    """The `clock_status` word for a PS-FTP pull: `device`, or UNKNOWN when no device stamp was read.

    AN OFFLINE RECORDING HAS NO HOST CLOCK, BY CONSTRUCTION. The device writes those samples to its own
    flash with nothing connected, so the host's clock never touched them and no cross-check between two
    clocks can ever exist for those bytes — which is exactly why `device+host` would be a false promise
    here and why the live adapter's header rule cannot answer this question. The device's own clock, on
    the other hand, is demonstrably there: the device named the session directory from its RTC, which is
    the stamp `start_ms` was derived from. `none` would deny it.

    When that stamp did not parse, this path has read NO clock at all and says so. It does not fall back
    to `none`, which is a measured conclusion about both clocks rather than an absence of measurement
    (§5), and it does not guess from the transport (the mistake the live adapter's docstring records)."""
    return ae.CLOCK_DEVICE_ONLY if start_ms is not None else ae.UNKNOWN


def assemble_pull(
    manifest: dict,
    *,
    device_id: str | None = None,
    session_id: str | None = None,
    session_meta: dict | None = None,
    device_state: str | None = None,
    clock_offset: ae.ClockOffset | None = None,
) -> ae.AcquisitionEvidence:
    """Normalize ONE pulled Polar onboard recording — a whole session directory — into an envelope.

    `manifest` is what `polar_psftp.pull_recording` returns and `session_meta` is what its
    `_session_meta` derived from the on-device path; this reads both and opens nothing (§9/§12: no
    second hashing system, no re-read of the pulled bytes).

    THE ARTIFACT IS THE SET. A pull mirrors a directory, so one envelope describes the whole session and
    `signal` stays absent: the file names are in `provenance`, and naming one of them as the signal would
    describe a fraction of what the envelope covers. `artifact_size` is the transferred total, which is
    the one size that is true of the set, and `artifact_sha256` is one digest over the same population
    (`_artifact_digest`, composed by the rule `provenance.artifact_digest.rule` states).

    ⚠️ THE TWO AXES SEPARATE CLEANLY HERE, AND THE PULL IS THE CONTRACT'S CLEANEST §6 EXAMPLE. Validation
    asks whether the bytes we hold match what the device declared — a per-file length check that really
    ran. Completeness asks whether we hold the whole set, which a TRUNCATED LISTING leaves unanswerable
    even when every transferred byte checked out. So a pull is routinely VALID + UNKNOWN, and that pair
    is information rather than a contradiction.

    ⚠️ AN UNENUMERATED DIRECTORY IS UNKNOWN, NOT PARTIAL. `pull_recording` already draws this line for
    its own `ok` field: a listing that raised or came back truncated means the pull was complete over
    what it HAPPENED TO SEE. Reporting PARTIAL would assert that something is missing, which nobody
    measured; reporting COMPLETE would assert the opposite (§5). A manifest that carries no
    `unenumerated` count at all gets the same UNKNOWN — the count is absent, so it is not zero."""
    meta = dict(session_meta or {})
    files = list(manifest.get("files") or [])
    short = list(manifest.get("short") or [])
    unenumerated = manifest.get("unenumerated")
    new_files = manifest.get("new_files")

    start_ms = _device_start_ms(meta.get("date"), meta.get("time"))

    # ── validation (§6): the declared-size check per file. Nothing was pulled ⇒ nothing was checked,
    # and a verdict over zero files is not a verdict. ──
    if not files:
        validation = ae.UNKNOWN
        validation_depth = None
    elif short:
        validation = ae.INVALID
        validation_depth = PULL_VALIDATION_DEPTH
    else:
        validation = ae.VALID
        validation_depth = PULL_VALIDATION_DEPTH

    # ── completeness (§6), independent of the above and ordered by certainty: a short file is a hole we
    # MEASURED; an unenumerated directory is a question we could not ask; everything else answered. ──
    if not files:
        completeness = ae.UNKNOWN
    elif short:
        completeness = ae.PARTIAL
    elif unenumerated is None:
        completeness = ae.UNKNOWN  # nobody counted — an absent count is not a count of zero (§∅)
    elif unenumerated:
        completeness = ae.UNKNOWN  # counted, and a directory did not answer: we cannot tell
    else:
        completeness = ae.COMPLETE

    # ── artifact identity (§12): one digest over the set, or None with the reason named ──
    set_sha, digest_meta = _artifact_digest(files)

    return ae.AcquisitionEvidence(
        session_id=session_id if session_id is not None else _pull_session_id(meta),
        device_id=device_id,
        source=ae.SOURCE_STORED_FILES,
        # see the docstring: the set spans whatever streams the device recorded, so no one name is it
        signal=None,
        start_time_ms=start_ms,  # the DEVICE's stamp, floating (no zone was ever written)
        end_time_ms=None,  # the pull reads no end stamp, and samples/s is not decoded here
        clock_status=clock_status_for_pull(start_ms),
        clock_offset=clock_offset if clock_offset is not None else ae.ClockOffset.unknown(),
        # a file pull moves BYTES. Nothing here decodes the device's container, so there is no sample
        # count to report and nothing declares one either (§8: UNKNOWN, never 0).
        sample_count=None,
        expected_sample_count=ae.UNKNOWN,
        duration_check=ae.DurationCheck.build(stored_s=None, observed_s=None),
        # a truncated FILE is not a packet that never arrived, and nothing decoded these bytes at all —
        # filing either count under a gap category would be the fabricated measurement §8 forbids
        transport_gaps=ae.UNKNOWN,
        decode_gaps=ae.UNKNOWN,
        device_state=device_state if device_state is not None else ae.UNKNOWN,
        artifact_path=manifest.get("out_dir"),
        artifact_size=manifest.get("total_bytes"),
        # ONE digest over the SET, which is what `artifact_path` and `artifact_size` already describe.
        # It deepens no verdict: the device declares a size and never a hash, so `validation_depth`
        # stays `declared-size-per-file`. What it adds is the identity the declared-size check cannot
        # give — a reader holding the directory can show that these are still the bytes that arrived.
        artifact_sha256=set_sha,
        validation=validation,
        validation_depth=validation_depth,
        completeness=completeness,
        provenance={
            "session_path": manifest.get("session"),
            "kind": meta.get("kind"),
            "device_stamp_local": meta.get("start_local"),
            "device_clock_read_from": PULL_CLOCK_SOURCE if start_ms is not None else None,
            "n_files": len(files),
            # THE ENUMERATION, not just the count: a reader that meets this envelope can now walk the
            # directory and re-derive both the per-file digests and the set digest from `rule`.
            "files": [{"name": f.get("name"), "bytes": f.get("bytes"), "sha256": f.get("sha256")} for f in files],
            "artifact_digest": digest_meta,
            "n_new": None if new_files is None else len(new_files),
            "n_skipped": sum(1 for f in files if f.get("skipped")),
            "short": short,
            "unreadable_dirs": manifest.get("unreadable_dirs"),
            "truncated_dirs": manifest.get("truncated_dirs"),
            "unenumerated": unenumerated,
            # the pull's OWN one-line verdict, carried rather than re-derived: it folds both axes into
            # one boolean, so a reader can see where this envelope's two words came from
            "pull_ok": manifest.get("ok"),
        },
    )


def _pull_session_id(meta: dict) -> str | None:
    """The 14-digit `YYYYMMDDHHMMSS` stamp, or None when the device path carried no date and time.

    The same token the live path uses, and for the same reason: a reader joins an envelope to a night by
    finding the session id inside the artifact's name, and the box already names a pulled directory
    `Polar_Offline_<serial>_<14 digits>`. Reusing the token means no second matching rule."""
    date, hhmmss = meta.get("date"), meta.get("time")
    return f"{date}{hhmmss}" if date and hhmmss else None
