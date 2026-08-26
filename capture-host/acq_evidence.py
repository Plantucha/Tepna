# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""acq_evidence — the Acquisition Evidence Contract (ACQ-EVIDENCE-CONTRACT-2026-08-24-BRIEF).

A small, canonical envelope for what CAPTURE knows about the INTEGRITY, COMPLETENESS, TIMING, and
PROVENANCE of acquired data BEFORE a Dex interprets it. It is an ACQUISITION layer, not a science
layer (spec §3/§4): it answers "what do we know about the acquisition itself?", never "is this
physiological event real?".

THE THESIS (brief §1 map): this is a pure ASSEMBLER over facts Tepna already stores. This module is
GENERIC — it holds the envelope shape and its invariants and contains NO O2Ring / AS11 / EDF protocol
logic (spec §9). Device-specific capture code produces the observations (see the per-device assemblers,
e.g. `acq_evidence_o2ring`); this module only normalizes and carries them.

THREE INVARIANTS, each planted-control tested (spec §5/§6/§8):
  1. UNKNOWN ≠ ABSENT. Missing information is `UNKNOWN`, never a negative conclusion and never 0. An
     unavailable expected-sample-count is `UNKNOWN`, not `0`; an unobserved device state is `UNKNOWN`,
     not "not recording".
  2. VALIDATION ⟂ COMPLETENESS. Independent axes. A `.dat` can be VALID + PARTIAL (a whole,
     trailer-finalised recording that is only part of a night) or INVALID + COMPLETE. Never collapsed
     into one score.
  3. ACQUISITION ⟂ SCIENCE. Acquisition integrity never modifies event confidence here (spec §4/§15).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

SCHEMA = "ganglior.acquisition-evidence"
SCHEMA_VERSION = "1.1.0"  # ganglior-family, MINOR-bumped as fields are added back-compatibly
#   1.1.0 — added `clock_offset` (ClockOffset). A new FIELD, so the version DOES move — unlike the
#           `SOURCE_STORED_SPOOL` addition below, which added a VALUE to an open vocabulary.

# ── the one sentinel that keeps missing information from becoming a negative conclusion (§5) ──
UNKNOWN = "UNKNOWN"

# validation axis (§6) — independent of completeness
VALID = "VALID"
INVALID = "INVALID"
# completeness axis (§6) — independent of validation
COMPLETE = "COMPLETE"
PARTIAL = "PARTIAL"

# acquisition source provenance (§10) — live and stored are never merged into one indistinguishable word
SOURCE_LIVE = "live"  # a real-time device stream (O2Ring OXYFRAME, CPAP BLE)
SOURCE_STORED_DAT = "stored_dat"  # the device's onboard recording artifact (.dat)
SOURCE_SD_EDF = "sd_edf"  # a device SD-card EDF export
SOURCE_STORED_SPOOL = "stored_spool"  # the device's own spooled data, pulled over its link (AS11 CPAP)
# NOTE: a new SOURCE VALUE is not a new FIELD — the envelope shape is unchanged, so SCHEMA_VERSION does
# not move. `source` was an open vocabulary from the start (§10 requires that live and stored never
# collapse into one word); adding the CPAP spool to it is what that vocabulary is for.


@dataclass(frozen=True)
class DurationCheck:
    """The expected-vs-independent duration comparison (brief §1 refinement 2, lead-ratified; the
    auto-harvest owner spec §16's vocabulary — `stored`/`observed` — shared with the #1742 runner).

    `stored_s` is the in-artifact DECLARATION (the .dat trailer's `total_seconds`), co-derived with the
    actual sample count from the same bytes. `observed_s` is the INDEPENDENT expectation — the
    live-observed `duration_s` at close, seen by the live path, or `None` when the live path did not see
    the close. Their disagreement is a first-class field, never silently reconciled."""

    stored_s: int | None
    observed_s: int | None
    source: str  # "observed" when the live path saw the close, "stored" as the fallback, else UNKNOWN
    delta_s: int | None  # SIGN CONVENTION (pinned): delta_s = stored_s - observed_s
    agrees: bool | None  # |delta_s| <= 1 — the ±1 s tolerance is the ring counter's quantization, not
    #                      bare equality (o2ring-duration-is-quantized: the counter is ±1 s quantized,
    #                      NOT a frame index). None when either side is unknown.

    @staticmethod
    def build(stored_s: int | None, observed_s: int | None) -> "DurationCheck":
        if stored_s is None and observed_s is None:
            return DurationCheck(None, None, UNKNOWN, None, None)
        if stored_s is None or observed_s is None:
            # one side present: prefer the independently-observed value for the expected slot when we
            # have it, else the stored declaration — but there is no comparison to make.
            src = "observed" if observed_s is not None else "stored"
            return DurationCheck(stored_s, observed_s, src, None, None)
        delta = stored_s - observed_s
        return DurationCheck(stored_s, observed_s, "observed", delta, abs(delta) <= 1)


@dataclass(frozen=True)
class ClockOffset:
    """An INDEPENDENTLY MEASURED device-vs-reference clock offset, with the provenance that makes it
    usable (CPAPDEX-STR-SUMMARY-INGEST, the "still owed" clock box).

    WHY THIS IS A FIELD AND NOT A COMMENT: a consumer that corrects a device timestamp needs to know
    WHEN the offset was measured and AGAINST WHAT — an offset without those is a bare number nobody can
    responsibly apply, because a device crystal drifts and an offset measured a week ago is not the
    offset tonight. So the provenance rides the envelope, never a code comment.

    THIS DOES NOT CORRECT ANYTHING. It is the DECLARE half of declare-never-correct: the envelope
    carries the measurement, and a consumer decides whether and how to apply it, emitting corrected
    values BESIDE the raw device-time ones (INV3/INV4 — the raw stamp is never substituted).

    `offset_sec` is signed: POSITIVE means the DEVICE clock reads LATER than the reference. Absent
    measurement is None — never 0.0, which would assert a measured agreement that never happened."""

    offset_sec: float | None
    measured_at_ms: float | None  # Clock Contract floating tMs — WHEN, so staleness is the consumer's to judge
    reference: str  # what it was measured AGAINST (e.g. "host-stratum1"); UNKNOWN when unstated
    method: str  # how (e.g. "GetDateTime"); UNKNOWN when unstated

    @staticmethod
    def unknown() -> "ClockOffset":
        """The honest absence. Every member unknown — not a zero offset, which is a different claim."""
        return ClockOffset(None, None, UNKNOWN, UNKNOWN)

    @property
    def measured(self) -> bool:
        """True only when there is a number to apply. A consumer gates on this, never on truthiness —
        `offset_sec == 0.0` is a legitimate MEASURED result (the clocks agreed) and is falsy."""
        return self.offset_sec is not None


@dataclass(frozen=True)
class AcquisitionEvidence:
    """The canonical envelope. Assembled from existing stores; emitted beside the artifact."""

    session_id: str | None
    device_id: str | None
    source: str
    signal: str | None

    start_time_ms: float | None  # Clock Contract floating tMs; None (not 0) when unknown
    end_time_ms: float | None
    clock_status: str  # a timingSource-derived word (device+host / host / none) or UNKNOWN
    # (its NUMERIC companion is `clock_offset`, in the defaulted tail below — a dataclass cannot carry
    #  a defaulted field ahead of non-defaulted ones, so it sits there rather than here)

    sample_count: int | None
    expected_sample_count: int | None | str  # int, or UNKNOWN — NEVER 0 for "we don't know" (§8)
    duration_check: DurationCheck

    # gap accounting kept forensic, not a percentage (§8). Each category is a count or UNKNOWN.
    transport_gaps: int | str
    decode_gaps: int | str

    device_state: str  # a normalized OXYLIFE/FGState observation, or UNKNOWN (§9)

    artifact_path: str | None
    artifact_size: int | None
    artifact_sha256: str | None  # reuse the canonical hash; None (not "") when not computed (§12)

    validation: str  # VALID | INVALID | UNKNOWN (§6)
    validation_depth: str | None  # e.g. "size+finalised+records" — what the validation actually checked
    completeness: str  # COMPLETE | PARTIAL | UNKNOWN (§6) — INDEPENDENT of validation

    # v1.1.0 — the NUMERIC companion to `clock_status`. The word says WHICH CLOCKS were involved; this
    # says BY HOW MUCH they differed, WHEN, and AGAINST WHAT. Defaulted to the honest-absence record, so
    # every existing caller keeps working and gets UNKNOWN rather than a fabricated zero.
    clock_offset: ClockOffset = field(default_factory=ClockOffset.unknown)

    provenance: dict = field(default_factory=dict)  # ledger refs / observed transitions (§13)

    schema: str = SCHEMA
    version: str = SCHEMA_VERSION

    def to_dict(self) -> dict:
        return asdict(self)
