# tepna-capture — tests/test_webmon_error_contract.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# EVERY ERROR RESPONSE, ASSERTED WHOLE.
#
# Mutation pass 2026-08-02. `webmon.py` measured 2 345 mutants with 395 surviving (82 % killed) and
# 386 of the 395 inside `make_app` — one function holding the whole aiohttp route table. The single
# largest cluster in it was this:
#
#     {"ok": False, "error": "..."}   ->   {"ok": True, "error": "..."}       status 400 / 409 / 500 / 502
#
# Forty-nine mutants of that shape survived. The existing tests assert `resp.status`, and a handful
# assert `body["ok"] is True` on SUCCESS paths — but nothing read the body of a FAILURE. So every error
# response in the monitor could report success to a client that branches on `ok`, and the browser does:
# a failed bond, a refused CPAP pull and a config write that hit a full disk would all render as done.
#
# The fix is not more assertions on `status`. It is asserting the response OBJECT, which is what the
# route actually returns — the same reason `pull_recording`'s manifest and `HostClockLogWriter`'s row
# are asserted whole elsewhere in this suite.

import asyncio
import json

import pytest
import webmon
from aiohttp.test_utils import TestClient, TestServer

from tests.test_webmon_api import H10, _mk, _serve


@pytest.fixture(autouse=True)
def _no_real_bluetoothctl(monkeypatch):
    async def fake_bond(*a, **k):
        return True
    monkeypatch.setattr(webmon.bonding, "ensure_bonded", fake_bond)


def _post(app, path, payload, raw=False):
    async def go(c):
        r = await (c.post(path, data=payload) if raw else c.post(path, json=payload))
        return r.status, await r.json()
    return _serve(app, go)


# ── the shape itself: ok is False on every failure, and it is the whole body ────────────────────────
def test_a_non_object_body_is_refused_with_the_documented_error(tmp_path):
    """`_bad_body_response` — the shared refusal every POST routes through. A JSON array or a bare
    string is not a request; accepting one lets `body.get(...)` raise deep inside a handler instead."""
    app, *_ = _mk(tmp_path)
    status, body = _post(app, "/api/bond", json.dumps([1, 2, 3]), raw=True)
    assert status == 400
    assert body == {"ok": False, "error": "request body must be a JSON object"}


@pytest.mark.parametrize("path", ["/api/bond", "/api/forget", "/api/remember"])
def test_an_invalid_mac_is_refused_identically_on_every_route_that_takes_one(tmp_path, path):
    """Three separate `{"ok": False, "error": "invalid device address"}` sites, each with its own
    mutants. A caller that trusts `ok` would proceed to pair, unpair or persist a device whose address
    the module just rejected."""
    app, *_ = _mk(tmp_path)
    status, body = _post(app, path, {"address": "not-a-mac"})
    assert status == 400
    assert body == {"ok": False, "error": "invalid device address"}


def test_an_unidentified_device_is_refused_with_the_fields_that_are_missing(tmp_path):
    """The `missing` list is the actionable half — the pairing screen renders it — and it survived
    being renamed or nulled. Asserting only `status == 400` cannot see that."""
    app, *_ = _mk(tmp_path)
    dev = {**H10, "address": "11:22:33:44:55:66", "vendor": "  ", "model": "  "}
    status, body = _post(app, "/api/remember", dev)
    assert status == 400
    assert body == {"ok": False, "missing": ["vendor", "model"],
                    "error": "unidentified device — missing vendor, model"}


def test_a_config_write_that_fails_reports_failure_rather_than_success(tmp_path, monkeypatch):
    """`{"ok": False, "error": "config write failed (disk?)"}` at 500 — the response that exists for a
    full or read-only disk. Under the surviving mutant it answered `ok: True`, so the monitor would
    show a device forgotten while config.yaml still lists it and the daemon keeps reconnecting."""
    async def fake_forget(*a, **k):
        return {"ok": True, "address": H10["address"]}
    monkeypatch.setattr(webmon.bonding, "forget", fake_forget)
    # make the atomic write's mkstemp fail the way a full / read-only disk does — _save() catches it
    # and returns False, which is the branch under test
    import tempfile
    app, *_ = _mk(tmp_path)

    def no_disk(*a, **k):
        raise OSError(28, "No space left on device")
    monkeypatch.setattr(tempfile, "mkstemp", no_disk)
    status, body = _post(app, "/api/forget", {"address": H10["address"]})
    assert status == 500
    assert body == {"ok": False, "error": "config write failed (disk?)"}


# ── the CPAP pull's four refusals ───────────────────────────────────────────────────────────────────
def test_a_cpap_pull_is_refused_when_the_harvest_is_disabled(tmp_path):
    app, *_ = _mk(tmp_path)
    status, body = _post(app, "/api/cpap/pull", {})
    assert status == 400
    assert body == {"ok": False, "error": "cpap harvest is disabled in config"}


def test_a_cpap_pull_names_the_scope_it_did_not_understand(tmp_path):
    """The `!r` on the scope is what makes the message actionable, and it survived. A caller sending a
    typo gets back which typo."""
    app, cfg, *_ = _mk(tmp_path)
    cfg["cpap"] = {"enabled": True}
    status, body = _post(app, "/api/cpap/pull", {"scope": "yesterday"})
    assert status == 400
    assert body == {"ok": False, "error": "unknown scope 'yesterday'"}


def test_a_cpap_pull_refuses_while_sensors_are_streaming_and_names_them(tmp_path):
    """409, not 500: the interlock working as designed. The `busy` list is the operator's instruction —
    it says which sensor to wait for — and a mutant that nulls it leaves them guessing.

    The interlock itself is not cosmetic: measured 2026-07-26, a pull next to a recording sensor cost
    5-7 dB and 17 reconnects across three of them."""
    app, cfg, st, *_ = _mk(tmp_path)
    cfg["cpap"] = {"enabled": True}
    st["devices"] = {"H10": {"connected": True, "streaming": True}}
    status, body = _post(app, "/api/cpap/pull", {"scope": "last"})
    assert status == 409
    assert body["ok"] is False
    assert body["busy"] == ["H10"]
    assert body["error"] == "sensors are streaming: H10"


def test_a_cpap_pull_that_raises_reports_the_exception_type_and_message(tmp_path, monkeypatch):
    """`f"{type(e).__name__}: {e}"` — three mutants replaced `type(e)` with `type(None)`, which reports
    every failure as `NoneType`. A manual pull must never 500 the monitor, so this string is the only
    thing the operator gets."""
    app, cfg, *_ = _mk(tmp_path)
    cfg["cpap"] = {"enabled": True}

    def boom(*a, **k):
        raise ConnectionResetError("card never associated")
    import cpap_harvest                      # webmon imports it inside the handler
    # inside `_work`, which is what the try/except actually wraps
    monkeypatch.setattr(cpap_harvest, "reachable", boom)
    monkeypatch.setattr(cpap_harvest, "nights_for", lambda *a, **k: [])
    status, body = _post(app, "/api/cpap/pull", {"scope": "last"})
    assert status == 500
    assert body == {"ok": False, "error": "ConnectionResetError: card never associated"}


# ── the busy/holder responses ───────────────────────────────────────────────────────────────────────
def test_a_stored_pull_that_is_unavailable_says_so_rather_than_succeeding(tmp_path):
    app, *_ = _mk(tmp_path)                       # no pull_stored wired in
    status, body = _post(app, "/api/pull", {"which": "all"})
    assert status == 400
    assert body == {"ok": False, "detail": "stored-session pull not available"}


# ═══════════════════════════════════════════════════════════════════════════════════════════════════
# THE ARGUMENTS THE DOUBLES WERE THROWING AWAY
#
# Second-largest cluster: ~40 mutants that null or drop an argument on the way into a helper.
# `bonding.bond(None, adapter_mac)`, `bonding.ensure_bonded(address, None)`,
# `cpap_harvest.reachable(base, None)`, `clockcfg.set_ntp(servers, body.get(None, 2048))`. Every one
# survived, and every one for the same reason: the stub was `async def fake(*a, **k): return {...}`,
# which cannot tell being handed the right address from being handed None.
#
# The adapter argument is the sharp one. This box has three BLE radios (VIGIL §radios), so an
# `adapter_mac` that is computed and then dropped means the bond, the unpair, or the pull goes out of
# whichever controller BlueZ happens to pick.
# ═══════════════════════════════════════════════════════════════════════════════════════════════════

ADAPTER = "AA:AA:AA:AA:AA:AA"


def test_bonding_is_told_which_device_and_which_radio(tmp_path, monkeypatch):
    """`bonding.bond(None, adapter_mac)` and `bonding.bond(body["address"], None)` and the whole
    argument dropped — three mutants, all invisible to a stub that ignored what it was handed."""
    seen = {}

    async def fake_bond(address, adapter):
        seen["args"] = (address, adapter)
        return {"ok": True, "detail": "paired"}
    monkeypatch.setattr(webmon.bonding, "bond", fake_bond)
    app, *_ = _mk(tmp_path)
    status, body = _post(app, "/api/bond", {"address": "11:22:33:44:55:66"})
    assert status == 200 and body["ok"] is True
    assert seen["args"] == ("11:22:33:44:55:66", ADAPTER)


def test_forgetting_is_told_which_device_and_which_radio(tmp_path, monkeypatch):
    """The unpair side: `bonding.forget(None, adapter_mac)` and `forget(adapter_mac)` — the second
    passes the ADAPTER as the address, so the box would unpair its own controller entry."""
    seen = {}

    async def fake_forget(address, adapter):
        seen["args"] = (address, adapter)
        return {"ok": True}
    monkeypatch.setattr(webmon.bonding, "forget", fake_forget)
    app, cfg, *_ = _mk(tmp_path)
    status, body = _post(app, "/api/forget", {"address": H10["address"]})
    assert status == 200
    assert seen["args"] == (H10["address"], ADAPTER)
    assert [d["address"] for d in cfg["devices"]] == [], "and the device leaves the config"


def test_a_forget_that_is_not_a_device_leaves_the_other_devices_alone(tmp_path, monkeypatch):
    """`cfg.get("devices", [])` → `cfg.get(None, [])` / `cfg.get("DEVICES", [])`: the comprehension then
    reads an empty list and the rewrite WIPES the device list. Nothing asserted the survivors."""
    async def fake_forget(*a, **k):
        return {"ok": True}
    monkeypatch.setattr(webmon.bonding, "forget", fake_forget)
    other = {**H10, "name": "Verity", "address": "11:22:33:44:55:66"}
    app, cfg, *_ = _mk(tmp_path, devices=[H10, other])
    _post(app, "/api/forget", {"address": H10["address"]})
    assert [d["address"] for d in cfg["devices"]] == ["11:22:33:44:55:66"], \
        "forgetting one device must not empty the list"


# ═══════════════════════════════════════════════════════════════════════════════════════════════════
# THE ATOMIC CONFIG WRITE
#
# ~20 mutants in `_save()`. The docstring explains at length why this is atomic — a truncating write
# left config.yaml empty on a full disk, and "the daemon comes up with an empty device list and records
# nothing, all night, with no error at the time of the damage". What no test checked is the mechanics
# that make it atomic: the temp file must be a SIBLING (`dir=d`), or `os.replace` is a cross-filesystem
# move and the atomicity is gone.
# ═══════════════════════════════════════════════════════════════════════════════════════════════════

def test_the_config_temp_file_is_written_beside_the_config(tmp_path, monkeypatch):
    """`tempfile.mkstemp(..., dir=None)` puts the temp in /tmp, so `os.replace` crosses filesystems and
    raises instead of being atomic — and `dir=d` where `d` came from `os.path.dirname(...) and "."`
    (mutant 777) is the empty string. Both survived; neither is visible from the file's contents."""
    seen = {}
    import tempfile as _tf
    real = _tf.mkstemp

    def spy(**kw):
        seen.update(kw)
        return real(**kw)
    monkeypatch.setattr(_tf, "mkstemp", spy)

    async def fake_forget(*a, **k):
        return {"ok": True}
    monkeypatch.setattr(webmon.bonding, "forget", fake_forget)
    app, _cfg, _st, cfg_path, _bus = _mk(tmp_path)
    status, _ = _post(app, "/api/forget", {"address": H10["address"]})
    assert status == 200

    import os as _os
    assert seen["dir"] == _os.path.dirname(_os.path.abspath(cfg_path)), \
        "a sibling temp — os.replace is only atomic within one filesystem"
    assert seen["prefix"] == ".config." and seen["suffix"] == ".yaml.tmp", \
        "dotted and suffixed so a crashed write is recognisable and is not mistaken for the config"
    assert not _os.path.exists(seen["dir"] + "/" + ".config."), "no temp left behind"


def test_the_written_config_keeps_its_key_order_and_stays_block_style(tmp_path, monkeypatch):
    """`sort_keys=False` → `True` and `default_flow_style=False` → `True`. The operator reads and
    re-comments this file by hand (the docstring records four hand-made backups made for exactly that
    reason), so alphabetising it or collapsing it to `{a: 1, b: 2}` makes the diff unreadable — which
    is the whole cost the comment-loss warning already accepts once."""
    async def fake_forget(*a, **k):
        return {"ok": True}
    monkeypatch.setattr(webmon.bonding, "forget", fake_forget)
    app, cfg, _st, cfg_path, _bus = _mk(tmp_path)
    cfg["zzz_last"] = 1
    cfg["aaa_first"] = 2
    _post(app, "/api/forget", {"address": H10["address"]})

    text = open(cfg_path).read()
    body = [ln for ln in text.splitlines() if ln and not ln.startswith("#")]
    assert body.index("zzz_last: 1") < body.index("aaa_first: 2"), \
        "insertion order, not alphabetical — this file is read by a human"
    assert "{" not in text, "block style, not flow style"


# ═══════════════════════════════════════════════════════════════════════════════════════════════════
# THE SSE STREAM — the monitor's only live surface
#
# ~30 survivors. The existing test reads ONE frame and asserts `b"72" in frame`, which is a substring
# check on a byte string: it cannot see the response headers, the snapshot event, the `_all` multiplex,
# or the shutdown sentinel. The headers matter operationally — `X-Accel-Buffering: no` is what stops a
# reverse proxy buffering an event stream into uselessness, and `Cache-Control: no-cache` is what stops
# it being replayed from cache. Both were free to be mangled.
#
# HTTP header NAMES are case-insensitive, so the `"CONTENT-TYPE"` mutants are equivalent and are
# expected to survive; the VALUES are not, and those are pinned.
# ═══════════════════════════════════════════════════════════════════════════════════════════════════

def _sse(app, key, after=None, frames=1, snapshots=1, timeout=3.0):
    """Open an SSE connection, drain `snapshots` snapshot frames, run `after`, collect `frames` data
    frames. `_all` opens with one snapshot PER known stream, which is itself part of the contract."""
    async def go():
        srv = TestServer(app)
        cl = TestClient(srv)
        await cl.start_server()
        try:
            resp = await cl.get(f"/api/stream/{key}")
            snaps = [await asyncio.wait_for(resp.content.readuntil(b"\n\n"), timeout=timeout)
                     for _ in range(snapshots)]
            if after:
                after()
            got = []
            for _ in range(frames):
                got.append(await asyncio.wait_for(resp.content.readuntil(b"\n\n"), timeout=timeout))
            return dict(resp.headers), snaps, got
        finally:
            await cl.close()
    return asyncio.run(go())


def test_the_event_stream_sets_the_headers_that_keep_it_streaming(tmp_path):
    """`text/event-stream` → `TEXT/EVENT-STREAM`, `no-cache` → `NO-CACHE`, `no` → `NO`. A media type is
    matched case-insensitively by browsers, but `X-Accel-Buffering` is read by nginx as an exact token:
    mangled, the proxy buffers the stream and the monitor stops updating until the buffer fills."""
    app, _cfg, _st, _p, bus = _mk(tmp_path)
    headers, _snaps, _ = _sse(app, "hr", after=lambda: bus.push("hr", [72], fs=1.0))
    assert headers["Content-Type"] == "text/event-stream"
    assert headers["Cache-Control"] == "no-cache"
    assert headers["X-Accel-Buffering"] == "no"


def test_a_single_stream_subscription_receives_only_its_own_frames(tmp_path):
    """`msg["stream"] != key` → `==` inverts the filter, so a subscriber to `hr` gets everything except
    `hr`. The existing test pushed a non-matching frame but asserted only that `b"72"` appeared
    somewhere — a substring in a byte blob cannot see that the wrong frames also arrived."""
    app, _cfg, _st, _p, bus = _mk(tmp_path)

    def push():
        bus.push("acc", [1, 2, 3], fs=50.0)      # must be filtered out
        bus.push("hr", [72], fs=1.0)             # must arrive

    _h, _snaps, frames = _sse(app, "hr", after=push)
    payload = json.loads(frames[0].decode().split("data: ", 1)[1])
    assert payload["stream"] == "hr", f"a non-matching frame reached an hr subscriber: {payload}"


def test_the_all_key_multiplexes_every_stream_over_one_connection(tmp_path):
    """`allmode = (key == "_all")` → `None` / `"_ALL"`. Both make `_all` behave as a literal stream
    name, which matches nothing — so the Overview page goes permanently blank while every test that
    subscribes to a single stream still passes. Browsers cap ~6 connections per host, which is why this
    multiplex exists at all."""
    app, _cfg, _st, _p, bus = _mk(tmp_path)

    def push():
        bus.push("acc", [1, 2, 3], fs=50.0)
        bus.push("hr", [72], fs=1.0)

    n_snap = len(bus.meta())
    assert n_snap > 1, "the multiplex only means something with more than one known stream"
    _h, snaps, frames = _sse(app, "_all", after=push, frames=2, snapshots=n_snap)
    assert all(s.startswith(b"event: snapshot\n") for s in snaps), \
        "_all opens with one snapshot per known stream, not one for the literal key '_all'"
    streams = [json.loads(f.decode().split("data: ", 1)[1])["stream"] for f in frames]
    assert streams == ["acc", "hr"], "_all forwards every stream, in order, unfiltered"


def test_the_first_frame_is_a_snapshot_of_the_stream_that_was_asked_for(tmp_path):
    """`bus.snapshot(k)` → `bus.snapshot(None)` and `json.dumps(None)`. The snapshot is what paints the
    monitor before any new sample arrives; nulled, the page opens empty and stays empty until the next
    push, which for a 1 Hz stream is a second and for `ppi` can be a minute."""
    app, _cfg, _st, _p, bus = _mk(tmp_path)
    bus.push("hr", [72], fs=1.0)
    _h, snaps, _ = _sse(app, "hr", after=lambda: bus.push("hr", [73], fs=1.0))
    snapshot = snaps[0]
    assert snapshot.startswith(b"event: snapshot\n"), "the SSE event name the client dispatches on"
    payload = json.loads(snapshot.decode().split("data: ", 1)[1])
    assert payload is not None and payload.get("stream") == "hr"


# ═══════════════════════════════════════════════════════════════════════════════════════════════════
# GUARD INVERSIONS AND DEFAULTS NO CALLER EXERCISES
#
# The small cluster with the sharpest teeth. Six `and` → `or` swaps and a dozen `cfg.get(key, DEFAULT)`
# fallbacks, none of which any test reached — the fixtures always supply the key, which is exactly the
# input that cannot distinguish a default from a value.
# ═══════════════════════════════════════════════════════════════════════════════════════════════════

def test_the_archive_is_not_enabled_without_a_target(tmp_path):
    """`bool(body.get("enabled", True)) and tgt is not None` → `or`. Under the mutant the archive is
    marked enabled with NO target configured, so the nightly offload runs against nothing and reports
    success — the fabricated-completeness shape this suite refuses everywhere else."""
    app, cfg, *_ = _mk(tmp_path)
    status, body = _post(app, "/api/storage", {"enabled": True, "schedule": {"mode": "after_settle"}})
    assert status == 200
    assert cfg["archive"]["enabled"] is False, "enabled requires a target, not just the flag"
    assert "target" not in cfg["archive"]


def test_the_archive_enabled_flag_defaults_to_on_when_a_target_is_given(tmp_path, monkeypatch):
    """`body.get("enabled", True)` → `False`: the default an operator hits by POSTing a target without
    the flag, which the monitor's form does. Flipped, saving a target silently leaves the archive off."""
    monkeypatch.setattr(webmon.storage_targets, "validate",
                        lambda t: {"kind": "mount", "mountpoint": str(tmp_path / "m"),
                                   "protocol": "local"})
    app, cfg, *_ = _mk(tmp_path)
    status, _ = _post(app, "/api/storage", {"schedule": {"mode": "after_settle"}, "target": {"kind": "mount"}})
    assert status == 200
    assert cfg["archive"]["enabled"] is True, "a target supplied and no flag means enabled"


def test_an_established_device_id_is_not_overwritten_by_a_rescan(tmp_path):
    """`if incoming.get("device_id") and incoming[...] != existing[...]` → `or`. The docstring records
    what this cost on the real box: guessDevice() derived `AC0C301E` from the MAC where the Verity's
    real serial is `0C301E3F`, and one night's files split across two identities — because device_id is
    interpolated into every capture filename. An `or` here re-fires the branch even when the incoming
    id is absent."""
    app, cfg, *_ = _mk(tmp_path)
    status, body = _post(app, "/api/remember", {**H10, "device_id": "AC0C301E"})
    assert status == 200 and body["ok"] is True
    assert cfg["devices"][0]["device_id"] == "12345678", \
        "an established identity wins over a rescan's guess"


def test_a_rescan_does_not_erase_the_tuned_keys_it_did_not_send(tmp_path):
    """The merge itself, and the `_KEYS` allowlist whose members survived being renamed. One pass
    through the pairing screen used to erase `rates:` from both sensors — the decision that cut 71 % of
    the box's bytes — leaving nightqc grading coverage against a nominal nobody chose."""
    tuned = {**H10, "rates": {"acc": 50}, "optional": True}
    app, cfg, *_ = _mk(tmp_path, devices=[tuned])
    _post(app, "/api/remember", {k: H10[k] for k in
                                 ("name", "vendor", "model", "device_id", "address", "streams")})
    assert cfg["devices"][0]["rates"] == {"acc": 50}, "a re-remember is idempotent on untouched keys"
    assert cfg["devices"][0]["optional"] is True


def test_the_cpap_destination_falls_back_to_the_documented_defaults(tmp_path, monkeypatch):
    """`cfg.get("root", "/srv/tepna")` (four sites), `dest_subdir` → `"captures/cpap"`, `wifi_profile`
    → `"ezshare"`, `max_run_sec` → `5400`. Case-flipped they point at `/SRV/TEPNA`, which on a
    case-sensitive filesystem is a different directory that does not exist — and the `root` fallback is
    the one a config without an explicit `root:` actually takes."""
    seen = {}
    import cpap_harvest

    def spy_harvest(dest, base, nights, deadline):
        seen["dest"] = dest
        return {"short": [], "errors": [], "files": 0, "bytes": 0, "nights": 0,
                "skipped": 0, "nights_on_card": 0}

    def spy_wifi_up(profile, timeout, guard, root=None):
        seen["profile"], seen["root"] = profile, root
        return True
    monkeypatch.setattr(cpap_harvest, "reachable", lambda *a, **k: False)
    monkeypatch.setattr(cpap_harvest, "default_route_dev", lambda: "eth0")
    monkeypatch.setattr(cpap_harvest, "wifi_up", spy_wifi_up)
    monkeypatch.setattr(cpap_harvest, "wifi_down", lambda *a, **k: None)
    monkeypatch.setattr(cpap_harvest, "nights_for", lambda *a, **k: ["2026-08-01"])
    monkeypatch.setattr(cpap_harvest, "harvest", spy_harvest)
    monkeypatch.setattr(cpap_harvest, "blocking_devices", lambda *a, **k: [])

    app, cfg, *_ = _mk(tmp_path)
    del cfg["root"]                                  # no root configured — the fallback is the subject
    cfg["cpap"] = {"enabled": True}
    status, _ = _post(app, "/api/cpap/pull", {"scope": "last"})
    assert status == 200
    import os as _os
    assert seen["dest"] == _os.path.join("/srv/tepna", "captures/cpap")
    assert seen["root"] == "/srv/tepna", \
        "root MUST reach wifi_up — omitting it falls through to /tmp, read-only under ProtectSystem=strict"
    assert seen["profile"] == "ezshare"


def test_the_cpap_reachability_probe_is_bounded(tmp_path, monkeypatch):
    """`cpap_harvest.reachable(base, 5.0)` → `(base, None)` / the argument dropped. None reaches the
    socket layer as 'wait forever', on the code path whose entire job is deciding quickly whether the
    card needs Wi-Fi association at all."""
    seen = {}
    import cpap_harvest

    def spy_reachable(base, timeout):
        seen["args"] = (base, timeout)
        return True
    monkeypatch.setattr(cpap_harvest, "reachable", spy_reachable)
    monkeypatch.setattr(cpap_harvest, "nights_for", lambda *a, **k: [])
    monkeypatch.setattr(cpap_harvest, "blocking_devices", lambda *a, **k: [])
    monkeypatch.setattr(cpap_harvest, "harvest", lambda *a, **k: {
        "short": [], "errors": [], "files": 0, "bytes": 0, "nights": 0, "skipped": 0,
        "nights_on_card": 0})
    app, cfg, *_ = _mk(tmp_path)
    cfg["cpap"] = {"enabled": True}
    _post(app, "/api/cpap/pull", {"scope": "last"})
    assert seen["args"] == (cpap_harvest.DEFAULT_BASE, 5.0)


# ═══════════════════════════════════════════════════════════════════════════════════════════════════
# ROUND TWO — what the first round could not see
#
# The first pass took webmon from 82 % to 87 %. Re-reading the residue showed two blind spots that were
# properties of the FIXTURES, not of the tests:
#
#   1. `cfg.get("devices", [])` -> `cfg.get("devices")`. Identical while the key is present, and every
#      fixture supplies it. Only a config WITHOUT `devices` — a freshly-provisioned box, before the
#      first pairing — can tell them apart, and then the difference is `None` where a list is iterated.
#   2. The `{"ok": False}` -> `{"ok": True}` shape on the routes round one did not reach: the Polar
#      pull, timesync, the settings 400 and the 502/409 wrappers. Same defect, different handlers.
# ═══════════════════════════════════════════════════════════════════════════════════════════════════

def _mk_bare(tmp_path, **kw):
    """An app whose config has NO `devices` key at all — a box that has never been paired."""
    import telemetry as _t
    cfg = {"root": str(tmp_path), "clock": {"sudo": False}}          # note: no "devices"
    st = {"host_clock": {"source": "ntp"}, "devices": {}}
    app = webmon.make_app(_t.TelemetryBus(), cfg, str(tmp_path / "config.yaml"),
                          ADAPTER, st, None, **kw)
    return app, cfg, st


def test_a_box_that_has_never_been_paired_serves_an_empty_device_list(tmp_path):
    """`cfg.get("devices", [])` with the default dropped returns None, and `for d in None` raises — a
    500 on the monitor's first ever page load, which is exactly when nobody is watching a log."""
    app, *_ = _mk_bare(tmp_path)

    async def go(c):
        r = await c.get("/api/state")
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 200 and body["devices"] == []


def test_remembering_the_first_device_on_a_bare_config_works(tmp_path):
    """`cfg.setdefault("devices", [])` → `setdefault("devices", None)`: the very next line appends to
    it. The first pairing on a new box is the only call that reaches this."""
    app, cfg, _st = _mk_bare(tmp_path)
    status, body = _post(app, "/api/remember", H10)
    assert status == 200 and body["ok"] is True
    assert [d["address"] for d in cfg["devices"]] == [H10["address"]]


def test_settings_and_timesync_survive_a_bare_config(tmp_path):
    """Three more `cfg.get("devices", )` sites, each on a route the monitor calls at load."""
    app, *_ = _mk_bare(tmp_path)

    async def go(c):
        s = await c.get("/api/settings")
        return s.status, await s.json()
    status, body = _serve(app, go)
    assert status == 200 and body["devices"] == []


# ── the error bodies round one did not reach ────────────────────────────────────────────────────────
def test_a_polar_listing_for_an_unknown_address_is_refused(tmp_path):
    app, *_ = _mk(tmp_path)

    async def go(c):
        r = await c.get("/api/polar/recordings?address=99:99:99:99:99:99")
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 400
    assert body == {"ok": False, "error": "unknown or non-Polar address"}


def test_a_polar_pull_with_a_bad_address_or_session_is_refused(tmp_path):
    app, *_ = _mk(tmp_path)
    status, body = _post(app, "/api/polar/pull", {"address": "99:99:99:99:99:99", "session": ""})
    assert status == 400
    assert body == {"ok": False, "error": "bad address or session path"}


def test_a_polar_listing_that_raises_reports_the_exception_as_a_bad_gateway(tmp_path, monkeypatch):
    """502 with `f"{type(e).__name__}: {e}"` — three sites, each with a `type(None)` mutant that reports
    every BLE fault as `NoneType`. The device is upstream of the monitor, so 502 is the honest code."""
    import polar_psftp
    polar = {**H10, "vendor": "Polar", "address": "24:AC:AC:0C:30:1E"}

    async def boom(*a, **k):
        raise ConnectionError("device disconnected mid-discovery")
    monkeypatch.setattr(polar_psftp, "list_recordings", boom)
    app, *_ = _mk(tmp_path, devices=[polar])

    async def go(c):
        r = await c.get("/api/polar/recordings?address=24:AC:AC:0C:30:1E")
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 502
    assert body == {"ok": False, "error": "ConnectionError: device disconnected mid-discovery"}


def test_a_polar_listing_that_is_busy_reports_the_holder_of_the_lock(tmp_path, monkeypatch):
    """409, and `busy` names WHICH operation holds the single offline slot — the actionable half, and
    the reason this is not a 500."""
    import offline_lock
    import polar_psftp
    polar = {**H10, "vendor": "Polar", "address": "24:AC:AC:0C:30:1E"}

    async def busy(*a, **k):
        raise offline_lock.OfflineBusy("o2ring pull")
    monkeypatch.setattr(polar_psftp, "list_recordings", busy)
    app, *_ = _mk(tmp_path, devices=[polar])

    async def go(c):
        r = await c.get("/api/polar/recordings?address=24:AC:AC:0C:30:1E")
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 409
    assert body["ok"] is False and body["busy"] == "o2ring pull"


def test_timesync_for_an_unknown_address_is_refused(tmp_path):
    app, *_ = _mk(tmp_path)
    status, body = _post(app, "/api/timesync", {"address": "99:99:99:99:99:99"})
    assert status == 400
    assert body == {"ok": False, "error": "unknown address"}


def test_a_settings_post_that_is_rejected_reports_why(tmp_path):
    """`{"ok": False, "error": str(e)}` at 400 — the SettingsError text is the whole message the form
    renders, and `str(None)` / `ok: True` both survived."""
    app, *_ = _mk(tmp_path)
    status, body = _post(app, "/api/settings",
                         {"streams": {H10["address"]: ["not_a_stream"]}})
    assert status == 400
    assert body["ok"] is False
    assert "unknown stream(s): not_a_stream" in body["error"]


# ── paths, defaults and arithmetic ──────────────────────────────────────────────────────────────────
def test_the_index_page_is_served_from_beside_the_module(tmp_path):
    """`os.path.join(_HERE, "monitor.html")` → `os.path.join("monitor.html")`, which resolves against
    the process's working directory. Under systemd that is `/`, so the monitor 404s on a box where it
    works fine from a shell in the source tree — the same directory-dropped defect as
    `polar_psftp`'s sidecar."""
    app, *_ = _mk(tmp_path)
    import os as _os
    cwd = _os.getcwd()
    _os.chdir(tmp_path)                      # a working directory that is NOT the module's
    try:
        async def go(c):
            r = await c.get("/")
            return r.status, await r.text()
        status, text = _serve(app, go)
    finally:
        _os.chdir(cwd)
    assert status == 200 and "Tepna Vigil" in text


def test_the_timeline_bucket_count_has_a_default_and_is_clamped(tmp_path):
    """`int(req.query.get("buckets", DEFAULT))` with the default dropped is `int(None)` — a 500 on the
    monitor's timeline tab, which never passes `buckets` explicitly."""
    night = tmp_path / "captures" / "2026-07-19"
    night.mkdir(parents=True)
    (night / "Polar_H10_12345678_20260719031641_ECG.txt").write_text("Phone timestamp\n")
    app, *_ = _mk(tmp_path)

    async def go(c):
        r = await c.get("/api/timeline")            # no buckets= — the default is the subject
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 200, body
    assert body.get("night") == "2026-07-19", "and the night defaults to the one with newest activity"


def test_a_pull_progress_percentage_is_a_real_percentage(tmp_path, monkeypatch):
    """`100 * done // total` → `100 * done / total` and → `101 * done // total`. Both survived: one
    puts a fraction in a progress bar, the other ends a completed pull at 101 %."""
    import polar_psftp
    polar = {**H10, "vendor": "Polar", "address": "24:AC:AC:0C:30:1E"}
    seen = []

    async def fake_pull(address, session, out_dir, adapter=None, on_progress=None):
        # the progress record is POPPED when the pull returns, so read it while it is live
        on_progress(1, 8)
        seen.append(st["devices"][polar["name"]]["pull_progress"]["pct"])
        on_progress(8, 8)
        seen.append(st["devices"][polar["name"]]["pull_progress"]["pct"])
        return {"ok": True, "files": [], "total_bytes": 8, "session": session, "out_dir": out_dir}
    monkeypatch.setattr(polar_psftp, "pull_recording", fake_pull)
    app, _cfg, st, *_ = _mk(tmp_path, devices=[polar])

    status, _body = _post(app, "/api/polar/pull",
                          {"address": "24:AC:AC:0C:30:1E", "session": "/U/0/20260719/E/034500/"})
    assert status == 200
    # `100 * done // total`: floor division on purpose, so 1/8 reads 12. The mutants are `/` (12.5,
    # a fractional percent in a progress bar) and `101 *` (which ends the pull at 101 %).
    assert seen == [12, 100], f"1 of 8 bytes is 12 % and 8 of 8 is exactly 100 %: {seen}"


def test_the_cpap_run_deadline_has_a_default(tmp_path, monkeypatch):
    """`float(ccfg.get("max_run_sec", 5400))` — the wall that stops a manual pull holding the streaming
    interlock all night. 5401 survived; so would 54."""
    import cpap_harvest
    seen = {}

    def spy_harvest(dest, base, nights, deadline):
        seen["deadline"] = deadline
        return {"short": [], "errors": [], "files": 0, "bytes": 0, "nights": 0, "skipped": 0,
                "nights_on_card": 0}
    monkeypatch.setattr(cpap_harvest, "reachable", lambda *a, **k: True)
    monkeypatch.setattr(cpap_harvest, "nights_for", lambda *a, **k: [])
    monkeypatch.setattr(cpap_harvest, "blocking_devices", lambda *a, **k: [])
    monkeypatch.setattr(cpap_harvest, "harvest", spy_harvest)
    import time as _time
    app, cfg, *_ = _mk(tmp_path)
    cfg["cpap"] = {"enabled": True}
    t0 = _time.monotonic()
    status, _ = _post(app, "/api/cpap/pull", {"scope": "last"})
    assert status == 200
    assert 5395 <= seen["deadline"] - t0 <= 5405, \
        f"the default deadline is 5400 s from the start of the run, got {seen['deadline'] - t0:.0f}"


# ═══════════════════════════════════════════════════════════════════════════════════════════════════
# ROUND THREE — the timesync-all fan-out, and a guard whose false arm was never reached
#
# These eight moved from `killed` to `timeout` between rounds, which is inconclusive rather than a
# regression: adding tests to the selection lengthens every per-mutant run, so borderline mutants brush
# mutmut's budget. Rather than argue about the classification, they are asserted directly — a mutant
# killed by a named assertion cannot time its way out.
# ═══════════════════════════════════════════════════════════════════════════════════════════════════

def test_timesync_all_reports_a_result_for_every_configured_device(tmp_path, monkeypatch):
    """The fan-out's two arms. A non-Polar device is SKIPPED with `ok: True` — the O2Ring re-syncs its
    RTC on every connect, so there is nothing to do and reporting a failure would be wrong — while a
    Polar device is actually synced. Six mutants renamed or inverted the skip record's fields."""
    async def fake_host(**kw):
        return {"ok": True, "source": "ntp"}
    monkeypatch.setattr(webmon.clockcfg, "sync_now", fake_host)
    ring = {**H10, "name": "Ring", "vendor": "Wellue", "address": "D1:98:62:7C:92:B3"}
    polar = {**H10, "name": "H10", "vendor": "Polar", "address": "24:AC:AC:0C:30:1E"}

    synced = []

    async def fake_sync(addr):
        synced.append(addr)
        return {"ok": True, "address": addr, "set": "2026-08-02T12:00:00"}
    app, *_ = _mk(tmp_path, devices=[ring, polar], sync_time=fake_sync)

    async def go(c):
        r = await c.post("/api/timesync/all", json={})
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 200
    assert body["host"] == {"ok": True, "source": "ntp"}
    by_name = {d["name"]: d for d in body["devices"]}
    assert by_name["Ring"] == {"address": "D1:98:62:7C:92:B3", "name": "Ring", "ok": True,
                               "skipped": "auto", "detail": "re-syncs on every connect"}
    assert by_name["H10"]["ok"] is True and by_name["H10"]["address"] == "24:AC:AC:0C:30:1E"
    assert synced == ["24:AC:AC:0C:30:1E"], "only the Polar device is actually told the time"


def test_timesync_all_says_unavailable_when_no_syncer_is_wired(tmp_path, monkeypatch):
    """`{"ok": False, "error": "unavailable"}` — the fallback when the daemon did not pass a
    `sync_time`. Five mutants rewrote it, including one that reports `ok: True` for a device whose clock
    was never touched. Polar stamps every sample with device time; claiming a sync that did not happen
    is how a night gets silently mis-dated."""
    async def fake_host(**kw):
        return {"ok": True}
    monkeypatch.setattr(webmon.clockcfg, "sync_now", fake_host)
    polar = {**H10, "name": "H10", "vendor": "Polar", "address": "24:AC:AC:0C:30:1E"}
    app, *_ = _mk(tmp_path, devices=[polar])          # no sync_time= wired in

    async def go(c):
        r = await c.post("/api/timesync/all", json={})
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 200
    assert body["devices"] == [{"ok": False, "error": "unavailable", "name": "H10"}]


def test_a_polar_pull_refuses_a_session_that_is_not_an_absolute_path(tmp_path):
    """`not dev or not session.startswith("/")` → the `not` dropped, so a RELATIVE session is accepted
    and an ABSOLUTE one refused — a complete inversion. Round one only sent an empty session, which the
    `not dev` arm rejects first, so the second arm was never reached in either direction.

    The session is interpolated into an output path, so a relative one escapes the captures tree."""
    polar = {**H10, "vendor": "Polar", "address": "24:AC:AC:0C:30:1E"}
    app, *_ = _mk(tmp_path, devices=[polar])
    status, body = _post(app, "/api/polar/pull",
                         {"address": "24:AC:AC:0C:30:1E", "session": "U/0/20260719/E/034500/"})
    assert status == 400
    assert body == {"ok": False, "error": "bad address or session path"}


# ═══════════════════════════════════════════════════════════════════════════════════════════════════
# ROUND FOUR — the bare-config sites round two could not reach, and the mount-unit guard
#
# `_mk_bare` (round two) covered `/api/state`, `/api/remember` and `/api/settings`. The remaining
# `cfg.get("devices", [])` sites with the default dropped live on routes it never called — the settings
# POST, timesync, the Polar pull, forget, and the timeline. Same defect, same 500 on a box before its
# first pairing; they were simply out of reach.
# ═══════════════════════════════════════════════════════════════════════════════════════════════════

def test_every_route_the_monitor_calls_survives_a_bare_config(tmp_path, monkeypatch):
    """`cfg.get("devices")` with the default dropped returns None, and `for d in None` raises. Each of
    these routes is called by the monitor on load or on the first pairing, so a 500 here is what a new
    box shows its owner before they have done anything wrong."""
    async def fake_host(**kw):
        return {"ok": True}
    monkeypatch.setattr(webmon.clockcfg, "sync_now", fake_host)
    app, cfg, _st = _mk_bare(tmp_path)

    async def go(c):
        out = {}
        out["settings_get"] = (await c.get("/api/settings")).status
        out["settings_post"] = (await c.post("/api/settings", json={"settings": {}})).status
        out["timesync_all"] = (await c.post("/api/timesync/all", json={})).status
        out["timesync"] = (await c.post("/api/timesync", json={"address": "AA:BB"})).status
        out["polar_recs"] = (await c.get("/api/polar/recordings?address=AA:BB")).status
        out["polar_pull"] = (await c.post("/api/polar/pull",
                                          json={"address": "AA:BB", "session": "/U/0/"})).status
        return out
    got = _serve(app, go)
    assert got["settings_get"] == 200 and got["settings_post"] == 200
    assert got["timesync_all"] == 200, "the fan-out over zero devices is a no-op, not a crash"
    assert got["timesync"] == 400 and got["polar_recs"] == 400 and got["polar_pull"] == 400, \
        "an unknown address on a device-less box is refused, not a 500"


def test_forgetting_on_a_bare_config_is_refused_rather_than_crashing(tmp_path, monkeypatch):
    """`/api/forget`'s rewrite reads `cfg.get("devices", [])`; with the default dropped the
    comprehension iterates None. A stale monitor tab can POST this against a box whose config was
    reset."""
    async def fake_forget(*a, **k):
        return {"ok": True}
    monkeypatch.setattr(webmon.bonding, "forget", fake_forget)
    app, cfg, _st = _mk_bare(tmp_path)
    status, _body = _post(app, "/api/forget", {"address": "AA:BB:CC:DD:EE:FF"})
    assert status == 200
    assert cfg["devices"] == [], "an empty device list, not a crash and not None"


def test_a_timeline_request_on_a_bare_config_does_not_crash(tmp_path):
    """The timeline handler passes `cfg.get("devices", [])` straight into the builder."""
    night = tmp_path / "captures" / "2026-08-03"
    night.mkdir(parents=True)
    (night / "Polar_H10_1_20260803031641_ECG.txt").write_text("Phone timestamp\n")
    app, *_ = _mk_bare(tmp_path)

    async def go(c):
        r = await c.get("/api/timeline")
        return r.status
    assert _serve(app, go) == 200


def test_a_mount_target_gets_a_unit_and_a_local_one_does_not(tmp_path, monkeypatch):
    """`(tgt.get("kind") or "") == "mount" and tgt.get("protocol") != "local"` — seven survivors on one
    line, including the `and` → `or`. `mount_unit` emits a systemd unit the operator installs into
    `/etc/systemd/system` and pastes as root, so emitting one for a target that needs none, or omitting
    it for one that does, is a real instruction to a human either way. Both arms asserted, plus the
    protocol key and value, because a substring check on the response cannot see them."""
    monkeypatch.setattr(webmon.storage_targets, "dest_status", lambda t: {"ready": True, "path": "/m"})
    monkeypatch.setattr(webmon.storage_targets, "mount_unit", lambda t: {"unit": "srv-x.mount"})

    def _get(target):
        app, cfg, *_ = _mk(tmp_path)
        cfg["archive"] = {"target": target}

        async def go(c):
            return await (await c.get("/api/storage")).json()
        return _serve(app, go)

    remote = _get({"kind": "mount", "protocol": "cifs", "mountpoint": "/m"})
    assert remote.get("mount_unit") == {"unit": "srv-x.mount"}, \
        "a REMOTE mount needs the unit — that is the whole point of emitting one"
    local = _get({"kind": "mount", "protocol": "local", "mountpoint": "/m"})
    assert "mount_unit" not in local, "a local mount is already mounted; a unit would be wrong"
    transfer = _get({"kind": "transfer", "protocol": "cifs"})
    assert "mount_unit" not in transfer, "a transfer target stages nowhere and mounts nothing"


# ── the SAME family, the two call sites the pass above stopped short of ──────────────────────────────
# The section above fixed `bonding.bond` and `bonding.forget`. `bonding.scan` and
# `bonding.ensure_bonded` take the same `adapter_mac` and were left dropping it — a sibling divergence
# inside the very file that closed the family. Found 2026-08-05 by `tools/find_blindspots.py`
# (`adapter` is the 4th most-discarded argument name in the suite, 41 doubles) and confirmed by
# mutation: `bonding.scan(None)` and `ensure_bonded(address, None)` both survive the whole webmon
# suite, while the same mutation on bond/forget reds.
#
# The consequence is not symmetric with the covered pair. A bond on the wrong radio at least fails
# loudly at the next connect; a SCAN on the wrong radio returns an empty list, which the operator reads
# as "the sensor is not advertising" — and this box's own notes record one adapter that goes deaf while
# the other works, which is precisely the state that makes an empty scan look like a dead sensor.

def test_the_device_scan_runs_on_the_PINNED_radio_not_whichever_bluez_picks(tmp_path, monkeypatch):
    """`bonding.scan(adapter_mac)` → `bonding.scan(None)` survived. A scan on the default controller
    finds nothing on a two-radio box and reports it as an empty device list."""
    seen = {}

    async def fake_scan(adapter):
        seen["adapter"] = adapter
        return []
    monkeypatch.setattr(webmon.bonding, "scan", fake_scan)
    app, *_ = _mk(tmp_path)
    status, _body = _post(app, "/api/scan", {})
    assert status == 200
    assert seen.get("adapter") == "AA:AA:AA:AA:AA:AA", (
        f"scan went out on {seen.get('adapter')!r} — an unpinned scan finds nothing on a box whose "
        "other radio is deaf, and an empty list reads as a dead sensor")


def test_the_pre_pull_bond_check_uses_the_PINNED_radio(tmp_path, monkeypatch):
    """`bonding.ensure_bonded(address, adapter_mac)` → `(address, None)` survived. This runs before every
    PS-FTP pull, with the daemon's capture paused: bonding the wrong controller leaves the link
    unauthenticated on the one that matters, and a Polar H10 refuses PMD on an unauthenticated link."""
    seen = {}

    async def fake_ensure(address, adapter):
        seen["args"] = (address, adapter)
        return True

    async def fake_list(address, adapter=None):
        return [{"session": "/U/0/1/", "size": 1}]
    monkeypatch.setattr(webmon.bonding, "ensure_bonded", fake_ensure)
    monkeypatch.setattr(webmon.polar_psftp, "list_recordings", fake_list)
    app, *_ = _mk(tmp_path)
    # GET /api/polar/recordings — it routes through `_polar_run`, which is where ensure_bonded lives.
    _serve(app, lambda c: c.get("/api/polar/recordings", params={"address": H10["address"]}))
    assert seen.get("args") == (H10["address"], "AA:AA:AA:AA:AA:AA"), (
        f"ensure_bonded got {seen.get('args')!r} — the address AND the radio are both load-bearing")
