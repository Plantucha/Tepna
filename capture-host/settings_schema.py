# tepna-capture — settings_schema.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# ALLOWLIST for anything the monitor is permitted to change in config.yaml.
#
# Deliberately narrow. The UI can adjust capture behaviour, but it must NEVER be able to write an
# arbitrary key or an out-of-range value into the daemon's config: a bad `adapter`, `web.host` or `root`
# would lock the box out of its own radio, its own web surface, or its own storage, with no way back
# except editing the file by hand on a headless Pi. Those keys are absent from this table ON PURPOSE.
#
# Each entry: (type, min, max, needs_restart, help). `needs_restart` drives the UI's "reconnect needed"
# hint — stream changes only take effect when the device's PMD session is re-negotiated.
from __future__ import annotations

SETTINGS: dict[str, tuple] = {
    # link health / RSSI
    "link.rssi_enabled":        (bool,  None, None, False, "Poll connection RSSI (needs the privileged helper)"),
    "link.rssi_interval_sec":   (float, 5,    600,  False, "How often to read RSSI while it is working"),
    "link.rssi_retry_sec":      (float, 60,   3600, False, "Slow re-probe when RSSI is unavailable"),
    # device clocks
    "time.auto_sync_devices":   (bool,  None, None, False, "Set device clocks from the host on connect"),
    "time.drift_check_sec":     (float, 60,   3600, False, "How often to check for a device-clock jump"),
    "time.resync_jump_sec":     (float, 5,    600,  False, "Skew change that triggers a re-sync"),
    # BLE adapter watchdog
    "watchdog.enabled":         (bool,  None, None, False, "Auto-recover a wedged BLE controller"),
    "watchdog.interval_sec":    (float, 15,   600,  False, "Watchdog check interval"),
    "watchdog.grace_checks":    (int,   1,    10,   False, "Consecutive wedged checks before a power-cycle"),
    "watchdog.max_adapter_cycles": (int, 1,   10,   False, "Hard cap on controller power-cycles"),
    # O2Ring
    "o2ring.ppg_fs":            (float, 100,  200,  True,  "O2Ring pleth sample rate (calibrated 125.738)"),
}


class SettingsError(ValueError):
    pass


def coerce(key: str, value):
    """Validate one setting → the coerced value. Raises SettingsError on anything not allowlisted or
    out of range, so a malformed request can never reach config.yaml."""
    if key not in SETTINGS:
        raise SettingsError(f"{key} is not a settable key")
    typ, lo, hi, _restart, _help = SETTINGS[key]
    if typ is bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, str) and value.lower() in ("true", "false"):
            return value.lower() == "true"
        raise SettingsError(f"{key} expects a boolean")
    try:
        v = typ(value)
    except (TypeError, ValueError):
        raise SettingsError(f"{key} expects {typ.__name__}") from None
    if (lo is not None and v < lo) or (hi is not None and v > hi):
        raise SettingsError(f"{key} must be between {lo} and {hi} (got {v})")
    return v


def get_nested(cfg: dict, key: str):
    cur = cfg
    for part in key.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def set_nested(cfg: dict, key: str, value) -> None:
    parts = key.split(".")
    cur = cfg
    for p in parts[:-1]:
        nxt = cur.get(p)
        if not isinstance(nxt, dict):
            nxt = {}
            cur[p] = nxt
        cur = nxt
    cur[parts[-1]] = value


def describe(cfg: dict, defaults: dict) -> list[dict]:
    """Current value + bounds for every allowlisted setting, for the UI to render."""
    out = []
    for key, (typ, lo, hi, restart, help_) in SETTINGS.items():
        cur = get_nested(cfg, key)
        out.append({"key": key, "value": cur if cur is not None else defaults.get(key),
                    "type": typ.__name__, "min": lo, "max": hi,
                    "needs_restart": restart, "help": help_})
    return out
