# tepna-capture — cpap_spool_caller.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# THE CALLER for the P4 spool transaction (CPAP-SPOOL-ACQUISITION brief Do-3; the last unchecked box
# of CPAP-ACQ-P4-SPOOL-TRANSACTION §7, "the single daemon-wiring touch (nightly pull), announced").
#
# `cpap_spool.sync_spool` has been a complete, 100%-covered transaction driver wired into NOTHING
# since #1711 — `tools/find_unwired.py` carries it as a declared, dated suppression precisely so the
# gap stayed visible instead of reading as finished work. This module closes it.
#
# WHAT THIS MODULE IS: the DECISION half — when may a stored-spool pull run, and when it may not,
# WHICH RULE SAID SO. All pure. The daemon touch in `capture.py` is deliberately thin, because a
# decision that only exists inside an async loop is a decision no test can reach (the lesson that
# produced `apply_instance`, and `autopull_arming` before it).
#
# 🔴 THREE INDEPENDENT REASONS A PULL MUST DEFER, and they are NOT interchangeable:
#   1. THE AS11 HOLDS EXACTLY ONE CONNECTION. The live-stream controller and the shadow detector
#      already queue behind each other on it (`is_capturing=cpap_ctl._running`, the coexistence
#      lesson of 2026-08-25). A spool pull is a third claimant on the same single socket.
#   2. A WEARABLE IS STREAMING. Reused verbatim from `cpap_harvest.blocking_devices` — a harvest is
#      unsafe when a radio carries real sample traffic near the body. BLE-to-BLE contention is if
#      anything tighter than the Wi-Fi case that rule was written for.
#   3. THE ADAPTER IS MID-RECOVERY (`_RECOVER`) — do not add radio traffic to a healing radio.
#
# ⚠️ AND A FOURTH THAT IS A CONFIG ERROR, NOT A RUNTIME STATE: the spool window must not OVERLAP the
# Wi-Fi harvest window. Both are 2.4 GHz on one box. The harvest schedule exists because concurrent
# 2.4 GHz traffic cost a measured 5-7 dB and 17 reconnects across three sensors (`cpap_harvest`
# §due_now); pointing a BLE pull into that same window re-creates the contention the schedule was
# built to avoid — and it would do so silently, because each job's own interlock only sees its own
# kind of traffic. A runtime interlock CANNOT catch this: the harvest holds no lock the pull can
# read, so the two would simply both run. It is therefore checked where it is knowable — at arming,
# from config alone — and it REFUSES rather than warns.

from __future__ import annotations

# The morning window. Therapy has ended (the owner is up), and it clears the 13:00 Wi-Fi harvest
# window [13,15) by a full hour on the near side. It is a DEFAULT, not a constraint: `at_hour` is
# configurable, and `harvest_conflict` is what actually holds the separation.
SPOOL_AT_HOUR_DEFAULT = 10
SPOOL_WINDOW_H_DEFAULT = 2


def window_hours(at_hour: int, window_h: int) -> set[int]:
    """The set of clock hours a `[at_hour, at_hour+window_h)` window covers, MODULO 24.

    Set expansion rather than interval arithmetic, deliberately. `cpap_harvest.due_now` carries a
    scar from exactly this: `at_hour <= h < at_hour + window_h` is arithmetic on a value that is
    modulo 24, and it silently CLIPPED a window that started late in the day. A set of at most 24
    small integers cannot clip, cannot wrap wrongly, and is checkable by reading it."""
    w = max(0, min(24, int(window_h)))
    return {(int(at_hour) + i) % 24 for i in range(w)}


def harvest_conflict(spool_at: int, spool_window_h: int,
                     harvest_at: int, harvest_window_h: int) -> list[int]:
    """The hours where the spool window overlaps the Wi-Fi harvest window. Empty list = clear.

    Returns the offending HOURS, not a bool, so a refusal can name them — a refusal that cannot say
    which hour collided is a refusal the operator has to re-derive by hand."""
    return sorted(window_hours(spool_at, spool_window_h)
                  & window_hours(harvest_at, harvest_window_h))


def spool_arming(cfg: dict) -> dict:
    """Is the stored-spool pull armed, and — when it is not — WHICH FLAG SAID SO. PURE.

    ⚠️ `cpap.spool_pull.enabled` DEFAULTS OFF AND NEVER INHERITS, for the reason `pull.on_close`
    does not inherit and `pull.on_doff` does: on_doff was SPLIT OUT of a live flag and had to
    reproduce existing behaviour exactly, whereas this names a path that HAS NEVER RUN ANYWHERE.
    There is no behaviour to preserve, so any inheritance would arm it as a side effect of a deploy
    rather than as a decision somebody made. It is turned on by an edit made on purpose.

    That matters more here than it did there, because of what is still owed: the FIRST WITNESSED
    PULL has not happened (CPAP-SPOOL-ACQUISITION Do-1, attended, waiting on the owner). Landing the
    caller disabled is the point — the code is reviewable and testable now, and the radio-touching
    first run stays an attended event.

    `enabled` is read WITHOUT a literal fallback (`scfg.get("enabled")`, not `.get("enabled", False)`)
    for one reason only: it preserves the difference between ABSENT and an explicit `False`, which is
    what the arming line reports back. `autopull_arming` makes the same distinction for the same
    reason — "absent -> defaults OFF" and "=False" are different operator situations and a message
    that conflates them sends someone to edit a key that is already what they wanted.

    ⚠️ `_maybe_start_as11_shadow` gives a DIFFERENT reason for the same shape — that it "stays out of
    settings_schema's shared-leaf default check" — and I checked before copying it: there is no such
    check. `settings_schema.SETTINGS` is an explicit dotted-key allowlist and `describe()` reads its
    defaults from that table (`each entry's dflt`), so how a key is read in `capture.py` has no
    bearing on it either way. The claim is inert, and it is recorded here rather than propagated."""
    scfg = (cfg.get("cpap", {}) or {}).get("spool_pull", {}) or {}
    if not scfg.get("enabled"):
        return {"armed": False, "why": "cpap.spool_pull.enabled=False" if "enabled" in scfg
                else "cpap.spool_pull.enabled absent -> defaults OFF (never inherits)",
                "at_hour": None, "window_h": None}
    at_hour = int(scfg.get("at_hour", SPOOL_AT_HOUR_DEFAULT))
    window_h = int(scfg.get("window_h", SPOOL_WINDOW_H_DEFAULT))
    if not 0 <= at_hour <= 23:
        return {"armed": False, "why": f"cpap.spool_pull.at_hour={at_hour} is not an hour 0-23",
                "at_hour": None, "window_h": None}
    if window_h < 1:
        return {"armed": False, "why": f"cpap.spool_pull.window_h={window_h} would never open",
                "at_hour": None, "window_h": None}
    ccfg = cfg.get("cpap", {}) or {}
    # Only when the harvest is ENABLED can it contend. A disabled harvest's at_hour is a dormant
    # number, and refusing against it would block a legitimate config for a job that never runs.
    if ccfg.get("enabled"):
        clash = harvest_conflict(at_hour, window_h,
                                 int(ccfg.get("at_hour", 13)), 2)
        if clash:
            return {"armed": False, "at_hour": None, "window_h": None,
                    "why": "cpap.spool_pull window overlaps the Wi-Fi harvest window at hour(s) "
                           + ", ".join(f"{h:02d}" for h in clash)
                           + " — both are 2.4 GHz and neither interlock can see the other"}
    return {"armed": True, "why": "", "at_hour": at_hour, "window_h": window_h}


def pull_blocked(*, recovering: bool, streaming: list[str], cpap_capturing: bool) -> str | None:
    """WHY a due pull must defer this minute, or None when it is clear to run. PURE.

    Ordered most-fundamental first so the reported reason is the one an operator should act on: a
    healing adapter outranks a busy one, and the AS11's single socket outranks a wearable that is
    merely nearby. Every branch returns a STRING naming its rule, because the failure this whole
    lane keeps rediscovering is a path that declines to run and says nothing (`autopull_arming`:
    *"the symptom was an ABSENT LOG LINE"*).

    A deferral must NOT consume the day — that belongs to the caller and is why this returns a
    reason rather than a decision to skip. `cpap_harvest.due_now` learned it the same way: a daily
    job that burns its one chance on a late-sleeping user silently skips days."""
    if recovering:
        return "adapter mid-recovery"
    if cpap_capturing:
        return "the AS11 live-stream controller holds the one connection"
    if streaming:
        return "streaming: " + ", ".join(streaming[:3])
    return None


# The floor a FIRST sync pulls from when the ledger is empty. After that the ledger's last committed
# cursor is the authority and this is never consulted again (`sync_spool`: `cursor = rows[-1][...] if
# rows else epoch_start`). It is deliberately RECENT rather than epochal: the first attended pull is
# specified as "a small bounded range (one day)", and a floor of 1970 would make run one an unbounded
# backfill of every session the device holds — the opposite of bounded, on the one run a human watches.
SPOOL_EPOCH_START_DEFAULT = "2026-08-01T00:00:00.000Z"


async def spool_pull_cycle(*, connect, creds, root, epoch_start, spool_type="Summary",
                           device="AS11-01", session="", max_rounds=64,
                           establish=None, cipher_factory=None, sync=None, pull_round=None,
                           on_transition=None):
    """ONE short-connect transactional sync pass → `sync_spool`'s summary dict.

    Structure mirrors `cpap_shadow_runner.poll_cycle` deliberately, including the two scars it
    carries, because this opens the same link on the same single-socket device:

      - the tuple unpack is INSIDE the try. If `connect()` returns a malformed tuple the link is
        ALREADY OPEN, and unpacking outside would leak it — the connection-leak class that wedged
        the box for 27 minutes on 2026-08-25 (a CONNECTED peripheral stops advertising, so every
        later poll dies `BleakDeviceNotFoundError` forever).
      - `disconnect` is bound to None BEFORE the try, or a failed unpack raises `NameError` in the
        `finally` and buries the real error under it.

    Every collaborator is injected and defaulted lazily rather than at def-time, so importing this
    module costs no bleak/protocol import and a test binds a script with no radio anywhere."""
    import as11_cipher
    import as11_pull
    import cpap_spool

    establish = establish or as11_pull.establish
    cipher_factory = cipher_factory or as11_cipher.make_cipher
    sync = sync or cpap_spool.sync_spool
    pull_round = pull_round or as11_pull.pull_spool_round

    conn = await connect()
    disconnect = None
    try:
        write, recv_frame, disconnect = conn
        key = await establish(bytes.fromhex(creds["masterPairKey"]), creds["clientId"],
                              write, recv_frame)
        seal, unseal = cipher_factory(key)

        async def _round(stype, from_dt):
            return await pull_round(write, recv_frame, seal, unseal, stype, from_dt)

        return await sync(_round, root, device=device, session=session, spool_type=spool_type,
                          epoch_start=epoch_start, max_rounds=max_rounds,
                          on_transition=on_transition)
    finally:
        if disconnect is not None:
            await disconnect()
