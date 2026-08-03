#!/usr/bin/env python3
# tepna-capture — probe_oxyii_opcodes.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# THE O2RING COMMAND SPACE, MAPPED — the same question asked of the Verity, on a different protocol.
#
# `probe_pmd_opcodes.py` mapped the Polar PMD instruction set by exploiting a status code: an
# implemented op rejects the CALL, an absent one rejects the OPCODE, and the two differ. **That trick
# does not transfer.** The OxyII envelope carries no status field — a command either produces a reply
# frame or it does not — so the discriminator here is REPLY vs SILENCE, which is weaker evidence and is
# reported as such.
#
# Known surface (O2RING-PROTOCOL §3-§4): 0xFF AUTH · 0x10 SETUP · 0x04 LIVE · 0xC0 SET_UTC_TIME ·
# 0xF1 FILE_LIST · 0xF2 FILE_START · 0xF3 FILE_DATA · 0xF4 FILE_END.
#
# ── WHY THIS IS RISKIER THAN THE POLAR SWEEP, STATED PLAINLY ────────────────────────────────────────
#
# * The Polar sweep could lean on `invalid_op`; here an unknown command that IS implemented simply runs.
# * The command space demonstrably contains STATE-CHANGING ops — `0xC0` writes the device clock — so
#   "unknown command" and "harmless" are not the same thing.
# * The ring holds the only copy of any un-synced night. **Stored sessions must be backed up first**
#   (`pull_session.py`, or the daemon's auto-pull to `/srv/tepna/captures/stored/`) and this refuses to
#   run without `--i-accept-the-risk`.
#
# Mitigations: empty payloads (a command needing parameters should reject before acting), a live-state
# snapshot before and after, abort at the first unexplained change, and the known ops skipped by default
# so nothing already understood is fired for no information.
#
#   python probe_oxyii_opcodes.py --address <mac> --dry-run
#   python probe_oxyii_opcodes.py --address <mac> --i-accept-the-risk --json oxyii-ops.json
#
# ⚠️ THE RING ADVERTISES ONLY WHILE WORN (O2RING-PROTOCOL §5). It must be on a finger to be reachable.

from __future__ import annotations

import argparse
import asyncio
import datetime as _dt
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from link_guard import require_free_link  # noqa: E402

import oxyii  # noqa: E402
from bleak import BleakClient, BleakScanner  # noqa: E402

KNOWN = {0xFF: "AUTH", 0x10: "SETUP", 0x04: "LIVE", 0xC0: "SET_UTC_TIME",
         0xF1: "FILE_LIST", 0xF2: "FILE_START", 0xF3: "FILE_DATA", 0xF4: "FILE_END"}


class Ring:
    def __init__(self, client):
        self.c, self.q, self.buf = client, asyncio.Queue(), oxyii.Reassembler()

    async def start(self):
        def on(_s, data: bytearray):
            for frame in self.buf.feed(bytes(data)):
                self.q.put_nowait(frame)
        await self.c.start_notify(oxyii.OXYII_NOTIFY, on)

    async def send(self, op: int, payload: bytes = b"", timeout: float = 2.5):
        while not self.q.empty():
            self.q.get_nowait()
        await self.c.write_gatt_char(oxyii.OXYII_WRITE, oxyii.encode(op, payload), response=False)
        try:
            return await asyncio.wait_for(self.q.get(), timeout)
        except asyncio.TimeoutError:
            return None


async def snapshot(r):
    """The live frame is the only cheap read-back — it carries SpO2/HR/battery/contact."""
    f = await r.send(oxyii.OP_LIVE)
    return f.hex() if f else None


async def run(address, adapter, lo, hi, dry) -> dict:
    plan = [op for op in range(lo, hi + 1) if op not in KNOWN]
    out = {"address": address, "range": f"{lo:#04x}-{hi:#04x}",
           "method": "empty-payload command; REPLY vs SILENCE only — this protocol has no status field, "
                     "so a silent op is 'no evidence', not 'absent'",
           "skipped_known": {f"{op:#04x}": n for op, n in sorted(KNOWN.items())},
           "planned": len(plan), "probed_at": _dt.datetime.now().isoformat()}
    if dry:
        out["dry_run"] = "nothing sent"
        return out
    dev = None
    for _ in range(3):
        dev = await BleakScanner.find_device_by_address(address, timeout=15.0)
        if dev:
            break
    if dev is None:
        return {**out, "error": "not found — the ring advertises ONLY while worn"}
    kw = {"bluez": {"adapter": adapter}} if adapter else {}
    async with BleakClient(dev, **kw) as c:
        r = Ring(c)
        await r.start()
        await r.send(oxyii.OP_AUTH, oxyii.auth_payload())          # the handshake the ring expects
        await r.send(oxyii.OP_SETUP, b"\x00")
        base = await snapshot(r)
        out["live_before"] = base
        res = {}
        for op in plan:
            try:
                f = await r.send(op)
            except Exception as exc:                               # noqa: BLE001
                res[f"{op:#04x}"] = {"error": f"{type(exc).__name__}: {exc}"}
                out["aborted_at"] = f"{op:#04x}"
                break
            res[f"{op:#04x}"] = {"replied": f is not None, "frame": f.hex()[:80] if f else None}
            if f is not None:
                after = await snapshot(r)
                if after and base and after[:20] != base[:20]:
                    res[f"{op:#04x}"]["state_changed"] = {"before": base[:40], "after": after[:40]}
                    out["aborted_at"] = f"{op:#04x}"
                    out["abort_reason"] = "live state changed — stopping rather than poking further"
                    break
        out["opcodes"] = res
        out["live_after"] = await snapshot(r)
        out["responders"] = [k for k, v in res.items() if v.get("replied")]
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Map the OxyII command space, undocumented ops included")
    ap.add_argument("--address", required=True)
    ap.add_argument("--adapter", default=None)
    ap.add_argument("--from", dest="lo", type=lambda x: int(x, 0), default=0x00)
    ap.add_argument("--to", dest="hi", type=lambda x: int(x, 0), default=0xFF)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--i-accept-the-risk", action="store_true",
                    help="required to send: an unknown OxyII command has no status code to reject with, "
                         "so an implemented one simply RUNS. Back up stored sessions first.")
    ap.add_argument("--json", dest="json_path", default=None)
    a = ap.parse_args(argv)
    if not (a.dry_run or a.i_accept_the_risk):
        print("refusing: --dry-run to see the plan, or --i-accept-the-risk to send it.\n"
              "Unlike the PMD sweep there is no 'invalid_op' to hide behind here.")
        return 2
    if not a.dry_run:
        require_free_link()
    res = asyncio.run(run(a.address, a.adapter, a.lo, a.hi, a.dry_run))
    text = json.dumps(res, indent=2, default=str)
    if a.json_path:
        with open(a.json_path, "w") as fh:
            fh.write(text + "\n")
    print(text)
    return 1 if res.get("error") or res.get("aborted_at") else 0


if __name__ == "__main__":
    raise SystemExit(main())
