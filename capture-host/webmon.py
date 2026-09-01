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
import asyncio, hmac, json, logging, os, re, tempfile, time as _time
from aiohttp import web
import yaml
import bonding
import daemon_control
import clockcfg
import offline_lock
import polar_pmd as pmd          # for SDK_MODE — the feature bit, named once, not spelled "0x9" here
import polar_psftp
import storage_targets
import alerts
import timeline as _timeline
import build_id
import settings_schema
import wifi_join
import wifi_uplink
from writers import missing_identity, StreamWriter

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


# Every stream name the box can actually write. The floor under the per-device firmware check in
# settings_post: that check is skipped when the device has never connected since boot, and an
# allowlist that exists only while a sensor is up is not an allowlist (CAPTURE-HOST-DEEP-AUDIT §D4).
# Derived from the writer layouts so it cannot drift from what a runner can open, plus the two the
# non-PMD runners add (`spo2` from the ring, `eeg` from the Muse child tool).
KNOWN_STREAMS = frozenset(StreamWriter.HEADERS) | {"spo2", "eeg"}

# A body that is not a JSON OBJECT. Distinct from `{}` on purpose (CAPTURE-HOST-DEEP-AUDIT §D1/§D3):
# `{}` is a caller who sent an object and omitted the keys, which several endpoints treat as a
# deliberate instruction; this is a caller whose request never arrived intact, which is never an
# instruction to do anything.
BAD_BODY = object()


async def _body(req):
    """The request's JSON object, `{}` when there is no body, or `BAD_BODY`.

    `BAD_BODY` covers two things that used to be collapsed into `{}` or to raise 500:

      * a body that does not decode as JSON (CAPTURE-HOST-DEEP-AUDIT §D1) — returning `{}` for it is
        what let `POST /api/storage` answer 200 and PERSIST the deletion of the configured offload
        target. The handler's own docstring promised the opposite ("a rejected target leaves the
        previous one running rather than half-applying"): an unparseable body was never *rejected*, it
        was applied as a clear;
      * valid JSON that is not an object — `null`, `[]`, `"x"`, `3` (§D3). `_body` guarded only a
        DECODE error, so these reached handlers as non-dicts and 500'd on `.get`.

    An ABSENT body still maps to `{}`: several endpoints legitimately mean "use the defaults" by
    posting nothing. A handler for which that is not true says so itself — see `storage_post`."""
    if not req.body_exists:
        return {}
    try:
        d = await req.json()
    except Exception:
        return BAD_BODY
    return d if isinstance(d, dict) else BAD_BODY


def _bad_body_response():
    return web.json_response(
        {"ok": False, "error": "request body must be a JSON object"}, status=400)


# Written at the top of every machine-emitted config.yaml. The file is UI-owned and `yaml.safe_dump`
# cannot round-trip comments (CAPTURE-HOST-DEEP-AUDIT §D5), so rather than let an operator discover
# that by losing 20 lines of their own notes, the file says what it is and where the prose lives.
_CFG_BANNER = (
    "# WRITTEN BY THE TEPNA MONITOR — comments in this file are NOT preserved.\n"
    "# Every save (settings / remember / forget / storage) re-emits it from the in-memory config, and\n"
    "# the YAML emitter has no comment round-trip. Keep notes in config.example.yaml, which is version\n"
    "# controlled and never written by the box.\n")

_comment_loss_warned = False

# The banner's own lines, derived FROM the banner rather than restated as substrings. The previous
# version listed three phrases to skip and missed the fourth line ("# controlled and never written by
# the box."), so a freshly machine-written config.yaml — one with no operator comments in it at all —
# was reported as carrying comments, and the box warned about losing notes nobody had written. Deriving
# the set means it cannot drift from the banner again.
_BANNER_LINES = frozenset(ln.strip() for ln in _CFG_BANNER.splitlines() if ln.strip())


def _has_comments(path: str) -> bool:
    """True when the file on disk carries operator comments this save is about to drop. Cheap, and
    deliberately ignores the banner we wrote ourselves.

    ADVISORY ONLY, SO IT MUST NOT BE ABLE TO FAIL A SAVE. `_save()` calls this inside its own
    try/except, so anything raised here is swallowed into `return False` and surfaces to the operator
    as "config write failed (disk?)" — a wrong reason for an unwritable disk that is fine. A
    non-UTF-8 byte anywhere in config.yaml (an accented device name typed in a Latin-1 editor) used to
    do exactly that and made the whole settings UI unusable until somebody found the byte."""
    try:
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                t = line.strip()
                # `# WRITTEN BY THE TEPNA MONITOR` is matched by prefix as well, so a banner emitted by
                # an older build — whose wording differs from today's — is still not mistaken for prose.
                if t.startswith("#") and t not in _BANNER_LINES \
                        and not t.startswith("# WRITTEN BY THE TEPNA MONITOR"):
                    return True
    except (OSError, UnicodeDecodeError):
        return False
    return False


def _warn_comment_loss(path: str) -> None:
    global _comment_loss_warned
    _comment_loss_warned = True
    _log.warning("config: %s carries comments that this save will DROP — the monitor owns this file "
                 "and the YAML emitter cannot round-trip comments. Keep notes in config.example.yaml.",
                 path)


def make_app(bus, cfg: dict, cfg_path: str, adapter_mac, status: dict, spawn_device,
             pull_stored=None, polar_pause=None, sync_time=None, forget_device=None,
             on_tz_change=None, notifier=None, ring_config=None, ring_buzz=None,
             cpap_pair=None, cpap_stream=None) -> web.Application:
    # 🔴 PROBED ONCE, HERE, BECAUSE THIS IS DAEMON STARTUP.
    # Reading it per-request would report the sha on DISK, which after a deploy is the new code while
    # this process is still serving the old — the "is X deployed?" question answering itself wrongly.
    # Measured on vigil 2026-08-30: the checkout sat at 2618f8f9 while the running process had started
    # 30 minutes earlier on da2c55b6. Held in memory, this reports what is RUNNING.
    _build = build_id.probe(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
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
                           ("name", "vendor", "model", "device_id", "device_id_aliases", "name_aliases", "address", "streams")},
                        "connected": bool(st.get("connected")),
                        "battery": st.get("battery"),
                        "rssi": st.get("rssi"),
                        "clock_synced": st.get("clock_synced"),
                        "device_time": st.get("device_time"),
                        "clock_skew_sec": st.get("clock_skew_sec"),
                        # THE WATCHDOG'S GIVE-UP VERDICT, which until now reached nobody. `capture.py`
                        # sets it when the clock write has failed its whole budget and retracts it on the
                        # next successful sync — a fact with 7 tests pinning it and, before this line, no
                        # consumer at all. That is the failure the `worn_why` comment below describes,
                        # one field over: a value that exists in STATUS but is not forwarded here is NOT
                        # published. For a suite whose Clock Contract rests on device time being
                        # trustworthy, a night captured under an uncorrectable clock was downstream
                        # indistinguishable from a good one.
                        "clock_uncorrectable": st.get("clock_uncorrectable"),
                        # A RATE THE DEVICE REFUSED. capture.py logs it with the words "the config
                        # still says %s; nothing else will tell you it did not happen" — and then
                        # published `rate_unmet` to STATUS, where nothing read it. The log line was
                        # more literally true than its author intended. It matters because the config
                        # keeps claiming the rate you asked for: a Verity negotiated down from 176 Hz
                        # is a different recording, and only this field says so after the fact.
                        "rate_unmet": st.get("rate_unmet"),
                        # WHEN THIS DEVICE LAST PRODUCED A SAMPLE. Published on every write and read by
                        # nothing until now. `nightqc` computes a per-night `silent_sec` and the frozen-
                        # sensor alert fires off it, but that is a NIGHT summary — an operator watching
                        # the card mid-session had no way to see a stream that stopped four minutes ago
                        # while the link stayed up. That is the same failure the frozen alert exists for,
                        # one time-scale down.
                        "last_sample": st.get("last_sample"),
                        "pull_progress": st.get("pull_progress"),
                        # §19/§20 — the O2Ring presence axis and its EXECUTION WITNESS. `presence` is
                        # an observation (advertising ≠ connected ≠ recording); `presence_witness` is
                        # the one field that says where the §19 chain STOPS, so a path that never
                        # armed cannot read as healthy. §20 is explicit that exposing only
                        # "enabled = true" is insufficient — and a field forwarded here but drawn by
                        # nobody is still not exposed, which is why monitor.html draws all three.
                        "presence": st.get("presence"),
                        "presence_reason": st.get("presence_reason"),
                        "presence_witness": st.get("presence_witness"),
                        # link_epoch (E5) is the reconnect count — the honest churn signal a green
                        # "connected" dot hides. A device that flaps all night reads "connected" at every
                        # sample yet has a climbing epoch; surfacing it is what makes that visible.
                        "link_epoch": st.get("link_epoch"),
                        "worn": st.get("worn"),
                        # WHICH SOURCE DECIDED, and what the other one thought. `worn` alone is a bare
                        # True/False/None with no provenance, and on 2026-08-13 that was the entire
                        # failure: an armband on a desk reported `worn: True` from its HR contact bit
                        # for ten hours while nothing said where that came from or that the optical
                        # detector disagreed. The daemon logs the conflict; a log line does not reach
                        # the person looking at the monitor. A field that exists in STATUS but is not
                        # forwarded here is NOT published — the same class as a DSP value that never
                        # reaches its export, and it fails silently in both directions.
                        "worn_why": st.get("worn_why"),
                        "worn_optical": st.get("worn_optical"),
                        "worn_optical_why": st.get("worn_optical_why"),
                        # THE RING'S OWN CLOCK vs the host (GET_INFO [24:31], readable since 2026-08-19).
                        # The 6-hourly 0xC0 push was previously trusted blind; this read-back says whether
                        # it landed and how far the free-running RTC has wandered since.
                        "ring_rtc_offset_s": st.get("ring_rtc_offset_s"),
                        "ring_rtc_read": st.get("ring_rtc_read"),
                        # The ring's settings struct AS THE RING REPORTS IT (0x00 read-back), plus the
                        # verdict of the last monitor-queued write. The requested value is deliberately
                        # not echoed anywhere — only what the device confirmed.
                        "ring_config": st.get("ring_config"),
                        "ring_config_verdict": st.get("ring_config_verdict"),
                        "ring_buzz_at": st.get("ring_buzz_at"),
                        # A battery-event RTC reset, flagged the moment a readback sees the jump — the
                        # stored .dat timebase is suspect from this instant until the next verified push.
                        "ring_rtc_reset_suspect": st.get("ring_rtc_reset_suspect"),
                        "charging": bool(st.get("charging")),
                        # How many of this device's flushes have FAILED. Distinct from `last_error`,
                        # which is about the LINK: a write failure means the samples arrived and may
                        # not have reached the disk, so the card can read perfectly live while the
                        # night is being lost. Zero on every healthy device.
                        "flush_failures": st.get("flush_failures"),
                        "last_error": st.get("last_error")})
        return out

    async def index(_req):
        # NO-CACHE, deliberately. The page is the OPERATOR'S WINDOW ONTO A LIVE CAPTURE, and a stale copy
        # of it is not a cosmetic problem — it is a wrong answer about whether tonight is recording.
        # Measured 2026-08-25: after a box reboot the owner's tab showed an empty stream grid while 15
        # streams were live, and a soft refresh did not necessarily fetch the repaired script (Etag +
        # Last-Modified alone let mobile Chrome reuse the cached HTML heuristically). The page is ~190 KB
        # on a LAN, served by the same box that is capturing — re-fetching it costs nothing that matters,
        # and being able to trust what it shows costs everything.
        return web.FileResponse(os.path.join(_HERE, "monitor.html"),
                                headers={"Cache-Control": "no-cache, must-revalidate"})

    def _cpap_live_block(c):
        """The serve-time "is therapy running NOW" view, as its OWN top-level block.

        ⚠️ NOT merged into `cpap`, and a contract test enforces that. `test_webmon_state_contract`
        asserts every top-level block is projected VERBATIM, precisely so a lookup reading the wrong
        key gives a loud mismatch instead of a permanently-empty panel — enriching `cpap` in place
        broke it, and the right answer was the sibling key, not a relaxed contract. It is also the
        more honest shape: harvest state counts FILES on a daily timer, this reads a BLE detector
        seconds ago, and they are two facts that happen to concern one machine.

        Never raises: a diagnostic overlay must not be able to take the state endpoint down."""
        if not isinstance(c, dict):
            return None
        try:
            import cpap_live
            poll_s = float(((cfg.get("as11_detector") or {}).get("poll_interval_sec")) or 30.0)
            return cpap_live.live_view(c, _time.time() * 1000.0, poll_s)
        except Exception:  # noqa: BLE001
            _log.exception("cpap live-view failed; omitting the block")
            return None

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
            # Alert-transport health. The monitor renders three states from it — ok / unproven /
            # FAILING — because "enabled and never delivered anything" is not the same as working.
            "alerts": status.get("alerts"),
            # Offload result, so the sidebar pill can say whether anything actually left the box.
            "archive": status.get("archive"),
            # CPAP harvest (CPAP-AUTOHARVEST-2026-07-26-BRIEF). Its OWN block, deliberately not a
            # pseudo-device under `devices`: the CPAP arrives as FILES on a daily timer with no BLE
            # link, so it has no connected/RSSI/worn state and would render as a permanently-dead
            # sensor if it sat in that list. Null until the poller has run once.
            #
            # `live` answers the DIFFERENT question "is therapy running NOW", which the harvest fields
            # cannot: they count files. It is computed HERE, at serve time, and not at publish time,
            # because the answer ages between the two — a value stamped 40 minutes ago and served as
            # `therapy: true` is a fabricated present tense. See `cpap_live.live_view`.
            #
            # ⚠️ THE AGEING MUST HAPPEN ON THIS SIDE. `detector_host_ms` is a BOX-local stamp; a
            # browser subtracting it from its own clock differences two clocks and prints the result
            # as a duration. Both operands here are this host's clock.
            "cpap": status.get("cpap"),
            # SEPARATE BLOCK, SEPARATE QUESTION. `cpap` above counts harvested FILES on a daily timer;
            # this answers "is therapy running right now", from the AS11 shadow detector, aged HERE at
            # serve time. Null when there is no cpap block at all.
            "cpap_live": _cpap_live_block(status.get("cpap")),
            # PER-DEVICE reconnect distress against that device's own per-adapter baseline. Forwarded
            # so it EXISTS for a human at all: it was published to STATUS and read by nothing — not
            # this projection, not the monitor, not the failover ladder — so a distressed radio was
            # computed nightly and seen by nobody (enumerated 2026-09-01).
            #
            # ⚠️ IT DOES NOT DRIVE FAILOVER, AND MUST NOT WITHOUT AGGREGATION. The verdict is
            # per-DEVICE; `ADAPTER` is a single global pin, so firing a switch off one device's
            # distress would relocate every OTHER device — off a radio their own baselines say is
            # fine. Rendering is the honest consumer until a per-ADAPTER verdict exists.
            "radio_distress": status.get("radio_distress"),
        })

    # ── CPAP manual pull ────────────────────────────────────────────────────────────────────────
    # The scheduled poller owns the 13:00 window; this is the operator's "do it now" for a night that
    # was missed or a card that was swapped. It enforces the SAME streaming interlock as the poller —
    # a manual button is not a reason to put a 2.4 GHz transmitter next to a recording sensor
    # (measured 2026-07-26: 5-7 dB and 17 reconnects across three sensors during a pull).
    _cpap_busy = {"running": False}

    async def cpap_pull(req):
        import cpap_harvest
        ccfg = cfg.get("cpap") or {}
        if not ccfg.get("enabled"):
            return web.json_response({"ok": False, "error": "cpap harvest is disabled in config"}, status=400)
        if _cpap_busy["running"]:
            return web.json_response({"ok": False, "error": "a pull is already running"}, status=409)
        body = await _body(req)
        if body is BAD_BODY:
            return _bad_body_response()
        scope = body.get("scope") or "missing"
        if scope not in ("last", "week", "missing"):
            return web.json_response({"ok": False, "error": f"unknown scope {scope!r}"}, status=400)
        busy = cpap_harvest.blocking_devices(status.get("devices"))
        if busy:
            # 409, not 500: the box is working exactly as intended and the operator can retry later.
            return web.json_response({"ok": False, "busy": busy,
                                      "error": "sensors are streaming: " + ", ".join(busy)}, status=409)

        import datetime as _d
        nights = cpap_harvest.nights_for(scope, _d.datetime.now())
        dest = os.path.join(cfg.get("root", "/srv/tepna"), ccfg.get("dest_subdir", "captures/cpap"))
        profile = str(ccfg.get("wifi_profile", "ezshare"))
        max_run = float(ccfg.get("max_run_sec", 5400))

        root = cfg.get("root", "/srv/tepna")
        base = ccfg.get("base_url", cpap_harvest.DEFAULT_BASE)

        def _work(direct_hint):
            # SAME TWO RULES AS THE SCHEDULED LOOP, and they have to be stated here too because this is
            # a second caller of the same machinery — a manual pull that behaves differently from the
            # nightly one is a trap for whoever is debugging at 2am.
            #   1. already reachable ⇒ associate nothing (a station-mode card needs no Wi-Fi work);
            #   2. `root` MUST be passed, so the wpa control dir is probed against a path inside
            #      ReadWritePaths. Omitting it silently falls through to /tmp, which is READ-ONLY under
            #      ProtectSystem=strict — measured: the scheduled path worked and this one still failed
            #      with "Failed to initialize control interface '/tmp/tepna-wpa-1000'".
            # Probed by the CALLER and handed in, because the uplink handover below has to know the
            # answer BEFORE it decides whether to drop the box's Wi-Fi. Re-probing here would cost a
            # second 5 s round trip on a button press and could disagree with the decision already made.
            direct = direct_hint
            if not direct:
                guard = cpap_harvest.default_route_dev()
                if not cpap_harvest.wifi_up(profile, 45.0, guard, root=root):
                    return {"ok": False, "error": "could not associate to the card"}
            try:
                r = cpap_harvest.harvest(dest, base, nights,
                                         __import__("time").monotonic() + max_run)
            finally:
                if not direct:
                    cpap_harvest.wifi_down(profile, root=root)
            r["ok"] = not (r["short"] or r["errors"])
            return r

        _cpap_busy["running"] = True
        # ONE RADIO, ONE ASSOCIATION — same handover as the nightly loop in capture.py, INCLUDING the
        # "already reachable ⇒ associate nothing" rule. A card in station mode is reached over the
        # existing network, so the harvest never touches the radio and the uplink must not be dropped:
        # suspending here regardless would take the box off Wi-Fi on every manual pull, for nothing.
        # (That is the current vigil deployment — `reachable` is true and the association path is never
        # entered — so an unconditional suspend would be wrong on the only box this runs on.)
        uplink_suspended = False
        harvest_ok = False
        try:
            # INSIDE the try, deliberately. `reachable` does network I/O and can raise, and this
            # handler's contract is that a manual pull never 500s the monitor — moving the probe out
            # to inform the suspend decision moved it out of that guarantee too, and a ConnectionReset
            # from the probe came back as a text/plain 500 instead of the JSON error contract.
            direct = await asyncio.to_thread(cpap_harvest.reachable, base, 5.0)
            if not direct:
                uplink_suspended, why = await wifi_uplink.suspend_for_harvest(root)
                _log.info("cpap/pull: %s", why)
            res = await asyncio.to_thread(_work, direct)
            harvest_ok = bool(res.get("ok"))
        except Exception as e:            # noqa: BLE001 — a manual pull must never 500 the monitor
            return web.json_response({"ok": False, "error": f"{type(e).__name__}: {e}"}, status=500)
        finally:
            _cpap_busy["running"] = False
            # In the `finally` so it runs on the exception path too — that early `return` is exactly
            # the door through which a suspended uplink would otherwise never be restored.
            if uplink_suspended:
                _, rwhy = await wifi_uplink.resume_after_harvest(root, uplink_suspended, harvest_ok)
                _log.info("cpap/pull: %s", rwhy)
        st = status.setdefault("cpap", {})
        st.update(state="ok" if res.get("ok") else "error", **{k: v for k, v in res.items()
                  if k in ("files", "bytes", "nights", "skipped", "short", "errors", "nights_on_card")})
        return web.json_response({"scope": scope, **res})

    async def cpap_pair_h(req):
        """POST /api/cpap/pair {passkey} — run the ResMed AS11 SRP-6a pairing using the passkey the
        CPAP shows on its screen, and store the credentials for later BLE pulls (as11_creds.json).

        The pairing exchange is PLAINTEXT SRP (no AES, no extra dependency); the BLE handshake itself
        runs on the daemon, which owns the radios — so a build without AS11 support answers 501, never
        a 200 that paired nothing. The device must be in Bluetooth pairing mode (its menu → Bluetooth)
        so it shows a passkey; without that there is nothing to enter here. The response carries whatever
        the daemon's pairing op reports (verified/stored), never a bare 'queued' — pairing either
        completed against the device or it did not."""
        if cpap_pair is None:
            return web.json_response(
                {"ok": False, "error": "CPAP BLE pairing is not wired on this daemon"}, status=501)
        body = await _body(req)
        if body is BAD_BODY:
            return _bad_body_response()
        passkey = str(body.get("passkey", "")).strip()
        if not (passkey.isdigit() and 4 <= len(passkey) <= 10):
            return web.json_response(
                {"ok": False, "error": "passkey must be the 4–10 digit code shown on the CPAP screen"},
                status=400)
        try:
            res = await cpap_pair(passkey)
        except Exception as e:            # noqa: BLE001 — a pairing attempt must never 500 the monitor
            return web.json_response({"ok": False, "error": f"{type(e).__name__}: {e}"}, status=500)
        return web.json_response(res)

    async def cpap_stream_h(req):
        """POST /api/cpap/stream {action:"start"|"stop"} — start or stop the live CPAP waveform.

        On start the daemon opens the ResMed AS11 encrypted stream on the FREE radio and pushes flow +
        pressure onto the telemetry bus, so the samples appear in the monitor's Live-streams grid over
        the existing SSE — no separate feed. The daemon owns the radios and enforces the same interlock
        the CPAP pull does (it refuses while a wearable is delivering), so a build without AS11 support
        answers 501 and a contended box answers whatever the daemon reports (ok:false), never a 200 that
        streamed nothing. Read-only: StartStream is an `application` read, no therapy RPC is ever sent."""
        if cpap_stream is None:
            return web.json_response(
                {"ok": False, "error": "CPAP BLE streaming is not wired on this daemon"}, status=501)
        body = await _body(req)
        if body is BAD_BODY:
            return _bad_body_response()
        action = str(body.get("action", "")).strip()
        if action not in ("start", "stop"):
            return web.json_response(
                {"ok": False, "error": "action must be 'start' or 'stop'"}, status=400)
        try:
            res = await cpap_stream(action)
        except Exception as e:            # noqa: BLE001 — a stream toggle must never 500 the monitor
            return web.json_response({"ok": False, "error": f"{type(e).__name__}: {e}"}, status=500)
        return web.json_response(res)

    async def scan(_req):
        found = await bonding.scan(adapter_mac)
        return web.json_response([f.__dict__ for f in found])

    async def bond(req):
        body = await _body(req)
        if body is BAD_BODY:
            return _bad_body_response()
        if not _valid_mac(body.get("address")):
            return web.json_response({"ok": False, "error": "invalid device address"}, status=400)
        return web.json_response(await bonding.bond(body["address"], adapter_mac))

    async def forget(req):
        body = await _body(req)
        if body is BAD_BODY:
            return _bad_body_response()
        if not _valid_mac(body.get("address")):
            return web.json_response({"ok": False, "error": "invalid device address"}, status=400)
        res = await bonding.forget(body["address"], adapter_mac)
        cfg["devices"] = [d for d in cfg.get("devices", []) if d.get("address") != body["address"]]
        if not _save():
            return web.json_response({"ok": False, "error": "config write failed (disk?)"}, status=500)
        if forget_device:                     # stop the runner too — else it reconnects a dropped device
            forget_device(body["address"])
        return web.json_response(res)

    async def ring_buzz_h(req):
        """POST /api/ring/buzz {address} — fire ONE commanded vibration on the ring's next poll.
        The buzz-fiducial marker: operator-commanded from the monitor while every device records, so
        one mechanical event lands in N streams on one box clock. The response reports queued, not
        fired — the daemon logs + publishes `ring_buzz_at` when the frame actually goes out."""
        if ring_buzz is None:
            return web.json_response({"ok": False, "error": "buzz not wired on this daemon"}, status=501)
        body = await _body(req)
        if body is BAD_BODY:
            return _bad_body_response()
        if not _valid_mac(body.get("address")):
            return web.json_response({"ok": False, "error": "invalid device address"}, status=400)
        ring_buzz(body["address"])
        return web.json_response({"ok": True, "queued": True,
                                  "note": "fires on the ring's next poll; ring_buzz_at on /api/state stamps the command"})

    async def ring_config_h(req):
        """POST /api/ring/config {address, field, value} — queue ONE whitelisted O2Ring settings write.
        Validation is capture.queue_ring_config's (it builds the frame via oxyii.set_config_frame, so an
        off-whitelist field or out-of-range value 400s HERE and nothing invalid ever waits on a link).
        The write itself lands on the ring's next live poll (~1 s when connected); the monitor then shows
        the ring's own read-back (`ring_config` + `ring_config_verdict` on /api/state), never the value
        that was merely requested."""
        if ring_config is None:
            return web.json_response({"ok": False, "error": "ring settings not wired on this daemon"},
                                     status=501)
        body = await _body(req)
        if body is BAD_BODY:
            return _bad_body_response()
        if not _valid_mac(body.get("address")):
            return web.json_response({"ok": False, "error": "invalid device address"}, status=400)
        field = body.get("field")
        try:
            value = int(body.get("value"))
        except (TypeError, ValueError):
            return web.json_response({"ok": False, "error": "value must be an integer"}, status=400)
        try:
            ring_config(body["address"], field, value)
        except ValueError as e:
            return web.json_response({"ok": False, "error": str(e)}, status=400)
        return web.json_response({"ok": True, "queued": {"field": field, "value": value},
                                  "note": "applied on the ring's next poll; verify via ring_config on /api/state"})

    async def remember(req):
        dev = await _body(req)
        if dev is BAD_BODY:
            return _bad_body_response()
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
        _KEYS = ("name", "vendor", "model", "device_id", "device_id_aliases", "name_aliases", "address", "streams")
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
            pass       # THE NORMAL END OF AN SSE STREAM: the operator closed the tab. All three
                       # are the client going away, not a fault, and the `finally` below does the
                       # only thing that matters — unsubscribe, so the bus stops filling a dead queue
        finally:
            _live_queues.discard(q)
            bus.unsubscribe(q)
        return resp

    async def pull_stored_h(req):
        # Download the O2Ring's onboard-recorded .dat over BLE. Pauses live SpO2 capture for the duration
        # (one BLE link). Synchronous: returns when the pull completes (a night file is small, ~a minute).
        if not pull_stored:
            return web.json_response({"ok": False, "detail": "stored-session pull not available"}, status=400)
        # DELIBERATELY TOLERANT, unlike the other POSTs. This body carries only which/ftype DEFAULTS —
        # there is no state to half-apply and nothing to destroy — and two tests pin the tolerance as
        # the intended behaviour. Contrast `storage_post`, where the same leniency deleted the
        # configured offload target (CAPTURE-HOST-DEEP-AUDIT §D1). Non-object bodies are folded to the
        # defaults here rather than 500'ing on `.get`, which is §D3's half of the fix.
        body = await _body(req)
        if body is BAD_BODY:
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
        the thing it was reporting on.)

        ⚠️ THE UI OWNS THIS FILE, AND WRITING IT DESTROYS THE OPERATOR'S COMMENTS
        (CAPTURE-HOST-DEEP-AUDIT §D5). `yaml.safe_dump` has no comment round-trip, so the emitted
        document is comment-free BY CONSTRUCTION — 20 comment lines in, 0 out, values identical. That
        is why four hand-made backups of one file were sitting in the working tree
        (`config.yaml.bak`, `.pre-acc52`, `.pre-coospo`, `.pre-ppi-1646`): the comment-free ones are
        machine-emitted and the human re-authored the comments by hand afterwards.

        Not silently accepted, and not fixed by adding `ruamel.yaml` either — a runtime dependency for
        comment preservation is a SOUP entry on a 62304-aligned appliance, which is a real cost for a
        cosmetic gain. The honest resolution is to say so: the loss is announced once per process, and
        `config.example.yaml` (version-controlled, never written by the box) is where the prose that
        explains each key actually lives.

        The 0664 -> 0600 permission change is NOT a defect and is left alone: narrowing a config the
        code itself calls world-readable is an improvement, and no consumer reads it as another user."""
        d = os.path.dirname(os.path.abspath(cfg_path)) or "."
        tmp = None
        try:
            if not _comment_loss_warned and _has_comments(cfg_path):
                _warn_comment_loss(cfg_path)
            fd, tmp = tempfile.mkstemp(prefix=".config.", suffix=".yaml.tmp", dir=d)
            with os.fdopen(fd, "w") as f:
                f.write(_CFG_BANNER)
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
                    pass   # already on the failure path, and the caller is being told the SAVE
                           # failed — a stray temp file must not displace that report

    # ── Clock / NTP / timezone (Clock Contract §🔒 — the box's wall clock stamps every capture) ──
    _clock_sudo = (cfg.get("clock") or {}).get("sudo", True)

    async def clock_get(_req):
        return web.json_response(await clockcfg.status())

    async def clock_set(req):
        body = await _body(req)
        if body is BAD_BODY:
            return _bad_body_response()
        servers = body.get("servers") or []
        if isinstance(servers, str):
            servers = servers.replace(",", " ").split()
        return web.json_response(
            await clockcfg.set_ntp(servers, body.get("poll_max_sec", 2048), sudo=_clock_sudo))

    async def clock_sync(_req):
        return web.json_response(await clockcfg.sync_now(sudo=_clock_sudo))

    async def clock_tz(req):
        body = await _body(req)
        if body is BAD_BODY:
            return _bad_body_response()
        r = await clockcfg.set_tz(body.get("timezone"), sudo=_clock_sudo)
        # A deliberate zone change must RE-ANCHOR the capture clock, not be absorbed by it
        # (CAPTURE-HOST-DEEP-AUDIT §A1). `_now()` sees a zone move as a DST relabelling — offset delta
        # equals apparent drift, by construction — and keeps counting in the OLD offset, so without this
        # the box answered ok, reported the new zone with `tz_set: true`, and silently stamped every
        # subsequent file an hour off. Only this handler knows the change was intended.
        if r.get("ok") and on_tz_change is not None:
            try:
                on_tz_change(f"timezone set to {r.get('timezone')}")
            except Exception:                     # never fail the tz change over its own bookkeeping
                _log.exception("clock/tz: re-anchor hook failed")
        return web.json_response(r)

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
        # O2Ring ppg: 6200 B/s measured while the stream ran at its observed ROW rate (~125.7 = 125.000 ADC
        # samples + inserted `156` beat markers), NOT the 125.000 ADC clock — a throughput calibration is
        # bytes over the rate the wire actually carried. DEVICE-RATE-TRUTH §2; cf. capture.O2PPG_FS_DEFAULT.
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

    def _schedule(delay, verb, minutes):
        """Fire the helper AFTER the response has flushed.

        A named seam, not an inline lambda, because a test must be able to observe that the daemon WAS
        scheduled without actually stopping the unit the test runner is inside. Monkeypatching this is
        how the ordering gets asserted at all."""
        asyncio.get_running_loop().call_later(delay, lambda: daemon_control.run(verb, minutes))

    async def daemon_post(req):
        """Stop or restart the capture daemon from the monitor, so recovery needs no terminal.

        ⚠️ THIS UNIT SERVES THIS RESPONSE. `restart` and `stop` end the process that is writing the
        reply, so firing synchronously drops the connection mid-write and the operator sees a failed
        request for an action that in fact succeeded — indistinguishable from a crash, and the reason
        people stop trusting the button. So: validate, ANSWER, then fire on a short delay.

        VALIDATION HAPPENS BEFORE THE ANSWER, not in the deferred half. An answer-then-fire design that
        validates late returns a cheerful 200 and then does nothing, which is worse than a 400 — it is
        the silent-success shape this suite keeps finding elsewhere."""
        body = await _body(req)
        if body is BAD_BODY:
            return _bad_body_response()
        verb, minutes = body.get("verb"), body.get("minutes")
        # ⚠️ THE USB PORT COMES FROM THIS SERVER'S CONFIG, NEVER FROM THE REQUEST BODY. `rebind` unbinds
        # and re-binds a device as root, and the helper's real allowlist is the device CLASS it reads off
        # the hardware — but an argument the caller chooses is still an argument the caller chooses, and
        # the whole fixed-surface pattern exists so that a request cannot name the target. So the body's
        # `minutes` is DISCARDED here and replaced, rather than defaulted from: a body that carries a
        # port must not be able to influence one.
        if verb == "rebind":
            minutes = (cfg.get("watchdog") or {}).get("usb_path")
            if not minutes:
                return web.json_response(
                    {"ok": False, "verb": verb,
                     "error": "no watchdog.usb_path in config — this box has no adapter port to re-bind"},
                    status=400)
        try:
            daemon_control.build_cmd(verb, minutes)      # raises on a bad verb or bad argument
        except daemon_control.VerbError as e:
            return web.json_response({"ok": False, "verb": verb, "error": str(e)}, status=400)
        # ⚠️ THE ON-BODY GUARD FOR THE SELF-KILLING VERBS, AND WHY IT IS HERE RATHER THAN IN THE HELPER.
        # restart/stop/reboot (daemon_control.KILLS_SELF) each END this daemon and drop every BLE link, so
        # firing one while a sensor is worn loses that night's live recording — measured 2026-08-23, a
        # `restart` mid-capture dropped 13 active streams. "Is a sensor recording right now?" is a question
        # only this process can answer; the helper would have to infer it from file mtimes, and status.json
        # plus the LINK log are written continuously whether or not any sensor is connected — so a helper-
        # side guard would refuse forever. A guard that is usually wrong is worse than one honestly placed.
        #
        # THE PREDICATE IS on_body, NOT `connected` — and that is the fix, not an incidental. Until now
        # only `reboot` was guarded and it gated on `connected`: a docked/charging sensor reports
        # connected=True while producing nothing, so that guard refused a reboot on an evening every sensor
        # was idle on its charger (2026-07-26) — the false positive that trains an operator to always pass
        # force. `blocking_devices` is single-sourced on telemetry.on_body (a charging device cannot be on
        # a body); it ignores charging/not-worn and blocks only on a radio actually carrying traffic near a
        # body, or an unknown — which is cheap to force past. DROPS_LINKS (radio/rebind) is deliberately
        # NOT guarded: those are the BLE-recovery rungs, run precisely when links are already stuck, so a
        # worn-gate there would block the fix.
        #
        # `force` is an explicit act, not a bypass: the caller is told exactly what is on-body and has to
        # say it anyway. Anyone who could route around this already has `sudo` and could reboot directly.
        if verb in daemon_control.KILLS_SELF and not body.get("force"):
            import cpap_harvest

            worn = cpap_harvest.blocking_devices(status.get("devices"))
            if worn:
                return web.json_response(
                    {
                        "ok": False,
                        "verb": verb,
                        "worn": worn,
                        "error": f"refusing to {verb} — a sensor is recording on-body: "
                        f"{', '.join(worn)}. Re-send with force:true if you mean it.",
                    },
                    status=409,
                )
        if verb not in daemon_control.KILLS_SELF:
            # ⚠️ OFF THE EVENT LOOP. `daemon_control.run` is a blocking subprocess call, and the inline
            # verbs are not all fast: the helper sleeps 5 s inside `radio` and up to 11 s inside
            # `rebind`, and `deploy` does a NETWORK fetch that has taken 300 s on this box. Called
            # directly, every one of those freezes the whole monitor — the live SSE feed, every other
            # request — for its full duration, and a recovery button that hangs the page it is served
            # from is the shape people stop trusting.
            return web.json_response(await asyncio.to_thread(
                daemon_control.run, verb, minutes,
                timeout=daemon_control.timeout_for(verb)))
        _schedule(daemon_control.RESTART_DELAY_S, verb, minutes)
        detail = {
            "stop": lambda: ("stopping capture for %s min — this page will disconnect and the daemon "
                             "restarts itself afterwards" % daemon_control.coerce_minutes(minutes)),
            "reboot": lambda: "rebooting the host — this page will disconnect for a minute or so; "
                              "capture resumes on boot",
        }.get(verb, lambda: "restarting — this page will disconnect for a few seconds")()
        return web.json_response({
            "ok": True, "verb": verb, "scheduled_in_s": daemon_control.RESTART_DELAY_S,
            "detail": detail})

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
                #
                # ⚠️ `ppg2w` WAS MISSING HERE AND THAT DELETED IT FROM config.yaml. For a device with no
                # capability read this list IS the offer set, so a capturable stream absent from it is
                # not merely un-toggleable: `saveSettings` posts only the rendered checkboxes and the
                # server assigns the WHOLE list per address, so the first ordinary save after that
                # stream was enabled silently dropped it. Measured — the O2Ring wrote 110 MB of `_PPG2W`
                # on the night of 2026-08-09 and 0 rows on 2026-08-10, and the config backups bracket
                # the loss to a routine settings save (`bak-20260809-083246` has it,
                # `bak-2026-08-10-1806` does not). `write_ppg2w` was present the whole time; nothing was
                # broken except this list.
                #
                # The rule: anything `run_oxyii` can open a writer for MUST appear here, or enabling it
                # is unreachable and keeping it is impossible. Gate-backed below.
                supported = ["spo2", "ppg", "ppg2w"]
            # SDK MODE IS OFFERED ONLY WHERE THE DEVICE ADVERTISES IT (feature bit 0x9), and the
            # capability is DERIVED, never inferred from vendor or model: a switch that cannot work is
            # worse than an absent one, because the operator sets it and the config then claims a mode
            # the hardware never had. `pmd_supported` is the live read, `pmd_supported_seen` what the
            # last connect saw — the same fallback pair `rate_options` uses, so the switch survives the
            # device being asleep. Note `supported` above deliberately STRIPS the `0x…` flags, which is
            # why this reads the unfiltered list instead.
            seen_flags = [str(x) for x in (st.get("pmd_supported") or d.get("pmd_supported_seen") or [])]
            devs.append({"name": d.get("name"), "address": d.get("address"), "vendor": d.get("vendor"),
                         "streams": d.get("streams") or [], "supported": supported,
                         "bps": _bps_for(d), "bps_ref": _bps_ref(d),
                         # the device's OWN menu of legal rates, read at connect — a dropdown built from
                         # this cannot offer an unsupported value
                         "rate_options": st.get("pmd_options") or {},
                         "rates": d.get("rates") or {},
                         "sdk_capable": hex(pmd.SDK_MODE) in seen_flags,
                         "sdk_mode": bool(d.get("sdk_mode")),
                         # WHAT THE DEVICE LAST SAID, which is not what the config asked for: True on,
                         # False off, None never reported. Kept separate and rendered as its own state —
                         # collapsing "unknown" into "off" is how a night runs at 55 Hz under a config
                         # that reads 176 with nothing to show for it (see capture._enter_sdk_mode).
                         "sdk_mode_actual": st.get("sdk_mode")})
        return web.json_response({
            "settings": settings_schema.describe(cfg),
            "devices": devs,
            "bps_by_model": _BPS_BY_MODEL,
        })

    async def settings_post(req):
        """Apply allowlisted settings and/or per-device stream selections. Validates EVERYTHING before
        touching config.yaml, and backs the file up first — a corrupt config on a headless box means no
        capture and no web surface to fix it from."""
        body = await _body(req)
        if body is BAD_BODY:
            return _bad_body_response()
        changed, restart_needed, warnings = [], False, []
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
                # A STATIC FLOOR FIRST, so an unknown stream NAME is refused whatever the device's
                # connection state (CAPTURE-HOST-DEEP-AUDIT §D4). The firmware check below is skipped
                # entirely when `pmd_supported` is absent — and it is absent for a device that has
                # never connected SINCE BOOT (not merely one that is disconnected: `pmd_supported` is
                # written once at connect and `_set` only ever `update`s, so it survives a drop). The
                # consequence was bounded — capture.py ignores an unrecognised stream name, so no
                # writer and no file — but "the guard is absent and nothing downstream happens to care"
                # is not a guard.
                bad = [x for x in streams if x not in KNOWN_STREAMS]
                if bad:
                    raise settings_schema.SettingsError(
                        f"unknown stream(s): {', '.join(sorted(bad))} "
                        f"(known: {', '.join(sorted(KNOWN_STREAMS))})")
                st = status.get("devices", {}).get(dev.get("name"), {})
                # REMEMBERED capabilities: what the device advertised the last time it connected,
                # persisted so a reboot does not disarm the check until the sensor next comes up.
                sup = st.get("pmd_supported")
                if sup:
                    dev["pmd_supported_seen"] = list(sup)
                else:
                    sup = dev.get("pmd_supported_seen")
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
                if opts:
                    dev["pmd_options_seen"] = {k: list(v) for k, v in opts.items()}
                else:
                    opts = dev.get("pmd_options_seen") or {}
                clean = {}
                for stream, val in rates.items():
                    if stream not in KNOWN_STREAMS:
                        raise settings_schema.SettingsError(f"unknown stream {stream!r}")
                    try:
                        v = int(val)
                    except (TypeError, ValueError):
                        raise settings_schema.SettingsError(f"{stream} rate must be a number") from None
                    # A FLOOR, independent of the device menu (§D4): a never-connected device offered no
                    # menu, and `-1` or `0` Hz is not a rate under any firmware.
                    if not 1 <= v <= 10_000:
                        raise settings_schema.SettingsError(
                            f"{stream}: {v} Hz is not a plausible sample rate")
                    allowed = opts.get(stream) or []
                    if allowed and v not in allowed:
                        # Refuse rather than let the device reject the START and leave an idle stream.
                        raise settings_schema.SettingsError(
                            f"{dev.get('name')} {stream}: {v} Hz not offered (choose {allowed})")
                    clean[stream] = v
                # MERGE, NEVER REPLACE. A whole-dict assignment silently DELETES every override the
                # submitted payload happens not to mention, and the UI does not mention all of them: it
                # only renders a control for a rate the device is currently OFFERING. So a stream whose
                # menu has shrunk — the Verity's PPG drops 28/44/135/176 the moment SDK mode is off, and
                # ACC/GYRO drop everything but 52 — has no control, is not submitted, and was being
                # erased by the next unrelated settings save.
                #
                # MEASURED: that is exactly how 176 Hz PPG was lost on 2026-08-03. `config.yaml.bak`
                # still holds `ppg: 176, acc: 26, gyro: 26`; the live config kept only `mag: 10`, and
                # the save that did it was someone toggling PPI on. Nothing logged, nothing failed.
                #
                # Keeping an override the device does not currently offer is SAFE and is the point:
                # `polar_pmd.chosen_rate` honours a configured rate only if the device offers it and
                # otherwise falls back, so a preserved 176 lies dormant and re-applies by itself when
                # SDK mode returns. To change a rate you set it; there is deliberately no way to clear
                # one by omission, because omission is indistinguishable from "the UI could not show it".
                merged = dict(dev.get("rates") or {})
                merged.update(clean)
                if merged != (dev.get("rates") or {}):
                    dev["rates"] = merged
                    changed.append(f"{dev.get('name')}.rates")
                    restart_needed = True     # rate is fixed at PMD START, i.e. at connect

            for addr, want in (body.get("sdk_mode") or {}).items():
                dev = next((d for d in cfg.get("devices", []) if d.get("address") == addr), None)
                if not dev:
                    raise settings_schema.SettingsError(f"unknown device {addr}")
                if not isinstance(want, bool):
                    raise settings_schema.SettingsError("sdk_mode must be a boolean")
                # REFUSE IT ON HARDWARE THAT DOES NOT ADVERTISE IT, for the same reason a rate outside
                # the device's menu is refused: the alternative is a config asserting a mode the device
                # will reject at connect, leaving the streams on their normal rates while every surface
                # says otherwise. Enabling is gated; DISABLING is always allowed, so a flag set against
                # a device that has since been swapped can still be cleared.
                sup = [str(x) for x in ((status.get("devices", {}).get(dev.get("name"), {})
                                         .get("pmd_supported")) or dev.get("pmd_supported_seen") or [])]
                if want and sup and hex(pmd.SDK_MODE) not in sup:
                    raise settings_schema.SettingsError(
                        f"{dev.get('name')} does not advertise SDK mode (feature {hex(pmd.SDK_MODE)})")
                if bool(dev.get("sdk_mode")) != want:
                    dev["sdk_mode"] = want
                    changed.append(f"{dev.get('name')}.sdk_mode")
                    restart_needed = True     # the mode is entered during PMD negotiation, i.e. at connect
                # ⚠️ SDK MODE COSTS PPI AND HR, AND NOTHING SAID SO (POLAR-ONBOARD-BACKUP-FOLLOWUPS §3).
                # The UI presented SDK mode and the stream checkboxes as independent, so the config could
                # express a state the hardware cannot hold and the only symptom was two streams quietly
                # absent. This WARNS rather than refusing, deliberately: the combination is legal to
                # write — a Verity swapped for a device without the exclusion would make it valid, and a
                # hard refusal would then block a correct config on a family fact. Warning is also what
                # the brief asked for; "silently winning" was the defect.
                #
                # It is evaluated on the FINAL state, not on `changed`, so it fires when SDK mode was
                # already on and PPI is being added — the same conflict arriving from the other side.
                # A check that only ran on the sdk_mode edge would miss exactly that.
                excl = [s for s in (dev.get("streams") or []) if s in ("ppi", "hr")]
                if want and excl:
                    warnings.append(
                        f"{dev.get('name')}: SDK mode disables {' + '.join(excl)} on a Verity — "
                        f"{'those streams' if len(excl) > 1 else 'that stream'} will be silently absent "
                        "while it is on")
        except settings_schema.SettingsError as e:
            return web.json_response({"ok": False, "error": str(e)}, status=400)
        if changed:
            try:                              # back up before writing — a bad write bricks the daemon
                import shutil
                shutil.copyfile(cfg_path, cfg_path + ".bak")
            except Exception:
                # THE SAFETY NET IS GONE, and the write proceeds anyway — the right call, since
                # refusing a settings change because a backup failed strands the operator. But it
                # must not be SILENT: without this line, the one moment the .bak is needed is the
                # one moment nobody knows it is missing.
                _log.warning("settings: could not back up %s — writing WITHOUT a rollback copy",
                            cfg_path, exc_info=True)
            # A FAILED WRITE IS NOT A SUCCESS (CAPTURE-HOST-DEEP-AUDIT §D2, closing the last caller of
            # VIGIL-DEEP-ANALYSIS §2A). `_save()`'s return value was discarded here while its three
            # siblings — /api/remember, /api/forget, /api/storage — all report 500. The in-memory cfg
            # keeps the change either way, so the UI showed the new value, the disk kept the old one,
            # and the setting silently reverted at the next restart.
            if not _save():
                return web.json_response(
                    {"ok": False, "error": "config write failed (disk?)", "changed": changed},
                    status=500)
        # `warnings` is ALWAYS present, even when empty. A key that appears only on trouble teaches a
        # client to read its absence as "no trouble", which is indistinguishable from "this server is
        # older than the check" — the same absence-is-not-evidence trap the streams/rates surfaces hit.
        return web.json_response({"ok": True, "changed": changed,
                                  "restart_needed": restart_needed, "warnings": warnings})

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
        target leaves the previous one running rather than half-applying.

        A body that did not arrive as a JSON object is a 400, NOT a clear (CAPTURE-HOST-DEEP-AUDIT
        §D1). An empty POST is included: `{}` reaches this handler from a caller who deliberately sent
        an object with no `target` — the designed disable path, which monitor.html and four tests use —
        whereas no body at all is a client that failed to send its request. Treating the second as the
        first is how an empty POST returned 200 and persisted `{"enabled": false}` with the target gone,
        which at the next daemon start also un-gates retention's second-copy protection."""
        if not req.body_exists:
            return _bad_body_response()
        body = await _body(req)
        if body is BAD_BODY:
            return _bad_body_response()
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
        if body is BAD_BODY:
            return _bad_body_response()
        try:
            tgt = storage_targets.validate(body.get("target") or (cfg.get("archive") or {}).get("target"))
        except storage_targets.StorageError as e:
            return web.json_response({"ok": False, "error": str(e)}, status=400)
        try:
            return web.json_response(await storage_targets.test_target(tgt))
        except Exception as e:      # a probe must never 500 the monitor
            return web.json_response({"ok": False, "detail": f"{type(e).__name__}: {e}"})

    # ── Push alerts / webhook destination (VIGIL-OBSERVED-ERRORS E6) ────────────────────────────
    # The low-disk and sensor-offline alerts fired to nobody because `alerts.webhook_url` could only be
    # set by hand-editing config.yaml on a headless box. This surface owns the destination.
    #
    # ⚠️ WRITE-ONLY BY DESIGN — the URL goes in and never comes back out. For ntfy / Discord / Slack /
    # Telegram / Home Assistant the URL *is* the bearer credential, and this page is LAN-reachable
    # through Caddy. So it follows the rule storage_targets states for passwords: settable, never
    # echoed. `hint` is scheme://host with the path (the token) stripped, which answers "where is this
    # pointed?" without publishing the secret. That is also why the key is absent from
    # settings_schema.SETTINGS — `/api/settings` returns every value it owns straight to the client.

    def _alerts_cfg() -> dict:
        a = cfg.get("alerts") or {}
        url = a.get("webhook_url") or ""
        return {"enabled": bool(a.get("enabled")) and bool(url),
                "configured": bool(url),
                "hint": alerts.webhook_hint(url)}

    async def alerts_get(_req):
        return web.json_response(_alerts_cfg())

    async def alerts_post(req):
        """Set / change / clear the webhook destination, applied to the LIVE notifier.

        Absent `webhook_url` KEEPS the stored one, so the operator can toggle `enabled` without
        re-typing a secret the UI never showed them. `""` is the explicit clear — the distinction
        matters precisely because the field renders empty even when one IS configured, so treating
        "the client didn't send it" as "delete it" would wipe the destination on every toggle."""
        if not req.body_exists:
            return _bad_body_response()
        body = await _body(req)
        if body is BAD_BODY:
            return _bad_body_response()
        a = cfg.setdefault("alerts", {})
        try:
            url = alerts.validate_webhook_url(body["webhook_url"]) if "webhook_url" in body \
                else (a.get("webhook_url") or "")
        except alerts.AlertsError as e:
            return web.json_response({"ok": False, "error": str(e)}, status=400)
        enabled = bool(body.get("enabled", a.get("enabled", False)))
        if url:
            a["webhook_url"] = url
        else:
            a.pop("webhook_url", None)
        # Cannot be enabled with nothing to fire at — the same rule Notifier applies, kept in the stored
        # config too so a restart reads back exactly what the UI is showing.
        a["enabled"] = enabled and bool(url)
        if not _save():
            return web.json_response({"ok": False, "error": "config write failed (disk?)"}, status=500)
        if notifier is not None:
            notifier.configure(url or None, a["enabled"])   # live — no restart, no dropped BLE links
        return web.json_response({"ok": True, **_alerts_cfg()})

    async def alerts_test(_req):
        """Fire one real alert to the CURRENT destination, so the operator learns it works now rather
        than discovering at 03:00 that the token was wrong. Deliberately sends through the LIVE
        notifier: a probe with its own transport would prove the URL reachable, not that alerting is
        wired up."""
        if notifier is None or not notifier.enabled:
            return web.json_response({"ok": False, "error": "alerts are not enabled"}, status=400)
        try:
            ok = await notifier.send("Tepna test", "Test alert from the Tepna monitor.")
        except Exception as e:                  # a probe must never 500 the monitor
            return web.json_response({"ok": False, "error": f"{type(e).__name__}: {e}"})
        return web.json_response({"ok": bool(ok),
                                  "error": "" if ok else "the webhook did not accept the alert"})

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
            # `sorted(... if _timeline._STAMP_RE.search(n + "_00000000000000_") or True)` stood here
            # until 2026-08-01: an `or True` makes the whole condition constant, so the filter selected
            # nothing and the sort was thrown away by the `max` on the next line. It existed only as a
            # reference to a regex that has since moved into writers.file_stamp (audit F5) — and it
            # broke outright when that regex went away, in a path whose two tests were the only thing
            # that noticed. Replaced with what it actually did: pick the directory with the newest
            # activity.
            try:
                nights = [n for n in os.listdir(captures)
                          if os.path.isdir(os.path.join(captures, n))]
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
        body = await _body(req)
        if body is BAD_BODY:
            return _bad_body_response()
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
        body = await _body(req)
        if body is BAD_BODY:
            return _bad_body_response()
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
            # `ok` mirrors the MANIFEST's verdict, not merely "the request completed". A pull that came
            # back short must not render as a success in the monitor (audit F3).
            return web.json_response({"ok": bool((manifest or {}).get("ok", True)),
                                      "manifest": manifest})
        except offline_lock.OfflineBusy as e:
            return web.json_response({"ok": False, "busy": e.holder, "error": str(e)}, status=409)
        except Exception as e:
            return web.json_response({"ok": False, "error": f"{type(e).__name__}: {e}"}, status=502)

    async def polar_recording(req):
        """POST /api/polar/recording {address, action: status|start|stop, sample_type?: rr|hr}.

        The H10 ONBOARD-recording control (POLAR-ONBOARD-BACKUP §6 Q1 / FOLLOWUPS §4) — through
        `_polar_run`, so the op owns the device's single BLE link instead of racing run_polar; the
        brief forbids a standalone script for exactly that reason. `start` defaults to RR because the
        RR-acceptance probe is this endpoint's reason to exist; the response carries the device's own
        READBACK (`recording_on` + identifier), never an echo of the request — see
        polar_psftp.recording_control. A device REFUSAL (the §6 Q1 'no') arrives as the 502 with the
        PS-FTP error text: a measurement, so it must reach the caller verbatim, not be flattened."""
        body = await _body(req)
        if body is BAD_BODY:
            return _bad_body_response()
        address, action = body.get("address", ""), body.get("action", "")
        if not _polar_dev(address):
            return web.json_response({"ok": False, "error": "unknown or non-Polar address"}, status=400)
        if action not in ("status", "start", "stop"):
            return web.json_response({"ok": False, "error": "action must be status|start|stop"}, status=400)
        st_word = body.get("sample_type", "rr")
        if st_word not in ("rr", "hr"):
            return web.json_response({"ok": False, "error": "sample_type must be rr|hr"}, status=400)
        st = polar_psftp.SAMPLE_TYPE_RR_INTERVAL if st_word == "rr" else polar_psftp.SAMPLE_TYPE_HEART_RATE
        try:
            out = await _polar_run(address, lambda: polar_psftp.recording_control(
                address, action, sample_type=st))
            return web.json_response({"ok": True, **out})
        except offline_lock.OfflineBusy as e:
            return web.json_response({"ok": False, "busy": e.holder, "error": str(e)}, status=409)
        except Exception as e:
            return web.json_response({"ok": False, "error": f"{type(e).__name__}: {e}"}, status=502)

    async def version_get(_req):
        """GET /api/version — what code is running, and since when.

        `dirty` is a TRISTATE: `null` means git could not tell us (a tarball deploy has no .git), and
        the page must render that as unknown rather than clean. `started` is what makes the sha mean
        "running" rather than "on disk" — a sha that moved without `started` moving means something
        re-read the tree, not that new code is serving."""
        return web.json_response(_build)

    # ── Wi-Fi uplink (hotspot / hotel) ───────────────────────────────────────────────────────────
    # 🔴 NO ENDPOINT HERE EVER RETURNS THE CREDENTIAL. `public_view` is the only shape that crosses
    # this boundary: ssid, security, and whether a key is held — never the key. The monitor is served
    # over the LAN, so a "show saved password" convenience would publish the owner's hotel and phone
    # passwords to anything that can reach port 8787.
    async def wifi_get(_req):
        root = cfg.get("root", "/srv/tepna")
        st = await wifi_uplink.status()
        return web.json_response({**st, "saved": wifi_uplink.public_view(wifi_uplink.load_saved(root))})

    async def wifi_scan_h(_req):
        return web.json_response(await wifi_uplink.scan())

    async def wifi_connect_h(req):
        body = await _body(req)
        if body is BAD_BODY:
            return _bad_body_response()
        root = cfg.get("root", "/srv/tepna")
        ssid = str(body.get("ssid") or "")
        security = wifi_join.OPEN if body.get("security") == wifi_join.OPEN else wifi_join.SECURED
        passphrase = body.get("passphrase")
        if passphrase is None:
            # No passphrase supplied ⇒ use the remembered one. This is the reconnect path, and it is
            # why the UI never needs the key back: the box already holds it.
            saved = wifi_uplink.load_saved(root)
            if not saved or saved.get("ssid") != ssid:
                return web.json_response(
                    {"ok": False, "error": f"no saved password for {ssid!r} — enter it once"}, status=400)
            passphrase, security = saved.get("psk") or "", saved.get("security", wifi_join.SECURED)
        r = await wifi_uplink.join(ssid, passphrase, security)
        if r.get("ok") and body.get("remember", True):
            try:
                r["saved"] = wifi_uplink.save_network(root, ssid, passphrase, security)
            except (ValueError, OSError) as e:
                # Joined but could not remember: report BOTH. Silently dropping the save is how the
                # uplink comes up now and cannot be restored after the next harvest.
                r["warning"] = f"connected, but could not save the network: {e}"
        return web.json_response(r, status=200 if r.get("ok") else 400)

    async def wifi_disconnect_h(_req):
        return web.json_response(await wifi_uplink.leave())

    async def wifi_forget_h(_req):
        root = cfg.get("root", "/srv/tepna")
        return web.json_response({"ok": True, "forgot": wifi_uplink.forget_network(root)})


    app.add_routes([
        web.get("/", index),
        web.get("/api/state", state),
        web.get("/api/version", version_get),
        web.get("/api/wifi", wifi_get),
        web.post("/api/wifi/scan", wifi_scan_h),
        web.post("/api/wifi/connect", wifi_connect_h),
        web.post("/api/wifi/disconnect", wifi_disconnect_h),
        web.post("/api/wifi/forget", wifi_forget_h),
        web.post("/api/scan", scan),
        web.post("/api/cpap/pull", cpap_pull),
        web.post("/api/cpap/pair", cpap_pair_h),
        web.post("/api/cpap/stream", cpap_stream_h),
        web.post("/api/bond", bond),
        web.post("/api/forget", forget),
        web.post("/api/ring/config", ring_config_h),
        web.post("/api/ring/buzz", ring_buzz_h),
        web.post("/api/remember", remember),
        web.post("/api/pull", pull_stored_h),
        web.get("/api/settings", settings_get),
        web.post("/api/settings", settings_post),
        web.post("/api/daemon", daemon_post),
        web.get("/api/timeline", timeline_get),
        web.get("/api/storage", storage_get),
        web.get("/api/alerts", alerts_get),
        web.post("/api/alerts", alerts_post),
        web.post("/api/alerts/test", alerts_test),
        web.post("/api/storage", storage_post),
        web.post("/api/storage/test", storage_test),
        web.post("/api/timesync", timesync),
        web.post("/api/timesync/all", timesync_all),
        web.get("/api/polar/recordings", polar_recordings),
        web.post("/api/polar/pull", polar_pull),
        web.post("/api/polar/recording", polar_recording),
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
