# tepna-capture — link_distress.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# IS THIS RADIO COPING? — the continuous signal the failover mechanism never had.
#
# The mechanism itself is old and wired (capture.py DUAL-RADIO FAILOVER, P1.5): it picks a healthy
# spare, repoints the process-global pin, re-bonds, and every device task follows. What it lacked was
# a reason to fire other than "the recovery ladder is spent" — i.e. WEDGED. A radio that is up,
# answering, and simply cannot hold its links produced no trigger at all, and the night it happened
# (2026-08-29, the O2Ring reconnect storm) nothing switched and nothing said why.
#
# 🔴 THE BANDS ARE PRE-STATED AND MEASURED PER ARM — see
# `briefs/RADIO-FAILOVER-DISTRESS-SIGNAL-2026-08-29-BRIEF.md`, written before this file existed. That
# ordering is the point: `auto_stop`'s eps came from the wrong reference state precisely because the
# number was chosen after looking at a trace, and it nearly truncated a live recording.
#
# WHAT IS AND IS NOT A SIGNAL, from that measurement:
#   · RECONNECT RATE is the signal. The storm reads 13.72/h against that device's own 0.23 median on
#     that adapter — ~60×, separable by a wide margin rather than a hair.
#   · `down%` is NOT, and it is the obvious choice, which is why it is named here: medians of 35–78 %
#     for the H10 and the ring are WEAR — the strap comes off inside its own connected span — so a
#     trigger on it fires on an ordinary night. Carried as report-only.
#   · `frames_dropped` was 0 in every file in the corpus. Not usable here, not proposed.

from __future__ import annotations

import datetime as _dt
import math
import re
import statistics

__all__ = [
    "OK",
    "DISTRESSED",
    "UNKNOWN",
    "FLOOR_PER_H",
    "BASELINE_MULT",
    "HYSTERESIS_S",
    "MIN_BASELINE_NIGHTS",
    "baseline_median",
    "band_for",
    "assess",
    "switch_event",
]

OK = "ok"
DISTRESSED = "distressed"
UNKNOWN = "unknown"

# Above every non-storm observation in the corpus (highest 4.67/h, Verity on the Sena) and far below
# the storm (13.72/h). An ABSOLUTE floor, so a device whose own baseline is near zero cannot be called
# distressed by a couple of ordinary reconnects.
FLOOR_PER_H = 8.0

# ...and a RELATIVE arm, so a device with a legitimately high baseline is not distressed by being
# itself. BOTH must be exceeded. This is what makes the rule per-arm rather than global — the same
# reason a wedge verdict is judged against an adapter's own history and never a sibling's.
BASELINE_MULT = 10.0

# A reconnect storm is SUSTAINED — the 2026-08-29 one ran five hours. A mask-off, a charger touch or
# a doorway is not. Deliberately much looser than the threshold is tight: switching late costs a bad
# hour, flapping a device between radios all night costs the night.
HYSTERESIS_S = 900.0

# Below this there is no baseline, and therefore no verdict. A new adapter — the AX210 has ZERO
# nights — gets no learned threshold, no affinity and no assumed superiority until three exist.
MIN_BASELINE_NIGHTS = 3


def baseline_median(per_night_rates):
    """`(median, n)` for one device on one adapter, or `(None, n)` below the minimum. PURE.

    None is "no baseline", NOT zero: a zero baseline would make `BASELINE_MULT` collapse and leave
    the floor deciding alone, which is exactly the global rule this exists to avoid."""
    vals = []
    for r in per_night_rates or []:
        try:
            v = float(r)
        except (TypeError, ValueError):
            continue   # a MEDIAN over the rates that parsed; the caller is given the count it was
                       # computed from, so a dropped sample narrows the claim rather than hiding
        if v == v and v not in (float("inf"), float("-inf")) and v >= 0:
            vals.append(v)
    if len(vals) < MIN_BASELINE_NIGHTS:
        return None, len(vals)
    return statistics.median(vals), len(vals)


def band_for(median, *, floor_per_h: float = FLOOR_PER_H, mult: float = BASELINE_MULT):
    """The rate a device must EXCEED on this adapter, or None when there is no baseline. PURE."""
    if median is None:
        return None
    return max(float(floor_per_h), float(mult) * float(median))


def assess(
    observed_per_h,
    per_night_rates,
    sustained_s,
    *,
    floor_per_h: float = FLOOR_PER_H,
    mult: float = BASELINE_MULT,
    hysteresis_s: float = HYSTERESIS_S,
) -> dict:
    """`{state, detail, observed, band, median, nights, sustained_s}` — is this link distressed? PURE.

    UNKNOWN is a real answer and is never folded into OK: without ≥3 nights on THIS adapter there is
    no baseline, and calling that healthy would let a brand-new radio look proven on its first night.
    A caller must not be able to read a refusal as an all-clear."""
    median, nights = baseline_median(per_night_rates)
    try:
        obs = float(observed_per_h)
        held = float(sustained_s)
        # 🔴 NaN PASSES `float()` AND FAILS EVERY COMPARISON, so an unusable rate would fall through
        # every guard below and arrive at DISTRESSED — a spurious radio switch from a value that says
        # nothing. `math.isfinite` is the check; `>= 0` catches a negative rate, which is not a
        # measurement either. Found by the test, not by reading the code.
        if not (math.isfinite(obs) and math.isfinite(held)) or obs < 0 or held < 0:
            raise ValueError("non-finite or negative")
    except (TypeError, ValueError):
        return {
            "state": UNKNOWN,
            "detail": f"unusable inputs: observed={observed_per_h!r} sustained={sustained_s!r}",
            "observed": None,
            "band": None,
            "median": median,
            "nights": nights,
            "sustained_s": None,
        }
    band = band_for(median, floor_per_h=floor_per_h, mult=mult)
    base = {
        "observed": round(obs, 2),
        "band": None if band is None else round(band, 2),
        "median": None if median is None else round(median, 3),
        "nights": nights,
        "sustained_s": round(held, 1),
    }
    if band is None:
        return {
            **base,
            "state": UNKNOWN,
            "detail": f"no baseline — {nights} night(s) on this adapter, {MIN_BASELINE_NIGHTS} "
            f"needed; a new radio is not proven by its first night",
        }
    if obs <= band:
        return {
            **base,
            "state": OK,
            "detail": f"{obs:.1f}/h within band {band:.1f}/h "
            f"(max of {floor_per_h:.1f} floor, {mult:.0f}x median {median:.2f})",
        }
    if held < float(hysteresis_s):
        return {
            **base,
            "state": OK,
            "detail": f"{obs:.1f}/h over band {band:.1f}/h but held only {held:.0f}s of "
            f"{float(hysteresis_s):.0f}s — not yet sustained",
        }
    return {
        **base,
        "state": DISTRESSED,
        "detail": f"{obs:.1f}/h over band {band:.1f}/h (max of {floor_per_h:.1f} floor, "
        f"{mult:.0f}x median {median:.2f}) sustained {held:.0f}s",
    }


def switch_event(*, device, from_mac, to_mac, verdict, cause="reconnect-rate"):
    """The record a switch emits. PURE.

    🔴 IT CARRIES WHICH SIGNAL FIRED AND ITS VALUE, not merely that a switch happened. A switch that
    leaves only "failed over" is half-silent, and silent healing is the defect class this whole unit
    exists inside: it happens, and nothing that survives the night says why. `band` and `median` ride
    along so a reader can tell a marginal trip from a 60x one without re-deriving the threshold."""
    v = verdict or {}
    return {
        "event": "radio-failover",
        "device": device,
        "from": from_mac,
        "to": to_mac,
        "cause": cause,
        "observed_per_h": v.get("observed"),
        "band_per_h": v.get("band"),
        "baseline_median_per_h": v.get("median"),
        "baseline_nights": v.get("nights"),
        "sustained_s": v.get("sustained_s"),
        "detail": v.get("detail"),
    }


# ── the BASELINE PRODUCER — what makes the signal above more than report-only ────────────────────
# `assess` refuses without >=3 nights per device per adapter, and nothing wrote those nights, so on
# every box today every verdict is honestly UNKNOWN. This is the missing half.
#
# 🔴 THE RATE IS OVER THE CONNECTED SPAN, NOT THE FILE. Measured 2026-08-29 while deriving the bands:
# normalising over the whole file gives `down% = 100` for a backup strap that was never worn and
# dilutes every rate by the hours a device sat in a drawer. The question is "how often did this link
# drop WHILE IT WAS UP", and only the connected span asks it.
LINK_ADAPTER_RE = re.compile(r"adapter=([0-9A-Fa-f:]{17})")
MIN_SESSION_H = 1.0  # below this a "rate" is one reconnect over a few minutes — noise, not a night
MIN_SAMPLES = 20


def night_rates(text):
    """`(adapter_mac, {device: reconnects_per_hour})` for ONE LINK.csv, or `(None, {})`. PURE.

    The adapter comes from the file's own `# adapter=<MAC> hci=<hciN>` header, so a rate is
    attributable to the radio that produced it without the caller guessing — which matters because
    the wearables moved UB500 -> Sena mid-corpus, making the two arms SEQUENTIAL populations that must
    never be pooled.

    A device with fewer than `MIN_SAMPLES` rows or a connected span under `MIN_SESSION_H` is omitted
    rather than given a rate: one reconnect across four minutes is 15/h, which would trip any band."""
    lines = str(text or "").splitlines()
    if not lines:
        return None, {}
    m = LINK_ADAPTER_RE.search(lines[0])
    adapter = m.group(1).upper() if m else None
    hdr = None
    rows = {}
    for line in lines[1:]:
        parts = line.rstrip("\n").split(";")
        if hdr is None:
            if "Phone timestamp" in parts:
                hdr = parts
            continue
        try:
            it, idev, ic, ie = (hdr.index(x) for x in ("Phone timestamp", "device", "connected", "link_epoch"))
        except ValueError:
            return adapter, {}
        if len(parts) <= max(it, idev, ic, ie):
            continue
        try:
            t = _dt.datetime.fromisoformat(parts[it]).timestamp()
            ep = int(parts[ie] or 0)
        except (ValueError, TypeError):
            continue   # a row with no usable timestamp or epoch cannot be placed in a night
        rows.setdefault(parts[idev], []).append((t, parts[ic].strip().lower() in ("1", "true"), ep))
    out = {}
    for dev, rs in rows.items():
        rs.sort()
        on = [r for r in rs if r[1]]
        if len(on) < MIN_SAMPLES:
            continue
        span_h = (on[-1][0] - on[0][0]) / 3600.0
        if span_h < MIN_SESSION_H:
            continue
        out[dev] = (len({r[2] for r in on}) - 1) / span_h
    return adapter, out


def merge_baselines(prior, adapter, rates, *, keep=14):
    """Fold ONE night's rates into the baseline record. PURE; returns a NEW dict.

    Keeps the most recent `keep` nights per (adapter, device). Bounded because a baseline that grows
    forever eventually describes a radio that no longer exists — and because the median should track
    the box as it is now, not as it was two months ago. Newest LAST, so a reader can see the trend."""
    out = {a: {d: list(v) for d, v in devs.items()} for a, devs in (prior or {}).items()}
    if not adapter or not rates:
        return out
    slot = out.setdefault(adapter, {})
    for dev, rate in rates.items():
        try:
            r = float(rate)
        except (TypeError, ValueError):
            continue   # merging baselines: an unparseable rate is NOT a zero rate, and folding it
                       # in as one would drag every merged baseline toward the floor
        if not math.isfinite(r) or r < 0:
            continue
        slot.setdefault(dev, []).append(round(r, 4))
        slot[dev] = slot[dev][-int(keep) :]
    return out
