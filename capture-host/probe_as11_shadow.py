# tepna-capture — probe_as11_shadow.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
"""probe_as11_shadow — run the AS11 session detector in SHADOW mode against a natural session.
#
Increment 1 of the session-detector rollout (brief AS11-SESSION-DETECTOR-IMPLEMENTATION): the
operator tool that drives `cpap_supervisor` + `cpap_detect.ShadowDetector` on the box, polling
FGState / MachineMetrics.LastTherapyUseDateTime / MaskPressure over the encrypted BLE link and
journalling every would-have decision to a SESSIONDETECT.csv. It DRIVES NOTHING — no capture is
started or stopped — so a night of its trace can be compared against the real button usage to
validate the state machine and tune the sustained-Standby debounce before acting mode ships.

READ-ONLY on the AS11: only `establish` + `get_items` (Get 0x43) are used; never Set / Enter* /
SetDateTime. The bleak connect mirrors `capture._cpap_ble_connect` verbatim (imported, not
copied, so the two cannot drift); everything it feeds — establish, cipher, the poll loop — is
unit-tested against fakes.

Usage (on the box, daemon stopped per link_guard):
    .venv/bin/python probe_as11_shadow.py [--interval 30] [--count N] [--out SESSIONDETECT.csv]
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from time import monotonic

sys.path.insert(0, ".")
import as11_cipher  # noqa: E402
import as11_pull  # noqa: E402
import writers  # noqa: E402
from cpap_supervisor import CPAPSessionSupervisor  # noqa: E402
from cpap_detect import ShadowDetector  # noqa: E402

# The read-only DataItems the detector needs each poll: the explicit therapy state, the mask
# pressure corroborator, and the MachineMetrics subtree that carries the LastTherapyUseDateTime
# device-verdict marker.
POLL_ITEMS = ["FGState", "MaskPressure", "MachineMetrics"]


async def run_shadow(
    *,
    connect,
    creds,
    out_path,
    interval_s,
    count,
    make_writer=None,
    supervisor=None,
    establish=as11_pull.establish,
    cipher_factory=as11_cipher.make_cipher,
    get_items=as11_pull.get_items,
    mono=monotonic,
    sleep=asyncio.sleep,
):
    """The testable orchestration: open the link, establish the encrypted session, then poll and
    journal. Every hardware seam (`connect`, `establish`, `cipher_factory`, `get_items`, the
    clock and sleep) is injected so the glue is covered without a radio."""
    write, recv_frame, disconnect = await connect()
    writer = None
    try:
        key = await establish(bytes.fromhex(creds["masterPairKey"]), creds["clientId"], write, recv_frame)
        seal, unseal = cipher_factory(key)

        async def read():
            try:
                return await get_items(write, recv_frame, seal, unseal, POLL_ITEMS)
            except as11_pull.As11Error:
                return None  # a failed read is unreachable-for-this-tick, never a fabricated state

        writer = (make_writer or _default_writer)(out_path)
        det = ShadowDetector(
            supervisor or CPAPSessionSupervisor(),
            read=read,
            mono=mono,
            writer=writer,
            poll_interval_s=interval_s,
        )
        polled = {"n": 0}

        def should_stop():
            if count is None:
                return False
            polled["n"] += 1
            return polled["n"] > count

        await det.run(should_stop=should_stop, sleep=sleep)
    finally:
        if writer is not None:
            writer.close()
        await disconnect()


def _default_writer(out_path):  # pragma: no cover - thin ctor over the file-sidecar edge
    return writers.OxyLifeLogWriter(out_path, device="as11-shadow")


async def _connect(ble_addr, hci):  # pragma: no cover - bleak I/O edge, CI has no radio
    from capture import _cpap_ble_connect

    return await _cpap_ble_connect(ble_addr, hci)


async def main():  # pragma: no cover - CLI wiring over the pragma'd bleak/creds edges
    from capture import _load_as11_creds

    ap = argparse.ArgumentParser()
    ap.add_argument("--creds", default="as11_creds.json")
    ap.add_argument("--adapter", default=None, help="hciN to pin the free radio")
    ap.add_argument("--interval", type=float, default=30.0)
    ap.add_argument("--count", type=int, default=None, help="stop after N polls (default: until Ctrl-C)")
    ap.add_argument("--out", default="SESSIONDETECT.csv")
    args = ap.parse_args()
    creds = _load_as11_creds(args.creds)
    if creds is None:
        print("no AS11 creds — cannot run", file=sys.stderr)
        return 1
    await run_shadow(
        connect=lambda: _connect(creds["ble_addr"], args.adapter),
        creds=creds,
        out_path=args.out,
        interval_s=args.interval,
        count=args.count,
    )
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(asyncio.run(main()))
