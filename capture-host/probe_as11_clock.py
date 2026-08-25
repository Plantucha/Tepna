# tepna-capture — probe_as11_clock.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
"""probe_as11_clock — characterise the AS11 RTC against the box clock over a session.
#
The clock-discipline sidecar the owner asked for: poll GetDateTime (device clock) beside the box's
disciplined clock every `--interval` seconds, write an AS11CLOCK.csv anchor per read, and at the end
report the offset AND the rate — is a ResMed "minute" actually a minute, or does the RTC tick off-rate?
(as11_clock.analyze). Run it across a therapy session so tonight's device-stamped EDF becomes
re-anchorable and the fixed-vs-drift question is answered from data, not assumed.

READ-ONLY: only `establish` + `get_date_time` are used — never Set / Enter* / SetDateTime. The AS11
RTC is MEASURED, never written (it cannot be set over BLE anyway). Clock Contract untouched.

⚠️ The device labels its clock with a Z and — measured 2026-08-24 on the box — actually tracks ~UTC
(it read 01:35 while true UTC was 01:16, i.e. ~21 min fast vs UTC), NOT the box's local zone. So the
host reference is the box's UTC (`time.time`), and `offset = host_UTC − device` is the device's
deviation from UTC (≈ −21 min here, device ahead). Comparing to the box's LOCAL clock instead would
inject the box's timezone (EDT, −4 h) and mis-report the offset as −4 h 21 m — the box tz, not the
device's error. The RATE (slope) is unaffected by the reference either way.

Usage (on the box, daemon stopped per link_guard):
    .venv/bin/python probe_as11_clock.py [--interval 30] [--count N] [--out AS11CLOCK.csv]
"""
from __future__ import annotations

import argparse
import asyncio
import datetime
import sys
import time

sys.path.insert(0, ".")
import as11_cipher  # noqa: E402
import as11_clock  # noqa: E402
import as11_pull  # noqa: E402


def _utc_iso(epoch_s: float) -> str:
    """A UTC epoch → an ISO-8601 UTC string for the sidecar's human column."""
    return datetime.datetime.fromtimestamp(epoch_s, datetime.timezone.utc).isoformat(timespec="seconds")


async def run_clock(
    *,
    connect,
    creds,
    out_path,
    interval_s,
    count,
    make_sidecar=None,
    establish=as11_pull.establish,
    cipher_factory=as11_cipher.make_cipher,
    get_date_time=as11_pull.get_date_time,
    host_epoch=time.time,
    sleep=asyncio.sleep,
):
    """Testable orchestration: open the link, establish, then poll the device clock and journal each
    anchor. Every hardware seam is injected. Returns `as11_clock.analyze` over the collected anchors on
    normal (count-bounded) completion."""
    write, recv_frame, disconnect = await connect()
    sidecar = None
    anchors = []
    try:
        key = await establish(bytes.fromhex(creds["masterPairKey"]), creds["clientId"], write, recv_frame)
        seal, unseal = cipher_factory(key)
        sidecar = (make_sidecar or _default_sidecar)(out_path)
        polled = {"n": 0}

        def should_stop():
            if count is None:
                return False
            polled["n"] += 1
            return polled["n"] > count

        while not should_stop():
            host_s = float(host_epoch())
            try:
                device_iso = await get_date_time(write, recv_frame, seal, unseal)
            except as11_pull.As11Error:
                device_iso = None
            device_epoch = as11_clock.parse_device_epoch_s(device_iso)
            offset = (host_s - device_epoch) if device_epoch is not None else None
            sidecar.write(_utc_iso(host_s), host_s, device_iso, device_epoch, offset)
            if device_epoch is not None:
                anchors.append((host_s, device_epoch))
            await sleep(interval_s)
        return as11_clock.analyze(anchors)
    finally:
        if sidecar is not None:
            sidecar.close()
        await disconnect()


def _default_sidecar(out_path):  # pragma: no cover - thin ctor over the file-sidecar edge
    return as11_clock.ClockSidecar(out_path)


async def _connect(ble_addr, hci):  # pragma: no cover - bleak I/O edge, CI has no radio
    from capture import _cpap_ble_connect

    return await _cpap_ble_connect(ble_addr, hci)


async def main():  # pragma: no cover - CLI wiring over the pragma'd bleak/creds edges
    from capture import _load_as11_creds

    ap = argparse.ArgumentParser()
    ap.add_argument("--creds", default="as11_creds.json")
    ap.add_argument("--adapter", default=None, help="hciN to pin the free radio")
    ap.add_argument("--interval", type=float, default=30.0)
    ap.add_argument("--count", type=int, default=None, help="stop after N reads (default: until Ctrl-C)")
    ap.add_argument("--out", default="AS11CLOCK.csv")
    args = ap.parse_args()
    creds = _load_as11_creds(args.creds)
    if creds is None:
        print("no AS11 creds — cannot run", file=sys.stderr)
        return 1
    result = await run_clock(
        connect=lambda: _connect(creds["ble_addr"], args.adapter),
        creds=creds,
        out_path=args.out,
        interval_s=args.interval,
        count=args.count,
    )
    print(result.get("verdict") or f"declined: {result.get('reason')}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(asyncio.run(main()))
