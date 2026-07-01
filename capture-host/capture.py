# tepna-capture — capture.py  (entrypoint: python capture.py --config config.yaml)
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Async supervisor: holds the live BLE links overnight, routes frames to the vendor-layout writers,
# supervises the Muse child tool, and writes status.json. Per-device reconnect loops keep an
# unattended night alive across transient drops; onboard recording (O2Ring/Verity/H10) is the backstop.
#
# ⚠️ The BLE paths are UNVERIFIED on hardware here (see polar_pmd.py header). This is a correct-shaped
#    scaffold honoring the §7 integration contract; validate against real frames + PSL output first.

from __future__ import annotations
import argparse, asyncio, json, logging, os, signal, subprocess, datetime as _dt
import yaml
from bleak import BleakClient

from writers import StreamWriter, capture_filename, night_dir
import polar_pmd as pmd

HR_UUID = "00002a37-0000-1000-8000-00805f9b34fb"   # standard Heart Rate Measurement (RR intervals)
log = logging.getLogger("tepna-capture")
STATUS: dict = {"updated": None, "devices": {}}
_STOP = asyncio.Event()


def _now() -> _dt.datetime:
    return _dt.datetime.now()   # LOCAL civil time — the Clock Contract primary stamp. Keep the host NTP-synced.


def _set(name, **kv):
    STATUS["devices"].setdefault(name, {}).update(kv)


def _parse_hr(data: bytes):
    """Standard HR Measurement char → (bpm, [rr_ms,...])."""
    flags = data[0]; i = 1
    if flags & 0x01:
        bpm = int.from_bytes(data[1:3], "little"); i = 3
    else:
        bpm = data[1]; i = 2
    if flags & 0x08:   # energy expended present
        i += 2
    rr = []
    while i + 1 < len(data) + 1 and i + 1 <= len(data):
        if i + 2 > len(data):
            break
        raw = int.from_bytes(data[i:i + 2], "little"); i += 2
        rr.append(round(raw / 1024 * 1000))   # 1/1024 s units -> ms
    return bpm, rr


async def run_polar(dev: dict, root: str):
    name, addr = dev["name"], dev["address"]
    streams = dev.get("streams", ["ecg"])
    backoff = 5
    while not _STOP.is_set():
        writers: dict[int, StreamWriter] = {}
        hr_writer = None
        started = _now()
        ndir = night_dir(root, started)
        try:
            _set(name, connected=False, address=addr, last_error=None)
            async with BleakClient(addr) as client:
                _set(name, connected=True)
                log.info("%s connected", name)
                backoff = 5

                # Open one writer per requested stream.
                def w(stream, ext="txt"):
                    p = os.path.join(ndir, capture_filename(dev["vendor"], dev["model"], dev["device_id"], started, stream, ext))
                    return StreamWriter(p, stream)
                meas_of = {"ecg": pmd.ECG, "ppg": pmd.PPG, "acc": pmd.ACC}
                for s in streams:
                    if s in meas_of:
                        writers[meas_of[s]] = w(s)
                if "hr" in streams:
                    hr_writer = w("hr")

                # PMD data handler — one char carries all PMD streams; route by measurement type.
                def on_pmd(_sender, data: bytearray):
                    arrival = _now()
                    try:
                        meas, samples = pmd.decode_frame(bytes(data), arrival)
                    except ValueError as e:
                        _set(name, last_error=str(e)); return
                    wr = writers.get(meas)
                    if not wr or not samples:
                        return
                    for smp in samples:
                        if meas == pmd.ECG:
                            wr.write_ecg(smp.phone, smp.sensor_ns, smp.t_ms, smp.values[0])
                        elif meas == pmd.ACC:
                            wr.write_acc(smp.phone, smp.sensor_ns, smp.t_ms, *smp.values)
                        elif meas == pmd.PPG:
                            wr.write_ppg(smp.phone, smp.sensor_ns, smp.t_ms, smp.values[:3], smp.values[3])
                    _set(name, **{f"rows_{meas}": wr.rows, "last_sample": writers and smp.phone.isoformat()})

                def on_hr(_sender, data: bytearray):
                    if not hr_writer:
                        return
                    bpm, rr = _parse_hr(bytes(data))
                    hr_writer.write_hr(_now(), 0, bpm, rr)

                if writers:
                    await client.start_notify(pmd.PMD_DATA, on_pmd)
                    for meas in writers:
                        await client.write_gatt_char(pmd.PMD_CONTROL, pmd.START[meas], response=True)
                if hr_writer:
                    await client.start_notify(HR_UUID, on_hr)

                # Hold the link until disconnect or shutdown.
                while client.is_connected and not _STOP.is_set():
                    await asyncio.sleep(1)
        except Exception as e:
            _set(name, connected=False, last_error=repr(e))
            log.warning("%s link error: %r", name, e)
        finally:
            for wr in writers.values():
                wr.close()
            if hr_writer:
                hr_writer.close()
        if not _STOP.is_set():
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)   # exponential backoff, capped


async def run_muse(dev: dict, root: str):
    """Muse EEG is captured by a child tool (muselsl / OpenMuse), not bleak. Supervise + restart it."""
    name, addr = dev["name"], dev["address"]
    tool = dev.get("muse_tool", "muselsl")
    while not _STOP.is_set():
        started = _now()
        ndir = night_dir(root, started)
        out = os.path.join(ndir, capture_filename(dev["vendor"], dev["model"], dev["device_id"], started, "eeg", "csv"))
        # NOTE: verify the exact CLI for YOUR tool/version. Defaults below are the common forms:
        #   muselsl : needs a `stream` running, then `record`; or use a wrapper. OpenMuse: one-shot `record`.
        if tool == "openmuse":
            cmd = ["OpenMuse", "record", "--address", addr, "--outfile", out]
        else:
            cmd = ["muselsl", "record", "--address", addr, "--filename", out]
        try:
            _set(name, connected=True, address=addr, tool=tool, last_error=None, file=out)
            log.info("%s: %s", name, " ".join(cmd))
            proc = await asyncio.create_subprocess_exec(*cmd)
            while proc.returncode is None and not _STOP.is_set():
                try:
                    await asyncio.wait_for(proc.wait(), timeout=1)
                except asyncio.TimeoutError:
                    pass
            if proc.returncode is None:
                proc.terminate()
        except FileNotFoundError:
            _set(name, connected=False, last_error=f"{tool} not installed (pipx install {tool})")
            await asyncio.sleep(30)
        except Exception as e:
            _set(name, connected=False, last_error=repr(e))
        if not _STOP.is_set():
            await asyncio.sleep(5)


async def status_loop(root: str):
    path = os.path.join(root, "captures", "status.json")
    while not _STOP.is_set():
        STATUS["updated"] = _now().isoformat()
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w") as f:
                json.dump(STATUS, f, indent=2)
        except Exception as e:
            log.warning("status write: %r", e)
        await asyncio.sleep(10)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="config.yaml")
    args = ap.parse_args()
    cfg = yaml.safe_load(open(args.config))
    root = cfg["root"]
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, _STOP.set)

    tasks = [asyncio.create_task(status_loop(root))]
    for dev in cfg.get("devices", []):
        runner = run_muse if dev.get("vendor") == "Muse" else run_polar
        tasks.append(asyncio.create_task(runner(dev, root)))
    log.info("tepna-capture up: %d device(s), root=%s", len(cfg.get("devices", [])), root)
    await _STOP.wait()
    for t in tasks:
        t.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    log.info("tepna-capture stopped")


if __name__ == "__main__":
    asyncio.run(main())
