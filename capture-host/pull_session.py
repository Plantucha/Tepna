# tepna-capture — pull_session.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# One-off: pull the O2Ring-S ONBOARD-recorded session(s) off flash over BLE and save the raw bytes as a
# .dat — the same recording the ViHealth Android app syncs on removal. This is the device's own
# backstop record; use it to cross-check the on-the-fly SpO2 CSV the daemon captured live.
#
#   IMPORTANT: the ring holds ONE BLE link — STOP the capture daemon first (fuser -k 8760/tcp) so this
#   script can connect. (No special ATT MTU is required — the negotiated 247 is plenty; the old
#   "needs MTU >= 517" note was a misread placeholder MTU, CORRECTED in oxyii.py 2026-07-18.)
#
#   python pull_session.py --address D1:98:62:7C:92:B3 --out /home/michal/tepna-smoketest/captures/stored
#     [--which latest|all|<YYYYMMDDhhmmss>]  [--ftype N]  [--adapter hciX]

from __future__ import annotations
import argparse, asyncio, json, os
from bleak import BleakClient, BleakScanner
from bleak.exc import BleakDeviceNotFoundError
import oxyii

_NAME_HINTS = ("o2ring", "s8-aw", "s8aw", "wellue", "checkme")


async def _wait(q: asyncio.Queue, op: int, timeout: float = 20.0):
    """Await the next frame with opcode `op`, skipping interleaved live (0x04) frames.

    Timeout is 20 s, NOT the original 6 s: the ring is genuinely slow to answer file ops — FILE_LIST was
    MEASURED at 4.14 s on real hardware 2026-07-18, so 6 s left almost no margin and any radio contention
    pushed it over. That produced a bare `TimeoutError()` which read like a dead/absent device and sent us
    chasing a phantom MTU fault (the `MTU=23` printed at connect is bleak's PLACEHOLDER — the real
    negotiated MTU is only known after a characteristic is acquired; it is 247 here, not 23)."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while True:
        remain = deadline - loop.time()
        if remain <= 0:
            raise asyncio.TimeoutError(f"no reply to op {op:#x}")
        o, p = await asyncio.wait_for(q.get(), remain)
        if o == op:
            return p


async def pull(address, out_dir, which="latest", ftype=0, adapter=None, serial="0000", wait=0,
               on_progress=None):
    """Returns the list of .dat paths written this call (empty if the ring never appeared / no sessions)."""
    os.makedirs(out_dir, exist_ok=True)
    loop = asyncio.get_running_loop()
    deadline = loop.time() + wait
    while True:
        try:
            return await _pull_once(address, out_dir, which, ftype, adapter, serial, on_progress)
        except BleakDeviceNotFoundError:
            if loop.time() >= deadline:
                print("ring never appeared — wake it (USB charger / press button / re-wear) and rerun.", flush=True)
                return []
            print("ring not seen; scanning again … wear it (finger-in) with the phone app closed.", flush=True)
            await asyncio.sleep(2)


async def _pull_once(address, out_dir, which, ftype, adapter, serial, on_progress=None):
    # bluez={"adapter": ...}, not the deprecated bare `adapter=` kwarg (see capture.adapter_kw): when
    # bleak drops the shim the bare form is swallowed as an unknown kwarg rather than raised, so the
    # adapter pin would vanish silently and the pull would run on the wrong radio.
    kw = {"bluez": {"adapter": adapter}} if adapter else {}
    # EARLY-EXIT scan: return the instant the ring advertises. Its burst is short — a fixed-timeout
    # discover() finds it but then the connect window has closed. Matches address OR name (MAC can rotate).
    device = await BleakScanner.find_device_by_filter(
        lambda d, adv: d.address.upper() == address.upper()
        or any(h in ((adv.local_name or d.name or "").lower()) for h in _NAME_HINTS),
        timeout=25, **kw)
    if device is None:
        raise BleakDeviceNotFoundError(address, "O2Ring not advertising (finger-in + phone app closed)")

    q: asyncio.Queue = asyncio.Queue()
    reasm = oxyii.Reassembler()

    def on_notify(_h, data):
        for frame in reasm.feed(bytes(data)):
            r = oxyii.decode(frame)
            if r:
                q.put_nowait(r)

    print(f"connecting to {device.address}  {device.name!r} …", flush=True)
    async with BleakClient(device, **kw) as client:
        # Acquire the REAL ATT MTU before reporting it. On BlueZ bleak returns a placeholder 23 until a
        # characteristic is acquired, so printing mtu_size straight after connect always said "23" and
        # looked like a fatal MTU fault (2026-07-18: cost a long misdiagnosis — the real MTU is 247).
        be = getattr(client, "_backend", None)
        if hasattr(be, "_acquire_mtu"):
            try:
                await be._acquire_mtu()
            except Exception:
                pass                                  # best-effort: reporting only, never blocks the pull
        await client.start_notify(oxyii.OXYII_NOTIFY, on_notify)
        print(f"connected · MTU={getattr(client, 'mtu_size', '?')} (post-acquire)", flush=True)

        async def send(frame):
            await client.write_gatt_char(oxyii.OXYII_WRITE, frame, response=False)

        # Auth + setup (mirror the live flow; file ops appear to require the session be opened).
        await send(oxyii.auth_frame(serial)); await asyncio.sleep(0.5)
        await send(oxyii.setup_frame());      await asyncio.sleep(0.5)

        # 1) list recorded sessions
        await send(oxyii.file_list_frame())
        sessions = oxyii.parse_file_list(await _wait(q, oxyii.OP_FILE_LIST))
        print(f"recorded sessions on flash ({len(sessions)}): {sessions}", flush=True)
        if not sessions:
            print("no sessions found — nothing to pull.", flush=True)
            return []

        saved_paths = []
        # The flash list is NOT chronologically ordered, so "latest" must pick the max stamp, not [-1].
        # Session stamps are YYYYMMDDhhmmss → lexical max == chronological latest.
        targets = sessions if which == "all" else ([max(sessions)] if which == "latest" else [which])
        safe_root = os.path.abspath(out_dir) + os.sep
        for ts in targets:
            # `ts` (from `which=<specific>` — e.g. the LAN webmon /api/pull body — or the ring's file-list)
            # is an untrusted value that becomes a filesystem path below. CONTAINMENT GUARD: the resolved
            # path must stay INSIDE out_dir, so a traversal id such as `../..` can never make the pull read
            # or write outside it (py/path-injection). This standalone abspath+startswith check is the
            # sanitizer the flow analysis recognizes; the stamp-shape check is a second, cheaper reject.
            path = os.path.abspath(os.path.join(out_dir, f"Wellue_O2Ring-S_{ts}_STORED.dat"))
            if not path.startswith(safe_root):
                print(f"  ⚠ session id {ts!r} escapes the output dir — skipping.", flush=True)
                continue
            if not (ts.isdigit() and 8 <= len(ts) <= 14):
                print(f"  ⚠ implausible session id {ts!r} — skipping.", flush=True)
                continue
            print(f"\n── session {ts} ──", flush=True)
            await send(oxyii.file_start_frame(ts, ftype))
            meta = await _wait(q, oxyii.OP_FILE_START)
            size = int.from_bytes(meta[:4], "little")
            print(f"  size = {size} bytes  (meta {meta[:16].hex()})", flush=True)
            if not (0 < size < 50_000_000):
                print(f"  ⚠ implausible size — try a different --ftype (got {size}); skipping.", flush=True)
                await send(oxyii.file_end_frame()); await asyncio.sleep(0.3)
                continue

            # ALREADY ON DISK → skip the download. `which="all"` re-lists every onboard session, so without
            # this an auto-pull (or any repeat pull) re-downloads the whole flash over a slow BLE link every
            # cycle. The device-reported `size` is authoritative, so a same-size .dat is the same recording.
            # Not added to saved_paths: the return value is what this call actually WROTE, which is how the
            # auto-pull poller knows a session is genuinely new. (`path` was validated + built above.)
            if os.path.exists(path) and os.path.getsize(path) == size:
                print(f"  already on disk ({size} bytes) — skipping download.", flush=True)
                await send(oxyii.file_end_frame()); await asyncio.sleep(0.3)
                continue

            data = bytearray()
            off = 0
            while off < size:
                await send(oxyii.file_data_frame(off))
                try:
                    chunk = await _wait(q, oxyii.OP_FILE_DATA)
                except asyncio.TimeoutError:
                    print(f"  ⚠ timeout at offset {off}/{size}; stopping.", flush=True); break
                if not chunk:
                    break
                data += chunk; off += len(chunk)
                if off % (512 * 40) < len(chunk):
                    print(f"  {off}/{size} ({100*off//size}%)", flush=True)
                    if on_progress:
                        try:
                            on_progress(off, size)     # a UI hook must never break the transfer
                        except Exception:
                            pass
            await send(oxyii.file_end_frame()); await asyncio.sleep(0.3)

            with open(path, "wb") as f:                    # `path` computed above (skip-existing check)
                f.write(data)
            hdr = bytes(data[:10]).hex()
            fmt_a = data[:2] == b"\x01\x03"
            n_samples = max(0, (len(data) - 10 - 48)) // 3 if len(data) > 58 else 0
            meta_j = {"session": ts, "bytes": len(data), "declared_size": size,
                      "header": hdr, "format_a": fmt_a, "approx_samples": n_samples,
                      "trailer": bytes(data[-48:]).hex() if len(data) >= 48 else ""}
            with open(path + ".meta.json", "w") as f:
                json.dump(meta_j, f, indent=2)
            saved_paths.append(path)
            print(f"  saved {len(data)} bytes → {path}\n  header={hdr} format_a={fmt_a} ~{n_samples} samples", flush=True)
        return saved_paths


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--address", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--which", default="latest", help="latest | all | <YYYYMMDDhhmmss>")
    ap.add_argument("--ftype", type=int, default=0)
    ap.add_argument("--adapter", default=None, help="BlueZ adapter e.g. hci1 (omit = default)")
    ap.add_argument("--serial", default="0000")
    ap.add_argument("--wait", type=int, default=0, help="seconds to keep retrying if the ring is asleep")
    a = ap.parse_args()
    asyncio.run(pull(a.address, a.out, a.which, a.ftype, a.adapter, a.serial, a.wait))


if __name__ == "__main__":
    main()
