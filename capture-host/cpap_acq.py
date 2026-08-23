# tepna-capture — cpap_acq.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# CPAP ACQUISITION LIFECYCLE — the explicit state machine, provenance event vocabulary, and failure
# taxonomy that surround the AS11 protocol core (as11_link/as11_pull/cpap_stream). Executes P2 of
# CPAP-ACQUISITION-HARDENING-AUDIT-2026-08-23-BRIEF, under the acquisition-hardening lead (session
# codename Mutator, 2026-08-23).
#
# WHY A STANDALONE MODULE. The audit's gap G3 is that the live path has only a binary running/not-running
# with no recorded transitions. This is pure logic — a legal-transition table, an event record, a failure
# taxonomy — with NO transport, NO async, NO physiology, NO BUS. It touches neither cpap_stream's
# ingestion function nor capture.py, so it is collision-free with the feature arm's in-flight EDF wiring
# (P1's raw sidecar and P5's recovery will CONSUME this; wiring is a later, announced step).
#
# WHAT IT IS NOT. Not a scheduler, not a recovery driver, not a writer. It answers "what transitions are
# legal, what does one produce, and how is a failure classified" — the vocabulary the recovery policy
# (P5) and the provenance sidecar (P2 persistence, modeled on writers.LinkLogWriter) both need. Clocks
# are INJECTED so the whole thing is deterministic under test.
from __future__ import annotations

import time as _time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum


class AcqState(Enum):
    """The CPAP acquisition lifecycle (spec §3). The smallest set that covers the live + spool + recovery
    paths the audit names; every member below has at least one legal transition in LEGAL_TRANSITIONS.

    CONNECTION vs ACQUISITION (spec §4): these are ACQUISITION states. A transport drop moves
    LIVE_CAPTURING→LIVE_INTERRUPTED WITHOUT ending the acquisition session — a new connection does not
    start a new session, and a connection loss is not a physiological session end."""

    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    AUTHENTICATING = "authenticating"
    AUTHENTICATED = "authenticated"
    CONFIGURING = "configuring"
    READY = "ready"
    LIVE_CAPTURING = "live_capturing"
    LIVE_INTERRUPTED = "live_interrupted"
    SYNC_PENDING = "sync_pending"
    SYNCING = "syncing"
    VERIFIED = "verified"
    RECOVERING = "recovering"
    SHUTTING_DOWN = "shutting_down"
    ERROR = "error"


# THE LEGAL TRANSITION TABLE. A (from, to) pair not in this set is an invalid transition and is REFUSED
# (spec §3: "invalid transitions must not silently occur"). Kept as an explicit frozenset rather than
# per-state methods so the whole legal graph is auditable in one place and testable as data.
#
# The shape follows spec §6's restore order (CONNECT→AUTHENTICATE→CONFIGURE→RESTORE→RESUME) plus the
# audit's hardware-pinned recovery: a drop during live capture goes to LIVE_INTERRUPTED→RECOVERING, and
# recovery re-enters at CONNECTING (a reconnect must NOT assume prior protocol state remains valid —
# spec §6). ERROR and SHUTTING_DOWN are reachable from every operational state; DISCONNECTED is the
# terminal rest state a clean shutdown or a fatal error settles into.
_S = AcqState
LEGAL_TRANSITIONS: frozenset = frozenset({
    # connect — the daemon opens a link to the KNOWN paired address (no discovery scan; pairing is a
    # one-time operator action, not a daemon state), so DISCONNECTED goes straight to CONNECTING.
    (_S.DISCONNECTED, _S.CONNECTING),
    (_S.CONNECTING, _S.CONNECTED),
    # auth + configure + ready
    (_S.CONNECTED, _S.AUTHENTICATING),
    (_S.AUTHENTICATING, _S.AUTHENTICATED),
    (_S.AUTHENTICATED, _S.CONFIGURING),
    (_S.CONFIGURING, _S.READY),
    # live capture + its interruption (a transport drop, NOT a session end)
    (_S.READY, _S.LIVE_CAPTURING),
    (_S.LIVE_CAPTURING, _S.LIVE_INTERRUPTED),
    (_S.LIVE_INTERRUPTED, _S.RECOVERING),
    # stored-spool synchronization (READY or a verified live night can move to sync)
    (_S.READY, _S.SYNC_PENDING),
    (_S.LIVE_CAPTURING, _S.SYNC_PENDING),
    (_S.SYNC_PENDING, _S.SYNCING),
    (_S.SYNCING, _S.VERIFIED),
    (_S.SYNCING, _S.RECOVERING),          # a sync drop recovers, per the P4 hardware model
    (_S.VERIFIED, _S.READY),              # a verified sync returns to ready for more work
    (_S.VERIFIED, _S.SHUTTING_DOWN),
    # recovery re-enters the connect sequence — prior protocol state is NOT assumed valid (spec §6)
    (_S.RECOVERING, _S.CONNECTING),
    (_S.RECOVERING, _S.ERROR),            # recovery budget spent → error
    # clean stop from any settled operational state
    (_S.READY, _S.SHUTTING_DOWN),
    (_S.LIVE_CAPTURING, _S.SHUTTING_DOWN),
    (_S.SHUTTING_DOWN, _S.DISCONNECTED),
    # error is reachable from every operational state; a fatal error settles to disconnected
    (_S.CONNECTING, _S.ERROR),
    (_S.CONNECTED, _S.ERROR),
    (_S.AUTHENTICATING, _S.ERROR),
    (_S.AUTHENTICATED, _S.ERROR),
    (_S.CONFIGURING, _S.ERROR),
    (_S.READY, _S.ERROR),
    (_S.LIVE_CAPTURING, _S.ERROR),
    (_S.LIVE_INTERRUPTED, _S.ERROR),
    (_S.SYNC_PENDING, _S.ERROR),
    (_S.SYNCING, _S.ERROR),
    (_S.ERROR, _S.DISCONNECTED),          # settled/abandoned
    (_S.ERROR, _S.RECOVERING),            # a recoverable error retries
})


class FailureClass(Enum):
    """Failure taxonomy (spec §30). NOT collapsed into "CPAP disconnected" — recovery policy depends on
    the class. `recoverable` is the property the recovery driver (P5) branches on: a permanent protocol
    or auth error must NOT trigger endless reconnects (spec §31)."""

    TRANSPORT_FAILURE = ("transport_failure", True)
    TIMEOUT = ("timeout", True)
    FRAME_CORRUPTION = ("frame_corruption", True)
    STREAM_STALL = ("stream_stall", True)
    DEVICE_UNAVAILABLE = ("device_unavailable", True)
    # The peer stopped sending mid-file: neither a timeout (the link is alive) nor corruption
    # (the bytes received are good) — it has its own retry policy, so it gets its own class.
    TRUNCATED_TRANSFER = ("truncated_transfer", True)
    RECOVERABLE_ERROR = ("recoverable_error", True)
    AUTHENTICATION_FAILURE = ("authentication_failure", False)
    PROTOCOL_FAILURE = ("protocol_failure", False)
    STORAGE_FAILURE = ("storage_failure", False)
    VALIDATION_FAILURE = ("validation_failure", False)
    FATAL_ERROR = ("fatal_error", False)

    def __init__(self, label: str, recoverable: bool):
        self.label = label
        self.recoverable = recoverable


class InvalidTransition(RuntimeError):
    """Raised when a transition not in LEGAL_TRANSITIONS is attempted. Carries both states so a caller
    logs the exact illegal edge rather than a generic 'bad state'."""

    def __init__(self, frm: AcqState, to: AcqState):
        self.frm = frm
        self.to = to
        super().__init__(f"illegal CPAP acquisition transition: {frm.value} -> {to.value}")


@dataclass(frozen=True)
class Transition:
    """One recorded state transition (spec §3). Immutable — a provenance record is evidence, not a
    mutable cursor. Every field the spec requires: previous + new state, reason, host monotonic AND wall
    time (both, because monotonic orders events across a clock step while wall time places them on the
    stratum-1 timeline), the device identity, and the acquisition-session identity. `failure` is set only
    on a transition into ERROR/LIVE_INTERRUPTED so the class survives with the edge that produced it."""

    prev: AcqState
    new: AcqState
    reason: str
    host_monotonic: float
    host_wall: str          # ISO-8601 UTC, from the injected wall clock — never fabricated downstream
    device_id: str | None
    session_id: str | None
    failure: FailureClass | None = None

    def as_row(self) -> str:
        """A `;`-delimited provenance row, matching the writers.LinkLogWriter sidecar idiom (P2
        persistence models this). Blank, never a fabricated zero, for an absent field (Clock-Contract
        honesty: a missing value is visible)."""
        def _f(v) -> str:
            return "" if v is None else str(v)
        return ";".join((
            self.host_wall,
            f"{self.host_monotonic:.6f}",
            self.prev.value,
            self.new.value,
            self.reason,
            _f(self.device_id),
            _f(self.session_id),
            _f(self.failure.label if self.failure else None),
        ))


def _default_wall() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class AcqLifecycle:
    """The live acquisition-lifecycle tracker. Holds the current state + the immutable transition history,
    validates every move against LEGAL_TRANSITIONS, and stamps each with injected clocks.

    Clocks are INJECTED (`mono`/`wall`) so tests are deterministic and the module has no hidden time
    dependency — the same discipline as writers.py's `_time.monotonic`. `device_id` / `session_id` are
    the acquisition identity every transition carries (spec §27: DEVICE and ACQUISITION_RUN are distinct
    concepts, both recorded)."""

    device_id: str | None = None
    session_id: str | None = None
    state: AcqState = AcqState.DISCONNECTED
    history: list = field(default_factory=list)
    mono: "callable" = _time.monotonic
    wall: "callable" = _default_wall

    def can(self, to: AcqState) -> bool:
        """True iff moving to `to` from the current state is a legal transition."""
        return (self.state, to) in LEGAL_TRANSITIONS

    def to(self, new: AcqState, reason: str, *, failure: FailureClass | None = None) -> Transition:
        """Transition to `new`, recording it. Raises InvalidTransition on an illegal edge — the move does
        NOT happen and no partial record is appended (spec §3: invalid transitions must not silently
        occur). Returns the recorded Transition so the caller can persist/emit it."""
        if (self.state, new) not in LEGAL_TRANSITIONS:
            raise InvalidTransition(self.state, new)
        t = Transition(
            prev=self.state, new=new, reason=reason,
            host_monotonic=self.mono(), host_wall=self.wall(),
            device_id=self.device_id, session_id=self.session_id, failure=failure,
        )
        self.state = new
        self.history.append(t)
        return t

    def fail(self, failure: FailureClass, reason: str) -> Transition:
        """Move to ERROR (or LIVE_INTERRUPTED if the failure is a recoverable transport drop during live
        capture) carrying the failure class. A convenience over `to`, so a caller classifies once and the
        right edge + record follow. The recovery driver (P5) reads `failure.recoverable` off the returned
        record to decide reconnect vs abort."""
        if self.state is AcqState.LIVE_CAPTURING and failure.recoverable:
            return self.to(AcqState.LIVE_INTERRUPTED, reason, failure=failure)
        return self.to(AcqState.ERROR, reason, failure=failure)
