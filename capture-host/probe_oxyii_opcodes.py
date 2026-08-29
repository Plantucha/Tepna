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
# ❓ OPEN, and it would upgrade the whole method if it holds: the reply's 4th byte (the "flag") is NOT
# always 0x01. Measured 2026-08-03 across 13 responders — 0x01 on every reply carrying a payload, but
# 0xfc for ops 0x01/0xec and 0xe1 for 0x07/0x08, all of which returned EMPTY payloads. That is the shape
# of an ACK/NACK, i.e. the status field this file says does not exist. NOT yet asserted: three flag
# values on thirteen samples is a pattern, not a decode, and reading structure into bytes too early is
# exactly what produced two retracted findings the same day. Confirm against a command known to be
# invalid before believing it.
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


async def _cycle_adapter() -> bool:
    """Power-cycle the BlueZ adapter — unprivileged, and bonding survives it.

    ⚠️ IT IS NOT RELIABLE, and an earlier version of this comment overstated it. It cleared an
    `org.bluez.Error.InProgress` scan several times on 2026-08-03 and then, later the same day, failed
    three times in a row with a 14 s settle and no stray process holding a discovery session — the stuck
    state lives in bluetoothd, not in a client. What DID clear it was restarting the service
    (`tepna-restart.sh radio`). Keep this as the cheap unprivileged first try; escalate to the service
    restart when it does not take."""
    try:
        for arg in ("off", "on"):
            proc = await asyncio.create_subprocess_exec(
                "bluetoothctl", "power", arg,
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
            await asyncio.wait_for(proc.wait(), 15)
            await asyncio.sleep(2)
        await asyncio.sleep(3)
        return True
    except Exception:                                      # noqa: BLE001 — recovery is best-effort
        return False


async def snapshot(r):
    """The live frame is the only cheap read-back — it carries SpO2/HR/battery/contact."""
    f = await r.send(oxyii.OP_LIVE)
    return f.hex() if f else None


# How many live frames to sample, and how far apart, before deciding which bytes are the device's own
# noise. Five at ~1 s covers the 1 Hz frame cadence with margin.
BASELINE_N, BASELINE_GAP_S = 5, 1.0

# The null's control command. FILE_LIST is documented, read-only, and takes no arguments, so
# firing it establishes what a COMMAND costs without changing anything.
CONTROL_OP = 0xF1


async def _sample(r, n, gap):
    frames = []
    for i in range(n):
        f = await r.send(oxyii.OP_LIVE)
        if f:
            frames.append(bytes(f))
        if i < n - 1:
            await asyncio.sleep(gap)
    return frames


async def learn_baseline(r, n: int = BASELINE_N, gap: float = BASELINE_GAP_S):
    """Learn which byte positions cannot testify — the ones that move on their own, AND the ones that
    move merely because a command was sent at all.

    THE ABORT DETECTOR IS ONLY AS GOOD AS ITS NULL, and this one has been wrong twice.

    FIRST: it had no null. Written and validated against a ring in its dock, where the live frame is
    static, it compared raw frames — and on a WORN ring 4 of 4 consecutive frames differ with nothing
    sent (plethysmogram, sequence counter, checksum). Fixed by sampling first and letting only constant
    bytes testify.

    SECOND, and worse, because the first fix made it look rigorous: a PASSIVE null cannot see a byte
    that the act of commanding perturbs. Live-frame byte 17 sat at 0xc7 across every passive sample —
    perfectly "stable", 34 of 34 bytes on a docked ring — and moved for 0x00, 0x03 and 0x06, which was
    duly reported as three findings. Then 0xF1 (FILE_LIST: DOCUMENTED, read-only, and on a worn ring it
    does not even reply) moved it too, 199 -> 53. So byte 17 is a scratch field the command channel
    writes, not device state, and all three "effects" were the same artifact.

    Hence the null now includes a CONTROL COMMAND. A documented read-only op is fired between two
    passive samples, and any byte it disturbs is disqualified along with the self-churning ones. The
    control has to be a real command, not a read, because the thing being measured is the cost of
    commanding."""
    before = await _sample(r, n, gap)
    if not before:
        return None, []
    width = min(len(f) for f in before)
    stable = [i for i in range(width) if len({f[i] for f in before}) == 1]
    # THE CONTROL: a documented read-only command. Whatever it moves, an unknown opcode moving the same
    # byte proves nothing.
    await r.send(CONTROL_OP)
    after = await _sample(r, n, gap)
    for f in after:
        stable = [i for i in stable if i < len(f) and f[i] == before[-1][i]]
    frames = before + after
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


def _flush(path, out):
    """Write the report NOW, after every opcode.

    THE HUMAN IS PART OF THE INSTRUMENT and cannot be asked to wait for a clean exit. This device has
    actuators — a vibration motor and a display — and NOTHING in the data frame reveals them, so the only
    detector for that whole class of effect is the person wearing it. Twice on 2026-08-03 a run was killed
    the moment an actuator fired (once buzzing, once a white display) and took its entire record with it,
    because the report was written only at the end. Nine opcodes went unlogged the second time. A report
    that exists only on a clean exit does not exist during the runs that matter most."""
    if path:
        with open(path, "w") as fh:
            fh.write(json.dumps(out, indent=2, default=str) + "\n")


async def run(address, adapter, lo, hi, dry, limit=None, skip=(), json_path=None) -> dict:
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
    dev, scan_errors = None, []
    for attempt in range(3):
        try:
            dev = await BleakScanner.find_device_by_address(address, timeout=15.0)
        except Exception as exc:                           # noqa: BLE001
            # THE ADAPTER WEDGES ON EVERY DISCONNECT, and it does not admit it: the next scan raises
            # `org.bluez.Error.InProgress` while `bluetoothctl show` still reports `Discovering: no`.
            # The tell is a scan that returns in 2-3 s when a real one takes 45 — which reads as "the
            # ring is not advertising" and sends you after the device instead of the host. Measured
            # 2026-08-03: this cost several windows, and once killed a resumed sweep before a single
            # opcode was sent — this call sat OUTSIDE the guard that protects the rest of the run, so it
            # died with a traceback and wrote no report at all. A power cycle clears it, needs no sudo,
            # and bonding survives it.
            scan_errors.append(f"{type(exc).__name__}: {exc}")
            if attempt < 2:
                await _cycle_adapter()
            continue
        if dev:
            break
    if scan_errors:
        out["scan_errors"] = scan_errors
    if dev is None:
        return {**out, "error": ("adapter refused to scan — see scan_errors" if scan_errors else
                                 "not found — advertises while WORN, or briefly around a plug-in")}
    # THE REPORT HOLDS THE LIVE DICT, and every line below is inside a guard. Measured 2026-08-03: a full
    # 248-opcode sweep reached its CLOSING snapshot, the link had gone by then, and the raised
    # `Service Discovery has not been performed yet` propagated out of run() before main() could write the
    # JSON — ten minutes of hardware evidence discarded on the last line, with the ring only reachable
    # while worn or charging. `out["opcodes"] = res` therefore happens BEFORE anything that can throw, and
    # a lost link is recorded as a finding rather than allowed to erase the findings.
    res: dict = {}
    out["opcodes"] = res
    try:
        async with BleakClient(dev, bluez={"adapter": adapter} if adapter else {}) as c:
            r = Ring(c)
            await r.start()
            await r.send(oxyii.OP_AUTH, oxyii.auth_payload())      # the handshake the ring expects
            await r.send(oxyii.OP_SETUP, b"\x00")
            base_frame, stable = await learn_baseline(r)
            base = base_frame.hex() if base_frame else None
            out["live_before"] = base
            out["baseline"] = {"samples": BASELINE_N, "control_op": f"{CONTROL_OP:#04x}",
                               "null": "passive churn + one documented read-only command",
                               "stable_bytes": len(stable),
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
                    res[f"{op:#04x}"] = {"replied": f is not None, "frame": f.hex()[:80] if f else None,
                                         # WALL-CLOCK PER OPCODE, so "it buzzed at 18:00:20" resolves to
                                         # one command instead of an estimate from elapsed time.
                                         "at": _dt.datetime.now().strftime("%H:%M:%S.%f")[:12]}
                    _flush(json_path, out)
                    if f is not None:
                        # The verification snapshot is INSIDE the guard too — a link that dies while
                        # confirming an op's effect must not cost the ops already mapped.
                        after = await snapshot(r)
                        moved = _changed(base_frame, after, stable)
                        if moved:
                            # ADJUDICATE BEFORE CONVICTING. The null lasts ~10 s; the sweep lasts
                            # minutes. On a WORN ring SpO2 and HR hold still across the null and then
                            # drift on their own — measured 2026-08-03, the sweep stopped at 0x02 on
                            # byte 13 going 98 -> 95, which is SpO2 doing what SpO2 does. A byte that
                            # keeps moving across a DOCUMENTED READ-ONLY command is drifting, not
                            # responding, so the control is fired again and only what survives it
                            # convicts. Everything else is recorded as drift and the sweep goes on.
                            await r.send(CONTROL_OP)
                            ctrl = await snapshot(r)
                            drifting = set(_changed(bytes.fromhex(after), ctrl, stable))
                            real = [i for i in moved if i not in drifting]
                            if not real:
                                res[f"{op:#04x}"]["drift_suspected"] = {
                                    "byte_positions": moved,
                                    "note": "moved again under the control command — physiological "
                                            "drift, not an effect of this opcode"}
                            prev, real_moved = base_frame, real
                            # ROLL THE BASELINE FORWARD, so slow drift cannot accumulate into a false
                            # positive later in a run that lasts minutes. Read `before` off the OLD
                            # frame first — reading it after the roll reports before == after.
                            base_frame = bytes.fromhex(ctrl) if ctrl else base_frame
                            if real_moved:
                                res[f"{op:#04x}"]["state_changed"] = {
                                    "byte_positions": real_moved,
                                    "before": [prev[i] for i in real_moved],
                                    "after": [bytes.fromhex(after)[i] for i in real_moved]}
                                out["aborted_at"] = f"{op:#04x}"
                                out["abort_reason"] = ("a byte that held constant across the baseline "
                                                       "moved and did NOT move again under the control "
                                                       "command — stopping rather than poking further")
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
    res = asyncio.run(run(a.address, a.adapter, a.lo, a.hi, a.dry_run, a.limit, skip, a.json_path))
    text = json.dumps(res, indent=2, default=str)
    if a.json_path:
        with open(a.json_path, "w") as fh:
            fh.write(text + "\n")
    print(text)
    return 1 if res.get("error") or res.get("aborted_at") or res.get("link_lost") else 0


if __name__ == "__main__":
    raise SystemExit(main())
