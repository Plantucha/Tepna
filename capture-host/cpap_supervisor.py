# tepna-capture — cpap_supervisor.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# AS11 CPAP session-detection supervisor — the HARDWARE-FREE decision core.
#
# Sits conceptually ABOVE LiveStreamController (charter §17): the supervisor owns the
# observe / start / stop / reconnect decisions; the controller keeps live-stream / drain /
# raw / EDF / finalize. This module is ONLY the decision core — it ingests timestamped
# Observations and emits Decisions (+ journalled transitions per §20). The BLE poll adapter
# feeds it; nothing here touches a radio, a clock, or the controller, so it is deterministic
# and unit-testable without hardware.
#
# READ-ONLY on the AS11: this core NEVER calls Set / EnterTherapy / EnterStandby. It only
# CLASSIFIES what the device reports. The ratified rulings it encodes:
#   • FGState is the PRIMARY explicit therapy-state read; start on Standby→Therapy with NO
#     start debounce (SmartStart is a clean edge).
#   • STOP is the device's OWN verdict: MachineMetrics.LastTherapyUseDateTime advancing past
#     the value captured at session start. That marker is monotonic and device-clock-relative,
#     so comparing it to its own baseline cancels the ~21-min device-clock offset — the Clock
#     Contract is untouched, and NO host-vs-device comparison happens here.
#   • Sustained-Standby hysteresis is the FALLBACK stop, used only when the verdict marker is
#     unavailable/unchanged — a brief mask-off SmartStop flicker must NOT close a session, so
#     Standby must persist ≥ stop_debounce_s before the fallback fires.
#   • MaskPressure is a physical CORROBORATOR, never the sole trigger.
#   • Device UNREACHABLE (BLE loss / unreadable Get) is NOT therapy-stopped: an ACTIVE session
#     is HELD across the outage. Absence of evidence never closes a session; only a positive
#     device verdict or sustained explicit Standby does.
#
# The device clock offset (~21 min) is a SEPARATE finding handled at the ingest boundary — the
# adapter supplies `last_therapy_use` as an already-parsed monotonic marker (Clock-Contract
# regex at the boundary, never new Date). This core only asks "did it advance?".

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

__all__ = [
    "TherapyState",
    "SessionState",
    "Observation",
    "Decision",
    "CPAPSessionSupervisor",
    "DEFAULT_STOP_DEBOUNCE_S",
    "MASK_THERAPY_MIN_CMH2O",
]

# Sustained-Standby fallback debounce. The charter's ~40 s is an INPUT to be tuned from real
# shadow data (§10), not a final value — it lives here as one named default, overridable per
# deployment. It matters ONLY for the fallback path; the device-verdict stop is immediate.
DEFAULT_STOP_DEBOUNCE_S = 40.0

# MaskPressure (cmH2O) above which the mask is corroborating active therapy. A corroborator
# only — it upgrades confidence, it never triggers a transition on its own.
MASK_THERAPY_MIN_CMH2O = 2.0


class TherapyState(str, Enum):
    """The device's own flow-generator operating-state enum (`FGState`)."""

    THERAPY = "Therapy"
    STANDBY = "Standby"


class SessionState(str, Enum):
    """The supervisor's committed acquisition-session state.

    Deliberately only two values. "Device state unknown" is NOT a third session state — an
    unreadable/unreachable observation HOLDS whichever of these we last committed (§12-15: a
    reconnect or a mask-off is not a new session, and an outage is not a stop).
    """

    IDLE = "idle"
    ACTIVE = "active"


@dataclass(frozen=True)
class Observation:
    """One timestamped read of the device, as the poll adapter (or in-stream evidence) sees it.

    The four device fields are independently optional so the core can reason under partial
    reads (a connect that succeeded but whose FGState item came back InvalidObject, say).
    `reachable` is the BLE/connection layer; `fg_state` is the therapy layer — kept distinct
    per the §12 session model.
    """

    host_ms: int
    reachable: bool
    fg_state: TherapyState | None = None
    # Monotonic device-verdict marker (adapter-parsed from LastTherapyUseDateTime). None = unread.
    last_therapy_use: int | None = None
    mask_pressure: float | None = None


@dataclass(frozen=True)
class Decision:
    """The classification of one Observation. `action` is what an ACTING supervisor WOULD do;
    in shadow mode nothing consumes it but the journal. `evidence` carries the driving values
    for the §20 per-transition record.

    Duck-types the house journal contract (`cpap_acq.Transition`): a `*LifeLogWriter` sidecar
    calls `.as_row()` to append one line, so a Decision can be written straight to a
    SESSIONDETECT.csv the same way an OxyLifecycle Transition writes OXYLIFE.csv."""

    host_ms: int
    prior_state: SessionState
    state: SessionState
    transition: str | None  # None | "start" | "stop"
    action: str | None  # None | "start_capture" | "stop_capture"
    trigger: str
    confidence: str
    evidence: dict = field(default_factory=dict)

    # Stable column order for the sidecar row. Blank (never a fabricated zero) for a None field,
    # matching cpap_acq.Transition.as_row so the two journals read the same way.
    ROW_FIELDS = (
        "host_ms",
        "prior_state",
        "state",
        "transition",
        "action",
        "trigger",
        "confidence",
        "reachable",
        "fg_state",
        "last_therapy_use",
        "mask_pressure",
        "baseline_use",
    )

    def as_row(self) -> str:
        ev = self.evidence
        cells = {
            "host_ms": self.host_ms,
            "prior_state": self.prior_state.value,
            "state": self.state.value,
            "transition": self.transition,
            "action": self.action,
            "trigger": self.trigger,
            "confidence": self.confidence,
            "reachable": ev.get("reachable"),
            "fg_state": ev.get("fg_state"),
            "last_therapy_use": ev.get("last_therapy_use"),
            "mask_pressure": ev.get("mask_pressure"),
            "baseline_use": ev.get("baseline_use"),
        }
        return ";".join("" if cells[f] is None else str(cells[f]) for f in self.ROW_FIELDS)


def _mask_active(mask_pressure: float | None, threshold: float) -> bool:
    """True only when a real pressure reading corroborates active therapy."""
    return mask_pressure is not None and mask_pressure >= threshold


class CPAPSessionSupervisor:
    """Pure state machine: feed it Observations in time order, read back Decisions.

    Not thread-safe and holds no I/O — one instance per logical device, driven from a single
    poll loop. `journal` (if given) receives every TRANSITION Decision; set `journal_every` to
    also receive the non-transition steady/held/pending Decisions (the shadow data-collector
    logs every would-have decision against real button usage to tune the debounce and validate
    the machine before anything acts).
    """

    def __init__(
        self,
        *,
        stop_debounce_s: float = DEFAULT_STOP_DEBOUNCE_S,
        mask_therapy_min: float = MASK_THERAPY_MIN_CMH2O,
        journal=None,
        journal_every: bool = False,
    ) -> None:
        self.stop_debounce_ms = stop_debounce_s * 1000.0
        self.mask_therapy_min = mask_therapy_min
        self._journal = journal
        self._journal_every = journal_every
        self._state = SessionState.IDLE
        # LastTherapyUseDateTime marker captured at session start; a strictly-greater later
        # value is the device's own "this session ended" verdict.
        self._baseline_use: int | None = None
        # Host-ms at which the current uninterrupted Standby run began (fallback-stop timer).
        self._standby_since_ms: int | None = None

    @property
    def state(self) -> SessionState:
        return self._state

    def _emit(self, decision: Decision) -> Decision:
        if self._journal is not None and (decision.transition is not None or self._journal_every):
            self._journal(decision)
        return decision

    def _decide(
        self,
        obs: Observation,
        *,
        prior: SessionState,
        transition: str | None,
        action: str | None,
        trigger: str,
        confidence: str,
    ) -> Decision:
        return Decision(
            host_ms=obs.host_ms,
            prior_state=prior,
            state=self._state,
            transition=transition,
            action=action,
            trigger=trigger,
            confidence=confidence,
            evidence={
                "reachable": obs.reachable,
                "fg_state": obs.fg_state.value if obs.fg_state is not None else None,
                "last_therapy_use": obs.last_therapy_use,
                "mask_pressure": obs.mask_pressure,
                "baseline_use": self._baseline_use,
                "standby_since_ms": self._standby_since_ms,
            },
        )

    def observe(self, obs: Observation) -> Decision:
        prior = self._state

        # (1) UNREACHABLE — hold, never conclude a stop from absence of evidence. Break any
        # in-progress Standby run: we can no longer vouch for its continuity.
        if not obs.reachable:
            self._standby_since_ms = None
            return self._emit(
                self._decide(
                    obs,
                    prior=prior,
                    transition=None,
                    action=None,
                    trigger="unreachable_hold",
                    confidence="held",
                )
            )

        # (2) IDLE — the only way out is a positive FGState==Therapy (clean SmartStart edge,
        # no start debounce). Standby / unreadable while idle stays idle.
        if self._state == SessionState.IDLE:
            if obs.fg_state == TherapyState.THERAPY:
                self._state = SessionState.ACTIVE
                self._baseline_use = obs.last_therapy_use
                self._standby_since_ms = None
                confidence = "confirmed" if _mask_active(obs.mask_pressure, self.mask_therapy_min) else "fgstate_only"
                return self._emit(
                    self._decide(
                        obs,
                        prior=prior,
                        transition="start",
                        action="start_capture",
                        trigger="fgstate_therapy",
                        confidence=confidence,
                    )
                )
            return self._emit(
                self._decide(
                    obs,
                    prior=prior,
                    transition=None,
                    action=None,
                    trigger="idle_steady",
                    confidence="fgstate_only" if obs.fg_state is not None else "held",
                )
            )

        # (3) ACTIVE — the device's own verdict outranks everything: LastTherapyUseDateTime
        # advancing past the session-start baseline means the device ended THIS session. Fires
        # even if FGState came back unreadable, and even during a Standby blip (a mask-off the
        # device committed to a full SmartStop IS a session end — we follow device semantics).
        if (
            self._baseline_use is not None
            and obs.last_therapy_use is not None
            and obs.last_therapy_use > self._baseline_use
        ):
            self._state = SessionState.IDLE
            self._baseline_use = None
            self._standby_since_ms = None
            return self._emit(
                self._decide(
                    obs,
                    prior=prior,
                    transition="stop",
                    action="stop_capture",
                    trigger="device_verdict",
                    confidence="confirmed",
                )
            )

        # FGState==Therapy → still running; clear any Standby-blip timer (mask-on recovery).
        if obs.fg_state == TherapyState.THERAPY:
            self._standby_since_ms = None
            return self._emit(
                self._decide(
                    obs,
                    prior=prior,
                    transition=None,
                    action=None,
                    trigger="active_steady",
                    confidence="confirmed" if _mask_active(obs.mask_pressure, self.mask_therapy_min) else "fgstate_only",
                )
            )

        # FGState==Standby → sustained-Standby FALLBACK stop (only reached when no verdict
        # advance was seen). A brief blip must not close the session, so require the Standby run
        # to persist ≥ stop_debounce before firing.
        if obs.fg_state == TherapyState.STANDBY:
            if self._standby_since_ms is None:
                self._standby_since_ms = obs.host_ms
                return self._emit(
                    self._decide(
                        obs,
                        prior=prior,
                        transition=None,
                        action=None,
                        trigger="standby_pending",
                        confidence="held",
                    )
                )
            if obs.host_ms - self._standby_since_ms >= self.stop_debounce_ms:
                self._state = SessionState.IDLE
                self._baseline_use = None
                self._standby_since_ms = None
                confidence = "corroborated" if not _mask_active(obs.mask_pressure, self.mask_therapy_min) else "conflicted"
                return self._emit(
                    self._decide(
                        obs,
                        prior=prior,
                        transition="stop",
                        action="stop_capture",
                        trigger="sustained_standby",
                        confidence=confidence,
                    )
                )
            return self._emit(
                self._decide(
                    obs,
                    prior=prior,
                    transition=None,
                    action=None,
                    trigger="standby_pending",
                    confidence="held",
                )
            )

        # Reachable but FGState unreadable while ACTIVE (connection OK, item InvalidObject) and
        # no verdict advance: hold the session, and drop any Standby run — we cannot confirm it.
        self._standby_since_ms = None
        return self._emit(
            self._decide(
                obs,
                prior=prior,
                transition=None,
                action=None,
                trigger="state_unreadable_hold",
                confidence="held",
            )
        )
