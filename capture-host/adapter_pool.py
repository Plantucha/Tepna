# tepna-capture — adapter_pool.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# THE RADIO POOL IS DISCOVERED, NOT CONFIGURED — plug an adapter in and it joins.
#
# 🔴 THE FAILURE THIS FIXES, live on the box 2026-08-30. Three radios are present and every wearable
# is on ONE of them, because the daemon pins a single process-global adapter. The AX210 went in an
# hour ago and sits idle while H10/Verity/O2Ring collide on the Sena — `org.bluez.Error.InProgress`,
# `adapter wedged`, connect timeouts, and four daemon restarts overnight. The capacity exists; the
# scheduling does not.
#
# ⚠️ THE PER-DEVICE `adapter:` CONFIG KEY DOES NOT DO THIS, and reaching for it is the trap. Verified
# 2026-08-29: it only bites in the multi-INSTANCE deployment, and this box runs one instance, so
# `instance_devices(cfg, None)` returns every device and the key is inert. Distribution has to come
# from resolving an adapter PER DEVICE at connect time, which is what this module decides.
#
# WHAT THIS IS NOT: it does not replace `capture.py`'s P1.5 capture failover (move a connected device
# off a wedged radio) or `ble_discovery`'s sibling-radio retry (#1971). It supplies the SET those two
# operate over, and keeps that set current as hardware comes and goes.

from __future__ import annotations

__all__ = ["usable_pool", "assign", "apply_added", "apply_removed", "rebalance_reason"]


def usable_pool(adapters, reserved=()):
    """`(open, reserved_present)` — the adapters a device may be placed on. PURE.

    `adapters` is `[{mac, up}, ...]`. Down adapters are excluded: placing a device on a radio we
    could not confirm is up is the same mistake `failover_target` refuses to make on the capture side.

    RESERVED adapters are returned separately rather than dropped. On this box hci0 carries the CPAP's
    own link, and putting wearables there re-creates on one radio exactly the contention this module
    exists to relieve — but a reserved radio is still better than NO radio, so the caller can fall
    back to it deliberately instead of the pool silently pretending it does not exist."""
    res = {str(m).upper() for m in (reserved or ())}
    open_, held = [], []
    for a in adapters or []:
        mac = str((a or {}).get("mac") or "").upper()
        if not mac or not (a or {}).get("up"):
            continue
        (held if mac in res else open_).append(mac)
    # Sorted so the same hardware yields the same plan on every restart — a pool that reshuffles on
    # boot would re-bond every sensor for nothing.
    return sorted(set(open_)), sorted(set(held))


def assign(devices, pool, prior=None, reserved_pool=(), movable=None):
    """`{device: adapter}` — which radio serves which sensor. PURE and STICKY.

    🔴 STICKINESS IS THE POINT, not an optimisation. Moving a device to another radio costs a
    disconnect, a re-bond and a gap in its recording, so a device already on a live adapter STAYS
    there even if a more balanced arrangement exists. Only devices with no home — new, or orphaned by
    an unplugged radio — are placed, and they go to the least-loaded adapter.

    Deterministic: devices are considered in sorted order and ties break on adapter name, so the same
    inputs give the same plan. A restart must not reshuffle a working box.

    With no open adapter at all, the reserved ones are used rather than leaving a device unassigned —
    a sensor on a contended radio still records; a sensor on no radio does not."""
    prior = dict(prior or {})
    usable = list(pool) or list(reserved_pool)
    if not usable:
        return {}
    # ⚠️ `movable` RESOLVES THE TENSION AT THE HEART OF THIS MODULE. Stickiness protects a live
    # recording — but it also means a newly-plugged radio sits IDLE while the old one stays
    # overloaded, which is the exact problem the pool exists to fix. Moving a device that is not
    # currently connected costs nothing: it lands on its new adapter the next time it reconnects, and
    # on this box that happens constantly. So balance arrives without anyone deliberately dropping a
    # link. `None` means "move nobody who has a home", which is the conservative default.
    freeable = {d for d in (movable or ())}
    out, load = {}, {a: 0 for a in usable}
    for dev in sorted(devices or []):
        home = prior.get(dev)
        if home in load and dev not in freeable:
            out[dev] = home
            load[home] += 1
    for dev in sorted(devices or []):
        if dev in out:
            continue
        target = min(usable, key=lambda a: (load[a], a))
        out[dev] = target
        load[target] += 1
    return out


def apply_added(mac, adapters, devices, current, reserved=(), movable=None):
    """`(assignment, moved)` after a radio is plugged in. PURE.

    ⚠️ A NEW ADAPTER NEVER INTERRUPTS A LIVE RECORDING. Pass `movable` — the devices that are NOT
    currently connected — and only those are re-homed onto it; anyone mid-stream stays put and lands
    on the new plan at their next reconnect. Rebalancing everything on plug-in would drop every
    wearable at once, which is a worse outage than the contention it relieves."""
    pool, held = usable_pool(adapters, reserved)
    after = assign(devices, pool, current, held, movable=movable)
    return after, sorted(d for d, a in after.items() if current.get(d) != a)


def apply_removed(mac, adapters, devices, current, reserved=()):
    """`(assignment, moved)` after a radio disappears. PURE.

    The devices it served have no home and are re-placed; everyone else stays put. This is the case
    that MUST act immediately — unlike an addition, a removal leaves sensors with no radio at all."""
    gone = str(mac or "").upper()
    kept = {d: a for d, a in (current or {}).items() if a != gone}
    pool, held = usable_pool(adapters, reserved)
    after = assign(devices, pool, kept, held)
    return after, sorted(d for d, a in after.items() if current.get(d) != a)


def rebalance_reason(before, after):
    """A one-line, human-readable summary of what moved and where. PURE.

    Every reassignment is a real disconnect on a real sensor, so it is said out loud rather than
    happening quietly — the same rule the radio-switch event follows."""
    moves = [(d, before.get(d), a) for d, a in sorted((after or {}).items()) if before.get(d) != a]
    if not moves:
        return "no device moved"
    return "; ".join(f"{d}: {b or 'unassigned'} -> {a}" for d, b, a in moves)
