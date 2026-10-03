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
import json
import os
from typing import Any

import solid_night_inputs as _inputs
import verdict as _v

GATE = "solid-night"
TOOL = "capture-host/solid_night.py"
NOT_SETTLED = "not settled"
EXIT_SOLID = 14
VERDICT_NAME = "SOLID-VERDICT.json"
NO_VERDICT = "no solid-night verdict was written for this settled night"
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
    result: dict[str, Any] = {
        "night": night,
        "devices": {n: {"status": st, "reasons": rs} for n, (st, rs) in outcomes.items()},
        "not_applicable": {n: d.get("reason") for n, d in na.items()},
        "failing": sum(len(rs) for rs in failing.values()),
        "unknown": sum(len(rs) for rs in unknown.values()),
    }
    common: dict[str, Any] = {
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
    weeks of skips stays visible.

    One verdict per night: a date given twice is refused, since which of the two counts would be a guess.
    Dates are parsed before sorting, so the order is calendar order whatever ISO spelling came in."""
    parsed = [(_dt.date.fromisoformat(d), st, rs) for d, st, rs in nights]
    if len({day for day, _st, _rs in parsed}) != len(parsed):
        raise ValueError("a night appears twice: one verdict per night")
    ordered = sorted(parsed)  # dates are distinct, so the tuple order IS the date order
    pending = None
    if ordered and ordered[-1][1] == "UNKNOWN" and ordered[-1][2] == NOT_SETTLED:
        pending = ordered[-1][0].isoformat()
        ordered = ordered[:-1]
    solid = span_nights = na_since_pass = 0
    run: tuple[_dt.date, _dt.date] | None = None  # (first PASS, last PASS) — both or neither
    for day, status, _reason in ordered:
        if status == "PASS":
            run = (day if run is None else run[0], day)
            solid += 1
            span_nights += na_since_pass + 1
            na_since_pass = 0
        elif status == "NOT_APPLICABLE":
            if run is not None:
                na_since_pass += 1
        else:
            solid = span_nights = na_since_pass = 0
            run = None
    days = (run[1] - run[0]).days + 1 if run is not None else 0
    return {
        "solid": solid,
        "nights": span_nights,
        "days": days,
        "first": run[0].isoformat() if run is not None else None,
        "last": run[1].isoformat() if run is not None else None,
        "pending": pending,
        "exit": solid >= EXIT_SOLID,
        "statement": f"{solid} solid of {span_nights} nights over {days} days",
    }


def night_verdict(night_dir: str, devices: list, *, commit: str | None = None, at: str | None = None) -> dict:
    """A SETTLED night's verdict, its band decisions supplied from the files beside it (`solid_night_inputs`).

    Only ever called for a settled night: the caller runs on the loss audit's own trigger, which fires once
    night N+1 has begun (§2's settle trigger), so `settled` is True by construction here."""
    return compose(
        night=os.path.basename(night_dir.rstrip("/")),
        settled=True,
        devices=_inputs.score_devices(night_dir, devices),
        evidence=[TOOL, "capture-host/solid_night_inputs.py", os.path.join(night_dir, _inputs.LOSS_AUDIT_NAME)],
        commit=commit,
        at=at,
    )


def history(captures_dir: str, nights: list[str], active: set[str]) -> list[tuple[str, str, str | None]]:
    """`(night, status, reason)` for `consecutive`, from each night's written verdict.

    The run starts at the first night that HAS a verdict — nights before the programme are not nights it
    failed. After that, a settled night with no verdict is UNKNOWN (it was not assessed, so it cannot bridge
    a run — §3.1), and a night with no verdict that is still active is `not settled`.

    🔴 THE WRITTEN VERDICT WINS OVER `active`. A night that has a verdict beside it HAD settled when that
    verdict was composed, and a later file touch cannot un-settle it. Reading `active` first made a
    composed night unassessed, and §3.1 resets the run on a non-latest `not settled` — so the night's own
    PASS would be thrown away by a file written next to it. This is not hypothetical: `active_nights`
    calls a night active when ANY file in its directory is younger than `settle_sec`, and the daemon
    appends the live-vitals `OXYLIFE.csv` into the PREVIOUS night's directory all day. Measured on vigil
    2026-09-29 15:40: `2026-09-28` had device data quiet for 39 702 s and a FAIL verdict written 28 979 s
    earlier, and read `not settled` because `OXYLIFE.csv` was 11.2 s old. The archive's `.archived` marker
    (5703 s old on the same night) is a second instance of the same class. `nightqc.newest_data_mtime`
    exists precisely because a directory-wide mtime answers a different question; the loss-audit trigger
    was taught that and this was not."""
    out: list[tuple[str, str, str | None]] = []
    for night in sorted(nights):
        v = _inputs.read_json(os.path.join(captures_dir, night, VERDICT_NAME))
        if v is not None:
            out.append((night, str(v.get("status")), v.get("reason")))
            continue
        if out:
            out.append((night, "UNKNOWN", NOT_SETTLED if night in active else NO_VERDICT))
    return out


def pending_verdict(
    night_dir: str, devices: list, *, nights: list[str], active: set[str], commit: str | None = None,
    at: str | None = None,
) -> tuple[dict, dict]:
    """The night still being CAPTURED, as `UNKNOWN` `not settled` — composed in memory and never written.

    §2 composes a verdict on the loss audit's own trigger, which fires only once the night has settled.
    That is right for the FILE: a verdict written beside a night whose data is still arriving would be a
    claim over input that does not exist yet. It was wrong for the STATUS surface, which between doff and
    the settle window had nothing new to publish and so kept displaying the PREVIOUS night's verdict under
    the previous night's date — the one case an operator meets every single morning. `compose` has always
    been able to say this (`settled=False`) and `monitor.html` has always been able to render it (the
    `pending` branch styles the card idle rather than as a finding); only the producer was missing.

    NO BAND IS EVALUATED. Scoring an in-flight night would measure completeness against an interval that
    has not finished arriving and publish the shortfall as a finding — an output over absent input (§∅).
    Each expected device therefore carries an EMPTY band set, which `device_outcome` reads as UNKNOWN
    "no band was evaluated for this device", and `result.devices` says exactly that. None of it can reach
    the status word: `compose` returns on `settled` before the band outcomes are consulted.

    The loss audit is deliberately absent from `evidence` — it has not run for this night, and naming a
    file that does not exist is the citation this suite refuses everywhere else."""
    night = os.path.basename(night_dir.rstrip("/"))
    expected: dict[str, dict] = {
        str(d.get("name") or d.get("model")): {"bands": {}} for d in _inputs.expected_devices(night_dir, devices)
    }
    obj = compose(
        night=night,
        settled=False,
        devices=expected,
        evidence=[TOOL, "capture-host/solid_night_inputs.py"],
        commit=commit,
        at=at,
    )
    captures = os.path.dirname(night_dir.rstrip("/"))
    past = [n for n in history(captures, nights, active) if n[0] < night]
    run = consecutive([*past, (night, obj["status"], obj["reason"])])
    # UNCONDITIONAL, unlike `write_night`'s: only NOT_APPLICABLE carries `result: null` by contract, and
    # `compose` returns on `settled` long before it can reach that branch. A guard here would be a branch
    # no input can take — protection against a case the function's own precondition excludes.
    obj["result"]["run"] = run
    _v.validate(obj)
    return obj, run


def write_night(
    night_dir: str, devices: list, *, nights: list[str], active: set[str], commit: str | None = None
) -> tuple[dict, dict]:
    """Write the night's verdict beside its loss audit, with the run AS OF this night in `result.run` — the
    owner's exit counter, "S solid of N nights over D days" (§3.1). Returns `(verdict, run)` — the run
    separately, because a NOT_APPLICABLE verdict carries `result: null` by contract and has nowhere to hold it."""
    obj = night_verdict(night_dir, devices, commit=commit)
    captures = os.path.dirname(night_dir.rstrip("/"))
    night = os.path.basename(night_dir.rstrip("/"))
    past = [n for n in history(captures, nights, active) if n[0] < night]
    run = consecutive([*past, (night, obj["status"], obj["reason"])])
    if obj.get("result") is not None:
        obj["result"]["run"] = run
    _v.validate(obj)
    tmp = os.path.join(night_dir, VERDICT_NAME + ".tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=1)
    os.replace(tmp, os.path.join(night_dir, VERDICT_NAME))
    return obj, run


def sample_object() -> dict:
    """Corpus-free emission for the adoption gate: a synthetic CLEAN H10 night laid out as the box writes one.
    Continuity, completeness, validity and clocks all PASS from their real inputs; the night is still
    UNKNOWN, because the timebase term names the residual pass it waits for — exactly what a real night
    reads until that lands."""
    import tempfile

    base = "Polar_H10_SAMPLE_20260101220000"
    t0 = _dt.datetime(2026, 1, 1, 22, 0, 0)
    with tempfile.TemporaryDirectory() as d:
        night = os.path.join(d, "2026-01-01")
        os.makedirs(night)

        def put(name: str, text: str) -> None:
            with open(os.path.join(night, name), "w", encoding="utf-8") as fh:
                fh.write(text)

        # A REALISTIC device axis and a batch-structured host stamp, for the same reason the test
        # fixtures carry them (clock.js CK_AXIS_DRAWN_SHARE): this column used to advance by 1 ns per
        # row, which is by construction a DRAWN counter, and the timebase term would score the adoption
        # gate's own sample as "not a clock". Host jitter is POSITIVE and skips the first and last batch
        # so no row crosses a whole second and the completeness arithmetic is unchanged.
        rows = []
        for i in range(401):
            ns = int(i / 2 * 1e9) + ((i * 7919) % 211)
            jit = 0 if (i < 4 or i >= 397) else (1 + (i // 4) % 5)
            t = t0 + _dt.timedelta(seconds=i / 2, milliseconds=jit)
            rows.append(f"{t.isoformat(timespec='milliseconds')};{ns};{i};100")
        put(
            f"{base}_ECG.txt",
            "Phone timestamp;sensor timestamp [ns];timestamp [ms];ecg [uV]\n" + "\n".join(rows) + "\n",
        )
        put(
            f"{base}_ECGSEAMS.txt",
            "# pmd stream=ecg negotiated=yes rate=2 offered=2\n# final stream=ecg seams=0 examined=401\n",
        )
        put(f"{base}_ECGRUNS.txt", "# stream=ecg rule=stuck min_run=30\n")
        put(
            _inputs.LOSS_AUDIT_NAME,
            json.dumps(
                {
                    "journal": "read",
                    "devices": {
                        "Polar H10 SAMPLE": {
                            "file": f"{base}_ECG.txt",
                            "gaps": [],
                            "wear": {"available": True, "worn_end": {"at": "2026-01-01T22:03:00", "reason": "doff"}},
                        }
                    },
                }
            ),
        )
        return night_verdict(night, [{"name": "Polar H10 SAMPLE", "model": "H10"}])
