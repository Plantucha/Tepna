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
# The OxyII transactional pull layer (acquisition charter G1). `_pull_once` no longer decides "do we
# already have this?" from a lone size-equality check — it drives the append-only inventory ledger and
# the restart-safe plan, so an interrupted transfer is re-queued or explicitly restarted, never silently
# trusted (charter §1). oxy_inventory = the ledger + classify; oxy_restart = the ledger↔disk plan;
# oxy_transfer = the atomic commit primitive; oxy_lifecycle = the daemon-level PULLING state.
import oxy_inventory
import oxy_restart
import oxy_transfer
import oxy_lifecycle

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


async def _pull_once(address, out_dir, which, ftype, adapter, serial, on_progress=None, lifecycle=None):
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
        # Upstream's hardest-won lesson (nglessner/o2ring-s-protocol): a too-small ATT MTU makes
        # cmd=0xF2 READ_FILE_START fail SILENTLY — zero bytes, no GATT error, just a timeout that reads
        # as "everything works except file transfer". BlueZ auto-negotiates 247 here (sufficient; the
        # 517 in Bumble examples is because Bumble does NOT auto-negotiate), so this should never fire.
        # It is a WARN not a block — if _acquire_mtu threw above we may still hold the placeholder 23,
        # and refusing on that would break a pull BlueZ would otherwise complete. Loud, not fatal.
        _mtu = getattr(client, "mtu_size", None)
        if isinstance(_mtu, int) and _mtu < 200:
            print(f"  ⚠ ATT MTU is {_mtu} (<200) — file transfer (cmd=0xF2) may fail silently; "
                  f"if the pull times out with 0 bytes, this is why", flush=True)
        await client.start_notify(oxyii.OXYII_NOTIFY, on_notify)
        print(f"connected · MTU={_mtu if _mtu is not None else '?'} (post-acquire)", flush=True)

        async def send(frame):
            await client.write_gatt_char(oxyii.OXYII_WRITE, frame, response=False)

        # Auth + setup (mirror the live flow; file ops appear to require the session be opened).
        await send(oxyii.auth_frame(serial)); await asyncio.sleep(0.5)
        await send(oxyii.setup_frame());      await asyncio.sleep(0.5)
        # ── DEVICE IDENTITY, recorded per session ─────────────────────────────────────────────────
        # `parse_get_info`'s own docstring says why this matters, and it was never called: *"this
        # device's behaviour is firmware-dependent (the F2 MTU gate differs between 2D010001/2/3), so a
        # capture should record which firmware produced it."* Nothing in the tree recorded the ring's
        # firmware — the only firmware handling anywhere was Polar-side. A capture whose interpretation
        # depends on firmware, and which does not say which firmware, cannot be re-read later with that
        # knowledge.
        #
        # ⚠️ STRICTLY NON-FATAL, and `None` rather than a guess. An identity read must never be able to
        # fail a pull: the recording on flash is the irreplaceable thing here, and a 20 s wait for a
        # nice-to-have is not worth risking it — so this uses a SHORT 6 s bound and swallows everything.
        # A ring that does not answer 0xE1 yields `device_firmware: null`, an honest "not read" rather
        # than a plausible default.
        identity = None
        try:
            await send(oxyii.info_frame())
            identity = oxyii.parse_get_info(await _wait(q, oxyii.OP_GET_INFO, timeout=6.0))
        except Exception as e:                       # noqa: BLE001 — see above; never fatal
            print(f"  ⚠ device identity not read ({e!r}) — continuing; firmware will be null", flush=True)
        if identity:
            print(f"device: firmware={identity.get('firmware')!r} serial={identity.get('serial')!r}",
                  flush=True)
        # The recording's stable identity is (device id, session stamp) — never a stamp alone (a stamp is
        # the ring's drifting RTC, and two rings could share one). The device id is the identity read's
        # serial when we got one; when 0xE1 did not answer it falls back to the `serial` arg (else the
        # address) so a ledger row can still be keyed rather than dropped.
        device_id = (identity or {}).get("serial") or serial or address

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

        # ── THE TRANSACTIONAL PULL (OxyII acquisition charter G1) ─────────────────────────────────────
        # Every state transition is recorded in an append-only ledger beside the night files, and
        # oxy_restart.plan() reads that ledger against what is actually on disk to decide, per session,
        # whether the bytes we already hold can be trusted. This REPLACES the old lone "same-size .dat on
        # disk → skip" heuristic (which trusted size equality — the exact failure the charter names): the
        # skip is now a property of the ledger (a COMMITTED row whose bytes still match), and the plan can
        # also recover a verified-but-never-committed file without re-pulling it over the slow BLE link.
        ledger_path = os.path.join(out_dir, "inventory.jsonl")
        rows = oxy_inventory.load_rows(ledger_path)

        # PRE-PASS: apply the containment + stamp guards ONCE (unchanged behaviour — an escaping or
        # non-stamp `which` is dropped here and never becomes a path), and build the two maps plan() needs:
        # identity → finished-.dat size, and identity → leftover-.part size.
        disk_listing: dict[str, int] = {}
        part_files: dict[str, int] = {}
        planned_targets = []
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
            ident = oxy_inventory.identity(device_id, ts)
            part = path + ".part"
            if os.path.exists(path):
                disk_listing[ident] = os.path.getsize(path)
            if os.path.exists(part):
                part_files[ident] = os.path.getsize(part)
            planned_targets.append((ts, ident, path, part))

        planned = oxy_restart.plan(rows, disk_listing, part_files)

        # G4 lifecycle: the daemon's acquisition is PAUSED_FOR_PULL while this owns the ring's one BLE
        # link, and PULLING while it moves bytes. The pull path is this state's only emitter; the edges
        # are threaded through LEGAL_TRANSITIONS (NOT_SEEN → PAUSED_FOR_PULL → PULLING), never forced.
        lifecycle = lifecycle or oxy_lifecycle.OxyLifecycle()
        lifecycle.device_id = device_id
        lifecycle.to(oxy_lifecycle.OxyState.PAUSED_FOR_PULL, "stored-session pull owns the link")
        lifecycle.to(oxy_lifecycle.OxyState.PULLING, "autopull: reading stored recordings off flash")

        for ts, ident, path, part in planned_targets:
            # INTACT — the ledger says COMMITTED and the bytes on disk still match: the ONLY do-nothing.
            # This is the old size-equality skip, now grounded in a validated ledger row rather than in the
            # file's size alone. Not added to saved_paths: the return value is what this call actually WROTE.
            if oxy_restart.is_trusted(planned, ident):
                print(f"  {ts}: committed and unchanged on disk — skipping download.", flush=True)
                continue
            # QUARANTINE — the bytes changed under a verified/committed row. Re-pulling would destroy the
            # evidence and trusting would launder it, so neither happens: a human decides.
            if ident in planned[oxy_restart.QUARANTINE]:
                print(f"  ⚠ {ts}: size changed under a verified record — quarantined; a human decides. "
                      f"Skipping.", flush=True)
                continue
            # COMMIT — verified but never committed: the kill-window between the atomic rename and the
            # ledger write. commit() renames BEFORE recording, so the finished bytes are already at the
            # final path; recovery is to RECORD the COMMITTED row, not to re-pull a recording we have.
            if ident in planned[oxy_restart.COMMIT]:
                oxy_inventory.append_row(ledger_path, oxy_inventory.make_row(
                    device_id, ts, oxy_inventory.COMMITTED,
                    reason="verified but never committed — commit recorded on restart",
                    size=disk_listing.get(ident), reported_size=disk_listing.get(ident), path=path))
                saved_paths.append(path)
                print(f"  {ts}: verified but never committed — commit recorded (no re-pull).", flush=True)
                continue

            # REPULL / new → download it. DISCOVERED the moment we act on the listing; every later
            # transition is recorded too, so a crash between any two is diagnosable from the ledger alone.
            oxy_inventory.append_row(ledger_path, oxy_inventory.make_row(
                device_id, ts, oxy_inventory.DISCOVERED, reason="listed on flash", path=path))
            print(f"\n── session {ts} ──", flush=True)
            await send(oxyii.file_start_frame(ts, ftype))
            meta = await _wait(q, oxyii.OP_FILE_START)
            size = int.from_bytes(meta[:4], "little")
            print(f"  size = {size} bytes  (meta {meta[:16].hex()})", flush=True)
            if not (0 < size < 50_000_000):
                print(f"  ⚠ implausible size — try a different --ftype (got {size}); skipping.", flush=True)
                oxy_inventory.append_row(ledger_path, oxy_inventory.make_row(
                    device_id, ts, oxy_inventory.FAILED, reason=f"implausible reported size {size}",
                    reported_size=size, failure="implausible_size"))
                await send(oxyii.file_end_frame()); await asyncio.sleep(0.3)
                continue

            oxy_inventory.append_row(ledger_path, oxy_inventory.make_row(
                device_id, ts, oxy_inventory.DOWNLOADING, reason="transfer in flight",
                reported_size=size, path=part))

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

            # AN INCOMPLETE DOWNLOAD MUST NOT OCCUPY THE FINAL PATH. The loop above `break`s on a
            # mid-transfer timeout, and this used to write the short buffer straight to `<session>.dat`
            # and report it in `saved_paths` — reproduced 2026-08-05: a timeout at offset 512 of 3002
            # left a 512-byte .dat that is indistinguishable, to anything globbing *.dat, from a
            # complete session. The sidecar did record `bytes` vs `declared_size`, so the truth was
            # written down; it just was not where a consumer looks. Same shape as §C5 one module over.
            #
            # So: land it under `.part` and RENAME (oxy_transfer.commit — atomic rename + dir fsync) only
            # when the byte count matches what the device declared, so a reader sees either no file or a
            # complete one — never a growing prefix. A short pull keeps its `.part` (the bytes are not
            # thrown away), lands a PARTIAL ledger row rather than COMMITTED, and the next run re-downloads
            # it because oxy_restart.plan() classifies a PARTIAL-with-.part as REPULL.
            complete = len(data) >= size
            with open(part, "wb") as f:
                f.write(data)
            # CLASSIFY the received bytes against the ring's reported size AND the Format-A finalisation
            # trailer, and record the verdict. A file reaches VERIFIED only when the trailer parses; a
            # right-sized-but-unfinalised one is PARTIAL — known, recorded, re-pullable — never silently
            # trusted (the ring can report full size before the trailer flushes, so size is not enough).
            state, reason = oxy_inventory.classify(bytes(data), size, oxyii.parse_oxy_trailer)
            sha = oxy_inventory.sha256_bytes(bytes(data))
            oxy_inventory.append_row(ledger_path, oxy_inventory.make_row(
                device_id, ts, state, reason=reason, size=len(data), reported_size=size,
                sha256=sha, path=part))
            if complete:
                oxy_transfer.commit(part, path)            # atomic rename + dir fsync (was os.replace)
                oxy_inventory.append_row(ledger_path, oxy_inventory.make_row(
                    device_id, ts, oxy_inventory.COMMITTED,
                    reason="atomically committed into the night tree", size=len(data),
                    reported_size=size, sha256=sha, path=path))
            else:
                print(f"  ⚠ INCOMPLETE: {len(data)}/{size} bytes — kept as {os.path.basename(part)}, "
                      f"NOT written as a session. The next pull re-downloads it.", flush=True)
            hdr = bytes(data[:10]).hex()
            fmt_a = data[:2] == b"\x01\x03"
            n_samples = max(0, (len(data) - 10 - 48)) // 3 if len(data) > 58 else 0
            # The ring's OWN session summary, parsed from the Format-A trailer (oxyii.parse_oxy_trailer):
            # an independent cross-check on OxyDex's avg/min SpO2 + desat counts from the same bytes, and
            # `finalized` — the reliable "complete" predicate, since the device can report full size via
            # cmd=0xF2 before the trailer flushes (size-equality is not enough). None when unfinalised.
            summary = oxyii.parse_oxy_trailer(data) if fmt_a else None
            meta_j = {"session": ts, "bytes": len(data), "declared_size": size,
            # Which firmware produced these bytes. None when 0xE1 did not answer — see the
            # identity read above; "not read" and "old firmware" are different facts.
            "device_firmware": (identity or {}).get("firmware"),
            "device_serial": (identity or {}).get("serial"),
                      "header": hdr, "format_a": fmt_a, "approx_samples": n_samples,
                      "finalized": bool(summary),
                      "device_summary": summary,
                      "trailer": bytes(data[-48:]).hex() if len(data) >= 48 else ""}
            # The sidecar rides whichever file actually exists, so a `.part` is still explained.
            final = path if complete else part
            with open(final + ".meta.json", "w") as f:
                json.dump(meta_j, f, indent=2)
            # REPORT IT EITHER WAY — under the name that says which it is. Returning nothing for a
            # short pull would hide real bytes from the operator: `saved_paths` feeds the API's
            # `new_files`/`sessions`, and the prior design deliberately surfaced partials there ("the
            # data is real"). That intent is kept; what changes is that the caller now sees
            # `<session>.dat.part`, so truncation is legible from the FILENAME instead of only from a
            # sidecar field every consumer has to remember to read.
            saved_paths.append(final)
            print(f"  {'saved' if complete else 'partial'} {len(data)} bytes → {final}\n"
                  f"  header={hdr} format_a={fmt_a} ~{n_samples} samples", flush=True)
        # Back to PAUSED_FOR_PULL: the bytes are handled, but this call still holds the link until the
        # BleakClient context exits below (PULLING → PAUSED_FOR_PULL is a legal edge).
        lifecycle.to(oxy_lifecycle.OxyState.PAUSED_FOR_PULL, "pull complete — releasing the link")
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
