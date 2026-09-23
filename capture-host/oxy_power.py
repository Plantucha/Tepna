# tepna-capture — oxy_power.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# THE POWER AXIS — radio on-time, ring battery and harvest reliability as ONE deterministic policy
# (O2RING-POWER-AWARE-BLE-LIFECYCLE-2026-09-05-BRIEF). Pure: no I/O, no bleak, no clock of its own.
#
# 🔴 WHAT ALREADY EXISTS AND IS NOT REBUILT (brief §1 — the gap analysis came first):
#   · the LINK axis          `oxy_lifecycle.OxyState`         (connect → live → pull, journaled)
#   · the RECORDING axis     `oxy_lifecycle.OxyRecEngine`
#   · the PRESENCE axis      `oxy_presence.observe` / `probe_justified` (UNKNOWN first-class, debounce)
#   · identity               `oxy_presence.is_expected_ring`  (ADDRESS-ONLY, standing ruling)
#   · the harvest            `pull_session` + `oxy_inventory` + `oxy_transfer` + `oxy_restart.plan`
#   · the restart-storm hold `capture.oxyii_restart_storm` / `oxyii_storm_hold_s`
#   · the failure taxonomy   `cpap_acq.FailureClass`
#   · the journal row        `oxy_lifecycle.Transition.as_row()` → `writers.OxyLifeLogWriter`
# This module adds the axis that none of those carry: WHO holds the radio and WHY, how long it has
# been on, when the next attempt is even permitted, and the counters that make a night's radio cost a
# number rather than an impression. It starts NO connection and moves NO bytes.
#
# ⚠️ THE ENGINE IS GUARDED IN THE DAEMON AND STRICT IN TESTS, like `capture._oxy_emit`. `to()` raises
# on an illegal edge so a test can pin the machine; the `note_*` methods the daemon calls SKIP an
# illegal edge and COUNT it (`illegal_skipped`) — a modelling gap must surface as telemetry, never as a
# dead capture loop. A skipped edge that stays at zero on real nights is the evidence the model is
# complete; one that climbs names the edge to add.
#
# ⚠️ A REFUSAL IS A VALUE, NOT AN EXCEPTION. `attempt_allowed` / `harvest_request` return a `Decision`
# carrying the reason, so the caller journals WHY nothing happened (§4/§12/§16: the states that matter
# most on a quiet night are the ones where the radio stayed off on purpose).
from __future__ import annotations

import time as _time
from dataclasses import dataclass
from enum import Enum

import oxy_lifecycle
from cpap_acq import FailureClass

AXIS = "power"   # the OXYLIFE.csv `axis` column value; blank = LINK, "rec" = RECORDING, "power" = this


# ── §2 the power states ───────────────────────────────────────────────────────────────────────────
class PowerState(Enum):
    RADIO_IDLE = "pw_radio_idle"                 # nothing owns the radio for this ring
    PASSIVE_SCAN = "pw_passive_scan"             # observing advertisements only
    DEVICE_DETECTED = "pw_device_detected"       # the ring is in range — presence ≠ ready (§4)
    HARVEST_CANDIDATE = "pw_harvest_candidate"   # a trigger has justified a link; not yet taken
    CONNECTING = "pw_connecting"
    CONNECTED_IDLE = "pw_connected_idle"         # link held, no frames / ring not worn
    ACTIVE_CAPTURE = "pw_active_capture"         # live worn PPG frames flowing — NEVER interrupted (§16)
    HARVESTING = "pw_harvesting"                 # stored-session pull owns the link
    DISCONNECTING = "pw_disconnecting"
    COOLDOWN = "pw_cooldown"                     # deliberate silence: strikes exhausted or storm hold
    RESOURCE_WAIT = "pw_resource_wait"           # the radio/slot belongs to someone else (§17)
    ERROR_BACKOFF = "pw_error_backoff"           # a failure-typed pause before the next attempt (§11)


# Every radio activation has an owner and a REASON (§2). `CPAP_CAPTURE` is in the vocabulary so a CPAP
# arbitration can speak it later; nothing in this module grants it — the CPAP family takes no
# ownership today (gap analysis §17), and inventing a grant here would be the parallel subsystem §1 forbids.
class RadioReason(Enum):
    SCAN_FOR_O2RING = "scan_for_o2ring"
    LIVE_O2RING_CAPTURE = "live_o2ring_capture"
    O2RING_HARVEST = "o2ring_harvest"
    CPAP_CAPTURE = "cpap_capture"
    RECOVERY = "recovery"


_S = PowerState
LEGAL_TRANSITIONS: frozenset[tuple[PowerState, PowerState]] = frozenset({
    # scanning
    (_S.RADIO_IDLE, _S.PASSIVE_SCAN), (_S.PASSIVE_SCAN, _S.RADIO_IDLE),
    (_S.PASSIVE_SCAN, _S.DEVICE_DETECTED), (_S.DEVICE_DETECTED, _S.PASSIVE_SCAN),
    (_S.DEVICE_DETECTED, _S.RADIO_IDLE), (_S.DEVICE_DETECTED, _S.HARVEST_CANDIDATE),
    (_S.HARVEST_CANDIDATE, _S.DEVICE_DETECTED), (_S.HARVEST_CANDIDATE, _S.PASSIVE_SCAN),
    (_S.HARVEST_CANDIDATE, _S.RADIO_IDLE),
    # taking the link — from idle/scan (live loop) or from a candidate (harvest)
    (_S.RADIO_IDLE, _S.CONNECTING), (_S.PASSIVE_SCAN, _S.CONNECTING), (_S.DEVICE_DETECTED, _S.CONNECTING),
    (_S.HARVEST_CANDIDATE, _S.CONNECTING), (_S.ERROR_BACKOFF, _S.CONNECTING),
    (_S.DISCONNECTING, _S.CONNECTING),
    (_S.CONNECTING, _S.CONNECTED_IDLE), (_S.CONNECTING, _S.HARVESTING),
    (_S.CONNECTING, _S.DISCONNECTING), (_S.CONNECTING, _S.ERROR_BACKOFF),
    # holding the link
    (_S.CONNECTED_IDLE, _S.ACTIVE_CAPTURE), (_S.ACTIVE_CAPTURE, _S.CONNECTED_IDLE),
    (_S.CONNECTED_IDLE, _S.HARVESTING), (_S.CONNECTED_IDLE, _S.DISCONNECTING),
    (_S.ACTIVE_CAPTURE, _S.DISCONNECTING), (_S.HARVESTING, _S.DISCONNECTING),
    # releasing it
    (_S.DISCONNECTING, _S.RADIO_IDLE), (_S.DISCONNECTING, _S.PASSIVE_SCAN),
    (_S.DISCONNECTING, _S.DEVICE_DETECTED), (_S.DISCONNECTING, _S.COOLDOWN),
    (_S.DISCONNECTING, _S.ERROR_BACKOFF), (_S.DISCONNECTING, _S.RESOURCE_WAIT),
    # waiting states — each may only leave through RADIO_IDLE (cooldown/backoff over) or a re-scan,
    # never straight into CONNECTING: that edge is the connect-fail loop §12 forbids.
    (_S.COOLDOWN, _S.RADIO_IDLE), (_S.COOLDOWN, _S.PASSIVE_SCAN),
    (_S.ERROR_BACKOFF, _S.RADIO_IDLE), (_S.ERROR_BACKOFF, _S.PASSIVE_SCAN), (_S.ERROR_BACKOFF, _S.COOLDOWN),
    (_S.RESOURCE_WAIT, _S.RADIO_IDLE), (_S.RESOURCE_WAIT, _S.PASSIVE_SCAN),
    (_S.RESOURCE_WAIT, _S.DEVICE_DETECTED), (_S.RESOURCE_WAIT, _S.HARVEST_CANDIDATE),
    # a cooldown / busy slot / backoff can be declared from any non-link state
    (_S.RADIO_IDLE, _S.COOLDOWN), (_S.PASSIVE_SCAN, _S.COOLDOWN), (_S.DEVICE_DETECTED, _S.COOLDOWN),
    (_S.HARVEST_CANDIDATE, _S.COOLDOWN),
    (_S.RADIO_IDLE, _S.RESOURCE_WAIT), (_S.PASSIVE_SCAN, _S.RESOURCE_WAIT),
    (_S.DEVICE_DETECTED, _S.RESOURCE_WAIT), (_S.HARVEST_CANDIDATE, _S.RESOURCE_WAIT),
    (_S.RADIO_IDLE, _S.ERROR_BACKOFF), (_S.PASSIVE_SCAN, _S.ERROR_BACKOFF),
    (_S.DEVICE_DETECTED, _S.ERROR_BACKOFF), (_S.HARVEST_CANDIDATE, _S.ERROR_BACKOFF),
})

# The states in which THIS ring's radio is on. Everything else is radio-off for this ring — the
# whole point of the axis is that this set is small and every second inside it has an owner.
RADIO_ON: frozenset[PowerState] = frozenset({
    _S.PASSIVE_SCAN, _S.CONNECTING, _S.CONNECTED_IDLE, _S.ACTIVE_CAPTURE, _S.HARVESTING, _S.DISCONNECTING,
})
# Link states: the ones a `harvest_request` must never preempt (§16) are a strict subset.
LINK_HELD: frozenset[PowerState] = frozenset({_S.CONNECTED_IDLE, _S.ACTIVE_CAPTURE, _S.HARVESTING})


class InvalidTransition(RuntimeError):
    def __init__(self, frm: PowerState, to: PowerState):
        self.frm, self.to = frm, to
        super().__init__(f"illegal power transition: {frm.value} -> {to.value}")


# ── §7 scan policy — named constants, chosen by state, never a magic number in a loop ─────────────
@dataclass(frozen=True)
class ScanPolicy:
    """`window_s` on, then `interval_s` off. `duty` is the fraction of wall time the receiver is on.
    `active=False` everywhere: an active scan sends a SCAN_REQ per advert and the sniffer measured
    ~60 % of air packets on the box to be SCAN_REQs (VIGIL-BLUETOOTH-ADAPTERS §F4) — the presence
    observer needs the ADV_IND only."""
    name: str
    window_s: float
    interval_s: float
    active: bool = False

    @property
    def duty(self) -> float:
        return self.window_s / (self.window_s + self.interval_s)


SCAN_LOW = ScanPolicy("low", window_s=10.0, interval_s=110.0)           # ring absent — 8 % duty
SCAN_MODERATE = ScanPolicy("moderate", window_s=10.0, interval_s=50.0)  # ring present, not ready — 17 %
SCAN_RESPONSIVE = ScanPolicy("responsive", window_s=10.0, interval_s=10.0)  # sync expected soon — 50 %
# ⚠️ `SCAN_RESPONSIVE` IS TODAY'S BEHAVIOUR: `_presence_scan_loop` runs a 10 s window then sleeps the
# same 10 s, unconditionally, i.e. 50 % duty with an ACTIVE scan (`BleakScanner.discover` default).
# The policy makes that the EXCEPTION rather than the constant.


def scan_policy_for(state: PowerState, *, sync_expected: bool = False) -> ScanPolicy:
    """Which cadence the presence observer should run at, from the ring's power state alone."""
    if state is _S.HARVEST_CANDIDATE or sync_expected:
        return SCAN_RESPONSIVE
    if state is _S.DEVICE_DETECTED:
        return SCAN_MODERATE
    return SCAN_LOW


# ── §9 timeouts — one name per phase, mapped onto the constants the paths already use ────────────
@dataclass(frozen=True)
class Timeouts:
    """Seven distinct bounds, seven distinct failures. The VALUES are the ones already in force on the
    box (gap analysis §9) — this dataclass names them; it does not retune them:
      discovery   `pull_session._pull_once` find_device_by_filter(timeout=25)
      connect     bleak's `BleakClient(timeout=30)` default, now passed EXPLICITLY (it was implicit)
      auth        `capture._BLE_SETUP_TIMEOUT_S` (10) — the 0xFF/0x10 writes
      service_discovery  same bound as auth today (bleak resolves services inside connect)
      inventory   `pull_session._wait` (20) — the F1 file-list reply
      transfer_chunk     the per-chunk 0xF2/0xF3 wait (20)
      disconnect  `capture._BLE_DISCONNECT_TIMEOUT_S` (10)"""
    discovery_s: float = 25.0
    connect_s: float = 30.0
    auth_s: float = 10.0
    service_discovery_s: float = 10.0
    inventory_s: float = 20.0
    transfer_chunk_s: float = 20.0
    disconnect_s: float = 10.0


TIMEOUTS = Timeouts()


# ── §18 battery — bands from the ADVERTISED/reported percentage, never a reason to connect ────────
class BatteryBand(Enum):
    NORMAL = "normal"
    LOW = "low"
    CRITICAL = "critical"
    UNKNOWN = "unknown"


BATTERY_LOW_PCT = 20
BATTERY_CRITICAL_PCT = 10


def battery_band(pct) -> BatteryBand:
    """UNKNOWN for None, non-numeric and out-of-range — an unreadable battery is not a full one."""
    if isinstance(pct, bool) or not isinstance(pct, (int, float)) or not (0 <= pct <= 100):
        return BatteryBand.UNKNOWN
    if pct <= BATTERY_CRITICAL_PCT:
        return BatteryBand.CRITICAL
    if pct <= BATTERY_LOW_PCT:
        return BatteryBand.LOW
    return BatteryBand.NORMAL


# ── §10–§12 attempts, strikes, failure-typed backoff ─────────────────────────────────────────────
MAX_ATTEMPTS = 3                       # three strikes per opportunity, then COOLDOWN
STRIKE_COOLDOWN_S = 1800.0             # after the third strike: half an hour of deliberate silence
# §11 — the pause AFTER a failure depends on WHAT failed. A missing ring is not coming back in 30 s; an
# auth refusal will not be fixed by trying harder; a transport hiccup usually will.
BACKOFF_S: dict[FailureClass, float] = {
    FailureClass.TRANSPORT_FAILURE: 60.0,
    FailureClass.TIMEOUT: 120.0,
    FailureClass.DEVICE_UNAVAILABLE: 300.0,
    FailureClass.STREAM_STALL: 60.0,
    FailureClass.TRUNCATED_TRANSFER: 60.0,
    FailureClass.FRAME_CORRUPTION: 120.0,
    FailureClass.RECOVERABLE_ERROR: 120.0,
    FailureClass.AUTHENTICATION_FAILURE: 1800.0,
    FailureClass.PROTOCOL_FAILURE: 3600.0,
    FailureClass.STORAGE_FAILURE: 600.0,
    FailureClass.VALIDATION_FAILURE: 600.0,
    FailureClass.FATAL_ERROR: 3600.0,
}
_DEFAULT_BACKOFF_S = 120.0


def backoff_for(failure: FailureClass | None, strikes: int) -> float:
    """Seconds to wait after the `strikes`-th consecutive failure of class `failure`. Doubles per strike
    (strike 1 → ×1, strike 2 → ×2) and is capped at the strike cooldown, so no class can out-wait it."""
    base = BACKOFF_S.get(failure, _DEFAULT_BACKOFF_S) if failure is not None else _DEFAULT_BACKOFF_S
    return min(base * (2 ** max(0, strikes - 1)), STRIKE_COOLDOWN_S)


def classify_exception(exc: BaseException) -> FailureClass:
    """Map a harvest/connect exception onto the shared taxonomy WITHOUT importing bleak (this module
    is pure). Type NAMES are matched because bleak's exception classes are the only vocabulary the
    pull path raises; a refusal text is matched the way `capture.transient_ble_error` does it."""
    name = type(exc).__name__
    text = repr(exc).lower()
    if isinstance(exc, TimeoutError) or name in ("TimeoutError", "CancelledError"):
        return FailureClass.TIMEOUT
    if name == "BleakDeviceNotFoundError" or "not found" in text or "not advertising" in text:
        return FailureClass.DEVICE_UNAVAILABLE
    if "not_implemented" in text or "error 201" in text or "notpermitted" in text:
        return FailureClass.PROTOCOL_FAILURE
    if "auth" in text:
        return FailureClass.AUTHENTICATION_FAILURE
    if isinstance(exc, OSError) or "bleak" in name.lower() or "dbus" in text:
        return FailureClass.TRANSPORT_FAILURE
    return FailureClass.RECOVERABLE_ERROR


ALLOW = "allow"
DEFER = "defer"


@dataclass(frozen=True)
class Decision:
    action: str          # ALLOW | DEFER
    reason: str

    @property
    def allowed(self) -> bool:
        return self.action == ALLOW


@dataclass(frozen=True)
class RadioOwner:
    """§17 — who holds this ring's radio, why, since when, and (if bounded) until when."""
    owner: str
    reason: RadioReason
    since: float
    until: float | None = None


@dataclass(frozen=True)
class Attempt:
    """§10 — one connection attempt, recorded whether it succeeded or not."""
    started: float
    ended: float | None
    trigger: str
    ok: bool | None
    failure: FailureClass | None
    files: int = 0
    bytes: int = 0

    @property
    def duration_s(self) -> float | None:
        return None if self.ended is None else self.ended - self.started


# ── §21 counters ─────────────────────────────────────────────────────────────────────────────────
@dataclass
class Counters:
    scan_windows: int = 0
    scan_seconds: float = 0.0
    # `sightings`, NOT `adverts`: the scanner API hands back one discovered device per window, not a
    # packet count. Naming it adverts would claim a resolution the instrument does not have.
    sightings: int = 0
    transitions: int = 0
    illegal_skipped: int = 0
    connect_attempts: int = 0
    connect_successes: int = 0
    connect_failures: int = 0
    connection_seconds: float = 0.0
    harvest_attempts: int = 0
    harvests_ok: int = 0
    harvest_seconds: float = 0.0
    files: int = 0
    bytes: int = 0
    retries: int = 0
    cooldowns: int = 0
    deferrals_live: int = 0        # §16 — a harvest deferred because live worn capture was running
    deferrals_busy: int = 0        # §17 — the offline slot/radio belonged to someone else
    deferrals_policy: int = 0      # §12 — inside a cooldown / strikes exhausted

    def as_dict(self) -> dict:
        d = dict(self.__dict__)
        d["harvest_avg_s"] = (self.harvest_seconds / self.harvests_ok) if self.harvests_ok else None
        return d


# ── §5 the per-ring cache ─────────────────────────────────────────────────────────────────────────
@dataclass
class RingCache:
    address: str
    first_seen: float | None = None
    last_seen: float | None = None
    last_state_change: float | None = None
    # bumps on every ABSENT→PRESENT edge: "the same ring, a new appearance" — the opportunity id §12 needs
    generation: int = 0
    last_rec_state: str | None = None
    last_worn: bool | None = None
    last_safe_sync_at: float | None = None
    last_success_at: float | None = None
    last_failure_at: float | None = None
    last_failure: FailureClass | None = None
    retry_count: int = 0
    cooldown_until: float | None = None
    cooldown_reason: str | None = None
    backoff_until: float | None = None    # §11 — the failure-typed pause between strikes
    synced_this_idle: bool = False
    battery: BatteryBand = BatteryBand.UNKNOWN
    owner: RadioOwner | None = None
    # §19 — the re-arm chain WORN → RECORDING → REMOVED. `synced_this_idle` clears ONLY when the chain
    # completes; a flicker of the worn bit, or a docked ring, re-arms nothing.
    rearm_stage: str = "idle"

    def as_dict(self) -> dict:
        d = dict(self.__dict__)
        d["battery"] = self.battery.value
        d["last_failure"] = self.last_failure.label if self.last_failure else None
        o = self.owner
        d["owner"] = None if o is None else {"owner": o.owner, "reason": o.reason.value,
                                             "since": o.since, "until": o.until}
        return d


def _default_wall() -> str:
    return oxy_lifecycle._default_wall()


class RingPower:
    """One ring's power axis: state, cache, counters and the journal rows it has not yet flushed.

    The daemon holds one per configured ring and calls the `note_*` / `attempt_*` methods from the
    sites that already exist (presence loop, `_oxy_emit`, `pull_oxyii_session`, the storm hold).
    Nothing here awaits, sleeps or opens a socket."""

    def __init__(self, address: str, *, device_id: str | None = None, session_id: str | None = None,
                 mono=_time.monotonic, wall=_default_wall):
        self.state = _S.RADIO_IDLE
        self.cache = RingCache(address=address)
        self.counters = Counters()
        self.attempts: list[Attempt] = []
        self.device_id = device_id
        self.session_id = session_id
        self._mono = mono
        self._wall = wall
        self._pending: list = []            # journal rows awaiting a writer (drain())
        self._link_since: float | None = None
        self._open_attempt: Attempt | None = None

    # ── the machine ─────────────────────────────────────────────────────────────────────────────
    def can(self, new: PowerState) -> bool:
        return (self.state, new) in LEGAL_TRANSITIONS

    def to(self, new: PowerState, reason: str, *, failure: FailureClass | None = None):
        """STRICT: raises on an illegal edge. Tests pin the machine through this."""
        if not self.can(new):
            raise InvalidTransition(self.state, new)
        now = self._mono()
        t = oxy_lifecycle.Transition(prev=self.state, new=new, reason=reason, host_monotonic=now,
                                     host_wall=self._wall(), device_id=self.device_id,
                                     session_id=self.session_id, failure=failure, axis=AXIS)
        self.state = new
        self.cache.last_state_change = now
        self.counters.transitions += 1
        self._pending.append(t)
        return t

    def _try(self, new: PowerState, reason: str, *, failure: FailureClass | None = None) -> bool:
        """GUARDED: the daemon's form. A self-edge is a no-op (idempotence, like `_oxy_emit`); any
        other illegal edge is skipped AND counted."""
        if new is self.state:
            return False
        if not self.can(new):
            self.counters.illegal_skipped += 1
            return False
        self.to(new, reason, failure=failure)
        return True

    def drain(self) -> list:
        """Journal rows recorded since the last drain, oldest first. The caller writes them; a row is
        never lost for want of a writer at the moment it was produced."""
        out, self._pending = self._pending, []
        return out

    # ── §17 ownership ──────────────────────────────────────────────────────────────────────────
    def take(self, owner: str, reason: RadioReason, *, until: float | None = None) -> RadioOwner:
        o = RadioOwner(owner=owner, reason=reason, since=self._mono(), until=until)
        self.cache.owner = o
        return o

    def release(self) -> None:
        self.cache.owner = None

    # ── §3/§4/§6 presence → power (transitions, not raw adverts) ───────────────────────────────
    def note_scan_window(self, window_s: float, *, sightings: int) -> None:
        self.counters.scan_windows += 1
        self.counters.scan_seconds += max(0.0, float(window_s))
        self.counters.sightings += max(0, int(sightings))
        if self.state is _S.RADIO_IDLE:
            self._try(_S.PASSIVE_SCAN, "presence observer window")

    def note_presence(self, pres_state: str, now: float) -> None:
        """`pres_state` is `oxy_presence.OxyPresState.value` — the presence axis is consumed, never
        re-derived here. PRESENT → DEVICE_DETECTED (a new appearance bumps `generation`);
        ABSENT → back to PASSIVE_SCAN; UNKNOWN changes NOTHING (a blind scanner is not an absence)."""
        c = self.cache
        if pres_state == "pres_present":
            if c.first_seen is None:
                c.first_seen = now
            if self.state in (_S.RADIO_IDLE, _S.PASSIVE_SCAN, _S.RESOURCE_WAIT, _S.DISCONNECTING):
                # a NEW appearance: the ring was not being tracked as detected. Inside a link, a
                # backoff or a cooldown the sighting is just `last_seen` — no generation, no reset.
                c.generation += 1
                c.retry_count = 0           # a fresh appearance is a fresh opportunity (§12)
                if self.state is _S.RADIO_IDLE:
                    self._try(_S.PASSIVE_SCAN, "presence observer window")
                self._try(_S.DEVICE_DETECTED, f"ring present (generation {c.generation})")
            c.last_seen = now
        elif pres_state == "pres_absent":
            if self.state in (_S.DEVICE_DETECTED, _S.HARVEST_CANDIDATE):
                self._try(_S.PASSIVE_SCAN, "ring absent")

    def note_battery(self, pct) -> BatteryBand:
        self.cache.battery = battery_band(pct)
        return self.cache.battery

    # ── §19 the re-arm chain ───────────────────────────────────────────────────────────────────
    def note_worn_rec(self, worn: bool | None, rec_state: str | None) -> bool:
        """Advance WORN → RECORDING → REMOVED from the two axes the ring already publishes. Returns
        True on the one event that re-arms (`synced_this_idle` → False): REMOVED after RECORDING after
        WORN. A `None` is UNKNOWN and moves nothing; a bare worn flicker never completes the chain."""
        c = self.cache
        c.last_worn, c.last_rec_state = worn, rec_state
        if worn is True:
            if c.rearm_stage == "idle":
                c.rearm_stage = "worn"
            if c.rearm_stage == "worn" and rec_state == "recording":
                c.rearm_stage = "recording"
            return False
        if worn is False:
            done = c.rearm_stage == "recording"
            c.rearm_stage = "idle"          # removed: the chain either completed or is broken
            if done:
                c.synced_this_idle = False
                c.last_safe_sync_at = self._mono()
            return done
        return False

    # ── §16 the one hard rule ──────────────────────────────────────────────────────────────────
    def harvest_request(self, *, link_state: str | None, worn: bool | None,
                        strict_idle: bool = True) -> Decision:
        """May a stored-session harvest take the link NOW? DEFER while live worn capture is running —
        `link_state` is `OxyState.value` as published (`oxy_lifecycle`), `worn` the ring's own vote.
        Either being 'live'/True is enough: a live link is raw PPG, and raw data outranks a backup (§25).
        UNKNOWN (`None`, `None`) is ALLOWED — refusing to harvest on an unknown loses the only backup for a
        lossy night (the same asymmetry `autopull_poller`'s `on_body(st) is True` encodes).
        `strict_idle=False` skips the §19 synced-idle veto: the hourly reconciliation net passes it,
        because that net exists for exactly the night whose WORN→RECORDING→REMOVED chain was never
        observable (no link all night ⇒ `worn` never True ⇒ the chain cannot complete) — refusing there
        would trade the only backup of a lossy night for one connect an hour (§25: raw data > battery).
        The event triggers (charger · doff · presence) stay strict."""
        if link_state == "live" or (worn is True and link_state == "connected"):
            self.counters.deferrals_live += 1
            return Decision(DEFER, "LIVE CAPTURE ACTIVE → HARVEST DEFERRED")
        if strict_idle and self.cache.synced_this_idle:
            self.counters.deferrals_policy += 1
            return Decision(DEFER, "already synced this idle period (§19) — re-arms on WORN→RECORDING→REMOVED")
        return Decision(ALLOW, "no live capture to interrupt")

    # ── §10–§12 attempts ───────────────────────────────────────────────────────────────────────
    def attempt_allowed(self, now: float) -> Decision:
        """§12 — no attempt while a cooldown is running; strikes reset once it has expired. The
        'new opportunity' half of the invariant is the caller's per-trigger latch (charger / doff /
        presence `_*_PULLED`) plus `generation`; this is the half that latch cannot see."""
        c = self.cache
        if c.cooldown_until is not None:
            if now < c.cooldown_until:
                self.counters.deferrals_policy += 1
                return Decision(DEFER, f"cooldown ({c.cooldown_reason}) until +{c.cooldown_until - now:.0f}s")
            self.cooldown_over()
        if c.backoff_until is not None:
            if now < c.backoff_until:
                self.counters.deferrals_policy += 1
                return Decision(DEFER, f"backoff after strike {c.retry_count} until +{c.backoff_until - now:.0f}s")
            c.backoff_until = None          # strikes are KEPT — the backoff is a pause, not a pardon
            self.note_backoff_over()
        if c.retry_count >= MAX_ATTEMPTS:   # pragma: no cover — the third strike always sets a cooldown
            self.counters.deferrals_policy += 1
            return Decision(DEFER, "strikes exhausted")
        return Decision(ALLOW, f"attempt {c.retry_count + 1} of {MAX_ATTEMPTS}")

    def attempt_started(self, trigger: str, now: float, *, owner: str = "pull_oxyii_session") -> Attempt:
        a = Attempt(started=now, ended=None, trigger=trigger, ok=None, failure=None)
        self._open_attempt = a
        self.counters.harvest_attempts += 1
        if self.cache.retry_count:
            self.counters.retries += 1
        self.take(owner, RadioReason.O2RING_HARVEST)
        if self.can(_S.HARVEST_CANDIDATE):
            self._try(_S.HARVEST_CANDIDATE, f"harvest trigger: {trigger}")
        self._try(_S.CONNECTING, f"harvest connect ({trigger})")
        return a

    def attempt_finished(self, now: float, *, ok: bool, failure: FailureClass | None = None,
                         files: int = 0, bytes: int = 0) -> Attempt:
        """Close the open attempt. Success → synced_this_idle, strikes reset, RADIO_IDLE. Failure →
        strike, failure-typed ERROR_BACKOFF, and on the third strike a COOLDOWN (§10/§11/§12)."""
        c = self.cache
        prev = self._open_attempt or Attempt(started=now, ended=None, trigger="?", ok=None, failure=None)
        a = Attempt(started=prev.started, ended=now, trigger=prev.trigger, ok=ok, failure=failure,
                    files=files, bytes=bytes)
        self.attempts.append(a)
        self._open_attempt = None
        self.release()
        if self.state is _S.CONNECTING:
            self._try(_S.HARVESTING, "link taken")
        self._try(_S.DISCONNECTING, "harvest finished" if ok else "harvest failed", failure=failure)
        if ok:
            c.last_success_at, c.retry_count, c.synced_this_idle = now, 0, True
            c.rearm_stage = "idle"
            self.counters.harvests_ok += 1
            self.counters.harvest_seconds += a.duration_s or 0.0
            self.counters.files += files
            self.counters.bytes += bytes
            self._try(_S.RADIO_IDLE, "harvest committed — radio released")
            return a
        c.last_failure_at, c.last_failure = now, failure
        c.retry_count += 1
        if c.retry_count >= MAX_ATTEMPTS:
            self._cooldown(now + STRIKE_COOLDOWN_S, f"{MAX_ATTEMPTS} strikes ({failure.label if failure else 'unknown'})",
                           failure=failure)
        else:
            pause = backoff_for(failure, c.retry_count)
            c.backoff_until = now + pause
            self._try(_S.ERROR_BACKOFF, f"strike {c.retry_count}: {failure.label if failure else 'unknown'} "
                                        f"— back off {pause:.0f}s", failure=failure)
        return a

    def _cooldown(self, until: float, reason: str, *, failure: FailureClass | None = None) -> None:
        self.cache.cooldown_until, self.cache.cooldown_reason = until, reason
        self.counters.cooldowns += 1
        self._try(_S.COOLDOWN, reason, failure=failure)

    def note_cooldown(self, until: float, reason: str) -> bool:
        """An externally declared hold (the restart-storm hold). Idempotent on `until`, so the live
        loop re-entering the hold branch every iteration counts ONE cooldown, not one per second."""
        if self.cache.cooldown_until == until:
            return False
        self._cooldown(until, reason)
        return True

    def note_busy(self, now: float, holder: str) -> None:
        """§17 — the slot/radio belongs to someone else. Counted; RESOURCE_WAIT if reachable."""
        self.counters.deferrals_busy += 1
        self._try(_S.RESOURCE_WAIT, f"radio held by {holder}")
        self.cache.last_failure_at = now

    def cooldown_over(self) -> None:
        """The hold has expired (the live loop's "restart-storm hold over", or `attempt_allowed` finding
        the deadline passed). Strikes reset: a cooldown IS the pardon a backoff is not."""
        c = self.cache
        c.cooldown_until, c.cooldown_reason, c.retry_count = None, None, 0
        self._try(_S.RADIO_IDLE, "cooldown over")

    def note_backoff_over(self) -> None:
        self._try(_S.RADIO_IDLE, "backoff over")

    # ── the LINK axis drives the live half ─────────────────────────────────────────────────────
    def note_link(self, link_state: "oxy_lifecycle.OxyState", reason: str, now: float, *,
                  failure: FailureClass | None = None) -> None:
        """Fold a LINK-axis transition into the power axis. Called from `capture._oxy_emit`, so the live
        loop needs no second set of emit sites. Counts connect attempts/successes/failures and the
        seconds the link was held; the PULL side is driven by `attempt_*`, so PAUSED_FOR_PULL and
        PULLING are ignored here — they are the harvest's business."""
        L = oxy_lifecycle.OxyState
        if link_state is L.CONNECTING:
            self.counters.connect_attempts += 1
            self.take("run_oxyii", RadioReason.LIVE_O2RING_CAPTURE)
            self._try(_S.CONNECTING, reason)
        elif link_state is L.CONNECTED:
            self.counters.connect_successes += 1
            self._link_since = now
            self._try(_S.CONNECTED_IDLE, reason)
        elif link_state is L.LIVE:
            self._try(_S.ACTIVE_CAPTURE, reason)
        elif link_state is L.IDLE_UNWORN:
            self._try(_S.CONNECTED_IDLE, reason)
        elif link_state in (L.INTERRUPTED, L.DISCONNECTED, L.ERROR):
            if self.state is _S.CONNECTING:
                self.counters.connect_failures += 1
            if self._link_since is not None:
                self.counters.connection_seconds += max(0.0, now - self._link_since)
                self._link_since = None
            if self.state in RADIO_ON:
                self._try(_S.DISCONNECTING, reason, failure=failure)
            self.release()
        elif link_state is L.RECOVERING:
            self.take("adapter_watchdog", RadioReason.RECOVERY)
            self._try(_S.ERROR_BACKOFF, reason, failure=failure)
        elif link_state is L.SHUTTING_DOWN:
            self.release()
            if self._link_since is not None:
                self.counters.connection_seconds += max(0.0, now - self._link_since)
                self._link_since = None
            if self.state in RADIO_ON and self.state is not _S.DISCONNECTING:
                self._try(_S.DISCONNECTING, reason)
            self._try(_S.RADIO_IDLE, reason)

    # ── the projection webmon forwards ─────────────────────────────────────────────────────────
    def snapshot(self) -> dict:
        return {
            "state": self.state.value,
            "radio_on": self.state in RADIO_ON,
            "scan_policy": scan_policy_for(self.state).name,
            "cache": self.cache.as_dict(),
            "counters": self.counters.as_dict(),
            "last_attempt": None if not self.attempts else {
                "trigger": self.attempts[-1].trigger, "ok": self.attempts[-1].ok,
                "failure": self.attempts[-1].failure.label if self.attempts[-1].failure else None,
                "duration_s": self.attempts[-1].duration_s, "files": self.attempts[-1].files,
                "bytes": self.attempts[-1].bytes,
            },
        }
