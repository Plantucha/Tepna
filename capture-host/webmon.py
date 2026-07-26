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
import asyncio, hmac, json, logging, os, re, tempfile
from aiohttp import web
import yaml
import bonding
import clockcfg
import offline_lock
import polar_psftp
import storage_targets
import timeline as _timeline
import settings_schema
from writers import missing_identity

_HERE = os.path.dirname(os.path.abspath(__file__))
_log = logging.getLogger("tepna.webmon")

# A device address reaches bonding.* which f-string-interpolates it into a newline-delimited
# bluetoothctl stdin script (VIGIL-DEEP-ANALYSIS §2A) — so an address carrying a newline could inject
# control commands (power off / remove <other-sensor>). Validate the EXACT MAC shape at this boundary.
_MAC_RE = re.compile(r'^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$')


def _valid_mac(a) -> bool:
    # fullmatch, NOT match: Python's `$` also matches just BEFORE a trailing newline, so
    # "AA:BB:CC:DD:EE:FF\n" passed the anchored pattern. Not a command injection — `$` permits only a
    # LONE trailing newline with nothing after it, so the worst it put into bonding's bluetoothctl
    # script was a blank line — but /api/remember persists the address to config.yaml, and an address
    # with a trailing newline never matches a real BLE address again. That is precisely the failure
    # writers.IDENTITY_FIELDS exists to stop: "remembered ✓", then silently never captured, for the
    # rest of the box's life (VIGIL-HARDENING-III §2).
    return isinstance(a, str) and bool(_MAC_RE.fullmatch(a))


async def _body(req) -> dict:
    """A malformed/empty JSON body is a 400-worthy client error, never a 500 traceback
    (VIGIL-DEEP-ANALYSIS §2A). Returns {} on absent/undecodable body."""
    try:
        return await req.json() if req.body_exists else {}
    except Exception:
        return {}


def make_app(bus, cfg: dict, cfg_path: str, adapter_mac, status: dict, spawn_device,
             pull_stored=None, polar_pause=None, sync_time=None, forget_device=None) -> web.Application:
    # Optional shared-secret gate on the CONTROL surface. When web.token is set, every POST (bond / forget
    # / remember / pull / settings / clock — all the state-changing verbs) needs the token; GET reads stay
    # open so the monitor can still display without it. Default OFF (no token → current wide-open behaviour;
    # fine on a trusted home LAN). Accepts `Authorization: Bearer <t>` or `X-Tepna-Token: <t>`; compared in
    # constant time so the check leaks no timing signal about the secret.
    _token = (cfg.get("web") or {}).get("token")

    @web.middleware
    async def _auth(request, handler):
        if _token and request.method == "POST":
            supplied = request.headers.get("X-Tepna-Token")
            auth = request.headers.get("Authorization", "")
            if not supplied and auth.startswith("Bearer "):
                supplied = auth[7:]
            if not (supplied and hmac.compare_digest(supplied, _token)):
                return web.json_response({"ok": False, "error": "unauthorized"}, status=401)
        return await handler(request)

    app = web.Application(middlewares=[_auth])

    # SSE MUST NOT OUTLIVE THE DAEMON. The live-view stream below is a `while True` that ends only when
    # the CLIENT goes away — so `AppRunner.cleanup()`, which waits for in-flight requests, waits on a
    # browser tab. Measured 2026-07-20: SIGTERM left the daemon alive past 101 s with an open monitor,
    # which under systemd is a `systemctl restart` that hangs to TimeoutStopSec and is then SIGKILLed
    # mid-write. aiohttp fires `on_shutdown` BEFORE it waits, so that is where a live view has to end.
    # Setting the flag is not enough on its own: the handler is parked in `q.get()` and would not look
    # at it for a further keep-alive period, so push a sentinel to wake every open stream at once.
    _shutting_down = asyncio.Event()
    _live_queues: set = set()

    async def _on_shutdown(_app):
        _shutting_down.set()
        for lq in list(_live_queues):
            try:
                lq.put_nowait({"stream": "__shutdown__"})
            except Exception:       # pragma: no cover — an unbounded Queue's put_nowait cannot fail;
                pass                # the guard only ensures one bad subscriber cannot block the rest
    app.on_shutdown.append(_on_shutdown)

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
                        # link_epoch (E5) is the reconnect count — the honest churn signal a green
                        # "connected" dot hides. A device that flaps all night reads "connected" at every
                        # sample yet has a climbing epoch; surfacing it is what makes that visible.
                        "link_epoch": st.get("link_epoch"),
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
            # What disciplined THIS BOX's clock. The devices inherit host time, so an undisciplined
            # host silently makes every stamp wrong-but-consistent — this is the evidence, not a guess.
            "host_clock": status.get("host_clock"),
            # Box-health blocks the guardrail pollers publish: free disk + retention, and tonight's
            # capture-completeness QC. Present only once their poller has run (null before then).
            "storage": status.get("storage"),
            "qc": status.get("qc"),
            # Boot/adapter facts: uptime (a moved started_at = a spurious restart) + a mis-pin flag.
            "host": status.get("host"),
            # Offload result, so the sidebar pill can say whether anything actually left the box.
            "archive": status.get("archive"),
        })

    async def scan(_req):
        found = await bonding.scan(adapter_mac)
        return web.json_response([f.__dict__ for f in found])

    async def bond(req):
        body = await _body(req)
        if not _valid_mac(body.get("address")):
            return web.json_response({"ok": False, "error": "invalid device address"}, status=400)
        return web.json_response(await bonding.bond(body["address"], adapter_mac))

    async def forget(req):
        body = await _body(req)
        if not _valid_mac(body.get("address")):
            return web.json_response({"ok": False, "error": "invalid device address"}, status=400)
        res = await bonding.forget(body["address"], adapter_mac)
        cfg["devices"] = [d for d in cfg.get("devices", []) if d.get("address") != body["address"]]
        if not _save():
            return web.json_response({"ok": False, "error": "config write failed (disk?)"}, status=500)
        if forget_device:                     # stop the runner too — else it reconnects a dropped device
            forget_device(body["address"])
        return web.json_response(res)

    async def remember(req):
        dev = await _body(req)
        if not _valid_mac(dev.get("address")):
            return web.json_response({"ok": False, "error": "invalid device address"}, status=400)
        # Refuse an unidentifiable device INSTEAD of persisting it. The browser's guessDevice() leaves
        # vendor/model blank for any sensor it does not recognise; without this the entry was written to
        # config.yaml and answered "remembered ✓", while the capture daemon quietly refused to ever open
        # a writer for it — a device that looked saved forever and never recorded a byte. Failing here
        # surfaces it while the user is still standing in front of the pairing screen. FOLLOWUPS-II §F1.
        missing = missing_identity(dev)
        if missing:
            return web.json_response(
                {"ok": False, "missing": missing,
                 "error": "unidentified device — missing " + ", ".join(missing)}, status=400)
        # MERGE ONTO THE EXISTING ENTRY — never "last write wins" (2026-07-26).
        #
        # This used to drop the stored device and rebuild it from the 6-key allowlist below, so
        # re-remembering an ALREADY-KNOWN sensor silently destroyed every tuned key that is not in that
        # list. Observed on the real box: one pass through the pairing screen erased `rates:` from the
        # H10 (acc 50) and the Verity (acc 52, mag 20) — the E4 decision that cut 71 % of the box's
        # bytes — leaving the daemon to negotiate defaults and nightqc to grade coverage against a
        # nominal the operator never chose (it reported acc 24 % / mag 39 % on a night where both
        # streams were complete). `optional: true` on a backup device would go the same way.
        #
        # A re-remember is how the UI handles an ordinary re-scan, so it must be IDEMPOTENT on
        # everything the caller did not explicitly send.
        cfg.setdefault("devices", [])
        _KEYS = ("name", "vendor", "model", "device_id", "address", "streams")
        incoming = {k: dev[k] for k in _KEYS if k in dev}
        existing = next((d for d in cfg["devices"] if d.get("address") == dev.get("address")), None)
        if existing:
            merged = {**existing, **incoming}
            # DEVICE_ID IS AN IDENTITY, NOT A FIELD TO REFRESH. It is interpolated into every capture
            # filename (`<Vendor>_<Model>_<DeviceId>_<stamp>_<STREAM>.txt`), so changing it renames the
            # sensor's whole future output and orphans it from its own history. The browser's
            # guessDevice() derives one from the MAC when it cannot read the real serial — on this box
            # that turned the Verity's Polar serial `0C301E3F` into `AC0C301E` (MAC bytes 2-5) and split
            # one night's files across two identities. An established id therefore wins over an
            # incoming guess; correcting it is a deliberate config edit, not a side effect of scanning.
            if existing.get("device_id"):
                if incoming.get("device_id") and incoming["device_id"] != existing["device_id"]:
                    _log.warning("remember: keeping established device_id %r for %s (ignoring incoming "
                                 "%r — changing it would rename every future capture file)",
                                 existing["device_id"], dev.get("address"), incoming["device_id"])
                merged["device_id"] = existing["device_id"]
            cfg["devices"] = [merged if d is existing else d for d in cfg["devices"]]
            saved = merged
        else:
            cfg["devices"].append(incoming)
            saved = incoming
        if not _save():
            return web.json_response({"ok": False, "error": "config write failed (disk?)"}, status=500)
        if spawn_device:                      # hot-start capture without a restart
            # `saved`, not cfg["devices"][-1] — a MERGED device keeps its original position in the
            # list, so the old index-based lookup would hot-start whichever sensor happened to be last.
            spawn_device(saved)
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
        _live_queues.add(q)
        try:
            snaps = [m["key"] for m in bus.meta()] if allmode else [key]
            for k in snaps:
                await resp.write(f"event: snapshot\ndata: {json.dumps(bus.snapshot(k))}\n\n".encode())
            while not _shutting_down.is_set():
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=15)
                except asyncio.TimeoutError:  # pragma: no cover — the SSE keep-alive fires only on a
                    await resp.write(b": keep-alive\n\n")   # live long-lived connection idle >15 s; a
                    continue                                 # unit test of this infinite handler hangs teardown

                if _shutting_down.is_set():
                    break                       # woken by the shutdown sentinel — let cleanup() finish
                if not allmode and msg["stream"] != key:
                    continue
                await resp.write(f"data: {json.dumps(msg)}\n\n".encode())
        except (asyncio.CancelledError, ConnectionResetError, ConnectionError):
            pass
        finally:
            _live_queues.discard(q)
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

    def _save() -> bool:
        """Persist config.yaml ATOMICALLY — write a sibling temp, fsync, then os.replace.

        This used to be `open(cfg_path, "w")`, which TRUNCATES before it writes. A failure partway —
        a full disk (the box was at 13.2 % free on 2026-07-25), a power cut, a kill — left config.yaml
        truncated or empty, and the `except` below could not undo it: by the time it ran, the only copy
        was already destroyed. Returning ok:false does not restore a file.

        The blast radius is the whole appliance and it is SILENT: capture.py reads the config exactly
        once, at startup, so a corrupted file changes nothing until the next restart — and then the
        daemon either fails to parse it or comes up with an empty device list and records nothing, all
        night, with no error at the time of the damage.

        os.replace() is atomic on POSIX, so a reader sees either the whole old file or the whole new
        one. The directory fsync is what makes the rename itself survive a power loss (fsyncing the
        file alone leaves the directory entry unflushed). Failure at ANY step leaves the original
        untouched and reports false. (VIGIL-DEEP-ANALYSIS §2A kept the honest return value; this fixes
        the thing it was reporting on.)"""
        d = os.path.dirname(os.path.abspath(cfg_path)) or "."
        tmp = None
        try:
            fd, tmp = tempfile.mkstemp(prefix=".config.", suffix=".yaml.tmp", dir=d)
            with os.fdopen(fd, "w") as f:
                yaml.safe_dump(cfg, f, sort_keys=False, default_flow_style=False)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, cfg_path)          # atomic: readers see old-or-new, never a partial file
            tmp = None
            try:                               # make the RENAME durable, not just the bytes
                dfd = os.open(d, os.O_RDONLY)
                try:
                    os.fsync(dfd)
                finally:
                    os.close(dfd)
            except OSError:                    # some filesystems refuse a directory fsync; the replace
                pass                           # already happened and is still atomic
            return True
        except Exception as e:   # a full/read-only disk must NOT report ok:true (VIGIL-DEEP-ANALYSIS §2A)
            _log.warning("config write failed: %r", e)
            return False
        finally:
            if tmp and os.path.exists(tmp):
                try:
                    os.unlink(tmp)             # never leave a stray .config.*.yaml.tmp behind
                except OSError:
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
            "settings": settings_schema.describe(cfg),
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

    # ── Storage / offload target (STORAGE-OFFLOAD-TARGETS) ──────────────────────────────────────
    # The box has a small SSD, so finished nights have to leave. This surface owns WHERE they go and
    # WHEN. It stores no secret: `storage_targets.validate` refuses a password field outright, so
    # nothing here can put one in config.yaml (world-readable) or echo one back over the LAN.

    def _storage_cfg() -> dict:
        a = cfg.get("archive") or {}
        tgt = a.get("target") or None
        out = {"enabled": bool(a.get("enabled")), "target": tgt,
               "schedule": a.get("schedule") or {"mode": "after_settle"},
               "poll_sec": a.get("poll_sec", 3600),
               "protocols": storage_targets.describe(),
               "last": a.get("_last_result") or status.get("archive", {}).get("last"),
               "status": status.get("archive", {})}
        if tgt:
            try:
                out["ready"] = storage_targets.dest_status(tgt)
                if (tgt.get("kind") or "") == "mount" and tgt.get("protocol") != "local":
                    out["mount_unit"] = storage_targets.mount_unit(tgt)
            except storage_targets.StorageError as e:
                out["ready"] = {"ready": False, "path": None, "reason": str(e)}
        return out

    async def storage_get(_req):
        return web.json_response(_storage_cfg())

    async def storage_post(req):
        """Persist the offload target + schedule. Validated BEFORE anything is written, so a rejected
        target leaves the previous one running rather than half-applying."""
        body = await _body(req)
        try:
            tgt = storage_targets.validate(body["target"]) if body.get("target") else None
            sched = storage_targets.validate_schedule(body.get("schedule"))
        except storage_targets.StorageError as e:
            return web.json_response({"ok": False, "error": str(e)}, status=400)
        except (KeyError, TypeError) as e:
            return web.json_response({"ok": False, "error": f"malformed body: {e}"}, status=400)
        a = cfg.setdefault("archive", {})
        a["enabled"] = bool(body.get("enabled", True)) and tgt is not None
        a["schedule"] = sched
        if tgt is not None:
            a["target"] = tgt
            # `dest` stays the single path the mirror writes to, so nightarchive + the retention gate
            # are unchanged: a mount target IS its mountpoint; a transfer target stages nowhere and is
            # pushed from the captures dir directly.
            if tgt["kind"] == "mount":
                a["dest"] = tgt["mountpoint"]
            else:
                a.pop("dest", None)
        else:
            a.pop("target", None)
        if not _save():
            return web.json_response({"ok": False, "error": "config write failed (disk?)"}, status=500)
        return web.json_response({"ok": True, **_storage_cfg()})

    async def storage_test(req):
        """Probe a target WITHOUT saving it, so the operator finds a wrong key or path here rather than
        at 03:00 when a night is waiting to leave."""
        body = await _body(req)
        try:
            tgt = storage_targets.validate(body.get("target") or (cfg.get("archive") or {}).get("target"))
        except storage_targets.StorageError as e:
            return web.json_response({"ok": False, "error": str(e)}, status=400)
        try:
            return web.json_response(await storage_targets.test_target(tgt))
        except Exception as e:      # a probe must never 500 the monitor
            return web.json_response({"ok": False, "detail": f"{type(e).__name__}: {e}"})

    # ── Capture timeline (per-stream state strip + per-device dBm trace) ────────────────────────
    # Deliberately NOT folded into /api/state: state is polled every 5 s by every open tab, while this
    # walks the night's files. Cached per (night, buckets) and recomputed at most every 60 s — a night
    # is ~1500 files and re-counting rows on every poll is the stall #292 moved off the event loop.
    _tl_cache: dict = {}

    async def timeline_get(req):
        night = req.query.get("night") or ""
        try:
            buckets = max(20, min(600, int(req.query.get("buckets", _timeline.DEFAULT_BUCKETS))))
        except (TypeError, ValueError):
            buckets = _timeline.DEFAULT_BUCKETS
        captures = os.path.join(cfg.get("root", "/srv/tepna"), "captures")
        if not night:
            # Default to the night being WRITTEN, which is the folder with the newest activity — not
            # the newest NAME. After midnight the sensor writers stay in their session's start-date
            # folder while only the sidecars roll, so the newest name holds two files and no data.
            try:
                nights = sorted(n for n in os.listdir(captures)
                                if _timeline._STAMP_RE.search(n + "_00000000000000_") or True)
                nights = [n for n in nights if os.path.isdir(os.path.join(captures, n))]
                night = max(nights, key=lambda n: os.path.getmtime(os.path.join(captures, n)),
                            default="")
            except OSError:
                night = ""
        if not night or "/" in night or ".." in night:
            return web.json_response({"error": "no night"}, status=400)
        key = (night, buckets)
        now = asyncio.get_event_loop().time()
        hit = _tl_cache.get(key)
        if hit and now - hit[0] < 60:
            return web.json_response(hit[1])
        try:
            out = await asyncio.to_thread(_timeline.build,
                                          os.path.join(captures, night), cfg.get("devices", []), buckets)
        except Exception as e:      # a display aid must never 500 the monitor
            return web.json_response({"error": f"{type(e).__name__}: {e}"}, status=500)
        _tl_cache.clear()
        _tl_cache[key] = (now, out)
        return web.json_response(out)

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
        web.get("/api/timeline", timeline_get),
        web.get("/api/storage", storage_get),
        web.post("/api/storage", storage_post),
        web.post("/api/storage/test", storage_test),
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
