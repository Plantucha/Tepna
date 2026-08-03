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


# How many live frames to sample, and how far apart, before deciding which bytes are the device's own
# noise. Five at ~1 s covers the 1 Hz frame cadence with margin.
BASELINE_N, BASELINE_GAP_S = 5, 1.0


async def learn_baseline(r, n: int = BASELINE_N, gap: float = BASELINE_GAP_S):
    """Sample the live frame with NOTHING sent, and learn which byte positions move on their own.

    THE ABORT DETECTOR IS ONLY AS GOOD AS ITS NULL, and this one had no null at all. It was written and
    validated against a ring sitting in its dock, where the live frame is static and any difference
    really is an effect. Measured 2026-08-03 on a WORN ring: 4 of 4 consecutive frames differ in their
    first 20 bytes with nothing sent — the frame carries a plethysmogram, a sequence counter and a
    checksum. The very first opcode swept (0x00) tripped the detector, and only a hand-run control
    separated the real effect (byte 17, `c7` -> `00`, persistent across four post-frames while SpO2, HR
    and the counter carried on normally) from the noise it was buried in.

    So the null is MEASURED per run, never assumed: only positions that held constant across the
    baseline can testify, and the rest are named in the report rather than quietly ignored. If nothing
    holds constant the detector is BLIND, and it has to say so — a comparison that cannot fail is worse
    than no comparison, because it reads as a clean bill of health."""
    frames = []
    for i in range(n):
        f = await r.send(oxyii.OP_LIVE)
        if f:
            frames.append(bytes(f))
        if i < n - 1:
            await asyncio.sleep(gap)
    if not frames:
        return None, []
    width = min(len(f) for f in frames)
    stable = [i for i in range(width) if len({f[i] for f in frames}) == 1]
    return frames[-1], stable


def _changed(base: bytes | None, after_hex: str | None, stable: list) -> list:
    """Byte positions that moved AND were entitled to testify."""
    if not base or not after_hex or not stable:
        return []
    after = bytes.fromhex(after_hex)
    return [i for i in stable if i < len(after) and after[i] != base[i]]


def plan_ops(lo: int, hi: int, limit: int | None = None, skip=()) -> list:
    """Opcodes to try, NEAREST-KNOWN-FIRST rather than 0x00 upward.

    A linear crawl spends its window on empty space: at 2.5 s per silent opcode a full 0x00-0xFF pass is
    ~10 minutes against a device that is reachable only while worn or on the charger, and it front-loads
    the range that happens to be numerically smallest rather than the range most likely to answer.
    Firmware command spaces cluster — this one puts LIVE at 0x04, SETUP at 0x10, SET_UTC_TIME at 0xC0 and
    the four file ops at 0xF1-0xF4 — so an unknown sibling of a known command is a far better bet than an
    address picked for being early. Ordering by distance to the nearest documented opcode puts every
    neighbourhood in the first ~40 probes (~2 min) and leaves the barren middle for last, where a
    truncated run costs least. Ties break numerically so the order is deterministic and resumable.

    (The first real hit, 0x00, sits close to LIVE at 0x04 — which is the pattern this encodes.)

    `skip` is for an opcode already CHARACTERISED by hand. 0x00 is the case in point: it replies and it
    moves a status byte, so it trips the abort every run and stops the sweep before the rest of the space
    is reached. Re-firing it buys nothing and costs the whole window."""
    skip = set(skip)
    ops = [op for op in range(lo, hi + 1) if op not in KNOWN and op not in skip]
    ops.sort(key=lambda op: (min(abs(op - k) for k in KNOWN), op))
    return ops[:limit] if limit else ops


async def run(address, adapter, lo, hi, dry, limit=None, skip=()) -> dict:
    plan = plan_ops(lo, hi, limit, skip)
    out = {"address": address, "range": f"{lo:#04x}-{hi:#04x}",
           "method": "empty-payload command; REPLY vs SILENCE only — this protocol has no status field, "
                     "so a silent op is 'no evidence', not 'absent'",
           "skipped_known": {f"{op:#04x}": n for op, n in sorted(KNOWN.items())},
           "plan_order": "nearest-known-first — a sibling of a documented opcode beats a low address",
           "skipped_characterised": [f"{op:#04x}" for op in sorted(set(skip))],
           "planned": len(plan), "first_20": [f"{op:#04x}" for op in plan[:20]], "probed_at": _dt.datetime.now().isoformat()}
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
    # THE REPORT HOLDS THE LIVE DICT, and every line below is inside a guard. Measured 2026-08-03: a full
    # 248-opcode sweep reached its CLOSING snapshot, the link had gone by then, and the raised
    # `Service Discovery has not been performed yet` propagated out of run() before main() could write the
    # JSON — ten minutes of hardware evidence discarded on the last line, with the ring only reachable
    # while worn or charging. `out["opcodes"] = res` therefore happens BEFORE anything that can throw, and
    # a lost link is recorded as a finding rather than allowed to erase the findings.
    res: dict = {}
    out["opcodes"] = res
    try:
        async with BleakClient(dev, **kw) as c:
            r = Ring(c)
            await r.start()
            await r.send(oxyii.OP_AUTH, oxyii.auth_payload())      # the handshake the ring expects
            await r.send(oxyii.OP_SETUP, b"\x00")
            base_frame, stable = await learn_baseline(r)
            base = base_frame.hex() if base_frame else None
            out["live_before"] = base
            out["baseline"] = {"samples": BASELINE_N, "stable_bytes": len(stable),
                               "volatile_bytes": [i for i in range(len(base_frame or b""))
                                                  if i not in stable]}
            if not stable:
                # Never sweep behind a detector that cannot fail — it would read as "nothing changed".
                out["detector_blind"] = ("every byte of the live frame moves on its own, so a state "
                                         "change cannot be attributed to any opcode — refusing to sweep")
                return out
            for op in plan:
                try:
                    f = await r.send(op)
                    res[f"{op:#04x}"] = {"replied": f is not None, "frame": f.hex()[:80] if f else None}
                    if f is not None:
                        # The verification snapshot is INSIDE the guard too — a link that dies while
                        # confirming an op's effect must not cost the ops already mapped.
                        after = await snapshot(r)
                        moved = _changed(base_frame, after, stable)
                        if moved:
                            res[f"{op:#04x}"]["state_changed"] = {
                                "byte_positions": moved,
                                "before": [base_frame[i] for i in moved],
                                "after": [bytes.fromhex(after)[i] for i in moved]}
                            out["aborted_at"] = f"{op:#04x}"
                            out["abort_reason"] = ("a byte that held constant across the baseline moved — "
                                                   "stopping rather than poking further")
                            break
                except Exception as exc:                           # noqa: BLE001
                    res[f"{op:#04x}"] = {"error": f"{type(exc).__name__}: {exc}"}
                    out["aborted_at"] = f"{op:#04x}"
                    break
            out["live_after"] = await snapshot(r)
    except Exception as exc:                                       # noqa: BLE001
        out["link_lost"] = f"{type(exc).__name__}: {exc}"
    out["responders"] = [k for k, v in res.items() if v.get("replied")]
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Map the OxyII command space, undocumented ops included")
    ap.add_argument("--address", required=True)
    ap.add_argument("--adapter", default=None)
    ap.add_argument("--from", dest="lo", type=lambda x: int(x, 0), default=0x00)
    ap.add_argument("--to", dest="hi", type=lambda x: int(x, 0), default=0xFF)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--skip", default="", help="comma-separated opcodes already characterised by hand")
    ap.add_argument("--max-ops", dest="limit", type=int, default=None,
                    help="stop after N opcodes (they are ordered nearest-known-first, so a short run "
                         "still covers every neighbourhood)")
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
    skip = [int(x, 0) for x in a.skip.split(",") if x.strip()]
    res = asyncio.run(run(a.address, a.adapter, a.lo, a.hi, a.dry_run, a.limit, skip))
    text = json.dumps(res, indent=2, default=str)
    if a.json_path:
        with open(a.json_path, "w") as fh:
            fh.write(text + "\n")
    print(text)
    return 1 if res.get("error") or res.get("aborted_at") or res.get("link_lost") else 0


if __name__ == "__main__":
    raise SystemExit(main())
