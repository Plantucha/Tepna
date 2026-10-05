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
_BAND_OUTCOMES = ("PASS", "FAIL", "UNKNOWN", "NOT_APPLICABLE")


def device_outcome(bands: dict) -> tuple[str, list[str]]:
    """One scored device's outcome from its band decisions `{band: {"status", "reason"}}`.

    FAIL outranks UNKNOWN outranks PASS, over the device's APPLICABLE bands. Returns the outcome and the
    reasons of the class that decided it (empty for a PASS).

    🔴 `NOT_APPLICABLE` is the verdict contract's own word — "examined and the rule does not bind" — and
    it is the fourth band outcome rather than a flavour of UNKNOWN, because the two say different things
    and decide differently. UNKNOWN is "this band could not be decided", and it resets the run; a band
    that does not bind was never a question about this device, and neither passing nor failing it is the
    honest answer. A NOT_APPLICABLE band therefore drops out of the outcome entirely, and it MUST name
    why (an unexplained one is refused below) — an inapplicable band that does not say what made it
    inapplicable is indistinguishable from a band quietly switched off.

    A device whose bands are ALL inapplicable reads UNKNOWN, never PASS — the same rule as the empty band
    set, and for the same reason: a device judged on nothing has not been judged (§∅). The count is named
    in the reason so the two cases stay distinguishable in the verdict."""
    if not bands:
        return "UNKNOWN", ["no band was evaluated for this device"]
    for band, decision in bands.items():
        if decision.get("status") not in _BAND_OUTCOMES:
            raise ValueError(f"band {band!r}: status {decision.get('status')!r} is not one of {_BAND_OUTCOMES}")
        if decision.get("status") == "NOT_APPLICABLE" and not decision.get("reason"):
            raise ValueError(f"band {band!r}: NOT_APPLICABLE without a reason says nothing about why it does not bind")
    applicable = {b: d for b, d in bands.items() if d["status"] != "NOT_APPLICABLE"}
    if not applicable:
        why = "; ".join(f"{b}: {d['reason']}" for b, d in bands.items())
        return "UNKNOWN", [f"every band is inapplicable for this device ({len(bands)}) — {why}"]
    fails = [f"{b}: {d.get('reason') or 'failed'}" for b, d in applicable.items() if d["status"] == "FAIL"]
    if fails:
        return "FAIL", fails
    unknowns = [f"{b}: {d.get('reason') or 'undecided'}" for b, d in applicable.items() if d["status"] == "UNKNOWN"]
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
    scope: dict | None = None,
) -> dict:
    """The night's `tepna.verdict/1`.

    `scope` is the recording this verdict is ABOUT (`solid_night_inputs.recording_scope`) — which folders
    it read, which it was judged in, and what wear it excluded as daytime. New and optional so every
    existing caller keeps working; surfaced in `result.scope` because a verdict that does not say what it
    measured cannot be checked (QC-SCOPE-RESOLUTION-2026-07-28's L4, applied to the judge).

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
    if scope is not None:
        result["scope"] = scope
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
    # 🔴 A SCOPE THAT CANNOT BE RESOLVED IS NOT A NIGHT THAT FAILED. The third-folder branch is a
    # TRIPWIRE that must never fire — a band runs 18:00 -> 10:00 and so touches exactly two calendar
    # dates, which bounds a clipped recording to two folders structurally (measured: 111 night recordings
    # on the mirror, 61 in one folder, 50 in two, ZERO in three). It is kept and asserted rather than
    # deleted, because a bound nobody checks is a bound nobody keeps; and if it ever does fire the night
    # is UNKNOWN with the reason rather than judged over a scope that was silently cut short.
    # ⚠️ `ok` MUST BE STATED, and `is not True` is the test rather than a falsy check with a default.
    # `scope.get("ok", True)` was my own §∅ violation: a scope that never said whether it resolved would
    # have been judged anyway, a default standing in for an unmeasured fact. The mutation gate found it
    # by perturbing that default — three mutants no test could distinguish, because the only input that
    # separates them is a scope with no `ok` key at all, which is exactly the case the rule is about.
    if scope is not None:
        if scope.get("ok") is not True:
            return _v.make(
                status="UNKNOWN",
                result=result,
                reason=str(scope.get("reason") or "the recording scope did not state whether it resolved"),
                **common,
            )
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

    ⚠️ NO NIGHTS AT ALL is `status: NOT_RUN` with every count NULL, never three zeros — a pass that
    examined nothing has not measured a run of length zero. `status` is `PASS` once the run reaches
    `EXIT_SOLID` and `SHORTFALL` below it, so a consumer reads the run's own verdict rather than
    re-deriving it from `exit`.

    One verdict per night: a date given twice is refused, since which of the two counts would be a guess.
    Dates are parsed before sorting, so the order is calendar order whatever ISO spelling came in."""
    # 🔴 EXAMINED NOTHING IS NOT A MEASURED ZERO (§🧾, §∅ in reverse). `consecutive([])` used to return
    # `solid 0 / nights 0 / days 0` and the sentence "0 solid of 0 nights over 0 days" — BYTE-IDENTICAL
    # to the answer for a pass that examined a night and found no run. Measured on the box 2026-10-04:
    # six judge passes (12:30, 13:34, 15:37, 17:35, 18:47, 19:37) each published that sentence while no
    # night had a verdict at all, so `history` had returned an empty list and there was nothing to count.
    # A reader cannot tell "no solid nights" from "no nights", and the three zeros state the stronger
    # claim. §🧾's word for a pass that examined nothing is NOT_RUN, so the counts go NULL and say so.
    if not nights:
        return {
            "solid": None,
            "nights": None,
            "days": None,
            "first": None,
            "last": None,
            "pending": None,
            "exit": False,  # not an exit, and not a claim about one: nothing was examined
            "status": "NOT_RUN",
            "statement": "no night was examined, so there is no run to report",
        }
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
        # The counts were MEASURED over at least one night, which is what separates this from the
        # NOT_RUN above. A caller that only prints `statement` still cannot conflate the two.
        "status": "PASS" if solid >= EXIT_SOLID else "SHORTFALL",
        "statement": f"{solid} solid of {span_nights} nights over {days} days",
    }


def night_verdict(night_dir: str, devices: list, *, commit: str | None = None, at: str | None = None) -> dict:
    """A SETTLED night's verdict, its band decisions supplied from the files beside it (`solid_night_inputs`).

    Only ever called for a settled night: the caller runs on the loss audit's own trigger, which fires once
    night N+1 has begun (§2's settle trigger), so `settled` is True by construction here."""
    scope = _inputs.recording_scope(night_dir)
    return compose(
        night=os.path.basename(night_dir.rstrip("/")),
        settled=True,
        devices=_inputs.score_devices(night_dir, devices),
        # EVERY folder the scope read is cited, not just the judged one — the evidence list is the
        # verdict's own account of what it opened.
        evidence=[TOOL, "capture-host/solid_night_inputs.py"]
        + [os.path.join(d, _inputs.LOSS_AUDIT_NAME) for d in (scope.get("dirs") or [night_dir])],
        commit=commit,
        at=at,
        scope=scope,
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
    night_dir: str,
    devices: list,
    *,
    nights: list[str],
    active: set[str],
    commit: str | None = None,
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


WITHDRAWN_NAME = "SOLID-VERDICT-WITHDRAWN.jsonl"
# How many superseded verdicts a night keeps. Six passes judged 2026-10-04 before its data was in, so a
# cap of one would have discarded five of the six and left exactly the trail that was missing.
WITHDRAWN_KEEP = 32


def _provenance(v: dict) -> dict:
    """The identifying fields of a verdict, for the withdrawal record.

    ⚠️ THE COMMIT LIVES IN `producedBy`, not at the top level — §🧾's own shape. My first version read
    `v.get("commit")` and would have published `null` for every real verdict while passing against
    synthetic dicts that carried a top-level key. A fixture has to carry the property the code reasons
    about; this one did not, and the result would have been an unmeasured field presented as measured
    (§∅). The top-level read stays as a fallback for a hand-written or legacy object."""
    return {
        "status": v.get("status"),
        "reason": v.get("reason"),
        "at": v.get("at"),
        "commit": ((v.get("producedBy") or {}).get("commit")) or v.get("commit"),
    }


def _withdraw(night_dir: str, replacement: dict) -> dict | None:
    """Record the verdict about to be REPLACED, before it is. Returns the withdrawal entry, or None.

    🔴 `os.replace` IS ATOMIC AND LOSSY, and the second property cost a night. Measured on the box
    2026-10-04: six judge passes (12:30 … 19:37) published verdicts over a night whose data had not
    arrived, the 19:37 UNKNOWN was overwritten by the 04:50 FAIL, and afterwards the night's own
    artefacts held no evidence that any of the six existed — the trail was reconstructible only from the
    journal, which rotates. A verdict is a published claim; withdrawing one is itself a fact, so it is
    recorded beside the night rather than erased.

    APPEND-ONLY and never fatal: a withdrawal that cannot be written must not stop the night getting its
    correct verdict, so the failure is reported in the return value and the replacement proceeds. Losing
    the record of a superseded claim is bad; refusing to publish the true one is worse."""
    path = os.path.join(night_dir, VERDICT_NAME)
    prior = _inputs.read_json(path)
    if prior is None:
        return None  # nothing published yet: a first verdict withdraws nothing
    entry = {
        "withdrawn": _provenance(prior),
        "replaced_by": _provenance(replacement),
        "reason": (
            "re-judged: the night's loss audit re-ran over data that had arrived since, so this verdict "
            "was composed over an input set that no longer describes the night"
        ),
        "at": replacement.get("at"),
    }
    kept: list[str] = []
    try:
        wpath = os.path.join(night_dir, WITHDRAWN_NAME)
        if os.path.exists(wpath):
            with open(wpath, encoding="utf-8") as fh:
                kept = [ln for ln in fh if ln.strip()]
        kept.append(json.dumps(entry) + "\n")
        with open(wpath, "w", encoding="utf-8") as fh:
            fh.writelines(kept[-WITHDRAWN_KEEP:])
    except OSError as exc:
        entry["recorded"] = False
        entry["record_error"] = str(exc)
        return entry
    entry["recorded"] = True
    return entry


def write_night(
    night_dir: str, devices: list, *, nights: list[str], active: set[str], commit: str | None = None
) -> tuple[dict, dict]:
    """Write the night's verdict beside its loss audit, with the run AS OF this night in `result.run` — the
    owner's exit counter, "S solid of N nights over D days" (§3.1). Returns `(verdict, run)` — the run
    separately, because a NOT_APPLICABLE verdict carries `result: null` by contract and has nowhere to hold it.

    A verdict already published here is WITHDRAWN with its reason (`_withdraw`) before it is replaced,
    never silently overwritten."""
    obj = night_verdict(night_dir, devices, commit=commit)
    captures = os.path.dirname(night_dir.rstrip("/"))
    night = os.path.basename(night_dir.rstrip("/"))
    past = [n for n in history(captures, nights, active) if n[0] < night]
    run = consecutive([*past, (night, obj["status"], obj["reason"])])
    if obj.get("result") is not None:
        obj["result"]["run"] = run
    _v.validate(obj)
    # WITHDRAW BEFORE REPLACING, not after: the prior verdict has to be read while it is still there.
    withdrawn = _withdraw(night_dir, obj)
    if withdrawn is not None and obj.get("result") is not None:
        obj["result"]["withdrew"] = withdrawn
    _v.validate(obj)
    tmp = os.path.join(night_dir, VERDICT_NAME + ".tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=1)
    os.replace(tmp, os.path.join(night_dir, VERDICT_NAME))
    return obj, run


SAMPLE_NIGHT = "2026-01-01"
SAMPLE_BASE = "Polar_H10_SAMPLE_20260101220000"
SAMPLE_DEVICE = {"name": "Polar H10 SAMPLE", "model": "H10"}
SAMPLE_ROWS = 401  # 2 Hz over exactly 200 s, inclusive of both ends
SAMPLE_BATCH = 4  # rows per BLE frame: one real host measurement, back-timed across the frame (§🔒.7)


def sample_night(night: str) -> list[dict]:
    """Lay out a synthetic CLEAN H10 night in `night` and return its device list.

    SPLIT OUT OF `sample_object` SO A TEST CAN MEASURE THE FIXTURE. Four properties of these bytes are
    load-bearing, and NONE of them is visible in the verdict the fixture produces — every band still
    passes when they are violated one at a time, which is why twenty-five mutations of this layout
    survived the gate while `sample_object` was the only way in:
      · `SAMPLE_ROWS` rows at 2 Hz, the first and last landing EXACTLY on the nominal, so the span is
        exactly 200 s and the completeness denominator is not a rounding;
      · host stamps in batches of `SAMPLE_BATCH` sharing one offset, because a BLE frame IS one host
        measurement and `residual_scan` takes one anchor per frame (treating each row as an anchor
        fabricates anchors out of an interpolation);
      · a per-row device offset, so the column is not a DRAWN counter (`clock.js CK_AXIS_DRAWN_SHARE`:
        a column advancing by a constant is by construction not a clock, and the timebase term would
        score the adoption gate's own sample as "not a clock");
      · a NON-NEGATIVE host offset, so no row crosses a whole second backwards.
    `test_the_SAMPLE_FIXTURE_carries_the_four_properties_it_needs` holds all four."""
    # THE START COMES FROM THE NAME, so the fixture cannot disagree with itself. The 14-digit stamp in
    # `SAMPLE_BASE` is the declared start (Clock Contract §4, anchor rule 2) and the only place it is
    # written; a second literal here was one more thing to keep in step, and `datetime(2026, 1, 1, 22,
    # 0, 0)` with its trailing default second was two mutation sites that could not change an answer.
    t0 = _dt.datetime.strptime(SAMPLE_BASE.rsplit("_", 1)[1], "%Y%m%d%H%M%S")

    def put(name: str, text: str) -> None:
        with open(os.path.join(night, name), "w", encoding="utf-8") as fh:
            fh.write(text)

    rows = []
    for i in range(SAMPLE_ROWS):
        frame = i // SAMPLE_BATCH
        # ONE OFFSET PER FRAME, AND THE EDGE RULE IS STATED IN FRAMES. It used to be `i < SAMPLE_BATCH or
        # i >= SAMPLE_ROWS - SAMPLE_BATCH`, which STRADDLES the frame grid: 401 rows is 100 frames plus a
        # row, so that zeroed rows 397-400 — three of them inside the frame that starts at 396. A frame
        # with two offsets is two host measurements, which is the thing this fixture exists not to be, and
        # the straddle is why the property could not be stated as a test at all (seven of the twenty-five
        # survivors lived in that one expression). Zero on the FIRST frame and on the last lone row is all
        # property 1 needs: the span's two ends land on the nominal.
        jit = 0 if (frame == 0 or i == SAMPLE_ROWS - 1) else (1 + frame % 5)
        ns = int(i / 2 * 1e9) + ((i * 7919) % 211)
        t = t0 + _dt.timedelta(seconds=i / 2, milliseconds=jit)
        rows.append(f"{t.isoformat(timespec='milliseconds')};{ns};{i};100")
    put(
        f"{SAMPLE_BASE}_ECG.txt",
        "Phone timestamp;sensor timestamp [ns];timestamp [ms];ecg [uV]\n" + "\n".join(rows) + "\n",
    )
    put(
        f"{SAMPLE_BASE}_ECGSEAMS.txt",
        f"# pmd stream=ecg negotiated=yes rate=2 offered=2\n# final stream=ecg seams=0 examined={SAMPLE_ROWS}\n",
    )
    put(f"{SAMPLE_BASE}_ECGRUNS.txt", "# stream=ecg rule=stuck min_run=30\n")
    put(
        _inputs.LOSS_AUDIT_NAME,
        json.dumps(
            {
                "journal": "read",
                # §A5's record set, read and empty: the sample is a CLEAN night, so the honest value
                # is "the journal was read and no clock event happened" — `[]`, never a missing key
                # (an audit older than the record) and never `null` (journalctl unavailable). Those
                # are the three absences the tripwire must tell apart, and the sample shows the one
                # that lets it run.
                "clock_events": [],
                "devices": {
                    SAMPLE_DEVICE["name"]: {
                        "file": f"{SAMPLE_BASE}_ECG.txt",
                        "gaps": [],
                        "wear": {"available": True, "worn_end": {"at": "2026-01-01T22:03:00", "reason": "doff"}},
                    }
                },
            }
        ),
    )
    return [dict(SAMPLE_DEVICE)]


def sample_object() -> dict:
    """Corpus-free emission for the adoption gate: a synthetic CLEAN H10 night laid out as the box writes
    one, scored by the real `night_verdict`.

    EVERY band PASSES from its real inputs, and the night with them. It read UNKNOWN until §A5 landed,
    because the timebase term then named the residual pass it was waiting for; the tripwire now runs over
    this axis, finds no candidate, and the sample became the thing it claims to be."""
    import tempfile

    with tempfile.TemporaryDirectory() as d:
        night = os.path.join(d, SAMPLE_NIGHT)
        os.makedirs(night)
        return night_verdict(night, sample_night(night))
