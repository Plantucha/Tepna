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
from typing import Final, Literal

SCHEMA = "ganglior.acquisition-evidence"
SCHEMA_VERSION = "1.1.0"  # ganglior-family, MINOR-bumped as fields are added back-compatibly
#   1.1.0 — added `clock_offset` (ClockOffset). A new FIELD, so the version DOES move — unlike the
#           `SOURCE_STORED_SPOOL` addition below, which added a VALUE to an open vocabulary.

# ── the one sentinel that keeps missing information from becoming a negative conclusion (§5) ──
# `Final` is what carries the LITERAL type to the three count-field annotations below: without it
# mypy widens this to `str`, and `int | Literal[UNKNOWN]` would then admit every string again.
UNKNOWN: Final = "UNKNOWN"

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
# the device's own onboard recording FILES, pulled off its filesystem over its link (Polar PS-FTP).
# Neither word above describes it: `stored_dat` is ONE artifact the device finalises with a trailer, and
# `stored_spool` is a cursor the device serves bytes from. A PS-FTP pull mirrors a directory the device
# wrote by itself, so the acquisition is a SET of files whose own count is part of what is known about
# it. §10 is why it gets its own word rather than borrowing one: a consumer that cannot tell a file-set
# pull from a finalised single artifact cannot tell which absences are expected.
SOURCE_STORED_FILES = "stored_files"
# NOTE: a new SOURCE VALUE is not a new FIELD — the envelope shape is unchanged, so SCHEMA_VERSION does
# not move. `source` was an open vocabulary from the start (§10 requires that live and stored never
# collapse into one word); adding the CPAP spool to it is what that vocabulary is for.

# ── the `clock_status` vocabulary, named here because the field had no producer ────────────────────
# `clock_status` is declared on the envelope and documented below as "device+host / host / none", and
# until `acq_evidence_polar` landed NO production caller ever passed one of those words: measured
# 2026-10-21 over this tree, `pull_session.py` was the only call site naming the field at all and it
# names `UNKNOWN`, so every envelope the box has written reads UNKNOWN there. The words were therefore
# a comment rather than a vocabulary. Naming them as constants is what lets an adapter state one and a
# reader compare without matching a string literal. These are VALUES in an open vocabulary, exactly as
# the sources above are, so SCHEMA_VERSION does not move.
CLOCK_DEVICE_AND_HOST = "device+host"  # the stream carries the device's own clock beside the host's
CLOCK_HOST_ONLY = "host"  # only the host stamped it — there is no second clock to compare against
CLOCK_NONE = "none"  # neither clock reached the artifact
# Only the device's own clock stamped it, because no host was there to stamp anything. This is the
# FOURTH combination of the two clocks, and it was missing because no producer had ever met it: a live
# stream always has a host, so the three words above cover every live case. An onboard recording made
# with no phone connected is the case that needs it, and `device+host` would promise a cross-check that
# cannot exist for those bytes while `host` and `none` would both deny a clock that is demonstrably
# there. Whether that device clock AGREES with a host's is `clock_offset`'s question, never this one.
CLOCK_DEVICE_ONLY = "device"

# ── the `duration_check.source` vocabulary (§16 of the auto-harvest owner spec, verbatim) ──────────
# These two words are the owner spec's own, shared with the #1742 runner, so they are named here
# rather than renamed. `DurationCheck.build` is their only production producer today, but the
# dataclass is public and a direct construction bypasses the builder entirely.
DURATION_SOURCE_OBSERVED = "observed"  # the live path saw the close, so the expectation is independent
DURATION_SOURCE_STORED = "stored"  # only the artifact's own declaration was available


# ── THE DECLARED VOCABULARIES, and the refusal that makes them more than a comment ────────────────
# Measured 2026-10-21: this module declared five vocabularies as bare constants, ran no
# `__post_init__`, and raised nowhere. A producer passing `host_only` or `stored-files` therefore
# wrote a sidecar every consumer reads as unknown, and no gate reded. OPEN, in the source note above,
# means EXTENSIBLE and never UNENUMERATED: a word joins by declaring a constant. So a tuple per
# vocabulary and a refusal on an unlisted word hold both halves of that note, and UNKNOWN stays legal
# in every one of them (§5 — missing information must always have somewhere to go).
#
# WHAT IS NOT VALIDATED, on purpose. `device_state` carries a normalized OXYLIFE/FGState observation
# and `validation_depth` describes what a checker actually checked; both are open OBSERVATION spaces
# this module does not declare, so a tuple would refuse a true word. The rule binds exactly the
# vocabularies declared HERE (§9: the generic envelope holds no protocol logic, and a device's own
# state words are protocol).
def _declared(prefix: str) -> tuple[str, ...]:
    """The words a prefix declares, read from the constants above rather than retyped beneath them.

    DERIVED, so declaring `SOURCE_X` extends the vocabulary with no second edit and no stale list —
    a hand-written list names only the words whoever wrote it remembered. The `isinstance` test is
    what keeps a TUPLE sharing the prefix (`SOURCE_WORDS` itself) out of its own vocabulary."""
    return tuple(sorted(v for k, v in globals().items() if k.startswith(prefix) and isinstance(v, str)))


SOURCE_WORDS: tuple[str, ...] = _declared("SOURCE_") + (UNKNOWN,)
CLOCK_WORDS: tuple[str, ...] = _declared("CLOCK_") + (UNKNOWN,)
DURATION_SOURCE_WORDS: tuple[str, ...] = _declared("DURATION_SOURCE_") + (UNKNOWN,)
# The two axes of §6 share no prefix, so they are named. The suite holds every upper-case string
# constant in this module to membership in exactly one vocabulary, which is what catches a word
# declared here and forgotten there — the staleness a literal tuple cannot see by itself.
VALIDATION_WORDS: tuple[str, ...] = (VALID, INVALID, UNKNOWN)
COMPLETENESS_WORDS: tuple[str, ...] = (COMPLETE, PARTIAL, UNKNOWN)


def _refuse_unlisted(field_name: str, word: object, vocabulary: tuple[str, ...]) -> None:
    """Refuse a word no reader knows. The message names the FIELD, the word and the vocabulary,
    because "invalid value" sends the operator back to the source to learn which of five it was."""
    if word not in vocabulary:
        raise ValueError(f"acq_evidence: {field_name}={word!r} is not a declared word; expected one of {vocabulary}")


def _refuse_unlisted_count(field_name: str, value: int | str | None) -> None:
    """A count field is an int, or UNKNOWN, or None — never another word (§8). `"0"`, `"none"` and
    `"n/a"` are exactly the strings that read as a measured zero downstream, so they stop here.

    ⚠️ THE PARAMETER STAYS `int | str | None` ON PURPOSE, which is wider than the three fields it
    guards. The annotations above refuse a bad word at type-check time, and this refuses it at
    construction time, and the two cover different callers: a `**kwargs` splat erases the literal
    type (the suite's own refusal tests do exactly that), an `Any` from a `dict.get` satisfies any
    annotation, and nothing type-checks a caller outside this tree at all. Narrowing this parameter
    to match the fields would leave those three callers with no check anywhere."""
    if isinstance(value, str) and value != UNKNOWN:
        raise ValueError(f"acq_evidence: {field_name}={value!r} is a count or {UNKNOWN}, never another word")


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

    def __post_init__(self) -> None:
        _refuse_unlisted("duration_check.source", self.source, DURATION_SOURCE_WORDS)

    @staticmethod
    def build(stored_s: int | None, observed_s: int | None) -> "DurationCheck":
        if stored_s is None and observed_s is None:
            return DurationCheck(None, None, UNKNOWN, None, None)
        if stored_s is None or observed_s is None:
            # one side present: prefer the independently-observed value for the expected slot when we
            # have it, else the stored declaration — but there is no comparison to make.
            src = DURATION_SOURCE_OBSERVED if observed_s is not None else DURATION_SOURCE_STORED
            return DurationCheck(stored_s, observed_s, src, None, None)
        delta = stored_s - observed_s
        return DurationCheck(stored_s, observed_s, DURATION_SOURCE_OBSERVED, delta, abs(delta) <= 1)


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
    clock_status: str  # WHICH clocks stamped it: device+host / host / device / none, or UNKNOWN.
    # A live stream's word is derived from `quality.timingSource`; a stored artifact's is read from
    # its own header or path stamp, because no host was there to publish a timingSource at all.
    # (its NUMERIC companion is `clock_offset`, in the defaulted tail below — a dataclass cannot carry
    #  a defaulted field ahead of non-defaulted ones, so it sits there rather than here)

    sample_count: int | None
    expected_sample_count: int | Literal["UNKNOWN"] | None  # int, or UNKNOWN — NEVER 0 for "we don't know" (§8)
    duration_check: DurationCheck

    # gap accounting kept forensic, not a percentage (§8). Each category is a count or UNKNOWN.
    transport_gaps: int | Literal["UNKNOWN"]
    decode_gaps: int | Literal["UNKNOWN"]

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

    def __post_init__(self) -> None:
        """Construction is where an undeclared word stops.

        WHY HERE AND NOT IN EACH ADAPTER: three adapters pass these words through from their own
        callers untouched, so a rule each adapter must remember is not a mechanism. Every envelope
        this box writes is built by constructing this dataclass, so this is the one place no producer
        can route around. A refusal costs the ENVELOPE and never the artifact: all five production
        producers assemble inside a guard that logs and writes the sidecar without it."""
        _refuse_unlisted("source", self.source, SOURCE_WORDS)
        _refuse_unlisted("clock_status", self.clock_status, CLOCK_WORDS)
        _refuse_unlisted("validation", self.validation, VALIDATION_WORDS)
        _refuse_unlisted("completeness", self.completeness, COMPLETENESS_WORDS)
        _refuse_unlisted_count("expected_sample_count", self.expected_sample_count)
        _refuse_unlisted_count("transport_gaps", self.transport_gaps)
        _refuse_unlisted_count("decode_gaps", self.decode_gaps)

    def to_dict(self) -> dict:
        return asdict(self)
