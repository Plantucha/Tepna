# tepna-capture — polar_psftp.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Polar PS-FTP (RFC60 + RFC76) client — list and DOWNLOAD the onboard offline recordings a Polar
# device (Verity Sense / H10) stores in its own flash when you press the button to record without a
# phone. This is the Polar sibling of pull_session.py (which does the same for the Wellue O2Ring over
# the OxyII protocol): the device's own backstop record, pulled straight off flash over BLE.
#
# Protocol is verbatim from the official Polar BLE SDK (BlePsFtpUtils.kt / pftp_request.proto):
#   * All request+response traffic rides ONE characteristic — the PFTP MTU char FB005C51 (write the
#     framed request, reassemble the response from its notifications). FB005C52/53 are unused here.
#   * A request is wrapped twice: an RFC60 2-byte little-endian length prefix over the protobuf, then
#     RFC76 air-packets (1-byte header: bit0=next, bits1-2=status MORE/LAST, bits4-7=seq 0..15).
#   * GET on a directory path -> response payload is a serialized PbPFtpDirectory; GET on a file path
#     -> the raw file bytes. Only GET (read-only) is used — this module never writes/deletes on-device.
#
#   IMPORTANT: a Polar device holds ONE BLE link. STOP the live capture daemon (or use the monitor's
#   pull button, which pauses capture) before pulling, or the connect will fail. The link must be
#   BONDED first (bonding.ensure_bonded) — Polar gates PS-FTP behind an encrypted link.
#
#   CLI:  python polar_psftp.py --address 24:AC:AC:0C:30:1E list
#         python polar_psftp.py --address 24:AC:AC:0C:30:1E pull --session /U/0/20260716/E/170114/ \
#                               --out /srv/tepna/captures/incoming/verity-offline
from __future__ import annotations
import argparse, asyncio, json, os
from bleak import BleakClient, BleakScanner


async def _bt_disconnect(address: str):
    """Best-effort: drop any BlueZ-held link before we connect. A bonded+trusted Polar device is
    auto-reconnected by BlueZ, which then fights bleak for the device's single BLE slot and surfaces
    as 'failed to discover services, device disconnected'. Clearing it first lets bleak own the link."""
    try:
        p = await asyncio.create_subprocess_exec(
            "bluetoothctl", "disconnect", address,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
        await asyncio.wait_for(p.wait(), timeout=6.0)
        await asyncio.sleep(2.0)   # let the controller settle before re-connecting
    except Exception:
        pass

MTU_CHAR = "fb005c51-02e7-f387-1cad-8acd2d8df0c8"   # RFC77_PFTP_MTU_CHARACTERISTIC
GET = 0                                             # PbPFtpOperation.Command.GET
USER_ROOT = "/U/0/"

# ── minimal protobuf (proto2, hand-rolled — no runtime dep) ──
def _uvarint(n: int) -> bytes:
    out = bytearray()
    while True:
        b = n & 0x7F; n >>= 7
        out.append(b | (0x80 if n else 0))
        if not n:
            return bytes(out)

def _encode_operation(command: int, path: str) -> bytes:
    p = path.encode("utf-8")
    return bytes([0x08, command]) + b"\x12" + _uvarint(len(p)) + p   # field1 command, field2 path

def _read_varint(buf, i):
    shift = val = 0
    while True:
        b = buf[i]; i += 1
        val |= (b & 0x7F) << shift
        if not (b & 0x80):
            return val, i
        shift += 7

def _iter_fields(buf):
    i, n = 0, len(buf)
    while i < n:
        tag, i = _read_varint(buf, i)
        fn, wt = tag >> 3, tag & 7
        if wt == 0:
            v, i = _read_varint(buf, i); yield fn, v
        elif wt == 2:
            ln, i = _read_varint(buf, i); yield fn, buf[i:i + ln]; i += ln
        elif wt == 5:
            yield fn, buf[i:i + 4]; i += 4
        elif wt == 1:
            yield fn, buf[i:i + 8]; i += 8
        else:
            raise ValueError(f"bad protobuf wire type {wt}")

def _parse_pb_fields(buf) -> dict:
    """{field_number: value} for a flat protobuf message — last occurrence wins. Used for the small
    PbDate / PbTime / GET_LOCAL_TIME replies; _parse_directory handles the repeated-entry case."""
    return {fn: val for fn, val in _iter_fields(buf)}


def _parse_directory(buf) -> list[tuple[str, int]]:
    """PbPFtpDirectory { repeated PbPFtpEntry entries=1 } ; PbPFtpEntry { name=1, size=2 }."""
    entries = []
    for fn, val in _iter_fields(buf):
        if fn == 1 and isinstance(val, (bytes, bytearray)):
            name, size = None, 0
            for efn, ev in _iter_fields(val):
                if efn == 1 and isinstance(ev, (bytes, bytearray)):
                    name = ev.decode("utf-8", "replace")
                elif efn == 2 and isinstance(ev, int):
                    size = ev
            if name is not None:
                entries.append((name, size))
    return entries

# ── RFC76 framing ──
class _Seq:
    __slots__ = ("seq",)
    def __init__(self): self.seq = 0
    def inc(self): self.seq = self.seq + 1 if self.seq < 0x0F else 0

# ── PS-FTP QUERY (as opposed to a file REQUEST) ─────────────────────────────────────────────────────
# RFC60's 2-byte header carries the LENGTH for a request, but the QUERY ID for a query, with the top bit
# of byte 1 set to mark it (BlePsFtpUtility.makeCompleteMessageStream). Everything after that — the RFC76
# air-packet chunking — is identical, so both share _chunk_rfc76 below.
#
# SAFETY: the PbPFtpQuery enum also contains PREPARE_FIRMWARE_UPDATE (12), REQUEST_START_RECORDING (14)
# and friends. A wrong id here would do something far worse than set a clock, and this module is
# otherwise strictly read-only — so query sending is restricted to the three TIME ids by allowlist.
SET_SYSTEM_TIME, SET_LOCAL_TIME, GET_LOCAL_TIME = 1, 3, 4
_ALLOWED_QUERIES = frozenset({SET_SYSTEM_TIME, SET_LOCAL_TIME, GET_LOCAL_TIME})


def _encode_query_header(query_id: int, params: bytes = b"") -> bytes:
    if query_id not in _ALLOWED_QUERIES:
        raise ValueError(f"refusing PS-FTP query id {query_id}: not a time query (allowlist "
                         f"{sorted(_ALLOWED_QUERIES)}) — this module must not trigger firmware "
                         f"update / recording / sync operations")
    return bytes([query_id & 0xFF, ((query_id >> 8) & 0x7F) | 0x80]) + params   # top bit 1 = QUERY


# ── minimal proto2 encoders (same hand-rolled approach as _encode_operation) ────────────────────────
def _pb_uint(field: int, value: int) -> bytes:
    return bytes([(field << 3) | 0]) + _uvarint(value)


def _pb_int32(field: int, value: int) -> bytes:
    # proto2 `int32` is a PLAIN varint (not zigzag); negatives are sign-extended to 64 bits.
    return bytes([(field << 3) | 0]) + _uvarint(value & 0xFFFFFFFFFFFFFFFF if value < 0 else value)


def _pb_msg(field: int, payload: bytes) -> bytes:
    return bytes([(field << 3) | 2]) + _uvarint(len(payload)) + payload


def _pb_date(y: int, mo: int, d: int) -> bytes:            # PbDate{year=1, month=2, day=3}
    return _pb_uint(1, y) + _pb_uint(2, mo) + _pb_uint(3, d)


def _pb_time(h: int, mi: int, s: int, ms: int = 0) -> bytes:   # PbTime{hour,minute,seconds,millis}
    return _pb_uint(1, h) + _pb_uint(2, mi) + _pb_uint(3, s) + _pb_uint(4, ms)


def encode_set_local_time(dt, tz_offset_min: int) -> bytes:
    """PbPFtpSetLocalTimeParams{date=1, time=2, tz_offset=3 (minutes)} — `dt` is LOCAL civil time."""
    return (_pb_msg(1, _pb_date(dt.year, dt.month, dt.day))
            + _pb_msg(2, _pb_time(dt.hour, dt.minute, dt.second, dt.microsecond // 1000))
            + _pb_int32(3, tz_offset_min))


def encode_set_system_time(dt_local) -> bytes:
    """PbPFtpSetSystemTimeParams{date=1, time=2, trusted=3}; trusted=True (host is NTP-disciplined).
    NOTE: callers pass LOCAL CIVIL time here on purpose — see set_local_time for why (Clock Contract)."""
    return (_pb_msg(1, _pb_date(dt_local.year, dt_local.month, dt_local.day))
            + _pb_msg(2, _pb_time(dt_local.hour, dt_local.minute, dt_local.second, dt_local.microsecond // 1000))
            + _pb_uint(3, 1))


def _chunk_rfc76(stream: bytes, frame_mtu: int) -> list[bytes]:
    packets, seq, nxt, i, n = [], _Seq(), 0, 0, len(stream)
    while True:
        remaining = n - i
        if remaining > (frame_mtu - 1):
            status, take = 0x06, frame_mtu - 1          # MORE
        else:
            status, take = 0x02, remaining              # LAST
        packets.append(bytes([nxt | status | (seq.seq << 4)]) + stream[i:i + take])
        seq.inc(); i += take; nxt = 1
        if status == 0x02:
            return packets


def _build_request_packets(protobuf: bytes, frame_mtu: int) -> list[bytes]:
    hs = len(protobuf)
    return _chunk_rfc76(bytes([hs & 0xFF, (hs >> 8) & 0x7F]) + protobuf, frame_mtu)  # top bit 0 = REQUEST


def _build_query_packets(query_id: int, params: bytes, frame_mtu: int) -> list[bytes]:
    return _chunk_rfc76(_encode_query_header(query_id, params), frame_mtu)


class PolarPsFtp:
    """Bonded PS-FTP session over bleak. `async with PolarPsFtp(address) as fs: await fs.list_dir(...)`."""
    def __init__(self, address: str, adapter: str | None = None):
        self.address = address
        self._kw = {"adapter": adapter} if adapter else {}
        self._client: BleakClient | None = None
        self._q: asyncio.Queue = asyncio.Queue()
        self._frame_mtu = 20

    async def __aenter__(self):
        await _bt_disconnect(self.address)
        # A bonded+trusted Polar device that isn't advertising a fresh packet right now (idle on the
        # nightstand, or oscillating in BlueZ's auto-reconnect) is missed by find_device_by_address, which
        # needs to catch a live advertisement. But BlueZ already KNOWS the bonded device by path, so a
        # direct BleakClient(address).connect() resolves it without a fresh advert — the same way the
        # capture daemon connects. Prefer the scan (returns a rich device object), fall back to the address.
        dev = await BleakScanner.find_device_by_address(self.address, timeout=15.0, **self._kw)
        if not dev:
            dev = self.address
        self._client = BleakClient(dev, timeout=25.0, **self._kw)
        try:
            await self._client.connect()
            try:
                if hasattr(self._client, "_acquire_mtu"):
                    await self._client._acquire_mtu()
            except Exception:
                pass
            self._frame_mtu = max(20, (getattr(self._client, "mtu_size", 23) or 23) - 3)
            await self._client.start_notify(MTU_CHAR, lambda _s, d: self._q.put_nowait(bytes(d)))
        except Exception:
            # never leak a half-open link — a lingering connection blocks the device's single BLE slot
            try: await self._client.disconnect()
            except Exception: pass
            raise
        return self

    async def __aexit__(self, *exc):
        if self._client:
            try: await self._client.stop_notify(MTU_CHAR)
            except Exception: pass
            try: await self._client.disconnect()
            except Exception: pass

    async def _read_response(self, timeout: float) -> bytes:
        seq, out, expect_next = _Seq(), bytearray(), 0
        while True:
            pkt = await asyncio.wait_for(self._q.get(), timeout=timeout)
            b0 = pkt[0]
            status = (b0 >> 1) & 0x03
            sq = (b0 >> 4) & 0x0F
            if sq != seq.seq:
                raise RuntimeError(f"air packet lost (expected seq {seq.seq}, got {sq})")
            seq.inc()
            if expect_next != (b0 & 0x01):
                raise RuntimeError("PS-FTP stream out of sync")
            expect_next = 1
            if status == 0x00:                              # ERROR_OR_RESPONSE
                err = (pkt[1] | (pkt[2] << 8)) if len(pkt) >= 3 else 0
                if err == 0:
                    return bytes(out)
                raise RuntimeError(f"PS-FTP error {err}")
            out += pkt[1:]
            if status == 0x01:                              # LAST
                return bytes(out)
            # MORE -> continue

    async def get(self, path: str, timeout: float = 60.0) -> bytes:
        for pkt in _build_request_packets(_encode_operation(GET, path), self._frame_mtu):
            await self._client.write_gatt_char(MTU_CHAR, pkt, response=False)
        return await self._read_response(timeout)

    async def list_dir(self, path: str) -> list[tuple[str, int]]:
        return _parse_directory(await self.get(path))

    async def query(self, query_id: int, params: bytes = b"", timeout: float = 20.0) -> bytes:
        """Send a PS-FTP QUERY. Restricted to the time ids (see _ALLOWED_QUERIES) — this is the ONLY
        write this module performs; everything else is strictly read-only."""
        for pkt in _build_query_packets(query_id, params, self._frame_mtu):
            await self._client.write_gatt_char(MTU_CHAR, pkt, response=False)
        return await self._read_response(timeout)

    async def set_local_time(self, when=None, tz_offset_min: int | None = None,
                             with_system_time: bool = True) -> None:
        """Set the device clock. Polar stamps EVERY sample with device time (ns since 2000-01-01), and an
        unset device runs from a firmware default — an H10 resets to 2019-01-01 whenever it leaves the
        strap. Setting it from the NTP-disciplined host makes `sensor timestamp [ns]` a real wall clock
        and puts sibling devices on a COMMON origin, which is what cross-device timing (PAT) needs.
        LOCAL civil time per the Clock Contract; SET_SYSTEM_TIME additionally takes UTC."""
        import datetime as _dt
        when = when or _dt.datetime.utcnow()   # UTC — see the note below
        # WE SET DEVICE CLOCKS IN UTC, deliberately, and it is not the same decision as the Clock
        # Contract's floating local-civil wall clock (which still governs the file's `Phone timestamp`
        # column and every Dex node — that convention is frozen).
        # Reason: the Verity's PMD SAMPLE clock is immovably UTC. Setting local time, setting system
        # time with local civil, and tz_offset=0 were each tried on hardware 2026-07-18 and none moved
        # it — GET_LOCAL_TIME reported the local time we set while samples kept arriving +4 h. Since one
        # device cannot be moved off UTC, the only way to put SIBLING devices on a COMMON timebase — the
        # precondition PAT needs — is to set the settable ones (H10) to UTC as well. Device stamps are
        # used for relative/inter-sample timing, so this changes nothing downstream except that
        # cross-device alignment becomes exact instead of needing a per-device offset table.
        if tz_offset_min is None:
            # tz_offset = 0 ON PURPOSE. The device derives its SYSTEM (UTC) clock from local+tz_offset,
            # and PMD stamps every sample with the SYSTEM clock — so sending the true offset (-240) made
            # the Verity stamp 4 h ahead of the H10 (which has no system clock and stamps local),
            # measured 2026-07-18. Declaring tz_offset=0 makes device time == local civil == what stamps
            # the samples, which is exactly the Clock Contract's floating wall-clock: local civil time
            # encoded as if it were UTC (CLAUDE.md §1). One timebase across every sensor.
            tz_offset_min = 0          # device time IS UTC, so the declared offset is zero
        # Device families differ (PolarBleApiImpl.setLocalTime switches on fileSystemType):
        #   h10FileSystem   -> SET_LOCAL_TIME only; SET_SYSTEM_TIME answers NOT_IMPLEMENTED (error 201)
        #   polarFileSystemV2 (Verity Sense / OH1) -> both
        await self.query(SET_LOCAL_TIME, encode_set_local_time(when, tz_offset_min))
        if with_system_time:
            await self.query(SET_SYSTEM_TIME, encode_set_system_time(when))

    async def get_local_time(self):
        """Read the device clock back → datetime (local civil, as the device holds it), or None."""
        import datetime as _dt
        raw = await self.query(GET_LOCAL_TIME)
        f = _parse_pb_fields(raw)
        d, t = f.get(1), f.get(2)
        if not (isinstance(d, bytes) and isinstance(t, bytes)):
            return None
        dd, tt = _parse_pb_fields(d), _parse_pb_fields(t)
        try:
            return _dt.datetime(dd[1], dd[2], dd[3], tt.get(1, 0), tt.get(2, 0), tt.get(3, 0),
                                (tt.get(4, 0) or 0) * 1000)
        except (KeyError, TypeError, ValueError):
            return None

    async def walk(self, path: str = USER_ROOT, maxdepth: int = 6, _depth: int = 0):
        """Yield (full_path, size, is_dir) for everything under `path`."""
        try:
            entries = await self.list_dir(path)
        except Exception:
            yield (path, -1, False); return
        for name, size in entries:
            full = path + name
            is_dir = name.endswith("/")
            yield (full, size, is_dir)
            if is_dir and _depth < maxdepth:
                async for row in self.walk(full, maxdepth, _depth + 1):
                    yield row

    @property
    def mtu(self): return getattr(self._client, "mtu_size", None)


async def _with_retry(coro_factory, attempts: int = 3, backoff: float = 2.0):
    """Retry a PS-FTP op on transient BLE faults (BlueZ 'device disconnected' mid-discovery is common)."""
    last = None
    for i in range(attempts):
        try:
            return await coro_factory()
        except Exception as e:
            last = e
            if i < attempts - 1:
                await asyncio.sleep(backoff)
    raise last


def _session_meta(path: str) -> dict:
    """Derive {kind,date,time,start_local} from a recording path /U/0/YYYYMMDD/{E|R}/HHMMSS/."""
    parts = [p for p in path.split("/") if p]        # ['U','0','YYYYMMDD','E','HHMMSS']
    date = time = None
    for p in parts:
        if len(p) == 8 and p.isdigit(): date = p
        elif len(p) == 6 and p.isdigit(): time = p
    kind = "exercise" if "/E/" in path else ("offline" if "/R/" in path else "other")
    start_local = None
    if date and time:
        start_local = f"{date[:4]}-{date[4:6]}-{date[6:]}T{time[:2]}:{time[2:4]}:{time[4:]}"
    return {"kind": kind, "date": date, "time": time, "start_local": start_local}


async def list_recordings(address: str, adapter: str | None = None) -> list[dict]:
    """Enumerate real recordings on the device: exercise sessions (/U/0/DATE/E/TIME/) and offline
    recordings (/U/0/DATE/R/TIME/). Returns one dict per session with its files + total bytes."""
    async def _once():
        async with PolarPsFtp(address, adapter) as fs:
            return [r async for r in fs.walk(USER_ROOT)]
    rows = await _with_retry(_once)
    # a session dir = a time-folder (6 digits) directly under an E/ or R/ segment
    sessions: dict[str, dict] = {}
    for full, size, is_dir in rows:
        segs = [s for s in full.split("/") if s]
        # find a 6-digit time segment whose parent is E or R
        for idx in range(len(segs)):
            if len(segs[idx]) == 6 and segs[idx].isdigit() and idx >= 1 and segs[idx - 1] in ("E", "R"):
                sess = "/" + "/".join(segs[: idx + 1]) + "/"
                sessions.setdefault(sess, {"path": sess, **_session_meta(sess), "files": [], "total_bytes": 0})
                if not is_dir and size >= 0:
                    sessions[sess]["files"].append({"name": full[len(sess):], "path": full, "size": size})
                    sessions[sess]["total_bytes"] += size
                break
    out = sorted(sessions.values(), key=lambda s: (s.get("date") or "", s.get("time") or ""))
    return out


async def pull_recording(address: str, session: str, out_dir: str, adapter: str | None = None,
                         on_progress=None) -> dict:
    """Download every file under `session` (a /U/0/DATE/{E|R}/TIME/ dir) into out_dir, mirroring the
    on-device tree. Returns a manifest {session, files:[...], total_bytes, out_dir}."""
    if not session.endswith("/"):
        session += "/"
    os.makedirs(out_dir, exist_ok=True)
    manifest = {"session": session, "out_dir": out_dir, "files": [], "total_bytes": 0}
    async def _once():
        m = {"files": [], "total_bytes": 0}
        async with PolarPsFtp(address, adapter) as fs:
            files = [(f, s) async for f, s, is_dir in fs.walk(session) if not is_dir and s >= 0]
            total = sum(sz for _, sz in files) or 1     # PS-FTP has no per-chunk hook, so report
            done = 0                                    # per-FILE completion — coarse but honest
            for full, size in files:
                rel = full[len(session):]
                dst = os.path.join(out_dir, rel)
                os.makedirs(os.path.dirname(dst) or out_dir, exist_ok=True)
                data = await fs.get(full, timeout=180.0)
                with open(dst, "wb") as fh:
                    fh.write(data)
                m["files"].append({"name": rel, "bytes": len(data), "declared": size,
                                   "ok": len(data) == size, "dst": dst})
                m["total_bytes"] += len(data)
                done += len(data)
                if on_progress:
                    try:
                        on_progress(done, total)
                    except Exception:
                        pass                            # a UI hook must never break the transfer
        return m
    got = await _with_retry(_once)
    manifest["files"] = got["files"]
    manifest["total_bytes"] = got["total_bytes"]
    # a small sidecar so the pull is self-describing (mirrors pull_session.py's .meta.json)
    meta = {**_session_meta(session), **{k: manifest[k] for k in ("session", "total_bytes")},
            "device": address, "n_files": len(manifest["files"])}
    with open(os.path.join(out_dir, "recording.meta.json"), "w") as fh:
        json.dump(meta, fh, indent=2)
    return manifest


def main():
    ap = argparse.ArgumentParser(description="Polar PS-FTP: list / pull onboard offline recordings")
    ap.add_argument("--address", required=True, help="BLE MAC of the Polar device (must be bonded)")
    ap.add_argument("--adapter", default=None, help="BlueZ adapter e.g. hci1 (omit = default)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    p = sub.add_parser("pull")
    p.add_argument("--session", help="session dir e.g. /U/0/20260716/E/170114/ (omit = pull all recordings)")
    p.add_argument("--out", required=True, help="output directory")
    a = ap.parse_args()

    async def run():
        if a.cmd == "list":
            recs = await list_recordings(a.address, a.adapter)
            print(json.dumps(recs, indent=2))
            print(f"\n{len(recs)} recording(s).")
        elif a.cmd == "pull":
            sessions = [a.session] if a.session else [r["path"] for r in await list_recordings(a.address, a.adapter)]
            for s in sessions:
                out = os.path.join(a.out, s.strip("/").replace("/", "_"))
                print(f"pulling {s} -> {out}")
                m = await pull_recording(a.address, s, out, a.adapter)
                for f in m["files"]:
                    print(f"  {f['bytes']:>8}  {f['name']}  {'OK' if f['ok'] else 'MISMATCH'}")
                print(f"  {len(m['files'])} files, {m['total_bytes']} bytes")
    asyncio.run(run())


if __name__ == "__main__":
    main()
