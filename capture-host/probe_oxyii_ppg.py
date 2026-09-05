# tepna-capture — probe_oxyii_ppg.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Phase 0 of O2RING-LIVE-PPG-WAVEFORM-2026-07-17-BRIEF: MEASURE the live cmd=0x04 reply on-device.
# The OxyII reference + our own reassembler comment say each 0x04 reply is a 24-B status header PLUS a
# ~100 Hz raw PPG waveform body that parse_live() ignores. This probe confirms the body on THIS ring and
# measures its size (→ true sample rate), without guessing. Read-only; captures a few frames then quits.
#
#   Stop the capture daemon first (fuser -k 8760/tcp) — the O2Ring holds ONE BLE link.
#   Wear the ring (finger in) with the phone ViHealth app CLOSED.
#     python probe_oxyii_ppg.py [--address D1:98:62:7C:92:B3] [--frames 12]
from __future__ import annotations
import argparse, asyncio
from bleak import BleakClient, BleakScanner
import oxyii
import oxy_presence


async def main(address: str, nframes: int):
    # ADDRESS-ONLY (standing ruling 2026-08-27 — see `oxy_presence.is_expected_ring`): a probe that
    # accepted any "o2ring"-named beacon would connect to a stranger's device as readily as the daemon.
    dev = await BleakScanner.find_device_by_filter(
        lambda d, adv: oxy_presence.is_expected_ring(d.address, address),
        timeout=25)
    if dev is None:
        print("ring not advertising — wear it (finger in), phone app closed, daemon stopped.")
        return

    reasm = oxyii.Reassembler()
    frames: list[bytes] = []

    def on_notify(_h, data):
        for fr in reasm.feed(bytes(data)):
            r = oxyii.decode(fr)
            if r and r[0] == oxyii.OP_LIVE:
                frames.append(r[1])

    async with BleakClient(dev, timeout=25) as c:
        mtu = getattr(c, "mtu_size", "?")
        print(f"connected {dev.address}  MTU={mtu}")
        await c.start_notify(oxyii.OXYII_NOTIFY, on_notify)
        await c.write_gatt_char(oxyii.OXYII_WRITE, oxyii.auth_frame(), response=False)
        await asyncio.sleep(0.6)
        await c.write_gatt_char(oxyii.OXYII_WRITE, oxyii.setup_frame(), response=False)
        await asyncio.sleep(0.6)
        for _ in range(nframes):
            await c.write_gatt_char(oxyii.OXYII_WRITE, oxyii.live_frame(), response=False)
            await asyncio.sleep(1.0)

    print(f"\ncaptured {len(frames)} live 0x04 replies")
    HDR = 24                                    # reference's stated status-header size
    for i, p in enumerate(frames):
        parsed = oxyii.parse_live(p) or {}
        print(f"  frame {i:2d}: payload_len={len(p):4d}  body={max(0, len(p) - HDR):4d}  "
              f"spo2={parsed.get('spo2')} hr={parsed.get('pr')} contact={parsed.get('contact')}")
    if not frames:
        return
    print("\n  first 2 frames, full hex:")
    for p in frames[:2]:
        print("   ", p.hex())
    lens = sorted(len(p) for p in frames)
    bodies = sorted(max(0, ln - HDR) for ln in lens)
    med_body = bodies[len(bodies) // 2]
    print(f"\n  payload len: min={lens[0]} max={lens[-1]} median={lens[len(lens)//2]}")
    print(f"  body (payload-{HDR}): min={bodies[0]} max={bodies[-1]} median={med_body} bytes/frame")
    if med_body <= 2:
        print("  → NO PPG body beyond the header on this ring/firmware → Phase-0 KILL criterion.")
    else:
        # frames arrive ~1/s, so body bytes/frame ≈ samples/sec × bytes/sample
        print(f"  → body present. If samples are: 1B → ~{med_body} Hz · 2B → ~{med_body//2} Hz · "
              f"3B(24-bit) → ~{med_body//3} Hz  (Phase 1 decodes width/endianness against the Verity PPG)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--address", default="D1:98:62:7C:92:B3")
    ap.add_argument("--frames", type=int, default=12)
    a = ap.parse_args()
    asyncio.run(main(a.address, a.frames))
