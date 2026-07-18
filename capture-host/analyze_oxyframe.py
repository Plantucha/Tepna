#!/usr/bin/env python3
# tepna-capture — analyze_oxyframe.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Identify O2Ring live-header byte [11] from a recorded `*_OXYFRAME.txt` sidecar.
#
# WHY THIS EXISTS. [11] is the only unidentified varying byte in the 24-byte live header. It was
# DISCARDED until 2026-07-18, so every prior attempt worked from 271 opportunistic frames (22 non-zero)
# and produced an unconvincing r=0.42 against pleth AC/DC — a correlation driven by single observations.
# The sidecar now records it every frame, so the question becomes a data question.
#
# THIS TOOL DELIBERATELY DOES NOT ASSUME THE ANSWER. The house hypothesis is an event/alert flag (the
# ring vibrates on desaturation, and the vendor's legacy Viatom format carries a vibration byte in the
# same spirit) — which is exactly why the tool must test the RIVALS just as hard. It scores four
# hypotheses against the same data and reports all of them:
#
#   H1 ALERT       — fires AT desaturation events; near-zero otherwise. Discriminator: association with
#                    desat episodes, and TIMING (an alert cannot precede the event that triggers it).
#   H2 PERFUSION   — a continuous index; should track pleth amplitude and be non-zero nearly always.
#                    Discriminator: it must NOT be 0 in 92% of frames. That alone nearly kills H2.
#   H3 MOTION      — a second motion/artifact channel. Discriminator: association with the motion byte.
#   H4 NUISANCE    — contact transitions, battery, or frame-sequence artifacts (i.e. not physiological).
#
# Statistics are stdlib-only (this host runs stdlib + bleak). The association test is a PERMUTATION test
# on the observed statistic: no scipy, no distributional assumption, and it stays honest for the rare-
# event case that dooms a naive chi-square here (22 non-zero in 271 frames had expected cells < 5).
#
# Usage:
#   python3 analyze_oxyframe.py <night>/*_OXYFRAME.txt [--desat-drop 3] [--desat-floor 90] [--perm 20000]

from __future__ import annotations
import argparse, datetime as _dt, os, random, sys

SPO2_MIN, SPO2_MAX = 50, 100          # a reading outside this is the ring reporting "no reading"


def parse_sidecar(path: str) -> list[dict]:
    """`*_OXYFRAME.txt` → rows. A BLANK column is None, never 0 — the writer never fabricates a value,
    and neither do we: coercing a blank SpO2 to 0 would invent a desaturation at every off-finger frame."""
    rows: list[dict] = []
    with open(path) as fh:
        head = fh.readline().rstrip("\n").split(";")
        idx = {name: i for i, name in enumerate(head)}
        need = ("Phone timestamp", "flag11", "spo2")
        missing = [n for n in need if n not in idx]
        if missing:
            raise SystemExit(f"{path}: not an OXYFRAME sidecar (missing {', '.join(missing)})")
        for line in fh:
            c = line.rstrip("\n").split(";")
            if len(c) < len(head):
                continue

            def num(name):
                v = c[idx[name]].strip() if name in idx else ""
                return int(v) if v.lstrip("-").isdigit() else None

            try:
                t = _dt.datetime.strptime(c[idx["Phone timestamp"]].strip(), "%Y-%m-%dT%H:%M:%S.%f")
            except ValueError:
                continue
            rows.append({"t": t, "flag11": num("flag11"), "spo2": num("spo2"), "pr": num("pr"),
                         "motion": num("motion"), "contact": num("contact"), "batt": num("battery_pct"),
                         "seq": num("seq")})
    return rows


def valid_spo2(v) -> bool:
    return v is not None and SPO2_MIN <= v <= SPO2_MAX


def mark_desat(rows: list[dict], drop: int, floor: int) -> list[bool]:
    """Per-frame: is this frame inside a desaturation episode?

    Definition (deliberately conventional, not tuned to make a hypothesis win): a frame is in a desat
    episode when its SpO2 is at least `drop` points below the trailing 120 s baseline (the median of
    valid readings in the preceding 2 min) OR below the absolute `floor`. Frames without a valid
    reading are NOT desat — absence of a measurement is not evidence of hypoxia."""
    out: list[bool] = []
    for i, r in enumerate(rows):
        if not valid_spo2(r["spo2"]):
            out.append(False)
            continue
        t0 = r["t"] - _dt.timedelta(seconds=120)
        base = [x["spo2"] for x in rows[max(0, i - 300):i] if x["t"] >= t0 and valid_spo2(x["spo2"])]
        if base:
            base.sort()
            med = base[len(base) // 2]
            out.append(r["spo2"] <= med - drop or r["spo2"] < floor)
        else:
            out.append(r["spo2"] < floor)
    return out


def phi(a: list[bool], b: list[bool]) -> float:
    """Phi coefficient of two boolean series (Pearson r for binaries). 0 when either is constant."""
    n11 = sum(1 for x, y in zip(a, b) if x and y)
    n10 = sum(1 for x, y in zip(a, b) if x and not y)
    n01 = sum(1 for x, y in zip(a, b) if not x and y)
    n00 = sum(1 for x, y in zip(a, b) if not x and not y)
    den = (n11 + n10) * (n01 + n00) * (n11 + n01) * (n10 + n00)
    return 0.0 if den == 0 else (n11 * n00 - n10 * n01) / (den ** 0.5)


def perm_test(a: list[bool], b: list[bool], iters: int, rng: random.Random) -> tuple[float, float]:
    """Two-sided permutation test on |phi|. Returns (observed_phi, p).

    A permutation test, not a chi-square: the flag is RARE (22/271 historically), so chi-square's
    expected-cell assumption fails outright and would hand back a confidently wrong p."""
    obs = phi(a, b)
    if obs == 0.0:
        return 0.0, 1.0
    shuf = list(b)
    hits = 0
    for _ in range(iters):
        rng.shuffle(shuf)
        if abs(phi(a, shuf)) >= abs(obs):
            hits += 1
    return obs, (hits + 1) / (iters + 1)


def lead_lag(flag: list[bool], event: list[bool], span: int = 20) -> list[tuple[int, float]]:
    """|phi| between the flag and the event shifted by k frames, k in [-span, +span].

    This is the discriminator that CAUSALITY gives us for free: an ALERT is a response, so its peak
    association must sit at lag >= 0 (flag at or AFTER the event). A peak at negative lag means the flag
    leads the desaturation, which no alert can do — that would point at a predictor (perfusion/signal
    quality degrading first), not an alarm.

    SIGN CONVENTION (got this backwards once — a synthetic series built to LEAD the event by 15 frames
    was reported as +15 and labelled "consistent with an alert", the exact wrong call): k is defined so
    that POSITIVE k means the flag FOLLOWS the event. We therefore compare flag[i] against
    event[i - k]: at k=+15 the flag is matched to an event 15 frames EARLIER, i.e. the flag lags it."""
    out = []
    n = len(flag)
    for k in range(-span, span + 1):
        f, e = [], []
        for i in range(n):
            j = i - k
            if 0 <= j < n:
                f.append(flag[i])
                e.append(event[j])
        out.append((k, phi(f, e)))
    return out


def describe_values(vals: list[int]) -> str:
    """Is the non-zero value set a BITFIELD (powers of two / small OR-combinations) or a CONTINUOUS
    range? A perfusion index reads as a spread of magnitudes; a flag set reads as powers of two."""
    nz = sorted({v for v in vals if v})
    if not nz:
        return "no non-zero observations"
    pow2 = [v for v in nz if v and (v & (v - 1)) == 0]
    frac = len(pow2) / len(nz)
    shape = ("looks like a BITFIELD (all powers of two)" if frac == 1.0
             else "mixed — powers of two plus combinations (bitfield with OR'd flags?)" if frac >= 0.5
             else "looks CONTINUOUS (few powers of two) — magnitude-like, e.g. an index")
    return f"{len(nz)} distinct non-zero values {nz[:24]}{'…' if len(nz) > 24 else ''} — {shape}"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Identify O2Ring live-header byte [11] from a sidecar.")
    ap.add_argument("path")
    ap.add_argument("--desat-drop", type=int, default=3, help="points below the 120 s baseline (default 3)")
    ap.add_argument("--desat-floor", type=int, default=90, help="absolute SpO2 floor (default 90)")
    ap.add_argument("--perm", type=int, default=20000, help="permutation iterations (default 20000)")
    ap.add_argument("--seed", type=int, default=20260718, help="permutation seed (reproducible by default)")
    a = ap.parse_args(argv)

    rows = parse_sidecar(a.path)
    if not rows:
        print("no rows — nothing to analyse")
        return 1
    rng = random.Random(a.seed)
    flags = [r["flag11"] for r in rows]
    nz = [v for v in flags if v]
    worn = [r for r in rows if valid_spo2(r["spo2"])]

    print(f"file        : {os.path.basename(a.path)}")
    print(f"frames      : {len(rows)}  ({rows[0]['t']} → {rows[-1]['t']})")
    print(f"worn frames : {len(worn)} with a valid SpO2 reading")
    print(f"flag11 != 0 : {len(nz)} frames ({100 * len(nz) / max(1, len(rows)):.2f}%)")
    print(f"values      : {describe_values([v for v in flags if v is not None])}")
    print()

    if not nz:
        print("VERDICT: byte [11] never left 0 in this recording — it cannot be identified from this")
        print("file. Capture a night that actually contains desaturation events, then re-run.")
        return 0
    if not worn:
        print("VERDICT: no valid SpO2 readings — the ring was not worn. Association is untestable.")
        return 0

    fb = [bool(r["flag11"]) for r in rows]
    desat = mark_desat(rows, a.desat_drop, a.desat_floor)
    print(f"desat frames: {sum(desat)} (>= {a.desat_drop} pts below the 120 s baseline, or < {a.desat_floor}%)")
    print()

    # ── H1 ALERT vs H3 MOTION vs H4 NUISANCE: association with each candidate driver ────────────────
    print("association of flag11!=0 with each candidate driver (permutation test on |phi|):")
    drivers = {
        "desaturation episode  (H1 alert)": desat,
        "motion byte > 0       (H3 motion)": [bool(r["motion"]) for r in rows],
        "off-finger / contact  (H4 nuisance)": [r["contact"] == 0 for r in rows],
        "low battery (<20%)    (H4 nuisance)": [(r["batt"] is not None and r["batt"] < 20) for r in rows],
    }
    for label, series in drivers.items():
        if len(set(series)) < 2:
            print(f"  {label:36}  n/a — driver never varies in this recording")
            continue
        obs, p = perm_test(fb, series, a.perm, rng)
        star = "  <-- significant" if p < 0.01 and abs(obs) >= 0.2 else ""
        print(f"  {label:36}  phi={obs:+.3f}  p={p:.4f}{star}")
    print()

    # ── H2 PERFUSION: a continuous index cannot be zero most of the time ────────────────────────────
    frac_nz_worn = sum(1 for r in rows if valid_spo2(r["spo2"]) and r["flag11"]) / len(worn)
    print(f"H2 perfusion check: flag11 non-zero in {100 * frac_nz_worn:.1f}% of WORN frames")
    print("  a perfusion index is a continuous measurement — it should be non-zero essentially always.")
    print("  " + ("consistent with H2." if frac_nz_worn > 0.9 else
                  "INCONSISTENT with H2 — a mostly-zero series is an event marker, not an index."))
    print()

    # ── Timing: an alert cannot precede its trigger ─────────────────────────────────────────────────
    if sum(desat) and sum(fb):
        ll = lead_lag(fb, desat)
        best_k, best_v = max(ll, key=lambda kv: abs(kv[1]))
        print(f"lead/lag: peak |phi| at lag {best_k:+d} frames (~{best_k} s), phi={best_v:+.3f}")
        print("  lag >= 0 => flag at or AFTER the desaturation: consistent with an ALERT (a response).")
        print("  lag <  0 => flag LEADS the event: no alarm can do that — that is a predictor")
        print("             (perfusion/signal quality degrading first), so H1 would be wrong.")
    print()
    print("Report the numbers; do not name the byte on one night. Two nights agreeing, or a single")
    print("night with a strong association AND a non-negative lag, is the bar.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
