# tepna-capture — as11_link_guard.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# ONE AS11, ONE LINK, FOUR ACTORS — serialized here and nowhere else.
#
# 🔴 THE HAZARD, AND WHY A PREDICATE CANNOT FIX IT. Four code paths open the AirSense's single BLE
# link: the 33 s shadow poll, the daily spool pull, the live-stream controller, and first-time pairing.
# `cpap_spool_caller.pull_blocked` already names "the AS11's single socket" — but it is a PREDICATE
# evaluated ONCE per minute BEFORE the pull starts, the pull then runs for minutes, and the shadow keeps
# polling every 33 s throughout. A check at the start cannot serialize an overlap that begins afterwards;
# only a claim HELD for the session's duration can.
#
# The hazard is concrete in our own protocol code, not hypothetical: `as11_pull.establish` uses STATIC
# rpc ids (`req_id=10, chk_id=11`) and `_await_result` matches frames BY ID, skipping everything else —
# so two concurrent handshakes on one link can each consume the OTHER's `{challenge, nonce}` and then
# compute `HMAC(K, wrong_challenge)`.
#
# 🔴 WHY THE AS11 IS THE EXCEPTION TO THE HOUSE RULE, because there IS one and it must be addressed.
# CAPTURE-HOST-RESOURCE-ORCHESTRATION-AUDIT-2026-09-05 §1 says, correctly: *"One task per device link ⇒
# per-device BLE command serialisation is STRUCTURAL, not a lock. A runner never issues two GATT commands
# concurrently because it is one coroutine."* That holds for every wearable — and the AS11 is the one
# device with FOUR actors instead of one runner: two independently supervised tasks (shadow, spool), a
# controller, and an HTTP pairing handler. The structural guarantee the audit relies on simply does not
# exist here, which is why this is a lock and not a redundant one.
#
# MIRRORS `offline_lock` DELIBERATELY — same shape, same reasoning, different resource:
#   * FAIL FAST, NEVER QUEUE. `offline_lock`'s header gives the reason and it applies here: a queued
#     caller "would sit there while the browser spins, and by the time it ran the user's intent (and the
#     device's state) may have moved on". For us it also removes the worst failure this module could
#     introduce — an unbounded wait turns one leaked release into a permanently dead CPAP, which is
#     strictly worse than the overlap being prevented. Nobody waits, so nobody can deadlock.
#   * RACE-FREE WITHOUT A LOCK. asyncio is single-threaded and there is no `await` between the check and
#     the set, so two coroutines cannot both observe a free slot. No `asyncio.Lock`, hence no lock bound
#     to the wrong event loop at import time.
#   * `LinkBusy` NAMES THE HOLDER, so the refusal is actionable and the journal says WHY a cycle is
#     missing rather than leaving a silent gap — absence-as-value applied to a deferral.
#
# DEVICE-SCOPED, NOT ADAPTER-SCOPED, and that is load-bearing: the shadow connects through
# `_cpap_connect_any_adapter` (with failover) while the spool uses a fixed `hci`, so the two can sit on
# DIFFERENT radios and BlueZ will not serialize them for us. The claim lives in our process, where the
# constraint actually is. One AS11 per box is assumed; `hold` takes the holder name so a per-address
# variant stays a local change.
#
# ⚠️ WHAT THIS DOES NOT ESTABLISH, because the 2026-10-05 outage is why it exists and this is NOT a
# diagnosis of it. Nothing in our code records who held the link that morning; the journal is CONSISTENT
# with an overlap (the spool pull's first pass ended `stopped=transport` in the same second as a poll
# TimeoutError) and consistency is not proof. Nor is it known whether the AS11 accepts two simultaneous
# links at all — if it accepts ONE, a second actor's connect simply FAILS rather than interleaving, which
# is a transport error and not a garbled proof. This removes a real hazard our own code makes possible.
# It does not claim to have removed the cause.
from __future__ import annotations

import logging

log = logging.getLogger("tepna.cpap")

__all__ = ["LinkBusy", "busy_with", "hold", "declined_line"]

_holder: str | None = None


class LinkBusy(RuntimeError):
    """Raised when another actor holds the AS11's single link. `holder` names it, for a useful line."""

    def __init__(self, holder: str):
        super().__init__(declined_line(holder))
        self.holder = holder


def declined_line(holder: str) -> str:
    """The sentence a declined actor leaves behind. Pure.

    Names the HOLDER, because "the link was busy" is not actionable: the question asked afterwards is
    which actor was in the way."""
    return f"the AS11 link is held by {holder} — declined rather than opening a second session"


def busy_with() -> str | None:
    """The actor currently holding the link, or None when it is free."""
    return _holder


async def hold(who: str, connect):
    """Claim the link for `who`, run `connect()`, and return its `(write, recv_frame, disconnect)` triple
    with `disconnect` extended to RELEASE. Raises `LinkBusy` immediately if another actor holds it.

    🔴 THE RELEASE IS TIED TO `disconnect`, NOT TO THIS CALL, because the link is held for the whole
    SESSION — connect, handshake, reads, close — and that span is the caller's, not ours. Every AS11
    actor already calls `disconnect`, which is what makes this placement honest rather than hopeful.

    ⚠️ NOT an `asynccontextmanager` like `offline_lock.slot`, and the difference is forced: a `with`
    block releases when the BODY ends, and here the body is a `connect()` that RETURNS a live link its
    caller goes on using. Wrapping `disconnect` is the only placement that matches the real span.

    A failure in `connect()` releases immediately: a claim held by a connect that never opened would
    block the link on behalf of nothing at all."""
    global _holder
    if _holder is not None:
        log.info(declined_line(_holder))
        raise LinkBusy(_holder)
    _holder = who
    try:
        write, recv_frame, disconnect = await connect()
    except BaseException:
        _holder = None
        raise

    async def _disconnect():
        global _holder
        try:
            await disconnect()
        finally:
            _holder = None

    return write, recv_frame, _disconnect
