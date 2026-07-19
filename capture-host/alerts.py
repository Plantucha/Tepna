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
            return bool(await self._post(self.url, {"title": title, "message": message}))
        except Exception:
            return False                       # a webhook must never crash capture

    def reset(self, key: str) -> None:
        """Forget a dedupe key so the NEXT occurrence alerts immediately (call when a sensor recovers)."""
        self._last.pop(key, None)


def offline_alert_due(down_since: float | None, now: float, threshold_sec: float) -> bool:
    """True when a device has been continuously offline for at least `threshold_sec`. `down_since` is the
    monotonic time it first went offline (None = currently connected → never due)."""
    return down_since is not None and (now - down_since) >= threshold_sec
