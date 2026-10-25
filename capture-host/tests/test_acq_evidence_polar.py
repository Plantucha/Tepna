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

import hashlib
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


# ── the STORED half: assemble_pull over a PS-FTP manifest ───────────────────────────────────────────
_SESS = "/U/0/20260802/R/224700/"
_META = {"kind": "offline", "date": "20260802", "time": "224700", "start_local": "2026-08-02T22:47:00"}


# the digests `pull_recording` records per file, derived here rather than typed, so a changed helper
# cannot agree with a stale literal
_SHA_ACC = hashlib.sha256(b"A" * 1763).hexdigest()
_SHA_BPM = hashlib.sha256(b"B" * 12).hexdigest()


def _manifest(**kw):
    """A clean one-file pull, in the shape `polar_psftp.pull_recording` really returns."""
    m = {
        "session": _SESS,
        "out_dir": "/srv/tepna/captures/stored/Polar_Offline_VERITY-01_20260802224700",
        "files": [
            {"name": "ACC.REC", "bytes": 1763, "declared": 1763, "ok": True, "sha256": _SHA_ACC, "dst": "…/ACC.REC"}
        ],
        "new_files": ["ACC.REC"],
        "short": [],
        "unreadable_dirs": [],
        "truncated_dirs": [],
        "unenumerated": 0,
        "ok": True,
        "total_bytes": 1763,
    }
    m.update(kw)
    return m


def _pull(manifest=None, **kw):
    kw.setdefault("device_id", "VERITY-01")
    kw.setdefault("session_meta", _META)
    return polar.assemble_pull(_manifest() if manifest is None else manifest, **kw)


def test_the_stored_pull_is_never_the_live_source():
    """§10: live and stored never collapse into one indistinguishable word, and neither of the two
    stored words that already existed describes a file-set pull — `stored_dat` is one trailer-finalised
    artifact and `stored_spool` is a cursor the device serves bytes from."""
    ev = _pull()
    assert ev.source == ae.SOURCE_STORED_FILES == "stored_files"
    assert ev.source != ae.SOURCE_LIVE
    assert ev.source not in (ae.SOURCE_STORED_DAT, ae.SOURCE_STORED_SPOOL, ae.SOURCE_SD_EDF)


def test_an_offline_recording_names_the_DEVICE_clock_and_not_a_cross_check():
    """No host was connected while the device wrote those samples, so no second clock exists for them.
    `device+host` would promise a cross-check that cannot be made and `host` would name the one clock
    that is definitely absent. The device's own RTC named the session directory, which is where the
    stamp comes from, and `provenance` says exactly that so the word cannot be read as per-sample."""
    ev = _pull()
    assert ev.clock_status == ae.CLOCK_DEVICE_ONLY == "device"
    assert ev.clock_status not in (ae.CLOCK_DEVICE_AND_HOST, ae.CLOCK_HOST_ONLY, ae.CLOCK_NONE)
    assert ev.provenance["device_clock_read_from"] == polar.PULL_CLOCK_SOURCE
    assert "not per-sample" in polar.PULL_CLOCK_SOURCE


def test_an_unreadable_device_stamp_is_UNKNOWN_and_never_none():
    """`none` is a measured conclusion about BOTH clocks; having read no stamp at all is an absence of
    measurement (§5). The device clock may well be inside the container nobody here decodes."""
    ev = _pull(session_meta={"kind": "other", "date": None, "time": None, "start_local": None})
    assert ev.clock_status == ae.UNKNOWN
    assert ev.start_time_ms is None
    assert ev.provenance["device_clock_read_from"] is None


def test_the_device_stamp_becomes_a_floating_wall_clock_ms():
    """Clock Contract §1: the device wrote local civil time with no zone, so the canonical form is
    floating `tMs` — the same encoding the live path stamps with `calendar.timegm`."""
    import calendar
    import datetime

    want = calendar.timegm(datetime.datetime(2026, 8, 2, 22, 47, 0).timetuple()) * 1000.0
    assert _pull().start_time_ms == want
    assert polar._device_start_ms("20260802", "224700") == want


@pytest.mark.parametrize(
    "date,hhmmss",
    [
        (None, "224700"),
        ("20260802", None),
        ("", ""),
        ("2026080", "224700"),  # seven digits — not the device's shape
        ("20260802", "22470"),  # five digits
        ("2026080x", "224700"),  # not all digits
        ("20260802", "2247x0"),
        ("20261332", "224700"),  # month 13, day 32 — an impossible calendar day
        ("20260802", "254700"),  # hour 25
    ],
)
def test_an_impossible_or_foreign_stamp_REFUSES_instead_of_rolling(date, hhmmss):
    """Clock Contract §7: `timegm` over a hand-built tuple rolls impossible components onto a WRONG
    instant exactly as `Date.UTC` does, and `_session_meta` validates only digit-ness and length. A
    date of `20261332` must therefore be refused here, not become January 1932's problem."""
    assert polar._device_start_ms(date, hhmmss) is None


def test_every_FIELD_of_the_stamp_reaches_the_component_it_names():
    """A slice that drops one digit is invisible to a fixture whose fields all read `0X`, because
    `int("8")` and `int("08")` agree. So this leg reads a stamp whose month, day and seconds each need
    BOTH of their digits: month 11, day 15, second 37."""
    import calendar
    import datetime

    want = calendar.timegm(datetime.datetime(2026, 11, 15, 22, 15, 37).timetuple()) * 1000.0
    assert polar._device_start_ms("20261115", "221537") == want
    # the anti-vacuity leg: each neighbouring component is a DIFFERENT instant, so the equality above
    # is what pins the slices rather than an arithmetic coincidence.
    for y, mo, d, h, mi, se in ((2026, 1, 15, 22, 15, 37), (2026, 11, 5, 22, 15, 37), (2026, 11, 15, 22, 15, 7)):
        other = calendar.timegm(datetime.datetime(y, mo, d, h, mi, se).timetuple()) * 1000.0
        assert other != want


@pytest.mark.parametrize("date,hhmmss", [("2026 802", "224700"), ("20260802", "2247 0")])
def test_a_stamp_the_CONSTRUCTOR_would_accept_is_still_refused(date, hhmmss):
    """`int(" 8")` is 8 and `int("+8")` is 8, so a stamp carrying whitespace or a sign reaches a REAL
    calendar day through the constructor and raises nothing. The digit check is the only thing that
    refuses it, and it must hold for each half alone: one clean side never excuses the other."""
    assert polar._device_start_ms(date, hhmmss) is None


def test_a_rolled_stamp_would_have_been_a_plausible_looking_instant():
    """The anti-vacuity leg for the test above: the refusal matters because the rolled value is not
    absurd on its face. Without the range check `20261332` dates the recording to 1933."""
    import calendar
    import datetime

    rolled = datetime.datetime(2026, 1, 1) + datetime.timedelta(days=12 * 31 + 31)
    assert rolled.year == 2027  # a readable date, and the wrong one
    assert polar._device_start_ms("20261332", "224700") != calendar.timegm(rolled.timetuple()) * 1000.0


def test_the_declared_size_check_is_what_VALID_means_here():
    """§6: the pull compares each transferred length against the size the device DECLARED in its own
    directory listing. That check really ran, so the depth names it — and names only it.

    ⚠️ A DIGEST IS NOT A DEEPER CHECK HERE. The device declares a size in its listing and never a hash,
    so there is nothing for a digest to be checked AGAINST — it is the artifact's identity, not a second
    verdict. The depth therefore stays `declared-size-per-file` while `artifact_sha256` is present, and
    a reader that sees the digest must not read it as a validated hash."""
    ev = _pull()
    assert ev.validation == ae.VALID
    assert ev.validation_depth == polar.PULL_VALIDATION_DEPTH == "declared-size-per-file"
    assert ev.artifact_sha256 is not None
    assert "hash" not in polar.PULL_VALIDATION_DEPTH


def test_a_short_file_is_INVALID_and_PARTIAL_at_once():
    """A length that failed its declaration says both things: the bytes do not match what the device
    declared, and the set is missing some of them. The axes stay separate but may agree."""
    ev = _pull(_manifest(short=["ACC.REC: declared 1763, got 900 bytes — left as ACC.REC.part"], ok=False))
    assert ev.validation == ae.INVALID
    assert ev.validation_depth == polar.PULL_VALIDATION_DEPTH  # the check RAN; it refused
    assert ev.completeness == ae.PARTIAL
    assert len(ev.provenance["short"]) == 1


def test_an_unenumerated_directory_leaves_completeness_UNKNOWN_while_the_bytes_stay_VALID():
    """The contract's cleanest §6 pair, and `pull_recording` already draws this line for its own `ok`:
    every byte we hold checked out, and a listing that came back truncated means we cannot tell whether
    we hold the whole set. UNKNOWN, never PARTIAL — nobody measured that something is missing."""
    ev = _pull(_manifest(truncated_dirs=["/U/0/20260802/R/224700/"], unenumerated=1, ok=False))
    assert ev.validation == ae.VALID
    assert ev.completeness == ae.UNKNOWN
    assert ev.provenance["unenumerated"] == 1
    assert ev.provenance["pull_ok"] is False


def test_an_ABSENT_unenumerated_count_is_not_a_count_of_zero():
    """§∅ at the fold. `capture.pull_polar_offline_all` records that `polar_psftp` writes this count
    unconditionally, so a `None` cannot arise from TODAY's one caller — which is exactly the premise an
    assembler must not depend on. Reading an absent count as 0 would publish COMPLETE over a set nobody
    enumerated, and that is the failure this whole contract exists to prevent."""
    m = _manifest()
    del m["unenumerated"]
    ev = _pull(m)
    assert ev.completeness == ae.UNKNOWN
    assert ev.provenance["unenumerated"] is None
    # the control: the same manifest with the count PRESENT and zero does reach COMPLETE
    assert _pull(_manifest()).completeness == ae.COMPLETE


def test_a_pull_that_moved_no_files_decides_nothing():
    """A verdict over zero files is not a verdict. Validation ran no check and completeness has no set
    to describe, so both are UNKNOWN and the depth is absent rather than naming a check nobody ran."""
    ev = _pull(_manifest(files=[], new_files=[], total_bytes=0))
    assert ev.validation == ae.UNKNOWN
    assert ev.validation_depth is None
    assert ev.completeness == ae.UNKNOWN
    assert ev.provenance["n_files"] == 0


def test_the_artifact_is_the_SET_and_no_single_signal_names_it():
    """A pull mirrors a directory, so one envelope covers every stream the device recorded. Naming one
    file as the signal would describe a fraction of what the envelope covers."""
    ev = _pull()
    assert ev.signal is None
    assert ev.artifact_path == _manifest()["out_dir"]
    assert ev.artifact_size == 1763


def test_no_sample_or_gap_number_is_invented_from_a_byte_transfer():
    """§8: nothing here decodes the device's container, so there is no sample count, nothing declares an
    expected one, and a truncated FILE is not a packet that never arrived."""
    ev = _pull(_manifest(short=["ACC.REC: declared 1763, got 900 bytes"]))
    assert ev.sample_count is None
    assert ev.expected_sample_count == ae.UNKNOWN
    assert ev.end_time_ms is None
    assert ev.transport_gaps == ae.UNKNOWN
    assert ev.decode_gaps == ae.UNKNOWN
    assert ev.duration_check.stored_s is None and ev.duration_check.observed_s is None


def test_the_session_id_is_the_14_digit_stamp_a_reader_already_joins_on():
    """The token the pulled DIRECTORY is named after (`Polar_Offline_<serial>_<14 digits>`) and the one
    the live envelope uses, so an envelope joins to a night by the same filename substring rule."""
    assert _pull().session_id == "20260802224700"
    assert _pull().session_id in _manifest()["out_dir"]
    # a caller that holds its own id keeps it
    assert _pull(session_id="20260802224700-retry").session_id == "20260802224700-retry"
    # and a path with no stamp yields no id rather than a fragment
    assert polar._pull_session_id({"date": "20260802", "time": None}) is None
    assert polar._pull_session_id({"date": None, "time": "224700"}) is None


def test_the_identity_and_the_caller_s_observations_are_CARRIED_not_derived():
    """§13: the puller holds only a BLE address, which is a different namespace from the identity every
    other envelope joins on. Both are asserted against two different values so a constant cannot pass."""
    assert _pull().device_id == "VERITY-01"
    assert _pull(device_id="H10-01").device_id == "H10-01"
    assert _pull(device_id=None).device_id is None
    off = ae.ClockOffset(offset_sec=1.25, measured_at_ms=1.0e12, reference="host-stratum1", method="GetDateTime")
    ev = _pull(device_state="CHARGING", clock_offset=off)
    assert ev.device_state == "CHARGING" and ev.clock_offset is off
    assert _pull().device_state == ae.UNKNOWN and _pull().clock_offset.offset_sec is None


def test_the_pull_s_own_accounting_travels_under_names_that_say_what_it_is():
    """What was new, what was already on disk, what the device path said — each under its own name, so
    none of it can be read as a sample count or a gap."""
    m = _manifest(
        files=[
            {"name": "ACC.REC", "bytes": 1763, "declared": 1763, "ok": True},
            {"name": "BPM.GZ", "bytes": 12, "declared": 12, "ok": True, "skipped": True},
        ],
        new_files=["ACC.REC"],
        total_bytes=1775,
    )
    p = _pull(m).provenance
    assert p["n_files"] == 2 and p["n_new"] == 1 and p["n_skipped"] == 1
    assert p["session_path"] == _SESS and p["kind"] == "offline"
    assert p["device_stamp_local"] == "2026-08-02T22:47:00"
    assert p["unreadable_dirs"] == [] and p["truncated_dirs"] == []
    # a manifest with no `new_files` key reports an absent count, not zero new files
    m2 = _manifest()
    del m2["new_files"]
    assert _pull(m2).provenance["n_new"] is None


# ── the SET digest: one identity for a pulled directory ─────────────────────────────────────────────
def _compose(pairs):
    """Re-derive the set digest BY HAND, from the rule and not from the module under test: sorted
    `name \0 sha256(file)` lines, joined by newlines, hashed once. A test that called the helper would
    agree with any composition the helper happened to use."""
    return hashlib.sha256("\n".join(sorted(f"{n}\0{h}" for n, h in pairs)).encode()).hexdigest()


def test_the_set_digest_is_the_composition_THIS_TREE_ALREADY_USES_and_not_a_new_rule():
    """A pulled recording is a DIRECTORY, so the row's open question was per-file digests against one
    digest over the set. The set is what `artifact_path` and `artifact_size` already describe, and the
    composition is not invented here: `manifest-gate.js` identifies a bundle by sorted
    `logicalName \0 sha256(text)` lines and `tools/sigma-corpus-headless.mjs` pins a corpus population
    the same way. Reusing it keeps §12's one hashing system true of a set as well as of a file."""
    m = _manifest(
        files=[
            {"name": "PLETH.GZ", "bytes": 12, "declared": 12, "ok": True, "sha256": _SHA_BPM},
            {"name": "ACC.REC", "bytes": 1763, "declared": 1763, "ok": True, "sha256": _SHA_ACC},
        ],
        total_bytes=1775,
    )
    ev = _pull(m)
    assert ev.artifact_sha256 == _compose([("ACC.REC", _SHA_ACC), ("PLETH.GZ", _SHA_BPM)])
    assert len(ev.artifact_sha256) == 64, "the full digest, as every other artifact hash here is"


def test_the_set_digest_does_not_depend_on_the_order_the_files_were_pulled_in():
    """The device's listing order is not a property of the recording, and a re-pull may transfer the
    same set in another order. A digest that moved with that order would read as a changed artifact."""
    a = {"name": "ACC.REC", "bytes": 1763, "declared": 1763, "ok": True, "sha256": _SHA_ACC}
    b = {"name": "PLETH.GZ", "bytes": 12, "declared": 12, "ok": True, "sha256": _SHA_BPM}
    first = _pull(_manifest(files=[a, b], total_bytes=1775)).artifact_sha256
    second = _pull(_manifest(files=[b, a], total_bytes=1775)).artifact_sha256
    assert first == second == _compose([("ACC.REC", _SHA_ACC), ("PLETH.GZ", _SHA_BPM)])


def test_the_digest_covers_the_NAMES_as_well_as_the_bytes():
    """Two files that swapped names are a different recording, and a digest over the bytes alone would
    call the two sets identical. The name travels in the leaf, which is why the leaf has a separator."""
    a = {"name": "ACC.REC", "bytes": 12, "declared": 12, "ok": True, "sha256": _SHA_ACC}
    b = {"name": "PLETH.GZ", "bytes": 12, "declared": 12, "ok": True, "sha256": _SHA_BPM}
    straight = _pull(_manifest(files=[a, b], total_bytes=24)).artifact_sha256
    swapped = _pull(
        _manifest(
            files=[{**a, "sha256": _SHA_BPM}, {**b, "sha256": _SHA_ACC}],
            total_bytes=24,
        )
    ).artifact_sha256
    assert straight != swapped


def test_ONE_UNHASHED_MEMBER_MAKES_THE_WHOLE_SET_DIGEST_ABSENT_with_that_member_NAMED():
    """§∅: `artifact_size` is the transferred total over EVERY file, skipped ones included, so a digest
    that quietly dropped the unhashed members would carry the identity of the whole set while covering
    part of it. A size-matched skip is the ordinary way a leaf is absent — the second pull of a
    session opens no file — and the honest answer is absence with the count beside it."""
    m = _manifest(
        files=[
            {"name": "ACC.REC", "bytes": 1763, "declared": 1763, "ok": True, "sha256": _SHA_ACC},
            {"name": "PLETH.GZ", "bytes": 12, "declared": 12, "ok": True, "skipped": True, "sha256": None},
        ],
        total_bytes=1775,
    )
    ev = _pull(m)
    assert ev.artifact_sha256 is None
    d = ev.provenance["artifact_digest"]
    assert d["n_hashed"] == 1 and d["n_unhashed"] == 1
    assert d["unhashed"] == ["PLETH.GZ"], "WHICH file the digest waits on, not just how many"
    assert "1 of 2 file(s)" in d["absent"]
    # and the one leaf that DOES exist still travels, so the reader is not left with nothing
    assert [f["sha256"] for f in ev.provenance["files"]] == [_SHA_ACC, None]


def test_EVERY_UNHASHED_MEMBER_IS_NAMED_and_not_only_the_first_one_found():
    """A reader deciding whether to re-pull needs the whole absent set. Naming one member of three
    would read as a single skipped sidecar while a session's ACC stream was also unhashed, and the
    count beside it does not say which name was dropped. So the scan does not stop at the first."""
    m = _manifest(
        files=[
            {"name": "ACC.REC", "bytes": 1763, "declared": 1763, "ok": True, "skipped": True, "sha256": None},
            {"name": "PLETH.GZ", "bytes": 12, "declared": 12, "ok": True, "sha256": _SHA_BPM},
            {"name": "PPI.REC", "bytes": 40, "declared": 40, "ok": True, "skipped": True, "sha256": None},
        ],
        total_bytes=1815,
    )
    d = _pull(m).provenance["artifact_digest"]
    assert d["unhashed"] == ["ACC.REC", "PPI.REC"], "manifest order, both of them"
    assert d["n_unhashed"] == 2 and d["n_hashed"] == 1
    assert "2 of 3 file(s)" in d["absent"]


def test_a_pull_that_moved_nothing_has_no_SET_to_digest():
    """A verdict over zero files is not a verdict (§5), and the empty join hashes to a perfectly real
    digest that would describe an empty directory as a recording."""
    ev = _pull(_manifest(files=[], new_files=[], total_bytes=0))
    assert ev.artifact_sha256 is None
    d = ev.provenance["artifact_digest"]
    assert d["absent"] == "nothing was pulled, so there is no set to digest"
    assert d["n_hashed"] == 0 and d["n_unhashed"] == 0 and d["unhashed"] == []
    assert ev.provenance["files"] == []


def test_a_manifest_from_before_per_file_hashing_reports_ABSENCE_and_not_a_digest_of_what_it_has():
    """An envelope assembled over an older manifest — one whose file records carry no `sha256` key at
    all — has no leaf to compose. That is the same absence as a skip, and it must not become a digest
    over the subset that happens to be hashable, because here that subset is empty."""
    ev = _pull(_manifest(files=[{"name": "ACC.REC", "bytes": 1763, "declared": 1763, "ok": True}], total_bytes=1763))
    assert ev.artifact_sha256 is None
    assert ev.provenance["artifact_digest"]["n_unhashed"] == 1
    assert ev.provenance["artifact_digest"]["unhashed"] == ["ACC.REC"]
    assert ev.provenance["files"] == [{"name": "ACC.REC", "bytes": 1763, "sha256": None}]


def test_the_RULE_travels_so_a_reader_holding_the_directory_can_re_derive_the_digest():
    """A digest a reader cannot reproduce is a number to trust rather than evidence to check. The
    composition states its own order and separator, and the per-file leaves travel beside it, so the
    whole claim is re-derivable from the files on disk."""
    ev = _pull()
    d = ev.provenance["artifact_digest"]
    assert d["rule"] == polar.SET_DIGEST_RULE
    assert "sorted" in d["rule"] and "sha256" in d["rule"]
    assert d["absent"] is None and d["n_hashed"] == 1 and d["n_unhashed"] == 0
    assert ev.provenance["files"] == [{"name": "ACC.REC", "bytes": 1763, "sha256": _SHA_ACC}]


def test_a_short_file_is_INVALID_and_STILL_CARRIES_ITS_DIGEST():
    """The two axes stay separate. A length that failed its declaration refuses the VALID word, and the
    bytes that did arrive are real and sit on disk under `.part` — so the set they belong to still has
    an identity. Withholding it would leave the one file a reader most needs to identify as the only
    one it cannot."""
    ev = _pull(_manifest(short=["ACC.REC: declared 1763, got 900 bytes — left as ACC.REC.part"], ok=False))
    assert ev.validation == ae.INVALID
    assert ev.artifact_sha256 == _compose([("ACC.REC", _SHA_ACC)])
