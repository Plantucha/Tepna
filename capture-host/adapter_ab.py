# tepna-capture — adapter_ab.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# A/B ONE BLE ADAPTER AGAINST ANOTHER, ON THE SAME SENSORS.
#
# Three dongles now sit on the box — a TP-Link UB500 (Realtek RTL8761B), the Intel onboard, and a
# Raytac MDBT50Q on Zephyr USB HCI. "Which one receives better?" is a measurable question and a
# datasheet cannot answer it: TX power and rated sensitivity say what a radio can do on a bench, not
# what it does through a duvet at 03:00 with the sensor on the far side of a sleeping body.
#
# ── WHAT IS COMPARED, AND WHY THESE THREE ─────────────────────────────────────────────────────────
#   RSSI          the direct signal-strength answer. Reported as MEDIAN plus the 10th percentile,
#                 because a link is not characterised by its typical moment — it is characterised by
#                 its bad ones. Two adapters can share a median and differ entirely in how deep the
#                 troughs go, and it is the troughs that drop packets.
#   link churn    connects per hour. A radio that holds one link all night and one that reconnects
#                 forty times can post the same RSSI while producing very different nights.
#   coverage      per-stream captured fraction, from the timeline. The outcome that actually matters:
#                 RSSI and churn are means, this is the end.
#
# ── WHY IT REFUSES TO COMPARE UNLABELLED NIGHTS ───────────────────────────────────────────────────
# Each night is read for the adapter stamped in its LINK sidecar (writers.LinkLogWriter). A night
# with no stamp predates that and CANNOT be attributed — this tool will say so and stop rather than
# let the operator supply the label from memory. The entire experiment is "which radio", so a
# remembered label is the one input that must never be trusted.
#
# ── AND WHY IT SAYS WHAT IT CANNOT CONTROL ────────────────────────────────────────────────────────
# This is an observational A/B, not a randomised one. Two nights differ in radio AND in body
# position, room temperature, battery level, how the strap sat. A 2 dB difference is not a finding; a
# 10 dB difference on every device probably is. The report prints the per-device deltas and leaves
# the verdict to a human, because the honest summary of one night against one night is "suggestive".
from __future__ import annotations

import os
import statistics as _st

import timeline


def _pct(xs: list[float], p: float) -> float | None:
    if not xs:
        return None
    s = sorted(xs)
    i = max(0, min(len(s) - 1, int(round((p / 100.0) * (len(s) - 1)))))
    return s[i]


def night_profile(night_dir: str, devices: list[dict]) -> dict:
    """Everything one night says about link quality, keyed by device."""
    dirs = [night_dir]
    stamps = timeline.link_adapter(night_dir)
    link = timeline.read_link_samples(dirs)
    tl = timeline.build(night_dir, devices)
    cover = {}
    for d in tl.get("devices") or []:
        cover[d.get("name")] = {s: v.get("coverage_pct") for s, v in (d.get("streams") or {}).items()}

    # `devices` is built in its own dict rather than through `out["devices"]`: `out` is genuinely
    # heterogeneous (str · list|None · dict), so its value type is `object`, and indexing an `object`
    # is not a type error the annotation can talk its way out of — it is the annotation being honest.
    dev_rows: dict[str, dict] = {}
    out: dict[str, object] = {"night": os.path.basename(night_dir.rstrip("/")),
           "adapter": sorted(set(stamps.values())) or None,
           "devices": dev_rows}
    for d in devices:
        # A nameless device previously keyed its row under a literal `null` in the emitted JSON. The
        # address is the identity that always exists (`ble-identity-is-address-only`), so it is the
        # fallback; `keys` still carries both, so the sample lookup is unchanged either way.
        name = d.get("name") or d.get("address") or "?"
        keys = [d.get("address"), d.get("name"), *(d.get("name_aliases") or [])]
        samples = timeline.merge_link_samples(link, keys)
        rssi = [r for _, _, r in samples if r is not None]
        conn = [c for _, c, _ in samples]
        span_h = ((samples[-1][0] - samples[0][0]) / 3600.0) if len(samples) > 1 else 0.0
        # Connect EDGES, not the raw connected count: 0->1 transitions are reconnects.
        edges = sum(1 for i in range(1, len(conn)) if conn[i] == 1 and conn[i - 1] == 0)
        dev_rows[name] = {
            "samples": len(samples),
            "rssi_median": round(_st.median(rssi), 1) if rssi else None,
            "rssi_p10": _pct(rssi, 10),
            "rssi_worst": min(rssi) if rssi else None,
            "frac_below_85": round(sum(1 for r in rssi if r <= -85) / len(rssi), 3) if rssi else None,
            "connected_frac": round(sum(1 for c in conn if c) / len(conn), 3) if conn else None,
            "reconnects_per_h": round(edges / span_h, 2) if span_h > 0 else None,
            "coverage_pct": cover.get(name) or {},
        }
    return out


def compare(a: dict, b: dict) -> dict:
    """B minus A, per device. Positive rssi delta = B received a STRONGER signal."""
    rows = []
    for name in sorted(set(a["devices"]) | set(b["devices"])):
        da, db = a["devices"].get(name) or {}, b["devices"].get(name) or {}
        def d(k):
            x, y = da.get(k), db.get(k)
            return round(y - x, 2) if isinstance(x, (int, float)) and isinstance(y, (int, float)) else None
        rows.append({"device": name, "a": da, "b": db,
                     "d_rssi_median": d("rssi_median"), "d_rssi_p10": d("rssi_p10"),
                     "d_frac_below_85": d("frac_below_85"), "d_reconnects_per_h": d("reconnects_per_h")})
    return {"a": a["night"], "b": b["night"],
            "adapter_a": a["adapter"], "adapter_b": b["adapter"], "rows": rows}


def unattributable(*profiles: dict) -> list[str]:
    """Nights whose LINK sidecar carries no adapter stamp — they cannot enter the comparison.

    Not a warning. The experiment is "which radio", so a night that cannot name its radio has nothing
    to contribute, and letting the operator supply the label from memory is precisely the assertion
    this whole file exists to avoid."""
    return [p["night"] for p in profiles if not p.get("adapter")]


def render(cmp_: dict) -> str:
    L = []
    L.append(f"  A: {cmp_['a']}  adapter={cmp_['adapter_a']}")
    L.append(f"  B: {cmp_['b']}  adapter={cmp_['adapter_b']}")
    L.append("")
    L.append(f"  {'device':22s} {'rssi med A/B':>16s} {'Δmed':>7s} {'p10 A/B':>14s} {'Δp10':>7s} "
             f"{'<-85dBm A/B':>15s} {'recon/h A/B':>13s}")
    for r in cmp_["rows"]:
        a, b = r["a"], r["b"]
        def pair(k, f="{}"):
            x, y = a.get(k), b.get(k)
            return f"{'—' if x is None else f.format(x)}/{'—' if y is None else f.format(y)}"
        L.append(f"  {r['device']:22s} {pair('rssi_median'):>16s} {str(r['d_rssi_median'] or '—'):>7s} "
                 f"{pair('rssi_p10'):>14s} {str(r['d_rssi_p10'] or '—'):>7s} "
                 f"{pair('frac_below_85'):>15s} {pair('reconnects_per_h'):>13s}")
    L.append("")
    L.append("  Δ is B − A. Positive Δrssi = B heard the sensor MORE strongly.")
    L.append("  One night vs one night is SUGGESTIVE, not conclusive: body position, room, battery and")
    L.append("  strap fit all moved too. Treat a few dB as noise; treat 10 dB on every device as real.")
    return "\n".join(L)
