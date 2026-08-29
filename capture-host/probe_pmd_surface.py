#!/usr/bin/env python3
# tepna-capture — probe_pmd_surface.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# THE WHOLE DOCUMENTED PMD COMMAND SURFACE, SWEPT ONCE, RECORDED VERBATIM. Companion to
# probe_verity_offline.py: that one answers a single question (can the device be forced to record?);
# this one collects the reference material a developer needs to answer the next twenty without
# re-deriving the wire format from a Kotlin SDK. Its output IS the evidence behind
# briefs/POLAR-PMD-COMMAND-SURFACE-2026-08-02-BRIEF.md — every "measured" line in that brief is a line
# in this transcript.
#
# ── WHAT IT SENDS, AND WHY THAT LIST IS AN ALLOWLIST ────────────────────────────────────────────────
#
# `SWEEP` below is an ALLOWLIST of control-point ops, and `_check_allowed` refuses anything outside it.
# The polarity is deliberate and it is the opposite of the compute-closure denylist in CLAUDE.md: there,
# an unknown asset must be assumed DANGEROUS so the gate cannot go blind; here, an unknown OPCODE must
# be assumed dangerous so the probe cannot poke firmware. A denylist of "the ops we know are writes"
# fails open the moment a firmware revision adds op 0x0B — we would send it having no idea what it does.
#
# Swept (all read-only — they report state, they do not change it):
#   0x01 GET_MEASUREMENT_SETTINGS         per measurement type, ONLINE and (|0x80) OFFLINE
#   0x04 GET_SDK_MODE_MEASUREMENT_SETTINGS per measurement type
#   0x05 GET_MEASUREMENT_STATUS           what is active right now, online and/or offline
#   0x06 GET_SDK_MODE_STATUS
#   0x07 GET_OFFLINE_RECORDING_TRIGGER_STATUS
#   0x0A (SDK name GET_DERIVED_MEASUREMENT_SETTINGS) — swept because it answers; NOT decoded here
# plus a plain GATT READ of the control point (the feature bitmask) and the Device Information Service.
#
# DELIBERATELY NOT SENT, and this is not squeamishness:
#   * 0x08 / 0x09 — SET_OFFLINE_RECORDING_TRIGGER_MODE / _SETTINGS. These PERSIST ACROSS POWER CYCLES.
#     A trigger left armed makes the device start recording by itself on every power-up, which silently
#     consumes the ~2 MB flash budget and — because one data type cannot be both offline and online —
#     removes the live stream the nightly capture depends on. A probe that leaves the device in a
#     different state than it found it is not a probe. Setting a trigger is a DESIGN DECISION with a
#     rollback plan, not a sweep item.
#   * every undocumented opcode. Note the distinction: an unrecognised OPCODE is never sent at all; an
#     unrecognised BITMASK BIT is only ever asked about with a documented READ op, and even that is
#     opt-in (--include-flag-bits).
#
# ── THE CLOCK LEG (--clock-experiment) ──────────────────────────────────────────────────────────────
#
# Opt-in, because it WRITES the device clock. It exists because reading the clock back is not proof of
# anything: measured 2026-07-18, GET_LOCAL_TIME faithfully echoed a local civil time we had set while
# PMD samples kept arriving stamped +4 h. The device answers about one clock and stamps with another,
# so the only honest test reads BOTH:
#
#   1. GET_LOCAL_TIME                         -> what the device says it holds
#   2. one live ACC frame -> Sample.sensor_ns -> what the device actually STAMPS
#   3. SET_LOCAL_TIME(local civil, real tz offset), then repeat 1 and 2
#   4. RESTORE the daemon's convention (UTC, tz_offset=0) in a `finally`
#
# Step 4 is the load-bearing one. capture.py deliberately runs every device on UTC so siblings share an
# origin (polar_psftp.set_local_time explains why); a probe that wandered off and left the armband on
# local civil would shift the next night's device stamps by the UTC offset — a 4 h error that looks
# entirely plausible in a file and would be found, if at all, weeks later in a cross-device comparison.
#
#   python probe_pmd_surface.py --address 24:AC:AC:0C:30:1E                     # read-only sweep
#   python probe_pmd_surface.py --address 24:AC:AC:0C:30:1E --clock-experiment  # + the clock proof
#   python probe_pmd_surface.py --address ... --json /tmp/surface.json          # machine-readable
#
# A Polar holds ONE BLE link, so stop the daemon first (deadman-timed, comes back by itself):
#       sudo -n /usr/local/lib/tepna/tepna-restart.sh stop 15

from __future__ import annotations

import argparse
import asyncio
import contextlib
import datetime as _dt
import json

from bleak import BleakClient, BleakScanner

import polar_pmd as pmd
import polar_psftp as psftp

# Device Information Service — which firmware answered matters more than any single reply. A protocol
# note with no firmware revision beside it is a note about an unknown device.
DIS = {
    "manufacturer": "00002a29-0000-1000-8000-00805f9b34fb",
    "model": "00002a24-0000-1000-8000-00805f9b34fb",
    "serial": "00002a25-0000-1000-8000-00805f9b34fb",
    "hardware_rev": "00002a27-0000-1000-8000-00805f9b34fb",
    "firmware_rev": "00002a26-0000-1000-8000-00805f9b34fb",
    "software_rev": "00002a28-0000-1000-8000-00805f9b34fb",
}
BATTERY = "00002a19-0000-1000-8000-00805f9b34fb"

# The PMD feature bitmask is NOT purely a list of measurements — it also advertises MODES. Named here
# and NOT in `pmd.MEAS_NAME`, deliberately: webmon decides what is capturable with
# `not str(x).startswith("0x")`, so naming these there would offer three modes to the user as streams
# (gate-locked by tests/test_webmon_settings_contract.py). A flag needs a separate table, not a rename.
FLAG_NAME = {0x09: "SDK_MODE", 0x0D: "OFFLINE_RECORDING", 0x0E: "OFFLINE_HR"}

POLAR_EPOCH = _dt.datetime(2000, 1, 1)          # device stamps are ns since this instant

# Ops this probe may send. See the header: allowlist, not denylist.
OP_GET_SETTINGS = 0x01
OP_GET_SDK_SETTINGS = 0x04
OP_STATUS = 0x05
OP_SDK_MODE_STATUS = 0x06
OP_TRIGGER_STATUS = 0x07
OP_DERIVED_SETTINGS = 0x0A

# name -> (op, takes a measurement-type argument?). Names are the polar-ble-sdk
# `PmdControlPointCommand` labels; the OP NUMBERS are what this probe actually measured answering.
#
# CHEAPEST AND SCARCEST FIRST. The link accepts a handful of writes before going deaf, so plan order is
# a priority order, not a taxonomy. The four one-shot queries are each unique and cost one command;
# the per-measurement ops cost 2×N and repeat a similar answer. Ordering the per-measurement ops first
# meant a run that completed 23 of 28 commands missed all four singles — the scarce information was
# spent on the plentiful kind.
SWEEP: dict[str, tuple[int, bool]] = {
    "GET_MEASUREMENT_STATUS": (OP_STATUS, False),
    "GET_SDK_MODE_STATUS": (OP_SDK_MODE_STATUS, False),
    "GET_OFFLINE_RECORDING_TRIGGER_STATUS": (OP_TRIGGER_STATUS, False),
    "GET_DERIVED_MEASUREMENT_SETTINGS": (OP_DERIVED_SETTINGS, False),
    "GET_MEASUREMENT_SETTINGS": (OP_GET_SETTINGS, True),
    "GET_SDK_MODE_MEASUREMENT_SETTINGS": (OP_GET_SDK_SETTINGS, True),
}
ALLOWED_OPS = frozenset(op for op, _ in SWEEP.values())

# The two that persist device state across a power cycle. Named explicitly so the refusal message can
# say WHY rather than "not allowed", and so grepping for the opcode lands on the reason.
PERSISTENT_WRITE_OPS = {
    0x08: "SET_OFFLINE_RECORDING_TRIGGER_MODE",
    0x09: "SET_OFFLINE_RECORDING_TRIGGER_SETTINGS",
}


def _check_allowed(cmd: bytes) -> bytes:
    """Gate every control-point write. Returns `cmd` so it can wrap a send in-line."""
    if not cmd:
        raise ValueError("empty control-point command")
    op = cmd[0]
    if op in PERSISTENT_WRITE_OPS:
        raise ValueError(
            f"refusing op {op:#04x} ({PERSISTENT_WRITE_OPS[op]}): it persists across power cycles — "
            "an armed trigger makes the device record by itself on every boot, eating the flash budget "
            "and removing the live stream. That is a design decision, not a sweep item.")
    if op not in ALLOWED_OPS:
        raise ValueError(f"refusing op {op:#04x}: not in this probe's read-only allowlist "
                         f"({sorted(ALLOWED_OPS)}) — an unknown opcode is assumed to write")
    return cmd


def sweep_cmd(op: int, meas: int | None = None, offline: bool = False) -> bytes:
    """Build one swept command. `offline=True` sets the recording bit on the measurement byte, which is
    how the device is asked about its OFFLINE menu rather than its live one — the two differ (the Verity
    offers ACC/GYRO at 13/26/52 Hz offline but only 52 Hz online)."""
    if meas is None:
        return _check_allowed(bytes([op]))
    return _check_allowed(bytes([op, meas | (pmd.OFFLINE_BIT if offline else 0)]))


def decode_settings(reply: bytes | None) -> dict:
    """Settings reply -> {'rate_hz': [...], ...}, naming the setting ids. Unknown ids keep their number
    rather than being dropped: a menu axis we cannot name is still evidence."""
    if not reply:
        return {}
    return {pmd.SETTING_NAME.get(sid, f"setting_{sid:#04x}"): vals
            for sid, vals in pmd.parse_settings_response(reply).items()}


def device_time(sensor_ns: int) -> _dt.datetime:
    """A PMD sample stamp -> the wall clock the DEVICE thinks it is. Naive: which clock this actually
    represents (UTC or local civil) is the very thing the clock experiment measures, so attaching a
    tzinfo here would be assuming the answer."""
    return POLAR_EPOCH + _dt.timedelta(microseconds=sensor_ns / 1000)


def clock_verdict(reported: _dt.datetime | None, stamped: _dt.datetime | None,
                  host_local: _dt.datetime, host_utc: _dt.datetime,
                  tol_s: float = 90.0) -> str:
    """Name which host clock the device's SAMPLE STAMPS agree with, and whether the clock it REPORTS
    agrees with the one it stamps.

    The tolerance is generous on purpose. This is not measuring skew — a wrong ANSWER here is a whole
    UTC offset (hours), and a tight bound would turn "the daemon last synced 20 minutes ago" into a
    false 'unknown'."""
    if stamped is None:
        return "no sample stamp — cannot say which clock the device stamps with"
    d_local, d_utc = abs((stamped - host_local).total_seconds()), abs((stamped - host_utc).total_seconds())
    if d_local <= tol_s and d_utc <= tol_s:
        which = "host is at UTC, so local and UTC are indistinguishable here"
    elif d_local <= tol_s:
        which = "device STAMPS LOCAL CIVIL time"
    elif d_utc <= tol_s:
        which = "device STAMPS UTC"
    else:
        which = (f"device stamps neither host clock (local {d_local:+.0f}s, UTC {d_utc:+.0f}s) — "
                 "unsynced device clock")
    if reported is None:
        return which
    split = abs((reported - stamped).total_seconds())
    if split > tol_s:
        which += (f" — and GET_LOCAL_TIME DISAGREES with the stamps by {split:.0f}s: the device answers "
                  "about one clock and stamps with another, so reading the clock back proves nothing")
    return which


class Control:
    """The PMD control point: write a command, await its indication, keep the raw bytes.

    Replies arrive as indications on the same characteristic we write, with no request id, so the only
    ordering the protocol gives us is arrival order — hence strictly one command in flight, and a drain
    of anything stale before each send (a leftover from a timed-out command would otherwise be returned
    as the NEXT command's answer, which is how a sweep silently attributes one op's reply to another)."""

    def __init__(self, client):
        self.client, self.q = client, asyncio.Queue()
        self.transcript, self.errors = [], []

    def _on_indication(self, _sender, data: bytearray):
        self.q.put_nowait(bytes(data))

    async def start(self):
        await self.client.start_notify(pmd.PMD_CONTROL, self._on_indication)

    async def send(self, cmd: bytes, timeout: float = 6.0) -> bytes | None:
        """One command, one reply, always a transcript line — including when the write itself is refused.

        A REFUSAL IS A MEASUREMENT, NOT AN ABORT. The Verity answers some control-point writes with a
        GATT-layer `UNLIKELY_ERROR (0x0E)` rather than a control-point ACK carrying an error status —
        `03 82` (stop with the recording bit) does it, and so did one of the settings queries here. That
        is precisely the kind of fact a command-surface sweep exists to record, so it is caught, written
        down, and the sweep continues. Letting it propagate cost a whole BLE window: the run died at
        reply 8 of 20 and the remaining ops went unasked."""
        _check_allowed(cmd)
        # Pace the control point. capture.py never fires queries back-to-back — it negotiates one stream,
        # starts it, then moves on — and this sweep is the first thing here to send thirty writes as fast
        # as the link will take them. The gap is cheap (about 8 s across a full sweep) next to the cost
        # of a window spent finding out that it mattered.
        await asyncio.sleep(0.25)
        while not self.q.empty():
            self.q.get_nowait()
        try:
            await self.client.write_gatt_char(pmd.PMD_CONTROL, cmd, response=True)
        except Exception as exc:                              # noqa: BLE001
            self.transcript.append({"sent": cmd.hex(), "reply": None,
                                    "refused": f"{type(exc).__name__}: {exc}"})
            self.errors.append(cmd.hex())
            return None
        try:
            reply = await asyncio.wait_for(self.q.get(), timeout)
        except asyncio.TimeoutError:
            reply = None
        self.transcript.append({"sent": cmd.hex(), "reply": reply.hex() if reply else None})
        return reply


async def _find(address: str, attempts: int = 3, timeout: float = 12.0):
    """Scan for the device, more than once. A single miss is the normal case on this box, not a verdict:
    an advertising interval and a scan window do not always intersect.

    Short window, several tries, rather than one long one — the clock leg needs six separate connects
    and a 20 s first-scan budget on each of them overran the whole run's timeout before it reached the
    interesting part."""
    for _ in range(attempts):
        dev = await BleakScanner.find_device_by_address(address, timeout=timeout)
        if dev is not None:
            return dev
    return None


@contextlib.asynccontextmanager
async def _client(dev, adapter: str | None, attempts: int = 3):
    """A CONNECTED client, or an exception — never the third thing.

    `async with BleakClient(...)` is not that guarantee. Measured on this box 2026-08-02: the context
    manager entered and the very next `start_notify` raised `BleakError("Not connected")`, i.e. the link
    went down between connect and first use and the `async with` said nothing. A probe that reports
    "Not connected" from a traceback three frames deep has spent its BLE window on a diagnostic worse
    than useless, so the link is verified here and retried, once per attempt."""
    last = "no attempt made"
    for _ in range(attempts):
        c = BleakClient(dev, bluez={"adapter": adapter} if adapter else {})
        try:
            await c.connect()
        except Exception as exc:                              # noqa: BLE001
            last = f"{type(exc).__name__}: {exc}"
            continue
        if c.is_connected:
            try:
                yield c
            finally:
                try:
                    await c.disconnect()
                except Exception:                             # noqa: BLE001 — teardown must not mask
                    pass
            return
        last = "connect() returned but the link was already down"
        try:
            await c.disconnect()
        except Exception:                                     # noqa: BLE001
            pass
    raise RuntimeError(f"could not hold a link to the device after {attempts} attempts ({last})")


async def _read_char(client, uuid: str) -> str | None:
    """A DIS/battery read that reports absence as absence. Every one of these is optional on a given
    firmware, and a missing characteristic must not abort a sweep that has 40 other things to collect."""
    try:
        raw = await client.read_gatt_char(uuid)
    except Exception as exc:                                  # noqa: BLE001 — any GATT error is "absent"
        return f"unavailable ({type(exc).__name__})"
    try:
        return bytes(raw).decode().strip("\x00").strip()
    except UnicodeDecodeError:
        return bytes(raw).hex()


async def read_identity(client) -> dict:
    out = {name: await _read_char(client, uuid) for name, uuid in DIS.items()}
    try:
        out["battery_pct"] = (await client.read_gatt_char(BATTERY))[0]
    except Exception as exc:                                  # noqa: BLE001
        out["battery_pct"] = f"unavailable ({type(exc).__name__})"
    return out


async def read_features(client) -> dict:
    """A plain GATT READ of the control point returns the supported-measurement bitmask. This is the
    device telling us which measurement types the rest of the sweep is even meaningful for."""
    try:
        raw = bytes(await client.read_gatt_char(pmd.PMD_CONTROL))
    except Exception as exc:                                  # noqa: BLE001
        return {"error": f"unavailable ({type(exc).__name__})"}
    feats = pmd.parse_features(raw)
    return {"raw": raw.hex(),
            "supported": sorted(pmd.MEAS_NAME.get(f, f"type_{f:#04x}") for f in feats),
            "supported_ids": sorted(feats)}


def plan_sweep(meas_types: list[int]) -> list[tuple[str, str, str, bytes]]:
    """The whole sweep as a flat, ordered list of `(op_name, measurement, mode, command)`.

    Flat and precomputed ON PURPOSE. The link to this device does not survive the whole sweep — measured
    across four windows, it accepts somewhere between four and nine control-point writes and then
    refuses every one after that at the ATT layer. A sweep written as nested loops has its position
    encoded in the Python stack, so a dropped link can only be handled by starting over; as a list with
    an index, it can be RESUMED on a fresh link at the exact command that failed. Per-measurement ops
    are asked ONLINE and OFFLINE because those are different menus (ACC offers 52 Hz online and
    13/26/52 Hz offline), and reading only the online one is how a nightly recording gets designed
    around a sample rate the device will not offer for recording."""
    plan: list[tuple[str, str, str, bytes]] = []
    for name, (op, per_meas) in SWEEP.items():
        if not per_meas:
            plan.append((name, "", "", sweep_cmd(op)))
            continue
        for meas in meas_types:
            label = pmd.MEAS_NAME.get(meas, f"{meas:#04x}")
            for mode, offline in (("online", False), ("offline", True)):
                plan.append((name, label, mode, sweep_cmd(op, meas, offline=offline)))
    return plan


def fold_replies(rows: list[tuple[str, str, str, bytes | None]]) -> dict:
    """Executed plan -> the nested report. Kept separate from execution so the shape of the output owes
    nothing to how many links it took to collect it."""
    out: dict = {}
    for name, label, mode, reply in rows:
        if not label:
            entry = {"raw": reply.hex() if reply else None}
            if name == "GET_MEASUREMENT_STATUS" and reply:
                entry["active"] = {pmd.MEAS_NAME[m]: pmd.ACTIVE_NAME.get(st, st)
                                   for m, st in sorted(pmd.parse_status_response(reply).items())}
            out[name] = entry
            continue
        out.setdefault(name, {}).setdefault(label, {})[mode] = {
            "raw": reply.hex() if reply else None, "settings": decode_settings(reply)}
    return out


async def execute_plan(address: str, adapter: str | None, plan: list, out: dict,
                       max_links: int = 6) -> list:
    """Drive the plan, taking a fresh link whenever the device stops accepting writes.

    The refusal is the signal to reconnect: once the Verity answers one control-point write with a
    GATT-layer error, every subsequent write on that link gets the same answer, so continuing on it
    collects nothing but identical error strings. `out` is updated as we go, so a run killed by an
    outer timeout still hands over everything collected up to that moment."""
    rows: list = []
    transcript: list = []
    refused: list = []
    i = 0
    for link in range(max_links):
        if i >= len(plan):
            break
        dev = await _find(address)
        if dev is None:
            out["sweep_note"] = f"device stopped advertising after {i}/{len(plan)} commands"
            break
        async with _client(dev, adapter) as client:
            cp = Control(client)
            await cp.start()
            while i < len(plan):
                name, label, mode, cmd = plan[i]
                before = len(cp.errors)
                reply = await cp.send(cmd)
                if len(cp.errors) > before:
                    break                                  # link has gone deaf — take a new one
                rows.append((name, label, mode, reply))
                i += 1
            transcript += cp.transcript
            refused += cp.errors
            out.update({"transcript": transcript, "gatt_refused": refused,
                        "links_used": link + 1, "commands_completed": f"{i}/{len(plan)}",
                        "control_point": fold_replies(rows)})
    # Identity LAST, on its OWN link. It is the least important thing here and the most destructive to
    # ask for: reading the Device Information Service is what dropped the link in the very first run.
    # Isolating it means a firmware string can never again cost a control-point answer, and gating it on
    # plan completion (the previous arrangement) meant the one run that needed a firmware revision most
    # — a partial one — was the run that never recorded it.
    dev = await _find(address)
    if dev is not None:
        try:
            async with _client(dev, adapter) as client:
                out["identity"] = await read_identity(client)
        except Exception as exc:                              # noqa: BLE001
            out["identity"] = {"error": f"{type(exc).__name__}: {exc}"}
    return rows


async def sample_stamp(address: str, adapter: str | None, meas: int = pmd.ACC,
                       timeout: float = 10.0) -> _dt.datetime | None:
    """Start ONE live stream, take the first frame's device stamp, stop. This is the half of the clock
    experiment that cannot be faked by asking the device what time it thinks it is.

    Its own connection, because PS-FTP and PMD cannot share one: a Polar accepts a single BLE link and
    `PolarPsFtp` owns its client (capture.py serialises the same way — it pauses live capture for the
    duration of a clock sync rather than trying to multiplex)."""
    got: asyncio.Queue = asyncio.Queue()

    def on_data(_s, data: bytearray):
        if got.empty():
            got.put_nowait(bytes(data))

    dev = await _find(address)
    if dev is None:
        return None
    async with _client(dev, adapter) as client:
        cp = Control(client)
        await cp.start()
        settings = pmd.parse_settings_response(await cp.send(sweep_cmd(OP_GET_SETTINGS, meas)) or b"")
        start = pmd.build_start(meas, settings) or pmd.START.get(meas)
        if start is None:
            return None
        await client.start_notify(pmd.PMD_DATA, on_data)
        try:
            # STOP first: PMD stream state survives a BleakClient reconnect, so a stale stream from an
            # earlier session answers 'already_streaming' and we would wait for data that never comes.
            await client.write_gatt_char(pmd.PMD_CONTROL, pmd.stop_cmd(meas), response=True)
            await client.write_gatt_char(pmd.PMD_CONTROL, start, response=True)
            try:
                frame = await asyncio.wait_for(got.get(), timeout)
            except asyncio.TimeoutError:
                return None
            _m, samples = pmd.decode_frame(frame, _dt.datetime.now())
            return device_time(samples[-1].sensor_ns) if samples else None
        finally:
            await client.write_gatt_char(pmd.PMD_CONTROL, pmd.stop_cmd(meas), response=True)
            await client.stop_notify(pmd.PMD_DATA)


async def _get_local_time(address: str, adapter: str | None):
    async with psftp.PolarPsFtp(address, adapter=adapter) as fs:
        return await fs.get_local_time()


async def _set_local_time(address: str, adapter: str | None, when=None, tz_offset_min=None):
    async with psftp.PolarPsFtp(address, adapter=adapter) as fs:
        await fs.set_local_time(when, tz_offset_min=tz_offset_min)


async def clock_experiment(address: str, adapter: str | None, meas: int = pmd.ACC) -> dict:
    """Is the device clock settable to LOCAL CIVIL time, or is it immovably UTC?

    Answered by measuring BOTH clocks the device exposes — the one it answers about (PS-FTP
    GET_LOCAL_TIME) and the one it stamps samples with (PMD `sensor_ns`) — before and after a write,
    then RESTORING the daemon's UTC convention whatever happens. See the header for why the restore is
    the important part, and why reading the clock back on its own proves nothing.

    Each step takes its own BLE link: the device grants one at a time and PS-FTP and PMD are different
    clients. That makes this slow (six connects) and is not negotiable."""
    out: dict = {}

    async def observe(label: str):
        reported = await _get_local_time(address, adapter)
        stamped = await sample_stamp(address, adapter, meas)
        now_local, now_utc = _dt.datetime.now(), _dt.datetime.now(_dt.timezone.utc).replace(tzinfo=None)
        out[label] = {
            "device_reports": reported.isoformat() if reported else None,
            "device_stamps": stamped.isoformat() if stamped else None,
            "host_local": now_local.isoformat(), "host_utc": now_utc.isoformat(),
            "verdict": clock_verdict(reported, stamped, now_local, now_utc),
        }

    await observe("before")
    now_local = _dt.datetime.now()
    # The TRUE offset, not zero — that is the whole experiment. capture.py deliberately sends a UTC
    # datetime with tz_offset=0; here we send local civil with its real offset and see what moves.
    tz = now_local.astimezone().utcoffset()
    offset_min = int(tz.total_seconds() // 60) if tz else 0
    out["wrote"] = {"local_civil": now_local.isoformat(), "tz_offset_min": offset_min}
    try:
        await _set_local_time(address, adapter, now_local, offset_min)
        out["set_local_time_ack"] = "accepted"
    except Exception as exc:                                  # noqa: BLE001
        out["set_local_time_ack"] = f"REFUSED: {type(exc).__name__}: {exc}"
    try:
        await observe("after")
        out["conclusion"] = _clock_conclusion(out)
    finally:
        # ALWAYS put the device back on the daemon's convention. A probe that leaves the armband on
        # local civil shifts every subsequent device stamp by the UTC offset, and a 4 h error in a
        # sleep file is plausible enough to survive review.
        try:
            await _set_local_time(address, adapter)            # defaults: UTC now, tz_offset 0
            out["restored"] = "device returned to the daemon's UTC convention"
        except Exception as exc:                              # noqa: BLE001
            out["restored"] = (f"RESTORE FAILED ({type(exc).__name__}: {exc}) — the device may be on "
                               "local civil time; re-run the daemon's clock sync before capturing")
    return out


def _clock_conclusion(obs: dict) -> str:
    """Turn the before/after pair into the sentence the brief needs."""
    if str(obs.get("set_local_time_ack", "")).startswith("REFUSED"):
        return "SET_LOCAL_TIME is REFUSED by the device — the clock is not settable over this path"
    before, after = obs.get("before", {}), obs.get("after", {})
    if not after.get("device_stamps"):
        return ("SET_LOCAL_TIME was accepted, but no sample stamp came back afterwards — inconclusive "
                "about the stamping clock")
    moved = before.get("device_stamps") and after["device_stamps"][:16] != before["device_stamps"][:16]
    if after.get("device_reports") and "DISAGREES" in after["verdict"]:
        return ("SET_LOCAL_TIME is ACCEPTED and GET_LOCAL_TIME echoes it, but the PMD SAMPLE clock does "
                "not follow — the device answers about a clock it does not stamp with. Reading the "
                "clock back is not evidence; only a sample stamp is.")
    if moved:
        return "SET_LOCAL_TIME is accepted AND the sample clock followed it — device time is settable"
    return f"SET_LOCAL_TIME accepted; sample clock unchanged. {after['verdict']}"


# Whatever the current run has collected. Module-level so an exception on the way out still has
# somewhere to leave the evidence — see main().
PARTIAL: dict = {}


async def run(address: str, adapter: str | None, do_clock: bool, extra_types: bool = False,
              do_sweep: bool = True) -> dict:
    out: dict = PARTIAL
    out.clear()
    out.update({"address": address, "probed_at": _dt.datetime.now().isoformat(),
                "not_sent": {f"{op:#04x}": f"{name} — persists across power cycles"
                             for op, name in sorted(PERSISTENT_WRITE_OPS.items())}})
    if do_sweep:
        try:
            await _sweep_phase(address, adapter, out, extra_types)
        except Exception as exc:                              # noqa: BLE001
            # The clock leg is a SEPARATE experiment on SEPARATE links. A sweep that lost the device
            # must not cancel it — that is two questions abandoned for the price of one.
            out["sweep_error"] = f"{type(exc).__name__}: {exc}"
    if do_clock:
        try:
            out["clock_experiment"] = await clock_experiment(address, adapter)
        except Exception as exc:                              # noqa: BLE001
            out["clock_experiment"] = {"error": f"{type(exc).__name__}: {exc}"}
    return out


async def _sweep_phase(address: str, adapter: str | None, out: dict, extra_types: bool) -> None:
    """Decide WHAT to ask, then hand it to execute_plan, which decides how many links that takes."""
    # One short link purely to learn which measurement types exist. Kept separate from the sweep because
    # the feature bitmask is what the sweep is built FROM, and a device that drops the link mid-sweep
    # should not cost us the plan as well.
    # Retried, because the plan is BUILT from this answer. A single failed feature read does not merely
    # lose one line of the report — it silently demotes the sweep to the fallback type list, which is
    # exactly the list that cannot contain a type we do not already know about. Measured: one run lost
    # this read and reported an EMPTY flag set on a device that advertises three.
    for _ in range(3):
        dev = await _find(address)
        if dev is None:
            out["error"] = "device not found — is it advertising, and is the daemon stopped?"
            return
        async with _client(dev, adapter) as client:
            out["features"] = await read_features(client)
        if out["features"].get("supported_ids"):
            break
    supported = [m for m in out["features"].get("supported_ids", []) if m in pmd.MEAS_NAME]
    if not supported:
        # The feature read is a convenience, not the sweep's premise. If it fails, ask about every type
        # this module knows: a device answers `not_supported` cheaply, and an empty sweep because one
        # optional GATT read failed is a wasted window.
        supported = sorted(pmd.MEAS_NAME)
        out["features"]["note"] = "feature bitmask unavailable — swept every known measurement type"
    # THE BITMASK MIXES MEASUREMENTS AND MODES. Polar publishes five measurement types for a Verity
    # Sense and this device sets eight bits, because three of them are capability FLAGS —
    # 0x09 SDK_MODE, 0x0D OFFLINE_RECORDING, 0x0E OFFLINE_HR (webmon.py:606, and gate-locked by
    # tests/test_webmon_settings_contract.py::test_capability_flags_are_not_offered_as_streams).
    # Reported always, QUERIED only on request: a settings read against a flag is harmless and is in
    # fact how you tell a flag from a stream (a mode answers `invalid_meas`; OFFLINE_HR, which names a
    # real recordable data type, answers `ok` with an empty menu) — but it is still a query about
    # firmware behaviour nobody here specified, so it stays behind --include-flag-bits.
    unknown = [m for m in out["features"].get("supported_ids", []) if m not in pmd.MEAS_NAME]
    out["flag_bits"] = {f"{m:#04x}": FLAG_NAME.get(m, "unrecognised") for m in unknown}
    if extra_types:
        supported = supported + unknown
    out["measurement_types_swept"] = [pmd.MEAS_NAME.get(m, f"{m:#04x}") for m in supported]
    await execute_plan(address, adapter, plan_sweep(supported), out)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Sweep the documented Polar PMD command surface (read-only)")
    ap.add_argument("--address", required=True)
    ap.add_argument("--adapter", default=None)
    ap.add_argument("--clock-experiment", action="store_true",
                    help="WRITES the device clock (and restores it) to settle whether local time sticks")
    ap.add_argument("--include-flag-bits", action="store_true",
                    help="also ask the documented READ ops about the bitmask's MODE bits "
                         "(0x09 SDK_MODE, 0x0D OFFLINE_RECORDING, 0x0E OFFLINE_HR) — harmless, and it "
                         "is how you tell a flag from a stream")
    ap.add_argument("--clock-only", action="store_true",
                    help="skip the sweep and run ONLY the clock experiment. The two share a BLE window "
                         "but not a budget: the sweep needs several links and the clock leg needs six "
                         "more, and running them in one invocation spent the whole timeout on the "
                         "sweep and never reached the clock — three windows in a row.")
    ap.add_argument("--json", dest="json_path", default=None, help="also write the full record here")
    a = ap.parse_args(argv)
    # A CRASH MUST STILL YIELD ITS TRANSCRIPT. Getting the link at all costs a daemon stop, so a run
    # that dies at reply 30 of 40 must hand over the 29 replies it did collect — the first attempt at
    # this printed a traceback and nothing else, which threw the whole window away.
    try:
        res = asyncio.run(run(a.address, a.adapter, a.clock_experiment or a.clock_only,
                              a.include_flag_bits, do_sweep=not a.clock_only))
    except Exception as exc:                                  # noqa: BLE001
        res = {"error": f"{type(exc).__name__}: {exc}", "partial": PARTIAL}
    text = json.dumps(res, indent=2, default=str)
    if a.json_path:
        with open(a.json_path, "w") as fh:
            fh.write(text + "\n")
    print(text)
    # A PARTIAL RUN IS A FAILED RUN. `sweep_error` used to leave the exit status at 0, so a sweep that
    # collected nothing at all reported success to the shell that ran it — the one signal an operator
    # actually reads.
    return 1 if (res.get("error") or res.get("sweep_error")) else 0


if __name__ == "__main__":
    raise SystemExit(main())
