#!/usr/bin/env python3
# tepna-capture — probe_pmd_opcodes.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# THE COMPLETE PMD INSTRUCTION SET — INCLUDING THE UNDOCUMENTED OPCODES — MAPPED WITHOUT EXECUTING THEM.
#
# Every other probe in this directory sends commands it understands. This one deliberately sends
# opcodes nobody here understands, which needs a method that cannot do damage while it does it.
#
# ── THE METHOD: ENUMERATE BY ERROR CODE, NOT BY EXECUTION ───────────────────────────────────────────
#
# Every documented PMD op takes parameters — a measurement type at minimum. So send the opcode ALONE,
# one byte, no payload. A device that implements the op rejects it on LENGTH before it acts; a device
# that does not implement it rejects the OPCODE. The two answers are different status codes, and that
# difference is the whole map:
#
#     0x01 invalid_op        -> the opcode DOES NOT EXIST on this firmware
#     0x04 invalid_length    -> the opcode EXISTS and wants arguments        <- the interesting one
#     0x05 invalid_parameter -> exists, parsed the (absent) payload, refused
#     0x00 ok                -> exists AND took a bare call — i.e. it DID something
#
# The last row is the risk and it is stated rather than hidden: an op that needs no parameters will
# EXECUTE. If some undocumented op is a factory reset or a flash erase, a bare probe fires it. That
# cannot be designed away from outside the firmware, so this tool is opt-in (`--i-accept-the-risk`),
# never sweeps by default, and is built to notice the damage if it happens.
#
# ── WHAT IT DOES INSTEAD OF TRUSTING ITSELF ─────────────────────────────────────────────────────────
#
# * FULL STATE SNAPSHOT before and after — measurement status, SDK-mode status, trigger status, and the
#   PPG/ACC settings menus. Any difference is reported as a SIDE EFFECT against the opcode that caused
#   it, which is the only way an undocumented write announces itself.
# * ABORT ON CHANGE. The sweep stops at the first unexplained state change rather than continuing to
#   poke a device that has just done something unknown. Finding out WHICH opcode did it matters more
#   than finishing the table.
# * KNOWN-DANGEROUS OPS ARE NAMED AND SKIPPED BY DEFAULT. 0x08/0x09 persist across power cycles (an
#   armed trigger records on every boot); they are already understood, so there is nothing to learn by
#   firing them and a real cost if a bare call happens to mean "enable".
# * NOTHING IS LEFT RUNNING — the sweep ends by reading status and stopping anything active.
#
#   python probe_pmd_opcodes.py --address … --i-accept-the-risk --json opcodes.json
#   python probe_pmd_opcodes.py --address … --dry-run          # print the plan, send nothing

from __future__ import annotations

import argparse
import asyncio
import datetime as _dt
import json

from bleak import BleakClient, BleakScanner

import polar_pmd as pmd

# Opcodes this project has established, so a hit is recognised rather than rediscovered.
KNOWN = {
    0x01: "GET_MEASUREMENT_SETTINGS", 0x02: "REQUEST_MEASUREMENT_START", 0x03: "STOP_MEASUREMENT",
    0x04: "GET_SDK_MODE_MEASUREMENT_SETTINGS", 0x05: "GET_MEASUREMENT_STATUS",
    0x06: "GET_SDK_MODE_STATUS", 0x07: "GET_OFFLINE_RECORDING_TRIGGER_STATUS",
    0x08: "SET_OFFLINE_RECORDING_TRIGGER_MODE", 0x09: "SET_OFFLINE_RECORDING_TRIGGER_SETTINGS",
}
# Persist across power cycles. Already understood; nothing to learn, real cost if a bare call arms one.
SKIP_BY_DEFAULT = {0x08, 0x09}


class Control:
    def __init__(self, client):
        self.client, self.q = client, asyncio.Queue()

    async def start(self):
        await self.client.start_notify(pmd.PMD_CONTROL, lambda _s, d: self.q.put_nowait(bytes(d)))

    async def send(self, cmd: bytes, timeout: float = 5.0):
        await asyncio.sleep(0.25)
        while not self.q.empty():
            self.q.get_nowait()
        await self.client.write_gatt_char(pmd.PMD_CONTROL, cmd, response=True)
        try:
            return await asyncio.wait_for(self.q.get(), timeout)
        except asyncio.TimeoutError:
            return None


def status_of(reply) -> tuple[int, str]:
    """A control-point ACK is [0xF0, op, meas|0xff, status, …]."""
    if reply is None:
        return pmd.NO_ACK, "no_response"
    code = reply[3] if len(reply) > 3 and reply[0] == 0xF0 else (reply[-1] if reply else pmd.NO_ACK)
    return code, pmd.CTRL_STATUS.get(code, f"unknown_{code:#04x}")


async def snapshot(cp) -> dict:
    """Everything readable that an undocumented write might disturb."""
    snap = {}
    for name, cmd in (("measurement_status", bytes([0x05])), ("sdk_mode", bytes([0x06])),
                      ("trigger_status", bytes([0x07])),
                      ("ppg_settings", bytes([0x01, pmd.PPG])), ("acc_settings", bytes([0x01, pmd.ACC]))):
        r = await cp.send(cmd)
        snap[name] = r.hex() if r else None
    return snap


def diff(a: dict, b: dict) -> dict:
    return {k: {"before": a.get(k), "after": b.get(k)} for k in a if a.get(k) != b.get(k)}


async def run(address, adapter, lo, hi, include_dangerous, dry_run) -> dict:
    plan = [op for op in range(lo, hi + 1) if include_dangerous or op not in SKIP_BY_DEFAULT]
    out = {"address": address, "range": f"{lo:#04x}-{hi:#04x}", "probed_at": _dt.datetime.now().isoformat(),
           "method": "bare single-byte opcode; existence inferred from the STATUS code, not from effect",
           "skipped": {f"{op:#04x}": KNOWN.get(op, "?") + " — persists across power cycles"
                       for op in sorted(SKIP_BY_DEFAULT) if not include_dangerous},
           "planned": [f"{op:#04x}" for op in plan]}
    if dry_run:
        out["dry_run"] = "nothing was sent"
        return out

    dev = None
    for _ in range(3):
        dev = await BleakScanner.find_device_by_address(address, timeout=12.0)
        if dev:
            break
    if dev is None:
        return {**out, "error": "device not found — is it advertising, and is the daemon stopped?"}

    async with BleakClient(dev, bluez={"adapter": adapter} if adapter else {}) as c:
        cp = Control(c)
        await cp.start()
        base = await snapshot(cp)
        out["state_before"] = base
        results = {}
        for op in plan:
            entry = {"known_as": KNOWN.get(op)}
            try:
                code, name = status_of(await cp.send(bytes([op])))
            except Exception as exc:                   # noqa: BLE001 — an ATT refusal is a result
                entry["gatt_refused"] = f"{type(exc).__name__}: {exc}"
                results[f"{op:#04x}"] = entry
                out["aborted_at"] = f"{op:#04x}"
                out["abort_reason"] = "link refused — cannot distinguish device state from link state"
                break
            entry["status"] = name
            entry["exists"] = (code != 0x01 and code != pmd.NO_ACK)
            entry["executed_bare"] = (code == 0x00)
            results[f"{op:#04x}"] = entry
            # A bare call that returned ok DID something. Snapshot immediately and stop if it shows.
            if code == 0x00 and op not in (0x05, 0x06, 0x07):
                d = diff(base, await snapshot(cp))
                if d:
                    entry["side_effect"] = d
                    out["aborted_at"] = f"{op:#04x}"
                    out["abort_reason"] = "state changed — stopping rather than poking further"
                    break
        out["opcodes"] = results
        after = await snapshot(cp)
        out["state_after"] = after
        out["net_state_change"] = diff(base, after) or "none"
        # Never leave anything running.
        st = pmd.parse_status_response(await cp.send(bytes([0x05])) or b"")
        active = [m for m, s in st.items() if s != pmd.NO_MEASUREMENT]
        for m in active:
            await cp.send(pmd.stop_cmd(m))
        out["left_running"] = [pmd.MEAS_NAME.get(m, hex(m)) for m in active]
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Map the PMD instruction set, undocumented ops included")
    ap.add_argument("--address", required=True)
    ap.add_argument("--adapter", default=None)
    ap.add_argument("--from", dest="lo", type=lambda x: int(x, 0), default=0x00)
    ap.add_argument("--to", dest="hi", type=lambda x: int(x, 0), default=0x3F)
    ap.add_argument("--include-dangerous", action="store_true",
                    help="also send 0x08/0x09 — they PERSIST across power cycles")
    ap.add_argument("--dry-run", action="store_true", help="print the plan, send nothing")
    ap.add_argument("--i-accept-the-risk", action="store_true",
                    help="required to send anything: an undocumented op needing NO parameters will "
                         "EXECUTE on a bare probe, and this cannot be prevented from outside the firmware")
    ap.add_argument("--json", dest="json_path", default=None)
    a = ap.parse_args(argv)
    if not (a.dry_run or a.i_accept_the_risk):
        print("refusing: pass --dry-run to see the plan, or --i-accept-the-risk to send it.\n"
              "A bare probe of an undocumented parameterless opcode EXECUTES it.")
        return 2
    res = asyncio.run(run(a.address, a.adapter, a.lo, a.hi, a.include_dangerous, a.dry_run))
    text = json.dumps(res, indent=2, default=str)
    if a.json_path:
        with open(a.json_path, "w") as fh:
            fh.write(text + "\n")
    print(text)
    return 1 if res.get("error") or res.get("aborted_at") else 0


if __name__ == "__main__":
    raise SystemExit(main())
