# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""probe_rtc_read — does any READ opcode expose the O2Ring's RTC? (the 0xE1 double-read probe)

The ring HAS a clock (it displays the time; 0xC0 SET_UTC_TIME writes it) but no documented read.
GET_INFO (0xE1) returns 60 bytes of which only firmware+serial are parsed; GET_CONFIG (0x00) returns
40 of which 20 are mapped. An RTC field cannot hide from a DIFFERENTIAL read: sample each reply twice,
`--gap` seconds apart, and a clock announces itself as bytes that CHANGED by ~gap in some encoding
(u8/u16/u32/BCD second counters all move). Constant bytes prove nothing either way; CHANGING bytes that
do not track the gap are counters/noise; changing bytes that track it are the RTC — settled either way.

Read-only opcodes only (0xE1, 0x00, 0xE4). Nothing here writes device state.

Usage (on the box, daemon stopped per link_guard):
    .venv/bin/python probe_rtc_read.py --address <MAC> [--gap 10]
"""
from __future__ import annotations
import argparse
import asyncio
import sys
from time import monotonic

sys.path.insert(0, ".")
from link_guard import require_free_link   # noqa: E402
import oxyii                                # noqa: E402
from bleak import BleakClient               # noqa: E402

READS = {"GET_INFO": oxyii.OP_GET_INFO, "GET_CONFIG": oxyii.OP_GET_CONFIG,
         "GET_BATTERY": oxyii.OP_GET_BATTERY}


class Chan:
    def __init__(self, client):
        self.c = client
        self.q: asyncio.Queue = asyncio.Queue()
        self.reasm = oxyii.Reassembler()

    async def start(self):
        async def on(_s, d):
            for f in self.reasm.feed(bytes(d)):
                self.q.put_nowait(f)
        await self.c.start_notify(oxyii.OXYII_NOTIFY, on)

    async def ask(self, op: int, seq: int) -> bytes | None:
        await self.c.write_gatt_char(oxyii.OXYII_WRITE, oxyii.encode(op, b"", seq), response=False)
        try:
            while True:
                f = await asyncio.wait_for(self.q.get(), 4.0)
                r = oxyii.decode(f)
                if r and r[0] == op:
                    return r[1]
        except asyncio.TimeoutError:
            return None


def diff(a: bytes, b: bytes, gap_s: float) -> list[str]:
    out = []
    for i in range(min(len(a), len(b))):
        if a[i] != b[i]:
            out.append(f"    byte[{i:2d}]  {a[i]:02X} -> {b[i]:02X}  (Δ={b[i]-a[i]:+d})")
    # multi-byte candidates: does any u16/u32 LE window advance by ~gap?
    for w in (2, 4):
        for i in range(0, min(len(a), len(b)) - w + 1):
            va = int.from_bytes(a[i:i+w], "little")
            vb = int.from_bytes(b[i:i+w], "little")
            d = vb - va
            if 0 < d and abs(d - gap_s) <= max(2, gap_s * 0.2):
                out.append(f"    *** u{w*8} LE @{i}: {va} -> {vb}  Δ={d}  ≈ the {gap_s:.0f}s gap — CLOCK CANDIDATE")
    return out


async def main(address: str, gap: float) -> int:
    async with BleakClient(address, timeout=25.0) as c:
        ch = Chan(c)
        await ch.start()
        # handshake per oxyii live path
        await c.write_gatt_char(oxyii.OXYII_WRITE, oxyii.encode(oxyii.OP_AUTH, b"", 0), response=False)
        await asyncio.sleep(0.5)
        first = {}
        for name, op in READS.items():
            first[name] = await ch.ask(op, 1)
            print(f"  {name}: {'%d bytes' % len(first[name]) if first[name] else 'NO REPLY'}")
        t0 = monotonic()
        await asyncio.sleep(gap)
        actual = monotonic() - t0
        changed_any = False
        for name, op in READS.items():
            second = await ch.ask(op, 2)
            if first[name] is None or second is None:
                print(f"  {name}: unreadable on one side — inconclusive")
                continue
            d = diff(first[name], second, actual)
            if d:
                changed_any = True
                print(f"  {name}: {len(d)} change(s) across {actual:.1f}s")
                for line in d:
                    print(line)
            else:
                print(f"  {name}: BYTE-IDENTICAL across {actual:.1f}s — no clock in this reply")
        if not changed_any:
            print("\n  VERDICT: no read opcode carries the RTC — pull-time does not exist on this surface.")
        return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--address", required=True)
    ap.add_argument("--gap", type=float, default=10.0)
    args = ap.parse_args()
    require_free_link()
    sys.exit(asyncio.run(main(args.address, args.gap)))
