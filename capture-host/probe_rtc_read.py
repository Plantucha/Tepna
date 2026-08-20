# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""probe_rtc_read — the O2Ring's RTC over BLE: the differential probe that FOUND it, and --clock to read it.

ANSWERED 2026-08-19, on hardware: GET_INFO (0xE1) bytes [24:31] ARE the RTC — year u16 LE, month, day,
hour, minute, second, the exact layout 0xC0 SET_UTC_TIME writes (oxyii.parse_get_info now decodes it).
The differential mode below is what found it (byte[30] advanced by the gap mod 60; byte[29] carried),
and an absolute read matched the freshly-synced host to the second. So time can be PULLED from the ring,
not only pushed.

The differential method, kept because it generalises: sample each read-only reply twice, `--gap` seconds
apart — a clock announces itself as bytes that CHANGED by ~gap in some encoding; constant bytes prove
nothing either way; changing bytes that do not track the gap are counters/noise (GET_BATTERY[2] is such
a one: analog voltage-like, bidirectional). `--clock` is the payoff: one read → ring RTC vs the
NTP-disciplined host, a direct drift check on the 6-hourly 0xC0 push.

Read-only opcodes only (0xE1, 0x00, 0xE4). Nothing here writes device state.

Usage (on the box, daemon stopped per link_guard):
    .venv/bin/python probe_rtc_read.py --address <MAC> [--gap 10]     # differential byte survey
    .venv/bin/python probe_rtc_read.py --address <MAC> --clock        # ring RTC vs host, one read
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


def clock_offset_s(rtc: dict, host) -> float:
    """Seconds the ring's RTC reads AHEAD of the host's local civil clock. Both sides are naive local
    wall time (Clock Contract: the ring stores set_time_frame's fields verbatim), so the comparison is
    component arithmetic — no zones anywhere. PURE."""
    import datetime as _dt
    ring = _dt.datetime(rtc["year"], rtc["month"], rtc["day"], rtc["hour"], rtc["minute"], rtc["second"])
    return (ring - host).total_seconds()


async def read_clock(address: str) -> int:
    """--clock: ONE GET_INFO read → the ring's RTC vs the host, as a signed offset. This is the pull-side
    drift check the differential probe proved possible: run it any time to see how far the free-running
    RTC has wandered since the last 0xC0 push (the daemon re-pushes 6-hourly)."""
    import datetime as _dt
    async with BleakClient(address, timeout=25.0) as c:
        ch = Chan(c)
        await ch.start()
        await c.write_gatt_char(oxyii.OXYII_WRITE, oxyii.encode(oxyii.OP_AUTH, b"", 0), response=False)
        await asyncio.sleep(0.5)
        payload = await ch.ask(oxyii.OP_GET_INFO, 1)
        host = _dt.datetime.now().replace(microsecond=0)
        if payload is None:
            print("  GET_INFO: NO REPLY — cannot read the clock")
            return 1
        info = oxyii.parse_get_info(payload)
        if not info or info.get("rtc") is None:
            print("  GET_INFO replied but the RTC fields are out of range — not a readable clock state")
            return 1
        r = info["rtc"]
        off = clock_offset_s(r, host)
        print(f"  ring RTC : {r['year']:04d}-{r['month']:02d}-{r['day']:02d} {r['hour']:02d}:{r['minute']:02d}:{r['second']:02d}")
        print(f"  host now : {host:%Y-%m-%d %H:%M:%S}  (local civil, NTP-disciplined)")
        print(f"  offset   : ring is {off:+.0f} s vs host  (±1 s read quantum)")
        return 0


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
    ap.add_argument("--clock", action="store_true",
                    help="single read: the ring's RTC vs the host clock (drift since the last 0xC0 push)")
    args = ap.parse_args()
    require_free_link()
    if args.clock:
        sys.exit(asyncio.run(read_clock(args.address)))
    sys.exit(asyncio.run(main(args.address, args.gap)))
