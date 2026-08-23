#!/usr/bin/env python3
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""
ble-jitter-probe — the BLE delivery-jitter instrument (ZEPHYR-INSTRUMENT-2026-08-23 §Task 2).

Reads `btmon` text on stdin, extracts the kernel HCI timestamp of every LE advertising report and
the advertiser's address, and reports the per-device inter-arrival jitter. The headline number is
the DELIVERY-JITTER FLOOR: the tightest-advertising device's spread around its modal interval — the
`spreadMs` / connection-interval quantization the Clock-Contract `hostAxis` code reasons about, but
MEASURED for this radio+stack rather than assumed.

    sudo timeout 60 btmon -i hci2 | python3 tools/ble-jitter-probe.py     # Zephyr (free adapter)
    sudo timeout 60 btmon -i hci0 | python3 tools/ble-jitter-probe.py     # Realtek, for comparison
    python3 tools/ble-jitter-probe.py --selftest                          # no hardware needed

WHY btmon-on-stdin rather than opening the monitor socket here: the monitor socket needs
CAP_NET_ADMIN, so btmon carries the privilege and this parser stays unprivileged — the same
fixed-surface split the vigil tepna-* helpers use. It also means a captured `btmon --write` dump can
be replayed offline.

SCOPE (honest): these are HOST-side HCI timestamps — they include host scheduler jitter. That is
exactly the quantity the future controller-side-timestamp firmware (§Task 1) will let us subtract;
until then this measures the current stack, which is itself the thing `hostAxis` runs against today.
"""
import re
import statistics
import sys

# btmon header lines carry the packet timestamp (seconds.microseconds); adv bodies carry the address.
_TS = re.compile(r"(\d+\.\d{6})")
_ADDR = re.compile(r"Address:\s*([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5})")
_RSSI = re.compile(r"RSSI:\s*(-?\d+)")
_HEADER = re.compile(r"^[<>]|\[hci\d+\]")
MIN_SAMPLES = 5  # need at least this many arrivals for a jitter estimate to mean anything


def parse(lines):
    """btmon text -> {addr: {'arrivals': [ts...], 'rssi': [dbm...]}}."""
    last_ts = None
    cur_addr = None
    dev = {}
    for line in lines:
        if _HEADER.search(line):
            m = _TS.search(line)
            if m:
                last_ts = float(m.group(1))
        a = _ADDR.search(line)
        if a:
            cur_addr = a.group(1).upper()
            d = dev.setdefault(cur_addr, {"arrivals": [], "rssi": []})
            if last_ts is not None:
                d["arrivals"].append(last_ts)
        elif cur_addr is not None:
            r = _RSSI.search(line)
            if r:
                dev[cur_addr]["rssi"].append(int(r.group(1)))
    return dev


def _mad(xs, center):
    """Half-IQR, not MAD (name kept for call-site stability): alternating +/-J residuals are
    BIMODAL and the median lands ON a cluster, collapsing MAD (1.2 ms against a 5.5 ms plant,
    measured on the capture-host sibling 2026-08-23). Half-IQR is J for alternating +/-J and
    ~equals MAD on Gaussians. `center` is unused but kept so call sites stay stable."""
    if len(xs) < 4:
        return statistics.median(abs(x - center) for x in xs) if xs else 0.0
    q = statistics.quantiles(xs, n=4)
    return (q[2] - q[0]) / 2.0


def analyse(dev):
    """Per-device modal interval + jitter (ms), and the aggregate delivery-jitter floor."""
    rows = []
    for addr, d in dev.items():
        # CLUSTER same-instant reports: an ACTIVE scan elicits a SCAN_RSP for every advertisement,
        # so each beacon yields TWO(+) reports a few hundred microseconds apart. Raw deltas then
        # alternate ~0.4ms,T -- the median lands near T/2 and the MAD EQUALS it. jitter==modal on
        # every row was the tell, twice: first misdiagnosed as parser echoes (2026-08-23, fix #1),
        # then measured again after set()-dedupe because SCAN_RSP stamps genuinely differ. The
        # separation is unambiguous physics: spec-minimum advertising interval is 20 ms; ADV to
        # SCAN_RSP gaps are sub-millisecond. Merge anything closer than 8 ms into one instant.
        raw = sorted(set(d["arrivals"]))
        ts = []
        for t in raw:
            if not ts or (t - ts[-1]) * 1000.0 >= 8.0:
                ts.append(t)
        if len(ts) < MIN_SAMPLES:
            continue
        ivs = [(b - a) * 1000.0 for a, b in zip(ts, ts[1:])]  # inter-arrival, ms
        if not ivs:
            continue
        # FOLD OUT MISSED BEACONS. A scanner catches an advertisement only when its scan window
        # aligns, so most gaps are k x the true interval (k>=1) -- the raw MAD is then a statistic
        # of the MISS PATTERN, not of timing (measured 2026-08-23: "median jitter 821 ms" on real
        # hci0 data was scan duty cycle wearing jitter's units). Estimate the base interval from the
        # smallest common spacing, fold every gap modulo it (the _wrappedSlopeFit trick), and the
        # residual is the per-received-event jitter with misses removed.
        # Base-interval estimate by CANDIDATE TESTING, not a percentile: a jittery beacon's smallest
        # gap under-reads the base by up to the jitter (the 200 +/- 20 ms selftest case locked onto
        # 160). Try median/m for m=1..4, score each by the median folded residual, keep the best --
        # tie-broken toward the LARGEST base, because as base -> 0 residuals trivially -> 0 (the
        # degenerate win a naive argmin hands you).
        med_iv = statistics.median(ivs)
        best_base, best_score = None, None
        for m in (1, 2, 3, 4):
            c = med_iv / m
            if c < 8.0:
                break
            # score RELATIVELY (residual / base): absolute residual always shrinks as the base
            # does (bounded by c/2), so an absolute argmin hands the win to the smallest candidate
            # whenever real jitter is large -- measured: the 200 +/- 20 ms selftest beacon folded
            # "better" into a 51 ms base at 73% phantom miss rate. Relative cost prefers the truth.
            score = statistics.median(min(abs(iv - round(iv / c) * c), c / 2) for iv in ivs) / c
            if best_score is None or score < best_score * 0.95:
                best_base, best_score = c, score
        base = max(best_base if best_base is not None else med_iv, 8.0)
        resid = []
        misses = 0
        for iv in ivs:
            k = max(1, round(iv / base))
            misses += k - 1
            r = iv - k * base
            resid.append(r)
        rows.append(
            {
                "addr": addr,
                "n": len(ts),
                "base_ms": base,
                "jitter_ms": _mad(resid, statistics.median(resid)),
                "miss_pct": round(100.0 * misses / (misses + len(ivs)), 1),
                "rssi": round(statistics.median(d["rssi"])) if d["rssi"] else None,
            }
        )
    rows.sort(key=lambda r: r["jitter_ms"])
    floor = rows[0] if rows else None
    med_jitter = statistics.median(r["jitter_ms"] for r in rows) if rows else None
    return rows, floor, med_jitter


def render(rows, floor, med_jitter):
    out = ["BLE delivery-jitter probe", ""]
    if not rows:
        out.append("no device advertised >= %d times — scan longer, or nothing is nearby." % MIN_SAMPLES)
        return "\n".join(out)
    out.append("%-18s %5s %11s %14s %8s %6s" % ("device", "n", "base_iv_ms", "jitter_ms(MAD)", "miss%", "rssi"))
    for r in rows:
        out.append(
            "%-18s %5d %11.1f %14.2f %8.1f %6s"
            % (r["addr"], r["n"], r["base_ms"], r["jitter_ms"], r["miss_pct"], "" if r["rssi"] is None else r["rssi"])
        )
    out.append("")
    out.append(
        "-- DELIVERY-JITTER FLOOR: %.2f ms  (%s at a %.1f ms base interval, %d samples, %.0f%% missed)"
        % (floor["jitter_ms"], floor["addr"], floor["base_ms"], floor["n"], floor["miss_pct"])
    )
    out.append("-- median per-device jitter: %.2f ms  across %d device(s) with >= %d samples" % (med_jitter, len(rows), MIN_SAMPLES))
    return "\n".join(out)


def _selftest():
    # Synthetic btmon: a tight beacon (100 ms +/- 1 ms) and a sloppy one (200 ms +/- 20 ms).
    lines = []
    t = 1000.0

    def emit(addr, ts, rssi):
        lines.append("> HCI Event: LE Meta Event (0x3e) plen 42 #1 [hci2] %.6f" % ts)
        lines.append("      LE Advertising Report (0x02)")
        lines.append("        Address: %s (Random)" % addr)
        lines.append("        RSSI: %d dBm" % rssi)

    tight, sloppy = "AA:BB:CC:DD:EE:01", "AA:BB:CC:DD:EE:02"
    jit = [1, -1, 0.5, -0.5, 1, -1, 0.3, -0.3, 0.8, -0.8]
    ks = [1, 2, 1, 1, 3, 1, 2, 1, 1, 2, 1, 1, 2, 1]  # missed-beacon multiples, like a real scanner
    acc = 0
    for i, k in enumerate(ks):
        acc += k
        emit(tight, t + acc * 0.100 + (jit[i % len(jit)] / 1000.0), -40)
    for i in range(11):
        emit(sloppy, t + i * 0.200 + (jit[i % len(jit)] * 20 / 1000.0), -85)

    # regression, both real mechanisms: every report surfaced twice at the SAME stamp (btmon echo)
    # AND an active-scan SCAN_RSP sibling 0.4 ms later (distinct stamp -- the one set() cannot fix)
    dup = []
    for i in range(0, len(lines), 4):
        blk = lines[i:i+4]
        dup.extend(blk); dup.extend(blk)
        rsp = list(blk)
        rsp[0] = rsp[0].replace(lines[i].split()[-1], "%.6f" % (float(lines[i].split()[-1]) + 0.0004))
        dup.extend(rsp)
    dev = parse(dup)
    rows, floor, med = analyse(dev)
    assert len(rows) == 2, rows
    assert floor["addr"] == tight, floor  # the tight beacon must be the floor
    assert abs(floor["base_ms"] - 100.0) < 5.0, floor  # true base recovered THROUGH the misses
    assert floor["jitter_ms"] < 3.0, floor             # and jitter is the +/-1ms plant, not miss gaps
    assert floor["miss_pct"] > 20, floor               # the misses are REPORTED, not hidden
    assert floor["jitter_ms"] < med, (floor["jitter_ms"], med)  # floor is the tightest, below the median
    sloppy_row = next(r for r in rows if r["addr"] == sloppy)
    assert abs(sloppy_row["base_ms"] - 200.0) < 25.0, sloppy_row
    assert sloppy_row["jitter_ms"] > floor["jitter_ms"] * 3, (sloppy_row, floor)  # ~20x jitter, clearly separated
    print("selftest OK — floor %.2f ms (tight), median %.2f ms; sloppy device correctly separated" % (floor["jitter_ms"], med))


def main(argv):
    if "--selftest" in argv:
        _selftest()
        return 0
    if "--help" in argv or "-h" in argv:
        print(__doc__)
        return 0
    rows, floor, med = analyse(parse(sys.stdin))
    print(render(rows, floor, med))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
