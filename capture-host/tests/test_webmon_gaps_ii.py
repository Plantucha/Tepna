# tepna-capture — tests/test_webmon_gaps_ii.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""webmon gap-fill II — the malformed-body guards and the no-op arms of the settings writer.

Two themes. First, `_body`'s contract (§D3): four endpoints check `BAD_BODY` and NONE of those checks
had ever run, so "POST garbage at the monitor" was an untested path on all of them — and the failure it
prevents is a 500 out of `.get` on a non-dict, i.e. the control surface falling over rather than
refusing. Second, the settings writer's UNCHANGED arms: the monitor re-POSTs the whole form on every
save, so "nothing actually changed" is the COMMON case, and it must not back up the config, rewrite it,
or claim a restart is needed.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import webmon  # noqa: E402
from test_webmon_api import H10, _mk, _serve  # noqa: E402

_JSON = {"Content-Type": "application/json"}


# ── _body: the three shapes it has to tell apart ───────────────────────────────────────────────────
def test_a_post_with_no_body_at_all_means_use_the_defaults(tmp_path):
    """An ABSENT body maps to `{}` — several endpoints legitimately mean "use the defaults" by posting
    nothing. It must not be confused with the malformed case, which is refused."""
    app, *_ = _mk(tmp_path, devices=[dict(H10)])

    async def go(c):
        r = await c.post("/api/timesync")          # no body, no content-type
        return r.status, await r.json()

    status, body = _serve(app, go)
    # reached the handler and got the handler's OWN answer (empty address → unknown), not a body error
    assert status == 400 and body["error"] == "unknown address"


def test_every_endpoint_refuses_valid_json_that_is_not_an_object(tmp_path):
    """`null`, `[]`, `"x"`, `3` all DECODE — the old guard only caught a decode error, so these reached
    handlers as non-dicts and 500'd on `.get`. Each of these four endpoints checks for it; none of the
    checks had ever run."""
    app, cfg, *_ = _mk(tmp_path, devices=[dict(H10)])
    cfg["cpap"] = {"enabled": True}                # else cpap_pull refuses earlier, for another reason

    async def go(c):
        out = {}
        for path, payload in (("/api/cpap/pull", "[]"), ("/api/storage/test", "null"),
                              ("/api/timesync", '"x"'), ("/api/polar/pull", "3")):
            r = await c.post(path, data=payload, headers=_JSON)
            out[path] = (r.status, (await r.json())["error"])
        return out

    for path, (status, err) in _serve(app, go).items():
        assert status == 400, f"{path} must refuse, not 500"
        assert err == "request body must be a JSON object", path


# ── _has_comments: a config that has nothing to lose ───────────────────────────────────────────────
def test_has_comments_is_false_for_a_file_whose_only_comments_are_our_own_banner(tmp_path):
    """The warning fires when a save is about to DROP operator comments. Our own banner is not the
    operator's, so a machine-written config must not trigger it on every save — that is a warning that
    trains the reader to ignore warnings."""
    p = tmp_path / "config.yaml"
    p.write_text(webmon.CONFIG_BANNER if hasattr(webmon, "CONFIG_BANNER") else
                 "# WRITTEN BY THE TEPNA MONITOR\nroot: /srv/tepna\ndevices: []\n")
    assert webmon._has_comments(str(p)) is False
    p.write_text("# my hand-tuned rates, do not touch\nroot: /srv/tepna\n")
    assert webmon._has_comments(str(p)) is True
    assert webmon._has_comments(str(tmp_path / "absent.yaml")) is False


# ── clock ──────────────────────────────────────────────────────────────────────────────────────────
def test_ntp_servers_may_be_posted_as_a_list_not_only_a_string(tmp_path, monkeypatch):
    """The string form is the text-input convenience (comma/space separated). A caller that already has
    a list — the monitor's own JS, and any script — must have it passed through untouched rather than
    re-split."""
    app, *_ = _mk(tmp_path)
    seen = {}

    async def fake_set_ntp(servers, poll_max_sec=2048, sudo=False):
        seen["servers"] = servers
        return {"ok": True}
    monkeypatch.setattr(webmon.clockcfg, "set_ntp", fake_set_ntp)

    async def go(c):
        r = await c.post("/api/clock", json={"servers": ["a.pool.ntp.org", "b.pool.ntp.org"]})
        return await r.json()

    assert _serve(app, go)["ok"] is True
    assert seen["servers"] == ["a.pool.ntp.org", "b.pool.ntp.org"]


def test_a_timezone_change_re_anchors_the_capture_clock(tmp_path, monkeypatch):
    """§A1, and the whole reason the hook exists. `_now()` reads a zone move as a DST relabelling —
    offset delta equals apparent drift by construction — so without this the box answers ok, reports the
    new zone, and silently stamps every subsequent file an hour off. Only this handler knows the change
    was intended."""
    called = []
    app, *_ = _mk(tmp_path, on_tz_change=lambda reason: called.append(reason))

    async def fake_set_tz(tz, sudo=False):
        return {"ok": True, "timezone": tz}
    monkeypatch.setattr(webmon.clockcfg, "set_tz", fake_set_tz)

    async def go(c):
        return await (await c.post("/api/clock/tz", json={"timezone": "Europe/Prague"})).json()

    assert _serve(app, go)["ok"] is True
    assert called == ["timezone set to Europe/Prague"]


def test_a_failing_re_anchor_hook_does_not_fail_the_timezone_change(tmp_path, monkeypatch):
    """The zone HAS been changed on the host by the time the hook runs. Reporting failure over the
    bookkeeping would tell the operator to retry a change that already took effect."""
    def boom(_reason):
        raise RuntimeError("anchor exploded")
    app, *_ = _mk(tmp_path, on_tz_change=boom)

    async def fake_set_tz(tz, sudo=False):
        return {"ok": True, "timezone": tz}
    monkeypatch.setattr(webmon.clockcfg, "set_tz", fake_set_tz)

    async def go(c):
        r = await c.post("/api/clock/tz", json={"timezone": "Europe/Prague"})
        return r.status, await r.json()

    status, body = _serve(app, go)
    assert status == 200 and body["ok"] is True


def test_no_re_anchor_when_the_timezone_change_itself_failed(tmp_path, monkeypatch):
    """The hook is gated on `ok` — re-anchoring the capture clock for a change that did not happen would
    introduce exactly the offset error it exists to prevent."""
    called = []
    app, *_ = _mk(tmp_path, on_tz_change=lambda reason: called.append(reason))

    async def fake_set_tz(tz, sudo=False):
        return {"ok": False, "error": "no such zone"}
    monkeypatch.setattr(webmon.clockcfg, "set_tz", fake_set_tz)

    async def go(c):
        return await (await c.post("/api/clock/tz", json={"timezone": "Mars/Olympus"})).json()

    assert _serve(app, go)["ok"] is False
    assert called == []


# ── settings_post: the arms where nothing changed ─────────────────────────────────────────────────
def _dev_with_rates():
    d = dict(H10)
    d["streams"] = ["ecg"]
    d["rates"] = {"ecg": 130}
    return d


def test_reposting_the_identical_settings_changes_nothing_and_writes_nothing(tmp_path):
    """The monitor re-POSTs the whole form on every save, so this is the COMMON path. It must not
    back the config up, must not rewrite it, and must not claim a restart is needed — a spurious
    `restart_needed` on a no-op save costs a night's capture if the operator acts on it."""
    app, cfg, status, cfg_path, _ = _mk(tmp_path, devices=[_dev_with_rates()],
                                        status={"H10": {"pmd_supported": ["ecg", "acc"],
                                                        "pmd_options": {"ecg": [130]}}})
    open(cfg_path, "w").write("root: x\n")

    async def go(c):
        r = await c.post("/api/settings", json={
            "streams": {H10["address"]: ["ecg"]},          # identical to config
            "rates": {H10["address"]: {"ecg": 130}},       # identical to config
        })
        return await r.json()

    body = _serve(app, go)
    assert body["ok"] is True
    assert body["changed"] == [] and not body.get("restart_needed")
    assert not os.path.exists(cfg_path + ".bak"), "a no-op save must not back the config up"


def test_a_settings_key_already_at_the_requested_value_is_not_listed_as_changed(tmp_path):
    """`changed` is what the UI echoes back to the operator. Listing a key that did not move teaches
    them the echo means nothing."""
    app, cfg, *_ = _mk(tmp_path)

    async def go(c):
        first = await (await c.post("/api/settings",
                                    json={"settings": {"power.drop_not_worn_sec": 600}})).json()
        again = await (await c.post("/api/settings",
                                    json={"settings": {"power.drop_not_worn_sec": 600}})).json()
        return first, again

    first, again = _serve(app, go)
    assert first["changed"] == ["power.drop_not_worn_sec"]
    assert again["changed"] == [], "the second save moved nothing"


def test_an_unknown_stream_in_a_rates_map_is_refused(tmp_path):
    """The rates map is keyed by stream name. An unknown key would be persisted and then silently
    ignored at connect — a rate the operator set, saved successfully, and that never applied.

    ⚠️ `eeg` is NOT the name to test with: it is already in KNOWN_STREAMS (the planned EEGDex node), so
    it validates fine and would make this test pass for the wrong reason."""
    app, *_ = _mk(tmp_path, devices=[_dev_with_rates()])
    assert "eeg" in webmon.KNOWN_STREAMS and "emg" not in webmon.KNOWN_STREAMS

    async def go(c):
        r = await c.post("/api/settings", json={"rates": {H10["address"]: {"emg": 250}}})
        return r.status, await r.json()

    status, body = _serve(app, go)
    assert status == 400 and "unknown stream 'emg'" in body["error"]


# ── remember: a device that has no established identity yet ───────────────────────────────────────
def test_remember_takes_the_incoming_device_id_when_none_is_established(tmp_path):
    """The keep-the-established-id rule only bites once there IS one. A device remembered without an id
    (an unrecognised sensor the browser could not read a serial from) must be able to gain one on a
    later scan — otherwise it can never be corrected at all."""
    bare = {k: v for k, v in H10.items() if k != "device_id"}
    app, cfg, *_ = _mk(tmp_path, devices=[bare])
    assert not cfg["devices"][0].get("device_id")

    async def go(c):
        r = await c.post("/api/remember", json={**H10, "device_id": "02849638"})
        return r.status, await r.json()

    status, body = _serve(app, go)
    assert status == 200 and body["ok"] is True
    assert cfg["devices"][0]["device_id"] == "02849638"
    assert len(cfg["devices"]) == 1, "a re-remember merges, it does not append"


# ── SSE: a stream opened while the daemon is already shutting down ────────────────────────────────
def test_a_stream_opened_during_shutdown_returns_at_once(tmp_path):
    """SIGTERM left the daemon alive past 101 s with an open monitor (2026-07-20). The loop is gated on
    the shutdown flag at the TOP as well as after the wake, so a connection arriving during teardown
    sends its snapshot and ends rather than parking in `q.get()` for a keep-alive period."""
    app, *_ = _mk(tmp_path)

    async def go(c):
        for handler in app.on_shutdown:            # what aiohttp fires before it waits
            await handler(app)
        r = await c.get("/api/stream/ecg")
        return r.status, await r.text()

    status, text = _serve(app, go)
    assert status == 200
    assert "event: snapshot" in text
    assert "\ndata: " in text or text.endswith("\n\n")
