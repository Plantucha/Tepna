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
import json
import sys
from time import monotonic

sys.path.insert(0, ".")
from link_guard import require_free_link   # noqa: E402
import oxyii                                # noqa: E402
import verdict as VD                        # noqa: E402

try:
    from bleak import BleakClient
except ImportError:  # no radio stack (the adoption gate's runner): the pure halves still import
    BleakClient = None  # type: ignore[assignment,misc]

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


# The candidate band: a u16/u32 LE window that advanced by the gap, ±max(2 s, 20 %). Pre-stated; it
# is the ONE rule both the prose (`diff`) and the object (`classify` → `verdict_object`) read.
GAP_TOL_FLOOR_S = 2.0
GAP_TOL_FRACTION = 0.2


def clock_candidates(a: bytes, b: bytes, gap_s: float) -> list[tuple[int, int, int, int, int]]:
    """`[(width_bytes, offset, before, after, delta)]` for every LE window that advanced by ≈ gap. PURE."""
    out = []
    for w in (2, 4):
        for i in range(0, min(len(a), len(b)) - w + 1):
            va = int.from_bytes(a[i:i+w], "little")
            vb = int.from_bytes(b[i:i+w], "little")
            d = vb - va
            if 0 < d and abs(d - gap_s) <= max(GAP_TOL_FLOOR_S, gap_s * GAP_TOL_FRACTION):
                out.append((w, i, va, vb, d))
    return out


def diff(a: bytes, b: bytes, gap_s: float) -> list[str]:
    out = []
    for i in range(min(len(a), len(b))):
        if a[i] != b[i]:
            out.append(f"    byte[{i:2d}]  {a[i]:02X} -> {b[i]:02X}  (Δ={b[i]-a[i]:+d})")
    # multi-byte candidates: does any u16/u32 LE window advance by ~gap?
    for w, i, va, vb, d in clock_candidates(a, b, gap_s):
        out.append(f"    *** u{w*8} LE @{i}: {va} -> {vb}  Δ={d}  ≈ the {gap_s:.0f}s gap — CLOCK CANDIDATE")
    return out


# ── tepna.verdict/1 — the VERDICT line as ONE object (VERDICT-CONTRACT wave 2) ───────────────────
# The rule `diff()` applies is a multi-byte LE window that advanced by ≈ the gap (|Δ − gap| ≤
# max(2 s, 20 %)) — the "CLOCK CANDIDATE" it prints. PASS ⇔ at least one opcode carries one · FAIL
# every readable reply was byte-identical (the prose VERDICT: no read opcode carries the RTC) · UNKNOWN
# bytes moved but no window tracked the gap (the probe has never claimed either way there, so the object
# does not either). Population: the opcodes read; one unreadable on either side is excluded — it was
# not compared. `outcome` per opcode ∈ {unreadable, identical, changed, candidate}, from `classify()`.
VERDICT_GATE = "oxyii-rtc-read-opcode"
VERDICT_CRITERION = {"name": "opcodes_with_clock_candidate", "threshold": 1, "unit": "opcodes", "direction": "gte"}


def classify(first: bytes | None, second: bytes | None, gap_s: float) -> str:
    """One opcode's outcome from its two reads. PURE. The candidate rule is `clock_candidates`, the
    same function `diff()` prints from, so prose and object cannot disagree."""
    if first is None or second is None:
        return "unreadable"
    if not diff(first, second, gap_s):   # the prose's BYTE-IDENTICAL, by the same comparison
        return "identical"
    return "candidate" if clock_candidates(first, second, gap_s) else "changed"


def verdict_object(outcomes: dict[str, str], gap_s: float) -> dict:
    """PURE over `{opcode_name: outcome}`."""
    n = len(outcomes)
    unread = [k for k, v in outcomes.items() if v == "unreadable"]
    cands = [k for k, v in outcomes.items() if v == "candidate"]
    changed = [k for k, v in outcomes.items() if v == "changed"]
    pop = {"checked": n - len(unread), "eligible": n, "excluded": len(unread)}
    result = {"gap_s": gap_s, "outcomes": dict(outcomes), "candidates": cands}
    ev = ["capture-host/probe_rtc_read.py"] + sorted(outcomes)
    tool = "capture-host/probe_rtc_read.py"
    if pop["checked"] == 0:
        return VD.make(gate=VERDICT_GATE, status="NOT_RUN", population=pop, criterion=VERDICT_CRITERION,
                       result=None, evidence=ev, tool=tool,
                       reason=f"no opcode was readable on both sides of the {gap_s:.0f} s gap — nothing compared")
    if cands:
        return VD.make(gate=VERDICT_GATE, status="PASS", population=pop, criterion=VERDICT_CRITERION,
                       result=result, evidence=ev, tool=tool, reason=None)
    if changed:
        return VD.make(gate=VERDICT_GATE, status="UNKNOWN", population=pop, criterion=VERDICT_CRITERION,
                       result=result, evidence=ev, tool=tool,
                       reason=f"bytes moved in {', '.join(changed)} but no u16/u32 window tracked the "
                              f"{gap_s:.0f} s gap — neither an RTC nor its absence was shown")
    return VD.make(gate=VERDICT_GATE, status="FAIL", population=pop, criterion=VERDICT_CRITERION,
                   result=result, evidence=ev, tool=tool,
                   reason="no read opcode carries the RTC — every readable reply was byte-identical "
                          f"across {gap_s:.0f} s; pull-time does not exist on this surface")


def verdict_sample() -> dict:
    """The object the adoption gate reads (`--verdict-sample`): synthetic reads, no ring."""
    a = bytearray(60); b = bytearray(60)
    a[4:8] = (1000).to_bytes(4, "little"); b[4:8] = (1010).to_bytes(4, "little")
    outcomes = {"GET_INFO": classify(bytes(a), bytes(b), 10.0), "GET_CONFIG": classify(bytes(40), bytes(40), 10.0),
                "GET_BATTERY": classify(None, bytes([80]), 10.0)}
    return verdict_object(outcomes, 10.0)


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
        outcomes: dict[str, str] = {}
        for name, op in READS.items():
            a, b = first[name], await ch.ask(op, 2)
            outcomes[name] = classify(a, b, actual)
            if a is None or b is None:   # == outcomes[name] == "unreadable", spelled so mypy narrows
                print(f"  {name}: unreadable on one side — inconclusive")
                continue
            d = diff(a, b, actual)
            if d:
                changed_any = True
                print(f"  {name}: {len(d)} change(s) across {actual:.1f}s")
                for line in d:
                    print(line)
            else:
                print(f"  {name}: BYTE-IDENTICAL across {actual:.1f}s — no clock in this reply")
        if not changed_any:
            print("\n  VERDICT: no read opcode carries the RTC — pull-time does not exist on this surface.")
        # One line, the object, after the prose — the verdict a machine reads (VERDICT-CONTRACT §1).
        print(json.dumps(verdict_object(outcomes, actual)))
        return 0


if __name__ == "__main__":
    if sys.argv[1:] == ["--verdict-sample"]:  # the adoption gate's cmd — no ring, no link guard
        print(json.dumps(verdict_sample(), indent=1))
        sys.exit(0)
    if BleakClient is None:
        sys.exit("probe_rtc_read: bleak is not installed — this probe needs a radio stack")
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
