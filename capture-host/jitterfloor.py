#!/usr/bin/env python3
# tepna-capture — jitterfloor.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Delivery-jitter floor from the PMDARRIVAL sidecar — no privileges, no new capture surface.

ZEPHYR-INSTRUMENT-2026-08-23 §Task 2, layer 2. The btmon probe (tools/ble-jitter-probe.py)
measures the HCI layer and needs CAP_NET_ADMIN; this module measures the PRODUCTION layer — the
same userspace stamps `hostAxis` is fed — from data capture already writes every night. Nothing to
install, nothing to sudo: pure post-processing of `*_PMDARRIVAL.csv`.

Each sidecar row is one PMD frame: host arrival stamp + the frame's device-clock span
(`first_sensor_ns`). Two estimators, strongest first:

- vs-device: jitter = half-IQR of (host inter-arrival − device inter-frame). The device clock supplies
  the schedule, so no base-interval estimation at all — but it is only honest when the device axis
  is REAL. A drawn axis (sample_index × assumed rate — the O2Ring shape) has near-constant deltas
  and would launder host jitter into "agreement"; detected exactly as `clock.js` does (modal-delta
  concentration ≥ 99 %), and refused.
- folded: base interval from candidate testing (median/m, RELATIVE residual score — an absolute
  argmin always hands the win to the smallest base), then jitter = half-IQR of the residual after
  removing k× multiples (missed frames). Works on host stamps alone.

The night's FLOOR is the smallest well-sampled stream jitter — a lower bound on what any
arrival-time analysis of that night can resolve. Everything below it is stack, not signal.
"""

from __future__ import annotations

import json
import re
import statistics
import sys
from datetime import datetime
from pathlib import Path

MIN_FRAMES = 100  # a floor claimed from fewer frames is an anecdote, not a floor
DRAWN_CONCENTRATION = 0.99  # modal-delta share above this ⇒ the device axis is drawn, not a clock
_STAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$")


def _parse_stamp_ms(s: str) -> float | None:
    """Explicit-format parse (Clock Contract: regex the format, never a locale guess).

    Only deltas are consumed downstream, so the zone-free epoch is immaterial — but a row that
    does not match the writer's exact format is dropped, never guessed at.
    """
    if not _STAMP.match(s):
        return None
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%S.%f").timestamp() * 1000.0


def parse_pmdarrival(path: Path) -> dict[str, list[tuple[float, int]]]:
    """CSV → {"device|meas": [(host_ms, first_sensor_ns), ...]} keeping only well-formed rows."""
    streams: dict[str, list[tuple[float, int]]] = {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        parts = line.split(";")
        if len(parts) != 6 or parts[0] == "Phone timestamp":
            continue
        host = _parse_stamp_ms(parts[0])
        if host is None:
            continue
        try:
            first_ns = int(parts[3])
        except ValueError:
            continue   # the floor is a MINIMUM over parsed rows, so a dropped row can only make
                       # the estimate more conservative, never smaller than the truth
        streams.setdefault(parts[1] + "|" + parts[2], []).append((host, first_ns))
    return streams


def _jitter_scale(xs: list[float]) -> float:
    """Half-IQR, not MAD: alternating +/-J residuals (delivery jitter's common shape) are BIMODAL,
    and the median then lands ON one cluster — MAD read 1.2 ms against a true 5.5 ms plant
    (measured 2026-08-23). Half-IQR is J exactly for alternating +/-J and ~MAD on Gaussians."""
    q = statistics.quantiles(xs, n=4)
    return (q[2] - q[0]) / 2.0


def _device_axis_is_drawn(dev_deltas_ms: list[float]) -> bool:
    """A drawn axis concentrates on one delta value — `clock.js`'s provenance test, ported."""
    rounded = [round(d, 1) for d in dev_deltas_ms]
    modal = statistics.mode(rounded)
    return rounded.count(modal) / len(rounded) >= DRAWN_CONCENTRATION


def _folded_base(host_deltas: list[float]) -> float:
    """Base interval by candidate testing with a RELATIVE residual score (see module docstring)."""
    med = statistics.median(host_deltas)
    best_base, best_score = med, None
    for m in (1, 2, 3, 4):
        c = med / m
        if c < 8.0:
            break
        # no cap needed: |d - round(d/c)*c| <= c/2 by construction of round()
        score = statistics.median(abs(d - round(d / c) * c) for d in host_deltas) / c
        if best_score is None or score < best_score * 0.95:
            best_base, best_score = c, score
    return max(best_base, 8.0)


def stream_jitter(rows: list[tuple[float, int]]) -> dict | None:
    """One stream's jitter, ms — vs-device where the axis is real, folded otherwise."""
    if len(rows) < MIN_FRAMES:
        return None
    rows = sorted(rows)
    host_deltas = [b[0] - a[0] for a, b in zip(rows, rows[1:])]
    dev_deltas = [(b[1] - a[1]) / 1e6 for a, b in zip(rows, rows[1:])]
    drawn = _device_axis_is_drawn(dev_deltas)
    if drawn:
        base = _folded_base(host_deltas)
        resid = [d - round(d / base) * base for d in host_deltas]
        method = "folded"
    else:
        resid = [h - d for h, d in zip(host_deltas, dev_deltas)]
        base = statistics.median(dev_deltas)
        method = "vs-device"
    return {
        "n_frames": len(rows),
        "method": method,
        "base_ms": round(base, 2),
        "jitter_ms": round(_jitter_scale(resid), 3),
        "device_axis_drawn": drawn,
    }


def night_floor(night_dir: Path) -> dict:
    """All PMDARRIVAL sidecars in a night directory → per-stream jitter + the night's floor."""
    per_stream: dict[str, dict] = {}
    for csv in sorted(night_dir.glob("*_PMDARRIVAL.csv")):
        for key, rows in parse_pmdarrival(csv).items():
            r = stream_jitter(rows)
            if r is not None:
                # a device+meas may span several session files; keep the best-sampled record
                prev = per_stream.get(key)
                if prev is None or r["n_frames"] > prev["n_frames"]:
                    per_stream[key] = r
    floor = None
    for key, r in per_stream.items():
        if floor is None or r["jitter_ms"] < floor["jitter_ms"]:
            floor = {"stream": key, **r}
    return {"streams": per_stream, "floor": floor}


def main(argv: list[str]) -> int:
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        print("usage: jitterfloor.py <night-dir> [--json]")
        return 0
    result = night_floor(Path(argv[0]))
    if "--json" in argv:
        print(json.dumps(result, indent=1, sort_keys=True))
        return 0
    if result["floor"] is None:
        print("no stream reached %d frames — no floor claimable for this night" % MIN_FRAMES)
        return 1
    f = result["floor"]
    for key, r in sorted(result["streams"].items()):
        print(
            "%-38s %6d frames  base %8.2f ms  jitter %7.3f ms  (%s)"
            % (key, r["n_frames"], r["base_ms"], r["jitter_ms"], r["method"])
        )
    print()
    print(
        "DELIVERY-JITTER FLOOR: %.3f ms  (%s, %s, %d frames)"
        % (f["jitter_ms"], f["stream"], f["method"], f["n_frames"])
    )
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main(sys.argv[1:]))
