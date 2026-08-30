# tepna-capture — tests/test_adapter_pool.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The radio pool: discovered, not configured. Plug an adapter in and it joins.

Uses the box's real MACs, because the arrangement they produce is the fix being tested: three radios
present, every wearable on one of them, and the AX210 idle while the others collide.
"""

import adapter_pool as P

UB = "AC:A7:F1:29:9D:1D"  # hci0 — the CPAP's own link
SENA = "00:01:95:CC:53:02"  # hci1 — where every wearable currently is
AX = "28:0C:50:0C:18:FD"  # hci2 — the AX210, plugged in 2026-08-30 and unused
DEVS = ["H10", "Verity", "O2Ring", "Coospo"]
ALL = [{"mac": UB, "up": True}, {"mac": SENA, "up": True}, {"mac": AX, "up": True}]


# ── the pool ───────────────────────────────────────────────────────────────────────────────────


def test_a_DOWN_adapter_is_not_in_the_pool():
    """Placing a device on a radio we could not confirm is up is the mistake `failover_target`
    already refuses on the capture side."""
    pool, _held = P.usable_pool(
        [{"mac": SENA, "up": True}, {"mac": AX, "up": False}, {"mac": None, "up": True}, {"mac": "", "up": True}]
    )
    assert pool == [SENA]


def test_the_RESERVED_radio_is_separated_not_discarded():
    """🔴 hci0 carries the CPAP's own link, and putting wearables there re-creates on one radio the
    contention this module exists to relieve. But a reserved radio beats NO radio, so the caller can
    fall back deliberately rather than the pool pretending it does not exist."""
    pool, held = P.usable_pool(ALL, reserved=[UB.lower()])  # case-insensitive
    assert pool == sorted([SENA, AX]) and held == [UB]


def test_the_pool_is_ORDER_STABLE_across_restarts():
    """A pool that reshuffles on boot would re-bond every sensor for nothing."""
    a = P.usable_pool(ALL)[0]
    b = P.usable_pool(list(reversed(ALL)))[0]
    assert a == b


# ── assignment ─────────────────────────────────────────────────────────────────────────────────


def test_the_box_TODAY_spreads_across_the_two_open_radios():
    """The fix, on the real hardware: four wearables, hci0 reserved for the CPAP, so two each on the
    Sena and the AX210 instead of four on one."""
    pool, held = P.usable_pool(ALL, reserved=[UB])
    got = P.assign(DEVS, pool, reserved_pool=held)
    assert sorted(got) == sorted(DEVS)
    counts = {a: sum(1 for v in got.values() if v == a) for a in set(got.values())}
    assert counts == {SENA: 2, AX: 2}, counts
    assert UB not in got.values(), "a wearable was placed on the CPAP's radio while others were free"


def test_assignment_is_STICKY_because_moving_costs_a_recording():
    """🔴 Not an optimisation. A move is a disconnect, a re-bond and a gap in a night's data, so a
    device already on a live adapter stays there even when a more balanced plan exists."""
    lopsided = {d: SENA for d in DEVS}
    pool, held = P.usable_pool(ALL, reserved=[UB])
    got = P.assign(DEVS, pool, lopsided, held)
    assert got == lopsided, "a working arrangement was reshuffled for balance"


def test_only_devices_with_NO_HOME_are_placed():
    pool, held = P.usable_pool(ALL, reserved=[UB])
    got = P.assign(DEVS, pool, {"H10": SENA, "Verity": SENA}, held)
    assert got["H10"] == SENA and got["Verity"] == SENA
    assert got["O2Ring"] == AX and got["Coospo"] == AX, "orphans did not go to the emptier radio"


def test_a_device_whose_radio_VANISHED_is_re_placed():
    """Its prior home is not in the pool, so it counts as homeless."""
    pool, held = P.usable_pool([{"mac": SENA, "up": True}], reserved=[UB])
    got = P.assign(DEVS, pool, {d: AX for d in DEVS}, held)
    assert set(got.values()) == {SENA}


def test_assignment_is_DETERMINISTIC():
    pool, held = P.usable_pool(ALL, reserved=[UB])
    assert P.assign(DEVS, pool, reserved_pool=held) == P.assign(list(reversed(DEVS)), pool, reserved_pool=held)


def test_with_NO_open_radio_the_reserved_one_is_used_rather_than_leaving_a_sensor_homeless():
    """A sensor on a contended radio still records. A sensor on no radio does not."""
    pool, held = P.usable_pool([{"mac": UB, "up": True}], reserved=[UB])
    assert pool == [] and held == [UB]
    got = P.assign(DEVS, pool, reserved_pool=held)
    assert set(got.values()) == {UB}


def test_no_radios_at_all_assigns_nobody_rather_than_inventing_one():
    assert P.assign(DEVS, [], reserved_pool=[]) == {}


# ── hotplug ────────────────────────────────────────────────────────────────────────────────────


def test_a_NEW_RADIO_NEVER_INTERRUPTS_A_LIVE_RECORDING():
    """🔴 Rebalancing everything on plug-in would drop every wearable at once — a worse outage than
    the contention it relieves."""
    before = {d: SENA for d in DEVS}
    after, moved = P.apply_added(AX, ALL, DEVS, before, reserved=[UB])
    assert after == before and moved == []


def test_but_DISCONNECTED_devices_DO_move_onto_it_so_it_does_not_sit_idle():
    """The tension this resolves: stickiness protects live links, and would otherwise leave a new
    radio unused — which is the very problem. A device that is not connected costs nothing to move;
    it lands on its new adapter at its next reconnect, and on this box that happens constantly."""
    before = {d: SENA for d in DEVS}
    after, moved = P.apply_added(AX, ALL, DEVS, before, reserved=[UB], movable={"Coospo", "O2Ring"})
    assert moved == ["Coospo", "O2Ring"]
    assert after["H10"] == SENA and after["Verity"] == SENA, "a live device was moved"
    assert after["Coospo"] == AX and after["O2Ring"] == AX


def test_a_REMOVED_radio_re_homes_its_devices_immediately():
    """Unlike an addition, a removal leaves sensors with NO radio — this one has to act."""
    before = {"H10": SENA, "Verity": SENA, "O2Ring": AX, "Coospo": AX}
    after, moved = P.apply_removed(
        SENA, [{"mac": UB, "up": True}, {"mac": AX, "up": True}], DEVS, before, reserved=[UB]
    )
    assert moved == ["H10", "Verity"] and after["H10"] == AX and after["Verity"] == AX
    assert after["O2Ring"] == AX and after["Coospo"] == AX, "an unaffected device was moved"


def test_removing_the_LAST_open_radio_falls_back_to_the_reserved_one():
    before = {d: AX for d in DEVS}
    after, _m = P.apply_removed(AX, [{"mac": UB, "up": True}], DEVS, before, reserved=[UB])
    assert set(after.values()) == {UB}


def test_removal_is_case_insensitive_on_the_mac():
    before = {d: SENA for d in DEVS}
    after, moved = P.apply_removed(SENA.lower(), [{"mac": AX, "up": True}], DEVS, before)
    assert moved == sorted(DEVS) and set(after.values()) == {AX}


# ── saying it out loud ─────────────────────────────────────────────────────────────────────────


def test_every_move_is_REPORTED_because_each_one_is_a_real_disconnect():
    before = {"H10": SENA}
    after = {"H10": AX, "Verity": SENA}
    line = P.rebalance_reason(before, after)
    assert "H10" in line and SENA in line and AX in line
    assert "Verity: unassigned -> " in line, "a first placement must read as one, not as a move"
    assert P.rebalance_reason(before, before) == "no device moved"
