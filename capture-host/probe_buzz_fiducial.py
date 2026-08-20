# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""probe_buzz_fiducial — fire ONE commanded buzz (0x83) into the ring's own raw stream and locate it.

O2RING-BUZZ-FIDUCIAL §3 step 1: confirm the 0x83 artifact SHAPE on hardware. Stream the raw dual-
wavelength buffer (cmd 0x05 → parse_rt_ppg → chA, chB, motion), fire a single vibrate at a known host
instant `--pre` seconds in, keep streaming `--post` seconds, then compare the MOTION channel in the
window AFTER the buzz against the baseline before it. The motion byte is the safer detector (the optical
amplitude response is unverified); both are reported.

SAFE BY CONSTRUCTION: the ONLY device-state write is 0x83, hard-coded. Never the 0xEE/0xE3 resets.
Read/stream opcodes otherwise. Runs with the capture daemon stopped (link_guard).

Usage (on the box, daemon stopped):
    .venv/bin/python probe_buzz_fiducial.py --address <MAC> [--pre 5] [--post 10] [--out buzz.txt]
"""
from __future__ import annotations
import argparse
import asyncio
import sys
from time import monotonic
from time import time as wall
import time as _timemod

sys.path.insert(0, ".")
from link_guard import require_free_link   # noqa: E402
import oxyii                                # noqa: E402
from bleak import BleakClient               # noqa: E402

VIBRATE = 0x83               # the ONLY device-state write this tool ever issues
_SPAN_S = 1.0                # capture.py _RT_PPG_SPAN_S — one raw buffer covers ~1 s (bounded, not a rate)


def back_time(recs, arrival_s: float, span_s: float = _SPAN_S):
    """Back-time a raw buffer's records from its arrival, exactly as the daemon does: the step is the
    BUFFER SPAN over its records, not a nominal rate. Returns [(host_s, chA, chB, motion)]. PURE."""
    n = len(recs)
    if n == 0:
        return []
    step = span_s / max(n - 1, 1)
    out = []
    for i, (a, b, mo) in enumerate(recs):
        out.append((arrival_s - (n - 1 - i) * step, a, b, mo))
    return out


def locate_artifact(samples, buzz_s: float | None, window_s: float = 1.0):
    """Compare the MOTION channel in [buzz, buzz+window] against the baseline [buzz-window, buzz).
    samples: [(host_s, chA, chB, motion)]. Returns the before/after motion means, their ratio, an
    optical-std comparison, and a detection verdict. PURE. `detected` is None when there is no buzz or
    an empty window (absence of evidence, not evidence of absence)."""
    if buzz_s is None:
        return {"detected": None, "reason": "no buzz fired"}
    before = [s for s in samples if buzz_s - window_s <= s[0] < buzz_s]
    after = [s for s in samples if buzz_s <= s[0] < buzz_s + window_s]
    if not before or not after:
        return {"detected": None, "reason": "empty window on one side", "n_before": len(before), "n_after": len(after)}
    mot = lambda rows: sum(abs(r[3]) for r in rows) / len(rows)
    std = lambda rows: (sum((r[1] - sum(x[1] for x in rows) / len(rows)) ** 2 for r in rows) / len(rows)) ** 0.5
    m_before, m_after = mot(before), mot(after)
    o_before, o_after = std(before), std(after)
    ratio = m_after / m_before if m_before > 0 else (float("inf") if m_after > 0 else 1.0)
    return {
        "detected": bool(m_after >= 2 * m_before and m_after > m_before + 1),  # 2x AND an absolute lift
        "motion_before": m_before, "motion_after": m_after, "motion_ratio": ratio,
        "optical_std_before": o_before, "optical_std_after": o_after,
        "n_before": len(before), "n_after": len(after),
    }


class Chan:
    def __init__(self, client):
        self.c = client
        self.q: list = []
        self.reasm = oxyii.Reassembler()

    async def start(self):
        def on(_s, d):
            for f in self.reasm.feed(bytes(d)):
                r = oxyii.decode(f)
                if r and r[0] == oxyii.OP_RT_PPG:
                    self.q.append(r[1])
        await self.c.start_notify(oxyii.OXYII_NOTIFY, on)

    def drain(self):
        got, self.q = self.q, []
        return got

    async def write(self, frame):
        await self.c.write_gatt_char(oxyii.OXYII_WRITE, frame, response=False)


def _iso(s):
    return _timemod.strftime("%H:%M:%S", _timemod.gmtime(s)) + f".{int((s % 1) * 1000):03d}"


def write_ppg2w_file(path, samples):
    with open(path, "w") as fh:
        fh.write("Phone timestamp;sensor timestamp [ns];channel 0;channel 1;motion\n")
        for host_s, a, b, mo in samples:
            stamp = _timemod.strftime("%Y-%m-%dT%H:%M:%S", _timemod.gmtime(host_s)) + f".{int((host_s % 1) * 1000):03d}"
            fh.write(f"{stamp};0;{a};{b};{mo}\n")


async def main(address: str, pre: float, post: float, out: str, sync: bool = False) -> int:
    import datetime as _dt
    async with BleakClient(address, timeout=25.0) as c:
        ch = Chan(c)
        await ch.start()
        await ch.write(oxyii.auth_frame())
        await asyncio.sleep(0.3)
        await ch.write(oxyii.setup_frame())
        await asyncio.sleep(0.3)
        if sync:
            # 0xC0 SET_UTC_TIME — push the host's (stratum-disciplined) LOCAL CIVIL time into the ring's
            # RTC, per Clock Contract §7 (fields stored verbatim, no TZ conversion). Same write the daemon
            # does every 6 h; opt-in here so the buzz onset can be re-measured against a freshly-synced ring.
            now = _dt.datetime.now()
            await ch.write(oxyii.set_time_frame(now))
            print(f"  ⏱ RTC synced to host {now:%H:%M:%S} (box clock ~7 ns of NTP)")
            await asyncio.sleep(0.3)
        samples: list = []
        buzz_s = None
        seq = 0
        t0 = monotonic()
        while True:
            elapsed = monotonic() - t0
            if buzz_s is None and elapsed >= pre:
                buzz_s = wall()
                await ch.write(oxyii.encode(VIBRATE, b"", seq))
                print(f"  ⚡ BUZZ fired at {_iso(buzz_s)} ({elapsed:.1f}s in)")
            if elapsed >= pre + post:
                break
            seq = (seq + 1) & 0xFF
            await ch.write(oxyii.rt_ppg_frame(seq))
            await asyncio.sleep(0.2)
            arrival = wall()
            for payload in ch.drain():
                samples.extend(back_time(oxyii.parse_rt_ppg(payload), arrival))
        samples.sort(key=lambda r: r[0])
        write_ppg2w_file(out, samples)
        print(f"  captured {len(samples)} raw samples over {pre + post:.0f}s → {out}")
        rep = locate_artifact(samples, buzz_s)
        if rep["detected"] is None:
            print(f"  artifact: inconclusive — {rep['reason']}")
        elif rep["detected"]:
            print(f"  ✓ BUZZ ARTIFACT in motion: {rep['motion_before']:.2f} → {rep['motion_after']:.2f} "
                  f"(×{rep['motion_ratio']:.1f})  optical σ {rep['optical_std_before']:.0f} → {rep['optical_std_after']:.0f}")
        else:
            print(f"  ✗ no clear motion artifact: {rep['motion_before']:.2f} → {rep['motion_after']:.2f} "
                  f"(×{rep['motion_ratio']:.1f}) — empty payload may not drive the motor hard enough")
        return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--address", required=True)
    ap.add_argument("--pre", type=float, default=5.0)
    ap.add_argument("--post", type=float, default=10.0)
    ap.add_argument("--out", default="buzz_fiducial.txt")
    ap.add_argument("--sync", action="store_true", help="push 0xC0 SET_UTC_TIME (host→ring RTC) before capture")
    a = ap.parse_args()
    require_free_link()
    sys.exit(asyncio.run(main(a.address, a.pre, a.post, a.out, a.sync)))
