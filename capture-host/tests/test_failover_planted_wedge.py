# tepna-capture — tests/test_failover_planted_wedge.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""SEEN TO FAIL OVER, not assumed — the last item on the failover brief's Done-when list.

`failover_target` has been tested as a pure decision since P1.5, and `link_distress` tests the signal.
Neither drives the LADDER. This plants a wedge on the pinned radio and asserts the whole path: the
recovery ladder escalates, a healthy spare is chosen, the process-wide pin actually MOVES, the
sensors are re-bonded there, and the switch leaves an EVENT carrying its cause.

🔴 WHY AN END-TO-END TEST AND NOT MORE UNIT TESTS. Every piece of this was already covered
individually and the wiring between them still had a hole — `_set_active_adapter` moves a process
global that nothing asserted, and the event emission was added blind. A ladder whose rungs are each
tested but which was never climbed is the shape this repo keeps finding.
"""


import capture
import pytest
from test_capture_runners import _dev, _run, _stop_after

PINNED = "00:01:95:CC:53:02"  # Sena — the radio we wedge
SPARE = "F0:D5:BF:1E:79:21"  # Intel — up, addressable, not pinned


@pytest.fixture(autouse=True)
def _isolate():
    capture._STOP.clear()
    capture._RADIO_EVENTS.clear()
    capture.STATUS.pop("radio_switches", None)
    before = capture.ADAPTER
    yield
    capture.ADAPTER = before
    capture._STOP.clear()
    capture._RADIO_EVENTS.clear()


def _wedge(monkeypatch, *, spares=((SPARE, True),), bond_ok=True):
    """Pin a radio, hold it DOWN, and offer `spares` to `list_adapters`."""
    bonded = []

    async def hci():
        return "hci1"

    async def is_up(_h):
        return False  # the wedge: the pinned adapter is DOWN, every poll

    async def adapters():
        return [{"mac": PINNED, "up": False}] + [{"mac": m, "up": u} for m, u in spares]

    async def btctl(_script, timeout=6):
        return ""

    async def ensure_bonded(addr, mac, force=False):
        bonded.append((addr, mac))
        return bond_ok

    async def restart_radio():
        return None

    monkeypatch.setattr(capture, "adapter_hci", hci)
    monkeypatch.setattr(capture, "_adapter_is_up", is_up)
    monkeypatch.setattr(capture, "list_adapters", adapters)
    monkeypatch.setattr(capture.bonding, "_btctl", btctl)
    monkeypatch.setattr(capture.bonding, "ensure_bonded", ensure_bonded)
    monkeypatch.setattr(capture, "_restart_radio", restart_radio)
    return bonded


def _cfg(**over):
    w = {
        "enabled": True,
        "interval_sec": 1,
        "grace_checks": 1,
        "max_adapter_cycles": 1,
        "recover_checks": 1,
        "max_failovers": 3,
    }
    w.update(over)
    return {"watchdog": w, "devices": [_dev(name="H10")]}


def _run_watchdog(monkeypatch, cfg, polls=6):
    capture.STATUS["devices"]["H10"] = {
        "connected": False,
        "address": "24:AC:AC:02:84:96",
        "last_error": "TimeoutError",
    }
    _stop_after(monkeypatch, polls)
    _run(capture.adapter_watchdog(PINNED, cfg))


def test_a_planted_wedge_MIGRATES_the_pin_to_a_healthy_spare(monkeypatch):
    """The whole point: the process-wide pin has to actually move, because every device task resolves
    ADAPTER -> hciN fresh on each reconnect. Asserting the decision alone would pass against a
    failover that decided correctly and then changed nothing."""
    bonded = _wedge(monkeypatch)
    capture.ADAPTER = PINNED
    _run_watchdog(monkeypatch, _cfg())
    assert capture.ADAPTER == SPARE, "the ladder escalated but the pin never moved"
    assert bonded and bonded[0][1] == SPARE, "the sensors were not re-bonded on the spare"


def test_the_switch_leaves_an_EVENT_carrying_its_cause(monkeypatch):
    """A `log.critical` is not a surface. Radio churn has to reach something that survives the night."""
    _wedge(monkeypatch)
    capture.ADAPTER = PINNED
    _run_watchdog(monkeypatch, _cfg())
    evs = capture.STATUS.get("radio_switches") or []
    assert evs, "a failover happened and left no event"
    ev = evs[-1]
    assert ev["from"] == PINNED and ev["to"] == SPARE
    assert ev["cause"] == "wedged" and "ladder spent" in (ev["detail"] or "")


def test_the_event_records_where_it_came_FROM_not_where_it_went(monkeypatch):
    """🔴 `adapter_mac` is reassigned inside the try, so an event built after the repoint would report
    the spare as both endpoints — a switch log that cannot tell you which radio failed."""
    _wedge(monkeypatch)
    capture.ADAPTER = PINNED
    _run_watchdog(monkeypatch, _cfg())
    ev = (capture.STATUS.get("radio_switches") or [])[-1]
    assert ev["from"] != ev["to"], "the event lost the radio it failed away from"


def test_NO_HEALTHY_SPARE_means_no_switch_and_no_event(monkeypatch):
    """A down spare is no spare. Moving onto an adapter we could not confirm UP is worse than staying
    on the wedged one, and it must not be reported as a recovery either."""
    _wedge(monkeypatch, spares=((SPARE, False),))
    capture.ADAPTER = PINNED
    _run_watchdog(monkeypatch, _cfg())
    assert capture.ADAPTER == PINNED, "failed over onto an adapter that was not up"
    assert not (capture.STATUS.get("radio_switches") or [])


def test_failover_DISABLED_by_config_does_not_switch(monkeypatch):
    _wedge(monkeypatch)
    capture.ADAPTER = PINNED
    _run_watchdog(monkeypatch, _cfg(failover=False))
    assert capture.ADAPTER == PINNED and not (capture.STATUS.get("radio_switches") or [])


def test_a_FAILED_re_bond_does_not_abort_the_migration(monkeypatch):
    """The spare is already pinned by then. Refusing to finish because one bond failed would leave the
    box on a radio nothing is bonded to — worse than the wedge."""
    _wedge(monkeypatch, bond_ok=False)
    capture.ADAPTER = PINNED
    _run_watchdog(monkeypatch, _cfg())
    assert capture.ADAPTER == SPARE
    assert capture.STATUS.get("radio_switches") or [], "the switch happened but was not recorded"


# ── the CPAP's dedicated radio is not collateral ──────────────────────────────────────────────────
# `config.example.yaml` calls `cpap.ble_stream.adapter` "the FREE radio — never the one the wearables
# capture on", and the split exists for 2.4 GHz coexistence (measured 2026-07-26: a transmitter beside
# recording sensors cost 5-7 dB and 17 reconnects across three devices). Until `reserved` was wired,
# a wedged wearable radio failed over ONTO that free radio by first-match ordering — silently
# re-creating the contention the split prevents, with nothing in the log naming it.
_WEARABLE = "00:1A:7D:AA:AA:AA"
_CPAP = "28:0C:50:BB:BB:BB"
_SPARE = "AA:BB:CC:DD:EE:FF"


def _ad(mac, hci, up=True):
    return {"mac": mac, "hci": hci, "up": up}


def _three():
    return [_ad(_WEARABLE, "hci0"), _ad(_CPAP, "hci1"), _ad(_SPARE, "hci2")]


def test_THE_CPAP_RADIO_IS_NOT_TAKEN_WHILE_ANY_OTHER_SPARE_EXISTS():
    got = capture.failover_target(_WEARABLE, _three(), reserved=(_CPAP,))
    assert got == _SPARE, f"failover took a reserved radio with {_SPARE} sitting free"


def test_A_RESERVATION_WORKS_WHETHER_CONFIGURED_AS_A_MAC_OR_AN_hciN():
    # `cpap.ble_stream.adapter` may legitimately be either form — the config's own comment prefers a
    # MAC because hci indices re-enumerate, but a bare hciN is still valid and must protect the same
    # radio. A reservation that understood only one form would silently protect nothing.
    assert capture.failover_target(_WEARABLE, _three(), reserved=("hci1",)) == _SPARE
    assert capture.failover_target(_WEARABLE, _three(), reserved=(_CPAP.lower(),)) == _SPARE


def test_IT_IS_A_PREFERENCE_NOT_A_PROHIBITION_WHEN_NOTHING_ELSE_IS_LEFT():
    """In extremis, commandeering the CPAP radio is the RIGHT trade — the wearables are the primary
    signal and the CPAP live stream is off by default. Refusing outright would trade a recoverable
    capture for a tidy rule. What must not happen is taking it *silently*."""
    only = [_ad(_WEARABLE, "hci0"), _ad(_CPAP, "hci1")]
    assert capture.failover_target(_WEARABLE, only, reserved=(_CPAP,)) == _CPAP


def test_A_DOWN_RESERVED_RADIO_IS_STILL_NO_SPARE():
    only = [_ad(_WEARABLE, "hci0"), _ad(_CPAP, "hci1", up=False)]
    assert capture.failover_target(_WEARABLE, only, reserved=(_CPAP,)) is None


def test_WITHOUT_A_RESERVATION_THE_OLD_BEHAVIOUR_IS_UNCHANGED():
    # The parameter defaults to empty, so every existing caller and every prior expectation holds.
    assert capture.failover_target(_WEARABLE, _three()) == _CPAP


def test_AN_EMPTY_OR_NONE_RESERVATION_IS_NOT_A_RESERVATION():
    # `cpap.ble_stream.adapter` is absent on a box with no CPAP; a None must not become a reservation
    # of the empty string and quietly hold back a radio whose mac failed to parse.
    assert capture.failover_target(_WEARABLE, _three(), reserved=()) == _CPAP
    assert capture.failover_target(_WEARABLE, _three(), reserved=(None, "")) == _CPAP


def test_COMMANDEERING_THE_CPAP_RADIO_IS_ANNOUNCED_NOT_QUIET(monkeypatch, caplog):
    """The end-to-end of the branch that used to happen by accident.

    Wearable radio wedged, and the CPAP's reserved radio is the ONLY spare. Taking it is the right
    trade — the wearables are the primary signal — but it must be SAID, because from this moment the
    two share one radio and the 2.4 GHz contention the split exists to prevent is back."""
    import logging

    _wedge(monkeypatch, spares=((_CPAP, True),))
    cfg = _cfg()
    cfg["cpap"] = {"ble_stream": {"adapter": _CPAP}}
    with caplog.at_level(logging.CRITICAL, logger="tepna-capture"):
        _run_watchdog(monkeypatch, cfg)

    assert capture.ADAPTER == _CPAP, "the only available spare was not taken"
    msgs = " ".join(r.getMessage() for r in caplog.records)
    assert "RESERVED radio" in msgs, (
        "a dedicated radio was commandeered with nothing in the log naming it — which is exactly the "
        "silence this change exists to end"
    )
    assert "contention" in msgs


def test_A_PLAIN_FAILOVER_DOES_NOT_CLAIM_A_RADIO_WAS_COMMANDEERED(monkeypatch, caplog):
    # The mirror: taking an ordinary spare must NOT emit the reserved warning, or the message stops
    # meaning anything the night it matters.
    import logging

    _wedge(monkeypatch, spares=((SPARE, True),))
    cfg = _cfg()
    cfg["cpap"] = {"ble_stream": {"adapter": _CPAP}}
    with caplog.at_level(logging.CRITICAL, logger="tepna-capture"):
        _run_watchdog(monkeypatch, cfg)

    assert capture.ADAPTER == SPARE
    assert "RESERVED radio" not in " ".join(r.getMessage() for r in caplog.records)


# ── the DISTRESS cause (part (a), 2026-09-01) — same dance, different decision ──────────────────────
# The adapter is UP and answering — nothing wedged — and simply cannot hold its links: the 08-29 ring
# storm shape. The verdict that may move the pin is the ADAPTER-level fold (≥2 rated links distressed
# together), gated behind `watchdog.distress_failover` DEFAULT OFF. Three behaviors, each the
# inverse of a way this could go wrong.

def _healthy(monkeypatch, *, spares=((SPARE, True),)):
    """A clean radio: every poll healthy, a spare on offer. The wedge never fires."""
    bonded = []

    async def hci():
        return "hci1"

    async def is_up(_h):
        return True

    async def adapters():
        return [{"mac": PINNED, "up": True}] + [{"mac": m, "up": u} for m, u in spares]

    async def btctl(_script, timeout=6):
        return ""

    async def ensure_bonded(addr, mac, force=False):
        bonded.append((addr, mac))
        return True

    monkeypatch.setattr(capture, "adapter_hci", hci)
    monkeypatch.setattr(capture, "_adapter_is_up", is_up)
    monkeypatch.setattr(capture, "list_adapters", adapters)
    monkeypatch.setattr(capture.bonding, "_btctl", btctl)
    monkeypatch.setattr(capture.bonding, "ensure_bonded", ensure_bonded)
    return bonded


def _distress_scan(monkeypatch, verdicts, *, on_adapter=PINNED):
    """ADAPTER-AWARE, like the real scan: `_LINK_DISTRESS_SEEN` is keyed `(adapter, device)`, so
    after a switch the new adapter's histories start EMPTY and the verdicts go absent — that keying,
    the 900 s hysteresis, and `max_failovers` are the three flap brakes. An adapter-blind fake
    bypasses all three and manufactures a ping-pong the production scan cannot produce in one poll
    (measured while writing this test: two opposite switches in four polls). The fake must model the
    keying or it tests a machine that does not exist."""
    def fake(adapter_mac, devices, baselines, now_s):
        return dict(verdicts) if adapter_mac == on_adapter else {}
    monkeypatch.setattr(capture, "link_distress_scan", fake)


def _run_healthy_watchdog(monkeypatch, cfg, polls=4):
    capture.STATUS["devices"]["H10"] = {"connected": True, "address": "24:AC:AC:02:84:96"}
    _stop_after(monkeypatch, polls)
    _run(capture.adapter_watchdog(PINNED, cfg))


def test_ADAPTER_LEVEL_DISTRESS_migrates_the_pin_when_armed(monkeypatch):
    """Two rated links distressed together + the flag on → the same migration the wedge takes, with
    the event naming the cause, the links, and the worst link's numbers."""
    bonded = _healthy(monkeypatch)
    _distress_scan(monkeypatch, {
        "Ring": {"state": "distressed", "observed": 13.7, "band": 8.0, "detail": "over band"},
        "H10": {"state": "distressed", "observed": 9.1, "band": 8.0, "detail": "over band"},
    })
    _run_healthy_watchdog(monkeypatch, _cfg(distress_failover=True))
    assert capture.ADAPTER == SPARE, "the pin must move on an armed adapter-level verdict"
    assert bonded, "the sensors must be re-bonded on the spare"
    (ev,) = capture._RADIO_EVENTS[-1:]
    assert ev["cause"] == "reconnect-rate" and ev["to"] == SPARE
    assert "Ring" in ev["device"] and "H10" in ev["device"]
    assert ev["observed_per_h"] == 13.7, "the worst link's numbers must ride the event"
    assert "adapter-wide" in ev["detail"]


def test_DEFAULT_OFF_means_report_only_however_distressed(monkeypatch):
    """🔴 THE PIN THIS UNIT SHIPS UNDER. Absent flag = report-only: the fold is published (visible in
    /api/state) and NOTHING moves — arming is the owner's, against the brief's pre-stated criterion."""
    _healthy(monkeypatch)
    _distress_scan(monkeypatch, {
        "Ring": {"state": "distressed", "observed": 13.7, "detail": "over band"},
        "H10": {"state": "distressed", "observed": 9.1, "detail": "over band"},
    })
    _run_healthy_watchdog(monkeypatch, _cfg())      # no distress_failover key at all — the default
    assert capture.ADAPTER != SPARE, "an unarmed verdict must not switch"
    assert capture._RADIO_EVENTS == []
    av = capture.STATUS.get("radio_distress_adapter") or {}
    assert av.get("state") == "distressed", "report-only still means REPORTED"


def test_ARMED_DISTRESS_with_NO_SPARE_reports_and_stays_put(monkeypatch):
    """The armed verdict with nowhere to go: no switch, no event, no crash — and the report still
    stands, because a verdict that evaporates when it cannot act is the silent-healing shape from
    the opposite direction."""
    _healthy(monkeypatch, spares=())
    _distress_scan(monkeypatch, {
        "Ring": {"state": "distressed", "observed": 13.7, "detail": "over band"},
        "H10": {"state": "distressed", "observed": 9.1, "detail": "over band"},
    })
    _run_healthy_watchdog(monkeypatch, _cfg(distress_failover=True))
    assert capture.ADAPTER != SPARE and capture._RADIO_EVENTS == []
    assert (capture.STATUS.get("radio_distress_adapter") or {}).get("state") == "distressed"


def test_ONE_distressed_link_does_not_switch_even_armed(monkeypatch):
    """The corroboration rule, end to end: a single storming link is a device/link pathology that
    moves with the device — relocating the healthy siblings for it is the category mismatch the
    per-device verdicts stayed report-only to avoid."""
    _healthy(monkeypatch)
    _distress_scan(monkeypatch, {
        "Ring": {"state": "distressed", "observed": 13.7, "detail": "over band"},
        "H10": {"state": "ok", "observed": 0.2, "detail": "within band"},
    })
    _run_healthy_watchdog(monkeypatch, _cfg(distress_failover=True))
    assert capture.ADAPTER != SPARE and capture._RADIO_EVENTS == []
    av = capture.STATUS.get("radio_distress_adapter") or {}
    assert av.get("state") == "ok" and "device-local" in (av.get("detail") or "")
