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

_log = logging.getLogger("tepna-capture")


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

    async def send(self, title: str, message: str, *, key: str | None = None,
                   dedupe_sec: float = 0.0, now: float = 0.0) -> bool:
        """Fire one alert. Returns True only if it was actually delivered."""
        if not self.enabled:
            return False
        if key is not None and dedupe_sec > 0:
            last = self._last.get(key)
            if last is not None and (now - last) < dedupe_sec:
                return False                   # too soon — suppress the repeat
            self._last[key] = now
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
            return False
        if not ok:
            _log.warning("alert %r rejected by the webhook (non-2xx)", title)
        return ok

    def reset(self, key: str) -> None:
        """Forget a dedupe key so the NEXT occurrence alerts immediately (call when a sensor recovers)."""
        self._last.pop(key, None)


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
