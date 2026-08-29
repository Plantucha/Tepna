#!/usr/bin/env python3
# tepna-capture — probe_verity_survey.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# THE WHOLE DEVICE SURVEY, UNATTENDED, AS ONE JSON RECORD.
#
# `probe_pmd_surface.py` sweeps the read-only control point. `probe_verity_offline.py` proves one write.
# This runs the ENTIRE research cycle end-to-end — identity, capability, mode state, an offline
# recording, the PS-FTP pull, and a decode of the container that comes back — and hands over a single
# structured report to be analysed afterwards. The point is that the expensive part of this work is not
# the thinking, it is holding a flaky BLE link long enough to ask forty questions in the right order.
#
# ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────────
#
# Every fact this repo has about the Verity was won one BLE window at a time, and several were won
# twice because a probe crashed before writing down what it had already learned. The public state of the
# art is no better: `polarofficial/polar-ble-sdk` issue #556 ("Accessing offline recording using
# python") is OPEN AND UNANSWERED, and the main community library (`zHElEARN/polar-python`) does
# streaming only — no control point, no SDK mode, no offline recording, no PS-FTP. There is no reference
# implementation to check against, so the report has to carry its own evidence.
#
# ── THE RULES IT ENFORCES ───────────────────────────────────────────────────────────────────────────
#
# * VERIFY BY CONSEQUENCE, NEVER BY THE ACK. "start returned ok" is not "it is recording"; only status
#   (0x05) says that. "stop returned ok" is not "it stopped"; measured 2026-08-03, a recording asked to
#   stop after 20 s ran on to 46 s. Every claim here re-reads the device.
# * NOTHING IS LEFT RUNNING. A stop in a `finally` is not enough on its own: the stop write can be
#   refused at the ATT layer by the same deafness that broke the run, so the guard cannot fire. The
#   survey ends with an unconditional `stop_everything()` that reads status and stops whatever it finds,
#   retried on its own fresh links.
# * THE LINK IS THE SCARCE RESOURCE. It intermittently refuses every write; measured across five
#   windows it accepted between four and thirty-six commands before going deaf, and once completed a
#   36-command sweep on one link. Each phase therefore retries as a UNIT and writes its findings into
#   the report as it goes, so a crash at phase 6 still hands over phases 1-5.
# * NO TRIGGER WRITES, EVER. Ops 0x08/0x09 persist across power cycles — an armed trigger makes the
#   device record by itself on every boot. Not swept, not offered, not reachable from here.
#
#   python probe_verity_survey.py --address 24:AC:AC:0C:30:1E --json survey.json
#   python probe_verity_survey.py --address ... --record-seconds 30 --pull-dir /tmp/pull
#   python probe_verity_survey.py --address ... --no-write      # read-only: identity + capability only
#
# A Polar grants ONE BLE link, so stop the daemon first (deadman-timed, comes back by itself):
#       sudo -n /usr/local/lib/tepna/tepna-restart.sh stop 30

from __future__ import annotations

import argparse
import asyncio
import datetime as _dt
import json
import os
import struct
import traceback

from bleak import BleakClient, BleakScanner

import polar_pmd as pmd
import polar_psftp as psftp

POLAR_EPOCH = _dt.datetime(2000, 1, 1)

# Seconds to wait after a disconnect before the next connect — see `_with_link`'s finally.
SETTLE_SEC = 6.0

DIS = {
    "manufacturer": "00002a29-0000-1000-8000-00805f9b34fb",
    "model": "00002a24-0000-1000-8000-00805f9b34fb",
    "serial": "00002a25-0000-1000-8000-00805f9b34fb",
    "hardware_rev": "00002a27-0000-1000-8000-00805f9b34fb",
    "firmware_rev": "00002a26-0000-1000-8000-00805f9b34fb",
    "software_rev": "00002a28-0000-1000-8000-00805f9b34fb",
}
BATTERY = "00002a19-0000-1000-8000-00805f9b34fb"

# The PMD feature bitmask mixes measurements and MODES. Named here and deliberately NOT in
# pmd.MEAS_NAME — webmon decides what is capturable with `not str(x).startswith("0x")`, so naming these
# there would offer three modes to the user as streams.
FLAG_NAME = {0x09: "SDK_MODE", 0x0D: "OFFLINE_RECORDING", 0x0E: "OFFLINE_HR"}

# Read-only control-point ops. An ALLOWLIST: an unknown opcode is assumed to write.
READ_OPS = {"measurement_status": 0x05, "sdk_mode_status": 0x06, "offline_trigger_status": 0x07}
OP_GET_SETTINGS, OP_GET_SDK_SETTINGS = 0x01, 0x04
FORBIDDEN = {0x08: "SET_OFFLINE_RECORDING_TRIGGER_MODE", 0x09: "SET_OFFLINE_RECORDING_TRIGGER_SETTINGS"}

# The device's own FCC ID, which Polar also puts in the DIS model field. Cross-checking them catches a
# swapped or counterfeit unit for free, and ties the report to a public filing (fccid.io/INW4J).
EXPECTED_FCC_ID = "INW4J"


def _check(cmd: bytes) -> bytes:
    if not cmd:
        raise ValueError("empty control-point command")
    if cmd[0] in FORBIDDEN:
        raise ValueError(f"refusing op {cmd[0]:#04x} ({FORBIDDEN[cmd[0]]}): persists across power cycles")
    return cmd


class Control:
    """One command in flight, replies paired by arrival order, every exchange written down."""

    def __init__(self, client):
        self.client, self.q, self.log = client, asyncio.Queue(), []

    async def start(self):
        await self.client.start_notify(pmd.PMD_CONTROL, lambda _s, d: self.q.put_nowait(bytes(d)))

    async def send(self, cmd: bytes, timeout: float = 6.0) -> bytes | None:
        _check(cmd)
        await asyncio.sleep(0.25)                      # pace it; capture.py never fires back-to-back
        while not self.q.empty():
            self.q.get_nowait()
        try:
            await self.client.write_gatt_char(pmd.PMD_CONTROL, cmd, response=True)
        except Exception as exc:                       # noqa: BLE001 — a refusal is a measurement
            self.log.append({"sent": cmd.hex(), "refused": f"{type(exc).__name__}: {exc}"})
            raise
        try:
            reply = await asyncio.wait_for(self.q.get(), timeout)
        except asyncio.TimeoutError:
            reply = None
        self.log.append({"sent": cmd.hex(), "reply": reply.hex() if reply else None})
        return reply


async def _find(address: str, attempts: int = 3, timeout: float = 12.0):
    for _ in range(attempts):
        dev = await BleakScanner.find_device_by_address(address, timeout=timeout)
        if dev is not None:
            return dev
    return None


def daemon_holds_link(unit: str = "tepna-capture.service") -> bool:
    """Is the capture daemon running and therefore holding the device's single BLE link?

    THE PRECONDITION THAT COSTS THE MOST WHEN UNCHECKED. A Polar grants exactly ONE link. With the
    daemon up, a probe's connect appears to succeed and then every GATT call raises `Service Discovery
    has not been performed yet` — an error that describes BlueZ's state, not the cause, and sends the
    reader after adapter resets and settle timers. Measured 2026-08-03: four survey runs were lost this
    way after a deadman timer silently restarted the daemon mid-session. Checking takes one subprocess
    call and turns a confusing three-frames-deep failure into a one-line instruction."""
    try:
        import subprocess
        r = subprocess.run(["systemctl", "is-active", unit], capture_output=True, text=True, timeout=10)
        return r.stdout.strip() == "active"
    except Exception:                                  # noqa: BLE001 — not on the box / no systemd
        return False


async def _cycle_adapter() -> bool:
    """Power-cycle the BlueZ adapter — no sudo needed, and bonding survives it.

    ⚠️ THIS IS NOT A FIX FOR `Service Discovery has not been performed yet`, despite being added for
    that. When that error repeated across every attempt on 2026-08-03 the actual cause was the CAPTURE
    DAEMON holding the device's single BLE link (its deadman timer had fired and restarted it) — see
    `daemon_holds_link()`. Neither this cycle nor a longer settle changed anything, because neither
    addressed the cause. Kept because it is cheap, unprivileged and leaves `Paired: yes / Bonded: yes`
    intact (PS-FTP refuses an unbonded link, so `bluetoothctl remove` would be far costlier) — but it is
    a speculative rung, not a measured remedy."""
    try:
        for arg in ("off", "on"):
            proc = await asyncio.create_subprocess_exec(
                "bluetoothctl", "power", arg,
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
            await asyncio.wait_for(proc.wait(), 15)
            await asyncio.sleep(3)
        await asyncio.sleep(4)
        return True
    except Exception:                                  # noqa: BLE001 — recovery is best-effort
        return False


async def _with_link(address: str, adapter: str | None, body, attempts: int = 3):
    """Run `body(client, cp)` on a verified link, retrying connect+subscribe+body as ONE unit.

    `is_connected` is not sufficient — measured, bleak reported a live link and the next call raised
    `Service Discovery has not been performed yet`, so `.services` is checked too."""
    last = "no attempt"
    for _ in range(attempts):
        dev = await _find(address)
        if dev is None:
            last = "device not advertising"
            continue
        # THE CONTEXT-MANAGER FORM, deliberately. `probe_verity_offline.py` uses `async with
        # BleakClient(...)` and holds a link reliably on this device; an explicit `connect()` here did
        # not, and its first control-point WRITE raised `Service Discovery has not been performed yet`
        # from inside bleak while a bare connect+read diagnostic showed 8 services and 21
        # characteristics on 3 of 3 attempts. Rather than keep theorising about why, match the call
        # shape that is known to work.
        try:
            async with BleakClient(dev, bluez={"adapter": adapter} if adapter else {}) as c:
                cp = Control(c)
                await cp.start()
                return await body(c, cp)
        except (AttributeError, NameError, TypeError, ValueError):
            # A CODE BUG IS NOT A FLAKY LINK — abort rather than spend BLE windows re-running it.
            raise
        except Exception as exc:                       # noqa: BLE001
            # KEEP THE TRACEBACK. Collapsing a failure to `type: message` cost four rounds of guessing
            # on `Service Discovery has not been performed yet`: the string names BlueZ's state and not
            # the call that raised it. The frame is the fact.
            last = f"{type(exc).__name__}: {exc}\n" + "".join(traceback.format_tb(exc.__traceback__)[-3:])
            await asyncio.sleep(SETTLE_SEC)
    raise RuntimeError(f"link failed after {attempts} attempts ({last})")


def _states(reply):
    return {pmd.MEAS_NAME[m]: pmd.ACTIVE_NAME.get(st, st)
            for m, st in sorted(pmd.parse_status_response(reply or b"").items())}


def _settings(reply):
    return {pmd.SETTING_NAME.get(sid, f"setting_{sid:#04x}"): vals
            for sid, vals in pmd.parse_settings_response(reply or b"").items()}


# ── phase 1 · identity ──────────────────────────────────────────────────────────────────────────────

async def phase_identity(address, adapter, out):
    async def body(c, _cp):
        got = {}
        for name, uuid in DIS.items():
            try:
                got[name] = bytes(await c.read_gatt_char(uuid)).decode().strip("\x00").strip()
            except Exception as exc:                   # noqa: BLE001
                got[name] = f"unavailable ({type(exc).__name__})"
        try:
            got["battery_pct"] = (await c.read_gatt_char(BATTERY))[0]
        except Exception as exc:                       # noqa: BLE001
            got["battery_pct"] = f"unavailable ({type(exc).__name__})"
        # Polar puts the FCC ID in the model field; a mismatch means a different unit than this report
        # claims to describe. Public filing: fccid.io/INW4J (Polar Electro Oy, granted 2021-02-10).
        got["fcc_id_expected"] = EXPECTED_FCC_ID
        got["fcc_id_matches_model"] = (got.get("model") == EXPECTED_FCC_ID)
        return got
    out["identity"] = await _with_link(address, adapter, body)


# ── phase 2 · capability ────────────────────────────────────────────────────────────────────────────

async def phase_capability(address, adapter, out):
    """Capability, on TWO links — the feature read and the control-point sweep cannot share one.

    ⚠️ A GATT READ OF THE CONTROL POINT COSTS THE LINK FOR SUBSEQUENT WRITES. Measured 2026-08-03 with
    a traceback: after `read_gatt_char(PMD_CONTROL)` succeeds, the very next `write_gatt_char` raises
    `Service Discovery has not been performed yet` from inside bleak — i.e. the client has silently lost
    its GATT session between the read and the write. The connect and the `.services` check both pass, so
    the failure surfaces far from its cause and reads like a radio problem; a bare connect+read+write
    diagnostic shows the link itself is perfectly healthy (8 services, 21 characteristics, 3/3 runs).

    `probe_pmd_surface` already handles this by giving the feature read a dedicated link. This did not,
    which is why four survey runs lost their capability and record phases."""
    got = {}

    async def read_features(c, _cp):
        raw = bytes(await c.read_gatt_char(pmd.PMD_CONTROL))
        return raw

    try:
        raw = await _with_link(address, adapter, read_features)
        feats = pmd.parse_features(raw)
        got["feature_bitmask"] = raw.hex()
        got["measurements"] = sorted(pmd.MEAS_NAME[f] for f in feats if f in pmd.MEAS_NAME)
        got["flag_bits"] = {f"{f:#04x}": FLAG_NAME.get(f, "unrecognised")
                            for f in sorted(feats) if f not in pmd.MEAS_NAME}
        meas = sorted(f for f in feats if f in pmd.MEAS_NAME)
    except Exception as exc:                           # noqa: BLE001
        got["feature_bitmask"] = f"unavailable ({type(exc).__name__})"
        got["note"] = "feature read failed — swept every known measurement type instead"
        meas = sorted(pmd.MEAS_NAME)

    async def sweep(_c, cp):
        res = {}
        for label, op in READ_OPS.items():
            r = await cp.send(_check(bytes([op])))
            res[label] = {"raw": r.hex() if r else None}
            if op == 0x05 and r:
                res[label]["active"] = _states(r)
        menus = {}
        for m in meas:
            name = pmd.MEAS_NAME[m]
            menus[name] = {}
            for mode, op, bit in (("online", OP_GET_SETTINGS, 0), ("offline", OP_GET_SETTINGS, 0x80),
                                  ("sdk_online", OP_GET_SDK_SETTINGS, 0),
                                  ("sdk_offline", OP_GET_SDK_SETTINGS, 0x80)):
                menus[name][mode] = _settings(await cp.send(_check(bytes([op, m | bit]))))
        res["settings_menus"] = menus
        res["control_transcript"] = cp.log
        return res

    got.update(await _with_link(address, adapter, sweep))
    out["capability"] = got


# ── phase 3 · offline recording lifecycle ───────────────────────────────────────────────────────────

async def phase_record(address, adapter, meas, seconds, out):
    """Start an offline recording, confirm from the DEVICE, stop, confirm stopped."""
    async def body(_c, cp):
        got = {"measurement": pmd.MEAS_NAME[meas], "requested_seconds": seconds}
        got["status_before"] = _states(await cp.send(pmd.status_cmd()))
        await cp.send(pmd.stop_cmd(meas))              # clear anything stale; proves STOP works first
        settings = pmd.parse_settings_response(await cp.send(pmd.get_settings_cmd(meas)) or b"")
        start = pmd.build_start(meas, settings) or pmd.START.get(meas)
        if start is None:
            got["error"] = f"no START for {pmd.MEAS_NAME[meas]}"
            return got
        cmd = pmd.as_offline(start)
        got["start_cmd"] = cmd.hex()
        got["negotiated"] = _settings_from_start(cmd)
        t0 = _dt.datetime.now(_dt.timezone.utc).replace(tzinfo=None)
        try:
            r = await cp.send(cmd)
            code = r[3] if r and len(r) > 3 and r[0] == 0xF0 else pmd.NO_ACK
            got["start_ack"] = pmd.CTRL_STATUS.get(code, f"unknown_{code:#04x}")
            got["in_charger_refusal"] = (code == pmd.IN_CHARGER)
            if code == pmd.IN_CHARGER:
                # ⚠️ THE DOCKED-START QUESTION IS UNSETTLED — do not read either way into it.
                # 2026-08-03, ~21:57: the daemon reconnected on a WALL charger with the battery climbing
                # 3% -> 12% and all four STARTs returned `ok`, which was written up as "a docked Verity
                # accepts starts, contradicting the docs". Later the same day, on vigil's USB at 100%,
                # a PPG start was refused with `0x0D in_charger` exactly as documented. One observation
                # each way. The variables not held fixed: wall charger vs USB host, and charge level.
                # Recorded as measured, never asserted.
                return got
            await asyncio.sleep(min(seconds, 120.0))
            during = pmd.parse_status_response(await cp.send(pmd.status_cmd()) or b"")
            got["status_during"] = {pmd.MEAS_NAME[m]: pmd.ACTIVE_NAME.get(s, s)
                                    for m, s in sorted(during.items())}
            got["recording_confirmed_by_device"] = pmd.is_recording(during, meas)
        finally:
            await cp.send(pmd.stop_cmd(meas))
            after = pmd.parse_status_response(await cp.send(pmd.status_cmd()) or b"")
            got["status_after"] = {pmd.MEAS_NAME[m]: pmd.ACTIVE_NAME.get(s, s)
                                   for m, s in sorted(after.items())}
            got["stopped_confirmed_by_device"] = not pmd.is_recording(after, meas)
            got["host_utc_start"] = t0.isoformat()
        return got
    out["record"] = await _with_link(address, adapter, body)


def _settings_from_start(cmd: bytes) -> dict:
    """Decode the TLV block a START carries — the same block the .REC header embeds verbatim."""
    out, i = {}, 2
    while i + 2 <= len(cmd):
        sid, count = cmd[i], cmd[i + 1]
        i += 2
        width = 1 if sid == 0x04 else 2
        vals = []
        for _ in range(count):
            if i + width > len(cmd):
                break
            vals.append(cmd[i] if width == 1 else cmd[i] | (cmd[i + 1] << 8))
            i += width
        out[pmd.SETTING_NAME.get(sid, f"setting_{sid:#04x}")] = vals
    return out


# ── phase 4 · the flash ─────────────────────────────────────────────────────────────────────────────

async def phase_flash(address, adapter, pull_dir, out):
    got = {}
    try:
        recs = await psftp.list_recordings(address, adapter)
        got["listing"] = recs
        got["n_recordings"] = len(recs)
    except Exception as exc:                           # noqa: BLE001
        got["error"] = f"list failed: {type(exc).__name__}: {exc}"
        out["flash"] = got
        return
    if pull_dir and recs:
        os.makedirs(pull_dir, exist_ok=True)
        pulled = []
        for r in recs:
            dest = os.path.join(pull_dir, r["path"].strip("/").replace("/", "_"))
            try:
                m = await psftp.pull_recording(address, r["path"], dest, adapter)
                pulled.append({"session": r["path"], "dir": dest,
                               "files": [{"name": f["name"], "bytes": f["bytes"], "ok": f["ok"]}
                                         for f in m["files"]]})
            except Exception as exc:                   # noqa: BLE001
                pulled.append({"session": r["path"], "error": f"{type(exc).__name__}: {exc}"})
        got["pulled"] = pulled
    out["flash"] = got


# ── phase 5 · decode what came off the flash ────────────────────────────────────────────────────────

def parse_rec_tlv(b: bytes) -> dict:
    """The settings TLVs a `.REC` header carries, VERBATIM from the START that created it.

    Offset 0x26, established by hexdump: the 19-byte ASCII stamp occupies 0x11-0x23, then a 2-byte
    field (0x0b for PPG, 0x0f for ACC — a length or block type, not decoded), then the TLVs. Reading
    from 0x22 instead — which is what the first version did, reusing the START parser that skips a
    2-byte `[op, meas]` prefix — misaligns every field and yields `rate_hz: [256, 55, 257, 22, ...]`,
    which is the setting IDs and values interleaved. Plausible-looking garbage, no error."""
    out, i = {}, 0x26
    while i + 2 <= len(b):
        sid, count = b[i], b[i + 1]
        if sid not in pmd.SETTING_NAME or count == 0 or count > 8:
            break
        i += 2
        width = 1 if sid == 0x04 else 2
        vals = []
        for _ in range(count):
            if i + width > len(b):
                break
            vals.append(b[i] if width == 1 else b[i] | (b[i + 1] << 8))
            i += width
        out[pmd.SETTING_NAME[sid]] = vals
    return out


def find_rec_frames(b: bytes, anchor: _dt.datetime | None) -> list:
    """PMD data frames inside a `.REC`, found by signature and CONSTRAINED to the recording's own window.

    A frame is [meas_type][8-byte LE ns since 2000-01-01][frame_type][payload], identical to the live
    link. Searching for "any known measurement byte followed by a plausible ns" is far too loose — the
    payload is delta-compressed and hits that pattern by chance. The first version did exactly that,
    found 4-6 frames where there are 49, and reported a span ending in 2034 because one spurious early
    match with a huge timestamp locked the monotonic filter against every real frame behind it.

    Constrained instead: the type must be the SAME throughout (a .REC holds one stream), and every
    timestamp must fall within 24 h of the header stamp. Both facts come from the file itself."""
    if anchor is None:
        return []
    lo = int((anchor - POLAR_EPOCH).total_seconds() * 1e9) - int(60e9)
    hi = lo + int(24 * 3600 * 1e9)
    best = []
    for meas in sorted(pmd.MEAS_NAME):
        frames, prev = [], None
        for i in range(0, max(0, len(b) - 10)):
            if b[i] != meas:
                continue
            ns = struct.unpack_from("<Q", b, i + 1)[0]
            if not (lo < ns < hi):
                continue
            if prev is not None and not (0 < ns - prev < 60e9):
                continue
            frames.append({"offset": i, "sensor_ns": ns, "frame_type": b[i + 9]})
            prev = ns
        if len(frames) > len(best):
            best = [{**f, "meas": pmd.MEAS_NAME[meas]} for f in frames]
    return best


def decode_rec(path: str, expected_start_utc: _dt.datetime | None = None) -> dict:
    """Decode a Polar `.REC` container.

        0x00  17-byte fixed header (00 2b 4c 7c 3d 01 ... 75 ba 6d f9)
        0x11  ASCII "YYYY-MM-DD HH:MM:SS" (19 bytes)  <- the recording's start, in UTC
        0x24  2-byte field, then the PMD settings TLVs verbatim from the START
        then  PMD DATA FRAMES, byte-identical to the live-link format

    So the file is self-describing and needs NO new decoder — `pmd.decode_frame` handles the frames
    unmodified. Frame cadence varies with stream bandwidth (PPG ~0.94 s, ACC ~2.4 s) because the device
    batches by BYTES not time, so a consumer must take timing from `sensor_ns`, never from frame index.

    `expected_start_utc` is the host's UTC clock at the moment THIS survey started the recording, and it
    is the only honest way to judge the timebase. Passing it for an OLD file compares a stamp to an
    unrelated `now` and reports nonsense — the first version called a 13.6 h-old ACC file "local civil"
    on exactly that error."""
    b = open(path, "rb").read()
    got = {"file": os.path.basename(path), "bytes": len(b)}
    try:
        got["header_stamp"] = b[0x11:0x11 + 19].decode("ascii")
        anchor = _dt.datetime.fromisoformat(got["header_stamp"])
    except Exception:                                  # noqa: BLE001
        got["header_stamp"], anchor = None, None
    got["settings_tlv"] = parse_rec_tlv(b)
    frames = find_rec_frames(b, anchor)
    got["n_frames"] = len(frames)
    if frames:
        f0, f1 = frames[0], frames[-1]
        got["stream"] = f0["meas"]
        got["first_frame_utc"] = (POLAR_EPOCH + _dt.timedelta(microseconds=f0["sensor_ns"] / 1000)).isoformat()
        got["last_frame_utc"] = (POLAR_EPOCH + _dt.timedelta(microseconds=f1["sensor_ns"] / 1000)).isoformat()
        got["span_sec"] = round((f1["sensor_ns"] - f0["sensor_ns"]) / 1e9, 2)
        got["frame_types"] = sorted({f["frame_type"] for f in frames})
        if len(frames) > 1:
            got["median_frame_gap_ms"] = _median([(y["sensor_ns"] - x["sensor_ns"]) / 1e6
                                                  for x, y in zip(frames, frames[1:])])
            got["stride_bytes"] = _median([y["offset"] - x["offset"] for x, y in zip(frames, frames[1:])])
        # INTERNAL consistency: the ASCII header and the first frame's own clock are both the device's,
        # so they must agree. This is checkable on ANY file, old or new. No `if anchor` guard: reaching
        # here means `frames` is non-empty, and `find_rec_frames` returns [] for a None anchor.
        got["header_vs_first_frame_sec"] = round(
            (_dt.datetime.fromisoformat(got["first_frame_utc"]) - anchor).total_seconds(), 2)
    # THE TIMEBASE VERDICT — only for a recording this run created, where the host clock at start is known.
    if expected_start_utc and anchor:
        d = (anchor - expected_start_utc).total_seconds()
        got["stamp_minus_host_utc_sec"] = round(d, 1)
        got["timebase"] = ("UTC" if abs(d) < 120 else
                           f"NOT host UTC — off by {d / 3600:.2f} h (local-civil would be the UTC offset)")
    return got


def _median(xs):
    xs = sorted(xs)
    return round(xs[len(xs) // 2], 1) if xs else None


def phase_decode(out, pull_dir):
    """Decode every pulled .REC — but judge the TIMEBASE only on the one this run created.

    The recording phase records `host_utc_start`; the session directory the device chose is named from
    its OWN clock. Matching those two is the timebase proof, and it is only valid for that session."""
    if not pull_dir or not os.path.isdir(pull_dir):
        return
    started = (out.get("record") or {}).get("host_utc_start")
    expect = _dt.datetime.fromisoformat(started) if started else None
    decoded = []
    for root, _dirs, files in os.walk(pull_dir):
        for f in sorted(files):
            if not f.upper().endswith(".REC"):
                continue
            path = os.path.join(root, f)
            # Only the session we just made gets the host-clock comparison; for the rest `now` is
            # unrelated to when they were recorded and the verdict would be noise.
            ours = bool(expect and abs(os.path.getmtime(path) - _now_epoch()) < 3600 and
                        _session_matches(root, expect))
            try:
                decoded.append(decode_rec(path, expect if ours else None))
            except Exception as exc:                   # noqa: BLE001
                decoded.append({"file": f, "error": f"{type(exc).__name__}: {exc}"})
    out["decoded"] = decoded


def _now_epoch():
    return _dt.datetime.now().timestamp()


def _session_matches(dirname: str, expect: _dt.datetime) -> bool:
    """Is this pulled directory the session the recording phase just created?

    The device names the directory from its own clock (…/U/0/YYYYMMDD/R/HHMMSS -> U_0_YYYYMMDD_R_HHMMSS).
    If that is within a couple of minutes of the host UTC time we started at, it is ours — and that
    correspondence is itself the timebase evidence, so it is required to be close rather than assumed.

    THE DATE COMPONENT IS PART OF THE COMPARISON. It did not used to be: the name was split on "_",
    only the trailing HHMMSS was read, and the run's OWN date was pasted onto it
    (`datetime.combine(expect.date(), hhmmss)`). That compares TIME-OF-DAY, so a session recorded on
    any previous day at the same clock-minute was judged "the session this run just created" — measured
    at 39 days old and still matching. Its stamps then got compared against this run's host clock,
    fabricating exactly the timebase verdict `test_the_timebase_verdict_needs_this_runs_own_host_clock`
    exists to prevent ("the first version called a 13.6 h-old ACC file 'local civil' on exactly that
    error"). The mtime<1h guard in `phase_decode` does NOT cover this: a freshly PULLED old session has
    a fresh mtime, because mtime records when we wrote the file, not when the device recorded it.

    Using the directory's own date also fixes the mirror-image bug at midnight: a device saying
    23:59:50 for a run the host started at 00:00:05 the next day is 15 s apart and ours, where pasting
    the run's date made it read as ~86390 s and rejected it.

    A name with no date (…_R_HHMMSS) keeps the old same-day assumption — it carries no date to check,
    so this is the weaker case by construction, not by choice."""
    parts = os.path.basename(dirname.rstrip("/")).split("_")
    tail = parts[-1]
    if not (len(tail) == 6 and tail.isdigit()):
        return False
    try:
        hhmmss = _dt.datetime.strptime(tail, "%H%M%S").time()
    except ValueError:
        return False
    day = expect.date()
    if len(parts) >= 3 and len(parts[-3]) == 8 and parts[-3].isdigit():
        try:
            day = _dt.datetime.strptime(parts[-3], "%Y%m%d").date()
        except ValueError:
            return False                      # an 8-digit non-date is a name we do not understand
    same = _dt.datetime.combine(day, hhmmss)
    return abs((same - expect).total_seconds()) < 180


# ── the safety net ──────────────────────────────────────────────────────────────────────────────────

async def stop_everything(address, adapter, out):
    """Read status and stop whatever is running — unconditionally, on fresh links.

    A `finally` stop is not enough by itself: the stop write can be refused by the same ATT-layer
    deafness that broke the run, so the guard cannot fire. This is the backstop, and it verifies by
    re-reading status rather than trusting the ACK."""
    async def body(_c, cp):
        before = pmd.parse_status_response(await cp.send(pmd.status_cmd()) or b"")
        active = [m for m, st in before.items() if st != pmd.NO_MEASUREMENT]
        for m in active:
            await cp.send(pmd.stop_cmd(m))             # BARE type — `03 82` is refused outright
        after = pmd.parse_status_response(await cp.send(pmd.status_cmd()) or b"")
        return {"was_active": [pmd.MEAS_NAME.get(m, hex(m)) for m in active],
                "still_active": [pmd.MEAS_NAME.get(m, hex(m))
                                 for m, st in after.items() if st != pmd.NO_MEASUREMENT]}
    try:
        out["left_clean"] = await _with_link(address, adapter, body, attempts=4)
    except Exception as exc:                           # noqa: BLE001
        out["left_clean"] = {"error": f"COULD NOT VERIFY: {type(exc).__name__}: {exc}",
                             "action": "re-run with --no-write to confirm nothing is recording"}


# ── driver ──────────────────────────────────────────────────────────────────────────────────────────

async def survey(address, adapter, meas, seconds, pull_dir, do_write) -> dict:
    out = {"address": address, "started_utc": _dt.datetime.now(_dt.timezone.utc).replace(tzinfo=None).isoformat(),
           "not_sent": {f"{op:#04x}": f"{n} — persists across power cycles" for op, n in sorted(FORBIDDEN.items())}}
    if daemon_holds_link():
        out["precondition"] = ("tepna-capture.service is ACTIVE and holds the device's single BLE link. "
                               "Every phase would fail with 'Service Discovery has not been performed "
                               "yet', which names BlueZ's state and not this cause. Stop it first: "
                               "sudo -n /usr/local/lib/tepna/tepna-restart.sh stop 30")
        return out
    phases = [("identity", phase_identity(address, adapter, out)),
              ("capability", phase_capability(address, adapter, out))]
    if do_write:
        phases.append(("record", phase_record(address, adapter, meas, seconds, out)))
    phases.append(("flash", phase_flash(address, adapter, pull_dir, out)))
    for name, coro in phases:
        try:
            await coro
        except Exception as exc:                       # noqa: BLE001 — one dead phase must not cost the rest
            out.setdefault("phase_errors", {})[name] = f"{type(exc).__name__}: {exc}"
    phase_decode(out, pull_dir)
    if do_write:
        await stop_everything(address, adapter, out)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Full Verity survey: identity, capability, record, pull, decode")
    ap.add_argument("--address", required=True)
    ap.add_argument("--adapter", default=None)
    ap.add_argument("--meas", default="ppg", choices=sorted({v: k for k, v in pmd.MEAS_NAME.items()}))
    ap.add_argument("--record-seconds", type=float, default=25.0)
    ap.add_argument("--pull-dir", default=None, help="pull recordings here and decode them")
    ap.add_argument("--no-write", action="store_true", help="read-only: skip the recording phase")
    ap.add_argument("--json", dest="json_path", default=None)
    a = ap.parse_args(argv)
    meas = {v: k for k, v in pmd.MEAS_NAME.items()}[a.meas]
    res = asyncio.run(survey(a.address, a.adapter, meas, a.record_seconds, a.pull_dir, not a.no_write))
    text = json.dumps(res, indent=2, default=str)
    if a.json_path:
        with open(a.json_path, "w") as fh:
            fh.write(text + "\n")
    print(text)
    return 1 if res.get("phase_errors") else 0


if __name__ == "__main__":
    raise SystemExit(main())
