# tepna-capture — tests/test_webmon_api.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The monitor's HTTP control surface. This is the ONLY path by which anything outside the daemon can
# change what the box does — settings, bonding, forgetting a device, triggering a stored-session pull —
# so the tests below are weighted towards the REFUSAL branches. A handler that wrongly accepts is how a
# headless Pi ends up mis-configured with no console to fix it from.
#
# Driven with aiohttp's TestServer/TestClient inside asyncio.run(), matching the house style in
# test_adapter_pin.py. No pytest-asyncio / pytest-aiohttp needed, so CI installs nothing extra.

import asyncio
import os

import pytest
import yaml
from aiohttp.test_utils import TestClient, TestServer

import bonding
import offline_lock
import telemetry
import webmon


def _serve(app, fn):
    """Run `fn(client)` against a live TestServer, tearing it down afterwards."""
    async def go():
        server = TestServer(app)
        client = TestClient(server)
        await client.start_server()
        try:
            return await fn(client)
        finally:
            await client.close()
    return asyncio.run(go())


H10 = {"name": "H10", "vendor": "Polar", "model": "H10", "device_id": "12345678",
       "address": "AA:BB:CC:DD:EE:FF", "streams": ["ecg"], "rates": {}}
RING = {"name": "Ring", "vendor": "Wellue", "model": "O2Ring-S", "device_id": "S8AW",
        "address": "D1:98:62:7C:92:B3", "streams": ["spo2"], "rates": {}}


def _mk(tmp_path, devices=None, status=None, **kw):
    cfg = {"root": str(tmp_path), "clock": {"sudo": False},
           "devices": [dict(d) for d in (devices if devices is not None else [H10])]}
    st = {"host_clock": {"source": "ntp"}, "devices": status if status is not None else {}}
    cfg_path = str(tmp_path / "config.yaml")
    app = webmon.make_app(bus := telemetry.TelemetryBus(), cfg, cfg_path, "AA:AA:AA:AA:AA:AA", st,
                          kw.pop("spawn_device", None), **kw)
    return app, cfg, st, cfg_path, bus


# ── /api/state ──────────────────────────────────────────────────────────────────────────────────────
def test_state_projects_config_and_status(tmp_path):
    app, *_ = _mk(tmp_path, status={"H10": {"connected": True, "battery": 88, "rssi": -55,
                                            "link_epoch": 7}})

    async def go(c):
        return await (await c.get("/api/state")).json()
    body = _serve(app, go)
    assert body["adapter"] == "AA:AA:AA:AA:AA:AA"
    d = body["devices"][0]
    assert d["name"] == "H10" and d["connected"] is True and d["battery"] == 88 and d["rssi"] == -55
    assert d["link_epoch"] == 7                       # E5 reconnect count surfaced for the monitor


def test_state_reports_a_configured_but_unseen_device_as_disconnected(tmp_path):
    """A device in config.yaml the daemon has never reached must read disconnected with null fields —
    NOT be omitted, and not inherit another device's status."""
    app, *_ = _mk(tmp_path, status={})

    async def go(c):
        return await (await c.get("/api/state")).json()
    d = _serve(app, go)["devices"][0]
    assert d["connected"] is False and d["battery"] is None and d["last_error"] is None


# ── /api/remember — the identity gate ───────────────────────────────────────────────────────────────
@pytest.mark.parametrize("missing_field", ["name", "vendor", "model", "device_id"])
def test_remember_refuses_an_unidentified_device_and_writes_nothing(tmp_path, missing_field):
    """writers.capture_filename interpolates vendor/model/device_id; a blank one yields a night named
    `__id_..._ECG.txt` that no adapter can route. The daemon already refuses to spawn such a device, so
    the monitor must refuse to PERSIST it — otherwise config.yaml gains a device that is never captured
    and the UI still reports "remembered ✓"."""
    spawned = []
    app, cfg, _st, cfg_path, _bus = _mk(tmp_path, spawn_device=spawned.append)
    dev = {**H10, "address": "11:22:33:44:55:66", missing_field: "   "}   # whitespace counts as missing

    async def go(c):
        r = await c.post("/api/remember", json=dev)
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 400 and body["ok"] is False and missing_field in body["missing"]
    assert len(cfg["devices"]) == 1, "config must not gain the device"
    assert not spawned, "an unidentified device must never be hot-started"
    assert not os.path.exists(cfg_path), "nothing may be written on a refusal"


def test_remember_persists_and_hot_starts_a_valid_device(tmp_path):
    spawned = []
    app, cfg, _st, cfg_path, _bus = _mk(tmp_path, spawn_device=spawned.append)
    dev = {**RING, "address": "11:22:33:44:55:66"}

    async def go(c):
        return await (await c.post("/api/remember", json=dev)).json()
    body = _serve(app, go)
    assert body["ok"] is True and body["remembered"] == 2
    assert len(spawned) == 1 and spawned[0]["address"] == "11:22:33:44:55:66"
    assert yaml.safe_load(open(cfg_path))["devices"][-1]["address"] == "11:22:33:44:55:66"


def test_remember_is_idempotent_on_address(tmp_path):
    app, cfg, *_ = _mk(tmp_path)

    async def go(c):
        await c.post("/api/remember", json=H10)
        return await (await c.post("/api/remember", json=H10)).json()
    body = _serve(app, go)
    assert body["remembered"] == 1, "re-remembering the same address must not duplicate it"
    assert len(cfg["devices"]) == 1


def test_remember_keeps_only_allowlisted_keys(tmp_path):
    """A payload carrying extra keys must not smuggle them into config.yaml."""
    app, cfg, *_ = _mk(tmp_path)
    dev = {**RING, "address": "11:22:33:44:55:66", "root": "/etc", "web": {"port": 1}}

    async def go(c):
        return await (await c.post("/api/remember", json=dev)).json()
    _serve(app, go)
    stored = cfg["devices"][-1]
    assert "root" not in stored and "web" not in stored


# ── /api/settings POST — the validation surface ─────────────────────────────────────────────────────
def _post_settings(tmp_path, payload, **kw):
    app, cfg, st, cfg_path, _bus = _mk(tmp_path, **kw)

    async def go(c):
        r = await c.post("/api/settings", json=payload)
        return r.status, await r.json()
    return (*_serve(app, go), cfg, cfg_path)


def test_settings_rejects_a_non_allowlisted_key(tmp_path):
    status, body, cfg, cfg_path = _post_settings(tmp_path, {"settings": {"root": "/etc"}})
    assert status == 400 and "not a settable key" in body["error"]
    assert "root" not in cfg or cfg["root"] == str(tmp_path)
    assert not os.path.exists(cfg_path), "a rejected settings post must not write config.yaml"


def test_settings_rejects_an_out_of_range_value(tmp_path):
    status, body, _cfg, cfg_path = _post_settings(tmp_path, {"settings": {"watchdog.grace_checks": 99}})
    assert status == 400 and "must be between" in body["error"]
    assert not os.path.exists(cfg_path)


def test_settings_applies_a_valid_change_and_reports_restart_need(tmp_path):
    status, body, cfg, cfg_path = _post_settings(
        tmp_path, {"settings": {"watchdog.interval_sec": 90, "o2ring.ppg_fs": 130}})
    assert status == 200 and body["ok"] is True
    assert set(body["changed"]) >= {"watchdog.interval_sec", "o2ring.ppg_fs"}
    assert body["restart_needed"] is True, "o2ring.ppg_fs is flagged needs_restart in the schema"
    assert cfg["watchdog"]["interval_sec"] == 90
    assert yaml.safe_load(open(cfg_path))["watchdog"]["interval_sec"] == 90


def test_settings_without_a_restart_key_does_not_demand_a_restart(tmp_path):
    _s, body, *_ = _post_settings(tmp_path, {"settings": {"watchdog.interval_sec": 90}})
    assert body["restart_needed"] is False


def test_settings_rejects_streams_for_an_unknown_device(tmp_path):
    status, body, *_ = _post_settings(tmp_path, {"streams": {"99:99:99:99:99:99": ["ecg"]}})
    assert status == 400 and "unknown device" in body["error"]


def test_settings_rejects_a_non_list_stream_spec(tmp_path):
    status, body, *_ = _post_settings(tmp_path, {"streams": {H10["address"]: "ecg"}})
    assert status == 400 and "must be a list" in body["error"]


def test_settings_rejects_a_stream_the_device_does_not_support(tmp_path):
    status, body, *_ = _post_settings(
        tmp_path, {"streams": {H10["address"]: ["ecg", "gyro"]}},
        status={"H10": {"pmd_supported": ["ecg", "acc"]}})
    assert status == 400 and "does not support" in body["error"] and "gyro" in body["error"]


def test_hr_is_always_allowed_even_though_pmd_never_reports_it(tmp_path):
    """`hr` rides the standard HR characteristic, not PMD, so it never appears in pmd_supported. Gating
    it on that list would make the strap's RR stream unselectable."""
    status, _body, *_ = _post_settings(
        tmp_path, {"streams": {H10["address"]: ["ecg", "hr"]}},
        status={"H10": {"pmd_supported": ["ecg", "acc"]}})
    assert status == 200


def test_settings_rejects_a_rate_the_device_did_not_offer(tmp_path):
    status, body, *_ = _post_settings(
        tmp_path, {"rates": {H10["address"]: {"acc": 999}}},
        status={"H10": {"pmd_options": {"acc": [25, 50, 100, 200]}}})
    assert status == 400 and "not offered" in body["error"]


def test_settings_accepts_an_offered_rate(tmp_path):
    status, _body, cfg, _p = _post_settings(
        tmp_path, {"rates": {H10["address"]: {"acc": 50}}},
        status={"H10": {"pmd_options": {"acc": [25, 50, 100, 200]}}})
    assert status == 200 and cfg["devices"][0]["rates"]["acc"] == 50


def test_settings_rejects_a_non_numeric_rate(tmp_path):
    status, body, *_ = _post_settings(tmp_path, {"rates": {H10["address"]: {"acc": "fast"}}})
    assert status == 400 and "must be a number" in body["error"]


# ── /api/settings GET ───────────────────────────────────────────────────────────────────────────────
def test_settings_get_hides_pmd_capability_flags_from_the_stream_menu(tmp_path):
    """The PMD feature bitmask also reports capability FLAGS (0x9, 0xd…) which are not data streams;
    offering them in the UI produces a START the device must reject."""
    app, *_ = _mk(tmp_path, status={"H10": {"pmd_supported": ["ecg", "acc", "0x9", "0xd"]}})

    async def go(c):
        return await (await c.get("/api/settings")).json()
    body = _serve(app, go)
    dev = [d for d in body["devices"] if d["name"] == "H10"][0]
    assert "0x9" not in dev["supported"] and "0xd" not in dev["supported"]
    assert {"ecg", "acc"} <= set(dev["supported"])


def test_settings_get_reports_the_ring_streams_despite_no_pmd(tmp_path):
    """The O2Ring speaks its own protocol, not PMD, so it reports no pmd_supported at all — the UI must
    still offer its two streams rather than an empty menu."""
    app, *_ = _mk(tmp_path, devices=[RING], status={"Ring": {}})

    async def go(c):
        return await (await c.get("/api/settings")).json()
    dev = _serve(app, go)["devices"][0]
    assert set(dev["supported"]) == {"spo2", "ppg", "ppg2w", "acc", "pletha"}


# ── /api/pull ───────────────────────────────────────────────────────────────────────────────────────
def test_pull_reports_unavailable_when_the_daemon_offers_no_puller(tmp_path):
    app, *_ = _mk(tmp_path, pull_stored=None)

    async def go(c):
        r = await c.post("/api/pull", json={})
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 400 and body["ok"] is False


def test_pull_surfaces_a_busy_offline_slot_as_409(tmp_path):
    """Two downloads at once would fight over the single BLE link; the UI needs to know WHO holds it."""
    async def busy(which, ftype):
        raise offline_lock.OfflineBusy("Polar H10")
    app, *_ = _mk(tmp_path, pull_stored=busy)

    async def go(c):
        r = await c.post("/api/pull", json={})
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 409 and body["busy"] == "Polar H10"


def test_pull_tolerates_a_malformed_json_body(tmp_path):
    seen = {}

    async def puller(which, ftype):
        seen.update(which=which, ftype=ftype)
        return {"files": []}
    app, *_ = _mk(tmp_path, pull_stored=puller)

    async def go(c):
        r = await c.post("/api/pull", data=b"not json",
                         headers={"Content-Type": "application/json"})
        return r.status
    assert _serve(app, go) == 200
    assert seen["ftype"] == 0, "a malformed body must fall back to defaults, not 500"


def test_pull_coerces_a_non_numeric_ftype(tmp_path):
    seen = {}

    async def puller(which, ftype):
        seen["ftype"] = ftype
        return {}
    app, *_ = _mk(tmp_path, pull_stored=puller)

    async def go(c):
        return (await c.post("/api/pull", json={"ftype": "abc"})).status
    assert _serve(app, go) == 200 and seen["ftype"] == 0


# ── /api/timesync ───────────────────────────────────────────────────────────────────────────────────
def test_timesync_rejects_an_unknown_address(tmp_path):
    app, *_ = _mk(tmp_path)

    async def go(c):
        r = await c.post("/api/timesync", json={"address": "00:00:00:00:00:00"})
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 400 and body["error"] == "unknown address"


def test_timesync_reports_the_ring_as_automatic_rather_than_failing(tmp_path):
    """The O2Ring has no manual sync step — its RTC is driven by the capture path. Reporting an error
    here would send the user hunting for a fault that does not exist."""
    app, *_ = _mk(tmp_path, devices=[RING])

    async def go(c):
        r = await c.post("/api/timesync", json={"address": RING["address"]})
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 200 and body["ok"] is True and body["skipped"] == "auto"


def test_timesync_surfaces_a_device_error_as_502(tmp_path):
    async def boom(address):
        raise RuntimeError("psftp said no")
    app, *_ = _mk(tmp_path, sync_time=boom)

    async def go(c):
        r = await c.post("/api/timesync", json={"address": H10["address"]})
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 502 and "RuntimeError" in body["error"]


# ── /api/polar/pull ─────────────────────────────────────────────────────────────────────────────────
def test_polar_pull_rejects_a_session_path_without_a_leading_slash(tmp_path):
    app, *_ = _mk(tmp_path)

    async def go(c):
        r = await c.post("/api/polar/pull", json={"address": H10["address"], "session": "SESSION1"})
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 400 and "bad address or session" in body["error"]


def test_polar_pull_rejects_a_non_polar_address(tmp_path):
    app, *_ = _mk(tmp_path, devices=[RING])

    async def go(c):
        r = await c.post("/api/polar/pull", json={"address": RING["address"], "session": "/U/0/1/"})
        return r.status, await r.json()
    assert _serve(app, go)[0] == 400


def test_polar_recordings_rejects_a_non_polar_address(tmp_path):
    app, *_ = _mk(tmp_path, devices=[RING])

    async def go(c):
        r = await c.get("/api/polar/recordings", params={"address": RING["address"]})
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 400 and "non-Polar" in body["error"]


# ── /api/scan and /api/forget ───────────────────────────────────────────────────────────────────────
def test_scan_serialises_discovered_devices(tmp_path, monkeypatch):
    async def fake_scan(*a, **k):
        return [bonding.Found(address="11:22:33:44:55:66", name="Polar H10 1234", rssi=-60,
                              bonded=False, connected=False, health=True)]
    monkeypatch.setattr(webmon.bonding, "scan", fake_scan)
    app, *_ = _mk(tmp_path)

    async def go(c):
        return await (await c.post("/api/scan", json={})).json()
    body = _serve(app, go)
    found = body["found"] if isinstance(body, dict) else body
    assert found[0]["address"] == "11:22:33:44:55:66" and found[0]["health"] is True
    assert found[0]["name"] == "Polar H10 1234" and found[0]["rssi"] == -60


def test_forget_removes_the_device_from_config(tmp_path, monkeypatch):
    async def fake_forget(*a, **k):
        return True
    monkeypatch.setattr(webmon.bonding, "forget", fake_forget)
    forgotten = []
    app, cfg, _st, cfg_path, _bus = _mk(tmp_path, forget_device=forgotten.append)

    async def go(c):
        return await (await c.post("/api/forget", json={"address": H10["address"]})).json()
    _serve(app, go)
    assert cfg["devices"] == [], "the device must be dropped from the in-memory config"
    assert yaml.safe_load(open(cfg_path))["devices"] == []
    assert forgotten == [H10["address"]], "the runner-stop callback must fire so no orphan reconnects"


# ── SSE ─────────────────────────────────────────────────────────────────────────────────────────────
def test_stream_sends_a_snapshot_then_releases_its_subscription(tmp_path):
    """The subscriber must be released when the client goes away; leaking one per page-load would grow
    the bus queue set for the life of the daemon."""
    app, _cfg, _st, _p, bus = _mk(tmp_path)
    bus.register("ecg", "ECG", "uV", 130)
    bus.push("ecg", [1, 2, 3])

    async def go(c):
        resp = await c.get("/api/stream/ecg")
        chunk = await asyncio.wait_for(resp.content.read(200), timeout=5)
        resp.close()
        return chunk
    chunk = _serve(app, go)
    assert b"snapshot" in chunk
    assert getattr(bus, "_subs", set()) == set() or len(bus._subs) == 0, "subscription leaked"


# ── config.yaml IS WRITTEN ATOMICALLY (VIGIL-HARDENING-II §2) ──────────────────────────────────
# _save() used to be `open(cfg_path, "w")`, which truncates BEFORE it writes. A failure partway (full
# disk, power cut, kill) left the only copy truncated, and the `except` could not undo it. The blast
# radius is the whole appliance and it is silent: capture.py reads the config once, at startup, so the
# damage surfaces as "recorded nothing all night" at the next restart.
#
# Driven through /api/remember — the endpoint that actually persists — so the write really happens.

def _seed_config(cfg_path):
    with open(cfg_path, "w") as f:
        yaml.safe_dump({"devices": [{"name": "keep me", "vendor": "V", "model": "M",
                                     "device_id": "1", "address": "AA:BB:CC:DD:EE:FF"}]}, f)
    return open(cfg_path).read()


def test_a_failing_config_write_leaves_the_previous_file_intact(tmp_path, monkeypatch):
    """THE regression: the old truncating write destroyed the file before it could fail."""
    app, _cfg, _st, cfg_path, _bus = _mk(tmp_path)
    before = _seed_config(cfg_path)
    assert before.strip(), "precondition: a real config exists on disk"

    def boom(*a, **k):
        raise OSError(28, "No space left on device")
    monkeypatch.setattr(webmon.yaml, "safe_dump", boom)

    async def go(c):
        r = await c.post("/api/remember", json={**RING, "address": "11:22:33:44:55:66"})
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 500 and body["ok"] is False, "a failed write must report failure"
    monkeypatch.undo()
    assert open(cfg_path).read() == before, \
        "a failed write must not damage the existing config — the whole point of the atomic replace"
    assert yaml.safe_load(open(cfg_path))["devices"][0]["name"] == "keep me"


def test_no_stray_temp_file_survives_a_failed_write(tmp_path, monkeypatch):
    app, _cfg, _st, cfg_path, _bus = _mk(tmp_path)
    _seed_config(cfg_path)
    def boom(*a, **k):
        raise OSError(28, "No space left on device")
    monkeypatch.setattr(webmon.yaml, "safe_dump", boom)

    async def go(c):
        return (await c.post("/api/remember", json={**RING, "address": "11:22:33:44:55:66"})).status
    _serve(app, go)
    monkeypatch.undo()
    strays = [n for n in os.listdir(os.path.dirname(cfg_path)) if n.endswith(".tmp")]
    assert strays == [], f"stray temp files left behind: {strays}"


def test_a_successful_write_still_lands_the_whole_config(tmp_path):
    """The atomic path must be a real save, not a safe no-op: every device the daemon holds must be on
    disk afterwards, not just the newest one."""
    app, cfg, _st, cfg_path, _bus = _mk(tmp_path)
    pre = [d["address"] for d in cfg["devices"]]

    async def go(c):
        return await (await c.post("/api/remember", json={**RING, "address": "11:22:33:44:55:66"})).json()
    assert _serve(app, go)["ok"] is True
    saved = yaml.safe_load(open(cfg_path))
    addrs = [d["address"] for d in saved["devices"]]
    assert addrs[-1] == "11:22:33:44:55:66", "the new device landed"
    assert all(a in addrs for a in pre), f"pre-existing devices must survive: {pre} vs {addrs}"


# ── A MAC MUST BE A MAC, WHOLE (VIGIL-HARDENING-III §2) ────────────────────────────────────────
# _valid_mac used `.match()` on an anchored pattern, but Python's `$` also matches just BEFORE a
# trailing newline. Not a command injection (only a LONE trailing newline gets through, so nothing
# can follow it), but /api/remember persists the address — and an address carrying a newline never
# matches a real BLE address again: "remembered ✓", then silently never captured.

def test_a_trailing_newline_is_not_a_valid_mac():
    assert webmon._valid_mac("AA:BB:CC:DD:EE:FF") is True
    assert webmon._valid_mac("aa:bb:cc:dd:ee:ff") is True
    assert webmon._valid_mac("AA:BB:CC:DD:EE:FF\n") is False, "Python's `$` gotcha"
    assert webmon._valid_mac("AA:BB:CC:DD:EE:FF\r") is False


def test_no_embedded_control_character_survives_validation():
    """Belt to the brace: the value is f-string-interpolated into a bluetoothctl script."""
    for bad in ("AA:BB:CC:DD:EE:FF\nquit", "AA:BB:CC:DD:EE:FF\n\n", "AA:BB:CC:DD:EE:FF remove x",
                " AA:BB:CC:DD:EE:FF", "AA:BB:CC:DD:EE:FFF", "AA:BB:CC:DD:EE", "", None, 42):
        assert webmon._valid_mac(bad) is False, f"{bad!r} must be rejected"


def test_remember_refuses_an_address_with_a_trailing_newline(tmp_path):
    """The end-to-end consequence: such a device would be persisted and then never captured."""
    app, cfg, _st, cfg_path, _bus = _mk(tmp_path)
    before = len(cfg["devices"])

    async def go(c):
        r = await c.post("/api/remember", json={**RING, "address": "11:22:33:44:55:66\n"})
        return r.status
    assert _serve(app, go) == 400
    assert len(cfg["devices"]) == before, "config must not gain an uncapturable device"


# ── STORAGE / OFFLOAD TARGET API (STORAGE-OFFLOAD-TARGETS) ─────────────────────────────────────
# The box has a small SSD, so nights must leave. This surface owns where they go and when — and it
# must never become a place a password comes to rest (config.yaml is world-readable on the box and
# this API is LAN-reachable through Caddy).

_RSYNC_T = {"protocol": "rsync", "host": "192.168.0.142", "user": "tepna",
            "share": "/mnt/tank/tepna", "identity": "/home/tepna/.ssh/id_ed25519"}


def test_storage_get_lists_the_protocol_catalogue(tmp_path):
    app, *_ = _mk(tmp_path)

    async def go(c):
        return await (await c.get("/api/storage")).json()
    body = _serve(app, go)
    by = {p["protocol"]: p for p in body["protocols"]}
    assert {"rsync", "nfs", "smb", "iscsi", "nvmeof", "webdav", "ftp", "local"} <= set(by)
    assert by["nfs"]["privileged"] is True, "the UI must know this one needs a root step"
    assert by["rsync"]["privileged"] is False


def test_storage_post_persists_the_target_and_schedule(tmp_path):
    app, cfg, _st, cfg_path, _bus = _mk(tmp_path)

    async def go(c):
        return await (await c.post("/api/storage", json={
            "enabled": True, "target": _RSYNC_T,
            "schedule": {"mode": "daily", "at": "09:30", "window_min": 60}})).json()
    body = _serve(app, go)
    assert body["ok"] is True
    saved = yaml.safe_load(open(cfg_path))["archive"]
    assert saved["target"]["host"] == "192.168.0.142"
    assert saved["schedule"] == {"mode": "daily", "at": "09:30", "window_min": 60}
    assert saved["enabled"] is True


def test_a_mount_target_sets_dest_to_its_mountpoint(tmp_path):
    """nightarchive + the retention gate both key off `dest`, so a mount target must populate it."""
    app, _cfg, _st, cfg_path, _bus = _mk(tmp_path)

    async def go(c):
        return await (await c.post("/api/storage", json={"target": {
            "protocol": "nfs", "host": "nas.local", "share": "/mnt/tank/tepna",
            "mountpoint": "/srv/tepna/archive"}})).json()
    body = _serve(app, go)
    assert body["ok"] is True
    assert yaml.safe_load(open(cfg_path))["archive"]["dest"] == "/srv/tepna/archive"
    assert body["mount_unit"]["unit_name"] == "srv-tepna-archive.mount"


def test_a_transfer_target_clears_dest(tmp_path):
    """rsync pushes straight off the box — a stale local `dest` would make the retention gate confirm
    against a directory nothing writes to."""
    app, cfg, _st, cfg_path, _bus = _mk(tmp_path)
    cfg.setdefault("archive", {})["dest"] = "/srv/tepna/old"

    async def go(c):
        return await (await c.post("/api/storage", json={"target": _RSYNC_T})).json()
    assert _serve(app, go)["ok"] is True
    assert "dest" not in yaml.safe_load(open(cfg_path))["archive"]


def test_storage_post_refuses_a_password_and_writes_nothing(tmp_path):
    app, _cfg, _st, cfg_path, _bus = _mk(tmp_path)

    async def go(c):
        r = await c.post("/api/storage", json={"target": {**_RSYNC_T, "password": "hunter2"}})
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 400 and "never stores a password" in body["error"]
    assert not os.path.exists(cfg_path), "a rejected target must not touch config.yaml"


def test_storage_post_rejects_an_argv_hostile_host(tmp_path):
    app, *_ = _mk(tmp_path)

    async def go(c):
        r = await c.post("/api/storage", json={"target": {**_RSYNC_T, "host": "-e/bin/sh"}})
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 400 and "invalid host" in body["error"]


def test_storage_test_reports_an_unmounted_mountpoint_as_not_ready(tmp_path, monkeypatch):
    app, *_ = _mk(tmp_path)
    mp = tmp_path / "archive"
    mp.mkdir()
    # A mountpoint is constrained to MOUNT_ROOTS because it is WRITTEN to; tmp_path is none of them.
    # Widen it here so this test exercises the readiness check rather than the location check (which
    # has its own tests in test_storage_targets.py).
    monkeypatch.setattr(webmon.storage_targets, "MOUNT_ROOTS",
                        tuple(webmon.storage_targets.MOUNT_ROOTS) + (str(tmp_path),))

    async def go(c):
        return await (await c.post("/api/storage/test", json={"target": {
            "protocol": "nfs", "host": "nas.local", "share": "/mnt/tank/tepna",
            "mountpoint": str(mp)}})).json()
    body = _serve(app, go)
    assert body["ok"] is False and "nothing is mounted" in body["detail"]


# ── RE-REMEMBERING A KNOWN DEVICE MUST NOT DESTROY ITS TUNING (VIGIL-REMEMBER-MERGE) ───────────
# `remember` dropped the stored entry and rebuilt it from a 6-key allowlist, so one pass through the
# pairing screen erased every tuned key outside that list. Observed on the real box: `rates:` vanished
# from the H10 (acc 50) and Verity (acc 52, mag 20) — the E4 decision that cut 71% of the box's bytes —
# and nightqc then graded a COMPLETE night against nominals the operator never chose (acc 24%, mag 39%).

def _dev_in(cfg, addr):
    return next((d for d in cfg["devices"] if d.get("address") == addr), None)


def test_re_remember_preserves_configured_rates(tmp_path):
    app, cfg, _st, _p, _b = _mk(tmp_path)
    addr = "24:AC:AC:0C:30:1E"
    cfg["devices"].append({"name": "Polar Verity Sense", "vendor": "Polar", "model": "VeritySense",
                           "device_id": "0C301E3F", "address": addr,
                           "streams": ["ppg", "acc"], "rates": {"acc": 52, "mag": 20}})

    async def go(c):
        return await (await c.post("/api/remember", json={
            "name": "Polar Sense 0C301E3F", "vendor": "Polar", "model": "VeritySense",
            "device_id": "AC0C301E", "address": addr, "streams": ["ppg", "acc", "gyro", "mag"]})).json()
    assert _serve(app, go)["ok"] is True
    d = _dev_in(cfg, addr)
    assert d["rates"] == {"acc": 52, "mag": 20}, "tuned rates must survive a re-scan"


def test_re_remember_keeps_the_established_device_id(tmp_path):
    """device_id is interpolated into every capture filename. Changing it renames the sensor's whole
    future output and orphans it from its own history — the browser guessed AC0C301E from the MAC."""
    app, cfg, _st, _p, _b = _mk(tmp_path)
    addr = "24:AC:AC:0C:30:1E"
    cfg["devices"].append({"name": "Polar Verity Sense", "vendor": "Polar", "model": "VeritySense",
                           "device_id": "0C301E3F", "address": addr, "streams": ["ppg"]})

    async def go(c):
        return await (await c.post("/api/remember", json={
            "name": "Polar Sense", "vendor": "Polar", "model": "VeritySense",
            "device_id": "AC0C301E", "address": addr, "streams": ["ppg"]})).json()
    _serve(app, go)
    assert _dev_in(cfg, addr)["device_id"] == "0C301E3F"


def test_re_remember_preserves_the_optional_flag(tmp_path):
    """An optional backup that loses `optional: true` starts counting as a missing device and reds QC."""
    app, cfg, _st, _p, _b = _mk(tmp_path)
    addr = "F7:33:8E:CF:E6:BE"
    cfg["devices"].append({"name": "COOSPO", "vendor": "Coospo", "model": "HRM808S",
                           "device_id": "0022265", "address": addr, "streams": ["hr"], "optional": True})

    async def go(c):
        return await (await c.post("/api/remember", json={
            "name": "COOSPO", "vendor": "Coospo", "model": "HRM808S",
            "device_id": "0022265", "address": addr, "streams": ["hr"]})).json()
    _serve(app, go)
    assert _dev_in(cfg, addr).get("optional") is True


def test_re_remember_still_applies_what_the_caller_DID_send(tmp_path):
    """Merging must not make the endpoint inert — an updated stream list has to land."""
    app, cfg, _st, _p, _b = _mk(tmp_path)
    addr = "24:AC:AC:0C:30:1E"
    cfg["devices"].append({"name": "old", "vendor": "Polar", "model": "VeritySense",
                           "device_id": "0C301E3F", "address": addr, "streams": ["ppg"],
                           "rates": {"mag": 20}})

    async def go(c):
        return await (await c.post("/api/remember", json={
            "name": "new name", "vendor": "Polar", "model": "VeritySense",
            "device_id": "0C301E3F", "address": addr, "streams": ["ppg", "mag"]})).json()
    _serve(app, go)
    d = _dev_in(cfg, addr)
    assert d["name"] == "new name" and d["streams"] == ["ppg", "mag"]
    assert d["rates"] == {"mag": 20}


def test_re_remember_does_not_duplicate_or_reorder(tmp_path):
    app, cfg, _st, _p, _b = _mk(tmp_path)
    addr = "24:AC:AC:0C:30:1E"
    cfg["devices"].append({"name": "V", "vendor": "Polar", "model": "VeritySense",
                           "device_id": "0C301E3F", "address": addr, "streams": ["ppg"]})
    cfg["devices"].append({"name": "Z-last", "vendor": "X", "model": "Y",
                           "device_id": "ZZ", "address": "11:22:33:44:55:66", "streams": ["hr"]})
    before = len(cfg["devices"])

    async def go(c):
        return await (await c.post("/api/remember", json={
            "name": "V", "vendor": "Polar", "model": "VeritySense",
            "device_id": "0C301E3F", "address": addr, "streams": ["ppg"]})).json()
    _serve(app, go)
    assert len(cfg["devices"]) == before, "a re-remember must not append a duplicate"
    assert cfg["devices"][-1]["name"] == "Z-last", "position must be stable, not shuffled to the end"


def test_a_genuinely_new_device_is_still_appended(tmp_path):
    app, cfg, _st, _p, _b = _mk(tmp_path)
    before = len(cfg["devices"])

    async def go(c):
        return await (await c.post("/api/remember", json={**RING, "address": "11:22:33:44:55:66"})).json()
    assert _serve(app, go)["ok"] is True
    assert len(cfg["devices"]) == before + 1
