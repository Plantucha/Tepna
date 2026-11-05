# tepna-capture — battery_health.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Battery ageing, pushed (owner, 2026-11-04: "wire up some ntfy for battery degradation for all devices").

THE SIGNAL. A rechargeable cell that loses capacity drains FASTER in percent per hour for the same load. Each
night this module reads a device's `battery_pct` from the LINK sidecars over the night band (22:00-06:00) and
keeps one figure: the drain in %/h. The device's own first BASELINE_NIGHTS qualifying nights are its baseline;
the median of its last RECENT_NIGHTS is its present. Capacity is estimated as baseline / present.

WHAT IT MEASURED, capture box 2026-07-25 -> 2026-11-04, this exact rule:

    device         qualifying nights   baseline %/h   present %/h   present / baseline
    O2Ring              73                3.33           3.89         1.17
    Verity Sense        48                4.26           4.58         1.07

AGEING_DRAIN_RATIO = 1.25 is the 80 % capacity point (1 / 0.8), the usual end-of-life mark for a Li-ion cell.
It sits over both present ratios. The push repeats at each further
CAPACITY_STEP_PCT lost, never twice for one step.

THE H10 IS OUT, on purpose. Its coin cell is not recharged, so it does not age, it empties; and its gauge reports
in 10 % steps, so its %/h read 0.00 to 4.68 on that population, which is not a measurement. Its emptying already
pushes at 20 % and 10 % (`alerts.battery_alert_step`) and before a night it cannot last
(`alerts.night_battery_short`).

THE RING'S GAUGE NOISE. `loss_audit.ring_dock_witness` calls a ring end a doff when the battery rises
RING_DOCK_RISE_PCT after it. An aged cell sags more under load, so its gauge reads larger false rises while
worn. Worn spans (the ring's SpO2 files) rose at most +3 over the whole population. This module records each
night's largest rise INSIDE those spans and pushes once when it reaches RING_DOCK_RISE_PCT - 1. Over the whole
night band instead, the ring rose +5 on 7 nights (off-finger and near-full docks), so the span limit is load-
bearing, not a refinement.

A night where any 600 s window rose RING_DOCK_RISE_PCT or more was charged and gives no drain figure. A night
under NIGHT_MIN_H or NIGHT_MIN_ROWS gives none either. An empty battery field is absent and skipped, never 0."""

from __future__ import annotations

import copy
import datetime as _dt
import glob
import logging
import os
import statistics

import loss_audit
import nights_index as _ni

log = logging.getLogger("tepna.battery_health")

STATE_NAME = "battery-health.json"
AGEING_MODELS = ("o2ring", "verity")  # rechargeable; matched in the config `model`, case-insensitive
RING_MODEL = "o2ring"
BAND_START_H, BAND_END_H = 22, 6
NIGHT_MIN_H = 6.0
NIGHT_MIN_ROWS = 20
WINDOW_S = 600.0
CHARGE_RISE_PCT = loss_audit.RING_DOCK_RISE_PCT
NOISE_ALERT_PCT = loss_audit.RING_DOCK_RISE_PCT - 1
BASELINE_NIGHTS = 14
RECENT_NIGHTS = 7
RECENT_MIN = 5
AGEING_DRAIN_RATIO = 1.25
CAPACITY_STEP_PCT = 10
_RING_SPO2 = "Wellue_O2Ring-S_*_SPO2.csv"
_HEAD_LINES = 20
_TAIL_BYTES = 4096


def is_night(name: str) -> bool:
    """A night folder's name: a real `YYYY-MM-DD` date."""
    try:
        return len(name) == 10 and _dt.date.fromisoformat(name) is not None
    except ValueError:
        return False


def in_band(t: _dt.datetime) -> bool:
    return t.hour >= BAND_START_H or t.hour < BAND_END_H


def night_of(t: _dt.datetime) -> str:
    """The night a band row belongs to: the date the evening began."""
    return (t - _dt.timedelta(hours=12)).date().isoformat()


def max_rise(rows: list[tuple[_dt.datetime, int]]) -> int:
    """The largest rise from a row to any later row within WINDOW_S. PURE; rows sorted."""
    best = 0
    for i, (t0, b0) in enumerate(rows):
        for t1, b1 in rows[i + 1 :]:
            if (t1 - t0).total_seconds() > WINDOW_S:
                break
            best = max(best, b1 - b0)
    return best


def night_drain(rows: list[tuple[_dt.datetime, int]]) -> float | None:
    """One night's drain in %/h, or None for a charged or short night. PURE; rows sorted, band only."""
    if len(rows) < NIGHT_MIN_ROWS or max_rise(rows) >= CHARGE_RISE_PCT:
        return None
    hours = (rows[-1][0] - rows[0][0]).total_seconds() / 3600
    if hours < NIGHT_MIN_H:
        return None
    return round((rows[0][1] - rows[-1][1]) / hours, 3)


def worn_max_rise(rows: list[tuple[_dt.datetime, int]], spans: list[tuple[_dt.datetime, _dt.datetime]]) -> int | None:
    """The largest rise inside any worn span, or None when no span holds two rows. PURE."""
    found = None
    for a, b in spans:
        inside = [r for r in rows if a <= r[0] <= b]
        if len(inside) >= 2:
            found = max(found or 0, max_rise(inside))
    return found


def capacity_pct(baseline: float, present: float) -> int | None:
    """Estimated capacity left, in %. None when either figure cannot carry the ratio. PURE."""
    if baseline <= 0 or present <= 0:
        return None
    return round(100 * baseline / present)


def ageing_due(nights: dict[str, float], alerted_pct: int | None) -> tuple[int, float, float] | None:
    """`(capacity %, baseline, present)` when a push is due, else None. PURE.

    Due when the present drain reaches AGEING_DRAIN_RATIO x baseline AND the capacity sits a full
    CAPACITY_STEP_PCT under the last pushed figure (or none was pushed)."""
    vals = [nights[k] for k in sorted(nights)]
    if len(vals) < BASELINE_NIGHTS + RECENT_MIN:
        return None
    base = statistics.median(vals[:BASELINE_NIGHTS])
    present = statistics.median(vals[BASELINE_NIGHTS:][-RECENT_NIGHTS:])
    cap = capacity_pct(base, present)
    if cap is None or present < AGEING_DRAIN_RATIO * base:
        return None
    if alerted_pct is not None and cap > alerted_pct - CAPACITY_STEP_PCT:
        return None
    return cap, base, present


def ageing_text(name: str, cap: int, base: float, present: float) -> tuple[str, str]:
    return (
        f"Tepna: {name} battery is wearing out",
        f"{name} now uses {present:.1f} % per hour overnight. Its first nights used {base:.1f} %. "
        f"That is about {cap} % of its starting capacity.",
    )


def noise_text(name: str, rise: int) -> tuple[str, str]:
    return (
        f"Tepna: {name} battery gauge is unsteady",
        f"While worn, the battery reading of {name} rose {rise} % within 10 minutes. The charger rule "
        f"calls a {CHARGE_RISE_PCT} % rise a removal, so the night check may soon misread one.",
    )


def _model_has(d: dict, *names: str) -> bool:
    """Does the config `model` name one of `names`, case-insensitive? A device without a model names none."""
    m = d.get("model")
    return isinstance(m, str) and any(n in m.lower() for n in names)


def _device_of(row_dev: str, row_addr: str, devices: list[dict]) -> dict | None:
    for d in devices:
        addr = (d.get("address") or "").lower()
        if (addr and row_addr.lower() == addr) or (row_dev and row_dev == d.get("name")):
            return d
    return None


def _band_rows(dirs: list[str], night: str, devices: list[dict]) -> dict[str, list[tuple[_dt.datetime, int]]]:
    """`{device name: sorted [(stamp, battery %)]}` for one night's band, from the LINK sidecars in `dirs`."""
    out: dict[str, list[tuple[_dt.datetime, int]]] = {}
    for path in sorted(p for d in dirs for p in glob.glob(os.path.join(d, "Tepna_*_LINK.csv"))):
        try:
            with open(path, errors="replace") as fh:
                head = fh.readline()
                while head.startswith("#"):  # the radio provenance line (writers.LinkLogWriter)
                    head = fh.readline()
                idx = {k: i for i, k in enumerate(head.rstrip("\n").split(";"))}
                i_ts, i_dev, i_b = idx.get("Phone timestamp"), idx.get("device"), idx.get("battery_pct")
                i_c, i_a = idx.get("connected"), idx.get("address")
                if i_ts is None or i_dev is None or i_b is None:
                    continue  # a sidecar written before the battery column landed
                for line in fh:
                    p = line.rstrip("\n").split(";")
                    if len(p) <= max(i_ts, i_dev, i_b) or (i_c is not None and p[i_c] != "1"):
                        continue
                    try:
                        t, b = _dt.datetime.fromisoformat(p[i_ts]), int(p[i_b])
                    except ValueError:
                        continue  # an empty battery field is ABSENT (never 0); a torn stamp is no row
                    if not in_band(t) or night_of(t) != night:
                        continue
                    dev = _device_of(p[i_dev], p[i_a] if i_a is not None and len(p) > i_a else "", devices)
                    if dev is not None:
                        out.setdefault(dev["name"], []).append((t, b))
        except OSError:
            log.warning("battery health: %s is unreadable, so this night reads without it", path, exc_info=True)
    for v in out.values():
        v.sort()
    return out


def _first_stamp(lines: list[str]) -> _dt.datetime | None:
    return next((s for s in map(_ni.parse_stamp, lines) if s is not None), None)


def _head_stamp(path: str) -> _dt.datetime | None:
    """The first stamp in the file's first _HEAD_LINES lines."""
    with open(path, "rb") as fh:
        return _first_stamp([fh.readline().decode("utf-8", "replace") for _ in range(_HEAD_LINES)])


def _tail_stamp(path: str) -> _dt.datetime | None:
    """The last stamp in the file's last _TAIL_BYTES bytes."""
    with open(path, "rb") as fh:
        fh.seek(max(0, os.path.getsize(path) - _TAIL_BYTES))
        return _first_stamp(fh.read().decode("utf-8", "replace").splitlines()[::-1])


def _ring_spans(dirs: list[str]) -> list[tuple[_dt.datetime, _dt.datetime]]:
    spans = []
    for path in sorted(p for d in dirs for p in glob.glob(os.path.join(d, _RING_SPO2))):
        try:
            a, b = _head_stamp(path), _tail_stamp(path)
        except OSError:
            log.warning("battery health: %s is unreadable, so its worn span is absent", path, exc_info=True)
            continue
        if a is not None and b is not None:
            spans.append((a, b))
    return spans


def update(captures: str, devices: list[dict], today: _dt.date, state: dict | None) -> dict:
    """Add every settled night not yet in `state` (a first run reads the whole history once). Returns the new
    state: `{device name: {"nights": {night: drain}, "noise": {night: rise}, ...latches}}` plus `"done"`."""
    state = copy.deepcopy(state or {})
    done = set(state.get("done") or [])
    ageing = [d for d in devices if _model_has(d, *AGEING_MODELS)]
    try:
        folders = sorted(n for n in os.listdir(captures) if is_night(n))
    except OSError:
        return state
    last_settled = (today - _dt.timedelta(days=1)).isoformat()
    for night in folders:
        if night in done or night > last_settled or not ageing:
            continue
        nxt = (_dt.date.fromisoformat(night) + _dt.timedelta(days=1)).isoformat()
        dirs = [os.path.join(captures, n) for n in (night, nxt)]  # an absent folder globs to nothing
        rows = _band_rows(dirs, night, ageing)
        spans = None
        for d in ageing:
            r = rows.get(d["name"]) or []
            rec = state.setdefault(d["name"], {"nights": {}, "noise": {}})
            drain = night_drain(r)
            if drain is not None:
                rec["nights"][night] = drain
            if _model_has(d, RING_MODEL):
                spans = _ring_spans(dirs) if spans is None else spans
                rise = worn_max_rise(r, spans)
                if rise is not None:
                    rec["noise"][night] = rise
        done.add(night)
    state["done"] = sorted(done)
    return state


def due(state: dict, devices: list[dict]) -> list[tuple[str, str, str, str, int]]:
    """Every push due now: `(device name, kind, title, message, latch value)`. PURE over `state`."""
    out = []
    for d in devices:
        rec = state.get(d.get("name"))
        if not isinstance(rec, dict):
            continue
        hit = ageing_due(rec.get("nights") or {}, rec.get("alerted_capacity"))
        if hit is not None:
            out.append((d["name"], "alerted_capacity", *ageing_text(d["name"], *hit), hit[0]))
        noise = max((rec.get("noise") or {}).values(), default=None)
        if noise is not None and noise >= NOISE_ALERT_PCT and rec.get("alerted_noise") is None:
            out.append((d["name"], "alerted_noise", *noise_text(d["name"], noise), noise))
    return out
