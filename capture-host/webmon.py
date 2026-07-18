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
import polar_psftp

_HERE = os.path.dirname(os.path.abspath(__file__))


def make_app(bus, cfg: dict, cfg_path: str, adapter_mac, status: dict, spawn_device,
             pull_stored=None, polar_pause=None) -> web.Application:
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
                        "worn": st.get("worn"),
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

    async def polar_recordings(req):
        address = req.query.get("address", "")
        if not _polar_dev(address):
            return web.json_response({"ok": False, "error": "unknown or non-Polar address"}, status=400)
        try:
            recs = await _polar_run(address, lambda: polar_psftp.list_recordings(address))
            return web.json_response({"ok": True, "recordings": recs})
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
            manifest = await _polar_run(address, lambda: polar_psftp.pull_recording(address, session, out_dir))
            return web.json_response({"ok": True, "manifest": manifest})
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
