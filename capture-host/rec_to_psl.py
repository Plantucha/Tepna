#!/usr/bin/env python3
# tepna-capture — rec_to_psl.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# A POLAR `.REC` OFF THE DEVICE'S FLASH → THE POLAR SENSOR LOGGER TEXT FORMAT THE DEXES ALREADY READ.
#
# This is the payoff of the whole onboard-backup idea. Proving the bytes come off the flash is not the
# goal; the goal is a night the fleet can ANALYSE when the BLE link dropped. `.REC` turns out to need no
# new decoder at all — its payload is a run of PMD data frames byte-identical to the live link — so the
# entire offline path is a container walk plus the decoder `capture.py` already uses every night.
#
# Container (established 2026-08-03 by reading files this project created):
#
#     0x00  17-byte fixed header (00 2b 4c 7c 3d 01 … 75 ba 6d f9)
#     0x11  ASCII "YYYY-MM-DD HH:MM:SS", 19 bytes — the start, in UTC
#     0x26  the PMD settings TLVs, VERBATIM from the START command that created it
#     then  [meas_type][8-byte LE ns since 2000-01-01][frame_type][delta payload] × N
#
# ⚠️ THE STAMP IS UTC. Measured to −0.3 s against a host UTC clock, and the Clock Contract's canonical
# `tMs` is floating LOCAL civil time — so a night written straight out of here lands an offset off and
# looks entirely plausible. `--tz-offset-min` converts at the boundary; the default of 0 writes UTC
# through and says so in the output, because a silent wrong answer is the failure this guards.
# `polar_psftp` calls the same field `start_local`, which it is not.
#
# ⚠️ FRAME CADENCE IS NOT CONSTANT. PPG frames arrive ~944 ms apart and ACC ~2.4 s, because the device
# batches by BYTES not by time. Timing therefore comes from each frame's own `sensor_ns`, never from a
# frame index — the same rule the live path learned the hard way (PMD-DECODE-SCALE-AND-RATE).
#
#   python rec_to_psl.py PPG.REC -o Polar_VeritySense_X_20260803120120_PPG.txt --tz-offset-min -240

from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import struct

import polar_pmd as pmd

POLAR_EPOCH = _dt.datetime(2000, 1, 1)
HDR_STAMP_AT, HDR_STAMP_LEN, TLV_AT = 0x11, 19, 0x26

# The PSL column headers each Dex parser already expects.
HEADERS = {
    pmd.PPG: "Phone timestamp;sensor timestamp [ns];channel 0;channel 1;channel 2;ambient",
    pmd.ACC: "Phone timestamp;sensor timestamp [ns];X [mg];Y [mg];Z [mg]",
    pmd.GYRO: "Phone timestamp;sensor timestamp [ns];X [dps];Y [dps];Z [dps]",
    pmd.MAG: "Phone timestamp;sensor timestamp [ns];X [G];Y [G];Z [G]",
}


def parse_header(b: bytes) -> dict:
    """Header stamp + the settings the recording was made with. Both come from the file itself."""
    out = {}
    try:
        out["stamp_utc"] = b[HDR_STAMP_AT:HDR_STAMP_AT + HDR_STAMP_LEN].decode("ascii")
    except Exception:                                  # noqa: BLE001
        out["stamp_utc"] = None
    tlv, i = {}, TLV_AT
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
        tlv[sid] = vals
    out["settings"] = tlv
    out["fs"] = (tlv.get(0x00) or [None])[0]
    out["channels"] = (tlv.get(0x04) or [None])[0]
    out["resolution_bits"] = (tlv.get(0x01) or [None])[0]
    return out


def find_frames(b: bytes, anchor: _dt.datetime | None) -> list[tuple[int, int, int]]:
    """(offset, meas, sensor_ns) for each PMD frame, constrained to the recording's own window.

    Searching for "any known measurement byte followed by a plausible timestamp" is far too loose — the
    payload is delta-compressed and hits that pattern by chance. A `.REC` holds ONE stream, so the type
    must be constant, and every stamp must sit inside 24 h of the header. Both facts come from the file.
    """
    if anchor is None:
        return []
    lo = int((anchor - POLAR_EPOCH).total_seconds() * 1e9) - int(60e9)
    hi = lo + int(24 * 3600 * 1e9)
    best: list[tuple[int, int, int]] = []
    for meas in sorted(pmd.MEAS_NAME):
        found, prev = [], None
        for i in range(0, max(0, len(b) - 10)):
            if b[i] != meas:
                continue
            ns = struct.unpack_from("<Q", b, i + 1)[0]
            if not (lo < ns < hi) or (prev is not None and not (0 < ns - prev < 60e9)):
                continue
            found.append((i, meas, ns))
            prev = ns
        if len(found) > len(best):
            best = found
    return best


def convert(path: str, tz_offset_min: int = 0) -> dict:
    """Decode a `.REC` into PSL rows. Returns {header, rows, meas, warnings}."""
    b = open(path, "rb").read()
    hdr = parse_header(b)
    anchor = None
    if hdr["stamp_utc"]:
        try:
            anchor = _dt.datetime.fromisoformat(hdr["stamp_utc"])
        except ValueError:
            anchor = None
    frames = find_frames(b, anchor)
    out: dict = {"file": os.path.basename(path), "header": hdr, "n_frames": len(frames),
                 "rows": [], "warnings": []}
    if not frames:
        out["warnings"].append("no PMD frames found — header stamp unreadable or file truncated")
        return out
    meas = frames[0][1]
    out["meas"] = pmd.MEAS_NAME.get(meas, hex(meas))
    fs = hdr["fs"] or pmd.SAMPLE_HZ.get(meas)
    scale = pmd.axis_scale(meas, hdr["settings"])
    shift = _dt.timedelta(minutes=tz_offset_min)
    prev_ns, truncated = None, 0
    for k, (off, _m, ns) in enumerate(frames):
        end = frames[k + 1][0] if k + 1 < len(frames) else len(b)
        # `arrival` is only used by decode_frame for the host-clock column; the device's own sensor_ns
        # is the real timing and is what gets written. Passing the frame's own UTC keeps them coherent.
        arrival = POLAR_EPOCH + _dt.timedelta(microseconds=ns / 1000) + shift
        # THE RECORD IS LONGER THAN ITS FRAME. Measured 2026-08-03 by sweeping the slice end against the
        # decoder: a 281-byte PPG record decodes cleanly at +279/+280 and raises "truncated after 52
        # samples" at +281. So the layout is 10-byte PMD header + 269-byte payload + 2 trailing bytes
        # (content unidentified — plausibly a CRC or length). Slicing to the next frame's offset feeds
        # those two bytes to the delta decoder, which reads them as a block header that cannot complete
        # and discards all 52 good samples. 52 is exactly 944 ms x 55 Hz, which is what showed the data
        # was present and the BOUNDARY was wrong.
        samples = None
        # NATURAL BOUNDARY FIRST, then trim. Trying trim=2 first was wrong and a test caught it: on an
        # UNCOMPRESSED frame (no delta blocks) two fewer bytes is simply one fewer sample, which decodes
        # cleanly and silently loses data instead of raising. Only a delta frame objects to the trailing
        # bytes, so let the decoder ask for the trim rather than assuming it.
        for trim in (0, 1, 2, 3):
            try:
                _mt, samples = pmd.decode_frame(b[off:end - trim], arrival, fs, prev_ns, scale)
                break
            except ValueError as exc:
                last_err = exc
        if samples is None:
            out["warnings"].append(f"frame {k} @0x{off:04x}: {last_err}")
            continue
        if not samples:
            truncated += 1
            continue
        for s in samples:
            t = POLAR_EPOCH + _dt.timedelta(microseconds=s.sensor_ns / 1000) + shift
            out["rows"].append((t, s.sensor_ns, s.values))
        prev_ns = ns
    if truncated:
        # A part-decoded delta frame is a GAP, never a guess — decode_frame already refuses to emit
        # survivors it cannot time (VIGIL-HARDENING-III §1). Count them rather than paper over them.
        out["warnings"].append(f"{truncated} frame(s) decoded to nothing (treated as gaps, not filled)")
    return out


def write_psl(res: dict, dest: str) -> int:
    meas = {v: k for k, v in pmd.MEAS_NAME.items()}.get(res.get("meas"))
    head = HEADERS.get(meas, "Phone timestamp;sensor timestamp [ns];v0;v1;v2")
    with open(dest, "w") as fh:
        fh.write(head + "\n")
        for t, ns, vals in res["rows"]:
            cols = ";".join(f"{v:.0f}" if isinstance(v, float) else str(v) for v in vals)
            fh.write(f"{t.strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3]};{ns};{cols}\n")
    return len(res["rows"])


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Polar .REC (device flash) -> Polar Sensor Logger text")
    ap.add_argument("rec")
    ap.add_argument("-o", "--out", help="write PSL text here (default: alongside, .txt)")
    ap.add_argument("--tz-offset-min", type=int, default=0,
                    help="minutes to ADD to the device's UTC stamps. The Clock Contract stores floating "
                         "LOCAL civil time, so a local-time corpus needs the real offset (e.g. -240). "
                         "Default 0 writes UTC through — correct only if the consumer expects UTC.")
    ap.add_argument("--json", dest="json_path", help="also write a decode report here")
    a = ap.parse_args(argv)
    res = convert(a.rec, a.tz_offset_min)
    dest = a.out or os.path.splitext(a.rec)[0] + ".txt"
    n = write_psl(res, dest) if res["rows"] else 0
    report = {"file": res["file"], "meas": res.get("meas"), "n_frames": res["n_frames"],
              "n_samples": n, "header": res["header"], "warnings": res["warnings"],
              "tz_offset_min": a.tz_offset_min,
              "timebase_written": "UTC (device stamps, unshifted)" if a.tz_offset_min == 0
              else f"local civil (UTC{a.tz_offset_min:+d} min)",
              "out": dest if n else None}
    if res["rows"]:
        report["first_row"] = res["rows"][0][0].isoformat()
        report["last_row"] = res["rows"][-1][0].isoformat()
        span = (res["rows"][-1][0] - res["rows"][0][0]).total_seconds()
        report["span_sec"] = round(span, 2)
        report["delivered_fs"] = round((n - 1) / span, 2) if span > 0 else None
    text = json.dumps(report, indent=2, default=str)
    if a.json_path:
        with open(a.json_path, "w") as fh:
            fh.write(text + "\n")
    print(text)
    return 0 if n else 1


if __name__ == "__main__":
    raise SystemExit(main())
