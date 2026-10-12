# tepna-capture — tests/test_webmon_timesync_on_body_gate.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# RESIDUE `2026-09-25-manual-time-sync-pauses-live-capture`: the monitor's sync button runs an OFFLINE
# RECORDING op per Polar and each one PAUSES live capture, at a price the press never named. Measured on
# vigil 2026-09-24 from one press at 22:00:54 — Verity 44.0 s then 13.0 s, H10 21.0 s then 11.0 s, and
# the H10 came back reading 2000-01-01, a 2.44e8 s device-clock step that FAILed that night's timebase.
#
# The remedy chosen of the row's three is "warn at the button", NOT "refuse during a recording": the
# owner needed this button mid-night on 2026-09-24, when only a sync could fix the H10's clock. So the
# gate is the on-body guard the three self-killing daemon verbs already use — name the sensors, quote the
# measured price, and let an explicit `force` through.

import os

import pytest
import webmon

from tests.test_webmon_api import H10, RING, _mk, _serve

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MONITOR = os.path.join(HERE, "monitor.html")


@pytest.fixture(autouse=True)
def _stub_host_sync(monkeypatch):
    """The HOST leg shells out to the privileged clock helper. These tests are about the on-body
    gate in front of it, so the host sync is stubbed — unstubbed it reaches a real sudo and hangs."""

    async def ok(sudo=True):
        return {"ok": True}

    monkeypatch.setattr(webmon.clockcfg, "sync_now", ok)


WORN = {"connected": True, "worn": True}
DOCKED = {"connected": True, "charging": True, "worn": True}
UNKNOWN = {"connected": True}


def _post(app, path, payload):
    async def go(c):
        r = await c.post(path, json=payload)
        return r.status, await r.json()

    return _serve(app, go)


async def _sync_time(addr):
    return {"ok": True, "address": addr}


def _app(tmp_path, status, devices=None):
    return _mk(tmp_path, devices=devices or [H10], status=status, sync_time=_sync_time)[0]


# ── /api/timesync/all ───────────────────────────────────────────────────────────────────────────────


def test_the_refusal_names_the_sensor_and_quotes_the_measured_price(tmp_path):
    st, body = _post(_app(tmp_path, {"H10": WORN}), "/api/timesync/all", {})
    assert st == 409
    assert body["ok"] is False
    assert body["worn"] == ["H10"]
    assert "force:true" in body["error"]
    assert "pauses its recording" in body["error"]
    cost = body["cost"]
    assert cost["gaps_sec"]["Polar H10"] == [21.0, 11.0]
    assert cost["gaps_sec"]["Polar Verity Sense"] == [44.0, 13.0]
    assert "2000-01-01" in cost["device_clock_risk"]
    assert "2026-09-24" in cost["measured"]


def test_force_is_an_explicit_act_and_goes_through(tmp_path):
    st, body = _post(_app(tmp_path, {"H10": WORN}), "/api/timesync/all", {"force": True})
    assert st == 200
    assert body["host"]["ok"] is True
    assert [d["address"] for d in body["devices"]] == [H10["address"]]


def test_a_docked_sensor_does_not_refuse(tmp_path):
    """`connected` is NOT the predicate. A sensor on its charger is connected and producing nothing, and
    warning on it is the false positive that trains an operator to always pass force."""
    st, body = _post(_app(tmp_path, {"H10": DOCKED}), "/api/timesync/all", {})
    assert st == 200
    assert "worn" not in body


def test_an_unknown_wear_state_refuses_like_the_harvest_does(tmp_path):
    """`blocking_devices` blocks on `is not False`. Refusing here costs one confirm click; syncing
    through a live recording costs the gaps above."""
    st, body = _post(_app(tmp_path, {"H10": UNKNOWN}), "/api/timesync/all", {})
    assert st == 409
    assert body["worn"] == ["H10"]


def test_a_device_the_daemon_has_never_seen_does_not_refuse(tmp_path):
    st, _ = _post(_app(tmp_path, {}), "/api/timesync/all", {})
    assert st == 200


def test_a_malformed_body_is_rejected_before_anything_is_paused(tmp_path):
    app = _app(tmp_path, {"H10": WORN})

    async def go(c):
        r = await c.post("/api/timesync/all", data="not json", headers={"content-type": "application/json"})
        return r.status, await r.json()

    st, body = _serve(app, go)
    assert st == 400
    assert body["ok"] is False


# ── /api/timesync (one device) ──────────────────────────────────────────────────────────────────────


def test_one_device_refuses_only_when_THAT_device_is_on_a_body(tmp_path):
    app = _app(tmp_path, {"H10": WORN, "Ring": WORN}, devices=[H10, RING])
    st, body = _post(app, "/api/timesync", {"address": H10["address"]})
    assert st == 409
    assert body["worn"] == ["H10"], "the other sensor's wear state is not this device's business"


def test_one_device_proceeds_while_a_DIFFERENT_sensor_is_worn(tmp_path):
    app = _app(tmp_path, {"Ring": WORN}, devices=[H10, RING])
    st, body = _post(app, "/api/timesync", {"address": H10["address"]})
    assert st == 200
    assert body["ok"] is True and body["address"] == H10["address"]


def test_one_device_honours_force(tmp_path):
    app = _app(tmp_path, {"H10": WORN})
    st, body = _post(app, "/api/timesync", {"address": H10["address"], "force": True})
    assert st == 200
    assert body["ok"] is True


# ── the page must actually ASK, and then re-fire ────────────────────────────────────────────────────


def test_the_monitor_names_the_price_and_re_fires_with_force():
    """A server-side 409 nobody surfaces is a button that silently fails. Both sync buttons go through
    `timesyncWarning` and re-post with force, the same flow `daemonKill` uses for the worn list."""
    page = open(MONITOR, encoding="utf-8").read()
    assert page.count("timesyncWarning") == 3, "one definition + one call per sync button"
    assert "RECORDING ON-BODY: " in page
    assert "Measured cost of one press" in page
    assert page.count("force:true})});") >= 2 or page.count("force:true}") >= 2


def test_the_cost_the_page_renders_is_the_cost_the_server_measured():
    """One source for the numbers: the page reads `r.cost`, it does not carry its own copy."""
    page = open(MONITOR, encoding="utf-8").read()
    fn = page[page.index("function timesyncWarning(") : page.index("async function syncTime(")]
    assert "r.cost" in fn
    for n in ("44", "13", "21", "11"):
        assert f"'{n}s'" not in fn
    assert "c.measured" in fn and "c.device_clock_risk" in fn


def test_the_constant_is_the_only_place_the_numbers_live():
    assert webmon.TIMESYNC_COST["gaps_sec"]["Polar H10"] == [21.0, 11.0]
    assert webmon.TIMESYNC_COST["gaps_sec"]["Polar Verity Sense"] == [44.0, 13.0]
