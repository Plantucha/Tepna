# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""Tests for the Acquisition Evidence Contract (ACQ-EVIDENCE-CONTRACT-2026-08-24-BRIEF).

The two PLANTED CONTROLS (lead ruling 5, spec §5/§6) are the point, not decoration: one that reds if
the envelope ever collapses UNKNOWN→ABSENT, and one that reds if it ever collapses VALID→COMPLETE.
Both are stated from the physics/semantics (pre-state-the-threshold), not as after-the-fact snapshots.
"""

from types import SimpleNamespace

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
