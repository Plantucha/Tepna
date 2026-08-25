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
    # a stored-session pull or an adapter recovery can be in progress before we ever connect
    (_S.NOT_SEEN, _S.PAUSED_FOR_PULL), (_S.NOT_SEEN, _S.RECOVERING),

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

    prev: "OxyState | OxyRecState"
    new: "OxyState | OxyRecState"
    reason: str
    host_monotonic: float
    host_wall: str
    device_id: str | None
    session_id: str | None
    failure: FailureClass | None = None
    # The AXIS column — appended last per the append-never-insert rule. Blank = the LINK axis (every
    # historical row); "rec" = the RECORDING axis (OXYII-PRESENCE-MODEL §3 / DAT-AUTO-HARVEST §3: two
    # INDEPENDENT dimensions, one journal, correlation in the reader). The two vocabularies are disjoint,
    # so even an axis-blind reader cannot confuse a rec row's states with link states.
    axis: str = ""

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
            self.axis,
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


# ── The RECORDING axis (OXYII-PRESENCE-MODEL §1-MEASURED / DAT-AUTO-HARVEST §3–§5, lead-ratified) ────
#
# The device's session state, INDEPENDENT of the link. The link axis above answers "what is our BLE
# relationship with the ring"; this axis answers "is the ring's internal recording session open" — and
# conflating them is the measured fleet trap (BLE loss reading as "recording ended"). Two tables, no
# cross-axis edge, correlation in the reader (owner spec §3: "the two dimensions must remain independent").
#
# The primary signal is MEASURED, not designed: `duration_s` (cmd-0x04 [0:4]) advances +1/s while the
# ring's session file is open and RESETS on close — 1,334,919 corpus frames, 40 doff→close events at a
# 7–12 s firmware debounce, and the counter's value at close equals the stored trailer's total_seconds
# exactly (18311 ≡ 18311, the pulled night of 2026-08-23). `contact` is a worn-vote and deliberately NOT
# a signal here (binary {0,1} on this firmware; 0x03 never observed).


class OxyRecState(Enum):
    """The owner spec's five states, no more. UNKNOWN is a first-class runtime state, not a boot
    placeholder — a lost link moves here, because an unobservable ring is not a not-recording ring."""

    UNKNOWN = "rec_unknown"                # no current observation (never seen, or the link is gone)
    NOT_RECORDING = "not_recording"        # duration_s observed 0 — the ring says no session is open
    RECORDING = "recording"                # duration_s observed ADVANCING — a session file is open
    END_CANDIDATE = "end_candidate"        # duration_s stepped BACKWARD — the ring closed that session
    END_CONFIRMED = "end_confirmed"        # the pulled .dat's trailer agreed with the observed duration


_R = OxyRecState

REC_LEGAL_TRANSITIONS = frozenset({
    (_R.UNKNOWN, _R.RECORDING), (_R.UNKNOWN, _R.NOT_RECORDING),
    (_R.NOT_RECORDING, _R.RECORDING), (_R.NOT_RECORDING, _R.UNKNOWN),
    (_R.RECORDING, _R.END_CANDIDATE), (_R.RECORDING, _R.UNKNOWN),
    # END_CANDIDATE → RECORDING: a new session began before the old one's pull confirmed — the ring is
    # re-donned. The candidate's confirmation debt lives in the inventory ledger, not in this axis.
    (_R.END_CANDIDATE, _R.END_CONFIRMED), (_R.END_CANDIDATE, _R.RECORDING), (_R.END_CANDIDATE, _R.UNKNOWN),
    (_R.END_CONFIRMED, _R.RECORDING), (_R.END_CONFIRMED, _R.NOT_RECORDING), (_R.END_CONFIRMED, _R.UNKNOWN),
})


@dataclass
class OxyRecEngine:
    """The recording-state engine: duration_s observations in, journal transitions out.

    Deterministic and pure — no clocks of its own (the Transition stamps come from the injected
    lifecycle-style clocks), no BLE, no protocol. `observe_duration` returns the 0, 1 or 2 transitions
    an observation caused (2 = a backward step straight into an already-advancing new session:
    RECORDING → END_CANDIDATE → RECORDING, one observation, two real events).

    Rules, each carrying its evidence:
      - UNKNOWN + duration 0            → NOT_RECORDING   (a direct device reading)
      - UNKNOWN + duration > 0          → hold; RECORDING only on a SECOND, strictly greater reading —
        a single positive value cannot distinguish an advancing counter from a stale one, and §5 forbids
        converting a non-observation into a conclusion.
      - NOT_RECORDING + duration > 0    → RECORDING       (the counter left 0: a session opened)
      - RECORDING + duration < prev     → END_CANDIDATE   (session_restarted's measured semantic: the
        counter is monotonic within a session, so ANY backward step is a close — quantization is ±1 s
        FORWARD jitter, never backward)
      - END_CANDIDATE + advancing       → RECORDING       (new session)
      - END_CONFIRMED + advancing       → RECORDING; + 0  → NOT_RECORDING
      - link lost (any state)           → UNKNOWN, prev forgotten — the next link starts from ignorance.
    `confirm_end` is fed by the PULL path when the trailer's total_seconds agrees with the duration this
    engine observed at close (the duration_check contract; agrees = |delta| ≤ 1 s, the counter's measured
    quantization) — the engine never confirms from its own evidence."""

    device_id: str | None = None
    session_id: str | None = None
    state: OxyRecState = OxyRecState.UNKNOWN
    prev_duration: int | None = None
    #: duration_s of the last observation BEFORE a backward step — what the closed session's counter
    #: read at close. The pull path compares the trailer against THIS (duration_check.observed_s).
    closed_at_duration: int | None = None
    history: list = field(default_factory=list)
    mono: "callable" = _time.monotonic
    wall: "callable" = _default_wall

    def _to(self, new: OxyRecState, reason: str) -> Transition:
        if (self.state, new) not in REC_LEGAL_TRANSITIONS:
            raise InvalidTransition(self.state, new)  # type: ignore[arg-type]
        t = Transition(
            prev=self.state, new=new, reason=reason,
            host_monotonic=self.mono(), host_wall=self.wall(),
            device_id=self.device_id, session_id=self.session_id, axis="rec",
        )
        self.state = new
        self.history.append(t)
        return t

    def observe_duration(self, duration) -> list:
        """Feed one live frame's duration_s. Returns the transitions it caused (possibly none)."""
        if duration is None or not isinstance(duration, int) or duration < 0:
            return []
        out: list[Transition] = []
        prev = self.prev_duration
        st = self.state
        if st is OxyRecState.UNKNOWN:
            if duration == 0:
                out.append(self._to(OxyRecState.NOT_RECORDING, "duration_s reads 0"))
            elif prev is not None and duration > prev:
                out.append(self._to(OxyRecState.RECORDING, f"duration_s advancing ({prev}→{duration})"))
        elif st is OxyRecState.NOT_RECORDING:
            if duration > 0:
                out.append(self._to(OxyRecState.RECORDING, f"duration_s left 0 (→{duration})"))
        elif st is OxyRecState.RECORDING:
            if prev is not None and duration < prev:
                self.closed_at_duration = prev
                out.append(self._to(OxyRecState.END_CANDIDATE,
                                    f"duration_s reset ({prev}→{duration}) — session closed at {prev}s"))
                if duration > 0:
                    out.append(self._to(OxyRecState.RECORDING,
                                        f"new session already advancing (→{duration})"))
        elif st is OxyRecState.END_CANDIDATE:
            if prev is not None and duration > prev:
                out.append(self._to(OxyRecState.RECORDING, f"duration_s advancing ({prev}→{duration})"))
        else:   # END_CONFIRMED — the only remaining state, and prev == 0 here BY CONSTRUCTION (the
                # candidate held at 0 until the pull confirmed), so under continuous observation any
                # positive counter is a NEW session opening; 0 is the ring still idle. A dead
                # `duration > prev` re-check would be an unreachable branch wearing a guard's clothes.
            if duration == 0:
                out.append(self._to(OxyRecState.NOT_RECORDING, "duration_s reads 0"))
            else:
                out.append(self._to(OxyRecState.RECORDING, f"duration_s reads {duration} — a new session is open"))
        self.prev_duration = duration
        return out

    def observe_link_lost(self, reason: str = "link lost — device unobservable") -> list:
        """The link dropped: the ring is UNOBSERVABLE, which is not the same fact as not-recording.
        prev_duration is forgotten — the next connection starts from ignorance, never from a stale
        counter (§5: device state not observed ≠ device not recording)."""
        self.prev_duration = None
        if self.state is OxyRecState.UNKNOWN:
            return []
        return [self._to(OxyRecState.UNKNOWN, reason)]

    def confirm_end(self, stored_s: int, *, tolerance_s: int = 1) -> list:
        """The pull path reports the trailer's total_seconds for the session this engine watched close.
        Confirms ONLY from END_CANDIDATE and only when |stored − observed| ≤ tolerance (the counter's
        ±1 s quantization, measured — o2ring-duration-is-quantized). A disagreement is the caller's
        first-class discrepancy to record; this engine does not fabricate agreement."""
        if self.state is not OxyRecState.END_CANDIDATE or self.closed_at_duration is None:
            return []
        if abs(stored_s - self.closed_at_duration) <= tolerance_s:
            return [self._to(OxyRecState.END_CONFIRMED,
                             f"trailer agrees: stored {stored_s}s vs observed {self.closed_at_duration}s")]
        return []
