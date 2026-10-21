# tepna-capture — tests/test_acq_evidence_polar.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""acq_evidence_polar — the Polar adapter for the Acquisition Evidence Contract.

The contract invariants are tested as PLANTED CONTROLS, not as incidental assertions: each one names a
value the adapter must NOT produce, so the test fails if the invariant is ever quietly relaxed.

  §5  UNKNOWN ≠ ABSENT      — absent accounting is UNKNOWN, never 0. `0` means "counted, none happened".
  §6  VALID ⟂ COMPLETE      — the two axes move independently and are never collapsed.
  §4  ACQUISITION ≠ SCIENCE — nothing here reads or writes an evidence tier.
  §8  NO FABRICATED FIGURE  — a write-side counter is never filed under a link-side gap category.
  §9  THE ADAPTER OWNS ONE DEVICE — a stream it does not own gets a refusal, never a guess.
  §18 EXECUTION WITNESS     — the envelope is written by the production seam, not only by the assembler.

Two findings this adapter rests on are pinned here so neither can be "simplified" away:

  · `clock_status` is derived from the ARTIFACT'S HEADER, not from its transport. `ppi` arrives over
    PMD exactly as `ecg` does and its file carries no device-clock column, so a transport-keyed rule
    would claim a clock that is not in the file.
  · A RESUMED artifact has no known sample count and no known start. The writer reopens the path in
    append mode at `rows=0`, so the instance's figures describe the instance and not the file.
"""

import json

import acq_evidence as ae
import acq_evidence_polar as polar
import pytest
import writers

_NS_COLUMN = "sensor timestamp [ns]"
# The four O2Ring opcodes whose header carries an ns column that `writers` fills with a literal 0,
# because the opcode exposes no device clock. They are the reason the refusal below is load-bearing.
_RING_ZERO_NS_STREAMS = ("accraw", "ppg2w", "pletha", "ppg1")


def _ev(**kw):
    """One envelope with the fields a live Polar teardown always has, overridable per test."""
    base = dict(
        device_id="VERITY-01",
        session_id="20261021031500",
        stream="ppg",
        artifact_path="/n/Polar_Verity_VERITY-01_20261021031500_PPG.txt",
        artifact_rows=1000,
        start_time_ms=1.0e12,
        stopped_cleanly=True,
    )
    base.update(kw)
    return polar.assemble_live(**base)


# ── §9 · the adapter owns ONE device, and the clock word comes off the header ───


def test_the_clock_word_is_read_off_the_writer_s_own_header_table():
    """Not a copied list: every Polar stream's word must agree with the header the writer writes."""
    for stream in sorted(polar.POLAR_STREAMS):
        header = writers.StreamWriter.HEADERS[stream]
        expected = ae.CLOCK_DEVICE_AND_HOST if _NS_COLUMN in header else ae.CLOCK_HOST_ONLY
        assert polar.clock_status_for(stream) == expected, stream


def test_ppi_is_pmd_transported_and_still_host_only():
    """THE FINDING, pinned. `ppi` is in `_PMD_STREAMS`, so a transport-keyed rule would call it
    device+host — and its file has no ns column at all, so that word would name a clock no reader can
    find. The header is what a reader actually meets, and it says host."""
    import capture

    assert "ppi" in capture._PMD_STREAMS
    assert _NS_COLUMN not in writers.StreamWriter.HEADERS["ppi"]
    assert polar.clock_status_for("ppi") == ae.CLOCK_HOST_ONLY
    # and the streams that DO carry it are not collapsed into the same answer
    assert polar.clock_status_for("ecg") == ae.CLOCK_DEVICE_AND_HOST


def test_the_header_rule_agrees_with_the_capture_path_s_OWN_by_design_list():
    """AN INDEPENDENT WITNESS for the one stream where transport and artifact disagree.

    The header rule reads `writers`' column set. `capture._NO_SAMPLE_TIME_BY_DESIGN` is a different
    source entirely — the VENDOR's rule, which the PMD handler states in a log line of its own ("PPI/HR
    sample time is either zero or missing ... and that is not a refusal"). Two sources derived from
    nothing in common must agree on which PMD stream has no device clock, and they do."""
    import capture
    import polar_pmd as pmd

    for meas, stream in pmd.MEAS_NAME.items():
        by_design = meas in capture._NO_SAMPLE_TIME_BY_DESIGN
        host_only = polar.clock_status_for(stream) == ae.CLOCK_HOST_ONLY
        assert by_design == host_only, f"{stream}: vendor rule says {by_design}, the header says {host_only}"
    # not a vacuous agreement: the vendor list names exactly one stream, so one row of the loop above
    # distinguishes the two answers and five confirm the other
    assert {pmd.MEAS_NAME[m] for m in capture._NO_SAMPLE_TIME_BY_DESIGN} == {"ppi"}


def test_the_stream_set_matches_what_the_live_polar_path_opens():
    """The set is declared in the adapter because `capture` imports it, so the parity is asserted
    here instead. Both directions — a stream added to the capture path and not to the adapter is as
    much a defect as the reverse."""
    import capture

    assert polar.POLAR_STREAMS == capture._PMD_STREAMS | {"hr", "rr"}
    for stream in polar.POLAR_STREAMS:
        assert stream in writers.StreamWriter.HEADERS, stream


def test_a_ring_stream_is_REFUSED_rather_than_answered():
    """§9's refusal, and it is load-bearing rather than tidy. The header table is shared with the ring,
    whose four zero-ns opcodes carry the column while exposing no clock — for those streams the
    column's PRESENCE is the opposite of evidence, so answering would turn a deliberate 0 into a
    claimed second clock."""
    for stream in _RING_ZERO_NS_STREAMS:
        assert _NS_COLUMN in writers.StreamWriter.HEADERS[stream], stream
        assert stream not in polar.POLAR_STREAMS, stream
        with pytest.raises(ValueError, match="not a live Polar stream"):
            polar.clock_status_for(stream)


def test_the_refusal_happens_before_any_envelope_is_built():
    """A refused stream must not produce a half-built envelope for a caller to log."""
    with pytest.raises(ValueError, match="not a live Polar stream"):
        _ev(stream="spo2")


# ── §5 · UNKNOWN ≠ ABSENT ──────────────────────────────────────────────────────


def test_absent_accounting_is_UNKNOWN_and_never_zero():
    ev = _ev()
    assert ev.expected_sample_count == ae.UNKNOWN
    assert ev.transport_gaps == ae.UNKNOWN and ev.decode_gaps == ae.UNKNOWN
    assert ev.artifact_size is None and ev.artifact_sha256 is None
    assert ev.device_state == ae.UNKNOWN
    assert ev.duration_check.stored_s is None and ev.duration_check.observed_s is None
    # the clock NUMBER is absent even though the clock WORD is known — two different questions
    assert ev.clock_status == ae.CLOCK_DEVICE_AND_HOST
    assert ev.clock_offset.offset_sec is None, "an absent offset is None, never a measured 0.0"
    assert ev.clock_offset.reference == ae.UNKNOWN and ev.clock_offset.method == ae.UNKNOWN
    for field in ("expected_sample_count", "transport_gaps", "decode_gaps"):
        assert getattr(ev, field) != 0, f"{field} must be UNKNOWN, not a zero that reads as a count"


def test_a_counted_zero_is_still_a_zero():
    """The other half of §5, and the reason the rule is not "write UNKNOWN when unsure": a writer that
    lost NO rows measured that, and `0` is the honest answer. Only the unmeasured is UNKNOWN."""
    ev = _ev(rows_lost=0, flush_failures=0, seam_count=0)
    assert ev.provenance["rows_lost"] == 0
    assert ev.provenance["flush_failures"] == 0
    assert ev.provenance["flush_seams"] == 0
    assert ev.completeness == ae.COMPLETE, "a measured zero loss must not read as a loss"


def test_an_unmeasured_counter_stays_absent():
    """A teardown that never had the counters passes none, and `None` is not `0`."""
    ev = _ev()
    assert ev.provenance["rows_lost"] is None
    assert ev.provenance["flush_seams"] is None
    assert ev.provenance["negotiated_hz"] is None


# ── the resumed-file control ───────────────────────────────────────────────────


def test_a_resumed_artifact_reports_no_sample_count_and_no_start():
    """The writer reopens the path in append mode at `rows=0`, so `rows` counts THIS instance while
    the FILE also holds the earlier session's data. Reporting either as the artifact's own would state
    a count smaller than the file and a start later than its first sample."""
    ev = _ev(artifact_rows=1000, resumed=True)
    assert ev.sample_count is None
    assert ev.start_time_ms is None
    # and neither figure is lost — each travels under the name of what it actually measures
    assert ev.provenance["rows_this_instance"] == 1000
    assert ev.provenance["instance_start_time_ms"] == 1.0e12
    assert ev.provenance["resumed"] is True


def test_the_same_facts_unresumed_DO_report_the_count():
    """The control for the control: the nulling must come from `resumed` and nothing else."""
    ev = _ev(artifact_rows=1000, resumed=False)
    assert ev.sample_count == 1000 and ev.start_time_ms == 1.0e12
    assert ev.provenance["resumed"] is False


def test_a_resumed_artifact_is_never_called_COMPLETE():
    """Even a clean stop with rows: this instance did not see the file begin."""
    ev = _ev(resumed=True, stopped_cleanly=True, artifact_rows=1000)
    assert ev.completeness == ae.UNKNOWN


# ── §6 · the two axes move independently ──────────────────────────────────────


def test_the_envelope_carries_the_IDENTITY_it_was_GIVEN():
    """§13: joining an artifact back to a session and a device is what the envelope is for, and
    `assemble_live` derives neither field — it carries what the caller measured. The mutation gate
    found that NO test observed `device_id`: replacing it with `None` left the whole suite green
    (`x_assemble_live__mutmut_20`, measured 2026-10-21). Both identities are asserted against two
    different pairs, so a hardcoded constant cannot satisfy them."""
    ev = _ev(device_id="H10-01", session_id="20261021041500")
    assert ev.device_id == "H10-01"
    assert ev.session_id == "20261021041500"
    other = _ev()
    assert other.device_id == "VERITY-01"
    assert other.session_id == "20261021031500"


def test_completeness_moves_while_validation_does_not():
    """The live path verifies no bytes — it writes them — so validation is UNKNOWN by construction and
    saying otherwise would assert a check nobody ran. The axes are independent, which here means
    completeness varies across all three of its values while validation never follows it."""
    seen = {}
    for kw in (
        dict(stopped_cleanly=True, artifact_rows=1000),  # COMPLETE
        dict(stopped_cleanly=False, artifact_rows=1000),  # PARTIAL — cut short
        dict(stopped_cleanly=None, artifact_rows=1000),  # UNKNOWN — no clean-stop signal
    ):
        ev = _ev(**kw)
        seen[ev.completeness] = ev.validation
        assert ev.validation == ae.UNKNOWN and ev.validation_depth is None
    assert set(seen) == {ae.COMPLETE, ae.PARTIAL, ae.UNKNOWN}


def test_a_lost_row_denies_COMPLETE_whatever_else_went_right():
    """A row the writer could not persist is a hole in THIS artifact, so a clean stop cannot overrule
    it. This is the arm a reviewer would most likely drop as redundant."""
    ev = _ev(stopped_cleanly=True, artifact_rows=1000, rows_lost=3)
    assert ev.completeness == ae.PARTIAL


def test_a_clean_stop_with_no_rows_is_UNKNOWN_not_COMPLETE():
    ev = _ev(stopped_cleanly=True, artifact_rows=0)
    assert ev.completeness == ae.UNKNOWN


# ── §8 · no write-side counter is filed as a link-side gap ────────────────────


def test_a_seam_and_a_lost_row_never_become_a_transport_or_decode_gap():
    """THE MISATTRIBUTION CONTROL. A flush seam is a write-side discontinuity and `rows_lost` is a row
    that never reached the disk; neither is a packet that never arrived (`transport_gaps`) nor one that
    arrived and would not decode (`decode_gaps`). Filing either under a gap category would be a
    fabricated measurement wearing the shape of a real one."""
    ev = _ev(seam_count=7, rows_lost=42, flush_failures=2)
    assert ev.transport_gaps == ae.UNKNOWN and ev.decode_gaps == ae.UNKNOWN
    assert ev.provenance["flush_seams"] == 7
    assert ev.provenance["rows_lost"] == 42
    assert ev.provenance["flush_failures"] == 2
    # and the numbers are nowhere a reader would mistake them for gaps
    blob = ev.to_dict()
    assert blob["transport_gaps"] == ae.UNKNOWN and blob["decode_gaps"] == ae.UNKNOWN


# ── the signal name ───────────────────────────────────────────────────────────


def test_the_negotiated_rate_rides_the_signal_only_when_it_was_measured():
    """A PMD rate is negotiated per session, so it is a session fact rather than a property of the
    stream key — which is why it is not hardcoded the way the ring's `@1Hz` is."""
    assert _ev(stream="ppg", negotiated_hz=55).signal == "ppg@55Hz"
    assert _ev(stream="ecg", negotiated_hz=130).signal == "ecg@130Hz"
    assert _ev(stream="hr", negotiated_hz=None).signal == "hr"
    assert _ev(stream="rr").signal == "rr"


def test_the_source_is_live_and_says_so():
    """§10 — live and stored never collapse into one indistinguishable word."""
    assert _ev().source == ae.SOURCE_LIVE


def test_a_caller_supplied_state_and_offset_survive():
    off = ae.ClockOffset(offset_sec=0.0125, measured_at_ms=1.0e12, reference="host-stratum1", method="pmd-anchor")
    ev = _ev(device_state="worn", clock_offset=off)
    assert ev.device_state == "worn"
    assert ev.clock_offset is off, "a caller's measurement is carried, never re-derived"
    assert ev.clock_offset.offset_sec == 0.0125


def test_an_end_time_is_carried_and_never_derived_from_rows():
    """`rr`/`ppi` rows are beats, `hr` is paced by the strap, and a PMD rate over a stream that dropped
    packets gives the COVERED span rather than the wall span — so rows × 1/hz would manufacture a
    duration. The caller passes one when it has one."""
    assert _ev(artifact_rows=1000, negotiated_hz=55).end_time_ms is None
    assert _ev(end_time_ms=1.0e12 + 5000).end_time_ms == 1.0e12 + 5000


# ── §4 · acquisition ⟂ science ────────────────────────────────────────────────


def _values(obj):
    if isinstance(obj, dict):
        for v in obj.values():
            yield from _values(v)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            yield from _values(v)
    elif obj is not None:
        yield str(obj).lower()


def test_the_envelope_carries_no_scientific_evidence_tier():
    """Scans VALUES, not the raw blob: a tier leaks in as a GRADE, while a KEY may legitimately hold a
    tier word (`clock_offset.measured_at_ms` is a timestamp, not a claim of `measured` tier)."""
    vals = list(_values(_ev(seam_count=1, rows_lost=0, negotiated_hz=55).to_dict()))
    for tier in ("measured", "validated", "emerging", "experimental", "heuristic"):
        assert tier not in vals, f"acquisition evidence must not carry the {tier} science tier"


def test_the_tier_control_still_catches_a_real_leak():
    """Guard the guard — narrowing the scan above must not quietly disable it."""
    assert "measured" in list(_values({"provenance": {"evidence": "measured"}}))


# ── the writer's seam accessor ────────────────────────────────────────────────


def test_the_writer_reports_its_seam_count_without_anyone_reaching_inside(tmp_path):
    """The envelope needs one number from the seam sidecar, and `_seams` is private. The property is
    what keeps a report ABOUT the artifact from reaching into the detector that produced it."""
    import datetime as dt

    path = str(tmp_path / "Polar_H10_H10-01_20261021031500_ECG.txt")
    wr = writers.StreamWriter(path, "ecg", fsync=False)
    try:
        wr.write_ecg(dt.datetime(2026, 10, 21, 3, 15, 0), 1_000_000_000, 0.0, 120)
        assert wr.seams == 0, "a monotonic clock has no seams, and that 0 is measured"
        assert wr.rows == 1
    finally:
        wr.close()


# ── §18 · the EXECUTION WITNESS ───────────────────────────────────────────────


def test_the_sidecar_is_actually_WRITTEN_beside_the_artifact(tmp_path):
    """An exported assembler nobody calls is the defect this lane keeps finding, so this drives
    `_emit_polar_live_evidence` — the function `run_polar`'s teardown invokes — with a REAL writer, and
    asserts the file lands where a Dex will look for it."""
    import datetime as dt

    import capture

    started = dt.datetime(2026, 10, 21, 3, 15, 0)
    path = str(tmp_path / "Polar_H10_H10-01_20261021031500_ECG.txt")
    wr = writers.StreamWriter(path, "ecg", fsync=False)
    wr.write_ecg(started, 1_000_000_000, 0.0, 120)
    wr.close()

    capture._emit_polar_live_evidence("H10", {"device_id": "H10-01"}, started, wr, 130.0)

    blob = json.loads((tmp_path / (wr.path.split("/")[-1] + ".meta.json")).read_text())
    ev = blob["acquisition_evidence"]
    assert ev["source"] == ae.SOURCE_LIVE
    assert ev["signal"] == "ecg@130Hz"
    assert ev["clock_status"] == ae.CLOCK_DEVICE_AND_HOST
    assert ev["sample_count"] == 1
    assert ev["artifact_path"] == wr.path
    # the session id is the token the FILENAME already carries, so the filename join a reader already
    # implements works with no new matching rule
    assert ev["session_id"] == "20261021031500"
    assert ev["session_id"] in wr.path
    # the device identity comes off the dev MAP the runner holds, not off the path, so this is the
    # one leg that proves the helper reads `dev["device_id"]` rather than re-parsing the filename
    assert ev["device_id"] == "H10-01"
    assert ev["provenance"]["stream"] == "ecg"
    assert ev["provenance"]["negotiated_hz"] == 130.0


def test_a_failing_sidecar_write_never_damages_the_capture(tmp_path, caplog):
    """The report must not harm the thing it reports on — the session already happened."""
    import datetime as dt
    import logging

    import capture

    class _Doomed:
        stream = "ecg"
        path = str(tmp_path / "absent-dir" / "x.txt")
        rows = 10
        resumed = False
        seams = 0
        rows_lost = 0
        flush_failures = 0

    with caplog.at_level(logging.ERROR):
        capture._emit_polar_live_evidence(  # must not raise
            "H10", {"device_id": "H10-01"}, dt.datetime(2026, 10, 21, 3, 15, 0), _Doomed(), None
        )
    assert "acquisition-evidence sidecar failed" in caplog.text


def test_run_polar_CALLS_the_emit_helper_on_its_KEPT_arm():
    """⚠️ A SOURCE SCAN, and weaker than the witness above — say so rather than let it read as one.

    The witness drives the helper directly, so it proves the helper works and proves nothing about
    whether the capture path invokes it. Deleting the call from `run_polar`'s teardown leaves every
    other test green, and `find_unwired` cannot cover it either: the helper is private and that gate
    scans public functions. Driving the real teardown needs a fake strap and a fake PMD negotiation,
    a larger rig than this unit justifies. A source scan pins PRESENCE, not EXECUTION — the weaker
    rung, chosen deliberately and named — and it catches the deletion, which is the regression that
    actually threatens this wiring."""
    import inspect

    import capture

    src = inspect.getsource(capture.run_polar)
    assert "_emit_polar_live_evidence(" in src, (
        "run_polar must CALL the emit helper — an assembler nobody calls is the defect this lane keeps finding"
    )
    # and on the KEPT arm only: an envelope describing a discarded header-only capture would be
    # evidence about a file that no longer exists. The discard arm is the one with `wr.discard()`.
    emit = src.index("_emit_polar_live_evidence(")
    assert src.index("wr.discard()") < emit, "the emit must sit after the discard arm, on the kept side"
    assert "wr.close()" in src[:emit], "the counters are only final after close"
