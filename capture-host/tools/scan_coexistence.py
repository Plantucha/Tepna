# tepna-capture — tools/scan_coexistence.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""§2's BLE coexistence matrix — the MEASUREMENT that earns `scan_coexistence_verified`.

WHY THIS EXISTS. `oxy_presence` is built, wired and gate-backed, and it refuses to start:
`COEXISTENCE_KEY` is a config key separate from `enabled` so that "the operator owns intent, the
matrix owns permission" (`oxy_presence.py:253-256`). O2RING-PRESENCE-TRIGGER-IMPL §4 states the
remaining step in five words — **"Arming it is a measurement, not an edit."** Until now there was no
harness, so the measurement was an improvised experiment on a box holding irreplaceable nights.

WHAT §2 ACTUALLY FORBIDS is assuming a second BLE operation is harmless while O2Ring / CPAP / H10 /
Verity may be acquiring. So the question is not "does a passive scan work?" — it is "does a passive
scan DISTURB the acquisitions already running?", and that is a comparison, not an observation.

THE DESIGN, and the reason it needs no new instrumentation: every wearable arrival is already stamped
into `*_PMDARRIVAL.csv` by `writers.PmdArrivalLogWriter`, which exists for the inter-device offset
work. So this tool does not measure the scan at all. It alternates SCAN-ON and SCAN-OFF windows,
records their boundaries, and afterwards compares the arrival statistics the daemon wrote ANYWAY
between the two populations. An interleaved control, not a before/after: a night drifts (battery,
posture, distance), and a before/after would attribute that drift to the scan.

🔴 IT DOES NOT WRITE THE CONFIG KEY, AND IT MUST NOT. Printing "PASS" is evidence; setting
`scan_coexistence_verified` is the owner accepting it. Fusing those two would let a tool grant itself
the permission the key exists to withhold — the fabricated-authority shape CLAUDE.md §🎫 names.

⚠️ RUNNING THIS DISTURBS CAPTURE BY DESIGN. That is the point: it spends the risk deliberately, in
bounded windows, with a control, instead of discovering it on a night that mattered. Owner-attended.

    .venv/bin/python tools/scan_coexistence.py run --adapter hci0 --cycles 8 --window 120 \
        --out /srv/tepna/captures/coexistence-windows.jsonl
    .venv/bin/python tools/scan_coexistence.py verdict \
        --windows /srv/tepna/captures/coexistence-windows.jsonl --night /srv/tepna/captures/2026-09-11
"""
from __future__ import annotations

import argparse
import datetime as _dt
import glob
import json
import os
import sys

# ── PRE-STATED DECISION BANDS ────────────────────────────────────────────────────────────────────
# Written BEFORE any data exists, because a band chosen after seeing the numbers is not a band
# (CLAUDE.md's repeated finding; `pre-state-the-threshold`). These are the AUTHOR'S PROPOSAL and the
# owner ratifies them — they are stated here so the ratification is about numbers, not vibes.
#
# DELIVERY RATIO — arrivals per second in SCAN-ON windows over SCAN-OFF windows, per stream. A
# passive scan that costs nothing leaves this at ~1.0. 0.95 allows ordinary jitter; below it, packets
# are being lost while the radio scans.
MIN_DELIVERY_RATIO = 0.95
# GAP RATIO — the LONGEST inter-arrival silence, ON over OFF. Delivery can hold while the
# DISTRIBUTION degrades: the same packet count arriving in clumps still breaks PAT's ~10 ms budget,
# and a mean would hide it. 1.5 is generous on purpose; the failure this catches is 3-10x.
#
# 🔴 THE MAXIMUM, NOT A PERCENTILE, AND THE FIRST DRAFT GOT THIS WRONG. p95 was the obvious choice and
# it is BACKWARDS for clumping: a stream that delivers 1000 packets in one second and then falls
# silent has thousands of 1 ms gaps and a handful of 200 s ones, so its p95 is SMALLER than the
# undisturbed stream's and the burst reads as an improvement. Caught by the burst test below, which
# was written first and refused to go red. The quantity that answers "did a silence appear that was
# not there before" lives in the extreme tail, and for a bounded window that is the max.
MAX_GAP_RATIO = 1.5
# A stream with fewer than this many arrivals in EITHER population is reported as INCONCLUSIVE rather
# than passed. A ratio over a handful of packets is noise wearing a verdict.
MIN_ARRIVALS_PER_POPULATION = 200


def parse_arrivals(text: str) -> list[tuple[float, str, str]]:
    """`*_PMDARRIVAL.csv` → `[(epoch_seconds, device, meas)]`. PURE.

    The file is SEMICOLON-delimited with a `Phone timestamp;device;meas;…` header. Malformed rows are
    dropped rather than raised on: this reads a live night's tail, where the last line may be half
    written, and a crash there would lose the whole measurement to a partial row."""
    out: list[tuple[float, str, str]] = []
    for line in text.splitlines():
        if not line or line.startswith(("#", "Phone timestamp")):
            continue
        parts = line.split(";")
        if len(parts) < 3:
            continue
        try:
            ts = _dt.datetime.fromisoformat(parts[0]).timestamp()
        except ValueError:
            continue        # a half-written tail row is normal on a live night, not an error
        out.append((ts, parts[1], parts[2]))
    return out


def split_by_window(arrivals, windows) -> dict[str, dict[str, list[float]]]:
    """Bucket arrivals into the ON and OFF populations, per `device/meas` stream. PURE.

    Returns `{state: {stream: [epoch, …]}}`. An arrival outside every window is DROPPED — the windows
    are the experiment and the rest of the night is not a control, because nobody was alternating
    anything during it."""
    pops: dict[str, dict[str, list[float]]] = {"on": {}, "off": {}}
    spans = [(w["t_start"], w["t_end"], w["state"]) for w in windows]
    for ts, dev, meas in arrivals:
        for start, end, state in spans:
            if start <= ts < end:
                pops.setdefault(state, {}).setdefault(f"{dev}/{meas}", []).append(ts)
                break
    return pops


def _rate_and_gap(stamps: list[float], seconds: float):
    """(arrivals per second, LONGEST inter-arrival gap) for one stream in one population. PURE.

    ⚠️ Gaps are measured WITHIN the population's own concatenated stamps, so the jump from the end of
    one window to the start of the next is included. That is deliberate for the ON population — a
    silence spanning a window boundary is still a silence — and it is why both populations are
    measured the same way rather than one being special-cased into looking better."""
    if seconds <= 0 or len(stamps) < 2:
        return 0.0, None
    stamps = sorted(stamps)
    return len(stamps) / seconds, max(b - a for a, b in zip(stamps, stamps[1:]))


def verdict(pops, windows, *, min_ratio=MIN_DELIVERY_RATIO, max_gap=MAX_GAP_RATIO,
            min_n=MIN_ARRIVALS_PER_POPULATION) -> dict:
    """Per-stream PASS / FAIL / INCONCLUSIVE against the pre-stated bands. PURE.

    ∅ INCONCLUSIVE IS NOT A PASS, and it is not a failure either. A stream the scan never had a chance
    to disturb (too few packets in either population) has told us nothing, and reporting that as
    "undisturbed" is how a matrix certifies a radio it never tested — the shape §2 exists to forbid."""
    secs = {"on": 0.0, "off": 0.0}
    for w in windows:
        secs[w["state"]] = secs.get(w["state"], 0.0) + max(0.0, w["t_end"] - w["t_start"])
    streams = sorted(set(pops.get("on", {})) | set(pops.get("off", {})))
    rows = []
    for s in streams:
        on, off = pops.get("on", {}).get(s, []), pops.get("off", {}).get(s, [])
        r_on, g_on = _rate_and_gap(on, secs["on"])
        r_off, g_off = _rate_and_gap(off, secs["off"])
        if min(len(on), len(off)) < min_n:
            rows.append({"stream": s, "state": "INCONCLUSIVE", "n_on": len(on), "n_off": len(off),
                         "why": f"fewer than {min_n} arrivals in a population"})
            continue
        d_ratio = (r_on / r_off) if r_off else 0.0
        g_ratio = (g_on / g_off) if (g_on is not None and g_off) else 0.0
        bad = []
        if d_ratio < min_ratio:
            bad.append(f"delivery {d_ratio:.3f} < {min_ratio}")
        if g_ratio > max_gap:
            bad.append(f"longest gap {g_ratio:.2f}x > {max_gap}x")
        rows.append({"stream": s, "state": "FAIL" if bad else "PASS", "n_on": len(on), "n_off": len(off),
                     "delivery_ratio": round(d_ratio, 4), "gap_ratio": round(g_ratio, 3),
                     "why": "; ".join(bad) or "within both bands"})
    overall = ("FAIL" if any(r["state"] == "FAIL" for r in rows)
               else "INCONCLUSIVE" if (not rows or any(r["state"] == "INCONCLUSIVE" for r in rows))
               else "PASS")
    return {"overall": overall, "seconds": secs, "streams": rows}


async def _run(adapter: str, cycles: int, window: float, out_path: str) -> int:
    """Alternate passive-scan windows and record their boundaries. Needs a radio; not unit-tested."""
    import asyncio

    from bleak import BleakScanner
    rows: list[dict] = []
    for i in range(cycles):
        for state in ("off", "on"):
            t0 = _dt.datetime.now().timestamp()
            seen: set[str] = set()
            if state == "on":
                # `detection_callback` counts SIGHTINGS so a scan that silently produced nothing is
                # distinguishable from one that ran — an empty ON window with a PASS verdict would be
                # a matrix certifying a radio that never transmitted.
                #
                # ⚠️ CONDITIONAL CONSTRUCTION, not `**kw`. The splat is what mypy fans out across
                # BleakScanner's overloads (5 errors from one line); `capture._cpap_ble_connect`
                # carries the same note for BleakClient and solves it the same way — choose the call.
                cb = lambda d, a: seen.add(d.address)            # noqa: E731
                scanner = (BleakScanner(detection_callback=cb, scanning_mode="passive", adapter=adapter)
                           if adapter else
                           BleakScanner(detection_callback=cb, scanning_mode="passive"))
                await scanner.start()
                await asyncio.sleep(window)
                await scanner.stop()
            else:
                await asyncio.sleep(window)
            t1 = _dt.datetime.now().timestamp()
            rows.append({"t_start": t0, "t_end": t1, "state": state, "adapter": adapter,
                         "cycle": i, "sightings": len(seen)})
            print(f"  cycle {i + 1}/{cycles} {state:3}  {t1 - t0:6.1f}s  sightings={len(seen)}",
                  flush=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r) + "\n")
    on_sight = sum(int(r["sightings"]) for r in rows if r["state"] == "on")
    print(f"\nwrote {len(rows)} windows → {out_path}")
    if not on_sight:
        print("⚠ ZERO sightings across every SCAN-ON window: the scan may not have run at all. A "
              "verdict from this file would certify a radio that never transmitted — investigate "
              "before running `verdict`.")
        return 2
    return 0


def _verdict_cmd(windows_path: str, night_dir: str) -> int:
    with open(windows_path, encoding="utf-8") as fh:
        windows = [json.loads(ln) for ln in fh if ln.strip()]
    arrivals = []
    for f in sorted(glob.glob(os.path.join(night_dir, "*PMDARRIVAL.csv"))):
        with open(f, encoding="utf-8", errors="replace") as fh:
            arrivals.extend(parse_arrivals(fh.read()))
    v = verdict(split_by_window(arrivals, windows), windows)
    print(f"§2 coexistence matrix — {night_dir}")
    print(f"  windows: on={v['seconds'].get('on', 0):.0f}s off={v['seconds'].get('off', 0):.0f}s"
          f"   arrivals parsed: {len(arrivals)}\n")
    for r in v["streams"]:
        print(f"  {r['state']:13} {r['stream']:44} n_on={r['n_on']:<7} n_off={r['n_off']:<7} {r['why']}")
    print(f"\n  OVERALL: {v['overall']}")
    if v["overall"] == "PASS":
        print("\n  This is EVIDENCE, not permission. If you accept it, YOU set "
              "`o2ring.presence_harvest.scan_coexistence_verified: true` — this tool will not.")
    return 0 if v["overall"] == "PASS" else 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="alternate passive-scan windows on the box (owner-attended)")
    r.add_argument("--adapter", default="")
    r.add_argument("--cycles", type=int, default=8)
    r.add_argument("--window", type=float, default=120.0)
    r.add_argument("--out", required=True)
    d = sub.add_parser("verdict", help="compare arrival statistics between the windows")
    d.add_argument("--windows", required=True)
    d.add_argument("--night", required=True)
    a = ap.parse_args(argv)
    if a.cmd == "run":
        import asyncio
        return asyncio.run(_run(a.adapter, a.cycles, a.window, a.out))
    return _verdict_cmd(a.windows, a.night)


if __name__ == "__main__":       # pragma: no cover - CLI entry
    sys.exit(main())
