# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""solid_night — the SOLID-NIGHT verdict's composition core (SOLID-NIGHT-2026-09-23-BRIEF §3).

One `tepna.verdict/1` per night, gate `solid-night`, over the night's SCORED devices. This module is the
part with no missing supplier: it takes band decisions that are ALREADY made and applies §3.1 — the
precedence, the population equality, the settle trigger and the consecutive count. The band suppliers
(the loss audit's per-gap causes, the seam sidecar's `# pmd` line, the acquisition envelope, the RUNS
sidecar, ADAPTERHCI) are wired in later units; keeping them out of here keeps this testable on its own.

PRECEDENCE (§3.1), first match wins:
  1. UNKNOWN `not settled`  — until night N+1's first data write; overrides everything.
  2. FAIL                   — any scored device FAILs any band. A clear failure is not hidden behind
                              another device's UNKNOWN.
  3. UNKNOWN                — no FAIL, but some band on some scored device could not be decided.
  4. NOT_APPLICABLE         — every expected device is NOT_APPLICABLE (nobody wore anything, witnessed).
  5. PASS                   — every scored device passes every band.

A device with NO band decisions is UNKNOWN, never PASS: a device judged on nothing has not been judged
(the examined-nothing shape this suite keeps finding). An empty expected list is UNKNOWN for the same
reason — the verdict contract would refuse a PASS over `checked: 0` anyway, and this says why.
"""

from __future__ import annotations

import datetime as _dt

import verdict as _v

GATE = "solid-night"
TOOL = "capture-host/solid_night.py"
NOT_SETTLED = "not settled"
EXIT_SOLID = 14
CRITERION = {
    "name": "failing band decisions across the night's scored devices (SOLID-NIGHT §3.4)",
    "threshold": 0,
    "unit": "failing band decisions",
    "direction": "eq",
}
_BAND_OUTCOMES = ("PASS", "FAIL", "UNKNOWN")


def device_outcome(bands: dict) -> tuple[str, list[str]]:
    """One scored device's outcome from its band decisions `{band: {"status", "reason"}}`.

    FAIL outranks UNKNOWN outranks PASS. Returns the outcome and the reasons of the class that decided
    it (empty for a PASS). An empty band set is UNKNOWN."""
    if not bands:
        return "UNKNOWN", ["no band was evaluated for this device"]
    for band, decision in bands.items():
        if decision.get("status") not in _BAND_OUTCOMES:
            raise ValueError(f"band {band!r}: status {decision.get('status')!r} is not one of {_BAND_OUTCOMES}")
    fails = [f"{b}: {d.get('reason') or 'failed'}" for b, d in bands.items() if d["status"] == "FAIL"]
    if fails:
        return "FAIL", fails
    unknowns = [f"{b}: {d.get('reason') or 'undecided'}" for b, d in bands.items() if d["status"] == "UNKNOWN"]
    if unknowns:
        return "UNKNOWN", unknowns
    return "PASS", []


def compose(
    *,
    night: str,
    settled: bool,
    devices: dict,
    evidence: list,
    commit: str | None = None,
    at: str | None = None,
) -> dict:
    """The night's `tepna.verdict/1`.

    `devices` is the night's EXPECTED list (§3.2 — per night, from the capture's own device set):
    `{name: {"applicable": False, "reason": str}}` for a witnessed no-wear device, otherwise
    `{name: {"bands": {...}}}`. A device whose applicability is not stated is SCORED: an unstated
    witness is not a witness."""
    na = {n: d for n, d in devices.items() if d.get("applicable") is False}
    scored = {n: d for n, d in devices.items() if d.get("applicable") is not False}
    outcomes = {n: device_outcome(d.get("bands") or {}) for n, d in scored.items()}
    failing = {n: rs for n, (st, rs) in outcomes.items() if st == "FAIL"}
    unknown = {n: rs for n, (st, rs) in outcomes.items() if st == "UNKNOWN"}
    result = {
        "night": night,
        "devices": {n: {"status": st, "reasons": rs} for n, (st, rs) in outcomes.items()},
        "not_applicable": {n: d.get("reason") for n, d in na.items()},
        "failing": sum(len(rs) for rs in failing.values()),
        "unknown": sum(len(rs) for rs in unknown.values()),
    }
    common = {
        "gate": GATE,
        "population": {"checked": len(scored), "eligible": len(devices), "excluded": len(na)},
        "criterion": CRITERION,
        "evidence": evidence,
        "tool": TOOL,
        "commit": commit,
        "at": at,
    }
    if not settled:
        return _v.make(status="UNKNOWN", result=result, reason=NOT_SETTLED, **common)
    if not devices:
        return _v.make(
            status="UNKNOWN", result=result, reason="no expected device is declared for this night", **common
        )
    if failing:
        why = "; ".join(f"{n} — {r}" for n, rs in failing.items() for r in rs)
        return _v.make(status="FAIL", result=result, reason=why, **common)
    if unknown:
        why = "; ".join(f"{n} — {r}" for n, rs in unknown.items() for r in rs)
        return _v.make(status="UNKNOWN", result=result, reason=why, **common)
    if not scored:
        why = "nobody wore anything: " + "; ".join(f"{n} — {r}" for n, r in result["not_applicable"].items())
        return _v.make(status="NOT_APPLICABLE", result=None, reason=why, **common)
    return _v.make(status="PASS", result=result, reason=None, **common)


def consecutive(nights: list[tuple[str, str, str | None]]) -> dict:
    """The current run, from `(date, status, reason)` per night, in any order.

    §3.1: PASS adds one · NOT_APPLICABLE SKIPS (neither adds nor resets) · FAIL and a SETTLED UNKNOWN
    RESET — a night that cannot be assessed must not bridge a run (§∅). The LATEST night, when it is
    UNKNOWN `not settled`, is PENDING: excluded, neither counted nor resetting. A `not settled` night
    that is NOT the latest should have settled when its successor started, so it is treated as what it
    is — unassessed — and resets. Any other status is not solid and resets.

    The exit reads "S solid of N nights over D days": N counts PASS and NOT_APPLICABLE nights from the
    run's first PASS to its last, D the calendar days between them inclusive, so a run stretched by
    weeks of skips stays visible."""
    ordered = sorted(nights, key=lambda n: _dt.date.fromisoformat(n[0]))
    pending = None
    if ordered and ordered[-1][1] == "UNKNOWN" and ordered[-1][2] == NOT_SETTLED:
        pending = ordered[-1][0]
        ordered = ordered[:-1]
    solid = span_nights = na_since_pass = 0
    run: tuple[_dt.date, _dt.date] | None = None  # (first PASS, last PASS) — both or neither
    for date, status, _reason in ordered:
        day = _dt.date.fromisoformat(date)
        if status == "PASS":
            run = (run[0] if run else day, day)
            solid += 1
            span_nights += na_since_pass + 1
            na_since_pass = 0
        elif status == "NOT_APPLICABLE":
            if run:
                na_since_pass += 1
        else:
            solid = span_nights = na_since_pass = 0
            run = None
    return {
        "solid": solid,
        "nights": span_nights,
        "days": (run[1] - run[0]).days + 1 if run else 0,
        "first": run[0].isoformat() if run else None,
        "last": run[1].isoformat() if run else None,
        "pending": pending,
        "exit": solid >= EXIT_SOLID,
        "statement": f"{solid} solid of {span_nights} nights over {(run[1] - run[0]).days + 1 if run else 0} days",
    }
