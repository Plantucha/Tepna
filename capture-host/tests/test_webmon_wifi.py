"""/api/wifi* — the box's own Wi-Fi uplink, driven from the bedside page.

🔴 THE PROPERTY THAT MATTERS HERE IS WHAT DOES **NOT** CROSS THE BOUNDARY. The monitor is served
unauthenticated over the LAN, so an endpoint that returned the stored key — or a "show saved
password" convenience — would publish the owner's hotel and phone-hotspot passwords to anything that
can reach the port. Every response shape below is asserted for the ABSENCE of the credential, not
merely for the presence of the right fields.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import wifi_join  # noqa: E402
import wifi_uplink  # noqa: E402
from tests.test_webmon_api import _mk, _serve  # noqa: E402

SSID = "HotelWifi"
PW = "correct horse battery"
PSK = wifi_join.derive_psk(SSID, PW)


def _call(app, method, path, body=None):
    async def go(c):
        r = await (c.get(path) if method == "GET" else c.post(path, json=body or {}))
        return r.status, await r.json()
    return _serve(app, go)


def _stub(monkeypatch, status=None, scan=None, join=None, calls=None):
    async def _status(runner=None):
        return status or {"ok": True, "state": "down", "ssid": None, "ip": None}

    async def _scan(runner=None):
        return scan or {"ok": True, "networks": [
            {"ssid": SSID, "signal": -40, "security": "secured", "bssid": "aa:bb"}]}

    async def _join(ssid, passphrase, security=wifi_join.SECURED, runner=None):
        if calls is not None:
            calls.append({"ssid": ssid, "passphrase": passphrase, "security": security})
        return join if join is not None else {"ok": True, "ssid": ssid}

    async def _leave(runner=None):
        return {"ok": True, "detail": "down"}

    monkeypatch.setattr(wifi_uplink, "status", _status)
    monkeypatch.setattr(wifi_uplink, "scan", _scan)
    monkeypatch.setattr(wifi_uplink, "join", _join)
    monkeypatch.setattr(wifi_uplink, "leave", _leave)


# ── the boundary ──────────────────────────────────────────────────────────────────────────────────
def test_THE_STORED_KEY_NEVER_APPEARS_IN_ANY_RESPONSE(tmp_path, monkeypatch):
    _stub(monkeypatch)
    app, cfg, *_ = _mk(tmp_path)
    wifi_uplink.save_network(str(tmp_path), SSID, PW)
    import json as _json

    # BOTH requests inside ONE serve: `_serve` spins its own event loop, and an aiohttp Application
    # cannot be started on a second one.
    async def go(c):
        out = {}
        out["/api/wifi"] = await (await c.get("/api/wifi")).json()
        out["/api/wifi/scan"] = await (await c.post("/api/wifi/scan", json={})).json()
        return out
    for path, body in _serve(app, go).items():
        blob = _json.dumps(body)
        assert PSK not in blob, f"{path} leaked the derived key"
        assert PW not in blob, f"{path} leaked the passphrase"


def test_STATUS_REPORTS_WHETHER_THE_UPLINK_WILL_COME_BACK(tmp_path, monkeypatch):
    # After a harvest the operator's real question is "will it rejoin on its own?" — which is exactly
    # what `has_credential` answers and what a bare state field cannot.
    _stub(monkeypatch, status={"ok": True, "state": "up", "ssid": SSID, "ip": "10.0.0.9"})
    app, *_ = _mk(tmp_path)
    wifi_uplink.save_network(str(tmp_path), SSID, PW)
    st, body = _call(app, "GET", "/api/wifi")
    assert st == 200 and body["state"] == "up" and body["ip"] == "10.0.0.9"
    assert body["saved"] == {"ssid": SSID, "security": "secured", "has_credential": True}


def test_NO_SAVED_NETWORK_REPORTS_NONE_RATHER_THAN_OMITTING_THE_FIELD(tmp_path, monkeypatch):
    _stub(monkeypatch)
    app, *_ = _mk(tmp_path)
    _st, body = _call(app, "GET", "/api/wifi")
    assert body["saved"] is None


# ── connect ───────────────────────────────────────────────────────────────────────────────────────
def test_CONNECTING_WITH_A_TYPED_PASSWORD_JOINS_AND_REMEMBERS(tmp_path, monkeypatch):
    calls = []
    _stub(monkeypatch, calls=calls)
    app, *_ = _mk(tmp_path)
    st, body = _call(app, "POST", "/api/wifi/connect", {"ssid": SSID, "passphrase": PW})
    assert st == 200 and body["ok"] is True
    assert body["saved"]["ssid"] == SSID
    assert calls[0]["passphrase"] == PW
    # ...and what landed on disk is the derivation, not the plaintext.
    assert wifi_uplink.load_saved(str(tmp_path))["psk"] == PSK


def test_RECONNECTING_SENDS_NO_PASSWORD_AND_USES_THE_STORED_KEY(tmp_path, monkeypatch):
    # The page never receives the key, so it cannot send it back. Omitting `passphrase` means "use
    # what you hold" — the path that makes a keyless UI possible.
    calls = []
    _stub(monkeypatch, calls=calls)
    app, *_ = _mk(tmp_path)
    wifi_uplink.save_network(str(tmp_path), SSID, PW)
    st, body = _call(app, "POST", "/api/wifi/connect", {"ssid": SSID})
    assert st == 200 and body["ok"] is True
    assert calls[0]["passphrase"] == PSK


def test_RECONNECTING_TO_A_NETWORK_WE_HOLD_NO_KEY_FOR_REFUSES_CLEARLY(tmp_path, monkeypatch):
    _stub(monkeypatch)
    app, *_ = _mk(tmp_path)
    st, body = _call(app, "POST", "/api/wifi/connect", {"ssid": "SomeoneElsesWifi"})
    assert st == 400 and body["ok"] is False and "enter it once" in body["error"]


def test_A_SAVED_NETWORK_DOES_NOT_UNLOCK_A_DIFFERENT_ONE(tmp_path, monkeypatch):
    # The stored key belongs to ONE ssid. Falling back to it for another network would try the
    # owner's home password against a stranger's access point.
    calls = []
    _stub(monkeypatch, calls=calls)
    app, *_ = _mk(tmp_path)
    wifi_uplink.save_network(str(tmp_path), SSID, PW)
    st, _body = _call(app, "POST", "/api/wifi/connect", {"ssid": "CoffeeShop"})
    assert st == 400 and calls == []


def test_A_FAILED_JOIN_IS_A_400_AND_SAVES_NOTHING(tmp_path, monkeypatch):
    _stub(monkeypatch, join={"ok": False, "error": "did not associate"})
    app, *_ = _mk(tmp_path)
    st, body = _call(app, "POST", "/api/wifi/connect", {"ssid": SSID, "passphrase": PW})
    assert st == 400 and "did not associate" in body["error"]
    assert wifi_uplink.load_saved(str(tmp_path)) is None


def test_AN_OPEN_NETWORK_NEEDS_NO_PASSWORD(tmp_path, monkeypatch):
    calls = []
    _stub(monkeypatch, calls=calls)
    app, *_ = _mk(tmp_path)
    st, body = _call(app, "POST", "/api/wifi/connect",
                     {"ssid": "FreeWifi", "security": "open", "passphrase": ""})
    assert st == 200 and body["ok"] is True
    assert calls[0]["security"] == "open"
    assert wifi_uplink.load_saved(str(tmp_path))["psk"] is None


def test_CONNECTED_BUT_UNSAVEABLE_REPORTS_BOTH(tmp_path, monkeypatch):
    # Silently dropping the save is how the uplink comes up now and cannot be restored after the next
    # harvest — the failure is invisible exactly until it matters.
    _stub(monkeypatch)

    def _boom(*_a, **_kw):
        raise OSError("read-only file system")

    monkeypatch.setattr(wifi_uplink, "save_network", _boom)
    app, *_ = _mk(tmp_path)
    st, body = _call(app, "POST", "/api/wifi/connect", {"ssid": SSID, "passphrase": PW})
    assert st == 200 and body["ok"] is True
    assert "could not save" in body["warning"]


def test_REMEMBER_FALSE_JOINS_WITHOUT_STORING(tmp_path, monkeypatch):
    _stub(monkeypatch)
    app, *_ = _mk(tmp_path)
    st, body = _call(app, "POST", "/api/wifi/connect",
                     {"ssid": SSID, "passphrase": PW, "remember": False})
    assert st == 200 and body["ok"] is True
    assert wifi_uplink.load_saved(str(tmp_path)) is None


def test_A_REJECTED_PASSPHRASE_IS_A_400(tmp_path, monkeypatch):
    _stub(monkeypatch, join={"ok": False, "error": "a Wi-Fi password is at least 8 characters"})
    app, *_ = _mk(tmp_path)
    st, _body = _call(app, "POST", "/api/wifi/connect", {"ssid": SSID, "passphrase": "short"})
    assert st == 400


# ── disconnect / forget ───────────────────────────────────────────────────────────────────────────
def test_DISCONNECT_BRINGS_THE_UPLINK_DOWN(tmp_path, monkeypatch):
    _stub(monkeypatch)
    app, *_ = _mk(tmp_path)
    st, body = _call(app, "POST", "/api/wifi/disconnect")
    assert st == 200 and body["ok"] is True


def test_FORGET_ERASES_THE_KEY_AND_SAYS_WHETHER_THERE_WAS_ONE(tmp_path, monkeypatch):
    _stub(monkeypatch)
    app, *_ = _mk(tmp_path)
    wifi_uplink.save_network(str(tmp_path), SSID, PW)
    async def go(c):
        first = await (await c.post("/api/wifi/forget", json={})).json()
        second = await (await c.post("/api/wifi/forget", json={})).json()
        return first, second
    first, second = _serve(app, go)
    assert first["forgot"] is True
    assert wifi_uplink.load_saved(str(tmp_path)) is None
    assert second["forgot"] is False, "forget must say when there was nothing to erase"


def test_A_MALFORMED_BODY_IS_REFUSED_NOT_GUESSED_AT(tmp_path, monkeypatch):
    _stub(monkeypatch)
    app, *_ = _mk(tmp_path)

    async def go(c):
        r = await c.post("/api/wifi/connect", data="not json",
                         headers={"content-type": "application/json"})
        return r.status, await r.json()
    st, _body = _serve(app, go)
    assert st == 400


# ── the harvest handover, from the endpoint's side ────────────────────────────────────────────────
# The nightly loop suspends the uplink only on the ASSOCIATING path. The manual pull has to make the
# same distinction, and initially did not: it suspended before `_work` computed reachability, so on
# the current vigil deployment — where the card is in station mode and `reachable` is always true —
# every press of "Download last night" would have taken the box off Wi-Fi for nothing.
def _cpap_app(tmp_path, monkeypatch, reachable, moves):
    import cpap_harvest
    from tests.test_webmon_api import _mk as _mkapp

    async def _suspend(root, runner=None):
        moves.append("suspend")
        return True, "suspending"

    async def _resume(root, suspended, harvest_ok=None, runner=None):
        moves.append("resume")
        return True, "restoring"

    monkeypatch.setattr(wifi_uplink, "suspend_for_harvest", _suspend)
    monkeypatch.setattr(wifi_uplink, "resume_after_harvest", _resume)
    monkeypatch.setattr(cpap_harvest, "reachable", lambda base, timeout=5.0: reachable)
    monkeypatch.setattr(cpap_harvest, "default_route_dev", lambda: "eno1")
    monkeypatch.setattr(cpap_harvest, "wifi_up",
                        lambda *_a, **_kw: moves.append("card-up") or True)
    monkeypatch.setattr(cpap_harvest, "wifi_down", lambda *_a, **_kw: moves.append("card-down"))
    monkeypatch.setattr(cpap_harvest, "nights_for", lambda scope, now: None)
    monkeypatch.setattr(cpap_harvest, "blocking_devices", lambda _d: [])
    monkeypatch.setattr(cpap_harvest, "harvest", lambda *_a, **_kw: {
        "files": 1, "bytes": 10, "skipped": 0, "nights": 1, "short": [], "errors": [],
        "partial": False, "nights_on_card": 1})
    app, cfg, *_ = _mkapp(tmp_path)
    cfg["cpap"] = {"enabled": True, "at_hour": 13, "wifi_profile": "ezshare",
                   "dest_subdir": "captures/cpap"}
    return app


def test_A_DIRECTLY_REACHABLE_CARD_LEAVES_THE_UPLINK_ALONE(tmp_path, monkeypatch):
    moves = []
    app = _cpap_app(tmp_path, monkeypatch, reachable=True, moves=moves)
    st, _body = _call(app, "POST", "/api/cpap/pull", {"scope": "last"})
    assert st == 200
    assert "suspend" not in moves, "the uplink was dropped for a harvest that never needed the radio"
    assert "card-up" not in moves


def test_AN_ASSOCIATING_HARVEST_SUSPENDS_AND_RESTORES_AROUND_ITSELF(tmp_path, monkeypatch):
    moves = []
    app = _cpap_app(tmp_path, monkeypatch, reachable=False, moves=moves)
    st, _body = _call(app, "POST", "/api/cpap/pull", {"scope": "last"})
    assert st == 200
    # Order is the property: let go of the radio, take the card, release the card, take it back.
    assert moves == ["suspend", "card-up", "card-down", "resume"], moves
