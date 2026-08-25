# tepna-capture — cpap_detect.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# AS11 session-detection SHADOW adapter — the seam between the BLE read and the pure state
# machine (cpap_supervisor). This module holds NO transport and NO real clock: the device read
# and the monotonic clock are injected, so the whole poll cycle is unit-tested against fakes
# with the stdlib alone. The BLE connect/establish/get_items shim lives in the operator probe
# (probe_as11_shadow.py); the daemon hook is a later increment.
#
# READ-ONLY: it only feeds already-read device values into the classifier and journals the
# would-have decision. In shadow mode it drives nothing — the SESSIONDETECT.csv trace is the
# data collector that validates the machine and tunes the debounce before anything acts.
#
# Clock Contract boundary: LastTherapyUseDateTime is parsed HERE, by explicit regex (never a
# locale parse), into a monotonic integer marker the core compares to its own baseline. A
# malformed/absent stamp yields None — an unread marker, never a fabricated instant.

from __future__ import annotations

import calendar
import re

from cpap_supervisor import Observation, TherapyState

__all__ = ["parse_use_marker", "extract_fields", "build_observation", "ShadowDetector"]

# Explicit ISO-8601 date-time head (fractional seconds / trailing zone ignored — we only need a
# monotonic ordering, not a displayed time). Regex the format; never new Date / locale parse.
_USE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})")


def parse_use_marker(raw) -> int | None:
    """LastTherapyUseDateTime string → monotonic epoch-seconds marker (UTC-floating, like the
    Clock Contract). Component ranges are validated so calendar.timegm cannot silently roll an
    out-of-range field onto a wrong instant; anything that does not match cleanly → None."""
    if not isinstance(raw, str):
        return None
    m = _USE_RE.match(raw)
    if m is None:
        return None
    year, month, day, hour, minute, second = (int(x) for x in m.groups())
    if not (1 <= month <= 12 and 1 <= day <= 31):
        return None
    if not (0 <= hour <= 23 and 0 <= minute <= 59 and 0 <= second <= 59):
        return None
    return calendar.timegm((year, month, day, hour, minute, second, 0, 0, 0))


def _as_therapy_state(raw) -> TherapyState | None:
    """FGState string → enum, or None for any value that is not one of the two known states."""
    try:
        return TherapyState(raw)
    except ValueError:
        return None


def _as_float(raw) -> float | None:
    """MaskPressure → float, or None if it is not a finite number (InvalidObject / missing)."""
    if isinstance(raw, bool):  # a bool is an int in Python; never a pressure
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    return None


def extract_fields(get_result: dict) -> tuple:
    """Pull (fg_state, use_marker, mask_pressure) out of a `Get` result dict. Tolerant of a
    missing item or a wrong-typed value — each maps to None rather than raising, so a partial
    read degrades to a partial Observation instead of a crash."""
    fg = _as_therapy_state(get_result.get("FGState"))
    mm = get_result.get("MachineMetrics")
    use_raw = mm.get("LastTherapyUseDateTime") if isinstance(mm, dict) else None
    use = parse_use_marker(use_raw)
    mask = _as_float(get_result.get("MaskPressure"))
    return fg, use, mask


def build_observation(get_result, host_ms: int) -> Observation:
    """A device read → an Observation. `get_result is None` means the read/connect failed
    (unreachable); any dict — even an empty one — is a reachable read whose fields may be
    partial."""
    if get_result is None:
        return Observation(host_ms=host_ms, reachable=False)
    fg, use, mask = extract_fields(get_result)
    return Observation(
        host_ms=host_ms,
        reachable=True,
        fg_state=fg,
        last_therapy_use=use,
        mask_pressure=mask,
    )


class ShadowDetector:
    """Drives one poll cycle: read the device (injected), classify, journal the decision.

    `read` is an async callable returning a `Get` result dict, or None when the connect/read
    failed. `mono` is a monotonic seconds clock (injected for determinism). `writer`, if given,
    is a `*LifeLogWriter`-style sidecar (duck-typed on `.write(decision)` → `decision.as_row()`)
    that records EVERY would-have decision — the shadow trace. Nothing here drives the
    controller; acting mode is a later increment.
    """

    def __init__(self, supervisor, *, read, mono, writer=None, poll_interval_s: float = 30.0):
        self._sup = supervisor
        self._read = read
        self._mono = mono
        self._writer = writer
        self.poll_interval_s = poll_interval_s

    async def poll_once(self):
        get_result = await self._read()
        host_ms = int(self._mono() * 1000)
        obs = build_observation(get_result, host_ms)
        decision = self._sup.observe(obs)
        if self._writer is not None:
            self._writer.write(decision)
        return decision

    async def run(self, *, should_stop, sleep):
        """Poll until `should_stop()` returns truthy, sleeping (injected) between cycles."""
        while not should_stop():
            await self.poll_once()
            await sleep(self.poll_interval_s)
