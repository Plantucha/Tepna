#!/usr/bin/env python3
# tepna-capture — probe_verity_offline.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# CAN WE FORCE THE VERITY TO RECORD TO ITS OWN FLASH? The Phase-1 probe for POLAR-ONBOARD-BACKUP §7.
#
# WHAT THIS IS TESTING. The brief assumed the start op was PS-FTP and needed a new transport plus a
# widened query allowlist. It is not: the Verity's onboard recording is the ORDINARY PMD control-point
# START, with ONE BIT set on the measurement-type byte (§4a). If that is right, forcing a recording is
# a flag on a command `capture.py` already sends every session — and this probe is what proves it
# against hardware rather than against a reading of the SDK.
#
#   status  = 0x05                      -> per-measurement active state, top 2 bits (0=none, 1=online,
#                                          2=offline, 3=both).  READ-ONLY.
#   start   = 0x02 <meas|0x80> <TLVs>   -> record to flash instead of streaming.
#   stop    = 0x03 <meas>               -> ONE stop serves both. It does NOT carry the recording
#                                          bit: `03 82` is refused with GATT Unlikely Error 0x0E.
#
# ── SAFETY, and why it is shaped like this ──────────────────────────────────────────────────────────
#
# * READ-ONLY BY DEFAULT. A bare run only asks `status`. Starting a recording needs `--force-record`,
#   because it WRITES to the device and because of the next two points.
# * STOP IS PROVEN BEFORE START IS ATTEMPTED. The probe issues STOP first (idempotent — it
#   clears any recording left running by an earlier attempt) and STOPS AGAIN in a `finally`. A probe
#   that can start something it cannot stop is how a sensor ends up quietly filling its flash, hitting
#   the memory limit, and auto-stopping mid-night (§0.2's fabricated-absence class).
# * ONE DATA TYPE CANNOT BE BOTH (brief §2). Recording PPG offline means there is NO live PPG for as
#   long as it runs. Default target is therefore ACC — the cheapest stream to lose for a mechanism
#   test — and PPG must be asked for explicitly.
# * WHILE IT RECORDS, THE DEVICE REFUSES FILE TRANSFER (`SYSTEM_BUSY`, §4a). Do not run a pull against
#   a device this probe has left recording; that is what the `finally` is for.
# * A Polar holds ONE BLE link. Stop the daemon first:
#       sudo -n /usr/local/lib/tepna/tepna-restart.sh stop 10     # deadman-restarts in 10 min
#
#   python probe_verity_offline.py --address 24:AC:AC:0C:30:1E                    # status only
#   python probe_verity_offline.py --address 24:AC:AC:0C:30:1E --force-record     # the real test
#
# ⚠️ `in_charger` (0x0D) — a Polar on its dock refuses every PMD START. If the device is charging this
# probe cannot answer the question; take it off the charger. That is a device state, not a bug, and it
# is reported as such rather than as a failed experiment.

from __future__ import annotations

import argparse
import asyncio
import json

from bleak import BleakClient, BleakScanner

import polar_pmd as pmd

_MEAS_BY_NAME = {v: k for k, v in pmd.MEAS_NAME.items()}


class _Control:
    """The PMD control point: write a command, await its indication.

    The queue exists because control-point replies are INDICATIONS on a different characteristic from
    the one we write; pairing them by arrival order is the only ordering the protocol gives us, so the
    probe is strictly one command in flight at a time."""

    def __init__(self, client: BleakClient):
        self.client, self.q = client, asyncio.Queue()

    def _on_indication(self, _sender, data: bytearray):
        self.q.put_nowait(bytes(data))

    async def start(self):
        await self.client.start_notify(pmd.PMD_CONTROL, self._on_indication)

    async def send(self, cmd: bytes, timeout: float = 6.0) -> bytes | None:
        while not self.q.empty():                      # drop stale replies from a previous command
            self.q.get_nowait()
        await self.client.write_gatt_char(pmd.PMD_CONTROL, cmd, response=True)
        try:
            return await asyncio.wait_for(self.q.get(), timeout)
        except asyncio.TimeoutError:
            return None


def _status_of(reply: bytes | None) -> dict:
    if reply is None:
        return {"error": "no reply to status"}
    parsed = pmd.parse_status_response(reply)
    return {pmd.MEAS_NAME[m]: pmd.ACTIVE_NAME.get(st, st) for m, st in sorted(parsed.items())}


def _ack_status(reply: bytes | None) -> tuple[int, str]:
    """A control-point ACK is `[0xF0, op, meas, status, ...]`; status is what we care about."""
    if reply is None:
        return pmd.NO_ACK, pmd.CTRL_STATUS[pmd.NO_ACK]
    code = reply[3] if len(reply) > 3 and reply[0] == 0xF0 else (reply[-1] if reply else pmd.NO_ACK)
    return code, pmd.CTRL_STATUS.get(code, f"unknown_{code:#04x}")


async def run(address: str, adapter: str | None, meas: int, force: bool, seconds: float) -> dict:
    out: dict = {"address": address, "measurement": pmd.MEAS_NAME[meas], "forced": force}
    dev = await BleakScanner.find_device_by_address(address, timeout=20.0)
    if dev is None:
        return {**out, "error": "device not found — is it advertising, and is the daemon stopped?"}
    async with BleakClient(dev, adapter=adapter) if adapter else BleakClient(dev) as client:
        cp = _Control(client)
        await cp.start()

        out["status_before"] = _status_of(await cp.send(pmd.status_cmd()))
        if not force:
            out["verdict"] = "read-only run — pass --force-record to attempt a recording"
            return out

        # Clear anything a previous attempt left running. Idempotent, and it proves STOP works on this
        # device BEFORE we ask it to start something.
        code, name = _ack_status(await cp.send(pmd.stop_cmd(meas)))
        out["pre_stop_ack"] = name

        settings = pmd.parse_settings_response(await cp.send(pmd.get_settings_cmd(meas)) or b"")
        start = pmd.build_start(meas, settings) or pmd.START.get(meas)
        if start is None:
            return {**out, "error": f"no START command for {pmd.MEAS_NAME[meas]}"}
        out["start_cmd"] = pmd.as_offline(start).hex()

        try:
            code, name = _ack_status(await cp.send(pmd.as_offline(start)))
            out["start_ack"] = name
            if code == 0x0D:
                out["verdict"] = ("device is IN THE CHARGER — every PMD start is refused while docked. "
                                  "Take it off the dock and re-run; this is not a protocol failure.")
                return out
            await asyncio.sleep(min(seconds, 60.0))
            out["status_during"] = _status_of(await cp.send(pmd.status_cmd()))
            recording = pmd.is_recording(
                pmd.parse_status_response(await cp.send(pmd.status_cmd()) or b""), meas)
            out["recording_confirmed_by_device"] = recording
            out["verdict"] = ("FORCED RECORDING CONFIRMED — the device reports it is recording to flash"
                              if recording else
                              f"start was answered '{name}' but the device does not report recording")
        finally:
            # Always. Even on an exception, even on a timeout — see the header.
            _, stop_name = _ack_status(await cp.send(pmd.stop_cmd(meas)))
            out["stop_ack"] = stop_name
            out["status_after"] = _status_of(await cp.send(pmd.status_cmd()))
        return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Can the Verity be forced to record to flash? (Phase 1)")
    ap.add_argument("--address", required=True)
    ap.add_argument("--adapter", default=None)
    ap.add_argument("--meas", default="acc", choices=sorted(_MEAS_BY_NAME),
                    help="ACC by default: recording a type removes its LIVE stream (brief §2)")
    ap.add_argument("--force-record", action="store_true", help="actually start a recording (writes!)")
    ap.add_argument("--seconds", type=float, default=20.0, help="how long to hold it before stopping")
    a = ap.parse_args(argv)
    res = asyncio.run(run(a.address, a.adapter, _MEAS_BY_NAME[a.meas], a.force_record, a.seconds))
    print(json.dumps(res, indent=2))
    return 0 if not res.get("error") else 1


if __name__ == "__main__":
    raise SystemExit(main())
