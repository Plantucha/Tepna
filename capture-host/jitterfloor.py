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
DRAWN_CONCENTRATION = 0.99  # lattice share at or above this ⇒ the device axis is drawn, not a clock
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
            continue  # the floor is a MINIMUM over parsed rows, so a dropped row can only make
            # the estimate more conservative, never smaller than the truth
        streams.setdefault(parts[1] + "|" + parts[2], []).append((host, first_ns))
    return streams


def _jitter_scale(xs: list[float]) -> float:
    """Half-IQR, not MAD: alternating +/-J residuals (delivery jitter's common shape) are BIMODAL,
    and the median then lands ON one cluster — MAD read 1.2 ms against a true 5.5 ms plant
    (measured 2026-08-23). Half-IQR is J exactly for alternating +/-J and ~MAD on Gaussians."""
    q = statistics.quantiles(xs, n=4)
    return (q[2] - q[0]) / 2.0


def _device_axis_is_drawn(dev_deltas_ns: list[int]) -> bool:
    """A drawn axis lies on an EXACT INTEGER LATTICE: every advance is a whole multiple of one grid
    step, because it was built as `sample_index × an assumed rate` and never measured anything.

    🔴 THIS USED TO TEST MODAL CONCENTRATION AND IT MISSED THE O2RING — the device whose axis is the
    canonical drawn one. Measured on vigil 2026-09-13 over 09-11/09-12: the ring's device deltas are
    exactly 1000/2000/3000/4000 ms, unmistakably drawn, but DROPPED FRAMES put ~2 % of the mass on the
    multiples, so the modal share was 0.9787 / 0.9725 — under the 0.99 bar. The guard passed, vs-device
    ran against a fabricated clock, and the ring reported 499.5 ms on one adapter and 11.5 ms on
    another from host inter-arrivals that are statistically identical (median 1001 ms both, 84.7 % vs
    82.9 % within ±50 ms of 1000). 499.5 is just half the base interval: the residual is `host − 0` on
    the 49.9 % of device deltas that do not advance at all.

    ⚠️ AND THE OBVIOUS FIX IS WRONG — do not "simplify" this back to it. Keying on the share of deltas
    that are integer MULTIPLES of the modal delta convicts the honest clocks: measured the same day,
    Polar H10 `acc` scores 0.9930 and `ecg` 0.9990 on that test, because a REAL clock delivering at a
    fixed frame interval with occasional misses also produces 2×/3× of its modal. Being a multiple does
    not separate the populations; being EXACT does. In the raw nanosecond field the two populations sit
    six orders of magnitude apart, with no threshold to tune:

        O2Ring OXYLIVE   1.000000   (grid exactly 1_000_000_000 ns)
        H10 acc / ecg    0.000003 … 0.000018
        Verity acc / ppg 0.000015 … 0.000068

    Integer ns on purpose: `%` on floats would reintroduce the fuzz this test exists to avoid.

    ∅ NO POSITIVE DELTA AT ALL ⇒ DRAWN. An axis that never advances (Verity `ppi`: 100 % zero deltas in
    both arms) is not a clock either, and vs-device against it would difference host stamps against a
    constant. The old code reached the same verdict by accident — modal 0.0 at 100 % concentration — so
    this branch preserves a behaviour that was previously a coincidence."""
    positive = [d for d in dev_deltas_ns if d > 0]
    if not positive:
        return True
    grid = min(positive)
    return sum(1 for d in positive if d % grid == 0) / len(positive) >= DRAWN_CONCENTRATION


# A residual is at most c/2 by construction of round(), so half of that is the natural line between
# "these deltas cluster on the lattice" and "they do not". It is a property of the arithmetic, not a
# tuned constant: nothing here was fitted to a corpus.
FOLD_FIT_TOL = 0.25


def _lattice_fit(deltas: list[float], c: float) -> float:
    """Share of deltas within FOLD_FIT_TOL*c of a multiple of c — a COUNT, never a central statistic.
    The deltas of a stream with dropped frames are bimodal by construction, and a median residual over
    a bimodal population describes whichever cluster it lands in while saying nothing about the other."""
    return sum(1 for d in deltas if abs(d - round(d / c) * c) < c * FOLD_FIT_TOL) / len(deltas)


def _folded_base(host_deltas: list[float]) -> float:
    """Base interval by candidate testing, scored by HOW MANY deltas fit the lattice — not by a
    residual average, and not normalised by the candidate.

    🔴 BOTH EARLIER SCORES FAILED, IN MIRROR-IMAGE WAYS, and the module docstring only recorded the
    first. An absolute argmin hands the win to the SMALLEST candidate (every divisor of the true base
    leaves the same residual). Dividing that residual by `c` to fix it hands the win to the LARGEST
    candidate for exactly the same reason — measured 2026-09-13 on the 1-in-3-dropped fixture, every
    candidate scored an identical 1.0 ms absolute residual, so the `/c` normalisation ranked them
    1:2:3:4 and picked m=1 (base 999 ms, jitter 248 ms) over the true m=2 (base 499.5, jitter ~3).

    ⚠️ AND THE 1.0 ms THAT DROVE IT WAS ITSELF AN ARTEFACT — the deeper defect. The deltas are bimodal
    (half ~500 ms, half ~1000 ms). Against c=999 the big half leaves ~1 ms and the small half leaves
    ~496 ms, and with one more big delta than small, the MEDIAN residual lands in the small cluster and
    reports 1.0 — a number that describes half the data while the other half misses the lattice
    entirely. A central statistic cannot score a fit that is bimodal by construction, whichever way it
    is normalised.

    So the score counts instead: the share of deltas landing within `FOLD_FIT_TOL * c` of a multiple.
    Ties go to the LARGEST candidate, which happens for free because `m` ascends (so `c` descends) and
    only a STRICTLY better fit displaces the incumbent — a divisor of the true base fits equally well
    and must not win, or the fold reports a base that is a submultiple of the real schedule."""
    med = statistics.median(host_deltas)
    # ⛔ WHEN MAY A CANDIDATE GO FINER THAN THE SMALLEST OBSERVED DELTA? Only when the deltas are whole
    # multiples of it — i.e. when the short gaps are single frames and the long ones are drops. Then a
    # finer grid is finding a schedule the stream never got to show. When they are NOT (30×100 with
    # 10×150: 1.5 is no one's missed frame), a finer grid is subdividing genuine irregularity until it
    # disappears, and a jitter floor that does that reports ~0 for a stream that is visibly uneven.
    #
    # Both halves are needed and neither is sufficient: this test admits c=500 AND c=1000 for a
    # dropped-frame stream, and it is the fit count below that prefers 500. Measured 2026-09-13 —
    # the discriminator is Wren's, the exception that killed a bare floor is the shipped 400/800
    # fixture, whose true base 200 lies BELOW every gap it ever emits.
    smallest = min(host_deltas)
    multiples_only = _lattice_fit(host_deltas, smallest) >= DRAWN_CONCENTRATION
    best_base, best_fit = max(med, 8.0), -1.0
    for m in (1, 2, 3, 4):
        c = med / m
        if c < 8.0 or (not multiples_only and c < smallest * 0.9):
            break
        fit = _lattice_fit(host_deltas, c)
        if fit > best_fit:
            best_base, best_fit = c, fit
    return max(best_base, 8.0)


def stream_jitter(rows: list[tuple[float, int]]) -> dict | None:
    """One stream's jitter, ms — vs-device where the axis is real, folded otherwise."""
    if len(rows) < MIN_FRAMES:
        return None
    rows = sorted(rows)
    host_deltas = [b[0] - a[0] for a, b in zip(rows, rows[1:])]
    # The guard reads the RAW ns integers (exact lattice test); the ms floats below are for the
    # vs-device residual only. Converting first and testing after is what let float fuzz in.
    dev_deltas_ns = [b[1] - a[1] for a, b in zip(rows, rows[1:])]
    dev_deltas = [d / 1e6 for d in dev_deltas_ns]
    drawn = _device_axis_is_drawn(dev_deltas_ns)
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
