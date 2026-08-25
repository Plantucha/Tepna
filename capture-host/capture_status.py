# tepna-capture — capture_status.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
"""capture-status — one reliable read of what the daemon is capturing RIGHT NOW.
#
Prints per-device live status straight from the daemon's own `/api/state` (the same state the monitor
renders), so there is a single authoritative answer to "is X recording?" instead of hand-rolled `ls`/
`find`/`grep` over the capture tree — which truncate, look in the wrong folder, and lie. A device is
STREAMING only when it has a live stream (`active` + a real `effFs`); `connected` alone is not capture.

Usage (on the box):
    .venv/bin/python capture_status.py            # defaults to http://127.0.0.1/api/state
    .venv/bin/python capture_status.py --url http://host/api/state
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request

__all__ = ["render", "fetch_state", "main"]


def _extras(dev: dict) -> str:
    """The compact per-device detail line (only the fields the daemon actually populated)."""
    bits = []
    if dev.get("worn") is not None:
        bits.append(f"worn={dev['worn']}")
    if dev.get("rssi") is not None:
        bits.append(f"rssi={dev['rssi']}")
    if dev.get("battery") is not None:
        bits.append(f"batt={dev['battery']}")
    if dev.get("last_sample") is not None:
        bits.append(f"last_sample={dev['last_sample']}")
    return "  ".join(bits)


def render(state: dict) -> str:
    """A `/api/state` dict → a human status report. STREAMING is keyed on a stream being `active`, not
    on `connected` — the exact distinction the whole tool exists to make."""
    adapter = state.get("adapter")
    devices = state.get("devices") or []
    stream_by_key = {s.get("key"): s for s in (state.get("streams") or [])}

    body = []
    streaming = 0
    for dev in devices:
        name = dev.get("name") or dev.get("device_id") or "?"
        dev_streams = [stream_by_key.get(k, {"key": k}) for k in (dev.get("streams") or [])]
        active = [s for s in dev_streams if s.get("active")]
        if active:
            streaming += 1
            status = "STREAMING"
        elif dev.get("connected"):
            status = "connected (idle)"
        else:
            status = "OFFLINE"

        extras = _extras(dev)
        body.append(f"  {name:22} {status}" + (f"   {extras}" if extras else ""))
        for s in dev_streams:
            body.append(
                f"      {str(s.get('key', '')):9} active={s.get('active')} "
                f"effFs={s.get('effFs')} health={s.get('health')}"
            )
        if dev.get("last_error"):
            body.append(f"      last_error: {dev['last_error']}")

    header = f"CAPTURE STATUS — adapter {adapter} — {streaming}/{len(devices)} device(s) STREAMING"

    cpap = state.get("cpap")
    if cpap:
        body.append(
            f"  CPAP: {cpap.get('state')} (enabled={cpap.get('enabled')}, "
            f"SD harvest {cpap.get('at_hour')}:00)"
        )

    return header + "\n" + "\n".join(body)


def fetch_state(url: str, opener=urllib.request.urlopen, timeout: float = 8.0) -> dict:
    """GET the daemon's `/api/state` and parse it. `opener` is injected so the fetch is testable."""
    with opener(url, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def main(argv=None, fetch=fetch_state) -> int:
    ap = argparse.ArgumentParser(description="Print per-device live capture status from /api/state.")
    ap.add_argument("--url", default="http://127.0.0.1/api/state")
    args = ap.parse_args(argv)
    try:
        state = fetch(args.url)
    except (OSError, ValueError) as exc:  # URLError is an OSError; JSON errors are ValueError
        print(f"could not read {args.url}: {exc}", file=sys.stderr)
        return 1
    print(render(state))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
