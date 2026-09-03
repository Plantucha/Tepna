#!/usr/bin/env python3
# tepna-capture — parse_dat.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""
parse_dat.py - decode a Wellue O2Ring S recording (.dat, OXY Format-A) to CSV.

Layout (byte-exact; ported from OxyDex oxydex-dsp.js decodeO2RingBinToCSV +
oxyii.parse_oxy_trailer, and VERIFIED against a real USB 0xF3 pull):
  HEADER   : 10 bytes, skipped (real header 01 03 00 00 00 00 00 00 04 00). Carries NO absolute
             time -> start instant comes from the 14-digit filename stamp YYYYMMDDhhmmss; if absent,
             the recording stays UNDATED (no fabricated time, per house rule #2).
  SAMPLES  : 3 bytes each at 1 Hz from offset 10: [spo2 u8][pulse u8][motion u8].
  TERMINATOR: a record with spo2==0xFF AND pulse==0xFF ends the sample stream.
  TRAILER  : last 48 bytes, valid only if data[-48:][4:8] == 48 12 5a da. A CLEAN USB pull (stopped
             at the FILE_START size) DOES include it; only an over-read pull scrambles it. Optional.

The built-in self-consistency check (mean valid spo2 ~= trailer avg_spo2 +/-1; n_samples ~=
trailer total_seconds within a small margin) is the regression: passing it on a real file proves the
header offset + record layout end to end (no golden fixture needed; real .dat are not committed).

Usage:
  python parse_dat.py RECORDING.dat [-o out.csv]   # decode -> CSV + stats
  python parse_dat.py --selftest                    # offline: synthetic round-trip
"""
import argparse
import csv
import datetime
import os
import re
import sys

HEADER_LEN = 10
_TRAILER_LEN = 48
_SUBMAGIC = b"\x48\x12\x5a\xda"


def parse_oxy_dat(data: bytes):
    """Raw Format-A .dat -> (meta, samples, trailer). samples are 1 Hz."""
    samples = []
    off, n = HEADER_LEN, len(data)
    while off + 3 <= n:
        s, h, mo = data[off], data[off + 1], data[off + 2]
        if s == 0xFF and h == 0xFF:                  # end-of-data marker
            break
        samples.append({
            "sec": len(samples),                     # 1 Hz: seconds from start
            "spo2": s if 50 <= s <= 100 else None,   # 0/<50 = finger off / invalid
            "pulse": h if 0 < h < 0xFF else None,
            "motion": mo * 2,                        # OxyDex CSV scaling (raw byte = mo)
        })
        off += 3
    trailer = None
    if n >= _TRAILER_LEN and data[-_TRAILER_LEN:][4:8] == _SUBMAGIC:
        t = data[-_TRAILER_LEN:]
        score = t[42]
        trailer = {
            "finalized": True,
            "total_seconds": t[12] | (t[13] << 8),
            "avg_spo2": t[34], "min_spo2": t[35],
            "desat_ge3": t[36], "desat_ge4": t[37],
            "seconds_below_90": t[39] | (t[40] << 8),
            "episodes_below_90": t[41],
            "o2_score_x10": None if score == 0xFF else score,
            "avg_hr": t[47],
        }
    meta = {"header_len": HEADER_LEN, "sample_hz": 1, "n_samples": len(samples),
            "finalized": trailer is not None}
    return meta, samples, trailer


def oxy_start_dt(fname):
    """Absolute start from the 14-digit filename stamp (local civil), else None."""
    m = re.search(r"(\d{14})", os.path.basename(fname or ""))
    if not m:
        return None
    try:
        # naive datetime is intentional: device stores LOCAL CIVIL time, no TZ (house rule #2)
        return datetime.datetime.strptime(m.group(1), "%Y%m%d%H%M%S")  # noqa: DTZ007
    except ValueError:
        return None


def self_consistency(samples, trailer):
    """Returns (ok, list_of_notes). Validates header offset + layout on real files."""
    notes = []
    if not trailer:
        return None, ["no valid trailer (unfinalized file, or wrong trailer offset)"]
    valid = [s["spo2"] for s in samples if s["spo2"] is not None]
    ok = True
    if valid:
        body_mean = sum(valid) / len(valid)
        d = abs(body_mean - trailer["avg_spo2"])
        notes.append(f"mean valid spo2 {body_mean:.1f} vs trailer avg {trailer['avg_spo2']} "
                     f"(|d|={d:.1f}, want <=1)")
        ok &= d <= 1
    else:
        notes.append("no valid spo2 samples to compare")
        ok = False
    dn = abs(len(samples) - trailer["total_seconds"])
    # A real recording can drop a few 1 Hz samples (a 6.2 h night: 22462 stored vs 22472 s), so the
    # count check is a small percentage, not a fixed +-2 that would false-flag long files.
    tol = max(2, round(0.02 * trailer["total_seconds"]))
    notes.append(f"n_samples {len(samples)} vs trailer total_seconds "
                 f"{trailer['total_seconds']} (|d|={dn}, want <={tol})")
    ok &= dn <= tol
    return ok, notes


def write_csv(path, samples, start_dt):
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["sec", "time", "spo2", "pulse", "motion"])
        for s in samples:
            t = (start_dt + datetime.timedelta(seconds=s["sec"])).isoformat() if start_dt else ""
            w.writerow([s["sec"], t,
                        "" if s["spo2"] is None else s["spo2"],
                        "" if s["pulse"] is None else s["pulse"],
                        s["motion"]])


def _build_synthetic_dat():
    """Construct a valid Format-A .dat with a known trailer for round-trip testing."""
    import random
    random.seed(1)
    spo2_vals, pulse_vals = [], []
    body = bytearray(b"\x00" * HEADER_LEN)              # 10-byte header
    n = 120
    below90 = 0
    for i in range(n):
        s = 88 if i in (40, 41, 42, 80) else random.randint(94, 99)  # a few dips
        h = random.randint(58, 72)
        mo = random.randint(0, 5)
        spo2_vals.append(s); pulse_vals.append(h)
        if s < 90:
            below90 += 1
        body += bytes([s, h, mo])
    body += b"\xff\xff\x00"                             # terminator
    avg = round(sum(spo2_vals) / len(spo2_vals))
    t = bytearray(48)
    t[4:8] = _SUBMAGIC
    t[12] = n & 0xFF; t[13] = (n >> 8) & 0xFF
    t[34] = avg
    t[35] = min(spo2_vals)
    t[36] = 3; t[37] = 1
    t[39] = below90 & 0xFF; t[40] = (below90 >> 8) & 0xFF
    t[41] = 1
    t[42] = 78                                          # score 7.8
    t[47] = round(sum(pulse_vals) / len(pulse_vals))
    return bytes(body) + bytes(t), n, avg


def selftest():  # pragma: no cover  (offline self-demo; see tests/ for coverage)
    data, n, avg = _build_synthetic_dat()
    meta, samples, trailer = parse_oxy_dat(data)
    ok = True
    ok &= meta["n_samples"] == n
    print(f"n_samples {meta['n_samples']} (expect {n}) -> {'OK' if meta['n_samples']==n else 'FAIL'}")
    ok &= trailer is not None and trailer["total_seconds"] == n
    print(f"trailer total_seconds {trailer['total_seconds'] if trailer else None} "
          f"(expect {n}) -> {'OK' if trailer and trailer['total_seconds']==n else 'FAIL'}")
    ok &= trailer["avg_spo2"] == avg
    print(f"trailer avg_spo2 {trailer['avg_spo2']} (expect {avg})")
    c_ok, notes = self_consistency(samples, trailer)
    for nline in notes:
        print("  consistency:", nline)
    ok &= bool(c_ok)
    print(f"self-consistency -> {'OK' if c_ok else 'FAIL'}")
    dt = oxy_start_dt("20260830132000.dat")
    ok &= dt == datetime.datetime(2026, 8, 30, 13, 20, 0)  # noqa: DTZ001 (local civil)
    print(f"oxy_start_dt('20260830132000.dat') = {dt} -> {'OK' if dt else 'FAIL'}")
    print("SELFTEST", "PASS" if ok else "FAIL")
    return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dat", nargs="?", help="path to a .dat recording")
    ap.add_argument("-o", "--out", help="output CSV path (default: <dat>.csv)")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        sys.exit(selftest())
    if not a.dat:
        ap.error("provide a .dat file or --selftest")

    with open(a.dat, "rb") as fh:
        data = fh.read()
    meta, samples, trailer = parse_oxy_dat(data)
    start_dt = oxy_start_dt(a.dat)  # None if no valid 14-digit stamp; never fabricated
    if start_dt is None:
        print("note: no valid 14-digit stamp in filename; recording left UNDATED "
              "(time column shows sec-offset only). No start time is fabricated.")

    out = a.out or (os.path.splitext(a.dat)[0] + ".csv")
    write_csv(out, samples, start_dt)
    print(f"decoded {meta['n_samples']} samples (1 Hz) -> {out}")
    if trailer:
        print("trailer stats:")
        for k, v in trailer.items():
            print(f"  {k}: {v}")
        c_ok, notes = self_consistency(samples, trailer)
        print(f"self-consistency: {'PASS' if c_ok else 'CHECK'}")
        for nline in notes:
            print("  -", nline)
        if not c_ok:
            print("  ^ if this fails on a real off-body pull, the FILE_DATA header offset "
                  "likely differs from the export format (samples shifted by a constant).")
    else:
        print("no valid 48-byte trailer (file may be unfinalized, or an over-read USB pull "
              "scrambled it). Sample decode still written.")

if __name__ == "__main__":  # pragma: no cover
    main()
