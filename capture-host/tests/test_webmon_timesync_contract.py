# tepna-capture — tests/test_webmon_timesync_contract.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`POST /api/timesync` and `/api/timesync/all` — who gets synced, in what order, and what is reported.

The device clock is what stamps a night. The Clock Contract makes those stamps floating local civil time
with no zone, so a device whose RTC has drifted produces a recording that is internally consistent and
wrong — and nothing downstream can tell, because there is no second opinion inside the file.

That makes two behaviours here load-bearing, and the mutation audit found both unasserted (42 survivors
in `timesync_all`, 20 in `timesync`):

* **The host is disciplined FIRST**, so the devices inherit a freshly corrected time rather than
  propagating the host's own drift into every sensor.
* **A non-Polar device is skipped honestly.** The O2Ring re-syncs its RTC on every connect (oxyii 0xC0),
  so there is nothing manual to do — and the answer says so, rather than shipping a button that silently
  no-ops or a red row that never goes green.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import offline_lock  # noqa: E402
import telemetry  # noqa: E402
import webmon  # noqa: E402
from tests.test_webmon_api import H10, _serve  # noqa: E402

RING = {"name": "Ring", "vendor": "Wellue", "model": "O2Ring-S", "device_id": "S8AW",
        "address": "D1:98:62:7C:92:B3", "streams": ["spo2"], "rates": {}}


def _app(tmp_path, devices, sync_time=None, host=None, order=None):
    cfg = {"root": str(tmp_path), "clock": {"sudo": False},
           "devices": [dict(d) for d in devices]}

    async def _host_sync(sudo=False):
        if order is not None:
            order.append("host")
        if isinstance(host, Exception):
            raise host
        return host if host is not None else {"ok": True, "source": "chrony"}
    webmon.clockcfg.sync_now = _host_sync
    return webmon.make_app(telemetry.TelemetryBus(), cfg, str(tmp_path / "config.yaml"),
                           "AA:AA:AA:AA:AA:AA", {"devices": {}}, None, sync_time=sync_time)


@pytest.fixture(autouse=True)
def _restore_host_sync():
    """`clockcfg.sync_now` is patched per-app rather than via monkeypatch, because `_app` installs it
    before make_app reads it. Restore it whatever the test did."""
    real = webmon.clockcfg.sync_now
    yield
    webmon.clockcfg.sync_now = real


# ── one device ──────────────────────────────────────────────────────────────────────────────────────
def _one(app, address):
    async def go(c):
        r = await c.post("/api/timesync", json={"address": address})
        return r.status, await r.json()
    return _serve(app, go)


def test_a_polar_is_synced_and_its_result_returned_verbatim(tmp_path):
    seen = []

    async def sync(addr):
        seen.append(addr)
        return {"ok": True, "skew_sec": -1.5, "address": addr}
    status, body = _one(_app(tmp_path, [H10], sync_time=sync), H10["address"])
    assert status == 200 and seen == [H10["address"]]
    assert body == {"ok": True, "skew_sec": -1.5, "address": H10["address"]}


def test_a_non_polar_is_reported_as_automatic_rather_than_synced(tmp_path):
    """`ok: True` with `skipped: "auto"` — not a failure, and not a silent success either. The ring has
    no manual step, and saying so is what stops an operator chasing a row that will never change."""
    called = []

    async def sync(addr):
        called.append(addr)
        return {"ok": True}
    status, body = _one(_app(tmp_path, [RING], sync_time=sync), RING["address"])
    assert status == 200
    assert body["ok"] is True and body["skipped"] == "auto"
    assert body["address"] == RING["address"]
    assert "connect" in body["detail"]
    assert called == [], "a device that self-syncs must not be driven over the radio"


def test_an_unknown_address_is_refused(tmp_path):
    status, body = _one(_app(tmp_path, [H10]), "99:99:99:99:99:99")
    assert status == 400 and body["error"] == "unknown address"


def test_a_polar_with_no_sync_hook_says_so_rather_than_pretending(tmp_path):
    status, body = _one(_app(tmp_path, [H10], sync_time=None), H10["address"])
    assert status == 400 and "unavailable" in body["error"]


def test_a_busy_radio_is_a_409_naming_its_holder(tmp_path):
    async def busy(addr):
        raise offline_lock.OfflineBusy("Verity")
    status, body = _one(_app(tmp_path, [H10], sync_time=busy), H10["address"])
    assert status == 409 and body["busy"] == "Verity" and body["ok"] is False


def test_a_failed_sync_is_a_502_naming_the_exception(tmp_path):
    async def boom(addr):
        raise RuntimeError("gatt timeout")
    status, body = _one(_app(tmp_path, [H10], sync_time=boom), H10["address"])
    assert status == 502 and "RuntimeError" in body["error"] and "gatt timeout" in body["error"]


# ── all devices ─────────────────────────────────────────────────────────────────────────────────────
def _all(app):
    async def go(c):
        return await (await c.post("/api/timesync/all")).json()
    return _serve(app, go)


def test_the_host_clock_is_disciplined_before_any_device(tmp_path):
    """Order is the point: a device synced from an undisciplined host inherits the host's drift, and the
    result is a night that is internally consistent and wrong."""
    order = []

    async def sync(addr):
        order.append(addr)
        return {"ok": True}
    body = _all(_app(tmp_path, [H10], sync_time=sync, order=order))
    assert order == ["host", H10["address"]], order
    assert body["host"] == {"ok": True, "source": "chrony"}


def test_a_failed_host_sync_is_reported_and_does_not_stop_the_devices(tmp_path):
    """The devices are still worth syncing to a host clock that is merely undisciplined — and the honest
    `host` block is what tells the operator which half to distrust."""
    async def sync(addr):
        return {"ok": True}
    body = _all(_app(tmp_path, [H10], sync_time=sync, host=RuntimeError("no chrony")))
    assert body["host"]["ok"] is False and "no chrony" in body["host"]["detail"]
    assert body["devices"][0]["ok"] is True


def test_every_device_is_named_in_the_result(tmp_path):
    """The rows are keyed by name in the UI; an unnamed row cannot be matched to a card."""
    async def sync(addr):
        return {"ok": True, "skew_sec": 0.2}
    body = _all(_app(tmp_path, [H10, RING], sync_time=sync))
    by_name = {d["name"]: d for d in body["devices"]}
    assert set(by_name) == {"H10", "Ring"}
    assert by_name["H10"]["ok"] is True and by_name["H10"]["skew_sec"] == 0.2
    assert by_name["Ring"]["skipped"] == "auto" and by_name["Ring"]["ok"] is True
    assert by_name["Ring"]["address"] == RING["address"]


def test_one_devices_failure_does_not_abandon_the_rest(tmp_path):
    """Serialised over one radio, so an early failure that stopped the loop would leave later devices
    unsynced with nothing said about them."""
    async def sync(addr):
        if addr == H10["address"]:
            raise RuntimeError("gatt timeout")
        return {"ok": True}
    second = {**H10, "name": "H10b", "address": "11:22:33:44:55:66"}
    body = _all(_app(tmp_path, [H10, second], sync_time=sync))
    by_name = {d["name"]: d for d in body["devices"]}
    assert by_name["H10"]["ok"] is False and "RuntimeError" in by_name["H10"]["error"]
    assert by_name["H10"]["address"] == H10["address"]
    assert by_name["H10b"]["ok"] is True, "the second device must still be attempted"


def test_without_a_sync_hook_every_polar_is_reported_unavailable(tmp_path):
    body = _all(_app(tmp_path, [H10], sync_time=None))
    assert body["devices"][0]["ok"] is False
    assert body["devices"][0]["error"] == "unavailable"
    assert body["devices"][0]["name"] == "H10"
