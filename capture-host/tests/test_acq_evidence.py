# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""Tests for the Acquisition Evidence Contract (ACQ-EVIDENCE-CONTRACT-2026-08-24-BRIEF).

The two PLANTED CONTROLS (lead ruling 5, spec §5/§6) are the point, not decoration: one that reds if
the envelope ever collapses UNKNOWN→ABSENT, and one that reds if it ever collapses VALID→COMPLETE.
Both are stated from the physics/semantics (pre-state-the-threshold), not as after-the-fact snapshots.
"""

from types import SimpleNamespace

import json

import acq_evidence as ae
import acq_evidence_o2ring as o2

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
    kw = dict(device_id="O2-1", session_id="20260826031500", artifact_path="/n/x_SPO2.csv",
              artifact_rows=3600)
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
    csv.write_text("header\n")
    started = dt.datetime(2026, 8, 26, 3, 15, 0)
    g = capture.O2PpgGrid()
    g.idx, g.lost, g.gaps = 3600, 12, 3
    capture._emit_oxy_live_evidence("O2-1", {"device_id": "O2-1"}, started,
                                    (str(csv), 3600), g, capture.O2PpgFrameLedger())

    blob = json.loads((tmp_path / (csv.name + ".meta.json")).read_text())
    ev = blob["acquisition_evidence"]
    assert ev["source"] == ae.SOURCE_LIVE
    assert ev["sample_count"] == 3600
    assert ev["artifact_path"] == str(csv)
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

    # a path whose parent does not exist ⇒ the open() raises inside the helper
    capture._emit_oxy_live_evidence("O2-1", {"device_id": "O2-1"}, dt.datetime(2026, 8, 26, 3, 15, 0),
                                    (str(tmp_path / "absent-dir" / "x.csv"), 10),
                                    capture.O2PpgGrid(), capture.O2PpgFrameLedger())  # must not raise


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
