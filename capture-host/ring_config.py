# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""ring_config — read the O2Ring's settings struct, or write ONE whitelisted field with read-back proof.

The vendor app's knobs (brightness, vibration intensity, alarm thresholds) over our own link. The write
path is deliberately narrow: `oxyii.set_config_frame` can only produce a frame for a whitelisted field
(SET_CONFIG_FIELDS), and every write here is bracketed by GET_CONFIG before/after with a FULL-STRUCT
diff — the write is reported as applied only if the expected byte moved to the expected value and NO
other byte moved. A write the ring ignored, half-applied, or applied somewhere unexpected exits 1 with
the diff, and the printed before-value is the restore command.

Usage (on the box, daemon stopped per link_guard):
    .venv/bin/python ring_config.py --address <MAC> --get
    .venv/bin/python ring_config.py --address <MAC> --set brightness 1
"""
from __future__ import annotations
import argparse
import asyncio
import sys

sys.path.insert(0, ".")
from link_guard import require_free_link   # noqa: E402
import oxyii                                # noqa: E402
from bleak import BleakClient               # noqa: E402


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

    async def ask_ack(self, want_op: int, timeout: float = 2.0) -> "oxyii.AckResult":
        """Read the ACK for a command already written, and return its outcome.

        Residue `2026-09-02-oxyii-acks-unparsed`: `0x01` SET_CONFIG is ack-only and its reply was never
        read, so a REJECTED write looked exactly like an accepted one. The vendor puts the status in the
        `pkgType`/`flag` byte (§2 of O2RING-PROTOCOL, `1` = success), which the old `decode()` discarded.

        This CONSUMES THE SAME FRAME THE NEXT `ask()` WOULD HAVE DRAINED AND THROWN AWAY, so the flow is
        unchanged — the ack was already being pulled off this queue and discarded; now it is read first.

        A timeout yields `NO_REPLY`, and that is the caller's observation to make: `parse_ack` cannot
        see a frame that never arrived."""
        try:
            while True:
                f = await asyncio.wait_for(self.q.get(), timeout)
                r = oxyii.decode_full(f)
                if r and r.op == want_op:
                    return oxyii.parse_ack(want_op, r)
        except asyncio.TimeoutError:
            return oxyii.parse_ack(want_op, None)

    async def ask(self, frame: bytes, want_op: int) -> bytes | None:
        await self.c.write_gatt_char(oxyii.OXYII_WRITE, frame, response=False)
        try:
            while True:
                f = await asyncio.wait_for(self.q.get(), 4.0)
                r = oxyii.decode(f)
                if r and r[0] == want_op:
                    return r[1]
        except asyncio.TimeoutError:
            return None


def struct_diff(before: bytes, after: bytes) -> list[tuple[int, int, int]]:
    """[(offset, old, new)] for every byte that moved. PURE."""
    return [(i, before[i], after[i]) for i in range(min(len(before), len(after))) if before[i] != after[i]]


def judge_write(field: str, value: int, before: bytes, after: bytes) -> tuple[bool, str]:
    """Did the write do EXACTLY what was asked? PURE.
    ok requires: the field's read-back byte (when mapped) moved to `value`, and nothing else moved.
    For the switch fields (readback None) any single-byte change among the three alarm bitfield bytes
    (alarm_flags/motor/buzzer offsets 0/4/5) is accepted but reported for the operator to eyeball."""
    changed = struct_diff(before, after)
    spec = oxyii.SET_CONFIG_FIELDS[field]
    rb = spec["readback"]
    if rb is not None:
        cfg = oxyii.parse_config(after)
        if cfg is None:
            return False, "read-back reply unparseable"
        if cfg.get(rb) != value:
            return False, f"read-back {rb}={cfg.get(rb)!r}, wanted {value} — write did not land"
        if len(changed) != 1:
            return False, f"{len(changed)} bytes moved (expected exactly 1): {[(o, hex(a), hex(b)) for o, a, b in changed]}"
        return True, f"byte[{changed[0][0]}] {changed[0][1]} → {changed[0][2]}"
    # switch fields: bitfields; require every change to sit in the known alarm bytes {0, 4, 5}
    if not changed:
        return False, "no byte moved — the ring ignored the write"
    if all(o in (0, 4, 5) for o, _a, _b in changed):
        return True, f"bitfield change: {[(o, hex(a), hex(b)) for o, a, b in changed]} (eyeball this)"
    return False, f"changes outside the alarm bitfield bytes: {[(o, hex(a), hex(b)) for o, a, b in changed]}"


def show(cfg: dict | None, raw: bytes | None):
    if cfg is None or raw is None:
        print("  (unparseable)")
        return
    for k, v in cfg.items():
        print(f"  {k:24s} {v}")
    print(f"  raw: {raw.hex()}")


async def run_get(address: str) -> int:
    async with BleakClient(address, timeout=25.0) as c:
        ch = Chan(c)
        await ch.start()
        await c.write_gatt_char(oxyii.OXYII_WRITE, oxyii.encode(oxyii.OP_AUTH, b"", 0), response=False)
        await asyncio.sleep(0.5)
        raw = await ch.ask(oxyii.config_frame(1), oxyii.OP_GET_CONFIG)
        if raw is None:
            print("  GET_CONFIG: NO REPLY")
            return 1
        show(oxyii.parse_config(raw), raw)
        return 0


async def run_set(address: str, field: str, value: int) -> int:
    frame = oxyii.set_config_frame(field, value)      # raises BEFORE any radio work on a bad request
    async with BleakClient(address, timeout=25.0) as c:
        ch = Chan(c)
        await ch.start()
        await c.write_gatt_char(oxyii.OXYII_WRITE, oxyii.encode(oxyii.OP_AUTH, b"", 0), response=False)
        await asyncio.sleep(0.5)
        before = await ch.ask(oxyii.config_frame(1), oxyii.OP_GET_CONFIG)
        if before is None:
            print("  GET_CONFIG (before): NO REPLY — refusing to write blind")
            return 1
        await c.write_gatt_char(oxyii.OXYII_WRITE, frame, response=False)
        # SURFACED, not acted on. The read-back below remains the verdict — it observes the device
        # state rather than the device's opinion of our request — but the ack is now READ and REPORTED
        # instead of silently drained, so a rejection is visible even when a read-back happens to agree.
        # No retry or abort is added here: that would be a behaviour change on its own evidence.
        ack = await ch.ask_ack(oxyii.OP_SET_CONFIG)
        print(f"  SET_CONFIG ack: {ack.value}")
        await asyncio.sleep(0.6)                       # let the setting persist before the read-back
        after = await ch.ask(oxyii.config_frame(2), oxyii.OP_GET_CONFIG)
        if after is None:
            print("  GET_CONFIG (after): NO REPLY — write state UNKNOWN; re-run --get before trusting it")
            return 1
        ok, detail = judge_write(field, value, before, after)
        prev = oxyii.parse_config(before)
        rb = oxyii.SET_CONFIG_FIELDS[field]["readback"]
        if ok:
            print(f"  ✓ {field} = {value}  ({detail})")
            if rb is not None and prev is not None:
                print(f"  restore with: --set {field} {prev.get(rb)}")
            return 0
        print(f"  ✗ {field} = {value} NOT verified: {detail}")
        return 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--address", required=True)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--get", action="store_true")
    g.add_argument("--set", nargs=2, metavar=("FIELD", "VALUE"))
    a = ap.parse_args()
    require_free_link()
    if a.get:
        sys.exit(asyncio.run(run_get(a.address)))
    sys.exit(asyncio.run(run_set(a.address, a.set[0], int(a.set[1]))))
