# tepna-capture — oxy_lifecycle.py
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""OxyII (O2Ring) acquisition-lifecycle journal — charter G4 (the CPAP P2 twin, for the O2Ring arm).

The daemon's live acquisition passes through a small set of states DERIVED FROM WHAT `run_oxyii` +
the pull handoff + autopull ACTUALLY DO (charter R5 — not a spec-imposed 16-state machine). This module
is the pure, run_oxyii-AGNOSTIC state machine + immutable transition record; the capture.py emit calls
and the `OXYLIFE.csv` sidecar / STATUS surfacing are the separate announced wiring touch, exactly as
CPAP P2 (`cpap_acq.py`) preceded its wiring.

Boundary (charter, lead-ratified): G4 is the daemon lifecycle AS SEEN FROM capture.py. `PAUSED_FOR_PULL`
and `PULLING` are visible there (the `_OXYII_PAUSE` set/clear and the autopull call sites); per-transfer
DOWNLOADING/VERIFYING depth is G1's inventory ledger, not a second instrument here.

The failure taxonomy is NOT forked: it is the shared `cpap_acq.FailureClass`, which `oxy_transfer.py`
already imports — one taxonomy across both Bluetooth arms.
"""
import time as _time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum

from cpap_acq import FailureClass


class OxyState(Enum):
    """The states with a real `run_oxyii` counterpart. §25 liveness (CONNECTED_BUT_IDLE / DISCONNECTED /
    NOT_SEEN / PROTOCOL_STALLED) is expressed here as CONNECTED / DISCONNECTED / NOT_SEEN / INTERRUPTED."""

    NOT_SEEN = "not_seen"                 # resting: the ring has not been seen this run (§25 NOT_SEEN)
    CONNECTING = "connecting"             # scan + BLE connect in progress
    CONNECTED = "connected"               # auth(0xFF)+setup(0x10) done, link up, not yet streaming (§25 CONNECTED_BUT_IDLE)
    LIVE = "live"                         # decoding the ~1 Hz vitals poll (cmd 0x04)
    IDLE_UNWORN = "idle_unworn"           # link up but the ring reports not-worn
    INTERRUPTED = "interrupted"           # link held but no frames decoded (§25 PROTOCOL_STALLED)
    DISCONNECTED = "disconnected"         # the link dropped (§25 DISCONNECTED)
    PAUSED_FOR_PULL = "paused_for_pull"   # a stored-session pull owns the link (_OXYII_PAUSE)
    PULLING = "pulling"                   # the autopull is pulling a stored recording (daemon-level)
    RECOVERING = "recovering"             # the adapter watchdog is resetting a wedged controller (_RECOVER)
    ERROR = "error"                       # a failure the recovery driver must classify
    SHUTTING_DOWN = "shutting_down"       # the daemon's real shutdown path (terminal)


_S = OxyState

# The legal edges, read off run_oxyii's real control flow. An illegal move RAISES — a lifecycle that
# cannot happen must not be silently recorded (charter R5 / P2 §3).
LEGAL_TRANSITIONS = frozenset({
    (_S.NOT_SEEN, _S.CONNECTING), (_S.NOT_SEEN, _S.SHUTTING_DOWN),

    (_S.CONNECTING, _S.CONNECTED), (_S.CONNECTING, _S.DISCONNECTED), (_S.CONNECTING, _S.ERROR),
    (_S.CONNECTING, _S.RECOVERING), (_S.CONNECTING, _S.PAUSED_FOR_PULL), (_S.CONNECTING, _S.SHUTTING_DOWN),

    (_S.CONNECTED, _S.LIVE), (_S.CONNECTED, _S.IDLE_UNWORN), (_S.CONNECTED, _S.INTERRUPTED),
    (_S.CONNECTED, _S.DISCONNECTED), (_S.CONNECTED, _S.ERROR), (_S.CONNECTED, _S.PAUSED_FOR_PULL),
    (_S.CONNECTED, _S.RECOVERING), (_S.CONNECTED, _S.SHUTTING_DOWN),

    (_S.LIVE, _S.INTERRUPTED), (_S.LIVE, _S.IDLE_UNWORN), (_S.LIVE, _S.DISCONNECTED),
    (_S.LIVE, _S.PAUSED_FOR_PULL), (_S.LIVE, _S.ERROR), (_S.LIVE, _S.RECOVERING),
    (_S.LIVE, _S.SHUTTING_DOWN),

    (_S.IDLE_UNWORN, _S.LIVE), (_S.IDLE_UNWORN, _S.INTERRUPTED), (_S.IDLE_UNWORN, _S.DISCONNECTED),
    (_S.IDLE_UNWORN, _S.PAUSED_FOR_PULL), (_S.IDLE_UNWORN, _S.ERROR), (_S.IDLE_UNWORN, _S.RECOVERING),
    (_S.IDLE_UNWORN, _S.SHUTTING_DOWN),

    (_S.INTERRUPTED, _S.CONNECTING), (_S.INTERRUPTED, _S.DISCONNECTED), (_S.INTERRUPTED, _S.ERROR),
    (_S.INTERRUPTED, _S.RECOVERING), (_S.INTERRUPTED, _S.SHUTTING_DOWN),

    (_S.DISCONNECTED, _S.CONNECTING), (_S.DISCONNECTED, _S.PAUSED_FOR_PULL),
    (_S.DISCONNECTED, _S.RECOVERING), (_S.DISCONNECTED, _S.ERROR), (_S.DISCONNECTED, _S.SHUTTING_DOWN),

    (_S.PAUSED_FOR_PULL, _S.PULLING), (_S.PAUSED_FOR_PULL, _S.CONNECTING),
    (_S.PAUSED_FOR_PULL, _S.DISCONNECTED), (_S.PAUSED_FOR_PULL, _S.RECOVERING),
    (_S.PAUSED_FOR_PULL, _S.SHUTTING_DOWN),

    (_S.PULLING, _S.PAUSED_FOR_PULL), (_S.PULLING, _S.CONNECTING), (_S.PULLING, _S.DISCONNECTED),
    (_S.PULLING, _S.ERROR), (_S.PULLING, _S.RECOVERING), (_S.PULLING, _S.SHUTTING_DOWN),

    (_S.RECOVERING, _S.CONNECTING), (_S.RECOVERING, _S.DISCONNECTED), (_S.RECOVERING, _S.ERROR),
    (_S.RECOVERING, _S.PAUSED_FOR_PULL), (_S.RECOVERING, _S.SHUTTING_DOWN),

    (_S.ERROR, _S.RECOVERING), (_S.ERROR, _S.CONNECTING), (_S.ERROR, _S.DISCONNECTED),
    (_S.ERROR, _S.SHUTTING_DOWN),
})


class InvalidTransition(RuntimeError):
    """An illegal lifecycle edge. Not the FailureClass taxonomy — a programmer/plumbing error, raised so
    an impossible transition is loud, never a silently recorded fiction."""

    def __init__(self, frm: OxyState, to: OxyState):
        super().__init__(f"illegal OxyII lifecycle transition {frm.value} -> {to.value}")
        self.frm = frm
        self.to = to


@dataclass(frozen=True)
class Transition:
    """One immutable recorded transition — prev/new/reason, host monotonic AND wall (monotonic orders
    across a clock step, wall places it on the stratum-1 timeline), device + acquisition-run identity,
    and the FailureClass on an edge into ERROR/INTERRUPTED. `as_row` matches the writers.LinkLogWriter
    sidecar idiom the wiring writes to `OXYLIFE.csv`."""

    prev: OxyState
    new: OxyState
    reason: str
    host_monotonic: float
    host_wall: str
    device_id: str | None
    session_id: str | None
    failure: FailureClass | None = None

    def as_row(self) -> str:
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
class OxyLifecycle:
    """The live O2Ring lifecycle tracker. Current state + immutable history; every move validated against
    LEGAL_TRANSITIONS and stamped with injected clocks (deterministic tests, no hidden time dependency).
    `device_id` names the ring; `session_id` names the acquisition run — distinct concepts, both carried
    (charter R5)."""

    device_id: str | None = None
    session_id: str | None = None
    state: OxyState = OxyState.NOT_SEEN
    history: list = field(default_factory=list)
    mono: "callable" = _time.monotonic
    wall: "callable" = _default_wall

    def can(self, to: OxyState) -> bool:
        return (self.state, to) in LEGAL_TRANSITIONS

    def to(self, new: OxyState, reason: str, *, failure: FailureClass | None = None) -> Transition:
        """Transition to `new`, recording it. Raises InvalidTransition on an illegal edge — the move does
        NOT happen and NO partial record is appended. Returns the Transition for the caller to emit."""
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
        """A recoverable failure DURING LIVE is an INTERRUPTED (the ring stalled / the link dropped mid
        capture — reconnect), matching run_oxyii's stall-then-reconnect path; anything else is ERROR. The
        recovery path reads `failure.recoverable` off the returned record."""
        if self.state is OxyState.LIVE and failure.recoverable:
            return self.to(OxyState.INTERRUPTED, reason, failure=failure)
        return self.to(OxyState.ERROR, reason, failure=failure)

    def status_state(self) -> str:
        """The current state's label, for the STATUS dict webmon serves (the STATUS half of G4's
        'existing journal/STATUS surfaces')."""
        return self.state.value
