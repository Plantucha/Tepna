# tepna-capture — webmon.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The box's on-device CONTROL + LIVE-MONITOR surface (Tepna Vigil hero live-view, HEALTH-BOX-VISION
# §4). This is a HOST surface, not a bundled Dex app — it is NOT gated by the bundler/provenance
# suite; it drives BLE (scan/bond/forget) and streams live samples the daemon is already decoding.
# Bind to the LAN/bedside box only (never WAN); reach it remotely via Tailscale (§8 / PHI statement).
#
# Endpoints:
#   GET  /                     -> monitor.html
#   GET  /api/state            -> remembered devices (+ live status), stream metadata, adapter
#   POST /api/scan             -> discover advertising devices (bonding.scan)
#   POST /api/bond   {address} -> Just-Works bond (bonding.bond) — REQUIRED before H10 PMD holds
#   POST /api/forget {address} -> remove bond + drop from remembered
#   POST /api/remember {device}-> persist to config.yaml (auto-connect) + hot-start capture
#   GET  /api/stream/{key}     -> Server-Sent-Events live waveform (one stream)

from __future__ import annotations
import asyncio, json, os
from aiohttp import web
import yaml
import bonding
import clockcfg
import offline_lock
import polar_psftp
import settings_schema

_HERE = os.path.dirname(os.path.abspath(__file__))


def make_app(bus, cfg: dict, cfg_path: str, adapter_mac, status: dict, spawn_device,
             pull_stored=None, polar_pause=None, sync_time=None) -> web.Application:
    app = web.Application()

    def _remembered() -> list[dict]:
        out = []
        for d in cfg.get("devices", []):
            st = status.get("devices", {}).get(d["name"], {})
            out.append({**{k: d.get(k) for k in
                           ("name", "vendor", "model", "device_id", "address", "streams")},
                        "connected": bool(st.get("connected")),
                        "battery": st.get("battery"),
                        "rssi": st.get("rssi"),
                        "clock_synced": st.get("clock_synced"),
                        "device_time": st.get("device_time"),
                        "clock_skew_sec": st.get("clock_skew_sec"),
                        "pull_progress": st.get("pull_progress"),
                        "frames_dropped": st.get("frames_dropped"),
                        "frames_duplicated": st.get("frames_duplicated"),
                        "worn": st.get("worn"),
                        "charging": bool(st.get("charging")),
                        "last_error": st.get("last_error")})
        return out

    async def index(_req):
        return web.FileResponse(os.path.join(_HERE, "monitor.html"))

    async def state(_req):
        return web.json_response({
            "adapter": adapter_mac,
            "devices": _remembered(),
            "streams": bus.meta(),
        })

    async def scan(_req):
        found = await bonding.scan(adapter_mac)
        return web.json_response([f.__dict__ for f in found])

    async def bond(req):
        body = await req.json()
        return web.json_response(await bonding.bond(body["address"], adapter_mac))

    async def forget(req):
        body = await req.json()
        res = await bonding.forget(body["address"], adapter_mac)
        cfg["devices"] = [d for d in cfg.get("devices", []) if d.get("address") != body["address"]]
        _save()
        return web.json_response(res)

    async def remember(req):
        dev = await req.json()
        # de-dupe by address; last write wins
        cfg.setdefault("devices", [])
        cfg["devices"] = [d for d in cfg["devices"] if d.get("address") != dev.get("address")]
        cfg["devices"].append({k: dev[k] for k in
                               ("name", "vendor", "model", "device_id", "address", "streams") if k in dev})
        _save()
        if spawn_device:                      # hot-start capture without a restart
            spawn_device(cfg["devices"][-1])
        return web.json_response({"ok": True, "remembered": len(cfg["devices"])})

    async def stream(req):
        # key == "_all" multiplexes EVERY stream over ONE SSE connection — the monitor's Overview needs
        # all ~10 streams at once, and browsers cap ~6 HTTP/1.1 connections per host, so per-stream
        # connections would starve the rest. Each frame carries its own "stream" field for client demux.
        key = req.match_info["key"]
        allmode = (key == "_all")
        resp = web.StreamResponse(headers={
            "Content-Type": "text/event-stream", "Cache-Control": "no-cache",
            "Connection": "keep-alive", "X-Accel-Buffering": "no"})
        await resp.prepare(req)
        q = bus.subscribe()
        try:
            snaps = [m["key"] for m in bus.meta()] if allmode else [key]
            for k in snaps:
                await resp.write(f"event: snapshot\ndata: {json.dumps(bus.snapshot(k))}\n\n".encode())
            while True:
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=15)
                except asyncio.TimeoutError:
                    await resp.write(b": keep-alive\n\n")   # comment frame keeps the socket open
                    continue
                if not allmode and msg["stream"] != key:
                    continue
                await resp.write(f"data: {json.dumps(msg)}\n\n".encode())
        except (asyncio.CancelledError, ConnectionResetError, ConnectionError):
            pass
        finally:
            bus.unsubscribe(q)
        return resp

    async def pull_stored_h(req):
        # Download the O2Ring's onboard-recorded .dat over BLE. Pauses live SpO2 capture for the duration
        # (one BLE link). Synchronous: returns when the pull completes (a night file is small, ~a minute).
        if not pull_stored:
            return web.json_response({"ok": False, "detail": "stored-session pull not available"}, status=400)
        try:
            body = await req.json() if req.body_exists else {}
        except Exception:
            body = {}
        which = body.get("which", "latest")
        try:
            ftype = int(body.get("ftype", 0))
        except (TypeError, ValueError):
            ftype = 0
        try:
            return web.json_response(await pull_stored(which, ftype))
        except offline_lock.OfflineBusy as e:
            # 409, not 500: another device owns the single download slot. Expected, retryable, not a fault.
            return web.json_response({"ok": False, "busy": e.holder, "detail": str(e)}, status=409)
        except Exception as e:
            return web.json_response({"ok": False, "detail": repr(e)}, status=500)

    def _save():
        try:
            with open(cfg_path, "w") as f:
                yaml.safe_dump(cfg, f, sort_keys=False, default_flow_style=False)
        except Exception:
            pass

    # ── Clock / NTP / timezone (Clock Contract §🔒 — the box's wall clock stamps every capture) ──
    _clock_sudo = (cfg.get("clock") or {}).get("sudo", True)

    async def clock_get(_req):
        return web.json_response(await clockcfg.status())

    async def clock_set(req):
        body = await req.json()
        servers = body.get("servers") or []
        if isinstance(servers, str):
            servers = servers.replace(",", " ").split()
        return web.json_response(
            await clockcfg.set_ntp(servers, body.get("poll_max_sec", 2048), sudo=_clock_sudo))

    async def clock_sync(_req):
        return web.json_response(await clockcfg.sync_now(sudo=_clock_sudo))

    async def clock_tz(req):
        body = await req.json()
        return web.json_response(await clockcfg.set_tz(body.get("timezone"), sudo=_clock_sudo))

    # ── Polar onboard offline-recording pull (PS-FTP) — PR #153; /api/polar/* to avoid the O2Ring /api/pull ──
    # A Polar device holds ONE BLE link: if it's live-streaming, pause it first (Forget) or the pull fails.
    # Only remembered Polar addresses; bleak default controller.
    def _polar_dev(address):
        for d in cfg.get("devices", []):
            if d.get("address") == address and d.get("vendor") == "Polar":
                return d
        return None

    async def _polar_run(address, op):
        # Pause the daemon's live capture of this Polar device (it holds the one BLE link) for the duration
        # of the PS-FTP op, then resume. Without this the pull races run_polar's reconnect loop and fails
        # with org.bluez.Error.InProgress. bonding + the op both run while capture is paused.
        async def _wrapped():
            await bonding.ensure_bonded(address, adapter_mac)
            return await op()
        if polar_pause:
            return await polar_pause(address, _wrapped)
        return await _wrapped()

    # Measured bytes/sec, PER DEVICE — the same stream name costs very different amounts on different
    # hardware, so a single global table lies. H10 ACC runs at 200 Hz (11.4 kB/s) while the Verity's runs
    # at 52 Hz (2.9 kB/s): quoting one number for "acc" overstated the Verity by ~4x. Measured on this
    # host 2026-07-18 over real captures.
    # (bytes/sec, at_rate_hz) measured on this host 2026-07-18. Cost scales with the CHOSEN rate — a
    # fixed MB figure would start lying the moment a rate is changed, which is the whole point of the
    # dropdown. Per device, because the same stream name costs very different amounts on different
    # hardware (H10 ACC 200 Hz vs Verity ACC 52 Hz).
    _BPS_BY_MODEL = {
        "H10":    {"ecg": (7800, 130), "acc": (11400, 200), "hr": (35, 1)},
        "Verity": {"ppg": (3750, 55), "acc": (2950, 52), "gyro": (2800, 52),
                   "mag": (2950, 50), "ppi": (30, 1)},
        "O2Ring": {"spo2": (60, 1), "ppg": (6200, 125.738)},
    }

    def _model_of(dev: dict) -> str:
        blob = f"{dev.get('model','')} {dev.get('name','')}".lower()
        return "H10" if "h10" in blob else ("Verity" if ("verity" in blob or "sense" in blob) else "O2Ring")

    def _bps_for(dev: dict) -> dict:
        return {k: v[0] for k, v in _BPS_BY_MODEL[_model_of(dev)].items()}

    def _bps_ref(dev: dict) -> dict:
        """{stream: [bytes_per_sec, at_rate]} so the UI can scale cost by the selected rate."""
        return {k: list(v) for k, v in _BPS_BY_MODEL[_model_of(dev)].items()}

    async def settings_get(_req):
        devs = []
        for d in cfg.get("devices", []):
            st = status.get("devices", {}).get(d.get("name"), {})
            # Only offer what the device ACTUALLY advertises (PMD feature bitmask read at connect).
            # Offering a stream the firmware lacks would just produce a START rejection and an idle card.
            # Filter to actual DATA streams. The PMD feature bitmask also reports capability flags —
            # the Verity advertises 0x9 SDK_MODE, 0xd OFFLINE_RECORDING, 0xe OFFLINE_HR — which are
            # modes, not measurements. polar_pmd names the ones it decodes and leaves the rest as hex,
            # so an unnamed (0x…) entry is exactly "not a stream we can capture"; offering it would be a
            # checkbox that can never work.
            supported = [x for x in (st.get("pmd_supported") or []) if not str(x).startswith("0x")] \
                        or None
            if d.get("vendor") in ("Wellue", "Viatom"):
                # The ring has no PMD feature bitmask; its capturable set is fixed and known. `ppg` is the
                # 125 Hz pleth we decode out of the same 0x04 frame as the 1 Hz summary — the second
                # largest stream on the box, and until now it had no toggle at all.
                supported = ["spo2", "ppg"]
            devs.append({"name": d.get("name"), "address": d.get("address"), "vendor": d.get("vendor"),
                         "streams": d.get("streams") or [], "supported": supported,
                         "bps": _bps_for(d), "bps_ref": _bps_ref(d),
                         # the device's OWN menu of legal rates, read at connect — a dropdown built from
                         # this cannot offer an unsupported value
                         "rate_options": st.get("pmd_options") or {},
                         "rates": d.get("rates") or {}})
        return web.json_response({
            "settings": settings_schema.describe(cfg, {}),
            "devices": devs,
            "bps_by_model": _BPS_BY_MODEL,
        })

    async def settings_post(req):
        """Apply allowlisted settings and/or per-device stream selections. Validates EVERYTHING before
        touching config.yaml, and backs the file up first — a corrupt config on a headless box means no
        capture and no web surface to fix it from."""
        body = await req.json()
        changed, restart_needed = [], False
        try:
            for key, val in (body.get("settings") or {}).items():
                v = settings_schema.coerce(key, val)
                if settings_schema.get_nested(cfg, key) != v:
                    settings_schema.set_nested(cfg, key, v)
                    changed.append(key)
                    if settings_schema.SETTINGS[key][3]:
                        restart_needed = True
            for addr, streams in (body.get("streams") or {}).items():
                dev = next((d for d in cfg.get("devices", []) if d.get("address") == addr), None)
                if not dev:
                    raise settings_schema.SettingsError(f"unknown device {addr}")
                if not isinstance(streams, list) or not all(isinstance(x, str) for x in streams):
                    raise settings_schema.SettingsError("streams must be a list of names")
                st = status.get("devices", {}).get(dev.get("name"), {})
                sup = st.get("pmd_supported")
                if sup:                      # refuse a stream the firmware does not advertise
                    bad = [x for x in streams if x not in sup and x not in ("hr",)]
                    if bad:
                        raise settings_schema.SettingsError(
                            f"{dev.get('name')} does not support: {', '.join(bad)}")
                if sorted(streams) != sorted(dev.get("streams") or []):
                    dev["streams"] = streams
                    changed.append(f"{dev.get('name')}.streams")
                    restart_needed = True    # PMD START is negotiated at connect
            for addr, rates in (body.get("rates") or {}).items():
                dev = next((d for d in cfg.get("devices", []) if d.get("address") == addr), None)
                if not dev:
                    raise settings_schema.SettingsError(f"unknown device {addr}")
                opts = (status.get("devices", {}).get(dev.get("name"), {}).get("pmd_options") or {})
                clean = {}
                for stream, val in rates.items():
                    try:
                        v = int(val)
                    except (TypeError, ValueError):
                        raise settings_schema.SettingsError(f"{stream} rate must be a number") from None
                    allowed = opts.get(stream) or []
                    if allowed and v not in allowed:
                        # Refuse rather than let the device reject the START and leave an idle stream.
                        raise settings_schema.SettingsError(
                            f"{dev.get('name')} {stream}: {v} Hz not offered (choose {allowed})")
                    clean[stream] = v
                if clean != (dev.get("rates") or {}):
                    dev["rates"] = clean
                    changed.append(f"{dev.get('name')}.rates")
                    restart_needed = True     # rate is fixed at PMD START, i.e. at connect
        except settings_schema.SettingsError as e:
            return web.json_response({"ok": False, "error": str(e)}, status=400)
        if changed:
            try:                              # back up before writing — a bad write bricks the daemon
                import shutil
                shutil.copyfile(cfg_path, cfg_path + ".bak")
            except Exception:
                pass
            _save()
        return web.json_response({"ok": True, "changed": changed, "restart_needed": restart_needed})

    async def timesync(req):
        """Set ONE device's internal clock from the host. Polar only — the O2Ring already re-syncs its
        RTC on every connect (oxyii 0xC0), so there is nothing manual to do there and we say so rather
        than shipping a button that silently no-ops."""
        body = await req.json() if req.body_exists else {}
        address = body.get("address", "")
        dev = next((d for d in cfg.get("devices", []) if d.get("address") == address), None)
        if not dev:
            return web.json_response({"ok": False, "error": "unknown address"}, status=400)
        if dev.get("vendor") != "Polar":
            return web.json_response({"ok": True, "skipped": "auto", "address": address,
                                      "detail": "O2Ring re-syncs its RTC on every connect (no manual step)"})
        if not sync_time:
            return web.json_response({"ok": False, "error": "time sync unavailable"}, status=400)
        try:
            return web.json_response(await sync_time(address))
        except offline_lock.OfflineBusy as e:
            return web.json_response({"ok": False, "busy": e.holder, "error": str(e)}, status=409)
        except Exception as e:
            return web.json_response({"ok": False, "error": f"{type(e).__name__}: {e}"}, status=502)

    async def timesync_all(_req):
        """Host clock first (so devices inherit a freshly disciplined time), then every capable device.
        Serialised by offline_lock — one radio, one device at a time."""
        out = {"host": None, "devices": []}
        try:
            out["host"] = await clockcfg.sync_now(sudo=_clock_sudo)
        except Exception as e:
            out["host"] = {"ok": False, "detail": repr(e)}
        for d in cfg.get("devices", []):
            addr = d.get("address")
            if d.get("vendor") != "Polar":
                out["devices"].append({"address": addr, "name": d.get("name"), "ok": True,
                                       "skipped": "auto", "detail": "re-syncs on every connect"})
                continue
            try:
                r = await sync_time(addr) if sync_time else {"ok": False, "error": "unavailable"}
            except Exception as e:
                r = {"ok": False, "address": addr, "error": f"{type(e).__name__}: {e}"}
            r["name"] = d.get("name")
            out["devices"].append(r)
        return web.json_response(out)

    async def polar_recordings(req):
        address = req.query.get("address", "")
        if not _polar_dev(address):
            return web.json_response({"ok": False, "error": "unknown or non-Polar address"}, status=400)
        try:
            recs = await _polar_run(address, lambda: polar_psftp.list_recordings(address))
            return web.json_response({"ok": True, "recordings": recs})
        except offline_lock.OfflineBusy as e:
            return web.json_response({"ok": False, "busy": e.holder, "error": str(e)}, status=409)
        except Exception as e:
            return web.json_response({"ok": False, "error": f"{type(e).__name__}: {e}"}, status=502)

    async def polar_pull(req):
        body = await req.json()
        address, session = body.get("address", ""), body.get("session", "")
        dev = _polar_dev(address)
        if not dev or not session.startswith("/"):
            return web.json_response({"ok": False, "error": "bad address or session path"}, status=400)
        dev_id = dev.get("device_id") or address.replace(":", "")[-8:]
        out_dir = os.path.join(cfg.get("root", "/srv/tepna"), "captures", "stored",
                               f"Polar_{dev.get('model', 'Device')}_{dev_id}_offline_{session.strip('/').replace('/', '_')}")
        try:
            def _prog(done, total):
                nm = (dev or {}).get("name") or address
                status.setdefault("devices", {}).setdefault(nm, {})["pull_progress"] = {
                    "device": nm, "bytes": done, "total": total,
                    "pct": (100 * done // total) if total else 0}
            try:
                manifest = await _polar_run(address, lambda: polar_psftp.pull_recording(
                    address, session, out_dir, on_progress=_prog))
            finally:
                status.get("devices", {}).get((dev or {}).get("name") or address, {}).pop("pull_progress", None)
            return web.json_response({"ok": True, "manifest": manifest})
        except offline_lock.OfflineBusy as e:
            return web.json_response({"ok": False, "busy": e.holder, "error": str(e)}, status=409)
        except Exception as e:
            return web.json_response({"ok": False, "error": f"{type(e).__name__}: {e}"}, status=502)

    app.add_routes([
        web.get("/", index),
        web.get("/api/state", state),
        web.post("/api/scan", scan),
        web.post("/api/bond", bond),
        web.post("/api/forget", forget),
        web.post("/api/remember", remember),
        web.post("/api/pull", pull_stored_h),
        web.get("/api/settings", settings_get),
        web.post("/api/settings", settings_post),
        web.post("/api/timesync", timesync),
        web.post("/api/timesync/all", timesync_all),
        web.get("/api/polar/recordings", polar_recordings),
        web.post("/api/polar/pull", polar_pull),
        web.get("/api/stream/{key}", stream),
        web.get("/api/clock", clock_get),
        web.post("/api/clock", clock_set),
        web.post("/api/clock/sync", clock_sync),
        web.post("/api/clock/tz", clock_tz),
    ])
    return app


async def start(app: web.Application, host: str, port: int) -> web.AppRunner:
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host, port)
    await site.start()
    return runner
