# tepna-capture — alerts.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# PUSH ALERTING. The monitor page is a PULL surface — you only see a problem if you go look. For a bedside
# box a lost night is unrecoverable, so the two events worth a phone buzz are:
#
#   • a configured sensor going OFFLINE and staying offline (dead battery, wandered out of range) — catch
#     it while you are still awake, not at breakfast;
#   • the daemon (re)STARTING — a spurious overnight restart is otherwise invisible.
#
# Transport is a generic webhook POST (ntfy.sh, a Discord/Slack/Telegram bridge, Home Assistant, …), so no
# vendor is baked in. DISABLED by default and only ever fires to a URL the operator put in config.yaml —
# this module never invents a destination. Alerting must NEVER take capture down, so every failure here is
# swallowed; the worst case is a missed notification, never a missed night.
from __future__ import annotations
import logging
import time as _time
from urllib.parse import urlsplit

_log = logging.getLogger("tepna-capture")


class AlertsError(ValueError):
    """A rejected webhook URL. Mirrors storage_targets.StorageError so webmon can 400 uniformly."""


# ── THE WEBHOOK URL IS A CREDENTIAL, AND IS TREATED AS ONE ────────────────────────────────────────
# For every transport this targets — ntfy, Discord, Slack, Telegram, Home Assistant — possession of the
# URL *is* the authorisation to post. It is a bearer token shaped like a link. So it follows the same
# rule storage_targets states for passwords: the operator may SET it from the monitor, and the monitor
# will never hand it back. The API returns whether one is configured plus a scheme+host HINT with the
# path (i.e. the token) stripped — enough to answer "which endpoint is this pointed at?" without putting
# the credential on a LAN-reachable page.
#
# This is also why the key is NOT in settings_schema.SETTINGS: `/api/settings` echoes every value it
# owns straight back to the UI, which for this one would publish the secret to anyone who can reach the
# box. A dedicated write-only endpoint is the whole reason this lives here instead.
_MAX_URL = 2048


def validate_webhook_url(value) -> str:
    """Coerce + validate a webhook URL. Returns "" for an explicit clear, else a vetted absolute URL."""
    if value is None:
        return ""
    if not isinstance(value, str):
        raise AlertsError("webhook_url must be a string")
    v = value.strip()
    if not v:
        return ""                              # explicit clear — the one way to switch alerting off
    if len(v) > _MAX_URL:
        raise AlertsError(f"webhook_url is too long (max {_MAX_URL})")
    # Control characters are a header/log-injection vector once this reaches aiohttp and the journal.
    if any(ord(c) < 0x20 or ord(c) == 0x7F for c in v):
        raise AlertsError("webhook_url contains control characters")
    try:
        parts = urlsplit(v)
    except ValueError as e:                    # malformed IPv6 literal, bad port, …
        raise AlertsError(f"webhook_url is not a valid URL: {e}") from None
    if parts.scheme not in ("http", "https"):
        # An allowlist, not a denylist: `file://` would make the box read a local file, and there is no
        # reason to POST an alert anywhere but HTTP(S).
        raise AlertsError("webhook_url must start with http:// or https://")
    if not parts.hostname:
        raise AlertsError("webhook_url has no host")
    return v


def webhook_hint(url: str | None) -> str:
    """A safe, non-secret label for a configured URL: scheme://host[:port], PATH AND QUERY REMOVED.

    The path is exactly where these services put the token (`/hooks/T00/B00/xxxx`,
    `/api/webhooks/<id>/<token>`), so returning it would defeat the point of not returning the URL.
    """
    if not url:
        return ""
    try:
        p = urlsplit(url)
    except ValueError:            # never produced by a validated value, but a STORED one can predate
        return ""                 # this validation — degrade to no hint rather than raise
    return f"{p.scheme}://{p.netloc}" if p.scheme and p.netloc else ""


async def _http_post(url: str, payload: dict) -> bool:
    """POST `payload` as JSON with a short timeout. Returns True on a 2xx. aiohttp is already a daemon dep
    (webmon), imported lazily so `import alerts` stays cheap and dependency-free for tests."""
    import aiohttp

    timeout = aiohttp.ClientTimeout(total=10)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.post(url, json=payload) as resp:
            return 200 <= resp.status < 300


class Notifier:
    """Edge-triggered webhook notifier. `send()` is a no-op unless both enabled and a URL are present;
    `key`+`dedupe_sec` suppress a repeat of the SAME alert within a window so one flapping sensor cannot
    spam the operator. `_post` is injectable for tests (defaults to the real webhook)."""

    def __init__(self, url: str | None = None, enabled: bool = False, _post=None):
        self.url = url
        self.enabled = bool(enabled and url)
        self._post = _post or _http_post       # resolved here (not a default arg) so tests can patch it
        self._last: dict[str, float] = {}      # dedupe key → monotonic ts of the last send
        # ── DELIVERY IS RECORDED, NOT JUST ATTEMPTED ────────────────────────────────────────────────
        # Failure was already logged; SUCCESS was silent and nothing was published anywhere. So
        # "delivered", "suppressed by dedupe" and "never attempted" were indistinguishable after the
        # fact, and the only way to know an alert arrived was to have been looking at your phone.
        # Measured 2026-08-11: 32 alerts FIRED in 24 h and the journal held exactly ONE delivery
        # outcome in 48 h — a failure. Nothing said whether the other 32 landed.
        #
        # That is the last line of defence for every silent-absence failure this daemon guards against
        # ("every failure mode here looks like a green box with a short file"), so its own health has
        # to be visible on the same surface as the capture it protects.
        self.delivered = 0     # ARRIVED, not attempted — the word `sent` blurs exactly that line
        self.failed = 0
        self.suppressed = 0
        self.last_ok: float | None = None       # wall-clock epoch of the last DELIVERED alert
        self.last_error: str | None = None      # why the last attempt failed; None once one succeeds
        self.last_title: str | None = None

    def stats(self) -> dict:
        """What the monitor shows. A notifier that has never delivered anything reports
        `last_ok: None`, which is a different state from "delivered a while ago" and must render as
        one — the same tri-state discipline `sdk_mode_actual` uses."""
        return {"enabled": self.enabled, "delivered": self.delivered, "failed": self.failed,
                "suppressed": self.suppressed, "last_ok": self.last_ok,
                "last_error": self.last_error, "last_title": self.last_title}

    async def send(self, title: str, message: str, *, key: str | None = None,
                   dedupe_sec: float = 0.0, now: float = 0.0) -> bool:
        """Fire one alert. Returns True only if it was actually delivered."""
        if not self.enabled:
            return False
        if key is not None and dedupe_sec > 0:
            last = self._last.get(key)
            if last is not None and (now - last) < dedupe_sec:
                self.suppressed += 1           # counted: a suppressed alert is not a delivered one
                return False                   # too soon — suppress the repeat
            self._last[key] = now
        self.last_title = title
        try:
            ok = bool(await self._post(self.url, {"title": title, "message": message}))
        except Exception as e:
            # SWALLOWING THE EXCEPTION MUST NOT ALSO SWALLOW THE EVIDENCE (CAPTURE-HOST-DEEP-AUDIT §C1).
            # A webhook must never crash capture — that part is right and stays. But this used to return
            # False with no log at ANY level, so a delivery that never happened was indistinguishable
            # from one that did: the caller latched, the operator was never told, and the journal held
            # nothing to find afterwards either. The alert is lost either way; the RECORD of losing it
            # need not be.
            _log.warning("alert %r not delivered: %r", title, e)
            self.failed += 1
            self.last_error = f"{type(e).__name__}: {e}"
            return False
        if not ok:
            _log.warning("alert %r rejected by the webhook (non-2xx)", title)
            self.failed += 1
            self.last_error = "rejected by the webhook (non-2xx)"
            return False
        # LOGGED AT INFO ON SUCCESS TOO. Absence of a failure line is not evidence of delivery — that
        # asymmetry is what made 32 alerts unaccountable.
        _log.info("alert %r delivered", title)
        self.delivered += 1
        self.last_ok = _time.time()
        self.last_error = None
        return True

    def reset(self, key: str) -> None:
        """Forget a dedupe key so the NEXT occurrence alerts immediately (call when a sensor recovers)."""
        self._last.pop(key, None)

    def configure(self, url: str | None, enabled: bool) -> None:
        """Re-point the notifier at runtime, so a monitor edit applies WITHOUT restarting the daemon.

        Restarting to pick up a webhook change would drop every BLE link mid-night, which is a far worse
        outcome than the thing being configured. `enabled` is re-derived through the same `enabled and
        url` rule the constructor uses, so clearing the URL cannot leave alerting nominally "on" and
        silently dead.

        The dedupe ledger is CLEARED on a real change: those timestamps say "the operator has already
        been told", which is only true of the previous destination. Keeping them would silence the first
        alert to a newly-configured endpoint — precisely the one the operator is waiting for to confirm
        it works. An idempotent re-save (same URL, same flag) is not a change and leaves it intact, so
        clicking Save twice cannot be used to bypass dedupe.
        """
        changed = (url != self.url) or (bool(enabled and url) != self.enabled)
        self.url = url
        self.enabled = bool(enabled and url)
        if changed:
            self._last.clear()


def device_is_recording(connected: bool, last_data_mono: float | None, now: float,
                        grace_sec: float) -> bool:
    """PURE: is the device actually PRODUCING DATA, or merely LINKED?

    `connected` is not `recording`, and conflating them cost a whole night. On 2026-07-29 the H10 lost
    its BlueZ bond and entered a connect→drop loop: it linked for 1–2 s, was torn down for being
    unauthenticated, retried ~70 s later, for four and a half hours. The alert loop keyed on
    `connected`, which is momentarily TRUE inside each doomed connect, so the operator got:

        23:54 offline → 00:18 RECONNECTED → 00:24 offline → 00:51 RECONNECTED
        00:57 offline → 03:31 RECONNECTED → 03:37 offline → 03:42 RECONNECTED → 03:48 offline

    Four "recovered" notices, and NOT ONE BYTE written after 23:48. Every all-clear was false, and the
    flapping turned a total outage into what read as a series of resolved blips.

    This is the lesson `cpap_harvest.blocking_devices` already learned one module over — "a sensor on
    its charger reports connected=True while producing nothing" — applied to the alert path, which
    never got it. Both are the house rule that a silent zero is the thing to catch.

    `grace_sec` exists because a device that has only just linked has not streamed yet and must not be
    called recording on the strength of the link alone. `last_data_mono is None` — nothing ever arrived
    this session — therefore reads as NOT recording, which is the honest answer and is precisely the
    state the H10 sat in all night."""
    if not connected or last_data_mono is None:
        return False
    return (now - last_data_mono) <= grace_sec


def offline_alert_due(down_since: float | None, now: float, threshold_sec: float) -> bool:
    """True when a device has been continuously offline for at least `threshold_sec`. `down_since` is the
    monotonic time it first went offline (None = currently connected → never due)."""
    return down_since is not None and (now - down_since) >= threshold_sec


def offline_alert_suppressed(optional: bool, ever_connected: bool) -> bool:
    """Should the offline alert stay QUIET for this device?

    Only for an `optional: true` device that has NEVER connected this session. The connect loop already
    draws this distinction — it logs "optional backup device not present — keeping a quiet eye out" once
    and backs off, deliberately, "instead of a warning every backoff cycle (the COOSPO spam)". The alert
    loop never asked, so the same absent strap produced the box contradicting itself, six minutes apart:

        INFO     COOSPO 808S 0022265: optional backup device not present — keeping a quiet eye out
        WARNING  alert: COOSPO 808S 0022265 has been offline for ~5 min — capture is missing it

    plus a webhook, on every service start (three in three days for a strap nobody was wearing).
    Capture is not "missing" a device that was never expected to join, and an alert channel that cries
    over a non-event is one an operator learns to ignore — which costs the alerts that matter.

    `ever_connected` is the whole nuance. An optional device that DID join and then dropped is a real
    event: it was contributing data and stopped, exactly what this alert is for. Silence is only correct
    for one that never showed up at all."""
    return bool(optional) and not ever_connected


def ring_identity_mismatch(expected, seen) -> str | None:
    """PURE impostor-shape check (VIGIL-BLUETOOTH-ADVERSARIAL-AUDIT §6.2 Mitigation C).

    `expected` is the operator-configured WIRE serial — `serial:` on the O2Ring device entry, the string
    the ring returns in its 0xE1 GET_INFO reply (2592302100 on the corpus ring). It is NOT the BLE-name
    id the capture filenames carry (`S8AW2100`); the two are different strings for one ring, and the
    audit brief's first draft named the wrong one. `seen` is what the connected peer actually answered.
    Returns the alert text when they differ, None when they match.

    No expectation configured ⇒ None. This is detection the operator opts into by writing the serial
    down; with nothing to compare against there is nothing to say, and a check that fires unconfigured
    would fire on every box that has not read this docstring. An EMPTY or ABSENT reply against a
    configured serial IS a mismatch — a peer that answers the identity query with no identity is
    exactly the shape of something that is not the ring.

    Detection, not prevention. The link is unbonded and the reply is plaintext, so an impostor that has
    read this repo can echo the right serial; what this catches is the cheap impostor and the WRONG RING
    — a replaced unit, a neighbour's O2Ring, a re-scanned random-static address that landed on the
    wrong device — and it says so on the monitor and the webhook instead of letting that link's data
    into the corpus unremarked."""
    exp = str(expected).strip() if expected is not None else ""
    if not exp:
        return None
    got = str(seen).strip() if seen is not None else ""
    if got == exp:
        return None
    shown = repr(got) if got else "no serial at all"
    return f"connected peer reports {shown}, config expects {exp!r}"


# WHY THIS EXISTS, AND WHY IT IS NOT `missing`.
#
# On 2026-07-25 the Verity acknowledged four PMD streams `ok` at 23:51:23 and wrote nothing until
# 04:16:01 — 4 h 25 m — with the link up throughout (680 of 682 poll samples connected). The cause was
# an unbounded GATT read and is fixed; what was missing is anyone being TOLD.
#
# QC's `missing` cannot see it. `missing` means "this stream produced nothing all night", and the
# moment 04:16 arrived those streams had rows and stopped qualifying. The detectable signature of a
# frozen sensor is different and much sharper — and every clause below exists to exclude a false
# positive that would otherwise fire nightly:
#
#   silent while the night is still being written  — at dawn everything goes quiet; that is the night
#                                                    ending, not a fault (silence is measured against
#                                                    the night's newest write, so this is inherent).
#   connected                                      — out of range or switched off is a DIFFERENT fault
#                                                    and already has offline_alert_due.
#   not charging                                   — a docked ring is silent by design, every morning.
#                                                    Alerting on it teaches you to ignore alerts.
#   has written something                          — a device that produced nothing all night is
#                                                    `missing`, which already alerts. Two names for
#                                                    one fault is noise.
def arrival_canary(qc: dict, live: dict) -> list[str]:
    """THE CANARY for the packet-arrival sidecar — streams whose offset floor has stopped being a floor.

    The sidecar exists so `min(arrival - device)` recovers the per-connection BLE offset, which works
    only because buffering is one-sided and therefore has a hard lower EDGE. Two things can silently
    take that away: the writer dying (rows stop while samples continue) and the edge smearing (a wedged
    stack, a clock step, a device that starts batching differently). Neither shows up in the data files,
    and without this both surface weeks later inside an analysis — which is exactly how the back-timed
    stamps this replaces went unnoticed for the whole corpus.

    ⚠️ THE SMEARED ARM IS RETIRED, and it is the last paragraph of this docstring coming true. It fired
    on EVERY stream on the first real night (2026-08-11). `floor_ok` demands the minimum sit within 5 ms
    of the 1st percentile; measured, true arrivals smear 29.3 / 42.0 ms (H10 acc / ecg) and
    155.1 / 590.6 ms (Verity ppg / acc). The premise was wrong, not the captures: BLE callback
    scheduling jitter is tens of milliseconds, so a 5 ms floor was never reachable — and the back-timed
    per-sample stamps this sidecar replaced smeared 27-115 ms, i.e. THE SAME ORDER.

    The arm goes rather than getting a looser threshold, because the quantity stopped mattering: the H10
    certified with `agree = 4.5 ms` DESPITE a 42 ms floor smear, since the lower envelope does not need
    a sharp edge. `clock_offset.estimate`'s `certified` is what a consumer actually spends. Re-tuning the
    number would have kept a check that measures something real and irrelevant, and paged someone nightly
    to say so. `floor_spread_ms` stays in the QC report as a diagnostic.

    What remains is the failure nothing else can see:
      * DEAD — the device is connected and writing samples, but its sidecar row count is not advancing.
               The write is wrapped in a bare `except: pass` (telemetry must never disturb the data
               callback), so a persistent failure is invisible by construction. It stayed correctly
               silent across all 159,607 rows of the first real night.
    """
    out = []
    for name, st in (live or {}).items():
        if not st or not st.get("connected"):
            continue
        rows, arr = st.get("rows"), st.get("arrival_rows")
        # Only a device that is DEMONSTRABLY producing data can have a dead sidecar. `arrival_rows` is
        # absent on non-PMD devices and None before the first frame — neither is a fault.
        if arr is not None and rows and arr == 0:
            out.append(f"{name} — writing samples but the arrival sidecar has no rows")
    return out


def frozen_devices(qc: dict, live: dict, threshold_sec: float) -> list[str]:
    """Devices that are connected and awake but have stopped producing data.

    `qc` is a nightqc.summarize() result (each device carries `silent_sec`, seconds since its last
    write measured against the night's newest write). `live` is STATUS["devices"]. A device missing
    from `live` is never reported — an unknown state is not evidence of a fault."""
    out = []
    for d in qc.get("devices") or []:
        name, silent = d.get("name"), d.get("silent_sec")
        if not name or silent is None or silent < threshold_sec:
            continue
        st = live.get(name)
        if not st or not st.get("connected") or st.get("charging"):
            continue
        out.append(name)
    return out
