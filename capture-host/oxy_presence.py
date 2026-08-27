# tepna-capture — oxy_presence.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# THE PRESENCE AXIS — the THIRD independent dimension (O2RING-AUTONOMOUS-HARVEST charter §3/§5),
# and the four things that charter asks for which did not exist: presence, the advertisement source,
# a connection budget (§11), and a connection-lifetime deadline (§12).
#
# 🔴 WHAT ALREADY EXISTS AND IS NOT REBUILT (§14/§36 — the smallest change set):
#   · the LINK axis        `oxy_lifecycle.OxyState` / `LEGAL_TRANSITIONS`
#   · the RECORDING axis   `oxy_lifecycle.OxyRecState` / `REC_LEGAL_TRANSITIONS`
#   · the flush gate       `oxy_transfer.flush_gate`  (§9 — run_status 3 → 1, deadline-first)
#   · the close decision   `oxy_transfer.close_harvest_decision` + `CLOSE_PULL_SCOPE = "latest"` (§10)
#   · the abort deadline   `oxy_transfer.pull_deadline` / `GUARD_BAND_S` (§12, reused VERBATIM below)
#   · the transaction      `oxy_inventory` DISCOVERED → COMMITTED, `identity()`, `reconcile()` (§14/§16)
# This module adds an axis and two bounds. It starts NO download and owns NO bytes: §14's rule is that
# presence is a NEW TRIGGER feeding the existing transactional harvest, never a second downloader.
#
# ⚠️ RULING — PRESENCE IS NEVER INFERRED FROM LINK VOCABULARY. `OxyState.NOT_SEEN` reads like absence
# and is not: it is a LINK state meaning "no connection has been attempted this run". A ring can be
# advertising healthily while the link axis says NOT_SEEN, and a ring can be gone while the link axis
# says CONNECTED (until the drop is noticed). Deriving one axis from the other is precisely the
# conflation §3 forbids, and the fleet trap the RECORDING axis was split out to escape — BLE loss
# reading as "recording ended".
#
# 🔴 STANDING RULING, FLEET-WIDE (elevated 2026-08-27): BLE DEVICE IDENTITY ON THIS HOST IS
# ADDRESS-ONLY — never local-name matching, on any device path, present or future. A BLE
# advertisement's local name is unauthenticated and attacker-controlled: any device in range may
# broadcast any name. Matching on it lets an arbitrary stranger's beacon summon a GATT connection
# from this host on demand, spending the §11 connection budget and contending for the ONE radio the
# wearables and the CPAP are already using. An address is spoofable too, but it is the identity the
# pairing was established against and the one every other Tepna path already keys on. See
# `is_expected_ring` for the enforcement.
#
# ⚠️ AND PRESENCE IS NOT PROOF OF A RECORDING (§5, last line). It answers "is the ring in radio range",
# nothing more. Only the RECORDING axis, fed by a probe, may say a session exists — which is why
# `probe_justified` below returns a decision to LOOK, never a decision to harvest.

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class OxyPresState(Enum):
    """Three states, and UNKNOWN is first-class — the same discipline `OxyRecState` uses.

    An un-run scanner and a scanner that has seen nothing are DIFFERENT facts: the first has made no
    observation, the second has made one and it was negative. Collapsing them would let a disabled
    scanner read as "the ring is not here", which is a fabricated observation (§2.6's honesty rule in
    the Clock Contract, applied to presence)."""

    UNKNOWN = "pres_unknown"    # no observation — the scanner is off, or has not yet run a full window
    ABSENT = "pres_absent"      # observed: no qualifying advertisement for at least the absence window
    PRESENT = "pres_present"    # observed: the expected ring advertised enough to clear the debounce


_P = OxyPresState

# Deliberately TOTAL — every ordered pair is legal, including the self-edges the other two axes reject.
# Presence is an OBSERVATION of the physical world (§5), not a protocol state machine: a ring may
# appear, vanish and reappear in any order, and an RF gap is indistinguishable from a walk out of
# range. The link and recording axes RAISE on an illegal move because their edges are read off real
# control flow; there is no control flow here to be violated, so a transition table would encode a
# belief about the world rather than a fact about the code.
PRES_LEGAL_TRANSITIONS = frozenset((a, b) for a in _P for b in _P)

# The axis tag written into the shared lifecycle journal. The `axis` column is append-only and the
# three vocabularies are disjoint by prefix (`pres_` here, `rec_` there, bare on the link axis), so an
# axis-blind reader still cannot confuse them — the property that made a third axis cheap.
AXIS = "pres"

# §5 debounce. Chosen for what each one PREVENTS, not tuned to data we do not have yet:
#   · one advertisement must not create a harvest ("avoid creating a harvest every time one
#     advertisement is received" — the charter names this failure directly), so PRESENT needs ≥ 2
#     sightings, which also rejects a single reflected/aliased frame.
#   · absence must tolerate RF gaps. The O2Ring advertises at ~1 Hz when idle; 90 s is ~90 missed
#     advertisements, far outside any burst of interference, and comfortably inside the not-worn
#     power-drop window so a departure is still noticed before the ring sleeps.
# ⚠️ Both are PROVISIONAL and are marked so: they cannot be validated until §2's coexistence matrix
# runs on the box (Thursday). They are refusal-shaped, not precision-shaped — widen rather than
# narrow if the matrix surprises us.
PRESENT_MIN_SIGHTINGS = 2
ABSENT_AFTER_S = 90.0


@dataclass(frozen=True)
class Presence:
    """An observation, with the reason it reached this verdict — never a bare boolean.

    The reason is carried rather than re-derived so the journal records the sentence the policy
    actually used, the same contract `oxy_transfer.Selection` keeps."""

    state: OxyPresState
    sightings: int
    last_seen: float | None
    reason: str


def is_expected_ring(addr: str | None, configured: str | None) -> bool:
    """§5 — "avoid treating arbitrary BLE devices as the ring". Address identity ONLY.

    🔴 NAME MATCHING IS DELIBERATELY NOT OFFERED, and this is a security property rather than a
    tidiness one. A BLE advertisement's local name is attacker-controlled and unauthenticated: any
    device in range may broadcast any name it likes. Matching on it would let an arbitrary nearby
    device summon a GATT connection from this host on demand — a connection that spends the §11
    budget and, worse, competes for the one radio the wearables and CPAP are using. An address can
    be spoofed too, but it is at least the identity the pairing was established against, and it is
    the identity every other Tepna path already keys on.

    Comparison is case-insensitive because BlueZ and bleak disagree on hex case across versions; it
    is NOT whitespace-tolerant beyond a strip, because a configured address with interior spaces is
    a typo that should fail loudly rather than match nothing silently."""
    if not addr or not configured:
        return False
    return addr.strip().upper() == configured.strip().upper()


def observe(prev: Presence | None, *, seen_at: float | None, now: float,
            min_sightings: int = PRESENT_MIN_SIGHTINGS,
            absent_after_s: float = ABSENT_AFTER_S) -> Presence:
    """Fold one scan tick into the presence observation. PURE.

    `seen_at` is the monotonic time of a QUALIFYING advertisement this tick (identity already checked
    by `is_expected_ring`), or None for a tick that saw nothing. `now` is the same monotonic clock —
    §23: every deadline here is a duration budget, and the Clock Contract's `tMs` is reserved for
    sample time, never for scheduling.

    The asymmetry is the design: PRESENT requires REPEATED evidence (debounce, §5), while ABSENT
    requires SUSTAINED silence (tolerate advertisement loss and RF gaps, §5). A symmetric rule would
    either flap on one stray frame or take minutes to notice a departure."""
    if seen_at is not None:
        n = (prev.sightings + 1) if prev is not None else 1
        if n >= min_sightings:
            return Presence(_P.PRESENT, n, seen_at, f"{n} sightings ≥ {min_sightings}")
        # Seen once. NOT yet PRESENT — and critically, not ABSENT either: we hold whatever we knew
        # before rather than inventing a negative observation from a positive one.
        keep = prev.state if prev is not None else _P.UNKNOWN
        return Presence(keep, n, seen_at, f"{n} sighting(s) < {min_sightings} — debouncing")
    if prev is None or prev.last_seen is None:
        # Nothing seen and nothing ever seen. This is NOT absence: with no prior sighting there is no
        # window to have elapsed, so the honest answer is that we do not know.
        return Presence(_P.UNKNOWN, 0, None, "no advertisement yet — no observation to report")
    quiet = now - prev.last_seen
    if quiet >= absent_after_s:
        return Presence(_P.ABSENT, 0, prev.last_seen, f"silent {quiet:.0f}s ≥ {absent_after_s:.0f}s")
    return Presence(prev.state, prev.sightings, prev.last_seen,
                    f"silent {quiet:.0f}s < {absent_after_s:.0f}s — tolerating the gap")


# ── §6 / §11 / §12 · THE CONNECTION BUDGET ───────────────────────────────────────────────────────────
# §11's cost model is explicit and inverts the usual one: "optimize NUMBER OF BLE CONNECTIONS rather
# than NUMBER OF BYTES". Connection acquisition is the expensive act, so the decision that matters is
# not "how much do we transfer" but "is opening a link justified at all, and having opened one, do we
# finish the job inside it".
#
# The forbidden shape is named in the charter and is what these functions exist to make impossible:
# connect → disconnect → reconnect → immediately perform the same operation.

CONNECT = "connect"           # open a link: a presence event justifies a look
SKIP = "skip"                 # do not open a link, and the reason says which rule declined


@dataclass(frozen=True)
class ProbePlan:
    """Whether to spend a connection, and by when it must be released."""

    action: str
    abort_at: float | None
    reason: str


def probe_justified(*, armed: bool, presence: Presence | None, rec_state: str | None,
                    last_probe_at: float | None, now: float,
                    min_probe_interval_s: float = 300.0) -> ProbePlan:
    """§6 — does this presence event justify opening a GATT connection? PURE, and it says NO by default.

    ORDER IS THE CONTRACT, cheapest and most fundamental refusal first, so the reason an operator
    reads is the one they should act on:

      1. NOT ARMED — §21's safe default. Nothing else is even evaluated; an unarmed system must not
         report "the ring is absent" as its reason for inaction, which would read as a device fault.
      2. NOT PRESENT — including UNKNOWN. ⚠️ UNKNOWN MUST NOT PROBE, and this is the sharp edge of
         §5's "presence is an OBSERVATION": UNKNOWN means we have not looked, and probing on it would
         make the scanner's own disabled state indistinguishable from a sighting. That is how a cold
         scanner turns into a connection storm.
      3. ALREADY RECORDING — §6/§11 say it outright: if the ring is still recording, disconnect and
         return to observation; do NOT repeatedly download while recording. A ring mid-session has
         nothing finalized to collect, so a probe would spend a link acquisition to learn what the
         recording axis already knows.
      4. TOO SOON — the rate limit. §5's debounce stops one advertisement becoming a harvest; this
         stops a ring that is legitimately present and legitimately advertising from becoming a probe
         every scan tick, which is the same failure one layer up.

    `min_probe_interval_s` defaults to 5 minutes: long enough that a night of presence costs a
    handful of connections rather than hundreds, short enough that the end of a recording is noticed
    well inside the not-worn drop window. Like the debounce constants it is PROVISIONAL until §2's
    matrix runs — and it is the one a reviewer should push back on first, because it trades
    end-detection latency against radio contention and we have measured neither yet."""
    if not armed:
        return ProbePlan(SKIP, None, "presence trigger not armed")
    if presence is None or presence.state is not _P.PRESENT:
        got = presence.state.value if presence is not None else "no observation"
        return ProbePlan(SKIP, None, f"not present ({got})")
    if rec_state == "recording":
        return ProbePlan(SKIP, None, "already recording — observe, do not probe (§6/§11)")
    if last_probe_at is not None and (now - last_probe_at) < min_probe_interval_s:
        wait = min_probe_interval_s - (now - last_probe_at)
        return ProbePlan(SKIP, None, f"probed {now - last_probe_at:.0f}s ago — {wait:.0f}s to go")
    return ProbePlan(CONNECT, None, "present, not recording, and the interval has elapsed")


# 🔴 `connection_plan` WAS HERE AND HAS BEEN DELETED — the unwired gate caught it, and it was right.
# It composed `pull_deadline` → `flush_gate` → act, which is EXACTLY what `oxy_transfer.
# close_harvest_decision` already composes. Three facts made deleting it the only defensible call:
#
#   1. It duplicated an existing composition. §36: "implement the smallest change set"; §14: reuse the
#      existing machinery. A second function computing the same order from the same two predicates is
#      a parallel layer, however carefully it is written.
#   2. It was UNWIRED — referenced only by its own tests. And it would have been the FOURTH unwired
#      decision function in this family: `close_harvest_decision`, `flush_gate`, `pull_deadline` and
#      `resume_target` are all deliberately landed ahead of "unit 2's async shell" that will drive
#      them. Adding a fifth does not advance that shell; it enlarges what the shell must reconcile.
#   3. Its one genuine difference was a CALLER policy, not a decision. It answered `flush_gate`'s WAIT
#      with "release the link and observe" (§12: lifetime is the resource, and a held link keeps the
#      ring awake) where `close_harvest_decision` returns WAIT. That is what a caller DOES with WAIT
#      — it belongs at the call site in unit 2's shell, not in a second copy of the decision.
#
# What the presence path therefore owes: when that shell lands, it consumes `close_harvest_decision`
# and interprets WAIT as release-and-observe. Recorded in the brief rather than left as dead code.

# ── §20 / §21 · ENABLED vs ARMED, AND THE SAFE DEFAULT ───────────────────────────────────────────────


@dataclass(frozen=True)
class Arming:
    """§20 — the two are DIFFERENT and conflating them is the failure this repo keeps paying for.

    `enabled` is what the operator asked for. `armed` is what the system can actually do. They come
    apart here for a reason that is not hypothetical: §2's hardware coexistence matrix has NOT RUN
    (the box is in DC until Thursday), so passive scanning is UNPROVEN against live CPAP/H10/Verity
    acquisition. §2's instruction is explicit — do not sacrifice an existing acquisition channel to
    make O2Ring harvesting more elegant — so the scanner SHIPS COLD: enabled may be true while armed
    is false, and the reason says which gate is holding it.

    That is also the honest reading of "done by morning": the code is complete and gated; the
    permission to transmit is owed to a measurement nobody can take tonight."""

    enabled: bool
    armed: bool
    reason: str


# The config key that carries §2's verdict. It is SEPARATE from `enabled` on purpose: an operator
# enabling the feature must not thereby assert a hardware measurement they did not run, and the two
# facts have different owners — the operator owns intent, the matrix owns permission.
COEXISTENCE_KEY = "scan_coexistence_verified"


def arming(cfg: dict) -> Arming:
    """Read `o2ring.presence_harvest` — default OFF, NEVER inherited (§21). PURE.

    Same discipline as `capture.autopull_arming` and the CPAP spool caller: an ABSENT key and an
    explicit `false` produce DIFFERENT sentences, because they are different operator situations and
    a message that conflates them sends someone to edit a key that already says what they wanted.

    🔴 It always returns a reason, armed or not. `autopull_arming` exists because a path had never
    armed and NOTHING SAID SO — 0 `armed` lines against 312 poller lines — and no gate can observe a
    line that was never printed."""
    pcfg = (cfg.get("o2ring", {}) or {}).get("presence_harvest", {}) or {}
    if not pcfg.get("enabled"):
        return Arming(False, False,
                      "o2ring.presence_harvest.enabled=False" if "enabled" in pcfg
                      else "o2ring.presence_harvest.enabled absent -> defaults OFF (never inherits)")
    if not pcfg.get(COEXISTENCE_KEY):
        return Arming(True, False,
                      f"enabled, but NOT armed: {COEXISTENCE_KEY} is unset — §2's passive-scan "
                      "coexistence matrix has not been run on this box, so scanning is unproven "
                      "against live CPAP/H10/Verity acquisition")
    return Arming(True, True, "armed: enabled and coexistence verified")
