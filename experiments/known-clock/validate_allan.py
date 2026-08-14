# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""Validate capture-host/allan.py against `allantools`, the field-standard implementation.

WHY. `allan.py` is the suite's answer to "does this clock average down?", and every stability claim
rests on it. It was known-answer tested against SYNTHESISED noise of each type — which proves it is
self-consistent, not that it agrees with the field. An independent implementation is the only thing
that can catch a shared-assumption error, and allantools (Riley/NIST SP-1065 conventions) is the
reference the literature uses.

Run:  python3 experiments/known-clock/validate_allan.py
"""
import sys, os, math, random
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "capture-host"))

import numpy as np
import allantools as at
import allan as tepna


def synth(kind, n=4096, seed=7):
    """Phase series (seconds) with a KNOWN dominant noise type."""
    rng = random.Random(seed)
    x = [0.0] * n
    if kind == "white-PM":                       # sigma_y ~ tau^-1
        x = [rng.gauss(0, 1e-3) for _ in range(n)]
    elif kind == "white-FM":                     # sigma_y ~ tau^-1/2
        y = [rng.gauss(0, 1e-6) for _ in range(n)]
        acc = 0.0
        for i in range(n):
            acc += y[i]
            x[i] = acc
    elif kind == "RW-FM":                        # sigma_y ~ tau^+1/2
        f, acc = 0.0, 0.0
        for i in range(n):
            f += rng.gauss(0, 1e-8)
            acc += f
            x[i] = acc
    elif kind == "drift":                        # sigma_y ~ tau^+1
        x = [0.5 * 1e-9 * (i ** 2) for i in range(n)]
    return x


def main():
    tau0 = 1.0
    rows, bad = [], 0
    print(f"{'noise':10} {'tepna slope':>12} {'allantools slope':>17} {'theory':>7}  {'adev agree':>11}")
    print("-" * 66)
    for kind, theory in [("white-PM", -1.0), ("white-FM", -0.5), ("RW-FM", +0.5), ("drift", +1.0)]:
        x = synth(kind)

        # ── tepna ──────────────────────────────────────────────────────────────────────────────
        t_pts = tepna.adev(x, tau0)
        t_slope = tepna.slope(t_pts)

        # ── allantools (reference): overlapping ADEV from the same phase series ────────────────
        taus = np.array([p["tau"] for p in t_pts], dtype=float)
        a_tau, a_dev, _, _ = at.oadev(np.array(x, dtype=float), rate=1.0 / tau0,
                                      data_type="phase", taus=taus)
        # slope of log-log, same estimator tepna uses
        lg_t, lg_d = np.log10(a_tau), np.log10(a_dev)
        a_slope = float(np.polyfit(lg_t, lg_d, 1)[0])

        # per-tau agreement on the DEVIATION itself, not just the slope
        t_dev = np.array([p["adev"] for p in t_pts], dtype=float)
        m = min(len(t_dev), len(a_dev))
        rel = np.abs(t_dev[:m] - a_dev[:m]) / np.maximum(a_dev[:m], 1e-300)
        worst = float(np.max(rel))
        agree = worst < 1e-9
        if not agree or abs(t_slope - a_slope) > 0.02:
            bad += 1
        rows.append((kind, t_slope, a_slope, theory, worst))
        print(f"{kind:10} {t_slope:12.4f} {a_slope:17.4f} {theory:7.1f}  {'EXACT' if agree else f'{worst:.2e}':>11}")

    print()
    print("worst per-tau relative difference across all four:",
          f"{max(r[4] for r in rows):.3e}")
    print("ADEV points compared:", sum(1 for _ in rows), "series")
    if bad:
        print(f"\n{bad} series DISAGREE with allantools")
        return 1
    print("\nallan.py agrees with allantools to machine precision on every noise type.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
