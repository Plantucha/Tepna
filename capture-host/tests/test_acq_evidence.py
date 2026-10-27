# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""Tests for the Acquisition Evidence Contract (ACQ-EVIDENCE-CONTRACT-2026-08-24-BRIEF).

The two PLANTED CONTROLS (lead ruling 5, spec §5/§6) are the point, not decoration: one that reds if
the envelope ever collapses UNKNOWN→ABSENT, and one that reds if it ever collapses VALID→COMPLETE.
Both are stated from the physics/semantics (pre-state-the-threshold), not as after-the-fact snapshots.
"""

from types import SimpleNamespace
from typing import Literal, get_type_hints

import calendar
import json

import pytest

import acq_evidence as ae
import acq_evidence_o2ring as o2
import writers

# A finalised Format-A trailer as oxyii.parse_oxy_trailer returns it (only the fields the adapter reads).
_TRAILER_18311 = {"finalized": True, "total_seconds": 18311, "avg_spo2": 96, "min_spo2": 88}


def _row(**kw):
    base = {
        "device_id": "S8-AW-01",
        "session": "20260618214109",
        "state": "VERIFIED",
        "size": 18311 * 3 + 58,
        "sha256": "abc123",
        "path": "/x/20260618214109.dat",
        "attempt": 1,
    }
    base.update(kw)
    return base


def _verify(ok=True, depth="size+finalised+records", sha256="abc123"):
    return SimpleNamespace(ok=ok, depth=depth, sha256=sha256, size=18311 * 3 + 58)


# ── DurationCheck (the lead-ratified shape) ──────────────────────────────────────────────────────
def test_duration_check_agrees_on_exact_match():
    d = ae.DurationCheck.build(stored_s=18311, observed_s=18311)  # today's 18311≡18311
    assert d.stored_s == 18311 and d.observed_s == 18311
    assert d.delta_s == 0 and d.agrees is True and d.source == "observed"


def test_duration_check_tolerates_the_ring_counter_quantization():
    """±1 s is the ring duration-counter quantization (o2ring-duration-is-quantized), not bare
    equality — a benign ±1 must not read as disagreement."""
    assert ae.DurationCheck.build(18312, 18311).agrees is True  # delta +1
    assert ae.DurationCheck.build(18310, 18311).agrees is True  # delta -1
    assert ae.DurationCheck.build(18313, 18311).agrees is False  # delta +2 is a real discrepancy


def test_duration_check_sign_convention_is_stored_minus_observed():
    assert ae.DurationCheck.build(100, 90).delta_s == 10  # stored - observed


def test_duration_check_one_side_unknown_makes_no_comparison():
    d = ae.DurationCheck.build(stored_s=18311, observed_s=None)  # live path did not see the close
    assert d.observed_s is None and d.delta_s is None and d.agrees is None and d.source == "stored"
    d2 = ae.DurationCheck.build(stored_s=None, observed_s=18311)
    assert d2.source == "observed" and d2.agrees is None
    d3 = ae.DurationCheck.build(stored_s=None, observed_s=None)
    assert d3.source == ae.UNKNOWN and d3.delta_s is None


# ── the §17 acquisition cases (O2Ring .dat) ──────────────────────────────────────────────────────
def test_complete_valid_acquisition():
    ev = o2.assemble_dat(
        _row(), trailer=_TRAILER_18311, verify_result=_verify(), observed_duration_s=18311, clock_status="device+host"
    )
    assert ev.validation == ae.VALID and ev.completeness == ae.COMPLETE
    assert ev.sample_count == 18311 and ev.expected_sample_count == 18311
    assert ev.decode_gaps == 0 and ev.duration_check.agrees is True
    assert ev.schema == ae.SCHEMA and ev.source == ae.SOURCE_STORED_DAT


def test_partial_acquisition_not_finalised():
    ev = o2.assemble_dat(
        _row(state="PARTIAL"), trailer=None, verify_result=_verify(ok=False, depth="size+finalised+records")
    )
    assert ev.completeness == ae.PARTIAL and ev.validation == ae.INVALID


def test_hash_mismatch_is_invalid_but_can_be_complete():
    """A finalised .dat whose bytes fail verification: COMPLETE (finalised) + INVALID (hash) — the two
    axes are independent (§6)."""
    ev = o2.assemble_dat(_row(), trailer=_TRAILER_18311, verify_result=_verify(ok=False), observed_duration_s=18311)
    assert ev.validation == ae.INVALID and ev.completeness == ae.COMPLETE


def test_missing_artifact_and_no_verify_is_unknown_not_negative():
    ev = o2.assemble_dat(_row(size=None, sha256=None, state="DISCOVERED"), trailer=None, verify_result=None)
    assert ev.validation == ae.UNKNOWN and ev.sample_count is None
    assert ev.completeness == ae.UNKNOWN and ev.artifact_sha256 is None
    assert ev.transport_gaps == ae.UNKNOWN and ev.decode_gaps == ae.UNKNOWN
    assert ev.device_state == ae.UNKNOWN and ev.clock_status == ae.UNKNOWN


def test_sha_falls_back_to_the_inventory_row_when_verify_absent():
    ev = o2.assemble_dat(_row(sha256="row-sha"), trailer=_TRAILER_18311, verify_result=None)
    assert ev.artifact_sha256 == "row-sha"  # reuse the canonical hash, never recompute


def test_start_and_end_time_derive_from_a_known_start():
    ev = o2.assemble_dat(_row(), trailer=_TRAILER_18311, verify_result=_verify(), start_time_ms=1000.0)
    assert ev.start_time_ms == 1000.0 and ev.end_time_ms == 1000.0 + 18311 * 1000
    assert ev.to_dict()["duration_check"]["stored_s"] == 18311


def test_non_whole_record_body_yields_unknown_sample_count():
    ev = o2.assemble_dat(_row(size=18311 * 3 + 58 + 1), trailer=_TRAILER_18311, verify_result=_verify())
    assert ev.sample_count is None  # a shifted grid is not a fabricated count


# ── PLANTED CONTROL 1: UNKNOWN ≠ ABSENT (spec §5/§8, ruling 5) ────────────────────────────────────
def test_CONTROL_unknown_expected_sample_count_is_never_zero_or_absent():
    """A .dat with no trailer cannot declare an expected count. That MUST surface as UNKNOWN — never 0
    (which would read as 'zero samples expected') and never None-as-absent. This control reds the
    instant the assembler maps missing→0."""
    ev = o2.assemble_dat(_row(), trailer=None, verify_result=_verify())
    assert ev.expected_sample_count == ae.UNKNOWN
    assert ev.expected_sample_count != 0  # the whole point: not zero
    assert ev.expected_sample_count is not None  # and not absent


# ── PLANTED CONTROL 2: VALID ≠ COMPLETE (spec §6, ruling 5) ──────────────────────────────────────
def test_CONTROL_valid_artifact_can_be_a_partial_acquisition():
    """A finalised, hash-VALID .dat whose stored duration is SHORTER than the live-observed session is
    VALID + PARTIAL — intact bytes that captured only part of what was observed. This control reds if
    completeness is ever made to mirror validation (the single-quality-score collapse §6 forbids)."""
    short = dict(_TRAILER_18311, total_seconds=17000)  # ring finalised 17000 s; live observed 18311
    ev = o2.assemble_dat(
        _row(size=17000 * 3 + 58), trailer=short, verify_result=_verify(sha256="abc123"), observed_duration_s=18311
    )
    assert ev.validation == ae.VALID  # the artifact is intact and finalised
    assert ev.completeness == ae.PARTIAL  # but the acquisition missed 1311 s the live path observed
    assert ev.duration_check.agrees is False and ev.duration_check.delta_s == 17000 - 18311


def test_failed_inventory_state_maps_to_invalid_via_the_fallback():
    """When no verify() result is passed, a FAILED inventory state is INVALID at the classifier's
    coarser depth — the §19 boundary fallback the landed pull path uses."""
    ev = o2.assemble_dat(_row(state="FAILED"), trailer=None, verify_result=None)
    assert ev.validation == ae.INVALID and ev.validation_depth == "size+finalised"


# ── the LIVE half (spec §10: BOTH O2Ring paths, never merged) ─────────────────
def _live(**over):
    kw = dict(device_id="O2-1", session_id="20260826031500", artifact_path="/n/x_SPO2.csv", artifact_rows=3600)
    kw.update(over)
    return o2.assemble_live(**kw)


def test_live_and_stored_are_DISTINGUISHABLE_sources():
    """Spec §10 forbids merging the two O2Ring paths into one indistinguishable source. A reader must
    always be able to tell which path produced a night."""
    assert _live().source == ae.SOURCE_LIVE
    assert o2.assemble_dat(_row()).source == ae.SOURCE_STORED_DAT
    assert _live().source != o2.assemble_dat(_row()).source


def test_the_live_path_claims_NO_validation_because_it_verifies_nothing():
    """The honest asymmetry with the stored path. `verify()` re-reads the .dat and can say VALID; the
    live path WRITES bytes — no hash, no re-read, no trailer. Claiming VALID would assert a check
    nobody ran."""
    ev = _live()
    assert ev.validation == ae.UNKNOWN and ev.validation_depth is None
    assert ev.artifact_sha256 is None, "the live path computes no hash — never invent a second one"


def test_live_gap_fields_are_UNKNOWN_and_the_PPG_facts_are_NAMED_separately():
    """THE control for this adapter, and the reason it exists: the live path carries rich gap
    accounting, but it belongs to the PPG STREAM while this envelope describes the 1 Hz SpO2 CSV — a
    DIFFERENT stream from the same device. Reporting PPG gaps as this artifact's transport_gaps would
    attribute one stream's losses to another's file: a fabricated measurement wearing the shape of a
    real one. So the gap fields stay UNKNOWN and the PPG figures ride in provenance UNDER THEIR OWN
    NAME — present, and impossible to mistake for this file's."""
    grid = {"samples_written": 3588, "gaps_inserted": 3, "grid_positions_lost": 12}
    ev = _live(ppg_grid=grid, ppg_ledger={"frames": 900, "truncated": 0})
    assert ev.transport_gaps == ae.UNKNOWN and ev.decode_gaps == ae.UNKNOWN
    assert ev.transport_gaps != 3, "the PPG stream's gaps are NOT this artifact's"
    assert ev.provenance["ppg_grid"] == grid, "but they are PRESERVED, under their own key"
    assert ev.provenance["ppg_ledger"]["frames"] == 900


def test_live_sample_count_is_the_rows_actually_written():
    ev = _live(artifact_rows=3600, start_time_ms=1000.0)
    assert ev.sample_count == 3600
    assert ev.expected_sample_count == ae.UNKNOWN, "a live stream has no independent expectation"
    assert ev.end_time_ms == 1000.0 + 3600 * 1000, "the CSV is 1 Hz — one row per second"


def test_live_completeness_needs_a_clean_stop_signal():
    assert _live(stopped_cleanly=True).completeness == ae.COMPLETE
    assert _live(stopped_cleanly=False).completeness == ae.PARTIAL
    assert _live(stopped_cleanly=None).completeness == ae.UNKNOWN, "no signal ⇒ UNKNOWN, never guessed"
    assert _live(stopped_cleanly=True, artifact_rows=0).completeness == ae.UNKNOWN, (
        "a clean stop with zero rows is not a COMPLETE acquisition"
    )


def test_the_grid_and_ledger_projections_READ_REAL_FIELDS():
    """⚠️ This is the control for a near-miss, not a formality. The first version of the projection
    called `grid.summary()` behind a `hasattr` guard — and NEITHER class has that method, so it would
    have silently written null for both provenance blocks while reading as correct code. Same shape as
    the EdfSink `final_path` defect: a guarded call to a method that does not exist degrades into a
    SILENT ABSENCE. Asserting real values is what distinguishes them."""
    import capture

    g = capture.O2PpgGrid()
    g.idx, g.lost, g.gaps = 3600, 12, 3
    facts = capture._oxy_grid_facts(g)
    assert facts is not None, "a None here is the silent-absence bug this test exists for"
    assert facts["samples_written"] == 3588 and facts["gaps_inserted"] == 3
    assert facts["grid_positions_lost"] == 12 and facts["nominal_fs"] > 0
    led = capture._oxy_ledger_facts(capture.O2PpgFrameLedger())
    assert led is not None and set(led) >= {"frames", "declared", "delivered", "truncated"}
    assert capture._oxy_grid_facts(None) is None and capture._oxy_ledger_facts(None) is None


def test_the_live_sidecar_is_actually_WRITTEN_beside_the_artifact(tmp_path):
    """EXECUTION WITNESS for the emit seam. An exported assembler nobody calls is the defect this whole
    lane keeps finding, so this drives `_emit_oxy_live_evidence` — the function `run_oxyii`'s close
    path invokes — and asserts the file lands where a Dex will look for it."""
    import datetime as dt

    import capture

    csv = tmp_path / "Viatom_O2Ring_O2-1_20260826031500_SPO2.csv"
    started = dt.datetime(2026, 8, 26, 3, 15, 0)
    # THE REAL WRITER, not a (path, rows) fiction: the seam's whole subject is which of the writer's
    # two clocks reaches the envelope, so a stand-in carrying a hand-typed row count could not fail.
    # The link came up 2 h 27 m after the process did, which is the ordinary ring case.
    wr = writers.Spo2CsvWriter(str(csv), fsync=False)
    first = dt.datetime(2026, 8, 26, 5, 42, 7)
    for i in range(3):
        wr.write(first + dt.timedelta(seconds=i), 96, 58, 0)
    wr.close()
    g = capture.O2PpgGrid()
    g.idx, g.lost, g.gaps = 3600, 12, 3
    capture._emit_oxy_live_evidence("O2-1", {"device_id": "O2-1"}, started, wr, g, capture.O2PpgFrameLedger())

    blob = json.loads((tmp_path / (csv.name + ".meta.json")).read_text())
    ev = blob["acquisition_evidence"]
    assert ev["source"] == ae.SOURCE_LIVE
    assert ev["sample_count"] == 3
    assert ev["artifact_path"] == str(csv)
    # row `2026-09-22-filename-stamp-still-wrong-for-other-consumers` part (a): the artifact is dated
    # by its FIRST ROW, and the session start stays — under the name of what it measures
    assert ev["start_time_ms"] == calendar.timegm(first.timetuple()) * 1000.0
    assert ev["provenance"]["instance_start_time_ms"] == calendar.timegm(started.timetuple()) * 1000.0
    assert ev["start_time_ms"] > ev["provenance"]["instance_start_time_ms"], (
        "the ring's filename and session id carry the process start; the file begins later"
    )
    # and the derived end follows the corrected start rather than amplifying the old error
    assert ev["end_time_ms"] == ev["start_time_ms"] + 3 * 1000
    assert ev["provenance"]["resumed"] is False
    assert ev["provenance"]["rows_this_instance"] == 3
    # the session id is the token the FILENAME already carries, so OxyDex's existing filename join
    # (#1752) works with no new matching rule
    assert ev["session_id"] == "20260826031500"
    assert ev["session_id"] in csv.name, "the join OxyDex already implements is by filename substring"
    # and the PPG accounting survived the round-trip rather than serialising as null
    assert ev["provenance"]["ppg_grid"]["gaps_inserted"] == 3


def test_a_failing_sidecar_write_never_damages_the_capture(tmp_path):
    """The report must not harm the thing it reports on — the session already happened."""
    import datetime as dt

    import capture

    # a path whose parent does not exist ⇒ the open() raises inside the helper. A real writer cannot
    # be built there — it would raise at construction, inside the capture path rather than inside the
    # report — so the stand-in carries exactly the four attributes the helper reads.
    class _Doomed:
        path = str(tmp_path / "absent-dir" / "x.csv")
        rows = 10
        resumed = False
        first_row_ms = 1_787_000_000_000.0

    capture._emit_oxy_live_evidence(
        "O2-1",
        {"device_id": "O2-1"},
        dt.datetime(2026, 8, 26, 3, 15, 0),
        _Doomed(),
        capture.O2PpgGrid(),
        capture.O2PpgFrameLedger(),
    )  # must not raise


def test_run_oxyii_CALLS_the_emit_helper_on_its_close_path():
    """⚠️ A SOURCE SCAN, and weaker than the witness above — say so rather than let it read as one.

    The test above drives `_emit_oxy_live_evidence` DIRECTLY, so it proves the helper works and proves
    nothing about whether the capture path invokes it. Deleting the call from `run_oxyii`'s close seam
    leaves every other test green — the unpinned-wiring shape (#1784's controller hand-off). And
    `find_unwired` cannot cover it either: the helper is private, and that gate only scans public
    functions.

    `run_oxyii` drives a live BLE session, so an execution witness would need a fake ring; that is a
    larger rig than this unit justifies. A source scan pins PRESENCE, not EXECUTION — the weaker rung,
    chosen deliberately and named — and it is enough to catch a deletion, which is the regression that
    actually threatens this wiring."""
    import inspect

    import capture

    src = inspect.getsource(capture.run_oxyii)
    assert "_emit_oxy_live_evidence(" in src, (
        "run_oxyii must CALL the emit helper — an assembler nobody calls is the defect this lane keeps finding"
    )
    # and it must be reached only for a KEPT file: an envelope describing a discarded header-only
    # capture would be evidence about a file that no longer exists
    assert "_spo2_kept" in src
    # and the WRITER travels, not a (path, rows) pair: the envelope cannot date the artifact by its
    # first row, nor know it is resumed, from a pair that carries neither (row part (a))
    assert "_spo2_kept = _w" in src


# ── THE DECLARED VOCABULARIES: a word no reader knows refuses at CONSTRUCTION ─────────────────────
# Measured 2026-10-21: the module declared five vocabularies as bare constants and validated none of
# them, so a producer could write `host_only` and every consumer would read it as unknown.
_VOCABULARIES = (
    ("source", ae.SOURCE_WORDS),
    ("clock_status", ae.CLOCK_WORDS),
    ("validation", ae.VALIDATION_WORDS),
    ("completeness", ae.COMPLETENESS_WORDS),
)
_COUNT_FIELDS = ("expected_sample_count", "transport_gaps", "decode_gaps")


def _envelope(**kw):
    """A minimal legal envelope, so a leg below states exactly the one word it is about."""
    base = {
        "session_id": "s1",
        "device_id": "d1",
        "source": ae.SOURCE_LIVE,
        "signal": "spo2",
        "start_time_ms": None,
        "end_time_ms": None,
        "clock_status": ae.UNKNOWN,
        "sample_count": None,
        "expected_sample_count": ae.UNKNOWN,
        "duration_check": ae.DurationCheck.build(None, None),
        "transport_gaps": ae.UNKNOWN,
        "decode_gaps": ae.UNKNOWN,
        "device_state": ae.UNKNOWN,
        "artifact_path": None,
        "artifact_size": None,
        "artifact_sha256": None,
        "validation": ae.UNKNOWN,
        "validation_depth": None,
        "completeness": ae.UNKNOWN,
    }
    base.update(kw)
    return ae.AcquisitionEvidence(**base)


@pytest.mark.parametrize("field_name,vocabulary", _VOCABULARIES)
def test_every_word_the_module_DECLARES_is_accepted(field_name, vocabulary):
    """THE ANTI-VACUITY LEG. A refusal that also rejected the module's own words would fail every
    producer beneath it, so the acceptance direction is measured over the DERIVED tuple rather than
    over a list retyped here — a retyped list tests the typist's memory."""
    assert vocabulary, "an empty vocabulary accepts nothing, which is not a pass"
    for word in vocabulary:
        assert getattr(_envelope(**{field_name: word}), field_name) == word


@pytest.mark.parametrize("field_name,vocabulary", _VOCABULARIES)
def test_UNKNOWN_stays_legal_in_every_vocabulary(field_name, vocabulary):
    """§5. Closing a vocabulary must never close the door on missing information."""
    assert ae.UNKNOWN in vocabulary
    assert getattr(_envelope(**{field_name: ae.UNKNOWN}), field_name) == ae.UNKNOWN


@pytest.mark.parametrize(
    "field_name,bad",
    [
        ("source", "stored-files"),
        ("clock_status", "host_only"),
        ("validation", "ok"),
        ("completeness", "full"),
    ],
)
def test_each_vocabulary_field_refuses_its_OWN_undeclared_word(field_name, bad):
    """One leg per field, because a check that covers four fields can lose one and still look green.
    Each `bad` word is a PLAUSIBLE near-miss of the real one, which is the shape a producer writes."""
    with pytest.raises(ValueError) as caught:
        _envelope(**{field_name: bad})
    message = str(caught.value)
    assert field_name in message and bad in message, "the message must name the field AND the word"


@pytest.mark.parametrize("field_name", _COUNT_FIELDS)
@pytest.mark.parametrize("bad", ["0", "none", "n/a"])
def test_a_count_field_refuses_a_word_that_is_not_UNKNOWN(field_name, bad):
    """§∅ at the envelope's edge. These three strings are the ones that read downstream as a measured
    zero or an absence, and `"0"` is the worst of them: it survives every `int()` a consumer runs."""
    with pytest.raises(ValueError) as caught:
        _envelope(**{field_name: bad})
    assert field_name in str(caught.value)


@pytest.mark.parametrize("field_name", _COUNT_FIELDS)
def test_a_count_field_still_takes_a_real_count_including_zero(field_name):
    """A MEASURED zero is a legitimate count — no transport gaps is the common night — so the refusal
    above must key on the TYPE and never on falsiness."""
    assert getattr(_envelope(**{field_name: 0}), field_name) == 0
    assert getattr(_envelope(**{field_name: 7}), field_name) == 7
    assert getattr(_envelope(**{field_name: ae.UNKNOWN}), field_name) == ae.UNKNOWN


def test_each_count_field_REFUSES_A_STRANGE_WORD_AT_TYPE_TIME_TOO_not_only_at_construction():
    """THE REFUSAL ABOVE IS RUNTIME-ONLY, AND THAT IS A NIGHT'S DELAY. These three fields were
    annotated `int | str`, so mypy accepted `transport_gaps="n/a"` and the producer learnt at
    construction — on a capture path that assembles once a night. Measured on this tree: a planted
    `"n/a"` at a construction site drew no mypy error before the `Literal` union and three named
    `arg-type` errors after it.

    The annotation is therefore load-bearing, so it gets a check of its own. The mypy ratchet cannot
    be that check: it convicts on errors the tree HAS and says nothing about a refusal the tree
    LOST, and widening a field back to `int | str` removes errors rather than adding any. This test
    reds instead.

    The two tests above cannot catch it either — they splat `**{field_name: bad}`, and a splat erases
    the literal type, which is exactly why the runtime guard stays wider than the fields (see
    `_refuse_unlisted_count`)."""
    hints = get_type_hints(ae.AcquisitionEvidence)
    count = int | Literal["UNKNOWN"]

    assert hints["transport_gaps"] == count, "a gap count is a count or UNKNOWN, and no other string"
    assert hints["decode_gaps"] == count, "a gap count is a count or UNKNOWN, and no other string"
    # `None` belongs here and `str` does not: an unknowable expectation is absent, not a word.
    assert hints["expected_sample_count"] == count | None

    # The union names the word, so a renamed constant would leave the annotation pinned to a word the
    # module no longer declares. That reads as a passing test about nothing, so pin the value too.
    assert ae.UNKNOWN == "UNKNOWN"


def test_every_STRING_CONSTANT_the_module_declares_sits_in_exactly_one_vocabulary():
    """THE STALENESS TRIPWIRE, and the reason the tuples are derived rather than written out. A sixth
    word added above with no vocabulary beneath it reds here instead of shipping as a word no reader
    knows, and a vocabulary holding a word the module no longer declares reds too. `SCHEMA` and
    `SCHEMA_VERSION` are the envelope's identity rather than a vocabulary, so they are excluded by
    name — the only two exclusions, stated here rather than hidden in a prefix."""
    declared = {
        k: v
        for k, v in vars(ae).items()
        if k.isupper() and isinstance(v, str) and k not in ("SCHEMA", "SCHEMA_VERSION")
    }
    assert len(declared) >= 2, "the scan found almost nothing, which is not a pass"
    union = set()
    for vocabulary in (*(v for _, v in _VOCABULARIES), ae.DURATION_SOURCE_WORDS):
        union |= set(vocabulary)
    assert set(declared.values()) == union, f"constants {sorted(declared.values())} against words {sorted(union)}"


def test_a_direct_DurationCheck_refuses_a_source_the_module_never_declared():
    """The builder is not the only producer: the dataclass is public and `asdict` round-trips through
    it, so the refusal lives on the type rather than in `build`."""
    with pytest.raises(ValueError) as caught:
        ae.DurationCheck(300, 300, "measured", 0, True)
    assert "duration_check.source" in str(caught.value)


def test_the_builder_never_produces_an_undeclared_duration_source():
    """All four input shapes, because each one takes a different arm to its word."""
    for stored, observed in ((None, None), (300, None), (None, 300), (300, 301)):
        assert ae.DurationCheck.build(stored, observed).source in ae.DURATION_SOURCE_WORDS


def test_no_production_producer_passes_a_word_outside_the_vocabularies():
    """THE CONTROL THAT SAYS THIS CHANGES NO SIDECAR THE BOX WRITES TODAY. Each adapter is driven
    here through its real assembler, and every word it chose is one the module declares."""
    built = [
        o2.assemble_dat(_row(), trailer=_TRAILER_18311, verify_result=_verify()),
        o2.assemble_dat(_row(state="FAILED"), trailer=None, verify_result=None),
        _live(),
        _live(stopped_cleanly=True),
    ]
    for ev in built:
        for field_name, vocabulary in _VOCABULARIES:
            assert getattr(ev, field_name) in vocabulary, f"{field_name} left its vocabulary"


def test_the_vocabulary_READER_takes_only_its_PREFIX_and_only_strings():
    """`_declared` is the mechanism, and a test that reads only its OUTPUT cannot see it fail.

    Every vocabulary is computed once at module import, so the mutation gate's trampoline is not live
    when that call happens: measured 2026-10-21, four mutants of this one line survived the whole
    suite, including the one that turns `and` into `or` and admits every string constant the module
    has. A test that asserts on `SOURCE_WORDS` reads a tuple built before any mutant existed, so the
    call below is direct and the expected words are written out rather than derived."""
    assert ae._declared("CLOCK_") == ("device", "device+host", "host", "none")
    assert ae._declared("DURATION_SOURCE_") == ("observed", "stored")
    assert ae.UNKNOWN not in ae._declared("CLOCK_"), "a prefix reader must not admit an unprefixed word"
    assert ae._declared("NO_SUCH_PREFIX_") == (), "an undeclared prefix declares nothing"
    assert ae._declared("") == tuple(sorted(ae._declared(""))), "the reader returns its words sorted"


def test_a_one_sided_duration_keeps_the_side_it_HAS():
    """Mutant-measured 2026-10-21: dropping `observed_s` from the one-sided return survived the suite.

    Every earlier leg reads `source`, and none reads the value that named it. A record whose source
    says `observed` while the observed slot is null is absence as a value, in miniature (§∅)."""
    got = ae.DurationCheck.build(None, 7200)
    assert (got.stored_s, got.observed_s, got.source) == (None, 7200, ae.DURATION_SOURCE_OBSERVED)
    assert (got.delta_s, got.agrees) == (None, None), "one side present leaves no comparison to make"
    got = ae.DurationCheck.build(7200, None)
    assert (got.stored_s, got.observed_s, got.source) == (7200, None, ae.DURATION_SOURCE_STORED)


# ── the ring's own start stamp: ONE reading decides both the word and the field ───────────────────
# Row `2026-10-21-the-ring-stored-path-declares-an-unknown-clock-it-could-name`. The row proposed
# `none`; the trailer carries `start_t_ms` at T+8, so the measured word is `device`.
_TRAILER_WITH_START = {"finalized": True, "total_seconds": 300, "start_t_ms": 1_771_200_000_000}


def test_a_trailer_that_carries_a_start_stamp_names_the_DEVICE_clock():
    """The ring wrote that u32 itself with no phone connected, so the device clock reached the artifact
    and `none` would deny it. `device+host` would promise a cross-check those bytes cannot have."""
    assert o2.clock_status_for_dat(_TRAILER_WITH_START) == ae.CLOCK_DEVICE_ONLY
    assert o2.clock_status_for_dat(_TRAILER_WITH_START) != ae.CLOCK_NONE


def test_no_trailer_reads_NO_clock_and_says_UNKNOWN_not_none():
    """§5/§∅ and the sibling adapter's ruling: `none` is a measured conclusion about BOTH clocks, so a
    path that parsed no trailer may not borrow it. UNKNOWN is the absence of measurement."""
    assert o2.clock_status_for_dat(None) == ae.UNKNOWN
    assert o2.clock_status_for_dat({}) == ae.UNKNOWN
    assert o2.clock_status_for_dat({"finalized": True, "total_seconds": 300}) == ae.UNKNOWN


def test_a_zero_start_stamp_is_ABSENCE_not_the_1970_epoch():
    """§∅ as raw bytes: the stamp is a u32 the ring writes at T+8, so 0 is the field never written. A
    value-trusting reader would publish a recording that began on 1970-01-01."""
    assert o2.clock_status_for_dat({"start_t_ms": 0}) == ae.UNKNOWN
    assert o2.clock_status_for_dat({"start_t_ms": -1}) == ae.UNKNOWN
    assert o2._start_ms({"start_t_ms": 0}) is None


def test_the_boundary_is_non_positive_so_the_smallest_positive_stamp_is_a_reading():
    """Where the refusal sits, pinned. The rule refuses `<= 0` and nothing more, so 1 ms is a
    reading. A mutant that moved the constant to 1 survived every other test here: both stamps
    those tests use, 0 and 1_771_200_000_000, answer the same on either side of that line."""
    assert o2._start_ms({"start_t_ms": 1}) == 1.0
    assert o2.clock_status_for_dat({"start_t_ms": 1}) == ae.CLOCK_DEVICE_ONLY


def test_a_stamp_that_is_not_a_clock_reading_is_refused_by_shape():
    """A `bool` passes `isinstance(v, int)`, a string passes neither, and a non-finite float is no
    instant. Each is refused, and the refusal is the same absence in all three cases."""
    assert o2._start_ms({"start_t_ms": True}) is None
    assert o2._start_ms({"start_t_ms": "20260719010000"}) is None
    assert o2._start_ms({"start_t_ms": float("inf")}) is None
    assert o2._start_ms({"start_t_ms": float("nan")}) is None
    assert o2._start_ms(["start_t_ms"]) is None  # not a dict at all
    assert o2._start_ms({"start_t_ms": 1_771_200_000_000}) == 1_771_200_000_000.0


def test_the_assembler_takes_the_start_stamp_from_the_trailer_it_already_parsed():
    """The caller holds nothing the trailer does not, so passing none is not asserting absence. The
    envelope gains a real start and a real end rather than two nulls beside a readable stamp."""
    ev = o2.assemble_dat(_row(), trailer=_TRAILER_WITH_START, verify_result=_verify())
    assert ev.start_time_ms == 1_771_200_000_000.0
    assert ev.end_time_ms == 1_771_200_000_000.0 + 300 * 1000
    assert ev.clock_status == ae.UNKNOWN, "the assembler forwards the WORD its caller states"


def test_an_explicit_start_time_outranks_the_trailers_own_stamp():
    """The live path may have co-observed the session open, which is a host-disciplined instant rather
    than the ring's free-running clock. An explicit value therefore wins."""
    ev = o2.assemble_dat(_row(), trailer=_TRAILER_WITH_START, verify_result=_verify(), start_time_ms=5_000.0)
    assert ev.start_time_ms == 5_000.0 and ev.end_time_ms == 5_000.0 + 300 * 1000


def test_a_trailerless_pull_still_carries_no_start_time():
    """The derivation adds information and invents none: with no trailer there is no stamp to read."""
    ev = o2.assemble_dat(_row(), trailer=None, verify_result=_verify())
    assert ev.start_time_ms is None and ev.end_time_ms is None


# ── the stored envelope RE-STATES the pull's own facts ────────────────────────────────────────────
# The diff-scoped mutation gate reported 17 survivors inside `assemble_dat` on #3906, and nearly every
# one replaced a single field with `None`. Each assertion below names a fact the envelope owes the
# inventory row it was handed. A dropped field is not cosmetic: a consumer reads this sidecar as the
# record of what the pull was, so a null there denies a fact the pull established.
def test_the_stored_envelope_CARRIES_every_identity_its_inventory_row_states():
    """Six fields, each a verbatim re-statement. The row names the ring, the session, the file and the
    attempt; the adapter adds the one signal an O2Ring `.dat` holds. None of the six is derived, so a
    null in any of them is a lost fact rather than a measured absence."""
    row = _row(device_id="S8-AW-07", session="20260719010203", path="/x/20260719010203.dat", attempt=3)
    ev = o2.assemble_dat(row, trailer=_TRAILER_18311, verify_result=_verify())
    assert ev.device_id == "S8-AW-07", "the ring the row names"
    assert ev.session_id == "20260719010203"
    assert ev.artifact_path == "/x/20260719010203.dat"
    assert ev.artifact_size == 18311 * 3 + 58
    assert ev.signal == "spo2_hr_motion@1Hz", "the one signal a ring .dat carries"
    assert ev.provenance == {"inventory_state": "VERIFIED", "attempt": 3}


def test_the_stored_envelope_CARRIES_the_device_state_its_caller_OBSERVED():
    """UNKNOWN belongs to the caller who observed nothing. A caller passing a word did observe the
    ring, so the envelope states that word. UNKNOWN in its place would report an unexamined device."""
    ev = o2.assemble_dat(_row(), trailer=_TRAILER_18311, verify_result=_verify(), device_state="worn")
    assert ev.device_state == "worn"
    bare = o2.assemble_dat(_row(), trailer=_TRAILER_18311, verify_result=_verify())
    assert bare.device_state == ae.UNKNOWN, "the CONTROL: nobody looked, so the word says so"


def test_the_RECORD_WALK_hash_outranks_the_inventory_row_own_copy():
    """Both digests cover the same bytes, and the walk computed its own while reading every record
    boundary. The row's copy can predate a re-verify, so the richer reading wins. A null here would
    discard a hash this pull actually computed, and the row's own value sits right beside it."""
    ev = o2.assemble_dat(_row(sha256="row-sha"), trailer=_TRAILER_18311, verify_result=_verify(sha256="walk-sha"))
    assert ev.artifact_sha256 == "walk-sha"


def test_a_file_of_HEADER_AND_TRAILER_ONLY_counts_NO_samples():
    """58 bytes is a 10-byte header and a 48-byte trailer with nothing between them. A count of 0 is a
    MEASUREMENT, and these bytes support none: the body must EXCEED both envelopes before a sample
    grid exists at all (§∅). A shorter file is the same absence, and never a negative count."""
    empty = o2.assemble_dat(_row(size=58), trailer=_TRAILER_18311, verify_result=_verify())
    assert empty.sample_count is None, "no grid was found, which is not a grid of zero samples"
    stub = o2.assemble_dat(_row(size=10), trailer=_TRAILER_18311, verify_result=_verify())
    assert stub.sample_count is None, "a header alone yields no count, and never one below zero"


def test_the_sample_count_is_a_WHOLE_number_of_records():
    """The body divides into 3-byte records, and the count is how many of them it holds. A true
    division would write `300.0` into the sidecar, which states a fractional sample a 1 Hz grid
    cannot hold."""
    ev = o2.assemble_dat(_row(size=300 * 3 + 58), trailer=_TRAILER_18311, verify_result=_verify())
    assert ev.sample_count == 300
    assert isinstance(ev.sample_count, int), "a float count serialises as 300.0 in the sidecar"


def test_a_COARSE_validation_depth_never_claims_ZERO_decode_gaps():
    """Only the record-boundary walk can prove the sample grid whole. A VERIFIED inventory row was
    classified at the coarser size-and-finalised depth, which examined no boundary, so the gap count
    stays UNKNOWN. Both halves of the guard are load-bearing: VALID alone proves nothing about the
    grid, and a 0 here would be a count nothing measured (§∅)."""
    coarse = o2.assemble_dat(_row(state="VERIFIED"), trailer=_TRAILER_18311, verify_result=None)
    assert coarse.validation == ae.VALID and coarse.validation_depth == "size+finalised"
    assert coarse.decode_gaps == ae.UNKNOWN
    deep = o2.assemble_dat(_row(), trailer=_TRAILER_18311, verify_result=_verify())
    assert deep.decode_gaps == 0, "the CONTROL: the record walk DID examine every boundary"


def test_a_COMMITTED_inventory_row_is_as_VALID_as_a_VERIFIED_one():
    """`oxy_inventory` classifies both words clean at the size-and-finalised depth, and the adapter
    reads the two as one. No test passed the second word, so renaming it inside its tuple changed
    nothing. The gate excludes a string literal from what it DEMANDS, and its own note asks for the
    test when the literal carries data a consumer reads. An inventory state is exactly that."""
    ev = o2.assemble_dat(_row(state="COMMITTED"), trailer=_TRAILER_18311, verify_result=None)
    assert ev.validation == ae.VALID and ev.validation_depth == "size+finalised"
    assert ev.provenance["inventory_state"] == "COMMITTED"
