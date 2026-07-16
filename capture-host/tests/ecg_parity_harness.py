#!/usr/bin/env python3
# tepna-capture — ecg_parity_harness.py  (STAGED — destined for capture-host/tests/ in the worktree)
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Offline decode->write->parse PARITY HARNESS for the mandatory ECG stream. No BLE, no hardware.
# It exercises the REAL producer (capture-host/polar_pmd.decode_frame + writers.StreamWriter) and
# re-implements the CONSUMER's fs/gap inference EXACTLY as ecgdex-dsp.js parseECGText does
# (lines ~3115-3143), so a producer<->parser contract break shows up as a failing assert here
# instead of as a 10%-wrong HR on a real night.
#
# Modes:
#   (default) synthetic  : build a known 130 Hz ECG PMD frame, run producer, assert consumer infers fs=130.
#   --psl <file>         : parse a REAL Polar Sensor Logger *_ECG.txt and report what fs IT yields
#                          (settles whether real PSL emits integer or fractional `timestamp [ms]`).
#
# Run (from capture-host/):  python3 tests/ecg_parity_harness.py
#                            python3 tests/ecg_parity_harness.py --psl /path/to/real_ECG.txt

from __future__ import annotations
import argparse, os, struct, sys, tempfile, datetime as _dt

HERE = os.path.dirname(os.path.abspath(__file__))
# When staged in scratchpad, import from the repo capture-host/. In the worktree (tests/ under
# capture-host/) the parent dir is capture-host/ and these import directly.
for cand in (os.path.dirname(HERE), "/media/michal/647A504F7A50205A/Tepna/capture-host"):
    if os.path.exists(os.path.join(cand, "polar_pmd.py")):
        sys.path.insert(0, cand); break
import polar_pmd, writers  # the REAL scaffold modules


# ── build a synthetic, fully-known ECG type-0 PMD data notification ───────────────────────────
def synth_ecg_frame(n_samples: int = 260, fs: int = 130, last_ns: int | None = None) -> tuple[bytes, int]:
    """One PMD ECG frame: header [meas=0x00][last_ns u64][frame_type=0] + n * int24-LE uV."""
    if last_ns is None:
        # arbitrary plausible ns-since-2000 (~ 2026); value is irrelevant to fs inference.
        last_ns = 831_110_400_000_000_000
    hdr = bytes([polar_pmd.ECG]) + struct.pack("<Q", last_ns) + bytes([0])
    body = bytearray()
    for i in range(n_samples):
        uv = int(1500 * (1 if i % 13 else -3))  # any int24-safe pattern
        body += struct.pack("<i", uv)[:3]       # low 3 bytes = int24 LE
    return bytes(hdr) + bytes(body), last_ns


# ── the CONSUMER's fs/gap inference, ported byte-for-byte from parseECGText ────────────────────
def consumer_infer(path: str) -> dict:
    """Mirror ecgdex-dsp.js parseECGText fs+gap logic against a written file (col index 2 = ms)."""
    fs, prev_ms, ms_step, gaps, n = 130, None, None, [], 0
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            p = [c for c in _split(line)]
            try:
                v = float(p[-1])
            except (ValueError, IndexError):
                continue  # header / junk row (non-numeric last column)
            n += 1
            if len(p) >= 3:
                try:
                    ms = float(p[2])
                except ValueError:
                    ms = None
                if ms is not None:
                    if prev_ms is not None:
                        d = ms - prev_ms
                        if ms_step is None and 0 < d < 50:
                            ms_step = d
                        if ms_step and d > ms_step * 2.5:
                            gaps.append({"idx": n - 1, "ms": d})
                    prev_ms = ms
    if ms_step and ms_step > 0:
        fs = round(1000.0 / ms_step)
    return {"fs": fs, "ms_step": ms_step, "gaps": gaps, "n": n}


def _split(line: str):
    import re
    return re.split(r"[;\t,]", line)


def run_synthetic() -> int:
    frame, _ = synth_ecg_frame()
    meas, samples = polar_pmd.decode_frame(frame, _dt.datetime(2026, 6, 25, 21, 53, 0, 123000))
    assert meas == polar_pmd.ECG and samples, "decode produced no ECG samples"
    d = tempfile.mkdtemp(prefix="ecgparity_")
    path = os.path.join(d, "Polar_H10_TEST_20260625215300_ECG.txt")
    wr = writers.StreamWriter(path, "ecg")
    for s in samples:
        wr.write_ecg(s.phone, s.sensor_ns, s.t_ms, s.values[0])
    wr.close()
    got = consumer_infer(path)
    print(f"synthetic 130 Hz frame -> {len(samples)} samples")
    print(f"  consumer inferred: fs={got['fs']}  ms_step={got['ms_step']}  gaps={len(got['gaps'])}  n={got['n']}")
    print(f"  wrote: {path}")
    with open(path) as fh:
        head = [next(fh) for _ in range(4)]
    print("  first rows:\n    " + "    ".join(head))
    # PSL parity: the ms column (index 2) must be RELATIVE (first data row == 0.0) and FRACTIONAL.
    first_ms = head[1].split(";")[2]
    fs_ok = got["fs"] == 130
    rel_ok = first_ms == "0.0"
    ok = fs_ok and rel_ok
    print(f"  first-row ms column = {first_ms!r}  (PSL requires '0.0'; relative+fractional)")
    if ok:
        print("PASS: consumer recovers fs=130 AND ms column is relative/fractional (matches real PSL).")
    else:
        if not rel_ok:
            print(f"FAIL: first-row ms is {first_ms!r}, expected '0.0' (real PSL is relative to recording start).")
        print(f"FAIL: consumer inferred fs={got['fs']}, expected 130.")
        print("      Root cause: writers.write_ecg formats the ms column as {t_ms:.0f} (integer ms);")
        print("      the true 7.692 ms step rounds to 7/8, so parseECGText infers 143/125 Hz.")
        print("      Fix candidate: emit '{t_ms:.3f}' in writers.write_ecg.")
    return 0 if ok else 1


def run_psl(psl_path: str) -> int:
    got = consumer_infer(psl_path)
    print(f"REAL PSL file: {psl_path}")
    print(f"  consumer inferred: fs={got['fs']}  ms_step={got['ms_step']}  gaps={len(got['gaps'])}  n={got['n']}")
    print("  -> ms_step is FRACTIONAL if real PSL emits sub-ms; INTEGER (7/8) if PSL rounds too.")
    print("     If fractional, writers.py '.0f' is the deviation. If integer & fs is still ~130,")
    print("     re-check the consumer model against this file.")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--psl", help="parse a real Polar Sensor Logger *_ECG.txt instead of the synthetic frame")
    a = ap.parse_args()
    sys.exit(run_psl(a.psl) if a.psl else run_synthetic())
